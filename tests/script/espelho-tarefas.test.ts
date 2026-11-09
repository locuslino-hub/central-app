// @vitest-environment node
// Tarefas da Central espelhadas no Google Tarefas (spec 2026-11-09), na lista
// "Central". Idempotente: a espelho guarda o id da Central nas notas, então
// repetir o pedido (fila offline, resposta perdida) nunca duplica.
import { describe, expect, it } from 'vitest';
import { PedidoInvalido } from '../../script/agenda';
import { tratar, type Ambiente } from '../../script/api';
import {
  LOTE_NO_MAXIMO,
  espelharTarefas,
  marcadorDaTarefa,
  type ItemDoEspelho,
  type ServicoDeTarefas,
} from '../../script/tarefas-google';
import { armazemNaMemoria } from '../apoio/armazem';
import { tarefasGoogleFalso, type TarefasGoogleFalso } from '../apoio/tarefas-google';

const CODIGO = 'codigo-ficticio-de-teste-0123456789abcdef';
const servico = (g: TarefasGoogleFalso) => g.servico as unknown as ServicoDeTarefas;

function item(extra: Partial<ItemDoEspelho> = {}): ItemDoEspelho {
  return { id: 'tarefa-1', titulo: 'Revisar parágrafo do relatório', data: '2026-11-09', feito: false, apagado: false, ...extra };
}

const espelhar = (g: TarefasGoogleFalso, ...itens: ItemDoEspelho[]) => espelharTarefas({ tarefas: itens }, servico(g)).resultados;

describe('lista "Central"', () => {
  it('é criada se não existe, uma vez só', () => {
    const g = tarefasGoogleFalso();
    g.lista('Minhas tarefas');
    espelhar(g, item());
    espelhar(g, item({ id: 'tarefa-2' }));
    expect(g.de('Tasklists.insert')).toEqual([{ metodo: 'Tasklists.insert', args: [{ title: 'Central' }] }]);
    expect([...g.listas.values()].map((l) => l.title)).toEqual(['Minhas tarefas', 'Central']);
  });

  it('a que já existe é usada, mesmo depois de outras páginas de listas', () => {
    const g = tarefasGoogleFalso({ paginaMaxima: 2 });
    for (const nome of ['A', 'B', 'C']) g.lista(nome);
    const central = g.lista('Central');
    espelhar(g, item());
    expect(g.de('Tasklists.insert')).toEqual([]);
    expect(central.tarefas.size).toBe(1);
  });
});

describe('espelharTarefas', () => {
  it('cria com título, dia, notas com o id da Central e status a fazer', () => {
    const g = tarefasGoogleFalso();
    const [resultado] = espelhar(g, item());
    const [criada] = g.vivas();
    expect(resultado).toEqual({ id: 'tarefa-1', ok: true, googleId: criada.id });
    expect(criada).toMatchObject({
      title: 'Revisar parágrafo do relatório',
      notes: marcadorDaTarefa('tarefa-1'),
      status: 'needsAction',
      due: '2026-11-09T00:00:00.000Z',
    });
  });

  it('sem data (Sem prazo) vai sem dia', () => {
    const g = tarefasGoogleFalso();
    const { data: _sem, ...semData } = item();
    espelhar(g, semData);
    expect(g.vivas()[0].due).toBeUndefined();
  });

  it('feita: completed; reaberta: needsAction, sem a hora de conclusão', () => {
    const g = tarefasGoogleFalso();
    const [{ googleId }] = espelhar(g, item({ feito: true }));
    expect(g.vivas()[0]).toMatchObject({ status: 'completed', completed: expect.any(String) });
    espelhar(g, item({ feito: false, googleId: googleId! }));
    expect(g.vivas()[0].status).toBe('needsAction');
    expect(g.vivas()[0].completed).toBeUndefined();
  });

  it('com o id da espelho, título e dia mudam por patch, sem criar outra', () => {
    const g = tarefasGoogleFalso();
    const [{ googleId }] = espelhar(g, item());
    g.chamadas.length = 0;
    const [depois] = espelhar(g, item({ titulo: 'Revisar parágrafo 2', data: '2026-11-10', googleId: googleId! }));
    expect(depois.googleId).toBe(googleId);
    expect(g.vivas()).toHaveLength(1);
    expect(g.vivas()[0]).toMatchObject({ title: 'Revisar parágrafo 2', due: '2026-11-10T00:00:00.000Z' });
    expect(g.de('Tasks.insert')).toEqual([]);
    // Com o id, não precisa procurar pela lista.
    expect(g.de('Tasks.list')).toEqual([]);
  });

  it('dia tirado (foi para Sem prazo): o dia sai da espelho', () => {
    const g = tarefasGoogleFalso();
    const [{ googleId }] = espelhar(g, item());
    const { data: _sem, ...semData } = item({ googleId: googleId! });
    espelhar(g, semData);
    expect(g.vivas()[0].due).toBeUndefined();
  });

  it('repetir sem o id (a resposta se perdeu) acha a espelho pelas notas e não duplica', () => {
    const g = tarefasGoogleFalso({ paginaMaxima: 1 });
    espelhar(g, item({ id: 'outra', titulo: 'Outra' }));
    const [primeira] = espelhar(g, item());
    const [segunda] = espelhar(g, item({ titulo: 'Título novo' }));
    expect(segunda.googleId).toBe(primeira.googleId);
    expect(g.vivas()).toHaveLength(2);
    expect(g.vivas().find((t) => t.id === primeira.googleId)!.title).toBe('Título novo');
    const pedido = g.de('Tasks.list')[0].args[1] as Record<string, unknown>;
    expect(pedido).toMatchObject({ showCompleted: true, showHidden: true });
  });

  it('acha também a espelho concluída e escondida', () => {
    const g = tarefasGoogleFalso();
    const [{ googleId }] = espelhar(g, item({ feito: true }));
    g.central()!.tarefas.get(googleId!)!.hidden = true;
    espelhar(g, item({ feito: true, titulo: 'Mudou' }));
    expect(g.vivas()).toHaveLength(1);
  });

  it('espelho apagada no Google: cria outra e devolve o id novo', () => {
    const g = tarefasGoogleFalso();
    const [{ googleId }] = espelhar(g, item());
    g.central()!.tarefas.get(googleId!)!.deleted = true;
    const [depois] = espelhar(g, item({ googleId: googleId! }));
    expect(depois.googleId).not.toBe(googleId);
    expect(g.vivas()).toHaveLength(1);
  });

  it('id guardado que não existe mais (404): cria outra', () => {
    const g = tarefasGoogleFalso();
    const [depois] = espelhar(g, item({ googleId: 'naoexiste' }));
    expect(depois.ok).toBe(true);
    expect(g.vivas()).toHaveLength(1);
  });

  it('apagada na Central: apaga a espelho e devolve googleId null', () => {
    const g = tarefasGoogleFalso();
    const [{ googleId }] = espelhar(g, item());
    expect(espelhar(g, item({ apagado: true, googleId: googleId! }))).toEqual([{ id: 'tarefa-1', ok: true, googleId: null }]);
    expect(g.vivas()).toEqual([]);
  });

  it('apagar sem o id acha pelas notas; apagar o que não existe não é erro', () => {
    const g = tarefasGoogleFalso();
    espelhar(g, item());
    expect(espelhar(g, item({ apagado: true }))[0].ok).toBe(true);
    expect(g.vivas()).toEqual([]);
    expect(espelhar(g, item({ apagado: true }))[0].ok).toBe(true);
    expect(espelhar(g, item({ apagado: true, googleId: 'naoexiste' }))[0].ok).toBe(true);
  });

  it('desfazer o apagar (o id guardado é de uma apagada): volta como tarefa nova', () => {
    const g = tarefasGoogleFalso();
    const [{ googleId }] = espelhar(g, item());
    espelhar(g, item({ apagado: true, googleId: googleId! }));
    const [volta] = espelhar(g, item({ googleId: googleId! }));
    expect(volta.googleId).not.toBe(googleId);
    expect(g.vivas()).toHaveLength(1);
  });

  it('título com quebras de linha, controle ou vazio é limpo; longo é cortado', () => {
    const g = tarefasGoogleFalso();
    espelhar(g, item({ id: 'a', titulo: 'Linha 1\nLinha 2\u0007' }), item({ id: 'b', titulo: '   ' }), item({ id: 'c', titulo: 'x'.repeat(1500) }));
    const titulos = g.vivas().map((t) => t.title);
    expect(titulos[0]).toBe('Linha 1 Linha 2');
    expect(titulos[1]).toBe('(sem título)');
    expect(titulos[2]).toHaveLength(1024);
  });

  it('uma tarefa que falha não derruba as outras, e o registro não leva título nem id', () => {
    const g = tarefasGoogleFalso();
    const insert = g.servico.Tasks.insert;
    g.servico.Tasks.insert = (corpo, lista) => {
      if ((corpo as { title?: string }).title === 'Segredo da Marina') {
        throw new Error('API call to tasks.tasks.insert failed with error: Backend Error Segredo tarefa-segredo');
      }
      return insert(corpo, lista);
    };
    const erros: string[] = [];
    const original = console.error;
    console.error = (...partes: unknown[]) => void erros.push(partes.map(String).join(' '));
    let resultados;
    try {
      resultados = espelhar(g, item({ id: 'tarefa-segredo', titulo: 'Segredo da Marina' }), item({ id: 'tarefa-2' }));
    } finally {
      console.error = original;
    }
    expect(resultados).toEqual([
      { id: 'tarefa-segredo', ok: false, googleId: null },
      { id: 'tarefa-2', ok: true, googleId: expect.any(String) },
    ]);
    expect(erros).toHaveLength(1);
    for (const proibido of ['Segredo', 'segredo', 'Marina']) expect(erros[0]).not.toContain(proibido);
  });

  it.each([
    ['sem lista', {}],
    ['lista vazia', { tarefas: [] }],
    [`mais de ${LOTE_NO_MAXIMO}`, { tarefas: Array.from({ length: LOTE_NO_MAXIMO + 1 }, (_, i) => item({ id: `t${i}` })) }],
    ['id inválido', { tarefas: [item({ id: 'a/b' })] }],
    ['título não texto', { tarefas: [{ ...item(), titulo: 3 }] }],
    ['data inválida', { tarefas: [item({ data: '2026-02-30' })] }],
    ['feito não booleano', { tarefas: [{ ...item(), feito: 'sim' }] }],
    ['apagado ausente', { tarefas: [{ id: 'x', titulo: 'a', feito: false }] }],
    ['googleId inválido', { tarefas: [item({ googleId: 'a b' })] }],
  ])('pedido inválido (%s): recusado antes de chamar o Google', (_nome, dados) => {
    const g = tarefasGoogleFalso();
    expect(() => espelharTarefas(dados, servico(g))).toThrow(PedidoInvalido);
    expect(g.chamadas).toEqual([]);
  });
});

describe('ação espelharTarefas pelo script', () => {
  function ambiente(g: TarefasGoogleFalso | null): Ambiente & { armazem: ReturnType<typeof armazemNaMemoria> } {
    return { lerCodigo: () => CODIGO, armazem: armazemNaMemoria(), ...(g ? { tarefasGoogle: () => servico(g) } : {}) };
  }

  it('responde os resultados, e roda dentro da trava do script (dois aparelhos não criam duas listas)', () => {
    const g = tarefasGoogleFalso();
    const amb = ambiente(g);
    const naTrava: boolean[] = [];
    const insert = g.servico.Tasklists.insert;
    g.servico.Tasklists.insert = (corpo) => {
      naTrava.push(amb.armazem.dentroDaTrava);
      return insert(corpo);
    };
    const resposta = tratar({ codigo: CODIGO, acao: 'espelharTarefas', dados: { tarefas: [item()] } }, amb);
    expect(resposta).toEqual({ ok: true, dados: { resultados: [{ id: 'tarefa-1', ok: true, googleId: expect.any(String) }] } });
    expect(naTrava).toEqual([true]);
  });

  it('sem o serviço do Google Tarefas: interno', () => {
    expect(tratar({ codigo: CODIGO, acao: 'espelharTarefas', dados: { tarefas: [item()] } }, ambiente(null))).toEqual({
      ok: false,
      erro: 'interno',
    });
  });

  it('script ocupado: ocupado, sem chamar o Google', () => {
    const g = tarefasGoogleFalso();
    const amb = ambiente(g);
    amb.armazem.ocupado = true;
    expect(tratar({ codigo: CODIGO, acao: 'espelharTarefas', dados: { tarefas: [item()] } }, amb)).toEqual({ ok: false, erro: 'ocupado' });
    expect(g.chamadas).toEqual([]);
  });
});
