// @vitest-environment node
// Ampliação 11/11 do feito espelhado: concluir no Google Tarefas (lista
// "Central") uma tarefa criada pela Central conta na Central, e a Central
// nunca desmarca lá o que o dono concluiu, a não ser que ela mesma reabra a
// tarefa depois. Nomes fictícios.
import { describe, expect, it } from 'vitest';
import { PedidoInvalido } from '../../script/agenda';
import { tratar, type Ambiente } from '../../script/api';
import {
  CONCLUIDAS_NO_MAXIMO,
  JANELA_SEM_DESDE_MS,
  concluidasNoEspelho,
  espelharTarefas,
  marcadorDaTarefa,
  type ItemDoEspelho,
  type ServicoDeTarefas,
} from '../../script/tarefas-google';
import { armazemNaMemoria } from '../apoio/armazem';
import { tarefasGoogleFalso, type ListaGuardada, type TarefasGoogleFalso } from '../apoio/tarefas-google';

const CODIGO = 'codigo-ficticio-de-teste-0123456789abcdef';
const AGORA = Date.parse('2026-11-11T12:00:00Z');
const servico = (g: TarefasGoogleFalso) => g.servico as unknown as ServicoDeTarefas;

function item(extra: Partial<ItemDoEspelho> = {}): ItemDoEspelho {
  return { id: 'tarefa-1', titulo: 'Revisar parágrafo do relatório', data: '2026-11-10', feito: false, feitoEm: 0, apagado: false, ...extra };
}

const espelhar = (g: TarefasGoogleFalso, ...itens: ItemDoEspelho[]) => espelharTarefas({ tarefas: itens }, servico(g)).resultados;

/** O dono conclui a espelho direto no Google Tarefas. */
function concluirNoGoogle(g: TarefasGoogleFalso, googleId: string, quando: string) {
  const t = g.central()!.tarefas.get(googleId)!;
  t.status = 'completed';
  t.completed = quando;
  t.updated = quando;
}

function central(g: TarefasGoogleFalso): ListaGuardada {
  return g.central() ?? g.lista('Central');
}

describe('concluidasNoEspelho (ação lerEspelhos)', () => {
  it('devolve só as espelhas concluídas da lista "Central": o id da Central e a hora da conclusão', () => {
    const g = tarefasGoogleFalso();
    const outra = g.lista('Minhas tarefas');
    const c = central(g);
    g.tarefa(c, { id: 'g1', title: 'Ligar para a Renata', notes: marcadorDaTarefa('tarefa-1'), status: 'completed', completed: '2026-11-10T21:00:00.000Z', updated: '2026-11-10T21:00:00.000Z' });
    g.tarefa(c, { id: 'g2', title: 'Aberta', notes: marcadorDaTarefa('tarefa-2') });
    g.tarefa(c, { id: 'g3', title: 'Sem marcador', status: 'completed', completed: '2026-11-10T21:00:00.000Z', updated: '2026-11-10T21:00:00.000Z' });
    g.tarefa(c, { id: 'g4', notes: marcadorDaTarefa('tarefa-4'), status: 'completed', completed: '2026-11-10T21:00:00.000Z', updated: '2026-11-10T21:00:00.000Z', deleted: true });
    g.tarefa(c, { id: 'g5', notes: marcadorDaTarefa('tarefa-5'), status: 'completed', completed: '2026-11-10T22:00:00.000Z', updated: '2026-11-10T22:00:00.000Z', hidden: true });
    g.tarefa(outra, { id: 'g6', notes: marcadorDaTarefa('tarefa-6'), status: 'completed', completed: '2026-11-10T21:00:00.000Z', updated: '2026-11-10T21:00:00.000Z' });

    const resposta = concluidasNoEspelho({ desde: Date.parse('2026-11-10T00:00:00Z') }, servico(g), AGORA);
    expect(resposta).toEqual({
      concluidas: [
        { id: 'tarefa-1', em: Date.parse('2026-11-10T21:00:00.000Z') },
        { id: 'tarefa-5', em: Date.parse('2026-11-10T22:00:00.000Z') },
      ],
      agora: AGORA,
    });
    // Nada de título, notas ou id do Google na resposta.
    const texto = JSON.stringify(resposta);
    for (const proibido of ['Renata', 'central:', 'g1', 'g5']) expect(texto).not.toContain(proibido);
  });

  it('pede ao Google só as mudadas desde `desde` (updatedMin), filtra as concluídas aqui, com as escondidas e só os campos necessários', () => {
    const g = tarefasGoogleFalso();
    const c = central(g);
    g.tarefa(c, { id: 'g1', notes: marcadorDaTarefa('tarefa-1'), status: 'completed', completed: '2026-11-01T09:00:00.000Z', updated: '2026-11-01T09:00:00.000Z' });
    g.tarefa(c, { id: 'g2', notes: marcadorDaTarefa('tarefa-2'), status: 'completed', completed: '2026-11-10T09:00:00.000Z', updated: '2026-11-10T09:00:00.000Z' });
    const desde = Date.parse('2026-11-09T00:00:00Z');
    const { concluidas } = concluidasNoEspelho({ desde }, servico(g), AGORA);
    expect(concluidas.map((c) => c.id)).toEqual(['tarefa-2']);
    const [lista] = g.de('Tasks.list');
    expect(lista.args[1]).not.toHaveProperty('completedMin');
    expect(lista.args[1]).toMatchObject({
      showCompleted: true,
      showHidden: true,
      updatedMin: new Date(desde).toISOString(),
      fields: 'items(notes,status,completed,deleted),nextPageToken',
    });
  });

  it('sem `desde` (primeira leitura): olha os últimos 30 dias', () => {
    const g = tarefasGoogleFalso();
    central(g);
    concluidasNoEspelho({}, servico(g), AGORA);
    expect(g.de('Tasks.list')[0].args[1]).toMatchObject({ updatedMin: new Date(AGORA - JANELA_SEM_DESDE_MS).toISOString() });
    expect(JANELA_SEM_DESDE_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('sem a lista "Central": nada, e não cria a lista', () => {
    const g = tarefasGoogleFalso();
    g.lista('Minhas tarefas');
    expect(concluidasNoEspelho({}, servico(g), AGORA)).toEqual({ concluidas: [], agora: AGORA });
    expect(g.de('Tasklists.insert')).toEqual([]);
    expect(g.de('Tasks.list')).toEqual([]);
  });

  it('lê todas as páginas, com teto de itens', () => {
    const g = tarefasGoogleFalso({ paginaMaxima: 100 });
    const c = central(g);
    for (let i = 0; i < CONCLUIDAS_NO_MAXIMO + 50; i++) {
      g.tarefa(c, { id: `g${i}`, notes: marcadorDaTarefa(`tarefa-${i}`), status: 'completed', completed: '2026-11-10T09:00:00.000Z', updated: '2026-11-10T09:00:00.000Z' });
    }
    const { concluidas } = concluidasNoEspelho({}, servico(g), AGORA);
    expect(concluidas).toHaveLength(CONCLUIDAS_NO_MAXIMO);
    expect(g.de('Tasks.list').length).toBeGreaterThan(1);
  });

  it('a mesma tarefa da Central em duas espelhas: vale a conclusão mais nova, uma vez só', () => {
    const g = tarefasGoogleFalso();
    const c = central(g);
    g.tarefa(c, { id: 'g1', notes: marcadorDaTarefa('tarefa-1'), status: 'completed', completed: '2026-11-10T09:00:00.000Z', updated: '2026-11-10T09:00:00.000Z' });
    g.tarefa(c, { id: 'g2', notes: marcadorDaTarefa('tarefa-1'), status: 'completed', completed: '2026-11-10T11:00:00.000Z', updated: '2026-11-10T11:00:00.000Z' });
    expect(concluidasNoEspelho({}, servico(g), AGORA).concluidas).toEqual([{ id: 'tarefa-1', em: Date.parse('2026-11-10T11:00:00.000Z') }]);
  });

  it.each([
    ['desde texto', { desde: '2026-11-10' }],
    ['desde negativo', { desde: -1 }],
    ['desde infinito', { desde: Number.POSITIVE_INFINITY }],
    ['dados não objeto', 3],
  ])('pedido inválido (%s): recusado antes de chamar o Google', (_nome, dados) => {
    const g = tarefasGoogleFalso();
    expect(() => concluidasNoEspelho(dados, servico(g), AGORA)).toThrow(PedidoInvalido);
    expect(g.chamadas).toEqual([]);
  });

  describe('pelo script', () => {
    function ambiente(g: TarefasGoogleFalso | null): Ambiente {
      const armazem = armazemNaMemoria();
      armazem.agora = () => AGORA;
      return { lerCodigo: () => CODIGO, armazem, ...(g ? { tarefasGoogle: () => servico(g) } : {}) };
    }

    it('responde as concluídas', () => {
      const g = tarefasGoogleFalso();
      g.tarefa(central(g), { id: 'g1', notes: marcadorDaTarefa('tarefa-1'), status: 'completed', completed: '2026-11-10T21:00:00.000Z', updated: '2026-11-10T21:00:00.000Z' });
      expect(tratar({ codigo: CODIGO, acao: 'lerEspelhos', dados: {} }, ambiente(g))).toEqual({
        ok: true,
        dados: { concluidas: [{ id: 'tarefa-1', em: Date.parse('2026-11-10T21:00:00.000Z') }], agora: AGORA },
      });
    });

    it('sem o Google Tarefas no script: lista vazia, sem erro', () => {
      expect(tratar({ codigo: CODIGO, acao: 'lerEspelhos', dados: {} }, ambiente(null))).toEqual({
        ok: true,
        dados: { concluidas: [], agora: AGORA },
      });
    });

    it('falha do Google: o registro não leva título, notas nem id', () => {
      const g = tarefasGoogleFalso();
      central(g);
      g.servico.Tasks.list = () => {
        throw new Error('API call to tasks.tasks.list failed with error: Backend Error "Segredo da Marina" tarefa-segredo-0123456789');
      };
      const erros: string[] = [];
      const original = console.error;
      console.error = (...partes: unknown[]) => void erros.push(partes.map(String).join(' '));
      try {
        expect(tratar({ codigo: CODIGO, acao: 'lerEspelhos', dados: {} }, ambiente(g))).toEqual({ ok: false, erro: 'interno' });
      } finally {
        console.error = original;
      }
      for (const proibido of ['Segredo', 'Marina', 'tarefa-segredo']) expect(erros.join('\n')).not.toContain(proibido);
    });
  });
});

describe('espelharTarefas não desmarca o que o dono concluiu no Google', () => {
  it('tarefa aberta na Central e concluída no Google: o envio (ex. virada do dia) muda o dia e mantém concluída; a resposta avisa', () => {
    const g = tarefasGoogleFalso();
    const [{ googleId }] = espelhar(g, item());
    concluirNoGoogle(g, googleId!, '2026-11-10T21:00:00.000Z');
    g.chamadas.length = 0;

    const [resultado] = espelhar(g, item({ data: '2026-11-11', googleId: googleId! }));
    expect(resultado).toEqual({ id: 'tarefa-1', ok: true, googleId, concluidaEm: Date.parse('2026-11-10T21:00:00.000Z') });
    expect(g.vivas()[0]).toMatchObject({ status: 'completed', completed: '2026-11-10T21:00:00.000Z', due: '2026-11-11T00:00:00.000Z' });
    // O patch da tarefa aberta não leva status nem a hora de conclusão.
    for (const { args } of g.de('Tasks.patch')) {
      expect(args[0]).not.toHaveProperty('status');
      expect(args[0]).not.toHaveProperty('completed');
    }
  });

  it('achada pelas notas (sem o id guardado): também não desmarca', () => {
    const g = tarefasGoogleFalso();
    const [{ googleId }] = espelhar(g, item());
    concluirNoGoogle(g, googleId!, '2026-11-10T21:00:00.000Z');
    const [resultado] = espelhar(g, item({ titulo: 'Outro título' }));
    expect(resultado.concluidaEm).toBe(Date.parse('2026-11-10T21:00:00.000Z'));
    expect(g.vivas()).toMatchObject([{ title: 'Outro título', status: 'completed' }]);
  });

  it('reaberta na Central depois da conclusão no Google (feitoEm mais novo): reabre lá', () => {
    const g = tarefasGoogleFalso();
    const [{ googleId }] = espelhar(g, item({ feito: true, feitoEm: Date.parse('2026-11-10T08:00:00Z') }));
    concluirNoGoogle(g, googleId!, '2026-11-10T09:00:00.000Z');
    const [resultado] = espelhar(g, item({ feito: false, feitoEm: Date.parse('2026-11-10T10:00:00Z'), googleId: googleId! }));
    expect(resultado).toEqual({ id: 'tarefa-1', ok: true, googleId });
    expect(g.vivas()[0].status).toBe('needsAction');
    expect(g.vivas()[0].completed).toBeUndefined();
  });

  it('reaberta na Central antes da conclusão no Google (feitoEm mais velho): fica concluída', () => {
    const g = tarefasGoogleFalso();
    const [{ googleId }] = espelhar(g, item());
    concluirNoGoogle(g, googleId!, '2026-11-10T21:00:00.000Z');
    const [resultado] = espelhar(g, item({ feitoEm: Date.parse('2026-11-10T20:00:00Z'), googleId: googleId! }));
    expect(resultado.concluidaEm).toBe(Date.parse('2026-11-10T21:00:00.000Z'));
    expect(g.vivas()[0].status).toBe('completed');
  });

  it('aberta nos dois lados: um patch só, sem "concluidaEm"', () => {
    const g = tarefasGoogleFalso();
    const [{ googleId }] = espelhar(g, item());
    g.chamadas.length = 0;
    const [resultado] = espelhar(g, item({ feitoEm: Date.parse('2026-11-10T20:00:00Z'), googleId: googleId! }));
    expect(resultado).toEqual({ id: 'tarefa-1', ok: true, googleId });
    expect(g.de('Tasks.patch')).toHaveLength(1);
  });

  it('nova, aberta: criada sem status (o Google põe "a fazer")', () => {
    const g = tarefasGoogleFalso();
    espelhar(g, item());
    expect(g.de('Tasks.insert')[0].args[0]).not.toHaveProperty('status');
    expect(g.vivas()[0].status).toBe('needsAction');
  });

  it.each([
    ['feitoEm texto', { ...item(), feitoEm: '2026-11-10' }],
    ['feitoEm negativo', { ...item(), feitoEm: -5 }],
    ['feitoEm NaN', { ...item(), feitoEm: Number.NaN }],
  ])('pedido inválido (%s): recusado antes de chamar o Google', (_nome, tarefa) => {
    const g = tarefasGoogleFalso();
    expect(() => espelharTarefas({ tarefas: [tarefa] }, servico(g))).toThrow(PedidoInvalido);
    expect(g.chamadas).toEqual([]);
  });
});

describe('revisão 11/11: a conclusão feita pelo próprio app não passa por conclusão do dono', () => {
  it('feita: manda a hora de conclusão = feitoEm, e a resposta leva a hora que o Google gravou (conclusaoPropria)', () => {
    const g = tarefasGoogleFalso();
    const feitoEm = Date.parse('2026-11-10T08:00:00Z');
    const [resultado] = espelhar(g, item({ feito: true, feitoEm }));
    expect(g.de('Tasks.insert')[0].args[0]).toMatchObject({ status: 'completed', completed: '2026-11-10T08:00:00.000Z' });
    expect(g.vivas()[0].completed).toBe('2026-11-10T08:00:00.000Z');
    expect(resultado).toEqual({ id: 'tarefa-1', ok: true, googleId: g.vivas()[0].id, conclusaoPropria: feitoEm });
  });

  it('feita sem hora conhecida (feitoEm 0): só o status', () => {
    const g = tarefasGoogleFalso();
    espelhar(g, item({ feito: true }));
    expect(g.de('Tasks.insert')[0].args[0]).not.toHaveProperty('completed');
  });

  it('Google que grava a hora de chegada: concluir e desfazer antes de a resposta voltar reabre lá no envio seguinte', () => {
    // O Google está 5 min adiantado e ignora a hora enviada.
    const g = tarefasGoogleFalso({ ignorarCompleted: true, agora: () => Date.parse('2026-11-10T08:05:00Z') });
    const [{ googleId }] = espelhar(g, item());
    const [conclusao] = espelhar(g, item({ feito: true, feitoEm: Date.parse('2026-11-10T08:00:00Z'), googleId: googleId! }));
    expect(conclusao.conclusaoPropria).toBe(Date.parse('2026-11-10T08:05:00Z'));
    // Desfeita às 08:01 (antes da hora que o Google gravou): sem conclusaoPropria, pareceria conclusão do dono.
    const [reaberta] = espelhar(
      g,
      item({ feitoEm: Date.parse('2026-11-10T08:01:00Z'), conclusaoPropria: conclusao.conclusaoPropria!, googleId: googleId! }),
    );
    expect(reaberta).toEqual({ id: 'tarefa-1', ok: true, googleId });
    expect(g.vivas()[0].status).toBe('needsAction');
  });

  it('conclusão do dono depois da do app (mais nova que conclusaoPropria): fica concluída', () => {
    const g = tarefasGoogleFalso();
    const [{ googleId }] = espelhar(g, item());
    concluirNoGoogle(g, googleId!, '2026-11-10T21:00:00.000Z');
    const [resultado] = espelhar(g, item({ feitoEm: Date.parse('2026-11-10T08:01:00Z'), conclusaoPropria: Date.parse('2026-11-10T08:05:00Z'), googleId: googleId! }));
    expect(resultado.concluidaEm).toBe(Date.parse('2026-11-10T21:00:00.000Z'));
    expect(g.vivas()[0].status).toBe('completed');
  });

  it('cliente antigo (sem feitoEm): como antes, a tarefa aberta vai com needsAction, num patch só', () => {
    const g = tarefasGoogleFalso();
    const [{ googleId }] = espelhar(g, item());
    concluirNoGoogle(g, googleId!, '2026-11-10T21:00:00.000Z');
    g.chamadas.length = 0;
    const { feitoEm: _sem, ...antigo } = item({ googleId: googleId! });
    const [resultado] = espelhar(g, antigo);
    expect(resultado).toEqual({ id: 'tarefa-1', ok: true, googleId });
    expect(g.de('Tasks.patch')).toHaveLength(1);
    expect(g.de('Tasks.patch')[0].args[0]).toMatchObject({ status: 'needsAction', completed: null });
    expect(g.vivas()[0].status).toBe('needsAction');
  });

  it.each([
    ['conclusaoPropria texto', { ...item(), conclusaoPropria: 'ontem' }],
    ['conclusaoPropria negativa', { ...item(), conclusaoPropria: -1 }],
  ])('pedido inválido (%s): recusado antes de chamar o Google', (_nome, tarefa) => {
    const g = tarefasGoogleFalso();
    expect(() => espelharTarefas({ tarefas: [tarefa] }, servico(g))).toThrow(PedidoInvalido);
    expect(g.chamadas).toEqual([]);
  });

  it('com o cache do script, o id da lista "Central" vem do cache; lista sumida (404) limpa o cache e devolve nada', () => {
    const valores = new Map<string, string>();
    const guarda = { get: (k: string) => valores.get(k) ?? null, put: (k: string, v: string) => void valores.set(k, v), remove: (k: string) => void valores.delete(k) };
    const g = tarefasGoogleFalso();
    const c = central(g);
    g.tarefa(c, { id: 'g1', notes: marcadorDaTarefa('tarefa-1'), status: 'completed', completed: '2026-11-10T21:00:00.000Z', updated: '2026-11-10T21:00:00.000Z' });
    concluidasNoEspelho({}, servico(g), AGORA, guarda);
    g.chamadas.length = 0;
    expect(concluidasNoEspelho({}, servico(g), AGORA, guarda).concluidas).toHaveLength(1);
    expect(g.de('Tasklists.list')).toEqual([]);

    g.listas.delete(c.id);
    expect(concluidasNoEspelho({}, servico(g), AGORA, guarda)).toEqual({ concluidas: [], agora: AGORA });
    expect([...valores.keys()].some((k) => k.includes('listas'))).toBe(false);
  });
});
