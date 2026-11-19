// Buscar um áudio para tocar (V02, Tarefa 7). Áudio que ainda espera rede neste
// aparelho toca do blob local; os demais são baixados do Drive sob demanda pela
// ação `lerAudio` do script (só arquivos de "Central/Audios"). O app conhece o
// id do áudio (o mesmo mandado em `salvarAudio`), não o id do arquivo no Drive.
import { AUDIO_BASE64_NO_MAXIMO } from '../../script/audio';
import { chamar as chamarScript } from '../conexao/cliente';
import { lerAudioPendente } from './audios-pendentes';

/** Baixar áudio pesa mais que os outros pedidos: mais tempo que os 30 s de sempre. */
const TEMPO_LIMITE_DO_DOWNLOAD_MS = 120_000;

/** O Drive não tem o áudio (ou a resposta não serve): quem chama mostra o aviso. */
export class AudioIndisponivel extends Error {
  constructor() {
    super('Áudio indisponível');
    this.name = 'AudioIndisponivel';
  }
}

export type Chamar = <T>(acao: string, dados?: object) => Promise<T>;

const chamarComTempoDeAudio: Chamar = (acao, dados) => chamarScript(acao, dados, { tempoLimiteMs: TEMPO_LIMITE_DO_DOWNLOAD_MS });

/** Só áudio que o app grava; qualquer outro tipo vindo do script não é tocado. */
const TIPO_VALIDO = /^audio\/(webm|ogg|mp4)$/;

type Resposta = { ok?: boolean; base64?: unknown; mime?: unknown };

function paraBlob(base64: string, mime: string): Blob {
  const texto = atob(base64);
  const bytes = new Uint8Array(texto.length);
  for (let i = 0; i < texto.length; i++) bytes[i] = texto.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * O áudio da ideia como Blob. Erro de rede ou do script sobe como veio;
 * `AudioIndisponivel` quando o Drive não o tem.
 */
export async function buscarAudio(audioId: string, opcoes: { chamar?: Chamar } = {}): Promise<Blob> {
  const local = await lerAudioPendente(audioId);
  if (local) return new Blob([local.bytes], { type: local.mime });
  const chamar = opcoes.chamar ?? chamarComTempoDeAudio;
  const resposta = await chamar<Resposta>('lerAudio', { id: audioId });
  if (!resposta || resposta.ok !== true || typeof resposta.base64 !== 'string' || typeof resposta.mime !== 'string') throw new AudioIndisponivel();
  if (!TIPO_VALIDO.test(resposta.mime) || resposta.base64.length > AUDIO_BASE64_NO_MAXIMO) throw new AudioIndisponivel();
  try {
    return paraBlob(resposta.base64, resposta.mime);
  } catch {
    throw new AudioIndisponivel();
  }
}
