import { copyFileSync, createReadStream, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

const PACOTE_DA_IA = createRequire(import.meta.url).resolve('@litert-lm/core/package.json');
/** Versão do `@litert-lm/core`: nome da pasta dos arquivos da IA e do armazenamento deles no aparelho. */
const VERSAO_LITERTLM: string = JSON.parse(readFileSync(PACOTE_DA_IA, 'utf8')).version;

/**
 * IA local (Tarefa 21, R18): os arquivos wasm do `@litert-lm/core` saem do
 * próprio app, em `litertlm/<versão>/`, e não de CDN. No build são copiados para
 * `dist/litertlm/<versão>/`; no `npm run dev`, servidos direto do pacote. O
 * trabalhador da IA escolhe qual dos quatro usar conforme o navegador. A versão
 * no caminho faz cada atualização do pacote vir de um endereço novo.
 */
function wasmDaIA(): Plugin {
  const origem = join(dirname(PACOTE_DA_IA), 'wasm');
  const arquivos = () => readdirSync(origem).filter((nome) => /^litertlm_wasm_\w+\.(?:js|wasm)$/.test(nome));
  let saida = 'dist';
  let base = '/';
  return {
    name: 'wasm-da-ia',
    configResolved(config) {
      saida = resolve(config.root, config.build.outDir);
      base = config.base;
    },
    configureServer(servidor) {
      servidor.middlewares.use(`${base}litertlm/${VERSAO_LITERTLM}/`, (pedido, resposta, seguir) => {
        const nome = (pedido.url ?? '').replace(/^\//, '').split('?')[0];
        if (!arquivos().includes(nome)) return seguir();
        resposta.setHeader('Content-Type', nome.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        createReadStream(join(origem, nome)).pipe(resposta);
      });
    },
    closeBundle() {
      const destino = join(saida, 'litertlm', VERSAO_LITERTLM);
      mkdirSync(destino, { recursive: true });
      for (const nome of arquivos()) copyFileSync(join(origem, nome), join(destino, nome));
    },
  };
}

/** Onde o build grava o app (o `outDir` padrão, ao lado deste arquivo). */
const PASTA_DO_BUILD = resolve(dirname(fileURLToPath(import.meta.url)), 'dist');

/** `sha384-…` do arquivo já gravado no build, no formato do atributo `integrity`. */
const integridade = (arquivo: string) =>
  `sha384-${createHash('sha384').update(readFileSync(join(PASTA_DO_BUILD, arquivo))).digest('base64')}`;

export default defineConfig({
  base: '/central-app/',
  plugins: [
    preact(),
    wasmDaIA(),
    // Offline (Tarefa 22). Só o app (HTML, JS, CSS, fontes, ícones) fica guardado para abrir sem internet.
    //  - `litertlm/` (~120 MB de wasm da IA, quatro variantes) NÃO entra: quem baixa a IA guarda só a variante
    //    do seu navegador, junto do modelo, num armazenamento próprio (`litertlm-<versão>`, src/ia/runtime.ts).
    //  - Nenhuma regra de cache em tempo de execução: o script do Google (script.google.com) e qualquer
    //    outro endereço de fora passam direto pela rede. Os dados vão por sincronia/IndexedDB, não por cache HTTP.
    //  - Atualização: `skipWaiting` + `clientsClaim`. A versão nova assume sozinha assim que baixa, sem
    //    esperar o dono fechar o app (no celular ele quase nunca fecha). A tela só avisa (src/pwa.ts).
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      manifest: false, // o manifesto é o public/manifest.webmanifest
      workbox: {
        globPatterns: ['index.html', 'assets/**/*.{js,css,woff,woff2}', 'icones/*.{png,svg}', 'manifest.webmanifest'],
        globIgnores: ['litertlm/**', 'teste-*.html'],
        // O que passar disso não é do app. Teste (tests/e2e/service-worker.spec.ts) confere que nada de
        // `assets/` fica de fora em silêncio.
        maximumFileSizeToCacheInBytes: 2 * 1024 * 1024,
        // O index.html é o único guardado sem hash no nome: leva a integridade. Se o CDN ainda entrega o HTML
        // velho quando o service worker novo instala, a instalação falha (e tenta de novo na próxima conferência)
        // em vez de guardar um HTML que pede arquivos que não existem mais.
        manifestTransforms: [
          async (entradas) => ({
            manifest: entradas.map((e) => (e.url === 'index.html' ? { ...e, integrity: integridade(e.url) } : e)),
            warnings: [],
          }),
        ],
        navigateFallback: 'index.html',
        // O teste é feito com caminho e busca (`?…`): a página de teste nunca vira o app.
        navigateFallbackDenylist: [/\/teste-[^/]*\.html(\?|$)/],
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
      },
    }),
  ],
  define: { __VERSAO_LITERTLM__: JSON.stringify(VERSAO_LITERTLM) },
  // Trabalhador clássico: o carregador do wasm da IA usa `importScripts`.
  worker: { format: 'iife' },
  test: {
    environment: 'jsdom',
    exclude: ['tests/e2e/**', 'node_modules/**'],
    globalSetup: ['tests/setup-fuso.ts'],
    setupFiles: ['tests/setup.ts'],
  },
});
