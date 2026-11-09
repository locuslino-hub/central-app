import { copyFileSync, createReadStream, mkdirSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import preact from '@preact/preset-vite';

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
  plugins: [preact(), wasmDaIA()],
  // Trabalhador clássico: o carregador do wasm da IA usa `importScripts`.
  worker: { format: 'iife' },
  test: {
    environment: 'jsdom',
    exclude: ['tests/e2e/**', 'node_modules/**'],
    globalSetup: ['tests/setup-fuso.ts'],
    setupFiles: ['tests/setup.ts'],
  },
});
