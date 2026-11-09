import { describe, expect, it } from 'vitest';
import type { Tarefa } from '../../src/dados/tipos';
import { formatarDuracao, quandoDaTarefa, rotuloDaDuracao } from '../../src/ui/quando';
import { quandoNaLista } from '../../src/ui/tarefas-lista';

const HOJE = '2026-11-05'; // quinta

const t = (extra: Partial<Tarefa> = {}): Tarefa => ({
  id: 'a',
  atualizadoEm: 1,
  aparelho: 'x',
  titulo: 'Tarefa',
  salaId: null,
  duracaoMin: 60,
  duracaoConfirmada: false,
  feito: false,
  fixada: false,
  marcar: false,
  ...extra,
});

describe('formatarDuracao', () => {
  it.each([
    [15, '15 min'],
    [45, '45 min'],
    [60, '1 h'],
    [90, '1 h 30'],
    [120, '2 h'],
    [135, '2 h 15'],
    [1, '1 min'],
  ])('%i minutos = %s', (minutos, texto) => {
    expect(formatarDuracao(minutos)).toBe(texto);
  });
});

describe('rotuloDaDuracao', () => {
  it('enquanto não confirmada, diz "cerca de"', () => {
    expect(rotuloDaDuracao(t())).toBe('cerca de 1 h');
    expect(rotuloDaDuracao(t({ duracaoMin: 90 }))).toBe('cerca de 1 h 30');
  });
  it('confirmada, diz só o tempo', () => {
    expect(rotuloDaDuracao(t({ duracaoConfirmada: true }))).toBe('1 h');
    expect(rotuloDaDuracao(t({ duracaoMin: 30, duracaoConfirmada: true }))).toBe('30 min');
  });
});

describe('quandoDaTarefa', () => {
  it('hoje, outro dia, com prazo e compromisso', () => {
    expect(quandoDaTarefa(t({ data: HOJE }), HOJE)).toBe('Hoje');
    expect(quandoDaTarefa(t({ data: '2026-11-06' }), HOJE)).toBe('Sexta, 6/11');
    expect(quandoDaTarefa(t({ data: '2026-11-04' }), HOJE)).toBe('Quarta, 4/11');
    expect(quandoDaTarefa(t({ data: '2026-11-06', prazoHora: '17:00' }), HOJE)).toBe('Até sexta, 6/11, às 17:00');
    expect(quandoDaTarefa(t({ data: HOJE, inicio: '11:00' }), HOJE)).toBe('Hoje, às 11:00');
  });
  it('ano só quando difere do de hoje', () => {
    expect(quandoDaTarefa(t({ data: '2027-01-02' }), HOJE)).toBe('Sábado, 2/1/2027');
  });
  it('semana', () => {
    expect(quandoDaTarefa(t({ semana: '2026-11-02' }), HOJE)).toBe('Esta semana');
    expect(quandoDaTarefa(t({ semana: '2026-11-09' }), HOJE)).toBe('Próxima semana');
    expect(quandoDaTarefa(t({ semana: '2026-11-23' }), HOJE)).toBe('Semana de 23/11');
  });
  it('sem nada, Sem prazo', () => {
    expect(quandoDaTarefa(t(), HOJE)).toBe('Sem prazo');
  });
});

describe('quandoNaLista (o que a linha mostra)', () => {
  it('tarefa de hoje sem prazo não repete "Hoje"', () => {
    expect(quandoNaLista(t({ data: HOJE }), HOJE)).toBeUndefined();
    expect(quandoNaLista(t(), HOJE)).toBeUndefined();
  });
  it('compromisso de hoje mostra só a hora', () => {
    expect(quandoNaLista(t({ data: HOJE, inicio: '11:00' }), HOJE)).toBe('11:00');
  });
  it('compromisso de outro dia mostra o dia e a hora', () => {
    expect(quandoNaLista(t({ data: '2026-11-13', inicio: '11:00' }), HOJE)).toBe('Sexta, 13/11 · 11:00');
    expect(quandoNaLista(t({ data: '2026-11-03', inicio: '09:30' }), HOJE)).toBe('Terça, 3/11 · 09:30');
  });
  it('tarefa marcada para outro dia mostra o dia', () => {
    expect(quandoNaLista(t({ data: '2026-11-13' }), HOJE)).toBe('Sexta, 13/11');
  });
  it('prazo mostra o dia e a hora do prazo', () => {
    expect(quandoNaLista(t({ data: '2026-11-13', prazoHora: '17:00' }), HOJE)).toBe('Até sexta, 13/11, às 17:00');
  });
});
