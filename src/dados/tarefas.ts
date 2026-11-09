// O que as telas de tarefas fazem com uma tarefa (Tarefa 9). Cada operação lê o
// registro de novo na hora de escrever e muda só o seu campo: uma edição que
// chegou do outro aparelho nesse meio tempo não é desfeita. Tudo passa por `salvar`.
import { dataValida, segundaDaSemana } from '../chat/datas';
import { desfazer, type Desfazivel } from './desfazer';
import { lerRegistros, salvar } from './loja';
import type { Tarefa } from './tipos';

async function lerTarefa(id: string): Promise<Tarefa | undefined> {
  const [registro] = await lerRegistros([{ colecao: 'tarefas', id }]);
  const tarefa = registro as Tarefa | undefined;
  return tarefa && !tarefa.apagado ? tarefa : undefined;
}

/** Aplica `mudar` à versão atual da tarefa. `undefined` se ela não existe mais. */
async function atualizar(id: string, mudar: (tarefa: Tarefa) => Tarefa): Promise<Tarefa | undefined> {
  const atual = await lerTarefa(id);
  return atual && (await salvar('tarefas', mudar(atual)));
}

/** Sem `semana` nem `semanaVencida`: escolher quando fazer encerra o aviso da semana. */
function semSemana({ semana: _semana, semanaVencida: _vencida, ...resto }: Tarefa): Omit<Tarefa, 'semana' | 'semanaVencida'> {
  return resto;
}

export async function reabrirTarefa(id: string): Promise<boolean> {
  return !!(await atualizar(id, (tarefa) => ({ ...tarefa, feito: false })));
}

/**
 * Conclui e devolve a entrada do desfazer (a mesma da pilha do app), ou
 * `undefined` se a tarefa não existe mais. Desfazer só reabre: o resto da
 * tarefa fica como está agora.
 */
export async function concluirTarefa(id: string): Promise<Desfazivel | undefined> {
  const feita = await atualizar(id, (tarefa) => ({ ...tarefa, feito: true }));
  if (!feita) return undefined;
  return desfazer.registrar(`Tarefa concluída: ${feita.titulo}`, async () => {
    await reabrirTarefa(id);
  });
}

export async function moverParaHoje(id: string, hoje: string): Promise<boolean> {
  return !!(await atualizar(id, (tarefa) => ({ ...semSemana(tarefa), data: hoje })));
}

/** "Esta semana": a tarefa fica na semana (a segunda-feira dela) sem dia fixo. */
export async function moverParaSemana(id: string, hoje: string): Promise<boolean> {
  return !!(await atualizar(id, ({ data: _data, ...resto }) => ({
    ...semSemana(resto as Tarefa),
    semana: segundaDaSemana(hoje),
  })));
}

/** `dia`: `AAAA-MM-DD` que existe no calendário. Devolve `false` sem escrever se não for. */
export async function moverParaDia(id: string, dia: string): Promise<boolean> {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia);
  if (!partes || !dataValida(Number(partes[1]), Number(partes[2]), Number(partes[3]))) return false;
  return !!(await atualizar(id, (tarefa) => ({ ...semSemana(tarefa), data: dia })));
}

/** O dono leu o aviso de que a semana acabou. */
export async function darCiencia(id: string): Promise<boolean> {
  return !!(await atualizar(id, ({ semanaVencida: _vencida, ...resto }) => resto as Tarefa));
}

/** Confirma a duração (mesmo que seja a padrão): o app deixa de dizer "cerca de". */
export async function confirmarDuracao(id: string, minutos: number): Promise<boolean> {
  if (!Number.isInteger(minutos) || minutos < 1 || minutos > 24 * 60) return false;
  return !!(await atualizar(id, (tarefa) => ({ ...tarefa, duracaoMin: minutos, duracaoConfirmada: true })));
}
