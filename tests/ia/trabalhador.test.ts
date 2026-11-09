import { describe, expect, it, vi } from 'vitest';
import {
  criarTratador, guardaNaPasta, MODELO, type Dependencias, type Guarda, type Motor, type Pasta, type Resposta,
} from '../../src/ia/trabalhador';

/** Corpo de resposta em pedaços, como o download do modelo. */
function corpo(pedacos: number[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controle) {
      for (const n of pedacos) controle.enqueue(new Uint8Array(n).fill(7));
      controle.close();
    },
  });
}

function guardaFalsa(guardado = false): Guarda & { bytes: number; apagou: number } {
  const guarda = {
    bytes: guardado ? 10 : 0,
    apagou: 0,
    existe: async () => guarda.bytes > 0,
    async gravar(dados: ReadableStream<Uint8Array>, total: number, aoProgredir: (n: number) => void) {
      let n = 0;
      for await (const pedaco of dados as unknown as AsyncIterable<Uint8Array>) {
        n += pedaco.byteLength;
        aoProgredir(n);
      }
      if (n !== total) throw new Error('tamanho errado');
      guarda.bytes = n;
    },
    ler: async () => new Blob([new Uint8Array(guarda.bytes)]),
    apagar: async () => {
      guarda.bytes = 0;
      guarda.apagou++;
    },
  };
  return guarda;
}

function motorFalso(texto = '{"itens":[]}'): Motor & { perguntas: string[]; cancelou: number } {
  const motor = {
    perguntas: [] as string[],
    cancelou: 0,
    perguntar: async (_sistema: string, frase: string) => {
      motor.perguntas.push(frase);
      return texto;
    },
    cancelar: () => {
      motor.cancelou++;
    },
    liberar: async () => {},
  };
  return motor;
}

function montar(deps: Partial<Dependencias> = {}) {
  const respostas: Resposta[] = [];
  const guarda = (deps.guarda as ReturnType<typeof guardaFalsa>) ?? guardaFalsa();
  const motor = motorFalso();
  const completas: Dependencias = {
    guarda,
    baixar: vi.fn(async () => new Response(corpo([10]))),
    espacoLivre: async () => null,
    criarMotor: vi.fn(async () => motor),
    ...deps,
  };
  const tratar = criarTratador(completas, (r) => respostas.push(r));
  return { tratar, respostas, guarda, motor, deps: completas };
}

describe('modelo', () => {
  it('é o Gemma 4 E4B fixado num commit, com o tamanho conhecido', () => {
    expect(MODELO.url).toMatch(
      /^https:\/\/huggingface\.co\/litert-community\/gemma-4-E4B-it-litert-lm\/resolve\/[0-9a-f]{40}\/gemma-4-E4B-it-gpu\.litertlm$/,
    );
    expect(MODELO.tamanho).toBeGreaterThan(2_000_000_000);
  });
});

describe('tratador do trabalhador', () => {
  it('verificar diz se o modelo está guardado', async () => {
    const { tratar, respostas } = montar({ guarda: guardaFalsa(true) });
    await tratar({ tipo: 'verificar' });
    expect(respostas).toEqual([{ tipo: 'verificado', guardado: true }]);
  });

  it('baixar grava o modelo, avisa o progresso e termina com "baixado"', async () => {
    const tamanho = MODELO.tamanho;
    const metade = Math.floor(tamanho / 2);
    // Corpo falso: dois pedaços "grandes" sem alocar 3 GB.
    const baixar = vi.fn(async () => new Response(corpo([4, 6])));
    const guarda = guardaFalsa();
    guarda.gravar = async (_dados, total, aoProgredir) => {
      expect(total).toBe(tamanho);
      aoProgredir(metade);
      aoProgredir(tamanho);
      guarda.bytes = tamanho;
    };
    const { tratar, respostas } = montar({ baixar, guarda });
    await tratar({ tipo: 'baixar' });
    expect(baixar).toHaveBeenCalledTimes(1);
    expect(respostas).toEqual([
      { tipo: 'progresso', baixados: 0, total: tamanho },
      { tipo: 'progresso', baixados: metade, total: tamanho },
      { tipo: 'progresso', baixados: tamanho, total: tamanho },
      { tipo: 'baixado' },
    ]);
  });

  it('progresso miúdo não inunda a tela: no máximo um aviso por por cento', async () => {
    const guarda = guardaFalsa();
    guarda.gravar = async (_d, total, aoProgredir) => {
      for (let n = 1; n <= 1000; n++) aoProgredir(Math.floor((total * n) / 1000));
    };
    const { tratar, respostas } = montar({ guarda });
    await tratar({ tipo: 'baixar' });
    const avisos = respostas.filter((r) => r.tipo === 'progresso');
    expect(avisos.length).toBeLessThanOrEqual(102);
    expect(avisos.at(-1)).toEqual({ tipo: 'progresso', baixados: MODELO.tamanho, total: MODELO.tamanho });
  });

  it('sem espaço livre não baixa nada', async () => {
    const baixar = vi.fn(async () => new Response(corpo([10])));
    const { tratar, respostas } = montar({ baixar, espacoLivre: async () => MODELO.tamanho / 2 });
    await tratar({ tipo: 'baixar' });
    expect(baixar).not.toHaveBeenCalled();
    expect(respostas).toEqual([{ tipo: 'erro', etapa: 'baixar', motivo: 'sem-espaco' }]);
  });

  it('sem internet vira "sem-internet" e não apaga nada (outra aba pode ter o modelo)', async () => {
    const { tratar, respostas, guarda } = montar({ baixar: async () => Promise.reject(new TypeError('Failed to fetch')) });
    await tratar({ tipo: 'baixar' });
    expect(respostas.at(-1)).toEqual({ tipo: 'erro', etapa: 'baixar', motivo: 'sem-internet' });
    expect(guarda.apagou).toBe(0);
  });

  it('resposta de erro do servidor vira "falhou"', async () => {
    const { tratar, respostas } = montar({ baixar: async () => new Response('não', { status: 404 }) });
    await tratar({ tipo: 'baixar' });
    expect(respostas.at(-1)).toEqual({ tipo: 'erro', etapa: 'baixar', motivo: 'falhou', mensagem: 'HTTP 404' });
  });

  it('download incompleto vira "falhou"; quem limpa o pedaço é a guarda, não o trabalhador', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { tratar, respostas, guarda } = montar({ baixar: async () => new Response(corpo([3])) });
    await tratar({ tipo: 'baixar' });
    expect(respostas.at(-1)).toEqual({ tipo: 'erro', etapa: 'baixar', motivo: 'falhou' });
    expect(guarda.apagou).toBe(0);
  });

  it('cancelar o download para tudo', async () => {
    let sinal: AbortSignal | undefined;
    const guarda = guardaFalsa();
    let liberar: () => void = () => {};
    guarda.gravar = async () => {
      await new Promise<void>((r) => (liberar = r));
      if (sinal?.aborted) throw new DOMException('cancelado', 'AbortError');
    };
    const { tratar, respostas } = montar({
      guarda,
      baixar: async (s) => {
        sinal = s;
        return new Response(corpo([1]));
      },
    });
    const download = tratar({ tipo: 'baixar' });
    await new Promise((r) => setTimeout(r, 0));
    await tratar({ tipo: 'cancelar-download' });
    liberar();
    await download;
    expect(sinal?.aborted).toBe(true);
    expect(respostas.at(-1)).toEqual({ tipo: 'erro', etapa: 'baixar', motivo: 'cancelado' });
  });

  it('apagar durante o download espera o download parar antes de apagar', async () => {
    const guarda = guardaFalsa();
    let gravando = false;
    guarda.gravar = async (dados) => {
      gravando = true;
      try {
        for await (const _ of dados as unknown as AsyncIterable<Uint8Array>) {
          // lê até o download ser cortado
        }
      } finally {
        gravando = false;
      }
    };
    guarda.apagar = async () => {
      if (gravando) throw new DOMException('arquivo em uso', 'NoModificationAllowedError');
      guarda.apagou++;
    };
    const { tratar, respostas } = montar({
      guarda,
      baixar: async (sinal) =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controle) {
              sinal.addEventListener('abort', () => controle.error(new DOMException('cortado', 'AbortError')));
            },
          }),
        ),
    });
    const download = tratar({ tipo: 'baixar' });
    await new Promise((r) => setTimeout(r, 0));
    await tratar({ tipo: 'apagar' });
    await download;
    expect(guarda.apagou).toBe(1);
    expect(respostas).toContainEqual({ tipo: 'apagado' });
  });

  it('carregar abre o modelo guardado com os arquivos do próprio app', async () => {
    const { tratar, respostas, deps } = montar({ guarda: guardaFalsa(true) });
    await tratar({ tipo: 'carregar', wasm: 'https://exemplo.test/central-app/litertlm/' });
    expect(deps.criarMotor).toHaveBeenCalledWith(expect.any(Blob), 'https://exemplo.test/central-app/litertlm/');
    expect(respostas).toEqual([{ tipo: 'carregada' }]);
  });

  it('dois pedidos de carregar abrem um motor só', async () => {
    const { tratar, respostas, deps } = montar({ guarda: guardaFalsa(true) });
    await Promise.all([tratar({ tipo: 'carregar', wasm: 'x/' }), tratar({ tipo: 'carregar', wasm: 'x/' })]);
    expect(deps.criarMotor).toHaveBeenCalledTimes(1);
    expect(respostas).toEqual([{ tipo: 'carregada' }, { tipo: 'carregada' }]);
  });

  it('carregar de novo depois de falhar tenta abrir outra vez', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const motor = { perguntar: async () => '', cancelar: () => {}, liberar: async () => {} };
    const criarMotor = vi.fn().mockRejectedValueOnce(new Error('GPU ocupada')).mockResolvedValueOnce(motor);
    const { tratar, respostas } = montar({ guarda: guardaFalsa(true), criarMotor });
    await tratar({ tipo: 'carregar', wasm: 'x/' });
    await tratar({ tipo: 'carregar', wasm: 'x/' });
    expect(criarMotor).toHaveBeenCalledTimes(2);
    expect(respostas.at(-1)).toEqual({ tipo: 'carregada' });
  });

  it('erro ao carregar vira "falhou"', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { tratar, respostas } = montar({
      guarda: guardaFalsa(true),
      criarMotor: async () => Promise.reject(new Error('sem WebGPU')),
    });
    await tratar({ tipo: 'carregar', wasm: 'x/' });
    expect(respostas).toEqual([{ tipo: 'erro', etapa: 'carregar', motivo: 'falhou', mensagem: 'Error: sem WebGPU' }]);
  });

  it('perguntar responde com o texto do modelo e não usa a rede', async () => {
    const { tratar, respostas, motor, deps } = montar({ guarda: guardaFalsa(true) });
    const rede = vi.fn();
    vi.stubGlobal('fetch', rede);
    await tratar({ tipo: 'carregar', wasm: 'x/' });
    await tratar({ tipo: 'perguntar', id: 4, sistema: 'Instruções', frase: 'Ligar para a Renata' });
    expect(motor.perguntas).toEqual(['Ligar para a Renata']);
    expect(respostas.at(-1)).toEqual({ tipo: 'resposta', id: 4, texto: '{"itens":[]}' });
    expect(rede).not.toHaveBeenCalled();
    expect(deps.baixar).not.toHaveBeenCalled();
  });

  it('perguntar sem modelo carregado responde erro', async () => {
    const { tratar, respostas } = montar();
    await tratar({ tipo: 'perguntar', id: 1, sistema: 'x', frase: 'y' });
    expect(respostas).toEqual([{ tipo: 'erro', etapa: 'perguntar', motivo: 'falhou', id: 1 }]);
  });

  it('cancelar a pergunta em curso para o modelo', async () => {
    const { tratar, motor } = montar({ guarda: guardaFalsa(true) });
    await tratar({ tipo: 'carregar', wasm: 'x/' });
    let soltar: () => void = () => {};
    motor.perguntar = () => new Promise((r) => (soltar = () => r('')));
    const pergunta = tratar({ tipo: 'perguntar', id: 9, sistema: 'x', frase: 'y' });
    await new Promise((r) => setTimeout(r, 0));
    await tratar({ tipo: 'cancelar', id: 9 });
    soltar();
    await pergunta;
    expect(motor.cancelou).toBe(1);
  });

  it('pergunta cancelada enquanto espera na fila não roda', async () => {
    const { tratar, motor, respostas } = montar({ guarda: guardaFalsa(true) });
    await tratar({ tipo: 'carregar', wasm: 'x/' });
    let soltar: () => void = () => {};
    const perguntas: string[] = [];
    motor.perguntar = (_s, frase) => {
      perguntas.push(frase);
      return frase === 'primeira' ? new Promise((r) => (soltar = () => r('{}'))) : Promise.resolve('{}');
    };
    const primeira = tratar({ tipo: 'perguntar', id: 1, sistema: 'x', frase: 'primeira' });
    const segunda = tratar({ tipo: 'perguntar', id: 2, sistema: 'x', frase: 'segunda' });
    await new Promise((r) => setTimeout(r, 0));
    await tratar({ tipo: 'cancelar', id: 2 });
    soltar();
    await Promise.all([primeira, segunda]);
    expect(perguntas).toEqual(['primeira']);
    expect(respostas).toContainEqual({ tipo: 'erro', etapa: 'perguntar', motivo: 'cancelado', id: 2 });
  });

  it('apagar tira o modelo do aparelho', async () => {
    const { tratar, respostas, guarda } = montar({ guarda: guardaFalsa(true) });
    await tratar({ tipo: 'carregar', wasm: 'x/' });
    await tratar({ tipo: 'apagar' });
    expect(guarda.apagou).toBe(1);
    expect(respostas.at(-1)).toEqual({ tipo: 'apagado' });
  });
});

/** Pasta privada falsa: arquivos em memória, com a escrita síncrona dos trabalhadores. */
function pastaFalsa(): Pasta & { arquivos: Map<string, Uint8Array> } {
  const arquivos = new Map<string, Uint8Array>();
  return {
    arquivos,
    async getFileHandle(nome, opcoes) {
      if (!arquivos.has(nome)) {
        if (!opcoes?.create) throw new DOMException('não existe', 'NotFoundError');
        arquivos.set(nome, new Uint8Array());
      }
      return {
        getFile: async () => new File([arquivos.get(nome)!.slice()], nome),
        createSyncAccessHandle: async () => ({
          truncate: (n: number) => arquivos.set(nome, arquivos.get(nome)!.slice(0, n)),
          write: (dados: Uint8Array, { at }: { at: number }) => {
            const atual = arquivos.get(nome)!;
            const novo = new Uint8Array(Math.max(atual.length, at + dados.length));
            novo.set(atual);
            novo.set(dados, at);
            arquivos.set(nome, novo);
            return dados.length;
          },
          flush: () => {},
          close: () => {},
        }),
      };
    },
    async removeEntry(nome) {
      if (!arquivos.delete(nome)) throw new DOMException('não existe', 'NotFoundError');
    },
  };
}

describe('guarda na pasta privada', () => {
  it('grava os pedaços em ordem e só depois marca como completo', async () => {
    const pasta = pastaFalsa();
    const guarda = guardaNaPasta(async () => pasta, { arquivo: 'modelo.bin', tamanho: 6 });
    expect(await guarda.existe()).toBe(false);
    const vistos: number[] = [];
    await guarda.gravar(corpo([2, 4]), 6, (n) => vistos.push(n));
    expect(vistos).toEqual([2, 6]);
    expect(await guarda.existe()).toBe(true);
    expect((await guarda.ler()).size).toBe(6);
  });

  it('tamanho errado não conta como guardado', async () => {
    const pasta = pastaFalsa();
    const guarda = guardaNaPasta(async () => pasta, { arquivo: 'modelo.bin', tamanho: 6 });
    await expect(guarda.gravar(corpo([2]), 6, () => {})).rejects.toThrow();
    expect(await guarda.existe()).toBe(false);
  });

  it('marca sem arquivo do tamanho certo não conta', async () => {
    const pasta = pastaFalsa();
    const guarda = guardaNaPasta(async () => pasta, { arquivo: 'modelo.bin', tamanho: 6 });
    await guarda.gravar(corpo([6]), 6, () => {});
    pasta.arquivos.set('modelo.bin', new Uint8Array(3));
    expect(await guarda.existe()).toBe(false);
  });

  it('falha no meio da gravação apaga o pedaço gravado', async () => {
    const pasta = pastaFalsa();
    const guarda = guardaNaPasta(async () => pasta, { arquivo: 'modelo.bin', tamanho: 6 });
    const quebrado = new ReadableStream<Uint8Array>({
      start(controle) {
        controle.enqueue(new Uint8Array(2));
        controle.error(new TypeError('rede caiu'));
      },
    });
    await expect(guarda.gravar(quebrado, 6, () => {})).rejects.toThrow('rede caiu');
    expect(pasta.arquivos.has('modelo.bin')).toBe(false);
  });

  it('se outra aba está gravando (arquivo travado), não apaga nada dela', async () => {
    const pasta = pastaFalsa();
    const guarda = guardaNaPasta(async () => pasta, { arquivo: 'modelo.bin', tamanho: 6 });
    await guarda.gravar(corpo([6]), 6, () => {});
    const original = pasta.getFileHandle.bind(pasta);
    pasta.getFileHandle = async (nome, opcoes) => {
      const alca = await original(nome, opcoes);
      return {
        ...alca,
        createSyncAccessHandle: async () => {
          throw new DOMException('travado por outra aba', 'NoModificationAllowedError');
        },
      };
    };
    await expect(guarda.gravar(corpo([6]), 6, () => {})).rejects.toThrow('travado');
    expect(pasta.arquivos.get('modelo.bin')?.length).toBe(6);
    expect(pasta.arquivos.has('modelo.bin.ok')).toBe(true);
  });

  it('apagar tira o modelo e a marca, mesmo se faltar algum', async () => {
    const pasta = pastaFalsa();
    const guarda = guardaNaPasta(async () => pasta, { arquivo: 'modelo.bin', tamanho: 6 });
    await guarda.apagar();
    await guarda.gravar(corpo([6]), 6, () => {});
    await guarda.apagar();
    expect(pasta.arquivos.size).toBe(0);
    expect(await guarda.existe()).toBe(false);
  });
});
