// Google Agenda pelo serviço avançado Calendar (API v3), nunca pelo CalendarApp
// (R9): só a API dá extendedProperties.private, transparency e a resposta do
// dono a um convite. O serviço chega por parâmetro (Codigo.ts passa o global
// `Calendar`), então tudo aqui roda igual nos testes.
//
// Regras fixas:
// - lê todas as agendas marcadas na lista do dono; grava só na principal;
// - nunca envia, convida nem notifica: evento criado não tem convidados e
//   toda gravação leva sendUpdates 'none';
// - a sala fica em extendedProperties.private.centralSala;
// - desfazer só apaga evento da principal com a marca privada do app
//   (centralCriado '1'), nunca outro evento do dono;
// - o pedido é conferido antes de qualquer chamada ao Google;
// - erros e registros nunca levam título, id, e-mail ou nome de agenda;
// - o id de uma agenda que não é a principal nunca sai do script: o app
//   recebe um apelido opaco e estável (`agenda-…`).

/** O dono vive em Lisboa: horas do app são de Lisboa. */
export const FUSO = 'Europe/Lisbon';
/** As 7 salas fixas (mesmos ids da semente em src/dados/loja.ts). */
export const SALAS_FIXAS: readonly string[] = [
  'sala-doutoramento',
  'sala-investigacao',
  'sala-aulas',
  'sala-orientacoes',
  'sala-mba',
  'sala-pessoal',
  'sala-casa',
];
/** Maior período de um pedido `eventos` (de `de` até `ate`). Cobre a vista do ano com folga. */
export const DIAS_NO_MAXIMO = 400;
/** Teto de eventos por pedido, somadas as agendas (os mais cedo ficam). */
export const EVENTOS_NO_MAXIMO = 2500;
/** Teto de agendas lidas: a lista do dono tem poucas; isto só evita laço sem fim. */
export const AGENDAS_NO_MAXIMO = 50;
export const TITULO_NO_MAXIMO = 200;

const PRINCIPAL = 'primary';
const MARCA_DO_APP = 'centralCriado';
const CHAVE_DA_SALA = 'centralSala';
const POR_PAGINA = 2500;
const PAGINAS_NO_MAXIMO = 20;
const DIA_MS = 24 * 60 * 60 * 1000;

/** Só os campos usados: sem descrição, local nem e-mail de convidados. */
const CAMPOS_DOS_EVENTOS =
  'items(id,status,eventType,summary,start,end,transparency,htmlLink,attendees(self,responseStatus),extendedProperties(private)),nextPageToken';
const CAMPOS_DA_LISTA = 'items(id,primary,selected,hidden,deleted),nextPageToken';
const CAMPOS_DA_MARCA = 'id,status,extendedProperties';
/** Um evento inteiro, com os mesmos campos da lista (para o criarEvento repetido). */
const CAMPOS_DO_EVENTO =
  'id,status,eventType,summary,start,end,transparency,htmlLink,attendees(self,responseStatus),extendedProperties(private)';

const DATA = /^(\d{4})-(\d{2})-(\d{2})$/;
const HORA = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
/** Ids do Google: base32hex, mais `_` e carimbo nas repetições. Nada de `/`, `.`, `@`. */
const ID_DE_EVENTO = /^[A-Za-z0-9_-]{1,1024}$/;
/** Id escolhido pelo app ao criar: base32hex (a-v, 0-9), 5 a 1024 caracteres, como a API exige. */
const ID_DO_APP = /^[a-v0-9]{5,1024}$/;
const CONTROLE = /[\u0000-\u001f\u007f]/;
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/;
const LINK_DO_GOOGLE = /^https:\/\/(?:www\.google\.com\/calendar|calendar\.google\.com)\/\S*$/;
const ANO_MINIMO = 1900;
const ANO_MAXIMO = 2200;

export type Evento = {
  id: string;
  /**
   * 'primary' para a agenda principal. As outras vêm com um apelido opaco e
   * estável (`agenda-` + 11 caracteres), nunca o id do Google (que é um e-mail).
   */
  agendaId: string;
  titulo: string;
  /** ISO com o fuso de Lisboa (`2026-10-23T11:00:00+01:00`), ou `AAAA-MM-DD` no dia inteiro. */
  inicio: string;
  /** Como `inicio`. No dia inteiro, o dia seguinte ao último (exclusivo, como no Google). */
  fim: string;
  diaInteiro: boolean;
  /** Marcado como "disponível" no Google (transparency 'transparent'). */
  livre: boolean;
  /** O próprio dono (convidado `self`) recusou. */
  recusado: boolean;
  /** Sala guardada pelo app; sem ela, null (a memória decide no app). */
  salaId: string | null;
  /** Abrir no Google Agenda (só https do Google). */
  link: string | null;
};

export type NovoEvento = {
  titulo: string;
  data: string;
  inicio: string;
  fim: string;
  salaId: string | null;
  /**
   * Id gerado pelo app (base32hex, 5 a 1024). Repetir o pedido com o mesmo id
   * não cria outro evento: devolve o já criado.
   */
  id?: string;
};

/** Resposta de `eventos`. `incompleto`: alguma agenda falhou ou um teto foi atingido. */
export type RespostaEventos = { eventos: Evento[]; incompleto: boolean };

type Args = Record<string, unknown>;
type DataDaApi = { date?: string; dateTime?: string; timeZone?: string };

export interface EventoDaApi {
  id?: string;
  status?: string;
  eventType?: string;
  summary?: string;
  start?: DataDaApi;
  end?: DataDaApi;
  transparency?: string;
  htmlLink?: string;
  attendees?: { self?: boolean; responseStatus?: string }[];
  extendedProperties?: { private?: Record<string, string>; shared?: Record<string, string> };
}

export interface EntradaDaLista {
  id?: string;
  primary?: boolean;
  selected?: boolean;
  hidden?: boolean;
  deleted?: boolean;
}

/** O pedaço do serviço avançado Calendar (v3) que o script usa. */
export interface ServicoDeAgenda {
  CalendarList: { list(args: Args): { items?: EntradaDaLista[]; nextPageToken?: string } };
  Events: {
    list(agendaId: string, args: Args): { items?: EventoDaApi[]; nextPageToken?: string };
    get(agendaId: string, eventoId: string, args: Args): EventoDaApi;
    insert(corpo: object, agendaId: string, args: Args): EventoDaApi;
    patch(corpo: object, agendaId: string, eventoId: string, args: Args): EventoDaApi;
    remove(agendaId: string, eventoId: string, args: Args): void;
  };
}

/** Pedido com forma errada: vira `interno`, sem chamar o Google. A mensagem é fixa. */
export class PedidoInvalido extends Error {
  constructor() {
    super('Pedido de agenda inválido');
    this.name = 'PedidoInvalido';
  }
}

/** Falha numa chamada ao Google. Leva só o método, o motivo curto (ex.: Not Found) e o status HTTP. */
class FalhaDoGoogle extends Error {
  readonly status: number | null;

  constructor(metodo: string, motivo: string, status: number | null) {
    super(`Google Agenda (${metodo}): ${motivo}`);
    this.name = 'FalhaDoGoogle';
    this.status = status;
  }
}

// ---------- fuso de Lisboa ----------

/** 01:00 UTC do último domingo do mês (0 = janeiro): hora em que Portugal troca. */
function trocaDeHora(ano: number, mes: number): number {
  const ultimo = new Date(Date.UTC(ano, mes + 1, 0));
  return Date.UTC(ano, mes, ultimo.getUTCDate() - ultimo.getUTCDay(), 1);
}

/** Minutos à frente de UTC em Lisboa no instante: 60 no verão, 0 no inverno (regra da UE). */
function minutosDeLisboa(ms: number): number {
  const ano = new Date(ms).getUTCFullYear();
  return ms >= trocaDeHora(ano, 2) && ms < trocaDeHora(ano, 9) ? 60 : 0;
}

function comFuso(minutos: number): string {
  return minutos === 60 ? '+01:00' : '+00:00';
}

function utcDoDia(data: string): number {
  const [, ano, mes, dia] = DATA.exec(data)!;
  return Date.UTC(Number(ano), Number(mes) - 1, Number(dia));
}

/** Instante RFC 3339 (com Z ou deslocamento) na hora de Lisboa, com o fuso: `2026-10-23T11:00:00+01:00`. */
export function paraLisboa(texto: string): string {
  const partes = typeof texto === 'string' ? RFC3339.exec(texto) : null;
  if (!partes) throw new Error('Hora sem fuso');
  const [, , mes, dia, hora, minuto, segundo, hDoFuso, mDoFuso] = partes;
  const fora =
    Number(mes) < 1 || Number(mes) > 12 || Number(dia) < 1 || Number(dia) > 31 || Number(hora) > 23 ||
    Number(minuto) > 59 || Number(segundo) > 59 || Number(hDoFuso ?? 0) > 23 || Number(mDoFuso ?? 0) > 59;
  const ms = fora ? NaN : Date.parse(texto);
  if (!Number.isFinite(ms)) throw new Error('Hora inválida');
  const inteiro = Math.floor(ms / 1000) * 1000;
  const minutos = minutosDeLisboa(inteiro);
  return new Date(inteiro + minutos * 60_000).toISOString().slice(0, 19) + comFuso(minutos);
}

/** 00:00 de Lisboa no dia, com o fuso. A troca de hora é à 01:00 UTC, nunca à meia-noite. */
function meiaNoiteEmLisboa(data: string): string {
  return `${data}T00:00:00${comFuso(minutosDeLisboa(utcDoDia(data) - 60 * 60_000))}`;
}

/** Dia de hoje em Lisboa (AAAA-MM-DD) no instante. */
export function hojeEmLisboa(agora: number): string {
  return new Date(agora + minutosDeLisboa(agora) * 60_000).toISOString().slice(0, 10);
}

/**
 * Hora de parede de Lisboa (`HH:MM` no dia) com o fuso, ou null se ela não
 * existe (último domingo de março, 01:00 a 01:59: o relógio salta para 02:00).
 * No último domingo de outubro, 01:00 a 01:59 existe duas vezes: vale a
 * primeira, ainda no horário de verão (+01:00).
 */
export function horaEmLisboa(data: string, hora: string): string | null {
  const [h, m] = hora.split(':').map(Number);
  const comoUtc = utcDoDia(data) + h * 60 * 60_000 + m * 60_000;
  if (minutosDeLisboa(comoUtc - 60 * 60_000) === 60) return `${data}T${hora}:00+01:00`;
  if (minutosDeLisboa(comoUtc) === 0) return `${data}T${hora}:00+00:00`;
  return null;
}

function diaSeguinte(data: string): string {
  return new Date(utcDoDia(data) + DIA_MS).toISOString().slice(0, 10);
}

// ---------- conferência do pedido ----------

function objeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function proprio(alvo: unknown, chave: string): unknown {
  return objeto(alvo) && Object.prototype.hasOwnProperty.call(alvo, chave) ? alvo[chave] : undefined;
}

export function dataValida(valor: unknown): valor is string {
  if (typeof valor !== 'string') return false;
  const partes = DATA.exec(valor);
  if (!partes) return false;
  const ano = Number(partes[1]);
  if (ano < ANO_MINIMO || ano > ANO_MAXIMO) return false;
  return new Date(utcDoDia(valor)).toISOString().slice(0, 10) === valor;
}

/** Link para abrir no Google Agenda: só https do próprio Google. */
export function linkValido(valor: unknown): valor is string {
  return typeof valor === 'string' && LINK_DO_GOOGLE.test(valor);
}

export function salaValida(valor: unknown): valor is string | null {
  return valor === null || (typeof valor === 'string' && SALAS_FIXAS.indexOf(valor) >= 0);
}

function exigir(condicao: boolean): asserts condicao {
  if (!condicao) throw new PedidoInvalido();
}

export function lerPeriodo(dados: unknown): { de: string; ate: string } {
  exigir(objeto(dados));
  const { de, ate } = dados;
  exigir(dataValida(de) && dataValida(ate));
  const dias = (utcDoDia(ate) - utcDoDia(de)) / DIA_MS;
  exigir(dias >= 0 && dias <= DIAS_NO_MAXIMO);
  return { de, ate };
}

function conferirNovo(dados: unknown): { novo: NovoEvento; inicioIso: string; fimIso: string } {
  exigir(objeto(dados));
  const { titulo, data, inicio, fim, salaId, id } = dados;
  exigir(typeof titulo === 'string');
  const aparado = titulo.trim();
  exigir(aparado.length > 0 && aparado.length <= TITULO_NO_MAXIMO && !CONTROLE.test(aparado));
  exigir(dataValida(data));
  exigir(typeof inicio === 'string' && HORA.test(inicio) && typeof fim === 'string' && HORA.test(fim));
  exigir(fim > inicio);
  exigir(salaValida(salaId));
  exigir(id === undefined || (typeof id === 'string' && ID_DO_APP.test(id)));
  // Hora que não existe em Lisboa (troca de março) é pedido inválido.
  const inicioIso = horaEmLisboa(data, inicio);
  const fimIso = horaEmLisboa(data, fim);
  exigir(inicioIso !== null && fimIso !== null);
  const novo: NovoEvento = { titulo: aparado, data, inicio, fim, salaId };
  if (id !== undefined) novo.id = id;
  return { novo, inicioIso, fimIso };
}

export function lerNovoEvento(dados: unknown): NovoEvento {
  return conferirNovo(dados).novo;
}

export function lerId(dados: unknown): string {
  exigir(objeto(dados));
  const { id } = dados;
  exigir(typeof id === 'string' && ID_DE_EVENTO.test(id));
  return id;
}

export function lerTrocaDeSala(dados: unknown): { id: string; salaId: string | null } {
  const id = lerId(dados);
  const salaId = (dados as Record<string, unknown>).salaId;
  exigir(salaValida(salaId));
  return { id, salaId };
}

// ---------- chamadas ao Google ----------

/** Só o motivo curto da API ("Not Found", "Forbidden"): o resto pode trazer ids ou e-mails. */
function motivoDe(erro: unknown): string {
  const mensagem = typeof erro === 'object' && erro !== null ? (erro as { message?: unknown }).message : undefined;
  const texto = typeof mensagem === 'string' ? mensagem : '';
  const motivo = /failed with error: ([A-Za-z ]{1,40})/.exec(texto)?.[1]?.trim();
  return motivo || 'falhou';
}

/**
 * Status HTTP da falha: `details.code` do GoogleJsonResponseException, ou,
 * sem ele, pelo motivo da mensagem (só os três que o script trata).
 */
export function statusDe(erro: unknown): number | null {
  const detalhes = typeof erro === 'object' && erro !== null ? (erro as { details?: unknown }).details : undefined;
  const codigo = typeof detalhes === 'object' && detalhes !== null ? (detalhes as { code?: unknown }).code : undefined;
  if (typeof codigo === 'number' && Number.isInteger(codigo)) return codigo;
  const motivo = motivoDe(erro);
  if (/^Not Found$/i.test(motivo)) return 404;
  if (/^(Resource has been deleted|Gone)$/i.test(motivo)) return 410;
  if (/already exists|^Duplicate$/i.test(motivo)) return 409;
  return null;
}

function paraFalha(metodo: string, erro: unknown): FalhaDoGoogle {
  return new FalhaDoGoogle(metodo, motivoDe(erro), statusDe(erro));
}

function google<T>(metodo: string, fazer: () => T): T {
  try {
    return fazer();
  } catch (erro) {
    throw paraFalha(metodo, erro);
  }
}

const sumiu = (erro: unknown) => erro instanceof FalhaDoGoogle && (erro.status === 404 || erro.status === 410);

function registrar(texto: string) {
  if (typeof console !== 'undefined') console.error(`Central: ${texto}`);
}

// ---------- tradução para Evento ----------

function ponto(valor: unknown): { texto: string; ms: number; dia: boolean } | null {
  const data = proprio(valor, 'date');
  if (dataValida(data)) return { texto: data, ms: utcDoDia(data), dia: true };
  const hora = proprio(valor, 'dateTime');
  if (typeof hora !== 'string') return null;
  try {
    const texto = paraLisboa(hora);
    return { texto, ms: Date.parse(texto), dia: false };
  } catch {
    return null;
  }
}

/** Evento da API -> Evento do app, ou null se faltar o essencial. `ordem` serve só para ordenar. */
function traduzir(api: unknown, agendaId: string): { evento: Evento; ordem: number; fimMs: number } | null {
  const id = proprio(api, 'id');
  if (typeof id !== 'string' || id === '') return null;
  const inicio = ponto(proprio(api, 'start'));
  const fim = ponto(proprio(api, 'end'));
  if (!inicio || !fim) return null;
  const titulo = proprio(api, 'summary');
  const link = proprio(api, 'htmlLink');
  const convidados = proprio(api, 'attendees');
  const sala = proprio(proprio(proprio(api, 'extendedProperties'), 'private'), CHAVE_DA_SALA);
  const recusado =
    Array.isArray(convidados) &&
    convidados.some((c) => proprio(c, 'self') === true && proprio(c, 'responseStatus') === 'declined');
  return {
    evento: {
      id,
      agendaId,
      titulo: typeof titulo === 'string' ? titulo : '',
      inicio: inicio.texto,
      fim: fim.texto,
      diaInteiro: inicio.dia,
      livre: proprio(api, 'transparency') === 'transparent',
      recusado,
      salaId: typeof sala === 'string' && SALAS_FIXAS.indexOf(sala) >= 0 ? sala : null,
      link: linkValido(link) ? link : null,
    },
    // Dia inteiro conta da meia-noite de Lisboa, para ordenar com os de horário.
    ordem: inicio.dia ? Date.parse(meiaNoiteEmLisboa(inicio.texto)) : inicio.ms,
    fimMs: fim.dia ? Date.parse(meiaNoiteEmLisboa(fim.texto)) : fim.ms,
  };
}

function exigirEvento(api: unknown): Evento {
  const traduzido = traduzir(api, PRINCIPAL);
  if (!traduzido) throw new Error('Google Agenda devolveu evento sem a forma esperada');
  return traduzido.evento;
}

// ---------- apelido das agendas ----------

/**
 * Apelido opaco e estável de uma agenda (hash cyrb53 de 53 bits, em base 36).
 * O id do Google (e-mail) nunca sai do script. Mesmo id, mesmo apelido.
 */
function apelido(id: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < id.length; i++) {
    const c = id.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const valor = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return `agenda-${valor.toString(36).padStart(11, '0')}`;
}

type AgendaALer = { id: string; apelido: string };

// ---------- ações ----------

/**
 * Agendas a ler: a principal (sempre, como 'primary') e as marcadas na lista
 * do dono. `cortada`: havia mais do que o teto de agendas ou de páginas.
 */
function agendasMarcadas(servico: ServicoDeAgenda): { agendas: AgendaALer[]; cortada: boolean } {
  const ids: string[] = [];
  let pagina: string | undefined;
  for (let vez = 0; vez < PAGINAS_NO_MAXIMO; vez++) {
    const args: Args = { maxResults: 250, fields: CAMPOS_DA_LISTA };
    if (pagina) args.pageToken = pagina;
    const resposta = google('calendarList.list', () => servico.CalendarList.list(args));
    for (const entrada of Array.isArray(resposta?.items) ? resposta.items : []) {
      const id = proprio(entrada, 'id');
      if (typeof id !== 'string' || id === '' || id.length > 1024) continue;
      if (proprio(entrada, 'deleted') === true || proprio(entrada, 'hidden') === true) continue;
      if (proprio(entrada, 'primary') === true) ids.unshift(PRINCIPAL);
      else if (proprio(entrada, 'selected') === true) ids.push(id);
    }
    pagina = typeof resposta?.nextPageToken === 'string' ? resposta.nextPageToken : undefined;
    if (!pagina) break;
  }
  // Mesmo se a lista não marcar a principal, ela é lida: é onde o app grava.
  if (ids.indexOf(PRINCIPAL) < 0) ids.unshift(PRINCIPAL);
  return {
    agendas: ids.slice(0, AGENDAS_NO_MAXIMO).map((id) => ({ id, apelido: id === PRINCIPAL ? PRINCIPAL : apelido(id) })),
    cortada: pagina !== undefined || ids.length > AGENDAS_NO_MAXIMO,
  };
}

/** Eventos de uma agenda no período. `cortada`: sobrou página por ler (teto de eventos ou de páginas). */
function lerAgenda(servico: ServicoDeAgenda, agenda: AgendaALer, timeMin: string, timeMax: string) {
  const achados: NonNullable<ReturnType<typeof traduzir>>[] = [];
  let pagina: string | undefined;
  for (let vez = 0; vez < PAGINAS_NO_MAXIMO && achados.length < EVENTOS_NO_MAXIMO; vez++) {
    const args: Args = {
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
      timeZone: FUSO,
      maxResults: POR_PAGINA,
      fields: CAMPOS_DOS_EVENTOS,
    };
    if (pagina) args.pageToken = pagina;
    const resposta = google('events.list', () => servico.Events.list(agenda.id, args));
    for (const item of Array.isArray(resposta?.items) ? resposta.items : []) {
      if (proprio(item, 'status') === 'cancelled' || proprio(item, 'eventType') === 'workingLocation') continue;
      const traduzido = traduzir(item, agenda.apelido);
      if (traduzido) achados.push(traduzido);
    }
    pagina = typeof resposta?.nextPageToken === 'string' ? resposta.nextPageToken : undefined;
    if (!pagina) break;
  }
  return { achados, cortada: pagina !== undefined };
}

/**
 * `eventos {de, ate}`: dias AAAA-MM-DD de Lisboa, `ate` incluído.
 * `incompleto` é true se uma agenda assinada falhou (e foi pulada) ou se um
 * teto (agendas, páginas, 2500 eventos) foi atingido.
 */
export function listarEventos(dados: unknown, servico: ServicoDeAgenda): RespostaEventos {
  const { de, ate } = lerPeriodo(dados);
  const timeMin = meiaNoiteEmLisboa(de);
  const timeMax = meiaNoiteEmLisboa(diaSeguinte(ate));
  const { agendas, cortada } = agendasMarcadas(servico);
  let incompleto = cortada;
  const todos: NonNullable<ReturnType<typeof traduzir>>[] = [];
  for (const agenda of agendas) {
    try {
      const lida = lerAgenda(servico, agenda, timeMin, timeMax);
      todos.push(...lida.achados);
      if (lida.cortada) incompleto = true;
    } catch (erro) {
      // A principal falhando daria uma agenda vazia que engana: o pedido falha.
      if (agenda.id === PRINCIPAL) throw erro;
      incompleto = true;
      registrar(`agenda assinada ignorada: ${erro instanceof FalhaDoGoogle ? erro.message : 'falhou'}`);
    }
  }
  if (todos.length > EVENTOS_NO_MAXIMO) incompleto = true;
  todos.sort((a, b) => a.ordem - b.ordem || a.fimMs - b.fimMs);
  return { eventos: todos.slice(0, EVENTOS_NO_MAXIMO).map((t) => t.evento), incompleto };
}

/**
 * `criarEvento`: na principal, horas de Lisboa, sem convidados e sem notificar.
 * A hora vai com o fuso explícito (`+01:00`/`+00:00`, ver horaEmLisboa) e com
 * timeZone Europe/Lisbon. Com `id` do app, repetir o pedido (fila offline,
 * resposta perdida) dá 409 no Google: o script lê o evento e, se ele tem a
 * marca do app e não foi desfeito, devolve esse mesmo evento.
 */
export function criarEvento(dados: unknown, servico: ServicoDeAgenda): Evento {
  const { novo, inicioIso, fimIso } = conferirNovo(dados);
  const privadas: Record<string, string> = { [MARCA_DO_APP]: '1' };
  if (novo.salaId !== null) privadas[CHAVE_DA_SALA] = novo.salaId;
  const corpo = {
    ...(novo.id !== undefined ? { id: novo.id } : {}),
    summary: novo.titulo,
    start: { dateTime: inicioIso, timeZone: FUSO },
    end: { dateTime: fimIso, timeZone: FUSO },
    extendedProperties: { private: privadas },
  };
  let criado: EventoDaApi;
  try {
    criado = servico.Events.insert(corpo, PRINCIPAL, { sendUpdates: 'none' });
  } catch (erro) {
    const falha = paraFalha('events.insert', erro);
    const id = novo.id;
    if (falha.status !== 409 || id === undefined) throw falha;
    criado = google('events.get', () => servico.Events.get(PRINCIPAL, id, { fields: CAMPOS_DO_EVENTO }));
    if (proprio(criado, 'status') === 'cancelled') throw new Error('Evento do app já desfeito');
    if (proprio(proprio(proprio(criado, 'extendedProperties'), 'private'), MARCA_DO_APP) !== '1') {
      throw new Error('Id já usado por evento que não é do app');
    }
  }
  return exigirEvento(criado);
}

function marcaDoEvento(servico: ServicoDeAgenda, id: string) {
  return google('events.get', () => servico.Events.get(PRINCIPAL, id, { fields: CAMPOS_DA_MARCA }));
}

/**
 * `removerEvento {id}` (desfazer a criação): só na principal e só com a marca
 * do app. Já apagado responde `removido: false`, sem erro (desfazer repetido).
 */
export function removerEvento(dados: unknown, servico: ServicoDeAgenda): { removido: boolean } {
  const id = lerId(dados);
  let atual: EventoDaApi;
  try {
    atual = marcaDoEvento(servico, id);
  } catch (erro) {
    // Já não existe (404) ou foi apagado (410): nada a desfazer.
    if (sumiu(erro)) return { removido: false };
    throw erro;
  }
  if (proprio(atual, 'status') === 'cancelled') return { removido: false };
  const privadas = proprio(proprio(atual, 'extendedProperties'), 'private');
  if (proprio(privadas, MARCA_DO_APP) !== '1') throw new Error('Evento não foi criado pelo app');
  try {
    google('events.delete', () => servico.Events.remove(PRINCIPAL, id, { sendUpdates: 'none' }));
  } catch (erro) {
    // Apagado entre o get e o delete (outro aparelho, outra tentativa).
    if (sumiu(erro)) return { removido: false };
    throw erro;
  }
  return { removido: true };
}

/**
 * `trocarSalaEvento {id, salaId}` na principal. Lê as propriedades privadas e
 * manda o mapa privado inteiro, com a sala nova: o resultado é o mesmo se o
 * patch mesclar ou substituir o mapa, e a marca do app nunca se perde. As
 * compartilhadas (de outros apps) nunca são enviadas. Sala null fica como
 * texto vazio, que se lê como "sem sala".
 */
export function trocarSalaEvento(dados: unknown, servico: ServicoDeAgenda): Evento {
  const { id, salaId } = lerTrocaDeSala(dados);
  const atual = marcaDoEvento(servico, id);
  if (proprio(atual, 'status') === 'cancelled') throw new Error('Evento apagado');
  const privadas = proprio(proprio(atual, 'extendedProperties'), 'private');
  const corpo = {
    extendedProperties: { private: { ...(objeto(privadas) ? privadas : {}), [CHAVE_DA_SALA]: salaId ?? '' } },
  };
  return exigirEvento(google('events.patch', () => servico.Events.patch(corpo, PRINCIPAL, id, { sendUpdates: 'none' })));
}

/**
 * Para a função do editor: lista as agendas e lê os eventos de hoje da
 * principal com o mesmo pedido da ação `eventos` (campos e opções), para o
 * passo do dono provar o pedido real. Devolve só a contagem; não grava nada.
 */
export function provarAgenda(servico: ServicoDeAgenda, agora: number): { agendas: number } {
  const agendas = agendasMarcadas(servico).agendas.length;
  const hoje = hojeEmLisboa(agora);
  lerAgenda(servico, { id: PRINCIPAL, apelido: PRINCIPAL }, meiaNoiteEmLisboa(hoje), meiaNoiteEmLisboa(diaSeguinte(hoje)));
  return { agendas };
}
