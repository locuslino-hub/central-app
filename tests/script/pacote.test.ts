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
  pais?: string[];
  /** Falso = de outra pessoa (compartilhado comigo). */
  dono?: boolean;
}

const TIPO_PASTA = 'application/vnd.google-apps.folder';
/** Id que o Drive real dá à raiz do Meu Drive (nas consultas ela é "root"). */
const RAIZ_DO_DRIVE = 'id-real-da-raiz';

interface BlobFalso {
  getDataAsString(): string;
  getContentType(): string;
}

/** Drive avançado (v3) na memória, só com o que o script usa. */
function driveFalso() {
  const arquivos = new Map<string, ArquivoNoDrive>();
  const listas: string[] = [];
  const movimentos: { id: string; addParents?: string; removeParents?: string }[] = [];
  let proximo = 0;
  let atualizacoes = 0;
  const Files = {
    create(recurso: { name: string; mimeType?: string; parents?: string[] }, midia?: BlobFalso) {
      proximo += 1;
      const arquivo = {
        id: `arquivo-${proximo}`,
        name: recurso.name,
        mimeType: recurso.mimeType,
        trashed: false,
        conteudo: midia?.getDataAsString() ?? '',
        pais: (recurso.parents ?? []).map((p) => (p === 'root' ? RAIZ_DO_DRIVE : p)),
      };
      arquivos.set(arquivo.id, arquivo);
      return { id: arquivo.id, name: arquivo.name };
    },
    get(id: string, opcoes?: { alt?: string }): unknown {
      const arquivo = arquivos.get(id);
      if (!arquivo) throw new Error('File not found');
      if (opcoes?.alt !== 'media') {
        return {
          id,
          name: arquivo.name,
          trashed: arquivo.trashed,
          size: String(arquivo.conteudo.length),
          mimeType: arquivo.mimeType,
          ownedByMe: arquivo.dono !== false,
          parents: arquivo.pais?.length ? [...arquivo.pais] : [RAIZ_DO_DRIVE],
        };
      }
      // Como o Drive real (issue 149104685): alt=media no serviço avançado lança.
      const erro = new Error(`Response Code: 200. Message: ${arquivo.conteudo}`);
      erro.name = 'HttpResponseException';
      throw erro;
    },
    update(
      recurso: { trashed?: boolean },
      id: string,
      midia?: BlobFalso | null,
      opcoes?: { addParents?: string; removeParents?: string },
    ): unknown {
      const arquivo = arquivos.get(id);
      if (!arquivo) throw new Error('File not found');
      if (recurso.trashed !== undefined) arquivo.trashed = recurso.trashed;
      if (midia) {
        atualizacoes += 1;
        arquivo.conteudo = midia.getDataAsString();
      }
      if (opcoes) {
        movimentos.push({ id, ...opcoes });
        const atuais = arquivo.pais?.length ? arquivo.pais : [RAIZ_DO_DRIVE];
        const saem = new Set((opcoes.removeParents ?? '').split(',').filter(Boolean));
        arquivo.pais = [...atuais.filter((p) => !saem.has(p)), ...(opcoes.addParents ? [opcoes.addParents] : [])];
      }
      return { id };
    },
    list(opcoes: { q: string }) {
      listas.push(opcoes.q);
      const q = opcoes.q;
      const nome = /name = '([^']+)'/.exec(q)?.[1];
      const prefixo = /name contains '([^']+)'/.exec(q)?.[1];
      const pai = /'([^']+)' in parents/.exec(q)?.[1];
      const soPasta = q.includes(`mimeType = '${TIPO_PASTA}'`);
      const semPasta = q.includes(`mimeType != '${TIPO_PASTA}'`);
      const soDoDono = q.includes("'me' in owners");
      const files = [...arquivos.values()]
        .filter((a) => !a.trashed)
        .filter((a) => (nome ? a.name === nome : prefixo ? a.name.includes(prefixo) : true))
        .filter((a) => !pai || (pai === 'root' ? !a.pais?.length || a.pais.includes(RAIZ_DO_DRIVE) : !!a.pais?.includes(pai)))
        .filter((a) => !soPasta || a.mimeType === TIPO_PASTA)
        .filter((a) => !semPasta || a.mimeType !== TIPO_PASTA)
        .filter((a) => !soDoDono || a.dono !== false)
        .map((a) => ({ id: a.id, name: a.name, parents: a.pais?.length ? [...a.pais] : [RAIZ_DO_DRIVE] }));
      return { files };
    },
  };
  return {
    arquivos,
    listas,
    movimentos,
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
  camposNovos = [],
}: { semAgenda?: boolean; semGmail?: boolean; semTarefas?: boolean; camposNovos?: ('label' | 'taskId')[] } = {}) {
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
      putAll(valores: Record<string, string>, segundos?: number) {
        for (const [chave, valor] of Object.entries(valores)) this.put(chave, valor, segundos);
      },
      remove: (chave: string) => void cache.valores.delete(chave),
    };
  };
  const trava = { livre: true, presa: false, esperas: [] as number[] };
  let uuids = 0;
  const calendario = agendasDoDono({ camposNovos });
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
    // Planilhas: só a pergunta pela planilha ativa (o script não tem nenhuma).
    SpreadsheetApp: { getActiveSpreadsheet: () => null },
    Utilities: {
      base64Decode: (texto: string) => texto,
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

describe('autorizarV02', () => {
  it('é função global no topo do arquivo, para o dono rodar pelo editor', () => {
    expect(pacote).toMatch(/^function autorizarV02\(/m);
  });

  it('toca só Drive e Planilhas, registra a aprovação, cria só a pasta Central e não troca propriedades', () => {
    const { globais, propriedades, registros, drive } = carregar();
    globais.gerarCodigo();
    const antes = new Map(propriedades);
    (globais as unknown as { autorizarV02(): void }).autorizarV02();
    expect(drive.listas.length).toBeGreaterThan(0);
    expect([...drive.arquivos.values()].map((a) => [a.name, a.mimeType])).toEqual([['Central', TIPO_PASTA]]);
    expect(propriedades).toEqual(antes);
    expect(registros.at(-1)).toBe('Permissão V02 aprovada');
  });

  it('arruma os arquivos antigos (organizarPastaCentral) antes de registrar a aprovação', () => {
    const { globais, registros, drive } = carregar();
    drive.arquivos.set('dados', { id: 'dados', name: 'central-dados.json', trashed: false, conteudo: '{}' });
    (globais as unknown as { autorizarV02(): void }).autorizarV02();
    const central = [...drive.arquivos.values()].find((a) => a.name === 'Central')!;
    expect(drive.arquivos.get('dados')!.pais).toEqual([central.id]);
    expect(registros.at(-1)).toBe('Permissão V02 aprovada');
    expect(registros.some((r) => /arquivo de dados movido/.test(r))).toBe(true);
  });

  it('se a organização falha (duas pastas Central), a autorização conclui mesmo assim', () => {
    const { globais, registros, drive } = carregar();
    for (const id of ['c1', 'c2']) drive.arquivos.set(id, { id, name: 'Central', mimeType: TIPO_PASTA, trashed: false, conteudo: '' });
    expect(() => (globais as unknown as { autorizarV02(): void }).autorizarV02()).not.toThrow();
    expect(registros.at(-1)).toBe('Permissão V02 aprovada');
    expect(drive.movimentos).toEqual([]);
  });
});

describe('organizarPastaCentral', () => {
  type Editor = { organizarPastaCentral(): void };
  const raizDe = (drive: ReturnType<typeof driveFalso>) => ({
    pasta(id: string, nome: string, extra: Partial<ArquivoNoDrive> = {}) {
      drive.arquivos.set(id, { id, name: nome, mimeType: TIPO_PASTA, trashed: false, conteudo: '', ...extra });
    },
    arquivo(id: string, nome: string, extra: Partial<ArquivoNoDrive> = {}) {
      drive.arquivos.set(id, { id, name: nome, mimeType: 'application/json', trashed: false, conteudo: '{}', ...extra });
    },
  });

  it('é função global no topo do arquivo, para o dono rodar pelo editor', () => {
    expect(pacote).toMatch(/^function organizarPastaCentral\(/m);
  });

  it('move o arquivo de dados, as cópias e a Casa (partilhada) da raiz para Central, sem apagar nem mudar propriedades', () => {
    const { globais, propriedades, registros, drive } = carregar();
    const d = raizDe(drive);
    d.arquivo('dados', 'central-dados.json');
    d.arquivo('copia1', 'central-dados-2026-11-01.json');
    d.arquivo('copia2', 'central-dados-2026-11-02.json');
    d.pasta('casa', 'Casa (partilhada)');
    d.arquivo('compras', 'Compras', { mimeType: 'application/vnd.google-apps.spreadsheet', pais: ['casa'] });
    const antes = new Map(propriedades);

    (globais as unknown as Editor).organizarPastaCentral();

    const central = [...drive.arquivos.values()].find((a) => a.name === 'Central')!;
    for (const id of ['dados', 'copia1', 'copia2', 'casa']) expect(drive.arquivos.get(id)!.pais).toEqual([central.id]);
    expect(drive.arquivos.get('compras')!.pais).toEqual(['casa']);
    expect([...drive.arquivos.values()].some((a) => a.trashed)).toBe(false);
    expect(drive.arquivos.size).toBe(6);
    expect(propriedades).toEqual(antes);
    // Drive v3: sai da raiz (id real), entra em Central.
    expect(drive.movimentos[0]).toMatchObject({ addParents: central.id, removeParents: RAIZ_DO_DRIVE });
    const texto = registros.join('\n');
    expect(texto).toMatch(/2 cópias diárias movidas/);
    expect(texto).toMatch(/Casa \(partilhada\) movida/);
    expect(texto).not.toMatch(/copia1|2026-11/);
  });

  it('é idempotente: a segunda vez não move nada', () => {
    const { globais, drive } = carregar();
    const d = raizDe(drive);
    d.arquivo('dados', 'central-dados.json');
    d.pasta('casa', 'Casa (partilhada)');
    (globais as unknown as Editor).organizarPastaCentral();
    const movimentos = drive.movimentos.length;
    const fotografia = JSON.stringify([...drive.arquivos.values()]);
    (globais as unknown as Editor).organizarPastaCentral();
    expect(drive.movimentos).toHaveLength(movimentos);
    expect(JSON.stringify([...drive.arquivos.values()])).toBe(fotografia);
  });

  it('usa o id guardado do arquivo de dados, mesmo com outro de mesmo nome (de outro dono) por aí', () => {
    const { globais, propriedades, drive } = carregar();
    const d = raizDe(drive);
    d.arquivo('meu', 'central-dados.json');
    propriedades.set('ID_DO_ARQUIVO_DE_DADOS', 'meu');
    d.arquivo('alheio', 'central-dados.json', { dono: false });
    (globais as unknown as Editor).organizarPastaCentral();
    const central = [...drive.arquivos.values()].find((a) => a.name === 'Central')!;
    expect(drive.arquivos.get('meu')!.pais).toEqual([central.id]);
    expect(drive.arquivos.get('alheio')!.pais).toBeUndefined();
  });

  it('arquivo de dados de outro dono e cópias de outro dono não são tocados', () => {
    const { globais, drive } = carregar();
    const d = raizDe(drive);
    d.arquivo('dados', 'central-dados.json', { dono: false });
    d.arquivo('copia', 'central-dados-2026-11-01.json', { dono: false });
    (globais as unknown as Editor).organizarPastaCentral();
    expect(drive.movimentos).toEqual([]);
  });

  it('id guardado que aponta para arquivo de outro dono: aviso dados_de_outro_dono e nada é movido', () => {
    const { globais, propriedades, registros, drive } = carregar();
    raizDe(drive).arquivo('alheio', 'central-dados.json', { dono: false });
    propriedades.set('ID_DO_ARQUIVO_DE_DADOS', 'alheio');
    (globais as unknown as Editor).organizarPastaCentral();
    expect(registros.join('\n')).toMatch(/AVISO dados_de_outro_dono/);
    expect(drive.movimentos).toEqual([]);
  });

  it('Casa na raiz e também dentro de Central: não mexe em nenhuma e avisa', () => {
    const { globais, registros, drive } = carregar();
    const d = raizDe(drive);
    d.pasta('central', 'Central');
    d.pasta('casa-raiz', 'Casa (partilhada)');
    d.pasta('casa-dentro', 'Casa (partilhada)', { pais: ['central'] });
    (globais as unknown as Editor).organizarPastaCentral();
    expect(drive.movimentos).toEqual([]);
    expect(registros.join('\n')).toMatch(/AVISO/);
  });

  it('falha ao mover o arquivo de dados não impede mover a Casa, e nada lança', () => {
    const { globais, drive } = carregar();
    const d = raizDe(drive);
    d.arquivo('dados', 'central-dados.json');
    d.pasta('casa', 'Casa (partilhada)');
    const original = drive.servico.Files.update;
    drive.servico.Files.update = (recurso, id, midia, opcoes) => {
      if (id === 'dados') throw new Error('Drive fora do ar');
      return original(recurso, id, midia, opcoes);
    };
    expect(() => (globais as unknown as Editor).organizarPastaCentral()).not.toThrow();
    const central = [...drive.arquivos.values()].find((a) => a.name === 'Central')!;
    expect(drive.arquivos.get('casa')!.pais).toEqual([central.id]);
    expect(drive.arquivos.get('dados')!.pais).toBeUndefined();
  });

  it('com a trava ocupada, avisa e não mexe em nada', () => {
    const { globais, trava, registros, drive } = carregar();
    raizDe(drive).arquivo('dados', 'central-dados.json');
    trava.livre = false;
    expect(() => (globais as unknown as Editor).organizarPastaCentral()).not.toThrow();
    expect(drive.movimentos).toEqual([]);
    expect(registros.join('\n')).toMatch(/AVISO/);
  });
});

describe('revisão: cópia não fatal e buscas só do dono', () => {
  it('com duas pastas Central e o arquivo de dados já existente, a gravação segue e a cópia falha só no registro (sem ids)', () => {
    const { pedir, drive, erros } = conectado();
    drive.arquivos.set('antigo', { id: 'antigo', name: 'central-dados.json', trashed: false, conteudo: '{"versao":1,"ultimo":0,"registros":[]}' });
    for (const id of ['central-um', 'central-dois']) drive.arquivos.set(id, { id, name: 'Central', mimeType: TIPO_PASTA, trashed: false, conteudo: '' });

    const resposta = pedir('enviar', { mudancas: [tarefa('t1', 'a')] });

    expect(resposta.ok).toBe(true);
    expect(drive.arquivos.get('antigo')!.conteudo).toContain('t1');
    expect([...drive.arquivos.values()].some((a) => a.name.startsWith('central-dados-'))).toBe(false);
    const registrado = erros.join('\n');
    expect(registrado).toMatch(/cópia diária/);
    expect(registrado).not.toMatch(/central-um|central-dois|antigo/);
  });

  it('arquivo central-dados.json de outra pessoa (compartilhado comigo) não conta como duplicado', () => {
    const { pedir, drive } = conectado();
    drive.arquivos.set('meu', { id: 'meu', name: 'central-dados.json', trashed: false, conteudo: '{"versao":1,"ultimo":0,"registros":[]}' });
    drive.arquivos.set('alheio', { id: 'alheio', name: 'central-dados.json', trashed: false, conteudo: '{}', dono: false });
    expect(pedir('enviar', { mudancas: [tarefa('t1', 'a')] }).ok).toBe(true);
    expect(drive.arquivos.get('meu')!.conteudo).toContain('t1');
    expect(drive.arquivos.get('alheio')!.conteudo).toBe('{}');
  });

  it('as consultas por nome (arquivo de dados e cópias) filtram só o dono', () => {
    const { pedir, drive } = conectado();
    drive.arquivos.set('meu', { id: 'meu', name: 'central-dados.json', trashed: false, conteudo: '{"versao":1,"ultimo":0,"registros":[]}' });
    pedir('enviar', { mudancas: [tarefa('t1', 'a')] });
    const porNome = drive.listas.filter((q) => q.includes("name = 'central-dados.json'") || q.includes("name contains 'central-dados-'"));
    expect(porNome.length).toBeGreaterThan(0);
    for (const q of porNome) expect(q).toContain("'me' in owners");
  });

  it('cópia velha de outra pessoa não é mandada para a lixeira', () => {
    const { pedir, drive } = conectado();
    pedir('enviar', { mudancas: [tarefa('t1', 'a')] });
    drive.arquivos.set('velha-alheia', { id: 'velha-alheia', name: 'central-dados-2026-09-01.json', trashed: false, conteudo: '{}', dono: false });
    drive.arquivos.set('velha-minha', { id: 'velha-minha', name: 'central-dados-2026-09-01.json', trashed: false, conteudo: '{}' });
    pedir('enviar', { mudancas: [tarefa('t2', 'b')] });
    expect(drive.arquivos.get('velha-alheia')!.trashed).toBe(false);
    expect(drive.arquivos.get('velha-minha')!.trashed).toBe(true);
  });
});

describe('avisos com código fixo no registro da organização', () => {
  type Editor = { organizarPastaCentral(): void };
  const pasta = (drive: ReturnType<typeof driveFalso>, id: string, nome: string, extra: Partial<ArquivoNoDrive> = {}) =>
    drive.arquivos.set(id, { id, name: nome, mimeType: TIPO_PASTA, trashed: false, conteudo: '', ...extra });
  const dados = (drive: ReturnType<typeof driveFalso>, id: string, extra: Partial<ArquivoNoDrive> = {}) =>
    drive.arquivos.set(id, { id, name: 'central-dados.json', mimeType: 'application/json', trashed: false, conteudo: '{}', ...extra });

  it('central_duplicada', () => {
    const { globais, registros, drive } = carregar();
    pasta(drive, 'c1', 'Central');
    pasta(drive, 'c2', 'Central');
    (globais as unknown as Editor).organizarPastaCentral();
    expect(registros.join('\n')).toMatch(/AVISO central_duplicada/);
  });

  it('dados_na_lixeira (id guardado na lixeira)', () => {
    const { globais, propriedades, registros, drive } = carregar();
    dados(drive, 'meu', { trashed: true });
    propriedades.set('ID_DO_ARQUIVO_DE_DADOS', 'meu');
    (globais as unknown as Editor).organizarPastaCentral();
    expect(registros.join('\n')).toMatch(/AVISO dados_na_lixeira/);
  });

  it('dados_duplicados (dois com o nome, sem id guardado)', () => {
    const { globais, registros, drive } = carregar();
    dados(drive, 'um');
    dados(drive, 'dois');
    (globais as unknown as Editor).organizarPastaCentral();
    expect(registros.join('\n')).toMatch(/AVISO dados_duplicados/);
    expect(drive.movimentos).toEqual([]);
  });

  it('casa_duplicada (duas na raiz)', () => {
    const { globais, registros, drive } = carregar();
    pasta(drive, 'a', 'Casa (partilhada)');
    pasta(drive, 'b', 'Casa (partilhada)');
    (globais as unknown as Editor).organizarPastaCentral();
    expect(registros.join('\n')).toMatch(/AVISO casa_duplicada/);
  });

  it('casa_em_dois_lugares, mesmo com a de Central vazia: não mexe', () => {
    const { globais, registros, drive } = carregar();
    pasta(drive, 'central', 'Central');
    pasta(drive, 'raiz', 'Casa (partilhada)');
    pasta(drive, 'dentro', 'Casa (partilhada)', { pais: ['central'] });
    (globais as unknown as Editor).organizarPastaCentral();
    expect(registros.join('\n')).toMatch(/AVISO casa_em_dois_lugares/);
    expect(drive.movimentos).toEqual([]);
  });

  it('o central-dados.json de outra pessoa nem entra na busca: o do dono é achado e movido, sem aviso de duplicado', () => {
    const { globais, registros, drive } = carregar();
    dados(drive, 'alheio', { dono: false });
    dados(drive, 'meu');
    (globais as unknown as Editor).organizarPastaCentral();
    expect(registros.join('\n')).not.toMatch(/dados_duplicados/);
    expect(drive.arquivos.get('meu')!.pais).toBeDefined();
    expect(drive.arquivos.get('alheio')!.pais).toBeUndefined();
  });

  it('trava_ocupada', () => {
    const { globais, trava, registros } = carregar();
    trava.livre = false;
    (globais as unknown as Editor).organizarPastaCentral();
    expect(registros.join('\n')).toMatch(/AVISO trava_ocupada/);
  });
});

describe('arquivos novos dentro da pasta Central', () => {
  it('o arquivo de dados e a cópia diária nascem em Central; só há uma pasta Central', () => {
    const { pedir, drive } = conectado();
    pedir('enviar', { mudancas: [tarefa('t1', 'a')] });
    pedir('enviar', { mudancas: [tarefa('t2', 'b')] });
    const todos = [...drive.arquivos.values()];
    const centrais = todos.filter((a) => a.name === 'Central' && a.mimeType === TIPO_PASTA);
    expect(centrais).toHaveLength(1);
    expect(centrais[0]!.pais).toEqual([RAIZ_DO_DRIVE]);
    const dados = todos.find((a) => a.name === 'central-dados.json')!;
    const copia = todos.find((a) => a.name === `central-dados-${hojeEmLisboa()}.json`)!;
    expect(dados.pais).toEqual([centrais[0]!.id]);
    expect(copia.pais).toEqual([centrais[0]!.id]);
  });

  it('arquivo de dados antigo na raiz continua achado pelo nome e atualizado onde está (sem mover nem duplicar)', () => {
    const { pedir, drive } = conectado();
    drive.arquivos.set('antigo', { id: 'antigo', name: 'central-dados.json', trashed: false, conteudo: '{"versao":1,"ultimo":0,"registros":[]}' });
    expect(pedir('enviar', { mudancas: [tarefa('t1', 'a')] }).ok).toBe(true);
    expect([...drive.arquivos.values()].filter((a) => a.name === 'central-dados.json')).toHaveLength(1);
    expect(drive.arquivos.get('antigo')!.pais).toBeUndefined();
    expect(drive.arquivos.get('antigo')!.conteudo).toContain('t1');
    expect(drive.movimentos).toEqual([]);
  });

  it('com duas pastas Central, gravar dados novos dá interno e não cria o arquivo', () => {
    const { pedir, drive } = conectado();
    for (const id of ['c1', 'c2']) drive.arquivos.set(id, { id, name: 'Central', mimeType: TIPO_PASTA, trashed: false, conteudo: '' });
    expect(pedir('enviar', { mudancas: [tarefa('t1', 'a')] })).toEqual({ ok: false, erro: 'interno' });
    expect([...drive.arquivos.values()].some((a) => a.name === 'central-dados.json')).toBe(false);
  });
});

describe('salvarAudio no pacote', () => {
  it('grava em Central/Audios pelo Drive, é idempotente e não confunde a pasta com o arquivo de dados', () => {
    const { pedir, drive } = conectado();
    const base64 = 'T2dnUwACAAAAAAAAAAA=';
    const a = pedir('salvarAudio', { id: 'audio-1', base64, mime: 'audio/webm' }) as { ok: boolean; dados: { ok: boolean; driveId: string } };
    const b = pedir('salvarAudio', { id: 'audio-1', base64, mime: 'audio/webm' }) as typeof a;
    expect(a.ok && a.dados.ok).toBe(true);
    expect(b.dados.driveId).toBe(a.dados.driveId);
    const nomes = [...drive.arquivos.values()].map((x) => x.name).sort();
    expect(nomes).toEqual(['Audios', 'Central', 'audio-audio-1.webm']);
    const arquivo = [...drive.arquivos.values()].find((x) => x.name === 'audio-audio-1.webm')!;
    expect(arquivo.mimeType).toBe('audio/webm');
    expect(arquivo.pais).toHaveLength(1);
  });
});

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
    for (const id of ['arquivo-1', 'arquivo-2']) expect(mensagem).not.toContain(id);
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
      ['Central', TIPO_PASTA],
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
    const { pedir, propriedades, drive } = conectado();
    pedir('enviar', { mudancas: [tarefa('t1', 'Aula da Aurora')] });
    const idDosDados = [...drive.arquivos.values()].find((x) => x.name === 'central-dados.json')!.id;
    const guardado = [...propriedades].find(([, valor]) => valor === idDosDados);
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
    expect(vivos.sort()).toEqual(['Central', `central-dados-${hojeEmLisboa()}.json`, 'central-dados.json']);
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
      // V02: Drive completo (pasta Central/Audios) e Planilhas (finanças e listas).
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/spreadsheets',
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

  it('nenhum escopo largo do Google Agenda; do Drive só o completo da V02, sem o somente leitura nem o drive.file antigo', () => {
    const escopos = manifesto().oauthScopes as string[];
    for (const largo of ['calendar', 'calendar.events', 'calendar.readonly', 'drive.readonly', 'drive.file']) {
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
    expect(ultima.url).toBe(`${ENDPOINT}arquivo-2?alt=media`);
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
    const original = drive.arquivos.get('arquivo-2')!;
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
    expect(JSON.parse(drive.arquivos.get('arquivo-2')!.conteudo).registros).toHaveLength(2);
    expect(rede.chamadas.every((c) => c.params.method === 'get')).toBe(true);
  });

  it.each([403, 404, 500, 302])('HTTP %i dá interno, sem gravar, e o registro não leva token, URL, id nem corpo', (status) => {
    const { pedir, rede, erros, drive } = conectado();
    pedir('enviar', { mudancas: [tarefa('t1', 'Segredo da Marina')] });
    const antes = drive.arquivos.get('arquivo-2')!.conteudo;
    rede.status = status;
    rede.corpoDoErro = `{"error":{"message":"Segredo da Marina arquivo-2 ${TOKEN_FICTICIO}"}}`;

    expect(pedir('puxar', { desde: 0 })).toEqual({ ok: false, erro: 'interno' });
    expect(pedir('enviar', { mudancas: [tarefa('t2', 'b')] })).toEqual({ ok: false, erro: 'interno' });
    expect(drive.arquivos.get('arquivo-2')!.conteudo).toBe(antes);
    const registrado = erros.join('\n');
    expect(registrado).toContain(`HTTP ${status}`);
    for (const proibido of [TOKEN_FICTICIO, ENDPOINT, 'arquivo-2', 'Segredo']) {
      expect(registrado).not.toContain(proibido);
    }
  });

  it('falha de rede dá interno, e a mensagem original (com URL e token) não vai ao registro', () => {
    const { pedir, rede, erros } = conectado();
    pedir('enviar', { mudancas: [tarefa('t1', 'a')] });
    rede.falharCom = `Address unavailable: ${ENDPOINT}arquivo-2?alt=media Bearer ${TOKEN_FICTICIO}`;

    expect(pedir('puxar', { desde: 0 })).toEqual({ ok: false, erro: 'interno' });
    const registrado = erros.join('\n');
    expect(registrado).toMatch(/Leitura do Drive falhou na rede/);
    for (const proibido of [TOKEN_FICTICIO, ENDPOINT, 'arquivo-2']) expect(registrado).not.toContain(proibido);
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
    expect(mensagem).toContain(`${drive.arquivos.get('arquivo-2')!.conteudo.length} caracteres`);
    for (const proibido of ['Segredo', 'arquivo-2', TOKEN_FICTICIO, ENDPOINT]) expect(mensagem).not.toContain(proibido);
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
    for (const proibido of ['arquivo-2', TOKEN_FICTICIO]) expect(mensagem).not.toContain(proibido);
  });
});

describe('diagnosticarDrive (leitura pela API)', () => {
  function preparado() {
    const carregado = conectado();
    carregado.pedir('enviar', { mudancas: [tarefa('t1', 'Segredo da Marina')] });
    const principal = carregado.drive.arquivos.get('arquivo-2')!;
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
    for (const proibido of ['Segredo', 'arquivo-2', TOKEN_FICTICIO, ENDPOINT]) expect(relatorio).not.toContain(proibido);
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
    expect(propriedades.get('ID_DO_ARQUIVO_DE_DADOS')).toBe('arquivo-2');
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

describe('diagnosticoAgenda (blocos do Google Tarefas e cores)', () => {
  const PRINCIPAL = 'marina.ficticia@example.com';
  const AVISO = 'As mudanças feitas no título não serão salvas. Para fazer edições, acesse: https://tasks.google.com/task/';

  function preparado(opcoes: { camposNovos?: ('label' | 'taskId')[] } = {}) {
    const carregado = carregar(opcoes);
    const hoje = hojeEmLisboa();
    const hora = { inicio: `${hoje}T12:00:00Z`, fim: `${hoje}T13:00:00Z` };
    const { calendario, tarefasGoogle } = carregado;
    calendario.evento(PRINCIPAL, { id: 'blocoSecreto1', summary: 'Tese da Marina', ...hora, description: `${AVISO}webSecreto1`, eventType: 'focusTime', transparency: 'transparent', label: { id: 'etqSecreta', backgroundColor: '#3f51b5' } });
    calendario.evento(PRINCIPAL, { id: 'blocoSecreto2', summary: 'Ler a Renata', ...hora, description: `${AVISO}webSecreto2`, eventType: 'focusTime' });
    calendario.evento(PRINCIPAL, { id: 'comumSecreto', summary: 'Café com Prof. Souza', ...hora, colorId: '9', description: 'Sala secreta' });
    const lista = tarefasGoogle.lista('Tese');
    tarefasGoogle.tarefa(lista, { id: 'apiSecreta1', idDaWeb: 'webSecreto1', due: `${hoje}T00:00:00.000Z` });
    const diagnosticar = () => {
      const antes = carregado.registros.length;
      (carregado.globais as unknown as { diagnosticoAgenda(): void }).diagnosticoAgenda();
      return carregado.registros.slice(antes).join('\n');
    };
    return { ...carregado, diagnosticar };
  }

  it('é função global no topo do arquivo, para o dono rodar pelo editor', () => {
    expect(pacote).toMatch(/^function diagnosticoAgenda\(/m);
  });

  it('registra só contagens e nomes de campos: nada de títulos, ids, e-mails nem descrições', () => {
    const { diagnosticar, erros } = preparado();
    const relatorio = diagnosticar();
    expect(relatorio).toContain('Hoje: eventos: 3; com description de tarefa: 2; com taskId: 0; com colorId: 1; com label: 0;');
    expect(relatorio).toMatch(/Tipos de evento: .*focusTime 2/);
    expect(relatorio).toMatch(/Campos vistos: .*description.*summary/);
    expect(relatorio).toMatch(/Google Tarefas: listas: 1; blocos de tarefa: 2; achados na leitura do período: 1; achados na busca completa: 1 \(pelo link: 1; pelo id: 0\)/);
    expect(relatorio).toMatch(/label\): desligada; leitura do taskId: desligada/);
    expect(relatorio).toMatch(/reconhecidos como bloco: 2; blocos em série: 0; ids de tarefa repetidos: 0\./);
    expect(relatorio).toMatch(/espelhos da lista Central \(saem da agenda\): 0\./);
    for (const proibido of ['Secret', 'Marina', 'Renata', 'Souza', 'example.com', 'mudanças', 'tasks.google.com', 'Sala']) {
      expect(relatorio + erros.join('\n')).not.toContain(proibido);
    }
  });

  it('quando a API devolve label, conta e liga a leitura dela na ação eventos', () => {
    const carregado = preparado({ camposNovos: ['label'] });
    const relatorio = carregado.diagnosticar();
    expect(relatorio).toMatch(/com label: 1/);
    expect(relatorio).toMatch(/Campos da etiqueta \(label\): backgroundColor, id\./);
    expect(relatorio).toMatch(/label\): ligada/);
    expect(relatorio).not.toContain('etqSecreta');
    expect(carregado.propriedades.get('CAMPOS_EXTRAS_DA_AGENDA')).toBe('label');

    carregado.globais.gerarCodigo();
    const codigo = carregado.propriedades.get('CODIGO_DO_APARELHO');
    const hoje = hojeEmLisboa();
    const { resposta } = carregado.postar(JSON.stringify({ codigo, acao: 'eventos', dados: { de: hoje, ate: hoje } }));
    const eventos = (resposta as { dados: { eventos: { id: string; cor?: unknown; tarefaGoogleId?: string }[] } }).dados.eventos;
    expect(eventos.find((e) => e.id === 'blocoSecreto1')).toMatchObject({ tarefaGoogleId: 'webSecreto1', cor: { chave: 'label:etqSecreta', hex: '#3f51b5' } });
    expect(eventos.find((e) => e.id === 'comumSecreto')!.cor).toEqual({ chave: 'cor:9', hex: '#3f51b5' });
  });

  it('conta ids de tarefa repetidos e espelhos da lista Central, sem os ids', () => {
    const carregado = preparado();
    const hoje = hojeEmLisboa();
    const tarde = { inicio: `${hoje}T15:00:00Z`, fim: `${hoje}T16:00:00Z` };
    carregado.calendario.evento(PRINCIPAL, { id: 'repetidoSecreto', summary: 'Tese de novo', ...tarde, description: `${AVISO}webSecreto1`, eventType: 'focusTime' });
    const central = carregado.tarefasGoogle.lista('Central');
    carregado.tarefasGoogle.tarefa(central, { id: 'apiEspelhoSecreta', idDaWeb: 'webSecreto2', due: `${hoje}T00:00:00.000Z` });
    const relatorio = carregado.diagnosticar();
    expect(relatorio).toMatch(/ids de tarefa repetidos: 1\./);
    expect(relatorio).toMatch(/espelhos da lista Central \(saem da agenda\): 1\./);
    expect(relatorio).not.toContain('Secret');
  });

  it('sem o Google Tarefas ligado, diz que falhou e segue', () => {
    const carregado = carregar({ semTarefas: true });
    (carregado.globais as unknown as { diagnosticoAgenda(): void }).diagnosticoAgenda();
    expect(carregado.registros.join('\n')).toMatch(/Google Tarefas falhou/);
  });
});
