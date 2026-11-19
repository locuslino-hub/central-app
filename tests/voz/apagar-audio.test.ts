import { describe, expect, it, vi } from 'vitest';
import { ErroConexao, ErroScript } from '../../src/conexao/cliente';
import { apagarAudioDoDrive } from '../../src/voz/apagar-audio';

describe('apagarAudioDoDrive', () => {
  it('pede apagarAudio com o id do áudio e confirma', async () => {
    const chamar = vi.fn(async () => ({ ok: true, apagados: 1 }));
    expect(await apagarAudioDoDrive('a-1', { chamar: chamar as never })).toBe(true);
    expect(chamar).toHaveBeenCalledWith('apagarAudio', { id: 'a-1' });
  });

  it('arquivo que o Drive já não tem também conta como feito', async () => {
    const chamar = vi.fn(async () => ({ ok: true, apagados: 0 }));
    expect(await apagarAudioDoDrive('a-1', { chamar: chamar as never })).toBe(true);
  });

  it.each([new ErroConexao(), new ErroScript('interno'), new ErroScript('ocupado')])('falha (%s) devolve false, sem lançar', async (erro) => {
    const chamar = vi.fn(async () => {
      throw erro;
    });
    expect(await apagarAudioDoDrive('a-1', { chamar: chamar as never })).toBe(false);
  });

  it('resposta estranha devolve false', async () => {
    expect(await apagarAudioDoDrive('a-1', { chamar: (async () => ({})) as never })).toBe(false);
  });
});
