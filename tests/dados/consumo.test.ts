import { describe, expect, it } from 'vitest';
import { consumoDesdeAnterior, consumoPorMes, leiturasIgnoradas, proximoEnvio } from '../../src/dados/consumo';

describe('consumoDesdeAnterior', () => {
  it('primeira leitura tem consumo null', () => {
    expect(consumoDesdeAnterior([{ data: '2026-10-01', leitura: 100 }])).toEqual([
      { data: '2026-10-01', leitura: 100, consumo: null },
    ]);
  });

  it('consumo = leitura − anterior', () => {
    const r = consumoDesdeAnterior([
      { data: '2026-10-01', leitura: 100 },
      { data: '2026-11-01', leitura: 112.5 },
    ]);
    expect(r.map((x) => x.consumo)).toEqual([null, 12.5]);
    expect(r[1].aviso).toBeUndefined();
  });

  it('leitura menor que a anterior → consumo null e aviso leitura_menor, nunca negativo', () => {
    const r = consumoDesdeAnterior([
      { data: '2026-10-01', leitura: 100 },
      { data: '2026-11-01', leitura: 90 },
    ]);
    expect(r[1]).toEqual({ data: '2026-11-01', leitura: 90, consumo: null, aviso: 'leitura_menor' });
    expect(r.every((x) => x.consumo === null || x.consumo >= 0)).toBe(true);
  });

  it('ordena por data, mesmo que cheguem fora de ordem', () => {
    const r = consumoDesdeAnterior([
      { data: '2026-12-01', leitura: 130 },
      { data: '2026-10-01', leitura: 100 },
      { data: '2026-11-01', leitura: 110 },
    ]);
    expect(r.map((x) => [x.data, x.consumo])).toEqual([
      ['2026-10-01', null],
      ['2026-11-01', 10],
      ['2026-12-01', 20],
    ]);
  });

  it('depois de uma leitura menor, a conta recomeça dela (contador zerado)', () => {
    const r = consumoDesdeAnterior([
      { data: '2026-09-01', leitura: 9990 },
      { data: '2026-10-01', leitura: 5 },
      { data: '2026-11-01', leitura: 17 },
    ]);
    expect(r.map((x) => x.consumo)).toEqual([null, null, 12]);
    expect(r[1].aviso).toBe('leitura_menor');
    expect(r[2].aviso).toBeUndefined();
  });

  it('leitura igual à anterior dá consumo 0, sem aviso', () => {
    const r = consumoDesdeAnterior([
      { data: '2026-10-01', leitura: 100 },
      { data: '2026-10-02', leitura: 100 },
    ]);
    expect(r[1]).toEqual({ data: '2026-10-02', leitura: 100, consumo: 0 });
  });

  it('duas leituras no mesmo dia, já em ordem crescente, dão o consumo entre elas', () => {
    const r = consumoDesdeAnterior([
      { data: '2026-10-01', leitura: 100 },
      { data: '2026-10-05', leitura: 110 },
      { data: '2026-10-05', leitura: 115 },
    ]);
    expect(r.map((x) => [x.leitura, x.consumo])).toEqual([
      [100, null],
      [110, 10],
      [115, 5],
    ]);
  });

  it('mesmo dia fora de ordem: desempata pela leitura crescente (contador só sobe), sem aviso', () => {
    const r = consumoDesdeAnterior([
      { data: '2026-10-05', leitura: 115 },
      { data: '2026-10-05', leitura: 110 },
    ]);
    expect(r.map((x) => [x.leitura, x.consumo])).toEqual([
      [110, null],
      [115, 5],
    ]);
    expect(r.every((x) => x.aviso === undefined)).toBe(true);
  });

  it('rejeita ano de dois dígitos disfarçado (0026-01-01)', () => {
    expect(consumoDesdeAnterior([{ data: '0026-01-01', leitura: 1 }])).toEqual([]);
  });

  it('arredonda a 3 casas (sem lixo de ponto flutuante)', () => {
    const r = consumoDesdeAnterior([
      { data: '2026-10-01', leitura: 0.1 },
      { data: '2026-11-01', leitura: 0.3 },
    ]);
    expect(r[1].consumo).toBe(0.2);
  });

  it('ignora leitura não numérica, negativa ou com data inválida (não quebra a tela)', () => {
    const r = consumoDesdeAnterior([
      { data: '2026-10-01', leitura: 100 },
      { data: '2026-10-10', leitura: Number.NaN },
      { data: '2026-10-11', leitura: Number.POSITIVE_INFINITY },
      { data: '2026-10-12', leitura: -4 },
      { data: '2026-02-30', leitura: 120 },
      { data: '01/11/2026', leitura: 121 },
      { data: '', leitura: 122 },
      { data: '2026-11-01', leitura: 110 },
    ]);
    expect(r.map((x) => [x.data, x.consumo])).toEqual([
      ['2026-10-01', null],
      ['2026-11-01', 10],
    ]);
  });

  it('lista vazia e entrada que não é lista dão lista vazia', () => {
    expect(consumoDesdeAnterior([])).toEqual([]);
    expect(consumoDesdeAnterior(null as never)).toEqual([]);
    expect(consumoDesdeAnterior(undefined as never)).toEqual([]);
  });

  it('não altera a lista recebida', () => {
    const entrada = [
      { data: '2026-11-01', leitura: 110 },
      { data: '2026-10-01', leitura: 100 },
    ];
    const copia = structuredClone(entrada);
    consumoDesdeAnterior(entrada);
    expect(entrada).toEqual(copia);
  });

  it('aguenta 10 mil leituras', () => {
    const muitas = Array.from({ length: 10_000 }, (_, i) => ({
      data: new Date(Date.UTC(2000, 0, 1 + i)).toISOString().slice(0, 10),
      leitura: i * 2,
    }));
    const r = consumoDesdeAnterior(muitas);
    expect(r).toHaveLength(10_000);
    expect(r[9_999].consumo).toBe(2);
  });
});

describe('leiturasIgnoradas', () => {
  it('aponta posição e motivo de cada leitura que a conta ignora', () => {
    const r = leiturasIgnoradas([
      { data: '2026-10-01', leitura: 100 },
      { data: '2026-10-10', leitura: Number.NaN },
      { data: '2026-10-12', leitura: -4 },
      { data: '2026-02-30', leitura: 120 },
      { data: '01/11/2026', leitura: 121 },
      { data: '2026-11-01', leitura: Number.POSITIVE_INFINITY },
      { data: '2026-11-02', leitura: 110 },
    ]);
    expect(r).toEqual([
      { indice: 1, motivo: 'leitura_invalida' },
      { indice: 2, motivo: 'leitura_invalida' },
      { indice: 3, motivo: 'data_invalida' },
      { indice: 4, motivo: 'data_invalida' },
      { indice: 5, motivo: 'leitura_invalida' },
    ]);
  });

  it('leituras válidas não são apontadas; lista vazia e entrada que não é lista dão []', () => {
    expect(leiturasIgnoradas([{ data: '2026-10-01', leitura: 0 }])).toEqual([]);
    expect(leiturasIgnoradas([])).toEqual([]);
    expect(leiturasIgnoradas(null as never)).toEqual([]);
  });

  it('o que é apontado é exatamente o que consumoDesdeAnterior descarta', () => {
    const entrada = [
      { data: '2026-10-01', leitura: 100 },
      { data: 'x', leitura: 1 },
      { data: '2026-10-02', leitura: Number.NaN },
      { data: '2026-10-03', leitura: 105 },
    ];
    expect(entrada.length - leiturasIgnoradas(entrada).length).toBe(consumoDesdeAnterior(entrada).length);
  });
});

describe('consumoPorMes', () => {
  it('consumoPorMes soma por mês', () => {
    const r = consumoPorMes([
      { data: '2026-09-28', leitura: 100 },
      { data: '2026-10-10', leitura: 105 },
      { data: '2026-10-25', leitura: 112 },
      { data: '2026-11-03', leitura: 120 },
    ]);
    expect(r).toEqual([
      { mes: '2026-10', consumo: 12 },
      { mes: '2026-11', consumo: 8 },
    ]);
  });

  it('a primeira leitura não conta: mês só com ela fica de fora', () => {
    expect(consumoPorMes([{ data: '2026-10-01', leitura: 100 }])).toEqual([]);
  });

  it('leitura menor não soma nada, mas o mês com outras leituras continua', () => {
    const r = consumoPorMes([
      { data: '2026-10-01', leitura: 100 },
      { data: '2026-10-10', leitura: 3 },
      { data: '2026-10-20', leitura: 10 },
    ]);
    expect(r).toEqual([{ mes: '2026-10', consumo: 7 }]);
  });

  it('mês com leituras iguais aparece com 0; mês sem leitura não aparece', () => {
    const r = consumoPorMes([
      { data: '2026-08-01', leitura: 100 },
      { data: '2026-08-20', leitura: 100 },
      { data: '2026-11-02', leitura: 110 },
    ]);
    expect(r).toEqual([
      { mes: '2026-08', consumo: 0 },
      { mes: '2026-11', consumo: 10 },
    ]);
  });

  it('vira o ano em ordem cronológica', () => {
    const r = consumoPorMes([
      { data: '2027-01-05', leitura: 130 },
      { data: '2026-12-05', leitura: 120 },
      { data: '2026-11-05', leitura: 100 },
    ]);
    expect(r.map((x) => x.mes)).toEqual(['2026-12', '2027-01']);
  });

  it('soma sem lixo de ponto flutuante (0,1 + 0,2)', () => {
    const r = consumoPorMes([
      { data: '2026-10-01', leitura: 0 },
      { data: '2026-10-10', leitura: 0.1 },
      { data: '2026-10-20', leitura: 0.3 },
    ]);
    expect(r).toEqual([{ mes: '2026-10', consumo: 0.3 }]);
  });

  it('lista vazia dá lista vazia', () => {
    expect(consumoPorMes([])).toEqual([]);
  });
});

describe('proximoEnvio', () => {
  it('proximoEnvio com dia 5 em 16/11 → 05/12, 19 dias', () => {
    expect(proximoEnvio(5, '2026-11-16')).toEqual({ data: '2026-12-05', diasFaltando: 19 });
  });

  it('proximoEnvio no próprio dia → diasFaltando 0', () => {
    expect(proximoEnvio(16, '2026-11-16')).toEqual({ data: '2026-11-16', diasFaltando: 0 });
  });

  it('dia ainda por vir neste mês fica neste mês', () => {
    expect(proximoEnvio(20, '2026-11-16')).toEqual({ data: '2026-11-20', diasFaltando: 4 });
  });

  it('dia 31 em fevereiro cai no último dia do mês', () => {
    expect(proximoEnvio(31, '2026-02-10')).toEqual({ data: '2026-02-28', diasFaltando: 18 });
    expect(proximoEnvio(31, '2028-02-10')).toEqual({ data: '2028-02-29', diasFaltando: 19 });
  });

  it('dia 31 num mês de 30 dias cai no dia 30, e no próprio dia dá 0', () => {
    expect(proximoEnvio(31, '2026-04-30')).toEqual({ data: '2026-04-30', diasFaltando: 0 });
  });

  it('dia que já passou num mês curto: o mês seguinte usa o ajuste dele', () => {
    // 30 já passou em 31/01; fevereiro só tem 28.
    expect(proximoEnvio(30, '2026-01-31')).toEqual({ data: '2026-02-28', diasFaltando: 28 });
    // mês longo outra vez: o 31 volta a ser 31.
    expect(proximoEnvio(31, '2026-03-01')).toEqual({ data: '2026-03-31', diasFaltando: 30 });
  });

  it('vira o ano: dia 5 em 20/12 → 05/01 do ano seguinte', () => {
    expect(proximoEnvio(5, '2026-12-20')).toEqual({ data: '2027-01-05', diasFaltando: 16 });
  });

  it('conta certo por cima de 29/02 e de mudança de hora (sem fuso do aparelho)', () => {
    expect(proximoEnvio(1, '2028-02-15')).toEqual({ data: '2028-03-01', diasFaltando: 15 });
    expect(proximoEnvio(31, '2026-03-20')).toEqual({ data: '2026-03-31', diasFaltando: 11 });
  });

  it.each([0, 32, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, undefined, null, '5'])(
    'dia de envio inválido (%s) dá erro',
    (dia) => {
      expect(() => proximoEnvio(dia as never, '2026-11-16')).toThrow(RangeError);
    },
  );

  it.each(['', '2026-13-01', '2026-02-30', '16/11/2026', '2026-1-5', undefined, null])('hoje inválido (%s) dá erro', (hoje) => {
    expect(() => proximoEnvio(5, hoje as never)).toThrow(RangeError);
  });
});
