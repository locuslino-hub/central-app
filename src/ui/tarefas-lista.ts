// Que tarefa entra em qual lista (Checklist, Atividades, Sem prazo). Funções
// puras sobre `AAAA-MM-DD`, que nessa forma ordena como as datas.
//
// A virada do dia (dados/virada.ts) é quem grava a data de hoje nas tarefas que
// ficaram para trás; as listas, porém, já tratam essas tarefas como de hoje, para
// o dia certo aparecer mesmo antes de a virada gravar (ou se o aparelho estiver
// sem rede e a sincronia ainda não tiver chegado).
import { segundaDaSemana } from '../chat/datas';
import type { Tarefa } from '../dados/tipos';
import { nomeDaSemana, nomeDoDia, quandoDaTarefa } from './quando';

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const temDia = (tarefa: Tarefa): tarefa is Tarefa & { data: string } =>
  tarefa.data !== undefined && DIA.test(tarefa.data);
const temSemana = (tarefa: Tarefa): tarefa is Tarefa & { semana: string } =>
  tarefa.semana !== undefined && DIA.test(tarefa.semana);

/**
 * Prazo ou compromisso que já passou, aberto ou não (para a tarefa não mudar de
 * grupo ao ser concluída). Compromisso é tarefa com hora até a agenda do Google
 * chegar: se passou sem ser concluído, não pode sumir, então vale como atrasado.
 */
function prazoVencido(tarefa: Tarefa, hoje: string): boolean {
  return !!(tarefa.prazoHora || tarefa.inicio) && temDia(tarefa) && tarefa.data < hoje;
}

/** O aviso "Atrasada": prazo ou compromisso passado e ainda não feito. */
export function estaAtrasada(tarefa: Tarefa, hoje: string): boolean {
  return !tarefa.feito && prazoVencido(tarefa, hoje);
}

/**
 * Fixada primeiro, depois quem tem hora (compromissos, pela hora), depois por
 * título. Nada aqui depende de `feito`: concluir não muda a linha de lugar.
 */
export function porOrdem(a: Tarefa, b: Tarefa): number {
  if (a.fixada !== b.fixada) return a.fixada ? -1 : 1;
  if (!!a.inicio !== !!b.inicio) return a.inicio ? -1 : 1;
  if (a.inicio && b.inicio && a.inicio !== b.inicio) return a.inicio < b.inicio ? -1 : 1;
  return String(a.titulo ?? '').localeCompare(String(b.titulo ?? ''), 'pt-BR');
}

/**
 * Entra na Checklist do dia: o que é de hoje, o que ficou de dias anteriores e
 * ainda está aberto, prazos vencidos e compromissos passados não concluídos
 * (como atrasados). Feita só se foi hoje ou se foi concluída agora, nesta
 * página, para o "Desfazer" não sumir debaixo do dedo.
 */
export function daChecklist(tarefa: Tarefa, hoje: string, concluidasAgora: ReadonlySet<string>): boolean {
  if (!temDia(tarefa)) return false;
  if (tarefa.data > hoje) return false;
  if (!tarefa.feito) return true;
  return tarefa.data === hoje || concluidasAgora.has(tarefa.id);
}

/** Sem data e sem semana que ainda vale: o que Sem prazo lista (abertas, ou feitas agora). */
export function estaSemPrazo(tarefa: Tarefa, hoje: string): boolean {
  if (tarefa.inicio || temDia(tarefa)) return false;
  return !temSemana(tarefa) || tarefa.semana < segundaDaSemana(hoje);
}

/** `ordenaPorDia`: dentro do grupo a data decide (prazos e dias futuros). Em Hoje, não: a tarefa que veio de ontem não pula de lugar quando a virada grava. */
export type GrupoDeAtividade = { chave: string; titulo: string; ordem: number; ordenaPorDia: boolean };

const ATRASADAS: GrupoDeAtividade = { chave: 'atrasadas', titulo: 'Atrasadas', ordem: 0, ordenaPorDia: true };
const HOJE: GrupoDeAtividade = { chave: 'hoje', titulo: 'Hoje', ordem: 1, ordenaPorDia: false };
const PROXIMOS: GrupoDeAtividade = { chave: 'proximos', titulo: 'Próximos dias', ordem: 2, ordenaPorDia: true };
const SEM_PRAZO: GrupoDeAtividade = { chave: 'sem-prazo', titulo: 'Sem prazo', ordem: 4, ordenaPorDia: false };

/**
 * O grupo da tarefa em Atividades. Feita ou não, o grupo é o mesmo: concluir
 * não muda de grupo. Compromisso passado e aberto vai para Atrasadas.
 */
export function grupoDaAtividade(tarefa: Tarefa, hoje: string): GrupoDeAtividade {
  if (temDia(tarefa)) {
    if (prazoVencido(tarefa, hoje)) return ATRASADAS;
    return tarefa.data <= hoje ? HOJE : PROXIMOS;
  }
  if (temSemana(tarefa) && tarefa.semana >= segundaDaSemana(hoje)) {
    // Uma seção por semana, da mais próxima para a mais distante.
    return { chave: `semana-${tarefa.semana}`, titulo: nomeDaSemana(tarefa.semana, hoje), ordem: 3, ordenaPorDia: false };
  }
  return SEM_PRAZO;
}

/** Em listas por data, o dia que decide a ordem dentro do grupo. */
export function diaParaOrdenar(tarefa: Tarefa): string {
  return temDia(tarefa) ? tarefa.data : '';
}

/**
 * O "quando" que a linha mostra, quando ajuda: a hora do compromisso, o prazo,
 * ou o dia de uma tarefa marcada para depois. Tarefa de hoje não repete "Hoje".
 */
export function quandoNaLista(tarefa: Tarefa, hoje: string): string | undefined {
  if (tarefa.inicio) {
    if (!temDia(tarefa) || tarefa.data === hoje) return tarefa.inicio;
    return `${nomeDoDia(tarefa.data, hoje)} · ${tarefa.inicio}`;
  }
  if (tarefa.prazoHora) return quandoDaTarefa(tarefa, hoje);
  if (temDia(tarefa) && tarefa.data > hoje) return quandoDaTarefa(tarefa, hoje);
  return undefined;
}
