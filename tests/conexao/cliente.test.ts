import { describe, expect, it, vi } from 'vitest';
import { chamar, ErroConexao, ErroScript, ping } from '../../src/conexao/cliente';
import { salvarConexao } from '../../src/conexao/guarda';

const URL_FICTICIA = 'https://script.google.com/macros/s/ID-FICTICIO/exec';
const CODIGO = 'codigo-ficticio-de-teste-0123456789abcdef';
const CONEXAO = { url: URL_FICTICIA, codigo: CODIGO };

function respondeCom(corpo: string) {
  const falso = vi.fn(async (_url: string, _opcoes: RequestInit) => new Response(corpo));
  vi.stubGlobal('fetch', falso);
  return falso;
}

/** Como o fetch real: fica pendente até o sinal de abortar disparar. */
function ficaPendente() {
  const falso = vi.fn(
    (_url: string, opcoes: RequestInit) =>
      new Promise<Response>((_resolver, rejeitar) => {
        opcoes.signal?.addEventListener('abort', () =>
          rejeitar(new DOMException('abortado', 'AbortError')),
        );
      }),
  );
  vi.stubGlobal('fetch', falso);
  return falso;
}

describe('chamar', () => {
  it('faz POST no endereço salvo com código, ação e dados', async () => {
    await salvarConexao(CONEXAO);
    const falso = respondeCom('{"ok":true,"dados":{}}');
    await chamar('fazer-algo', { nome: 'Marina' });
    const [url, opcoes] = falso.mock.calls[0];
    expect(url).toBe(URL_FICTICIA);
    expect(opcoes.method).toBe('POST');
    expect(JSON.parse(opcoes.body as string)).toEqual({
      codigo: CODIGO,
      acao: 'fazer-algo',
      dados: { nome: 'Marina' },
    });
  });

  it('sem dados, manda objeto vazio', async () => {
    await salvarConexao(CONEXAO);
    const falso = respondeCom('{"ok":true,"dados":{}}');
    await chamar('ping');
    expect(JSON.parse(falso.mock.calls[0][1].body as string).dados).toEqual({});
  });

  it('usa só o cabeçalho que não dispara preflight e segue o redirecionamento', async () => {
    await salvarConexao(CONEXAO);
    const falso = respondeCom('{"ok":true,"dados":{}}');
    await chamar('ping');
    const opcoes = falso.mock.calls[0][1];
    expect(opcoes.headers).toEqual({ 'Content-Type': 'text/plain;charset=utf-8' });
    expect(opcoes.redirect).toBe('follow');
  });

  it('devolve os dados da resposta', async () => {
    await salvarConexao(CONEXAO);
    respondeCom('{"ok":true,"dados":{"nome":"Renata"}}');
    await expect(chamar<{ nome: string }>('ping')).resolves.toEqual({ nome: 'Renata' });
  });

  it('sem conexão salva lança ErroConexao e não usa a rede', async () => {
    const falso = respondeCom('{"ok":true,"dados":{}}');
    await expect(chamar('ping')).rejects.toBeInstanceOf(ErroConexao);
    expect(falso).not.toHaveBeenCalled();
  });

  it('banco indisponível também vira ErroConexao', async () => {
    vi.stubGlobal('indexedDB', undefined);
    await expect(chamar('ping')).rejects.toBeInstanceOf(ErroConexao);
  });

  it('falha de rede lança ErroConexao', async () => {
    await salvarConexao(CONEXAO);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(chamar('ping')).rejects.toBeInstanceOf(ErroConexao);
  });

  it('a mensagem do erro nunca traz o código', async () => {
    await salvarConexao(CONEXAO);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError(`falhou ${CODIGO}`)));
    const erro = await chamar('ping').catch((e: Error) => e);
    expect(String((erro as Error).message)).not.toContain(CODIGO);
  });

  it('página HTML em vez de JSON lança ErroConexao', async () => {
    await salvarConexao(CONEXAO);
    respondeCom('<!doctype html><title>Erro</title>');
    await expect(chamar('ping')).rejects.toBeInstanceOf(ErroConexao);
  });

  it.each([
    ['nulo', 'null'],
    ['lista', '[]'],
    ['sem ok', '{}'],
    ['ok que não é booleano', '{"ok":"sim"}'],
    ['erro desconhecido', '{"ok":false,"erro":"outra-coisa"}'],
    ['ok falso sem erro', '{"ok":false}'],
  ])('JSON fora do combinado lança ErroConexao: %s', async (_nome, corpo) => {
    await salvarConexao(CONEXAO);
    respondeCom(corpo);
    await expect(chamar('ping')).rejects.toBeInstanceOf(ErroConexao);
  });

  it('ok sem dados é resposta inválida: lança ErroConexao com motivo claro, não devolve undefined', async () => {
    await salvarConexao(CONEXAO);
    respondeCom('{"ok":true}');
    const lancado = await chamar('puxar').catch((e: unknown) => e);
    expect(lancado).toBeInstanceOf(ErroConexao);
    expect((lancado as Error).message).toBe('O script respondeu sem os dados');
  });

  it('dados nulos ainda são uma resposta (quem chamou confere a forma)', async () => {
    await salvarConexao(CONEXAO);
    respondeCom('{"ok":true,"dados":null}');
    await expect(chamar('ping')).resolves.toBeNull();
  });

  it.each(['codigo-invalido', 'ocupado', 'interno'])(
    'resposta recusada lança ErroScript com erro %s',
    async (erro) => {
      await salvarConexao(CONEXAO);
      respondeCom(JSON.stringify({ ok: false, erro }));
      const lancado = await chamar('ping').catch((e: unknown) => e);
      expect(lancado).toBeInstanceOf(ErroScript);
      expect(lancado).not.toBeInstanceOf(ErroConexao);
      expect((lancado as ErroScript).erro).toBe(erro);
    },
  );
});

describe('tempo limite', () => {
  it('aos 30 s desiste e lança ErroConexao, não antes', async () => {
    ficaPendente();
    vi.useFakeTimers();
    let terminou = false;
    const resultado = ping(CONEXAO).catch((e: unknown) => {
      terminou = true;
      return e;
    });
    await vi.advanceTimersByTimeAsync(29_999);
    expect(terminou).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await resultado).toBeInstanceOf(ErroConexao);
  });

  it('o limite também vale enquanto o corpo da resposta chega', async () => {
    const falso = vi.fn(async (_url: string, opcoes: RequestInit) => {
      const corpo = new ReadableStream({
        start(controle) {
          opcoes.signal?.addEventListener('abort', () =>
            controle.error(new DOMException('abortado', 'AbortError')),
          );
        },
      });
      return new Response(corpo);
    });
    vi.stubGlobal('fetch', falso);
    vi.useFakeTimers();
    const resultado = ping(CONEXAO).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await resultado).toBeInstanceOf(ErroConexao);
  });

  it('resposta a tempo não deixa relógio pendente', async () => {
    respondeCom('{"ok":true,"dados":{}}');
    vi.useFakeTimers();
    await ping(CONEXAO);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('ping', () => {
  it('testa a conexão informada, sem precisar de nada salvo', async () => {
    const falso = respondeCom('{"ok":true,"dados":{}}');
    await ping(CONEXAO);
    expect(falso.mock.calls[0][0]).toBe(URL_FICTICIA);
    expect(JSON.parse(falso.mock.calls[0][1].body as string)).toMatchObject({
      codigo: CODIGO,
      acao: 'ping',
    });
  });

  it('devolve quanto tempo levou, em milissegundos', async () => {
    respondeCom('{"ok":true,"dados":{}}');
    vi.spyOn(performance, 'now').mockReturnValueOnce(1_000).mockReturnValueOnce(2_234);
    await expect(ping(CONEXAO)).resolves.toBe(1_234);
  });

  it('nunca manda o código para endereço fora do Google', async () => {
    const falso = respondeCom('{"ok":true,"dados":{}}');
    await expect(
      ping({ ...CONEXAO, url: 'https://exemplo.invalid/exec' }),
    ).rejects.toBeInstanceOf(ErroConexao);
    expect(falso).not.toHaveBeenCalled();
  });
});
