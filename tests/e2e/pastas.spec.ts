import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { conectar, scriptFalso, URL_DO_SCRIPT, type ScriptFalso } from '../apoio/script-e2e';

// Pastas na sala e "Nova pasta" (V02, Tarefa 12), no navegador. O script de verdade responde a tudo
// (sincronia incluída) e só a criação de planilha é de mentira (o Drive e o Planilhas na memória ainda
// não existem aqui): devolve `planilha-ficticia-N`. Quinta-feira, 2026-11-05, 12:20 em Lisboa.
const AGORA = '2026-11-05T12:20:00+00:00';

/** Com CAPTURAS_T12 definida, as imagens vão para essa pasta (conferência visual). */
const CAPTURAS = process.env.CAPTURAS_T12;
async function capturar(page: Page, nome: string) {
  if (!CAPTURAS) return;
  mkdirSync(CAPTURAS, { recursive: true });
  await page.screenshot({ path: join(CAPTURAS, `${nome}.png`), fullPage: true });
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(AGORA);
});

/** Liga o script falso e acrescenta `criarPlanilha`: as outras ações seguem para o script de verdade. */
async function ligar(page: Page) {
  const script: ScriptFalso = scriptFalso();
  const ligacao = await script.ligarA(page);
  const criadas: { nome: string; modelo: string }[] = [];
  await page.route(URL_DO_SCRIPT, async (rota) => {
    const { acao, dados } = rota.request().postDataJSON() as { acao: string; dados: { nome: string; modelo: string } };
    if (acao !== 'criarPlanilha') return rota.fallback();
    criadas.push({ nome: dados.nome, modelo: dados.modelo });
    return rota.fulfill({
      headers: { 'access-control-allow-origin': '*' },
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, dados: { planilhaId: `planilha-ficticia-${criadas.length}` } }),
    });
  });
  return { script, ligacao, criadas };
}

async function abrir(page: Page, hash: string) {
  const ambiente = await ligar(page);
  await page.goto('/central-app/');
  await conectar(page);
  await page.goto(`/central-app/${hash}`);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  return ambiente;
}

const semRolagemDeLado = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

/** Controles visíveis com menos de 44 px; o botão de escolha do tipo vale pelo cartão (o rótulo se estende por ele todo). */
async function pequenos(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const achados: string[] = [];
    for (const controle of document.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, summary')) {
      const alvo = controle instanceof HTMLInputElement && controle.type === 'radio' ? (controle.closest<HTMLElement>('.pastas-tipo') ?? controle) : controle;
      const caixa = alvo.getBoundingClientRect();
      if (caixa.width === 0 && caixa.height === 0) continue;
      if (caixa.height < 43.5 || caixa.width < 43.5) {
        achados.push(`${controle.textContent?.trim().slice(0, 30) || controle.outerHTML.slice(0, 60)} (${Math.round(caixa.width)}x${Math.round(caixa.height)})`);
      }
    }
    return achados;
  });
}

async function semAchadosDoAxe(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(violations.filter((v) => v.impact === 'critical' || v.impact === 'serious').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
}

test.describe('computador, 1280 px', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('Casa sem pastas: cria as 6 padrão, aparecem na sala e no menu, e uma delas abre', async ({ page }) => {
    const erros: string[] = [];
    page.on('pageerror', (erro) => erros.push(erro.message));
    const { criadas } = await abrir(page, '#/sala/sala-casa');
    const pastas = page.getByRole('region', { name: 'Pastas' });
    await capturar(page, 'casa-vazia-desktop');

    await pastas.getByRole('button', { name: 'Criar pastas padrão da Casa' }).click();

    await expect(pastas.getByRole('link')).toHaveCount(6);
    expect(criadas.map((c) => c.modelo)).toEqual(['compras', 'compras', 'consumo', 'consumo', 'consumo', 'financeiro']);
    await expect(pastas.getByText('Pastas da Casa criadas')).toBeVisible();
    // O menu da Casa lista as 6.
    const submenu = page.getByRole('navigation', { name: 'Principal' }).getByRole('list', { name: 'Pastas da Casa' });
    await expect(submenu.getByRole('link')).toHaveCount(6);
    await capturar(page, 'casa-com-pastas-desktop');

    await pastas.getByRole('link', { name: /Consumo de Água/ }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Consumo de Água' })).toBeVisible();
    await expect(page).toHaveURL(/#\/sala\/sala-casa\/pasta\/pasta-casa-consumo-agua$/);
    const planilha = page.getByRole('link', { name: /Abrir no Google Planilhas/ });
    await expect(planilha).toHaveAttribute('href', /^https:\/\/docs\.google\.com\/spreadsheets\/d\/planilha-ficticia-\d$/);
    await expect(planilha).toHaveAttribute('target', '_blank');
    await expect(submenu.getByRole('link', { name: 'Consumo de Água' })).toHaveAttribute('aria-current', 'page');
    await capturar(page, 'pasta-desktop');
    await semAchadosDoAxe(page);
    expect(erros).toEqual([]);
  });

  test('Nova pasta comum em Doutoramento: formulário, criar, abrir, renomear, apagar e desfazer', async ({ page }) => {
    const { criadas } = await abrir(page, '#/sala/sala-doutoramento');
    const pastas = page.getByRole('region', { name: 'Pastas' });

    // Sala sem pastas: só a linha fina, sem texto de vazio nem cartão grande.
    await expect(pastas.getByText(/Nenhuma pasta/)).toHaveCount(0);
    await capturar(page, 'doutoramento-sem-pastas-desktop');
    await pastas.getByRole('button', { name: /Nova pasta/ }).click();
    const form = page.getByRole('form', { name: 'Nova pasta' });
    // Fora da Casa não há escolha de tipo: só o nome (cria pasta comum).
    await expect(form.getByRole('radio')).toHaveCount(0);
    await capturar(page, 'nova-pasta-desktop');
    await semAchadosDoAxe(page);
    await form.getByLabel('Nome da pasta').fill('Metodologia');
    await form.getByRole('button', { name: 'Criar pasta' }).click();

    await expect(pastas.getByText('Pasta criada')).toBeVisible();
    expect(criadas).toEqual([]); // pasta comum não chama o Google
    await pastas.getByRole('link', { name: 'Abrir' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Metodologia' })).toBeVisible();

    await page.getByRole('button', { name: 'Renomear' }).click();
    await page.getByLabel('Novo nome').fill('Metodologia da tese');
    await page.getByRole('button', { name: 'Salvar nome' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Metodologia da tese' })).toBeVisible();

    await page.getByRole('button', { name: 'Apagar pasta' }).click();
    await expect(page.getByText('Pasta apagada')).toBeVisible();
    await page.getByRole('button', { name: 'Desfazer', exact: true }).click();
    await expect(page.getByText('Desfeito')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Metodologia da tese' })).toBeVisible();
  });

  test('Nova pasta de registro: serviço, unidade e dia de envio; a planilha é criada com o modelo de consumo', async ({ page }) => {
    const { criadas } = await abrir(page, '#/sala/sala-casa');
    const pastas = page.getByRole('region', { name: 'Pastas' });
    await pastas.getByRole('button', { name: /Nova pasta/ }).click();
    const form = page.getByRole('form', { name: 'Nova pasta' });

    await form.getByRole('radio', { name: 'Registro' }).check();
    await form.getByLabel('Serviço').selectOption('luz');
    await expect(form.getByText('Unidade: kWh (vem do serviço)')).toBeVisible();
    await capturar(page, 'nova-pasta-registro-desktop');
    await form.getByLabel('Nome da pasta').fill('Luz do apartamento');
    await form.getByLabel('Dia de envio (opcional)').fill('7');
    await form.getByRole('button', { name: 'Criar pasta' }).click();

    await expect(pastas.getByText('Pasta criada')).toBeVisible();
    expect(criadas).toEqual([{ nome: 'Luz do apartamento', modelo: 'consumo' }]);
    await expect(pastas.getByRole('link', { name: /Luz do apartamento/ })).toContainText('Luz · kWh · envio no dia 7');
  });

  test('sem internet: avisa, não cria nada e funciona ao voltar', async ({ page }) => {
    const { ligacao, criadas } = await abrir(page, '#/sala/sala-casa');
    const pastas = page.getByRole('region', { name: 'Pastas' });
    ligacao.cair();

    await pastas.getByRole('button', { name: 'Criar pastas padrão da Casa' }).click();

    await expect(pastas.getByRole('alert')).toContainText('Nada foi criado');
    expect(criadas).toEqual([]);
    await capturar(page, 'casa-sem-internet-desktop');
    ligacao.voltar();
    // O "Tentar de novo" fica dentro do bloco do aviso.
    await pastas.getByRole('alert').getByRole('button', { name: 'Tentar de novo' }).click();
    await expect(pastas.getByRole('link')).toHaveCount(6);
  });
});

test.describe('celular, 375 px', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('as pastas ficam em duas colunas, sem rolagem de lado, e o formulário cabe na tela', async ({ page }) => {
    await abrir(page, '#/sala/sala-casa');
    const pastas = page.getByRole('region', { name: 'Pastas' });
    await capturar(page, 'casa-vazia-celular');

    await pastas.getByRole('button', { name: 'Criar pastas padrão da Casa' }).click();
    await expect(pastas.getByRole('link')).toHaveCount(6);
    // Duas colunas: o 2º cartão fica ao lado do 1º, o 3º volta para a margem esquerda, e o selo não cobre o nome.
    const caixas = await pastas.getByRole('link').evaluateAll((links) => links.map((l) => l.getBoundingClientRect().toJSON() as { left: number; top: number; width: number }));
    expect(caixas[1].left).toBeGreaterThan(caixas[0].left);
    expect(Math.abs(caixas[1].top - caixas[0].top)).toBeLessThan(4); // (o cartão sob o mouse sobe 2 px)
    expect(caixas[2].left).toBe(caixas[0].left);
    expect(caixas[2].top).toBeGreaterThan(caixas[0].top);
    const cobertos = await pastas.getByRole('link').evaluateAll((links) =>
      links.filter((l) => {
        const selo = l.querySelector('.pasta-selo')!.getBoundingClientRect();
        const nome = l.querySelector('.pasta-nome')!.getBoundingClientRect();
        return selo.left < nome.right && selo.right > nome.left && selo.top < nome.bottom && selo.bottom > nome.top;
      }).length,
    );
    expect(cobertos).toBe(0);
    // O cartão "Nova pasta" ocupa a linha toda.
    const nova = await pastas.getByRole('button', { name: /Nova pasta/ }).evaluate((b) => b.getBoundingClientRect().width);
    expect(nova).toBeGreaterThan(caixas[0].width * 1.8);
    expect(await semRolagemDeLado(page)).toBe(true);
    await capturar(page, 'sala-com-pastas-celular');

    await pastas.getByRole('button', { name: /Nova pasta/ }).click();
    const form = page.getByRole('form', { name: 'Nova pasta' });
    await form.getByRole('radio', { name: 'Registro' }).check();
    await expect(form.getByLabel('Dia de envio (opcional)')).toBeVisible();
    expect(await semRolagemDeLado(page)).toBe(true);
    expect(await pequenos(page)).toEqual([]);
    await form.scrollIntoViewIfNeeded();
    await capturar(page, 'nova-pasta-celular');
    await semAchadosDoAxe(page);
  });

  test('sala sem pastas e Nova pasta fora da Casa no celular: linha fina, só o nome, cabe na tela', async ({ page }) => {
    await abrir(page, '#/sala/sala-doutoramento');
    const pastas = page.getByRole('region', { name: 'Pastas' });
    await expect(pastas.getByText(/Nenhuma pasta/)).toHaveCount(0);
    await pastas.getByRole('button', { name: /Nova pasta/ }).click();
    const form = page.getByRole('form', { name: 'Nova pasta' });
    await expect(form.getByLabel('Nome da pasta')).toBeVisible();
    await expect(form.getByRole('radio')).toHaveCount(0);
    expect(await semRolagemDeLado(page)).toBe(true);
    expect(await pequenos(page)).toEqual([]);
    await capturar(page, 'doutoramento-nova-pasta-celular');
    await semAchadosDoAxe(page);
  });

  test('a página da pasta cabe no celular e o link da planilha tem toque de 44 px', async ({ page }) => {
    await abrir(page, '#/sala/sala-casa');
    await page.getByRole('region', { name: 'Pastas' }).getByRole('button', { name: 'Criar pastas padrão da Casa' }).click();
    // O Financeiro só funciona no computador (Tarefa 16): no celular a página que mostra o link da planilha é a do Registro.
    await page.getByRole('region', { name: 'Pastas' }).getByRole('link', { name: /Consumo de Água/ }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Consumo de Água' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Abrir no Google Planilhas/ })).toBeVisible();
    expect(await semRolagemDeLado(page)).toBe(true);
    expect(await pequenos(page)).toEqual([]);
    await capturar(page, 'pasta-celular');
  });
});
