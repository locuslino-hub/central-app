// Roteador de frases da V02 (Tarefa 3): gasto, leitura de consumo e itens de
// lista. Funções puras, sem IA e sem I/O. O "hoje" chega como `AAAA-MM-DD`.
//
// A busca roda sobre o texto normalizado (minúsculo e sem acento, mesmo
// comprimento da frase original), então um trecho achado ali serve para
// recortar a frase original sem perder os acentos do dono.

import { dataValida, normalizar, somarDias } from './datas';

export type Gasto = {
  valor: number;
  moeda: '€' | 'R$';
  descricao: string;
  data: string;
  categoria: string | null;
  avisos: string[];
};

export type Leitura = {
  servico: 'agua' | 'luz' | 'gas';
  valor: number;
  unidade: 'm³' | 'kWh';
  data: string;
  avisos: string[];
};

/** `generica`: "lista de compras" sem dizer qual (vale a pasta de Lista onde o dono está, ou a semanal). */
export type NomeDeLista = 'semanal' | 'casa' | 'generica';

export type Destino =
  | { tipo: 'gasto'; gasto: Gasto }
  | { tipo: 'leitura'; leitura: Leitura }
  | { tipo: 'lista'; lista: NomeDeLista; itens: string[] }
  | { tipo: 'outro' };

/** Tamanho máximo de frase aceito (frase maior vira `outro`). */
export const MAX_FRASE = 2000;

/**
 * Categorias por palavra-chave (já sem acento). Editável: o chamador pode
 * trocar por uma lista própria. Só termos genéricos.
 */
export const CATEGORIAS_PADRAO: Record<string, string[]> = {
  Alimentação: ['mercado', 'supermercado', 'padaria', 'salgado', 'cafe', 'restaurante', 'almoco', 'jantar',
    'lanche', 'pizza', 'comida', 'pao', 'feira', 'acougue'],
  Transporte: ['gasolina', 'combustivel', 'uber', 'taxi', 'onibus', 'metro', 'estacionamento', 'passagem', 'pedagio'],
  Casa: ['aluguel', 'condominio', 'luz', 'agua', 'gas', 'internet', 'reparo', 'limpeza'],
  Saúde: ['farmacia', 'remedio', 'consulta', 'medico', 'dentista', 'exame'],
  Lazer: ['cinema', 'streaming', 'viagem', 'bar', 'show', 'passeio'],
  Educação: ['curso', 'livro', 'mensalidade', 'material', 'inscricao'],
};

// ------------------------------------------------------------------- comuns

/** Frase utilizável: texto, até 2000 caracteres e com alguma letra ou número. */
function utilizavel(frase: unknown): frase is string {
  return typeof frase === 'string' && frase.length <= MAX_FRASE && /[\p{L}\p{N}]/u.test(frase);
}

const dois = (n: number) => String(n).padStart(2, '0');

/**
 * Número em formato brasileiro ("1.250,75"), europeu ou inglês ("1250.75",
 * "1,250.75"). Um separador só: vírgula é decimal; ponto é milhar quando
 * seguido de grupos de 3 dígitos ("1.250"), senão decimal ("40.5").
 */
export function lerNumero(s: string): number | null {
  const temV = s.includes(',');
  const temP = s.includes('.');
  let decimal: string | null = null;
  let milhar: string | null = null;
  if (temV && temP) {
    decimal = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
    milhar = decimal === ',' ? '.' : ',';
  } else if (temV) {
    if ((s.match(/,/g) ?? []).length === 1) decimal = ',';
    else milhar = ',';
  } else if (temP) {
    if (/^[1-9]\d{0,2}(\.\d{3})+$/.test(s)) milhar = '.';
    else decimal = '.';
  }
  if (decimal && (s.match(decimal === ',' ? /,/g : /\./g) ?? []).length !== 1) return null;
  if (milhar && decimal && s.lastIndexOf(milhar) > s.lastIndexOf(decimal)) return null;
  if (milhar && !new RegExp(`^\\d{1,3}(\\${milhar}\\d{3})+(\\${decimal ?? ','}\\d+)?$`).test(s)) return null;
  let t = s;
  if (milhar) t = t.split(milhar).join('');
  if (decimal === ',') t = t.replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

type Trecho = { ini: number; fim: number };

/** Troca os trechos por espaços (mesmo comprimento). */
function mascarar(n: string, trechos: Trecho[]): string {
  let r = n;
  for (const t of trechos) r = r.slice(0, t.ini) + ' '.repeat(t.fim - t.ini) + r.slice(t.fim);
  return r;
}

const PREF_DATA = '(?:(?:no|em|ate|do|de)\\s+)?(?:o\\s+)?(?:dia\\s+)?';
const SOLTA = '(?<![a-z\\d/.,-])';
const RE_PALAVRA_DATA = /(?<![a-z])(anteontem|ontem|hoje)(?![a-z])/g;
const RE_ISO = new RegExp(`${SOLTA}${PREF_DATA}(\\d{4})-(\\d{2})-(\\d{2})(?![\\d-])`, 'g');
const RE_BARRA = new RegExp(`${SOLTA}${PREF_DATA}(\\d{1,2})/(\\d{1,2})(?:/(\\d{4}|\\d{2}))?(?![\\d/])`, 'g');
const RE_PONTO = new RegExp(`${SOLTA}${PREF_DATA}(\\d{1,2})[.-](\\d{1,2})[.-](\\d{4})(?![\\d.-])`, 'g');
/** Hora escrita ("10h", "15:30"): não pode virar valor. */
const RE_HORA = /(?<![\d:/.,a-z])\d{1,2}(?::\d{2}|\s?h(?:\d{2})?)(?![a-z\d])/g;

type AchadoData = Trecho & { data: string | null; invalida: boolean };

/** Datas e horas escritas na frase normalizada. A primeira data vale. */
function acharDatas(n: string, hoje: string): { datas: AchadoData[]; horas: Trecho[] } {
  const ano0 = Number(hoje.slice(0, 4));
  const datas: AchadoData[] = [];
  const pos = (m: RegExpMatchArray): Trecho => ({ ini: m.index!, fim: m.index! + m[0].length });
  const montar = (m: RegExpMatchArray, a: number, mes: number, d: number) =>
    datas.push(dataValida(a, mes, d)
      ? { ...pos(m), data: `${a}-${dois(mes)}-${dois(d)}`, invalida: false }
      : { ...pos(m), data: null, invalida: true });

  for (const m of n.matchAll(RE_PALAVRA_DATA)) {
    const dias = m[1] === 'anteontem' ? -2 : m[1] === 'ontem' ? -1 : 0;
    datas.push({ ...pos(m), data: somarDias(hoje, dias), invalida: false });
  }
  for (const m of n.matchAll(RE_ISO)) montar(m, +m[1], +m[2], +m[3]);
  for (const m of n.matchAll(RE_PONTO)) montar(m, +m[3], +m[2], +m[1]);
  for (const m of n.matchAll(RE_BARRA)) {
    const a = m[3] === undefined ? ano0 : m[3].length === 2 ? 2000 + +m[3] : +m[3];
    montar(m, a, +m[2], +m[1]);
  }
  datas.sort((a, b) => a.ini - b.ini);
  const horas = [...n.matchAll(RE_HORA)].map(pos);
  return { datas, horas };
}

/** Data da frase (ou hoje) mais os avisos de data futura ou inexistente. */
function dataDaFrase(datas: AchadoData[], hoje: string): { data: string; avisos: string[] } {
  const d = datas[0];
  if (!d) return { data: hoje, avisos: [] };
  if (d.invalida || !d.data) return { data: hoje, avisos: ['data inválida'] };
  return { data: d.data, avisos: d.data > hoje ? ['data futura'] : [] };
}

type Candidato = Trecho & { valor: number; negativo: boolean; duvida?: boolean };

// Números ditados: "5 e 50" (euros e cêntimos) e por extenso ("cinco e cinquenta").
const PALAVRAS: Record<string, number> = {
  zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9,
  dez: 10, onze: 11, doze: 12, treze: 13, catorze: 14, quatorze: 14, quinze: 15, dezasseis: 16, dezesseis: 16,
  dezassete: 17, dezessete: 17, dezoito: 18, dezanove: 19, dezenove: 19, vinte: 20, trinta: 30, quarenta: 40,
  cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90, cem: 100,
};
const ALT_PALAVRAS = Object.keys(PALAVRAS).sort((a, b) => b.length - a.length).join('|');
const RE_POR_EXTENSO = new RegExp(
  `(?<![a-z])(?:${ALT_PALAVRAS})(?![a-z])(?:\\s+e\\s+(?:${ALT_PALAVRAS})(?![a-z]))*`, 'g');
const RE_DIGITOS_E = /(?<![\w.,])(\d+)\s+e\s+(\d{2})(?![\d,.])/g;
/** Depois do número vem algo que o torna parcial: mil, centenas, cêntimos. */
const PARCIAL_DEPOIS = /^\s*(?:mil|milhao|milhoes|cento|centos|cent(?:imos?|avos?))(?![a-z])/;
const PARCIAL_ANTES = /(?:cent[oa]s?|[a-z]+entos|mil)\s+(?:e\s+)?$/;
/** "5 euros e 50": o resto do valor ficou fora; melhor não adivinhar. */
const RESTO_DEPOIS = new RegExp(`^\\s*(?:(?:€|euros?|reais|real)\\s+)?e\\s+(?:\\d|(?:${ALT_PALAVRAS})(?![a-z]))`);
const MOEDA_DEPOIS = /^\s*(?:€|euros?|reais|real|r\$)(?![a-z])/;

/** Junta "vinte" + "cinco" em 25; devolve os grupos (euros, cêntimos) ou null se não couber. */
function gruposPorExtenso(tokens: string[]): number[] | null {
  const vals = tokens.map((t) => PALAVRAS[t]);
  const grupos: number[] = [];
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i];
    const prox = vals[i + 1];
    if (v >= 20 && v < 100 && v % 10 === 0 && prox !== undefined && prox >= 1 && prox <= 9) {
      grupos.push(v + prox);
      i++;
    } else grupos.push(v);
  }
  return grupos.length <= 2 ? grupos : null;
}

/** Números da frase já sem datas e horas (dígitos, "5 e 50" e por extenso). */
function acharNumeros(mascarada: string): Candidato[] {
  const r: Candidato[] = [];
  let resto = mascarada;
  const pos = (m: RegExpMatchArray): Trecho => ({ ini: m.index!, fim: m.index! + m[0].length });
  const parcial = (t: Trecho) =>
    PARCIAL_DEPOIS.test(mascarada.slice(t.fim)) || PARCIAL_ANTES.test(mascarada.slice(0, t.ini));

  for (const m of mascarada.matchAll(RE_DIGITOS_E)) {
    const t = pos(m);
    r.push({ ...t, valor: +m[1] + +m[2] / 100, negativo: false, duvida: parcial(t) });
    resto = mascarar(resto, [t]);
  }
  for (const m of mascarada.matchAll(RE_POR_EXTENSO)) {
    const t = pos(m);
    if (r.some((c) => t.ini < c.fim && t.fim > c.ini)) continue;
    const tokens = m[0].split(/\s+e\s+/);
    if (tokens.length === 1 && PALAVRAS[tokens[0]] === 1 && !MOEDA_DEPOIS.test(mascarada.slice(t.fim))) continue; // "um café"
    const g = gruposPorExtenso(tokens);
    const valor = g === null ? 0 : g.length === 2 ? g[0] + g[1] / 100 : g[0];
    const centavosInvalidos = g !== null && g.length === 2 && (g[1] < 1 || g[1] > 99);
    r.push({ ...t, valor, negativo: false, duvida: g === null || centavosInvalidos || parcial(t) });
    resto = mascarar(resto, [t]);
  }
  for (const m of resto.matchAll(/(?<![\w.,])(-\s?)?(\d+(?:[.,]\d+)*)(?!\d)/g)) {
    const valor = lerNumero(m[2]);
    if (valor === null) continue;
    const t = pos(m);
    r.push({ ...t, valor, negativo: !!m[1], duvida: parcial(t) });
  }
  return r.sort((a, b) => a.ini - b.ini);
}

/** Verbo de dinheiro no passado: o gasto já aconteceu. */
const VERBO_PASSADO =
  /(?<![a-z])(gast(?:ei|ou|amos)|pagu(?:ei|emos)|pagou|custou|desembols(?:ei|ou)|pagamos)(?![a-z])/;
/** "Comprei" só é gasto com moeda escrita ("comprei 3 maçãs" não é). */
const VERBO_COMPRA = /(?<![a-z])(?:comprei|compramos|comprou)(?![a-z])/;
/** Palavras ambíguas ("pago", "gasto"): saem da descrição, mas não bastam para virar gasto. */
const VERBO_FRACO = /(?<![a-z])(?:pago|gasto|despesa|pagamento)(?![a-z])/;
/** Qualquer palavra de pagamento: separa leitura de gasto. */
const VERBO_AMPLO = /(?<![a-z])(?:gast\w*|pag\w*|custou|custa|desembols\w*|despesa)(?![a-z])/;
/** Intenção ou futuro: a frase é tarefa ou compromisso, não gasto. */
const INTENCAO = new RegExp(
  '(?<![a-z])(?:amanha|proxim[ao]s?|vou|vai|vamos|preciso|precisa|precisamos|tenho\\s+que|tenho\\s+de|devo|lembrar|marcar|' +
  'agendar|pagar|reuniao|reunioes|compromisso|semana\\s+que\\s+vem|' +
  '(?:domingo|segunda|terca|quarta|quinta|sexta|sabado)(?:[\\s-]feira)?)(?![a-z])');
const RE_REAIS = /^\s*(?:r\$|reais|real)(?![a-z])/;
const RE_REAIS_ANTES = /(?:r\$|reais\s+)\s*$/;
const RE_EURO = /^\s*(?:€|euros?)(?![a-z])/;
const RE_EURO_ANTES = /(?:€|euros?\s+)\s*$/;

/** Palavra de moeda na frase: serve para separar gasto de leitura. */
const TEM_MOEDA = /(?:€|r\$|(?<![a-z])(?:euros?|reais|real)(?![a-z]))/;

// ------------------------------------------------------------------- gasto

const FILLER =
  '(?:de|do|da|dos|das|no|na|nos|nas|em|com|para|pra|pelo|pela|num|numa|um|uma|o|a|os|as|e|ao|à|às|as|comprando|comprei|compra|gastando|mais|ainda|hoje|ontem|por)';
const RE_FILLER_INI = new RegExp(`^(?:[\\s,.;:!?-]|${FILLER}(?![\\p{L}\\p{N}]))+`, 'iu');
const RE_FILLER_FIM = new RegExp(`(?:[\\s,.;:!?-]|(?<![\\p{L}\\p{N}])${FILLER})+$`, 'iu');

/** Tira o que sobrou das remoções: pontuação solta, "de da" seguidos e preposições nas pontas. */
function limparDescricao(texto: string): string {
  const compactar = (t: string) =>
    t.replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').replace(/([,;])(?:\s*[,;])+/g, '$1');
  let t = compactar(texto);
  // Preposições separadas só por vírgula ("de, da") ou repetidas ("de de") ficam só com a última.
  const virgula = new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${FILLER}\\s*[,;]\\s*)+(?=${FILLER}(?![\\p{L}\\p{N}]))`, 'giu');
  const repetida = new RegExp(`(?<![\\p{L}\\p{N}])(${FILLER})\\s+(?=\\1(?![\\p{L}\\p{N}]))`, 'giu');
  t = t.replace(virgula, '').replace(repetida, '');
  t = t.replace(RE_FILLER_INI, '').replace(RE_FILLER_FIM, '');
  return compactar(t).trim();
}

function categoriaDe(n: string): string | null {
  for (const [nome, chaves] of Object.entries(CATEGORIAS_PADRAO)) {
    const re = new RegExp(`(?<![a-z])(?:${chaves.join('|')})(?:s|es)?(?![a-z])`);
    if (re.test(n)) return nome;
  }
  return null;
}

/** As palavras que podem vir logo depois de um número sem moeda para ele ser dinheiro: "12 no mercado", "5 em gasolina". */
const PALAVRAS_DEPOIS_DO_VALOR = new Set([
  'no', 'na', 'nos', 'nas', 'em', 'num', 'numa', 'de', 'do', 'da', 'dos', 'das', 'com', 'para', 'pra', 'por', 'pelo', 'pela',
  'hoje', 'ontem', 'anteontem', 'e', 'reais', 'real', 'euros', 'euro',
]);

/**
 * Sem moeda escrita junto do número, ele só é dinheiro se a frase acabar ali ou se a palavra seguinte for das permitidas
 * (lista branca): preposição de compra ("no mercado", "de luz"), "hoje/ontem", "à/às" (com acento), gerúndio
 * ("comprando"). Qualquer outra coisa ("2 contas", "3 cafés", "2 horas", "40%", "3 a Marina") deixa de ser gasto.
 * "de manhã", "por cento" e "e pouco" (valor impreciso) também não valem.
 */
function depoisDoNumeroPareceDinheiro(n: string, frase: string, fim: number): boolean {
  const pontas = /^[\s,.;:!-]+/;
  const resto = n.slice(fim).replace(pontas, '');
  if (resto === '') return true;
  if (/^(?:de|do|da)\s+(?:manha|tarde|noite|madrugada)(?![a-z])|^por\s+cento|^e\s+(?:pouco|meio|meia|tanto|tantos|qualquer)(?![a-z])/.test(resto)) return false;
  const palavra = /^[a-z]+/.exec(resto)?.[0];
  if (!palavra) return false;
  if (palavra === 'dia') return /^dia\s+\d/.test(resto); // "5 dia 10/11"
  if (PALAVRAS_DEPOIS_DO_VALOR.has(palavra) || /^[a-z]{2,}(?:ando|endo|indo|ondo)$/.test(palavra)) return true;
  // "à padaria", "às 10h": só com acento (sem ele, "a" é "a Marina").
  return (palavra === 'a' || palavra === 'as') && /^[àÀ]/u.test(frase.slice(fim).replace(pontas, ''));
}
/** Pergunta ("será que gastei 20 euros?") não é gasto dito. */
const E_PERGUNTA = /\?\s*$|(?<![a-z])sera\s+que(?![a-z])/;

export function extrairGasto(frase: string, hoje: string): Gasto | null {
  if (!utilizavel(frase)) return null;
  const n = normalizar(frase);
  if (INTENCAO.test(n)) return null; // tarefa ou compromisso, não gasto
  if (E_PERGUNTA.test(n) || RE_PEDIDO_DE_TAREFA.test(n)) return null; // pergunta ou pedido de tarefa/lembrete
  const verbo = VERBO_PASSADO.exec(n) ?? VERBO_COMPRA.exec(n);
  // Verbo no passado, ou valor com moeda ("gasto de 20 euros"). "Comprei" sem moeda só vale com "por <valor>": "comprei pão por 2,50".
  if (!verbo && !TEM_MOEDA.test(n)) return null;
  const soCompra = !VERBO_PASSADO.test(n) && !TEM_MOEDA.test(n);
  const temEuro = /€|(?<![a-z])euros?(?![a-z])/.test(n);
  const temReal = /r\$|(?<![a-z])reais?(?![a-z])/.test(n);
  if (temEuro && temReal) return null; // moedas misturadas
  if (/cent(?:imos?|avos?)/.test(n)) return null; // valor em cêntimos: não adivinhar
  const { datas, horas } = acharDatas(n, hoje);
  const mascarada = mascarar(n, [...datas, ...horas]);
  const candidatos = acharNumeros(mascarada).filter((c) => !c.negativo && c.valor > 0);
  const com = (c: Candidato) =>
    RE_REAIS_ANTES.test(n.slice(0, c.ini)) || RE_EURO_ANTES.test(n.slice(0, c.ini)) ||
    RE_REAIS.test(n.slice(c.fim)) || RE_EURO.test(n.slice(c.fim));
  const escolhido = candidatos.find(com) ?? candidatos[0];
  if (!escolhido || escolhido.duvida) return null;
  if (RESTO_DEPOIS.test(n.slice(escolhido.fim))) return null; // "5 euros e 50": valor incompleto
  if (soCompra && !/(?<![a-z])por\s*$/.test(n.slice(0, escolhido.ini))) return null;
  if (!com(escolhido) && !depoisDoNumeroPareceDinheiro(n, frase, escolhido.fim)) return null;
  // Data futura só vale para gasto já feito (verbo no passado).
  if (!verbo && datas[0]?.data && datas[0].data > hoje) return null;

  // Moeda: a que está colada no número; senão a única mencionada; padrão €.
  const antes = n.slice(0, escolhido.ini);
  const depois = n.slice(escolhido.fim);
  const ehReal = RE_REAIS_ANTES.test(antes) || RE_REAIS.test(depois);
  const ehEuro = RE_EURO_ANTES.test(antes) || RE_EURO.test(depois);
  const moeda: Gasto['moeda'] = ehEuro ? '€' : ehReal || temReal ? 'R$' : '€';

  const { data, avisos } = dataDaFrase(datas, hoje);
  if (moeda !== '€') avisos.unshift('moeda diferente de €');

  // Descrição: o que sobra depois de tirar verbo, valor, moeda, data e hora.
  const tirar: Trecho[] = [...datas, ...horas];
  if (verbo) tirar.push({ ini: verbo.index, fim: verbo.index + verbo[0].length });
  const fraco = VERBO_FRACO.exec(n);
  if (fraco) tirar.push({ ini: fraco.index, fim: fraco.index + fraco[0].length });
  let ini = escolhido.ini;
  let fim = escolhido.fim;
  const mA = /(?:r\$|€)\s*$/.exec(antes);
  if (mA) ini -= mA[0].length;
  const mD = /^\s*(?:€|euros?|reais|real|r\$)(?![a-z])/.exec(depois);
  if (mD) fim += mD[0].length;
  tirar.push({ ini, fim });
  const descricao = limparDescricao(mascarar(frase, tirar));

  return { valor: escolhido.valor, moeda, descricao, data, categoria: categoriaDe(n), avisos };
}

// ----------------------------------------------------------------- leitura

const SERVICOS: { servico: Leitura['servico']; re: RegExp; unidade: Leitura['unidade'] }[] = [
  { servico: 'agua', re: /(?<![a-z])agua(?![a-z])/, unidade: 'm³' },
  { servico: 'luz', re: /(?<![a-z])(?:luz|energia|eletricidade)(?![a-z])/, unidade: 'kWh' },
  { servico: 'gas', re: /(?<![a-z])gas(?![a-z])/, unidade: 'm³' },
];
const UNIDADE_DEPOIS = /^\s*(?:kwh|m3|m³|metros?\s+cubicos?)(?![a-z])/;
/** A palavra de leitura nas 6 palavras antes do número: "leitura da água 1234", "contador marca 120". */
const PALAVRA_JUNTO_DO_NUMERO = /(?<![a-z])(?:leitura|consumo|contador|medidor|relogio)(?:\s+[^\s]+){0,6}\s*$/;

/**
 * Frase de pedido ou de tarefa: "adicione...", "tarefa", "lembrete" (as regras do chat da V01 fazem a tarefa).
 * Exportada: o executor usa a mesma.
 */
export const RE_PEDIDO_DE_TAREFA = /(?<![a-z])(?:adicione|adiciona|acrescente|anote|anota|inclua|tarefas?|atividades?|lembrete|lembrar)(?![a-z])/;
/** Começa com um verbo no infinitivo ("mandar a leitura...", "trocar o contador..."): é pedido, não leitura. */
const COMECA_COM_INFINITIVO = /^\s*(?!contador|medidor|calor|valor|setor)[a-z]{2,}(?:ar|er|ir|or)(?![a-z])/;
/** O número é dia, quantidade de gente ou de vezes: "até dia 10", "3 pessoas", "2 vezes". */
const DIA_ANTES = /(?<![a-z])dia\s*$/;
const CONTAGEM_DEPOIS = /^\s*(?:pessoas?|vezes|vez|dias?(?!\s+\d)|horas?|meses|mes|semanas?|moradores?|ocupantes|torneiras?|quartos?)(?![a-z])/;
const MES = '(?:janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)';
const DIA_DE_MES_DEPOIS = new RegExp(String.raw`^\s*de\s+${MES}(?![a-z])`);
/** Disseram um dia ("dia 3", "3 de novembro", "amanhã") que não deu para ler como data. */
const DATA_DITA = new RegExp(String.raw`(?<![a-z])(?:dia\s+\d{1,2}|\d{1,2}\s+de\s+${MES}|amanha|depois\s+de\s+amanha)(?![a-z])`);

export function extrairLeitura(frase: string, hoje: string): Leitura | null {
  if (!utilizavel(frase)) return null;
  const n = normalizar(frase);
  if (VERBO_AMPLO.test(n) || TEM_MOEDA.test(n)) return null; // é pagamento
  // Pedido ou tarefa: na dúvida, caminho normal, nunca a planilha.
  if (RE_PEDIDO_DE_TAREFA.test(n) || COMECA_COM_INFINITIVO.test(n)) return null;

  // O serviço dito primeiro na frase.
  const achado = SERVICOS
    .map((s) => ({ s, i: n.search(s.re) }))
    .filter((x) => x.i >= 0)
    .sort((a, b) => a.i - b.i)[0];
  if (!achado) return null;

  const { datas, horas } = acharDatas(n, hoje);
  const candidatos = acharNumeros(mascarar(n, [...datas, ...horas])).filter(
    (c) => !DIA_ANTES.test(n.slice(0, c.ini)) && !CONTAGEM_DEPOIS.test(n.slice(c.fim)) && !DIA_DE_MES_DEPOIS.test(n.slice(c.fim)),
  );
  const comUnidade = candidatos.find((c) => UNIDADE_DEPOIS.test(n.slice(c.fim)));
  const comPalavra = candidatos.find((c) => PALAVRA_JUNTO_DO_NUMERO.test(n.slice(0, c.ini)));
  const escolhido = comUnidade ?? comPalavra;
  if (!escolhido || escolhido.negativo || escolhido.duvida) return null; // leitura nunca é negativa

  const { data, avisos } = dataDaFrase(datas, hoje);
  if (datas.length === 0 && DATA_DITA.test(n)) avisos.push('data inválida');
  return { servico: achado.s.servico, valor: escolhido.valor, unidade: achado.s.unidade, data, avisos };
}

// ------------------------------------------------------------------- lista

const KW_CASA =
  /(?<![a-z])(?:lista\s+de\s+compras?\s+(?:para|pra|da|de)\s+(?:a\s+)?casa|compras\s+(?:para|pra)\s+casa|compras?\s+(?:para|pra|pro|da|de|do)\s+(?:a\s+|o\s+)?casa|lista\s+(?:da|de|pra|para)\s+casa)(?![a-z])/;
const KW_SEMANAL =
  /(?<![a-z])(?:lista\s+de\s+compras?\s+(?:da|de|pra|para)\s+(?:a\s+)?semana|lista\s+de\s+compras?\s+semana(?:l|is)|compras\s+(?:da|de)\s+semana|compras?\s+(?:da|de|pra|para|na)\s+(?:a\s+)?semana|compras\s+semanais|lista\s+semanal|lista\s+da\s+semana)(?![a-z])/;
/** "Lista de compra(s)" sem dizer qual: "lista do mercado", "nas compras" ("nas compras da semana" já é a semanal) e "compras:". */
const KW_GENERICA =
  /(?<![a-z])(?:lista\s+de\s+compras?|lista\s+d[eo]\s+(?:super)?mercado|nas?\s+(?:minhas?\s+|nossas?\s+)?compras?(?!\s+d[eoa]s?(?![a-z]))|compras?(?=\s*:))(?![a-z])/;
const VERBO_LISTA =
  /^\s*(?:por favor\s*,?\s*)?(?:(?:pode|podes|quero|queria)\s+)?(?:poe|por|poem|ponha\w*|coloc\w*|coloqu\w*|adiciona\w*|adicione\w*|acrescenta\w*|acrescente\w*|inclui\w*|inclua\w*|anota\w*|anote\w*|bota\w*|bote\w*|mete\w*|inserir|insira)(?![a-z])\s*/;
const PREP_FINAL = /(?:^|\s|,)(?:nas?|nos?|em|para|pra|pro|ao|as|a|o|da|de|do|minha|nossa|minhas|nossas|essa|esta|nessa|nesta|sua|seu)\s*$/;
/** Antes do nome da lista, só artigos e possessivos ("minha lista de compras pão"). */
const SO_ARTIGOS = /^(?:(?:nas?|a|minha|nossa|da|essa|esta|nessa|nesta)\s*)*$/;
/** Cada "comprar" repetido separa um item; "compra" também ("comprar pão compra café"). */
const COMPRAR_SEPARA = /(?<![a-z])compra(?:r)?(?![a-z])\s*/g;
const MAX_ITEM = 80;
/** Mais itens que isso num pedido só: provavelmente não é uma lista de compras. */
const MAX_ITENS_DO_PEDIDO = 20;
/** Sem pedido explícito ("comprar X, Y"): limites mais curtos, para não sequestrar frase de conversa. */
const MAX_ITENS_SEM_PEDIDO = 12;
const MAX_PALAVRAS_SEM_PEDIDO = 6;
/** Infinitivo de tarefa no começo do item ("comprar" fica de fora: é item de compra). */
const TAREFA_NO_ITEM =
  /^(?:ligar|telefonar|marcar|agendar|pagar|enviar|mandar|responder|fazer|avisar|falar|reservar|cancelar|renovar|resolver)(?![a-z])/;

/** Palavra que faz da frase uma tarefa ou lembrete, não um item de compra. */
const PALAVRA_DE_TAREFA = /(?<![a-z])(?:tarefas?|atividades?|lembrete|lembrar|lembre)(?![a-z])/;

/** Verbos curtos no infinitivo que a regra de terminação não pega ("pôr" já vem sem acento). */
const INFINITIVOS_CURTOS = new Set(['ver', 'ir', 'ter', 'ler', 'dar', 'vir', 'ser', 'por']);
/** Substantivos que terminam como infinitivo: "-dor" (liquidificador, amaciador, desentupidor) e alguns comuns. */
const NAO_E_INFINITIVO = /^(?:[a-z]*dor|acucar|licor|colher|toner|cheddar|cooler|sabor|calor|valor|setor|melhor|pior|maior|menor|motor|favor|autor)$/;

/** A palavra (já sem acento) é um verbo no infinitivo ("lavar", "ver", "pintar"). */
function ehInfinitivo(palavra: string): boolean {
  if (INFINITIVOS_CURTOS.has(palavra)) return true;
  return /^[a-z]{2,}(?:ar|er|ir|or)$/.test(palavra) && !NAO_E_INFINITIVO.test(palavra);
}

/**
 * O item é uma ação, não uma compra: começa com infinitivo ("limpar filtro", "ver preço") ou tem "para/pra" + infinitivo
 * ("roupa para lavar"). `comprar` conta como item quando `comprarVale` ("põe comprar pilhas na lista da casa").
 */
function itemTemVerbo(nItem: string, comprarVale: boolean): boolean {
  const palavras = nItem.split(/\s+/);
  if (ehInfinitivo(palavras[0]!) && !(comprarVale && palavras[0] === 'comprar')) return true;
  return palavras.some((p, i) => (p === 'para' || p === 'pra') && i + 1 < palavras.length && ehInfinitivo(palavras[i + 1]!));
}

/** O item parece compromisso, hora, dia, agenda ou tarefa: na dúvida não vai para a planilha compartilhada. */
function itemParecePedido(nItem: string): boolean {
  return (
    INTENCAO.test(nItem) ||
    PALAVRA_DE_TAREFA.test(nItem) ||
    /(?<![a-z])(?:agenda|calendario)(?![a-z])/.test(nItem) ||
    /^(?:no|na|nos|nas|em|ao|aos)\s/.test(nItem) || // "no calendário", "na agenda": sobra de pedido para outro lugar
    (/^(?:o|a|os|as)\s/.test(nItem) && /(?<![a-z\d])\d+(?![a-z\d])/.test(nItem)) || // "o relatório 1"
    nItem.search(RE_HORA) >= 0 ||
    nItem.search(RE_PALAVRA_DATA) >= 0
  );
}

/** Sinal de que a frase é tarefa, compromisso, gasto, pergunta ou conversa: aí não é lista (usado onde não há pedido explícito). */
function temSinalDePedido(n: string): boolean {
  return (
    n.includes('?') ||
    PALAVRA_DE_TAREFA.test(n) ||
    RE_PEDIDO_DE_TAREFA.test(n) ||
    INTENCAO.test(n) ||
    TEM_MOEDA.test(n) ||
    VERBO_AMPLO.test(n) ||
    FALA_DE_CONVERSA.test(n) ||
    n.search(RE_HORA) >= 0 ||
    n.search(RE_PALAVRA_DATA) >= 0 ||
    /(?<![a-z])dia\s*\d|\d{1,2}\/\d{1,2}\/\d{2,4}|(?<![a-z])por\s+\d/.test(n) ||
    /(?<![a-z])(?:de|da|pela)\s+(?:manha|tarde|noite|madrugada)|(?<![a-z])(?:a|esta|nesta)\s+(?:tarde|noite)|(?<![a-z])(?:na|nesta|esta)\s+(?:proxima\s+)?semana|(?<![a-z])(?:este|esse|neste|nesse)\s+mes|(?<![a-z])(?:mes|ano)\s+que\s+vem/.test(n)
  );
}

/**
 * Parte o texto dos itens: por vírgula (fora de números como "1,5"), ";", quebra de linha, " e " e por cada "comprar"
 * repetido (que some do começo do item). Devolve `null` se um item é inválido (comprido demais, parece tarefa, sobra do
 * nome da lista...). Sem repetidos, na ordem dita.
 */
function separarItens(texto: string): string[] | null {
  const nt = normalizar(texto);
  const pedacos: string[] = [];
  let desde = 0;
  for (const m of nt.matchAll(COMPRAR_SEPARA)) {
    pedacos.push(texto.slice(desde, m.index!));
    desde = m.index! + m[0].length;
  }
  pedacos.push(texto.slice(desde));

  const itens: string[] = [];
  const vistos = new Set<string>();
  for (const pedaco of pedacos) {
    for (const bruto of pedaco.split(SEPARADOR_DE_ITENS)) {
      const item = bruto.replace(/^[\s.,;:!?-]+|[\s.,;:!?-]+$/g, '').replace(/^e\s+|\s+e$/i, '').trim();
      if (!item) continue;
      const nItem = normalizar(item);
      if (/^(?:da|de|do)(?![a-z])/.test(nItem) || /(?<![a-z])lista(?![a-z])/.test(nItem)) return null; // sobra do nome da lista
      if (item.length > MAX_ITEM) return null; // item comprido demais: não some em silêncio, a frase vira ideia
      if (/(?:^|\s)(?:para|pra|de|do|da|com|em|no|na)$/.test(nItem)) return null; // item cortado no meio ("tampa para")
      if (vistos.has(nItem)) continue;
      vistos.add(nItem);
      itens.push(item);
    }
  }
  // Item que é tarefa ("ligar para o dentista") não é compra: deixa seguir como tarefa.
  if (itens.some((i) => TAREFA_NO_ITEM.test(normalizar(i)) || itemParecePedido(normalizar(i)) || itemTemVerbo(normalizar(i), true))) return null;
  if (itens.length > MAX_ITENS_DO_PEDIDO) return null;
  return itens.length ? itens : null;
}

/** Itens ditos sem pedido explícito de lista ("comprar leite"): só vale texto simples de compra. */
function itensSemPedidoExplicito(texto: string): string[] | null {
  const n = normalizar(texto);
  if (temSinalDePedido(n) || /^e(?![a-z])|^(?:esta|estao|foi|vai|era)(?![a-z])/.test(n.trim())) return null;
  const itens = separarItens(texto);
  if (!itens || itens.length > MAX_ITENS_SEM_PEDIDO) return null;
  for (const item of itens) {
    const palavras = normalizar(item).split(/\s+/);
    if (palavras.length > MAX_PALAVRAS_SEM_PEDIDO || palavras.some((p) => PALAVRA_DE_VERBO.test(p))) return null;
  }
  return itens;
}

/** "(eu) preciso comprar X", "tenho que comprar X", "comprar X": compra falada, sem hora, dia, compromisso nem pessoa. */
const COMPRA_FALADA =
  /^\s*(?:(?:eu|nos|a\s+gente)\s+)?(?:(?:preciso|precisamos|tenho|temos)\s+(?:de\s+|que\s+)?)?comprar(?![a-z])\s*([\s\S]*)$/;

function extrairCompraFalada(frase: string): string[] | null {
  const m = COMPRA_FALADA.exec(normalizar(frase));
  if (!m || !m[1]!.trim()) return null;
  const texto = frase.slice(frase.length - m[1]!.length);
  // "com a Marina": pessoa, é compromisso ou tarefa.
  if (/(?<![\p{L}])com\s+(?:(?:a|o)\s+)?\p{Lu}/u.test(texto)) return null;
  return itensSemPedidoExplicito(texto);
}

/**
 * Pedido claro de lista: um verbo de pôr ("põe", "coloque"...) antes ou depois do nome da lista, os dois pontos depois
 * dele, ou a frase começando pelo nome da lista ("lista de compras pão e leite"). "Preciso fazer as compras da semana" é
 * tarefa, não item de lista. Sem nome de lista, "(preciso) comprar X, Y e Z" também é lista (genérica).
 */
export function extrairItensDeLista(frase: string): { lista: NomeDeLista; itens: string[] } | null {
  if (!utilizavel(frase)) return null;
  const n = normalizar(frase);
  const casa = KW_CASA.exec(n);
  const semanal = casa ? null : KW_SEMANAL.exec(n);
  const generica = casa || semanal ? null : KW_GENERICA.exec(n);
  const kw = casa ?? semanal ?? generica;
  if (!kw) {
    const falados = extrairCompraFalada(frase);
    return falados ? { lista: 'generica', itens: falados } : null;
  }
  const lista: NomeDeLista = casa ? 'casa' : semanal ? 'semanal' : 'generica';

  const ini = kw.index;
  const fim = ini + kw[0].length;
  let apos = frase.slice(fim);
  let antes = frase.slice(0, ini);
  const verbo = VERBO_LISTA.exec(n.slice(0, ini));
  const doisPontos = /^\s*:\s*([\s\S]*)$/.exec(apos);
  // "na lista de compras coloca pão": o verbo vem depois do nome da lista.
  const aposSemPontas = apos.replace(/^[\s,.;:!?-]+/, '');
  const verboDepois = VERBO_LISTA.exec(normalizar(aposSemPontas));
  const soAbreComNome = SO_ARTIGOS.test(normalizar(antes).trim());
  if (!verbo && !verboDepois && !doisPontos && !soAbreComNome) return null; // sem pedido claro de lista: segue como tarefa ou ideia
  if (PALAVRA_DE_TAREFA.test(n)) return null;
  if (verbo) antes = antes.slice(verbo[0].length);
  if (!verbo && verboDepois && !doisPontos) apos = aposSemPontas.slice(verboDepois[0].length);
  // Tira preposições soltas no fim ("... pilhas na" antes de "lista da casa").
  for (let guarda = 0; guarda < 5; guarda++) {
    const p = PREP_FINAL.exec(normalizar(antes));
    if (!p) break;
    antes = antes.slice(0, p.index);
  }

  const texto = (doisPontos ? doisPontos[1] : '') || antes.trim() || apos.trim();
  const semPedido = !verbo && !verboDepois && !doisPontos;
  const itens = semPedido ? itensSemPedidoExplicito(texto) : separarItens(texto);
  return itens ? { lista, itens } : null;
}

// ------------------------------------------------------- lista, frase curta

const MAX_FRASE_CURTA = 100;
const MAX_ITENS_CURTA = 8;
const MAX_PALAVRAS_DO_ITEM = 4;
/** Palavras de quem conversa, pergunta ou nega: não é uma lista de compras. */
const FALA_DE_CONVERSA =
  /(?<![a-z])(?:eu|voce|voces|nos|ele|ela|eles|elas|nao|ja|ainda|mas|porque|pois|quando|onde|como|quem|qual|quais|que|se|ola|oi|obrigad[oa])(?![a-z])/;
/** Palavra com jeito de verbo conjugado ("liguei", "paguei", "fizemos", "limpando"): item de compra não é. */
const PALAVRA_DE_VERBO = /^(?:[a-z]{4,}(?:ei|ou|amos|emos|imos)|[a-z]{5,}(?:ando|endo|indo))$/;
const SEPARADOR_DE_ITENS = /\s*(?:(?<!\d),|,(?!\d)|;|\n|\s+e\s+)\s*/;

/**
 * Dentro de uma pasta de lista: a frase curta que é CLARAMENTE uma lista de itens ("leite e pão", "2 litros de leite, ovos",
 * "põe leite"). Qualquer sinal de tarefa, pedido, hora, dia, dinheiro, pergunta ou conversa devolve `null` (na dúvida,
 * caminho normal: tarefa ou ideia, nunca a planilha compartilhada).
 */
export function extrairItensDeListaCurta(frase: string): string[] | null {
  if (!utilizavel(frase) || frase.length > MAX_FRASE_CURTA || frase.includes('?')) return null;
  let texto = frase.trim();
  let n = normalizar(texto);
  if (PALAVRA_DE_TAREFA.test(n) || INTENCAO.test(n) || TEM_MOEDA.test(n) || VERBO_AMPLO.test(n) || FALA_DE_CONVERSA.test(n)) return null;
  if (n.search(RE_HORA) >= 0 || n.search(RE_PALAVRA_DATA) >= 0 || /\d[/.:-]\d|(?<![a-z])dia\s*\d/.test(n)) return null;
  // "põe leite" / "adicione pão na lista": o verbo e o "na lista" do fim não são item.
  const verbo = VERBO_LISTA.exec(n);
  if (verbo && n.length > verbo[0].length) {
    texto = texto.slice(verbo[0].length);
    n = n.slice(verbo[0].length);
  }
  const fim = /\s+(?:na|nesta|para\s+a|pra)\s+lista[\s.!]*$/.exec(n);
  if (fim) texto = texto.slice(0, fim.index);

  const itens: string[] = [];
  const vistos = new Set<string>();
  for (const bruto of texto.split(SEPARADOR_DE_ITENS)) {
    const item = bruto.replace(/^[\s.,;:!-]+|[\s.,;:!-]+$/g, '');
    if (!item) continue;
    const nItem = normalizar(item);
    const palavras = nItem.split(/\s+/);
    if (item.length > MAX_ITEM || palavras.length > MAX_PALAVRAS_DO_ITEM || !/\p{L}/u.test(item)) return null;
    if (itemTemVerbo(nItem, false)) return null;
    if (palavras.some((p) => PALAVRA_DE_VERBO.test(p))) return null;
    if (vistos.has(nItem)) continue;
    vistos.add(nItem);
    itens.push(item);
  }
  return itens.length > 0 && itens.length <= MAX_ITENS_CURTA ? itens : null;
}

// ------------------------------------------------------------------ roteador

/**
 * Valor, leitura e lista primeiro; o resto (`outro`) segue para as regras de
 * tarefa e compromisso do chat. Decidir se vira Ideia é com o chamador.
 */
export function rotear(frase: string, hoje: string): Destino {
  if (!utilizavel(frase)) return { tipo: 'outro' };
  const lista = extrairItensDeLista(frase);
  if (lista) return { tipo: 'lista', ...lista };
  const leitura = extrairLeitura(frase, hoje);
  if (leitura) return { tipo: 'leitura', leitura };
  const gasto = extrairGasto(frase, hoje);
  if (gasto) return { tipo: 'gasto', gasto };
  return { tipo: 'outro' };
}
