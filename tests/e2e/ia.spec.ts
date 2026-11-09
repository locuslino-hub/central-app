// IA local (Tarefa 21) no app construído: o wasm sai do próprio app, a página
// de IA local abre e nada é baixado sem o dono pedir.
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect, test } from '@playwright/test';
import { MODELO } from '../../src/ia/modelo';

const VERSAO = (createRequire(import.meta.url)('@litert-lm/core/package.json') as { version: string }).version;

test('os arquivos wasm da IA saem do próprio app, numa pasta com a versão do pacote', async ({ request }) => {
  for (const nome of ['litertlm_wasm_internal.js', 'litertlm_wasm_internal.wasm', 'litertlm_wasm_compat_asyncify_internal.wasm']) {
    const resposta = await request.get(`/central-app/litertlm/${VERSAO}/${nome}`);
    expect(resposta.status(), nome).toBe(200);
  }
  // Nada solto em `litertlm/`: só a pasta da versão.
  expect(readdirSync('dist/litertlm')).toEqual([VERSAO]);
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

test.describe('IA sem internet', () => {
  test('com o modelo já baixado, o motor da IA abre sem rede: os arquivos dele ficam no aparelho', async () => {
    test.setTimeout(120_000);
    // Perfil gravado em disco: a pasta privada de um contexto anônimo fica na memória, e o modelo falso tem 3 GB
    // (vazio: o disco não chega a gastar isso). Service worker ligado (o app abre offline) e CSP desligada só para
    // o teste criar o modelo falso num trabalhador.
    const perfil = mkdtempSync(join(tmpdir(), 'central-ia-'));
    const contexto = await chromium.launchPersistentContext(perfil, {
      baseURL: 'http://localhost:4173',
      serviceWorkers: 'allow',
      bypassCSP: true,
      locale: 'pt-BR',
    });
    try {
      const page = contexto.pages()[0] ?? (await contexto.newPage());
      const doTrabalhador: string[] = [];
      page.on('worker', (trabalhador) => trabalhador.on('console', (m) => doTrabalhador.push(m.text())));
      const daIA: string[] = [];
      page.on('request', (pedido) => {
        if (/\/litertlm\/|huggingface/.test(pedido.url())) daIA.push(pedido.url());
      });

      await page.goto('/central-app/#/ia');
      await expect(page.getByRole('heading', { level: 1, name: 'IA local' })).toBeVisible();
      test.skip(!(await page.evaluate(() => 'gpu' in navigator)), 'navegador sem WebGPU: a IA nem tenta abrir');
      await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

      // Modelo falso "já baixado" (de antes desta versão): arquivo do tamanho certo, vazio, e a marca de completo.
      await page.evaluate(
        async ({ arquivo, tamanho }) => {
          const codigo = `onmessage = async (e) => {
            const { arquivo, tamanho } = e.data;
            const pasta = await navigator.storage.getDirectory();
            const escrita = await (await pasta.getFileHandle(arquivo, { create: true })).createSyncAccessHandle();
            escrita.truncate(tamanho);
            escrita.flush();
            escrita.close();
            await pasta.getFileHandle(arquivo + '.ok', { create: true });
            postMessage('ok');
          };`;
          const trabalhador = new Worker(URL.createObjectURL(new Blob([codigo], { type: 'text/javascript' })));
          await new Promise((ok, erro) => {
            trabalhador.onmessage = ok;
            trabalhador.onerror = erro;
            trabalhador.postMessage({ arquivo, tamanho });
          });
          trabalhador.terminate();
        },
        { arquivo: MODELO.arquivo, tamanho: MODELO.tamanho },
      );

      // Com internet: a abertura guarda os arquivos do motor (só a variante deste navegador) e tenta abrir o
      // modelo, que é falso e não abre.
      await page.reload();
      await expect(page.getByText('A IA não abriu neste aparelho.', { exact: false })).toBeVisible({ timeout: 30_000 });
      const guardados = await page.evaluate(async (nome) => {
        if (!(await caches.has(nome))) return [];
        return (await (await caches.open(nome)).keys()).map((r) => new URL(r.url).pathname);
      }, `litertlm-${VERSAO}`);
      expect(guardados).toHaveLength(2);
      expect(guardados.every((p) => p.startsWith(`/central-app/litertlm/${VERSAO}/litertlm_wasm_`))).toBe(true);
      expect(new Set(guardados.map((p) => p.replace(/\.(js|wasm)$/, ''))).size).toBe(1); // .js e .wasm da mesma variante
      expect(daIA.length).toBeGreaterThan(0);
      expect(daIA.every((url) => url.includes(`/litertlm/${VERSAO}/`))).toBe(true);

      // Sem internet: o motor abre dos arquivos guardados; só o modelo (falso) falha.
      await contexto.setOffline(true);
      daIA.length = 0;
      doTrabalhador.length = 0;
      await page.reload();
      await expect(page.getByRole('heading', { level: 1, name: 'IA local' })).toBeVisible();
      await expect(page.getByText('A IA não abriu neste aparelho.', { exact: false })).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => doTrabalhador.join('\n')).toContain('O modelo não abriu');
      expect(doTrabalhador.join('\n')).not.toContain('O motor da IA não carregou');
      expect(daIA).toEqual([]);
    } finally {
      await contexto.close();
      rmSync(perfil, { recursive: true, force: true });
    }
  });
});
