import { describe, expect, it } from 'vitest';
import {
  dataValida, diaDaSemana, normalizar, segundaDaSemana, somarDias, somarMinutos,
} from '../../src/chat/datas';

describe('aritmética de datas', () => {
  it('somarDias atravessa mês, ano e fevereiro bissexto', () => {
    expect(somarDias('2026-11-05', 1)).toBe('2026-11-06');
    expect(somarDias('2026-11-30', 1)).toBe('2026-12-01');
    expect(somarDias('2026-12-31', 1)).toBe('2027-01-01');
    expect(somarDias('2028-02-28', 1)).toBe('2028-02-29');
    expect(somarDias('2027-02-28', 1)).toBe('2027-03-01');
    expect(somarDias('2026-11-05', -5)).toBe('2026-10-31');
  });

  it('diaDaSemana: 0 = domingo', () => {
    expect(diaDaSemana('2026-11-05')).toBe(4); // quinta
    expect(diaDaSemana('2026-11-08')).toBe(0); // domingo
    expect(diaDaSemana('2026-11-09')).toBe(1); // segunda
  });

  it('segundaDaSemana devolve a segunda-feira, inclusive no domingo', () => {
    expect(segundaDaSemana('2026-11-05')).toBe('2026-11-02');
    expect(segundaDaSemana('2026-11-02')).toBe('2026-11-02');
    expect(segundaDaSemana('2026-11-08')).toBe('2026-11-02');
    expect(segundaDaSemana('2027-01-01')).toBe('2026-12-28');
  });

  it('dataValida recusa dias que não existem', () => {
    expect(dataValida(2026, 11, 30)).toBe(true);
    expect(dataValida(2026, 11, 31)).toBe(false);
    expect(dataValida(2027, 2, 29)).toBe(false);
    expect(dataValida(2028, 2, 29)).toBe(true);
    expect(dataValida(2026, 13, 1)).toBe(false);
    expect(dataValida(2026, 1, 0)).toBe(false);
  });

  it('somarMinutos não passa da meia-noite', () => {
    expect(somarMinutos('11:00', 60)).toBe('12:00');
    expect(somarMinutos('09:45', 60)).toBe('10:45');
    expect(somarMinutos('23:30', 60)).toBe('23:59');
  });

  it('normalizar tira acentos e caixa sem mudar o comprimento', () => {
    const s = 'Início às 11h, TÉRMINO 12h; Orientações, ç';
    expect(normalizar(s)).toBe('inicio as 11h, termino 12h; orientacoes, c');
    expect(normalizar(s)).toHaveLength(s.length);
    const emoji = 'Reunião 🎓 amanhã';
    expect(normalizar(emoji)).toHaveLength(emoji.length);
  });
});
