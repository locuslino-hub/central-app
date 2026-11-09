// Espelho das tarefas da Central no Google Tarefas (spec 2026-11-09), pelo
// serviço avançado Tasks (API v1). O Google é só espelho: o dono usa a Central,
// e nada aqui lê o Google Tarefas para mudar a Central.
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
import { PedidoInvalido, dataValida, motivoDe, statusDe } from './agenda';
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
}

/** O pedaço do serviço avançado Tasks (v1) que o script usa. */
export interface ServicoDeTarefas {
  Tasklists: {
    list(args: Args): { items?: { id?: string; title?: string }[]; nextPageToken?: string };
    insert(corpo: object): { id?: string };
  };
  Tasks: {
    list(lista: string, args: Args): { items?: TarefaDaApi[]; nextPageToken?: string };
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
