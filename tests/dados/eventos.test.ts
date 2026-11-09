import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErroConexao, ErroScript } from '../../src/conexao/cliente';
import { ErroAgenda, type Evento, type RespostaEventos } from '../../src/dados/agenda';
import {
  assinarEventos,
  atualizarEventos,
  esquecerEventos,
  lerEventos,
  type Dependencias,
} from '../../src/dados/eventos';

const evento = (titulo: string): Evento => ({
  id: titulo,
  agendaId: 'primary',
  titulo,
  inicio: '2026-11-05T09:00:00+00:00',
  fim: '2026-11-05T10:00:00+00:00',
  diaInteiro: false,
  livre: false,
  recusado: false,
  salaId: null,
  link: null,
});

const resposta = (titulos: string[], incompleto = false): RespostaEventos => ({ eventos: titulos.map(evento), incompleto });

/** Dependências de teste: tudo na memória, com os pedidos anotados. */
function dependencias(extra: Partial<Dependencias> = {}) {
  const pedidos: { de: string; ate: string }[] = [];
  let relogio = 1_000;
  const dep: Dependencias = {
    conectado: async () => true,
    listar: async (periodo) => {
      pedidos.push(periodo);
      return resposta(['Aula']);
    },
    pingar: vi.fn(async () => ({})),
    agora: () => relogio,
    ...extra,
  };
  return { dep, pedidos, passar: (ms: number) => (relogio += ms) };
}

beforeEach(() => esquecerEventos());

describe('leitura inicial', () => {
  it('sem nada lido, a leitura está vazia, sem falha e sem carregar', () => {
    expect(lerEventos('2026-11-02', '2026-11-08')).toEqual({
      eventos: [],
      incompleto: false,
      falha: null,
      lidoEm: null,
      tentadoEm: null,
      carregando: false,
    });
  });
});

describe('atualizarEventos', () => {
  it('lê o período, guarda na memória e marca a hora da leitura', async () => {
    const { dep, pedidos } = dependencias();
    const leitura = await atualizarEventos('2026-11-02', '2026-11-08', dep);
    expect(pedidos).toEqual([{ de: '2026-11-02', ate: '2026-11-08' }]);
    expect(leitura).toMatchObject({ falha: null, carregando: false, lidoEm: 1_000, tentadoEm: 1_000, incompleto: false });
    expect(leitura.eventos.map((e) => e.titulo)).toEqual(['Aula']);
    expect(lerEventos('2026-11-02', '2026-11-08')).toBe(leitura);
  });

  it('cada período tem a sua leitura', async () => {
    const { dep } = dependencias();
    await atualizarEventos('2026-11-02', '2026-11-08', dep);
    expect(lerEventos('2026-11-09', '2026-11-15').lidoEm).toBeNull();
  });

  it('dois pedidos juntos para o mesmo período viram uma chamada só', async () => {
    let chamadas = 0;
    let liberar!: () => void;
    const { dep } = dependencias({
      listar: () => {
        chamadas++;
        return new Promise((resolver) => {
          liberar = () => resolver(resposta(['Aula']));
        });
      },
    });
    const a = atualizarEventos('2026-11-05', '2026-11-05', dep);
    const b = atualizarEventos('2026-11-05', '2026-11-05', dep);
    expect(lerEventos('2026-11-05', '2026-11-05').carregando).toBe(true);
    await vi.waitFor(() => expect(chamadas).toBe(1));
    liberar();
    const [x, y] = await Promise.all([a, b]);
    expect(chamadas).toBe(1);
    expect(x).toBe(y);
    expect(lerEventos('2026-11-05', '2026-11-05').carregando).toBe(false);
  });

  it('repassa "algumas agendas não carregaram"', async () => {
    const { dep } = dependencias({ listar: async () => resposta(['Aula'], true) });
    expect((await atualizarEventos('2026-11-05', '2026-11-05', dep)).incompleto).toBe(true);
  });

  it('a próxima leitura boa limpa a falha e o aviso', async () => {
    let vez = 0;
    const { dep } = dependencias({
      listar: async () => {
        vez++;
        if (vez === 1) throw new ErroAgenda('falhou');
        return resposta(['Aula']);
      },
    });
    expect((await atualizarEventos('2026-11-05', '2026-11-05', dep)).falha).toBe('falhou');
    const leitura = await atualizarEventos('2026-11-05', '2026-11-05', dep);
    expect(leitura).toMatchObject({ falha: null, incompleto: false });
    expect(leitura.eventos).toHaveLength(1);
  });

  it('quem ouve é avisado ao começar e ao terminar, e para de ser avisado ao sair', async () => {
    const { dep } = dependencias();
    const vistos: boolean[] = [];
    const parar = assinarEventos(() => vistos.push(lerEventos('2026-11-05', '2026-11-05').carregando));
    await atualizarEventos('2026-11-05', '2026-11-05', dep);
    expect(vistos).toEqual([true, false]);
    parar();
    await atualizarEventos('2026-11-05', '2026-11-05', dep);
    expect(vistos).toHaveLength(2);
  });

  it('guarda só as últimas leituras: períodos antigos saem da memória', async () => {
    const { dep } = dependencias();
    const ate = (i: number) => new Date(Date.UTC(2026, 0, i)).toISOString().slice(0, 10);
    for (let i = 1; i <= 40; i++) await atualizarEventos('2026-01-01', ate(i), dep);
    expect(lerEventos('2026-01-01', ate(1)).lidoEm).toBeNull();
    expect(lerEventos('2026-01-01', ate(40)).lidoEm).not.toBeNull();
  });
});

describe('quando falha', () => {
  const periodo = ['2026-11-05', '2026-11-05'] as const;
  const falhando = (erro: unknown, extra: Partial<Dependencias> = {}) =>
    dependencias({
      listar: async () => {
        throw erro;
      },
      ...extra,
    });

  it('mantém o que já estava na tela e diz que não carregou', async () => {
    let vez = 0;
    const { dep } = dependencias({
      listar: async () => {
        if (vez++ === 0) return resposta(['Aula'], true);
        throw new ErroAgenda('sem-internet');
      },
    });
    await atualizarEventos(...periodo, dep);
    const leitura = await atualizarEventos(...periodo, dep);
    expect(leitura.falha).toBe('sem-internet');
    expect(leitura.eventos.map((e) => e.titulo)).toEqual(['Aula']);
    expect(leitura.incompleto).toBe(true);
    expect(leitura.lidoEm).toBe(1_000);
    expect(leitura.carregando).toBe(false);
  });

  it('sem internet', async () => {
    const { dep } = falhando(new ErroAgenda('sem-internet'));
    expect((await atualizarEventos(...periodo, dep)).falha).toBe('sem-internet');
  });

  it('o script ou o Google recusou: falhou', async () => {
    const { dep } = falhando(new ErroAgenda('falhou'));
    expect((await atualizarEventos(...periodo, dep)).falha).toBe('falhou');
  });

  it('erro que não é da agenda também vira falhou, sem estourar', async () => {
    const { dep } = falhando(new TypeError('x'));
    expect((await atualizarEventos(...periodo, dep)).falha).toBe('falhou');
  });

  it('aparelho sem conexão guardada: não conectado, sem chamar o script', async () => {
    const { dep, pedidos } = dependencias({ conectado: async () => false });
    const leitura = await atualizarEventos(...periodo, dep);
    expect(leitura.falha).toBe('nao-conectado');
    expect(pedidos).toEqual([]);
    expect(dep.pingar).not.toHaveBeenCalled();
  });

  it('código inválido: antes de falar em reconectar, testa o ping', async () => {
    const { dep } = falhando(new ErroAgenda('codigo-invalido'));
    await atualizarEventos(...periodo, dep);
    expect(dep.pingar).toHaveBeenCalledTimes(1);
  });

  it('código inválido e ping funcionando: o código vale, falta liberar a agenda no script', async () => {
    const { dep } = falhando(new ErroAgenda('codigo-invalido'));
    expect((await atualizarEventos(...periodo, dep)).falha).toBe('nao-liberada');
  });

  it('código inválido e o ping também recusa o código: aí sim, reconectar', async () => {
    const { dep } = falhando(new ErroAgenda('codigo-invalido'), {
      pingar: async () => {
        throw new ErroScript('codigo-invalido');
      },
    });
    expect((await atualizarEventos(...periodo, dep)).falha).toBe('codigo');
  });

  it('código inválido e o ping não chega: sem internet, não é o código', async () => {
    const { dep } = falhando(new ErroAgenda('codigo-invalido'), {
      pingar: async () => {
        throw new ErroConexao();
      },
    });
    expect((await atualizarEventos(...periodo, dep)).falha).toBe('sem-internet');
  });

  it('código inválido e o ping dá outro erro: falhou', async () => {
    const { dep } = falhando(new ErroAgenda('codigo-invalido'), {
      pingar: async () => {
        throw new ErroScript('interno');
      },
    });
    expect((await atualizarEventos(...periodo, dep)).falha).toBe('falhou');
  });

  it('o ping só roda quando o erro é de código inválido', async () => {
    for (const erro of [new ErroAgenda('sem-internet'), new ErroAgenda('falhou'), new ErroAgenda('invalido')]) {
      esquecerEventos();
      const { dep } = falhando(erro);
      await atualizarEventos(...periodo, dep);
      expect(dep.pingar, erro.falha).not.toHaveBeenCalled();
    }
  });
});

describe('só na memória', () => {
  it('não cria banco no navegador: os eventos nunca vão ao Drive nem à exportação', async () => {
    const antes = (await indexedDB.databases()).map((b) => b.name).sort();
    const { dep } = dependencias();
    await atualizarEventos('2026-11-05', '2026-11-05', dep);
    expect((await indexedDB.databases()).map((b) => b.name).sort()).toEqual(antes);
  });

  it('uma leitura que termina depois de esquecer não volta para a memória', async () => {
    let liberar!: () => void;
    const { dep } = dependencias({
      listar: () => new Promise((resolver) => (liberar = () => resolver(resposta(['Aula'])))),
    });
    const andando = atualizarEventos('2026-11-05', '2026-11-05', dep);
    await vi.waitFor(() => expect(liberar).toBeTypeOf('function'));
    esquecerEventos();
    liberar();
    await andando;
    expect(lerEventos('2026-11-05', '2026-11-05').lidoEm).toBeNull();
  });

  it('esquecer apaga tudo', async () => {
    const { dep } = dependencias();
    await atualizarEventos('2026-11-05', '2026-11-05', dep);
    esquecerEventos();
    expect(lerEventos('2026-11-05', '2026-11-05').lidoEm).toBeNull();
  });
});
