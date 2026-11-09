import { beforeEach, describe, expect, it, vi } from 'vitest';
import { criarItem } from '../../src/chat/interpretar';
import { ErroAgenda } from '../../src/dados/agenda';
import { criarCompromisso, desfazerCompromisso, trocarSalaDoCompromisso } from '../../src/dados/compromisso';
import { desfazer } from '../../src/dados/desfazer';
import { assinarEventos, lerEventos } from '../../src/dados/eventos';
import { listar, listarPendentes, salvar, semear } from '../../src/dados/loja';
import { migrarCompromissos } from '../../src/dados/migrar';
import { sincronizar, type Chamar } from '../../src/dados/sincronia';
import type { PendenteAgenda } from '../../src/dados/tipos';
import { agendaEscrita } from '../apoio/agenda-escrita';
import { servidorDeTeste } from '../apoio/servidor';

// Quinta-feira, 2026-11-05, 12:20 (Europe/Lisbon). Só a data é falsa.
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 5, 12, 20));
  await semear();
});

const novo = {
  titulo: 'Reunião sobre o projeto',
  data: '2026-11-06',
  inicio: '11:00',
  fim: '12:00',
  salaId: 'sala-investigacao',
};

const daAgenda = async () =>
  (await listarPendentes()).filter((p): p is PendenteAgenda => p.tipo === 'agenda');

const semEspera = (_ms: number) => Promise.resolve();

/** Sincroniza com o servidor de verdade para os registros e a agenda falsa para os eventos. */
function sincronizarCom(agenda: ReturnType<typeof agendaEscrita>) {
  const servidor = servidorDeTeste();
  const chamar = (<T>(acao: string, dados?: object) =>
    ['criarEvento', 'removerEvento', 'trocarSalaEvento'].includes(acao)
      ? agenda.chamar<T>(acao, dados)
      : servidor.chamar<T>(acao, dados)) as Chamar;
  return sincronizar({ chamar, esperar: semEspera });
}

describe('criarCompromisso', () => {
  it('cria o evento no Google Agenda, com o id do cliente, e nada fica na fila', async () => {
    const agenda = agendaEscrita();
    await agenda.instalar();

    const { eventoId, situacao } = await criarCompromisso(novo);

    expect(situacao).toBe('criado');
    expect(eventoId).toMatch(/^[0-9a-f]{32}$/);
    expect(agenda.eventos.get(eventoId)).toMatchObject({ titulo: 'Reunião sobre o projeto', salaId: 'sala-investigacao' });
    expect(agenda.de('criarEvento')[0].dados).toMatchObject({ id: eventoId, data: '2026-11-06', inicio: '11:00', fim: '12:00' });
    expect(await daAgenda()).toEqual([]);
  });

  it('as telas de calendário lêem de novo: a leitura guardada fica obsoleta', async () => {
    await (await import('../../src/dados/eventos')).atualizarEventos('2026-11-02', '2026-11-08', {
      conectado: async () => true,
      listar: async () => ({ eventos: [], incompleto: false }),
      pingar: async () => ({}),
      agora: () => 1000,
    });
    const avisos = vi.fn();
    const parar = assinarEventos(avisos);
    const agenda = agendaEscrita();
    await agenda.instalar();

    await criarCompromisso(novo);

    expect(lerEventos('2026-11-02', '2026-11-08').obsoleta).toBe(true);
    expect(avisos).toHaveBeenCalled();
    parar();
  });

  it('sem internet, o pedido fica em `pendentes` com o id do evento', async () => {
    const agenda = agendaEscrita();
    await agenda.instalar();
    agenda.modo('rede');

    const { eventoId, situacao } = await criarCompromisso(novo);

    expect(situacao).toBe('sem-internet');
    expect(await daAgenda()).toEqual([
      expect.objectContaining({ tipo: 'agenda', acao: 'criarEvento', evento: { ...novo, id: eventoId } }),
    ]);
  });

  it('sem conexão guardada, também fica na fila', async () => {
    const agenda = agendaEscrita();
    await agenda.instalar({ conectar: false });
    const { situacao } = await criarCompromisso(novo);
    expect(situacao).toBe('sem-internet');
    expect(await daAgenda()).toHaveLength(1);
  });

  it('o script recusando (permissão ainda não aprovada) também fica na fila, e diz isso', async () => {
    const agenda = agendaEscrita();
    await agenda.instalar();
    agenda.modo('recusar');

    const { situacao } = await criarCompromisso(novo);

    expect(situacao).toBe('recusada');
    expect(await daAgenda()).toHaveLength(1);
  });

  it('pedido que o script recusaria (fim antes do início) rejeita e não entra na fila', async () => {
    const agenda = agendaEscrita();
    await agenda.instalar();
    await expect(criarCompromisso({ ...novo, inicio: '12:00', fim: '11:00' })).rejects.toBeInstanceOf(ErroAgenda);
    expect(await daAgenda()).toEqual([]);
    expect(agenda.pedidos).toEqual([]);
  });
});

describe('a fila da agenda, na sincronia', () => {
  it('quando a internet volta, envia com o mesmo id e a fila esvazia', async () => {
    const agenda = agendaEscrita();
    await agenda.instalar();
    agenda.modo('rede');
    const { eventoId } = await criarCompromisso(novo);

    // Ainda sem internet: continua na fila.
    expect(await sincronizarCom(agenda)).toBe('por-enviar');
    expect(await daAgenda()).toHaveLength(1);

    agenda.modo('ok');
    expect(await sincronizarCom(agenda)).toBe('atualizado');
    expect(await daAgenda()).toEqual([]);
    expect([...agenda.eventos.keys()]).toEqual([eventoId]);
  });

  it('repetir o envio não duplica: o script devolve o evento já criado', async () => {
    const agenda = agendaEscrita();
    await agenda.instalar();
    agenda.modo('rede');
    const { eventoId } = await criarCompromisso(novo);
    agenda.modo('ok');
    // A resposta se perdeu depois de o Google criar: o app tenta de novo com o mesmo id.
    await agenda.chamar('criarEvento', { ...novo, id: eventoId });

    await sincronizarCom(agenda);

    expect(agenda.eventos.size).toBe(1);
    expect(await daAgenda()).toEqual([]);
  });

  it('o script recusando deixa na fila e tenta de novo na próxima rodada', async () => {
    const agenda = agendaEscrita();
    await agenda.instalar();
    agenda.modo('recusar');
    await criarCompromisso(novo);

    expect(await sincronizarCom(agenda)).toBe('por-enviar');
    expect(await daAgenda()).toHaveLength(1);

    agenda.modo('ok');
    expect(await sincronizarCom(agenda)).toBe('atualizado');
    expect(agenda.eventos.size).toBe(1);
  });

  it('uma ação recusada não trava as outras da fila', async () => {
    const agenda = agendaEscrita();
    await agenda.instalar();
    agenda.modo('rede');
    await criarCompromisso({ ...novo, titulo: 'Primeiro' });
    await criarCompromisso({ ...novo, titulo: 'Segundo', inicio: '14:00', fim: '15:00' });
    agenda.modo('ok');
    let vez = 0;
    agenda.aoCriar(() => {
      if (++vez === 1) throw new Error('recusado');
    });

    await sincronizarCom(agenda);

    expect([...agenda.eventos.values()].map((e) => e.titulo)).toEqual(['Segundo']);
    expect(await daAgenda()).toHaveLength(1);
  });
});

describe('desfazerCompromisso', () => {
  it('evento já criado: remove do Google Agenda', async () => {
    const agenda = agendaEscrita();
    await agenda.instalar();
    const { eventoId } = await criarCompromisso(novo);

    await desfazerCompromisso(eventoId);

    expect(agenda.eventos.size).toBe(0);
    expect(agenda.de('removerEvento')[0].dados).toEqual({ id: eventoId });
  });

  it('pedido ainda na fila: só tira da fila, sem falar com o Google', async () => {
    const agenda = agendaEscrita();
    await agenda.instalar();
    agenda.modo('rede');
    const { eventoId } = await criarCompromisso(novo);
    agenda.modo('ok');
    const antes = agenda.pedidos.length;

    await desfazerCompromisso(eventoId);

    expect(await daAgenda()).toEqual([]);
    expect(agenda.pedidos.length).toBe(antes);
    await sincronizarCom(agenda);
    expect(agenda.eventos.size).toBe(0);
  });

  it('desfeito enquanto o envio está em curso: a sincronia remove o evento que acabou de criar', async () => {
    const agenda = agendaEscrita();
    await agenda.instalar();
    agenda.modo('rede');
    const { eventoId } = await criarCompromisso(novo);
    agenda.modo('ok');
    // O dono desfaz no meio do envio, antes de o Google responder.
    agenda.aoCriar(() => desfazerCompromisso(eventoId));

    await sincronizarCom(agenda);

    expect(agenda.eventos.size).toBe(0);
    expect(await daAgenda()).toEqual([]);
  });

  it('sem internet, a remoção entra na fila e sai quando a conexão volta', async () => {
    const agenda = agendaEscrita();
    await agenda.instalar();
    const { eventoId } = await criarCompromisso(novo);
    agenda.modo('rede');

    await desfazerCompromisso(eventoId);

    expect(await daAgenda()).toEqual([expect.objectContaining({ acao: 'removerEvento', id: eventoId })]);
    agenda.modo('ok');
    await sincronizarCom(agenda);
    expect(agenda.eventos.size).toBe(0);
    expect(await daAgenda()).toEqual([]);
  });

  it('o Google recusando a remoção rejeita, para o cartão avisar', async () => {
    const agenda = agendaEscrita();
    await agenda.instalar();
    const { eventoId } = await criarCompromisso(novo);
    agenda.modo('recusar');
    await expect(desfazerCompromisso(eventoId)).rejects.toBeInstanceOf(ErroAgenda);
    expect(agenda.eventos.size).toBe(1);
  });
});

describe('trocarSalaDoCompromisso', () => {
  it('na fila, muda a sala do pedido; no Google Agenda, troca no evento', async () => {
    const agenda = agendaEscrita();
    await agenda.instalar();
    agenda.modo('rede');
    const { eventoId: naFila } = await criarCompromisso(novo);
    await trocarSalaDoCompromisso(naFila, 'sala-mba');
    expect(((await daAgenda())[0] as { evento: { salaId: string } }).evento.salaId).toBe('sala-mba');

    agenda.modo('ok');
    const { eventoId: noGoogle } = await criarCompromisso({ ...novo, titulo: 'Outro', inicio: '15:00', fim: '16:00' });
    await trocarSalaDoCompromisso(noGoogle, null);
    expect(agenda.eventos.get(noGoogle)?.salaId).toBeNull();
  });
});

describe('criarItem com compromisso (chat)', () => {
  const compromisso = { tipo: 'compromisso' as const, titulo: 'Banca', salaId: null, data: '2026-11-06', inicio: '14:00', fim: '15:30', marcar: false };

  it('cria o evento, não cria tarefa, e o desfazer remove o evento', async () => {
    const agenda = agendaEscrita();
    await agenda.instalar();

    const criado = await criarItem(compromisso);

    expect(criado.tarefa).toBeUndefined();
    expect(criado.agenda).toBe('criado');
    expect(await listar('tarefas')).toEqual([]);
    expect(agenda.eventos.get(criado.eventoId!)).toMatchObject({ titulo: 'Banca', inicio: '2026-11-06T14:00:00+00:00', fim: '2026-11-06T15:30:00+00:00' });

    await criado.desfazer();
    expect(agenda.eventos.size).toBe(0);
    const pedidos = agenda.pedidos.length;
    await criado.desfazer(); // uma vez só
    expect(agenda.pedidos.length).toBe(pedidos);
  });

  it('o desfazer fica na pilha do app e tira a entrada quando usado pelo cartão', async () => {
    const agenda = agendaEscrita();
    await agenda.instalar();
    const criado = await criarItem(compromisso);
    expect(desfazer.ultimo()?.rotulo).toBe('Item do chat: Banca');

    await criado.desfazer();
    expect(desfazer.ultimo()?.rotulo).not.toBe('Item do chat: Banca');
  });

  it('sem internet: fica na fila, avisa, e o desfazer só tira da fila', async () => {
    const agenda = agendaEscrita();
    await agenda.instalar();
    agenda.modo('rede');

    const criado = await criarItem(compromisso);

    expect(criado.agenda).toBe('sem-internet');
    expect(await daAgenda()).toHaveLength(1);
    await criado.desfazer();
    expect(await daAgenda()).toEqual([]);
    expect(await listar('tarefas')).toEqual([]);
  });

  it('compromisso sem as duas horas ainda vira tarefa, sem hora de início', async () => {
    const { tarefa } = await criarItem({ ...compromisso, inicio: undefined });
    expect(tarefa).toBeDefined();
    expect('inicio' in tarefa!).toBe(false);
  });
});

describe('migrarCompromissos', () => {
  const antiga = (extra: object = {}) => ({
    titulo: 'Reunião com a Marina',
    salaId: 'sala-orientacoes',
    data: '2026-11-06',
    inicio: '15:30',
    duracaoMin: 90,
    duracaoConfirmada: true,
    feito: false,
    fixada: false,
    marcar: false,
    ...extra,
  });

  it('leva a tarefa com hora para a fila da agenda e a apaga, numa vez só', async () => {
    const tarefa = await salvar('tarefas', antiga());
    const comum = await salvar('tarefas', { ...antiga(), titulo: 'Sem hora', inicio: undefined });

    expect(await migrarCompromissos()).toBe(1);

    expect((await listar('tarefas')).map((t) => t.id)).toEqual([comum.id]);
    const [acao] = await daAgenda();
    expect(acao).toMatchObject({
      acao: 'criarEvento',
      evento: { titulo: 'Reunião com a Marina', data: '2026-11-06', inicio: '15:30', fim: '17:00', salaId: 'sala-orientacoes' },
    });
    expect(acao.acao === 'criarEvento' && acao.evento.id).toMatch(/^[0-9a-f]{32}$/);
    expect((await listar('tarefas', { comApagados: true })).find((t) => t.id === tarefa.id)?.apagado).toBe(true);
  });

  it('é idempotente: rodar de novo não cria mais nada', async () => {
    await salvar('tarefas', antiga());
    await migrarCompromissos();
    expect(await migrarCompromissos()).toBe(0);
    expect(await daAgenda()).toHaveLength(1);
  });

  it('dois aparelhos chegam ao mesmo id de evento, e o script não duplica', async () => {
    const tarefa = await salvar('tarefas', antiga());
    await migrarCompromissos();
    const [primeira] = await daAgenda();

    globalThis.indexedDB = new (await import('fake-indexeddb')).IDBFactory();
    await semear();
    await salvar('tarefas', { ...tarefa });
    await migrarCompromissos();
    const [segunda] = await daAgenda();

    expect(primeira.acao === 'criarEvento' && segunda.acao === 'criarEvento' && segunda.evento.id).toBe(
      primeira.acao === 'criarEvento' ? primeira.evento.id : '',
    );
  });

  it('o evento sai na sincronia, com o mesmo id, e a fila esvazia', async () => {
    const agenda = agendaEscrita();
    await agenda.instalar();
    await salvar('tarefas', antiga());
    await migrarCompromissos();
    const [acao] = await daAgenda();

    expect(await sincronizarCom(agenda)).toBe('atualizado');
    expect(await daAgenda()).toEqual([]);
    expect([...agenda.eventos.keys()]).toEqual([acao.acao === 'criarEvento' ? acao.evento.id : '']);
  });

  it('o fim não passa da meia-noite; hora que a agenda recusaria deixa a tarefa como está', async () => {
    await salvar('tarefas', antiga({ titulo: 'Tarde', inicio: '23:00', duracaoMin: 180 }));
    const quebrada = await salvar('tarefas', antiga({ titulo: 'Hora que não existe', data: '2027-03-28', inicio: '01:30' }));
    const longo = await salvar('tarefas', antiga({ titulo: 'x'.repeat(2000) }));

    expect(await migrarCompromissos()).toBe(1);

    const [acao] = await daAgenda();
    expect(acao.acao === 'criarEvento' && acao.evento.fim).toBe('23:59');
    const vivas = (await listar('tarefas')).map((t) => t.id);
    expect(vivas).toEqual(expect.arrayContaining([quebrada.id, longo.id]));
  });

  it('tarefa já concluída também é levada: o compromisso existiu', async () => {
    await salvar('tarefas', antiga({ feito: true }));
    expect(await migrarCompromissos()).toBe(1);
  });
});
