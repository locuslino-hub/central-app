import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { planilhasNaMemoria } from '../apoio/planilhas-e2e';
import { conectar, scriptFalso } from '../apoio/script-e2e';

// Financeiro (V02, Tarefa 16), no navegador: a pasta Financeiro lê a planilha, mostra cartões, barras e tabela do mês,
// recebe um gasto por voz (Pode falar) ou pelo formulário e deixa trocar a categoria. No celular só diz "Abra no computador".
// As planilhas são de mentira (`planilhas-e2e.ts`); o resto é o código de verdade. Quinta-feira, 2026-11-05, 12:20 em
// Lisboa. Descrições, nomes e valores fictícios.
const AGORA = '2026-11-05T12:20:00+00:00';
const gasto = (Data: string, Descrição: string, Categoria: string, Valor: string, extra: Record<string, string> = {}) => ({
  Data,
  Descrição,
  Categoria,
  Tipo: 'Débito',
  Valor,
  Quem: 'Marina',
  Observação: '',
  ...extra,
});
// O histórico vale para todas as planilhas criadas; as outras pastas ignoram as colunas que não são delas.
const HISTORICO = [
  gasto('2026-11-01', 'Mercado', 'Alimentação', '42,30'),
  gasto('2026-11-03', 'Gasolina', 'Transporte', '30', { Tipo: 'Crédito', Quem: 'Renata' }),
  gasto('2026-11-04', 'Cinema', 'Lazer', '18,50'),
  gasto('2026-10-20', 'Aluguel', 'Casa', '600'),
];

/** Com CAPTURAS_T16 definida, as imagens vão para essa pasta (conferência visual). */
const CAPTURAS = process.env.CAPTURAS_T16;
async function capturar(page: Page, nome: string) {
  if (!CAPTURAS) return;
  mkdirSync(CAPTURAS, { recursive: true });
  await page.screenshot({ path: join(CAPTURAS, `${nome}.png`), fullPage: true });
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(AGORA);
});

/** Abre a Casa, cria as 6 pastas padrão e entra em Financeiro (a 6ª planilha criada). */
async function abrirFinanceiro(page: Page) {
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
  await pastas.getByRole('link', { name: /Financeiro/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Financeiro' })).toBeVisible();
  return { script, planilhas };
}

const semRolagemDeLado = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

async function semAchadosDoAxe(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(violations.filter((v) => v.impact === 'critical' || v.impact === 'serious').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
}

test.describe('computador, 1280 px', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('lê a planilha: cartões, barras por categoria e tabela do mês, sem rolagem de lado e sem erro grave de acessibilidade', async ({ page }) => {
    const erros: string[] = [];
    page.on('pageerror', (erro) => erros.push(erro.message));
    await abrirFinanceiro(page);

    const tabela = page.getByRole('table', { name: 'Gastos do mês' });
    await expect(tabela.getByRole('row')).toHaveCount(4); // cabeçalho + 3 gastos de novembro
    await expect(tabela.getByRole('row').nth(1)).toContainText('Cinema');
    const cartoes = page.getByRole('list', { name: 'Resumo do mês' });
    await expect(cartoes).toContainText('€ 90,80');
    await expect(cartoes).toContainText('Alimentação');
    await expect(page.getByRole('list', { name: 'Gastos por categoria' }).getByRole('listitem')).toHaveCount(3);
    await expect(page.getByRole('link', { name: /Abrir planilha/ })).toHaveAttribute('href', /docs\.google\.com\/spreadsheets\/d\/planilha-ficticia-6$/);

    await page.getByRole('button', { name: 'Mês anterior' }).click();
    await expect(page.getByText('outubro de 2026')).toBeVisible();
    await expect(tabela.getByRole('row')).toHaveCount(2);
    await page.getByRole('button', { name: 'Mês seguinte' }).click();

    await expect(tabela.getByRole('row')).toHaveCount(4);
    expect(await semRolagemDeLado(page)).toBe(true);
    await capturar(page, 'financeiro-desktop');
    await semAchadosDoAxe(page);
    expect(erros).toEqual([]);
  });

  test('gasto por voz aparece na tabela do desktop', async ({ page }) => {
    const { planilhas } = await abrirFinanceiro(page);
    const tabela = page.getByRole('table', { name: 'Gastos do mês' });
    await expect(tabela.getByRole('row')).toHaveCount(4);

    await page.keyboard.press('Control+Alt+KeyN');
    await expect(page).toHaveURL(/#\/falar$/);
    await page.getByRole('textbox', { name: 'Texto falado' }).fill('gastei 5,50 hoje comprando salgado');
    await page.getByRole('button', { name: 'Pronto' }).click();

    const cartao = page.getByRole('article');
    await expect(cartao).toContainText('Gasto guardado');
    await expect(cartao).toContainText('€ 5,50 · Alimentação · Débito');
    expect(planilhas.linhas(6).at(-1)?.valores).toMatchObject({ Data: '2026-11-05', Descrição: 'salgado', Categoria: 'Alimentação', Tipo: 'Débito', Valor: '5.5', Quem: 'Central' });
    await capturar(page, 'financeiro-cartao-voz');
    await semAchadosDoAxe(page);

    // Trocar categoria: a linha da planilha e o cartão mudam.
    await cartao.getByRole('button', { name: 'Trocar categoria' }).click();
    await capturar(page, 'financeiro-trocar-categoria');
    await page.getByRole('group', { name: 'Trocar categoria' }).getByRole('button', { name: 'Lazer' }).click();
    await expect(cartao).toContainText('€ 5,50 · Lazer · Débito');
    await expect.poll(() => planilhas.linhas(6).at(-1)?.valores['Categoria']).toBe('Lazer');

    // Volta para a pasta: o gasto novo está na tabela, a data mais recente primeiro.
    await cartao.getByRole('button', { name: 'Fechar' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Financeiro' })).toBeVisible();
    await expect(tabela.getByRole('row')).toHaveCount(5);
    await expect(tabela.getByRole('row').nth(1)).toContainText('salgado');
    await expect(tabela.getByRole('row').nth(1)).toContainText('€ 5,50');
    await expect(page.getByRole('list', { name: 'Resumo do mês' })).toContainText('€ 96,30');
  });

  test('frase comum dita não vai para o Financeiro', async ({ page }) => {
    const { planilhas } = await abrirFinanceiro(page);
    await expect(page.getByRole('table', { name: 'Gastos do mês' })).toBeVisible();

    for (const frase of ['preciso pagar 50 de luz amanhã', 'gastei 3 horas revisando o capítulo 2', 'será que gastei 20 euros?', 'paguei 2 contas']) {
      await page.keyboard.press('Control+Alt+KeyN');
      await page.getByRole('textbox', { name: 'Texto falado' }).fill(frase);
      await page.getByRole('button', { name: 'Pronto' }).click();
      await expect(page.getByRole('article')).toBeVisible();
      await expect(page.getByRole('article')).not.toContainText('Gasto guardado');
      expect(planilhas.linhas(6)).toHaveLength(4);
      await page.getByRole('article').getByRole('button', { name: 'Fechar' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Financeiro' })).toBeVisible();
    }
  });

  test('gasto pelo formulário: guarda com Desfazer e a linha continua na planilha, marcada "desfeito"', async ({ page }) => {
    const { planilhas } = await abrirFinanceiro(page);
    const tabela = page.getByRole('table', { name: 'Gastos do mês' });
    await expect(tabela.getByRole('row')).toHaveCount(4);

    const form = page.getByRole('form', { name: 'Novo gasto' });
    await form.getByLabel('Valor (€)').fill('12,50');
    await form.getByLabel('Descrição').fill('Livraria');
    await form.getByLabel(/^Categoria/).fill('lazer');
    await form.getByRole('button', { name: 'Guardar gasto' }).click();

    const resultado = page.getByRole('article');
    await expect(resultado).toContainText('Gasto guardado');
    await expect(resultado).toContainText('€ 12,50 · Lazer · Débito');
    await expect(tabela.getByRole('row')).toHaveCount(5);
    expect(planilhas.linhas(6).at(-1)?.valores).toMatchObject({ Categoria: 'Lazer', Quem: 'Central', Valor: '12.5' });

    await resultado.getByRole('button', { name: 'Desfazer' }).click();
    await expect(resultado).toContainText('Gasto desfeito');
    await expect(tabela.getByRole('row')).toHaveCount(4);
    expect(planilhas.linhas(6)).toHaveLength(5);
    expect(planilhas.linhas(6).at(-1)?.valores['Observação']).toBe('desfeito');
  });
});

// O celular é o aparelho (toque e tela estreita), não a janela: o teste liga a emulação de celular do navegador.
test.describe('celular, 375 px', () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

  test('diz "Abra no computador", esconde a tabela, cabe na tela e a voz de gasto funciona', async ({ page }) => {
    const { planilhas } = await abrirFinanceiro(page);

    await expect(page.getByText('Abra no computador')).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
    await expect(page.getByRole('form', { name: 'Novo gasto' })).toHaveCount(0);
    expect(await semRolagemDeLado(page)).toBe(true);
    await capturar(page, 'financeiro-celular');
    await semAchadosDoAxe(page);

    await page.getByRole('link', { name: 'Pode falar' }).click();
    await page.getByRole('textbox', { name: 'Texto falado' }).fill('gastei 5,50 hoje comprando salgado');
    await page.getByRole('button', { name: 'Pronto' }).click();
    await expect(page.getByRole('article')).toContainText('€ 5,50 · Alimentação · Débito');
    expect(planilhas.linhas(6).at(-1)?.valores).toMatchObject({ Descrição: 'salgado', Valor: '5.5' });
    expect(await semRolagemDeLado(page)).toBe(true);
    await semAchadosDoAxe(page);
  });
});

// Computador com zoom de 200% (janela de 640 px) e de 400% (320 px): o ponteiro é o mouse, então o Financeiro continua,
// com a tabela rolando dentro do próprio quadro e a página sem rolagem de lado (WCAG 1.4.10, reflow).
for (const largura of [640, 320]) {
  test.describe(`computador com zoom, janela de ${largura} px`, () => {
    test.use({ viewport: { width: largura, height: 800 } });

    test('mostra o Financeiro inteiro, sem rolagem de lado e com a tabela rolando no próprio quadro', async ({ page }) => {
      await abrirFinanceiro(page);

      await expect(page.getByText('Abra no computador')).toHaveCount(0);
      const tabela = page.getByRole('table', { name: 'Gastos do mês' });
      await expect(tabela).toBeVisible();
      await expect(page.getByRole('form', { name: 'Novo gasto' })).toBeVisible();
      expect(await semRolagemDeLado(page)).toBe(true);
      // A tabela não é espremida: o quadro dela rola (e se alcança com o teclado).
      const quadro = page.getByRole('region', { name: /Tabela de gastos do mês/ });
      await expect(quadro).toHaveAttribute('tabindex', '0');
      if (largura === 320) expect(await quadro.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
      await semAchadosDoAxe(page);
    });
  });
}
