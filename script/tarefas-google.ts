// Google Tarefas pelo serviço avançado Tasks (API v1), com duas partes:
// 1. Espelho das tarefas da Central (spec 2026-11-09, feito espelhado): o
//    Google é só espelho; nada do que muda na lista "Central" volta à Central.
// 2. Blocos do Google Tarefas na Agenda (spec 2026-11-09, blocos): tarefas que
//    o dono agenda com hora em qualquer lista. Aqui se lê o estado delas (o
//    feito do Google vale na Central, ver src/dados/eventos-feitos.ts) e se
//    conclui ou reabre a tarefa. As espelhos da lista "Central" que voltarem
//    como blocos são marcadas, e a leitura dos eventos as tira (a tarefa já
//    está na Central).
//
// Regras fixas:
// - tudo fica na lista "Central", criada se faltar;
// - cada espelho leva nas notas o id da tarefa da Central (`central:<id>`):
//   repetir o pedido (fila offline, resposta perdida, dois aparelhos) acha a
//   mesma espelho em vez de criar outra;
// - o pedido é conferido antes de qualquer chamada ao Google;
// - registros nunca levam título nem id; só o método e o motivo curto.
// O serviço chega por parâmetro (Codigo.ts passa o global `Tasks`), então tudo
// aqui roda igual nos testes.
import { ID_DE_TAREFA, LINK_DA_TAREFA, PedidoInvalido, dataValida, motivoDe, statusDe, type EstadoDaTarefa } from './agenda';
import { ID_VALIDO } from './colecoes';

export const NOME_DA_LISTA = 'Central';
/** Tarefas por pedido: cada uma é uma ou duas chamadas, e o pedido roda dentro da trava do script. */
export const LOTE_NO_MAXIMO = 20;
/** O Google Tarefas aceita títulos de até 1024 caracteres. */
export const TITULO_DA_ESPELHO_NO_MAXIMO = 1024;
const TITULO_RECEBIDO_NO_MAXIMO = 10_000;
const PAGINAS_NO_MAXIMO = 50;
const ID_DO_GOOGLE = /^[A-Za-z0-9_-]{1,256}$/;
const CONTROLE = /[\u0000-\u001f\u007f]+/g;
const MARCADOR = /(?:^|\s)central:([A-Za-z0-9_-]{1,64})(?=\s|$)/;

/** O que o app manda de cada tarefa. `googleId`: o id da espelho, se o app já sabe. */
export type ItemDoEspelho = {
  id: string;
  titulo: string;
  /** `AAAA-MM-DD`; sem ela, a espelho fica sem dia. */
  data?: string;
  feito: boolean;
  /** Apagada na Central: a espelho é apagada. */
  apagado: boolean;
  googleId?: string;
};

/** `ok: false`: esta tarefa falhou agora (o app tenta de novo); as outras seguem. */
export type ResultadoDoEspelho = { id: string; ok: boolean; googleId: string | null };

type Args = Record<string, unknown>;

export interface TarefaDaApi {
  id?: string;
  notes?: string;
  deleted?: boolean;
  status?: string;
  /** RFC 3339 da última mudança. */
  updated?: string;
  /** `https://tasks.google.com/task/<id da web>...`: o mesmo id do link no bloco da Agenda. */
  webViewLink?: string;
}

/** O pedaço do serviço avançado Tasks (v1) que o script usa. */
export interface ServicoDeTarefas {
  Tasklists: {
    list(args: Args): { items?: { id?: string; title?: string }[]; nextPageToken?: string };
    insert(corpo: object): { id?: string };
  };
  Tasks: {
    list(lista: string, args: Args): { items?: TarefaDaApi[]; nextPageToken?: string };
    get(lista: string, id: string): TarefaDaApi;
    insert(corpo: object, lista: string): TarefaDaApi;
    patch(corpo: object, lista: string, id: string): TarefaDaApi;
    remove(lista: string, id: string): void;
  };
}

/** Falha numa chamada ao Google Tarefas: só o método, o motivo curto e o status. */
class FalhaDasTarefas extends Error {
  readonly status: number | null;

  constructor(metodo: string, erro: unknown) {
    super(`Google Tarefas (${metodo}): ${motivoDe(erro)}`);
    this.name = 'FalhaDasTarefas';
    this.status = statusDe(erro);
  }
}

function google<T>(metodo: string, fazer: () => T): T {
  try {
    return fazer();
  } catch (erro) {
    throw new FalhaDasTarefas(metodo, erro);
  }
}

const sumiu = (erro: unknown) => erro instanceof FalhaDasTarefas && (erro.status === 404 || erro.status === 410);

function registrar(texto: string) {
  if (typeof console !== 'undefined') console.error(`Central: ${texto}`);
}

/** As notas da espelho: o id da tarefa na Central. */
export function marcadorDaTarefa(id: string): string {
  return `central:${id}`;
}

// ---------- conferência do pedido ----------

function objeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function exigir(condicao: boolean): asserts condicao {
  if (!condicao) throw new PedidoInvalido();
}

function lerItem(valor: unknown): ItemDoEspelho {
  exigir(objeto(valor));
  const { id, titulo, data, feito, apagado, googleId } = valor;
  exigir(typeof id === 'string' && ID_VALIDO.test(id));
  exigir(typeof titulo === 'string' && titulo.length <= TITULO_RECEBIDO_NO_MAXIMO);
  exigir(data === undefined || dataValida(data));
  exigir(typeof feito === 'boolean' && typeof apagado === 'boolean');
  exigir(googleId === undefined || (typeof googleId === 'string' && ID_DO_GOOGLE.test(googleId)));
  const item: ItemDoEspelho = { id, titulo, feito, apagado };
  if (data !== undefined) item.data = data;
  if (googleId !== undefined) item.googleId = googleId;
  return item;
}

export function lerLote(dados: unknown): ItemDoEspelho[] {
  exigir(objeto(dados));
  const { tarefas } = dados;
  exigir(Array.isArray(tarefas) && tarefas.length >= 1 && tarefas.length <= LOTE_NO_MAXIMO);
  return tarefas.map(lerItem);
}

// ---------- chamadas ----------

function tituloDaEspelho(titulo: string): string {
  const limpo = titulo.replace(CONTROLE, ' ').replace(/\s+/g, ' ').trim();
  return (limpo || '(sem título)').slice(0, TITULO_DA_ESPELHO_NO_MAXIMO);
}

/**
 * O corpo da espelho. `null` limpa no patch: dia tirado (Sem prazo) e hora de
 * conclusão de uma tarefa reaberta.
 */
function corpoDa(item: ItemDoEspelho): Record<string, unknown> {
  return {
    title: tituloDaEspelho(item.titulo),
    notes: marcadorDaTarefa(item.id),
    status: item.feito ? 'completed' : 'needsAction',
    due: item.data === undefined ? null : `${item.data}T00:00:00.000Z`,
    ...(item.feito ? {} : { completed: null }),
  };
}

/** Id da lista "Central"; cria se não houver. */
function listaCentral(servico: ServicoDeTarefas): string {
  let pagina: string | undefined;
  for (let vez = 0; vez < PAGINAS_NO_MAXIMO; vez++) {
    const args: Args = { maxResults: 100 };
    if (pagina) args.pageToken = pagina;
    const resposta = google('tasklists.list', () => servico.Tasklists.list(args));
    for (const lista of Array.isArray(resposta?.items) ? resposta.items : []) {
      if (lista?.title === NOME_DA_LISTA && typeof lista.id === 'string' && lista.id !== '') return lista.id;
    }
    pagina = typeof resposta?.nextPageToken === 'string' ? resposta.nextPageToken : undefined;
    if (!pagina) break;
  }
  const criada = google('tasklists.insert', () => servico.Tasklists.insert({ title: NOME_DA_LISTA }));
  if (typeof criada?.id !== 'string' || criada.id === '') throw new Error('Google Tarefas não devolveu a lista criada');
  return criada.id;
}

/** id da Central -> id da espelho, pelas notas, de todas as tarefas da lista (concluídas e escondidas também). */
function lerMarcadores(servico: ServicoDeTarefas, lista: string): Map<string, string> {
  const achados = new Map<string, string>();
  let pagina: string | undefined;
  for (let vez = 0; vez < PAGINAS_NO_MAXIMO; vez++) {
    const args: Args = { maxResults: 100, showCompleted: true, showHidden: true, fields: 'items(id,notes,deleted),nextPageToken' };
    if (pagina) args.pageToken = pagina;
    const resposta = google('tasks.list', () => servico.Tasks.list(lista, args));
    for (const tarefa of Array.isArray(resposta?.items) ? resposta.items : []) {
      if (tarefa?.deleted === true || typeof tarefa?.id !== 'string' || typeof tarefa.notes !== 'string') continue;
      const id = MARCADOR.exec(tarefa.notes)?.[1];
      if (id && !achados.has(id)) achados.set(id, tarefa.id);
    }
    pagina = typeof resposta?.nextPageToken === 'string' ? resposta.nextPageToken : undefined;
    if (!pagina) break;
  }
  return achados;
}

type Contexto = {
  servico: ServicoDeTarefas;
  lista: string;
  marcadores: () => Map<string, string>;
  /** Tira o marcador, só se a lista já foi lida (não lê a lista por isso). */
  esquecer: (id: string) => void;
};

/**
 * Patch na espelho. `null` se ela não existe mais, foi apagada no Google ou o
 * Google recusa o id (400, ex. "Invalid Value"): aí se procura pelas notas.
 */
function atualizar(ctx: Contexto, googleId: string, corpo: object): string | null {
  try {
    const resposta = google('tasks.patch', () => ctx.servico.Tasks.patch(corpo, ctx.lista, googleId));
    if (resposta?.deleted === true) return null;
    return typeof resposta?.id === 'string' && resposta.id !== '' ? resposta.id : googleId;
  } catch (erro) {
    if (sumiu(erro) || (erro instanceof FalhaDasTarefas && erro.status === 400)) return null;
    throw erro;
  }
}

function espelharUma(ctx: Contexto, item: ItemDoEspelho): string | null {
  if (item.apagado) {
    const alvo = item.googleId ?? ctx.marcadores().get(item.id);
    if (alvo) {
      try {
        google('tasks.delete', () => ctx.servico.Tasks.remove(ctx.lista, alvo));
      } catch (erro) {
        if (!sumiu(erro)) throw erro;
      }
      ctx.esquecer(item.id);
    }
    return null;
  }
  const corpo = corpoDa(item);
  if (item.googleId) {
    const atualizada = atualizar(ctx, item.googleId, corpo);
    if (atualizada) return atualizada;
  }
  const achada = ctx.marcadores().get(item.id);
  if (achada && achada !== item.googleId) {
    const atualizada = atualizar(ctx, achada, corpo);
    if (atualizada) return atualizada;
  }
  const criada = google('tasks.insert', () => ctx.servico.Tasks.insert(corpo, ctx.lista));
  if (typeof criada?.id !== 'string' || criada.id === '') throw new Error('Google Tarefas não devolveu a tarefa criada');
  ctx.marcadores().set(item.id, criada.id);
  return criada.id;
}

/**
 * `espelharTarefas {tarefas}`: cria, atualiza (título, dia, feita/reaberta) ou
 * apaga cada espelho. Uma tarefa que falha volta com `ok: false` e não derruba
 * as outras. A lista de marcadores só é lida se alguma tarefa vier sem o id da
 * espelho (ou com um id que não vale mais).
 */
export function espelharTarefas(dados: unknown, servico: ServicoDeTarefas): { resultados: ResultadoDoEspelho[] } {
  const itens = lerLote(dados);
  const lista = listaCentral(servico);
  let marcadores: Map<string, string> | null = null;
  const ctx: Contexto = {
    servico,
    lista,
    marcadores: () => (marcadores ??= lerMarcadores(servico, lista)),
    esquecer: (id) => void marcadores?.delete(id),
  };
  const resultados = itens.map((item): ResultadoDoEspelho => {
    try {
      return { id: item.id, ok: true, googleId: espelharUma(ctx, item) };
    } catch (erro) {
      registrar(`espelho de tarefa falhou: ${erro instanceof FalhaDasTarefas ? erro.message : 'falhou'}`);
      return { id: item.id, ok: false, googleId: item.googleId ?? null };
    }
  });
  return { resultados };
}

/** Para a função do editor: lê as listas (só a contagem). Não grava nada. */
export function provarTarefas(servico: ServicoDeTarefas): { listas: number; temCentral: boolean } {
  const resposta = google('tasklists.list', () => servico.Tasklists.list({ maxResults: 100 }));
  const itens = Array.isArray(resposta?.items) ? resposta.items : [];
  return { listas: itens.length, temCentral: itens.some((l) => l?.title === NOME_DA_LISTA) };
}

// ---------- blocos do Google Tarefas na Agenda (spec 2026-11-09, blocos) ----------
//
// Tarefas que o dono agenda com hora no Google Tarefas aparecem na Agenda como
// eventos (com o link `tasks.google.com/task/<id>` no fim da descrição). O
// feito delas vive no Google Tarefas: aqui o script lê o estado em lote e
// conclui ou reabre a tarefa, em qualquer lista. As espelhos da lista
// "Central" que voltarem como blocos são reconhecidas (a tarefa já está na
// Central) para a leitura dos eventos as tirar.

/** O cache do script (CacheService), onde fica o que já se achou. */
export interface GuardaDeTarefas {
  get(chave: string): string | null;
  put(chave: string, valor: string, segundos: number): void;
  putAll?(valores: Record<string, string>, segundos: number): void;
  remove(chave: string): void;
}

/** Relógio (ms), para o teto de tempo das leituras. */
export type Relogio = () => number;

/** Onde cada tarefa está (lista e id da API), guardado por 6 h. */
export const SEGUNDOS_DO_LOCAL = 6 * 60 * 60;
/** O estado lido das tarefas de um período: cache curto, para leituras seguidas (semana, mês, hoje). */
export const SEGUNDOS_DOS_ESTADOS = 2 * 60;
/** Tarefa procurada e não achada: não se procura de novo por 10 min. */
export const SEGUNDOS_DO_NAO_ACHADO = 10 * 60;
/** As listas do dono (ids e qual é a "Central"): 30 min. */
export const SEGUNDOS_DAS_LISTAS = 30 * 60;
/** Teto da busca de uma tarefa para marcar: passou disso, `gravado: false`. */
export const TETO_DA_BUSCA_MS = 20_000;
/** Teto da leitura dos estados na ação `eventos`: passou disso, os blocos vêm sem estado. */
export const TETO_DOS_ESTADOS_MS = 15_000;
const CHAVE_DA_VERSAO = 'tarefas-versao';
const CHAVE_DAS_LISTAS = 'tarefas-listas';
const CAMPOS_DA_BUSCA = 'items(id,status,updated,webViewLink,deleted),nextPageToken';
const LISTAS_NO_MAXIMO = 50;
const PAGINAS_POR_LISTA = 20;
const ESTADOS_NO_CACHE_NO_MAXIMO = 90_000;
const CHAVE_NO_MAXIMO = 250;
const DIA_MS = 24 * 60 * 60 * 1000;

type Lista = { id: string; central: boolean };
type Achada = { lista: string; id: string; idDaWeb: string | null; feito: boolean; atualizadaEm: number | null; central: boolean };

/** A leitura passou do teto de tempo. A mensagem é fixa. */
class TempoEsgotado extends Error {
  constructor() {
    super('Google Tarefas (tempo): tempo esgotado');
    this.name = 'TempoEsgotado';
  }
}

const semPermissao = (erro: unknown) => erro instanceof FalhaDasTarefas && (erro.status === 401 || erro.status === 403);

/** O id da web no `webViewLink` da tarefa. */
function idDaWeb(link: unknown): string | null {
  if (typeof link !== 'string') return null;
  const id = LINK_DA_TAREFA.exec(link)?.[1];
  return id && ID_DE_TAREFA.test(id) ? id : null;
}

function achada(lista: Lista, tarefa: TarefaDaApi | undefined): Achada | null {
  if (!tarefa || tarefa.deleted === true || typeof tarefa.id !== 'string' || !ID_DE_TAREFA.test(tarefa.id)) return null;
  const ms = typeof tarefa.updated === 'string' ? Date.parse(tarefa.updated) : NaN;
  return {
    lista: lista.id,
    id: tarefa.id,
    idDaWeb: idDaWeb(tarefa.webViewLink),
    feito: tarefa.status === 'completed',
    atualizadaEm: Number.isFinite(ms) ? ms : null,
    central: lista.central,
  };
}

/** A tarefa é a do bloco? Pelo link da web ou pelo id da API. */
const eDaTarefa = (a: Achada, taskId: string) => a.idDaWeb === taskId || a.id === taskId;

// O cache nunca derruba nada: sem ele, só se lê mais vezes.
function lerDoCache(guarda: GuardaDeTarefas | null, chave: string): string | null {
  try {
    return guarda?.get(chave) ?? null;
  } catch {
    return null;
  }
}

function gravarNoCache(guarda: GuardaDeTarefas | null, valores: Record<string, string>, segundos: number) {
  // O CacheService não aceita chave com mais de 250 caracteres.
  const validos: Record<string, string> = {};
  for (const chave of Object.keys(valores)) if (chave.length <= CHAVE_NO_MAXIMO) validos[chave] = valores[chave];
  if (!guarda || Object.keys(validos).length === 0) return;
  try {
    if (guarda.putAll) guarda.putAll(validos, segundos);
    else for (const chave of Object.keys(validos)) guarda.put(chave, validos[chave], segundos);
  } catch {
    // segue sem cache
  }
}

function tirarDoCache(guarda: GuardaDeTarefas | null, chave: string) {
  try {
    guarda?.remove(chave);
  } catch {
    // segue sem cache
  }
}

/** As listas do dono (com teto), guardadas por 30 min. */
function todasAsListas(servico: ServicoDeTarefas, guarda: GuardaDeTarefas | null): Lista[] {
  const guardadas = lerDoCache(guarda, CHAVE_DAS_LISTAS);
  if (guardadas) {
    try {
      const lido = JSON.parse(guardadas) as unknown;
      if (Array.isArray(lido) && lido.every((x) => Array.isArray(x) && typeof x[0] === 'string' && ID_DO_GOOGLE.test(x[0]))) {
        return lido.map((x: unknown[]) => ({ id: x[0] as string, central: x[1] === 1 }));
      }
    } catch {
      // lê de novo
    }
  }
  const listas: Lista[] = [];
  let pagina: string | undefined;
  for (let vez = 0; vez < PAGINAS_NO_MAXIMO && listas.length < LISTAS_NO_MAXIMO; vez++) {
    const args: Args = { maxResults: 100 };
    if (pagina) args.pageToken = pagina;
    const resposta = google('tasklists.list', () => servico.Tasklists.list(args));
    for (const lista of Array.isArray(resposta?.items) ? resposta.items : []) {
      if (typeof lista?.id === 'string' && ID_DO_GOOGLE.test(lista.id)) listas.push({ id: lista.id, central: lista.title === NOME_DA_LISTA });
    }
    pagina = typeof resposta?.nextPageToken === 'string' ? resposta.nextPageToken : undefined;
    if (!pagina) break;
  }
  const cortadas = listas.slice(0, LISTAS_NO_MAXIMO);
  gravarNoCache(guarda, { [CHAVE_DAS_LISTAS]: JSON.stringify(cortadas.map((l) => [l.id, l.central ? 1 : 0])) }, SEGUNDOS_DAS_LISTAS);
  return cortadas;
}

/**
 * Lê as tarefas de uma lista (concluídas e escondidas também), página a
 * página, até `aoAchar` responder true. `filtro`: dueMin/dueMax. Passou do
 * `prazo` (ms do relógio), lança TempoEsgotado.
 */
function lerLista(
  servico: ServicoDeTarefas,
  lista: Lista,
  filtro: Args,
  aoAchar: (a: Achada) => boolean,
  prazo: { ate: number; relogio: Relogio } | null,
): boolean {
  let pagina: string | undefined;
  for (let vez = 0; vez < PAGINAS_POR_LISTA; vez++) {
    if (prazo && prazo.relogio() > prazo.ate) throw new TempoEsgotado();
    const args: Args = { maxResults: 100, showCompleted: true, showHidden: true, fields: CAMPOS_DA_BUSCA, ...filtro };
    if (pagina) args.pageToken = pagina;
    const resposta = google('tasks.list', () => servico.Tasks.list(lista.id, args));
    for (const tarefa of Array.isArray(resposta?.items) ? resposta.items : []) {
      const a = achada(lista, tarefa);
      if (a && aoAchar(a)) return true;
    }
    pagina = typeof resposta?.nextPageToken === 'string' ? resposta.nextPageToken : undefined;
    if (!pagina) break;
  }
  return false;
}

const chaveDoLocal = (taskId: string) => `tarefa:${taskId}`;
const chaveDoNaoAchado = (taskId: string) => `tarefa-nao:${taskId}`;

function lerLocal(guarda: GuardaDeTarefas | null, taskId: string): { lista: Lista; id: string } | null {
  const texto = lerDoCache(guarda, chaveDoLocal(taskId));
  if (!texto) return null;
  try {
    const { l, i, c } = JSON.parse(texto) as { l?: unknown; i?: unknown; c?: unknown };
    return typeof l === 'string' && typeof i === 'string' && ID_DO_GOOGLE.test(l) && ID_DE_TAREFA.test(i)
      ? { lista: { id: l, central: c === 1 }, id: i }
      : null;
  } catch {
    return null;
  }
}

function guardarLocais(guarda: GuardaDeTarefas | null, locais: [taskId: string, a: Achada][]) {
  const valores: Record<string, string> = {};
  for (const [taskId, a] of locais) valores[chaveDoLocal(taskId)] = JSON.stringify({ l: a.lista, i: a.id, c: a.central ? 1 : 0 });
  gravarNoCache(guarda, valores, SEGUNDOS_DO_LOCAL);
}

/** Muda a cada marcação: o estado guardado de antes deixa de valer. */
function versaoDosEstados(guarda: GuardaDeTarefas | null): string {
  const versao = lerDoCache(guarda, CHAVE_DA_VERSAO);
  return versao && /^\d{1,15}$/.test(versao) ? versao : '0';
}

function diaMais(data: string, dias: number): string {
  const [ano, mes, dia] = data.split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia) + dias * DIA_MS).toISOString().slice(0, 10);
}

/** dueMin/dueMax para as tarefas com dia no período, com folga de um dia. */
function filtroDoPeriodo(periodo: { de: string; ate: string }): Args {
  return { dueMin: `${diaMais(periodo.de, -1)}T00:00:00.000Z`, dueMax: `${diaMais(periodo.ate, 2)}T00:00:00.000Z` };
}

/** As tarefas com dia no período, de todas as listas. */
function tarefasDoPeriodo(
  servico: ServicoDeTarefas,
  guarda: GuardaDeTarefas | null,
  periodo: { de: string; ate: string },
  prazo: { ate: number; relogio: Relogio } | null,
): Achada[] {
  const todas: Achada[] = [];
  for (const lista of todasAsListas(servico, guarda)) {
    lerLista(
      servico,
      lista,
      filtroDoPeriodo(periodo),
      (a) => {
        todas.push(a);
        return false;
      },
      prazo,
    );
  }
  return todas;
}

function lerEstadosGuardados(texto: string | null): Achada[] | null {
  if (!texto) return null;
  try {
    const lido = JSON.parse(texto) as unknown;
    if (!Array.isArray(lido)) return null;
    return lido.flatMap((x: unknown): Achada[] =>
      Array.isArray(x) && typeof x[0] === 'string' && typeof x[1] === 'string' && (x[2] === null || typeof x[2] === 'string')
        ? [
            {
              lista: x[0],
              id: x[1],
              idDaWeb: x[2] as string | null,
              feito: x[3] === 1,
              atualizadaEm: typeof x[4] === 'number' ? x[4] : null,
              central: x[5] === 1,
            },
          ]
        : [],
    );
  } catch {
    return null;
  }
}

/**
 * Estado (feito, hora da última mudança, se é espelho da "Central") das
 * tarefas dos blocos, para a leitura dos eventos. Uma leitura por lista (só
 * as tarefas com dia no período), nunca uma por evento, guardada por 2 min;
 * marcar uma tarefa invalida o guardado. Passou de 15 s, lança (a leitura dos
 * eventos segue sem estado). As que não aparecem ficam fora do mapa. O lugar
 * de cada uma fica guardado por 6 h, para marcar.
 */
export function estadosDasTarefas(
  ids: readonly string[],
  periodo: { de: string; ate: string },
  servico: ServicoDeTarefas,
  guarda: GuardaDeTarefas | null,
  relogio: Relogio = Date.now,
): Map<string, EstadoDaTarefa> {
  const pedidos = ids.filter((id) => ID_DE_TAREFA.test(id));
  const resultado = new Map<string, EstadoDaTarefa>();
  if (pedidos.length === 0) return resultado;
  const chave = `tarefas-estados:${versaoDosEstados(guarda)}:${periodo.de}:${periodo.ate}`;
  let todas = lerEstadosGuardados(lerDoCache(guarda, chave));
  if (todas === null) {
    todas = tarefasDoPeriodo(servico, guarda, periodo, { ate: relogio() + TETO_DOS_ESTADOS_MS, relogio });
    const texto = JSON.stringify(todas.map((a) => [a.lista, a.id, a.idDaWeb, a.feito ? 1 : 0, a.atualizadaEm, a.central ? 1 : 0]));
    if (texto.length <= ESTADOS_NO_CACHE_NO_MAXIMO) gravarNoCache(guarda, { [chave]: texto }, SEGUNDOS_DOS_ESTADOS);
  }
  const locais: [string, Achada][] = [];
  for (const taskId of pedidos) {
    if (resultado.has(taskId)) continue;
    const a = todas.find((t) => eDaTarefa(t, taskId));
    if (!a) continue;
    resultado.set(taskId, { feito: a.feito, atualizadaEm: a.atualizadaEm, ...(a.central ? { daCentral: true } : {}) });
    locais.push([taskId, a]);
  }
  guardarLocais(guarda, locais);
  return resultado;
}

/** `{taskId, feito, dia?}`: `dia` (AAAA-MM-DD) é o do bloco, para procurar primeiro só nele. */
export function lerMarcaDeTarefa(dados: unknown): { taskId: string; feito: boolean; dia?: string } {
  exigir(objeto(dados));
  const { taskId, feito, dia } = dados;
  exigir(typeof taskId === 'string' && ID_DE_TAREFA.test(taskId));
  exigir(typeof feito === 'boolean');
  exigir(dia === undefined || dataValida(dia));
  return { taskId, feito, ...(dia !== undefined ? { dia } : {}) };
}

/** Procura a tarefa em todas as listas, com o filtro dado (concluídas e escondidas também). */
function procurarTarefa(
  servico: ServicoDeTarefas,
  guarda: GuardaDeTarefas | null,
  taskId: string,
  filtro: Args,
  prazo: { ate: number; relogio: Relogio },
): Achada | null {
  let achou: Achada | null = null;
  for (const lista of todasAsListas(servico, guarda)) {
    const parou = lerLista(
      servico,
      lista,
      filtro,
      (a) => {
        if (!eDaTarefa(a, taskId)) return false;
        achou = a;
        return true;
      },
      prazo,
    );
    if (parou) break;
  }
  return achou;
}

/** A tarefa no lugar guardado, ou null se ela não está mais lá. */
function tarefaNoLocal(servico: ServicoDeTarefas, local: { lista: Lista; id: string }): Achada | null {
  try {
    return achada(local.lista, google('tasks.get', () => servico.Tasks.get(local.lista.id, local.id)));
  } catch (erro) {
    if (sumiu(erro) || (erro instanceof FalhaDasTarefas && erro.status === 400)) return null;
    throw erro;
  }
}

/**
 * `marcarTarefaGoogle {taskId, feito, dia?}`: conclui (`completed`) ou reabre
 * (`needsAction`, sem a hora de conclusão) a tarefa de um bloco, em qualquer
 * lista. Acha pelo `webViewLink` (que termina no id do link do bloco) ou pelo
 * id da API: primeiro no lugar guardado (6 h), depois só nas tarefas do dia
 * do bloco e, por fim, em tudo, com teto de 20 s. Não achada fica guardada
 * como tal por 10 min. Já no estado pedido, não grava. Nunca mexe no título.
 * `gravado: false`, sem erro (o feito fica só na Central): sem permissão
 * (401/403), sem o serviço, sem a tarefa, tempo esgotado ou tarefa que o
 * Google não deixa mudar (400, ex. atribuída pelo Docs ou pelo Chat).
 */
export function marcarTarefaGoogle(
  dados: unknown,
  servico: ServicoDeTarefas | null,
  guarda: GuardaDeTarefas | null,
  relogio: Relogio = Date.now,
): { feito: boolean; gravado: boolean } {
  const { taskId, feito, dia } = lerMarcaDeTarefa(dados);
  const naoGravou = { feito, gravado: false };
  if (!servico) return naoGravou;
  if (lerDoCache(guarda, chaveDoNaoAchado(taskId))) return naoGravou;
  const prazo = { ate: relogio() + TETO_DA_BUSCA_MS, relogio };
  try {
    const local = lerLocal(guarda, taskId);
    let tarefa = local ? tarefaNoLocal(servico, local) : null;
    if (local && !tarefa) tirarDoCache(guarda, chaveDoLocal(taskId));
    if (!tarefa && dia !== undefined) tarefa = procurarTarefa(servico, guarda, taskId, filtroDoPeriodo({ de: dia, ate: dia }), prazo);
    if (!tarefa) tarefa = procurarTarefa(servico, guarda, taskId, {}, prazo);
    if (!tarefa) {
      gravarNoCache(guarda, { [chaveDoNaoAchado(taskId)]: '1' }, SEGUNDOS_DO_NAO_ACHADO);
      return naoGravou;
    }
    guardarLocais(guarda, [[taskId, tarefa]]);
    if (tarefa.feito === feito) return { feito, gravado: true };
    const corpo = feito ? { status: 'completed' } : { status: 'needsAction', completed: null };
    const alvo = tarefa;
    google('tasks.patch', () => servico.Tasks.patch(corpo, alvo.lista, alvo.id));
    gravarNoCache(guarda, { [CHAVE_DA_VERSAO]: String(Number(versaoDosEstados(guarda)) + 1) }, SEGUNDOS_DO_LOCAL);
    return { feito, gravado: true };
  } catch (erro) {
    if (erro instanceof TempoEsgotado) return naoGravou;
    if (sumiu(erro) || semPermissao(erro) || (erro instanceof FalhaDasTarefas && erro.status === 400)) return naoGravou;
    throw erro;
  }
}

/**
 * Para diagnosticoAgenda: quantas tarefas dos blocos a leitura do período
 * acha, quantas a busca completa acha (pelo link ou pelo id) e quantas são
 * espelhos da lista "Central". Só contagens.
 */
export function diagnosticarTarefas(
  ids: readonly string[],
  periodo: { de: string; ate: string },
  servico: ServicoDeTarefas,
): { listas: number; blocos: number; noPeriodo: number; naBusca: number; peloLink: number; peloId: number; daCentral: number } {
  const listas = todasAsListas(servico, null);
  const doPeriodo = tarefasDoPeriodo(servico, null, periodo, null);
  // A busca completa lê cada lista uma vez só, e compara na memória.
  const todas: Achada[] = [];
  for (const lista of listas) {
    lerLista(
      servico,
      lista,
      {},
      (a) => {
        todas.push(a);
        return false;
      },
      null,
    );
  }
  const conta = { noPeriodo: 0, naBusca: 0, peloLink: 0, peloId: 0, daCentral: 0 };
  for (const taskId of ids) {
    if (doPeriodo.some((a) => eDaTarefa(a, taskId))) conta.noPeriodo += 1;
    const a = todas.find((t) => eDaTarefa(t, taskId));
    if (!a) continue;
    conta.naBusca += 1;
    if (a.central) conta.daCentral += 1;
    if (a.idDaWeb === taskId) conta.peloLink += 1;
    else conta.peloId += 1;
  }
  return { listas: listas.length, blocos: ids.length, ...conta };
}
