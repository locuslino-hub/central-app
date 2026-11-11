// Dados sincronizados: um arquivo JSON no Drive do dono. Lógica pura: o Drive,
// a trava e o relógio chegam por `Armazem` (Codigo.ts liga aos serviços do Google).
import { colecaoConhecida, registroValido } from './colecoes';

export const NOME_DO_ARQUIVO = 'central-dados.json';
export const DIAS_DE_COPIA = 30;
/** Corpo de pedido maior que isso é recusado antes de qualquer trabalho (api.ts). O app envia em lotes menores. */
export const TAMANHO_MAXIMO_DO_CORPO = 256 * 1024;
/** Limites do arquivo no Drive: acima deles, nada é gravado. */
export const TAMANHO_MAXIMO_DO_ARQUIVO = 10 * 1024 * 1024;
export const REGISTROS_NO_MAXIMO = 50_000;

const PREFIXO_DA_COPIA = 'central-dados-';
const COPIA = /^central-dados-(\d{4}-\d{2}-\d{2})\.json$/;
const DIA_MS = 24 * 60 * 60 * 1000;

/** A trava do script não saiu a tempo: quem pediu tenta de novo. */
export class Ocupado extends Error {
  constructor() {
    super('Trava ocupada');
    this.name = 'Ocupado';
  }
}

export type RegistroBase = {
  id: string;
  atualizadoEm: number;
  aparelho: string;
  apagado?: boolean;
  [campo: string]: unknown;
};

export type Item = { colecao: string; registro: RegistroBase };
export type Chave = { colecao: string; id: string };

export type RespostaEnviar = {
  aceitas: Chave[];
  /** Versões do servidor que venceram as enviadas. */
  conflitos: Item[];
  /** Itens com forma inválida (ver colecoes.ts): não gravados; o resto segue. */
  recusadas: Chave[];
  /** Versões de outro aparelho, recebidas depois do `desde` do cliente, que o envio sobrescreveu. */
  substituidas: Item[];
  /**
   * Relógio do servidor, nunca menor que o maior carimbo do arquivo. O app
   * confere "até 10 min no futuro" contra ele, não só contra o próprio relógio.
   */
  agora: number;
};

export interface Armazem {
  /** Conteúdo de central-dados.json, ou null se ainda não existe. */
  ler(): string | null;
  gravar(conteudo: string): void;
  /** Roda `fazer` com a trava do script; lança `Ocupado` se ela não sair. */
  comTrava<T>(fazer: () => T): T;
  agora(): number;
  /** Dia de hoje em Lisboa, AAAA-MM-DD. */
  hoje(): string;
  ultimaCopia(): string | null;
  marcarCopia(dia: string): void;
  copiar(nome: string, conteudo: string): void;
  /** Arquivos que podem ser cópias; só os de nome `central-dados-AAAA-MM-DD.json` são tocados. */
  listarCopias(): { id: string; nome: string }[];
  descartar(id: string): void;
}

/** Como fica no Drive. `recebidoEm` é o carimbo do servidor (R5); `ultimo` é o maior deles. */
type Guardado = { colecao: string; recebidoEm: number; registro: RegistroBase };
type Arquivo = { versao: 1; ultimo: number; registros: Guardado[] };

export function nomeDaCopia(dia: string): string {
  return `${PREFIXO_DA_COPIA}${dia}.json`;
}

/**
 * `a` substitui `b`? Maior `atualizadoEm` vence; no empate, o maior `aparelho`,
 * para os dois lados decidirem igual. A mesma versão nunca vence a si mesma.
 */
export function vence(a: RegistroBase, b: RegistroBase): boolean {
  if (a.atualizadoEm !== b.atualizadoEm) return a.atualizadoEm > b.atualizadoEm;
  return a.aparelho > b.aparelho;
}

function mesmaVersao(a: RegistroBase, b: RegistroBase): boolean {
  return a.atualizadoEm === b.atualizadoEm && a.aparelho === b.aparelho;
}

function objeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function exigir(condicao: boolean): asserts condicao {
  if (!condicao) throw new Error('Pedido malformado');
}

function marcaValida(valor: unknown): valor is number {
  return typeof valor === 'number' && Number.isFinite(valor) && valor >= 0;
}

// JSON.stringify do par: chave sem mistura entre coleção e id, e num Map,
// onde '__proto__' é um texto como outro qualquer.
function chaveDe(colecao: string, id: string): string {
  return JSON.stringify([colecao, id]);
}

function analisar(conteudo: string | null): Arquivo {
  if (conteudo === null) return { versao: 1, ultimo: 0, registros: [] };
  // Conteúdo quebrado lança aqui, antes de qualquer gravação: nunca se
  // sobrescreve o arquivo do dono com um vazio.
  const arquivo = JSON.parse(conteudo) as Arquivo;
  if (!objeto(arquivo) || !Array.isArray(arquivo.registros) || typeof arquivo.ultimo !== 'number') {
    throw new Error('Arquivo de dados em formato desconhecido');
  }
  return arquivo;
}

/**
 * `agora`: a marca do arquivo (a hora da última escrita), para o `desde` do
 * próximo puxar. `agoraDoServidor`: o relógio do servidor neste instante, que
 * não é a mesma coisa: o arquivo pode estar parado há dias. O app o usa para
 * conferir o relógio do aparelho antes de virar o dia.
 */
export function puxar(
  dados: unknown,
  armazem: Armazem,
): { registros: Item[]; agora: number; agoraDoServidor: number } {
  exigir(objeto(dados) && marcaValida(dados.desde));
  const { desde } = dados;
  const arquivo = analisar(armazem.ler());
  // `agora` sai do arquivo lido, não do relógio: toda escrita posterior recebe
  // carimbo maior que ele, então nada escapa do próximo `desde`.
  return {
    registros: arquivo.registros
      .filter((guardado) => guardado.recebidoEm > desde)
      .map(({ colecao, registro }) => ({ colecao, registro })),
    agora: arquivo.ultimo,
    agoraDoServidor: armazem.agora(),
  };
}

export function enviar(dados: unknown, armazem: Armazem): RespostaEnviar {
  // Envelope quebrado recusa o pedido inteiro; item com forma inválida vai
  // para `recusadas` e o resto segue.
  exigir(objeto(dados) && Array.isArray(dados.mudancas));
  const { desde } = dados;
  exigir(desde === undefined || marcaValida(desde));
  const agora = armazem.agora();
  const validas: Item[] = [];
  const recusadas: Chave[] = [];
  for (const mudanca of dados.mudancas as unknown[]) {
    exigir(objeto(mudanca) && objeto(mudanca.registro));
    const { colecao, registro } = mudanca;
    if (colecaoConhecida(colecao) && registroValido(colecao, registro, agora, { estrito: true })) {
      validas.push({ colecao, registro: registro as RegistroBase });
    } else if (typeof colecao === 'string' && typeof registro.id === 'string') {
      recusadas.push({ colecao, id: registro.id });
    }
  }
  const resposta: RespostaEnviar = { aceitas: [], conflitos: [], recusadas, substituidas: [], agora };
  if (validas.length === 0) return resposta;

  return armazem.comTrava(() => {
    const conteudoAntes = armazem.ler();
    const arquivo = analisar(conteudoAntes);
    const indice = new Map<string, number>();
    arquivo.registros.forEach((guardado, posicao) => {
      indice.set(chaveDe(guardado.colecao, guardado.registro.id), posicao);
    });

    let mudou = false;
    for (const { colecao, registro } of validas) {
      const chave = chaveDe(colecao, registro.id);
      const posicao = indice.get(chave);
      const atual = posicao === undefined ? undefined : arquivo.registros[posicao];
      if (atual && mesmaVersao(atual.registro, registro)) {
        // Reenvio (resposta anterior perdida): já está lá, sem carimbo novo.
        resposta.aceitas.push({ colecao, id: registro.id });
      } else if (!atual || vence(registro, atual.registro)) {
        // Versão de outro aparelho que o cliente ainda não tinha visto: ele
        // precisa saber que ela foi sobrescrita.
        if (
          atual &&
          desde !== undefined &&
          atual.recebidoEm > desde &&
          atual.registro.aparelho !== registro.aparelho
        ) {
          resposta.substituidas.push({ colecao, registro: atual.registro });
        }
        arquivo.ultimo = Math.max(armazem.agora(), arquivo.ultimo + 1);
        const guardado: Guardado = { colecao, recebidoEm: arquivo.ultimo, registro };
        if (posicao === undefined) {
          indice.set(chave, arquivo.registros.length);
          arquivo.registros.push(guardado);
        } else {
          arquivo.registros[posicao] = guardado;
        }
        resposta.aceitas.push({ colecao, id: registro.id });
        mudou = true;
      } else {
        resposta.conflitos.push({ colecao, registro: atual.registro });
      }
    }

    if (mudou) {
      const conteudo = JSON.stringify(arquivo);
      if (conteudo.length > TAMANHO_MAXIMO_DO_ARQUIVO || arquivo.registros.length > REGISTROS_NO_MAXIMO) {
        throw new Error('Arquivo de dados passaria do limite');
      }
      if (conteudoAntes !== null) copiaDoDia(armazem, conteudoAntes);
      armazem.gravar(conteudo);
    }
    resposta.agora = Math.max(armazem.agora(), arquivo.ultimo);
    return resposta;
  });
}

/**
 * Na primeira gravação do dia, guarda o arquivo como estava e descarta cópias
 * com mais de 30 dias. Se a cópia de hoje já existe (marca perdida), não copia de novo.
 */
function copiaDoDia(armazem: Armazem, conteudo: string) {
  const hoje = armazem.hoje();
  if (armazem.ultimaCopia() === hoje) return;
  const copias = armazem.listarCopias();
  if (!copias.some(({ nome }) => nome === nomeDaCopia(hoje))) armazem.copiar(nomeDaCopia(hoje), conteudo);
  armazem.marcarCopia(hoje);
  const limite = new Date(Date.parse(`${hoje}T00:00:00Z`) - DIAS_DE_COPIA * DIA_MS)
    .toISOString()
    .slice(0, 10);
  for (const { id, nome } of copias) {
    const dia = COPIA.exec(nome)?.[1];
    if (dia !== undefined && dia < limite) armazem.descartar(id);
  }
}
