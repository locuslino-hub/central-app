import { expect, test } from '@playwright/test';

test('a página inicial mostra Central de Comando', async ({ page }) => {
  await page.goto('/central-app/');
  await expect(page.getByRole('heading', { level: 1, name: 'Painel do dia' })).toBeVisible();
});

test('a página de teste de IA continua publicada', async ({ page }) => {
  const resposta = await page.goto('/central-app/teste-ia.html');
  expect(resposta?.status()).toBe(200);
});
