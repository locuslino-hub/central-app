import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apagar, gravarDoServidor, listar, listarAvisos, listarPendentes as listarTodosOsPendentes, salvar, salvarRelogioDoServidor } from '../../src/dados/loja';
import { sincronizar } from '../../src/dados/sincronia';
import type { ParaSalvar, Tarefa } from '../../src/dados/tipos';
import { iniciarVirada, virarDia } from '../../src/dados/virada';
import { servidorDeTeste } from '../apoio/servidor';

/** A fila sem o espelho no Google (que tem testes próprios em tests/dados/espelho.test.ts). */
const listarPendentes = async () => (await listarTodosOsPendentes()).filter((p) => p.tipo !== 'espelho');


// Quinta-feira, 2026-11-05, 12:20 em Lisboa (WET = UTC em novembro).
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

/** Deixa o IndexedDB de teste (que usa timers reais) terminar o que estiver em andamento. */
const esvaziar = async () => {
  for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r));
};

const porTitulo = async () => Object.fromEntries((await listar('tarefas')).map((t) => [t.titulo, t]));

beforeEach(() => {
  // Só o Date: o fake-indexeddb agenda o trabalho com timers reais.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AGORA);
});

describe('virarDia: tarefas com dia', () => {
  it('tarefa aberta de ontem passa para hoje, pela loja (hora nova, pendente)', async () => {
    const ontem = await salvar('tarefas', tarefa('Rever capítulo 3', { data: '2026-11-04', salaId: 'sala-orientacoes' }));
    vi.setSystemTime(AGORA + 1000);

    const resultado = await virarDia(HOJE);

    const [salva] = await listar('tarefas');
    expect(salva).toMatchObject({ id: ontem.id, data: HOJE, titulo: 'Rever capítulo 3', salaId: 'sala-orientacoes' });
    expect(salva.atualizadoEm).toBeGreaterThan(ontem.atualizadoEm);
    expect(resultado).toEqual({ movidas: 1, semanasVencidas: 0 });
    // Uma entrada da criação e uma da virada: a sincronia envia a versão atual.
    expect((await listarPendentes()).filter((p) => p.tipo === 'registro' && p.id === ontem.id)).toHaveLength(2);
  });

  it('tarefa de muitos dias atrás também vem para hoje', async () => {
    await salvar('tarefas', tarefa('Velha', { data: '2025-12-31' }));
    await virarDia(HOJE);
    expect((await listar('tarefas'))[0].data).toBe(HOJE);
  });

  it('não mexe no que não é atrasado: de hoje, de amanhã, feita, apagada, sem prazo', async () => {
    await salvar('tarefas', tarefa('De hoje', { data: HOJE }));
    await salvar('tarefas', tarefa('De amanhã', { data: '2026-11-06' }));
    await salvar('tarefas', tarefa('Feita ontem', { data: '2026-11-04', feito: true }));
    await salvar('tarefas', tarefa('Sem prazo'));
    const apagada = await salvar('tarefas', tarefa('Apagada', { data: '2026-11-03' }));
    await apagar('tarefas', apagada.id);
    const antes = await listar('tarefas', { comApagados: true });

    const resultado = await virarDia(HOJE);

    expect(resultado).toEqual({ movidas: 0, semanasVencidas: 0 });
    expect(await listar('tarefas', { comApagados: true })).toEqual(antes);
  });

  it('é idempotente: rodar de novo não escreve nada', async () => {
    await salvar('tarefas', tarefa('Ontem', { data: '2026-11-04' }));
    await salvar('tarefas', tarefa('Semana passada', { semana: '2026-10-26' }));
    await virarDia(HOJE);
    const depois = await listar('tarefas');
    const pendentes = await listarPendentes();
    vi.setSystemTime(AGORA + 60_000);

    const segunda = await virarDia(HOJE);

    expect(segunda).toEqual({ movidas: 0, semanasVencidas: 0 });
    expect(await listar('tarefas')).toEqual(depois);
    expect(await listarPendentes()).toEqual(pendentes);
  });

  it('tarefa com prazo atrasada guarda o dia do prazo: é atrasada, não de hoje', async () => {
    await salvar('tarefas', tarefa('Entrega do relatório', { data: '2026-11-03', prazoHora: '17:00' }));
    const resultado = await virarDia(HOJE);
    expect(resultado.movidas).toBe(0);
    expect((await listar('tarefas'))[0].data).toBe('2026-11-03');
  });

  it('compromisso que já passou não vira tarefa de hoje', async () => {
    await salvar(
      'tarefas',
      tarefa('Reunião sobre o projeto', { data: '2026-11-04', inicio: '11:00', duracaoMin: 60, duracaoConfirmada: true }),
    );
    const resultado = await virarDia(HOJE);
    expect(resultado.movidas).toBe(0);
    expect((await listar('tarefas'))[0].data).toBe('2026-11-04');
  });

  it('dia escrito de forma estranha é deixado como está', async () => {
    await salvar('tarefas', tarefa('Data torta', { data: 'ontem' }));
    await salvar('tarefas', tarefa('Data vazia', { data: '' }));
    await expect(virarDia(HOJE)).resolves.toEqual({ movidas: 0, semanasVencidas: 0 });
  });

  it('em mudança de mês e de ano compara datas, não textos soltos', async () => {
    await salvar('tarefas', tarefa('Fim de ano', { data: '2026-12-31' }));
    await salvar('tarefas', tarefa('Ano novo', { data: '2027-01-02' }));
    expect(await virarDia('2027-01-01')).toEqual({ movidas: 1, semanasVencidas: 0 });
    const t = await porTitulo();
    expect(t['Fim de ano'].data).toBe('2027-01-01');
    expect(t['Ano novo'].data).toBe('2027-01-02');
  });
});

describe('virarDia: semana vencida', () => {
  it('semana que acabou: a tarefa perde a semana, volta para Sem prazo e guarda o aviso', async () => {
    const t = await salvar('tarefas', tarefa('Ler artigo da Aurora', { semana: '2026-10-26' }));
    const resultado = await virarDia(HOJE);

    const [salva] = await listar('tarefas');
    expect(resultado).toEqual({ movidas: 0, semanasVencidas: 1 });
    expect(salva.id).toBe(t.id);
    expect(salva.semana).toBeUndefined();
    expect('semana' in salva).toBe(false);
    expect(salva.data).toBeUndefined();
    expect(salva.semanaVencida).toBe('2026-10-26');
  });

  it('a semana de hoje e as futuras ficam como estão', async () => {
    await salvar('tarefas', tarefa('Esta', { semana: '2026-11-02' }));
    await salvar('tarefas', tarefa('Próxima', { semana: '2026-11-09' }));
    expect(await virarDia(HOJE)).toEqual({ movidas: 0, semanasVencidas: 0 });
    const t = await porTitulo();
    expect(t['Esta'].semana).toBe('2026-11-02');
    expect(t['Próxima'].semana).toBe('2026-11-09');
  });

  it('a semana vence na segunda: domingo ainda vale, segunda não', async () => {
    await salvar('tarefas', tarefa('Da semana', { semana: '2026-11-02' }));
    expect(await virarDia('2026-11-08')).toEqual({ movidas: 0, semanasVencidas: 0 }); // domingo
    expect(await virarDia('2026-11-09')).toEqual({ movidas: 0, semanasVencidas: 1 }); // segunda
  });

  it('tarefa feita de semana vencida não é tocada', async () => {
    await salvar('tarefas', tarefa('Feita', { semana: '2026-10-26', feito: true }));
    expect(await virarDia(HOJE)).toEqual({ movidas: 0, semanasVencidas: 0 });
    expect((await listar('tarefas'))[0].semana).toBe('2026-10-26');
  });
});

describe('virarDia: dois aparelhos', () => {
  let notebook: IDBFactory;
  let celular: IDBFactory;
  let servidor: ReturnType<typeof servidorDeTeste>;
  const no = (aparelho: IDBFactory) => {
    globalThis.indexedDB = aparelho;
  };
  const semEspera = () => Promise.resolve();
  const sincronizarAqui = () => sincronizar({ chamar: servidor.chamar, esperar: semEspera });

  beforeEach(() => {
    notebook = new IDBFactory();
    celular = new IDBFactory();
    servidor = servidorDeTeste();
  });

  /** O que o dono vê: tudo menos a hora e o aparelho da última escrita. */
  const visivel = async () =>
    (await listar('tarefas', { comApagados: true }))
      .map(({ atualizadoEm: _a, aparelho: _b, ...resto }) => resto)
      .sort((a, b) => a.id.localeCompare(b.id));

  async function prepararNosDois() {
    no(notebook);
    await salvar('tarefas', tarefa('De ontem', { data: '2026-11-04', id: 'tarefa-ontem' }));
    await salvar('tarefas', tarefa('Da semana passada', { semana: '2026-10-26', id: 'tarefa-semana' }));
    await salvar('tarefas', tarefa('De hoje', { data: HOJE, id: 'tarefa-hoje' }));
    await sincronizarAqui();
    no(celular);
    await sincronizarAqui();
  }

  it('os dois aparelhos viram o dia ao mesmo tempo e chegam ao mesmo resultado, sem duplicar', async () => {
    await prepararNosDois();

    vi.setSystemTime(AGORA + 1000);
    no(notebook);
    await virarDia(HOJE);
    vi.setSystemTime(AGORA + 2500);
    no(celular);
    await virarDia(HOJE);

    // Troca de dados em volta, até os dois pararem de mudar.
    for (let volta = 0; volta < 2; volta++) {
      vi.setSystemTime(AGORA + 5000 + volta * 1000);
      no(notebook);
      expect(await sincronizarAqui()).toBe('atualizado');
      no(celular);
      expect(await sincronizarAqui()).toBe('atualizado');
    }

    no(notebook);
    const doNotebook = await visivel();
    no(celular);
    const doCelular = await visivel();
    expect(doNotebook).toEqual(doCelular);
    expect(doNotebook).toHaveLength(3);
    const porId = Object.fromEntries(doNotebook.map((t) => [t.id, t]));
    expect(porId['tarefa-ontem'].data).toBe(HOJE);
    expect(porId['tarefa-hoje'].data).toBe(HOJE);
    expect(porId['tarefa-semana'].semana).toBeUndefined();
    expect(porId['tarefa-semana'].semanaVencida).toBe('2026-10-26');
    expect(await listarPendentes()).toEqual([]);
  });

  it('só um aparelho vira o dia e o outro recebe: o que recebeu já está em dia', async () => {
    await prepararNosDois();
    vi.setSystemTime(AGORA + 1000);
    no(notebook);
    await virarDia(HOJE);
    await sincronizarAqui();
    no(celular);
    await sincronizarAqui();
    const recebido = await visivel();
    vi.setSystemTime(AGORA + 9000);
    expect(await virarDia(HOJE)).toEqual({ movidas: 0, semanasVencidas: 0 });
    expect(await visivel()).toEqual(recebido);
  });

  it('virar o dia nos dois não cria avisos de conflito: a mudança é a mesma', async () => {
    await prepararNosDois();
    vi.setSystemTime(AGORA + 1000);
    no(notebook);
    await virarDia(HOJE);
    vi.setSystemTime(AGORA + 2500);
    no(celular);
    await virarDia(HOJE);
    vi.setSystemTime(AGORA + 5000);
    no(notebook);
    await sincronizarAqui();
    no(celular);
    await sincronizarAqui();
    no(notebook);
    await sincronizarAqui();
    no(celular);
    const doCelular = await listarAvisos();
    no(notebook);
    expect([...(await listarAvisos()), ...doCelular]).toEqual([]);
  });

  it('edição mais nova do outro aparelho não é desfeita, se a sincronia vem antes da virada', async () => {
    await prepararNosDois();
    // O celular passa a tarefa de ontem para sexta e sincroniza.
    vi.setSystemTime(AGORA + 1000);
    no(celular);
    const ontem = (await listar('tarefas')).find((t) => t.id === 'tarefa-ontem')!;
    await salvar('tarefas', { ...ontem, data: '2026-11-06' });
    await sincronizarAqui();

    // O notebook (ainda com a cópia velha) sincroniza antes de virar o dia, como faz no app.
    vi.setSystemTime(AGORA + 2000);
    no(notebook);
    await sincronizarAqui();
    await virarDia(HOJE);
    expect((await listar('tarefas')).find((t) => t.id === 'tarefa-ontem')?.data).toBe('2026-11-06');
  });
});

describe('iniciarVirada', () => {
  afterEach(() => vi.useRealTimers());

  async function esperarTarefa(titulo: string, condicao: (t: Tarefa) => boolean) {
    await vi.waitFor(async () => {
      const achada = (await listar('tarefas')).find((t) => t.titulo === titulo);
      expect(achada && condicao(achada)).toBe(true);
    });
  }

  it('vira o dia ao iniciar', async () => {
    await salvar('tarefas', tarefa('Ontem', { data: '2026-11-04' }));
    const parar = iniciarVirada();
    await esperarTarefa('Ontem', (t) => t.data === HOJE);
    parar();
  });

  it('espera o "antes" (a sincronia) para virar, para não decidir em cima de dado velho', async () => {
    await salvar('tarefas', tarefa('Ontem', { data: '2026-11-04' }));
    let liberar!: () => void;
    const antes = vi.fn(() => new Promise<void>((pronto) => (liberar = pronto)));
    const parar = iniciarVirada({ antes });

    await new Promise((r) => setTimeout(r, 30));
    expect(antes).toHaveBeenCalledTimes(1);
    expect((await listar('tarefas'))[0].data).toBe('2026-11-04');

    liberar();
    await esperarTarefa('Ontem', (t) => t.data === HOJE);
    parar();
  });

  it('se parar enquanto espera o "antes", não vira depois', async () => {
    await salvar('tarefas', tarefa('Ontem', { data: '2026-11-04' }));
    let liberar!: () => void;
    const parar = iniciarVirada({ antes: () => new Promise<void>((pronto) => (liberar = pronto)) });
    await vi.waitFor(() => expect(liberar).toBeTypeOf('function'));
    parar();
    liberar();
    await new Promise((r) => setTimeout(r, 50));
    expect((await listar('tarefas'))[0].data).toBe('2026-11-04');
  });

  it('se o "antes" falha, vira mesmo assim', async () => {
    await salvar('tarefas', tarefa('Ontem', { data: '2026-11-04' }));
    const parar = iniciarVirada({ antes: () => Promise.reject(new Error('sem rede')) });
    await esperarTarefa('Ontem', (t) => t.data === HOJE);
    parar();
  });

  it('se o "antes" nunca termina, vira depois da espera máxima', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(AGORA);
    await salvar('tarefas', tarefa('Ontem', { data: '2026-11-04' }));
    const parar = iniciarVirada({ antes: () => new Promise<void>(() => {}), esperaMaximaMs: 5000 });
    await vi.advanceTimersByTimeAsync(4000);
    expect((await listar('tarefas'))[0].data).toBe('2026-11-04');
    await vi.advanceTimersByTimeAsync(2000);
    await vi.waitFor(async () => expect((await listar('tarefas'))[0].data).toBe(HOJE));
    parar();
  });

  it('com o app aberto, vira de novo na meia-noite, sem recarregar, e no dia seguinte também', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(Date.parse('2026-11-05T23:59:30Z'));
    await salvar('tarefas', tarefa('De hoje', { data: HOJE }));
    const parar = iniciarVirada();
    await vi.advanceTimersByTimeAsync(100);
    expect((await listar('tarefas'))[0].data).toBe(HOJE);

    await vi.advanceTimersByTimeAsync(31_000); // 00:00:01 de sexta
    await vi.waitFor(async () => expect((await listar('tarefas'))[0].data).toBe('2026-11-06'));

    await vi.advanceTimersByTimeAsync(24 * 3600_000); // sábado
    await vi.waitFor(async () => expect((await listar('tarefas'))[0].data).toBe('2026-11-07'));
    parar();
  });

  it('ao voltar ao app em outro dia, vira na hora', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(AGORA);
    await salvar('tarefas', tarefa('De hoje', { data: HOJE }));
    const parar = iniciarVirada();
    await vi.advanceTimersByTimeAsync(100);

    vi.setSystemTime(Date.parse('2026-11-07T08:00:00Z'));
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(async () => expect((await listar('tarefas'))[0].data).toBe('2026-11-07'));
    parar();
  });

  it('depois de parar, a meia-noite não faz mais nada', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(Date.parse('2026-11-05T23:59:30Z'));
    await salvar('tarefas', tarefa('De hoje', { data: HOJE }));
    const parar = iniciarVirada();
    await vi.advanceTimersByTimeAsync(100);
    parar();
    await vi.advanceTimersByTimeAsync(3 * 3600_000);
    expect((await listar('tarefas'))[0].data).toBe(HOJE);
  });

  describe('com aparelho conectado: só vira em cima de dado em dia', () => {
    const MIN = 60_000;
    const conectado = () => Promise.resolve(true);

    it('a sincronia não terminou "atualizado": não vira, e na tentativa seguinte não desfaz a cópia mais nova do outro aparelho', async () => {
      vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
      vi.setSystemTime(AGORA);
      const velha = await salvar('tarefas', tarefa('Ontem', { data: '2026-11-04' }));
      const estados = ['sem-internet', 'atualizado'];
      const antes = vi.fn(async () => {
        const estado = estados.shift();
        if (estado === 'atualizado') {
          // Nesta rodada a sincronia traz a cópia que o outro aparelho já tinha passado para sexta.
          await gravarDoServidor([
            { colecao: 'tarefas', registro: { ...velha, data: '2026-11-06', atualizadoEm: AGORA + 1000, aparelho: 'outro' } },
          ]);
          await salvarRelogioDoServidor(Date.now());
        }
        return estado;
      });
      const parar = iniciarVirada({ antes, conectado });

      await vi.advanceTimersByTimeAsync(100);
      await esvaziar();
      expect(antes).toHaveBeenCalledTimes(1);
      expect((await listar('tarefas'))[0].data).toBe('2026-11-04'); // não escreveu

      await vi.advanceTimersByTimeAsync(5 * MIN + 1000);
      await vi.waitFor(() => expect(antes).toHaveBeenCalledTimes(2));
      await vi.advanceTimersByTimeAsync(100);
      expect((await listar('tarefas'))[0].data).toBe('2026-11-06'); // a do outro aparelho vale
      parar();
    });

    it('sem internet e sem nada de novo: a tentativa seguinte vira o dia', async () => {
      vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
      vi.setSystemTime(AGORA);
      await salvar('tarefas', tarefa('Ontem', { data: '2026-11-04' }));
      const estados = ['sem-internet', 'atualizado'];
      const parar = iniciarVirada({
        antes: async () => {
          const estado = estados.shift();
          if (estado === 'atualizado') await salvarRelogioDoServidor(Date.now());
          return estado;
        },
        conectado,
      });
      await vi.advanceTimersByTimeAsync(100);
      await esvaziar();
      expect((await listar('tarefas'))[0].data).toBe('2026-11-04');
      await vi.advanceTimersByTimeAsync(5 * MIN + 1000);
      await vi.waitFor(async () => expect((await listar('tarefas'))[0].data).toBe(HOJE));
      parar();
    });

    it('espera esgotada também conta como "não terminou": não vira', async () => {
      vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
      vi.setSystemTime(AGORA);
      await salvar('tarefas', tarefa('Ontem', { data: '2026-11-04' }));
      const parar = iniciarVirada({ antes: () => new Promise(() => {}), conectado, esperaMaximaMs: 5000 });
      await vi.advanceTimersByTimeAsync(7000);
      await esvaziar();
      expect((await listar('tarefas'))[0].data).toBe('2026-11-04');
      parar();
    });

    it('ao voltar ao app com a virada pendente, tenta na hora', async () => {
      vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
      vi.setSystemTime(AGORA);
      await salvar('tarefas', tarefa('Ontem', { data: '2026-11-04' }));
      const estados = ['erro-codigo', 'atualizado'];
      const parar = iniciarVirada({
        antes: async () => {
          const estado = estados.shift();
          if (estado === 'atualizado') await salvarRelogioDoServidor(Date.now());
          return estado;
        },
        conectado,
      });
      await vi.advanceTimersByTimeAsync(100);
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.waitFor(async () => expect((await listar('tarefas'))[0].data).toBe(HOJE));
      parar();
    });

    it('relógio do aparelho longe do do servidor (dias à frente): não grava nada', async () => {
      vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
      vi.setSystemTime(AGORA);
      await salvar('tarefas', tarefa('Ontem', { data: '2026-11-04' }));
      await salvar('tarefas', tarefa('Semana', { semana: '2026-11-02' }));
      const antes = await listar('tarefas');
      vi.setSystemTime(AGORA + 3 * 24 * 3600_000); // o relógio do aparelho pulou 3 dias
      const parar = iniciarVirada({
        antes: async () => {
          await salvarRelogioDoServidor(AGORA); // o servidor diz que agora é quinta 12:20
          return 'atualizado';
        },
        conectado,
      });
      await vi.advanceTimersByTimeAsync(200);
      await esvaziar();
      expect(await listar('tarefas')).toEqual(antes);
      parar();
    });

    it('relógio atrasado em relação ao servidor também não grava; diferença pequena (2 min) é normal', async () => {
      vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
      vi.setSystemTime(AGORA);
      await salvar('tarefas', tarefa('Ontem', { data: '2026-11-04' }));
      const parar = iniciarVirada({
        antes: async () => {
          await salvarRelogioDoServidor(AGORA + 30 * MIN); // o relógio daqui está 30 min atrasado
          return 'atualizado';
        },
        conectado,
      });
      await vi.advanceTimersByTimeAsync(200);
      await esvaziar();
      expect((await listar('tarefas'))[0].data).toBe('2026-11-04');
      parar();

      const parar2 = iniciarVirada({
        antes: async () => {
          await salvarRelogioDoServidor(AGORA + 2 * MIN);
          return 'atualizado';
        },
        conectado,
      });
      await vi.waitFor(async () => expect((await listar('tarefas'))[0].data).toBe(HOJE));
      parar2();
    });
  });

  describe('com a sincronia de verdade (o servidor sem escrita há 23 h)', () => {
    let notebook: IDBFactory;
    let servidor: ReturnType<typeof servidorDeTeste>;
    const semEspera = () => Promise.resolve();
    const conectado = () => Promise.resolve(true);
    const HORA = 3600_000;

    beforeEach(() => {
      notebook = new IDBFactory();
      globalThis.indexedDB = notebook;
      servidor = servidorDeTeste();
    });

    /** Ontem à tarde alguém escreveu; desde então o arquivo do servidor não mudou. */
    async function escritaDeOntem() {
      vi.setSystemTime(AGORA - 23 * HORA);
      await salvar('tarefas', tarefa('Do outro dia', { data: '2026-11-04' }));
      await sincronizar({ chamar: servidor.chamar, esperar: semEspera });
      vi.setSystemTime(AGORA);
    }

    it('relógio do aparelho certo: a virada grava (a última escrita do servidor ser antiga não bloqueia)', async () => {
      await escritaDeOntem();
      const parar = iniciarVirada({ antes: () => sincronizar({ chamar: servidor.chamar, esperar: semEspera }), conectado });
      await vi.waitFor(async () => expect((await listar('tarefas'))[0].data).toBe(HOJE));
      parar();
    });

    it('relógio do aparelho 3 dias à frente do servidor: não grava', async () => {
      await escritaDeOntem();
      vi.setSystemTime(AGORA + 3 * 24 * HORA);
      servidor.armazem.agora = () => AGORA; // o servidor sabe que ainda é quinta
      const antes = await listar('tarefas');
      const parar = iniciarVirada({ antes: () => sincronizar({ chamar: servidor.chamar, esperar: semEspera }), conectado });
      await esvaziar();
      await new Promise((r) => setTimeout(r, 100));
      await esvaziar();
      expect(await listar('tarefas')).toEqual(antes);
      parar();
    });

    it('script antigo (sem agoraDoServidor): depois de uma sincronia atualizada, vira normalmente', async () => {
      await escritaDeOntem();
      const antigo = async <T,>(acao: string, dados: object = {}): Promise<T> => {
        const resposta = (await servidor.chamar<Record<string, unknown>>(acao, dados)) as Record<string, unknown>;
        delete resposta.agoraDoServidor;
        return resposta as T;
      };
      const parar = iniciarVirada({ antes: () => sincronizar({ chamar: antigo, esperar: semEspera }), conectado });
      await vi.waitFor(async () => expect((await listar('tarefas'))[0].data).toBe(HOJE));
      parar();
    });
  });

  it('se gravar falha, tenta de novo depois, e não perde a virada', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(AGORA);
    await salvar('tarefas', tarefa('Ontem', { data: '2026-11-04' }));
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
      throw new Error('disco cheio');
    });
    const parar = iniciarVirada();
    await vi.advanceTimersByTimeAsync(100);
      await esvaziar();
    expect(erro).toHaveBeenCalled();
    expect((await listar('tarefas'))[0].data).toBe('2026-11-04');
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1000);
    await vi.waitFor(async () => expect((await listar('tarefas'))[0].data).toBe(HOJE));
    parar();
  });
});
