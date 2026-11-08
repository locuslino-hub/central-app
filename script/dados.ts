// Dados sincronizados: um arquivo JSON no Drive do dono. Lógica pura: o Drive,
// a trava e o relógio chegam por `Armazem` (Codigo.ts liga aos serviços do Google).

export const NOME_DO_ARQUIVO = 'central-dados.json';
export const DIAS_DE_COPIA = 30;
/** Corpo de pedido maior que isso é recusado antes de qualquer trabalho (api.ts). O app envia em lotes menores. */
export const TAMANHO_MAXIMO_DO_CORPO = 256 * 1024;

const PREFIXO_DA_COPIA = 'central-dados-';
const COPIA = /^central-dados-(\d{4}-\d{2}-\d{2})\.json$/;
const COLECAO_VALIDA = /^[a-zA-Z]{1,40}$/;
const TAMANHO_MAXIMO_DO_ID = 200;
const TAMANHO_MAXIMO_DO_APARELHO = 200;
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

function textoCurto(valor: unknown, maximo: number): valor is string {
  return typeof valor === 'string' && valor.length > 0 && valor.length <= maximo;
}

function validarItem(valor: unknown): Item {
  exigir(objeto(valor));
  const { colecao, registro } = valor;
  exigir(typeof colecao === 'string' && COLECAO_VALIDA.test(colecao));
  exigir(objeto(registro));
  exigir(textoCurto(registro.id, TAMANHO_MAXIMO_DO_ID));
  exigir(textoCurto(registro.aparelho, TAMANHO_MAXIMO_DO_APARELHO));
  const { atualizadoEm } = registro;
  exigir(typeof atualizadoEm === 'number' && Number.isFinite(atualizadoEm) && atualizadoEm >= 0);
  return { colecao, registro: registro as RegistroBase };
}

// JSON.stringify do par: chave sem mistura entre coleção e id, e num Map,
// onde '__proto__' é um texto como outro qualquer.
function chaveDe(colecao: string, id: string): string {
  return JSON.stringify([colecao, id]);
}

function lerArquivo(armazem: Armazem): Arquivo {
  const conteudo = armazem.ler();
  if (conteudo === null) return { versao: 1, ultimo: 0, registros: [] };
  // Conteúdo quebrado lança aqui, antes de qualquer gravação: nunca se
  // sobrescreve o arquivo do dono com um vazio.
  const arquivo = JSON.parse(conteudo) as Arquivo;
  if (!objeto(arquivo) || !Array.isArray(arquivo.registros) || typeof arquivo.ultimo !== 'number') {
    throw new Error('Arquivo de dados em formato desconhecido');
  }
  return arquivo;
}

export function puxar(dados: unknown, armazem: Armazem): { registros: Item[]; agora: number } {
  exigir(objeto(dados));
  const { desde } = dados;
  exigir(typeof desde === 'number' && Number.isFinite(desde) && desde >= 0);
  const arquivo = lerArquivo(armazem);
  // `agora` sai do arquivo lido, não do relógio: toda escrita posterior recebe
  // carimbo maior que ele, então nada escapa do próximo `desde`.
  return {
    registros: arquivo.registros
      .filter((guardado) => guardado.recebidoEm > desde)
      .map(({ colecao, registro }) => ({ colecao, registro })),
    agora: arquivo.ultimo,
  };
}

export function enviar(
  dados: unknown,
  armazem: Armazem,
): { aceitas: Chave[]; conflitos: Item[] } {
  exigir(objeto(dados) && Array.isArray(dados.mudancas));
  // Tudo validado antes de abrir a trava: um item ruim recusa o pedido inteiro.
  const mudancas = dados.mudancas.map(validarItem);
  if (mudancas.length === 0) return { aceitas: [], conflitos: [] };

  return armazem.comTrava(() => {
    const conteudoAntes = armazem.ler();
    const arquivo = lerArquivo(armazem);
    const indice = new Map<string, number>();
    arquivo.registros.forEach((guardado, posicao) => {
      indice.set(chaveDe(guardado.colecao, guardado.registro.id), posicao);
    });

    const aceitas: Chave[] = [];
    const conflitos: Item[] = [];
    let mudou = false;
    for (const { colecao, registro } of mudancas) {
      const chave = chaveDe(colecao, registro.id);
      const posicao = indice.get(chave);
      const atual = posicao === undefined ? undefined : arquivo.registros[posicao];
      if (atual && mesmaVersao(atual.registro, registro)) {
        // Reenvio (resposta anterior perdida): já está lá, sem carimbo novo.
        aceitas.push({ colecao, id: registro.id });
      } else if (!atual || vence(registro, atual.registro)) {
        arquivo.ultimo = Math.max(armazem.agora(), arquivo.ultimo + 1);
        const guardado: Guardado = { colecao, recebidoEm: arquivo.ultimo, registro };
        if (posicao === undefined) {
          indice.set(chave, arquivo.registros.length);
          arquivo.registros.push(guardado);
        } else {
          arquivo.registros[posicao] = guardado;
        }
        aceitas.push({ colecao, id: registro.id });
        mudou = true;
      } else {
        conflitos.push({ colecao, registro: atual.registro });
      }
    }

    if (mudou) {
      if (conteudoAntes !== null) copiaDoDia(armazem, conteudoAntes);
      armazem.gravar(JSON.stringify(arquivo));
    }
    return { aceitas, conflitos };
  });
}

/** Na primeira gravação do dia, guarda o arquivo como estava e descarta cópias com mais de 30 dias. */
function copiaDoDia(armazem: Armazem, conteudo: string) {
  const hoje = armazem.hoje();
  if (armazem.ultimaCopia() === hoje) return;
  armazem.copiar(nomeDaCopia(hoje), conteudo);
  armazem.marcarCopia(hoje);
  const limite = new Date(Date.parse(`${hoje}T00:00:00Z`) - DIAS_DE_COPIA * DIA_MS)
    .toISOString()
    .slice(0, 10);
  for (const { id, nome } of armazem.listarCopias()) {
    const dia = COPIA.exec(nome)?.[1];
    if (dia !== undefined && dia < limite) armazem.descartar(id);
  }
}
