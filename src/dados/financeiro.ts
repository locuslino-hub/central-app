// Financeiro (V02, Tarefa 15): lê os lançamentos de uma planilha (modelo "financeiro": Data, Descrição, Categoria, Tipo,
// Valor, Quem, Observação), soma o mês e anexa um gasto novo. Serve à tela Financeiro e à voz de gasto (executar.ts).
//
// - A planilha é dado de terceiros (outras pessoas com acesso à pasta editam): lê-se por NOME de cabeçalho; `Data` aceita
//   `AAAA-MM-DD` (o formato em que o script cria a coluna) ou `dd/mm/aaaa` (supõe-se dia antes do mês); `Valor` aceita
//   "1.250,75", "5,50", "1250.75", com €/EUR ("€ 5,50"), com sinal ("-5,50": reembolso, abate do total) ou entre
//   parênteses ("(5,50)", contábil). Separador único seguido de exatamente 3 dígitos é milhar ("1.250" e "1,250" valem
//   1250: nunca 1,25). Outra moeda (R$, US$, $), valor menor que 0,005 e valor acima de 1 bilhão não são lidos. Linha com
//   valor ou data ilegível NÃO entra na conta: vira texto em `avisos`. Linha "(desfeito)" (Observação = "desfeito")
//   fica de fora.
// - Resumos e categorias saem das linhas, calculados aqui (nada de fórmula nem aba de resumo). Somas em centavos inteiros.
// - Até a planilha final do dono chegar, gravar SEMPRE cria linha nova (decisão do plano, 9 da especificação). Nada apaga
//   linha: o desfazer é o de `anexar` (marca "desfeito" em Observação, ou tira da fila).
// - Só €: a coluna Valor não tem moeda; gravar R$ ali misturaria moedas nos totais. Por isso `registrarGasto` recusa
//   moeda diferente de € (quem chama decide: guardar como ideia, por exemplo).
import { normalizar } from '../chat/datas';
import { lerNumero } from '../chat/roteador';
import { hojeEmLisboa } from './dia';
import { dataDeTexto } from './leituras';
import {
  anexar,
  atualizar,
  lerPlanilha,
  COLUNA_DO_DESFEITO,
  MARCA_DO_DESFEITO,
  type AvisoDePlanilha,
  type LinhaDaPlanilha,
  type OpcoesDePlanilha,
  type ResultadoDaAtualizacao,
  type ResultadoDoAnexo,
  type ResultadoDoDesfazer,
} from './planilhas';
import type { Pasta } from './tipos';

export const TIPO_PADRAO = 'Débito';
export const CATEGORIA_PADRAO = 'Outros';
/** Nome do grupo, em `porTipo`, dos lançamentos sem Tipo na planilha. */
export const TIPO_SEM_TIPO = '(sem tipo)';
/** O que a Central escreve em "Quem" quando quem chama não diz (o app não tem nome de usuário; igual à Lista de compras). */
export const QUEM_DA_CENTRAL = 'Central';
export const DESCRICAO_NO_MAXIMO = 200;
export const CATEGORIA_NO_MAXIMO = 60;
export const TIPO_NO_MAXIMO = 30;
export const QUEM_NO_MAXIMO = 60;
export const OBSERVACAO_NO_MAXIMO = 500;
/** Valor (em módulo) acima disto não é lido nem gravado: erro de digitação, e protege a soma. */
export const VALOR_NO_MAXIMO = 1_000_000_000;
/** Menor valor lido: abaixo de meio centavo viraria 0 na soma, em silêncio. */
export const VALOR_NO_MINIMO = 0.005;
export const ANO_MINIMO = 2000;
export const ANO_MAXIMO = 2100;
/** Quantas linhas fora da conta são descritas uma a uma em `avisos`; as outras viram "e mais N". */
export const AVISOS_NO_MAXIMO = 20;

// ---------- números e textos ----------

/**
 * `5.555` → 556 (centavos, meio para cima, sem o erro de ponto flutuante de `5.555 * 100`). Número em notação
 * científica (`1e-7`) cai em `Math.round(valor * 100)`. `NaN` só se `valor` não for número finito.
 */
const emCentavos = (valor: number): number => {
  const c = Number(`${valor}e2`);
  return Number.isFinite(c) ? Math.round(c) : Math.round(valor * 100);
};

const MOEDA = '(?:€|eur)';
const VALOR = new RegExp(`^${MOEDA}?\\s*([-−+])?\\s*${MOEDA}?\\s*([\\d.,\\s]*\\d)\\s*${MOEDA}?$`, 'i');
const CONTABIL = new RegExp(`^${MOEDA}?\\s*\\((.*)\\)\\s*${MOEDA}?$`, 'i');

/**
 * O número da célula de valor, ou `null`. Aceita € ou EUR antes ou depois, sinal (+, -, −), parênteses contábeis
 * ("(5,50)" = -5,50) e espaço só como separador de milhar ("1 250,75"; "5 5" não é 55). Separador único ("," ou ".")
 * seguido de exatamente 3 dígitos é milhar ("1,250" e "1.250" = 1250), exceto com zero na frente ("0,250" = 0,25).
 * Vazio, texto solto, fórmula, outra moeda (R$, US$, $), valor entre 0 e 0,005 e acima de `VALOR_NO_MAXIMO` dão `null`.
 */
export function valorDeTexto(texto: string): number | null {
  const t = texto.trim();
  const contabil = CONTABIL.exec(t);
  if (contabil) {
    const dentro = valorDeTexto(contabil[1]!);
    return dentro === null || dentro < 0 ? null : dentro === 0 ? 0 : -dentro;
  }
  const m = VALOR.exec(t);
  if (!m) return null;
  let corpo = m[2]!;
  if (/\s/.test(corpo)) {
    if (!/^\d{1,3}(?:\s\d{3})+(?:[.,]\d+)?$/.test(corpo)) return null;
    corpo = corpo.replace(/\s/g, '');
  }
  if (/^[1-9]\d{0,2}[.,]\d{3}$/.test(corpo)) corpo = corpo.replace(/[.,]/, '');
  const n = lerNumero(corpo);
  if (n === null || n > VALOR_NO_MAXIMO || (n !== 0 && n < VALOR_NO_MINIMO)) return null;
  return m[1] === '-' || m[1] === '−' ? (n === 0 ? 0 : -n) : n;
}

/** Espaços juntos, sem quebra de linha nem caractere de controle. */
const limpar = (texto: unknown): string => (typeof texto === 'string' ? texto.replace(/[\p{Cc}\s]+/gu, ' ').trim() : '');

/** Chave para agrupar: sem acento, sem maiúscula, espaços juntos e sem espaço nas pontas. */
const chave = (texto: string): string => normalizar(limpar(texto));

const cortar = (texto: string, n = 40): string => (texto.length > n ? `${texto.slice(0, n)}…` : texto);

/** Quantas letras da grafia têm acento ou maiúscula (para desempatar: "Alimentação" ganha de "alimentacao"). */
const enfeites = (grafia: string): number => [...grafia].filter((c) => normalizar(c) !== c).length;

/** A grafia mais frequente do grupo; empate: a com mais acento e maiúscula, depois a ordem alfabética. */
function melhorGrafia(variantes: ReadonlyMap<string, number>): string {
  return [...variantes.entries()].sort(([a, na], [b, nb]) => nb - na || enfeites(b) - enfeites(a) || a.localeCompare(b, 'pt-BR'))[0]![0];
}

/** Junta nomes que só diferem em maiúscula, acento ou espaço; soma os centavos de cada grupo e dá a grafia de exibição. */
function agrupar(itens: Iterable<{ nome: string; centavos: number }>): { nome: string; centavos: number }[] {
  const grupos = new Map<string, { variantes: Map<string, number>; centavos: number }>();
  for (const item of itens) {
    const nome = limpar(item.nome);
    const k = chave(nome);
    let g = grupos.get(k);
    if (!g) {
      g = { variantes: new Map(), centavos: 0 };
      grupos.set(k, g);
    }
    g.centavos += item.centavos;
    g.variantes.set(nome, (g.variantes.get(nome) ?? 0) + 1);
  }
  return [...grupos.values()].map((g) => ({ nome: melhorGrafia(g.variantes), centavos: g.centavos }));
}

const emOrdemAlfabetica = (nomes: Iterable<string>): string[] =>
  agrupar([...nomes].map((nome) => ({ nome, centavos: 0 })))
    .map((g) => g.nome)
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));

// ---------- ler ----------

export type Lancamento = {
  /** Id da linha na planilha. */
  id: string;
  /** `AAAA-MM-DD`. */
  data: string;
  descricao: string;
  /** Vazia na planilha vira `CATEGORIA_PADRAO`. */
  categoria: string;
  tipo: string;
  /** Em €, pode ser negativo (reembolso). */
  valor: number;
  quem: string;
  /** `fila`: sem rede, sai ao voltar. */
  pendente?: 'fila';
};

export type NaoSalvo = { id: string; descricao: string; valor: string };

export type ResumoDeLancamentos = {
  /** Na ordem da planilha. */
  lancamentos: Lancamento[];
  /**
   * Uma frase por linha que ficou fora da conta (valor ou data ilegível), até `AVISOS_NO_MAXIMO`; passando disso, a
   * última frase é "e mais N linhas fora da conta".
   */
  avisos: string[];
  /** Quantas linhas ficaram fora da conta por valor ou data ilegível (todas, mesmo as que não têm frase em `avisos`). */
  foraDaConta: number;
  /** Anexos que a sincronia desistiu de enviar: não estão salvos. */
  naoSalvos: NaoSalvo[];
};

export type LeituraDeLancamentos = ResumoDeLancamentos & {
  /** `true`: sem rede, veio do cache. */
  doCache: boolean;
  /** Aviso da planilha (`planilha_mudou`: faltou coluna; mostra o que dá e a Central não deve gravar). */
  aviso?: AvisoDePlanilha;
};

const CAMPOS = ['Data', 'Descrição', 'Categoria', 'Tipo', 'Valor', 'Quem'] as const;

/** Os lançamentos de linhas já lidas de uma planilha. Não falha com linha estranha. */
export function lancamentosDeLinhas(linhas: readonly LinhaDaPlanilha[]): ResumoDeLancamentos {
  const lancamentos: Lancamento[] = [];
  const frases: string[] = [];
  const naoSalvos: NaoSalvo[] = [];
  for (const linha of linhas) {
    const v = (coluna: string) => (linha.valores[coluna] ?? '').trim();
    if (v(COLUNA_DO_DESFEITO).toLowerCase() === MARCA_DO_DESFEITO) continue;
    if (CAMPOS.every((campo) => v(campo) === '')) continue; // linha em branco
    const descricao = v('Descrição');
    if (linha.pendente === 'parada') {
      naoSalvos.push({ id: linha.id, descricao, valor: v('Valor') });
      continue;
    }
    const onde = descricao !== '' ? `"${cortar(descricao)}"` : v('Data') !== '' ? `de ${cortar(v('Data'))}` : 'sem descrição';
    const valor = valorDeTexto(v('Valor'));
    if (valor === null) {
      frases.push(`Valor ilegível no lançamento ${onde}: ${v('Valor') === '' ? 'vazio' : `"${cortar(v('Valor'))}"`}`);
      continue;
    }
    const data = dataDeTexto(v('Data'));
    if (data === null) {
      frases.push(`Data ilegível no lançamento ${onde}: ${v('Data') === '' ? 'vazia' : `"${cortar(v('Data'))}"`}`);
      continue;
    }
    lancamentos.push({
      id: linha.id,
      data,
      descricao,
      categoria: v('Categoria') || CATEGORIA_PADRAO,
      tipo: v('Tipo'),
      valor,
      quem: v('Quem'),
      ...(linha.pendente === 'fila' ? { pendente: 'fila' as const } : {}),
    });
  }
  const avisos = frases.slice(0, AVISOS_NO_MAXIMO);
  const resto = frases.length - avisos.length;
  if (resto > 0) avisos.push(`e mais ${resto} ${resto === 1 ? 'linha fora da conta' : 'linhas fora da conta'}`);
  return { lancamentos, avisos, foraDaConta: frases.length, naoSalvos };
}

/**
 * Os lançamentos da planilha da pasta. Com rede, lê no script; sem rede, usa o cache (`doCache`). Lança se a pasta
 * não tem planilha (como `lerPlanilha`).
 */
export async function lerLancamentos(pasta: Pasta, opcoes: OpcoesDePlanilha = {}): Promise<LeituraDeLancamentos> {
  const leitura = await lerPlanilha(pasta, opcoes);
  return { ...lancamentosDeLinhas(leitura.linhas), doCache: leitura.doCache, ...(leitura.aviso ? { aviso: leitura.aviso } : {}) };
}

// ---------- resumir ----------

export type ResumoDoMes = {
  /** Em €, soma de todos os lançamentos do mês (reembolso abate). */
  total: number;
  /** Do maior para o menor. */
  porCategoria: { categoria: string; total: number }[];
  /** Do maior para o menor; lançamento sem Tipo entra em `TIPO_SEM_TIPO`. */
  porTipo: { tipo: string; total: number }[];
};

const MES = /^\d{4}-(?:0[1-9]|1[0-2])$/;

const doMaiorAoMenor = (a: { nome: string; centavos: number }, b: { nome: string; centavos: number }) => b.centavos - a.centavos || a.nome.localeCompare(b.nome, 'pt-BR');

/**
 * Soma o mês `AAAA-MM` (por data, ISO ou dd/mm/aaaa) por categoria e por tipo, em centavos inteiros. Categoria e tipo
 * que só diferem em maiúscula, acento ou espaço ficam juntos, com a grafia mais usada (empate: a com acento e maiúscula).
 * Mês sem lançamentos, ou `mes` fora do formato, dá tudo 0/vazio.
 */
export function resumoDoMes(lancamentos: readonly Lancamento[], mes: string): ResumoDoMes {
  const doMes = MES.test(mes)
    ? lancamentos.flatMap((l) => {
        const data = dataDeTexto(l.data);
        const centavos = emCentavos(l.valor);
        return data?.startsWith(mes) && Number.isFinite(centavos) ? [{ l, centavos }] : [];
      })
    : [];
  return {
    total: doMes.reduce((soma, { centavos }) => soma + centavos, 0) / 100,
    porCategoria: agrupar(doMes.map(({ l, centavos }) => ({ nome: limpar(l.categoria) || CATEGORIA_PADRAO, centavos })))
      .sort(doMaiorAoMenor)
      .map(({ nome, centavos }) => ({ categoria: nome, total: centavos / 100 })),
    porTipo: agrupar(doMes.map(({ l, centavos }) => ({ nome: limpar(l.tipo) || TIPO_SEM_TIPO, centavos })))
      .sort(doMaiorAoMenor)
      .map(({ nome, centavos }) => ({ tipo: nome, total: centavos / 100 })),
  };
}

/** As categorias já usadas (sem duplicata por maiúscula, acento ou espaço), em ordem alfabética. Vazia vira `CATEGORIA_PADRAO`. */
export function categoriasEmUso(lancamentos: readonly Lancamento[]): string[] {
  return emOrdemAlfabetica(lancamentos.map((l) => limpar(l.categoria) || CATEGORIA_PADRAO));
}

/** Os nomes já usados em "Quem" (sem duplicata por maiúscula, acento ou espaço; vazio não conta), em ordem alfabética. */
export function quemEmUso(lancamentos: readonly Lancamento[]): string[] {
  return emOrdemAlfabetica(lancamentos.map((l) => limpar(l.quem)).filter((q) => q !== ''));
}

/** Os tipos já usados (sem duplicata por maiúscula, acento ou espaço; vazio não conta), em ordem alfabética. */
export function tiposEmUso(lancamentos: readonly Lancamento[]): string[] {
  return emOrdemAlfabetica(lancamentos.map((l) => limpar(l.tipo)).filter((t) => t !== ''));
}

/**
 * A categoria como já existe na planilha: se `categoria` é igual a uma de `existentes` sem contar acento, maiúscula nem
 * espaço, devolve a grafia da existente; senão devolve a categoria limpa. Vazia vira `CATEGORIA_PADRAO`.
 */
export function canonicalizarCategoria(categoria: string, existentes: readonly string[]): string {
  const limpa = limpar(categoria) || CATEGORIA_PADRAO;
  const igual = existentes.map(limpar).find((e) => e !== '' && chave(e) === chave(limpa));
  return igual ?? limpa;
}

// ---------- gravar ----------

/**
 * Um gasto novo. O `Gasto` que `extrairGasto` (chat/roteador) devolve serve como está (a moeda e os avisos dele são
 * usados). `data` em `AAAA-MM-DD` (ou dd/mm/aaaa); `tipo` padrão "Débito"; `categoria` vazia vira "Outros"; `quem`
 * padrão "Central" (quem chama pode passar o nome escolhido, ver `quemEmUso`).
 */
export type NovoGasto = {
  valor: number;
  data: string;
  descricao: string;
  categoria?: string | null;
  tipo?: string;
  quem?: string;
  /** Só `€` é gravado (ver o topo do arquivo); outra moeda é recusada. */
  moeda?: '€' | 'R$';
  observacao?: string;
  /** Avisos de quem entendeu a frase (ex.: "usei a data de hoje"); repassados em `avisos`. */
  avisos?: readonly string[];
};

export type OpcoesDoGasto = OpcoesDePlanilha & {
  /** `AAAA-MM-DD`; padrão: hoje em Lisboa (só para avisar de data no futuro). */
  hoje?: string;
};

export type MotivoDaRecusa = 'valor_invalido' | 'data_invalida' | 'texto_longo' | 'moeda_diferente' | 'descricao_vazia';

export type ResultadoDoGasto =
  | {
      gravado: true;
      idDaLinha: string;
      /** `enviada`: já está na planilha; `na_fila`: sem rede, sai ao voltar. */
      situacao: 'enviada' | 'na_fila';
      anexo: ResultadoDoAnexo;
      /** O que foi gravado, já como a tela o mostra. */
      lancamento: Lancamento;
      avisos: string[];
      /** Nunca apaga linha (veja `anexar`): tira da fila ou marca "desfeito". Pode ser repetido. */
      desfazer: () => Promise<ResultadoDoDesfazer>;
    }
  | {
      gravado: false;
      /** `recusada`: o gasto não presta (veja `motivo`); `bloqueada`: a planilha não deixou (veja `aviso`). */
      situacao: 'recusada' | 'bloqueada';
      motivo?: MotivoDaRecusa;
      aviso?: AvisoDePlanilha;
      /** Frase pronta, em português, para o cartão. */
      mensagem: string;
      avisos: string[];
    };

const recusa = (motivo: MotivoDaRecusa, mensagem: string, avisos: string[]): ResultadoDoGasto => ({ gravado: false, situacao: 'recusada', motivo, mensagem, avisos });

/**
 * Anexa um gasto à planilha da pasta (sempre linha nova). Antes de gravar confere: valor número finito maior que 0 e
 * até `VALOR_NO_MAXIMO`, data que existe (ano de `ANO_MINIMO` a `ANO_MAXIMO`), moeda €, descrição não vazia, textos nos
 * limites; se algo não presta, NÃO grava e diz o motivo (`situacao: 'recusada'`). Data no futuro grava, com aviso. Valor
 * com mais de 2 casas é arredondado para centavos, com aviso. Sem rede o gasto fica na fila (`na_fila`); planilha mudada
 * (coluna faltando) ou sem acesso bloqueia (`bloqueada`, nada gravado). Lança se a pasta não tem planilha.
 */
export async function registrarGasto(pasta: Pasta, gasto: NovoGasto, opcoes: OpcoesDoGasto = {}): Promise<ResultadoDoGasto> {
  const { hoje = hojeEmLisboa(), ...daPlanilha } = opcoes;
  const avisos = (Array.isArray(gasto.avisos) ? gasto.avisos : []).filter((a): a is string => typeof a === 'string');

  const reais = typeof gasto.valor === 'number' ? gasto.valor : Number.NaN;
  const centavos = Number.isFinite(reais) && Math.abs(reais) <= VALOR_NO_MAXIMO ? emCentavos(reais) : Number.NaN;
  if (!(centavos > 0)) return recusa('valor_invalido', 'O valor do gasto precisa ser um número maior que zero.', avisos);

  const data = typeof gasto.data === 'string' ? dataDeTexto(gasto.data) : null;
  if (data === null) return recusa('data_invalida', 'A data do gasto não é uma data que existe.', avisos);
  const ano = Number(data.slice(0, 4));
  if (ano < ANO_MINIMO || ano > ANO_MAXIMO) return recusa('data_invalida', `O ano da data do gasto precisa estar entre ${ANO_MINIMO} e ${ANO_MAXIMO}.`, avisos);

  if (gasto.moeda !== undefined && gasto.moeda !== '€') return recusa('moeda_diferente', `O Financeiro só guarda valores em € (veio ${String(gasto.moeda)}).`, avisos);

  const descricao = limpar(gasto.descricao);
  if (descricao === '') return recusa('descricao_vazia', 'O gasto precisa de uma descrição.', avisos);
  const categoria = limpar(gasto.categoria) || CATEGORIA_PADRAO;
  const tipo = limpar(gasto.tipo) || TIPO_PADRAO;
  const quem = limpar(gasto.quem) || QUEM_DA_CENTRAL;
  const observacao = limpar(gasto.observacao);
  const longos: [string, string, number][] = [
    ['descrição', descricao, DESCRICAO_NO_MAXIMO],
    ['categoria', categoria, CATEGORIA_NO_MAXIMO],
    ['tipo', tipo, TIPO_NO_MAXIMO],
    ['quem', quem, QUEM_NO_MAXIMO],
    ['observação', observacao, OBSERVACAO_NO_MAXIMO],
  ];
  const longo = longos.find(([, texto, maximo]) => texto.length > maximo);
  if (longo) return recusa('texto_longo', `A ${longo[0]} passa de ${longo[2]} caracteres.`, avisos);

  const valor = centavos / 100;
  const todosAvisos = [...avisos];
  if (emCentavos(reais) !== Number(`${reais}e2`)) todosAvisos.push(`Valor arredondado para centavos: ${valor}`);
  if (data > hoje) todosAvisos.push(`A data do gasto (${data}) ainda não chegou.`);

  const valores: Record<string, string> = { Data: data, Descrição: descricao, Categoria: categoria, Tipo: tipo, Valor: String(valor), Quem: quem };
  // "desfeito" sozinho é a marca de linha desfeita: escrito como observação, a linha sumiria da tela. Entre parênteses, não.
  if (observacao) valores[COLUNA_DO_DESFEITO] = observacao.toLowerCase() === MARCA_DO_DESFEITO ? `(${observacao})` : observacao;

  const anexo = await anexar(pasta, valores, daPlanilha);
  if (anexo.situacao === 'bloqueada') {
    const aviso = anexo.aviso ?? 'sem_acesso';
    return {
      gravado: false,
      situacao: 'bloqueada',
      aviso,
      mensagem: aviso === 'planilha_mudou' ? 'A planilha mudou (falta uma coluna): nada foi gravado.' : 'A planilha não deixou gravar: nada foi gravado.',
      avisos: todosAvisos,
    };
  }
  const lancamento: Lancamento = { id: anexo.idDaLinha, data, descricao, categoria, tipo, valor, quem, ...(anexo.situacao === 'na_fila' ? { pendente: 'fila' as const } : {}) };
  return { gravado: true, idDaLinha: anexo.idDaLinha, situacao: anexo.situacao, anexo, lancamento, avisos: todosAvisos, desfazer: anexo.desfazer };
}

// ---------- corrigir ----------

/**
 * Troca a categoria de uma linha (o "Trocar categoria" do cartão), por id. Categoria vazia vira "Outros"; a de mais de
 * `CATEGORIA_NO_MAXIMO` caracteres não é gravada e devolve `'categoria_invalida'`. Para reaproveitar a grafia já usada na
 * planilha, passe antes por `canonicalizarCategoria`. O resto é o resultado de `atualizar`.
 */
export async function trocarCategoria(pasta: Pasta, idDaLinha: string, categoria: string, opcoes: OpcoesDePlanilha = {}): Promise<ResultadoDaAtualizacao | 'categoria_invalida'> {
  const limpa = limpar(categoria) || CATEGORIA_PADRAO;
  if (limpa.length > CATEGORIA_NO_MAXIMO) return 'categoria_invalida';
  return atualizar(pasta, idDaLinha, { Categoria: limpa }, opcoes);
}
