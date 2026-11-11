// Coleção `agua` na loja e na sincronia: um registro por gole, então dois
// aparelhos registrando ao mesmo tempo somam, e desfazer vira lápide que chega
// ao outro aparelho.
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErroConexao } from '../../src/conexao/cliente';
import { apagar, listar, listarAvisos, listarPendentes as listarTodosOsPendentes, salvar } from '../../src/dados/loja';
import { sincronizar } from '../../src/dados/sincronia';
import type { AguaRegistro, ParaSalvar } from '../../src/dados/tipos';
import { servidorDeTeste } from '../apoio/servidor';

/** A fila sem o espelho no Google (que tem testes próprios em tests/dados/espelho.test.ts). */
const listarPendentes = async () => (await listarTodosOsPendentes()).filter((p) => p.tipo !== 'espelho');

// Relógio fixo: quinta, 2026-11-05, 12:20 em Lisboa (WET = UTC em novembro).
const AGORA = Date.parse('2026-11-05T12:20:00Z');
const MINUTO = 60_000;

function gole(ml: number, hora = '12:20'): ParaSalvar<AguaRegistro> {
  return { data: '2026-11-05', hora, ml };
}

let notebook: IDBFactory;
let celular: IDBFactory;
let servidor: ReturnType<typeof servidorDeTeste>;
const semEspera = (_ms: number) => Promise.resolve();

/** Os aparelhos são bancos separados: troca qual o app enxerga. */
function no(aparelho: IDBFactory) {
  globalThis.indexedDB = aparelho;
}

function sincronizarAqui() {
  return sincronizar({ chamar: servidor.chamar, esperar: semEspera });
}

const total = (goles: AguaRegistro[]) => goles.reduce((soma, g) => soma + g.ml, 0);

beforeEach(() => {
  // Só o Date é falso: o fake-indexeddb agenda trabalho com timers reais.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AGORA);
  notebook = new IDBFactory();
  celular = new IDBFactory();
  servidor = servidorDeTeste();
});

describe('agua na loja', () => {
  it('salvar cria o gole com id próprio e um pendente para enviar', async () => {
    const salvo = await salvar('agua', gole(125));

    expect(salvo).toMatchObject({ data: '2026-11-05', hora: '12:20', ml: 125, atualizadoEm: AGORA });
    expect(salvo.id).toMatch(/\S/);
    expect(await listar('agua')).toEqual([salvo]);
    expect(await listarPendentes()).toEqual([
      expect.objectContaining({ tipo: 'registro', colecao: 'agua', id: salvo.id }),
    ]);
  });

  it('dois goles iguais no mesmo minuto são dois registros', async () => {
    const primeiro = await salvar('agua', gole(250));
    const segundo = await salvar('agua', gole(250));

    expect(primeiro.id).not.toBe(segundo.id);
    expect(await listar('agua')).toHaveLength(2);
  });

  it('apagar some de listar, mas fica a lápide na fila para o outro aparelho', async () => {
    const salvo = await salvar('agua', gole(375));
    vi.setSystemTime(AGORA + MINUTO);

    await apagar('agua', salvo.id);

    expect(await listar('agua')).toEqual([]);
    expect(await listar('agua', { comApagados: true })).toEqual([
      expect.objectContaining({ id: salvo.id, apagado: true, atualizadoEm: AGORA + MINUTO }),
    ]);
    expect((await listarPendentes()).filter((p) => p.tipo === 'registro' && p.id === salvo.id)).not.toHaveLength(0);
  });
});

describe('agua em dois aparelhos', () => {
  it('goles no mesmo minuto, um aparelho sem internet: os dois ficam, o total soma e não há aviso', async () => {
    // O celular está sem internet: grava, mas não consegue enviar.
    no(celular);
    servidor.falharAntes(() => new ErroConexao());
    const doCelular = await salvar('agua', gole(250));
    expect(await sincronizarAqui()).toBe('por-enviar');
    servidor.falharAntes(undefined);

    // No mesmo minuto, o notebook registra outro gole e envia.
    no(notebook);
    const doNotebook = await salvar('agua', gole(125));
    expect(await sincronizarAqui()).toBe('atualizado');

    // A internet volta no celular; depois o notebook puxa de novo.
    no(celular);
    expect(await sincronizarAqui()).toBe('atualizado');
    no(notebook);
    expect(await sincronizarAqui()).toBe('atualizado');

    for (const aparelho of [notebook, celular]) {
      no(aparelho);
      const goles = await listar('agua');
      expect(goles.map((g) => g.id).sort()).toEqual([doCelular.id, doNotebook.id].sort());
      expect(total(goles)).toBe(375);
      expect(await listarAvisos()).toEqual([]);
      expect(await listarPendentes()).toEqual([]);
    }
  });

  it('desfazer num aparelho apaga o gole no outro (a lápide sincroniza)', async () => {
    no(notebook);
    const salvo = await salvar('agua', gole(500));
    await sincronizarAqui();
    no(celular);
    await sincronizarAqui();
    expect(await listar('agua')).toHaveLength(1);

    vi.setSystemTime(AGORA + MINUTO);
    no(notebook);
    await apagar('agua', salvo.id);
    expect(await sincronizarAqui()).toBe('atualizado');

    no(celular);
    expect(await sincronizarAqui()).toBe('atualizado');
    expect(await listar('agua')).toEqual([]);
    expect(await listar('agua', { comApagados: true })).toEqual([
      expect.objectContaining({ id: salvo.id, apagado: true }),
    ]);
    expect(await listarAvisos()).toEqual([]);
  });
});
