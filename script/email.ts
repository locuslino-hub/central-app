// Gmail só para LER, pelo serviço avançado Gmail (API v1), com o escopo
// gmail.readonly (R11). O serviço chega por parâmetro (Codigo.ts passa o
// global `Gmail`), então tudo aqui roda igual nos testes.
//
// Regras fixas:
// - só dois métodos do Gmail: Users.Messages.list (a busca) e
//   Users.Threads.get com formato de metadados (De, Assunto, trecho, data e
//   marcadores). Nunca o corpo, anexos, destinatários nem outro método;
// - a Central nunca muda nada no Gmail: Feito e Agora não ficam só no app;
// - de cada e-mail fica só id, remetente, endereço, assunto, trecho (até 200),
//   data e link para abrir no Gmail;
// - erros e registros nunca levam endereço, nome, assunto, trecho nem ids.

import { paraLisboa, statusDe } from './agenda';

/** Busca do Gmail: não lidos da aba Principal nos últimos 14 dias [Dono]. */
export const BUSCA = 'is:unread category:primary newer_than:14d';
export const TRECHO_NO_MAXIMO = 200;
export const ASSUNTO_NO_MAXIMO = 200;
export const REMETENTE_NO_MAXIMO = 100;
/** Maior endereço de e-mail válido (RFC 5321). */
export const ENDERECO_NO_MAXIMO = 254;
/**
 * Teto de conversas lidas por atualização: uma leitura do Gmail por conversa,
 * e a busca inline (cache vazio) precisa responder bem antes dos 30 s do app.
 */
export const CONVERSAS_NO_MAXIMO = 50;
/** O cache do script aceita até 100 KB por valor: fica uma folga. */
export const BYTES_NO_MAXIMO = 90_000;

const EU = 'me';
const DE_NO_MAXIMO = 1000;
/** Chegada depois disso é dado quebrado (e não cabe na data AAAA-MM-DD): a conversa é pulada. */
const MS_NO_MAXIMO = Date.UTC(2200, 0, 1);
const POR_PAGINA = 100;
const PAGINAS_NO_MAXIMO = 5;
const CAMPOS_DA_BUSCA = 'messages(id,threadId),nextPageToken';
/** Só o que vira Email e o que decide se ele fica: nada de corpo nem partes. */
const CAMPOS_DA_CONVERSA = 'messages(id,labelIds,snippet,internalDate,payload/headers)';
const CABECALHOS = ['From', 'Subject'];
const LINK_DO_GMAIL = 'https://mail.google.com/mail/u/0/#all/';

/** Ids do Gmail são hexadecimais: nada de `/`, `#`, `?` ou `:` (o link é montado com eles). */
const ID_DO_GMAIL = /^[A-Za-z0-9]{1,64}$/;
const LINK_GUARDADO = /^https:\/\/mail\.google\.com\/mail\/u\/0\/#all\/[A-Za-z0-9]{1,64}$/;
const DATA_COM_FUSO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;
const MS = /^\d{1,16}$/;
const ENDERECO = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:".]+$/;
/** Controles, caracteres invisíveis (o Gmail enche o trecho deles) e separadores. */
const INVISIVEIS = /[\u0000-\u001f\u007f-\u009f\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u206a-\u206f\u3164\ufeff\uffa0]/g;
const ESPACOS = /[\s\u00a0\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/g;

const CAMPOS: readonly (keyof Email)[] = ['id', 'remetente', 'enderecoRemetente', 'assunto', 'trecho', 'data', 'link'];

export type Email = {
  /** Id da mensagem no Gmail (a não lida mais nova da conversa). */
  id: string;
  /** Nome de quem enviou; sem nome, o endereço. */
  remetente: string;
  /** Endereço em minúsculas, ou '' se o cabeçalho não tem um válido. Serve à memória de pessoas. */
  enderecoRemetente: string;
  assunto: string;
  /** Começo do texto, até 200 caracteres. */
  trecho: string;
  /** Chegada no Gmail, ISO com o fuso de Lisboa (`2026-11-05T10:20:00+00:00`). */
  data: string;
  /** Abre a conversa no Gmail da web. */
  link: string;
};

type Args = Record<string, unknown>;

interface MensagemDaApi {
  id?: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: { headers?: { name?: string; value?: string }[] };
}

/** O pedaço do serviço avançado Gmail (v1) que o script usa: só leitura. */
export interface ServicoDeGmail {
  Users: {
    Messages: { list(userId: string, args: Args): { messages?: MensagemDaApi[]; nextPageToken?: string } };
    Threads: { get(userId: string, id: string, args: Args): { messages?: MensagemDaApi[] } };
  };
}

/** Onde a lista fica entre o gatilho e o app (o cache do script, em Codigo.ts). */
export interface GuardaDeEmails {
  ler(): string | null;
  gravar(texto: string): void;
}

/**
 * Motivos conhecidos que o registro pode mostrar. Qualquer outro texto da
 * mensagem pode trazer endereço ou assunto: vira "falhou".
 */
const MOTIVOS = [
  'Not Found',
  'Forbidden',
  'Backend Error',
  'Bad Request',
  'Rate Limit Exceeded',
  'User-rate limit exceeded',
  'Too many concurrent requests for user',
  'Insufficient Permission',
  'Request had insufficient authentication scopes',
  'Invalid Credentials',
  'Service unavailable',
  'Internal error',
  'Precondition check failed',
];

/** O motivo da API, se for um dos conhecidos; senão "falhou". O texto do erro nunca passa adiante. */
function motivoConhecido(erro: unknown): string {
  const mensagem = typeof erro === 'object' && erro !== null ? (erro as { message?: unknown }).message : undefined;
  const depois = typeof mensagem === 'string' ? /failed with error: ([^\n]*)/.exec(mensagem)?.[1] : undefined;
  if (!depois) return 'falhou';
  const lido = depois.trim().toLowerCase();
  return MOTIVOS.filter((conhecido) => lido.startsWith(conhecido.toLowerCase()))[0] ?? 'falhou';
}

/** Falha numa chamada ao Gmail: só o método, um motivo conhecido e o status HTTP. */
class FalhaDoGmail extends Error {
  readonly status: number | null;

  constructor(metodo: string, erro: unknown) {
    const motivo = motivoConhecido(erro);
    super(`Gmail (${metodo}): ${motivo}`);
    this.name = 'FalhaDoGmail';
    this.status = statusDe(erro);
  }
}

function gmail<T>(metodo: string, fazer: () => T): T {
  try {
    return fazer();
  } catch (erro) {
    throw new FalhaDoGmail(metodo, erro);
  }
}

function registrar(texto: string) {
  if (typeof console !== 'undefined') console.error(`Central: ${texto}`);
}

// ---------- limpeza de texto ----------

/** Corta em `maximo` unidades sem deixar meio emoji no fim. */
function cortar(texto: string, maximo: number): string {
  if (texto.length <= maximo) return texto;
  const corte = texto.slice(0, maximo);
  return /[\ud800-\udbff]$/.test(corte) ? corte.slice(0, -1) : corte;
}

function limpar(texto: string, maximo: number): string {
  return cortar(texto.replace(INVISIVEIS, ' ').replace(ESPACOS, ' ').trim(), maximo);
}

const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function codigoValido(codigo: number): boolean {
  return Number.isInteger(codigo) && codigo > 0 && codigo <= 0x10ffff && (codigo < 0xd800 || codigo > 0xdfff);
}

/** O trecho do Gmail vem com entidades HTML (`&#39;`, `&amp;`): volta a texto. */
function semEntidades(texto: string): string {
  return texto.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,6});/gi, (inteira, nome: string) => {
    if (nome[0] === '#') {
      const codigo = nome[1] === 'x' || nome[1] === 'X' ? parseInt(nome.slice(2), 16) : parseInt(nome.slice(1), 10);
      return codigoValido(codigo) ? String.fromCodePoint(codigo) : ' ';
    }
    return ENTIDADES[nome.toLowerCase()] ?? inteira;
  });
}

/** Trecho pronto para guardar: sem entidades, sem invisíveis, espaços juntados, até 200. */
export function limparTrecho(trecho: string): string {
  return limpar(semEntidades(typeof trecho === 'string' ? trecho : ''), TRECHO_NO_MAXIMO);
}

function enderecoValido(valor: string): boolean {
  return valor.length <= ENDERECO_NO_MAXIMO && ENDERECO.test(valor);
}

/** Cabeçalho From (`"Prof. Souza" <souza@…>`, `Marina <…>`, `renata@…`) em nome e endereço. */
export function lerRemetente(de: string): { remetente: string; enderecoRemetente: string } {
  // Um From real tem poucas centenas de caracteres: o corte só limita o trabalho das buscas abaixo.
  const valor = typeof de === 'string' ? de.slice(0, DE_NO_MAXIMO).trim() : '';
  let nome = valor;
  let endereco = '';
  const comSinais = /^(.*)<([^<>]*)>\s*$/.exec(valor);
  if (comSinais) {
    nome = comSinais[1].trim();
    endereco = comSinais[2].trim();
  } else if (valor.indexOf('@') >= 0) {
    nome = '';
    endereco = valor;
  }
  if (/^".*"$/.test(nome)) nome = nome.slice(1, -1).replace(/\\(.)/g, '$1');
  endereco = enderecoValido(endereco) ? endereco.toLowerCase() : '';
  const remetente = limpar(nome, REMETENTE_NO_MAXIMO) || endereco;
  return { remetente, enderecoRemetente: endereco };
}

export function linkDaConversa(conversa: string): string {
  if (!ID_DO_GMAIL.test(conversa)) throw new Error('Id de conversa fora do padrão');
  return `${LINK_DO_GMAIL}${conversa}`;
}

// ---------- leitura do Gmail ----------

/**
 * Conversas que casam com a busca (as mais novas primeiro, até o teto) e,
 * de cada uma, os ids das mensagens que casaram.
 */
function conversasDaBusca(servico: ServicoDeGmail): Map<string, Set<string>> {
  const conversas = new Map<string, Set<string>>();
  let pagina: string | undefined;
  for (let vez = 0; vez < PAGINAS_NO_MAXIMO; vez++) {
    const args: Args = { q: BUSCA, maxResults: POR_PAGINA, fields: CAMPOS_DA_BUSCA };
    if (pagina) args.pageToken = pagina;
    const resposta = gmail('messages.list', () => servico.Users.Messages.list(EU, args));
    for (const { id, threadId } of Array.isArray(resposta?.messages) ? resposta.messages : []) {
      if (typeof id !== 'string' || !ID_DO_GMAIL.test(id)) continue;
      if (typeof threadId !== 'string' || !ID_DO_GMAIL.test(threadId)) continue;
      const casadas = conversas.get(threadId);
      if (casadas) casadas.add(id);
      else if (conversas.size < CONVERSAS_NO_MAXIMO) conversas.set(threadId, new Set([id]));
    }
    pagina = typeof resposta?.nextPageToken === 'string' ? resposta.nextPageToken : undefined;
    if (!pagina || conversas.size >= CONVERSAS_NO_MAXIMO) break;
  }
  return conversas;
}

function marcadores(m: MensagemDaApi): string[] {
  return Array.isArray(m.labelIds) ? m.labelIds : [];
}

function chegada(m: MensagemDaApi): number | null {
  if (typeof m.internalDate !== 'string' || !MS.test(m.internalDate)) return null;
  const ms = Number(m.internalDate);
  return ms <= MS_NO_MAXIMO ? ms : null;
}

function cabecalho(m: MensagemDaApi, nome: string): string {
  const lista = Array.isArray(m.payload?.headers) ? m.payload!.headers! : [];
  const achado = lista.filter((c) => typeof c?.name === 'string' && c.name.toLowerCase() === nome.toLowerCase())[0];
  return typeof achado?.value === 'string' ? achado.value : '';
}

/**
 * O e-mail da conversa, ou null se ela não fica por responder: a não lida
 * mais nova que casou com a busca, ainda na caixa de entrada (arquivar tira)
 * e que não foi o dono quem mandou; sai se o dono respondeu depois dela.
 */
function emailDaConversa(conversa: string, casadas: Set<string>, mensagens: MensagemDaApi[]): { email: Email; ms: number } | null {
  let escolhida: { m: MensagemDaApi; ms: number } | null = null;
  for (const m of mensagens) {
    const ms = chegada(m);
    if (ms === null || typeof m.id !== 'string' || !casadas.has(m.id)) continue;
    const lista = marcadores(m);
    if (lista.indexOf('INBOX') < 0 || lista.indexOf('SENT') >= 0) continue;
    if (!escolhida || ms > escolhida.ms) escolhida = { m, ms };
  }
  if (!escolhida) return null;
  const limite = escolhida.ms;
  const respondida = mensagens.some((m) => marcadores(m).indexOf('SENT') >= 0 && (chegada(m) ?? -1) > limite);
  if (respondida) return null;
  const { m, ms } = escolhida;
  return {
    email: {
      id: m.id as string,
      ...lerRemetente(cabecalho(m, 'From')),
      assunto: limpar(cabecalho(m, 'Subject'), ASSUNTO_NO_MAXIMO),
      trecho: limparTrecho(m.snippet ?? ''),
      data: paraLisboa(new Date(ms).toISOString()),
      link: linkDaConversa(conversa),
    },
    ms,
  };
}

const sumiu = (erro: unknown) => erro instanceof FalhaDoGmail && (erro.status === 404 || erro.status === 410);

/**
 * Lê o Gmail agora: e-mails por responder, do mais antigo ao mais novo.
 * Conversa apagada no meio (404) é pulada; qualquer outra falha lança, para
 * nunca trocar a lista boa por uma parcial.
 */
export function buscarEmails(servico: ServicoDeGmail): Email[] {
  const achados: { email: Email; ms: number }[] = [];
  conversasDaBusca(servico).forEach((casadas, conversa) => {
    let mensagens: MensagemDaApi[];
    try {
      const lida = gmail('threads.get', () =>
        servico.Users.Threads.get(EU, conversa, { format: 'metadata', metadataHeaders: CABECALHOS, fields: CAMPOS_DA_CONVERSA }),
      );
      mensagens = Array.isArray(lida?.messages) ? lida.messages : [];
    } catch (erro) {
      if (sumiu(erro)) return;
      throw erro;
    }
    const achado = emailDaConversa(conversa, casadas, mensagens);
    if (achado) achados.push(achado);
  });
  achados.sort((a, b) => a.ms - b.ms || (a.email.id < b.email.id ? -1 : 1));
  return achados.map((a) => a.email);
}

// ---------- guarda ----------

function bytesEmUtf8(texto: string): number {
  let total = 0;
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i);
    if (c < 0x80) total += 1;
    else if (c < 0x800) total += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < texto.length) {
      total += 4;
      i++;
    } else total += 3;
  }
  return total;
}

/** Texto para guardar, até BYTES_NO_MAXIMO: os mais novos saem primeiro (os antigos são os mais urgentes). */
function caber(lista: Email[]): { lista: Email[]; texto: string } {
  const cabem = lista.slice();
  let texto = JSON.stringify(cabem);
  while (cabem.length > 0 && bytesEmUtf8(texto) > BYTES_NO_MAXIMO) {
    cabem.pop();
    texto = JSON.stringify(cabem);
  }
  if (cabem.length < lista.length) registrar(`lista de e-mails cortada para caber no cache: ${lista.length - cabem.length} a menos`);
  return { lista: cabem, texto };
}

function texto(valor: unknown, maximo: number): valor is string {
  return typeof valor === 'string' && valor.length <= maximo;
}

function emailValido(valor: unknown): valor is Email {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) return false;
  const chaves = Object.keys(valor);
  if (chaves.length !== CAMPOS.length || CAMPOS.some((campo) => chaves.indexOf(campo) < 0)) return false;
  const e = valor as Record<string, unknown>;
  return (
    typeof e.id === 'string' &&
    ID_DO_GMAIL.test(e.id) &&
    texto(e.remetente, REMETENTE_NO_MAXIMO) &&
    texto(e.enderecoRemetente, ENDERECO_NO_MAXIMO) &&
    (e.enderecoRemetente === '' || enderecoValido(e.enderecoRemetente)) &&
    texto(e.assunto, ASSUNTO_NO_MAXIMO) &&
    texto(e.trecho, TRECHO_NO_MAXIMO) &&
    typeof e.data === 'string' &&
    DATA_COM_FUSO.test(e.data) &&
    typeof e.link === 'string' &&
    LINK_GUARDADO.test(e.link)
  );
}

/** Lista guardada, conferida campo a campo; null se faltar, estiver quebrada ou fora da forma. */
export function lerGuardados(guardado: string | null): Email[] | null {
  if (typeof guardado !== 'string') return null;
  let lista: unknown;
  try {
    lista = JSON.parse(guardado);
  } catch {
    return null;
  }
  if (!Array.isArray(lista) || lista.length > CONVERSAS_NO_MAXIMO || !lista.every(emailValido)) return null;
  return lista;
}

/**
 * Gatilho de 30 min e botão "Atualizar agora": lê o Gmail e troca a lista
 * guardada. Se o Gmail falhar, lança e a lista anterior fica. Se só a
 * gravação falhar, a lista nova ainda volta para quem pediu.
 */
export function atualizarEmails(servico: ServicoDeGmail, guarda: GuardaDeEmails): Email[] {
  const { lista, texto: guardar } = caber(buscarEmails(servico));
  try {
    guarda.gravar(guardar);
  } catch {
    registrar('lista de e-mails não foi guardada no cache');
  }
  return lista;
}

/**
 * Ação `emails`: a lista guardada pelo gatilho. Sem ela (cache expirou ou
 * foi descartado), lê o Gmail agora em vez de dizer que não há nada.
 */
export function listarEmails(servico: () => ServicoDeGmail, guarda: GuardaDeEmails): Email[] {
  let guardado: string | null = null;
  try {
    guardado = guarda.ler();
  } catch {
    // sem cache: lê agora
  }
  return lerGuardados(guardado) ?? atualizarEmails(servico(), guarda);
}
