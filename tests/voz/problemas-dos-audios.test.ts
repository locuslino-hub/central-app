import { openDB } from 'idb';
import { describe, expect, it, vi } from 'vitest';
import {
  assinarProblemas,
  guardarAudio,
  listarAudios,
  limparProblemaDeAudio,
  lerAudioPendente,
  marcarProblemaDeAudio,
  problemasDosAudios,
} from '../../src/voz/audios-pendentes';

const bytes = new Uint8Array([1, 2, 3]).buffer;

describe('problemas dos áudios (avisos "Áudio não enviado" nas ideias)', () => {
  it('começa sem problema nenhum', async () => {
    expect((await problemasDosAudios()).size).toBe(0);
  });

  it('marca um problema e o lê de volta; marcar de novo troca o motivo', async () => {
    await marcarProblemaDeAudio('a-1', 'recusado');
    await marcarProblemaDeAudio('a-1', 'sem_espaco');
    await marcarProblemaDeAudio('a-2', 'falhou');
    expect(Object.fromEntries(await problemasDosAudios())).toEqual({ 'a-1': 'sem_espaco', 'a-2': 'falhou' });
  });

  it('limpar tira só aquele', async () => {
    await marcarProblemaDeAudio('a-1', 'recusado');
    await marcarProblemaDeAudio('a-2', 'recusado');
    await limparProblemaDeAudio('a-1');
    expect([...(await problemasDosAudios()).keys()]).toEqual(['a-2']);
  });

  it('áudio da fila que o app desistiu de reenviar (falhou) conta como problema, sem ser marcado', async () => {
    await guardarAudio({ id: 'f-1', bytes, mime: 'audio/webm', guardadoEm: 1, falhou: true });
    await guardarAudio({ id: 'ok-1', bytes, mime: 'audio/webm', guardadoEm: 2 });
    expect(Object.fromEntries(await problemasDosAudios())).toEqual({ 'f-1': 'falhou' });
  });

  it('lerAudioPendente devolve o áudio da fila, ou undefined', async () => {
    await guardarAudio({ id: 'a-9', bytes, mime: 'audio/mp4', guardadoEm: 1 });
    expect((await lerAudioPendente('a-9'))?.mime).toBe('audio/mp4');
    expect(await lerAudioPendente('nao-tem')).toBeUndefined();
  });

  it('assinarProblemas avisa quando um problema é anotado ou limpo, e para depois de cancelar', async () => {
    const ouvinte = vi.fn();
    const parar = assinarProblemas(ouvinte);
    await marcarProblemaDeAudio('a-1', 'recusado');
    expect(ouvinte).toHaveBeenCalledTimes(1);
    await limparProblemaDeAudio('a-1');
    expect(ouvinte).toHaveBeenCalledTimes(2);
    parar();
    await marcarProblemaDeAudio('a-2', 'falhou');
    expect(ouvinte).toHaveBeenCalledTimes(2);
  });
});

describe('migração do banco central-audios 1 -> 2', () => {
  it('sobe criando problemas sem tocar nos áudios guardados (inclusive o que falhou)', async () => {
    const antigo = await openDB('central-audios', 1, {
      upgrade(banco) {
        banco.createObjectStore('pendentes', { keyPath: 'id' });
      },
    });
    await antigo.put('pendentes', { id: 'v1-a', bytes, mime: 'audio/webm', guardadoEm: 1 });
    await antigo.put('pendentes', { id: 'v1-b', bytes, mime: 'audio/mp4', guardadoEm: 2, falhou: true, tentativas: 5 });
    antigo.close();

    expect((await listarAudios()).map((a) => a.id)).toEqual(['v1-a', 'v1-b']);
    expect((await lerAudioPendente('v1-b'))?.mime).toBe('audio/mp4');
    expect(Object.fromEntries(await problemasDosAudios())).toEqual({ 'v1-b': 'falhou' });
    await marcarProblemaDeAudio('v1-a', 'recusado');
    expect((await problemasDosAudios()).get('v1-a')).toBe('recusado');
  });
});
