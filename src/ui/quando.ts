// Quando e quanto tempo, em palavras, para as telas de tarefas e para o cartão do chat.
import { diaDaSemana, segundaDaSemana, somarDias } from '../chat/datas';
import type { Tarefa } from '../dados/tipos';

const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

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
