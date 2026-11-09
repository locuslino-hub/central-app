import { salvar } from '../../src/dados/loja';
import type { ParaSalvar, Tarefa } from '../../src/dados/tipos';

/** Tarefa aberta, sem prazo, com a duração padrão ainda não confirmada. */
export function tarefa(titulo: string, extra: Partial<ParaSalvar<Tarefa>> = {}): ParaSalvar<Tarefa> {
  return {
    titulo,
    salaId: null,
    duracaoMin: 60,
    duracaoConfirmada: false,
    feito: false,
    fixada: false,
    marcar: false,
    ...extra,
  };
}

export const criar = (titulo: string, extra: Partial<ParaSalvar<Tarefa>> = {}) =>
  salvar('tarefas', tarefa(titulo, extra));
