import { copyFileSync, createReadStream, mkdirSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * IA local (Tarefa 21, R18): os arquivos wasm do `@litert-lm/core` saem do
 * próprio app, em `litertlm/`, e não de CDN. No build são copiados para
 * `dist/litertlm/`; no `npm run dev`, servidos direto do pacote. O trabalhador
 * da IA escolhe qual dos quatro usar conforme o navegador.
 */
function wasmDaIA(): Plugin {
  const origem = join(dirname(createRequire(import.meta.url).resolve('@litert-lm/core/package.json')), 'wasm');
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
      servidor.middlewares.use(`${base}litertlm/`, (pedido, resposta, seguir) => {
        const nome = (pedido.url ?? '').replace(/^\//, '').split('?')[0];
        if (!arquivos().includes(nome)) return seguir();
        resposta.setHeader('Content-Type', nome.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        createReadStream(join(origem, nome)).pipe(resposta);
      });
    },
    closeBundle() {
      const destino = join(saida, 'litertlm');
      mkdirSync(destino, { recursive: true });
      for (const nome of arquivos()) copyFileSync(join(origem, nome), join(destino, nome));
    },
  };
}

export default defineConfig({
  base: '/central-app/',
  plugins: [
    preact(),
    wasmDaIA(),
    // Offline (Tarefa 22). Só o app (HTML, JS, CSS, fontes, ícones) fica guardado para abrir sem internet.
    //  - `litertlm/` (~120 MB de wasm da IA) NÃO entra: a IA tem o próprio armazenamento (Tarefa 21).
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
        maximumFileSizeToCacheInBytes: 2 * 1024 * 1024, // o que passar disso é de IA, não do app
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/\/teste-[^/]*\.html$/],
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
      },
    }),
  ],
  // Trabalhador clássico: o carregador do wasm da IA usa `importScripts`.
  worker: { format: 'iife' },
  test: {
    environment: 'jsdom',
    exclude: ['tests/e2e/**', 'node_modules/**'],
    globalSetup: ['tests/setup-fuso.ts'],
    setupFiles: ['tests/setup.ts'],
  },
});
