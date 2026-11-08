import { describe, expect, it } from 'vitest';
import { tratar, tratarCorpo, type Ambiente } from '../../script/api';
import {
  NOME_DO_ARQUIVO,
  enviar,
  nomeDaCopia,
  puxar,
  vence,
  type Item,
  type RegistroBase,
} from '../../script/dados';
import { armazemNaMemoria, type ArmazemDeTeste } from '../apoio/armazem';

const CODIGO = 'codigo-ficticio-de-teste-0123456789abcdef';
const T0 = Date.parse('2026-11-05T12:20:00Z');
const MINUTO = 60_000;

function tarefa(id: string, titulo: string, atualizadoEm: number, aparelho = 'notebook'): RegistroBase {
  return { id, titulo, atualizadoEm, aparelho };
}

function item(registro: RegistroBase, colecao = 'tarefas'): Item {
  return { colecao, registro };
}

function ambienteCom(armazem: ArmazemDeTeste): Ambiente {
  return { lerCodigo: () => CODIGO, armazem };
}

function pedir(armazem: ArmazemDeTeste, acao: string, dados: unknown) {
  return tratar({ codigo: CODIGO, acao, dados }, ambienteCom(armazem));
}

describe('nome do arquivo', () => {
  it('é central-dados.json, e as cópias levam o dia no nome', () => {
    expect(NOME_DO_ARQUIVO).toBe('central-dados.json');
    expect(nomeDaCopia('2026-11-05')).toBe('central-dados-2026-11-05.json');
  });
});

describe('vence', () => {
  it('maior atualizadoEm vence', () => {
    expect(vence(tarefa('t', 'b', T0 + 1), tarefa('t', 'a', T0))).toBe(true);
    expect(vence(tarefa('t', 'a', T0), tarefa('t', 'b', T0 + 1))).toBe(false);
  });

  it('empate de hora decide pelo aparelho, igual nos dois lados', () => {
    const a = tarefa('t', 'a', T0, 'aparelho-a');
    const b = tarefa('t', 'b', T0, 'aparelho-b');
    expect(vence(b, a)).toBe(true);
    expect(vence(a, b)).toBe(false);
  });

  it('a mesma versão não vence a si mesma', () => {
    const a = tarefa('t', 'a', T0);
    expect(vence(a, { ...a })).toBe(false);
  });
});

describe('puxar', () => {
  it('sem arquivo no Drive devolve lista vazia e agora 0', () => {
    expect(puxar({ desde: 0 }, armazemNaMemoria())).toEqual({ registros: [], agora: 0 });
  });

  it('devolve o que foi enviado, sem campos internos do servidor', () => {
    const armazem = armazemNaMemoria();
    const registro = tarefa('t1', 'Ler capítulo com Marina', T0);
    enviar({ mudancas: [item(registro)] }, armazem);

    const { registros, agora } = puxar({ desde: 0 }, armazem);

    expect(registros).toEqual([item(registro)]);
    expect(agora).toBeGreaterThan(0);
  });

  it('desde compara o carimbo do servidor, não atualizadoEm (R5)', () => {
    const armazem = armazemNaMemoria();
    enviar({ mudancas: [item(tarefa('t1', 'Nova', T0 + 10 * MINUTO))] }, armazem);
    const { agora } = puxar({ desde: 0 }, armazem);

    // Escrita feita offline horas antes, que só chega agora ao servidor.
    armazem.relogio += MINUTO;
    const antiga = tarefa('t2', 'Feita offline por Renata', T0 - 120 * MINUTO, 'celular');
    enviar({ mudancas: [item(antiga)] }, armazem);

    expect(puxar({ desde: agora }, armazem).registros).toEqual([item(antiga)]);
  });

  it('desde igual ao último agora não devolve nada', () => {
    const armazem = armazemNaMemoria();
    enviar({ mudancas: [item(tarefa('t1', 'a', T0))] }, armazem);
    const { agora } = puxar({ desde: 0 }, armazem);
    expect(puxar({ desde: agora }, armazem)).toEqual({ registros: [], agora });
  });

  it('o carimbo sempre sobe, mesmo com o relógio parado ou voltando', () => {
    const armazem = armazemNaMemoria();
    enviar({ mudancas: [item(tarefa('t1', 'a', T0))] }, armazem);
    const primeiro = puxar({ desde: 0 }, armazem).agora;
    armazem.relogio -= 5 * MINUTO;
    enviar({ mudancas: [item(tarefa('t2', 'b', T0))] }, armazem);

    const depois = puxar({ desde: primeiro }, armazem);
    expect(depois.agora).toBeGreaterThan(primeiro);
    expect(depois.registros.map((r) => r.registro.id)).toEqual(['t2']);
  });

  it('não grava nada', () => {
    const armazem = armazemNaMemoria();
    puxar({ desde: 0 }, armazem);
    expect(armazem.gravacoes).toEqual([]);
  });
});

describe('enviar', () => {
  it('aceita registro novo e grava dentro da trava', () => {
    const armazem = armazemNaMemoria();
    const resposta = enviar({ mudancas: [item(tarefa('t1', 'a', T0))] }, armazem);

    expect(resposta).toEqual({ aceitas: [{ colecao: 'tarefas', id: 't1' }], conflitos: [] });
    expect(armazem.gravacoes).toHaveLength(1);
    expect(armazem.gravacoes[0].naTrava).toBe(true);
  });

  it('versão mais nova substitui; mais velha vira conflito com a versão do servidor', () => {
    const armazem = armazemNaMemoria();
    const nova = tarefa('t1', 'Reunião com Prof. Souza', T0 + MINUTO, 'celular');
    enviar({ mudancas: [item(nova)] }, armazem);

    const velha = tarefa('t1', 'Reunião', T0, 'notebook');
    expect(enviar({ mudancas: [item(velha)] }, armazem)).toEqual({
      aceitas: [],
      conflitos: [item(nova)],
    });
    expect(puxar({ desde: 0 }, armazem).registros).toEqual([item(nova)]);
  });

  it('reenviar a mesma versão é aceito sem mudar o carimbo', () => {
    const armazem = armazemNaMemoria();
    const registro = tarefa('t1', 'a', T0);
    enviar({ mudancas: [item(registro)] }, armazem);
    const { agora } = puxar({ desde: 0 }, armazem);

    armazem.relogio += MINUTO;
    expect(enviar({ mudancas: [item({ ...registro })] }, armazem).aceitas).toEqual([
      { colecao: 'tarefas', id: 't1' },
    ]);
    expect(puxar({ desde: agora }, armazem).registros).toEqual([]);
  });

  it('lápide é aceita e devolvida', () => {
    const armazem = armazemNaMemoria();
    enviar({ mudancas: [item(tarefa('t1', 'a', T0))] }, armazem);
    const lapide = { ...tarefa('t1', 'a', T0 + MINUTO), apagado: true };
    enviar({ mudancas: [item(lapide)] }, armazem);
    expect(puxar({ desde: 0 }, armazem).registros).toEqual([item(lapide)]);
  });

  it('mesmo id em coleções diferentes são registros diferentes', () => {
    const armazem = armazemNaMemoria();
    enviar(
      { mudancas: [item(tarefa('x', 'tarefa', T0)), item(tarefa('x', 'sala', T0), 'salas')] },
      armazem,
    );
    expect(puxar({ desde: 0 }, armazem).registros).toHaveLength(2);
  });

  it('lista vazia não grava', () => {
    const armazem = armazemNaMemoria();
    expect(enviar({ mudancas: [] }, armazem)).toEqual({ aceitas: [], conflitos: [] });
    expect(armazem.gravacoes).toEqual([]);
  });

  it('arquivo corrompido no Drive nunca é sobrescrito', () => {
    const armazem = armazemNaMemoria({ conteudo: '{"versao":1,"registros":[' });
    expect(() => enviar({ mudancas: [item(tarefa('t1', 'a', T0))] }, armazem)).toThrow();
    expect(armazem.gravacoes).toEqual([]);
    expect(armazem.conteudo).toBe('{"versao":1,"registros":[');
  });
});

describe('cópia diária', () => {
  function comArquivo() {
    const armazem = armazemNaMemoria();
    enviar({ mudancas: [item(tarefa('t1', 'a', T0))] }, armazem);
    return armazem;
  }

  it('a primeira escrita do dia copia o arquivo como estava antes', () => {
    const armazem = comArquivo();
    armazem.marcada = '2026-11-04';
    const antes = armazem.conteudo;

    enviar({ mudancas: [item(tarefa('t2', 'b', T0))] }, armazem);

    expect([...armazem.copias.values()]).toEqual([
      { nome: 'central-dados-2026-11-05.json', conteudo: antes },
    ]);
    expect(armazem.marcada).toBe('2026-11-05');
  });

  it('só uma cópia por dia', () => {
    const armazem = comArquivo();
    enviar({ mudancas: [item(tarefa('t2', 'b', T0))] }, armazem);
    enviar({ mudancas: [item(tarefa('t3', 'c', T0))] }, armazem);
    expect(armazem.copias.size).toBe(1);
  });

  it('sem arquivo ainda não há o que copiar', () => {
    const armazem = armazemNaMemoria();
    enviar({ mudancas: [item(tarefa('t1', 'a', T0))] }, armazem);
    expect(armazem.copias.size).toBe(0);
  });

  it('guarda 30 dias: descarta só cópias mais antigas e nada além das cópias', () => {
    const armazem = comArquivo();
    armazem.copias.set('velha', { nome: 'central-dados-2026-10-05.json', conteudo: '' });
    armazem.copias.set('limite', { nome: 'central-dados-2026-10-06.json', conteudo: '' });
    armazem.copias.set('outro', { nome: 'notas-da-Aurora.json', conteudo: '' });
    armazem.copias.set('principal', { nome: 'central-dados.json', conteudo: '' });

    enviar({ mudancas: [item(tarefa('t2', 'b', T0))] }, armazem);

    const nomes = [...armazem.copias.values()].map((c) => c.nome).sort();
    expect(nomes).toEqual([
      'central-dados-2026-10-06.json',
      'central-dados-2026-11-05.json',
      'central-dados.json',
      'notas-da-Aurora.json',
    ]);
  });
});

describe('ações pelo tratar', () => {
  it('puxar e enviar respondem com ok', () => {
    const armazem = armazemNaMemoria();
    const registro = tarefa('t1', 'Aula da Aurora', T0);
    expect(pedir(armazem, 'enviar', { mudancas: [item(registro)] })).toEqual({
      ok: true,
      dados: { aceitas: [{ colecao: 'tarefas', id: 't1' }], conflitos: [] },
    });
    expect(pedir(armazem, 'puxar', { desde: 0 })).toMatchObject({
      ok: true,
      dados: { registros: [item(registro)] },
    });
  });

  it('trava ocupada responde ocupado e não grava', () => {
    const armazem = armazemNaMemoria({ ocupado: true });
    expect(pedir(armazem, 'enviar', { mudancas: [item(tarefa('t1', 'a', T0))] })).toEqual({
      ok: false,
      erro: 'ocupado',
    });
    expect(armazem.gravacoes).toEqual([]);
  });

  it('sem código certo não lê nem grava o Drive', () => {
    const armazem = armazemNaMemoria();
    let lido = false;
    armazem.ler = () => {
      lido = true;
      return null;
    };
    const resposta = tratar(
      { codigo: 'outro', acao: 'enviar', dados: { mudancas: [item(tarefa('t1', 'a', T0))] } },
      ambienteCom(armazem),
    );
    expect(resposta).toEqual({ ok: false, erro: 'codigo-invalido' });
    expect(lido).toBe(false);
    expect(armazem.gravacoes).toEqual([]);
  });

  it.each([
    ['puxar sem dados', 'puxar', undefined],
    ['desde texto', 'puxar', { desde: '0' }],
    ['desde negativo', 'puxar', { desde: -1 }],
    ['desde infinito', 'puxar', { desde: Number.POSITIVE_INFINITY }],
    ['mudancas ausente', 'enviar', {}],
    ['mudancas não é lista', 'enviar', { mudancas: { 0: 1 } }],
    ['mudança nula', 'enviar', { mudancas: [null] }],
    ['registro sem id', 'enviar', { mudancas: [{ colecao: 'tarefas', registro: { atualizadoEm: 1, aparelho: 'a' } }] }],
    ['id vazio', 'enviar', { mudancas: [item(tarefa('', 'a', T0))] }],
    ['id gigante', 'enviar', { mudancas: [item(tarefa('x'.repeat(201), 'a', T0))] }],
    ['atualizadoEm texto', 'enviar', { mudancas: [{ colecao: 'tarefas', registro: { id: 't', atualizadoEm: '1', aparelho: 'a' } }] }],
    ['atualizadoEm negativo', 'enviar', { mudancas: [item(tarefa('t', 'a', -1))] }],
    ['aparelho ausente', 'enviar', { mudancas: [{ colecao: 'tarefas', registro: { id: 't', atualizadoEm: 1 } }] }],
    ['registro lista', 'enviar', { mudancas: [{ colecao: 'tarefas', registro: [] }] }],
    ['coleção __proto__', 'enviar', { mudancas: [item(tarefa('t', 'a', T0), '__proto__')] }],
    ['coleção com barra', 'enviar', { mudancas: [item(tarefa('t', 'a', T0), 'a/b')] }],
    ['coleção vazia', 'enviar', { mudancas: [item(tarefa('t', 'a', T0), '')] }],
  ])('pedido malformado (%s) responde interno sem gravar', (_nome, acao, dados) => {
    const armazem = armazemNaMemoria();
    expect(pedir(armazem, acao, dados)).toStrictEqual({ ok: false, erro: 'interno' });
    expect(armazem.gravacoes).toEqual([]);
  });

  it('um item malformado recusa o pedido inteiro, sem gravar os bons', () => {
    const armazem = armazemNaMemoria();
    const resposta = pedir(armazem, 'enviar', {
      mudancas: [item(tarefa('t1', 'a', T0)), item(tarefa('', 'b', T0))],
    });
    expect(resposta).toEqual({ ok: false, erro: 'interno' });
    expect(armazem.gravacoes).toEqual([]);
  });

  it('id __proto__ não contamina nada e volta igual', () => {
    const armazem = armazemNaMemoria();
    const registro = tarefa('__proto__', 'a', T0);
    pedir(armazem, 'enviar', { mudancas: [item(registro), item(tarefa('constructor', 'b', T0))] });
    const resposta = pedir(armazem, 'puxar', { desde: 0 }) as { dados: { registros: Item[] } };
    expect(resposta.dados.registros.map((r) => r.registro.id).sort()).toEqual([
      '__proto__',
      'constructor',
    ]);
    expect(({} as Record<string, unknown>).titulo).toBeUndefined();
  });
});

describe('tratarCorpo e tamanho', () => {
  it('corpo acima de 256 KB é recusado antes de ler o código', () => {
    let leuCodigo = false;
    const armazem = armazemNaMemoria();
    const ambiente: Ambiente = {
      lerCodigo: () => {
        leuCodigo = true;
        return CODIGO;
      },
      armazem,
    };
    const corpo = JSON.stringify({ codigo: CODIGO, acao: 'ping', dados: { x: 'a'.repeat(256 * 1024) } });

    expect(tratarCorpo(corpo, ambiente)).toStrictEqual({ ok: false, erro: 'interno' });
    expect(leuCodigo).toBe(false);
  });

  it('corpo logo abaixo do limite é atendido', () => {
    const base = JSON.stringify({ codigo: CODIGO, acao: 'ping', dados: { x: '' } });
    const corpo = JSON.stringify({
      codigo: CODIGO,
      acao: 'ping',
      dados: { x: 'a'.repeat(256 * 1024 - base.length) },
    });
    expect(corpo.length).toBe(256 * 1024);
    expect(tratarCorpo(corpo, ambienteCom(armazemNaMemoria())).ok).toBe(true);
  });
});
