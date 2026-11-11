// Feito espelhado no Google (spec 2026-11-09), do lado do app: a fila
// `pendentes` leva as tarefas ao Google Tarefas e o "✓ " dos compromissos ao
// Google Agenda, com tentativas, sem duplicar e sem contar como "por enviar".
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ID_VALIDO } from '../../script/colecoes';
import { ErroConexao } from '../../src/conexao/cliente';
import type { Evento } from '../../src/dados/agenda';
import { aplicarFeitos, idDoFeito, marcarCompromissoFeito } from '../../src/dados/eventos-feitos';
import {
  INTERVALO_ENTRE_TENTATIVAS_MS,
  TENTATIVAS_NO_MAXIMO,
  enfileirarEspelhosQueFaltam,
  gravarDoServidor,
  guardarIdDoEspelho,
  lerIdsDoEspelho,
  listar,
  listarAvisos,
  listarPendentes,
  salvar,
} from '../../src/dados/loja';
import { sincronizar } from '../../src/dados/sincronia';
import {
  apagarTarefa,
  concluirTarefa,
  confirmarDuracao,
  criarTarefa,
  editarTarefa,
  moverParaDia,
  moverTarefas,
  reabrirTarefa,
} from '../../src/dados/tarefas';
import type { EventoFeito, PendenteEspelho, Tarefa } from '../../src/dados/tipos';
import { virarDia } from '../../src/dados/virada';
import { agendasDoDono } from '../apoio/calendario';
import { servidorDeTeste } from '../apoio/servidor';
import { criar } from '../apoio/tarefas';

// Segunda, 2026-11-09, 12:20 em Lisboa. Só o Date é falso (o fake-indexeddb usa timers reais).
const AGORA = Date.parse('2026-11-09T12:20:00Z');
const PRINCIPAL = 'marina.ficticia@example.com';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AGORA);
});

const espelhos = async () => (await listarPendentes()).filter((p): p is PendenteEspelho => p.tipo === 'espelho');
const daTarefa = async (id: string) =>
  (await espelhos()).filter((p) => p.acao === 'espelharTarefa' && p.tarefaId === id);
const semEspera = (_ms: number) => Promise.resolve();
const lerTarefa = async (id: string) => (await listar('tarefas')).find((t) => t.id === id) as Tarefa;

function comGoogle() {
  const agenda = agendasDoDono();
  const servidor = servidorDeTeste({ comTarefasGoogle: true, agenda });
  return { agenda, servidor, sincronizar: () => sincronizar({ chamar: servidor.chamar, esperar: semEspera }) };
}

describe('a fila do espelho de tarefas', () => {
  it('criar uma tarefa põe um espelharTarefa na fila, na mesma escrita', async () => {
    const tarefa = (await criarTarefa('Ligar para a Renata', { data: '2026-11-09' }))!;
    expect(await espelhos()).toEqual([
      { seq: expect.any(Number), tipo: 'espelho', acao: 'espelharTarefa', tarefaId: tarefa.id, criadoEm: AGORA, tentativas: 0 },
    ]);
  });

  it('título, dia, concluir, reabrir e apagar entram; duração e sala não', async () => {
    const tarefa = (await criarTarefa('Revisar parágrafo', { data: '2026-11-09' }))!;
    await confirmarDuracao(tarefa.id, 30);
    await editarTarefa(tarefa.id, { salaId: 'sala-doutoramento' });
    expect(await daTarefa(tarefa.id)).toHaveLength(1);
    await editarTarefa(tarefa.id, { titulo: 'Revisar parágrafo 2' });
    await moverParaDia(tarefa.id, '2026-11-12');
    await concluirTarefa(tarefa.id);
    await reabrirTarefa(tarefa.id);
    await apagarTarefa(tarefa.id);
    expect(await daTarefa(tarefa.id)).toHaveLength(6);
  });

  it('tarefa com hora (decisão de 11/11) vai para o Google Tarefas como as outras (o Google Tarefas guarda só o dia)', async () => {
    const comHora = await criar('Ligar para a Renata', { data: '2026-11-09', inicio: '10:00' });
    expect(await daTarefa(comHora.id)).toHaveLength(1);
  });

  it('o id da espelho fica só neste aparelho: não muda a tarefa nem entra na fila', async () => {
    const tarefa = (await criarTarefa('Comprar lâmpada'))!;
    const antes = await listarPendentes();
    const versao = await lerTarefa(tarefa.id);
    await guardarIdDoEspelho(tarefa.id, 'tarefaGoogle1');
    expect(await listarPendentes()).toEqual(antes);
    expect(await lerTarefa(tarefa.id)).toEqual(versao);
    expect(await lerIdsDoEspelho([tarefa.id, 'outra'])).toEqual(['tarefaGoogle1', undefined]);
  });

  it('a virada do dia e o Fechar o dia mudam o dia: entram no espelho', async () => {
    const ontem = await criar('Ficou de ontem', { data: '2026-11-08' });
    const hoje = await criar('De hoje', { data: '2026-11-09' });
    await virarDia('2026-11-09');
    expect(await daTarefa(ontem.id)).toHaveLength(2);
    await moverTarefas([hoje.id], { tipo: 'amanha', hoje: '2026-11-09' });
    expect(await daTarefa(hoje.id)).toHaveLength(2);
  });

  it('tarefas antigas sem espelho entram uma vez (também as com hora); feitas, já espelhadas e as que já estão na fila, não', async () => {
    const semEspelho = await criar('Antiga');
    const feita = await criar('Feita', { feito: true });
    const espelhada = await criar('Espelhada');
    await guardarIdDoEspelho(espelhada.id, 'tarefaGoogle9');
    const comHora = await criar('Com hora', { data: '2026-11-09', inicio: '10:00' });
    // Simula o aparelho antes do espelho: a fila sem os espelhos.
    const { removerPendentes } = await import('../../src/dados/loja');
    await removerPendentes((await espelhos()).map((p) => p.seq));

    expect(await enfileirarEspelhosQueFaltam()).toBe(2);
    expect(await enfileirarEspelhosQueFaltam()).toBe(0);
    const ids = (await espelhos()).map((p) => (p.acao === 'espelharTarefa' ? p.tarefaId : ''));
    expect(ids.sort()).toEqual([semEspelho.id, comHora.id].sort());
    for (const fora of [feita, espelhada]) expect(ids).not.toContain(fora.id);
  });
});

describe('sincronia com o Google Tarefas', () => {
  it('cria a espelho, guarda o id neste aparelho e a fila esvazia; o estado é atualizado', async () => {
    const { servidor, sincronizar } = comGoogle();
    const tarefa = (await criarTarefa('Ligar para a Renata', { data: '2026-11-09' }))!;
    expect(await sincronizar()).toBe('atualizado');

    const [espelho] = servidor.tarefasGoogle.vivas();
    expect(espelho).toMatchObject({ title: 'Ligar para a Renata', due: '2026-11-09T00:00:00.000Z', status: 'needsAction' });
    expect(await lerIdsDoEspelho([tarefa.id])).toEqual([espelho.id]);
    expect(await listarPendentes()).toEqual([]);
    // O id da espelho não vai ao Drive: o outro aparelho acha a espelho pelas notas.
    expect(servidor.armazem.conteudo).not.toContain(espelho.id);
    expect(servidor.de('enviar')).toHaveLength(1);
  });

  it('concluir, reabrir, mudar o dia, ir para Sem prazo e apagar seguem para a espelho', async () => {
    const { servidor, sincronizar } = comGoogle();
    const tarefa = (await criarTarefa('Revisar parágrafo', { data: '2026-11-09' }))!;
    await sincronizar();
    const espelho = () => servidor.tarefasGoogle.central()!.tarefas.get((servidor.tarefasGoogle.vivas()[0] ?? { id: '' }).id);

    await concluirTarefa(tarefa.id);
    await sincronizar();
    expect(espelho()!.status).toBe('completed');

    await reabrirTarefa(tarefa.id);
    await moverParaDia(tarefa.id, '2026-11-12');
    await sincronizar();
    expect(espelho()).toMatchObject({ status: 'needsAction', due: '2026-11-12T00:00:00.000Z' });

    await editarTarefa(tarefa.id, { quando: { tipo: 'sem-prazo' } });
    await sincronizar();
    expect(espelho()!.due).toBeUndefined();

    await apagarTarefa(tarefa.id);
    await sincronizar();
    expect(servidor.tarefasGoogle.vivas()).toEqual([]);
    expect(servidor.tarefasGoogle.de('Tasks.insert')).toHaveLength(1);
    expect(await listarPendentes()).toEqual([]);
  });

  it('várias mudanças antes de sincronizar viram um pedido só, com a versão atual', async () => {
    const { servidor, sincronizar } = comGoogle();
    const tarefa = (await criarTarefa('Primeiro título', { data: '2026-11-09' }))!;
    await editarTarefa(tarefa.id, { titulo: 'Segundo título' });
    await concluirTarefa(tarefa.id);
    await sincronizar();
    expect(servidor.de('espelharTarefas')).toHaveLength(1);
    expect(servidor.tarefasGoogle.vivas()).toMatchObject([{ title: 'Segundo título', status: 'completed' }]);
  });

  it('resposta perdida: o reenvio acha a espelho pelas notas e não duplica', async () => {
    const { servidor, sincronizar } = comGoogle();
    await criarTarefa('Parafusar o apoio do banheiro');
    servidor.aoResponder((acao) => {
      if (acao === 'espelharTarefas') throw new ErroConexao();
    });
    await sincronizar();
    expect(servidor.tarefasGoogle.vivas()).toHaveLength(1);
    expect(await espelhos()).toHaveLength(1);

    servidor.aoResponder(undefined);
    await sincronizar();
    expect(servidor.tarefasGoogle.vivas()).toHaveLength(1);
    expect(await espelhos()).toEqual([]);
  });

  it('sem internet: o espelho fica na fila e vai quando a conexão volta', async () => {
    const { servidor, sincronizar } = comGoogle();
    await criarTarefa('Mandar mensagem para a Aurora', { data: '2026-11-09' });
    servidor.falharAntes((acao) => (acao === 'espelharTarefas' ? new ErroConexao() : undefined));
    await sincronizar();
    expect(await espelhos()).toHaveLength(1);
    expect((await espelhos())[0].tentativas).toBe(0);

    servidor.falharAntes(undefined);
    await sincronizar();
    expect(servidor.tarefasGoogle.vivas()).toHaveLength(1);
  });

  it('script sem o Google Tarefas (ainda não autorizado): fica na fila em silêncio, conta tentativas e não deixa "por enviar"', async () => {
    const servidor = servidorDeTeste();
    await criarTarefa('Revisar relatório', { data: '2026-11-09' });
    expect(await sincronizar({ chamar: servidor.chamar, esperar: semEspera })).toBe('atualizado');
    expect((await espelhos())[0].tentativas).toBe(1);

    // Uma rodada por hora: dentro da mesma hora as recusas contam uma vez só.
    for (let vez = 1; vez < TENTATIVAS_NO_MAXIMO; vez++) {
      vi.setSystemTime(Date.now() + INTERVALO_ENTRE_TENTATIVAS_MS);
      await sincronizar({ chamar: servidor.chamar, esperar: semEspera });
    }
    expect((await espelhos())[0].tentativas).toBe(TENTATIVAS_NO_MAXIMO);
    const chamadas = servidor.de('espelharTarefas').length;
    await sincronizar({ chamar: servidor.chamar, esperar: semEspera });
    expect(servidor.de('espelharTarefas').length).toBe(chamadas);
    expect(await espelhos()).toHaveLength(1);
  });

  it('a virada do dia leva o dia novo à espelho', async () => {
    const { servidor, sincronizar } = comGoogle();
    await criar('Ficou de ontem', { data: '2026-11-08' });
    await sincronizar();
    await virarDia('2026-11-09');
    await sincronizar();
    expect(servidor.tarefasGoogle.vivas()).toMatchObject([{ due: '2026-11-09T00:00:00.000Z' }]);
  });

  it('tarefa que ganhou hora antes do envio segue para o Google Tarefas, só com o dia', async () => {
    const { servidor, sincronizar } = comGoogle();
    const tarefa = (await criarTarefa('Ligar para a Renata', { data: '2026-11-09' }))!;
    const atual = await lerTarefa(tarefa.id);
    await gravarDoServidor([{ colecao: 'tarefas', registro: { ...atual, inicio: '10:00', atualizadoEm: AGORA + 1000, aparelho: 'outro' } }], AGORA + 1000);
    await sincronizar();
    expect(servidor.tarefasGoogle.vivas()).toMatchObject([{ due: '2026-11-09T00:00:00.000Z' }]);
    expect(await daTarefa(tarefa.id)).toEqual([]);
  });

  it('mais de 20 tarefas vão em lotes de até 20', async () => {
    const { servidor, sincronizar } = comGoogle();
    for (let i = 0; i < 25; i++) await criarTarefa(`Tarefa ${i}`);
    await sincronizar();
    expect(servidor.de('espelharTarefas').map((p) => p.dados.tarefas.length)).toEqual([20, 5]);
    expect(servidor.tarefasGoogle.vivas()).toHaveLength(25);
  });

  it('edição offline no aparelho A sobrevive ao id da espelho guardado no aparelho B', async () => {
    const notebook = new IDBFactory();
    const celular = new IDBFactory();
    const { servidor, sincronizar } = comGoogle();
    globalThis.indexedDB = notebook;
    const tarefa = (await criarTarefa('Revisar capítulo', { data: '2026-11-10' }))!;
    servidor.falharAntes((acao) => (acao === 'espelharTarefas' ? new ErroConexao() : undefined));
    await sincronizar();
    globalThis.indexedDB = celular;
    await sincronizar();

    // A, sem internet, muda o título; depois B espelha e guarda o id.
    globalThis.indexedDB = notebook;
    vi.setSystemTime(AGORA + 60_000);
    await editarTarefa(tarefa.id, { titulo: 'Revisar capítulo 3' });
    globalThis.indexedDB = celular;
    vi.setSystemTime(AGORA + 120_000);
    servidor.falharAntes(undefined);
    // B abre o app: a tarefa recebida do A, sem espelho aqui, entra na fila.
    expect(await enfileirarEspelhosQueFaltam()).toBe(1);
    await sincronizar();
    expect(servidor.tarefasGoogle.vivas()).toHaveLength(1);

    globalThis.indexedDB = notebook;
    await sincronizar();
    expect((await lerTarefa(tarefa.id)).titulo).toBe('Revisar capítulo 3');
    expect(await listarAvisos()).toEqual([]);
    globalThis.indexedDB = celular;
    await sincronizar();
    expect((await lerTarefa(tarefa.id)).titulo).toBe('Revisar capítulo 3');
    expect(await listarAvisos()).toEqual([]);
    expect(servidor.tarefasGoogle.vivas().map((t) => t.title)).toEqual(['Revisar capítulo 3']);
  });

  it('dois aparelhos: o outro muda a tarefa antes de receber o id da espelho, e nada duplica', async () => {
    const notebook = new IDBFactory();
    const celular = new IDBFactory();
    const { servidor, sincronizar } = comGoogle();
    globalThis.indexedDB = notebook;
    const tarefa = (await criarTarefa('Preparar aula', { data: '2026-11-10' }))!;
    servidor.falharAntes((acao) => (acao === 'espelharTarefas' ? new ErroConexao() : undefined));
    await sincronizar();
    globalThis.indexedDB = celular;
    await sincronizar();
    servidor.falharAntes(undefined);
    await editarTarefa(tarefa.id, { titulo: 'Preparar aula de MBA' });
    await sincronizar();
    globalThis.indexedDB = notebook;
    await sincronizar();
    expect(servidor.tarefasGoogle.vivas()).toHaveLength(1);
    expect(servidor.tarefasGoogle.vivas()[0].title).toBe('Preparar aula de MBA');
  });
});

describe('feito de compromisso', () => {
  function evento(extra: Partial<Evento> = {}): Evento {
    return {
      id: 'meu1',
      agendaId: 'primary',
      titulo: 'Orientação com Renata',
      inicio: '2026-11-09T14:00:00+00:00',
      fim: '2026-11-09T15:00:00+00:00',
      diaInteiro: false,
      livre: false,
      recusado: false,
      salaId: null,
      link: null,
      ...extra,
    };
  }
  const comEvento = (extra: Record<string, unknown> = {}) => {
    const google = comGoogle();
    google.agenda.evento(PRINCIPAL, {
      id: 'meu1',
      summary: 'Orientação com Renata',
      inicio: '2026-11-09T14:00:00+00:00',
      fim: '2026-11-09T15:00:00+00:00',
      ...extra,
    });
    return google;
  };

  it('o id do registro é fixo por agenda e evento, e vale como id de coleção', () => {
    expect(idDoFeito('primary', 'abc_20261109T140000Z')).toBe(idDoFeito('primary', 'abc_20261109T140000Z'));
    expect(idDoFeito('primary', 'abc')).not.toBe(idDoFeito('agenda-00000000001', 'abc'));
    expect(idDoFeito('primary', 'x'.repeat(1024))).toMatch(ID_VALIDO);
  });

  it('compromisso do dono: grava na Central e põe o "✓ " no Google pela fila', async () => {
    const { agenda, sincronizar } = comEvento();
    await marcarCompromissoFeito(evento(), true, '2026-11-09');
    const [registro] = await listar('eventosFeitos');
    expect(registro).toMatchObject({ eventoId: 'meu1', agendaId: 'primary', data: '2026-11-09', feito: true });
    expect(await espelhos()).toMatchObject([{ acao: 'marcarEventoFeito', id: 'meu1', feito: true }]);

    expect(await sincronizar()).toBe('atualizado');
    expect(agenda.agendas.get(PRINCIPAL)!.eventos.get('meu1')!.summary).toBe('✓ Orientação com Renata');
    expect(await listarPendentes()).toEqual([]);
  });

  it('marcar e desmarcar antes de sincronizar: vale o último toque, num pedido só', async () => {
    const { agenda, servidor, sincronizar } = comEvento();
    await marcarCompromissoFeito(evento(), true, '2026-11-09');
    await marcarCompromissoFeito(evento(), false, '2026-11-09');
    expect(await espelhos()).toMatchObject([{ acao: 'marcarEventoFeito', feito: false }]);
    expect(await listar('eventosFeitos')).toMatchObject([{ feito: false }]);
    await sincronizar();
    expect(servidor.de('marcarEventoFeito')).toHaveLength(1);
    expect(agenda.agendas.get(PRINCIPAL)!.eventos.get('meu1')!.summary).toBe('Orientação com Renata');
  });

  it('convite de outra pessoa: fica só na Central, sem pedido ao Google e sem erro', async () => {
    const { servidor, sincronizar } = comEvento({ organizer: { email: 'souza.ficticio@example.com' } });
    await marcarCompromissoFeito(evento({ somenteLeitura: true }), true, '2026-11-09');
    expect(await listar('eventosFeitos')).toMatchObject([{ feito: true }]);
    expect(await espelhos()).toEqual([]);
    expect(await sincronizar()).toBe('atualizado');
    expect(servidor.de('marcarEventoFeito')).toEqual([]);
  });

  it('evento de outra agenda: só na Central', async () => {
    await marcarCompromissoFeito(evento({ agendaId: 'agenda-0000000000a' }), true, '2026-11-09');
    expect(await espelhos()).toEqual([]);
  });

  it('o Google não deixa gravar (virou convite, sumiu): sai da fila sem erro e o feito fica na Central', async () => {
    const { servidor, sincronizar } = comEvento({ organizer: { email: 'renata.ficticia@example.com' } });
    await marcarCompromissoFeito(evento(), true, '2026-11-09');
    expect(await sincronizar()).toBe('atualizado');
    expect(servidor.de('marcarEventoFeito')).toHaveLength(1);
    expect(await listarPendentes()).toEqual([]);
    expect(await listar('eventosFeitos')).toMatchObject([{ feito: true }]);
  });

  it('aplicarFeitos: o registro da Central vale sobre o Google; sem registro, fica o do Google', () => {
    const doGoogle = [evento({ id: 'a', feito: true }), evento({ id: 'b' }), evento({ id: 'c' })];
    const registro = (id: string, feito: boolean): EventoFeito => ({
      id: idDoFeito('primary', id),
      eventoId: id,
      agendaId: 'primary',
      data: '2026-11-09',
      feito,
      atualizadoEm: 1,
      aparelho: 'notebook',
    });
    expect(aplicarFeitos(doGoogle, [])).toBe(doGoogle);
    const lista = aplicarFeitos(doGoogle, [registro('a', false), registro('b', true)]);
    expect(lista.map((e) => !!e.feito)).toEqual([false, true, false]);
    expect('feito' in lista[0]).toBe(false);
  });
});
