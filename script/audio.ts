// Áudios gravados no app (V02, Tarefa 2): o app manda o áudio em base64 e o
// script guarda o arquivo em "Central/Audios" no Drive do dono ("Central" é a
// pasta única do app, na raiz do Meu Drive: ver pasta-central.ts). Nada aqui toca
// serviços do Google: o Drive chega por `ServicoDeAudios` (Codigo.ts), então
// tudo roda igual nos testes.
//
// O pedido vem de fora e não é de confiança:
// - tipo e tamanho são conferidos antes de qualquer chamada ao Drive;
// - o id só vale com letras, números, "_" e "-" (ID_VALIDO), e o nome do
//   arquivo é montado só com ele e uma extensão fixa pelo tipo: nada do que o
//   app manda vira caminho, nome livre nem consulta do Drive;
// - repetir o pedido (fila offline, resposta perdida) acha o arquivo pelo nome
//   e devolve o mesmo driveId.
import { ID_VALIDO } from './colecoes';
import { pastaCentral, umaSo, type ServicoDePastas } from './pasta-central';

/** 6 MB de base64 (caracteres). Acima disso, `grande_demais`. */
export const AUDIO_BASE64_NO_MAXIMO = 6 * 1024 * 1024;
/** O mesmo teto em bytes crus (3/4 do base64): vale para o tamanho que o Drive informa. */
export const BYTES_DE_AUDIO_NO_MAXIMO = Math.floor(AUDIO_BASE64_NO_MAXIMO / 4) * 3;
export const PASTA_DE_AUDIOS = 'Audios';

/** Tipo aceito -> extensão fixa do nome do arquivo. */
const EXTENSAO_POR_TIPO: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'mp4',
};
/** Id de arquivo do Drive: letras, números, "_" e "-" (mesma regra do `Codigo.ts`). */
export const ID_DO_DRIVE = /^[A-Za-z0-9_-]{1,100}$/;
const BASE64_VALIDO = /^[A-Za-z0-9+/]+={0,2}$/;
export type TipoDeItem = 'pasta' | 'arquivo';

export type RespostaDeAudio = { ok: true; driveId: string } | { ok: false; erro: 'grande_demais' | 'mime_invalido' };

export class PedidoInvalido extends Error {
  constructor() {
    super('Pedido de áudio inválido');
    this.name = 'PedidoInvalido';
  }
}

/** O que o script precisa do Drive. Os nomes são fixos ou já validados. */
export interface ServicoDeAudios {
  /**
   * Itens do dono, não apagados, desse tipo, com esse nome dentro da pasta
   * `paiId` ("root" = Meu Drive). Pasta é só pasta; arquivo é tudo que não é pasta.
   */
  procurar(nome: string, paiId: string, tipo: TipoDeItem): { id: string }[];
  criarPasta(nome: string, paiId: string): string;
  criarArquivo(nome: string, mime: string, paiId: string, base64: string): string;
  /**
   * Só os metadados de um arquivo (nada é baixado): devolve `null` se o item não
   * é do dono, está na lixeira, é pasta, não está DIRETO dentro de `paiId` ou
   * não existe. É esta conferência que impede o app de ler qualquer outro
   * arquivo do Drive. Qualquer outro erro do Drive é lançado, não vira `null`.
   */
  inspecionar(arquivoId: string, paiId: string): { mime: string; bytes: number } | null;
  /** O conteúdo em base64. Só se chama depois de `inspecionar` aceitar o arquivo. */
  baixar(arquivoId: string): string;
  /** Manda o arquivo para a lixeira do Drive (recuperável; nunca apaga de vez). Só depois de `inspecionar` aceitar. */
  lixeira(arquivoId: string): void;
}

/** O Drive dos áudios visto como o das pastas: o helper `pastaCentral` é o mesmo das planilhas e dos dados. */
function comoPastas(servico: ServicoDeAudios): ServicoDePastas {
  return {
    procurarPasta: (nome, paiId) => servico.procurar(nome, paiId, 'pasta'),
    criarPasta: (nome, paiId) => servico.criarPasta(nome, paiId),
  };
}

/** Mais de um com o mesmo nome: o script não adivinha qual vale (como o arquivo de dados). */
function pastaOuCriar(servico: ServicoDeAudios, nome: string, paiId: string): string {
  const achada = umaSo(servico.procurar(nome, paiId, 'pasta'), nome);
  return achada ?? servico.criarPasta(nome, paiId);
}

export function salvarAudio(dados: unknown, servico: ServicoDeAudios): RespostaDeAudio {
  if (typeof dados !== 'object' || dados === null) throw new PedidoInvalido();
  const { id, base64, mime } = dados as Record<string, unknown>;
  if (typeof id !== 'string' || !ID_VALIDO.test(id)) throw new PedidoInvalido();
  if (typeof mime !== 'string' || typeof base64 !== 'string') throw new PedidoInvalido();
  // "audio/webm;codecs=opus" vale como "audio/webm"; o tipo gravado é sempre o base.
  const tipo = mime.split(';')[0]!.trim().toLowerCase();
  const extensao = Object.prototype.hasOwnProperty.call(EXTENSAO_POR_TIPO, tipo) ? EXTENSAO_POR_TIPO[tipo] : undefined;
  if (!extensao) return { ok: false, erro: 'mime_invalido' };
  if (base64.length > AUDIO_BASE64_NO_MAXIMO) return { ok: false, erro: 'grande_demais' };
  if (base64.length % 4 !== 0 || !BASE64_VALIDO.test(base64)) throw new PedidoInvalido();

  const raiz = pastaCentral(comoPastas(servico), { criar: true });
  const audios = pastaOuCriar(servico, PASTA_DE_AUDIOS, raiz);
  const nome = `audio-${id}.${extensao}`;
  // Mesmo id = mesmo conteúdo: se houver cópias do arquivo, qualquer uma serve
  // (só pasta repetida é ambígua e lança erro).
  const existente = servico.procurar(nome, audios, 'arquivo')[0];
  if (existente) return { ok: true, driveId: existente.id };
  return { ok: true, driveId: servico.criarArquivo(nome, tipo, audios, base64) };
}

export type RespostaDeLeitura =
  | { ok: true; base64: string; mime: string }
  | { ok: false; erro: 'nao_encontrado' | 'grande_demais' };

/** Procura a pasta sem criar: ler nunca muda o Drive. */
function pastaSeExistir(servico: ServicoDeAudios, nome: string, paiId: string): string | null {
  return umaSo(servico.procurar(nome, paiId, 'pasta'), nome);
}

/**
 * Lê um áudio já guardado. O pedido traz `id`, o id do áudio (o mesmo de
 * `salvarAudio`: o app só conhece esse). Só vale arquivo de áudio DENTRO de
 * "Central/Audios" do dono: qualquer outro, mesmo existente, dá `nao_encontrado`.
 * Nada é criado. O que vem do pedido só entra na consulta depois de validado.
 */
export function lerAudio(dados: unknown, servico: ServicoDeAudios): RespostaDeLeitura {
  if (typeof dados !== 'object' || dados === null) throw new PedidoInvalido();
  const { id } = dados as Record<string, unknown>;
  if (typeof id !== 'string' || !ID_VALIDO.test(id)) throw new PedidoInvalido();

  const raiz = pastaCentral(comoPastas(servico), { criar: false });
  const audios = raiz === null ? null : pastaSeExistir(servico, PASTA_DE_AUDIOS, raiz);
  if (audios === null) return { ok: false, erro: 'nao_encontrado' };

  let arquivoId: string | undefined;
  for (const extensao of Object.values(EXTENSAO_POR_TIPO)) {
    arquivoId = servico.procurar(`audio-${id}.${extensao}`, audios, 'arquivo')[0]?.id;
    if (arquivoId !== undefined) break;
  }
  if (arquivoId === undefined) return { ok: false, erro: 'nao_encontrado' };

  // Tipo e tamanho se conferem nos metadados, ANTES de baixar.
  const meta = servico.inspecionar(arquivoId, audios);
  if (!meta) return { ok: false, erro: 'nao_encontrado' };
  const tipo = meta.mime.split(';')[0]!.trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(EXTENSAO_POR_TIPO, tipo)) return { ok: false, erro: 'nao_encontrado' };
  if (!(meta.bytes <= BYTES_DE_AUDIO_NO_MAXIMO)) return { ok: false, erro: 'grande_demais' };
  const base64 = servico.baixar(arquivoId);
  if (base64.length > AUDIO_BASE64_NO_MAXIMO) return { ok: false, erro: 'grande_demais' };
  return { ok: true, base64, mime: tipo };
}

export type RespostaDeApagar = { ok: true; apagados: number };

/**
 * Manda para a lixeira do Drive o áudio de uma ideia apagada: só arquivos
 * `audio-<id>.<extensão>` DIRETO em "Central/Audios", do dono (`inspecionar`
 * confere dono, lixeira e pasta). Não é exclusão definitiva: o dono ainda
 * recupera pela lixeira do Drive. Sem pasta ou sem arquivo, `apagados: 0`
 * (repetir o pedido é seguro). Nada é criado.
 */
export function apagarAudio(dados: unknown, servico: ServicoDeAudios): RespostaDeApagar {
  if (typeof dados !== 'object' || dados === null) throw new PedidoInvalido();
  const { id } = dados as Record<string, unknown>;
  if (typeof id !== 'string' || !ID_VALIDO.test(id)) throw new PedidoInvalido();

  const raiz = pastaCentral(comoPastas(servico), { criar: false });
  const audios = raiz === null ? null : pastaSeExistir(servico, PASTA_DE_AUDIOS, raiz);
  if (audios === null) return { ok: true, apagados: 0 };

  let apagados = 0;
  for (const extensao of Object.values(EXTENSAO_POR_TIPO)) {
    for (const { id: arquivoId } of servico.procurar(`audio-${id}.${extensao}`, audios, 'arquivo')) {
      if (!servico.inspecionar(arquivoId, audios)) continue;
      servico.lixeira(arquivoId);
      apagados += 1;
    }
  }
  return { ok: true, apagados };
}
