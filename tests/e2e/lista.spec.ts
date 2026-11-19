import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { planilhasNaMemoria } from '../apoio/planilhas-e2e';
import { conectar, scriptFalso } from '../apoio/script-e2e';

// Lista de compras (V02, Tarefa 14), no navegador: a pasta Lista de Compras Semanais lê a planilha, marca comprado, limpa os
// comprados da vista, guarda item novo com Desfazer e recebe itens pela voz. As planilhas são de mentira (`planilhas-e2e.ts`);
// o resto é o código de verdade. Quinta-feira, 2026-11-05, 12:20 em Lisboa. Itens e nomes fictícios.
const AGORA = '2026-11-05T12:20:00+00:00';
const compra = (item: string, extra: Record<string, string> = {}) => ({
  Item: item,
  Quantidade: '',
  Valor: '',
  Link: '',
  Prioridade: '',
  'Comprado?': '',
  'Quem pôs': 'Marina',
  Data: '2026-11-01',
  Observação: '',
  ...extra,
});
const HISTORICO = [compra('Leite', { Quantidade: '2' }), compra('Pão'), compra('Ovos', { 'Comprado?': 'TRUE', 'Quem pôs': 'Renata' })];

/** Com CAPTURAS_T14 definida, as imagens vão para essa pasta (conferência visual). */
const CAPTURAS = process.env.CAPTURAS_T14;
async function capturar(page: Page, nome: string) {
  if (!CAPTURAS) return;
  mkdirSync(CAPTURAS, { recursive: true });
  await page.screenshot({ path: join(CAPTURAS, `${nome}.png`), fullPage: true });
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(AGORA);
});

/** Abre a Casa, cria as 6 pastas padrão e entra em Lista de Compras Semanais (a 1ª planilha criada). */
async function abrirListaSemanal(page: Page) {
  const script = scriptFalso();
  await script.ligarA(page);
  const planilhas = await planilhasNaMemoria(page, { historico: HISTORICO });
  await page.goto('/central-app/');
  await conectar(page);
  await page.goto('/central-app/#/sala/sala-casa');
  await page.reload();
  const pastas = page.getByRole('region', { name: 'Pastas' });
  await pastas.getByRole('button', { name: 'Criar pastas padrão da Casa' }).click();
  await expect(pastas.getByRole('link')).toHaveCount(6);
  await pastas.getByRole('link', { name: /Lista de Compras Semanais/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Lista de Compras Semanais' })).toBeVisible();
  return { script, planilhas };
}

const semRolagemDeLado = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

async function semAchadosDoAxe(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(violations.filter((v) => v.impact === 'critical' || v.impact === 'serious').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
}

test.describe('computador, 1280 px', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('lê a planilha, marca comprado, limpa os comprados e guarda um item com Desfazer', async ({ page }) => {
    const erros: string[] = [];
    page.on('pageerror', (erro) => erros.push(erro.message));
    const { planilhas } = await abrirListaSemanal(page);

    const aComprar = page.getByRole('list', { name: 'Itens a comprar' });
    await expect(aComprar.getByRole('checkbox')).toHaveCount(2);
    await expect(page.getByRole('list', { name: 'Itens comprados' }).getByRole('checkbox', { name: 'Ovos' })).toBeChecked();
    await expect(page.getByRole('link', { name: /Abrir no Google Planilhas/ })).toBeVisible();
    await capturar(page, 'lista-desktop');
    await semAchadosDoAxe(page);

    await aComprar.getByRole('checkbox', { name: 'Leite' }).click();
    await expect(page.getByRole('list', { name: 'Itens comprados' }).getByRole('checkbox', { name: 'Leite' })).toBeChecked();
    await expect.poll(() => planilhas.linhas(1)[0]?.valores['Comprado?']).toBe('TRUE');

    await page.getByRole('button', { name: 'Limpar comprados' }).click();
    await expect(page.getByRole('list', { name: 'Itens comprados' })).toHaveCount(0);
    expect(planilhas.linhas(1)).toHaveLength(3); // nenhuma linha foi apagada
    await page.getByRole('button', { name: /Mostrar comprados/ }).click();
    await expect(page.getByRole('list', { name: 'Itens comprados' }).getByRole('checkbox')).toHaveCount(2);

    const form = page.getByRole('form', { name: 'Novo item' });
    await form.getByLabel('Item').fill('Manteiga');
    await form.getByRole('button', { name: 'Pôr na lista' }).click();
    const cartao = page.getByRole('article');
    await expect(cartao).toContainText('Item guardado');
    expect(planilhas.linhas(1).at(-1)?.valores).toMatchObject({ Item: 'Manteiga', 'Quem pôs': 'Central', Data: '2026-11-05' });

    await cartao.getByRole('button', { name: 'Desfazer' }).click();
    await expect(cartao).toContainText('Item desfeito');
    expect(planilhas.linhas(1)).toHaveLength(4); // a linha continua na planilha, marcada "desfeito"
    expect(planilhas.linhas(1).at(-1)?.valores['Observação']).toBe('desfeito');
    expect(erros).toEqual([]);
  });

  test('o Pode falar dentro da pasta manda "leite e pão" para ela, e repetido pergunta antes', async ({ page }) => {
    const { planilhas } = await abrirListaSemanal(page);
    await expect(page.getByRole('list', { name: 'Itens a comprar' })).toBeVisible();

    await page.keyboard.press('Control+Alt+KeyN');
    await expect(page).toHaveURL(/#\/falar$/);
    await page.getByRole('textbox', { name: 'Texto falado' }).fill('café e leite');
    await page.getByRole('button', { name: 'Pronto' }).click();

    await expect(page.getByText('Item guardado')).toBeVisible();
    await expect(page.getByText(/Já estava na lista: “leite”/)).toBeVisible();
    expect(planilhas.linhas(1).map((l) => l.valores['Item'])).toEqual(['Leite', 'Pão', 'Ovos', 'café']);
    await page.getByRole('button', { name: 'Pôr mesmo assim' }).click();
    await expect.poll(() => planilhas.linhas(1).map((l) => l.valores['Item'])).toEqual(['Leite', 'Pão', 'Ovos', 'café', 'leite']);
  });
});

test.describe('celular, 375 px', () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true }); // o celular é o aparelho (toque + tela estreita), não só a janela

  test('cabe na tela, sem rolagem de lado, sem link da planilha, e marcar e pôr item funcionam', async ({ page }) => {
    await abrirListaSemanal(page);
    const form = page.getByRole('form', { name: 'Novo item' });
    await expect(form).toBeVisible();
    await expect(page.getByRole('link', { name: /Google Planilhas/ })).toHaveCount(0);
    expect(await semRolagemDeLado(page)).toBe(true);

    await page.getByRole('list', { name: 'Itens a comprar' }).getByRole('checkbox', { name: 'Pão' }).click();
    await expect(page.getByRole('list', { name: 'Itens comprados' }).getByRole('checkbox', { name: 'Pão' })).toBeChecked();
    await form.getByLabel('Item').fill('Manteiga');
    await form.getByRole('button', { name: 'Pôr na lista' }).click();
    await expect(page.getByRole('article')).toContainText('Item guardado');
    expect(await semRolagemDeLado(page)).toBe(true);
    await capturar(page, 'lista-celular');
    await semAchadosDoAxe(page);
  });
});
