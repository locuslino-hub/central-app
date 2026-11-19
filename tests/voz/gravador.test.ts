import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErroConexao, ErroScript } from '../../src/conexao/cliente';
import { criarIdeia, apagarIdeia } from '../../src/dados/ideias';
import { listar } from '../../src/dados/loja';
import { audiosPendentes, enviarAudio, ErroGravacao, esquecerTipoDaGravacao, iniciarGravacao, reenviarAudiosPendentes, tamanhoDosPendentes } from '../../src/voz/gravador';

class GravadorFalso {
  static ultimo: GravadorFalso;
  static suportados = ['audio/webm;codecs=opus', 'audio/webm'];
  static isTypeSupported = (tipo: string) => GravadorFalso.suportados.includes(tipo);
  state: 'inactive' | 'recording' = 'inactive';
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  /** Simula o navegador que nunca entrega o evento stop. */
  static semOnstop = false;
  constructor(public fluxo: unknown, public opcoes?: { mimeType?: string }) {
    this.mimeType = opcoes?.mimeType ?? 'audio/webm';
    GravadorFalso.ultimo = this;
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['abc'], { type: this.mimeType }) });
    if (!GravadorFalso.semOnstop) this.onstop?.();
  }
}

function fluxoFalso() {
  const trilhas = [{ stop: vi.fn() }, { stop: vi.fn() }];
  return { trilhas, fluxo: { getTracks: () => trilhas } };
}

function opcoes(getUserMedia: () => Promise<unknown>) {
  return { getUserMedia: getUserMedia as never, MediaRecorder: GravadorFalso as never };
}

describe('iniciarGravacao', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    GravadorFalso.semOnstop = false;
    esquecerTipoDaGravacao();
  });

  it('grava e devolve o blob com os segundos; solta o microfone', async () => {
    const { fluxo, trilhas } = fluxoFalso();
    const g = await iniciarGravacao(() => {}, opcoes(async () => fluxo));
    expect(GravadorFalso.ultimo.opcoes?.mimeType).toBe('audio/webm;codecs=opus');
    await vi.advanceTimersByTimeAsync(4200);
    const { blob, segundos } = await g.parar();
    expect(blob.size).toBe(3);
    expect(blob.type).toBe('audio/webm;codecs=opus');
    expect(segundos).toBe(4);
    for (const t of trilhas) expect(t.stop).toHaveBeenCalled();
  });

  it('avisa aos 150 s e corta aos 180 s', async () => {
    const { fluxo, trilhas } = fluxoFalso();
    const aviso = vi.fn();
    const g = await iniciarGravacao(aviso, opcoes(async () => fluxo));
    await vi.advanceTimersByTimeAsync(149_000);
    expect(aviso).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(aviso).toHaveBeenCalledExactlyOnceWith('quase_no_limite');
    await vi.advanceTimersByTimeAsync(29_000);
    expect(GravadorFalso.ultimo.state).toBe('recording');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(aviso).toHaveBeenLastCalledWith('limite');
    expect(GravadorFalso.ultimo.state).toBe('inactive');
    for (const t of trilhas) expect(t.stop).toHaveBeenCalled();
    const { segundos } = await g.parar(); // já cortada: devolve o que gravou
    expect(segundos).toBe(180);
  });

  it('cancelar para tudo, solta o microfone e some com os avisos', async () => {
    const { fluxo, trilhas } = fluxoFalso();
    const aviso = vi.fn();
    const g = await iniciarGravacao(aviso, opcoes(async () => fluxo));
    g.cancelar();
    expect(GravadorFalso.ultimo.state).toBe('inactive');
    for (const t of trilhas) expect(t.stop).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200_000);
    expect(aviso).not.toHaveBeenCalled();
  });

  it('microfone negado rejeita com ErroGravacao permissao_negada', async () => {
    const negado = Object.assign(new Error('x'), { name: 'NotAllowedError' });
    const p = iniciarGravacao(() => {}, opcoes(() => Promise.reject(negado)));
    await expect(p).rejects.toBeInstanceOf(ErroGravacao);
    await expect(p).rejects.toMatchObject({ codigo: 'permissao_negada' });
  });

  it('outro erro do microfone rejeita com desconhecido', async () => {
    const p = iniciarGravacao(() => {}, opcoes(() => Promise.reject(new Error('sem microfone'))));
    await expect(p).rejects.toMatchObject({ codigo: 'desconhecido' });
  });

  it('sem MediaRecorder rejeita com sem_suporte', async () => {
    const p = iniciarGravacao(() => {}, { getUserMedia: (async () => fluxoFalso().fluxo) as never, MediaRecorder: null as never });
    await expect(p).rejects.toMatchObject({ codigo: 'sem_suporte' });
  });

  it('se o gravador não abre, solta o microfone', async () => {
    const { fluxo, trilhas } = fluxoFalso();
    class Quebrado extends GravadorFalso {
      override start() {
        throw new Error('falhou');
      }
    }
    await expect(
      iniciarGravacao(() => {}, { getUserMedia: (async () => fluxo) as never, MediaRecorder: Quebrado as never }),
    ).rejects.toMatchObject({ codigo: 'desconhecido' });
    for (const t of trilhas) expect(t.stop).toHaveBeenCalled();
  });
});

describe('iniciarGravacao: falhas do gravador', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    GravadorFalso.semOnstop = false;
    esquecerTipoDaGravacao();
  });

  it('se o evento stop nunca chega, parar() monta o blob com o que já veio, em 3 s', async () => {
    GravadorFalso.semOnstop = true;
    const { fluxo, trilhas } = fluxoFalso();
    const g = await iniciarGravacao(() => {}, opcoes(async () => fluxo));
    const p = g.parar();
    await vi.advanceTimersByTimeAsync(2999);
    for (const t of trilhas) expect(t.stop).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    const { blob } = await p;
    expect(blob.size).toBe(3);
    for (const t of trilhas) expect(t.stop).toHaveBeenCalled();
  });

  it('onerror do gravador encerra e entrega o que foi gravado', async () => {
    GravadorFalso.semOnstop = true;
    const { fluxo, trilhas } = fluxoFalso();
    const g = await iniciarGravacao(() => {}, opcoes(async () => fluxo));
    GravadorFalso.ultimo.ondataavailable?.({ data: new Blob(['xyz']) });
    GravadorFalso.ultimo.onerror?.();
    const { blob } = await g.parar();
    expect(blob.size).toBe(3);
    for (const t of trilhas) expect(t.stop).toHaveBeenCalled();
  });

  it('cancelar() rejeita um parar() que está esperando', async () => {
    GravadorFalso.semOnstop = true;
    const g = await iniciarGravacao(() => {}, opcoes(async () => fluxoFalso().fluxo));
    const p = g.parar();
    const resultado = expect(p).rejects.toThrow(/cancelada/i);
    g.cancelar();
    await resultado;
  });

  it('tipo do blob que não é audio/webm, ogg ou mp4 vira o tipo escolhido na partida', async () => {
    class EstranhoMime extends GravadorFalso {
      constructor(f: unknown, o?: { mimeType?: string }) {
        super(f, o);
        this.mimeType = 'video/x-qualquer';
      }
    }
    const { fluxo } = fluxoFalso();
    const g = await iniciarGravacao(() => {}, { getUserMedia: (async () => fluxo) as never, MediaRecorder: EstranhoMime as never });
    const { blob } = await g.parar();
    expect(blob.type).toBe('audio/webm;codecs=opus');
  });

  it('sem tipo suportado e sem tipo do gravador: avisa no console e usa audio/webm', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    class SemTipos extends GravadorFalso {
      static override isTypeSupported = () => false;
      constructor(f: unknown, o?: { mimeType?: string }) {
        super(f, o);
        this.mimeType = '';
      }
    }
    const { fluxo } = fluxoFalso();
    const g = await iniciarGravacao(() => {}, { getUserMedia: (async () => fluxo) as never, MediaRecorder: SemTipos as never });
    const { blob } = await g.parar();
    expect(blob.type).toBe('audio/webm');
    expect(aviso).toHaveBeenCalled();
  });
});

describe('enviarAudio', () => {
  const blob = () => new Blob(['olá áudio'], { type: 'audio/webm;codecs=opus' });
  const BASE64 = btoa(String.fromCharCode(...new TextEncoder().encode('olá áudio')));

  it('envia salvarAudio em base64 e devolve o driveId', async () => {
    const chamar = vi.fn().mockResolvedValue({ ok: true, driveId: 'D1' });
    const r = await enviarAudio('aud-1', blob(), { chamar });
    expect(r).toEqual({ driveId: 'D1' });
    expect(chamar).toHaveBeenCalledWith('salvarAudio', { id: 'aud-1', base64: BASE64, mime: 'audio/webm;codecs=opus' });
    expect(await audiosPendentes()).toBe(0);
  });

  it('sem rede devolve { fila: true } e guarda o blob', async () => {
    const chamar = vi.fn().mockRejectedValue(new ErroConexao());
    expect(await enviarAudio('aud-2', blob(), { chamar })).toEqual({ fila: true });
    expect(await audiosPendentes()).toBe(1);
  });

  it('script ocupado ou com erro interno também vai para a fila', async () => {
    expect(await enviarAudio('a-ocupado', blob(), { chamar: vi.fn().mockRejectedValue(new ErroScript('ocupado')) })).toEqual({ fila: true });
    expect(await enviarAudio('a-interno', blob(), { chamar: vi.fn().mockRejectedValue(new ErroScript('interno')) })).toEqual({ fila: true });
    expect(await audiosPendentes()).toBe(2);
  });

  it('código inválido não adianta repetir: erro, sem fila', async () => {
    const chamar = vi.fn().mockRejectedValue(new ErroScript('codigo-invalido'));
    await expect(enviarAudio('aud-3', blob(), { chamar })).rejects.toBeInstanceOf(ErroScript);
    expect(await audiosPendentes()).toBe(0);
  });

  it.each(['grande_demais', 'mime_invalido'] as const)('recusa %s não vai para a fila: rejeita com ErroAudioRecusado', async (erro) => {
    const chamar = vi.fn().mockResolvedValue({ ok: false, erro });
    await expect(enviarAudio('aud-4', blob(), { chamar })).rejects.toMatchObject({ name: 'ErroAudioRecusado', motivo: erro });
    expect(await audiosPendentes()).toBe(0);
  });

  it('blob sem tipo válido usa o tipo escolhido na última gravação', async () => {
    vi.useFakeTimers();
    GravadorFalso.semOnstop = false;
    esquecerTipoDaGravacao();
    await iniciarGravacao(() => {}, opcoes(async () => fluxoFalso().fluxo));
    vi.useRealTimers();
    const chamar = vi.fn().mockResolvedValue({ ok: true, driveId: 'D' });
    await enviarAudio('aud-6', new Blob(['abc'], { type: '' }), { chamar });
    expect(chamar.mock.calls[0]![1].mime).toBe('audio/webm;codecs=opus');
  });

  it('acima de ~4,5 MB crus recusa na hora, antes de gerar base64 e sem chamar o script', async () => {
    const chamar = vi.fn();
    const grande = new Blob([new Uint8Array(4_718_593)], { type: 'audio/webm' });
    await expect(enviarAudio('aud-7', grande, { chamar })).rejects.toMatchObject({ name: 'ErroAudioRecusado', motivo: 'grande_demais' });
    expect(chamar).not.toHaveBeenCalled();
    expect(await audiosPendentes()).toBe(0);
  });

  it('sem espaço no aparelho (QuotaExceededError) devolve { erro: sem_espaco }', async () => {
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('cheio', 'QuotaExceededError');
    });
    const r = await enviarAudio('aud-8', blob(), { chamar: vi.fn().mockRejectedValue(new ErroConexao()) });
    expect(r).toEqual({ erro: 'sem_espaco' });
  });

  it('fila cheia (20 áudios) recusa o novo com sem_espaco e não apaga nenhum antigo', async () => {
    const falha = vi.fn().mockRejectedValue(new ErroConexao());
    for (let i = 0; i < 20; i++) expect(await enviarAudio(`f-${i}`, blob(), { chamar: falha })).toEqual({ fila: true });
    expect(await enviarAudio('f-novo', blob(), { chamar: falha })).toEqual({ erro: 'sem_espaco' });
    expect(await audiosPendentes()).toBe(20);
    // repetir um id que já está na fila não conta como novo
    expect(await enviarAudio('f-0', blob(), { chamar: falha })).toEqual({ fila: true });
  });

  it('tamanhoDosPendentes soma os bytes guardados', async () => {
    const falha = vi.fn().mockRejectedValue(new ErroConexao());
    await enviarAudio('t-1', new Blob(['12345'], { type: 'audio/webm' }), { chamar: falha });
    await enviarAudio('t-2', new Blob(['123'], { type: 'audio/webm' }), { chamar: falha });
    expect(await tamanhoDosPendentes()).toBe(8);
  });

  it('manda o corpo HTTP com codigo e acao antes de dados (prefixo exigido pelo script)', async () => {
    const { salvarConexao } = await import('../../src/conexao/guarda');
    await salvarConexao({ url: 'https://script.google.com/macros/s/ABC/exec', codigo: 'c'.repeat(64) });
    const fetchFalso = vi.fn().mockResolvedValue({ text: async () => JSON.stringify({ ok: true, dados: { ok: true, driveId: 'D9' } }) });
    vi.stubGlobal('fetch', fetchFalso);
    expect(await enviarAudio('aud-5', blob())).toEqual({ driveId: 'D9' });
    const corpo = fetchFalso.mock.calls[0]![1].body as string;
    expect(corpo.startsWith(`{"codigo":"${'c'.repeat(64)}","acao":"salvarAudio","dados":`)).toBe(true);
  });
});

describe('reenviarAudiosPendentes', () => {
  const blob = () => new Blob(['abc'], { type: 'audio/webm' });
  const falha = () => vi.fn().mockRejectedValue(new ErroConexao());
  // Cada áudio guardado tem a sua ideia (o reenvio confere): p-1, p-2 e o de teste.
  beforeEach(async () => {
    for (const audioId of ['p-1', 'p-2']) await criarIdeia(`ideia ${audioId}`, { audioId });
  });

  it('áudio de ideia apagada sai da fila sem ser enviado; o de ideia viva segue', async () => {
    await enviarAudio('p-1', blob(), { chamar: falha() });
    await enviarAudio('p-2', blob(), { chamar: falha() });
    const apagada = (await listar('ideias')).find((i) => i.audioId === 'p-1')!;
    await apagarIdeia(apagada.id);
    // apagarIdeia já tira da fila; guarda de novo para simular a fila de outro caminho (ex.: aparelho que apagou antes).
    await enviarAudio('p-1', blob(), { chamar: falha() });
    const chamar = vi.fn().mockResolvedValue({ ok: true, driveId: 'D' });
    expect(await reenviarAudiosPendentes({ chamar })).toEqual({ enviados: ['p-2'], descartados: [], restantes: 0, falhas: [] });
    expect(chamar.mock.calls.map((c) => c[1].id)).toEqual(['p-2']);
    expect(await audiosPendentes()).toBe(0);
  });

  it('áudio sem ideia nenhuma também sai da fila sem ser enviado', async () => {
    await enviarAudio('sem-dono', blob(), { chamar: falha() });
    const chamar = vi.fn();
    expect(await reenviarAudiosPendentes({ chamar })).toEqual({ enviados: [], descartados: [], restantes: 0, falhas: [] });
    expect(chamar).not.toHaveBeenCalled();
  });

  it('reenvia os guardados e esvazia a fila', async () => {
    await enviarAudio('p-1', blob(), { chamar: falha() });
    await enviarAudio('p-2', blob(), { chamar: falha() });
    const chamar = vi.fn().mockResolvedValue({ ok: true, driveId: 'D' });
    expect(await reenviarAudiosPendentes({ chamar })).toEqual({ enviados: ['p-1', 'p-2'], descartados: [], restantes: 0, falhas: [] });
    expect(chamar.mock.calls.map((c) => c[1].id).sort()).toEqual(['p-1', 'p-2']);
    expect(chamar.mock.calls[0]![1].base64).toBe(btoa('abc'));
    expect(await audiosPendentes()).toBe(0);
  });

  it('para na primeira falha de rede e mantém o resto', async () => {
    await enviarAudio('p-1', blob(), { chamar: falha() });
    await enviarAudio('p-2', blob(), { chamar: falha() });
    const chamar = falha();
    expect(await reenviarAudiosPendentes({ chamar })).toEqual({ enviados: [], descartados: [], restantes: 2, falhas: [] });
    expect(chamar).toHaveBeenCalledTimes(1);
  });

  it('descarta o que o script recusa de vez e segue com os outros', async () => {
    await enviarAudio('p-1', blob(), { chamar: falha() });
    await enviarAudio('p-2', blob(), { chamar: falha() });
    const chamar = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, erro: 'mime_invalido' })
      .mockResolvedValueOnce({ ok: true, driveId: 'D' });
    const r = await reenviarAudiosPendentes({ chamar });
    expect(r.enviados).toHaveLength(1);
    expect(r.descartados).toEqual([{ id: 'p-1', motivo: 'mime_invalido' }]); // nunca em silêncio
    expect(r.restantes).toBe(0);
  });

  it('script ocupado para a rodada, como falta de rede', async () => {
    await enviarAudio('p-1', blob(), { chamar: falha() });
    await enviarAudio('p-2', blob(), { chamar: falha() });
    const chamar = vi.fn().mockRejectedValue(new ErroScript('ocupado'));
    expect(await reenviarAudiosPendentes({ chamar })).toMatchObject({ enviados: [], restantes: 2 });
    expect(chamar).toHaveBeenCalledTimes(1);
  });

  it('erro interno de um áudio não bloqueia os seguintes', async () => {
    await enviarAudio('p-1', blob(), { chamar: falha() });
    await enviarAudio('p-2', blob(), { chamar: falha() });
    const chamar = vi.fn(async (_acao: string, dados: { id: string }) => {
      if (dados.id === 'p-1') throw new ErroScript('interno');
      return { ok: true, driveId: 'D' };
    });
    const r = await reenviarAudiosPendentes({ chamar: chamar as never });
    expect(r).toMatchObject({ enviados: ['p-2'], restantes: 1, falhas: [] });
  });

  it('após 5 erros internos o áudio é marcado como falhou, fica guardado e sai das rodadas', async () => {
    await enviarAudio('p-1', blob(), { chamar: falha() });
    const chamar = vi.fn().mockRejectedValue(new ErroScript('interno'));
    for (let i = 0; i < 4; i++) expect(await reenviarAudiosPendentes({ chamar })).toMatchObject({ falhas: [] });
    expect(await reenviarAudiosPendentes({ chamar })).toMatchObject({ enviados: [], restantes: 1, falhas: ['p-1'] });
    expect(chamar).toHaveBeenCalledTimes(5);
    expect(await reenviarAudiosPendentes({ chamar })).toMatchObject({ restantes: 1, falhas: ['p-1'] });
    expect(chamar).toHaveBeenCalledTimes(5); // não tenta mais
    expect(await audiosPendentes()).toBe(1); // nunca apaga
  });

  it('chamadas ao mesmo tempo dividem uma rodada só', async () => {
    await enviarAudio('p-1', blob(), { chamar: falha() });
    const chamar = vi.fn().mockResolvedValue({ ok: true, driveId: 'D' });
    const [a, b] = await Promise.all([reenviarAudiosPendentes({ chamar }), reenviarAudiosPendentes({ chamar })]);
    expect(chamar).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    expect(a.enviados).toEqual(['p-1']);
  });

  it('depois que a rodada acaba, uma nova pode começar', async () => {
    await enviarAudio('p-1', blob(), { chamar: falha() });
    await reenviarAudiosPendentes({ chamar: falha() });
    const chamar = vi.fn().mockResolvedValue({ ok: true, driveId: 'D' });
    expect((await reenviarAudiosPendentes({ chamar })).enviados).toEqual(['p-1']);
  });

  it('sem nada guardado, não chama o script', async () => {
    const chamar = vi.fn();
    expect(await reenviarAudiosPendentes({ chamar })).toEqual({ enviados: [], descartados: [], restantes: 0, falhas: [] });
    expect(chamar).not.toHaveBeenCalled();
  });

  it('fila vazia: não lê as ideias', async () => {
    const ideias = vi.fn(async () => []);
    const chamar = vi.fn();
    expect(await reenviarAudiosPendentes({ chamar, ideias })).toEqual({ enviados: [], descartados: [], restantes: 0, falhas: [] });
    expect(ideias).not.toHaveBeenCalled();
    expect(chamar).not.toHaveBeenCalled();
  });

  it('ideia apagada durante o envio: terminado o envio, o áudio é apagado do Drive', async () => {
    await enviarAudio('p-1', blob(), { chamar: falha() });
    // Primeira leitura: viva (o áudio segue); depois do envio: apagada.
    const ideias = vi
      .fn<() => Promise<{ audioId?: string; apagado?: boolean }[]>>()
      .mockResolvedValueOnce([{ audioId: 'p-1' }])
      .mockResolvedValue([{ audioId: 'p-1', apagado: true }]);
    const chamar = vi.fn(async (acao: string) => (acao === 'salvarAudio' ? { ok: true, driveId: 'D' } : { ok: true }));
    expect((await reenviarAudiosPendentes({ chamar: chamar as never, ideias })).enviados).toEqual(['p-1']);
    expect(chamar.mock.calls.map((c) => c[0])).toEqual(['salvarAudio', 'apagarAudio']);
    expect(chamar.mock.calls[1]).toEqual(['apagarAudio', { id: 'p-1' }]);
  });

  it('ideia viva depois do envio: o áudio fica no Drive (nada é apagado)', async () => {
    await enviarAudio('p-1', blob(), { chamar: falha() });
    const chamar = vi.fn(async () => ({ ok: true, driveId: 'D' }));
    await reenviarAudiosPendentes({ chamar: chamar as never });
    expect(chamar).toHaveBeenCalledTimes(1);
  });

  it('guardar o mesmo id duas vezes não duplica', async () => {
    await enviarAudio('p-1', blob(), { chamar: falha() });
    await enviarAudio('p-1', blob(), { chamar: falha() });
    expect(await audiosPendentes()).toBe(1);
  });
});
