// Migração dos compromissos antigos (Tarefa 12): até aqui o chat guardava
// compromisso como tarefa com hora de início (`Tarefa.inicio`, R28). Agora o
// compromisso mora no Google Agenda. Esta migração leva cada tarefa dessas para
// lá e a apaga (lápide, que sincroniza), uma vez e sem duplicar:
// - o id do evento sai do id da tarefa, então os dois aparelhos chegam ao mesmo
//   evento, e o script devolve o já criado em vez de criar outro;
// - a tarefa só some na mesma escrita que põe o pedido na fila, e a fila só
//   esvazia quando o script confirma;
// - tarefa que a agenda recusaria (hora que não existe, título comprido) fica
//   como está, para nada se perder.
import { lerNovoEvento } from '../../script/agenda';
import { levarTarefasParaAgenda, listar } from './loja';
import type { EventoPendente, Tarefa } from './tipos';

const HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;

const doisDigitos = (n: number) => String(n).padStart(2, '0');

/** `HH:MM` de `inicio` mais `duracaoMin`, sem passar da meia-noite; `null` se não sobra tempo no dia. */
function fimDe(inicio: string, duracaoMin: number): string | null {
  const partes = HORA.exec(inicio);
  if (!partes) return null;
  const comeco = Number(partes[1]) * 60 + Number(partes[2]);
  const minutos = Math.min(comeco + Math.max(1, Math.round(duracaoMin) || 60), 23 * 60 + 59);
  return minutos > comeco ? `${doisDigitos(Math.floor(minutos / 60))}:${doisDigitos(minutos % 60)}` : null;
}

/** Id de evento (32 hexadecimais) que só depende da tarefa. */
async function idDoEvento(tarefaId: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`compromisso-migrado:${tarefaId}`));
  return [...new Uint8Array(bytes).slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function eventoDe(tarefa: Tarefa): Promise<EventoPendente | null> {
  if (!tarefa.data || !tarefa.inicio) return null;
  const fim = fimDe(tarefa.inicio, tarefa.duracaoMin);
  if (!fim) return null;
  const id = await idDoEvento(tarefa.id);
  // A mesma conferência do script: pedido que ele recusaria não sai da tarefa.
  for (const salaId of [tarefa.salaId, null]) {
    const evento = { id, titulo: tarefa.titulo, data: tarefa.data, inicio: tarefa.inicio, fim, salaId };
    try {
      lerNovoEvento(evento);
      return evento;
    } catch {
      // tenta sem a sala (sala que a agenda não conhece); depois desiste
    }
  }
  return null;
}

/** Quantas tarefas foram levadas para a fila da agenda. Pode rodar quantas vezes quiser. */
export async function migrarCompromissos(): Promise<number> {
  const planos: { tarefaId: string; evento: EventoPendente }[] = [];
  for (const tarefa of await listar('tarefas')) {
    if (!tarefa.inicio) continue;
    const evento = await eventoDe(tarefa);
    if (evento) planos.push({ tarefaId: tarefa.id, evento });
  }
  return levarTarefasParaAgenda(planos);
}
