// O que as telas de tarefas fazem com uma tarefa (Tarefa 9). Cada operação lê o
// registro de novo na hora de escrever e muda só o seu campo: uma edição que
// chegou do outro aparelho nesse meio tempo não é desfeita. Tudo passa por `salvar`.
import { dataValida, segundaDaSemana } from '../chat/datas';
import { desfazer, type Desfazivel } from './desfazer';
import { apagar, lerRegistros, salvar } from './loja';
import type { ParaSalvar, Tarefa } from './tipos';

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
 * tarefa fica como está agora. `aoDesfazer` roda antes de reabrir, para o que
 * a conclusão fez por fora (o compromisso da tarefa de marcar); se falhar, a
 * tarefa continua concluída.
 */
export async function concluirTarefa(id: string, aoDesfazer?: () => Promise<void>): Promise<Desfazivel | undefined> {
  const feita = await atualizar(id, (tarefa) => ({ ...tarefa, feito: true }));
  if (!feita) return undefined;
  return desfazer.registrar(`Tarefa concluída: ${feita.titulo}`, async () => {
    await aoDesfazer?.();
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

// ---- Criar, editar e apagar à mão ----

const DIA_VALIDO = /^(\d{4})-(\d{2})-(\d{2})$/;
const diaExiste = (dia: string) => {
  const partes = DIA_VALIDO.exec(dia);
  return !!partes && dataValida(Number(partes[1]), Number(partes[2]), Number(partes[3]));
};

/**
 * Tarefa escrita pelo dono, sem passar pelo chat: Sem prazo, ou do dia dado.
 * Título vazio ou dia que não existe: `undefined`, sem escrever. A sala fica
 * em branco (o dono a escolhe ao editar), salvo quando quem chama já sabe: a
 * tarefa que vem de um e-mail (`emailId`) leva a sala e a pessoa dele.
 */
export async function criarTarefa(
  titulo: string,
  { data, salaId, pessoaId, emailId }: { data?: string; salaId?: string | null; pessoaId?: string; emailId?: string } = {},
): Promise<Tarefa | undefined> {
  const limpo = titulo.trim();
  if (!limpo || (data !== undefined && !diaExiste(data))) return undefined;
  const nova: ParaSalvar<Tarefa> = {
    titulo: limpo,
    salaId: salaId ?? null,
    ...(pessoaId !== undefined ? { pessoaId } : {}),
    ...(emailId !== undefined ? { emailId } : {}),
    ...(data !== undefined ? { data } : {}),
    duracaoMin: 60,
    duracaoConfirmada: false,
    feito: false,
    fixada: false,
    marcar: false,
  };
  return salvar('tarefas', nova);
}

export type NovoQuando =
  | { tipo: 'sem-prazo' }
  | { tipo: 'hoje'; hoje: string }
  | { tipo: 'semana'; hoje: string }
  | { tipo: 'dia'; dia: string };

export type Edicao = { titulo?: string; salaId?: string | null; quando?: NovoQuando };

/**
 * Muda só o que veio em `edicao`, sobre a versão atual da tarefa. `false`, sem
 * escrever, se o título ficou vazio, o dia não existe ou a tarefa sumiu.
 * Compromisso e prazo (têm hora) ficam no dia deles: só título e sala mudam.
 */
export async function editarTarefa(id: string, edicao: Edicao): Promise<boolean> {
  const titulo = edicao.titulo === undefined ? undefined : edicao.titulo.trim();
  if (titulo === '') return false;
  if (edicao.quando?.tipo === 'dia' && !diaExiste(edicao.quando.dia)) return false;
  return !!(await atualizar(id, (atual) => {
    let nova: Tarefa = { ...atual };
    if (titulo !== undefined) nova.titulo = titulo;
    if (edicao.salaId !== undefined) nova.salaId = edicao.salaId;
    const quando = edicao.quando;
    if (quando && !atual.inicio && !atual.prazoHora) {
      const { data: _data, semana: _semana, semanaVencida: _vencida, ...resto } = nova;
      nova = resto as Tarefa;
      if (quando.tipo === 'hoje') nova.data = quando.hoje;
      if (quando.tipo === 'dia') nova.data = quando.dia;
      if (quando.tipo === 'semana') nova.semana = segundaDaSemana(quando.hoje);
    }
    return nova;
  }));
}

/** Apaga e devolve a entrada do desfazer (que restaura a tarefa como era), ou `undefined` se já tinha sumido. */
export async function apagarTarefa(id: string): Promise<Desfazivel | undefined> {
  const antes = await apagar('tarefas', id);
  if (!antes) return undefined;
  return desfazer.registrar(`Tarefa apagada: ${antes.titulo}`, async () => {
    await salvar('tarefas', antes);
  });
}
