import { beforeEach, describe, expect, it, vi } from 'vitest';
import { iniciarEscuta } from '../../src/voz/reconhecimento';

/** Dublê de SpeechRecognition: o teste dispara os eventos à mão. */
class ReconhecedorFalso {
  static todos: ReconhecedorFalso[] = [];
  lang = '';
  continuous = false;
  interimResults = false;
  iniciado = 0;
  parado = 0;
  abortado = 0;
  chamadasDeStart = 0;
  /** Números das chamadas de start() que lançam (1 = a primeira). */
  falharNoStart: number[] = [];
  /** Resultado que o navegador ainda entrega depois de stop(), antes do onend. */
  finalDepoisDoStop: string | null = null;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  constructor() {
    ReconhecedorFalso.todos.push(this);
  }
  start() {
    this.chamadasDeStart++;
    if (this.falharNoStart.includes(this.chamadasDeStart)) throw new Error('InvalidStateError');
    this.iniciado++;
  }
  stop() {
    this.parado++;
    queueMicrotask(() => {
      if (this.finalDepoisDoStop) this.falar(0, [[this.finalDepoisDoStop, true]]);
      this.onend?.();
    });
  }
  abort() {
    this.abortado++;
  }
  /** Resultados no formato do navegador: lista de alternativas, com isFinal. */
  falar(resultIndex: number, itens: [texto: string, final: boolean][]) {
    const results = itens.map(([texto, final]) => Object.assign([{ transcript: texto }], { isFinal: final }));
    this.onresult?.({ resultIndex, results });
  }
}

function preparar() {
  ReconhecedorFalso.todos = [];
  const aoTexto = vi.fn();
  const aoErro = vi.fn();
  const escuta = iniciarEscuta(aoTexto, aoErro, ReconhecedorFalso as never);
  return { escuta, aoTexto, aoErro, rec: ReconhecedorFalso.todos[0]! };
}

/** Deixa a sessão durar mais que 1 s, para o fim dela não contar como "rápido". */
const sessaoLonga = () => vi.advanceTimersByTime(1100);

describe('iniciarEscuta', () => {
  beforeEach(() => vi.useFakeTimers());

  it('configura pt-BR, contínuo e com resultados parciais, e começa', () => {
    const { rec } = preparar();
    expect(rec.lang).toBe('pt-BR');
    expect(rec.continuous).toBe(true);
    expect(rec.interimResults).toBe(true);
    expect(rec.iniciado).toBe(1);
  });

  it('reinicia a escuta quando o navegador encerra sozinho', () => {
    const { rec } = preparar();
    sessaoLonga();
    rec.onend?.();
    expect(rec.iniciado).toBe(2);
  });

  it('não reinicia depois de parar', async () => {
    const { escuta, rec } = preparar();
    await escuta.parar();
    expect(rec.iniciado).toBe(1);
  });

  it('junta trechos parciais e finais em ordem', async () => {
    const { escuta, aoTexto, rec } = preparar();
    rec.falar(0, [['oi Marina', false]]);
    expect(aoTexto).toHaveBeenLastCalledWith('oi Marina', true);
    rec.falar(0, [['oi Marina,', true]]);
    expect(aoTexto).toHaveBeenLastCalledWith('oi Marina,', false);
    rec.falar(1, [['oi Marina,', true], ['marcar reunião', false]]);
    expect(aoTexto).toHaveBeenLastCalledWith('oi Marina, marcar reunião', true);
    rec.falar(1, [['oi Marina,', true], ['marcar reunião', true]]);
    expect(await escuta.parar()).toBe('oi Marina, marcar reunião');
  });

  it('mantém o texto de antes quando o navegador reinicia e a lista de resultados volta ao zero', async () => {
    const { escuta, aoTexto, rec } = preparar();
    rec.falar(0, [['primeira frase', true]]);
    sessaoLonga();
    rec.onend?.(); // reinício sozinho
    rec.falar(0, [['segunda frase', true]]);
    expect(aoTexto).toHaveBeenLastCalledWith('primeira frase segunda frase', false);
    expect(await escuta.parar()).toBe('primeira frase segunda frase');
  });

  it('parar inclui o trecho parcial que ainda não virou final', async () => {
    const { escuta, rec } = preparar();
    rec.falar(0, [['ligar para Renata', false]]);
    expect(await escuta.parar()).toBe('ligar para Renata');
  });

  it('parar não trava se o navegador não avisar o fim', async () => {
    const { escuta, rec } = preparar();
    rec.stop = () => {}; // nunca dispara onend
    rec.falar(0, [['só isso', true]]);
    const texto = escuta.parar();
    await vi.advanceTimersByTimeAsync(3000);
    expect(await texto).toBe('só isso');
  });

  it('cancelar aborta e não reinicia nem avisa mais texto', () => {
    const { escuta, aoTexto, rec } = preparar();
    escuta.cancelar();
    expect(rec.abortado).toBe(1);
    rec.onend?.();
    rec.falar(0, [['tarde demais', true]]);
    vi.advanceTimersByTime(5000);
    expect(rec.iniciado).toBe(1);
    expect(aoTexto).not.toHaveBeenCalled();
  });

  it.each([
    ['not-allowed', 'permissao_negada'],
    ['service-not-allowed', 'permissao_negada'],
    ['network', 'sem_rede'],
    ['audio-capture', 'desconhecido'],
    ['language-not-supported', 'desconhecido'],
  ])('erro %s chama aoErro(%s) e não reinicia', (erro, esperado) => {
    const { aoErro, rec } = preparar();
    rec.onerror?.({ error: erro });
    rec.onend?.();
    vi.advanceTimersByTime(5000);
    expect(aoErro).toHaveBeenCalledExactlyOnceWith(esperado);
    expect(rec.iniciado).toBe(1);
  });

  it('silêncio (no-speech) e aborted não são erro: a escuta continua', () => {
    const { aoErro, rec } = preparar();
    rec.onerror?.({ error: 'no-speech' });
    rec.onerror?.({ error: 'aborted' });
    sessaoLonga();
    rec.onend?.();
    expect(aoErro).not.toHaveBeenCalled();
    expect(rec.iniciado).toBe(2);
  });

  it('start que falha na primeira vez chama aoErro(desconhecido)', () => {
    const aoErro = vi.fn();
    class Quebrado extends ReconhecedorFalso {
      override start() {
        throw new Error('InvalidStateError');
      }
    }
    iniciarEscuta(() => {}, aoErro, Quebrado as never);
    expect(aoErro).toHaveBeenCalledWith('desconhecido');
  });

  it('sem suporte chama aoErro(sem_suporte) e devolve escuta inerte', async () => {
    vi.stubGlobal('SpeechRecognition', undefined);
    vi.stubGlobal('webkitSpeechRecognition', undefined);
    const aoErro = vi.fn();
    const escuta = iniciarEscuta(() => {}, aoErro);
    expect(aoErro).toHaveBeenCalledExactlyOnceWith('sem_suporte');
    expect(await escuta.parar()).toBe('');
    expect(() => escuta.cancelar()).not.toThrow();
  });

  it('usa webkitSpeechRecognition do navegador quando não vem dublê', () => {
    ReconhecedorFalso.todos = [];
    vi.stubGlobal('webkitSpeechRecognition', ReconhecedorFalso);
    iniciarEscuta(() => {}, () => {});
    expect(ReconhecedorFalso.todos).toHaveLength(1);
  });
});

describe('iniciarEscuta: reinício que falha', () => {
  beforeEach(() => vi.useFakeTimers());

  it('start() que lança no reinício tenta de novo em 250 ms, até 3 vezes, e então avisa desconhecido', () => {
    const { rec, aoErro } = preparar();
    rec.falharNoStart = [2, 3, 4, 5];
    sessaoLonga();
    rec.onend?.(); // 2ª chamada de start: lança
    expect(rec.chamadasDeStart).toBe(2);
    vi.advanceTimersByTime(249);
    expect(rec.chamadasDeStart).toBe(2);
    vi.advanceTimersByTime(1);
    expect(rec.chamadasDeStart).toBe(3);
    vi.advanceTimersByTime(250);
    expect(rec.chamadasDeStart).toBe(4);
    expect(aoErro).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(rec.chamadasDeStart).toBe(5);
    expect(aoErro).toHaveBeenCalledExactlyOnceWith('desconhecido'); // a 3ª nova tentativa também falhou
    vi.advanceTimersByTime(5000);
    expect(rec.chamadasDeStart).toBe(5);
  });

  it('se a segunda tentativa funciona, segue escutando sem avisar erro', () => {
    const { rec, aoErro } = preparar();
    rec.falharNoStart = [2];
    sessaoLonga();
    rec.onend?.();
    vi.advanceTimersByTime(250);
    expect(rec.iniciado).toBe(2);
    expect(aoErro).not.toHaveBeenCalled();
  });

  it('fim rápido (sessão < 1 s) espera 500 ms, depois 1 s, depois 2 s', () => {
    const { rec } = preparar();
    rec.onend?.();
    expect(rec.iniciado).toBe(1);
    vi.advanceTimersByTime(500);
    expect(rec.iniciado).toBe(2);
    rec.onend?.();
    vi.advanceTimersByTime(999);
    expect(rec.iniciado).toBe(2);
    vi.advanceTimersByTime(1);
    expect(rec.iniciado).toBe(3);
    rec.onend?.();
    vi.advanceTimersByTime(2000);
    expect(rec.iniciado).toBe(4);
  });

  it('5 fins rápidos seguidos param a escuta e avisam desconhecido', () => {
    const { rec, aoErro } = preparar();
    for (const espera of [500, 1000, 2000, 2000, 2000]) {
      rec.onend?.();
      vi.advanceTimersByTime(espera);
    }
    expect(aoErro).toHaveBeenCalledExactlyOnceWith('desconhecido');
    expect(rec.iniciado).toBe(5);
  });

  it('uma sessão longa zera a contagem de fins rápidos', () => {
    const { rec, aoErro } = preparar();
    for (const espera of [500, 1000, 2000, 2000]) {
      rec.onend?.();
      vi.advanceTimersByTime(espera);
    }
    sessaoLonga();
    rec.onend?.();
    rec.onend?.(); // um fim rápido a mais não chega a 5
    vi.advanceTimersByTime(2000);
    expect(aoErro).not.toHaveBeenCalled();
  });
});

describe('iniciarEscuta: limite de 180 s', () => {
  beforeEach(() => vi.useFakeTimers());

  it('aos 180 s para, avisa limite e o texto continua disponível em parar()', async () => {
    ReconhecedorFalso.todos = [];
    const aoAviso = vi.fn();
    const escuta = iniciarEscuta(() => {}, () => {}, ReconhecedorFalso as never, { aoAviso });
    const rec = ReconhecedorFalso.todos[0]!;
    rec.falar(0, [['texto longo', true]]);
    vi.advanceTimersByTime(179_999);
    expect(aoAviso).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(aoAviso).toHaveBeenCalledExactlyOnceWith('limite');
    expect(rec.parado).toBe(1);
    expect(await escuta.parar()).toBe('texto longo');
    expect(rec.iniciado).toBe(1);
  });
});

describe('iniciarEscuta: texto repetido', () => {
  beforeEach(() => vi.useFakeTimers());

  it('resultados cumulativos: fica só o mais longo', () => {
    const { aoTexto, rec } = preparar();
    rec.falar(0, [['marcar', true], ['marcar reunião', true], ['marcar reunião com a Marina', true]]);
    expect(aoTexto).toHaveBeenLastCalledWith('marcar reunião com a Marina', false);
  });

  it('compara sem diferença de maiúsculas e espaços', () => {
    const { aoTexto, rec } = preparar();
    rec.falar(0, [['Ligar para  Renata', true], ['ligar para renata amanhã', true]]);
    expect(aoTexto).toHaveBeenLastCalledWith('ligar para renata amanhã', false);
  });

  it('trechos diferentes continuam todos', () => {
    const { aoTexto, rec } = preparar();
    rec.falar(0, [['comprar pão', true], ['ligar para Renata', true]]);
    expect(aoTexto).toHaveBeenLastCalledWith('comprar pão ligar para Renata', false);
  });

  it('no reinício, tira do começo da sessão nova o que repete o fim de antes', async () => {
    const { escuta, aoTexto, rec } = preparar();
    rec.falar(0, [['revisar o relatório da Aurora', true]]);
    sessaoLonga();
    rec.onend?.();
    rec.falar(0, [['relatório da Aurora hoje à tarde', true]]);
    expect(aoTexto).toHaveBeenLastCalledWith('revisar o relatório da Aurora hoje à tarde', false);
    expect(await escuta.parar()).toBe('revisar o relatório da Aurora hoje à tarde');
  });

  it('uma palavra igual não conta como repetição (pode ser fala de verdade)', () => {
    const { aoTexto, rec } = preparar();
    rec.falar(0, [['isso não', true]]);
    sessaoLonga();
    rec.onend?.();
    rec.falar(0, [['não vou', true]]);
    expect(aoTexto).toHaveBeenLastCalledWith('isso não não vou', false);
  });
});

describe('iniciarEscuta: parar()', () => {
  beforeEach(() => vi.useFakeTimers());

  it('recebe o último final que o navegador entrega depois do stop, antes do fim', async () => {
    const { escuta, rec } = preparar();
    rec.finalDepoisDoStop = 'fechar o dia';
    expect(await escuta.parar()).toBe('fechar o dia');
  });

  it('chamadas repetidas devolvem a mesma promessa', () => {
    const { escuta } = preparar();
    expect(escuta.parar()).toBe(escuta.parar());
  });

  it('se o fim nunca chega, aos 2 s chama abort()', async () => {
    const { escuta, rec } = preparar();
    rec.stop = () => {};
    const p = escuta.parar();
    await vi.advanceTimersByTimeAsync(2000);
    await p;
    expect(rec.abortado).toBe(1);
  });

  it('se a escuta já terminou (erro fatal), responde na hora, sem esperar 2 s', async () => {
    const { escuta, rec } = preparar();
    rec.falar(0, [['já falei', true]]);
    rec.onerror?.({ error: 'network' });
    rec.onend?.();
    rec.stop = () => {}; // não chamaria onend de novo
    expect(await escuta.parar()).toBe('já falei'); // sem avançar o relógio
  });

  it('parar durante a espera de um reinício cancela o reinício', async () => {
    const { escuta, rec } = preparar();
    rec.falar(0, [['quase', true]]);
    rec.onend?.(); // fim rápido: reinício em 500 ms
    expect(await escuta.parar()).toBe('quase');
    vi.advanceTimersByTime(5000);
    expect(rec.iniciado).toBe(1);
  });
});
