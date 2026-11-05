import { expect, test, type Page } from '@playwright/test';

const ESPERANDO = 'Escolha um modelo. O download leva alguns minutos.';

async function abrir(page: Page, busca: string) {
  await page.route('https://cdn.jsdelivr.net/**', (rota) =>
    rota.fulfill({
      headers: { 'access-control-allow-origin': '*' },
      contentType: 'application/javascript',
      body: `export const Engine = { create: async ({ model }) => { throw new Error(model); } };`,
    }),
  );
  await page.goto(`/central-app/teste-ia.html${busca}`);
}

for (const modelo of ['E2B', 'E4B']) {
  test(`?m=${modelo} inicia o teste desse modelo`, async ({ page }) => {
    await abrir(page, `?m=${modelo}`);
    await expect(page.locator('#estado')).toContainText(`gemma-4-${modelo}-it`);
  });
}

for (const busca of ['', '?m=', '?m=e2b', '?m=E2B-outro', '?m=..%2F..%2Foutro', '?m=%3Cb%3Eoi']) {
  test(`"${busca}" se comporta como sem parâmetro`, async ({ page }) => {
    await abrir(page, busca);
    await expect(page.getByRole('button', { name: 'Testar Gemma 4 E2B' })).toBeEnabled();
    await page.waitForFunction(() => typeof (window as { rodar?: unknown }).rodar === 'function');
    await expect(page.locator('#estado')).toHaveText(ESPERANDO);
    const iniciado = await page.evaluate(
      () => (window as { resultado?: { modelo?: string } | null }).resultado?.modelo ?? null,
    );
    expect(iniciado).toBeNull();
  });
}

test('mostra se o armazenamento persistente foi concedido e o tempo para abrir', async ({ page }) => {
  await page.route('https://cdn.jsdelivr.net/**', (rota) =>
    rota.fulfill({
      headers: { 'access-control-allow-origin': '*' },
      contentType: 'application/javascript',
      body: `export const Engine = { create: async () => ({ createConversation: async () => { throw new Error('parou aqui'); } }) };`,
    }),
  );
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'storage', { value: { persist: async () => true } });
  });
  await page.goto('/central-app/teste-ia.html?m=E4B');
  await expect(page.locator('#persistencia')).toHaveText('Armazenamento persistente: concedido.');
  await expect(page.locator('#abertura')).toContainText(/Tempo para abrir E4B: \d+(\.\d)? s/);
  await expect(page.locator('#abertura')).toContainText('não sabe dizer se veio do cache');
});
