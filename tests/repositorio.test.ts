// @vitest-environment node
// Guardas do repositório público: nada de módulo de CDN sem versão, nada de segredo no git, nenhum
// e-mail pessoal nos arquivos (nem no histórico).
//
// Como rodar: `npx vitest run tests/repositorio.test.ts`. A conferência do histórico do Git faz parte
// dela (cerca de 2 s); fica de fora sozinha em clone raso (`git clone --depth`, como o do CI), que não
// tem o histórico inteiro. Para refazer só ela: `npx vitest run tests/repositorio.test.ts -t histórico`.
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

describe('módulos de CDN (public/ e tests/manual/)', () => {
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
    expect(modulosExternos(readFileSync('tests/manual/teste-ia.html', 'utf8'))).not.toEqual([]);
  });

  // R18: a página de teste de IA importa de CDN; por isso fica fora de public/, que vai ao ar.
  it('nada em public/ (o que é publicado) importa código de fora', () => {
    const problemas = arquivosEm('public').flatMap((arquivo) =>
      modulosExternos(readFileSync(arquivo, 'utf8')).map((url) => `${arquivo}: ${url}`),
    );
    expect(problemas).toEqual([]);
  });

  it('as páginas manuais só importam módulo com versão exata', () => {
    const problemas = arquivosEm('tests/manual').flatMap((arquivo) =>
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

// ---- Segredos e e-mails pessoais (Tarefa 23) ----

/** E-mail: texto@domínio.letras (`pacote@1.2.3` e `@escopo/pacote` não casam). */
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

/**
 * Só vale: noreply (GitHub e a assinatura das contribuições) e endereços inventados: os domínios de exemplo
 * dos testes (exemplo.invalid, exemplo.com), qualquer `.invalid` e `example.com/org/net` (reservados, nunca de uma pessoa de verdade).
 */
function emailPermitido(email: string): boolean {
  const [local, dominio] = email.toLowerCase().split('@');
  const ficticio = /(?:^|\.)(?:exemplo\.(?:invalid|com)|example\.(?:com|org|net))$|\.invalid$/.test(dominio);
  return ficticio || local === 'noreply' || local.endsWith('+noreply') || dominio === 'users.noreply.github.com';
}

/** `https://usuario:senha@host` e `https://usuario@host` não são e-mail: a parte antes do @ é dado de endereço. */
const SEM_USUARIO_DE_URL = /\/\/[^\s/@]*@/g;

function emailsDeFora(texto: string): string[] {
  return (texto.replace(SEM_USUARIO_DE_URL, '//').match(EMAIL) ?? []).filter((email) => !emailPermitido(email));
}

/** Formatos de chave, token e credencial. O que o app guarda no aparelho nunca aparece escrito no código. */
const SEGREDOS: [nome: string, padrao: RegExp][] = [
  ['token do GitHub', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/],
  ['chave de API do Google', /\bAIza[0-9A-Za-z_-]{30,}/],
  ['segredo de cliente do Google', /\bGOCSPX-[0-9A-Za-z_-]{20,}/],
  ['token de acesso do Google', /\bya29\.[0-9A-Za-z_-]{30,}/],
  ['token de atualização do Google', /\b1\/\/0[0-9A-Za-z_-]{40,}/],
  ['id de implantação do Apps Script', /\/macros\/s\/AKfycb[0-9A-Za-z_-]{20,}/],
  ['chave privada', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY/],
  ['chave da AWS', /\bAKIA[0-9A-Z]{16}\b/],
  ['token do Slack', /\bxox[abposr]-[0-9A-Za-z-]{10,}/],
  ['chave sk-', /\bsk-[A-Za-z0-9_-]{32,}/],
  // Os códigos dos testes dizem "ficticio" ou "teste" no próprio texto.
  ['código do aparelho preenchido', /["']?codigo["']?\s*[:=]\s*["'](?![^"']*(?:ficticio|teste|exemplo))[A-Za-z0-9_-]{32,}["']/],
];

function segredosEm(texto: string): string[] {
  return SEGREDOS.filter(([, padrao]) => padrao.test(texto)).map(([nome]) => nome);
}

const BINARIOS = /\.(?:png|jpe?g|gif|webp|ico|icns|woff2?|ttf|otf|eot|gguf|bin|zip|gz|pdf|wasm|mp3|mp4|webm)$/i;

/**
 * Este arquivo traz, de propósito, um exemplo de cada segredo e e-mail que procura. O package-lock.json
 * leva o e-mail de contato de quem mantém cada pacote de terceiros (só o e-mail é dispensado nele).
 */
const FORA_DOS_SEGREDOS = new Set(['tests/repositorio.test.ts']);
/** O package-lock.json fica só fora do e-mail: a busca por chave e token vale nele também. */
const FORA_DOS_EMAILS = new Set(['tests/repositorio.test.ts', 'package-lock.json']);

function arquivosDoGit(): string[] {
  const saida = spawnSync('git', ['ls-files', '-z'], { encoding: 'utf8' });
  return saida.stdout.split('\0').filter((caminho) => caminho !== '' && !BINARIOS.test(caminho));
}

describe('e-mails e segredos: as próprias verificações', () => {
  it.each([
    ['e-mail pessoal', 'fale com ana.silva@gmail.com hoje', ['ana.silva@gmail.com']],
    ['e-mail institucional', 'prof@universidade.edu.pt', ['prof@universidade.edu.pt']],
    ['noreply do GitHub', '290137166+locuslino-hub@users.noreply.github.com', []],
    ['noreply da assinatura', 'Co-Authored-By: Claude <noreply@anthropic.com>', []],
    ['domínio de exemplo', 'marina@exemplo.invalid e souza@exemplo.invalid', []],
    ['versão de pacote', 'vite@8.3.6 e @preact/preset-vite', []],
  ])('e-mail: %s', (_nome, texto, esperado) => {
    expect(emailsDeFora(texto)).toEqual(esperado);
  });

  it.each([
    ['token do GitHub', `ghp_${'a1B2'.repeat(9)}`],
    ['chave de API do Google', `AIza${'Sy-x9'.repeat(8)}`],
    ['id de implantação do Apps Script', `https://script.google.com/macros/s/AKfycb${'x1_-'.repeat(10)}/exec`],
    ['chave privada', '-----BEGIN PRIVATE KEY-----'],
    ['chave da AWS', 'AKIAABCDEFGHIJKLMNOP'],
    ['código do aparelho preenchido', `{ codigo: '${'a1b2c3d4'.repeat(5)}' }`],
  ])('segredo: pega %s', (nome, texto) => {
    expect(segredosEm(texto)).toContain(nome);
  });

  it.each([
    ['id fictício dos testes', 'https://script.google.com/macros/s/ID-FICTICIO/exec'],
    ['código fictício curto', "codigo: 'abc'"],
    ['texto comum', 'A chave de API fica fora do código.'],
  ])('segredo: aceita %s', (_nome, texto) => {
    expect(segredosEm(texto)).toEqual([]);
  });
});

describe('arquivos versionados', () => {
  const arquivos = arquivosDoGit();

  it('a lista de arquivos do git não está vazia', () => {
    expect(arquivos.length).toBeGreaterThan(50);
  });

  it('nenhum tem e-mail que não seja noreply ou @exemplo.invalid', () => {
    const problemas = arquivos
      .filter((arquivo) => !FORA_DOS_EMAILS.has(arquivo))
      .flatMap((arquivo) => emailsDeFora(readFileSync(arquivo, 'utf8')).map((email) => `${arquivo}: ${email}`));
    expect(problemas).toEqual([]);
  });

  it('nenhum tem chave, token ou credencial', () => {
    const problemas = arquivos
      .filter((arquivo) => !FORA_DOS_SEGREDOS.has(arquivo))
      .flatMap((arquivo) => segredosEm(readFileSync(arquivo, 'utf8')).map((nome) => `${arquivo}: ${nome}`));
    expect(problemas).toEqual([]);
  });
});

describe('histórico do Git', () => {
  const git = (...args: string[]) => spawnSync('git', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 512 });
  const raso = git('rev-parse', '--is-shallow-repository').stdout.trim() === 'true';

  // Clone raso (CI) não tem o histórico inteiro: não há o que conferir.
  it.skipIf(raso)('nenhum autor, mensagem ou linha já adicionada tem e-mail de fora ou segredo', () => {
    const autores = git('log', '--all', '--format=%an <%ae> / %cn <%ce>%n%B').stdout;
    expect(emailsDeFora(autores)).toEqual([]);
    expect(segredosEm(autores)).toEqual([]);

    // Só as linhas acrescentadas: o que já foi retirado também ficou no histórico.
    const adicionadasSem = (excluidos: ReadonlySet<string>) =>
      git('log', '--all', '-p', '--no-color', '--format=', '--', '.', ...[...excluidos].map((caminho) => `:(exclude)${caminho}`))
        .stdout.split('\n')
        .filter((linha) => linha.startsWith('+') && !linha.startsWith('+++'))
        .join('\n');
    const paraSegredos = adicionadasSem(FORA_DOS_SEGREDOS);
    expect(paraSegredos.length).toBeGreaterThan(0);
    expect(segredosEm(paraSegredos)).toEqual([]);
    expect(emailsDeFora(adicionadasSem(FORA_DOS_EMAILS))).toEqual([]);
  });
});
