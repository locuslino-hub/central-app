// Ampliação 11/11 do feito espelhado: a tarefa da Central que o dono concluiu
// direto no Google Tarefas (lista "Central") fica concluída na Central também.
// Vale a mudança mais nova: se a Central concluiu ou reabriu a tarefa depois
// da conclusão no Google (`feitoEm` maior ou igual), fica como está na Central.
import type { ConcluidaNoGoogle } from './agenda';
import { espelhoDaTarefa, lerRegistros, salvar } from './loja';
import type { Tarefa } from './tipos';

/**
 * Conclui na Central as tarefas concluídas no Google. Grava como concluir no
 * app (sincroniza com os outros aparelhos), com `feitoEm` = a hora da
 * conclusão no Google, e sem pôr nada na fila do espelho: o Google já está
 * concluído. Lê cada tarefa na hora de gravar. Devolve quantas mudaram.
 */
export async function aplicarConcluidasNoGoogle(concluidas: readonly ConcluidaNoGoogle[]): Promise<number> {
  let mudaram = 0;
  for (const { id, em } of concluidas) {
    const [registro] = await lerRegistros([{ colecao: 'tarefas', id }]);
    const tarefa = registro as Tarefa | undefined;
    if (!tarefa || tarefa.apagado || tarefa.feito || espelhoDaTarefa(tarefa) === null) continue;
    if (typeof tarefa.feitoEm === 'number' && tarefa.feitoEm >= em) continue;
    await salvar('tarefas', { ...tarefa, feito: true, feitoEm: em }, { semEspelho: true });
    mudaram++;
  }
  return mudaram;
}
