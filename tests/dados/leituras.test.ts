// Leituras de consumo (V02, Tarefa 13): ler a planilha como leituras, sem quebrar com linha estranha. Valores fictícios.
import { describe, expect, it } from 'vitest';
import { dataDeTexto, dataEmBr, leituraDeTexto, lembreteDeEnvio, numeroEmBr, resumirLeituras } from '../../src/dados/leituras';
import type { LinhaDaPlanilha } from '../../src/dados/planilhas';

const linha = (id: string, Data: string, Leitura: string, extra: Partial<LinhaDaPlanilha> & { Observação?: string } = {}): LinhaDaPlanilha => {
  const { Observação, ...resto } = extra;
  return { id, valores: { Data, Leitura, Unidade: 'm³', ...(Observação ? { Observação } : {}) }, ...resto };
};

describe('dataDeTexto', () => {
  it.each([
    ['2026-11-05', '2026-11-05'],
    ['05/11/2026', '2026-11-05'],
    ['5/1/2026', '2026-01-05'],
    ['05.11.2026', '2026-11-05'],
    [' 05/11/2026 ', '2026-11-05'],
  ])('%s → %s', (texto, esperado) => expect(dataDeTexto(texto)).toBe(esperado));

  it.each(['', 'ontem', '30/02/2026', '2026-13-01', '31/04/2026', '05/11/26'])('%s não é data', (texto) => expect(dataDeTexto(texto)).toBeNull());
});

describe('leituraDeTexto', () => {
  it.each([
    ['1234', 1234],
    ['1234,5', 1234.5],
    ['1234.5', 1234.5],
    ['1.234,5', 1234.5],
    [' 12 ', 12],
    ['0', 0],
  ])('%s → %s', (texto, esperado) => expect(leituraDeTexto(texto)).toBe(esperado));

  it.each(['', 'abc', '-5', '12 m³', '1,2,3'])('%s não é leitura', (texto) => expect(leituraDeTexto(texto)).toBeNull());
});

describe('formatos', () => {
  it('data e número do jeito do Brasil', () => {
    expect(dataEmBr('2026-11-05')).toBe('05/11/2026');
    expect(numeroEmBr(1234.5)).toBe('1.234,5');
    expect(numeroEmBr(0.1 + 0.2)).toBe('0,3');
  });
});

describe('resumirLeituras', () => {
  it('ordena por data, calcula o consumo e soma por mês, não importa a ordem das linhas', () => {
    const r = resumirLeituras([linha('c', '01/11/2026', '1012'), linha('a', '15/09/2026', '980'), linha('b', '01/10/2026', '1000')]);
    expect(r.leituras.map((l) => [l.id, l.consumo])).toEqual([['a', null], ['b', 20], ['c', 12]]);
    expect(r.porMes).toEqual([{ mes: '2026-10', consumo: 20 }, { mes: '2026-11', consumo: 12 }]);
    expect(r.ignoradas).toBe(0);
  });

  it('leitura menor: consumo null com aviso; a seguinte compara com a menor', () => {
    const r = resumirLeituras([linha('a', '2026-10-01', '1000'), linha('b', '2026-11-01', '980'), linha('c', '2026-11-03', '990')]);
    expect(r.leituras.map((l) => [l.consumo, l.aviso])).toEqual([[null, undefined], [null, 'leitura_menor'], [10, undefined]]);
  });

  it('o que não dá para ler fica fora e é contado; nada quebra', () => {
    const r = resumirLeituras([linha('a', '2026-10-01', '1000'), linha('b', 'semana passada', '1005'), linha('c', '2026-11-01', 'xyz'), { id: 'd', valores: {} }, linha('e', '2026-11-02', '1012')]);
    expect(r.leituras.map((l) => l.id)).toEqual(['a', 'e']);
    expect(r.ignoradas).toBe(3);
  });

  it('anexo na fila entra na conta e é marcado; anexo parado fica à parte, fora da conta', () => {
    const r = resumirLeituras([linha('a', '2026-10-01', '1000'), linha('b', '2026-11-01', '1010', { pendente: 'fila' }), linha('c', '2026-11-02', '1020', { pendente: 'parada' })]);
    expect(r.leituras.map((l) => [l.id, l.pendente, l.consumo])).toEqual([['a', undefined, null], ['b', 'fila', 10]]);
    expect(r.naoSalvas).toEqual([{ id: 'c', data: '2026-11-02', leitura: '1020' }]);
  });

  it('observação vai junto; mesmo dia desempata pela leitura', () => {
    const r = resumirLeituras([linha('b', '2026-11-01', '1005'), linha('a', '2026-11-01', '1000', { Observação: 'manhã' })]);
    expect(r.leituras.map((l) => [l.id, l.observacao])).toEqual([['a', 'manhã'], ['b', '']]);
  });

  it('sem linhas: tudo vazio', () => {
    expect(resumirLeituras([])).toEqual({ leituras: [], porMes: [], ignoradas: 0, naoSalvas: [] });
  });
});

describe('lembreteDeEnvio', () => {
  const registro = (diaDeEnvio?: number) => ({ tipo: 'registro' as const, ...(diaDeEnvio === undefined ? {} : { diaDeEnvio }) });

  it('avisa até 3 dias antes (hoje conta como 0) e não antes', () => {
    expect(lembreteDeEnvio(registro(5), '2026-11-05')).toEqual({ diasFaltando: 0, dia: 5 });
    expect(lembreteDeEnvio(registro(8), '2026-11-05')).toEqual({ diasFaltando: 3, dia: 8 });
    expect(lembreteDeEnvio(registro(9), '2026-11-05')).toBeNull();
  });

  it('passou o dia deste mês: conta o do mês seguinte', () => {
    expect(lembreteDeEnvio(registro(3), '2026-11-30')).toEqual({ diasFaltando: 3, dia: 3 });
    expect(lembreteDeEnvio(registro(3), '2026-11-05')).toBeNull();
  });

  it('sem dia de envio, dia inválido ou pasta de outro tipo: sem lembrete', () => {
    expect(lembreteDeEnvio(registro(), '2026-11-05')).toBeNull();
    expect(lembreteDeEnvio(registro(40), '2026-11-05')).toBeNull();
    expect(lembreteDeEnvio({ tipo: 'lista', diaDeEnvio: 5 }, '2026-11-05')).toBeNull();
  });
});
