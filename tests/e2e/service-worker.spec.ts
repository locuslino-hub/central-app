// O service worker gerado no build (Tarefa 22): o que entra na lista de arquivos
// guardados e como ele se protege de um HTML velho. Lê o `dist/` que o servidor
// de testes acabou de construir.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const DIST = 'dist';

/** As entradas `{url, revision, integrity?}` da lista de arquivos guardados do `sw.js`. */
function listaDoSw(codigo: string): { url: string; integrity?: string }[] {
  return [...codigo.matchAll(/\{url:"([^"]+)",revision:(?:"[^"]*"|null)(?:,integrity:"([^"]+)")?\}/g)].map(([, url, integrity]) => ({
    url,
    integrity,
  }));
}

test('todo arquivo de dist/assets entra na lista do service worker (nada passa do limite em silêncio)', () => {
  const lista = listaDoSw(readFileSync(join(DIST, 'sw.js'), 'utf8')).map((e) => e.url);
  const assets = readdirSync(join(DIST, 'assets'));
  expect(assets.length).toBeGreaterThan(3);
  expect(assets.filter((nome) => !lista.includes(`assets/${nome}`))).toEqual([]);
  expect(lista).toContain('index.html');
});

test('o index.html guardado leva a integridade (sha384): um HTML velho do CDN faz a instalação falhar', async ({ request }) => {
  const entrada = listaDoSw(readFileSync(join(DIST, 'sw.js'), 'utf8')).find((e) => e.url === 'index.html');
  const html = readFileSync(join(DIST, 'index.html'));
  expect(entrada?.integrity).toBe(`sha384-${createHash('sha384').update(html).digest('base64')}`);
  // O servido é o mesmo arquivo.
  const servido = await (await request.get('/central-app/index.html')).body();
  expect(`sha384-${createHash('sha384').update(servido).digest('base64')}`).toBe(entrada?.integrity);
});

test.describe('com o service worker ligado', () => {
  test.use({ serviceWorkers: 'allow' });

  test('página de teste com busca (?…) não vira o app', async ({ page }) => {
    await page.goto('/central-app/');
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await page.goto('/central-app/teste-links.html?link=1');
    await expect(page).toHaveTitle('Teste de links do OneDrive');
  });
});
