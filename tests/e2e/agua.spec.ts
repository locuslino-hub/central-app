import { expect, test, type Locator, type Page } from '@playwright/test';
import { conectar, scriptFalso } from '../apoio/script-e2e';

// O cartão Água na coluna direita (e no topo do Agora, no celular), no navegador, com o
// script de verdade e o Google na memória. Quinta-feira, 2026-11-05, 12:20 em Lisboa
// (inverno: UTC+0): o esperado é 619 mL.
const AGORA = '2026-11-05T12:20:00+00:00';

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(AGORA);
});

async function abrir(page: Page, hash: string) {
  const script = scriptFalso();
  await script.ligarA(page);
  await page.goto('/central-app/');
  await conectar(page);
  await page.goto(`/central-app/${hash}`);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

const coluna = (page: Page) => page.getByRole('complementary', { name: 'Agora e chat' });
const cartao = (page: Page) => page.getByRole('region', { name: 'Água' });

/** O cartão e cada botão dele cabem: nada é cortado nem sai pelos lados. */
async function semTransbordar(alvo: Locator) {
  const problemas = await alvo.evaluate((secao) => {
    const achados: string[] = [];
    const confere = (el: Element, nome: string) => {
      if (el.scrollWidth > el.clientWidth) achados.push(`${nome}: scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`);
    };
    confere(secao, 'cartão');
    const caixa = secao.getBoundingClientRect();
    for (const botao of secao.querySelectorAll('button')) {
      const nome = (botao.getAttribute('aria-label') || botao.textContent || '').trim().slice(0, 24);
      confere(botao, `botão "${nome}"`);
      const b = botao.getBoundingClientRect();
      if (b.height < 43.5) achados.push(`botão "${nome}" com ${Math.round(b.height)} px de altura`);
      if (b.width < 43.5) achados.push(`botão "${nome}" com ${Math.round(b.width)} px de largura`);
      if (b.left < caixa.left - 0.5 || b.right > caixa.right + 0.5) achados.push(`botão "${nome}" sai do cartão`);
    }
    // Nenhum texto passa da borda direita do cartão.
    for (const el of secao.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > caixa.right + 0.5) achados.push(`<${el.tagName.toLowerCase()} class="${el.getAttribute('class') ?? ''}"> passa da borda direita`);
    }
    return achados;
  });
  expect(problemas).toEqual([]);
}

test.describe('computador, 1280 × 800', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('a coluna mostra Agora, Água e Chat; "Toda" soma 500; com o chat aberto o cartão encolhe', async ({ page }) => {
    const erros: string[] = [];
    page.on('pageerror', (erro) => erros.push(erro.message));
    await abrir(page, '#/');

    await expect(coluna(page).getByRole('heading', { level: 2 })).toHaveText(['Agora', 'Água', 'Chat']);
    const agua = cartao(page);
    await expect(agua.locator('.agua-total')).toHaveText('0 mL');
    await expect(agua.getByText('Atrás 619 mL')).toBeVisible();
    // O sugerido (1 garrafa e ¼) é "Toda".
    await expect(agua.getByRole('button', { name: 'Toda, 500 mL, sugerido' })).toBeVisible();

    await agua.getByRole('button', { name: /^Toda, 500 mL/ }).click();
    await expect(agua.locator('.agua-total')).toHaveText('500 mL');
    await expect(agua.getByText('Último: 12:20 · 500 mL')).toBeVisible();
    await expect(agua.getByText('Atrás 119 mL')).toBeVisible();

    // Desfazer tira só o gole de hoje.
    await agua.getByRole('button', { name: 'Desfazer' }).click();
    await expect(agua.locator('.agua-total')).toHaveText('0 mL');
    await expect(agua.getByRole('button', { name: 'Desfazer' })).toBeDisabled();
    await agua.getByRole('button', { name: /^Toda, 500 mL/ }).click();
    await expect(agua.locator('.agua-total')).toHaveText('500 mL');

    // Chat aberto: a versão curta, de no máximo 80 px de altura.
    const alturaCompleta = (await agua.boundingBox())!.height;
    await coluna(page).getByRole('button', { name: /^Chat/ }).click();
    const curta = page.locator('.cartao-agua.curto');
    await expect(curta).toBeVisible();
    await expect(page.locator('.cartao-agua')).toHaveCount(1);
    const altura = (await curta.boundingBox())!.height;
    expect(altura).toBeLessThanOrEqual(80);
    expect(altura).toBeLessThan(alturaCompleta);
    await expect(curta).toContainText('Água: 500 mL');
    await curta.getByRole('button', { name: /^\+¼, 125 mL, sugerido/ }).click();
    await expect(curta).toContainText('Água: 625 mL');
    expect(erros).toEqual([]);
  });
});

test.describe('largura mínima, 1101 × 800', () => {
  test.use({ viewport: { width: 1101, height: 800 } });

  test('o cartão completo não transborda e os botões mantêm 44 px (atrás, em dia e meta)', async ({ page }) => {
    await abrir(page, '#/');
    const agua = cartao(page);
    await expect(agua.locator('.agua-total')).toHaveText('0 mL');
    // Medida da coluna: cartão de uns 242 px.
    const largura = (await agua.boundingBox())!.width;
    expect(largura).toBeGreaterThan(235);
    expect(largura).toBeLessThan(260);
    await semTransbordar(agua); // atrás, com 1 garrafa e ¼

    await agua.getByRole('button', { name: /^Toda, 500 mL/ }).click();
    await agua.getByRole('button', { name: /^Toda, 500 mL/ }).click();
    await expect(agua.locator('.agua-total')).toHaveText('1.000 mL');
    await expect(agua.getByText('No ritmo')).toBeVisible();
    await semTransbordar(agua); // em dia

    await agua.getByRole('button', { name: /^Toda, 500 mL/ }).click();
    await agua.getByRole('button', { name: /^Toda, 500 mL/ }).click();
    await expect(agua.locator('.agua-total')).toHaveText('2.000 mL');
    await expect(agua.getByText('Meta batida ✓')).toBeVisible();
    await semTransbordar(agua); // meta batida
  });

  test('a versão curta também cabe, com o botão de 44 px', async ({ page }) => {
    await abrir(page, '#/');
    await coluna(page).getByRole('button', { name: /^Chat/ }).click();
    const curta = page.locator('.cartao-agua.curto');
    await expect(curta).toBeVisible();
    await semTransbordar(curta);
  });
});

test.describe('celular, 390 × 844', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('o cartão aparece no topo de #/agora, cabe na tela e soma', async ({ page }) => {
    await abrir(page, '#/agora');
    const agua = page.getByRole('main').getByRole('region', { name: 'Água' });
    await expect(agua).toBeVisible();
    await expect(page.locator('.cartao-agua')).toHaveCount(1);
    await agua.getByRole('button', { name: /^½, 250 mL/ }).click();
    await expect(agua.locator('.agua-total')).toHaveText('250 mL');
    await semTransbordar(agua);
    const semRolagemDeLado = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    expect(semRolagemDeLado).toBe(true);
  });
});
