import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { planilhasNaMemoria } from '../apoio/planilhas-e2e';
import { conectar, scriptFalso } from '../apoio/script-e2e';

// Registro de consumo (V02, Tarefa 13), no navegador: a pasta Consumo de Água lê a planilha, mostra tabela e gráfico por
// mês, guarda uma leitura com Desfazer e lembra do envio. As planilhas são de mentira (`planilhas-e2e.ts`); o resto é o
// código de verdade. Quinta-feira, 2026-11-05, 12:20 em Lisboa. Valores fictícios.
const AGORA = '2026-11-05T12:20:00+00:00';
const HISTORICO = [
  { Data: '15/09/2026', Leitura: '980', Unidade: 'm³', Observação: '' },
  { Data: '01/10/2026', Leitura: '1000', Unidade: 'm³', Observação: '' },
  { Data: '01/11/2026', Leitura: '1012', Unidade: 'm³', Observação: '' },
];

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(AGORA);
});

/** Abre a Casa, cria as 6 pastas padrão e entra em Consumo de Água (que é a 3ª planilha criada). */
async function abrirConsumoDeAgua(page: Page) {
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
  await pastas.getByRole('link', { name: /Consumo de Água/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Consumo de Água' })).toBeVisible();
  return { script, planilhas };
}

const semRolagemDeLado = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

async function semAchadosDoAxe(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(violations.filter((v) => v.impact === 'critical' || v.impact === 'serious').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
}

test.describe('computador, 1280 px', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('lê a planilha, guarda uma leitura com Desfazer e mostra o consumo por mês', async ({ page }) => {
    const erros: string[] = [];
    page.on('pageerror', (erro) => erros.push(erro.message));
    const { planilhas } = await abrirConsumoDeAgua(page);

    const tabela = page.getByRole('table', { name: 'Leituras registradas' });
    await expect(tabela.getByRole('row')).toHaveCount(4); // cabeçalho + 3 leituras
    const grafico = page.getByRole('list', { name: 'Consumo por mês' });
    await expect(grafico.getByRole('listitem')).toHaveCount(2);
    await expect(grafico.getByRole('listitem').nth(0)).toContainText('out/26');
    await expect(grafico.getByRole('listitem').nth(0)).toContainText('20 m³');
    await semAchadosDoAxe(page);

    const form = page.getByRole('form', { name: 'Nova leitura' });
    await form.getByLabel(/^Leitura/).fill('1020,5');
    await form.getByRole('button', { name: 'Guardar leitura' }).click();

    const cartao = page.getByRole('article');
    await expect(cartao).toContainText('Leitura guardada');
    await expect(cartao).toContainText('Consumo desde a anterior: 8,5 m³');
    await expect(tabela.getByRole('row')).toHaveCount(5);
    expect(planilhas.linhas(3).at(-1)?.valores).toMatchObject({ Data: '2026-11-05', Leitura: '1020.5', Unidade: 'm³' });

    await cartao.getByRole('button', { name: 'Desfazer' }).click();
    await expect(cartao).toContainText('Leitura desfeita');
    await expect(tabela.getByRole('row')).toHaveCount(4);
    expect(planilhas.linhas(3)).toHaveLength(4); // a linha continua na planilha, marcada "desfeito"
    expect(planilhas.linhas(3).at(-1)?.valores['Observação']).toBe('desfeito');
    expect(erros).toEqual([]);
  });

  test('o Pode falar dentro da pasta manda a frase direto para ela', async ({ page }) => {
    const { planilhas } = await abrirConsumoDeAgua(page);
    await expect(page.getByRole('table', { name: 'Leituras registradas' })).toBeVisible();

    await page.keyboard.press('Control+Alt+KeyN');
    await expect(page).toHaveURL(/#\/falar$/);
    await page.getByRole('textbox', { name: 'Texto falado' }).fill('leitura 1018');
    await page.getByRole('button', { name: 'Pronto' }).click();

    await expect(page.getByText('Leitura guardada')).toBeVisible();
    expect(planilhas.linhas(3).at(-1)?.valores).toMatchObject({ Leitura: '1018', Data: '2026-11-05' });
  });
});

test.describe('celular, 375 px', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('cabe na tela, sem rolagem de lado, e o formulário funciona', async ({ page }) => {
    await abrirConsumoDeAgua(page);
    const form = page.getByRole('form', { name: 'Nova leitura' });
    await expect(form).toBeVisible();
    expect(await semRolagemDeLado(page)).toBe(true);
    await form.getByLabel(/^Leitura/).fill('1015');
    await form.getByRole('button', { name: 'Guardar leitura' }).click();
    await expect(page.getByRole('article')).toContainText('Leitura guardada');
    expect(await semRolagemDeLado(page)).toBe(true);
    await semAchadosDoAxe(page);
  });
});
