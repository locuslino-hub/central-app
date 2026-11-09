// Google Agenda pelo script (Tarefa 10): ações `eventos`, `criarEvento`,
// `removerEvento` e `trocarSalaEvento`. O pedido é conferido aqui com as
// mesmas regras do script (script/agenda.ts), então pedido inválido nem sai do
// aparelho. Erros viram `ErroAgenda` com um motivo curto para a tela.
// Sem tela nesta tarefa: as telas de calendário (T11) e a criação pelo chat (T12) usam isto.
import {
  PedidoInvalido,
  dataValida,
  lerId,
  lerNovoEvento,
  lerPeriodo,
  lerTrocaDeSala,
  linkValido,
  salaValida,
  type Evento,
  type NovoEvento,
} from '../../script/agenda';
import { ErroConexao, ErroScript, chamar as chamarOScript } from '../conexao/cliente';

export type { Evento, NovoEvento };

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
    (e.link === null || linkValido(e.link))
  );
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

const lista = (valor: unknown): valor is unknown[] => Array.isArray(valor);
const remocao = (valor: unknown): valor is { removido: boolean } =>
  typeof valor === 'object' && valor !== null && typeof (valor as { removido?: unknown }).removido === 'boolean';

/** Eventos de todas as agendas marcadas, de `de` a `ate` (dias de Lisboa, `ate` incluído), por início. */
export async function listarEventos(periodo: { de: string; ate: string }, opcoes: OpcoesDaAgenda = {}): Promise<Evento[]> {
  const itens = await pedir('eventos', () => lerPeriodo(periodo), lista, opcoes);
  // Item em forma errada fica de fora; o resto aparece.
  return itens.filter(eventoValido);
}

/** Cria na agenda principal, com horas HH:MM de Lisboa. Sem convidados e sem avisar ninguém. */
export function criarEvento(novo: NovoEvento, opcoes: OpcoesDaAgenda = {}): Promise<Evento> {
  return pedir('criarEvento', () => lerNovoEvento(novo), eventoValido, opcoes);
}

/** Desfaz a criação: só apaga evento criado pelo app. `removido: false` se já não existia. */
export function removerEvento(id: string, opcoes: OpcoesDaAgenda = {}): Promise<{ removido: boolean }> {
  return pedir('removerEvento', () => ({ id: lerId({ id }) }), remocao, opcoes);
}

/** Troca a sala de um evento da agenda principal; null tira a sala. */
export function trocarSalaEvento(id: string, salaId: string | null, opcoes: OpcoesDaAgenda = {}): Promise<Evento> {
  return pedir('trocarSalaEvento', () => lerTrocaDeSala({ id, salaId }), eventoValido, opcoes);
}
