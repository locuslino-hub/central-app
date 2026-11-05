// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { beforeAll, describe, expect, it } from 'vitest';

let pacote: string;

beforeAll(() => {
  execFileSync(process.execPath, ['script/build.mjs'], { stdio: 'pipe' });
  pacote = readFileSync('script/dist/Codigo.js', 'utf8');
}, 30_000);

interface Saida {
  texto: string;
  tipo: string | null;
  setMimeType(tipo: string): Saida;
}

/** Roda o pacote como o Apps Script roda: sem módulos, serviços como globais. */
function carregar() {
  const propriedades = new Map<string, string>();
  const registros: string[] = [];
  let uuids = 0;
  const contexto = vm.createContext({
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (chave: string) => propriedades.get(chave) ?? null,
        setProperty: (chave: string, valor: string) => void propriedades.set(chave, valor),
      }),
    },
    Utilities: {
      getUuid: () => {
        uuids += 1;
        return `${String(uuids).padStart(8, '0')}-1111-4111-8111-111111111111`;
      },
    },
    Logger: { log: (mensagem: unknown) => void registros.push(String(mensagem)) },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput(texto: string): Saida {
        return {
          texto,
          tipo: null,
          setMimeType(tipo) {
            this.tipo = tipo;
            return this;
          },
        };
      },
    },
  });
  vm.runInContext(pacote, contexto);
  const globais = contexto as unknown as {
    doPost(evento?: unknown): Saida;
    gerarCodigo(): void;
    tratar?: unknown;
  };
  const postar = (corpo: string) => {
    const saida = globais.doPost({ postData: { contents: corpo } });
    return { tipo: saida.tipo, resposta: JSON.parse(saida.texto) as unknown };
  };
  return { globais, propriedades, registros, postar };
}

describe('pacote do Apps Script', () => {
  it('expõe doPost e gerarCodigo como funções globais', () => {
    const { globais } = carregar();
    expect(typeof globais.doPost).toBe('function');
    expect(typeof globais.gerarCodigo).toBe('function');
  });

  it('declara as funções no topo do arquivo, onde o editor do Google as lista', () => {
    expect(pacote).toMatch(/^function doPost\(/m);
    expect(pacote).toMatch(/^function gerarCodigo\(/m);
  });

  it('não polui o escopo global com funções internas', () => {
    expect(carregar().globais.tratar).toBeUndefined();
  });

  it('sem código gerado, doPost recusa inclusive código vazio', () => {
    const { postar } = carregar();
    expect(postar(JSON.stringify({ codigo: '', acao: 'ping' })).resposta).toEqual({
      ok: false,
      erro: 'codigo-invalido',
    });
  });

  it('gerarCodigo guarda 32+ caracteres e registra o mesmo código para o dono copiar', () => {
    const { globais, propriedades, registros } = carregar();
    globais.gerarCodigo();
    const [guardado] = [...propriedades.values()];
    expect(propriedades.size).toBe(1);
    expect(guardado.length).toBeGreaterThanOrEqual(32);
    expect(registros.join('\n')).toContain(guardado);
  });

  it('o código gerado passa a abrir o ping, em JSON', () => {
    const { globais, propriedades, postar } = carregar();
    globais.gerarCodigo();
    const [codigo] = [...propriedades.values()];
    expect(postar(JSON.stringify({ codigo, acao: 'ping', dados: {} }))).toEqual({
      tipo: 'application/json',
      resposta: { ok: true, dados: {} },
    });
  });

  it('gerar de novo troca o código e o antigo deixa de valer', () => {
    const { globais, propriedades, postar } = carregar();
    globais.gerarCodigo();
    const [antigo] = [...propriedades.values()];
    globais.gerarCodigo();
    const [novo] = [...propriedades.values()];
    expect(novo).not.toBe(antigo);
    expect(propriedades.size).toBe(1);
    expect(postar(JSON.stringify({ codigo: antigo, acao: 'ping' })).resposta).toEqual({
      ok: false,
      erro: 'codigo-invalido',
    });
    expect(postar(JSON.stringify({ codigo: novo, acao: 'ping' })).resposta).toEqual({
      ok: true,
      dados: {},
    });
  });

  it('corpo quebrado vira interno em JSON, sem lançar exceção', () => {
    const { postar } = carregar();
    expect(postar('{quebrado')).toEqual({
      tipo: 'application/json',
      resposta: { ok: false, erro: 'interno' },
    });
  });

  it.each([
    ['sem evento', undefined],
    ['sem corpo', {}],
  ])('doPost %s responde interno', (_nome, evento) => {
    const { globais } = carregar();
    expect(JSON.parse(globais.doPost(evento).texto)).toEqual({ ok: false, erro: 'interno' });
  });
});

describe('manifesto publicado', () => {
  const manifesto = () =>
    JSON.parse(readFileSync('script/dist/appsscript.json', 'utf8')) as Record<string, unknown>;

  it('roda como o dono e aberto a qualquer pessoa, no fuso de Lisboa e em V8', () => {
    expect(manifesto()).toMatchObject({
      timeZone: 'Europe/Lisbon',
      runtimeVersion: 'V8',
      webapp: { executeAs: 'USER_DEPLOYING', access: 'ANYONE_ANONYMOUS' },
    });
  });

  it('declara os escopos explicitamente, sem pedir nada além do usado', () => {
    expect(manifesto().oauthScopes).toEqual([]);
  });
});
