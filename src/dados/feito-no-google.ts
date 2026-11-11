// Ampliação 11/11 do feito espelhado: a tarefa da Central que o dono concluiu
// direto no Google Tarefas (lista "Central") fica concluída na Central também.
// Vale a mudança mais nova: se a Central concluiu ou reabriu a tarefa depois
// da conclusão no Google (`feitoEm` maior ou igual), fica como está na Central.
// E a conclusão que o próprio app mandou ao Google (`conclusaoPropria`) nunca
// volta como se fosse do dono.
//
// Limite conhecido: a mesclagem do Drive é por registro (vence o maior
// `atualizadoEm`), não por campo. Se outro aparelho editar a tarefa antes de
// receber esta conclusão, a versão dele (aberta) vence; o próximo espelho
// dessa edição recebe `concluidaEm` do script e conclui de novo.
import type { ConcluidaNoGoogle } from './agenda';
import { espelhoDaTarefa, lerConclusoesProprias, lerRegistros, salvar } from './loja';
import type { Tarefa } from './tipos';

/**
 * Conclui na Central as tarefas concluídas no Google. Grava como concluir no
 * app (sincroniza com os outros aparelhos), com `feitoEm` = a hora da
 * conclusão no Google, e sem pôr nada na fila do espelho: o Google já está
 * concluído. Lê cada tarefa na hora de gravar. Devolve quantas mudaram.
 */
export async function aplicarConcluidasNoGoogle(concluidas: readonly ConcluidaNoGoogle[]): Promise<number> {
  let mudaram = 0;
  const proprias = await lerConclusoesProprias(concluidas.map(({ id }) => id));
  for (const [i, { id, em }] of concluidas.entries()) {
    const propria = proprias[i];
    if (propria !== undefined && em <= propria) continue;
    const [registro] = await lerRegistros([{ colecao: 'tarefas', id }]);
    const tarefa = registro as Tarefa | undefined;
    if (!tarefa || tarefa.apagado || tarefa.feito || espelhoDaTarefa(tarefa) === null) continue;
    if (typeof tarefa.feitoEm === 'number' && tarefa.feitoEm >= em) continue;
    await salvar('tarefas', { ...tarefa, feito: true, feitoEm: em }, { semEspelho: true });
    mudaram++;
  }
  return mudaram;
}
