import { describe, expect, it, vi } from 'vitest';
import { iguais, novoCodigo, tratar, tratarCorpo, type Ambiente } from '../../script/api';
import { armazemNaMemoria } from '../apoio/armazem';

const CODIGO = 'codigo-ficticio-de-teste-0123456789abcdef';

function ambienteCom(codigo: string | null): Ambiente {
  return { lerCodigo: () => codigo, armazem: armazemNaMemoria() };
}

const ambiente = ambienteCom(CODIGO);

describe('tratar', () => {
  it('recusa código errado', () => {
    expect(tratar({ codigo: 'outro-codigo', acao: 'ping' }, ambiente)).toEqual({
      ok: false,
      erro: 'codigo-invalido',
    });
  });

  it('responde ping com código certo', () => {
    expect(tratar({ codigo: CODIGO, acao: 'ping' }, ambiente)).toEqual({ ok: true, dados: {} });
  });

  it('recusa ação desconhecida como codigo-invalido, mesmo com o código certo', () => {
    expect(tratar({ codigo: CODIGO, acao: 'nao-existe' }, ambiente)).toEqual({
      ok: false,
      erro: 'codigo-invalido',
    });
  });

  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty'])(
    'não confunde a ação %s com propriedade herdada',
    (acao) => {
      expect(tratar({ codigo: CODIGO, acao }, ambiente)).toEqual({
        ok: false,
        erro: 'codigo-invalido',
      });
    },
  );

  it('sem código certo não revela se a ação existe', () => {
    expect(tratar({ codigo: 'outro-codigo', acao: 'nao-existe' }, ambiente)).toEqual({
      ok: false,
      erro: 'codigo-invalido',
    });
  });

  it.each([
    ['nulo', null],
    ['vazio', ''],
  ])('recusa tudo quando o código guardado é %s', (_nome, guardado) => {
    const semCodigo = ambienteCom(guardado);
    for (const codigo of ['', undefined, null, 'null', 'undefined', CODIGO]) {
      expect(tratar({ codigo, acao: 'ping' }, semCodigo)).toEqual({
        ok: false,
        erro: 'codigo-invalido',
      });
    }
  });

  it('recusa código guardado com menos de 32 caracteres, mesmo igual ao enviado', () => {
    const curto = 'a'.repeat(31);
    expect(tratar({ codigo: curto, acao: 'ping' }, ambienteCom(curto))).toEqual({
      ok: false,
      erro: 'codigo-invalido',
    });
  });

  it('aceita código guardado de exatamente 32 caracteres', () => {
    const limite = 'a'.repeat(32);
    expect(tratar({ codigo: limite, acao: 'ping' }, ambienteCom(limite)).ok).toBe(true);
  });

  it.each([
    ['número', 123],
    ['lista', [CODIGO]],
    ['objeto', { toString: () => CODIGO }],
    ['booleano', true],
  ])('recusa código que não é texto: %s', (_nome, codigo) => {
    expect(tratar({ codigo, acao: 'ping' }, ambiente)).toEqual({
      ok: false,
      erro: 'codigo-invalido',
    });
  });

  it.each([
    ['nulo', null],
    ['indefinido', undefined],
    ['número', 5],
    ['texto', 'ping'],
    ['lista', []],
    ['objeto vazio', {}],
  ])('recusa pedido sem código sem lançar exceção: %s', (_nome, pedido) => {
    expect(tratar(pedido, ambiente)).toEqual({ ok: false, erro: 'codigo-invalido' });
  });

  it('falha interna não carrega detalhe nenhum', () => {
    const quebrado: Ambiente = {
      armazem: armazemNaMemoria(),
      lerCodigo() {
        throw new Error('detalhe interno em /caminho/secreto');
      },
    };
    expect(tratar({ codigo: CODIGO, acao: 'ping' }, quebrado)).toStrictEqual({
      ok: false,
      erro: 'interno',
    });
  });
});

describe('tratarCorpo', () => {
  it('interpreta o corpo JSON e atende o pedido', () => {
    const corpo = JSON.stringify({ codigo: CODIGO, acao: 'ping', dados: {} });
    expect(tratarCorpo(corpo, ambiente)).toEqual({ ok: true, dados: {} });
  });

  it.each([
    ['JSON quebrado', '{"codigo":'],
    ['texto solto', 'ola'],
    ['vazio', ''],
    ['ausente', undefined],
  ])('responde interno sem lançar exceção: %s', (_nome, corpo) => {
    expect(tratarCorpo(corpo, ambiente)).toStrictEqual({ ok: false, erro: 'interno' });
  });
});

describe('iguais', () => {
  it.each([
    ['textos idênticos', 'abcdef', 'abcdef', true],
    ['diferença no primeiro caractere', 'xbcdef', 'abcdef', false],
    ['diferença no último caractere', 'abcdex', 'abcdef', false],
    ['enviado é prefixo do guardado', 'abc', 'abcdef', false],
    ['guardado é prefixo do enviado', 'abcdef', 'abc', false],
    ['enviado vazio', '', 'abcdef', false],
    ['caractere nulo a mais', 'abc\0', 'abc', false],
    ['acentos diferentes', 'código', 'codigo', false],
  ])('%s', (_nome, enviado, guardado, esperado) => {
    expect(iguais(enviado, guardado)).toBe(esperado);
  });

  function passosDe(enviado: string, guardado: string): number {
    const leitura = vi.spyOn(String.prototype, 'charCodeAt');
    iguais(enviado, guardado);
    const passos = leitura.mock.calls.length;
    leitura.mockRestore();
    return passos;
  }

  it('faz o mesmo trabalho não importa onde está a diferença', () => {
    const guardado = 'a'.repeat(40);
    const noInicio = 'b' + 'a'.repeat(39);
    const noFim = 'a'.repeat(39) + 'b';
    expect(passosDe(noInicio, guardado)).toBeGreaterThan(0);
    expect(passosDe(noInicio, guardado)).toBe(passosDe(noFim, guardado));
    expect(passosDe(noInicio, guardado)).toBe(passosDe(guardado, guardado));
  });

  it('o trabalho não depende do tamanho do código guardado', () => {
    const enviado = 'a'.repeat(40);
    expect(passosDe(enviado, 'a'.repeat(32))).toBe(passosDe(enviado, 'a'.repeat(64)));
  });
});

describe('novoCodigo', () => {
  it('junta dois UUIDs em 64 caracteres hexadecimais', () => {
    const fila = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ];
    expect(novoCodigo(() => fila.shift()!)).toBe(
      '11111111111141118111111111111111' + '22222222222242228222222222222222',
    );
  });
});
