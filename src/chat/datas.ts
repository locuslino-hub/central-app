// Datas e horas do chat (Tarefa 7). Funções puras: nada de `Date.now`; o
// "hoje" chega como `AAAA-MM-DD`, e as contas são feitas em UTC, onde não há
// horário de verão. A IA nunca decide data nem hora: quem decide é isto aqui.
//
// A busca roda sobre o texto normalizado (minúsculo e sem acento), que tem o
// mesmo comprimento da frase original: assim um trecho achado aqui serve para
// recortar o título na frase original, com os acentos que o dono escreveu.
// Nenhuma expressão tem repetição aninhada, então frases longas não travam.

/** Trecho `[ini, fim)` da frase. */
export type Trecho = { ini: number; fim: number };

/** Minúsculas e sem acentos, caractere a caractere, sem mudar o comprimento. */
export function normalizar(s: string): string {
  let r = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const m = c.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    if (m.length === 1) r += m;
    else {
      const l = c.toLowerCase();
      r += l.length === 1 ? l : c;
    }
  }
  return r;
}

// ---------------------------------------------------------------- aritmética

const DIA_MS = 86_400_000;
const dois = (n: number) => String(n).padStart(2, '0');

function partes(data: string): [number, number, number] {
  const [a, m, d] = data.split('-').map(Number);
  return [a, m, d];
}

function formatar(t: number): string {
  const x = new Date(t);
  return `${x.getUTCFullYear()}-${dois(x.getUTCMonth() + 1)}-${dois(x.getUTCDate())}`;
}

function utc(a: number, m: number, d: number): number {
  const x = new Date(0);
  x.setUTCFullYear(a, m - 1, d);
  return x.getTime();
}

export function dataValida(a: number, m: number, d: number): boolean {
  if (!Number.isInteger(a) || m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(utc(a, m + 1, 0)).getUTCDate();
}

export function somarDias(data: string, n: number): string {
  const [a, m, d] = partes(data);
  return formatar(utc(a, m, d) + n * DIA_MS);
}

/** 0 = domingo … 6 = sábado. */
export function diaDaSemana(data: string): number {
  const [a, m, d] = partes(data);
  return new Date(utc(a, m, d)).getUTCDay();
}

/** Segunda-feira da semana de `data` (a semana começa na segunda, como na loja). */
export function segundaDaSemana(data: string): string {
  return somarDias(data, -((diaDaSemana(data) + 6) % 7));
}

/** Soma minutos a `HH:MM`, sem passar de 23:59 (o compromisso não vira o dia). */
export function somarMinutos(hora: string, min: number): string {
  const [h, m] = hora.split(':').map(Number);
  const total = Math.min(h * 60 + m + min, 23 * 60 + 59);
  return `${dois(Math.floor(total / 60))}:${dois(total % 60)}`;
}

const data = (a: number, m: number, d: number) => `${a}-${dois(m)}-${dois(d)}`;

// --------------------------------------------------------------------- datas

/** `forte`: dia dito com todas as letras. `fraca`: "do dia", lista de hoje. */
export type AchadoData = Trecho & {
  data?: string;
  semana?: string;
  forca: 'forte' | 'fraca';
  /** Data escrita que não existe (31/11) ou já passou (ano explícito). */
  invalida?: boolean;
};

const L = '(?<![a-z0-9])';
const R = '(?![a-z0-9])';
/** Preposição antes do dia; sai do título junto com ele. */
const PREP =
  '((?:ate|a\\s+partir)\\s+(?:de\\s+|a\\s+|o\\s+)?|(?:para|pra|pro|na|no|nesta|neste|nessa|nesse|esta|este|essa|esse|em|de|do|da|a|pela|pelo)\\s+)?';
/** Preposições que fazem "segunda", "quinta" etc. serem dia, não ordinal. */
const PREP_DE_DIA = /^(?:ate|a\s+partir|para|pra|pro|na|no|nesta|neste|nessa|nesse|esta|este|essa|esse|em)(?:\s|$)/;
const MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto',
  'setembro', 'outubro', 'novembro', 'dezembro'];
const SEMANA = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];

/** "1/2 kg" é fração, não 1º de fevereiro (e "R$ 12/11", logo antes, é dinheiro). */
const SEM_UNIDADE =
  '(?!\\s*(?:kg|g|mg|l|ml|litros?|xicaras?|colher(?:es)?|copos?|duzias?|metros?|m|cm|mm|km|pacotes?|unidades?|porcao|porcoes|doses?)(?![a-z]))';

const RE_ISO = new RegExp(`${L}${PREP}(\\d{4})-(\\d{2})-(\\d{2})${R}`, 'g');
const RE_BARRA = new RegExp(
  `${L}${PREP}(?:o\\s+)?(?:dia\\s+)?(?<!\\$\\s*)(\\d{1,2})/(\\d{1,2})(?:/(\\d{4}|\\d{2}))?(?![\\d/])${SEM_UNIDADE}`, 'g');
const RE_TRACO = new RegExp(`${L}${PREP}(?:o\\s+)?(?:dia\\s+)?(\\d{1,2})[-.](\\d{1,2})[-.](\\d{4})${R}`, 'g');
const RE_MES = new RegExp(
  `${L}${PREP}(?:o\\s+)?(?:dia\\s+)?(\\d{1,2})(?:º|o)?\\s+de\\s+(${MESES.join('|')})(?:\\s+de\\s+(\\d{4}))?${R}`, 'g');
const RE_DIA = new RegExp(
  `${L}${PREP}(?:o\\s+)?dia\\s+(\\d{1,2})(?:º|o)?(?![\\d/:a-z])(?!\\s?h(?:oras?|rs?|s)?(?![a-z]))`, 'g');
const RE_SEMANA_DIA = new RegExp(
  `${L}${PREP}(?:(proxim[ao])\\s+)?(${SEMANA.join('|')})((?:-|\\s)?feira)?${R}(\\s+que\\s+vem${R})?` +
    `(\\s+(?:da|na)\\s+(?:proxima\\s+semana|semana\\s+que\\s+vem)${R})?`, 'g');
const RE_HOJE = new RegExp(`${L}${PREP}hoje${R}`, 'g');
const RE_AMANHA = new RegExp(`${L}${PREP}(depois\\s+de\\s+)?amanha${R}`, 'g');
const RE_DO_DIA = new RegExp(
  `${L}(?:(?:ate\\s+o\\s+)?fim\\s+)?do\\s+dia${R}(?!\\s*\\d)(?!\\s+(?:de|do|da|seguinte|anterior)${R})`, 'g');
const RE_DAQUI = new RegExp(`${L}(?:daqui\\s+a|em|dentro\\s+de)\\s+(\\d{1,3})\\s+dias?${R}`, 'g');
const RE_SEMANA = new RegExp(
  `${L}(?:(?:ate|para|pra|em)\\s+)?(?:(n?esta|n?essa)\\s+semana|(?:n?a\\s+)?proxima\\s+semana|(?:n?a\\s+)?semana\\s+que\\s+vem)${R}`,
  'g');
/**
 * O que pode vir logo depois de "sexta" para ela ser dia: hora, vírgula, fim da frase.
 * "à 15h" (crase por engano) chega aqui como "a 15h", porque o texto já está sem acento.
 */
const DEPOIS_DE_DIA =
  /^\s*(?:$|[,.;!?)]|\d|(?:as|a\s+\d|das|de\s+\d+|pelas|ate|a\s+partir|por\s+volta|(?:com\s+)?inicio|comec[a-z]*|ao\s+meio|meio[\s-]dia|de\s+manha|a\s+tarde|a\s+noite|que\s+vem)(?![a-z]))/;

/** Dia do mês sem mês: este mês, se ainda não passou; senão o próximo mês que tem esse dia. */
function proximoDiaDoMes(dia: number, hoje: string): string | undefined {
  let [a, m] = partes(hoje);
  const d0 = partes(hoje)[2];
  if (dia < d0) m++;
  for (let i = 0; i < 13; i++, m++) {
    if (m > 12) { m = 1; a++; }
    if (dataValida(a, m, dia)) return data(a, m, dia);
  }
  return undefined;
}

/** Dia e mês sem ano: a próxima vez que essa data acontece (29/02 pula para o bissexto). */
function proximaData(dia: number, mes: number, hoje: string): string | undefined {
  const a0 = partes(hoje)[0];
  for (let a = a0; a < a0 + 9; a++) {
    if (dataValida(a, mes, dia) && data(a, mes, dia) >= hoje) return data(a, mes, dia);
  }
  return undefined;
}

function comAno(a: number, m: number, d: number, hoje: string): Pick<AchadoData, 'data' | 'invalida'> {
  if (!dataValida(a, m, d)) return { invalida: true };
  const x = data(a, m, d);
  return x < hoje ? { data: x, invalida: true } : { data: x };
}

function ano(s: string): number {
  return s.length === 2 ? 2000 + Number(s) : Number(s);
}

/** Todas as datas da frase normalizada, em ordem, sem sobreposição. */
export function acharDatas(n: string, hoje: string): AchadoData[] {
  const achados: AchadoData[] = [];
  const pos = (m: RegExpMatchArray): Trecho => ({ ini: m.index!, fim: m.index! + m[0].length });
  const forte = (m: RegExpMatchArray, x: Partial<AchadoData>) =>
    achados.push({ ...pos(m), forca: 'forte', ...x });

  for (const m of n.matchAll(RE_ISO)) forte(m, comAno(+m[2], +m[3], +m[4], hoje));
  for (const m of n.matchAll(RE_TRACO)) forte(m, comAno(+m[4], +m[3], +m[2], hoje));
  for (const m of n.matchAll(RE_BARRA)) {
    const d = +m[2], mes = +m[3];
    if (m[4]) forte(m, comAno(ano(m[4]), mes, d, hoje));
    else {
      const x = mes >= 1 && mes <= 12 ? proximaData(d, mes, hoje) : undefined;
      forte(m, x ? { data: x } : { invalida: true });
    }
  }
  for (const m of n.matchAll(RE_MES)) {
    const d = +m[2], mes = MESES.indexOf(m[3]) + 1;
    if (m[4]) forte(m, comAno(+m[4], mes, d, hoje));
    else {
      const x = proximaData(d, mes, hoje);
      forte(m, x ? { data: x } : { invalida: true });
    }
  }
  for (const m of n.matchAll(RE_DIA)) {
    const x = +m[2] >= 1 && +m[2] <= 31 ? proximoDiaDoMes(+m[2], hoje) : undefined;
    forte(m, x ? { data: x } : { invalida: true });
  }
  for (const m of n.matchAll(RE_SEMANA_DIA)) {
    const [, prep, proxima, nome, feira, queVem, proximaSemana] = m;
    const ehDia =
      nome === 'sabado' || nome === 'domingo' || feira || proxima || queVem || proximaSemana ||
      (prep && PREP_DE_DIA.test(prep)) || DEPOIS_DE_DIA.test(n.slice(m.index! + m[0].length));
    if (!ehDia) continue;
    const alvo = SEMANA.indexOf(nome);
    let x: string;
    if (proximaSemana) x = somarDias(segundaDaSemana(hoje), 7 + ((alvo + 6) % 7));
    else x = somarDias(hoje, (alvo - diaDaSemana(hoje) + 7) % 7 || 7); // mesmo dia = semana que vem
    forte(m, { data: x });
  }
  for (const m of n.matchAll(RE_HOJE)) forte(m, { data: hoje });
  for (const m of n.matchAll(RE_AMANHA)) forte(m, { data: somarDias(hoje, m[2] ? 2 : 1) });
  for (const m of n.matchAll(RE_DAQUI)) forte(m, { data: somarDias(hoje, +m[1]) });
  for (const m of n.matchAll(RE_DO_DIA)) achados.push({ ...pos(m), forca: 'fraca', data: hoje });
  for (const m of n.matchAll(RE_SEMANA)) {
    const seg = segundaDaSemana(hoje);
    forte(m, { semana: m[1] ? seg : somarDias(seg, 7) });
  }
  return semSobreposicao(achados);
}

/** Mantém, da esquerda para a direita, o trecho mais longo de cada sobreposição. */
export function semSobreposicao<T extends Trecho>(xs: T[]): T[] {
  const ordem = [...xs].sort((a, b) => a.ini - b.ini || b.fim - a.fim);
  const r: T[] = [];
  for (const x of ordem) {
    const ultimo = r[r.length - 1];
    if (!ultimo || x.ini >= ultimo.fim) r.push(x);
    else if (x.ini === ultimo.ini && x.fim > ultimo.fim) r[r.length - 1] = x;
  }
  return r;
}

// --------------------------------------------------------------------- horas

/** `semTarde`: a mesma hora sem a regra de 1–7 = tarde ("das 5 às 8" é de manhã). */
export type AchadoHora = Trecho & { hora: string; papel: 'inicio' | 'fim'; semTarde?: string };

/**
 * Hora: "15:30", "15h", "15h30", "15 horas", "meio-dia", "3 da tarde" e, com
 * marca antes ("às", "das", "início", "término", "até", "pelas"), o número sozinho.
 * Dois-pontos logo depois sem minutos ("às 18h: enviar...") não impedem a hora.
 */
const RE_HORA =
  /(?<![\d:/.,a-z])(?:(meio[\s-]dia|meia[\s-]noite)|(\d{1,2})(?:(:)(\d{2})(?:\s?h)?|\s?(h|hs|hrs?|horas?)(\d{2})?(?:\s?min)?)?)(?![\d/a-z])(?!:\d)(?:\s+(?:da|de|a)\s+(manha|tarde|noite|madrugada)(?![a-z]))?/g;

type TipoMarca = 'livre' | 'ambigua' | 'faixa';
/** Marcas antes da hora, testadas nesta ordem (a mais específica primeiro). */
const MARCAS: [RegExp, AchadoHora['papel'], TipoMarca][] = [
  [/(?:(?<![a-z])com\s+)?(?<![a-z])(?:inicio|comeco|comeca|comecando|comecar|inicia|iniciando)(?:\s*:)?(?:\s+(?:as|a|das|pelas))?\s*$/, 'inicio', 'livre'],
  [/(?<![a-z])a\s+partir\s+d(?:as?|e)\s*$/, 'inicio', 'livre'],
  [/(?<![a-z])(?:por\s+volta\s+d(?:as?|e)|pelas|pela)\s*$/, 'inicio', 'livre'],
  [/(?:(?<![a-z])e\s+)?(?<![a-z])(?:termino|terminando|termina|terminar|final|fim)(?:\s*:)?(?:\s+(?:as|a|das))?\s*$/, 'fim', 'livre'],
  [/(?<![a-z])ate(?:\s+(?:as|a|o))?\s*$/, 'fim', 'ambigua'],
  // "a" cobre também "à" (crase por engano: "à 15h"), já sem acento.
  [/(?<![a-z])(?:as|a|ao)\s*$/, 'inicio', 'ambigua'],
  [/(?<![a-z])(?:das|de)\s*$/, 'inicio', 'faixa'],
  [/[-–]\s*$/, 'fim', 'faixa'],
];
/** Entre duas horas, isto faz da segunda o fim da primeira: "das 14 às 16", "14h-16h". */
const LIGACAO = /^\s*(?:as|a|ate(?:\s+(?:as|a))?|[-–])\s*$/;
/** Depois de "às 3" sem "h": só é hora se vier fim da frase ou palavra de ligação ("as 3 seções" não é). */
const DEPOIS_DE_HORA =
  /^\s*(?:$|[,.;!?)\-–]|(?:e|com|na|no|nas|nos|em|para|pra|ate|hoje|amanha|depois|dia|segunda|terca|quarta|quinta|sexta|sabado|domingo|sobre|pelo|pela|via|online|presencial|termino|fim|final|ou)(?![a-z]))/;

type Candidata = AchadoHora & { num: number; nua: boolean; marca?: TipoMarca; pendente?: boolean; temFim?: boolean };

function valor(m: RegExpMatchArray): { hora: string; semTarde?: string } | undefined {
  if (m[1]) return { hora: m[1].startsWith('meio') ? '12:00' : '00:00' };
  let h = Number(m[2]);
  const minutos = m[4] ?? m[6];
  const mm = minutos === undefined ? 0 : Number(minutos);
  if (h > 23 || mm > 59) return undefined;
  const periodo = m[7];
  if (periodo === 'tarde' || periodo === 'noite') {
    if (h < 12) h += 12;
    else if (h === 12 && periodo === 'noite') h = 0;
  } else if (!periodo && minutos === undefined && h >= 1 && h <= 7) {
    // "às 3" é de tarde
    return { hora: `${dois(h + 12)}:${dois(mm)}`, semTarde: `${dois(h)}:${dois(mm)}` };
  }
  return { hora: `${dois(h)}:${dois(mm)}` };
}

/**
 * Horas da frase normalizada, fora dos trechos `ocupados` (as datas). Devolve
 * também as `ligacoes` ("até" entre duas horas), que não valem como prazo, e
 * quantas horas escritas com "h" ou ":" não existem ("25h", "15:60").
 */
export function acharHoras(
  n: string, ocupados: Trecho[],
): { horas: AchadoHora[]; ligacoes: Trecho[]; invalidas: number } {
  const cruza = (a: number, b: number) => ocupados.some((o) => a < o.fim && b > o.ini);
  const comecaOcupado = (i: number) => {
    const j = i + (n.slice(i).match(/^\s*/)?.[0].length ?? 0);
    return ocupados.some((o) => o.ini === j);
  };
  const aceitas: Candidata[] = [];
  const ligacoes: Trecho[] = [];
  let invalidas = 0;

  for (const m of n.matchAll(RE_HORA)) {
    const num = m.index!;
    const fim = num + m[0].length;
    if (cruza(num, fim)) continue;
    const v = valor(m);
    if (!v) {
      if (m[3] || m[5]) invalidas++;
      continue;
    }
    const { hora, semTarde } = v;
    const nua = !m[1] && !m[3] && !m[5] && !m[7];
    const antes = n.slice(Math.max(0, num - 40), num);
    let ini = num, papel: AchadoHora['papel'] = 'inicio', marca: TipoMarca | undefined;
    for (const [re, p, t] of MARCAS) {
      const x = antes.match(re);
      if (x) {
        ini = num - x[0].length;
        if (cruza(ini, num)) ini = num; // a marca era parte da data
        else { papel = p; marca = t; }
        break;
      }
    }
    const c: Candidata = { ini, fim, hora, semTarde, papel, num, nua, marca };
    const anterior = aceitas[aceitas.length - 1];
    if (anterior && anterior.papel === 'inicio' && !anterior.temFim && LIGACAO.test(n.slice(anterior.fim, num))) {
      // Segunda ponta de uma faixa: "das 14 às 16".
      if (c.nua && !DEPOIS_DE_HORA.test(n.slice(fim)) && !comecaOcupado(fim)) continue;
      c.papel = 'fim';
      c.ini = anterior.fim;
      anterior.temFim = true;
      anterior.pendente = false;
      ligacoes.push({ ini: anterior.fim, fim: num });
      aceitas.push(c);
      continue;
    }
    if (c.nua) {
      if (!c.marca) continue; // "relatório 1" não é hora
      if (c.marca === 'faixa') {
        if (c.papel === 'fim') continue;
        c.pendente = true; // "das 3" só vale se vier "às 5" depois
      } else if (c.marca === 'ambigua' && !DEPOIS_DE_HORA.test(n.slice(fim)) && !comecaOcupado(fim)) {
        continue;
      }
    }
    aceitas.push(c);
  }
  const horas = aceitas
    .filter((c) => !c.pendente)
    .map(({ ini, fim, hora, papel, semTarde }) => (semTarde ? { ini, fim, hora, papel, semTarde } : { ini, fim, hora, papel }));
  return { horas, ligacoes, invalidas };
}
