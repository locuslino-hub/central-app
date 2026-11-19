// Leituras de consumo (água, luz, gás) numa pasta de Registro (V02, Tarefa 13): lê as linhas da planilha como
// leituras, junta o cálculo de `consumo.ts` e grava uma leitura nova. Serve à tela da pasta e à voz (executar.ts).
//
// - A planilha é dado de terceiros (outras pessoas com acesso à pasta editam): `Data` aceita `AAAA-MM-DD` (o formato em que o script
//   cria a coluna, igual em qualquer idioma de planilha) ou `dd/mm/aaaa` (planilha antiga ou feita à mão; supõe-se
//   dia antes do mês: numa planilha em inglês "5/11/2026" seria lido como 5 de novembro, mas lá é 11 de maio);
//   `Leitura` aceita 1234,5 / 1234.5 / 1.234,5. O que não der para ler fica fora da conta e é contado em `ignoradas`.
// - Linha `pendente: 'parada'` (a sincronia desistiu, não está salva) fica fora do cálculo e aparece à parte.
// - A coluna "Consumo desde a anterior" não é escrita: a Central calcula, na tela, a partir de Data e Leitura.
// - Gravar nunca apaga: o desfazer é o de `anexar` (marca "desfeito" em Observação, ou tira da fila).
import { lerNumero } from '../chat/roteador';
import { consumoDesdeAnterior, consumoPorMes, leiturasIgnoradas, proximoEnvio, type Leitura } from './consumo';
import { anexar, lerPlanilha, COLUNA_DO_DESFEITO, MARCA_DO_DESFEITO, type LinhaDaPlanilha, type OpcoesDePlanilha, type ResultadoDoAnexo } from './planilhas';
import type { Pasta } from './tipos';

/** Faltando até este número de dias para o envio, a Central lembra (faixa na pasta e no Hoje). */
export const DIAS_DE_AVISO_DO_ENVIO = 3;

// ---------- lembrete do envio ----------

/**
 * Se a pasta de Registro tem dia de envio e ele chega em até `DIAS_DE_AVISO_DO_ENVIO` dias (hoje conta como 0),
 * diz quantos dias faltam. Pasta sem dia de envio (ou com dia inválido) não lembra de nada.
 */
export function lembreteDeEnvio(pasta: Pick<Pasta, 'tipo' | 'diaDeEnvio'>, hoje: string): { diasFaltando: number; dia: number } | null {
  if (pasta.tipo !== 'registro' || pasta.diaDeEnvio === undefined) return null;
  try {
    const { diasFaltando } = proximoEnvio(pasta.diaDeEnvio, hoje);
    return diasFaltando <= DIAS_DE_AVISO_DO_ENVIO ? { diasFaltando, dia: pasta.diaDeEnvio } : null;
  } catch {
    return null; // dia de envio fora de 1 a 31 (dado de outro aparelho): sem lembrete
  }
}

// ---------- datas e números ----------

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const BR = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/;

function existe(a: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(a, m - 1, d));
  return dt.getUTCFullYear() === a && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** `AAAA-MM-DD` ou `dd/mm/aaaa` → `AAAA-MM-DD`; `null` se não for uma data que existe. */
export function dataDeTexto(texto: string): string | null {
  const t = texto.trim();
  const iso = ISO.exec(t);
  const br = BR.exec(t);
  const [a, m, d] = iso ? [+iso[1]!, +iso[2]!, +iso[3]!] : br ? [+br[3]!, +br[2]!, +br[1]!] : [0, 0, 0];
  if (!a || !existe(a, m, d)) return null;
  return `${String(a).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** `AAAA-MM-DD` → `dd/mm/aaaa`. */
export const dataEmBr = (iso: string): string => iso.split('-').reverse().join('/');

/** Número do jeito do Brasil, até 3 casas, sem zeros sobrando: `1.234,5`. */
export const numeroEmBr = (n: number): string => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

/** O número da célula da leitura, ou `null`. Vazio, negativo e texto solto não valem. */
export function leituraDeTexto(texto: string): number | null {
  const t = texto.replace(/\s/g, '');
  return t === '' ? null : lerNumero(t);
}

// ---------- ler ----------

export type LeituraLida = {
  /** Id da linha na planilha. */
  id: string;
  /** `AAAA-MM-DD`. */
  data: string;
  leitura: number;
  consumo: number | null;
  aviso?: 'leitura_menor';
  observacao: string;
  /** `fila`: sem rede, sai ao voltar. */
  pendente?: 'fila';
};

export type LeituraNaoSalva = { id: string; data: string; leitura: string };

export type ResumoDeLeituras = {
  /** Em ordem de data (a mais antiga primeiro), com o consumo desde a anterior. */
  leituras: LeituraLida[];
  porMes: { mes: string; consumo: number }[];
  /** Linhas da planilha que ficaram fora da conta (data ou leitura ilegível). */
  ignoradas: number;
  /** Anexos que a sincronia desistiu de enviar: não estão salvos. */
  naoSalvas: LeituraNaoSalva[];
};

const porDataELeitura = (a: { data: string; leitura: number }, b: { data: string; leitura: number }) =>
  a.data < b.data ? -1 : a.data > b.data ? 1 : a.leitura - b.leitura;

/** As leituras de uma planilha de consumo e tudo o que a tela precisa delas. Não falha com linha estranha. */
export function resumirLeituras(linhas: readonly LinhaDaPlanilha[]): ResumoDeLeituras {
  const naoSalvas: LeituraNaoSalva[] = [];
  const candidatas: { linha: LinhaDaPlanilha; data: string; leitura: number }[] = [];
  for (const linha of linhas) {
    const textoDaData = linha.valores['Data'] ?? '';
    const textoDaLeitura = linha.valores['Leitura'] ?? '';
    if (linha.pendente === 'parada') {
      naoSalvas.push({ id: linha.id, data: textoDaData, leitura: textoDaLeitura });
      continue;
    }
    // O que não dá para ler entra com valor inválido: `leiturasIgnoradas` o reconhece e o cálculo o deixa de fora.
    candidatas.push({ linha, data: dataDeTexto(textoDaData) ?? textoDaData, leitura: leituraDeTexto(textoDaLeitura) ?? Number.NaN });
  }
  const entrada: Leitura[] = candidatas.map(({ data, leitura }) => ({ data, leitura }));
  const fora = new Set(leiturasIgnoradas(entrada).map((i) => i.indice));
  const boas = candidatas.filter((_, i) => !fora.has(i)).sort(porDataELeitura);
  // `consumoDesdeAnterior` ordena do mesmo jeito: a posição `i` de uma é a posição `i` da outra.
  const calculadas = consumoDesdeAnterior(boas.map(({ data, leitura }) => ({ data, leitura })));
  const leituras = boas.map(({ linha, data, leitura }, i): LeituraLida => {
    const { consumo, aviso } = calculadas[i]!;
    return {
      id: linha.id,
      data,
      leitura,
      consumo,
      ...(aviso ? { aviso } : {}),
      observacao: linha.valores[COLUNA_DO_DESFEITO] ?? '',
      ...(linha.pendente === 'fila' ? { pendente: 'fila' as const } : {}),
    };
  });
  return { leituras, porMes: consumoPorMes(calculadas), ignoradas: fora.size, naoSalvas };
}

// ---------- gravar ----------

export type NovaLeitura = {
  /** `AAAA-MM-DD`. */
  data: string;
  valor: number;
  unidade: string;
  observacao?: string;
};

export type ResultadoDaLeitura = {
  anexo: ResultadoDoAnexo;
  /** O consumo desta leitura desde a anterior; `null` se for a primeira ou se for menor que a anterior. */
  consumo: number | null;
  aviso?: 'leitura_menor';
  /** A leitura que veio antes desta, por data. */
  anterior?: { data: string; leitura: number };
};

/**
 * Anexa uma leitura à planilha da pasta. Lê antes (se não der, usa o cache ou nada) para saber o consumo e se a
 * leitura é menor que a anterior; isso só informa: a linha é gravada do mesmo jeito. `anexo.situacao` diz se foi
 * enviada, ficou na fila (sem rede) ou foi bloqueada (planilha mudou etc.: nada gravado).
 */
export async function registrarLeitura(pasta: Pasta, nova: NovaLeitura, opcoes: OpcoesDePlanilha = {}): Promise<ResultadoDaLeitura> {
  let existentes: LeituraLida[] = [];
  try {
    existentes = resumirLeituras((await lerPlanilha(pasta, opcoes)).linhas).leituras;
  } catch {
    // Sem leitura da planilha: grava assim mesmo (o anexo diz o que aconteceu) e não afirma nada sobre o consumo.
  }
  const valores: Record<string, string> = { Data: nova.data, Leitura: String(nova.valor), Unidade: nova.unidade };
  const observacao = nova.observacao?.trim();
  // "desfeito" sozinho é a marca de linha desfeita: escrito como observação, a linha sumiria da tela. Entre parênteses, não.
  if (observacao) valores[COLUNA_DO_DESFEITO] = observacao.toLowerCase() === MARCA_DO_DESFEITO ? `(${observacao})` : observacao;
  const anexo = await anexar(pasta, valores, opcoes);

  const todas = consumoDesdeAnterior([...existentes.map(({ data, leitura }) => ({ data, leitura })), { data: nova.data, leitura: nova.valor }]);
  let posicao = -1;
  todas.forEach((l, i) => {
    if (l.data === nova.data && l.leitura === nova.valor) posicao = i;
  });
  const calculada = todas[posicao];
  const anterior = posicao > 0 ? todas[posicao - 1] : undefined;
  return {
    anexo,
    consumo: calculada?.consumo ?? null,
    ...(calculada?.aviso ? { aviso: calculada.aviso } : {}),
    ...(anterior ? { anterior: { data: anterior.data, leitura: anterior.leitura } } : {}),
  };
}
