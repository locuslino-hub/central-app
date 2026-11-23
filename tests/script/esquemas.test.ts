// @vitest-environment node
// Todo campo que o app grava (src/dados/tipos.ts) está no esquema do script
// (script/colecoes.ts): o script e o app conferem a forma de cada um. Campo
// que só existe em versões novas é opcional, para registro antigo, que não o
// tem, continuar valendo.
import { describe, expect, it } from 'vitest';
import { ESQUEMAS, NOMES_DAS_COLECOES, colecaoConhecida, registroValido, semCamposDesconhecidos, type NomeDaColecao } from '../../script/colecoes';
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
    feitoEm: AGORA - 5000,
    fixada: false,
    marcar: true,
    emailId: 'email-1',
    adiadaAte: '2026-11-07',
    pastaId: 'pasta-metodologia',
  },
  palavras: { ...base, termo: 'tese', salaId: 'sala-doutoramento' },
  documentos: { ...base, titulo: 'Plano', url: 'https://exemplo.invalid/plano', salaId: 'sala-mba', pessoaId: 'p-marina', pastaId: 'pasta-metodologia', arquivado: false },
  paginas: {
    ...base,
    salaId: 'sala-aulas',
    pastaId: 'pasta-metodologia',
    titulo: 'Página 1',
    blocos: [
      { id: 'b1', tipo: 'texto', texto: 'Ler o artigo da Aurora', itemId: 't-1' },
      { id: 'b2', tipo: 'painel', painel: 'agenda' },
    ],
  },
  estadosEmail: { ...base, feito: true, adiadaAte: '2026-11-07' },
  config: { ...base, id: 'geral', fimDoDia: '20:00', diaFechado: '2026-11-05' },
  eventosFeitos: { ...base, eventoId: 'ev-1', agendaId: 'primary', data: '2026-11-05', feito: true, pendenteNoGoogle: true, soNaCentral: false },
  coresDasSalas: { ...base, chave: 'cor:5', salaId: 'sala-casa' },
  agua: { ...base, data: '2026-11-05', hora: '12:40', ml: 125 },
  ideias: { ...base, texto: 'Ideia da Aurora', salaId: 'sala-aulas', estado: 'tarefa', tarefaId: 't-1', audioId: 'audio-1', audioSegundos: 42 },
  pastas: { ...base, salaId: 'sala-casa', tipo: 'registro', nome: 'Consumo de Água', ordem: 3, planilhaId: 'planilha-teste-1', modelo: 'consumo', servico: 'agua', unidade: 'm³', diaDeEnvio: 5, categorias: ['Mercado'] },
  notas: {
    ...base,
    salaId: 'sala-doutoramento',
    pastaId: 'pasta-metodologia',
    tipo: 'lista',
    texto: 'Texto de uma nota',
    itens: [
      { id: 'i-1', texto: 'Baixar dados', feito: true },
      { id: 'i-2', texto: 'Limpar planilha' },
    ],
    criadaEm: AGORA - 5000,
  },
};

const DA_BASE = new Set(['id', 'atualizadoEm', 'aparelho', 'apagado']);

describe('esquemas do script', () => {
  it('pastaId (pasta comum, Tarefa 17): opcional em tarefas, documentos e páginas; só id válido', () => {
    for (const colecao of ['tarefas', 'documentos', 'paginas'] as const) {
      const { pastaId: _tirado, ...antigo } = COMPLETOS[colecao] as Record<string, unknown>;
      // Registro de antes do campo continua valendo.
      expect(registroValido(colecao, antigo, AGORA), `${colecao} sem pastaId`).toBe(true);
      expect(registroValido(colecao, { ...antigo, pastaId: 'pasta-metodologia' }, AGORA, { estrito: true }), `${colecao} com pastaId`).toBe(true);
      for (const ruim of ['', 'com espaço', 'a'.repeat(65), 7, null, {}]) {
        expect(registroValido(colecao, { ...antigo, pastaId: ruim }, AGORA), `${colecao} pastaId ${String(ruim)}`).toBe(false);
      }
    }
  });

  it('pastaId passa pela leitura do app (semCamposDesconhecidos) sem ser tirado', () => {
    expect(semCamposDesconhecidos('tarefas', { ...COMPLETOS.tarefas, campoDeOutraVersao: 1 })).toMatchObject({ pastaId: 'pasta-metodologia' });
  });

  it('rascunhos não é coleção conhecida (C-16: nenhuma tela a usava)', () => {
    expect(colecaoConhecida('rascunhos')).toBe(false);
    expect(NOMES_DAS_COLECOES).not.toContain('rascunhos');
    expect(ESQUEMAS).not.toHaveProperty('rascunhos');
  });

  it('script aceita e devolve a coleção ideias', () => {
    expect(colecaoConhecida('ideias')).toBe(true);
    expect(NOMES_DAS_COLECOES).toContain('ideias');
    const minima = { ...base, texto: 'Só o texto', estado: 'nova' };
    expect(registroValido('ideias', minima, AGORA)).toBe(true);
    expect(registroValido('ideias', { ...minima, salaId: null }, AGORA)).toBe(true);
    expect(registroValido('ideias', { ...minima, apagado: true }, AGORA)).toBe(true);
  });

  it('ideias: limites aceitos (texto 1 e 2000, áudio 0 e 600 s, id de 100)', () => {
    for (const texto of ['x', 'x'.repeat(2000)]) expect(registroValido('ideias', { ...COMPLETOS.ideias, texto }, AGORA)).toBe(true);
    for (const audioSegundos of [0, 600]) expect(registroValido('ideias', { ...COMPLETOS.ideias, audioSegundos }, AGORA)).toBe(true);
    expect(registroValido('ideias', { ...COMPLETOS.ideias, audioId: 'a'.repeat(100) }, AGORA)).toBe(true);
  });

  it.each([
    ['texto', [1, null, undefined, '', 'x'.repeat(2001)]],
    ['tarefaId', [5, 'com espaço', '', 'a'.repeat(65)]],
    ['estado', ['feita', '', 1, null, undefined]],
    ['salaId', [5, false]],
    ['audioId', [5, null, '', 'tem espaço', 'a'.repeat(101)]],
    ['audioSegundos', ['42', Number.NaN, null, -1, 601, Number.POSITIVE_INFINITY]],
  ] as const)('ideias: %s com forma errada é recusado', (campo, valores) => {
    for (const valor of valores) {
      expect(registroValido('ideias', { ...COMPLETOS.ideias, [campo]: valor }, AGORA)).toBe(false);
    }
  });

  it('script aceita e devolve a coleção pastas', () => {
    expect(colecaoConhecida('pastas')).toBe(true);
    expect(NOMES_DAS_COLECOES).toContain('pastas');
    const minima = { ...base, salaId: 'sala-doutoramento', tipo: 'comum', nome: 'Capítulo 2' };
    expect(registroValido('pastas', minima, AGORA)).toBe(true);
    expect(registroValido('pastas', COMPLETOS.pastas, AGORA, { estrito: true })).toBe(true);
    expect(registroValido('pastas', { ...minima, apagado: true }, AGORA)).toBe(true);
  });

  it('pastas: limites aceitos (nome 1 e 100, dia de envio 1 e 31, id de planilha de 200)', () => {
    for (const nome of ['x', 'x'.repeat(100)]) expect(registroValido('pastas', { ...COMPLETOS.pastas, nome }, AGORA)).toBe(true);
    for (const diaDeEnvio of [1, 31]) expect(registroValido('pastas', { ...COMPLETOS.pastas, diaDeEnvio }, AGORA)).toBe(true);
    expect(registroValido('pastas', { ...COMPLETOS.pastas, planilhaId: 'a'.repeat(200) }, AGORA)).toBe(true);
  });

  it.each([
    ['salaId', [5, null, undefined, '', 'com espaço']],
    ['tipo', ['outro', '', 1, null, undefined]],
    ['nome', [1, null, undefined, '', 'x'.repeat(101)]],
    ['ordem', ['1', Number.NaN, Number.POSITIVE_INFINITY]],
    ['planilhaId', [5, null, '', 'tem espaço', 'a'.repeat(201)]],
    ['modelo', ['outro', '', 1, null]],
    ['servico', ['petroleo', '', 1, null]],
    ['unidade', ['litros', '', 1, null]],
    ['diaDeEnvio', [0, 32, 1.5, '5', Number.NaN, null]],
    ['categorias', ['Mercado', [1], null]],
  ] as const)('pastas: %s com forma errada é recusado', (campo, valores) => {
    for (const valor of valores) {
      expect(registroValido('pastas', { ...COMPLETOS.pastas, [campo]: valor }, AGORA)).toBe(false);
    }
  });

  it('script aceita e devolve a coleção notas', () => {
    expect(colecaoConhecida('notas')).toBe(true);
    expect(NOMES_DAS_COLECOES).toContain('notas');
    const texto = { ...base, salaId: 'sala-aulas', tipo: 'texto', texto: 'Revisar a parcela 3', criadaEm: AGORA - 1000 };
    expect(registroValido('notas', texto, AGORA, { estrito: true })).toBe(true);
    const lista = { ...base, salaId: 'sala-aulas', tipo: 'lista', itens: [{ id: 'a', texto: 'Um' }], criadaEm: AGORA - 1000 };
    expect(registroValido('notas', lista, AGORA, { estrito: true })).toBe(true);
    expect(registroValido('notas', COMPLETOS.notas, AGORA, { estrito: true })).toBe(true);
    expect(registroValido('notas', { ...texto, apagado: true }, AGORA)).toBe(true);
  });

  it('notas: limites aceitos (texto de 20 000, 200 itens, item de 500)', () => {
    expect(registroValido('notas', { ...COMPLETOS.notas, texto: 'x'.repeat(20_000) }, AGORA)).toBe(true);
    const duzentos = Array.from({ length: 200 }, (_, i) => ({ id: `i-${i}`, texto: 'y'.repeat(500) }));
    expect(registroValido('notas', { ...COMPLETOS.notas, itens: duzentos }, AGORA)).toBe(true);
  });

  it.each([
    ['salaId', [5, null, undefined, '', 'com espaço']],
    ['pastaId', [5, null, '', 'com espaço', 'a'.repeat(65)]],
    ['tipo', ['diario', '', 1, null, undefined]],
    ['texto', [5, null, 'x'.repeat(20_001)]],
    ['criadaEm', ['ontem', null, undefined, Number.NaN, -1, Number.POSITIVE_INFINITY]],
    [
      'itens',
      [
        'um',
        {},
        [null],
        ['a'],
        [{ texto: 'sem id' }],
        [{ id: 'a' }],
        [{ id: 'com espaço', texto: 'x' }],
        [{ id: 'a', texto: 5 }],
        [{ id: 'a', texto: 'x'.repeat(501) }],
        [{ id: 'a', texto: 'x', feito: 'sim' }],
        Array.from({ length: 201 }, (_, i) => ({ id: `i-${i}`, texto: 'x' })),
      ],
    ],
  ] as const)('notas: %s com forma errada é recusado', (campo, valores) => {
    for (const valor of valores) {
      expect(registroValido('notas', { ...COMPLETOS.notas, [campo]: valor }, AGORA)).toBe(false);
    }
  });

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
    ['tarefas', 'feitoEm', ['ontem', null, Number.NaN]],
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

  // Segurança: só entra o que o esquema conhece. Campo a mais (de aparelho
  // adulterado ou de versão futura) não é guardado no Drive.
  it.each(NOMES_DAS_COLECOES)('%s: no modo estrito, campo que não está no esquema é recusado', (colecao) => {
    expect(registroValido(colecao, { ...COMPLETOS[colecao], extra: 'x' }, AGORA, { estrito: true })).toBe(false);
    // Vindo de JSON, `__proto__` é um campo próprio como outro qualquer.
    const adulterado = JSON.parse(JSON.stringify(COMPLETOS[colecao]).replace(/}$/, ',"__proto__":{"x":1}}'));
    expect(registroValido(colecao, adulterado, AGORA, { estrito: true })).toBe(false);
  });

  it.each(NOMES_DAS_COLECOES)('%s: fora do modo estrito, campo desconhecido não derruba o registro (campo de versão futura ou antiga)', (colecao) => {
    expect(registroValido(colecao, { ...COMPLETOS[colecao], googleTarefaId: 'x' }, AGORA)).toBe(true);
    const limpo = semCamposDesconhecidos(colecao, { ...COMPLETOS[colecao], googleTarefaId: 'x' });
    expect(limpo).toEqual(COMPLETOS[colecao]);
  });

  it('o apagado (lápide) continua aceito em toda coleção', () => {
    for (const colecao of NOMES_DAS_COLECOES) {
      expect(registroValido(colecao, { ...COMPLETOS[colecao], apagado: true }, AGORA)).toBe(true);
    }
  });
});
