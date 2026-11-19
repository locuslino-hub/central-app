import { describe, expect, it, vi } from 'vitest';
import { AUDIO_BASE64_NO_MAXIMO } from '../../script/audio';
import { guardarAudio } from '../../src/voz/audios-pendentes';
import { AudioIndisponivel, buscarAudio } from '../../src/voz/ler-audio';

const BASE64 = btoa('abc'); // bytes fictícios

const lerBytes = (blob: Blob) =>
  new Promise<string>((resolver, rejeitar) => {
    const leitor = new FileReader();
    leitor.onload = () => resolver(leitor.result as string);
    leitor.onerror = () => rejeitar(leitor.error);
    leitor.readAsText(blob);
  });

describe('buscarAudio', () => {
  it('áudio ainda na fila deste aparelho toca do blob local, sem chamar o script', async () => {
    await guardarAudio({ id: 'a-1', bytes: new TextEncoder().encode('xyz').buffer, mime: 'audio/webm', guardadoEm: 1 });
    const chamar = vi.fn();

    const blob = await buscarAudio('a-1', { chamar: chamar as never });

    expect(chamar).not.toHaveBeenCalled();
    expect(blob.type).toBe('audio/webm');
    expect(await lerBytes(blob)).toBe('xyz');
  });

  it('áudio que não está na fila baixa do Drive pelo id e devolve um blob com o tipo certo', async () => {
    const chamar = vi.fn(async () => ({ ok: true, base64: BASE64, mime: 'audio/ogg' }));

    const blob = await buscarAudio('a-2', { chamar: chamar as never });

    expect(chamar).toHaveBeenCalledWith('lerAudio', { id: 'a-2' });
    expect(blob.type).toBe('audio/ogg');
    expect(await lerBytes(blob)).toBe('abc');
  });

  it('o Drive não achou o arquivo: lança AudioIndisponivel', async () => {
    const chamar = vi.fn(async () => ({ ok: false, erro: 'nao_encontrado' }));
    await expect(buscarAudio('a-3', { chamar: chamar as never })).rejects.toBeInstanceOf(AudioIndisponivel);
  });

  it('erro de rede ou do script sobe como veio (a tela decide o aviso)', async () => {
    const chamar = vi.fn(async () => {
      throw new Error('sem rede');
    });
    await expect(buscarAudio('a-4', { chamar: chamar as never })).rejects.toThrow('sem rede');
  });

  it('resposta sem base64 (script antigo ou lixo) lança AudioIndisponivel', async () => {
    const chamar = vi.fn(async () => ({ ok: true, mime: 'audio/webm' }));
    await expect(buscarAudio('a-5', { chamar: chamar as never })).rejects.toBeInstanceOf(AudioIndisponivel);
  });

  it('só aceita tipo audio/webm, ogg ou mp4: outro tipo lança AudioIndisponivel', async () => {
    for (const mime of ['text/html', 'audio/wav', 'audio/webmx', 'audio/webm;codecs=opus', 'application/octet-stream']) {
      const chamar = vi.fn(async () => ({ ok: true, base64: BASE64, mime }));
      await expect(buscarAudio('a-6', { chamar: chamar as never })).rejects.toBeInstanceOf(AudioIndisponivel);
    }
    for (const mime of ['audio/webm', 'audio/ogg', 'audio/mp4']) {
      const chamar = vi.fn(async () => ({ ok: true, base64: BASE64, mime }));
      expect((await buscarAudio('a-6', { chamar: chamar as never })).type).toBe(mime);
    }
  });

  it('base64 acima de 6 MB é recusado antes de decodificar (atob não roda)', async () => {
    const atob = vi.spyOn(globalThis, 'atob');
    const chamar = vi.fn(async () => ({ ok: true, base64: 'A'.repeat(AUDIO_BASE64_NO_MAXIMO + 4), mime: 'audio/webm' }));
    await expect(buscarAudio('a-7', { chamar: chamar as never })).rejects.toBeInstanceOf(AudioIndisponivel);
    expect(atob).not.toHaveBeenCalled();
  });
});
