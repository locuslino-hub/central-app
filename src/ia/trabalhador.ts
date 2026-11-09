// Trabalhador da IA local (Tarefa 21): roda fora da tela, para o app não travar
// enquanto o modelo baixa, abre ou pensa.
//
// - Baixa o Gemma 4 E4B uma vez, só quando o dono pede, direto para a pasta
//   privada do app no aparelho (OPFS). O cache do navegador não guardou o
//   modelo na prova de 8/11 (PROVAS.md): por isso a gravação é explícita.
// - Abre o modelo com o `@litert-lm/core` empacotado no app; os arquivos wasm
//   saem do próprio site (`litertlm/<versão>/`), não de CDN (R18), e ficam
//   guardados no aparelho junto do modelo (src/ia/runtime.ts): sem internet a
//   IA abre do mesmo jeito.
// - Responde às frases do chat. A frase só chega por `postMessage` e só vai ao
//   modelo, no aparelho: as únicas chamadas de rede daqui são o download do
//   modelo e dos arquivos do motor.
//
// A lógica fica em `criarTratador`, com as dependências de fora, para ser
// testada sem modelo, sem rede e sem pasta privada.

import { Engine, loadLiteRtLm, type Conversation, type Message } from '@litert-lm/core';
import { MODELO } from './modelo';
import { runtimeGuardado, varianteDoNavegador, type ArquivosDoMotor, type Runtime } from './runtime';

export { MODELO };

/** Folga de espaço livre exigida além do tamanho do modelo. */
const FOLGA = 1.1;

export type Motivo = 'sem-suporte' | 'sem-espaco' | 'sem-internet' | 'falhou' | 'cancelado';

/** Da tela para o trabalhador. */
export type Pedido =
  | { tipo: 'verificar' }
  /** `wasm`: endereço completo da pasta com os arquivos wasm do app (`litertlm/<versão>/`), com `/` no fim. */
  | { tipo: 'baixar'; wasm: string }
  | { tipo: 'cancelar-download' }
  | { tipo: 'carregar'; wasm: string }
  | { tipo: 'perguntar'; id: number; sistema: string; frase: string }
  | { tipo: 'cancelar'; id: number }
  | { tipo: 'apagar' };

/** Do trabalhador para a tela. */
export type Resposta =
  | { tipo: 'verificado'; guardado: boolean }
  | { tipo: 'progresso'; baixados: number; total: number }
  | { tipo: 'baixado' }
  | { tipo: 'carregada' }
  | { tipo: 'resposta'; id: number; texto: string }
  | { tipo: 'apagado' }
  | {
      tipo: 'erro';
      etapa: 'verificar' | 'baixar' | 'carregar' | 'perguntar' | 'apagar';
      motivo: Motivo;
      id?: number;
      mensagem?: string;
    };

/** Onde o modelo fica guardado no aparelho. */
export type Guarda = {
  /** O modelo está inteiro no aparelho. */
  existe(): Promise<boolean>;
  /** Grava o modelo; falha (e não marca como guardado) se o tamanho não bater. */
  gravar(dados: ReadableStream<Uint8Array>, total: number, aoProgredir: (baixados: number) => void): Promise<void>;
  ler(): Promise<Blob>;
  apagar(): Promise<void>;
};

/** O modelo aberto. */
export type Motor = {
  perguntar(sistema: string, frase: string): Promise<string>;
  cancelar(): void;
  liberar(): Promise<void>;
};

export type Dependencias = {
  guarda: Guarda;
  /** Os arquivos do motor (carregador `.js` e `.wasm`), guardados junto do modelo. */
  runtime: Runtime;
  /** O download do modelo. */
  baixar(sinal: AbortSignal): Promise<Response>;
  /** Bytes livres para o app, ou `null` se o navegador não diz. */
  espacoLivre(): Promise<number | null>;
  criarMotor(modelo: Blob, arquivos: ArquivosDoMotor): Promise<Motor>;
};

const ehCancelamento = (erro: unknown) => erro instanceof DOMException && erro.name === 'AbortError';

/** Trata um pedido por vez de cada tipo; perguntas esperam a anterior. */
export function criarTratador(deps: Dependencias, responder: (resposta: Resposta) => void) {
  let motor: Motor | null = null;
  /** Abertura em curso: dois pedidos de carregar esperam a mesma. */
  let abrindo: Promise<Motor> | null = null;
  let download: AbortController | null = null;
  /** O download em curso, para `apagar` esperar ele parar. */
  let baixando: Promise<void> | null = null;
  let perguntaAtual: number | null = null;
  /** Perguntas desistidas antes de chegar a vez delas. */
  const canceladas = new Set<number>();
  let filaDePerguntas: Promise<void> = Promise.resolve();

  function baixar(wasm: string): Promise<void> {
    if (baixando) return baixando; // já está baixando
    const controle = new AbortController();
    download = controle;
    baixando = baixarAgora(controle, wasm).finally(() => {
      download = null;
      baixando = null;
    });
    return baixando;
  }

  // O pedaço de um download que falhou é limpo pela própria guarda, e só se
  // ela chegou a abrir o arquivo: com o app em duas abas, a outra pode estar
  // gravando ou já ter o modelo inteiro.
  async function baixarAgora(controle: AbortController, wasm: string) {
    const livre = await deps.espacoLivre();
    if (livre !== null && livre < MODELO.tamanho * FOLGA) {
      responder({ tipo: 'erro', etapa: 'baixar', motivo: 'sem-espaco' });
      return;
    }
    let resposta: Response;
    try {
      resposta = await deps.baixar(controle.signal);
    } catch {
      responder({ tipo: 'erro', etapa: 'baixar', motivo: controle.signal.aborted ? 'cancelado' : 'sem-internet' });
      return;
    }
    if (!resposta.ok || !resposta.body) {
      responder({ tipo: 'erro', etapa: 'baixar', motivo: 'falhou', mensagem: `HTTP ${resposta.status}` });
      return;
    }
    const total = MODELO.tamanho;
    // Um aviso por ponto percentual: 3 GB em pedaços de 64 KB seriam 45 mil.
    const passo = Math.max(1, Math.floor(total / 100));
    let avisado = 0;
    responder({ tipo: 'progresso', baixados: 0, total });
    try {
      await deps.guarda.gravar(resposta.body, total, (baixados) => {
        if (baixados - avisado >= passo || (baixados >= total && avisado < total)) {
          avisado = baixados;
          responder({ tipo: 'progresso', baixados, total });
        }
      });
      if (controle.signal.aborted) throw new DOMException('cancelado', 'AbortError');
    } catch (erro) {
      const cancelado = controle.signal.aborted || ehCancelamento(erro);
      if (!cancelado) console.error('Download da IA falhou', erro);
      const espaco = erro instanceof DOMException && erro.name === 'QuotaExceededError';
      responder({ tipo: 'erro', etapa: 'baixar', motivo: cancelado ? 'cancelado' : espaco ? 'sem-espaco' : 'falhou' });
      return;
    }
    // Os arquivos do motor vão junto, para a IA abrir sem internet. Se falhar aqui,
    // o modelo continua guardado e a abertura (logo em seguida) tenta de novo.
    await deps.runtime.guardar(wasm).catch((erro) => console.warn('Arquivos do motor da IA não guardados', erro));
    responder({ tipo: 'baixado' });
  }

  async function carregar(wasm: string) {
    try {
      if (!motor) {
        abrindo ??= (async () => {
          // Já guardados, nada vai à rede; quem baixou o modelo antes disso ganha os arquivos agora (com internet).
          await deps.runtime.guardar(wasm);
          return deps.criarMotor(await deps.guarda.ler(), await deps.runtime.abrir(wasm));
        })().finally(() => {
          abrindo = null;
        });
        motor = await abrindo;
      }
      responder({ tipo: 'carregada' });
    } catch (erro) {
      console.error('Não consegui abrir a IA', erro);
      responder({ tipo: 'erro', etapa: 'carregar', motivo: 'falhou', mensagem: String(erro) });
    }
  }

  function perguntar(id: number, sistema: string, frase: string): Promise<void> {
    const vez = filaDePerguntas.then(async () => {
      if (canceladas.delete(id)) {
        responder({ tipo: 'erro', etapa: 'perguntar', motivo: 'cancelado', id });
        return;
      }
      if (!motor) {
        responder({ tipo: 'erro', etapa: 'perguntar', motivo: 'falhou', id });
        return;
      }
      perguntaAtual = id;
      try {
        responder({ tipo: 'resposta', id, texto: await motor.perguntar(sistema, frase) });
      } catch (erro) {
        responder({ tipo: 'erro', etapa: 'perguntar', motivo: 'falhou', id, mensagem: String(erro) });
      } finally {
        perguntaAtual = null;
      }
    });
    filaDePerguntas = vez.catch(() => {});
    return vez;
  }

  async function apagar() {
    try {
      download?.abort();
      // O arquivo só pode ser apagado depois que o download soltar ele.
      await baixando?.catch(() => {});
      const aberto = motor;
      motor = null;
      await aberto?.liberar().catch(() => {});
      await deps.guarda.apagar();
      await deps.runtime.apagar();
      responder({ tipo: 'apagado' });
    } catch (erro) {
      responder({ tipo: 'erro', etapa: 'apagar', motivo: 'falhou', mensagem: String(erro) });
    }
  }

  return async function tratar(pedido: Pedido): Promise<void> {
    switch (pedido.tipo) {
      case 'verificar':
        try {
          responder({ tipo: 'verificado', guardado: await deps.guarda.existe() });
        } catch (erro) {
          responder({ tipo: 'erro', etapa: 'verificar', motivo: 'sem-suporte', mensagem: String(erro) });
        }
        return;
      case 'baixar':
        return baixar(pedido.wasm);
      case 'cancelar-download':
        download?.abort();
        return;
      case 'carregar':
        return carregar(pedido.wasm);
      case 'perguntar':
        return perguntar(pedido.id, pedido.sistema, pedido.frase);
      case 'cancelar':
        if (perguntaAtual === pedido.id) motor?.cancelar();
        else canceladas.add(pedido.id);
        return;
      case 'apagar':
        return apagar();
    }
  };
}

// ---- Pasta privada (OPFS) ----

/** O pedaço da pasta privada que a guarda usa (a escrita síncrona só existe em trabalhadores). */
export type Pasta = {
  getFileHandle(nome: string, opcoes?: { create?: boolean }): Promise<{
    getFile(): Promise<File>;
    createSyncAccessHandle(): Promise<{
      truncate(tamanho: number): void;
      write(dados: Uint8Array, opcoes: { at: number }): number;
      flush(): void;
      close(): void;
    }>;
  }>;
  removeEntry(nome: string): Promise<void>;
};

const naoExiste = (erro: unknown) =>
  erro instanceof DOMException && (erro.name === 'NotFoundError' || erro.name === 'TypeMismatchError');

/**
 * Guarda o modelo num arquivo da pasta privada. Uma marca (`<arquivo>.ok`) só
 * é gravada depois do arquivo inteiro: download interrompido nunca conta.
 */
export function guardaNaPasta(abrir: () => Promise<Pasta>, modelo: { arquivo: string; tamanho: number }): Guarda {
  const marca = `${modelo.arquivo}.ok`;
  const remover = async (pasta: Pasta, nome: string) => {
    try {
      await pasta.removeEntry(nome);
    } catch (erro) {
      if (!naoExiste(erro)) throw erro;
    }
  };

  return {
    async existe() {
      const pasta = await abrir();
      try {
        await pasta.getFileHandle(marca);
        const arquivo = await (await pasta.getFileHandle(modelo.arquivo)).getFile();
        return arquivo.size === modelo.tamanho;
      } catch (erro) {
        if (naoExiste(erro)) return false;
        throw erro;
      }
    },

    async gravar(dados, total, aoProgredir) {
      const pasta = await abrir();
      // Abrir primeiro: se outra aba está gravando, isto falha e nada dela é mexido.
      const escrita = await (await pasta.getFileHandle(modelo.arquivo, { create: true })).createSyncAccessHandle();
      let gravados = 0;
      let completo = false;
      try {
        await remover(pasta, marca);
        escrita.truncate(0);
        const leitor = dados.getReader();
        for (;;) {
          const { done, value } = await leitor.read();
          if (done) break;
          gravados += escrita.write(value, { at: gravados });
          aoProgredir(gravados);
        }
        escrita.flush();
        if (gravados !== total) throw new Error(`Modelo incompleto: ${gravados} de ${total} bytes`);
        completo = true;
      } finally {
        escrita.close();
        if (!completo) await remover(pasta, modelo.arquivo).catch(() => {});
      }
      await pasta.getFileHandle(marca, { create: true });
    },

    async ler() {
      return (await (await abrir()).getFileHandle(modelo.arquivo)).getFile();
    },

    async apagar() {
      const pasta = await abrir();
      await remover(pasta, marca);
      await remover(pasta, modelo.arquivo);
    },
  };
}

// ---- O motor de verdade ----

function textoDa(mensagem: Message): string {
  const { content } = mensagem;
  if (typeof content === 'string') return content;
  return (content ?? []).map((parte) => (parte.type === 'text' ? String(parte.text) : '')).join('');
}

/** O LiteRT-LM carrega uma vez por trabalhador; numa nova tentativa só o modelo abre de novo. */
let motorCarregado: Promise<unknown> | null = null;

/** Abre o modelo com o LiteRT-LM empacotado, lendo os arquivos do motor guardados no aparelho. */
async function criarMotorReal(modelo: Blob, arquivos: ArquivosDoMotor): Promise<Motor> {
  try {
    motorCarregado ??= (async () => {
      // O carregador procura o `.wasm` ao lado do script; `locateFile` aponta para o guardado.
      (self as unknown as { Module?: unknown }).Module = {
        locateFile: (arquivo: string) => (arquivo.endsWith('.wasm') ? arquivos.wasm : arquivo),
      };
      return loadLiteRtLm(arquivos.js);
    })().catch((erro) => {
      motorCarregado = null;
      throw new Error(`O motor da IA não carregou: ${erro}`);
    });
    await motorCarregado;
  } finally {
    arquivos.liberar();
  }
  let motor: Engine;
  try {
    motor = await Engine.create({ model: modelo, mainExecutorSettings: { maxNumTokens: 2048 } });
  } catch (erro) {
    throw new Error(`O modelo não abriu: ${erro}`);
  }
  let conversa: Conversation | null = null;
  return {
    async perguntar(sistema, frase) {
      conversa = await motor.createConversation({
        preface: { messages: [{ role: 'system', content: sistema }] },
        sessionConfig: { maxOutputTokens: 400 },
      });
      try {
        return textoDa(await conversa.sendMessage(frase));
      } finally {
        const fim = conversa;
        conversa = null;
        await fim.delete().catch(() => {});
      }
    },
    cancelar() {
      conversa?.cancel();
    },
    liberar: () => motor.delete(),
  };
}

type EscopoDoTrabalhador = {
  postMessage(resposta: Resposta): void;
  onmessage: ((evento: MessageEvent<Pedido>) => void) | null;
  importScripts?: unknown;
};

/** Liga o tratador quando este arquivo roda como trabalhador (não nos testes). */
function ligar() {
  const escopo = self as unknown as EscopoDoTrabalhador;
  const tratar = criarTratador(
    {
      guarda: guardaNaPasta(() => navigator.storage.getDirectory() as unknown as Promise<Pasta>, MODELO),
      runtime: runtimeGuardado({
        armazem: caches,
        versao: __VERSAO_LITERTLM__,
        variante: varianteDoNavegador,
        baixar: (url) => fetch(url, { credentials: 'same-origin' }),
        criarUrl: (blob) => URL.createObjectURL(blob),
        revogarUrl: (url) => URL.revokeObjectURL(url),
      }),
      baixar: (sinal) => fetch(MODELO.url, { signal: sinal, credentials: 'omit', referrerPolicy: 'no-referrer' }),
      async espacoLivre() {
        try {
          const { quota, usage } = await navigator.storage.estimate();
          return quota === undefined ? null : quota - (usage ?? 0);
        } catch {
          return null;
        }
      },
      criarMotor: criarMotorReal,
    },
    (resposta) => escopo.postMessage(resposta),
  );
  escopo.onmessage = (evento) => void tratar(evento.data);
}

if (typeof window === 'undefined' && typeof self !== 'undefined' && 'importScripts' in self) ligar();
