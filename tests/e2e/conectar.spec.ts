import { expect, test } from '@playwright/test';

const URL_FICTICIA = 'https://script.google.com/macros/s/ID-FICTICIO/exec';
const CODIGO = 'codigo-ficticio-de-teste-0123456789abcdef';

test('o campo do código chega ao navegador sem correção nem sugestão', async ({ page }) => {
  await page.goto('/central-app/#/conectar');
  const campo = page.getByLabel('Código do aparelho');
  await expect(campo).toHaveAttribute('autocomplete', 'new-password');
  await expect(campo).toHaveAttribute('spellcheck', 'false');
  await expect(campo).toHaveAttribute('autocapitalize', 'none');
  await expect(campo).toHaveAttribute('autocorrect', 'off');
});

test('conecta o aparelho e guarda a conexão no navegador', async ({ page }) => {
  await page.route(URL_FICTICIA, async (rota) => {
    const certo = rota.request().postDataJSON().codigo === CODIGO;
    await rota.fulfill({
      headers: { 'access-control-allow-origin': '*' },
      contentType: 'application/json',
      body: JSON.stringify(certo ? { ok: true, dados: {} } : { ok: false, erro: 'codigo-invalido' }),
    });
  });

  await page.goto('/central-app/');
  await page.getByRole('link', { name: 'Conectar aparelho' }).click();

  await page.getByLabel('URL').fill(URL_FICTICIA);
  await page.getByLabel('Código do aparelho').fill('codigo-errado-ficticio-0123456789abcdef');
  await page.getByRole('button', { name: 'Testar e salvar' }).click();
  await expect(page.locator('.conectar').getByRole('status')).toContainText('incorreto');

  await page.getByLabel('Código do aparelho').fill(CODIGO);
  await page.getByRole('button', { name: 'Testar e salvar' }).click();
  await expect(page.locator('.conectar').getByRole('status')).toHaveText(/^Conectado em \d+,\d s$/);

  const salvo = await page.evaluate(
    () =>
      new Promise<unknown>((resolver, rejeitar) => {
        const abrir = indexedDB.open('central-conexao');
        abrir.onerror = () => rejeitar(abrir.error);
        abrir.onsuccess = () => {
          const leitura = abrir.result.transaction('conexao').objectStore('conexao').get('atual');
          leitura.onsuccess = () => resolver(leitura.result);
        };
      }),
  );
  expect(salvo).toEqual({ url: URL_FICTICIA, codigo: CODIGO });
});
