import { act, render } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hojeEmLisboa } from '../../src/dados/dia';
import { useHoje } from '../../src/ui/hooks';

let visto: Date | undefined;
function Sonda() {
  visto = useHoje();
  return null;
}

/** Aparelho em UTC-3 (ex.: de viagem): o "dia do aparelho" vira 3 h depois da meia-noite de Lisboa (UTC em novembro). */
function aparelhoEmUtcMenos3() {
  vi.spyOn(Date.prototype, 'toDateString').mockImplementation(function (this: Date) {
    return new Date(this.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('useHoje (C-18)', () => {
  it('vira o dia na meia-noite de Lisboa com o aparelho em outro fuso', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(Date.parse('2026-11-16T23:59:00Z')); // 23:59 em Lisboa; 20:59 no aparelho
    aparelhoEmUtcMenos3();
    render(<Sonda />);
    expect(hojeEmLisboa(visto!)).toBe('2026-11-16');

    vi.setSystemTime(Date.parse('2026-11-17T00:01:00Z')); // 00:01 em Lisboa; ainda 21:01 de 16/11 no aparelho
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(hojeEmLisboa(visto!)).toBe('2026-11-17');
  });
});
