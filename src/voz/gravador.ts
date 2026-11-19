// Gravador de áudio e envio ao Drive (V02, Tarefa 5). O áudio só é gravado se o
// dono ligar a chave "Gravar áudio" (Tarefa 6); a Tarefa 1 mostrou que gravar e
// reconhecer ao mesmo tempo funciona no celular Android. O envio usa a ação `salvarAudio`
// do script. Sem rede (ou script ocupado), o áudio fica neste aparelho, em
// `audios-pendentes`, e `reenviarAudiosPendentes` tenta de novo depois.
import { ErroConexao, ErroScript, chamar as chamarScript } from '../conexao/cliente';
import { AUDIO_BASE64_NO_MAXIMO } from '../../script/audio';
import { listar } from '../dados/loja';
import { apagarAudioDoDrive } from './apagar-audio';
import {
  contarAudios,
  existeAudio,
  guardarAudio,
  listarAudios,
  removerAudio,
  tamanhoDosAudios,
} from './audios-pendentes';

/** Aviso aos 150 s; corta aos 180 s. */
export const AVISO_EM_SEGUNDOS = 150;
export const LIMITE_EM_SEGUNDOS = 180;
/** Se o evento `stop` não vier, o blob sai do que já foi coletado depois disto. */
const ESPERA_DO_STOP_MS = 3000;
/** O servidor aceita 6 MB de base64; em bytes crus isso é 3/4 (~4,5 MB). */
export const BYTES_NO_MAXIMO = Math.floor(AUDIO_BASE64_NO_MAXIMO / 4) * 3;
/** Áudios guardados à espera de rede, no máximo; o novo é recusado, nenhum antigo é apagado. */
export const AUDIOS_NA_FILA_NO_MAXIMO = 20;
/** Erros do script (não de rede) que um áudio aguenta antes de ser marcado como `falhou`. */
export const TENTATIVAS_ATE_FALHAR = 5;
/** Envio de áudio é pesado: mais tempo que os 30 s dos outros pedidos. */
const TEMPO_LIMITE_DO_ENVIO_MS = 120_000;

export type AvisoDeGravacao = 'quase_no_limite' | 'limite';
export type Gravacao = {
  /**
   * Para e entrega o áudio. Depois do aviso `'limite'` a gravação já foi
   * cortada sozinha, mas o áudio só chega quando quem chamou usa `parar()`:
   * chame-o. Se o navegador não avisar o fim em 3 s, o áudio sai do que já foi
   * coletado. Rejeita se `cancelar()` for chamado (antes ou durante a espera).
   */
  parar(): Promise<{ blob: Blob; segundos: number }>;
  /** Descarta a gravação, solta o microfone e rejeita um `parar()` pendente. */
  cancelar(): void;
};

export type MotivoDeGravacao = 'permissao_negada' | 'sem_suporte' | 'desconhecido';

/** Não foi possível começar a gravar. */
export class ErroGravacao extends Error {
  readonly codigo: MotivoDeGravacao;

  constructor(codigo: MotivoDeGravacao) {
    super(`Não foi possível gravar: ${codigo}`);
    this.name = 'ErroGravacao';
    this.codigo = codigo;
  }
}

/** O que usamos do MediaRecorder; o dublê dos testes implementa só isto. */
export interface Gravador {
  state: string;
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: (() => void) | null;
  start(intervaloMs?: number): void;
  stop(): void;
}
export type ConstrutorDeGravador = (new (fluxo: MediaStream, opcoes?: { mimeType?: string }) => Gravador) & {
  isTypeSupported?: (tipo: string) => boolean;
};
type Fluxo = { getTracks(): { stop(): void }[] };

export type OpcoesDeGravacao = {
  getUserMedia?: (restricoes: { audio: true }) => Promise<Fluxo>;
  /** `null` simula navegador sem MediaRecorder. */
  MediaRecorder?: ConstrutorDeGravador | null;
};

// Em ordem de preferência; o script aceita webm, ogg e mp4 (o iPhone grava mp4).
const TIPOS_PREFERIDOS = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
const TIPO_ACEITO = /^audio\/(webm|ogg|mp4)/;
const TIPO_PADRAO = 'audio/webm';

/** Tipo escolhido na última gravação: serve de reserva se o blob vier sem tipo válido. */
let tipoDaUltimaGravacao: string | undefined;

/** Só para os testes: o tipo guardado vive no módulo. */
export function esquecerTipoDaGravacao(): void {
  tipoDaUltimaGravacao = undefined;
}

export async function iniciarGravacao(
  aoAviso: (tipo: AvisoDeGravacao) => void,
  opcoes: OpcoesDeGravacao = {},
): Promise<Gravacao> {
  const Construtor = opcoes.MediaRecorder === undefined ? (globalThis as { MediaRecorder?: ConstrutorDeGravador }).MediaRecorder : opcoes.MediaRecorder;
  const pedirMicrofone =
    opcoes.getUserMedia ??
    (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia
      ? (r: { audio: true }) => navigator.mediaDevices.getUserMedia(r)
      : undefined);
  if (!Construtor || !pedirMicrofone) throw new ErroGravacao('sem_suporte');

  let fluxo: Fluxo;
  try {
    fluxo = await pedirMicrofone({ audio: true });
  } catch (erro) {
    const nome = (erro as { name?: string } | null)?.name;
    throw new ErroGravacao(nome === 'NotAllowedError' || nome === 'SecurityError' ? 'permissao_negada' : 'desconhecido');
  }
  const soltarMicrofone = () => fluxo.getTracks().forEach((t) => t.stop());

  let gravador: Gravador;
  const pedacos: Blob[] = [];
  let inicio = 0;
  let descartar = false;
  let finalizada = false;
  let fim!: (resultado: { blob: Blob; segundos: number } | null) => void;
  const pronta = new Promise<{ blob: Blob; segundos: number } | null>((r) => (fim = r));
  const temporizadores: ReturnType<typeof setTimeout>[] = [];
  const limparTemporizadores = () => temporizadores.forEach(clearTimeout);
  let tipo: string | undefined;

  /** Uma vez só, venha de onstop, onerror ou do prazo: monta o blob, solta o microfone, resolve. */
  const finalizar = () => {
    if (finalizada) return;
    finalizada = true;
    limparTemporizadores();
    soltarMicrofone();
    if (descartar) return fim(null);
    const segundos = Math.min(LIMITE_EM_SEGUNDOS, Math.round((Date.now() - inicio) / 1000));
    let tipoFinal = TIPO_ACEITO.test(gravador.mimeType) ? gravador.mimeType : tipo;
    if (!tipoFinal) {
      console.warn('Gravação sem tipo de áudio conhecido; usando', TIPO_PADRAO);
      tipoFinal = TIPO_PADRAO;
    }
    fim({ blob: new Blob(pedacos, { type: tipoFinal }), segundos });
  };

  try {
    tipo = Construtor.isTypeSupported ? TIPOS_PREFERIDOS.find((t) => Construtor.isTypeSupported!(t)) : undefined;
    gravador = tipo ? new Construtor(fluxo as MediaStream, { mimeType: tipo }) : new Construtor(fluxo as MediaStream);
    gravador.ondataavailable = (e) => {
      if (e.data && e.data.size) pedacos.push(e.data);
    };
    gravador.onstop = finalizar;
    gravador.onerror = finalizar; // já parou por conta própria: entrega o que tem
    gravador.start(1000);
    inicio = Date.now();
    tipoDaUltimaGravacao = tipo;
  } catch {
    soltarMicrofone();
    throw new ErroGravacao('desconhecido');
  }

  const pararGravador = () => {
    if (gravador.state === 'inactive') return;
    try {
      gravador.stop();
    } catch {
      finalizar();
    }
  };
  temporizadores.push(
    setTimeout(() => aoAviso('quase_no_limite'), AVISO_EM_SEGUNDOS * 1000),
    setTimeout(() => {
      aoAviso('limite');
      pararGravador();
    }, LIMITE_EM_SEGUNDOS * 1000),
  );

  return {
    async parar() {
      pararGravador();
      // Se o navegador nunca avisar o fim, não deixa o dono esperando.
      if (!finalizada) temporizadores.push(setTimeout(finalizar, ESPERA_DO_STOP_MS));
      const resultado = await pronta;
      if (!resultado) throw new Error('Gravação cancelada');
      return resultado;
    },
    cancelar() {
      descartar = true;
      pararGravador();
      finalizar();
    },
  };
}

// ---- Envio ----

/** Mesmo formato de `chamar` (conexao/cliente.ts). */
export type Chamar = <T>(acao: string, dados?: object) => Promise<T>;
export type OpcoesDeEnvio = {
  chamar?: Chamar;
  /** Só o reenvio: as ideias (inclusive lápides) para saber de quem é cada áudio guardado. Os testes trocam. */
  ideias?: () => Promise<readonly { audioId?: string; apagado?: boolean }[]>;
};

const chamarComTempoDeAudio: Chamar = (acao, dados) => chamarScript(acao, dados, { tempoLimiteMs: TEMPO_LIMITE_DO_ENVIO_MS });

type RespostaDeAudio = { ok: true; driveId: string } | { ok: false; erro: 'grande_demais' | 'mime_invalido' };

/** O script (ou a checagem local) recusou o áudio de vez: repetir não adianta. */
export class ErroAudioRecusado extends Error {
  readonly motivo: 'grande_demais' | 'mime_invalido';

  constructor(motivo: 'grande_demais' | 'mime_invalido') {
    super(`Áudio recusado: ${motivo}`);
    this.name = 'ErroAudioRecusado';
    this.motivo = motivo;
  }
}

async function lerBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolver, rejeitar) => {
    const leitor = new FileReader();
    leitor.onload = () => resolver(leitor.result as ArrayBuffer);
    leitor.onerror = () => rejeitar(leitor.error);
    leitor.readAsArrayBuffer(blob);
  });
}

/** Em pedaços: `String.fromCharCode(...bytes)` estoura a pilha com áudio grande. */
function paraBase64(bytes: ArrayBuffer): string {
  const lista = new Uint8Array(bytes);
  let texto = '';
  for (let i = 0; i < lista.length; i += 0x8000) texto += String.fromCharCode(...lista.subarray(i, i + 0x8000));
  return btoa(texto);
}

/** Tipo a mandar: o do blob se o script aceita; senão o escolhido na gravação; senão webm (com aviso). */
function tipoParaEnviar(blob: Blob): string {
  if (TIPO_ACEITO.test(blob.type)) return blob.type;
  if (tipoDaUltimaGravacao) return tipoDaUltimaGravacao;
  console.warn('Áudio sem tipo conhecido; enviando como', TIPO_PADRAO);
  return TIPO_PADRAO;
}

/**
 * Um envio, sem fila. Devolve o driveId. Lança o que aconteceu: `ErroConexao`,
 * `ErroScript` ou `ErroAudioRecusado`. O tamanho é conferido em bytes crus
 * ANTES do base64, que custaria memória à toa num áudio que vai ser recusado.
 */
async function enviarUm(id: string, bytes: ArrayBuffer, mime: string, chamar: Chamar): Promise<string> {
  if (bytes.byteLength > BYTES_NO_MAXIMO) throw new ErroAudioRecusado('grande_demais');
  const resposta = await chamar<RespostaDeAudio>('salvarAudio', { id, base64: paraBase64(bytes), mime });
  if (!resposta.ok) throw new ErroAudioRecusado(resposta.erro);
  return resposta.driveId;
}

// DOMException nem sempre é `instanceof Error`: olha só o nome e o código.
const ehQuota = (erro: unknown) => {
  const { name, code } = (erro ?? {}) as { name?: string; code?: number };
  return name === 'QuotaExceededError' || code === 22;
};

/**
 * Manda o áudio ao Drive. Chegou: `{ driveId }`. Sem rede, script ocupado ou
 * erro do script: o áudio fica guardado neste aparelho e volta `{ fila: true }`.
 * Fila cheia (20) ou aparelho sem espaço: `{ erro: 'sem_espaco' }` e o áudio
 * NÃO foi guardado; nenhum áudio antigo é apagado. Recusa definitiva
 * (`ErroAudioRecusado`) e código inválido (`ErroScript`) sobem como erro.
 *
 * Quem chama (Tarefa 6) deve gravar o texto da ideia ANTES de chamar esta
 * função: um áudio perdido ou recusado nunca pode levar o texto junto.
 */
export async function enviarAudio(
  id: string,
  blob: Blob,
  opcoes: OpcoesDeEnvio = {},
): Promise<{ driveId: string } | { fila: true } | { erro: 'sem_espaco' }> {
  const chamar = opcoes.chamar ?? chamarComTempoDeAudio;
  const bytes = await lerBytes(blob);
  const mime = tipoParaEnviar(blob);
  try {
    return { driveId: await enviarUm(id, bytes, mime, chamar) };
  } catch (erro) {
    if (erro instanceof ErroScript && erro.erro === 'codigo-invalido') throw erro;
    if (!(erro instanceof ErroConexao) && !(erro instanceof ErroScript)) throw erro;
  }
  try {
    if (!(await existeAudio(id)) && (await contarAudios()) >= AUDIOS_NA_FILA_NO_MAXIMO) return { erro: 'sem_espaco' };
    await guardarAudio({ id, bytes, mime, guardadoEm: Date.now() });
  } catch (erro) {
    if (ehQuota(erro)) return { erro: 'sem_espaco' };
    throw erro;
  }
  return { fila: true };
}

export function audiosPendentes(): Promise<number> {
  return contarAudios();
}

/** Bytes ocupados pelos áudios à espera, para a tela avisar antes de encher. */
export function tamanhoDosPendentes(): Promise<number> {
  return tamanhoDosAudios();
}

export type ResultadoDoReenvio = {
  enviados: string[];
  /** Recusados de vez pelo script e removidos da fila: quem chama deve avisar o dono. */
  descartados: { id: string; motivo: 'grande_demais' | 'mime_invalido' }[];
  /** Guardados (contando os `falhou`). */
  restantes: number;
  /** Ids marcados `falhou`: o app desistiu de reenviar sozinho, mas o áudio continua guardado. */
  falhas: string[];
};

let reenvioEmAndamento: Promise<ResultadoDoReenvio> | null = null;

async function rodarReenvio(chamar: Chamar, lerIdeias: NonNullable<OpcoesDeEnvio['ideias']>): Promise<ResultadoDoReenvio> {
  const enviados: string[] = [];
  const descartados: ResultadoDoReenvio['descartados'] = [];
  // Fila vazia: nada a enviar, então nem lê as ideias (o caso comum ao abrir o app).
  const fila = await listarAudios();
  if (fila.length) {
    const ideias = await lerIdeias();
    const vivas = new Set(ideias.filter((i) => i.audioId && !i.apagado).map((i) => i.audioId));
    for (const audio of fila) {
      // Ideia apagada (ou que não existe mais): o áudio dela não vai ao Drive e sai da fila.
      if (!vivas.has(audio.id)) {
        await removerAudio(audio.id);
        continue;
      }
      if (audio.falhou) continue;
      try {
        await enviarUm(audio.id, audio.bytes, audio.mime, chamar);
        await removerAudio(audio.id);
        enviados.push(audio.id);
        // A ideia pode ter sido apagada durante o envio: o áudio que acabou de chegar ao Drive vai para a lixeira.
        await apagarSeAIdeiaSumiu(audio.id, lerIdeias, chamar);
      } catch (erro) {
        if (erro instanceof ErroAudioRecusado) {
          await removerAudio(audio.id);
          descartados.push({ id: audio.id, motivo: erro.motivo });
          continue;
        }
        // Rede fora, script ocupado ou código errado: nada adianta insistir agora.
        if (erro instanceof ErroConexao) break;
        if (erro instanceof ErroScript && (erro.erro === 'ocupado' || erro.erro === 'codigo-invalido')) break;
        // Erro só deste áudio: conta e segue para o próximo, sem travar a fila.
        const tentativas = (audio.tentativas ?? 0) + 1;
        await guardarAudio({ ...audio, tentativas, falhou: tentativas >= TENTATIVAS_ATE_FALHAR });
      }
    }
  }
  const guardados = await listarAudios();
  return {
    enviados,
    descartados,
    restantes: guardados.length,
    falhas: guardados.filter((a) => a.falhou).map((a) => a.id),
  };
}

/** Terminado um envio, relê as ideias: se a dona do áudio foi apagada nesse meio-tempo, o áudio sai do Drive. Falha aqui não derruba a rodada. */
async function apagarSeAIdeiaSumiu(audioId: string, lerIdeias: NonNullable<OpcoesDeEnvio['ideias']>, chamar: Chamar): Promise<void> {
  try {
    const dona = (await lerIdeias()).find((i) => i.audioId === audioId);
    if (dona && !dona.apagado) return;
    if (!(await apagarAudioDoDrive(audioId, { chamar }))) console.warn('Um áudio de ideia apagada ficou no Drive');
  } catch {
    // Sem leitura das ideias, nada se presume.
  }
}

/**
 * Tenta enviar de novo os áudios guardados, do mais antigo ao mais novo. Rede
 * fora ou script ocupado param a rodada (o resto fica para a próxima); erro só
 * de um áudio conta uma tentativa e passa ao seguinte; na 5ª o áudio é marcado
 * `falhou` e fica guardado. Áudio de ideia apagada (ou inexistente) é removido da
 * fila sem enviar. O que o script recusa de vez vem em `descartados`. Chamadas ao mesmo tempo dividem a mesma rodada.
 */
export function reenviarAudiosPendentes(opcoes: OpcoesDeEnvio = {}): Promise<ResultadoDoReenvio> {
  if (reenvioEmAndamento) return reenvioEmAndamento;
  const rodada = rodarReenvio(opcoes.chamar ?? chamarComTempoDeAudio, opcoes.ideias ?? (() => listar('ideias', { comApagados: true }))).finally(() => {
    reenvioEmAndamento = null;
  });
  reenvioEmAndamento = rodada;
  return rodada;
}
