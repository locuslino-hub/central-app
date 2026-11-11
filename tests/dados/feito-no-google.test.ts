// Ampliação 11/11 do feito espelhado, do lado do app: concluir no Google
// Tarefas (lista "Central") uma tarefa da Central conclui a tarefa na Central,
// e a Central nunca desmarca lá o que o dono concluiu, a não ser que ela mesma
// reabra a tarefa depois (vale a mudança mais nova, por `feitoEm`). Nomes fictícios.
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErroScript } from '../../src/conexao/cliente';
import { listar, listarPendentes } from '../../src/dados/loja';
import { LEITURA_DO_GOOGLE_A_CADA_MS, MARGEM_DA_LEITURA_MS, sincronizar } from '../../src/dados/sincronia';
import { concluirTarefa, criarTarefa, editarTarefa, reabrirTarefa } from '../../src/dados/tarefas';
import type { PendenteEspelho, Tarefa } from '../../src/dados/tipos';
import { virarDia } from '../../src/dados/virada';
import { servidorDeTeste } from '../apoio/servidor';

// Segunda, 2026-11-09, 12:20 em Lisboa. Só o Date é falso (o fake-indexeddb usa timers reais).
const AGORA = Date.parse('2026-11-09T12:20:00Z');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AGORA);
});

const semEspera = (_ms: number) => Promise.resolve();
const lerTarefa = async (id: string) => (await listar('tarefas', { comApagados: true })).find((t) => t.id === id) as Tarefa;
const espelhos = async () => (await listarPendentes()).filter((p): p is PendenteEspelho => p.tipo === 'espelho');

function comGoogle() {
  const servidor = servidorDeTeste({ comTarefasGoogle: true });
  const rodar = () => sincronizar({ chamar: servidor.chamar, esperar: semEspera });
  /** O dono conclui a espelho direto no Google Tarefas. */
  const concluirNoGoogle = (quando: string) => {
    const [espelho] = servidor.tarefasGoogle.vivas();
    espelho.status = 'completed';
    espelho.completed = quando;
    espelho.updated = quando;
  };
  return { servidor, rodar, concluirNoGoogle, espelho: () => servidor.tarefasGoogle.vivas()[0] };
}

describe('feitoEm: a hora da última mudança do feito na Central', () => {
  it('concluir e reabrir marcam a hora; mudar o título não', async () => {
    const tarefa = (await criarTarefa('Ligar para a Renata', { data: '2026-11-09' }))!;
    expect((await lerTarefa(tarefa.id)).feitoEm).toBeUndefined();
    vi.setSystemTime(AGORA + 1000);
    await concluirTarefa(tarefa.id);
    expect((await lerTarefa(tarefa.id)).feitoEm).toBe(AGORA + 1000);
    vi.setSystemTime(AGORA + 2000);
    await editarTarefa(tarefa.id, { titulo: 'Ligar para a Renata hoje' });
    expect((await lerTarefa(tarefa.id)).feitoEm).toBe(AGORA + 1000);
    vi.setSystemTime(AGORA + 3000);
    await reabrirTarefa(tarefa.id);
    expect((await lerTarefa(tarefa.id)).feitoEm).toBe(AGORA + 3000);
  });

  it('vai ao script junto com a tarefa', async () => {
    const { servidor, rodar } = comGoogle();
    const tarefa = (await criarTarefa('Revisar parágrafo', { data: '2026-11-09' }))!;
    await rodar();
    vi.setSystemTime(AGORA + 60_000);
    await concluirTarefa(tarefa.id);
    await rodar();
    expect(servidor.de('espelharTarefas').at(-1)!.dados.tarefas[0]).toMatchObject({ id: tarefa.id, feito: true, feitoEm: AGORA + 60_000 });
  });
});

describe('concluída no Google, concluída na Central', () => {
  it('a sincronia lê as concluídas e conclui a tarefa, sem pôr nada na fila do espelho', async () => {
    const { servidor, rodar, concluirNoGoogle, espelho } = comGoogle();
    const tarefa = (await criarTarefa('Mandar mensagem para a Aurora', { data: '2026-11-09' }))!;
    await rodar();
    concluirNoGoogle('2026-11-09T12:30:00.000Z');
    vi.setSystemTime(AGORA + 15 * 60_000);
    expect(await rodar()).toBe('atualizado');

    const depois = await lerTarefa(tarefa.id);
    expect(depois).toMatchObject({ feito: true, feitoEm: Date.parse('2026-11-09T12:30:00.000Z') });
    expect(await espelhos()).toEqual([]);
    expect(servidor.de('lerEspelhos').length).toBeGreaterThan(0);
    // O feito chega ao Drive (e aos outros aparelhos) pela fila normal.
    const noDrive = (JSON.parse(servidor.armazem.conteudo!).registros as { registro: Tarefa }[]).find((g) => g.registro.id === tarefa.id);
    expect(noDrive!.registro).toMatchObject({ feito: true, feitoEm: Date.parse('2026-11-09T12:30:00.000Z') });
    expect(espelho()).toMatchObject({ status: 'completed', completed: '2026-11-09T12:30:00.000Z' });
  });

  it('a virada do dia antes da leitura não desmarca no Google, e a tarefa fica concluída na Central', async () => {
    const { servidor, rodar, concluirNoGoogle, espelho } = comGoogle();
    const tarefa = (await criarTarefa('Comprar pilhas', { data: '2026-11-09' }))!;
    await rodar();
    concluirNoGoogle('2026-11-09T22:00:00.000Z');
    // Dia seguinte: o app abre, a virada traz a tarefa (ainda aberta aqui) para hoje.
    vi.setSystemTime(Date.parse('2026-11-10T08:00:00Z'));
    servidor.falharAntes((acao) => (acao === 'lerEspelhos' ? new ErroScript('codigo-invalido') : undefined));
    await virarDia('2026-11-10');
    await rodar();

    expect(espelho()).toMatchObject({ status: 'completed', due: '2026-11-10T00:00:00.000Z' });
    // Mesmo sem a leitura (script antigo), a resposta do espelho conclui na Central.
    expect(await lerTarefa(tarefa.id)).toMatchObject({ feito: true, feitoEm: Date.parse('2026-11-09T22:00:00.000Z') });
    expect(await espelhos()).toEqual([]);
  });

  it('reaberta na Central depois da conclusão no Google: vale a Central, e a espelho reabre', async () => {
    const { rodar, concluirNoGoogle, espelho } = comGoogle();
    const tarefa = (await criarTarefa('Revisar capítulo', { data: '2026-11-09' }))!;
    await rodar();
    concluirNoGoogle('2026-11-09T12:30:00.000Z');
    vi.setSystemTime(AGORA + 15 * 60_000);
    await rodar();
    expect((await lerTarefa(tarefa.id)).feito).toBe(true);

    vi.setSystemTime(AGORA + 20 * 60_000);
    await reabrirTarefa(tarefa.id);
    vi.setSystemTime(AGORA + 30 * 60_000);
    await rodar();
    expect((await lerTarefa(tarefa.id)).feito).toBe(false);
    expect(espelho().status).toBe('needsAction');
    // E a leitura seguinte não conclui de novo.
    vi.setSystemTime(AGORA + 40 * 60_000);
    await rodar();
    expect((await lerTarefa(tarefa.id)).feito).toBe(false);
  });

  it('reaberta num aparelho e o espelho ainda não saiu: o outro aparelho não conclui de novo pela conclusão mais velha', async () => {
    const notebook = new IDBFactory();
    const celular = new IDBFactory();
    globalThis.indexedDB = notebook;
    const { servidor, rodar, concluirNoGoogle, espelho } = comGoogle();
    const tarefa = (await criarTarefa('Preparar aula', { data: '2026-11-09' }))!;
    await rodar();
    concluirNoGoogle('2026-11-09T12:30:00.000Z');
    vi.setSystemTime(AGORA + 15 * 60_000);
    await rodar();
    expect((await lerTarefa(tarefa.id)).feito).toBe(true);

    // O notebook reabre; o registro chega ao Drive, o espelho não (caiu a internet nessa hora).
    vi.setSystemTime(AGORA + 20 * 60_000);
    await reabrirTarefa(tarefa.id);
    servidor.falharAntes((acao) => (acao === 'espelharTarefas' ? new Error('sem rede') : undefined));
    await rodar();
    expect(espelho().status).toBe('completed');

    // O celular recebe a tarefa reaberta e lê o Google, ainda concluída lá (12:30, antes de reabrir).
    globalThis.indexedDB = celular;
    vi.setSystemTime(AGORA + 25 * 60_000);
    await rodar();
    expect(servidor.de('lerEspelhos').at(-1)!.dados).toEqual({});
    expect((await lerTarefa(tarefa.id)).feito).toBe(false);

    // O notebook volta a ter internet: a espelho reabre.
    globalThis.indexedDB = notebook;
    servidor.falharAntes(undefined);
    vi.setSystemTime(AGORA + 30 * 60_000);
    await rodar();
    expect(espelho().status).toBe('needsAction');
  });

  it('tarefa já concluída ou apagada na Central: nada muda', async () => {
    const { rodar, concluirNoGoogle } = comGoogle();
    const tarefa = (await criarTarefa('Ligar para o Prof. Souza', { data: '2026-11-09' }))!;
    await rodar();
    vi.setSystemTime(AGORA + 60_000);
    await concluirTarefa(tarefa.id);
    concluirNoGoogle('2026-11-09T12:30:00.000Z');
    const antes = await lerTarefa(tarefa.id);
    vi.setSystemTime(AGORA + 15 * 60_000);
    await rodar();
    expect((await lerTarefa(tarefa.id)).feitoEm).toBe(antes.feitoEm);
  });
});

describe('quando ler o Google', () => {
  it('no máximo uma leitura a cada 45 s; a seguinte pede a partir do relógio do script, com margem', async () => {
    const { servidor, rodar } = comGoogle();
    await criarTarefa('Aberta', { data: '2026-11-09' });
    await rodar();
    await rodar();
    expect(servidor.de('lerEspelhos')).toHaveLength(1);
    expect(servidor.de('lerEspelhos')[0].dados).toEqual({});
    vi.setSystemTime(AGORA + LEITURA_DO_GOOGLE_A_CADA_MS);
    await rodar();
    expect(servidor.de('lerEspelhos')).toHaveLength(2);
    expect(servidor.de('lerEspelhos')[1].dados).toEqual({ desde: AGORA - MARGEM_DA_LEITURA_MS });
  });

  it('sem tarefa aberta, não lê', async () => {
    const { servidor, rodar } = comGoogle();
    await rodar();
    expect(servidor.de('lerEspelhos')).toEqual([]);
  });

  it('script antigo (não conhece a ação) ou sem internet só na leitura: a rodada segue atualizada', async () => {
    const { servidor, rodar } = comGoogle();
    await criarTarefa('Aberta', { data: '2026-11-09' });
    servidor.falharAntes((acao) => (acao === 'lerEspelhos' ? new ErroScript('codigo-invalido') : undefined));
    expect(await rodar()).toBe('atualizado');
    expect(servidor.tarefasGoogle.vivas()).toHaveLength(1);
  });

  it('resposta com forma errada é ignorada', async () => {
    const servidor = servidorDeTeste({ comTarefasGoogle: true });
    const tarefa = (await criarTarefa('Aberta', { data: '2026-11-09' }))!;
    const chamar = async <T,>(acao: string, dados?: object): Promise<T> =>
      acao === 'lerEspelhos'
        ? ({ concluidas: [{ id: tarefa.id, em: 'ontem' }, { id: '../x', em: 5 }], agora: AGORA } as T)
        : servidor.chamar<T>(acao, dados);
    expect(await sincronizar({ chamar, esperar: semEspera })).toBe('atualizado');
    expect((await lerTarefa(tarefa.id)).feito).toBe(false);
  });
});
