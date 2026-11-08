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

interface ArquivoNoDrive {
  id: string;
  name: string;
  mimeType?: string;
  trashed: boolean;
  conteudo: string;
}

interface BlobFalso {
  getDataAsString(): string;
  getContentType(): string;
}

type FormaDaLeitura = 'texto' | 'blob' | 'objeto' | 'excecao-200';

/** Drive avançado (v3) na memória, só com o que o script usa. */
function driveFalso() {
  const arquivos = new Map<string, ArquivoNoDrive>();
  const listas: string[] = [];
  let proximo = 0;
  // 'texto' é o que os tipos (@types) prometem; 'excecao-200' é o que o Drive real faz (ver fix 3).
  let formaDaLeitura: FormaDaLeitura = 'texto';
  const Files = {
    create(recurso: { name: string; mimeType?: string }, midia: BlobFalso) {
      proximo += 1;
      const arquivo = {
        id: `arquivo-${proximo}`,
        name: recurso.name,
        mimeType: recurso.mimeType,
        trashed: false,
        conteudo: midia.getDataAsString(),
      };
      arquivos.set(arquivo.id, arquivo);
      return { id: arquivo.id, name: arquivo.name };
    },
    get(id: string, opcoes?: { alt?: string }): unknown {
      const arquivo = arquivos.get(id);
      if (!arquivo) throw new Error('File not found');
      if (opcoes?.alt !== 'media') return { id, name: arquivo.name, trashed: arquivo.trashed };
      if (formaDaLeitura === 'texto') return arquivo.conteudo;
      if (formaDaLeitura === 'objeto') return JSON.parse(arquivo.conteudo);
      if (formaDaLeitura === 'excecao-200') {
        const erro = new Error(`Response Code: 200. Message: ${arquivo.conteudo}`);
        erro.name = 'HttpResponseException';
        throw erro;
      }
      return { getDataAsString: () => arquivo.conteudo, getContentType: () => 'application/json' };
    },
    update(recurso: { trashed?: boolean }, id: string, midia?: BlobFalso): unknown {
      const arquivo = arquivos.get(id);
      if (!arquivo) throw new Error('File not found');
      if (recurso.trashed !== undefined) arquivo.trashed = recurso.trashed;
      if (midia) arquivo.conteudo = midia.getDataAsString();
      return { id };
    },
    list(opcoes: { q: string }) {
      listas.push(opcoes.q);
      const nome = /name = '([^']+)'/.exec(opcoes.q)?.[1];
      const prefixo = /name contains '([^']+)'/.exec(opcoes.q)?.[1];
      const files = [...arquivos.values()]
        .filter((a) => !a.trashed)
        .filter((a) => (nome ? a.name === nome : prefixo ? a.name.includes(prefixo) : true))
        .map((a) => ({ id: a.id, name: a.name }));
      return { files };
    },
  };
  return {
    arquivos,
    listas,
    servico: { Files },
    lerComo(forma: FormaDaLeitura) {
      formaDaLeitura = forma;
    },
  };
}

/** Roda o pacote como o Apps Script roda: sem módulos, serviços como globais. */
function carregar() {
  const propriedades = new Map<string, string>();
  const leituras = new Map<string, number>();
  const registros: string[] = [];
  const erros: string[] = [];
  const drive = driveFalso();
  const cache = { valores: new Map<string, string>(), quebrado: false, putQuebrado: false, prazos: [] as number[] };
  const cacheDoScript = () => {
    if (cache.quebrado) throw new Error('CacheService fora do ar');
    return {
      get: (chave: string) => cache.valores.get(chave) ?? null,
      put: (chave: string, valor: string, segundos?: number) => {
        if (cache.putQuebrado) throw new Error('Cache cheio');
        cache.prazos.push(segundos ?? -1);
        cache.valores.set(chave, valor);
      },
      remove: (chave: string) => void cache.valores.delete(chave),
    };
  };
  const trava = { livre: true, presa: false, esperas: [] as number[] };
  let uuids = 0;
  const contexto = vm.createContext({
    Drive: drive.servico,
    CacheService: { getScriptCache: () => cacheDoScript() },
    LockService: {
      getScriptLock: () => ({
        tryLock(ms: number) {
          trava.esperas.push(ms);
          if (!trava.livre) return false;
          trava.presa = true;
          return true;
        },
        releaseLock() {
          trava.presa = false;
        },
      }),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (chave: string) => {
          leituras.set(chave, (leituras.get(chave) ?? 0) + 1);
          return propriedades.get(chave) ?? null;
        },
        setProperty: (chave: string, valor: string) => void propriedades.set(chave, valor),
      }),
    },
    Utilities: {
      newBlob: (dados: string, tipo: string): BlobFalso => ({
        getDataAsString: () => dados,
        getContentType: () => tipo,
      }),
      formatDate: (data: Date, fuso: string, formato: string) => {
        if (fuso !== 'Europe/Lisbon' || formato !== 'yyyy-MM-dd') throw new Error('formato inesperado');
        return data.toISOString().slice(0, 10);
      },
      getUuid: () => {
        uuids += 1;
        return `${String(uuids).padStart(8, '0')}-1111-4111-8111-111111111111`;
      },
    },
    Logger: { log: (mensagem: unknown) => void registros.push(String(mensagem)) },
    console: {
      log: (...partes: unknown[]) => void registros.push(partes.map(String).join(' ')),
      error: (...partes: unknown[]) => void erros.push(partes.map(String).join(' ')),
    },
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
  return { globais, propriedades, leituras, registros, erros, postar, drive, trava, cache };
}

// O vm tem o próprio Date, real: o dia da cópia é o de hoje (ver hojeEmLisboa).
const T0 = Date.parse('2026-11-05T12:20:00Z');

function tarefa(id: string, titulo: string, atualizadoEm = T0) {
  return { colecao: 'tarefas', registro: { id, titulo, salaId: null, atualizadoEm, aparelho: 'notebook' } };
}

type RespostaDoPacote = { ok: boolean; dados?: any; erro?: string };

/** Pacote carregado, com código gerado, e um atalho para pedir ações. */
function conectado() {
  const carregado = carregar();
  carregado.globais.gerarCodigo();
  const [codigo] = [...carregado.propriedades.values()];
  const pedir = (acao: string, dados: unknown) =>
    carregado.postar(JSON.stringify({ codigo, acao, dados })).resposta as RespostaDoPacote;
  return { ...carregado, pedir };
}

describe('autorizarDrive', () => {
  it('é função global no topo do arquivo, para o dono rodar pelo editor', () => {
    expect(pacote).toMatch(/^function autorizarDrive\(/m);
    expect(typeof (carregar().globais as unknown as { autorizarDrive: unknown }).autorizarDrive).toBe(
      'function',
    );
  });

  it('usa o Drive, registra uma mensagem e não cria arquivo nem troca o código', () => {
    const { globais, propriedades, registros, drive } = carregar();
    globais.gerarCodigo();
    const antes = new Map(propriedades);
    (globais as unknown as { autorizarDrive(): void }).autorizarDrive();

    expect(drive.listas.length).toBeGreaterThan(0);
    expect(drive.arquivos.size).toBe(0);
    expect(propriedades).toEqual(antes);
    expect(registros.at(-1)).toMatch(/Permissão do Drive/);
  });

  it('com o arquivo já criado, não registra o conteúdo nem o id', () => {
    const { globais, registros, propriedades, postar } = carregar();
    globais.gerarCodigo();
    const [codigo] = [...propriedades.values()];
    postar(JSON.stringify({ codigo, acao: 'enviar', dados: { mudancas: [tarefa('t1', 'Segredo da Marina')] } }));
    (globais as unknown as { autorizarDrive(): void }).autorizarDrive();

    const mensagem = registros.at(-1)!;
    expect(mensagem).toMatch(/Permissão do Drive/);
    expect(mensagem).not.toContain('Segredo');
    expect(mensagem).not.toContain('arquivo-1');
  });
});

describe('dados no Drive pelo pacote', () => {
  it('enviar cria central-dados.json em JSON e puxar devolve o enviado', () => {
    const { pedir, drive } = conectado();
    expect(pedir('enviar', { mudancas: [tarefa('t1', 'Ler com Marina')] })).toEqual({
      ok: true,
      dados: { aceitas: [{ colecao: 'tarefas', id: 't1' }], conflitos: [], recusadas: [], substituidas: [], agora: expect.any(Number) },
    });

    const arquivos = [...drive.arquivos.values()];
    expect(arquivos.map((a) => [a.name, a.mimeType])).toEqual([
      ['central-dados.json', 'application/json'],
    ]);
    expect(pedir('puxar', { desde: 0 }).dados.registros).toEqual([tarefa('t1', 'Ler com Marina')]);
  });

  it('escritas seguintes atualizam o mesmo arquivo, sem procurar de novo', () => {
    const { pedir, drive } = conectado();
    pedir('enviar', { mudancas: [tarefa('t1', 'a')] });
    const buscas = () => drive.listas.filter((q) => q.includes("name = 'central-dados.json'")).length;
    const antes = buscas();
    pedir('enviar', { mudancas: [tarefa('t2', 'b')] });

    expect([...drive.arquivos.values()].filter((a) => a.name === 'central-dados.json')).toHaveLength(1);
    expect(pedir('puxar', { desde: 0 }).dados.registros).toHaveLength(2);
    expect(buscas()).toBe(antes);
  });

  it('acha o arquivo já existente pelo nome quando o id não está guardado', () => {
    const { pedir, propriedades } = conectado();
    pedir('enviar', { mudancas: [tarefa('t1', 'Aula da Aurora')] });
    const guardado = [...propriedades].find(([, valor]) => valor === 'arquivo-1');
    expect(guardado).toBeDefined();
    propriedades.delete(guardado![0]);

    expect(pedir('puxar', { desde: 0 }).dados.registros).toEqual([tarefa('t1', 'Aula da Aurora')]);
  });

  it('lê o conteúdo também quando o Drive devolve um blob', () => {
    const { pedir, drive } = conectado();
    pedir('enviar', { mudancas: [tarefa('t1', 'a')] });
    drive.lerComo('blob');
    expect(pedir('puxar', { desde: 0 }).dados.registros).toEqual([tarefa('t1', 'a')]);
  });

  it('arquivo guardado que sumiu do Drive dá interno e não cria outro vazio', () => {
    const { pedir, drive } = conectado();
    pedir('enviar', { mudancas: [tarefa('t1', 'a')] });
    drive.arquivos.clear();

    expect(pedir('enviar', { mudancas: [tarefa('t2', 'b')] })).toEqual({ ok: false, erro: 'interno' });
    expect(drive.arquivos.size).toBe(0);
  });

  it('trava ocupada responde ocupado; a trava é sempre solta', () => {
    const { pedir, trava } = conectado();
    trava.livre = false;
    expect(pedir('enviar', { mudancas: [tarefa('t1', 'a')] })).toEqual({ ok: false, erro: 'ocupado' });

    trava.livre = true;
    expect(pedir('enviar', { mudancas: [tarefa('t1', 'a')] }).ok).toBe(true);
    expect(trava.presa).toBe(false);
    expect(trava.esperas.every((ms) => ms > 0 && ms <= 30_000)).toBe(true);
  });

  it('solta a trava mesmo quando a gravação falha', () => {
    const { pedir, trava, drive } = conectado();
    pedir('enviar', { mudancas: [tarefa('t1', 'a')] });
    drive.servico.Files.update = () => {
      throw new Error('Drive fora do ar');
    };
    expect(pedir('enviar', { mudancas: [tarefa('t2', 'b')] })).toEqual({ ok: false, erro: 'interno' });
    expect(trava.presa).toBe(false);
  });

  it('cópia diária vira arquivo próprio e cópias com mais de 30 dias vão para a lixeira', () => {
    const { pedir, drive } = conectado();
    pedir('enviar', { mudancas: [tarefa('t1', 'a')] });
    drive.arquivos.set('velha', {
      id: 'velha',
      name: 'central-dados-2026-09-01.json',
      trashed: false,
      conteudo: '{}',
    });

    pedir('enviar', { mudancas: [tarefa('t2', 'b')] });

    const vivos = [...drive.arquivos.values()].filter((a) => !a.trashed).map((a) => a.name);
    expect(vivos.sort()).toEqual([`central-dados-${hojeEmLisboa()}.json`, 'central-dados.json']);
    expect(drive.arquivos.get('velha')!.trashed).toBe(true);
  });
});

function hojeEmLisboa() {
  return new Date().toISOString().slice(0, 10);
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

  it('declara os escopos explicitamente: só arquivos do Drive criados pelo próprio script', () => {
    expect(manifesto().oauthScopes).toEqual(['https://www.googleapis.com/auth/drive.file']);
  });

  it('liga o serviço avançado do Drive na v3', () => {
    expect(manifesto().dependencies).toEqual({
      enabledAdvancedServices: [{ userSymbol: 'Drive', serviceId: 'drive', version: 'v3' }],
    });
  });
});

describe('arquivo de dados no Drive: casos que nunca gravam', () => {
  it('arquivo guardado que foi para a lixeira dá interno em puxar e enviar, sem gravar', () => {
    const { pedir, drive } = conectado();
    pedir('enviar', { mudancas: [tarefa('t1', 'a')] });
    const principal = [...drive.arquivos.values()].find((a) => a.name === 'central-dados.json')!;
    const antes = principal.conteudo;
    principal.trashed = true;

    expect(pedir('puxar', { desde: 0 })).toEqual({ ok: false, erro: 'interno' });
    expect(pedir('enviar', { mudancas: [tarefa('t2', 'b')] })).toEqual({ ok: false, erro: 'interno' });
    expect(principal.conteudo).toBe(antes);
    expect([...drive.arquivos.values()].filter((a) => a.name === 'central-dados.json')).toHaveLength(1);
  });

  it('dois arquivos central-dados.json sem id guardado dá interno e não cria nem grava', () => {
    const { pedir, drive } = conectado();
    for (const id of ['um', 'dois']) {
      drive.arquivos.set(id, { id, name: 'central-dados.json', trashed: false, conteudo: '{"versao":1,"ultimo":0,"registros":[]}' });
    }

    expect(pedir('enviar', { mudancas: [tarefa('t1', 'a')] })).toEqual({ ok: false, erro: 'interno' });
    expect(pedir('puxar', { desde: 0 })).toEqual({ ok: false, erro: 'interno' });
    expect(drive.arquivos.size).toBe(2);
    expect([...drive.arquivos.values()].every((a) => a.conteudo.includes('"registros":[]'))).toBe(true);
  });
});

describe('código do aparelho em cache', () => {
  it('depois do primeiro pedido, o código vem do cache e não das propriedades', () => {
    const { pedir, leituras } = conectado();
    pedir('ping', {});
    const depoisDoPrimeiro = leituras.get('CODIGO_DO_APARELHO') ?? 0;
    pedir('ping', {});
    pedir('ping', {});
    expect(leituras.get('CODIGO_DO_APARELHO') ?? 0).toBe(depoisDoPrimeiro);
  });

  it('gerar de novo invalida o cache: o código antigo para de valer na hora', () => {
    const { globais, propriedades, postar } = carregar();
    globais.gerarCodigo();
    const antigo = propriedades.get('CODIGO_DO_APARELHO')!;
    expect((postar(JSON.stringify({ codigo: antigo, acao: 'ping' })).resposta as { ok: boolean }).ok).toBe(true);

    globais.gerarCodigo();
    const novo = propriedades.get('CODIGO_DO_APARELHO')!;
    expect(postar(JSON.stringify({ codigo: antigo, acao: 'ping' })).resposta).toEqual({
      ok: false,
      erro: 'codigo-invalido',
    });
    expect((postar(JSON.stringify({ codigo: novo, acao: 'ping' })).resposta as { ok: boolean }).ok).toBe(true);
  });

  it('sem CacheService, lê das propriedades e continua atendendo', () => {
    const { pedir, cache } = conectado();
    cache.quebrado = true;
    expect(pedir('ping', {})).toEqual({ ok: true, dados: {} });
  });

  it('sem código gerado, nada vai para o cache', () => {
    const { postar, cache } = carregar();
    postar(JSON.stringify({ codigo: 'x'.repeat(40), acao: 'ping' }));
    expect(cache.valores.size).toBe(0);
  });
});

describe('fix 2: cache do código', () => {
  it('o código fica no cache por 10 min', () => {
    const { pedir, cache } = conectado();
    pedir('ping', {});
    expect(cache.prazos.length).toBeGreaterThan(0);
    expect(cache.prazos.every((segundos) => segundos === 600)).toBe(true);
  });

  it('gerarCodigo falha (lança) se não conseguir pôr o código novo no cache, sem registrar o código', () => {
    const { globais, cache, registros } = carregar();
    cache.putQuebrado = true;
    expect(() => globais.gerarCodigo()).toThrow(/gerarCodigo de novo/);
    expect(registros.join('\n')).not.toMatch(/Código do aparelho/);
  });

  it('gerarCodigo falha se o CacheService estiver fora do ar', () => {
    const { globais, cache } = carregar();
    cache.quebrado = true;
    expect(() => globais.gerarCodigo()).toThrow(/gerarCodigo de novo/);
  });
});

// Forma real documentada (issue 149104685 do Google, aberta; confirmada em 2026):
// no serviço avançado, Files.get(id, {alt: 'media'}) LANÇA HttpResponseException
// com "Response Code: 200. Message: <conteúdo>", em vez de devolver o conteúdo.
describe('fix 3: Drive real (alt=media lança com Response Code 200)', () => {
  it('puxar dá interno e o registro diz por quê, sem conteúdo nem id', () => {
    const { pedir, drive, erros } = conectado();
    pedir('enviar', { mudancas: [tarefa('t1', 'Segredo da Marina')] });
    drive.lerComo('excecao-200');

    expect(pedir('puxar', { desde: 0 })).toEqual({ ok: false, erro: 'interno' });
    const registrado = erros.join('\n');
    expect(registrado).toContain('HttpResponseException: Response Code: 200. Message: …');
    expect(registrado).not.toContain('Segredo');
    expect(registrado).not.toContain('arquivo-1');
  });

  it('erro do Drive com id longo na mensagem não leva o id ao registro', () => {
    const { pedir, drive, erros, propriedades } = conectado();
    pedir('enviar', { mudancas: [tarefa('t1', 'a')] });
    const idLongo = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';
    propriedades.set('ID_DO_ARQUIVO_DE_DADOS', idLongo);
    drive.servico.Files.get = () => {
      throw new Error(`File not found: ${idLongo}.`);
    };

    expect(pedir('puxar', { desde: 0 })).toEqual({ ok: false, erro: 'interno' });
    expect(erros.join('\n')).toContain('File not found');
    expect(erros.join('\n')).not.toContain(idLongo);
  });
});

describe('fix 3: diagnosticarDrive', () => {
  function preparado() {
    const carregado = conectado();
    carregado.pedir('enviar', { mudancas: [tarefa('t1', 'Segredo da Marina')] });
    const principal = [...carregado.drive.arquivos.values()].find((a) => a.name === 'central-dados.json')!;
    const diagnosticar = () => {
      const antes = carregado.registros.length;
      (carregado.globais as unknown as { diagnosticarDrive(): void }).diagnosticarDrive();
      return carregado.registros.slice(antes).join('\n');
    };
    return { ...carregado, principal, diagnosticar };
  }

  it('é função global no topo do arquivo, para o dono rodar pelo editor', () => {
    expect(pacote).toMatch(/^function diagnosticarDrive\(/m);
  });

  it.each([
    ['texto', /alt=media devolveu: texto/],
    ['blob', /alt=media devolveu: Blob/],
    ['objeto', /alt=media devolveu: objeto/],
    ['excecao-200', /alt=media lançou HttpResponseException; começa com "Response Code: 200": sim/],
  ] as const)('com o Drive devolvendo %s, registra tipo, tamanho e se o JSON abre, sem conteúdo nem id', (forma, tipo) => {
    const { drive, principal, diagnosticar } = preparado();
    drive.lerComo(forma);
    const relatorio = diagnosticar();

    expect(relatorio).toMatch(tipo);
    expect(relatorio).toContain(`${principal.conteudo.length} caracteres`);
    expect(relatorio).toMatch(/JSON\.parse: ok/);
    expect(relatorio).not.toContain('Segredo');
    expect(relatorio).not.toContain(principal.id);
  });

  it('registra também o resultado do caminho de leitura do app', () => {
    const { drive, diagnosticar } = preparado();
    drive.lerComo('excecao-200');
    expect(diagnosticar()).toMatch(/Leitura do app: falhou \(HttpResponseException: Response Code: 200\. Message: …\)/);
    drive.lerComo('texto');
    expect(diagnosticar()).toMatch(/Leitura do app: ok, \d+ caracteres, JSON\.parse: ok/);
  });

  it('conteúdo que não é JSON aparece como JSON.parse: falhou', () => {
    const { principal, diagnosticar } = preparado();
    principal.conteudo = 'Segredo da Marina, não é JSON';
    const relatorio = diagnosticar();
    expect(relatorio).toMatch(/JSON\.parse: falhou/);
    expect(relatorio).not.toContain('Segredo');
  });

  it('não grava nada no Drive nem muda propriedades', () => {
    const { drive, principal, propriedades, diagnosticar } = preparado();
    const conteudo = principal.conteudo;
    const quantos = drive.arquivos.size;
    const props = new Map(propriedades);
    drive.lerComo('excecao-200');
    diagnosticar();
    expect(principal.conteudo).toBe(conteudo);
    expect(drive.arquivos.size).toBe(quantos);
    expect(propriedades).toEqual(props);
  });

  it('sem arquivo ainda, diz que ele não existe', () => {
    const { globais, registros } = carregar();
    (globais as unknown as { diagnosticarDrive(): void }).diagnosticarDrive();
    expect(registros.join('\n')).toMatch(/ainda não existe/);
  });
});
