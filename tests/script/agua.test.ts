// @vitest-environment node
// Coleção sincronizada `agua` (um registro por gole): o script e o app aceitam
// e recusam exatamente o mesmo (script/colecoes.ts).
import { describe, expect, it } from 'vitest';
import { NOMES_DAS_COLECOES, colecaoConhecida, registroValido } from '../../script/colecoes';

// Relógio fixo: quinta, 2026-11-05, 12:20 em Lisboa (WET = UTC em novembro).
const AGORA = Date.parse('2026-11-05T12:20:00Z');
const base = { id: 'gole-0abc', aparelho: 'notebook', atualizadoEm: AGORA - 1000 };
const gole = { ...base, data: '2026-11-05', hora: '12:40', ml: 125 };

describe('agua', () => {
  it('é uma coleção conhecida', () => {
    expect(colecaoConhecida('agua')).toBe(true);
    expect(NOMES_DAS_COLECOES).toContain('agua');
  });

  it('aceita um gole com dia, hora e mL', () => {
    expect(registroValido('agua', gole, AGORA)).toBe(true);
  });

  it('aceita os limites: 1 e 5.000 mL, 00:00 e 23:59', () => {
    for (const ml of [1, 5000]) expect(registroValido('agua', { ...gole, ml }, AGORA)).toBe(true);
    for (const hora of ['00:00', '23:59']) expect(registroValido('agua', { ...gole, hora }, AGORA)).toBe(true);
  });

  it('aceita a lápide de um gole desfeito', () => {
    expect(registroValido('agua', { ...gole, apagado: true }, AGORA)).toBe(true);
  });

  it('recusa mL fora de 1 a 5.000, quebrado ou em texto', () => {
    for (const ml of [0, 5001, 12.5, '125', -125, Number.NaN, null]) {
      expect(registroValido('agua', { ...gole, ml }, AGORA)).toBe(false);
    }
  });

  it('recusa hora fora de HH:MM e dia fora de AAAA-MM-DD', () => {
    for (const hora of ['24:00', '9:05', '12:60', '', 1240]) {
      expect(registroValido('agua', { ...gole, hora }, AGORA)).toBe(false);
    }
    for (const data of ['5/11/2026', '2026-11-5', '05-11-2026', '', 20261105]) {
      expect(registroValido('agua', { ...gole, data }, AGORA)).toBe(false);
    }
  });

  it('recusa a falta de qualquer um dos três campos', () => {
    for (const campo of ['data', 'hora', 'ml'] as const) {
      const { [campo]: _fora, ...semCampo } = gole;
      expect(registroValido('agua', semCampo, AGORA)).toBe(false);
    }
  });
});
