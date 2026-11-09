// Servidor de arquivos do app construído (`dist/`) em que o teste escolhe qual
// versão está no ar. A versão 2 muda o HTML (uma marca no <head>) e o service
// worker (o carimbo do index.html), como acontece quando o app é publicado de novo.
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize } from 'node:path';

const BASE = '/central-app/';
const TIPOS: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

export const MARCA_DA_VERSAO = 'versao-do-app';

export async function servidorDeVersoes(pasta = 'dist') {
  let versao = 1;
  const servidor: Server = createServer((pedido, resposta) => {
    void (async () => {
      const caminho = decodeURIComponent((pedido.url ?? '/').split('?')[0]);
      if (!caminho.startsWith(BASE)) return resposta.writeHead(404).end();
      const relativo = caminho.slice(BASE.length) || 'index.html';
      const arquivo = join(pasta, normalize(relativo));
      if (!arquivo.startsWith(normalize(pasta))) return resposta.writeHead(403).end();
      try {
        let corpo: Buffer | string = await readFile(arquivo);
        if (versao === 2 && relativo === 'index.html') {
          corpo = corpo.toString('utf8').replace('<head>', `<head><meta name="${MARCA_DA_VERSAO}" content="2" />`);
        }
        if (versao === 2 && relativo === 'sw.js') {
          corpo = corpo.toString('utf8').replace(/(url:"index\.html",revision:")([0-9a-f]+)"/, '$1v2-$2"');
        }
        resposta.writeHead(200, { 'content-type': TIPOS[extname(arquivo)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
        resposta.end(corpo);
      } catch {
        resposta.writeHead(404).end();
      }
    })();
  });
  await new Promise<void>((pronto) => servidor.listen(0, '127.0.0.1', pronto));
  const porta = (servidor.address() as AddressInfo).port;
  return {
    /** O endereço do app nesta versão. `127.0.0.1` vale como origem segura (service worker funciona). */
    url: `http://127.0.0.1:${porta}${BASE}`,
    publicarVersao2() {
      versao = 2;
    },
    parar: () => new Promise<void>((pronto) => servidor.close(() => pronto())),
  };
}
