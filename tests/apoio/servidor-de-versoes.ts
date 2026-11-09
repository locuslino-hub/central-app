// Servidor de arquivos do app construído (`dist/`) em que o teste escolhe qual
// versão está no ar. A versão 2 muda o HTML (uma marca no <head>) e o service
// worker (o carimbo e a integridade do index.html), como acontece quando o app é
// publicado de novo. `foraDoAr` faz tudo responder 503: o que abrir depois disso
// veio do aparelho, não da rede.
import { createHash } from 'node:crypto';
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
  let noAr = true;
  const html2 = async () =>
    (await readFile(join(pasta, 'index.html'), 'utf8')).replace('<head>', `<head><meta name="${MARCA_DA_VERSAO}" content="2" />`);
  const servidor: Server = createServer((pedido, resposta) => {
    void (async () => {
      if (!noAr) return resposta.writeHead(503).end();
      const caminho = decodeURIComponent((pedido.url ?? '/').split('?')[0]);
      if (!caminho.startsWith(BASE)) return resposta.writeHead(404).end();
      const relativo = caminho.slice(BASE.length) || 'index.html';
      const arquivo = join(pasta, normalize(relativo));
      if (!arquivo.startsWith(normalize(pasta))) return resposta.writeHead(403).end();
      try {
        let corpo: Buffer | string = await readFile(arquivo);
        if (versao === 2 && relativo === 'index.html') corpo = await html2();
        if (versao === 2 && relativo === 'sw.js') {
          const integridade = `sha384-${createHash('sha384').update(await html2()).digest('base64')}`;
          const antes = corpo.toString('utf8');
          corpo = antes.replace(
            /(url:"index\.html",revision:")([0-9a-f]+)",integrity:"[^"]+"/,
            `$1v2-$2",integrity:"${integridade}"`,
          );
          if (corpo === antes) throw new Error('sw.js sem a entrada do index.html com integridade');
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
    /** Tudo passa a responder 503 (o servidor do app "caiu"). */
    foraDoAr() {
      noAr = false;
    },
    /** Fecha o servidor, mesmo com conexões abertas pelo navegador; pode ser chamado mais de uma vez. */
    parar: () =>
      new Promise<void>((pronto) => {
        servidor.close(() => pronto());
        servidor.closeAllConnections();
      }),
  };
}
