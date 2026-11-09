import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { enviar } from '../../script/dados';
import { ErroConexao, ErroScript } from '../../src/conexao/cliente';
import {
  apagar,
  assinar,
  concluirEnvio,
  gravarDoServidor,
  lerDiferencaDeRelogio,
  listar,
  listarAvisos,
  listarPendentes,
  salvar,
  semear,
} from '../../src/dados/loja';
import {
  assinarEstado,
  estadoAtual,
  iniciarSincronia,
  sincronizar,
  type EstadoSync,
} from '../../src/dados/sincronia';
import type { Mudanca, ParaSalvar, Tarefa } from '../../src/dados/tipos';
import { servidorDeTeste } from '../apoio/servidor';

// Relógio fixo: quinta, 2026-11-05, 12:20 em Lisboa (WET = UTC em novembro).
const AGORA = Date.parse('2026-11-05T12:20:00Z');
const MINUTO = 60_000;
const LIMITE_DO_CORPO = 256 * 1024;

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

function ouvir(ouvinte: (mudanca: Mudanca) => void) {
  onTestFinished(assinar(ouvinte));
}

let notebook: IDBFactory;
let celular: IDBFactory;
let servidor: ReturnType<typeof servidorDeTeste>;
const semEspera = (_ms: number) => Promise.resolve();

/** Os aparelhos são bancos separados: troca qual o app enxerga. */
function no(aparelho: IDBFactory) {
  globalThis.indexedDB = aparelho;
}

function sincronizarAqui(esperar: (ms: number) => Promise<void> = semEspera) {
  return sincronizar({ chamar: servidor.chamar, esperar });
}

function horario(minutos: number) {
  vi.setSystemTime(AGORA + minutos * MINUTO);
}

beforeEach(() => {
  // Só o Date é falso: o fake-indexeddb agenda trabalho com timers reais.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AGORA);
  notebook = new IDBFactory();
  celular = new IDBFactory();
  servidor = servidorDeTeste();
});

/** Tarefa criada no notebook e já recebida pelo celular. */
async function tarefaNosDois(titulo: string) {
  no(notebook);
  const criada = await salvar('tarefas', tarefa(titulo));
  expect(await sincronizarAqui()).toBe('atualizado');
  no(celular);
  expect(await sincronizarAqui()).toBe('atualizado');
  return criada;
}

describe('relógio do servidor', () => {
  it('depois de puxar, guarda a diferença entre o relógio do servidor e o deste aparelho', async () => {
    no(notebook);
    expect(await lerDiferencaDeRelogio()).toBeNull();
    await sincronizarAqui();
    expect(await lerDiferencaDeRelogio()).toBe(0); // o servidor de teste usa o mesmo Date.now

    horario(10);
    servidor.armazem.agora = () => Date.now() + 3 * 60 * MINUTO; // servidor 3 h adiantado
    await sincronizarAqui();
    expect(await lerDiferencaDeRelogio()).toBe(3 * 60 * MINUTO);
  });

  it('script antigo, que não manda agoraDoServidor: não guarda nada (a conferência de relógio é pulada)', async () => {
    no(notebook);
    await sincronizarAqui();
    expect(await lerDiferencaDeRelogio()).toBe(0);
    const antigo = async <T,>(acao: string, dados: object = {}): Promise<T> => {
      const resposta = (await servidor.chamar<Record<string, unknown>>(acao, dados)) as Record<string, unknown>;
      delete resposta.agoraDoServidor;
      return resposta as T;
    };
    expect(await sincronizar({ chamar: antigo, esperar: semEspera })).toBe('atualizado');
    expect(await lerDiferencaDeRelogio()).toBeNull();
  });
});

describe('dois aparelhos', () => {
  it('tarefa criada no notebook aparece no celular, com hora e aparelho de origem e sem pendentes', async () => {
    no(notebook);
    const criada = await salvar('tarefas', tarefa('Ler capítulo com Marina'));
    expect(await sincronizarAqui()).toBe('atualizado');
    expect(await listarPendentes()).toEqual([]);

    no(celular);
    expect(await sincronizarAqui()).toBe('atualizado');
    expect(await listar('tarefas')).toEqual([criada]);
    expect(await listarPendentes()).toEqual([]);
  });

  it('os dois mudam a mesma tarefa: vence a mais recente e avisos tem 1 item', async () => {
    const criada = await tarefaNosDois('Reunião com Prof. Souza');

    horario(1);
    no(notebook);
    await salvar('tarefas', { ...criada, titulo: 'Reunião com Prof. Souza às 15h' });
    horario(2);
    no(celular);
    await salvar('tarefas', { ...criada, titulo: 'Reunião com Prof. Souza cancelada' });

    horario(3);
    no(notebook);
    await sincronizarAqui();
    no(celular);
    expect(await sincronizarAqui()).toBe('atualizado');
    no(notebook);
    expect(await sincronizarAqui()).toBe('atualizado');

    for (const aparelho of [notebook, celular]) {
      no(aparelho);
      expect((await listar('tarefas')).map((t) => t.titulo)).toEqual([
        'Reunião com Prof. Souza cancelada',
      ]);
      expect(await listarPendentes()).toEqual([]);
    }
    no(notebook);
    const doNotebook = await listarAvisos();
    no(celular);
    const doCelular = await listarAvisos();
    expect([...doNotebook, ...doCelular]).toHaveLength(1);
    expect(doCelular[0]).toMatchObject({
      colecao: 'tarefas',
      registroId: criada.id,
      perdedora: { titulo: 'Reunião com Prof. Souza às 15h' },
      vencedora: { titulo: 'Reunião com Prof. Souza cancelada' },
    });
  });

  it('edição mais antiga enviada por último perde: vira aviso e não é enviada', async () => {
    const criada = await tarefaNosDois('Aula da Aurora');

    horario(1);
    no(celular);
    await salvar('tarefas', { ...criada, titulo: 'Aula da Aurora (velha)' });
    horario(2);
    no(notebook);
    await salvar('tarefas', { ...criada, titulo: 'Aula da Aurora (nova)' });
    await sincronizarAqui();
    const enviosAntes = servidor.de('enviar').length;

    no(celular);
    expect(await sincronizarAqui()).toBe('atualizado');

    expect((await listar('tarefas')).map((t) => t.titulo)).toEqual(['Aula da Aurora (nova)']);
    expect(await listarPendentes()).toEqual([]);
    const [aviso, ...outros] = await listarAvisos();
    expect(outros).toEqual([]);
    expect(aviso.perdedora).toMatchObject({ titulo: 'Aula da Aurora (velha)' });
    const enviadoDepois = servidor.de('enviar').slice(enviosAntes);
    expect(JSON.stringify(enviadoDepois)).not.toContain('(velha)');
  });

  it('conflito descoberto só no envio também vira aviso e o pendente sai', async () => {
    const criada = await tarefaNosDois('Orientação com Renata');
    horario(1);
    no(celular);
    await salvar('tarefas', { ...criada, titulo: 'Orientação com Renata (celular)' });

    // Entre o puxar e o enviar do celular, outro aparelho grava uma versão mais nova.
    servidor.aoResponder((acao) => {
      if (acao !== 'puxar') return;
      servidor.aoResponder(undefined);
      enviar(
        {
          mudancas: [
            {
              colecao: 'tarefas',
              registro: {
                ...criada,
                titulo: 'Orientação com Renata (notebook)',
                atualizadoEm: AGORA + 2 * MINUTO,
                aparelho: 'outro-aparelho',
              },
            },
          ],
        },
        servidor.armazem,
      );
    });
    horario(3);
    expect(await sincronizarAqui()).toBe('atualizado');

    expect((await listar('tarefas')).map((t) => t.titulo)).toEqual(['Orientação com Renata (notebook)']);
    expect(await listarPendentes()).toEqual([]);
    const avisos = await listarAvisos();
    expect(avisos).toHaveLength(1);
    expect(avisos[0].perdedora).toMatchObject({ titulo: 'Orientação com Renata (celular)' });
  });

  it('registro apagado propaga', async () => {
    const criada = await tarefaNosDois('Comprar café');
    horario(1);
    no(notebook);
    await apagar('tarefas', criada.id);
    expect(await sincronizarAqui()).toBe('atualizado');

    no(celular);
    expect(await sincronizarAqui()).toBe('atualizado');
    expect(await listar('tarefas')).toEqual([]);
    expect(await listar('tarefas', { comApagados: true })).toMatchObject([
      { id: criada.id, apagado: true, atualizadoEm: AGORA + MINUTO },
    ]);
    expect(await listarAvisos()).toEqual([]);
  });

  it('escrita offline antiga chega ao outro aparelho mesmo depois de ele sincronizar (R5)', async () => {
    no(celular);
    horario(30);
    await sincronizarAqui();

    // O notebook gravou às 12:20, offline, e só envia às 12:50.
    no(notebook);
    horario(0);
    const offline = await salvar('tarefas', tarefa('Feita offline'));
    horario(30);
    await sincronizarAqui();

    no(celular);
    horario(31);
    await sincronizarAqui();
    expect(await listar('tarefas')).toEqual([offline]);
  });

  it('sementes nos dois aparelhos não viram avisos nem envios', async () => {
    no(notebook);
    await semear();
    expect(await sincronizarAqui()).toBe('atualizado');
    no(celular);
    await semear();
    expect(await sincronizarAqui()).toBe('atualizado');
    no(notebook);
    expect(await sincronizarAqui()).toBe('atualizado');

    expect(servidor.de('enviar')).toEqual([]);
    expect(servidor.armazem.conteudo).toBeNull();
    for (const aparelho of [notebook, celular]) {
      no(aparelho);
      expect(await listarAvisos()).toEqual([]);
      expect(await listar('salas')).toHaveLength(7);
    }
  });

  it('sala semeada renomeada num aparelho chega ao outro sem aviso', async () => {
    no(notebook);
    await semear();
    const [mba] = (await listar('salas')).filter((s) => s.id === 'sala-mba');
    horario(1);
    await salvar('salas', { ...mba, nome: 'MBA executivo' });
    await sincronizarAqui();

    no(celular);
    await semear();
    expect(await sincronizarAqui()).toBe('atualizado');
    expect((await listar('salas')).find((s) => s.id === 'sala-mba')?.nome).toBe('MBA executivo');
    expect(await listarAvisos()).toEqual([]);
  });

  it('servidor restaurado de cópia antiga recebe de novo a versão mais nova', async () => {
    no(notebook);
    const v1 = await salvar('tarefas', tarefa('Versão 1'));
    await sincronizarAqui();
    const copia = servidor.armazem.conteudo;
    horario(1);
    await salvar('tarefas', { ...v1, titulo: 'Versão 2' });
    await sincronizarAqui();
    await sincronizarAqui(); // o aparelho já viu o carimbo da versão 2

    // O dono restaurou uma cópia antiga: o carimbo do servidor volta para trás.
    servidor.armazem.conteudo = copia;
    horario(2);
    expect(await sincronizarAqui()).toBe('atualizado');

    no(celular);
    await sincronizarAqui();
    expect((await listar('tarefas')).map((t) => t.titulo)).toEqual(['Versão 2']);
  });
});

describe('falhas', () => {
  it('sem rede: estado por-enviar e pendentes intactos', async () => {
    no(notebook);
    await salvar('tarefas', tarefa('Ligar para Renata'));
    const antes = await listarPendentes();
    servidor.falharAntes(() => new ErroConexao());

    expect(await sincronizarAqui()).toBe('por-enviar');
    expect(await listarPendentes()).toEqual(antes);
  });

  it('sem rede e nada a enviar: sem-internet', async () => {
    no(notebook);
    servidor.falharAntes(() => new ErroConexao());
    expect(await sincronizarAqui()).toBe('sem-internet');
  });

  it.each(['puxar', 'enviar'])('codigo-invalido em %s dá erro-codigo sem perder pendentes', async (etapa) => {
    no(notebook);
    await salvar('tarefas', tarefa('Ligar para Renata'));
    const antes = await listarPendentes();
    servidor.falharAntes((acao) => (acao === etapa ? new ErroScript('codigo-invalido') : undefined));

    expect(await sincronizarAqui()).toBe('erro-codigo');
    expect(await listarPendentes()).toEqual(antes);
  });

  it('interno dá erro-codigo sem perder pendentes', async () => {
    no(notebook);
    await salvar('tarefas', tarefa('Ligar para Renata'));
    const antes = await listarPendentes();
    servidor.falharAntes((acao) => (acao === 'enviar' ? new ErroScript('interno') : undefined));

    expect(await sincronizarAqui()).toBe('erro-codigo');
    expect(await listarPendentes()).toEqual(antes);
  });

  it('ocupado tenta de novo e envia', async () => {
    no(notebook);
    await salvar('tarefas', tarefa('Ligar para Renata'));
    servidor.falharAntes((acao, vez) =>
      acao === 'enviar' && vez === 1 ? new ErroScript('ocupado') : undefined,
    );
    const esperar = vi.fn(semEspera);

    expect(await sincronizarAqui(esperar)).toBe('atualizado');
    expect(servidor.de('enviar')).toHaveLength(2);
    expect(await listarPendentes()).toEqual([]);
    expect(esperar).toHaveBeenCalledTimes(1);
    expect(esperar.mock.calls[0][0]).toBeGreaterThan(0);
  });

  it('ocupado também no puxar tenta de novo', async () => {
    no(notebook);
    servidor.falharAntes((acao, vez) => (acao === 'puxar' && vez === 1 ? new ErroScript('ocupado') : undefined));
    expect(await sincronizarAqui()).toBe('atualizado');
    expect(servidor.de('puxar')).toHaveLength(2);
  });

  it('ocupado sempre: desiste depois de 3 tentativas e guarda os pendentes', async () => {
    no(notebook);
    await salvar('tarefas', tarefa('Ligar para Renata'));
    const antes = await listarPendentes();
    servidor.falharAntes((acao) => (acao === 'enviar' ? new ErroScript('ocupado') : undefined));
    const esperar = vi.fn(semEspera);

    expect(await sincronizarAqui(esperar)).toBe('por-enviar');
    expect(servidor.de('enviar')).toHaveLength(3);
    expect(esperar).toHaveBeenCalledTimes(2);
    expect(await listarPendentes()).toEqual(antes);
  });

  it('erro inesperado do próprio aparelho não vira rejeição solta', async () => {
    no(notebook);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const quebrado = () => Promise.reject(new TypeError('falha qualquer'));
    expect(await sincronizar({ chamar: quebrado, esperar: semEspera })).toBe('erro-codigo');
  });
});

describe('envio', () => {
  it('depois de enviar, os pendentes enviados saem; escrita feita durante o envio fica', async () => {
    no(notebook);
    const primeira = await salvar('tarefas', tarefa('Primeira'));
    let durante: Tarefa | undefined;
    servidor.aoResponder(async (acao) => {
      if (acao !== 'enviar' || durante) return;
      horario(1);
      durante = await salvar('tarefas', { ...primeira, titulo: 'Editada durante o envio' });
    });

    expect(await sincronizarAqui()).toBe('por-enviar');
    expect(await listarPendentes()).toMatchObject([{ colecao: 'tarefas', id: primeira.id }]);
    expect((await listar('tarefas'))[0].titulo).toBe('Editada durante o envio');

    servidor.aoResponder(undefined);
    expect(await sincronizarAqui()).toBe('atualizado');
    no(celular);
    await sincronizarAqui();
    expect((await listar('tarefas'))[0].titulo).toBe('Editada durante o envio');
  });

  it('o mesmo registro salvo várias vezes vai uma vez só, na versão atual', async () => {
    no(notebook);
    const t = await salvar('tarefas', tarefa('a'));
    await salvar('tarefas', { ...t, titulo: 'b' });
    await salvar('tarefas', { ...t, titulo: 'c' });
    await sincronizarAqui();

    const [envio] = servidor.de('enviar');
    expect(envio.dados.mudancas).toHaveLength(1);
    expect(envio.dados.mudancas[0].registro.titulo).toBe('c');
  });

  it('pendente só sai com confirmação do servidor em aceitas', async () => {
    no(notebook);
    const confirmada = await salvar('tarefas', tarefa('Confirmada'));
    const esquecida = await salvar('tarefas', tarefa('Esquecida pelo servidor'));
    const semUmaAceita = async <T,>(acao: string, dados: object = {}): Promise<T> => {
      const resposta = await servidor.chamar<any>(acao, dados);
      if (acao !== 'enviar') return resposta;
      return { ...resposta, aceitas: resposta.aceitas.filter((a: { id: string }) => a.id !== esquecida.id) };
    };

    expect(await sincronizar({ chamar: semUmaAceita, esperar: semEspera })).toBe('por-enviar');
    const fila = (await listarPendentes()).filter((p) => p.tipo === 'registro');
    expect(fila.map((p) => p.id)).toEqual([esquecida.id]);
    expect(fila.map((p) => p.id)).not.toContain(confirmada.id);
  });

  it('nada a enviar: não chama enviar', async () => {
    no(notebook);
    await sincronizarAqui();
    expect(servidor.de('enviar')).toEqual([]);
  });

  it('muitos registros vão em lotes, cada pedido abaixo de 256 KB', async () => {
    no(notebook);
    for (let i = 0; i < 30; i++) await salvar('tarefas', tarefa(`Tarefa ${i} ` + 'x'.repeat(20_000)));

    expect(await sincronizarAqui()).toBe('atualizado');
    expect(servidor.de('enviar').length).toBeGreaterThan(1);
    expect(servidor.pedidos.every((p) => p.tamanho <= LIMITE_DO_CORPO)).toBe(true);
    expect(await listarPendentes()).toEqual([]);
    no(celular);
    await sincronizarAqui();
    expect(await listar('tarefas')).toHaveLength(30);
  });

  it('registro grande demais fica pendente e não trava os outros', async () => {
    no(notebook);
    const grande = await salvar('tarefas', tarefa('x'.repeat(300_000)));
    await salvar('tarefas', tarefa('Pequena'));

    expect(await sincronizarAqui()).toBe('por-enviar');
    expect(await listarPendentes()).toMatchObject([{ id: grande.id }]);
    expect(servidor.pedidos.every((p) => p.tamanho <= LIMITE_DO_CORPO)).toBe(true);
    no(celular);
    await sincronizarAqui();
    expect((await listar('tarefas')).map((t) => t.titulo)).toEqual(['Pequena']);
  });
});

describe('puxar', () => {
  it('cada puxar pede só o que mudou depois do agora do puxar anterior', async () => {
    no(notebook);
    await salvar('tarefas', tarefa('a'));
    await sincronizarAqui(); // puxa do servidor vazio (agora 0) e envia
    await sincronizarAqui(); // puxa desde 0: recebe o próprio envio de volta
    await sincronizarAqui();

    const [primeiro, segundo, terceiro] = servidor.de('puxar');
    expect(primeiro.dados).toEqual({ desde: 0 });
    expect(segundo.dados).toEqual({ desde: 0 });
    expect(terceiro.dados.desde).toBe(JSON.parse(servidor.armazem.conteudo!).ultimo);
    expect(terceiro.dados.desde).toBeGreaterThan(0);
  });

  it('avisa os ouvintes com remota: true, e só quando algo mudou', async () => {
    await tarefaNosDois('Ler com Marina');
    const recebidas: Mudanca[] = [];
    no(celular);
    ouvir((m) => recebidas.push(m));

    no(notebook);
    const [t] = await listar('tarefas');
    horario(1);
    await salvar('tarefas', { ...t, titulo: 'Ler com Marina e Renata' });
    await sincronizarAqui();
    no(celular);
    await sincronizarAqui();
    await sincronizarAqui();

    expect(recebidas.filter((m) => m.remota)).toEqual([{ colecao: 'tarefas', id: t.id, remota: true }]);
  });
});

describe('gravarDoServidor (mesclagem)', () => {
  const base = { id: 't1', ...tarefa('Servidor') } as Tarefa;

  function remota(extra: Partial<Tarefa>) {
    return { colecao: 'tarefas', registro: { ...base, atualizadoEm: AGORA, aparelho: 'outro', ...extra } };
  }

  it('versão local pendente mais nova vence a remota de outro aparelho: aviso, pendente fica', async () => {
    no(notebook);
    horario(5);
    await salvar('tarefas', { ...base, titulo: 'Local' });
    await gravarDoServidor([remota({ titulo: 'Remota' })]);

    expect((await listar('tarefas'))[0].titulo).toBe('Local');
    expect(await listarPendentes()).toHaveLength(1);
    expect(await listarAvisos()).toMatchObject([
      { perdedora: { titulo: 'Remota' }, vencedora: { titulo: 'Local' }, criadoEm: AGORA + 5 * MINUTO },
    ]);
  });

  it('mesma mudança nos dois aparelhos (só hora e aparelho diferem): sem aviso, local pendente mais nova', async () => {
    no(notebook);
    horario(5);
    await salvar('tarefas', { ...base, titulo: 'Igual' });
    await gravarDoServidor([remota({ titulo: 'Igual' })]);
    expect(await listarAvisos()).toEqual([]);
    expect(await listarPendentes()).toHaveLength(1);
  });

  it('mesma mudança nos dois aparelhos: sem aviso, remota mais nova', async () => {
    no(notebook);
    await salvar('tarefas', { ...base, titulo: 'Igual' });
    await gravarDoServidor([remota({ titulo: 'Igual', atualizadoEm: AGORA + MINUTO })]);
    expect(await listarAvisos()).toEqual([]);
    expect((await listar('tarefas'))[0].aparelho).toBe('outro');
    expect(await listarPendentes()).toEqual([]);
  });

  it('campo opcional ausente e undefined contam como iguais; campo a mais ou valor diferente, não', async () => {
    no(notebook);
    horario(5);
    await salvar('tarefas', { ...base, titulo: 'T', pessoaId: undefined });
    await gravarDoServidor([remota({ titulo: 'T' })]);
    expect(await listarAvisos()).toEqual([]);
    await salvar('tarefas', { ...base, titulo: 'T', data: '2026-11-05' });
    await gravarDoServidor([remota({ titulo: 'T', data: '2026-11-06', atualizadoEm: AGORA + 2 * MINUTO })]);
    expect(await listarAvisos()).toHaveLength(1);
  });

  it('versão antiga do próprio aparelho voltando do servidor não é conflito', async () => {
    no(notebook);
    const local = await salvar('tarefas', { ...base, titulo: 'Primeira' });
    horario(1);
    await salvar('tarefas', { ...local, titulo: 'Segunda' });
    await gravarDoServidor([{ colecao: 'tarefas', registro: local }]);

    expect((await listar('tarefas'))[0].titulo).toBe('Segunda');
    expect(await listarAvisos()).toEqual([]);
  });

  it('remota mais nova sobre local pendente: aviso e só os pendentes desse registro saem', async () => {
    no(notebook);
    await salvar('tarefas', { ...base, titulo: 'Local' });
    const outra = await salvar('tarefas', tarefa('Outra'));
    await gravarDoServidor([remota({ titulo: 'Remota', atualizadoEm: AGORA + MINUTO })]);

    expect((await listar('tarefas')).find((t) => t.id === 't1')?.titulo).toBe('Remota');
    expect(await listarPendentes()).toMatchObject([{ id: outra.id }]);
    expect(await listarAvisos()).toHaveLength(1);
  });

  it('local sem pendente é só atualizada, sem aviso', async () => {
    no(notebook);
    await gravarDoServidor([remota({ titulo: 'Primeira' })]);
    await gravarDoServidor([remota({ titulo: 'Segunda', atualizadoEm: AGORA + MINUTO })]);
    expect((await listar('tarefas'))[0]).toMatchObject({ titulo: 'Segunda', aparelho: 'outro' });
    expect(await listarAvisos()).toEqual([]);
    expect(await listarPendentes()).toEqual([]);
  });

  it('local já enviada e mais nova que a do servidor volta para a fila, sem aviso', async () => {
    no(notebook);
    await gravarDoServidor([remota({ titulo: 'Nova', atualizadoEm: AGORA + MINUTO })]);
    await gravarDoServidor([remota({ titulo: 'Velha' })]);

    expect((await listar('tarefas'))[0].titulo).toBe('Nova');
    expect(await listarPendentes()).toMatchObject([{ colecao: 'tarefas', id: 't1' }]);
    expect(await listarAvisos()).toEqual([]);
  });

  it('semente vinda do servidor perdendo para edição local pendente não vira aviso', async () => {
    no(notebook);
    await semear();
    const [mba] = (await listar('salas')).filter((s) => s.id === 'sala-mba');
    await salvar('salas', { ...mba, nome: 'MBA executivo' });
    await gravarDoServidor([{ colecao: 'salas', registro: mba }]);

    expect(await listarAvisos()).toEqual([]);
    expect((await listar('salas')).find((s) => s.id === 'sala-mba')?.nome).toBe('MBA executivo');
  });

  it('semente local (atualizadoEm 0) nunca vira aviso', async () => {
    no(notebook);
    await semear();
    await gravarDoServidor([
      { colecao: 'salas', registro: { id: 'sala-mba', nome: 'MBA 2', ordem: 4, atualizadoEm: AGORA, aparelho: 'outro' } },
    ]);
    expect(await listarAvisos()).toEqual([]);
    expect((await listar('salas')).find((s) => s.id === 'sala-mba')?.nome).toBe('MBA 2');
  });

  it('itens malformados ou de coleção desconhecida são ignorados', async () => {
    no(notebook);
    await gravarDoServidor([
      null,
      { colecao: 'tarefas', registro: { id: 5, atualizadoEm: 1, aparelho: 'x' } },
      { colecao: 'tarefas', registro: { id: 't2', atualizadoEm: '1', aparelho: 'x' } },
      { colecao: 'naoExiste', registro: { id: 't3', atualizadoEm: 1, aparelho: 'x' } },
      { colecao: 'avisos', registro: { id: 't4', atualizadoEm: 1, aparelho: 'x' } },
      remota({ titulo: 'Válida' }),
    ]);
    expect((await listar('tarefas')).map((t) => t.titulo)).toEqual(['Válida']);
  });
});

describe('estado', () => {
  it('assinarEstado recebe atualizando e depois o estado final; estadoAtual acompanha', async () => {
    no(notebook);
    const vistos: EstadoSync[] = [];
    onTestFinished(assinarEstado((estado) => vistos.push(estado)));

    await sincronizarAqui();
    servidor.falharAntes(() => new ErroConexao());
    await sincronizarAqui();

    expect(vistos).toEqual(['atualizando', 'atualizado', 'atualizando', 'sem-internet']);
    expect(estadoAtual()).toBe('sem-internet');
  });

  it('chamadas simultâneas não se sobrepõem: a segunda roda depois da primeira', async () => {
    no(notebook);
    await salvar('tarefas', tarefa('a'));
    const [um, dois] = await Promise.all([sincronizarAqui(), sincronizarAqui()]);

    expect([um, dois]).toEqual(['atualizado', 'atualizado']);
    expect(servidor.pedidos.map((p) => p.acao)).toEqual(['puxar', 'enviar', 'puxar']);
  });
});

describe('iniciarSincronia', () => {
  let ouvinteDaLoja: ((m: Mudanca) => void) | undefined;
  const assinarFalso = (ouvinte: (m: Mudanca) => void) => {
    ouvinteDaLoja = ouvinte;
    return () => {
      ouvinteDaLoja = undefined;
    };
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    ouvinteDaLoja = undefined;
  });

  afterEach(() => {
    ouvinteDaLoja = undefined;
  });

  function iniciar() {
    const rodar = vi.fn(() => Promise.resolve<EstadoSync>('atualizado'));
    const parar = iniciarSincronia({ sincronizar: rodar, assinar: assinarFalso });
    onTestFinished(parar);
    return { rodar, parar };
  }

  function visibilidade(estado: DocumentVisibilityState) {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(estado);
  }

  it('sincroniza ao abrir', () => {
    const { rodar } = iniciar();
    expect(rodar).toHaveBeenCalledTimes(1);
  });

  it('sincroniza ao voltar ao app, não ao sair', () => {
    const { rodar } = iniciar();
    visibilidade('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(rodar).toHaveBeenCalledTimes(1);
    visibilidade('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(rodar).toHaveBeenCalledTimes(2);
  });

  it('sincroniza quando a internet volta', () => {
    const { rodar } = iniciar();
    window.dispatchEvent(new Event('online'));
    expect(rodar).toHaveBeenCalledTimes(2);
  });

  it('2 s depois de escrever, uma vez só para escritas seguidas; mudança remota não dispara', () => {
    const { rodar } = iniciar();
    ouvinteDaLoja!({ colecao: 'tarefas', id: 'a' });
    vi.advanceTimersByTime(1500);
    ouvinteDaLoja!({ colecao: 'tarefas', id: 'b' });
    vi.advanceTimersByTime(1999);
    expect(rodar).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(rodar).toHaveBeenCalledTimes(2);

    ouvinteDaLoja!({ colecao: 'tarefas', id: 'c', remota: true });
    vi.advanceTimersByTime(5000);
    expect(rodar).toHaveBeenCalledTimes(2);
  });

  it('a cada 60 s com o app aberto; escondido, não', () => {
    visibilidade('visible');
    const { rodar } = iniciar();
    vi.advanceTimersByTime(60_000);
    expect(rodar).toHaveBeenCalledTimes(2);
    visibilidade('hidden');
    vi.advanceTimersByTime(120_000);
    expect(rodar).toHaveBeenCalledTimes(2);
  });

  it('parar desliga eventos, relógio e escuta da loja', () => {
    const { rodar, parar } = iniciar();
    ouvinteDaLoja!({ colecao: 'tarefas', id: 'a' });
    parar();
    vi.advanceTimersByTime(120_000);
    window.dispatchEvent(new Event('online'));
    visibilidade('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(rodar).toHaveBeenCalledTimes(1);
    expect(ouvinteDaLoja).toBeUndefined();
  });
});

describe('fix 1: validação do que chega do servidor', () => {
  const valida = { id: 't1', ...tarefa('Válida'), atualizadoEm: AGORA, aparelho: 'outro' };

  it.each([
    ['atualizadoEm mais de 10 min no futuro', { ...valida, atualizadoEm: AGORA + 10 * MINUTO + 1 }],
    ['id com espaço', { ...valida, id: 'id com espaço' }],
    ['id com 65 caracteres', { ...valida, id: 'x'.repeat(65) }],
    ['aparelho com barra', { ...valida, aparelho: 'a/b' }],
    ['tarefa sem titulo', { ...valida, titulo: undefined }],
    ['titulo número', { ...valida, titulo: 5 }],
    ['apagado texto', { ...valida, apagado: 'sim' }],
  ])('tarefa remota com %s é ignorada', async (_nome, registro) => {
    no(notebook);
    await gravarDoServidor([{ colecao: 'tarefas', registro }]);
    expect(await listar('tarefas', { comApagados: true })).toEqual([]);
  });

  it('documento remoto com url que não é http(s) é ignorado; https entra', async () => {
    no(notebook);
    const documento = { titulo: 'Plano de aula', arquivado: false, atualizadoEm: AGORA, aparelho: 'outro' };
    await gravarDoServidor([
      { colecao: 'documentos', registro: { ...documento, id: 'd1', url: 'javascript:alert(1)' } },
      { colecao: 'documentos', registro: { ...documento, id: 'd2', url: 'https://exemplo.invalid/plano' } },
    ]);
    expect((await listar('documentos')).map((d) => d.id)).toEqual(['d2']);
  });

  it('exatamente 10 min no futuro ainda entra', async () => {
    no(notebook);
    await gravarDoServidor([{ colecao: 'tarefas', registro: { ...valida, atualizadoEm: AGORA + 10 * MINUTO } }]);
    expect(await listar('tarefas')).toHaveLength(1);
  });
});

describe('fix 1: recusadas pelo servidor', () => {
  it('registro recusado fica na fila e os outros seguem', async () => {
    no(notebook);
    await salvar('tarefas', { id: 'id com espaço', ...tarefa('Recusada') });
    const boa = await salvar('tarefas', tarefa('Boa'));

    expect(await sincronizarAqui()).toBe('por-enviar');
    const [envio] = servidor.de('enviar');
    expect(envio.dados.mudancas).toHaveLength(2);
    expect((await listarPendentes()).filter((p) => p.tipo === 'registro').map((p) => p.id)).toEqual(['id com espaço']);
    no(celular);
    await sincronizarAqui();
    expect((await listar('tarefas')).map((t) => t.id)).toEqual([boa.id]);
  });
});

describe('fix 1: corrida entre puxar e enviar (substituidas)', () => {
  it('enviar leva o desde do puxar da mesma rodada', async () => {
    no(notebook);
    await salvar('tarefas', tarefa('a'));
    await sincronizarAqui();
    const depoisDoPrimeiro = JSON.parse(servidor.armazem.conteudo!).ultimo as number;
    horario(1);
    await salvar('tarefas', tarefa('b'));
    await sincronizarAqui();

    const [primeiro, segundo] = servidor.de('enviar');
    expect(primeiro.dados.desde).toBe(0);
    expect(segundo.dados.desde).toBe(depoisDoPrimeiro);
  });

  it('versão de outro aparelho sobrescrita no envio vira aviso aqui', async () => {
    const criada = await tarefaNosDois('Orientação com Renata');
    horario(2);
    no(celular);
    await salvar('tarefas', { ...criada, titulo: 'Orientação com Renata (celular)' });

    // Entre o puxar e o enviar do celular, outro aparelho grava uma versão mais
    // nova que a base, mas mais velha que a edição do celular.
    servidor.aoResponder((acao) => {
      if (acao !== 'puxar') return;
      servidor.aoResponder(undefined);
      enviar(
        {
          mudancas: [
            {
              colecao: 'tarefas',
              registro: {
                ...criada,
                titulo: 'Orientação com Renata (notebook)',
                atualizadoEm: AGORA + MINUTO,
                aparelho: 'outro-aparelho',
              },
            },
          ],
        },
        servidor.armazem,
      );
    });
    horario(3);
    expect(await sincronizarAqui()).toBe('atualizado');

    expect((await listar('tarefas')).map((t) => t.titulo)).toEqual(['Orientação com Renata (celular)']);
    const avisos = await listarAvisos();
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({
      registroId: criada.id,
      perdedora: { titulo: 'Orientação com Renata (notebook)' },
      vencedora: { titulo: 'Orientação com Renata (celular)' },
    });
  });

  it('versão sobrescrita no envio que diz o mesmo que a local não vira aviso', async () => {
    const criada = await tarefaNosDois('Orientação com Renata');
    horario(2);
    no(celular);
    await salvar('tarefas', { ...criada, titulo: 'Orientação com Renata (igual)' });
    servidor.aoResponder((acao) => {
      if (acao !== 'puxar') return;
      servidor.aoResponder(undefined);
      enviar(
        {
          mudancas: [
            {
              colecao: 'tarefas',
              registro: { ...criada, titulo: 'Orientação com Renata (igual)', atualizadoEm: AGORA + MINUTO, aparelho: 'outro-aparelho' },
            },
          ],
        },
        servidor.armazem,
      );
    });
    horario(3);
    expect(await sincronizarAqui()).toBe('atualizado');
    expect(await listarAvisos()).toEqual([]);
    expect(await listarPendentes()).toEqual([]);
  });

  it('substituidas malformadas são ignoradas', async () => {
    no(notebook);
    await salvar('tarefas', tarefa('a'));
    const comLixo = async <T,>(acao: string, dados: object = {}): Promise<T> => {
      const resposta = await servidor.chamar<any>(acao, dados);
      if (acao !== 'enviar') return resposta;
      return { ...resposta, substituidas: [null, { colecao: 'constructor', registro: {} }, 5] };
    };
    expect(await sincronizar({ chamar: comLixo, esperar: semEspera })).toBe('atualizado');
    expect(await listarAvisos()).toEqual([]);
  });
});

describe('fix 1: aviso quando a remota vence uma alteração ainda por enviar', () => {
  it('mesmo vindo do mesmo aparelho', async () => {
    no(notebook);
    const local = await salvar('tarefas', { id: 't1', ...tarefa('Local por enviar') });
    await gravarDoServidor([
      { colecao: 'tarefas', registro: { ...local, titulo: 'Remota', atualizadoEm: local.atualizadoEm + MINUTO } },
    ]);
    expect(await listarAvisos()).toMatchObject([{ perdedora: { titulo: 'Local por enviar' } }]);
  });
});

describe('fix 1: avisos limitados', () => {
  it('guarda só os 200 mais novos', async () => {
    no(notebook);
    for (let i = 0; i < 205; i++) await salvar('tarefas', { id: `t${i}`, ...tarefa(`Local ${i}`) });
    await gravarDoServidor(
      Array.from({ length: 205 }, (_, i) => ({
        colecao: 'tarefas',
        registro: { id: `t${i}`, ...tarefa(`Remota ${i}`), atualizadoEm: AGORA + MINUTO, aparelho: 'outro' },
      })),
    );
    const avisos = await listarAvisos();
    expect(avisos).toHaveLength(200);
    expect(avisos[0].registroId).toBe('t5');
    expect(avisos.at(-1)!.registroId).toBe('t204');
  });
});

describe('fix 2: relógios diferentes (notebook +9 min, celular -2 min)', () => {
  // O relógio real é AGORA; o servidor marca o tempo real, cada aparelho o seu.
  const notebookAdiantado = () => horario(9);
  const celularAtrasado = () => horario(-2);

  beforeEach(() => {
    servidor.armazem.agora = () => AGORA;
  });

  it('o celular atrasado recebe os registros do notebook adiantado, lápides incluídas', async () => {
    no(notebook);
    notebookAdiantado();
    const fica = await salvar('tarefas', tarefa('Fica'));
    const sai = await salvar('tarefas', tarefa('Sai'));
    await apagar('tarefas', sai.id);
    expect(await sincronizarAqui()).toBe('atualizado');

    no(celular);
    celularAtrasado();
    expect(await sincronizarAqui()).toBe('atualizado');
    expect((await listar('tarefas')).map((t) => t.id)).toEqual([fica.id]);
    expect(await listar('tarefas', { comApagados: true })).toContainEqual(
      expect.objectContaining({ id: sai.id, apagado: true }),
    );
  });

  it('conflito devolvido no envio é resolvido mesmo com o relógio atrasado', async () => {
    no(notebook);
    notebookAdiantado();
    const criada = await salvar('tarefas', tarefa('Reunião com Prof. Souza'));
    await sincronizarAqui();
    no(celular);
    celularAtrasado();
    await sincronizarAqui();
    await salvar('tarefas', { ...criada, titulo: 'Reunião (celular)' });

    // Entre o puxar e o enviar do celular, o notebook grava uma versão mais nova.
    servidor.aoResponder((acao) => {
      if (acao !== 'puxar') return;
      servidor.aoResponder(undefined);
      enviar(
        {
          mudancas: [
            {
              colecao: 'tarefas',
              registro: { ...criada, titulo: 'Reunião (notebook)', atualizadoEm: criada.atualizadoEm + 5, aparelho: criada.aparelho },
            },
          ],
        },
        servidor.armazem,
      );
    });
    expect(await sincronizarAqui()).toBe('atualizado');

    expect((await listar('tarefas')).map((t) => t.titulo)).toEqual(['Reunião (notebook)']);
    expect(await listarPendentes()).toEqual([]);
    expect(await listarAvisos()).toMatchObject([{ perdedora: { titulo: 'Reunião (celular)' } }]);
  });

  it('substituida vinda do aparelho adiantado vira aviso no celular atrasado', async () => {
    no(notebook);
    notebookAdiantado();
    const criada = await salvar('tarefas', tarefa('Aula da Aurora'));
    await sincronizarAqui();
    no(celular);
    celularAtrasado();
    await sincronizarAqui();
    // Três edições: o carimbo do celular sobe a partir do que ele recebeu.
    let local = await salvar('tarefas', { ...criada, titulo: 'Aula (celular 1)' });
    local = await salvar('tarefas', { ...local, titulo: 'Aula (celular 2)' });
    local = await salvar('tarefas', { ...local, titulo: 'Aula (celular 3)' });

    servidor.aoResponder((acao) => {
      if (acao !== 'puxar') return;
      servidor.aoResponder(undefined);
      enviar(
        {
          mudancas: [
            {
              colecao: 'tarefas',
              registro: { ...criada, titulo: 'Aula (notebook)', atualizadoEm: criada.atualizadoEm + 1, aparelho: criada.aparelho },
            },
          ],
        },
        servidor.armazem,
      );
    });
    expect(await sincronizarAqui()).toBe('atualizado');

    expect((await listar('tarefas')).map((t) => t.titulo)).toEqual(['Aula (celular 3)']);
    expect(await listarAvisos()).toMatchObject([
      { perdedora: { titulo: 'Aula (notebook)' }, vencedora: { titulo: 'Aula (celular 3)' } },
    ]);
  });
});

describe('fix 2: avisos de substituidas e pendentes juntos', () => {
  it('se gravar o aviso falha, os pendentes ficam e nenhum aviso fica pela metade', async () => {
    const criada = await tarefaNosDois('Orientação com Renata');
    horario(2);
    no(celular);
    await salvar('tarefas', { ...criada, titulo: 'Orientação (celular)' });
    servidor.aoResponder((acao) => {
      if (acao !== 'puxar') return;
      servidor.aoResponder(undefined);
      enviar(
        {
          mudancas: [
            {
              colecao: 'tarefas',
              registro: { ...criada, titulo: 'Orientação (notebook)', atualizadoEm: AGORA + MINUTO, aparelho: 'outro-aparelho' },
            },
          ],
        },
        servidor.armazem,
      );
    });
    const antes = await listarPendentes();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const original = IDBObjectStore.prototype.add;
    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (
      this: IDBObjectStore,
      valor: unknown,
      chave?: IDBValidKey,
    ) {
      if (this.name === 'avisos') throw new Error('disco cheio');
      return original.call(this, valor, chave);
    });
    horario(3);

    expect(await sincronizarAqui()).not.toBe('atualizado');
    vi.mocked(IDBObjectStore.prototype.add).mockRestore();
    expect(await listarPendentes()).toEqual(antes);
    expect(await listarAvisos()).toEqual([]);
  });

  it('concluirEnvio também deixa só os 200 avisos mais novos', async () => {
    no(notebook);
    for (let i = 0; i < 205; i++) await salvar('tarefas', { id: `t${i}`, ...tarefa(`Local ${i}`) });
    await concluirEnvio(
      Array.from({ length: 205 }, (_, i) => ({
        colecao: 'tarefas',
        registro: { id: `t${i}`, ...tarefa(`Substituída ${i}`), atualizadoEm: AGORA - MINUTO, aparelho: 'outro' },
      })),
      [],
      AGORA,
    );
    const avisos = await listarAvisos();
    expect(avisos).toHaveLength(200);
    expect(avisos[0].registroId).toBe('t5');
    expect(avisos.at(-1)!.registroId).toBe('t204');
  });

  it('concluirEnvio tira os pendentes pedidos e grava os avisos na mesma escrita', async () => {
    no(notebook);
    const a = await salvar('tarefas', { id: 'a', ...tarefa('A') });
    await salvar('tarefas', { id: 'b', ...tarefa('B') });
    const [pa] = await listarPendentes();
    await concluirEnvio(
      [{ colecao: 'tarefas', registro: { ...a, titulo: 'A de outro', atualizadoEm: AGORA - MINUTO, aparelho: 'outro' } }],
      [pa.seq],
      AGORA,
    );
    expect((await listarPendentes()).filter((p) => p.tipo === 'registro').map((p) => p.id)).toEqual(['b']);
    expect(await listarAvisos()).toMatchObject([{ registroId: 'a', perdedora: { titulo: 'A de outro' } }]);
  });
});
