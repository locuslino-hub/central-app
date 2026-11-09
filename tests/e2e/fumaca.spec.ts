import { expect, test } from '@playwright/test';

test('a página inicial mostra Central de Comando', async ({ page }) => {
  await page.goto('/central-app/');
  await expect(page.getByRole('heading', { level: 1, name: 'Painel do dia' })).toBeVisible();
});

// R18: a página de teste de IA importa de CDN e não vai mais ao ar (está em tests/manual/).
test('a página de teste de IA não é mais publicada', async ({ page }) => {
  await page.goto('/central-app/teste-ia.html');
  // O servidor devolve o app para endereços que não existem: o conteúdo mostra que a página não está lá.
  await expect(page.getByRole('heading', { name: 'Teste de IA local' })).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1, name: 'Painel do dia' })).toBeVisible();
});
