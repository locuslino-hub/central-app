// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { beforeAll, describe, expect, it } from 'vitest';
import { agendasDoDono } from '../apoio/calendario';
import { gmailFalso, naoLida, respostaDoDono } from '../apoio/gmail';
import { tarefasGoogleFalso } from '../apoio/tarefas-google';

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

/** Drive avançado (v3) na memória, só com o que o script usa. */
function driveFalso() {
  const arquivos = new Map<string, ArquivoNoDrive>();
  const listas: string[] = [];
  let proximo = 0;
  let atualizacoes = 0;
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
      if (opcoes?.alt !== 'media') {
        return { id, name: arquivo.name, trashed: arquivo.trashed, size: String(arquivo.conteudo.length), mimeType: arquivo.mimeType };
      }
      // Como o Drive real (issue 149104685): alt=media no serviço avançado lança.
      const erro = new Error(`Response Code: 200. Message: ${arquivo.conteudo}`);
      erro.name = 'HttpResponseException';
      throw erro;
    },
    update(recurso: { trashed?: boolean }, id: string, midia?: BlobFalso): unknown {
      const arquivo = arquivos.get(id);
      if (!arquivo) throw new Error('File not found');
      if (recurso.trashed !== undefined) arquivo.trashed = recurso.trashed;
      if (midia) {
        atualizacoes += 1;
        arquivo.conteudo = midia.getDataAsString();
      }
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
    get atualizacoes() {
      return atualizacoes;
    },
  };
}

const TOKEN_FICTICIO = 'token-ficticio-ya29-0123456789abcdefghijklmnopqrstuvwxyz';

interface ChamadaDeRede {
  url: string;
  params: { method?: string; muteHttpExceptions?: boolean; followRedirects?: boolean; headers?: Record<string, string> };
  charset?: string;
}

/** API REST do Drive (GET files/{id}?alt=media) por UrlFetchApp, sobre o mesmo Drive falso. */
function redeFalsa(drive: ReturnType<typeof driveFalso>) {
  const rede = {
    chamadas: [] as ChamadaDeRede[],
    tokens: 0,
    status: 200,
    corpoDoErro: '',
    falharCom: '',
    /** O Drive responde 302: se o script seguir o redirecionamento, recebe 200 de outro lugar. */
    redirecionar: false,
    ScriptApp: {
      getOAuthToken() {
        rede.tokens += 1;
        return TOKEN_FICTICIO;
      },
    },
    UrlFetchApp: {
      fetch(url: string, params: ChamadaDeRede['params']) {
        const chamada: ChamadaDeRede = { url, params };
        rede.chamadas.push(chamada);
        if (rede.falharCom) throw new Error(rede.falharCom);
        if (rede.redirecionar) {
          const seguiu = params?.followRedirects !== false;
          return {
            getResponseCode: () => (seguiu ? 200 : 302),
            getContentText: () => (seguiu ? '{"versao":1,"ultimo":0,"registros":[]}' : ''),
          };
        }
        const casado = /^https:\/\/www\.googleapis\.com\/drive\/v3\/files\/([^?]+)\?alt=media$/.exec(url);
        const autorizado = params?.headers?.Authorization === `Bearer ${TOKEN_FICTICIO}`;
        const arquivo = casado ? drive.arquivos.get(decodeURIComponent(casado[1])) : undefined;
        const status = rede.status !== 200 ? rede.status : !autorizado ? 401 : !arquivo ? 404 : 200;
        return {
          getResponseCode: () => status,
          getContentText(charset?: string) {
            chamada.charset = charset;
            return status === 200 ? arquivo!.conteudo : rede.corpoDoErro;
          },
        };
      },
    },
  };
  return rede;
}

/** Gatilhos do projeto (ScriptApp): só o que o script usa para o gatilho de 30 min. */
function gatilhosFalsos() {
  type Gatilho = { getHandlerFunction(): string; getUniqueId(): string; minutos: number };
  const gatilhos = {
    lista: [] as Gatilho[],
    apagados: [] as string[],
    servico: {
      getProjectTriggers: () => [...gatilhos.lista],
      newTrigger(funcao: string) {
        return {
          timeBased: () => ({
            everyMinutes: (minutos: number) => ({
              create() {
                const id = `gatilho-${gatilhos.lista.length + gatilhos.apagados.length + 1}`;
                const novo = { getHandlerFunction: () => funcao, getUniqueId: () => id, minutos };
                gatilhos.lista.push(novo);
                return novo;
              },
            }),
          }),
        };
      },
      deleteTrigger(gatilho: Gatilho) {
        gatilhos.apagados.push(gatilho.getUniqueId());
        gatilhos.lista = gatilhos.lista.filter((g) => g.getUniqueId() !== gatilho.getUniqueId());
      },
    },
  };
  return gatilhos;
}

/** Roda o pacote como o Apps Script roda: sem módulos, serviços como globais. */
function carregar({
  semAgenda = false,
  semGmail = false,
  semTarefas = false,
}: { semAgenda?: boolean; semGmail?: boolean; semTarefas?: boolean } = {}) {
  const propriedades = new Map<string, string>();
  const leituras = new Map<string, number>();
  const registros: string[] = [];
  const erros: string[] = [];
  const drive = driveFalso();
  const rede = redeFalsa(drive);
  const cache = {
    valores: new Map<string, string>(),
    quebrado: false,
    putQuebrado: false,
    prazos: [] as number[],
    prazoPorChave: new Map<string, number>(),
  };
  const cacheDoScript = () => {
    if (cache.quebrado) throw new Error('CacheService fora do ar');
    return {
      get: (chave: string) => cache.valores.get(chave) ?? null,
      put: (chave: string, valor: string, segundos?: number) => {
        if (cache.putQuebrado) throw new Error('Cache cheio');
        cache.prazos.push(segundos ?? -1);
        cache.prazoPorChave.set(chave, segundos ?? -1);
        cache.valores.set(chave, valor);
      },
      remove: (chave: string) => void cache.valores.delete(chave),
    };
  };
  const trava = { livre: true, presa: false, esperas: [] as number[] };
  let uuids = 0;
  const calendario = agendasDoDono();
  const gmail = gmailFalso();
  const tarefasGoogle = tarefasGoogleFalso();
  const gatilhos = gatilhosFalsos();
  const contexto = vm.createContext({
    Drive: drive.servico,
    // Serviço avançado desligado: o global nem existe.
    ...(semAgenda ? {} : { Calendar: calendario.servico }),
    ...(semGmail ? {} : { Gmail: gmail.servico }),
    ...(semTarefas ? {} : { Tasks: tarefasGoogle.servico }),
    UrlFetchApp: rede.UrlFetchApp,
    ScriptApp: { ...rede.ScriptApp, ...gatilhos.servico },
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
  return { globais, propriedades, leituras, registros, erros, postar, drive, rede, trava, cache, calendario, gmail, tarefasGoogle, gatilhos };
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

  it('declara os escopos explicitamente: Drive do próprio script, chamada externa (R24), Google Agenda mínimo (T10) e Gmail só leitura (T13)', () => {
    expect(manifesto().oauthScopes).toEqual([
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/script.external_request',
      // Lista de agendas, só leitura (calendarList.list).
      'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
      // Criar, trocar sala e apagar só em agendas do próprio dono (events.insert/patch/delete).
      'https://www.googleapis.com/auth/calendar.events.owned',
      // Ler eventos de todas as agendas, inclusive assinadas (events.list/get).
      'https://www.googleapis.com/auth/calendar.events.readonly',
      // Gmail: só ler (R11). Nunca modify, send, compose nem o escopo total.
      'https://www.googleapis.com/auth/gmail.readonly',
      // Instalar o gatilho de 30 min dos e-mails (ScriptApp.newTrigger) e evitar duplicados.
      'https://www.googleapis.com/auth/script.scriptapp',
      // Google Tarefas: o espelho das tarefas na lista "Central" (spec do feito espelhado).
      'https://www.googleapis.com/auth/tasks',
    ]);
  });

  it('nenhum escopo do Gmail além da leitura', () => {
    const escopos = manifesto().oauthScopes as string[];
    expect(escopos).not.toContain('https://mail.google.com/');
    expect(escopos.filter((e) => /gmail|mail\.google/.test(e))).toEqual(['https://www.googleapis.com/auth/gmail.readonly']);
  });

  it('nenhum escopo largo do Google Agenda nem do Drive', () => {
    const escopos = manifesto().oauthScopes as string[];
    for (const largo of ['calendar', 'calendar.events', 'calendar.readonly', 'drive', 'drive.readonly']) {
      expect(escopos).not.toContain(`https://www.googleapis.com/auth/${largo}`);
    }
  });

  it('liga os serviços avançados do Drive e do Google Agenda na v3, e do Gmail na v1', () => {
    expect(manifesto().dependencies).toEqual({
      enabledAdvancedServices: [
        { userSymbol: 'Drive', serviceId: 'drive', version: 'v3' },
        { userSymbol: 'Calendar', serviceId: 'calendar', version: 'v3' },
        { userSymbol: 'Gmail', serviceId: 'gmail', version: 'v1' },
        { userSymbol: 'Tasks', serviceId: 'tasks', version: 'v1' },
      ],
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
// no serviço avançado, Files.get(id, {alt: 'media'}) LANÇA HttpResponseException.
// Por isso a leitura vai pela API REST do Drive, com UrlFetchApp (R24).
const ENDPOINT = 'https://www.googleapis.com/drive/v3/files/';

describe('R24: leitura pela API do Drive', () => {
  it('as únicas URLs no pacote são o endpoint de arquivos do Drive e o link do Gmail na web (que nunca é chamado)', () => {
    const urls = new Set(pacote.match(/https?:\/\/[^\s'"`)]+/g) ?? []);
    expect([...urls].sort()).toEqual(['https://mail.google.com/mail/u/0/#all/', ENDPOINT]);
  });

  it('puxar lê o conteúdo por GET no endpoint, com o token, alt=media e muteHttpExceptions', () => {
    const { pedir, rede } = conectado();
    pedir('enviar', { mudancas: [tarefa('t1', 'Ler com Marina')] });

    expect(pedir('puxar', { desde: 0 }).dados.registros).toEqual([tarefa('t1', 'Ler com Marina')]);
    const ultima = rede.chamadas.at(-1)!;
    expect(ultima.url).toBe(`${ENDPOINT}arquivo-1?alt=media`);
    expect(ultima.params).toMatchObject({
      method: 'get',
      muteHttpExceptions: true,
      headers: { Authorization: `Bearer ${TOKEN_FICTICIO}` },
    });
    expect(ultima.charset).toBe('UTF-8');
  });

  it('o id vai codificado na URL', () => {
    const { pedir, rede, drive, propriedades } = conectado();
    pedir('enviar', { mudancas: [tarefa('t1', 'a')] });
    const original = drive.arquivos.get('arquivo-1')!;
    drive.arquivos.set('a b/c?d', { ...original, id: 'a b/c?d' });
    propriedades.set('ID_DO_ARQUIVO_DE_DADOS', 'a b/c?d');

    expect(pedir('puxar', { desde: 0 }).ok).toBe(true);
    expect(rede.chamadas.at(-1)!.url).toBe(`${ENDPOINT}a%20b%2Fc%3Fd?alt=media`);
  });

  it('acentos voltam iguais', () => {
    const { pedir } = conectado();
    pedir('enviar', { mudancas: [tarefa('t1', 'Orientações às 15h')] });
    expect(pedir('puxar', { desde: 0 }).dados.registros[0].registro.titulo).toBe('Orientações às 15h');
  });

  it('todas as chamadas de rede vão só ao endpoint, e só para ler', () => {
    const { pedir, rede } = conectado();
    pedir('enviar', { mudancas: [tarefa('t1', 'a')] });
    pedir('enviar', { mudancas: [tarefa('t2', 'b')] });
    pedir('puxar', { desde: 0 });
    expect(rede.chamadas.length).toBeGreaterThan(0);
    for (const { url, params } of rede.chamadas) {
      expect(url.startsWith(ENDPOINT)).toBe(true);
      expect(url.endsWith('?alt=media')).toBe(true);
      expect(params.method).toBe('get');
    }
  });

  it('gravações continuam no serviço avançado', () => {
    const { pedir, drive, rede } = conectado();
    pedir('enviar', { mudancas: [tarefa('t1', 'a')] });
    pedir('enviar', { mudancas: [tarefa('t2', 'b')] });
    expect(drive.atualizacoes).toBeGreaterThan(0);
    expect(JSON.parse(drive.arquivos.get('arquivo-1')!.conteudo).registros).toHaveLength(2);
    expect(rede.chamadas.every((c) => c.params.method === 'get')).toBe(true);
  });

  it.each([403, 404, 500, 302])('HTTP %i dá interno, sem gravar, e o registro não leva token, URL, id nem corpo', (status) => {
    const { pedir, rede, erros, drive } = conectado();
    pedir('enviar', { mudancas: [tarefa('t1', 'Segredo da Marina')] });
    const antes = drive.arquivos.get('arquivo-1')!.conteudo;
    rede.status = status;
    rede.corpoDoErro = `{"error":{"message":"Segredo da Marina arquivo-1 ${TOKEN_FICTICIO}"}}`;

    expect(pedir('puxar', { desde: 0 })).toEqual({ ok: false, erro: 'interno' });
    expect(pedir('enviar', { mudancas: [tarefa('t2', 'b')] })).toEqual({ ok: false, erro: 'interno' });
    expect(drive.arquivos.get('arquivo-1')!.conteudo).toBe(antes);
    const registrado = erros.join('\n');
    expect(registrado).toContain(`HTTP ${status}`);
    for (const proibido of [TOKEN_FICTICIO, ENDPOINT, 'arquivo-1', 'Segredo']) {
      expect(registrado).not.toContain(proibido);
    }
  });

  it('falha de rede dá interno, e a mensagem original (com URL e token) não vai ao registro', () => {
    const { pedir, rede, erros } = conectado();
    pedir('enviar', { mudancas: [tarefa('t1', 'a')] });
    rede.falharCom = `Address unavailable: ${ENDPOINT}arquivo-1?alt=media Bearer ${TOKEN_FICTICIO}`;

    expect(pedir('puxar', { desde: 0 })).toEqual({ ok: false, erro: 'interno' });
    const registrado = erros.join('\n');
    expect(registrado).toMatch(/Leitura do Drive falhou na rede/);
    for (const proibido of [TOKEN_FICTICIO, ENDPOINT, 'arquivo-1']) expect(registrado).not.toContain(proibido);
  });

  it('o serviço avançado com alt=media nunca é usado para ler', () => {
    const { pedir } = conectado();
    pedir('enviar', { mudancas: [tarefa('t1', 'a')] });
    // O falso do Drive lança como o real em alt=media: se fosse usado, puxar daria interno.
    expect(pedir('puxar', { desde: 0 }).ok).toBe(true);
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

describe('R24: autorizarDrive usa os dois escopos', () => {
  it('com o arquivo criado, lê pela API uma vez e registra só o tamanho', () => {
    const { pedir, globais, registros, rede, drive } = conectado();
    pedir('enviar', { mudancas: [tarefa('t1', 'Segredo da Marina')] });
    const antes = rede.chamadas.length;
    (globais as unknown as { autorizarDrive(): void }).autorizarDrive();

    expect(rede.chamadas.length).toBe(antes + 1);
    const mensagem = registros.at(-1)!;
    expect(mensagem).toMatch(/Permissão do Drive aprovada/);
    expect(mensagem).toContain(`${drive.arquivos.get('arquivo-1')!.conteudo.length} caracteres`);
    for (const proibido of ['Segredo', 'arquivo-1', TOKEN_FICTICIO, ENDPOINT]) expect(mensagem).not.toContain(proibido);
  });

  it('sem arquivo, pede o token (os dois escopos) e não chama a rede', () => {
    const { globais, registros, rede } = carregar();
    (globais as unknown as { autorizarDrive(): void }).autorizarDrive();
    expect(rede.tokens).toBeGreaterThan(0);
    expect(rede.chamadas).toEqual([]);
    expect(registros.at(-1)).toMatch(/Permissão do Drive aprovada/);
  });

  it('leitura recusada aparece no registro, sem token nem id', () => {
    const { pedir, globais, registros, rede } = conectado();
    pedir('enviar', { mudancas: [tarefa('t1', 'a')] });
    rede.status = 403;
    (globais as unknown as { autorizarDrive(): void }).autorizarDrive();
    const mensagem = registros.at(-1)!;
    expect(mensagem).toMatch(/HTTP 403/);
    for (const proibido of ['arquivo-1', TOKEN_FICTICIO]) expect(mensagem).not.toContain(proibido);
  });
});

describe('diagnosticarDrive (leitura pela API)', () => {
  function preparado() {
    const carregado = conectado();
    carregado.pedir('enviar', { mudancas: [tarefa('t1', 'Segredo da Marina')] });
    const principal = carregado.drive.arquivos.get('arquivo-1')!;
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

  it('registra tamanho e se o JSON abre, sem conteúdo, id nem token', () => {
    const { principal, diagnosticar } = preparado();
    const relatorio = diagnosticar();
    expect(relatorio).toContain(`Leitura pela API do Drive: ok, ${principal.conteudo.length} caracteres, JSON.parse: ok`);
    for (const proibido of ['Segredo', 'arquivo-1', TOKEN_FICTICIO, ENDPOINT]) expect(relatorio).not.toContain(proibido);
  });

  it('leitura recusada mostra o status HTTP', () => {
    const { rede, diagnosticar } = preparado();
    rede.status = 404;
    expect(diagnosticar()).toMatch(/Leitura pela API do Drive: falhou \(Error: Leitura do Drive respondeu HTTP 404\)/);
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

describe('revisão: redirecionamento e busca sem gravar o id', () => {
  it('a leitura pede followRedirects: false', () => {
    const { pedir, rede } = conectado();
    pedir('enviar', { mudancas: [tarefa('t1', 'a')] });
    pedir('puxar', { desde: 0 });
    expect(rede.chamadas.at(-1)!.params.followRedirects).toBe(false);
  });

  it('redirecionamento do Drive vira interno (HTTP 302), sem seguir para outro lugar', () => {
    const { pedir, rede, erros } = conectado();
    pedir('enviar', { mudancas: [tarefa('t1', 'a')] });
    rede.redirecionar = true;
    expect(pedir('puxar', { desde: 0 })).toEqual({ ok: false, erro: 'interno' });
    expect(erros.join('\n')).toContain('HTTP 302');
  });

  it.each(['autorizarDrive', 'diagnosticarDrive'] as const)(
    '%s acha o arquivo pelo nome sem gravar o id nas propriedades',
    (funcao) => {
      const { pedir, globais, propriedades, registros } = conectado();
      pedir('enviar', { mudancas: [tarefa('t1', 'a')] });
      propriedades.delete('ID_DO_ARQUIVO_DE_DADOS');

      (globais as unknown as Record<string, () => void>)[funcao]();

      expect(propriedades.has('ID_DO_ARQUIVO_DE_DADOS')).toBe(false);
      expect(registros.join('\n')).toMatch(/já existe|Leitura pela API do Drive: ok/);
    },
  );

  it('a sincronia continua guardando o id achado pelo nome', () => {
    const { pedir, propriedades } = conectado();
    pedir('enviar', { mudancas: [tarefa('t1', 'a')] });
    propriedades.delete('ID_DO_ARQUIVO_DE_DADOS');
    pedir('puxar', { desde: 0 });
    expect(propriedades.get('ID_DO_ARQUIVO_DE_DADOS')).toBe('arquivo-1');
  });
});

describe('Tarefa 10: Google Agenda pelo pacote', () => {
  const reuniao = (data: string) => ({ titulo: 'Reunião com Prof. Souza', data, inicio: '11:00', fim: '12:00', salaId: 'sala-aulas' });

  it.each([
    ['2026-10-23', '+01:00'],
    ['2026-10-26', '+00:00'],
  ])('evento criado às 11:00 de %s volta às 11:00 pelo doPost', (data, fuso) => {
    const { pedir } = conectado();
    const criado = pedir('criarEvento', reuniao(data));
    expect(criado).toMatchObject({ ok: true, dados: { inicio: `${data}T11:00:00${fuso}`, salaId: 'sala-aulas', agendaId: 'primary' } });
    expect(pedir('eventos', { de: data, ate: data }).dados).toEqual({ eventos: [criado.dados], incompleto: false });
  });

  it('desfazer remove pelo doPost, sem notificar ninguém', () => {
    const { pedir, calendario } = conectado();
    const { dados } = pedir('criarEvento', reuniao('2026-10-23'));
    expect(pedir('removerEvento', { id: dados.id })).toEqual({ ok: true, dados: { removido: true } });
    expect(pedir('eventos', { de: '2026-10-23', ate: '2026-10-23' }).dados).toEqual({ eventos: [], incompleto: false });
    expect(calendario.notificacoes).toEqual([]);
    const gravacoes = calendario.chamadas.filter((c) => /insert|patch|remove/.test(c.metodo));
    expect(gravacoes.length).toBe(2);
    for (const { args } of gravacoes) expect(args.at(-1)).toEqual({ sendUpdates: 'none' });
  });

  it('criarEvento repetido com o mesmo id pelo doPost devolve o mesmo evento, sem duplicar', () => {
    const { pedir } = conectado();
    const comId = { ...reuniao('2026-10-23'), id: '0123456789abcdef0123456789abcdef' };
    const primeiro = pedir('criarEvento', comId);
    expect(pedir('criarEvento', comId)).toEqual(primeiro);
    expect(pedir('eventos', { de: '2026-10-23', ate: '2026-10-23' }).dados.eventos).toHaveLength(1);
  });

  it('trocar a sala pelo doPost', () => {
    const { pedir } = conectado();
    const { dados } = pedir('criarEvento', reuniao('2026-10-23'));
    expect(pedir('trocarSalaEvento', { id: dados.id, salaId: 'sala-casa' })).toMatchObject({ ok: true, dados: { salaId: 'sala-casa' } });
  });

  it('serviço avançado do Google Agenda desligado: interno, sem quebrar o resto', () => {
    const carregado = carregar({ semAgenda: true });
    carregado.globais.gerarCodigo();
    const codigo = carregado.propriedades.get('CODIGO_DO_APARELHO')!;
    const pedir = (acao: string, dados: unknown) =>
      carregado.postar(JSON.stringify({ codigo, acao, dados })).resposta as RespostaDoPacote;
    expect(pedir('eventos', { de: '2026-10-23', ate: '2026-10-23' })).toEqual({ ok: false, erro: 'interno' });
    expect(pedir('ping', {})).toEqual({ ok: true, dados: {} });
  });

  it('pedido inválido não chama o Google Agenda', () => {
    const { pedir, calendario } = conectado();
    expect(pedir('criarEvento', { ...reuniao('2026-10-23'), salaId: 'sala-x' })).toEqual({ ok: false, erro: 'interno' });
    expect(calendario.chamadas).toEqual([]);
  });
});

describe('Tarefa 10: autorizarDrive também prova o Google Agenda', () => {
  it('lê a lista de agendas e os eventos de hoje, registra só a contagem e não grava nada', () => {
    const { globais, registros, calendario } = carregar();
    (globais as unknown as { autorizarDrive(): void }).autorizarDrive();

    expect(calendario.de('CalendarList.list').length).toBeGreaterThan(0);
    expect(calendario.de('Events.list').length).toBeGreaterThan(0);
    expect(calendario.chamadas.filter((c) => /insert|patch|remove/.test(c.metodo))).toEqual([]);
    const mensagem = registros.at(-1)!;
    expect(mensagem).toMatch(/Permissão do Drive aprovada/);
    expect(mensagem).toMatch(/Permissão do Google Agenda aprovada: 3 agendas/);
    for (const proibido of ['marina', 'Aurora', 'Feriados', 'example.com']) expect(mensagem).not.toContain(proibido);
  });

  it('faz a mesma leitura da ação eventos (mesmos campos e opções), para o passo do dono provar o pedido real', () => {
    const { globais, calendario, pedir } = conectado();
    pedir('eventos', { de: '2026-10-23', ate: '2026-10-23' });
    const doApp = calendario.de('Events.list').at(-1)!.args[1] as Record<string, unknown>;
    (globais as unknown as { autorizarDrive(): void }).autorizarDrive();
    const doEditor = calendario.de('Events.list').at(-1)!.args[1] as Record<string, unknown>;
    const { timeMin: _a, timeMax: _b, ...opcoesDoApp } = doApp;
    const { timeMin: _c, timeMax: _d, ...opcoesDoEditor } = doEditor;
    expect(opcoesDoEditor).toEqual(opcoesDoApp);
  });

  it('Google Agenda recusado aparece no registro, sem e-mail, e o Drive continua relatado', () => {
    const { globais, registros, calendario } = carregar();
    calendario.servico.CalendarList.list = () => {
      throw new Error(
        'API call to calendar.calendarList.list failed with error: Request had insufficient authentication scopes. marina.ficticia@example.com',
      );
    };
    (globais as unknown as { autorizarDrive(): void }).autorizarDrive();
    const mensagem = registros.at(-1)!;
    expect(mensagem).toMatch(/Permissão do Drive aprovada/);
    expect(mensagem).toMatch(/Google Agenda falhou/);
    expect(mensagem).not.toContain('marina');
  });

  it('sem o serviço avançado, o registro diz que o Google Agenda falhou', () => {
    const { globais, registros } = carregar({ semAgenda: true });
    (globais as unknown as { autorizarDrive(): void }).autorizarDrive();
    expect(registros.at(-1)).toMatch(/Google Agenda falhou/);
  });
});

describe('feito espelhado: Google Tarefas pelo pacote', () => {
  it('autorizarDrive lê as listas do Google Tarefas, registra só a contagem e não cria nada', () => {
    const { globais, registros, tarefasGoogle } = carregar();
    tarefasGoogle.lista('Minhas tarefas');
    (globais as unknown as { autorizarDrive(): void }).autorizarDrive();
    expect(tarefasGoogle.de('Tasklists.list').length).toBeGreaterThan(0);
    expect(tarefasGoogle.chamadas.filter((c) => /insert|patch|remove/.test(c.metodo))).toEqual([]);
    const mensagem = registros.at(-1)!;
    expect(mensagem).toMatch(/Permissão do Google Tarefas aprovada: 1 lista; a lista Central será criada/);
    expect(mensagem).not.toContain('Minhas tarefas');
  });

  it('sem o serviço avançado, o registro diz que o Google Tarefas falhou, e o resto segue relatado', () => {
    const { globais, registros } = carregar({ semTarefas: true });
    (globais as unknown as { autorizarDrive(): void }).autorizarDrive();
    expect(registros.at(-1)).toMatch(/Permissão do Drive aprovada/);
    expect(registros.at(-1)).toMatch(/Google Tarefas falhou/);
  });

  it('espelharTarefas pelo doPost cria a lista Central e a tarefa', () => {
    const { pedir, tarefasGoogle } = conectado();
    const resposta = pedir('espelharTarefas', {
      tarefas: [{ id: 'tarefa-1', titulo: 'Ligar para a Renata', data: '2026-11-09', feito: false, apagado: false }],
    });
    expect(resposta).toEqual({ ok: true, dados: { resultados: [{ id: 'tarefa-1', ok: true, googleId: expect.any(String) }] } });
    expect(tarefasGoogle.vivas().map((t) => t.title)).toEqual(['Ligar para a Renata']);
  });

  it('marcarEventoFeito pelo doPost grava o "✓ " no Google Agenda', () => {
    const { pedir, calendario } = conectado();
    calendario.evento('marina.ficticia@example.com', {
      id: 'meu1',
      summary: 'Café com Aurora',
      inicio: '2026-10-23T11:00:00+01:00',
      fim: '2026-10-23T12:00:00+01:00',
    });
    expect(pedir('marcarEventoFeito', { id: 'meu1', feito: true })).toEqual({ ok: true, dados: { feito: true, gravado: true } });
    expect(calendario.agendas.get('marina.ficticia@example.com')!.eventos.get('meu1')!.summary).toBe('✓ Café com Aurora');
  });
});

describe('Tarefa 13: Gmail pelo pacote', () => {
  type ComGmail = { autorizarGmail(): void; atualizarEmails(evento?: unknown): void };
  const funcoes = (globais: unknown) => globais as ComGmail;
  const CHAVE = 'EMAILS_POR_RESPONDER';

  it('atualizarEmails e autorizarGmail são funções globais no topo do arquivo', () => {
    expect(pacote).toMatch(/^function atualizarEmails\(/m);
    expect(pacote).toMatch(/^function autorizarGmail\(/m);
    const { globais } = carregar();
    expect(typeof funcoes(globais).atualizarEmails).toBe('function');
    expect(typeof funcoes(globais).autorizarGmail).toBe('function');
  });

  it('a ação emails devolve os não lidos pelo doPost, sem mexer no Gmail', () => {
    const { pedir, gmail } = conectado();
    const m = naoLida({ de: 'Prof. Souza <souza@exemplo.invalid>' });
    gmail.mensagens.push(m);
    const resposta = pedir('emails', {});
    expect(resposta).toMatchObject({ ok: true, dados: [{ id: m.id, remetente: 'Prof. Souza' }] });
    expect(Object.keys(resposta.dados[0]).sort()).toEqual([
      'assunto',
      'data',
      'enderecoRemetente',
      'id',
      'link',
      'remetente',
      'trecho',
    ]);
    expect(gmail.proibidas).toEqual([]);
  });

  it('o gatilho grava a lista no cache do script por 6 h, e a ação emails lê de lá sem chamar o Gmail', () => {
    const { globais, pedir, gmail, cache } = conectado();
    const m = naoLida();
    gmail.mensagens.push(m);
    // O Apps Script passa um evento ao gatilho: é ignorado.
    funcoes(globais).atualizarEmails({ triggerUid: 'x' });
    expect(JSON.parse(cache.valores.get(CHAVE)!)).toHaveLength(1);
    expect(cache.prazoPorChave.get(CHAVE)).toBe(21_600);

    gmail.chamadas.length = 0;
    expect(pedir('emails', {}).dados.map((e: { id: string }) => e.id)).toEqual([m.id]);
    expect(gmail.chamadas).toEqual([]);
  });

  it('o gatilho registra o tempo gasto e a contagem, sem nada do e-mail', () => {
    const { globais, gmail, registros, erros } = conectado();
    gmail.mensagens.push(
      naoLida({ de: 'Renata <renata@exemplo.invalid>', assunto: 'Assunto da Renata', snippet: 'Texto da Renata' }),
    );
    funcoes(globais).atualizarEmails();
    const linha = registros.at(-1)!;
    expect(linha).toMatch(/^Central: e-mails atualizados em \d+ ms: 1 e-mail por responder\.$/);
    expect([...registros, ...erros].join('\n')).not.toMatch(/Renata|renata|exemplo\.invalid/);
  });

  it('item respondido pelo dono some na rodada seguinte do gatilho', () => {
    const { globais, pedir, gmail } = conectado();
    const m = naoLida();
    gmail.mensagens.push(m);
    funcoes(globais).atualizarEmails();
    expect(pedir('emails', {}).dados).toHaveLength(1);
    gmail.mensagens.push(respostaDoDono(m.threadId, Number(m.internalDate) + 60_000));
    funcoes(globais).atualizarEmails();
    expect(pedir('emails', {}).dados).toEqual([]);
  });

  it('atualizarEmails pelo doPost lê o Gmail de novo (botão Atualizar agora)', () => {
    const { pedir, gmail, cache } = conectado();
    expect(pedir('emails', {}).dados).toEqual([]);
    gmail.mensagens.push(naoLida());
    // A leitura feita por `emails` conta para o limite de 60 s: passado o limite, lê de novo.
    cache.valores.set('EMAILS_ATUALIZADOS_EM', String(Date.now() - 61_000));
    expect(pedir('atualizarEmails', {}).dados).toHaveLength(1);
  });

  it('gatilho com o Gmail fora do ar: falha com mensagem limpa e a lista anterior fica', () => {
    const { globais, gmail, cache, erros } = conectado();
    gmail.mensagens.push(naoLida());
    funcoes(globais).atualizarEmails();
    const antes = cache.valores.get(CHAVE);
    gmail.estado.falharLista =
      'API call to gmail.users.messages.list failed with error: Backend Error marina@exemplo.invalid';
    expect(() => funcoes(globais).atualizarEmails()).toThrow(/^Gmail \(messages\.list\): Backend Error$/);
    expect(cache.valores.get(CHAVE)).toBe(antes);
    expect(erros.join('\n')).not.toContain('marina');
  });

  it('sem o serviço avançado do Gmail, as ações de e-mail dão interno e o resto segue', () => {
    const carregado = carregar({ semGmail: true });
    carregado.globais.gerarCodigo();
    const codigo = carregado.propriedades.get('CODIGO_DO_APARELHO')!;
    const pedir = (acao: string) =>
      carregado.postar(JSON.stringify({ codigo, acao, dados: {} })).resposta as RespostaDoPacote;
    expect(pedir('emails')).toEqual({ ok: false, erro: 'interno' });
    expect(pedir('ping')).toEqual({ ok: true, dados: {} });
  });

  it('cache fora do ar: a ação emails lê o Gmail na hora', () => {
    const { pedir, gmail, cache } = conectado();
    pedir('ping', {});
    cache.quebrado = true;
    gmail.mensagens.push(naoLida());
    expect(pedir('emails', {}).dados).toHaveLength(1);
  });
});

describe('Tarefa 13: autorizarGmail (passo do dono)', () => {
  type ComGmail = { autorizarGmail(): void };
  const autorizar = (globais: unknown) => (globais as ComGmail).autorizarGmail();

  it('lê o Gmail, registra só a contagem e instala um gatilho de 30 min em atualizarEmails', () => {
    const { globais, gmail, gatilhos, registros } = carregar();
    gmail.mensagens.push(
      naoLida({ de: 'Marina <marina@exemplo.invalid>', assunto: 'Assunto da Marina' }),
      naoLida({ de: 'Aurora <aurora@exemplo.invalid>', snippet: 'Trecho da Aurora' }),
    );
    autorizar(globais);
    const mensagem = registros.at(-1)!;
    expect(mensagem).toMatch(/Permissão do Gmail aprovada: 2 e-mails por responder\./);
    expect(mensagem).toMatch(/Leitura levou \d+ ms/);
    expect(mensagem).toMatch(/Atualização automática a cada 30 minutos: ligada\./);
    for (const proibido of ['Marina', 'marina', 'Aurora', 'exemplo.invalid', 'Assunto', 'Trecho']) {
      expect(mensagem).not.toContain(proibido);
    }
    expect(gatilhos.lista.map((g) => [g.getHandlerFunction(), g.minutos])).toEqual([['atualizarEmails', 30]]);
    expect(gmail.proibidas).toEqual([]);
  });

  it('singular certo com 1 e-mail', () => {
    const { globais, gmail, registros } = carregar();
    gmail.mensagens.push(naoLida());
    autorizar(globais);
    expect(registros.at(-1)).toMatch(/Permissão do Gmail aprovada: 1 e-mail por responder\./);
  });

  it('rodar de novo não duplica o gatilho e limpa duplicados antigos', () => {
    const { globais, gatilhos, registros } = carregar();
    autorizar(globais);
    expect(registros.at(-1)).toMatch(/: ligada\./);
    autorizar(globais);
    expect(registros.at(-1)).toMatch(/já estava ligada\./);
    expect(gatilhos.lista).toHaveLength(1);
    // Duplicado criado à mão no editor: sai, fica um só.
    gatilhos.servico.newTrigger('atualizarEmails').timeBased().everyMinutes(30).create();
    autorizar(globais);
    expect(gatilhos.lista).toHaveLength(1);
    expect(gatilhos.apagados).toHaveLength(1);
  });

  it('não mexe em gatilhos de outras funções', () => {
    const { globais, gatilhos } = carregar();
    gatilhos.servico.newTrigger('outraCoisa').timeBased().everyMinutes(5).create();
    autorizar(globais);
    expect(gatilhos.lista.map((g) => g.getHandlerFunction()).sort()).toEqual(['atualizarEmails', 'outraCoisa']);
    expect(gatilhos.apagados).toEqual([]);
  });

  it('Gmail recusado: registro limpo, pede para rodar de novo e não instala o gatilho', () => {
    const { globais, gmail, gatilhos, registros } = carregar();
    gmail.estado.falharLista =
      'API call to gmail.users.messages.list failed with error: Request had insufficient authentication scopes. marina@exemplo.invalid';
    autorizar(globais);
    const mensagem = registros.at(-1)!;
    expect(mensagem).toMatch(/Gmail falhou \(.*insufficient authentication scopes.*\)\. Rode autorizarGmail de novo/);
    expect(mensagem).not.toContain('marina');
    expect(gatilhos.lista).toEqual([]);
  });

  it('não grava nada no Drive nem troca o código do aparelho', () => {
    const { globais, drive, propriedades } = carregar();
    globais.gerarCodigo();
    const antes = new Map(propriedades);
    autorizar(globais);
    expect(drive.arquivos.size).toBe(0);
    expect(propriedades).toEqual(antes);
  });
});

describe('rodada 1 da T13: limite e limpeza do cache pelo pacote', () => {
  const CHAVE = 'EMAILS_POR_RESPONDER';
  const CHAVE_DA_HORA = 'EMAILS_ATUALIZADOS_EM';
  type ComGmail = { atualizarEmails(): void };

  it('dois atualizarEmails seguidos pelo doPost leem o Gmail uma vez; a hora fica no cache por 6 h', () => {
    const { pedir, gmail, cache } = conectado();
    gmail.mensagens.push(naoLida());
    const primeira = pedir('atualizarEmails', {});
    expect(pedir('atualizarEmails', {})).toEqual(primeira);
    expect(gmail.de('Messages.list')).toHaveLength(1);
    expect(cache.valores.get(CHAVE_DA_HORA)).toMatch(/^\d+$/);
    expect(cache.prazoPorChave.get(CHAVE_DA_HORA)).toBe(21_600);
  });

  it('o gatilho não tem limite: sempre lê o Gmail', () => {
    const { globais, gmail } = conectado();
    gmail.mensagens.push(naoLida());
    (globais as unknown as ComGmail).atualizarEmails();
    (globais as unknown as ComGmail).atualizarEmails();
    expect(gmail.de('Messages.list')).toHaveLength(2);
  });

  it('gravação recusada pelo cache tira a lista antiga e a hora', () => {
    const { globais, gmail, cache } = conectado();
    gmail.mensagens.push(naoLida());
    (globais as unknown as ComGmail).atualizarEmails();
    expect(cache.valores.has(CHAVE)).toBe(true);
    cache.putQuebrado = true;
    (globais as unknown as ComGmail).atualizarEmails();
    expect(cache.valores.has(CHAVE)).toBe(false);
    expect(cache.valores.has(CHAVE_DA_HORA)).toBe(false);
  });
});
