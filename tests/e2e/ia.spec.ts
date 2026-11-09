// IA local (Tarefa 21) no app construído: o wasm sai do próprio app, a página
// de IA local abre e nada é baixado sem o dono pedir.
import { expect, test } from '@playwright/test';

test('os arquivos wasm da IA saem do próprio app', async ({ request }) => {
  for (const nome of ['litertlm_wasm_internal.js', 'litertlm_wasm_internal.wasm', 'litertlm_wasm_compat_asyncify_internal.wasm']) {
    const resposta = await request.get(`/central-app/litertlm/${nome}`);
    expect(resposta.status(), nome).toBe(200);
  }
});

test('a política deixa compilar wasm, mas não eval de JavaScript', async ({ page }) => {
  await page.goto('/central-app/');
  const politica = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(politica).toContain("script-src 'self' 'wasm-unsafe-eval'");
  expect(politica).not.toContain("'unsafe-eval'");
});

test('IA local abre, o trabalhador responde e nada é baixado sozinho', async ({ page }) => {
  const deFora: string[] = [];
  page.on('request', (pedido) => {
    if (/huggingface|hf\.co|jsdelivr/.test(pedido.url())) deFora.push(pedido.url());
  });
  const erros: string[] = [];
  page.on('pageerror', (erro) => erros.push(String(erro)));

  await page.goto('/central-app/#/ia');
  await expect(page.getByRole('heading', { level: 1, name: 'IA local' })).toBeVisible();
  const temGpu = await page.evaluate(() => 'gpu' in navigator);
  if (temGpu) {
    // O trabalhador abriu, olhou a pasta privada e disse que não há modelo.
    await expect(page.getByRole('button', { name: 'Baixar a IA' })).toBeVisible();
  } else {
    await expect(page.getByText(/não consegue rodar a IA local/)).toBeVisible();
  }
  await expect(page.getByText('A IA não abriu neste aparelho.', { exact: false })).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(deFora).toEqual([]);
  expect(erros).toEqual([]);
});
