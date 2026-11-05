import { expect, test, type Page } from '@playwright/test';

const LINK = 'https://exemplo.test/pessoal/Aurora?e=abc123';

async function abrir(page: Page) {
  await page.goto('/central-app/teste-links.html');
  // O vite preview devolve index.html com 200 para páginas que não existem:
  // por isso o conteúdo é conferido, não o status.
  await expect(page.getByRole('heading', { name: 'Teste de links do OneDrive' })).toBeVisible();
}

async function colar(page: Page, texto: string) {
  await page.getByLabel(/Link do arquivo no OneDrive/).fill(texto);
}

for (const [rotulo, texto] of [
  ['http', 'http://exemplo.test/arquivo'],
  ['javascript', 'javascript:alert(1)'],
  ['ftp', 'ftp://exemplo.test/arquivo'],
  ['ms-word já pronto', 'ms-word:ofe|u|https://exemplo.test/arquivo'],
  ['sem protocolo', 'exemplo.test/arquivo'],
  ['vazio', '   '],
] as const) {
  for (const botao of ['Abrir normal', 'Abrir no Word', 'Abrir no PowerPoint']) {
    test(`recusa ${rotulo} em "${botao}"`, async ({ page }) => {
      await abrir(page);
      await colar(page, texto);
      await page.getByRole('button', { name: botao }).click();
      await expect(page.locator('#aviso')).toHaveClass('erro');
      await expect(page.locator('#alvo')).toHaveText('nenhum');
    });
  }
}

test('a mensagem de recusa explica o motivo para http', async ({ page }) => {
  await abrir(page);
  await colar(page, 'http://exemplo.test/arquivo');
  await page.getByRole('button', { name: 'Abrir no Word' }).click();
  await expect(page.locator('#aviso')).toContainText('https://');
});

test('monta o endereço ms-word: com o link https', async ({ page }) => {
  await abrir(page);
  await colar(page, `  ${LINK}  `);
  await page.getByRole('button', { name: 'Abrir no Word' }).click();
  await expect(page.locator('#alvo')).toHaveText(`ms-word:ofe|u|${LINK}`);
  await expect(page.locator('#aviso')).toHaveClass('ok');
});

test('monta o endereço ms-powerpoint: com o link https', async ({ page }) => {
  await abrir(page);
  await colar(page, LINK);
  await page.getByRole('button', { name: 'Abrir no PowerPoint' }).click();
  await expect(page.locator('#alvo')).toHaveText(`ms-powerpoint:ofe|u|${LINK}`);
  await expect(page.locator('#aviso')).toHaveClass('ok');
});

test('"Abrir normal" abre o próprio link https em outra aba', async ({ page, context }) => {
  await context.route('https://exemplo.test/**', (rota) =>
    rota.fulfill({ contentType: 'text/html', body: '<title>destino</title>' }),
  );
  await abrir(page);
  await colar(page, LINK);
  const [aba] = await Promise.all([
    context.waitForEvent('page'),
    page.getByRole('button', { name: 'Abrir normal' }).click(),
  ]);
  await aba.waitForLoadState();
  expect(aba.url()).toBe(LINK);
  await expect(page.locator('#alvo')).toHaveText(LINK);
});

test('texto colado nunca vira HTML', async ({ page }) => {
  await abrir(page);
  await colar(page, '<img src=x onerror="document.title=1">');
  await page.getByRole('button', { name: 'Abrir normal' }).click();
  await expect(page.locator('#aviso')).toHaveClass('erro');
  await expect(page.locator('#aviso img, #alvo img')).toHaveCount(0);
  expect(await page.title()).toBe('Teste de links do OneDrive');
});

test('botões têm pelo menos 44 px e cabem em tela de celular', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await abrir(page);
  for (const botao of await page.getByRole('button').all()) {
    const caixa = await botao.boundingBox();
    expect(caixa!.height).toBeGreaterThanOrEqual(44);
    expect(caixa!.x + caixa!.width).toBeLessThanOrEqual(360);
  }
  const larguraDaPagina = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(larguraDaPagina).toBeLessThanOrEqual(360);
});

test('a página não carrega código de terceiros nem usa IndexedDB', async ({ page }) => {
  const externos: string[] = [];
  page.on('request', (req) => {
    if (!req.url().startsWith('http://localhost:4173/')) externos.push(req.url());
  });
  await abrir(page);
  const html = await (await page.request.get('/central-app/teste-links.html')).text();
  expect(html).not.toMatch(/indexedDB|<script[^>]*\bsrc=|innerHTML/);
  expect(externos).toEqual([]);
});
