// Apagar o áudio de uma ideia apagada (V02, privacidade): pede ao script que mande
// `audio-<id>.*` de "Central/Audios" para a lixeira do Drive. Uma tentativa só; sem
// rede ou com erro do script devolve `false` e quem chama avisa que o áudio continua
// no Drive (o dono pode apagá-lo à mão).
import { chamar as chamarScript } from '../conexao/cliente';

export type Chamar = <T>(acao: string, dados?: object) => Promise<T>;

/** `true` se o script confirmou (mesmo sem achar o arquivo); `false` se não deu para pedir. */
export async function apagarAudioDoDrive(audioId: string, opcoes: { chamar?: Chamar } = {}): Promise<boolean> {
  const chamar = opcoes.chamar ?? chamarScript;
  try {
    const resposta = await chamar<{ ok?: boolean }>('apagarAudio', { id: audioId });
    return resposta?.ok === true;
  } catch {
    return false;
  }
}
