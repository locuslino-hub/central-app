// Quando e quanto tempo, em palavras, para as telas de tarefas e para o cartão do chat.
import { diaDaSemana, segundaDaSemana, somarDias } from '../chat/datas';
import type { Evento } from '../dados/agenda';
import type { Tarefa } from '../dados/tipos';

const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const DIAS_POR_EXTENSO = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
const ABREVIACOES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/** Meses por extenso, com maiúscula. Lista fixa: não depende do idioma do aparelho. */
export const NOMES_DOS_MESES = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

export const minuscula = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** `6/11`, com o ano só quando não é o de hoje. */
export function diaMes(data: string, hoje: string): string {
  const [ano, mes, dia] = data.split('-').map(Number);
  return ano === Number(hoje.slice(0, 4)) ? `${dia}/${mes}` : `${dia}/${mes}/${ano}`;
}

/** "Hoje"; senão o dia da semana e a data, que confirmam qual sexta era. */
export function nomeDoDia(data: string, hoje: string): string {
  return data === hoje ? 'Hoje' : `${DIAS[diaDaSemana(data)]}, ${diaMes(data, hoje)}`;
}

/** "Esta semana", "Próxima semana" ou "Semana de 23/11". `semana` é a segunda-feira. */
export function nomeDaSemana(semana: string, hoje: string): string {
  const esta = segundaDaSemana(hoje);
  if (semana === esta) return 'Esta semana';
  if (semana === somarDias(esta, 7)) return 'Próxima semana';
  return `Semana de ${diaMes(semana, hoje)}`;
}

/** Quando a tarefa é, em palavras: "Hoje", "Sexta, 6/11", "Até sexta, 6/11, às 17:00", "Esta semana", "Sem prazo". */
export function quandoDaTarefa(
  tarefa: Pick<Tarefa, 'data' | 'semana' | 'prazoHora' | 'inicio'>,
  hoje: string,
): string {
  if (tarefa.data) {
    const dia = nomeDoDia(tarefa.data, hoje);
    if (tarefa.prazoHora) return `Até ${minuscula(dia)}, às ${tarefa.prazoHora}`;
    if (tarefa.inicio) return `${dia}, às ${tarefa.inicio}`;
    return dia;
  }
  if (tarefa.semana) return nomeDaSemana(tarefa.semana, hoje);
  return 'Sem prazo';
}

/** `45 min`, `1 h`, `1 h 30`. */
export function formatarDuracao(minutos: number): string {
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return resto === 0 ? `${horas} h` : `${horas} h ${resto}`;
}

/** Com a duração ainda não confirmada, o app diz "cerca de" (spec, seção 8). */
export function rotuloDaDuracao(tarefa: Pick<Tarefa, 'duracaoMin' | 'duracaoConfirmada'>): string {
  const tempo = formatarDuracao(tarefa.duracaoMin);
  return tarefa.duracaoConfirmada ? tempo : `cerca de ${tempo}`;
}

/**
 * Quando o evento acontece, inteiro e com os dias: "Hoje, das 09:00 às 10:30",
 * "Hoje, 22:00, até sexta, 6/11, 01:00", "De hoje até sábado, 7/11, dia inteiro".
 * As horas são as de Lisboa que o script mandou.
 */
export function quandoDoEvento(evento: Pick<Evento, 'inicio' | 'fim' | 'diaInteiro'>, hoje: string): string {
  const hora = (iso: string) => iso.slice(11, 16);
  if (evento.diaInteiro) {
    const ultimo = somarDias(evento.fim, -1);
    if (ultimo <= evento.inicio) return `${nomeDoDia(evento.inicio, hoje)}, dia inteiro`;
    const primeiro = evento.inicio === hoje ? 'hoje' : minuscula(nomeDoDia(evento.inicio, hoje));
    return `De ${primeiro} até ${minuscula(nomeDoDia(ultimo, hoje))}, dia inteiro`;
  }
  const diaInicio = evento.inicio.slice(0, 10);
  const diaFim = evento.fim.slice(0, 10);
  if (diaFim === diaInicio) {
    const a = hora(evento.inicio);
    const b = hora(evento.fim);
    return a === b ? `${nomeDoDia(diaInicio, hoje)}, ${a}` : `${nomeDoDia(diaInicio, hoje)}, das ${a} às ${b}`;
  }
  return `${nomeDoDia(diaInicio, hoje)}, ${hora(evento.inicio)}, até ${minuscula(nomeDoDia(diaFim, hoje))}, ${hora(evento.fim)}`;
}

const partesDoDia = (data: string) => data.split('-').map(Number) as [number, number, number];
const mesPorExtenso = (mes: number) => minuscula(NOMES_DOS_MESES[mes - 1]);

/** "Quinta-feira, 5 de novembro", com o ano só quando não é o de `hoje`. */
export function diaPorExtenso(data: string, hoje: string): string {
  const [ano, mes, dia] = partesDoDia(data);
  const base = `${DIAS_POR_EXTENSO[diaDaSemana(data)]}, ${dia} de ${mesPorExtenso(mes)}`;
  return ano === Number(hoje.slice(0, 4)) ? base : `${base} de ${ano}`;
}

/** "Qui". */
export const abreviacaoDoDia = (data: string): string => ABREVIACOES[diaDaSemana(data)];

/** "2 a 8 de novembro de 2026", "26 de outubro a 1 de novembro de 2026" ou com os dois anos. */
export function periodoPorExtenso(de: string, ate: string): string {
  const [a1, m1, d1] = partesDoDia(de);
  const [a2, m2, d2] = partesDoDia(ate);
  if (a1 === a2 && m1 === m2) return `${d1} a ${d2} de ${mesPorExtenso(m2)} de ${a2}`;
  if (a1 === a2) return `${d1} de ${mesPorExtenso(m1)} a ${d2} de ${mesPorExtenso(m2)} de ${a2}`;
  return `${d1} de ${mesPorExtenso(m1)} de ${a1} a ${d2} de ${mesPorExtenso(m2)} de ${a2}`;
}
