import { afterEach, describe, expect, it, vi } from 'vitest';
import { hojeEmLisboa, minutoEmLisboa, msAteMeiaNoiteEmLisboa, vigiarODia } from '../../src/dados/dia';

// Quinta-feira, 2026-11-05, 12:20 (Europe/Lisbon, UTC+0 no inverno).
const QUINTA_12H20 = new Date('2026-11-05T12:20:00Z');

describe('hojeEmLisboa', () => {
  it('é a data de Lisboa, não a do relógio UTC', () => {
    expect(hojeEmLisboa(QUINTA_12H20)).toBe('2026-11-05');
    // 23:30 UTC de 5/11 já é 6/11 em Lisboa no verão (UTC+1).
    expect(hojeEmLisboa(new Date('2026-07-05T23:30:00Z'))).toBe('2026-07-06');
    expect(hojeEmLisboa(new Date('2026-07-05T22:59:59Z'))).toBe('2026-07-05');
  });
});

describe('minutoEmLisboa', () => {
  it('é o minuto do dia em Lisboa (0 a 1439), no inverno e no verão', () => {
    expect(minutoEmLisboa(QUINTA_12H20)).toBe(12 * 60 + 20);
    expect(minutoEmLisboa(new Date('2026-07-05T22:30:00Z'))).toBe(23 * 60 + 30); // UTC+1
    expect(minutoEmLisboa(new Date('2026-11-06T00:00:00Z'))).toBe(0);
    expect(minutoEmLisboa(new Date('2026-11-05T23:59:59Z'))).toBe(23 * 60 + 59);
  });
});

describe('msAteMeiaNoiteEmLisboa', () => {
  it('conta o que falta até 00:00 de Lisboa', () => {
    expect(msAteMeiaNoiteEmLisboa(QUINTA_12H20)).toBe(11 * 3600_000 + 40 * 60_000);
    expect(msAteMeiaNoiteEmLisboa(new Date('2026-11-05T23:59:59.500Z'))).toBe(500);
  });

  it('à meia-noite em ponto falta um dia inteiro', () => {
    expect(msAteMeiaNoiteEmLisboa(new Date('2026-11-06T00:00:00Z'))).toBe(24 * 3600_000);
  });

  it('no verão usa a hora de Lisboa (UTC+1)', () => {
    // 22:30 UTC = 23:30 em Lisboa.
    expect(msAteMeiaNoiteEmLisboa(new Date('2026-07-05T22:30:00Z'))).toBe(30 * 60_000);
  });
});

describe('vigiarODia', () => {
  afterEach(() => vi.useRealTimers());

  function relogioFalso(inicio: string) {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date(inicio));
  }

  it('avisa uma vez, logo depois da meia-noite, com o dia novo', async () => {
    relogioFalso('2026-11-05T23:59:30Z');
    const dias: string[] = [];
    const parar = vigiarODia((dia) => dias.push(dia));

    await vi.advanceTimersByTimeAsync(29_000);
    expect(dias).toEqual([]);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(dias).toEqual(['2026-11-06']);
    parar();
  });

  it('segue vigiando: vira de novo no dia seguinte', async () => {
    relogioFalso('2026-11-05T23:59:30Z');
    const dias: string[] = [];
    const parar = vigiarODia((dia) => dias.push(dia));

    await vi.advanceTimersByTimeAsync(24 * 3600_000 + 40_000);
    expect(dias).toEqual(['2026-11-06', '2026-11-07']);
    parar();
  });

  it('não avisa de novo enquanto o dia é o mesmo', async () => {
    relogioFalso('2026-11-05T10:00:00Z');
    const dias: string[] = [];
    const parar = vigiarODia((dia) => dias.push(dia));
    await vi.advanceTimersByTimeAsync(5 * 3600_000);
    expect(dias).toEqual([]);
    parar();
  });

  it('ao voltar ao app em outro dia (aba parada, relógio que pulou), avisa na hora', () => {
    relogioFalso('2026-11-05T10:00:00Z');
    const dias: string[] = [];
    const parar = vigiarODia((dia) => dias.push(dia));

    vi.setSystemTime(new Date('2026-11-07T08:00:00Z'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(dias).toEqual(['2026-11-07']);

    // Mesmo dia: nada de novo.
    document.dispatchEvent(new Event('visibilitychange'));
    expect(dias).toEqual(['2026-11-07']);
    parar();
  });

  it('aba escondida não dispara nada', () => {
    relogioFalso('2026-11-05T10:00:00Z');
    const dias: string[] = [];
    const parar = vigiarODia((dia) => dias.push(dia));
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    vi.setSystemTime(new Date('2026-11-07T08:00:00Z'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(dias).toEqual([]);
    parar();
  });

  it('a função devolvida desliga timer e evento', async () => {
    relogioFalso('2026-11-05T23:59:30Z');
    const dias: string[] = [];
    const parar = vigiarODia((dia) => dias.push(dia));
    parar();
    await vi.advanceTimersByTimeAsync(60_000);
    vi.setSystemTime(new Date('2026-11-09T08:00:00Z'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(dias).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('um ouvinte que falha não derruba a vigia', async () => {
    relogioFalso('2026-11-05T23:59:30Z');
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const dias: string[] = [];
    let primeira = true;
    const parar = vigiarODia((dia) => {
      dias.push(dia);
      if (primeira) {
        primeira = false;
        throw new Error('falhou');
      }
    });
    await vi.advanceTimersByTimeAsync(24 * 3600_000 + 40_000);
    expect(dias).toEqual(['2026-11-06', '2026-11-07']);
    expect(erro).toHaveBeenCalled();
    parar();
  });

  it('acorda a cada 15 minutos no máximo: dia de mudança de hora não atrasa a virada', async () => {
    // 2027-03-28: Lisboa pula 01:00 para 02:00; a meia-noite seguinte chega 1 h antes do cálculo simples.
    relogioFalso('2027-03-28T00:30:00Z');
    const dias: string[] = [];
    const parar = vigiarODia((dia) => dias.push(dia));
    // Meia-noite local de 29/03 = 23:00Z de 28/03.
    await vi.advanceTimersByTimeAsync(22 * 3600_000 + 30 * 60_000 + 20 * 60_000);
    expect(dias).toEqual(['2027-03-29']);
    parar();
  });

  it('dia de volta da hora (25/10/2026, 25 h): só vira na meia-noite de verdade', async () => {
    // Lisboa volta de 02:00 para 01:00 em 25/10. Às 00:30 locais (23:30Z de 24/10) faltam 24 h 30 min.
    relogioFalso('2026-10-24T23:30:00Z');
    const dias: string[] = [];
    const parar = vigiarODia((dia) => dias.push(dia));
    await vi.advanceTimersByTimeAsync(23 * 3600_000 + 50 * 60_000);
    expect(dias).toEqual([]); // ainda é 25/10, 23:20 locais
    await vi.advanceTimersByTimeAsync(40 * 60_000);
    expect(dias).toEqual(['2026-10-26']);
    parar();
  });

  it('nada dispara antes da meia-noite, nem no último segundo', async () => {
    relogioFalso('2026-11-05T23:00:00Z');
    const dias: string[] = [];
    const parar = vigiarODia((dia) => dias.push(dia));
    await vi.advanceTimersByTimeAsync(59 * 60_000 + 59_000); // 23:59:59
    expect(dias).toEqual([]);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(dias).toEqual(['2026-11-06']);
    parar();
  });
});
