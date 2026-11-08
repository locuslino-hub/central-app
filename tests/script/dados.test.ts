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
  return { id, titulo, salaId: null, atualizadoEm, aparelho };
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

    expect(resposta).toEqual({
      aceitas: [{ colecao: 'tarefas', id: 't1' }],
      conflitos: [],
      recusadas: [],
      substituidas: [],
      agora: expect.any(Number),
    });
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
      recusadas: [],
      substituidas: [],
      agora: expect.any(Number),
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
      {
        mudancas: [
          item(tarefa('x', 'tarefa', T0)),
          item({ id: 'x', nome: 'Sala', ordem: 0, atualizadoEm: T0, aparelho: 'notebook' }, 'salas'),
        ],
      },
      armazem,
    );
    expect(puxar({ desde: 0 }, armazem).registros).toHaveLength(2);
  });

  it('lista vazia não grava', () => {
    const armazem = armazemNaMemoria();
    expect(enviar({ mudancas: [] }, armazem)).toEqual({
      aceitas: [],
      conflitos: [],
      recusadas: [],
      substituidas: [],
      agora: expect.any(Number),
    });
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
      dados: { aceitas: [{ colecao: 'tarefas', id: 't1' }], conflitos: [], recusadas: [], substituidas: [], agora: expect.any(Number) },
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
    ['registro lista', 'enviar', { mudancas: [{ colecao: 'tarefas', registro: [] }] }],
    ['desde de enviar texto', 'enviar', { mudancas: [], desde: '5' }],
    ['desde de enviar negativo', 'enviar', { mudancas: [], desde: -1 }],
  ])('pedido malformado (%s) responde interno sem gravar', (_nome, acao, dados) => {
    const armazem = armazemNaMemoria();
    expect(pedir(armazem, acao, dados)).toStrictEqual({ ok: false, erro: 'interno' });
    expect(armazem.gravacoes).toEqual([]);
  });

  it.each([
    ['registro sem id', { colecao: 'tarefas', registro: { titulo: 'a', salaId: null, atualizadoEm: 1, aparelho: 'a' } }],
    ['id vazio', item(tarefa('', 'a', T0))],
    ['id com 65 caracteres', item(tarefa('x'.repeat(65), 'a', T0))],
    ['id com espaço', item(tarefa('id com espaço', 'a', T0))],
    ['id com barra', item(tarefa('a/b', 'a', T0))],
    ['aparelho com ponto', item(tarefa('t', 'a', T0, 'note.book'))],
    ['aparelho ausente', { colecao: 'tarefas', registro: { id: 't', titulo: 'a', salaId: null, atualizadoEm: 1 } }],
    ['atualizadoEm texto', { colecao: 'tarefas', registro: { ...tarefa('t', 'a', T0), atualizadoEm: '1' } }],
    ['atualizadoEm negativo', item(tarefa('t', 'a', -1))],
    ['atualizadoEm mais de 10 min no futuro', item(tarefa('t', 'a', T0 + 10 * MINUTO + 1))],
    ['coleção __proto__', item(tarefa('t', 'a', T0), '__proto__')],
    ['coleção constructor', item(tarefa('t', 'a', T0), 'constructor')],
    ['coleção toString', item(tarefa('t', 'a', T0), 'toString')],
    ['coleção desconhecida', item(tarefa('t', 'a', T0), 'naoExiste')],
    ['coleção avisos (só local)', item(tarefa('t', 'a', T0), 'avisos')],
    ['coleção vazia', item(tarefa('t', 'a', T0), '')],
    ['tarefa sem titulo', { colecao: 'tarefas', registro: { id: 't', salaId: null, atualizadoEm: T0, aparelho: 'a' } }],
    ['titulo número', { colecao: 'tarefas', registro: { ...tarefa('t', 'a', T0), titulo: 5 } }],
    ['salaId ausente na tarefa', { colecao: 'tarefas', registro: { id: 't', titulo: 'a', atualizadoEm: T0, aparelho: 'a' } }],
    ['apagado texto', { colecao: 'tarefas', registro: { ...tarefa('t', 'a', T0), apagado: 'sim' } }],
    ['palavra com salaId nulo', { colecao: 'palavras', registro: { id: 'p', termo: 'tese', salaId: null, atualizadoEm: T0, aparelho: 'a' } }],
    ['sala sem nome', { colecao: 'salas', registro: { id: 's', ordem: 0, atualizadoEm: T0, aparelho: 'a' } }],
    ['documento com url javascript', { colecao: 'documentos', registro: { id: 'd', titulo: 'Plano', url: 'javascript:alert(1)', arquivado: false, atualizadoEm: T0, aparelho: 'a' } }],
    ['documento com url sem esquema', { colecao: 'documentos', registro: { id: 'd', titulo: 'Plano', url: 'exemplo.invalid/x', arquivado: false, atualizadoEm: T0, aparelho: 'a' } }],
    ['config sem fimDoDia', { colecao: 'config', registro: { id: 'geral', atualizadoEm: T0, aparelho: 'a' } }],
  ])('item inválido (%s) vai para recusadas e nada é gravado', (_nome, mudanca) => {
    const armazem = armazemNaMemoria();
    const resposta = pedir(armazem, 'enviar', { mudancas: [mudanca] }) as {
      ok: boolean;
      dados: { aceitas: unknown[]; recusadas: unknown[] };
    };
    expect(resposta.ok).toBe(true);
    expect(resposta.dados.aceitas).toEqual([]);
    const { colecao, registro } = mudanca as { colecao: unknown; registro: { id?: unknown } };
    if (typeof colecao === 'string' && typeof registro.id === 'string') {
      expect(resposta.dados.recusadas).toEqual([{ colecao, id: registro.id }]);
    }
    expect(armazem.gravacoes).toEqual([]);
  });

  it.each([
    ['tarefa com prazo e sala', item({ ...tarefa('t', 'a', T0), salaId: 'sala-aulas', data: '2026-11-05' })],
    ['atualizadoEm exatamente 10 min no futuro', item(tarefa('t', 'a', T0 + 10 * MINUTO))],
    ['lápide', item({ ...tarefa('t', 'a', T0), apagado: true })],
    ['documento https', { colecao: 'documentos', registro: { id: 'd', titulo: 'Plano', url: 'https://exemplo.invalid/plano', arquivado: false, atualizadoEm: T0, aparelho: 'a' } }],
    ['documento http', { colecao: 'documentos', registro: { id: 'd', titulo: 'Plano', url: 'HTTP://exemplo.invalid/plano', arquivado: false, atualizadoEm: T0, aparelho: 'a' } }],
    ['sala semeada', { colecao: 'salas', registro: { id: 'sala-mba', nome: 'MBA', ordem: 4, atualizadoEm: 0, aparelho: 'semente' } }],
    ['config', { colecao: 'config', registro: { id: 'geral', fimDoDia: '21:00', atualizadoEm: T0, aparelho: 'a' } }],
    ['rascunho sem sala', { colecao: 'rascunhos', registro: { id: 'r', texto: '', atualizadoEm: T0, aparelho: 'a' } }],
    ['id de UUID', item(tarefa('0b6f6a8e-3c1d-4c55-9a51-2f7c1d2e3f40', 'a', T0, '9d1c2b3a-0000-4000-8000-000000000000'))],
  ])('item válido (%s) é aceito', (_nome, mudanca) => {
    const armazem = armazemNaMemoria();
    const resposta = pedir(armazem, 'enviar', { mudancas: [mudanca] }) as {
      dados: { aceitas: unknown[]; recusadas: unknown[] };
    };
    expect(resposta.dados.recusadas).toEqual([]);
    expect(resposta.dados.aceitas).toHaveLength(1);
  });

  it('um item recusado não impede os outros', () => {
    const armazem = armazemNaMemoria();
    const resposta = pedir(armazem, 'enviar', {
      mudancas: [item(tarefa('t1', 'a', T0)), item(tarefa('mal formado', 'b', T0))],
    });
    expect(resposta).toEqual({
      ok: true,
      dados: {
        aceitas: [{ colecao: 'tarefas', id: 't1' }],
        conflitos: [],
        recusadas: [{ colecao: 'tarefas', id: 'mal formado' }],
        substituidas: [],
        agora: expect.any(Number),
      },
    });
    expect(puxar({ desde: 0 }, armazem).registros).toEqual([item(tarefa('t1', 'a', T0))]);
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

describe('limites do arquivo', () => {
  function arquivoCom(registros: { colecao: string; recebidoEm: number; registro: RegistroBase }[]) {
    return JSON.stringify({ versao: 1, ultimo: 1, registros });
  }

  it('com 50 000 registros, registro novo é recusado com interno e nada é gravado', () => {
    const cheios = Array.from({ length: 50_000 }, (_, i) => ({
      colecao: 'tarefas',
      recebidoEm: 1,
      registro: tarefa(`t${i}`, '', 1),
    }));
    const armazem = armazemNaMemoria({ conteudo: arquivoCom(cheios) });

    expect(pedir(armazem, 'enviar', { mudancas: [item(tarefa('nova', 'a', T0))] })).toEqual({
      ok: false,
      erro: 'interno',
    });
    expect(armazem.gravacoes).toEqual([]);
    expect(armazem.copias.size).toBe(0);
  });

  it('com 50 000 registros, atualizar um existente ainda é aceito', () => {
    const cheios = Array.from({ length: 50_000 }, (_, i) => ({
      colecao: 'tarefas',
      recebidoEm: 1,
      registro: tarefa(`t${i}`, '', 1),
    }));
    const armazem = armazemNaMemoria({ conteudo: arquivoCom(cheios) });
    expect(pedir(armazem, 'enviar', { mudancas: [item(tarefa('t7', 'nova', T0))] }).ok).toBe(true);
    expect(armazem.gravacoes).toHaveLength(1);
  });

  it('arquivo que passaria de 10 MB é recusado com interno e nada é gravado', () => {
    const grande = { colecao: 'tarefas', recebidoEm: 1, registro: tarefa('g', 'x'.repeat(10 * 1024 * 1024), 1) };
    const armazem = armazemNaMemoria({ conteudo: arquivoCom([grande]) });

    expect(pedir(armazem, 'enviar', { mudancas: [item(tarefa('nova', 'a', T0))] })).toEqual({
      ok: false,
      erro: 'interno',
    });
    expect(armazem.gravacoes).toEqual([]);
  });
});

describe('leitura única por envio', () => {
  it('enviar lê o arquivo do Drive uma vez só', () => {
    const armazem = armazemNaMemoria();
    enviar({ mudancas: [item(tarefa('t1', 'a', T0))] }, armazem);
    let leituras = 0;
    const ler = armazem.ler.bind(armazem);
    armazem.ler = () => {
      leituras += 1;
      return ler();
    };
    enviar({ mudancas: [item(tarefa('t2', 'b', T0))] }, armazem);
    expect(leituras).toBe(1);
  });
});

describe('cópia diária idempotente', () => {
  it('se a cópia do dia já existe (marca perdida), não copia de novo e marca o dia', () => {
    const armazem = armazemNaMemoria();
    enviar({ mudancas: [item(tarefa('t1', 'a', T0))] }, armazem);
    armazem.copias.set('ja-feita', { nome: 'central-dados-2026-11-05.json', conteudo: 'antes' });
    armazem.marcada = null;

    enviar({ mudancas: [item(tarefa('t2', 'b', T0))] }, armazem);

    expect([...armazem.copias.values()]).toEqual([{ nome: 'central-dados-2026-11-05.json', conteudo: 'antes' }]);
    expect(armazem.marcada).toBe('2026-11-05');
  });

  it('marca o dia logo depois de copiar, antes da limpeza de cópias velhas', () => {
    const armazem = armazemNaMemoria();
    enviar({ mudancas: [item(tarefa('t1', 'a', T0))] }, armazem);
    armazem.copias.set('velha', { nome: 'central-dados-2026-09-01.json', conteudo: '' });
    armazem.descartar = () => {
      throw new Error('Drive fora do ar');
    };

    expect(() => enviar({ mudancas: [item(tarefa('t2', 'b', T0))] }, armazem)).toThrow();
    expect(armazem.marcada).toBe('2026-11-05');
  });
});

describe('substituidas (corrida entre puxar e enviar)', () => {
  function servidorCom(registro: RegistroBase) {
    const armazem = armazemNaMemoria();
    enviar({ mudancas: [item(registro)] }, armazem);
    return armazem;
  }

  it('versão de outro aparelho recebida depois do desde do cliente volta em substituidas', () => {
    const armazem = armazemNaMemoria();
    const { agora: desde } = puxar({ desde: 0 }, armazem);
    armazem.relogio += MINUTO;
    const doCelular = tarefa('t1', 'celular', T0 + MINUTO, 'celular');
    enviar({ mudancas: [item(doCelular)] }, armazem);

    const resposta = enviar({ desde, mudancas: [item(tarefa('t1', 'notebook', T0 + 2 * MINUTO))] }, armazem);
    expect(resposta.aceitas).toEqual([{ colecao: 'tarefas', id: 't1' }]);
    expect(resposta.substituidas).toEqual([item(doCelular)]);
  });

  it('versão que o cliente já tinha visto (recebida até o desde) não volta', () => {
    const armazem = servidorCom(tarefa('t1', 'celular', T0, 'celular'));
    const { agora: desde } = puxar({ desde: 0 }, armazem);
    const resposta = enviar({ desde, mudancas: [item(tarefa('t1', 'notebook', T0 + MINUTO))] }, armazem);
    expect(resposta.substituidas).toEqual([]);
  });

  it('versão do mesmo aparelho não volta', () => {
    const armazem = servidorCom(tarefa('t1', 'primeira', T0));
    const resposta = enviar({ desde: 0, mudancas: [item(tarefa('t1', 'segunda', T0 + MINUTO))] }, armazem);
    expect(resposta.substituidas).toEqual([]);
  });

  it('sem desde, nada volta em substituidas', () => {
    const armazem = servidorCom(tarefa('t1', 'celular', T0, 'celular'));
    const resposta = enviar({ mudancas: [item(tarefa('t1', 'notebook', T0 + MINUTO))] }, armazem);
    expect(resposta.substituidas).toEqual([]);
  });
});

describe('fix 2: enviar devolve o relógio do servidor', () => {
  it('agora de enviar é o relógio do servidor e nunca menor que o maior carimbo', () => {
    const armazem = armazemNaMemoria();
    enviar({ mudancas: [item(tarefa('t1', 'a', T0))] }, armazem);
    const { agora: ultimo } = puxar({ desde: 0 }, armazem);
    armazem.relogio -= 5 * MINUTO;

    const resposta = enviar({ mudancas: [item(tarefa('t2', 'b', T0))] }, armazem);
    expect(resposta.agora).toBeGreaterThanOrEqual(ultimo + 1);
    armazem.relogio += 60 * MINUTO;
    expect(enviar({ mudancas: [item(tarefa('t3', 'c', T0))] }, armazem).agora).toBe(armazem.relogio);
  });

  it('sem nada válido para gravar, agora é o relógio do servidor', () => {
    const armazem = armazemNaMemoria();
    expect(enviar({ mudancas: [] }, armazem).agora).toBe(armazem.relogio);
  });
});
