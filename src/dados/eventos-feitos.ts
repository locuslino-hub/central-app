// "Feito" de compromisso (spec do feito espelhado). A Central é onde o dono
// marca: o feito fica num registro da coleção `eventosFeitos`, que sincroniza
// pelo Drive e aparece na hora nos dois aparelhos. Nos compromissos do dono
// (agenda principal, organizados por ele) entra também um pedido na fila para
// o script pôr "✓ " no título do Google. Convites de outras pessoas e eventos
// de outras agendas ficam só na Central, sem erro.
import type { Evento } from './agenda';
import { enfileirarMarcaDeFeito, enfileirarMarcaDeTarefa, lerRegistros, salvar } from './loja';
import type { EventoFeito } from './tipos';

/** Hash de 53 bits (cyrb53) em base 36: id fixo, curto e válido para qualquer id de evento. */
export function resumo(texto: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36).padStart(11, '0');
}

/** O id do registro de feito de um evento: o mesmo em todo aparelho. */
export function idDoFeito(agendaId: string, eventoId: string): string {
  return `feito-${resumo(`${agendaId}|${eventoId}`)}`;
}

/** O app pode pôr o "✓ " no Google? Só na agenda principal e em evento que o script não marcou como somente leitura. */
export function gravavelNoGoogle(evento: Pick<Evento, 'agendaId' | 'somenteLeitura'>): boolean {
  return evento.agendaId === 'primary' && evento.somenteLeitura !== true;
}

/**
 * Os eventos com o feito que vale. Regra de conflito:
 * - sem registro na Central, vale o do Google ("✓ " no título; num bloco do
 *   Google Tarefas, o estado da tarefa);
 * - compromisso comum: o registro da Central vale (é o último toque do dono;
 *   o Google só espelha);
 * - bloco do Google Tarefas com o estado lido lá (`tarefaAtualizadaEm`): vale
 *   o mais recente. O Google vence só se a tarefa mudou depois do último toque
 *   na Central (empate fica com a Central). Assim um ✓ dado no Google aparece
 *   na Central, e um ✓ dado na Central não é desfeito por uma leitura antiga.
 * Devolve a mesma lista se nada muda.
 */
export function aplicarFeitos(eventos: Evento[], registros: readonly EventoFeito[] | undefined): Evento[] {
  if (!registros || registros.length === 0) return eventos;
  const porId = new Map(registros.filter((r) => !r.apagado).map((r) => [r.id, r]));
  let mudou = false;
  const lista = eventos.map((evento) => {
    const registro = porId.get(idDoFeito(evento.agendaId, evento.id));
    if (!registro || registro.eventoId !== evento.id || !!evento.feito === registro.feito) return evento;
    if (evento.tarefaAtualizadaEm !== undefined && evento.tarefaAtualizadaEm > registro.atualizadoEm) return evento;
    mudou = true;
    const { feito: _feito, ...resto } = evento;
    return registro.feito ? { ...resto, feito: true } : resto;
  });
  return mudou ? lista : eventos;
}

/**
 * Marca (ou desmarca) o compromisso como feito em `dia` (`AAAA-MM-DD`). O
 * registro relido na hora de gravar só muda o `feito` e o dia.
 */
export async function marcarCompromissoFeito(evento: Evento, feito: boolean, dia: string): Promise<EventoFeito> {
  const id = idDoFeito(evento.agendaId, evento.id);
  const [atual] = (await lerRegistros([{ colecao: 'eventosFeitos', id }])) as (EventoFeito | undefined)[];
  const salvo = await salvar('eventosFeitos', {
    ...(atual && !atual.apagado ? atual : {}),
    id,
    eventoId: evento.id,
    agendaId: evento.agendaId,
    data: dia,
    feito,
  });
  // Bloco do Google Tarefas: o feito vai à tarefa (o título do bloco nunca muda).
  if (evento.tarefaGoogleId !== undefined) await enfileirarMarcaDeTarefa(evento.tarefaGoogleId, feito);
  else if (gravavelNoGoogle(evento)) await enfileirarMarcaDeFeito(evento.id, feito);
  return salvo;
}
