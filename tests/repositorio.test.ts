// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const IMPORTACAO_EXTERNA =
  /(?:\bfrom\s*|\bimport\s*\(?\s*|<script\b[^>]*\bsrc\s*=\s*)["'`]((?:https?:)?\/\/[^"'`]+)["'`]/g;
const VERSAO_EXATA = /[\w-]@\d+\.\d+\.\d+(?:-[\w.-]+)?(?:[/?#]|$)/;

function modulosExternos(texto: string): string[] {
  return [...texto.matchAll(IMPORTACAO_EXTERNA)].map((achado) => achado[1]);
}

function semVersaoExata(texto: string): string[] {
  return modulosExternos(texto).filter((url) => !VERSAO_EXATA.test(url));
}

function arquivosEm(pasta: string): string[] {
  return readdirSync(pasta, { withFileTypes: true }).flatMap((item) => {
    const caminho = join(pasta, item.name);
    return item.isDirectory() ? arquivosEm(caminho) : [caminho];
  });
}

describe('módulos de CDN em public/', () => {
  it.each([
    ['sem versão', `import {A} from 'https://cdn.jsdelivr.net/npm/@escopo/pacote/+esm';`],
    ['com latest', `import {A} from 'https://cdn.jsdelivr.net/npm/pacote@latest/+esm';`],
    ['versão parcial', `import 'https://cdn.jsdelivr.net/npm/pacote@1.2/+esm';`],
    ['faixa de versões', `import 'https://esm.sh/pacote@^1.2.3';`],
    ['importação dinâmica', `await import("https://unpkg.com/pacote");`],
    ['tag script', `<script type="module" src="https://unpkg.com/pacote"></script>`],
    ['sem protocolo', `import A from '//cdn.jsdelivr.net/npm/pacote/+esm';`],
  ])('a verificação pega %s', (_nome, texto) => {
    expect(semVersaoExata(texto)).toHaveLength(1);
  });

  it.each([
    ['escopo e versão', `import {A} from 'https://cdn.jsdelivr.net/npm/@escopo/pacote@0.19.0/+esm';`],
    ['versão no fim', `import 'https://esm.sh/pacote@1.2.3';`],
    ['pré-lançamento', `import 'https://esm.sh/pacote@1.2.3-beta.1/mod.js';`],
    ['módulo local', `import {A} from './local.js';`],
  ])('a verificação aceita %s', (_nome, texto) => {
    expect(semVersaoExata(texto)).toEqual([]);
  });

  it('a verificação enxerga a importação real da página de teste', () => {
    expect(modulosExternos(readFileSync('public/teste-ia.html', 'utf8'))).not.toEqual([]);
  });

  it('nenhum arquivo importa módulo sem versão exata', () => {
    const problemas = arquivosEm('public').flatMap((arquivo) =>
      semVersaoExata(readFileSync(arquivo, 'utf8')).map((url) => `${arquivo}: ${url}`),
    );
    expect(problemas).toEqual([]);
  });
});

describe('.gitignore', () => {
  const ignorado = (caminho: string) =>
    spawnSync('git', ['check-ignore', '-q', '--no-index', caminho]).status === 0;

  it.each([
    '.clasp.json',
    'script/.clasp.json',
    '.clasprc.json',
    'script/.clasprc.json',
    'script/.implantacao',
    '.env',
    '.env.local',
    'script/.env',
    'creds.json',
    'creds-google.json',
    'client_secret.json',
    'client_secret_123.json',
  ])('ignora %s', (caminho) => {
    expect(ignorado(caminho)).toBe(true);
  });

  it.each(['package.json', 'script/appsscript.json', 'script/tsconfig.json'])(
    'não ignora %s',
    (caminho) => {
      expect(ignorado(caminho)).toBe(false);
    },
  );
});
