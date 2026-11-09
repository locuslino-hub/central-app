// @vitest-environment node
// Revisão dos blocos do Google Tarefas (spec 2026-11-09): só é bloco o que o
// Google cria como bloco; tarefa repetida e espelho da lista "Central" não
// recebem o estado; a busca para marcar é barata e tem teto de tempo.
import { describe, expect, it, vi } from 'vitest';
import { listarEventos, type ServicoDeAgenda } from '../../script/agenda';
import {
  SEGUNDOS_DO_NAO_ACHADO,
  estadosDasTarefas,
  marcarTarefaGoogle,
  type GuardaDeTarefas,
  type ServicoDeTarefas,
} from '../../script/tarefas-google';
import { agendasDoDono, calendarioFalso, type CalendarioFalso } from '../apoio/calendario';
import { tarefasGoogleFalso, type TarefasGoogleFalso } from '../apoio/tarefas-google';

const PRINCIPAL = 'marina.ficticia@example.com';
const AULAS = 'aulas-ficticias@group.example.com';
const HORA = { inicio: '2026-10-23T11:00:00+01:00', fim: '2026-10-23T12:00:00+01:00' };
const DIA = { de: '2026-10-23', ate: '2026-10-23' };
const AVISO = 'As mudanças feitas no título não serão salvas. Para fazer edições, acesse: ';
const descricao = (id: string) => `${AVISO}https://tasks.google.com/task/${id}`;

const servico = (cal: CalendarioFalso) => cal.servico as unknown as ServicoDeAgenda;
const tarefas = (t: TarefasGoogleFalso) => t.servico as unknown as ServicoDeTarefas;

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

/** Relógio que anda `passo` ms a cada leitura. */
function relogioQueAnda(passo: number) {
  let agora = 0;
  return () => (agora += passo);
}

describe('só é bloco o que o Google cria como bloco', () => {
  const ids = (cal: CalendarioFalso) => listarEventos(DIA, servico(cal)).eventos.map((e) => [e.id, e.tarefaGoogleId ?? null]);

  it('link de tarefa colado no meio da descrição não faz bloco; no fim (com ?sa=6 e espaço), faz', () => {
    const cal = agendasDoDono();
    cal.evento(PRINCIPAL, { id: 'meio', summary: 'Reunião', ...HORA, description: 'ver https://tasks.google.com/task/abc antes da reunião' });
    cal.evento(PRINCIPAL, { id: 'fim', summary: 'Bloco', ...HORA, description: `${descricao('xyz')}?sa=6 \n` });
    expect(ids(cal)).toEqual([
      ['meio', null],
      ['fim', 'xyz'],
    ]);
  });

  it('outra agenda, organizador que não é o dono ou convidados: não é bloco (e o evento segue como era)', () => {
    const cal = agendasDoDono();
    cal.evento(AULAS, { id: 'outra', summary: 'A', ...HORA, description: descricao('a1') });
    cal.evento(PRINCIPAL, { id: 'convite', summary: 'B', ...HORA, description: descricao('a2'), organizer: { email: 'renata.ficticia@example.com' } });
    cal.evento(PRINCIPAL, {
      id: 'comConvidados',
      summary: 'C',
      ...HORA,
      description: descricao('a3'),
      attendees: [{ self: true }, { email: 'souza.ficticio@example.com' }],
    });
    const eventos = listarEventos(DIA, servico(cal)).eventos;
    expect(eventos.every((e) => e.tarefaGoogleId === undefined)).toBe(true);
    const porId = new Map(eventos.map((e) => [e.id, e]));
    expect(porId.get('outra')!.somenteLeitura).toBe(true);
    expect(porId.get('convite')!.somenteLeitura).toBe(true);
    // Evento do dono com convidados segue como compromisso comum dele.
    expect(porId.get('comConvidados')!.somenteLeitura).toBeUndefined();
  });

  it('o bloco (tipo focusTime) não é somente leitura: o app grava o feito na tarefa', () => {
    const cal = agendasDoDono();
    cal.evento(PRINCIPAL, { id: 'b', summary: 'Bloco', ...HORA, description: descricao('xyz'), eventType: 'focusTime' });
    expect(listarEventos(DIA, servico(cal)).eventos[0].somenteLeitura).toBeUndefined();
  });
});

describe('tarefa repetida e espelho da "Central"', () => {
  function cenario() {
    const cal = agendasDoDono();
    const t = tarefasGoogleFalso();
    const tese = t.lista('Tese');
    const central = t.lista('Central');
    const due = '2026-10-23T00:00:00.000Z';
    t.tarefa(tese, { id: 'apiS', idDaWeb: 'serie', due, status: 'completed', updated: '2026-10-23T09:00:00.000Z' });
    t.tarefa(tese, { id: 'apiD', idDaWeb: 'dupla', due, status: 'completed', updated: '2026-10-23T09:00:00.000Z' });
    t.tarefa(central, { id: 'apiC', idDaWeb: 'espelho', due, status: 'needsAction' });
    t.tarefa(tese, { id: 'apiU', idDaWeb: 'unica', due, status: 'completed', updated: '2026-10-23T09:00:00.000Z' });
    const bloco = (id: string, web: string, extra: Record<string, unknown> = {}) =>
      cal.evento(PRINCIPAL, { id, summary: id, ...HORA, description: descricao(web), eventType: 'focusTime', ...extra });
    bloco('ocorrencia', 'serie', { recurringEventId: 'serieDeBlocos' });
    bloco('dupla1', 'dupla');
    bloco('dupla2', 'dupla', { inicio: '2026-10-23T15:00:00+01:00', fim: '2026-10-23T16:00:00+01:00' });
    bloco('espelho', 'espelho');
    bloco('unica', 'unica');
    return { cal, t };
  }
  const ler = (cal: CalendarioFalso, t: TarefasGoogleFalso) =>
    listarEventos(DIA, servico(cal), { estadosDasTarefas: (ids, p) => estadosDasTarefas(ids, p, tarefas(t), null) }).eventos;

  it('bloco em série ou com o id repetido vem marcado como repetido e sem o estado do Google Tarefas', () => {
    const { cal, t } = cenario();
    const porId = new Map(ler(cal, t).map((e) => [e.id, e]));
    for (const id of ['ocorrencia', 'dupla1', 'dupla2']) {
      expect(porId.get(id)).toMatchObject({ tarefaRepetida: true });
      expect(porId.get(id)!.feito).toBeUndefined();
      expect(porId.get(id)!.tarefaAtualizadaEm).toBeUndefined();
    }
    expect(porId.get('unica')).toMatchObject({ feito: true });
    expect(porId.get('unica')!.tarefaRepetida).toBeUndefined();
  });

  it('bloco de uma espelho da lista "Central" sai da leitura (a tarefa já está na Central)', () => {
    const { cal, t } = cenario();
    expect(ler(cal, t).map((e) => e.id)).not.toContain('espelho');
  });

  it('sem o Google Tarefas, a espelho não é reconhecida e fica (nada some sem certeza)', () => {
    const { cal } = cenario();
    expect(listarEventos(DIA, servico(cal)).eventos.map((e) => e.id)).toContain('espelho');
  });
});

describe('custo e tempo', () => {
  function cenario() {
    const t = tarefasGoogleFalso();
    const listas = [t.lista('Minhas tarefas'), t.lista('Tese'), t.lista('Casa')];
    // Muitas tarefas antigas, sem dia; a do bloco tem dia.
    for (let i = 0; i < 250; i++) t.tarefa(listas[1], { id: `velha${i}`, status: 'completed' });
    const alvo = t.tarefa(listas[2], { id: 'api9', idDaWeb: 'web9', due: '2026-10-23T00:00:00.000Z' });
    return { t, alvo };
  }

  it('com o dia do bloco, procura primeiro só nas tarefas desse dia', () => {
    const { t, alvo } = cenario();
    expect(marcarTarefaGoogle({ taskId: 'web9', feito: true, dia: '2026-10-23' }, tarefas(t), null)).toEqual({ feito: true, gravado: true });
    expect(alvo.status).toBe('completed');
    const leituras = t.de('Tasks.list');
    expect(leituras.every((c) => (c.args[1] as { dueMin?: string }).dueMin === '2026-10-22T00:00:00.000Z')).toBe(true);
    expect(leituras).toHaveLength(3);
  });

  it('dia inválido é pedido inválido', () => {
    const { t } = cenario();
    expect(() => marcarTarefaGoogle({ taskId: 'web9', feito: true, dia: '2026-02-30' }, tarefas(t), null)).toThrow();
  });

  it('não achada: guarda o "não achado" por 10 min e não procura de novo', () => {
    const { t } = cenario();
    const guarda = cacheNaMemoria();
    expect(marcarTarefaGoogle({ taskId: 'sumida', feito: true }, tarefas(t), guarda).gravado).toBe(false);
    expect(guarda.prazos.get('tarefa-nao:sumida')).toBe(SEGUNDOS_DO_NAO_ACHADO);
    const chamadas = t.chamadas.length;
    expect(marcarTarefaGoogle({ taskId: 'sumida', feito: true }, tarefas(t), guarda).gravado).toBe(false);
    expect(t.chamadas.length).toBe(chamadas);
  });

  it('as listas ficam guardadas: a segunda busca não lista as listas de novo', () => {
    const { t } = cenario();
    const guarda = cacheNaMemoria();
    marcarTarefaGoogle({ taskId: 'web9', feito: true }, tarefas(t), guarda);
    guarda.valores.delete('tarefa:web9');
    marcarTarefaGoogle({ taskId: 'web9', feito: false }, tarefas(t), guarda);
    expect(t.de('Tasklists.list')).toHaveLength(1);
  });

  it('busca que passa de 20 s: gravado false, sem erro', () => {
    const { t, alvo } = cenario();
    expect(marcarTarefaGoogle({ taskId: 'web9', feito: true }, tarefas(t), null, relogioQueAnda(8_000))).toEqual({ feito: true, gravado: false });
    expect(alvo.status).toBe('needsAction');
  });

  it('leitura dos estados que passa de 15 s: os eventos vêm sem estado, sem derrubar a agenda', () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { t } = cenario();
    const cal = agendasDoDono();
    cal.evento(PRINCIPAL, { id: 'b', summary: 'Bloco', ...HORA, description: descricao('web9'), eventType: 'focusTime' });
    const { eventos } = listarEventos(DIA, servico(cal), {
      estadosDasTarefas: (ids, p) => estadosDasTarefas(ids, p, tarefas(t), null, relogioQueAnda(6_000)),
    });
    expect(eventos.map((e) => [e.id, e.tarefaAtualizadaEm])).toEqual([['b', undefined]]);
    expect(erro.mock.calls.flat().join(' ')).toContain('tempo esgotado');
    erro.mockRestore();
  });

  it('tarefa que o Google não deixa mudar (400, ex. atribuída pelo Docs): gravado false, sem erro', () => {
    const { t } = cenario();
    vi.spyOn(t.servico.Tasks, 'patch').mockImplementation(() => {
      throw Object.assign(new Error('API call to tasks.tasks.patch failed with error: Bad Request'), { details: { code: 400 } });
    });
    expect(marcarTarefaGoogle({ taskId: 'web9', feito: true }, tarefas(t), null)).toEqual({ feito: true, gravado: false });
  });
});

describe('campos extras recusados pela API (400)', () => {
  it('a primeira recusa troca para os campos de base no resto da leitura e avisa para esquecer os extras', () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cal = calendarioFalso();
    cal.agenda({ id: PRINCIPAL, summary: 'Marina', primary: true });
    cal.agenda({ id: AULAS, summary: 'Aulas', accessRole: 'writer' });
    cal.evento(PRINCIPAL, { id: 'a', summary: 'A', ...HORA });
    cal.evento(AULAS, { id: 'b', summary: 'B', ...HORA });
    const aoRecusar = vi.fn();
    const { eventos } = listarEventos(DIA, servico(cal), { extras: ['label'], aoRecusarExtras: aoRecusar });
    expect(eventos.map((e) => e.id).sort()).toEqual(['a', 'b']);
    expect(aoRecusar).toHaveBeenCalledTimes(1);
    // Principal: uma recusa e a releitura. Aulas: já só com os de base.
    const campos = cal.de('Events.list').map((c) => (c.args[1] as { fields: string }).fields);
    expect(campos).toHaveLength(3);
    expect(campos.filter((f) => f.includes('label'))).toHaveLength(1);
    erro.mockRestore();
  });
});
