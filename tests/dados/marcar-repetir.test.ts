import { beforeEach, describe, expect, it, vi } from 'vitest';
import { colocarNaAgenda, concluirSemAgenda } from '../../src/dados/marcar';
import { listar, listarPendentes, semear } from '../../src/dados/loja';
import * as tarefas from '../../src/dados/tarefas';
import { agendaEscrita } from '../apoio/agenda-escrita';
import { criar } from '../apoio/tarefas';

// Concluir a tarefa pode falhar depois de o compromisso já existir: tentar de novo não pode duplicar.
vi.mock('../../src/dados/tarefas', async (importar) => {
  const real = await importar<typeof import('../../src/dados/tarefas')>();
  return { ...real, concluirTarefa: vi.fn(real.concluirTarefa) };
});

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 5, 12, 20));
  await semear();
});

const marcacao = { dia: '2026-11-06', inicio: '15:30', fim: '16:30' };

async function preparar() {
  const agenda = agendaEscrita();
  await agenda.instalar();
  const tarefa = await criar('Marcar reunião com a Marina', { marcar: true, salaId: 'sala-orientacoes' });
  vi.mocked(tarefas.concluirTarefa).mockRejectedValueOnce(new Error('disco cheio'));
  return { agenda, tarefa };
}

describe('colocarNaAgenda: tentar de novo depois de falhar ao concluir', () => {
  it('com os mesmos dados, reaproveita o evento: nada duplica e a tarefa conclui', async () => {
    const { agenda, tarefa } = await preparar();

    await expect(colocarNaAgenda(tarefa, marcacao)).rejects.toThrow('disco cheio');
    expect(agenda.eventos.size).toBe(1);
    const [id] = [...agenda.eventos.keys()];

    const { entrada } = await colocarNaAgenda(tarefa, marcacao);

    expect(entrada).toBeDefined();
    expect(agenda.de('criarEvento')).toHaveLength(1);
    expect([...agenda.eventos.keys()]).toEqual([id]);
    expect((await listar('tarefas'))[0].feito).toBe(true);
  });

  it('com dados diferentes, o evento anterior é removido antes de criar o novo', async () => {
    const { agenda, tarefa } = await preparar();
    await expect(colocarNaAgenda(tarefa, marcacao)).rejects.toThrow();

    await colocarNaAgenda(tarefa, { ...marcacao, inicio: '17:00', fim: '18:00' });

    expect(agenda.de('removerEvento')).toHaveLength(1);
    expect([...agenda.eventos.values()].map((e) => e.inicio)).toEqual(['2026-11-06T17:00:00+00:00']);
  });

  it('se o evento anterior não pode ser removido, não cria outro (duplicaria) e registra o erro', async () => {
    const { agenda, tarefa } = await preparar();
    await expect(colocarNaAgenda(tarefa, marcacao)).rejects.toThrow();
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    agenda.modo('recusar');

    await expect(colocarNaAgenda(tarefa, { ...marcacao, inicio: '17:00', fim: '18:00' })).rejects.toThrow();

    expect(erro).toHaveBeenCalled();
    agenda.modo('ok');
    expect(agenda.eventos.size).toBe(1);
    expect(agenda.de('criarEvento')).toHaveLength(1);
  });
});

describe('Concluir sem agenda depois de uma tentativa que criou o evento', () => {
  const daAgenda = async () => (await listarPendentes()).filter((p) => p.tipo === 'agenda');

  it('o evento da tentativa anterior sai do Google e a tarefa conclui', async () => {
    const { agenda, tarefa } = await preparar();
    await expect(colocarNaAgenda(tarefa, marcacao)).rejects.toThrow('disco cheio');
    expect(agenda.eventos.size).toBe(1);

    const entrada = await concluirSemAgenda(tarefa.id);

    expect(entrada).toBeDefined();
    expect(agenda.eventos.size).toBe(0);
    expect((await listar('tarefas'))[0].feito).toBe(true);
    // Uma vez só: tentar Colocar na agenda depois cria um evento novo, não reaproveita o removido.
    expect(await daAgenda()).toEqual([]);
  });

  it('sem internet na primeira tentativa: o pedido de criar sai da fila e nada chega ao Google', async () => {
    const { agenda, tarefa } = await preparar();
    agenda.modo('rede');
    await expect(colocarNaAgenda(tarefa, marcacao)).rejects.toThrow('disco cheio');
    expect(await daAgenda()).toHaveLength(1);

    await concluirSemAgenda(tarefa.id);

    expect(await daAgenda()).toEqual([]);
    agenda.modo('ok');
    expect(agenda.eventos.size).toBe(0);
    expect((await listar('tarefas'))[0].feito).toBe(true);
  });

  it('o Google recusa a remoção agora: a remoção vai para a fila e a tarefa conclui mesmo assim', async () => {
    const { agenda, tarefa } = await preparar();
    await expect(colocarNaAgenda(tarefa, marcacao)).rejects.toThrow('disco cheio');
    const [id] = [...agenda.eventos.keys()];
    agenda.modo('recusar');
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await concluirSemAgenda(tarefa.id);

    expect(await daAgenda()).toMatchObject([{ acao: 'removerEvento', id }]);
    expect((await listar('tarefas'))[0].feito).toBe(true);
  });

  it('sem tentativa anterior, só conclui (nada vai para a agenda nem para a fila)', async () => {
    const agenda = agendaEscrita();
    await agenda.instalar();
    const tarefa = await criar('Marcar banca com o Prof. Souza', { marcar: true });

    await concluirSemAgenda(tarefa.id);

    expect(agenda.pedidos).toEqual([]);
    expect(await daAgenda()).toEqual([]);
    expect((await listar('tarefas'))[0].feito).toBe(true);
  });
});
