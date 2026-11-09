// Compromisso no Google Agenda (Tarefa 12): criar, desfazer e trocar a sala.
// Sem conexão ou com o Google recusando, a criação não se perde: vai para a fila
// `pendentes` com o id do evento, que é do cliente. Repetir o pedido com o mesmo
// id não duplica (o script devolve o evento já criado), então a sincronia pode
// tentar quantas vezes precisar.
//
// Quem usa: o chat (frase de compromisso) e a tarefa de marcar (CaixaMarcar).
import { ErroAgenda, criarEvento, novoIdDeEvento, removerEvento, trocarSalaEvento } from './agenda';
import { marcarEventosObsoletos } from './eventos';
import { enfileirarAgenda, retirarCriacaoPendente, trocarSalaPendente } from './loja';
import type { EventoPendente } from './tipos';

/**
 * - `criado`: já está no Google Agenda.
 * - `sem-internet`: não deu para falar com o script; entra na agenda quando a conexão voltar.
 * - `recusada`: o script ou o Google não aceitou agora; a fila tenta de novo mais tarde.
 */
export type SituacaoDaAgenda = 'criado' | 'sem-internet' | 'recusada';

export type NovoCompromisso = Omit<EventoPendente, 'id'>;

/** Frase curta para o cartão e a caixa, ou `null` se já está na agenda. */
export function avisoDaAgenda(situacao: SituacaoDaAgenda): string | null {
  if (situacao === 'sem-internet') return 'Sem internet. O compromisso entra na agenda quando a conexão voltar.';
  if (situacao === 'recusada') return 'A agenda do Google não aceitou agora. Vou tentar de novo mais tarde.';
  return null;
}

/**
 * Cria o compromisso. Pedido que nem sai do aparelho (`invalido`) rejeita: é
 * defeito do pedido e a fila nunca daria certo. Qualquer outra falha entra na
 * fila e o resultado diz qual foi.
 */
export async function criarCompromisso(novo: NovoCompromisso): Promise<{ eventoId: string; situacao: SituacaoDaAgenda }> {
  const evento: EventoPendente = { ...novo, id: novoIdDeEvento() };
  try {
    await criarEvento(evento);
    marcarEventosObsoletos();
    return { eventoId: evento.id, situacao: 'criado' };
  } catch (erro) {
    if (erro instanceof ErroAgenda && erro.falha === 'invalido') throw erro;
    // Só o motivo, nunca o pedido: o título é do dono.
    const situacao = erro instanceof ErroAgenda && erro.falha === 'sem-internet' ? 'sem-internet' : 'recusada';
    await enfileirarAgenda({ tipo: 'agenda', acao: 'criarEvento', evento });
    return { eventoId: evento.id, situacao };
  }
}

/**
 * Desfaz a criação: se o pedido ainda está na fila, só o tira de lá (se a
 * sincronia o estiver enviando neste instante, ela mesma remove o evento
 * quando termina). Senão remove o evento; sem internet, a remoção entra na fila.
 * Pode ser chamado de novo depois de uma falha.
 */
export async function desfazerCompromisso(eventoId: string): Promise<void> {
  if (await retirarCriacaoPendente(eventoId)) return;
  try {
    await removerEvento(eventoId);
    marcarEventosObsoletos();
  } catch (erro) {
    if (erro instanceof ErroAgenda && erro.falha === 'sem-internet') {
      await enfileirarAgenda({ tipo: 'agenda', acao: 'removerEvento', id: eventoId });
      return;
    }
    throw erro;
  }
}

/** Troca a sala: na fila, se o evento ainda não saiu; senão, no Google Agenda. */
export async function trocarSalaDoCompromisso(eventoId: string, salaId: string | null): Promise<void> {
  if (await trocarSalaPendente(eventoId, salaId)) return;
  await trocarSalaEvento(eventoId, salaId);
  marcarEventosObsoletos();
}
