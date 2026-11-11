// Tarefa de marcar (Tarefa 12): concluir "Marcar reunião com a Marina" abre uma
// caixa com dia e hora, e o compromisso vai para o Google Agenda. Aqui fica o
// que não é tela: sugerir o fim, conferir os campos e colocar na agenda.
import { desfazerCompromisso, criarCompromisso, type SituacaoDaAgenda } from './compromisso';
import type { Desfazivel } from './desfazer';
import { enfileirarAgenda } from './loja';
import { concluirTarefa } from './tarefas';
import type { Tarefa } from './tipos';

export type Marcacao = { dia: string; inicio: string; fim: string };

const HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DIA = /^\d{4}-\d{2}-\d{2}$/;

const minutosDe = (hora: string) => {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
};
const doisDigitos = (n: number) => String(n).padStart(2, '0');

/**
 * O fim sugerido: uma hora depois do início (15:30 vira 16:30). O dia acaba às
 * 23:59; início que não deixa uma hora inteira sugere esse fim. `''` se a hora não é válida.
 */
export function fimSugerido(inicio: string): string {
  if (!HORA.test(inicio)) return '';
  const total = Math.min(minutosDe(inicio) + 60, 23 * 60 + 59);
  return `${doisDigitos(Math.floor(total / 60))}:${doisDigitos(total % 60)}`;
}

/** O que falta ou está errado na marcação, em palavras para a caixa; `null` se está certa. */
export function erroDaMarcacao({ dia, inicio, fim }: Marcacao, hoje: string): { campo: keyof Marcacao; texto: string } | null {
  if (!DIA.test(dia)) return { campo: 'dia', texto: 'Escolha o dia.' };
  if (dia < hoje) return { campo: 'dia', texto: 'Esse dia já passou. Escolha hoje ou depois.' };
  if (!HORA.test(inicio)) return { campo: 'inicio', texto: 'Escolha a hora de início.' };
  if (!HORA.test(fim)) return { campo: 'fim', texto: 'Escolha a hora de fim.' };
  if (fim <= inicio) return { campo: 'fim', texto: 'O fim precisa ser depois do início.' };
  return null;
}

/** "Marcar reunião com a Marina" vira "Reunião com a Marina" na agenda. */
export function tituloDoCompromisso(titulo: string): string {
  const sem = titulo.trim().replace(/^marcar\s+/i, '');
  if (!sem) return titulo.trim();
  return sem.charAt(0).toUpperCase() + sem.slice(1);
}

/**
 * Compromisso já criado (ou na fila) cuja tarefa ainda não concluiu: se o dono
 * tenta de novo com os mesmos dados, o evento é o mesmo (nada duplica); com
 * dados diferentes, o anterior é desfeito antes de criar o novo.
 */
const criadosSemConcluir = new Map<string, { eventoId: string; situacao: SituacaoDaAgenda; marcacao: Marcacao }>();

const mesma = (a: Marcacao, b: Marcacao) => a.dia === b.dia && a.inicio === b.inicio && a.fim === b.fim;

/**
 * Cria o compromisso e conclui a tarefa. O desfazer devolvido remove o
 * compromisso (ou tira o pedido da fila) e reabre a tarefa; se remover falhar,
 * a tarefa segue concluída e dá para tentar de novo.
 * Se concluir falhar depois de criar, o erro sobe e o evento fica: tentar de
 * novo reaproveita o mesmo evento, sem duplicar (id apagado no Google não
 * volta, então o evento não é desfeito às cegas).
 * Tarefa que sumiu nesse meio tempo (`entrada` indefinida): o compromisso fica.
 */
export async function colocarNaAgenda(
  tarefa: Pick<Tarefa, 'id' | 'titulo' | 'salaId'>,
  marcacao: Marcacao,
): Promise<{ entrada: Desfazivel | undefined; agenda: SituacaoDaAgenda }> {
  let previo = criadosSemConcluir.get(tarefa.id);
  if (previo && !mesma(previo.marcacao, marcacao)) {
    try {
      await desfazerCompromisso(previo.eventoId);
    } catch (erro) {
      // Criar outro agora duplicaria: o dono tenta de novo.
      console.error('Não consegui desfazer o compromisso da tentativa anterior', erro);
      throw erro;
    }
    criadosSemConcluir.delete(tarefa.id);
    previo = undefined;
  }
  if (!previo) {
    const { eventoId, situacao } = await criarCompromisso({
      titulo: tituloDoCompromisso(tarefa.titulo),
      data: marcacao.dia,
      inicio: marcacao.inicio,
      fim: marcacao.fim,
      salaId: tarefa.salaId,
    });
    previo = { eventoId, situacao, marcacao: { ...marcacao } };
    criadosSemConcluir.set(tarefa.id, previo);
  }
  const { eventoId, situacao } = previo;
  let removido = false;
  const entrada = await concluirTarefa(tarefa.id, async () => {
    if (removido) return;
    await desfazerCompromisso(eventoId);
    removido = true;
  });
  criadosSemConcluir.delete(tarefa.id);
  return { entrada, agenda: situacao };
}

/**
 * O dono desistiu da agenda para esta tarefa ("Concluir sem agenda"): o
 * compromisso de uma tentativa anterior que criou o evento e não concluiu sai
 * do Google (ou da fila, se ainda não tinha saído). Se o Google recusa agora,
 * a remoção entra na fila e a sincronia a leva depois: concluir não fica preso.
 */
export async function descartarTentativaDeMarcar(tarefaId: string): Promise<void> {
  const previo = criadosSemConcluir.get(tarefaId);
  if (!previo) return;
  try {
    await desfazerCompromisso(previo.eventoId);
  } catch (erro) {
    console.error('Não consegui remover o compromisso da tentativa anterior; a remoção fica na fila', erro);
    await enfileirarAgenda({ tipo: 'agenda', acao: 'removerEvento', id: previo.eventoId });
  }
  criadosSemConcluir.delete(tarefaId);
}

/** "Concluir sem agenda": tira o que uma tentativa anterior deixou na agenda e conclui. */
export async function concluirSemAgenda(tarefaId: string): Promise<Desfazivel | undefined> {
  await descartarTentativaDeMarcar(tarefaId);
  return concluirTarefa(tarefaId);
}

/** Esquece o que ficou criado sem concluir (testes). */
export function esquecerMarcacoes() {
  criadosSemConcluir.clear();
}
