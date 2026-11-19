// Planilhas Google da Casa (V02, Tarefa 8): criar, ler, anexar e atualizar
// linhas. Nada aqui toca serviços do Google: Drive e Planilhas chegam por
// `ServicoDePlanilhas` (Codigo.ts), a trava por `comTrava` e os ids novos por
// `gerarId`, então tudo roda igual nos testes.
//
// O pedido vem de fora e não é de confiança:
// - todo `planilhaId` precisa ter o formato de id do Drive e apontar para uma
//   planilha Google do dono, fora da lixeira, DIRETO na pasta "Casa (partilhada)"
//   do dono, que fica DENTRO da pasta "Central" (Central/Casa (partilhada)).
//   Qualquer outra coisa (outro dono, lixeira, outra pasta, não é planilha, não
//   existe, id malformado) dá a mesma resposta, `fora_da_pasta`: não se revela
//   se o arquivo existe;
// - a planilha é lida por NOME de cabeçalho (primeira aba, cabeçalho na linha 1),
//   então colunas trocadas de lugar e colunas extras do usuário não atrapalham;
//   com nome repetido vale a primeira coluna;
// - só se anexa (nunca se apaga nem se regrava a aba): atualizar mexe só nas
//   células das colunas pedidas, na linha achada pelo id (coluna `id`, oculta);
// - ler a planilha para gravar é sempre DENTRO da trava, logo antes de gravar, e a
//   conferência da pasta se repete lá dentro;
// - número puro ("5", "-12.50", "1.250,75") é gravado como NÚMERO; qualquer
//   outro valor que comece com = + - @ (ou tabulação/retorno de carro) é gravado
//   como TEXTO: não vira fórmula. O id também vai sempre como texto;
// - o que a planilha mostra (`getDisplayValues`) pode vir reformatado (5.50 ->
//   "5,5", 2026-11-17 -> "17/11/2026"): para comparar, `iguais` normaliza.
//
// Limites (acima deles o script lança erro, nunca devolve ou grava pela metade;
// só `anexarLinha` responde `planilha_cheia`): 5000 linhas de dados, 30 colunas,
// 2000 caracteres por valor (também ao ler), 100 no nome.
import { ID_DO_DRIVE } from './audio';
import { ID_VALIDO } from './colecoes';
import { NOME_DA_PASTA_DA_CASA, pastaCentral, umaSo } from './pasta-central';

export { NOME_DA_PASTA_DA_CASA };
export const LINHAS_NO_MAXIMO = 5000;
export const COLUNAS_NO_MAXIMO = 30;
export const TAMANHO_MAXIMO_DO_VALOR = 2000;
export const TAMANHO_MAXIMO_DO_NOME = 100;
const NOME_DA_COLUNA_DE_ID = 'id';

export type ModeloDePlanilha = 'compras' | 'consumo' | 'financeiro';

/** Cabeçalhos por modelo; a coluna `id` (oculta) é sempre a última. */
export const CABECALHOS: Record<ModeloDePlanilha, readonly string[]> = {
  compras: ['Item', 'Quantidade', 'Valor', 'Link', 'Prioridade', 'Comprado?', 'Quem pôs', 'Data', 'Observação', 'id'],
  consumo: ['Data', 'Leitura', 'Unidade', 'Consumo desde a anterior', 'Observação', 'id'],
  financeiro: ['Data', 'Descrição', 'Categoria', 'Tipo', 'Valor', 'Quem', 'Observação', 'id'],
};

/**
 * Como gravar um valor: `texto` (nunca vira fórmula nem número), `numero`
 * (`valor` é um número em JS, ex. "-12.5", gravado como número; a célula volta
 * ao formato geral se estava em texto) ou `livre` (como digitado; o Sheets pode
 * converter, ex. datas).
 */
export type Formato = 'texto' | 'numero' | 'livre';

/** Uma célula a gravar, na coluna `coluna` (a partir de 1). */
export interface CelulaNova {
  coluna: number;
  valor: string;
  formato: Formato;
}

/** O que o script precisa do Drive e das Planilhas. Nomes e ids já chegam validados. */
export interface ServicoDePlanilhas {
  /** Pastas do dono, não apagadas, com esse nome DIRETO dentro de `paiId` ("root" = Meu Drive). */
  procurarPasta(nome: string, paiId: string): { id: string }[];
  criarPasta(nome: string, paiId: string): string;
  /**
   * Cria uma planilha Google DIRETO em `paiId`, com a linha 1 igual a
   * `cabecalho` e a coluna `colunaOculta` (a partir de 1) oculta e em texto. As
   * `colunasDeData` (a partir de 1) nascem em formato `yyyy-mm-dd`.
   * Se falhar no meio, não deixa planilha pela metade.
   */
  criarPlanilha(nome: string, paiId: string, cabecalho: readonly string[], colunaOculta: number, colunasDeData: readonly number[]): string;
  /**
   * `true` só se o arquivo é do dono, não está na lixeira, é planilha Google e
   * está DIRETO em `paiId`. Não existe e sem acesso dão `false`; qualquer outro
   * erro do Google é lançado, não vira `false`.
   */
  inspecionar(planilhaId: string, paiId: string): boolean;
  /**
   * Valores (como aparecem na tela) da primeira aba, da linha 1 até a última
   * com conteúdo. Lê no máximo `linhas + 2` linhas e `colunas + 1` colunas: o
   * excesso só serve para a lógica perceber que passou do teto. Lança `SemAcesso`
   * se o Google negar a abertura.
   */
  lerValores(planilhaId: string, limites: { linhas: number; colunas: number }): string[][];
  /** O texto que a célula mostra agora (a releitura de um só valor, logo antes de gravar). */
  lerCelula(planilhaId: string, linha: number, coluna: number): string;
  /**
   * Grava a linha `linha` inteira, da coluna 1 em diante, de uma vez (formatos
   * e valores contíguos). Lança se a linha já tem conteúdo (alguém anexou
   * entre a leitura e a gravação): nunca sobrescreve. Devolve o que as células
   * mostram depois, na mesma ordem.
   */
  escreverLinhaNova(planilhaId: string, linha: number, celulas: CelulaNova[]): string[];
  /** Grava só estas células da linha `linha` e devolve o que elas mostram depois, na mesma ordem. */
  escreverCelulas(planilhaId: string, linha: number, celulas: CelulaNova[]): string[];
  /** Grava ids (sempre como texto) na coluna `coluna`, de uma só vez; as outras linhas do trecho ficam como estavam. */
  escreverIds(planilhaId: string, coluna: number, ids: { linha: number; id: string }[]): void;
}

export interface ContextoDePlanilhas {
  servico: ServicoDePlanilhas;
  /** A trava do script (LockService): lança `Ocupado` se não conseguir. */
  comTrava<T>(fazer: () => T): T;
  /** Id novo e imprevisível para linha sem id (UUID). */
  gerarId(): string;
}

export class PedidoDePlanilhaInvalido extends Error {
  constructor() {
    super('Pedido de planilha inválido');
    this.name = 'PedidoDePlanilhaInvalido';
  }
}

/** O Google negou a abertura de uma planilha que já passou pela conferência da pasta. */
export class SemAcesso extends Error {
  constructor() {
    super('Sem acesso à planilha');
    this.name = 'SemAcesso';
  }
}

class PlanilhaGrandeDemais extends Error {
  constructor() {
    super('Planilha grande demais');
    this.name = 'PlanilhaGrandeDemais';
  }
}

export type ErroDeColuna = { erro: 'coluna_faltando'; colunas: string[] };
export type ForaDaPasta = { erro: 'fora_da_pasta' };
const FORA_DA_PASTA: ForaDaPasta = { erro: 'fora_da_pasta' };
/** A "Casa (partilhada)" ainda está na raiz do Drive: o dono precisa rodar `organizarPastaCentral` (GUIA, parte 9). */
export type FaltaOrganizar = { erro: 'organizar_pastas' };
const FALTA_ORGANIZAR: FaltaOrganizar = { erro: 'organizar_pastas' };

// ---------- pedido ----------

function objeto(dados: unknown): Record<string, unknown> {
  if (typeof dados !== 'object' || dados === null || Array.isArray(dados)) throw new PedidoDePlanilhaInvalido();
  return dados as Record<string, unknown>;
}

function textoDoPedido(v: unknown): string {
  if (typeof v !== 'string') throw new PedidoDePlanilhaInvalido();
  return v;
}

/** Nome livre (da planilha): sem aspas, barra invertida nem caracteres de controle. */
const NOME_LIVRE = /^[^'"\\\u0000-\u001f\u007f]+$/;

function nomeDaPlanilha(v: unknown): string {
  const nome = textoDoPedido(v).trim();
  if (nome.length < 1 || nome.length > TAMANHO_MAXIMO_DO_NOME || !NOME_LIVRE.test(nome)) throw new PedidoDePlanilhaInvalido();
  return nome;
}

function idDaLinha(v: unknown): string {
  const id = textoDoPedido(v);
  if (!ID_VALIDO.test(id)) throw new PedidoDePlanilhaInvalido();
  return id;
}

/** `{ coluna: texto }` em pares, com limites de quantidade, nome e tamanho. */
function mapaDeTextos(v: unknown, { permitirVazio }: { permitirVazio: boolean }): [string, string][] {
  const pares = Object.entries(objeto(v));
  if (pares.length > COLUNAS_NO_MAXIMO || (!permitirVazio && pares.length === 0)) throw new PedidoDePlanilhaInvalido();
  for (const [coluna, valor] of pares) {
    if (coluna.length < 1 || coluna.length > TAMANHO_MAXIMO_DO_NOME || coluna !== coluna.trim()) throw new PedidoDePlanilhaInvalido();
    if (typeof valor !== 'string' || valor.length > TAMANHO_MAXIMO_DO_VALOR) throw new PedidoDePlanilhaInvalido();
  }
  return pares as [string, string][];
}

/** Os valores a gravar: nunca incluem a coluna `id` (o id vai em `idDaLinha`). */
function valoresDoPedido(v: unknown): [string, string][] {
  const pares = mapaDeTextos(v, { permitirVazio: false });
  if (pares.some(([coluna]) => coluna === NOME_DA_COLUNA_DE_ID)) throw new PedidoDePlanilhaInvalido();
  return pares;
}

// ---------- valores ----------

const PERIGO_DE_FORMULA = /^[=+\-@\t\r]/;
const NUMERO_SIMPLES = /^[+-]?(?:0|[1-9]\d{0,14})(?:[.,]\d+)?$/;
const MILHAR_PONTO_E_VIRGULA = /^[+-]?[1-9]\d{0,2}(?:\.\d{3})+,\d+$/;
const MILHAR_VIRGULA_E_PONTO = /^[+-]?[1-9]\d{0,2}(?:,\d{3})+\.\d+$/;
/** "1.250" ou "1,250": ou decimal ou milhar; "1.250.000": só milhar. */
const SEPARADOR_AMBIGUO = /^[+-]?[1-9]\d{0,2}[.,]\d{3}$/;
const MILHAR_REPETIDO = /^[+-]?[1-9]\d{0,2}(?:([.,])\d{3}){2,}$/;
/** "007": o Sheets tiraria os zeros; fica texto. */
const ZERO_A_ESQUERDA = /^0\d+(?:[.,]\d+)?$/;
const DATA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATA_BR = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/;

function emNumero(texto: string): number | null {
  const n = Number(texto);
  return Number.isFinite(n) ? n : null;
}

/**
 * Número puro em texto: "5", "-12.50", "5,5", "1.250,75" (ponto de milhar e
 * vírgula decimal) ou "1,250.75". Com um só separador, ele é decimal ("1.250"
 * = 1,25). Zero à esquerda ("007") não é número: o texto é preservado.
 */
export function numeroDe(texto: string): number | null {
  const t = texto.trim();
  if (NUMERO_SIMPLES.test(t)) return emNumero(t.replace(',', '.'));
  if (MILHAR_PONTO_E_VIRGULA.test(t)) return emNumero(t.replace(/\./g, '').replace(',', '.'));
  if (MILHAR_VIRGULA_E_PONTO.test(t)) return emNumero(t.replace(/,/g, ''));
  return null;
}

/** Colunas que o Sheets pode interpretar (número, data, verdadeiro/falso); todas as outras gravam sempre como texto. */
const COLUNAS_INTERPRETADAS = new Set(['data', 'valor', 'leitura', 'comprado?']);

/**
 * Como gravar o valor: número puro vira número; o resto com prefixo de fórmula (ou zero à esquerda) vira texto.
 * Com `coluna`, só Data, Valor, Leitura e Comprado? são interpretadas pelo Sheets; nas outras ("Quantidade" com
 * "1/2" ou "2-3", "Item" com "1,250") o texto fica como foi dito.
 */
export function formatoDe(valor: string, coluna?: string): { formato: Formato; valor: string } {
  if (coluna !== undefined && !COLUNAS_INTERPRETADAS.has(coluna.trim().toLowerCase())) return { formato: 'texto', valor };
  // Com espaço ou tabulação nas pontas não é "número puro".
  const numero = valor === valor.trim() ? numeroDe(valor) : null;
  if (numero !== null) return { formato: 'numero', valor: String(numero) };
  return { formato: PERIGO_DE_FORMULA.test(valor) || ZERO_A_ESQUERDA.test(valor.trim()) ? 'texto' : 'livre', valor };
}

/** Chaves de comparação de um texto que a planilha mostra: duas células "iguais" têm chave em comum. */
function chaves(texto: string): string[] {
  const t = texto.trim();
  const achadas: string[] = [];
  // Números: sem moeda nem espaços; a interpretação ambígua ("1.250") gera as duas.
  const limpo = t.replace(/R\$/g, '').replace(/[\s €$]/g, '');
  const numero = numeroDe(limpo);
  if (numero !== null) achadas.push(`n:${numero}`);
  if (SEPARADOR_AMBIGUO.test(limpo)) achadas.push(`n:${emNumero(limpo.replace(/[.,]/, ''))}`);
  else if (MILHAR_REPETIDO.test(limpo)) achadas.push(`n:${emNumero(limpo.replace(/[.,]/g, ''))}`);
  // Datas: aaaa-mm-dd ou dia/mês/ano (dd/mm/aaaa, como a planilha em português mostra).
  const iso = DATA_ISO.exec(t);
  const br = DATA_BR.exec(t);
  const [ano, mes, dia] = iso ? [iso[1]!, iso[2]!, iso[3]!] : br ? [br[3]!, br[2]!, br[1]!] : [];
  if (ano && mes && dia && Number(mes) >= 1 && Number(mes) <= 12 && Number(dia) >= 1 && Number(dia) <= 31) {
    achadas.push(`d:${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`);
  }
  achadas.push(`t:${t.replace(/\s+/g, ' ').toUpperCase()}`);
  // Verdadeiro/falso: o Sheets mostra TRUE ou VERDADEIRO conforme o idioma; o app grava "sim"/"não".
  const sem = t.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase();
  if (/^(?:TRUE|VERDADEIRO|SIM)$/.test(sem)) achadas.push('b:1');
  else if (/^(?:FALSE|FALSO|NAO)$/.test(sem)) achadas.push('b:0');
  return achadas;
}

/**
 * Dois textos de célula valem o mesmo? Ignora espaços nas pontas e maiúsculas
 * (TRUE = true); compara números pelo valor (5.50 = "5,5" = "1.250,75" com
 * 1250.75; moeda e espaços de fora) e datas como datas (2026-11-17 =
 * 17/11/2026, dia antes do mês).
 */
export function iguais(a: string, b: string): boolean {
  const dasChaves = new Set(chaves(a));
  return chaves(b).some((chave) => dasChaves.has(chave));
}

// ---------- planilha ----------

/** Define sem risco de `__proto__` mexer no protótipo. */
function definir(alvo: Record<string, string>, chave: string, valor: string): void {
  Object.defineProperty(alvo, chave, { value: valor, enumerable: true, writable: true, configurable: true });
}

/**
 * Coluna que identifica uma linha de dados em cada modelo. Linha com essa
 * coluna vazia (ex.: a linha de "Total", sem data) é ignorada na leitura e
 * não ganha id. Só vale quando a planilha tem TODOS os cabeçalhos do modelo.
 */
const COLUNA_CHAVE: Record<ModeloDePlanilha, string> = { compras: 'Item', consumo: 'Data', financeiro: 'Data' };

interface Tabela {
  /** Cabeçalhos limpos (sem espaços nas pontas), um por coluna da linha 1. */
  cabecalho: string[];
  /** Nome -> posição (a partir de 0); com nome repetido vale a primeira coluna. */
  posicao: Map<string, number>;
  /** Linhas de dados: a posição `i` é a linha `i + 2` da planilha. */
  linhas: string[][];
  /** Posição da coluna que identifica linha de dados, se a planilha tem os cabeçalhos de um modelo. */
  colunaChave: number | null;
}

function celulaDe(linha: string[], coluna: number): string {
  return linha[coluna] ?? '';
}

/**
 * Planilha criada antes de existir a coluna Observação em compras e financeiro
 * segue sendo do modelo. No consumo a Observação sempre existiu e continua exigida.
 */
const OPCIONAL: Partial<Record<ModeloDePlanilha, string>> = { compras: 'Observação', financeiro: 'Observação' };

function modeloDa(posicao: Map<string, number>): ModeloDePlanilha | null {
  for (const modelo of Object.keys(CABECALHOS) as ModeloDePlanilha[]) {
    if (CABECALHOS[modelo].every((nome) => nome === OPCIONAL[modelo] || posicao.has(nome))) return modelo;
  }
  return null;
}

function lerTabela(servico: ServicoDePlanilhas, planilhaId: string): Tabela {
  const valores = servico.lerValores(planilhaId, { linhas: LINHAS_NO_MAXIMO, colunas: COLUNAS_NO_MAXIMO });
  if (valores.length > LINHAS_NO_MAXIMO + 1 || valores.some((linha) => linha.length > COLUNAS_NO_MAXIMO)) throw new PlanilhaGrandeDemais();
  const cabecalho = (valores[0] ?? []).map((nome) => nome.trim());
  const posicao = new Map<string, number>();
  cabecalho.forEach((nome, i) => {
    if (nome && !posicao.has(nome)) posicao.set(nome, i);
  });
  const modelo = modeloDa(posicao);
  return { cabecalho, posicao, linhas: valores.slice(1), colunaChave: modelo ? posicao.get(COLUNA_CHAVE[modelo])! : null };
}

const FALTA_O_ID: ErroDeColuna = { erro: 'coluna_faltando', colunas: [NOME_DA_COLUNA_DE_ID] };

/** Linha sem nada, sem contar a coluna do id. */
function vazia(linha: string[], colunaId: number): boolean {
  return linha.every((valor, i) => i === colunaId || valor.trim() === '');
}

/** Linha que não é dado: vazia, ou com a coluna-chave do modelo vazia (ex.: "Total"). */
function ignorada(tabela: Tabela, linha: string[], colunaId: number): boolean {
  if (vazia(linha, colunaId)) return true;
  return tabela.colunaChave !== null && celulaDe(linha, tabela.colunaChave).trim() === '';
}

function idDaCelula(linha: string[], colunaId: number): string {
  return celulaDe(linha, colunaId).trim();
}

/** Posições (em `tabela.linhas`) das linhas de dados sem id ou com id repetido (cópia feita à mão). */
function semIdOuRepetido(tabela: Tabela, colunaId: number): number[] {
  const vistos = new Set<string>();
  const achadas: number[] = [];
  tabela.linhas.forEach((linha, i) => {
    if (ignorada(tabela, linha, colunaId)) return;
    const id = idDaCelula(linha, colunaId);
    if (id === '' || vistos.has(id)) achadas.push(i);
    else vistos.add(id);
  });
  return achadas;
}

/** Colunas pedidas que a planilha não tem, na ordem do pedido. */
function colunasQueFaltam(tabela: Tabela, pedidas: string[]): string[] {
  return pedidas.filter((nome) => !tabela.posicao.has(nome));
}

const cortar = (texto: string): string => (texto.length > TAMANHO_MAXIMO_DO_VALOR ? texto.slice(0, TAMANHO_MAXIMO_DO_VALOR) : texto);

function resultadoDaLeitura(tabela: Tabela, colunaId: number) {
  const linhas: { id: string; valores: Record<string, string> }[] = [];
  for (const linha of tabela.linhas) {
    if (ignorada(tabela, linha, colunaId)) continue;
    const valores: Record<string, string> = {};
    tabela.cabecalho.forEach((nome, i) => {
      if (nome && i !== colunaId && tabela.posicao.get(nome) === i) definir(valores, nome, cortar(celulaDe(linha, i)));
    });
    linhas.push({ id: idDaCelula(linha, colunaId), valores });
  }
  return { cabecalho: [...tabela.cabecalho], linhas };
}

/**
 * Pasta "Casa (partilhada)" do dono DENTRO de "Central", sem criar. Sem a
 * "Central" ou sem a subpasta: `null`. Mais de uma de qualquer das duas: erro,
 * o script não adivinha. A que ficou solta na raiz (antes da pasta Central) não
 * vale: `autorizarV02` / `organizarPastaCentral` a movem para dentro.
 */
function pastaDaCasa(servico: ServicoDePlanilhas): string | null {
  const central = pastaCentral(servico, { criar: false });
  if (central === null) return null;
  return umaSo(servico.procurarPasta(NOME_DA_PASTA_DA_CASA, central), NOME_DA_PASTA_DA_CASA);
}

/** A planilha existe, é do dono e está DIRETO na pasta da Casa? Não diz por que não, se não. */
function estaNaPasta(servico: ServicoDePlanilhas, planilhaId: string): boolean {
  if (!ID_DO_DRIVE.test(planilhaId)) return false;
  const pasta = pastaDaCasa(servico);
  return pasta !== null && servico.inspecionar(planilhaId, pasta);
}

/** `SemAcesso` do serviço vira `sem_acesso`, igual nas ações que leem ou gravam planilha. */
function tratandoSemAcesso<T>(fazer: () => T): T | SemAcessoResposta {
  try {
    return fazer();
  } catch (erro) {
    if (erro instanceof SemAcesso) return { erro: 'sem_acesso' };
    throw erro;
  }
}

// ---------- ações ----------

/**
 * Cria a planilha do modelo DENTRO de "Central/Casa (partilhada)" no Drive do
 * dono, criando as pastas que faltarem. Na trava: dois pedidos juntos não fazem
 * duas pastas. Se não há Casa em Central mas há uma na raiz (de antes da
 * pasta Central), não cria outra: responde `organizar_pastas` e nada é criado. Não é idempotente: repetir cria outra planilha com o mesmo nome.
 */
export function criarPlanilha(dados: unknown, { servico, comTrava }: ContextoDePlanilhas): { planilhaId: string } | FaltaOrganizar {
  const pedido = objeto(dados);
  const nome = nomeDaPlanilha(pedido.nome);
  const modelo = pedido.modelo;
  if (typeof modelo !== 'string' || !Object.prototype.hasOwnProperty.call(CABECALHOS, modelo)) throw new PedidoDePlanilhaInvalido();
  const cabecalho = CABECALHOS[modelo as ModeloDePlanilha];
  return comTrava(() => {
    let central = pastaCentral(servico, { criar: false });
    let pasta = central === null ? null : umaSo(servico.procurarPasta(NOME_DA_PASTA_DA_CASA, central), NOME_DA_PASTA_DA_CASA);
    if (pasta === null) {
      // A Casa de antes da pasta Central ainda está solta na raiz: não se cria outra (ficariam duas, e a
      // organização não mexe quando há nas duas). O dono roda organizarPastaCentral antes.
      if (servico.procurarPasta(NOME_DA_PASTA_DA_CASA, 'root').length > 0) return FALTA_ORGANIZAR;
      central = central ?? pastaCentral(servico, { criar: true });
      pasta = servico.criarPasta(NOME_DA_PASTA_DA_CASA, central);
    }
    // Datas em aaaa-mm-dd: a Central lê a célula como a planilha a mostra, e "5/11/2026" muda de sentido (maio ou
    // novembro) conforme o idioma da planilha. Supõe-se planilha criada por aqui; a do dono, à mão, pode mostrar dd/mm/aaaa.
    const colunasDeData = cabecalho.flatMap((titulo, i) => (titulo === 'Data' ? [i + 1] : []));
    return { planilhaId: servico.criarPlanilha(nome, pasta, cabecalho, cabecalho.length, colunasDeData) };
  });
}

type SemAcessoResposta = { erro: 'sem_acesso' };

export type RespostaDeLeitura =
  | { cabecalho: string[]; linhas: { id: string; valores: Record<string, string> }[] }
  | ForaDaPasta
  | SemAcessoResposta
  | ErroDeColuna;

/**
 * Lê as linhas por nome de cabeçalho. `valores` traz todas as colunas com nome
 * (inclusive as extras do usuário), menos `id`; o texto é o que aparece na
 * tela, cortado em 2000 caracteres. Linha totalmente vazia (só com id, no
 * máximo) é ignorada, e também a linha sem a coluna-chave do modelo (`COLUNA_CHAVE`),
 * como a de "Total". Linha de dados sem id, ou com id repetido, ganha um id
 * novo (UUID), gravado só nessa coluna, numa só escrita, dentro da trava, relendo
 * a planilha e conferindo a pasta de novo antes. Sem a coluna `id` na planilha:
 * `coluna_faltando` (nada é gravado).
 */
export function lerLinhas(dados: unknown, contexto: ContextoDePlanilhas): RespostaDeLeitura {
  const { servico, comTrava, gerarId } = contexto;
  const planilhaId = textoDoPedido(objeto(dados).planilhaId);
  if (!estaNaPasta(servico, planilhaId)) return FORA_DA_PASTA;
  return tratandoSemAcesso((): RespostaDeLeitura => {
    const tabela = lerTabela(servico, planilhaId);
    const colunaId = tabela.posicao.get(NOME_DA_COLUNA_DE_ID);
    if (colunaId === undefined) return FALTA_O_ID;
    if (semIdOuRepetido(tabela, colunaId).length === 0) return resultadoDaLeitura(tabela, colunaId);
    return comTrava((): RespostaDeLeitura => {
      if (!estaNaPasta(servico, planilhaId)) return FORA_DA_PASTA;
      const atual = lerTabela(servico, planilhaId);
      const coluna = atual.posicao.get(NOME_DA_COLUNA_DE_ID);
      if (coluna === undefined) return FALTA_O_ID;
      const novos: { linha: number; id: string }[] = [];
      const usados = new Set(atual.linhas.map((linha) => idDaCelula(linha, coluna)).filter(Boolean));
      for (const i of semIdOuRepetido(atual, coluna)) {
        let id = gerarId();
        while (usados.has(id)) id = gerarId();
        usados.add(id);
        const linha = atual.linhas[i]!;
        while (linha.length <= coluna) linha.push('');
        linha[coluna] = id;
        novos.push({ linha: i + 2, id });
      }
      if (novos.length > 0) servico.escreverIds(planilhaId, coluna + 1, novos);
      return resultadoDaLeitura(atual, coluna);
    });
  });
}

export type RespostaDeAnexo = { ok: true } | ErroDeColuna | ForaDaPasta | SemAcessoResposta | { erro: 'planilha_cheia' };

/**
 * Acrescenta uma linha no fim, com `idDaLinha` na coluna `id`. Idempotente:
 * se já existe uma linha com esse id, não faz nada e responde ok. Só grava as
 * colunas de `valores`; colunas extras do usuário ficam vazias. Se `valores`
 * (ou a coluna `id`) citar coluna que a planilha não tem: `coluna_faltando` e
 * nada é gravado. Planilha já com 5000 linhas: `planilha_cheia`. A linha inteira
 * (id incluído) vai numa só escrita, que recusa gravar se a linha já tiver
 * conteúdo. Nunca apaga nem altera linha existente.
 */
export function anexarLinha(dados: unknown, { servico, comTrava }: ContextoDePlanilhas): RespostaDeAnexo {
  const pedido = objeto(dados);
  const planilhaId = textoDoPedido(pedido.planilhaId);
  const id = idDaLinha(pedido.idDaLinha);
  const valores = valoresDoPedido(pedido.valores);
  if (!estaNaPasta(servico, planilhaId)) return FORA_DA_PASTA;
  return tratandoSemAcesso((): RespostaDeAnexo =>
    comTrava((): RespostaDeAnexo => {
      if (!estaNaPasta(servico, planilhaId)) return FORA_DA_PASTA;
      const tabela = lerTabela(servico, planilhaId);
      const faltam = colunasQueFaltam(tabela, [NOME_DA_COLUNA_DE_ID, ...valores.map(([coluna]) => coluna)]);
      if (faltam.length > 0) return { erro: 'coluna_faltando', colunas: faltam };
      const colunaId = tabela.posicao.get(NOME_DA_COLUNA_DE_ID)!;
      if (tabela.linhas.some((linha) => idDaCelula(linha, colunaId) === id)) return { ok: true };
      if (tabela.linhas.length >= LINHAS_NO_MAXIMO) return { erro: 'planilha_cheia' };
      const celulas: CelulaNova[] = tabela.cabecalho.map((_nome, i) => ({ coluna: i + 1, valor: '', formato: 'livre' }));
      for (const [coluna, valor] of valores) {
        const posicao = tabela.posicao.get(coluna)!;
        celulas[posicao] = { coluna: posicao + 1, ...formatoDe(valor, coluna) };
      }
      celulas[colunaId] = { coluna: colunaId + 1, valor: id, formato: 'texto' };
      servico.escreverLinhaNova(planilhaId, tabela.linhas.length + 2, celulas);
      return { ok: true };
    }),
  );
}

export type RespostaDeAtualizacao =
  | { ok: true; valores: Record<string, string> }
  | { conflito: true }
  | { erro: 'linha_nao_achada' }
  | ErroDeColuna
  | ForaDaPasta
  | SemAcessoResposta;

/**
 * Muda células de uma linha achada pelo id (na posição que ela tiver agora,
 * mesmo com linhas inseridas ou apagadas acima). Só toca as colunas de `valores`.
 *
 * Conflito: `antes` (opcional) traz o que o app tinha lido nessas colunas. Para
 * cada coluna alterada: se o valor atual já é o novo, não há o que fazer (nem
 * conflito: repetir depois de resposta perdida dá ok); senão, se `antes` cita a
 * coluna e o valor atual é diferente dele, alguém mexeu desde a leitura:
 * `{ conflito: true }` e NADA é gravado (nem as colunas sem conflito). Coluna
 * sem entrada em `antes` não é conferida (a última escrita vale). A comparação
 * é `iguais`: tolera o que a planilha reformata (número, data, caixa, espaços).
 *
 * Logo antes de gravar, relê o id da linha-alvo (alguém pode ter inserido ou
 * apagado linhas desde a leitura): mudou, `linha_nao_achada`. O `ok` traz em
 * `valores` o que a planilha mostra DEPOIS de gravar, nas colunas do pedido: o
 * app usa como o novo `antes`.
 */
export function atualizarLinha(dados: unknown, { servico, comTrava }: ContextoDePlanilhas): RespostaDeAtualizacao {
  const pedido = objeto(dados);
  const planilhaId = textoDoPedido(pedido.planilhaId);
  const id = idDaLinha(pedido.idDaLinha);
  const valores = valoresDoPedido(pedido.valores);
  const antes = new Map(pedido.antes === undefined ? [] : mapaDeTextos(pedido.antes, { permitirVazio: true }));
  if (!estaNaPasta(servico, planilhaId)) return FORA_DA_PASTA;
  return tratandoSemAcesso((): RespostaDeAtualizacao =>
    comTrava((): RespostaDeAtualizacao => {
      if (!estaNaPasta(servico, planilhaId)) return FORA_DA_PASTA;
      const tabela = lerTabela(servico, planilhaId);
      const faltam = colunasQueFaltam(tabela, [NOME_DA_COLUNA_DE_ID, ...valores.map(([coluna]) => coluna)]);
      if (faltam.length > 0) return { erro: 'coluna_faltando', colunas: faltam };
      const colunaId = tabela.posicao.get(NOME_DA_COLUNA_DE_ID)!;
      const indice = tabela.linhas.findIndex((linha) => idDaCelula(linha, colunaId) === id);
      if (indice < 0) return { erro: 'linha_nao_achada' };
      const atual = tabela.linhas[indice]!;
      const linha = indice + 2;
      const aGravar: { nome: string; celula: CelulaNova }[] = [];
      const mostrado: [string, string][] = [];
      for (const [coluna, valor] of valores) {
        const posicao = tabela.posicao.get(coluna)!;
        const valorAtual = celulaDe(atual, posicao);
        mostrado.push([coluna, cortar(valorAtual)]);
        if (iguais(valorAtual, valor)) continue;
        const lido = antes.get(coluna);
        if (lido !== undefined && !iguais(cortar(valorAtual), lido)) return { conflito: true };
        aGravar.push({ nome: coluna, celula: { coluna: posicao + 1, ...formatoDe(valor, coluna) } });
      }
      if (aGravar.length > 0) {
        if (servico.lerCelula(planilhaId, linha, colunaId + 1).trim() !== id) return { erro: 'linha_nao_achada' };
        const exibidos = servico.escreverCelulas(planilhaId, linha, aGravar.map((a) => a.celula));
        aGravar.forEach((a, i) => {
          const m = mostrado.find(([coluna]) => coluna === a.nome)!;
          m[1] = cortar(exibidos[i] ?? '');
        });
      }
      const resultado: Record<string, string> = {};
      for (const [coluna, valor] of mostrado) definir(resultado, coluna, valor);
      return { ok: true, valores: resultado };
    }),
  );
}
