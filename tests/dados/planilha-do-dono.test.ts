// Planilha do dono: a pasta Financeiro pode apontar para uma planilha que o dono já tem (link só para abrir).
// O app não lê nem grava nela; os gastos do chat continuam na planilha do app. Ids fictícios.
import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { definirPlanilhaDoDono, idDoLinkDePlanilha, PLANILHA_INVALIDA, criarPasta, listarPastas } from '../../src/dados/pastas';
import { registroValido } from '../../script/colecoes';

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe('idDoLinkDePlanilha', () => {
  it('tira o id de um link completo, com aba e tudo', () => {
    expect(idDoLinkDePlanilha('https://docs.google.com/spreadsheets/d/1AbC_def-GHI234/edit?gid=820#gid=820')).toBe('1AbC_def-GHI234');
  });
  it('aceita o link sem o final e o id puro', () => {
    expect(idDoLinkDePlanilha('docs.google.com/spreadsheets/d/id-ficticio_1')).toBe('id-ficticio_1');
    expect(idDoLinkDePlanilha('  id-ficticio_1  ')).toBe('id-ficticio_1');
  });
  it('recusa o que não é planilha do Google', () => {
    expect(idDoLinkDePlanilha('https://exemplo.com/spreadsheets/d/abc')).toBeNull();
    expect(idDoLinkDePlanilha('')).toBeNull();
    expect(idDoLinkDePlanilha('dois ids')).toBeNull();
  });
});

describe('definirPlanilhaDoDono', () => {
  it('grava o id na pasta e vazio tira', async () => {
    const pasta = await criarPasta({ salaId: 'sala-casa', tipo: 'comum', nome: 'Financeiro' });
    const com = await definirPlanilhaDoDono(pasta.id, 'https://docs.google.com/spreadsheets/d/id-ficticio_1/edit');
    expect(com.planilhaDoDono).toBe('id-ficticio_1');
    expect((await listarPastas('sala-casa'))[0]!.planilhaDoDono).toBe('id-ficticio_1');
    const sem = await definirPlanilhaDoDono(pasta.id, '');
    expect(sem.planilhaDoDono).toBeUndefined();
  });
  it('link inválido não grava', async () => {
    const pasta = await criarPasta({ salaId: 'sala-casa', tipo: 'comum', nome: 'Financeiro' });
    await expect(definirPlanilhaDoDono(pasta.id, 'https://exemplo.com')).rejects.toThrow(PLANILHA_INVALIDA);
  });
});

describe('script', () => {
  it('aceita o campo planilhaDoDono na pasta', () => {
    const base = { id: 'pasta-1', aparelho: 'ap-1', salaId: 'sala-casa', tipo: 'comum', nome: 'Financeiro', atualizadoEm: 1 };
    expect(registroValido('pastas', { ...base, planilhaDoDono: 'id-ficticio_1' }, 10, { estrito: true })).toBe(true);
    expect(registroValido('pastas', { ...base, planilhaDoDono: 'com espaço' }, 10, { estrito: true })).toBe(false);
  });
});
