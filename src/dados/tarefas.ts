// O que as telas de tarefas fazem com uma tarefa (Tarefa 9). Cada operação lê o
// registro de novo na hora de escrever e muda só o seu campo: uma edição que
// chegou do outro aparelho nesse meio tempo não é desfeita. Tudo passa por `salvar`.
import { dataValida, segundaDaSemana, somarDias } from '../chat/datas';
import { desfazer, emLote, type Desfazivel } from './desfazer';
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

// ---- Agora e Fechar o dia (Tarefa 16) ----

/**
 * "Agora não" do Agora: a tarefa sai da fila até amanhã (`adiadaAte`). Ela
 * continua onde estava (na checklist de hoje, por exemplo). Desfazer devolve o
 * adiamento que havia antes, ou nenhum.
 */
export async function adiarTarefa(id: string, hoje: string): Promise<Desfazivel | undefined> {
  const antes = await lerTarefa(id);
  if (!antes) return undefined;
  const anterior = antes.adiadaAte;
  const feita = await atualizar(id, (tarefa) => ({ ...tarefa, adiadaAte: somarDias(hoje, 1) }));
  if (!feita) return undefined;
  return desfazer.registrar(`Volta amanhã: ${feita.titulo}`, async () => {
    await atualizar(id, ({ adiadaAte: _adiada, ...resto }) =>
      (anterior === undefined ? resto : { ...resto, adiadaAte: anterior }) as Tarefa,
    );
  });
}

/** Para onde Fechar o dia leva uma tarefa que ficou: o dia seguinte a `hoje`, ou Sem prazo. */
export type Destino = { tipo: 'amanha'; hoje: string } | { tipo: 'sem-prazo' };

type Lugar = Pick<Tarefa, 'data' | 'semana' | 'semanaVencida'>;

/** Move sem registrar o desfazer; devolve o lugar de antes e o título, ou `undefined` se não moveu. */
async function moverSemRegistrar(id: string, destino: Destino): Promise<{ lugar: Lugar; titulo: string } | undefined> {
  if (destino.tipo === 'amanha' && !diaExiste(destino.hoje)) return undefined;
  const antes = await lerTarefa(id);
  if (!antes) return undefined;
  // Prazo fica com o seu dia (mudar o prazo é outra decisão: `mudarPrazo`).
  if (antes.prazoHora) return undefined;
  // Compromisso antigo tem hora: sem dia, perderia o sentido.
  if (destino.tipo === 'sem-prazo' && antes.inicio) return undefined;
  const lugar: Lugar = { data: antes.data, semana: antes.semana, semanaVencida: antes.semanaVencida };
  const feita = await atualizar(id, (tarefa) => {
    const { data: _data, ...resto } = semSemana(tarefa) as Tarefa;
    return (destino.tipo === 'amanha' ? { ...resto, data: somarDias(destino.hoje, 1) } : resto) as Tarefa;
  });
  return feita && { lugar, titulo: feita.titulo };
}

/** Devolve data, semana e aviso da semana como eram; o resto da tarefa fica como está agora. */
function devolverLugar(id: string, lugar: Lugar) {
  return async () => {
    await atualizar(id, ({ data: _data, semana: _semana, semanaVencida: _vencida, ...resto }) => {
      const volta: Partial<Lugar> = {};
      if (lugar.data !== undefined) volta.data = lugar.data;
      if (lugar.semana !== undefined) volta.semana = lugar.semana;
      if (lugar.semanaVencida !== undefined) volta.semanaVencida = lugar.semanaVencida;
      return { ...resto, ...volta } as Tarefa;
    });
  };
}

const rotuloDoDestino = (destino: Destino) => (destino.tipo === 'amanha' ? 'Para amanhã' : 'Em Sem prazo');

/**
 * Leva a tarefa para amanhã ou para Sem prazo (Fechar o dia) e devolve a
 * entrada do desfazer. `undefined`, sem gravar, se a tarefa sumiu, o dia não
 * existe, ela tem prazo (o prazo não anda sozinho) ou é compromisso e o
 * destino é Sem prazo.
 */
export async function moverTarefa(id: string, destino: Destino): Promise<Desfazivel | undefined> {
  const movida = await moverSemRegistrar(id, destino);
  if (!movida) return undefined;
  return desfazer.registrar(`${rotuloDoDestino(destino)}: ${movida.titulo}`, devolverLugar(id, movida.lugar));
}

/**
 * Várias de uma vez ("Passar as 3 para amanhã"), com um Desfazer só. As que
 * têm prazo ficam (ver `moverTarefa`). Se uma escrita falhar no meio, o que já
 * andou ganha o seu Desfazer mesmo assim (o erro sobe como `EmParte`).
 */
export function moverTarefas(ids: readonly string[], destino: Destino): Promise<Desfazivel | undefined> {
  return emLote(
    ids.map((id) => async () => {
      const movida = await moverSemRegistrar(id, destino);
      return movida && devolverLugar(id, movida.lugar);
    }),
    (n) => {
      const quantas = n === 1 ? '1 tarefa' : `${n} tarefas`;
      return destino.tipo === 'amanha' ? `${quantas} para amanhã` : `${quantas} em Sem prazo`;
    },
  );
}

/**
 * Muda o prazo (dia e hora) de uma tarefa com prazo. Desfazer devolve o dia e
 * a hora de antes. `undefined`, sem gravar, se a tarefa sumiu, não tem prazo,
 * o dia não existe ou a hora não é `HH:MM`.
 */
export async function mudarPrazo(id: string, dia: string, hora: string): Promise<Desfazivel | undefined> {
  if (!diaExiste(dia) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) return undefined;
  const antes = await lerTarefa(id);
  if (!antes?.prazoHora) return undefined;
  const { data, prazoHora } = antes;
  const feita = await atualizar(id, (tarefa) => ({ ...semSemana(tarefa), data: dia, prazoHora: hora }) as Tarefa);
  if (!feita) return undefined;
  return desfazer.registrar(`Prazo mudado: ${feita.titulo}`, async () => {
    await atualizar(id, (tarefa) => ({ ...tarefa, ...(data !== undefined ? { data } : {}), prazoHora }));
  });
}
