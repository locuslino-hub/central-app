// @vitest-environment node
// Todo campo que o app grava (src/dados/tipos.ts) está no esquema do script
// (script/colecoes.ts): o script e o app conferem a forma de cada um. Campo
// que só existe em versões novas é opcional, para registro antigo, que não o
// tem, continuar valendo.
import { describe, expect, it } from 'vitest';
import { ESQUEMAS, NOMES_DAS_COLECOES, registroValido, type NomeDaColecao } from '../../script/colecoes';
import type { Colecoes } from '../../src/dados/tipos';

// Relógio fixo: quinta, 2026-11-05, 12:20 em Lisboa (WET = UTC em novembro).
const AGORA = Date.parse('2026-11-05T12:20:00Z');
const base = { id: 'r-1', aparelho: 'notebook', atualizadoEm: AGORA - 1000 };

/** Um registro de cada coleção com todos os campos que o app pode gravar. */
const COMPLETOS: { [C in NomeDaColecao]: Colecoes[C] } = {
  salas: { ...base, nome: 'Orientações', ordem: 3, notas: 'Combinar entregas' },
  pessoas: { ...base, nome: 'Marina', salaId: 'sala-orientacoes', papel: 'aluna', emails: ['marina@exemplo.invalid'], notas: 'Prefere terças' },
  tarefas: {
    ...base,
    titulo: 'Revisar capítulo',
    salaId: 'sala-doutoramento',
    pessoaId: 'p-marina',
    data: '2026-11-06',
    semana: '2026-11-02',
    prazoHora: '18:00',
    inicio: '11:00',
    semanaVencida: '2026-10-26',
    duracaoMin: 60,
    duracaoConfirmada: false,
    feito: false,
    fixada: false,
    marcar: true,
    emailId: 'email-1',
    adiadaAte: '2026-11-07',
  },
  palavras: { ...base, termo: 'tese', salaId: 'sala-doutoramento' },
  documentos: { ...base, titulo: 'Plano', url: 'https://exemplo.invalid/plano', salaId: 'sala-mba', pessoaId: 'p-marina', arquivado: false },
  paginas: {
    ...base,
    salaId: 'sala-aulas',
    titulo: 'Página 1',
    blocos: [
      { id: 'b1', tipo: 'texto', texto: 'Ler o artigo da Aurora', itemId: 't-1' },
      { id: 'b2', tipo: 'painel', painel: 'agenda' },
    ],
  },
  estadosEmail: { ...base, feito: true, adiadaAte: '2026-11-07' },
  rascunhos: { ...base, texto: 'Ideia', salaId: null },
  config: { ...base, id: 'geral', fimDoDia: '20:00', diaFechado: '2026-11-05' },
  eventosFeitos: { ...base, eventoId: 'ev-1', agendaId: 'primary', data: '2026-11-05', feito: true, pendenteNoGoogle: true, soNaCentral: false },
  coresDasSalas: { ...base, chave: 'cor:5', salaId: 'sala-casa' },
  agua: { ...base, data: '2026-11-05', hora: '12:40', ml: 125 },
};

const DA_BASE = new Set(['id', 'atualizadoEm', 'aparelho', 'apagado']);

describe('esquemas do script', () => {
  it.each(NOMES_DAS_COLECOES)('%s: todo campo que o app grava está no esquema', (colecao) => {
    const campos = Object.keys(COMPLETOS[colecao]).filter((campo) => !DA_BASE.has(campo));
    expect(campos.filter((campo) => !(campo in ESQUEMAS[colecao]))).toEqual([]);
  });

  it.each(NOMES_DAS_COLECOES)('%s: o registro completo é aceito', (colecao) => {
    expect(registroValido(colecao, COMPLETOS[colecao], AGORA)).toBe(true);
  });

  it('config: dia fechado em AAAA-MM-DD é aceito; ausente também (config antiga)', () => {
    expect(registroValido('config', { ...base, id: 'geral', fimDoDia: '20:00', diaFechado: '2026-11-05' }, AGORA)).toBe(true);
    expect(registroValido('config', { ...base, id: 'geral', fimDoDia: '20:00' }, AGORA)).toBe(true);
  });

  it('config: dia fechado fora de AAAA-MM-DD é recusado', () => {
    for (const diaFechado of ['05/11/2026', 'hoje', '', 20261105, null, true]) {
      expect(registroValido('config', { ...base, id: 'geral', fimDoDia: '20:00', diaFechado }, AGORA)).toBe(false);
    }
  });

  it('registro antigo, sem os campos novos, continua aceito', () => {
    expect(registroValido('salas', { ...base, nome: 'MBA' }, AGORA)).toBe(true);
    expect(registroValido('pessoas', { ...base, nome: 'Renata', salaId: 'sala-mba' }, AGORA)).toBe(true);
    expect(registroValido('tarefas', { ...base, titulo: 'Antiga', salaId: null }, AGORA)).toBe(true);
    expect(registroValido('documentos', { ...base, titulo: 'Plano', url: 'https://exemplo.invalid/p' }, AGORA)).toBe(true);
    expect(registroValido('paginas', { ...base, salaId: 'sala-aulas', titulo: 'Página' }, AGORA)).toBe(true);
    expect(registroValido('estadosEmail', { ...base }, AGORA)).toBe(true);
  });

  it.each([
    ['salas', 'ordem', ['3', null, Number.NaN, Number.POSITIVE_INFINITY]],
    ['pessoas', 'emails', ['marina@exemplo.invalid', [1], [null], {}, null]],
    ['tarefas', 'duracaoMin', ['60', null, Number.NaN]],
    ['tarefas', 'duracaoConfirmada', ['sim', 1, null]],
    ['tarefas', 'feito', ['sim', 0, null]],
    ['tarefas', 'fixada', ['não', null]],
    ['tarefas', 'marcar', ['sim', null]],
    ['documentos', 'arquivado', ['não', null]],
    ['paginas', 'blocos', ['texto', {}, [null], ['b1'], [{ tipo: 'texto' }], [{ id: 'b1' }], [{ id: 5, tipo: 'texto' }]]],
    ['estadosEmail', 'feito', ['sim', null]],
  ] as const)('%s: %s com forma errada é recusado', (colecao, campo, valores) => {
    for (const valor of valores) {
      expect(registroValido(colecao, { ...COMPLETOS[colecao], [campo]: valor }, AGORA)).toBe(false);
    }
  });
});
