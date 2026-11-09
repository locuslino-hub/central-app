// Google Agenda pelo script (Tarefa 10): ações `eventos`, `criarEvento`,
// `removerEvento` e `trocarSalaEvento`. O pedido é conferido aqui com as
// mesmas regras do script (script/agenda.ts), então pedido inválido nem sai do
// aparelho. Erros viram `ErroAgenda` com um motivo curto para a tela.
// Sem tela nesta tarefa: as telas de calendário (T11) e a criação pelo chat (T12) usam isto.
import {
  ID_DE_TAREFA,
  PedidoInvalido,
  dataValida,
  lerId,
  lerMarcaDeFeito,
  lerNovoEvento,
  lerPeriodo,
  lerTrocaDeSala,
  linkValido,
  salaValida,
  type Evento,
  type NovoEvento,
  type RespostaEventos,
} from '../../script/agenda';
import { CHAVE_DE_COR } from '../../script/colecoes';
import { lerLote, lerMarcaDeTarefa, type ItemDoEspelho, type ResultadoDoEspelho } from '../../script/tarefas-google';
import { ErroConexao, ErroScript, chamar as chamarOScript } from '../conexao/cliente';

export type { ItemDoEspelho, ResultadoDoEspelho };

export type { Evento, NovoEvento, RespostaEventos };

/**
 * Id novo para `criarEvento`: 32 caracteres hexadecimais (cabem no base32hex
 * que o Google aceita). Quem põe o pedido numa fila (T12) guarda o id junto:
 * repetir com o mesmo id devolve o evento já criado, sem duplicar.
 */
export function novoIdDeEvento(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

/**
 * - `sem-internet`: não chegou ao script; dá para tentar de novo.
 * - `codigo-invalido`: o aparelho precisa ser conectado de novo.
 * - `falhou`: o script ou o Google Agenda recusou (ex.: evento que não é do app).
 * - `invalido`: o pedido nem saiu do aparelho.
 */
export type FalhaDaAgenda = 'sem-internet' | 'codigo-invalido' | 'falhou' | 'invalido';

/** A mensagem é fixa por motivo: nunca leva título, id ou dados do pedido. */
export class ErroAgenda extends Error {
  readonly falha: FalhaDaAgenda;

  constructor(falha: FalhaDaAgenda) {
    super(`Google Agenda: ${falha}`);
    this.name = 'ErroAgenda';
    this.falha = falha;
  }
}

type Chamar = <T>(acao: string, dados?: object) => Promise<T>;
export type OpcoesDaAgenda = { chamar?: Chamar };

const HORA_COM_FUSO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;

function horaValida(valor: unknown): valor is string {
  return typeof valor === 'string' && HORA_COM_FUSO.test(valor) && Number.isFinite(Date.parse(valor));
}

/** A cor do Google: chave estável (como o script calcula) e hex para a amostra. */
function corValida(valor: unknown): boolean {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) return false;
  const { chave, hex } = valor as Record<string, unknown>;
  return typeof chave === 'string' && CHAVE_DE_COR.test(chave) && typeof hex === 'string' && /^#[0-9a-f]{6}$/.test(hex);
}

/** O que chega do script tem a forma de `Evento`? (Dia inteiro: datas; senão, horas com fuso.) */
export function eventoValido(valor: unknown): valor is Evento {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) return false;
  const e = valor as Record<string, unknown>;
  const ponto = e.diaInteiro === true ? dataValida : horaValida;
  return (
    typeof e.id === 'string' &&
    e.id !== '' &&
    typeof e.agendaId === 'string' &&
    e.agendaId !== '' &&
    typeof e.titulo === 'string' &&
    typeof e.diaInteiro === 'boolean' &&
    ponto(e.inicio) &&
    ponto(e.fim) &&
    typeof e.livre === 'boolean' &&
    typeof e.recusado === 'boolean' &&
    salaValida(e.salaId) &&
    (e.link === null || linkValido(e.link)) &&
    // Script antigo não manda: ausente vale false.
    (e.feito === undefined || typeof e.feito === 'boolean') &&
    (e.somenteLeitura === undefined || typeof e.somenteLeitura === 'boolean') &&
    // Blocos do Google Tarefas e cor (script novo; o antigo não manda).
    (e.tarefaGoogleId === undefined || (typeof e.tarefaGoogleId === 'string' && ID_DE_TAREFA.test(e.tarefaGoogleId))) &&
    (e.tarefaAtualizadaEm === undefined ||
      (typeof e.tarefaAtualizadaEm === 'number' && Number.isFinite(e.tarefaAtualizadaEm) && e.tarefaAtualizadaEm >= 0)) &&
    (e.tarefaRepetida === undefined || typeof e.tarefaRepetida === 'boolean') &&
    (e.cor === undefined || corValida(e.cor))
  );
}

/** Bloco do Google Tarefas é tempo ocupado, sempre (mesmo marcado como disponível no Google). */
function comoOcupado(evento: Evento): Evento {
  return evento.tarefaGoogleId !== undefined && evento.livre ? { ...evento, livre: false } : evento;
}

function falhaDe(erro: unknown): FalhaDaAgenda {
  if (erro instanceof ErroAgenda) return erro.falha;
  if (erro instanceof PedidoInvalido) return 'invalido';
  if (erro instanceof ErroConexao) return 'sem-internet';
  if (erro instanceof ErroScript && erro.erro === 'codigo-invalido') return 'codigo-invalido';
  return 'falhou';
}

/** Confere, chama e confere a resposta; qualquer falha vira `ErroAgenda`. */
async function pedir<T>(
  acao: string,
  conferir: () => object,
  forma: (resposta: unknown) => resposta is T,
  opcoes: OpcoesDaAgenda,
): Promise<T> {
  try {
    const dados = conferir();
    const resposta = await (opcoes.chamar ?? chamarOScript)<unknown>(acao, dados);
    if (!forma(resposta)) throw new ErroAgenda('falhou');
    return resposta;
  } catch (erro) {
    throw new ErroAgenda(falhaDe(erro));
  }
}

const respostaDeEventos = (valor: unknown): valor is { eventos: unknown[]; incompleto: boolean } =>
  typeof valor === 'object' &&
  valor !== null &&
  Array.isArray((valor as { eventos?: unknown }).eventos) &&
  typeof (valor as { incompleto?: unknown }).incompleto === 'boolean';
const remocao = (valor: unknown): valor is { removido: boolean } =>
  typeof valor === 'object' && valor !== null && typeof (valor as { removido?: unknown }).removido === 'boolean';

/**
 * Eventos de todas as agendas marcadas, de `de` a `ate` (dias de Lisboa, `ate`
 * incluído), por início. `incompleto`: o script pulou uma agenda ou bateu num
 * teto, ou algum item chegou em forma errada (fica de fora); a tela avisa.
 */
export async function listarEventos(
  periodo: { de: string; ate: string },
  opcoes: OpcoesDaAgenda = {},
): Promise<RespostaEventos> {
  const resposta = await pedir('eventos', () => lerPeriodo(periodo), respostaDeEventos, opcoes);
  const eventos = resposta.eventos.filter(eventoValido).map(comoOcupado);
  return { eventos, incompleto: resposta.incompleto || eventos.length !== resposta.eventos.length };
}

/**
 * Cria na agenda principal, com horas HH:MM de Lisboa. Sem convidados e sem
 * avisar ninguém. Sem `id`, gera um (novoIdDeEvento).
 */
export function criarEvento(novo: NovoEvento, opcoes: OpcoesDaAgenda = {}): Promise<Evento> {
  return pedir('criarEvento', () => lerNovoEvento({ ...novo, id: novo.id ?? novoIdDeEvento() }), eventoValido, opcoes);
}

/** Desfaz a criação: só apaga evento criado pelo app. `removido: false` se já não existia. */
export function removerEvento(id: string, opcoes: OpcoesDaAgenda = {}): Promise<{ removido: boolean }> {
  return pedir('removerEvento', () => ({ id: lerId({ id }) }), remocao, opcoes);
}

const marcaDeFeito = (valor: unknown): valor is { feito: boolean; gravado: boolean } =>
  typeof valor === 'object' &&
  valor !== null &&
  typeof (valor as { feito?: unknown }).feito === 'boolean' &&
  typeof (valor as { gravado?: unknown }).gravado === 'boolean';

/**
 * Põe (ou tira) o "✓ " no título de um compromisso da agenda principal.
 * `gravado: false`: o evento não é do dono (convite, outra agenda) ou sumiu;
 * o feito fica só na Central, sem erro.
 */
export function marcarEventoFeito(
  id: string,
  feito: boolean,
  opcoes: OpcoesDaAgenda = {},
): Promise<{ feito: boolean; gravado: boolean }> {
  return pedir('marcarEventoFeito', () => lerMarcaDeFeito({ id, feito }), marcaDeFeito, opcoes);
}

/**
 * Conclui (ou reabre) no Google Tarefas a tarefa de um bloco agendado na
 * Agenda. `gravado: false`: sem a tarefa, sem permissão ou sem o Google
 * Tarefas no script; o feito fica só na Central, sem erro.
 */
export function marcarTarefaGoogle(
  taskId: string,
  feito: boolean,
  dia: string | undefined,
  opcoes: OpcoesDaAgenda = {},
): Promise<{ feito: boolean; gravado: boolean }> {
  return pedir('marcarTarefaGoogle', () => lerMarcaDeTarefa({ taskId, feito, ...(dia !== undefined ? { dia } : {}) }), marcaDeFeito, opcoes);
}

const resultadosDoEspelho = (valor: unknown): valor is { resultados: ResultadoDoEspelho[] } =>
  typeof valor === 'object' &&
  valor !== null &&
  Array.isArray((valor as { resultados?: unknown }).resultados) &&
  (valor as { resultados: unknown[] }).resultados.every(
    (r) =>
      typeof r === 'object' &&
      r !== null &&
      typeof (r as ResultadoDoEspelho).id === 'string' &&
      typeof (r as ResultadoDoEspelho).ok === 'boolean' &&
      ((r as ResultadoDoEspelho).googleId === null || typeof (r as ResultadoDoEspelho).googleId === 'string'),
  );

/**
 * Espelha tarefas no Google Tarefas (lista "Central"), até LOTE_NO_MAXIMO por
 * pedido. Usa o mesmo cliente e os mesmos motivos de falha da agenda
 * (`ErroAgenda`): a fila trata os dois do mesmo jeito.
 */
export function espelharTarefas(itens: ItemDoEspelho[], opcoes: OpcoesDaAgenda = {}): Promise<{ resultados: ResultadoDoEspelho[] }> {
  return pedir('espelharTarefas', () => ({ tarefas: lerLote({ tarefas: itens }) }), resultadosDoEspelho, opcoes);
}

/** Troca a sala de um evento da agenda principal; null tira a sala. */
export function trocarSalaEvento(id: string, salaId: string | null, opcoes: OpcoesDaAgenda = {}): Promise<Evento> {
  return pedir('trocarSalaEvento', () => lerTrocaDeSala({ id, salaId }), eventoValido, opcoes);
}
