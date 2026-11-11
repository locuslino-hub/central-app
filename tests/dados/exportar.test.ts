import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NOMES_DAS_COLECOES } from '../../script/colecoes';
import { apagar, listar, salvar, semear } from '../../src/dados/loja';
import { FORMATO_DA_COPIA, lerCopia, montarCopia, nomeDoArquivoDaCopia, restaurarCopia } from '../../src/dados/exportar';
import { salvarConexao } from '../../src/conexao/guarda';

// Relógio fixo: quinta, 2026-11-05, 12:20 em Lisboa (WET = UTC em novembro).
const AGORA = new Date('2026-11-05T12:20:00Z').getTime();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AGORA);
});

const tarefa = (titulo: string) => ({
  titulo,
  salaId: 'sala-doutoramento',
  duracaoMin: 60,
  duracaoConfirmada: false,
  feito: false,
  fixada: false,
  marcar: false,
});

describe('montarCopia', () => {
  it('leva todas as coleções, mesmo as vazias, e o que o dono guardou', async () => {
    await semear();
    await salvar('tarefas', tarefa('Ler o artigo da Aurora'));
    await salvar('agua', { data: '2026-11-05', hora: '12:10', ml: 200 });
    const copia = await montarCopia();
    expect(copia.formato).toBe(FORMATO_DA_COPIA);
    expect(copia.exportadoEm).toBe('2026-11-05T12:20:00.000Z');
    expect(Object.keys(copia.colecoes).sort()).toEqual([...NOMES_DAS_COLECOES].sort());
    expect(copia.colecoes.tarefas.map((t) => t.titulo)).toEqual(['Ler o artigo da Aurora']);
    expect(copia.colecoes.agua).toHaveLength(1);
    expect(copia.colecoes.salas.length).toBeGreaterThanOrEqual(7);
  });

  it('não leva o que foi apagado', async () => {
    const criada = await salvar('tarefas', tarefa('Cancelada'));
    await apagar('tarefas', criada.id);
    expect((await montarCopia()).colecoes.tarefas).toEqual([]);
  });

  it('nunca leva a conexão nem o código do aparelho', async () => {
    await salvarConexao({ url: 'https://script.google.com/macros/s/ID-FICTICIO/exec', codigo: 'codigo-ficticio-de-teste-0123456789abcdef' });
    await semear();
    const texto = JSON.stringify(await montarCopia());
    expect(texto).not.toContain('codigo-ficticio');
    expect(texto).not.toContain('ID-FICTICIO');
  });
});

describe('nomeDoArquivoDaCopia', () => {
  it('leva a data no nome', () => {
    expect(nomeDoArquivoDaCopia(new Date('2026-11-05T12:20:00Z'))).toBe('central-copia-2026-11-05.json');
  });
});

describe('lerCopia', () => {
  it('aceita o que montarCopia fez', async () => {
    await salvar('tarefas', tarefa('Revisar parágrafo'));
    const copia = await montarCopia();
    expect(lerCopia(JSON.stringify(copia))?.colecoes.tarefas).toHaveLength(1);
  });

  it.each([['texto solto'], ['[]'], ['{}'], ['{"formato":"outro","colecoes":{}}'], [`{"formato":"${FORMATO_DA_COPIA}"}`]])(
    'recusa %s',
    (texto) => {
      expect(lerCopia(texto)).toBeNull();
    },
  );
});

describe('restaurarCopia', () => {
  it('devolve o que faltava e conta o que foi recusado', async () => {
    const criada = await salvar('tarefas', tarefa('Ler o artigo da Aurora'));
    const copia = await montarCopia();
    await apagar('tarefas', criada.id);
    expect(await listar('tarefas')).toEqual([]);

    // Um registro adulterado (campo fora do esquema) não entra.
    copia.colecoes.tarefas.push({ ...copia.colecoes.tarefas[0], id: 'estranha', extra: 'x' } as never);
    const resultado = await restaurarCopia(copia);
    expect(resultado).toEqual({ restaurados: 1, recusados: 1 });
    expect((await listar('tarefas')).map((t) => t.titulo)).toEqual(['Ler o artigo da Aurora']);
  });
});
