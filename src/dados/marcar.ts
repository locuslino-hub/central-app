// Tarefa de marcar (Tarefa 12): concluir "Marcar reunião com a Marina" abre uma
// caixa com dia e hora, e o compromisso vai para o Google Agenda. Aqui fica o
// que não é tela: sugerir o fim, conferir os campos e colocar na agenda.
import { desfazerCompromisso, criarCompromisso, type SituacaoDaAgenda } from './compromisso';
import type { Desfazivel } from './desfazer';
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
 * Cria o compromisso e conclui a tarefa. O desfazer devolvido remove o
 * compromisso (ou tira o pedido da fila) e reabre a tarefa. Se concluir falhar
 * depois de criar, o compromisso criado é desfeito e o erro sobe: nada fica pela metade.
 * Tarefa que sumiu nesse meio tempo (`entrada` indefinida): o compromisso fica.
 */
export async function colocarNaAgenda(
  tarefa: Pick<Tarefa, 'id' | 'titulo' | 'salaId'>,
  { dia, inicio, fim }: Marcacao,
): Promise<{ entrada: Desfazivel | undefined; agenda: SituacaoDaAgenda }> {
  const { eventoId, situacao } = await criarCompromisso({
    titulo: tituloDoCompromisso(tarefa.titulo),
    data: dia,
    inicio,
    fim,
    salaId: tarefa.salaId,
  });
  try {
    const entrada = await concluirTarefa(tarefa.id, () => desfazerCompromisso(eventoId));
    return { entrada, agenda: situacao };
  } catch (erro) {
    await desfazerCompromisso(eventoId).catch(() => {});
    throw erro;
  }
}
