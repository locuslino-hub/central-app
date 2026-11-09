// @vitest-environment node
// Blocos do Google Tarefas na Agenda e cor dos eventos (spec 2026-11-09,
// blocos e cores): o bloco é reconhecido pelo link na descrição (ou pelo
// campo taskId), conta como ocupado e tem o feito vivendo no Google Tarefas.
import { describe, expect, it, vi } from 'vitest';
import { PedidoInvalido, listarEventos, type ServicoDeAgenda } from '../../script/agenda';
import { tratar, type Ambiente } from '../../script/api';
import {
  SEGUNDOS_DO_LOCAL,
  estadosDasTarefas,
  marcarTarefaGoogle,
  type GuardaDeTarefas,
  type ServicoDeTarefas,
} from '../../script/tarefas-google';
import { armazemNaMemoria } from '../apoio/armazem';
import { agendasDoDono, calendarioFalso, type CalendarioFalso, type OpcoesDoFalso } from '../apoio/calendario';
import { tarefasGoogleFalso, type TarefasGoogleFalso } from '../apoio/tarefas-google';

const PRINCIPAL = 'marina.ficticia@example.com';
const AULAS = 'aulas-ficticias@group.example.com';
const CODIGO = 'codigo-ficticio-de-teste-0123456789abcdef';
const HORA = { inicio: '2026-10-23T11:00:00+01:00', fim: '2026-10-23T12:00:00+01:00' };
const DIA = { de: '2026-10-23', ate: '2026-10-23' };
const AVISO = 'As mudanças feitas no título, na descrição ou nos anexos não serão salvas. Para fazer edições, acesse: ';
const descricao = (id: string) => `${AVISO}https://tasks.google.com/task/${id}`;

const servico = (cal: CalendarioFalso) => cal.servico as unknown as ServicoDeAgenda;
const tarefas = (t: TarefasGoogleFalso) => t.servico as unknown as ServicoDeTarefas;

/** Um bloco do Google Tarefas na principal, como o Google Agenda mostra. */
function bloco(cal: CalendarioFalso, id: string, idDaTarefa: string, extra: Record<string, unknown> = {}) {
  return cal.evento(PRINCIPAL, {
    id,
    summary: 'Revisar capítulo da Aurora',
    ...HORA,
    description: descricao(idDaTarefa),
    transparency: 'transparent',
    eventType: 'focusTime',
    ...extra,
  });
}

function cacheNaMemoria(): GuardaDeTarefas & { valores: Map<string, string>; prazos: Map<string, number> } {
  const valores = new Map<string, string>();
  const prazos = new Map<string, number>();
  return {
    valores,
    prazos,
    get: (chave) => valores.get(chave) ?? null,
    put(chave, valor, segundos) {
      valores.set(chave, valor);
      prazos.set(chave, segundos);
    },
    putAll(novos, segundos) {
      for (const [chave, valor] of Object.entries(novos)) this.put(chave, valor, segundos);
    },
    remove: (chave) => void valores.delete(chave),
  };
}

describe('bloco do Google Tarefas na leitura dos eventos', () => {
  it('é reconhecido pelo link na descrição: vem com o id da tarefa e nunca com a descrição', () => {
    const cal = agendasDoDono();
    bloco(cal, 'bloco1', 'webAbc_12-3');
    const [evento] = listarEventos(DIA, servico(cal)).eventos;
    expect(evento.tarefaGoogleId).toBe('webAbc_12-3');
    expect(JSON.stringify(evento)).not.toContain('tasks.google.com');
    expect(JSON.stringify(evento)).not.toContain('mudanças');
  });

  it('conta como ocupado, mesmo marcado como disponível (transparent) no Google', () => {
    const cal = agendasDoDono();
    bloco(cal, 'bloco1', 'webAbc');
    cal.evento(PRINCIPAL, { id: 'comum', summary: 'Café com a Renata', ...HORA, transparency: 'transparent' });
    const eventos = listarEventos(DIA, servico(cal)).eventos;
    expect(eventos.find((e) => e.id === 'bloco1')!.livre).toBe(false);
    expect(eventos.find((e) => e.id === 'comum')!.livre).toBe(true);
  });

  it('evento comum, ou com descrição sem o link, não é bloco', () => {
    const cal = agendasDoDono();
    cal.evento(PRINCIPAL, { id: 'comum', summary: 'Banca', ...HORA, description: 'Sala 3, levar a tese' });
    expect(listarEventos(DIA, servico(cal)).eventos[0].tarefaGoogleId).toBeUndefined();
  });

  it('o campo taskId vale quando a API o conhece e a leitura dele está ligada', () => {
    const cal = agendasDoDono({ camposNovos: ['taskId'] });
    cal.evento(PRINCIPAL, { id: 'b2', summary: 'Ler artigo', ...HORA, taskId: 'idDaApi9' });
    expect(listarEventos(DIA, servico(cal), { extras: ['taskId'] }).eventos[0].tarefaGoogleId).toBe('idDaApi9');
    // Sem a leitura ligada, o campo nem é pedido.
    expect(listarEventos(DIA, servico(cal)).eventos[0].tarefaGoogleId).toBeUndefined();
  });

  it('sem campos extras ligados, nunca pede label nem taskId (a API pode não conhecer)', () => {
    const cal = agendasDoDono();
    listarEventos(DIA, servico(cal));
    for (const chamada of cal.de('Events.list')) expect((chamada.args[1] as { fields: string }).fields).not.toMatch(/label|taskId/);
  });

  it('extras que a API não conhece (400) voltam aos campos de base, sem perder os eventos', () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cal = agendasDoDono();
    bloco(cal, 'bloco1', 'webAbc');
    const { eventos, incompleto } = listarEventos(DIA, servico(cal), { extras: ['label', 'taskId'] });
    expect(eventos.map((e) => e.id)).toEqual(['bloco1']);
    expect(incompleto).toBe(false);
    expect(erro.mock.calls.flat().join(' ')).not.toMatch(/Aurora|webAbc|bloco1|marina/);
    erro.mockRestore();
  });

  it('id inválido no link não vira bloco', () => {
    const cal = agendasDoDono();
    cal.evento(PRINCIPAL, { id: 'x', summary: 'X', ...HORA, description: 'https://tasks.google.com/task/' });
    expect(listarEventos(DIA, servico(cal)).eventos[0].tarefaGoogleId).toBeUndefined();
  });
});

describe('cor do evento', () => {
  function comCores(opcoes?: OpcoesDoFalso) {
    const cal = calendarioFalso({ camposNovos: ['label'], ...opcoes });
    cal.agenda({ id: PRINCIPAL, summary: 'Marina', primary: true, backgroundColor: '#9FC6E7' });
    cal.agenda({ id: AULAS, summary: 'Aulas da Aurora', accessRole: 'writer', backgroundColor: '#7bd148' });
    return cal;
  }

  it('etiqueta (label) primeiro, depois colorId, depois a cor da agenda', () => {
    const cal = comCores();
    cal.evento(PRINCIPAL, { id: 'e1', summary: 'Tese', ...HORA, label: { id: 'etq_1', backgroundColor: '#3F51B5' }, colorId: '11' });
    cal.evento(PRINCIPAL, { id: 'e2', summary: 'Aula', ...HORA, colorId: '10' });
    cal.evento(PRINCIPAL, { id: 'e3', summary: 'Almoço', ...HORA });
    cal.evento(AULAS, { id: 'e4', summary: 'Aula da Aurora', ...HORA });
    const porId = new Map(listarEventos(DIA, servico(cal), { extras: ['label'] }).eventos.map((e) => [e.id, e.cor]));
    expect(porId.get('e1')).toEqual({ chave: 'label:etq_1', hex: '#3f51b5' });
    expect(porId.get('e2')).toEqual({ chave: 'cor:10', hex: '#0b8043' });
    expect(porId.get('e3')).toEqual({ chave: 'agenda:9fc6e7', hex: '#9fc6e7' });
    expect(porId.get('e4')).toEqual({ chave: 'agenda:7bd148', hex: '#7bd148' });
  });

  it('etiqueta ou colorId fora da forma esperada não passam', () => {
    const cal = comCores();
    cal.evento(PRINCIPAL, { id: 'e1', summary: 'A', ...HORA, label: { id: 'com espaço', backgroundColor: '#3f51b5' } });
    cal.evento(PRINCIPAL, { id: 'e2', summary: 'B', ...HORA, colorId: '99' });
    const cores = listarEventos(DIA, servico(cal), { extras: ['label'] }).eventos.map((e) => e.cor?.chave);
    expect(cores).toEqual(['agenda:9fc6e7', 'agenda:9fc6e7']);
  });

  it('agenda sem cor e evento sem cor: sem `cor`', () => {
    const cal = agendasDoDono();
    cal.evento(PRINCIPAL, { id: 'e1', summary: 'A', ...HORA });
    expect(listarEventos(DIA, servico(cal)).eventos[0].cor).toBeUndefined();
  });

  it('a lista de agendas pede a cor', () => {
    const cal = comCores();
    listarEventos(DIA, servico(cal));
    expect((cal.de('CalendarList.list')[0].args[0] as { fields: string }).fields).toContain('backgroundColor');
  });
});

describe('estado das tarefas dos blocos (Google Tarefas -> Central)', () => {
  function cenario() {
    const cal = agendasDoDono();
    const t = tarefasGoogleFalso();
    const minhas = t.lista('Minhas tarefas');
    const tese = t.lista('Tese');
    t.tarefa(minhas, { id: 'api1', idDaWeb: 'web1', due: '2026-10-23T00:00:00.000Z', status: 'completed', updated: '2026-10-23T09:30:00.000Z' });
    t.tarefa(tese, { id: 'api2', idDaWeb: 'web2', due: '2026-10-23T00:00:00.000Z', status: 'needsAction', updated: '2026-10-22T08:00:00.000Z' });
    // Sem link: achada pelo id da API.
    t.tarefa(tese, { id: 'api3', due: '2026-10-23T00:00:00.000Z', status: 'completed', updated: '2026-10-23T10:00:00.000Z' });
    bloco(cal, 'b1', 'web1');
    bloco(cal, 'b2', 'web2');
    bloco(cal, 'b3', 'api3');
    bloco(cal, 'b4', 'naoExiste');
    return { cal, t };
  }

  const ler = (cal: CalendarioFalso, t: TarefasGoogleFalso, guarda: GuardaDeTarefas | null = null) =>
    listarEventos(DIA, servico(cal), { estadosDasTarefas: (ids, periodo) => estadosDasTarefas(ids, periodo, tarefas(t), guarda) }).eventos;

  it('o feito vem do Google Tarefas, com a hora da última mudança', () => {
    const { cal, t } = cenario();
    const porId = new Map(ler(cal, t).map((e) => [e.id, e]));
    expect(porId.get('b1')).toMatchObject({ feito: true, tarefaAtualizadaEm: Date.parse('2026-10-23T09:30:00Z') });
    expect(porId.get('b2')!.feito).toBeUndefined();
    expect(porId.get('b2')!.tarefaAtualizadaEm).toBe(Date.parse('2026-10-22T08:00:00Z'));
    expect(porId.get('b3')).toMatchObject({ feito: true });
    expect(porId.get('b4')!.tarefaAtualizadaEm).toBeUndefined();
  });

  it('lê em lote: uma leitura por lista, filtrada pelo dia, nunca uma por evento', () => {
    const { cal, t } = cenario();
    ler(cal, t);
    const leituras = t.de('Tasks.list');
    expect(leituras).toHaveLength(2);
    for (const chamada of leituras) {
      expect(chamada.args[1]).toMatchObject({
        showCompleted: true,
        showHidden: true,
        dueMin: '2026-10-22T00:00:00.000Z',
        dueMax: '2026-10-25T00:00:00.000Z',
      });
    }
    expect(t.de('Tasks.get')).toEqual([]);
  });

  it('com cache: a segunda leitura logo depois não chama o Google Tarefas', () => {
    const { cal, t } = cenario();
    const guarda = cacheNaMemoria();
    ler(cal, t, guarda);
    const antes = t.chamadas.length;
    expect(ler(cal, t, guarda).find((e) => e.id === 'b1')!.feito).toBe(true);
    expect(t.chamadas.length).toBe(antes);
    // O lugar das tarefas fica guardado por 6 h, para marcar sem procurar.
    expect(guarda.prazos.get('tarefa:web1')).toBe(SEGUNDOS_DO_LOCAL);
  });

  it('falha no Google Tarefas não derruba os eventos', () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { cal, t } = cenario();
    vi.spyOn(t.servico.Tasklists, 'list').mockImplementation(() => {
      throw Object.assign(new Error('API call to tasks.tasklists.list failed with error: Backend Error'), { details: { code: 500 } });
    });
    const eventos = ler(cal, t);
    expect(eventos).toHaveLength(4);
    expect(eventos.every((e) => e.tarefaAtualizadaEm === undefined)).toBe(true);
    expect(erro.mock.calls.flat().join(' ')).toContain('estado das tarefas ignorado');
    erro.mockRestore();
  });

  it('sem blocos no período, nem chama o Google Tarefas', () => {
    const cal = agendasDoDono();
    const t = tarefasGoogleFalso();
    cal.evento(PRINCIPAL, { id: 'e', summary: 'Café', ...HORA });
    ler(cal, t);
    expect(t.chamadas).toEqual([]);
  });
});

describe('marcarTarefaGoogle', () => {
  function cenario() {
    const t = tarefasGoogleFalso({ agora: () => Date.parse('2026-10-23T15:00:00Z') });
    t.lista('Minhas tarefas');
    const tese = t.lista('Tese');
    const alvo = t.tarefa(tese, { id: 'api2', idDaWeb: 'web2', title: 'Revisar capítulo' });
    return { t, tese, alvo };
  }

  it('acha a tarefa em qualquer lista pelo link e conclui; título não muda', () => {
    const { t, alvo } = cenario();
    expect(marcarTarefaGoogle({ taskId: 'web2', feito: true }, tarefas(t), null)).toEqual({ feito: true, gravado: true });
    expect(alvo).toMatchObject({ status: 'completed', title: 'Revisar capítulo' });
    expect(t.de('Tasks.patch')[0].args[0]).toEqual({ status: 'completed' });
    expect(t.de('Tasks.list')[0].args[1]).toMatchObject({ showCompleted: true, showHidden: true });
  });

  it('reabre com needsAction e completed null', () => {
    const { t, alvo } = cenario();
    marcarTarefaGoogle({ taskId: 'web2', feito: true }, tarefas(t), null);
    expect(marcarTarefaGoogle({ taskId: 'web2', feito: false }, tarefas(t), null)).toEqual({ feito: false, gravado: true });
    expect(alvo.status).toBe('needsAction');
    expect(alvo.completed).toBeUndefined();
    expect(t.de('Tasks.patch')[1].args[0]).toEqual({ status: 'needsAction', completed: null });
  });

  it('acha também pelo id da API', () => {
    const { t, alvo } = cenario();
    expect(marcarTarefaGoogle({ taskId: 'api2', feito: true }, tarefas(t), null).gravado).toBe(true);
    expect(alvo.status).toBe('completed');
  });

  it('guarda o lugar por 6 h: a segunda marcação não procura de novo', () => {
    const { t } = cenario();
    const guarda = cacheNaMemoria();
    marcarTarefaGoogle({ taskId: 'web2', feito: true }, tarefas(t), guarda);
    expect(guarda.prazos.get('tarefa:web2')).toBe(6 * 60 * 60);
    const listas = t.de('Tasklists.list').length;
    marcarTarefaGoogle({ taskId: 'web2', feito: false }, tarefas(t), guarda);
    expect(t.de('Tasklists.list').length).toBe(listas);
    expect(t.de('Tasks.get')).toHaveLength(1);
  });

  it('lugar guardado que não vale mais (tarefa apagada): procura de novo', () => {
    const { t, tese } = cenario();
    const guarda = cacheNaMemoria();
    guarda.put('tarefa:web2', JSON.stringify({ l: tese.id, i: 'sumiu' }), 100);
    expect(marcarTarefaGoogle({ taskId: 'web2', feito: true }, tarefas(t), guarda).gravado).toBe(true);
    expect(JSON.parse(guarda.get('tarefa:web2')!)).toEqual({ l: tese.id, i: 'api2' });
  });

  it('já no estado pedido: não grava', () => {
    const { t } = cenario();
    expect(marcarTarefaGoogle({ taskId: 'web2', feito: false }, tarefas(t), null)).toEqual({ feito: false, gravado: true });
    expect(t.de('Tasks.patch')).toEqual([]);
  });

  it('marcar invalida o estado guardado: a próxima leitura dos eventos vê o novo', () => {
    const { t } = cenario();
    const cal = agendasDoDono();
    t.listas.forEach((l) => l.tarefas.forEach((x) => (x.due = '2026-10-23T00:00:00.000Z')));
    bloco(cal, 'b', 'web2');
    const guarda = cacheNaMemoria();
    const ler = () =>
      listarEventos(DIA, servico(cal), { estadosDasTarefas: (ids, p) => estadosDasTarefas(ids, p, tarefas(t), guarda) }).eventos[0];
    expect(ler().feito).toBeUndefined();
    marcarTarefaGoogle({ taskId: 'web2', feito: true }, tarefas(t), guarda);
    expect(ler()).toMatchObject({ feito: true, tarefaAtualizadaEm: Date.parse('2026-10-23T15:00:00Z') });
  });

  it('sem a tarefa, sem permissão ou sem o serviço: gravado false, sem erro', () => {
    const { t } = cenario();
    expect(marcarTarefaGoogle({ taskId: 'outra', feito: true }, tarefas(t), null)).toEqual({ feito: true, gravado: false });
    expect(marcarTarefaGoogle({ taskId: 'web2', feito: true }, null, null)).toEqual({ feito: true, gravado: false });
    vi.spyOn(t.servico.Tasks, 'patch').mockImplementation(() => {
      throw Object.assign(new Error('API call to tasks.tasks.patch failed with error: Insufficient Permission'), { details: { code: 403 } });
    });
    expect(marcarTarefaGoogle({ taskId: 'web2', feito: true }, tarefas(t), null)).toEqual({ feito: true, gravado: false });
  });

  it('falha passageira do Google (500) lança: a fila tenta de novo', () => {
    const { t } = cenario();
    vi.spyOn(t.servico.Tasks, 'patch').mockImplementation(() => {
      throw Object.assign(new Error('API call to tasks.tasks.patch failed with error: Backend Error'), { details: { code: 500 } });
    });
    expect(() => marcarTarefaGoogle({ taskId: 'web2', feito: true }, tarefas(t), null)).toThrow(/Backend Error/);
  });

  it('pedido com forma errada não chama o Google', () => {
    const { t } = cenario();
    for (const dados of [{}, { taskId: 'web2' }, { taskId: 'a/b', feito: true }, { taskId: 'web2', feito: 'sim' }, null]) {
      expect(() => marcarTarefaGoogle(dados, tarefas(t), null)).toThrow(PedidoInvalido);
    }
    expect(t.chamadas).toEqual([]);
  });
});

describe('ações do script', () => {
  function ambiente(cal: CalendarioFalso, t: TarefasGoogleFalso | null, guarda?: GuardaDeTarefas): Ambiente {
    return {
      lerCodigo: () => CODIGO,
      armazem: armazemNaMemoria(),
      calendario: () => servico(cal),
      ...(t ? { tarefasGoogle: () => tarefas(t) } : {}),
      ...(guarda ? { guardaDeTarefas: guarda } : {}),
    };
  }

  it('marcarTarefaGoogle responde gravado true/false; sem o Google Tarefas, false sem erro', () => {
    const cal = agendasDoDono();
    const t = tarefasGoogleFalso();
    t.tarefa(t.lista('Tese'), { id: 'api1', idDaWeb: 'web1' });
    expect(tratar({ codigo: CODIGO, acao: 'marcarTarefaGoogle', dados: { taskId: 'web1', feito: true } }, ambiente(cal, t))).toEqual({
      ok: true,
      dados: { feito: true, gravado: true },
    });
    expect(tratar({ codigo: CODIGO, acao: 'marcarTarefaGoogle', dados: { taskId: 'web1', feito: true } }, ambiente(cal, null))).toEqual({
      ok: true,
      dados: { feito: true, gravado: false },
    });
  });

  it('eventos traz o feito dos blocos lido no Google Tarefas, guardando no cache do ambiente', () => {
    const cal = agendasDoDono();
    const t = tarefasGoogleFalso();
    t.tarefa(t.lista('Tese'), { id: 'api1', idDaWeb: 'web1', due: '2026-10-23T00:00:00.000Z', status: 'completed' });
    bloco(cal, 'b1', 'web1');
    const guarda = cacheNaMemoria();
    const resposta = tratar({ codigo: CODIGO, acao: 'eventos', dados: DIA }, ambiente(cal, t, guarda)) as { ok: true; dados: { eventos: unknown[] } };
    expect(resposta.dados.eventos[0]).toMatchObject({ id: 'b1', tarefaGoogleId: 'web1', feito: true, livre: false });
    expect(guarda.get('tarefa:web1')).not.toBeNull();
  });

  it('eventos sem o Google Tarefas ligado: blocos sem estado, sem erro', () => {
    const cal = agendasDoDono();
    bloco(cal, 'b1', 'web1');
    const resposta = tratar({ codigo: CODIGO, acao: 'eventos', dados: DIA }, ambiente(cal, null)) as { ok: true; dados: { eventos: unknown[] } };
    expect(resposta.dados.eventos[0]).toMatchObject({ id: 'b1', tarefaGoogleId: 'web1' });
  });
});
