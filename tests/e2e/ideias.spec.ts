import { expect, test, type Page } from '@playwright/test';

// Tela Ideias (V02, Tarefa 7), no navegador. A ideia nasce do Pode falar (digitada: o
// reconhecimento de fala de verdade não roda no teste). Quinta-feira, 2026-11-05, 12:20
// em Lisboa (inverno: UTC+0). Nomes fictícios.
const AGORA = '2026-11-05T12:20:00+00:00';

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(AGORA);
});

function vigiarErros(page: Page) {
  const erros: string[] = [];
  page.on('pageerror', (erro) => erros.push(`pageerror: ${erro.message}`));
  page.on('console', (mensagem) => {
    if (mensagem.type() === 'error') erros.push(`console: ${mensagem.text()}`);
  });
  return erros;
}

/** Todo controle visível com menos de 44 px de lado. */
async function pequenos(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const achados: string[] = [];
    for (const controle of document.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, summary')) {
      const caixa = controle.getBoundingClientRect();
      if (caixa.width === 0 && caixa.height === 0) continue;
      if (caixa.height < 43.5 || caixa.width < 43.5) {
        achados.push(`${controle.textContent?.trim().slice(0, 30) || controle.outerHTML.slice(0, 60)} (${Math.round(caixa.width)}x${Math.round(caixa.height)})`);
      }
    }
    return achados;
  });
}

const semRolagemDeLado = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

/** Escreve a frase em Pode falar e toca Pronto: vira ideia. */
async function guardarIdeia(page: Page, frase: string) {
  await page.goto('/central-app/#/falar');
  await page.getByRole('textbox', { name: 'Texto falado' }).fill(frase);
  await page.getByRole('button', { name: 'Pronto' }).click();
  await expect(page.getByRole('article').getByText('Guardado em Ideias')).toBeVisible();
}

test.describe('celular, 390 px', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('#/ideias abre e mostra a ideia criada pelo Pode falar; o Ver do cartão leva até ela', async ({ page }) => {
    const erros = vigiarErros(page);
    await guardarIdeia(page, 'Usar o artigo do Prof. Souza no capítulo 2');

    await page.getByRole('article').getByRole('link', { name: 'Ver' }).click();

    await expect(page).toHaveURL(/#\/ideias$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Ideias' })).toBeVisible();
    await expect(page.getByText('Usar o artigo do Prof. Souza no capítulo 2')).toBeVisible();
    expect(await pequenos(page)).toEqual([]);
    expect(await semRolagemDeLado(page)).toBe(true);
    expect(erros).toEqual([]);
  });

  test('o Mais mostra Ideias com o contador, e a rota abre', async ({ page }) => {
    await guardarIdeia(page, 'Pensar no artigo da Aurora');
    await page.goto('/central-app/#/');
    await page.getByRole('button', { name: 'Mais' }).click();
    const ideias = page.getByRole('dialog', { name: 'Mais' }).getByRole('link', { name: /Ideias/ });
    await expect(ideias).toContainText('1');
    await ideias.click();
    await expect(page.getByRole('heading', { level: 1, name: 'Ideias' })).toBeVisible();
  });

  test('Outra sala leva a ideia para a sala escolhida; sai das novas', async ({ page }) => {
    await guardarIdeia(page, 'Pensar no artigo da Aurora');
    await page.goto('/central-app/#/ideias');

    await page.getByRole('button', { name: 'Escolher sala' }).click();
    await page.getByRole('group', { name: /Sala para/ }).getByRole('button', { name: 'Casa' }).click();

    await expect(page.getByText('Nada por arrumar. Boa!')).toBeVisible();
    await expect(page.getByText('Já arrumadas (1)')).toBeVisible();
  });
});

test.describe('computador, 1280 px', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('o menu mostra Ideias com o contador; Virar tarefa cria a tarefa e Desfazer a tira', async ({ page }) => {
    const erros = vigiarErros(page);
    await guardarIdeia(page, 'Pensar no artigo da Aurora');
    await page.goto('/central-app/#/ideias');

    const menu = page.getByRole('navigation', { name: 'Principal' });
    await expect(menu.getByRole('link', { name: /Ideias/ })).toContainText('1');

    await page.getByRole('button', { name: 'Virar tarefa' }).click();
    const cartao = page.getByRole('article');
    await expect(cartao.getByText('Virou tarefa de hoje')).toBeVisible();
    await expect(page.getByText('Nada por arrumar. Boa!')).toBeVisible();

    await cartao.getByRole('button', { name: 'Desfazer' }).click();
    await expect(page.getByText('Desfeito')).toBeVisible();
    await expect(page.getByText('Pensar no artigo da Aurora', { exact: true })).toBeVisible();
    expect(erros).toEqual([]);
  });
});
