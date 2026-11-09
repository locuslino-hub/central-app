import { beforeEach, describe, expect, it, vi } from 'vitest';
import { desfazer } from '../../src/dados/desfazer';
import { apagar, listar, listarPendentes, salvar } from '../../src/dados/loja';
import {
  concluirTarefa,
  confirmarDuracao,
  darCiencia,
  moverParaDia,
  moverParaHoje,
  moverParaSemana,
  reabrirTarefa,
} from '../../src/dados/tarefas';
import type { ParaSalvar, Tarefa } from '../../src/dados/tipos';

// Quinta-feira, 2026-11-05, 12:20 em Lisboa.
const AGORA = Date.parse('2026-11-05T12:20:00Z');
const HOJE = '2026-11-05';

function tarefa(titulo: string, extra: Partial<ParaSalvar<Tarefa>> = {}): ParaSalvar<Tarefa> {
  return {
    titulo,
    salaId: null,
    duracaoMin: 60,
    duracaoConfirmada: false,
    feito: false,
    fixada: false,
    marcar: false,
    ...extra,
  };
}

const unica = async () => (await listar('tarefas'))[0];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AGORA);
});

describe('concluir e reabrir', () => {
  it('concluir grava feito pela loja e devolve o desfazer, que reabre', async () => {
    const t = await salvar('tarefas', tarefa('Validar dados do lagar'));
    vi.setSystemTime(AGORA + 1000);

    const entrada = await concluirTarefa(t.id);

    expect(await unica()).toMatchObject({ id: t.id, feito: true });
    expect((await unica()).atualizadoEm).toBeGreaterThan(t.atualizadoEm);
    expect(await listarPendentes()).toHaveLength(2);
    expect(entrada?.rotulo).toBe('Tarefa concluída: Validar dados do lagar');
    expect(desfazer.ultimo()).toBe(entrada);

    await entrada!.reverter();
    expect(await unica()).toMatchObject({ feito: false });
    expect(desfazer.ultimo()).not.toBe(entrada);
  });

  it('desfazer não passa por cima de uma edição feita depois da conclusão', async () => {
    const t = await salvar('tarefas', tarefa('Rever capítulo 3'));
    const entrada = await concluirTarefa(t.id);
    vi.setSystemTime(AGORA + 1000);
    await salvar('tarefas', { ...(await unica()), titulo: 'Rever capítulo 4', salaId: 'sala-aulas' });

    await entrada!.reverter();

    expect(await unica()).toMatchObject({ titulo: 'Rever capítulo 4', salaId: 'sala-aulas', feito: false });
  });

  it('concluir tarefa que sumiu (apagada em outro aparelho) não faz nada e não cria registro', async () => {
    const t = await salvar('tarefas', tarefa('Sumiu'));
    await apagar('tarefas', t.id);
    expect(await concluirTarefa(t.id)).toBeUndefined();
    expect(await listar('tarefas')).toEqual([]);
    expect(await concluirTarefa('nao-existe')).toBeUndefined();
  });

  it('desfazer duas vezes reabre uma vez só', async () => {
    const t = await salvar('tarefas', tarefa('Uma vez'));
    const entrada = await concluirTarefa(t.id);
    await entrada!.reverter();
    const pendentes = (await listarPendentes()).length;
    await entrada!.reverter();
    expect(await listarPendentes()).toHaveLength(pendentes);
  });

  it('reabrir tira o feito', async () => {
    const t = await salvar('tarefas', tarefa('Feita', { feito: true }));
    await reabrirTarefa(t.id);
    expect((await unica()).feito).toBe(false);
  });
});

describe('Sem prazo: Hoje, Esta semana, Escolher dia', () => {
  it('Hoje: põe a data de hoje e limpa semana e aviso', async () => {
    const t = await salvar('tarefas', tarefa('Ler artigo', { semanaVencida: '2026-10-26' }));
    await moverParaHoje(t.id, HOJE);
    const salva = await unica();
    expect(salva.data).toBe(HOJE);
    expect('semana' in salva).toBe(false);
    expect('semanaVencida' in salva).toBe(false);
    expect(salva.titulo).toBe('Ler artigo');
  });

  it('Esta semana: guarda a segunda-feira e nenhum dia', async () => {
    const t = await salvar('tarefas', tarefa('Escrever resumo'));
    await moverParaSemana(t.id, HOJE);
    const salva = await unica();
    expect(salva.semana).toBe('2026-11-02');
    expect('data' in salva).toBe(false);
    // Num domingo ainda é a mesma semana (que começou na segunda anterior).
    await moverParaSemana(t.id, '2026-11-08');
    expect((await unica()).semana).toBe('2026-11-02');
    await moverParaSemana(t.id, '2026-11-09');
    expect((await unica()).semana).toBe('2026-11-09');
  });

  it('Escolher dia: guarda o dia e limpa a semana', async () => {
    const t = await salvar('tarefas', tarefa('Entregar formulário', { semana: '2026-11-02' }));
    expect(await moverParaDia(t.id, '2026-11-12')).toBe(true);
    const salva = await unica();
    expect(salva.data).toBe('2026-11-12');
    expect('semana' in salva).toBe(false);
  });

  it('Escolher dia recusa dia que não existe ou formato errado, sem escrever', async () => {
    const t = await salvar('tarefas', tarefa('Qualquer'));
    const pendentes = await listarPendentes();
    for (const ruim of ['', '2026-02-30', '2026-13-01', '12/11/2026', 'amanhã', '2026-11-5']) {
      expect(await moverParaDia(t.id, ruim)).toBe(false);
    }
    expect(await listarPendentes()).toEqual(pendentes);
    expect((await unica()).data).toBeUndefined();
  });

  it('mover tarefa que sumiu devolve false e não recria', async () => {
    const t = await salvar('tarefas', tarefa('Sumiu'));
    await apagar('tarefas', t.id);
    expect(await moverParaDia(t.id, '2026-11-12')).toBe(false);
    expect(await listar('tarefas')).toEqual([]);
  });

  it('dar ciência tira só o aviso da semana', async () => {
    const t = await salvar('tarefas', tarefa('Aviso', { semanaVencida: '2026-10-26' }));
    await darCiencia(t.id);
    const salva = await unica();
    expect('semanaVencida' in salva).toBe(false);
    expect(salva.titulo).toBe('Aviso');
  });
});

describe('duração', () => {
  it('confirmar grava os minutos e marca confirmada', async () => {
    const t = await salvar('tarefas', tarefa('Rever'));
    expect(t.duracaoMin).toBe(60);
    expect(t.duracaoConfirmada).toBe(false);
    await confirmarDuracao(t.id, 90);
    expect(await unica()).toMatchObject({ duracaoMin: 90, duracaoConfirmada: true });
  });

  it('confirmar o mesmo valor padrão também confirma', async () => {
    const t = await salvar('tarefas', tarefa('Rever'));
    await confirmarDuracao(t.id, 60);
    expect(await unica()).toMatchObject({ duracaoMin: 60, duracaoConfirmada: true });
  });

  it('recusa minutos inválidos', async () => {
    const t = await salvar('tarefas', tarefa('Rever'));
    for (const ruim of [0, -5, 1.5, Number.NaN, Infinity, 24 * 60 + 1]) {
      expect(await confirmarDuracao(t.id, ruim)).toBe(false);
    }
    expect(await unica()).toMatchObject({ duracaoMin: 60, duracaoConfirmada: false });
  });
});
