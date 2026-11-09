// A fila "A seguir" e o tempo livre de hoje (Tarefa 15). Sem tela: o Painel e o
// Agora (Tarefa 16) usam isto.
//
// As contas são puras (`calcularFila`, `calcularTempoLivre`): recebem tarefas,
// e-mails, estados e eventos por argumento e nunca leem o banco, a memória nem
// o relógio. `montarFila` e `tempoLivre` são só a cola que lê o estado atual
// (o banco é assíncrono, então as duas devolvem promessa).
//
// O dia é o de Lisboa. As horas dos eventos chegam como texto de Lisboa
// (`2026-11-05T14:00:00+00:00`), e as contas de "quanto falta" seguem o relógio
// de parede, como em calendario.ts.
import { somarDias, segundaDaSemana } from '../chat/datas';
import type { Evento } from './agenda';
import { hojeEmLisboa, minutoEmLisboa } from './dia';
import { lerEmails, type Email } from './emails';
import { aparece, tituloDaTarefa } from './emails-estado';
import { lerEventos } from './eventos';
import { lerConfig, listar } from './loja';
import type { EstadoEmail, Tarefa } from './tipos';

export const DURACAO_PADRAO_MIN = 60;
export const DURACAO_EMAIL_MIN = 5;
export const FIM_DO_DIA_PADRAO = '20:00';
/** Um prazo entra na fila 7 dias antes. */
export const DIAS_DE_ANTECEDENCIA_DO_PRAZO = 7;

/**
 * Por que o item está na fila. A ordem desta lista é a ordem da fila (as
 * fixadas primeiro, os e-mails por último).
 */
export type GrupoDaFila = 'fixada' | 'atrasada' | 'hoje' | 'prazo' | 'semana' | 'email';

export type ItemFila = {
  /** Estável entre atualizações: `tarefa:<id>` ou `email:<id>`. Serve de `key` na tela. */
  chave: string;
  tipo: 'tarefa' | 'email';
  grupo: GrupoDaFila;
  titulo: string;
  minutos: number;
  /** A duração é a padrão e o dono ainda não a confirmou: a tela escreve "cerca de". */
  estimada: boolean;
  /** Só em `tipo: 'tarefa'`. */
  tarefa?: Tarefa;
  /** O e-mail do item, ou o e-mail a que a tarefa está ligada (`emailId`), se ele ainda está na lista. */
  email?: Email;
};

export type EntradaDaFila = {
  agora: Date;
  tarefas: readonly Tarefa[];
  emails: readonly Email[];
  estadosEmail: readonly EstadoEmail[];
};

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;
const temDia = (valor: string | undefined): valor is string => valor !== undefined && DIA.test(valor);

const GRUPOS: readonly GrupoDaFila[] = ['fixada', 'atrasada', 'hoje', 'prazo', 'semana', 'email'];
const porTexto = (a: string, b: string) => a.localeCompare(b, 'pt-BR');

function duracaoDa(tarefa: Tarefa): { minutos: number; estimada: boolean } {
  const valida = Number.isFinite(tarefa.duracaoMin) && tarefa.duracaoMin >= 1;
  return valida
    ? { minutos: tarefa.duracaoMin, estimada: !tarefa.duracaoConfirmada }
    : { minutos: DURACAO_PADRAO_MIN, estimada: true };
}

/** Em que grupo a tarefa entra hoje; `null` se não entra. */
function grupoDaTarefa(tarefa: Tarefa, hoje: string, limiteDoPrazo: string, segunda: string): GrupoDaFila | null {
  if (tarefa.fixada) return 'fixada';
  if (temDia(tarefa.data)) {
    if (tarefa.data < hoje) return 'atrasada';
    if (tarefa.data === hoje) return 'hoje';
    // Dia futuro: só entra o que tem prazo (hora) a 7 dias ou menos.
    return tarefa.prazoHora !== undefined && tarefa.data <= limiteDoPrazo ? 'prazo' : null;
  }
  return temDia(tarefa.semana) && tarefa.semana === segunda ? 'semana' : null;
}

/** Dentro de um grupo: o dia mais antigo primeiro; quem tem hora de prazo antes de quem não tem, pela hora; depois título. */
function dentroDoGrupo(a: Tarefa, b: Tarefa): number {
  const diaA = temDia(a.data) ? a.data : '9999-99-99';
  const diaB = temDia(b.data) ? b.data : '9999-99-99';
  if (diaA !== diaB) return diaA < diaB ? -1 : 1;
  const horaA = a.prazoHora ?? '99:99';
  const horaB = b.prazoHora ?? '99:99';
  if (horaA !== horaB) return horaA < horaB ? -1 : 1;
  return porTexto(String(a.titulo ?? ''), String(b.titulo ?? '')) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * A fila: fixadas, atrasadas, hoje, prazos dos próximos 7 dias, Esta semana e,
 * por último, os e-mails do mais antigo ao mais novo. Fora dela: concluídas,
 * apagadas e o que o dono adiou ("Agora não") para depois de hoje. Tarefa
 * ligada a um e-mail (`emailId`) é um item só: a tarefa, com o e-mail junto.
 */
export function calcularFila({ agora, tarefas, emails, estadosEmail }: EntradaDaFila): ItemFila[] {
  const hoje = hojeEmLisboa(agora);
  const limiteDoPrazo = somarDias(hoje, DIAS_DE_ANTECEDENCIA_DO_PRAZO);
  const segunda = segundaDaSemana(hoje);
  const vivas = tarefas.filter((tarefa) => !tarefa.apagado);
  const emailsPorId = new Map(emails.map((email) => [email.id, email]));

  const doGrupo = new Map<GrupoDaFila, Tarefa[]>();
  for (const tarefa of vivas) {
    if (tarefa.feito) continue;
    if (tarefa.adiadaAte !== undefined && tarefa.adiadaAte > hoje) continue;
    const grupo = grupoDaTarefa(tarefa, hoje, limiteDoPrazo, segunda);
    if (grupo) doGrupo.set(grupo, [...(doGrupo.get(grupo) ?? []), tarefa]);
  }

  const fila: ItemFila[] = [];
  for (const grupo of GRUPOS) {
    if (grupo === 'email') continue;
    for (const tarefa of (doGrupo.get(grupo) ?? []).sort(dentroDoGrupo)) {
      const email = tarefa.emailId === undefined ? undefined : emailsPorId.get(tarefa.emailId);
      fila.push({
        chave: `tarefa:${tarefa.id}`,
        tipo: 'tarefa',
        grupo,
        titulo: tarefa.titulo,
        ...duracaoDa(tarefa),
        tarefa,
        ...(email ? { email } : {}),
      });
    }
  }

  // E-mail que já virou tarefa (mesmo concluída ou sem prazo) não volta como item solto.
  const comTarefa = new Set(vivas.flatMap((tarefa) => (tarefa.emailId === undefined ? [] : [tarefa.emailId])));
  const estados = new Map(estadosEmail.map((estado) => [estado.id, estado]));
  const instante = (email: Email) => Date.parse(email.data);
  const soltos = emails
    .filter((email) => !comTarefa.has(email.id) && aparece(estados.get(email.id), hoje))
    .sort((a, b) => instante(a) - instante(b) || (a.id < b.id ? -1 : 1));
  for (const email of soltos) {
    fila.push({
      chave: `email:${email.id}`,
      tipo: 'email',
      grupo: 'email',
      titulo: tituloDaTarefa(email),
      minutos: DURACAO_EMAIL_MIN,
      estimada: false,
      email,
    });
  }
  return fila;
}

export type Encaixe = {
  item: ItemFila;
  /** Cabe agora (true) ou fica para Depois (false). */
  cabe: boolean;
  /** Minutos somados da fila até este item, ele incluído. */
  acumulado: number;
};

/**
 * Soma as durações na ordem da fila: enquanto a soma não passa de `minutos`, o
 * item cabe agora; do primeiro que estoura em diante, tudo é Depois (a fila
 * manda: um item pequeno lá atrás não fura a vez do grande). Sem tempo
 * livre (`minutos <= 0`), nada cabe.
 */
export function cabeAgora(fila: readonly ItemFila[], minutos: number): Encaixe[] {
  let acumulado = 0;
  let estourou = !(minutos > 0);
  return fila.map((item) => {
    acumulado += item.minutos;
    if (acumulado > minutos) estourou = true;
    return { item, cabe: !estourou, acumulado };
  });
}

export type TempoLivre = {
  /** `HH:MM`: até quando vai o tempo livre (começo do próximo compromisso, ou o fim do dia). */
  ate: string;
  minutos: number;
  /**
   * O compromisso que limita o tempo livre. Se um compromisso está em andamento,
   * é ele (`minutos` 0). Ausente quando nenhum compromisso limita antes do fim do dia.
   */
  proximo?: Evento;
};

export type EntradaDoTempoLivre = {
  agora: Date;
  eventos: readonly Evento[];
  /** `HH:MM`; ausente ou inválido, 20:00. */
  fimDoDia?: string;
};

const dois = (n: number) => String(n).padStart(2, '0');
const comoHora = (minutos: number) => `${dois(Math.floor(minutos / 60))}:${dois(minutos % 60)}`;

function minutosDe(hora: string): number {
  const achado = HORA.exec(hora) ?? HORA.exec(FIM_DO_DIA_PADRAO)!;
  return Number(achado[1]) * 60 + Number(achado[2]);
}

/** Hora do dia de um texto de Lisboa (`...T14:00:00+00:00`), em minutos; `undefined` se não for um. */
function minutosDoIso(iso: string): number | undefined {
  const achado = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):([0-5]\d)/.exec(iso);
  return achado ? Number(achado[1]) * 60 + Number(achado[2]) : undefined;
}

/**
 * Quanto falta até o próximo compromisso de hoje, ou até o fim do dia (também
 * nos fins de semana). Não contam eventos de dia inteiro, marcados como livres
 * nem recusados. Compromisso em andamento: 0 minuto livre.
 */
export function calcularTempoLivre({ agora, eventos, fimDoDia }: EntradaDoTempoLivre): TempoLivre {
  const hoje = hojeEmLisboa(agora);
  const agoraMin = minutoEmLisboa(agora);
  const agoraMs = agora.getTime();
  const fimMin = minutosDe(fimDoDia ?? FIM_DO_DIA_PADRAO);

  const contam = eventos.filter((e) => !e.diaInteiro && !e.livre && !e.recusado);
  const emAndamento = contam.find((e) => {
    const ini = Date.parse(e.inicio);
    const fim = Date.parse(e.fim);
    return Number.isFinite(ini) && Number.isFinite(fim) && ini <= agoraMs && agoraMs < fim;
  });
  if (emAndamento) return { ate: comoHora(agoraMin), minutos: 0, proximo: emAndamento };

  if (agoraMin >= fimMin) return { ate: comoHora(fimMin), minutos: 0 };

  let proximo: { evento: Evento; minuto: number } | undefined;
  for (const evento of contam) {
    const ini = Date.parse(evento.inicio);
    const minuto = minutosDoIso(evento.inicio);
    if (!Number.isFinite(ini) || ini <= agoraMs || minuto === undefined || evento.inicio.slice(0, 10) !== hoje) continue;
    if (minuto >= fimMin) continue;
    if (!proximo || ini < Date.parse(proximo.evento.inicio)) proximo = { evento, minuto };
  }
  if (!proximo) return { ate: comoHora(fimMin), minutos: fimMin - agoraMin };
  return { ate: comoHora(proximo.minuto), minutos: Math.max(0, proximo.minuto - agoraMin), proximo: proximo.evento };
}

// ---- Cola com o estado atual ----

/** A fila de agora: tarefas e estados do banco, e-mails da memória. */
export async function montarFila(agora: Date = new Date()): Promise<ItemFila[]> {
  const [tarefas, estadosEmail] = await Promise.all([listar('tarefas'), listar('estadosEmail')]);
  return calcularFila({ agora, tarefas, estadosEmail, emails: lerEmails().emails });
}

/**
 * O tempo livre de agora: eventos de hoje da memória (a leitura de `hoje` a
 * `hoje`, a mesma que `useEventos(hoje, hoje)` mantém) e o fim do dia dos ajustes.
 */
export async function tempoLivre(agora: Date = new Date()): Promise<TempoLivre> {
  const hoje = hojeEmLisboa(agora);
  const { fimDoDia } = await lerConfig();
  return calcularTempoLivre({ agora, eventos: lerEventos(hoje, hoje).eventos, fimDoDia });
}
