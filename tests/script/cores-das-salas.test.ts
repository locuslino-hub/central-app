// @vitest-environment node
// Coleção sincronizada `coresDasSalas` (cor do Google -> sala): o script e o
// app aceitam e recusam exatamente o mesmo (script/colecoes.ts).
import { describe, expect, it } from 'vitest';
import { NOMES_DAS_COLECOES, colecaoConhecida, registroValido } from '../../script/colecoes';

const AGORA = Date.parse('2026-11-09T20:00:00Z');
const base = { id: 'cor-0abc', aparelho: 'notebook', atualizadoEm: AGORA - 1000 };

describe('coresDasSalas', () => {
  it('é uma coleção conhecida', () => {
    expect(colecaoConhecida('coresDasSalas')).toBe(true);
    expect(NOMES_DAS_COLECOES).toContain('coresDasSalas');
  });

  it('aceita as três formas de chave, com sala ou sem sala (null)', () => {
    for (const chave of ['label:etq_1-A', 'cor:1', 'cor:11', 'agenda:9fc6e7']) {
      expect(registroValido('coresDasSalas', { ...base, chave, salaId: 'sala-aulas' }, AGORA)).toBe(true);
    }
    expect(registroValido('coresDasSalas', { ...base, chave: 'cor:9', salaId: null }, AGORA)).toBe(true);
  });

  it('recusa chave fora da forma e sala que não é texto nem null', () => {
    for (const chave of ['cor:12', 'cor:0', 'agenda:9FC6E7', 'agenda:#9fc6e7', 'label:', 'label:com espaço', 'outra:1', '', 7]) {
      expect(registroValido('coresDasSalas', { ...base, chave, salaId: 'sala-aulas' }, AGORA)).toBe(false);
    }
    expect(registroValido('coresDasSalas', { ...base, chave: 'cor:9' }, AGORA)).toBe(false);
    expect(registroValido('coresDasSalas', { ...base, chave: 'cor:9', salaId: 3 }, AGORA)).toBe(false);
  });
});
