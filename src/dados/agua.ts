// Contas da água (Tarefa 25). Funções puras: nada de relógio aqui dentro. O dia
// chega como `AAAA-MM-DD` e a hora como `minuto` (minutos desde 00:00 em
// Lisboa); quem chama usa `hojeEmLisboa` e `minutoEmLisboa` (dia.ts).
// Regras fixas: docs/superpowers/specs/2026-11-09-agua.md.
import { somarDias } from '../chat/datas';
import type { AguaRegistro } from './tipos';

export const META_ML = 2000,
  GARRAFA_ML = 500,
  INICIO_MIN = 480,
  FIM_MIN = 1320,
  FOLGA_ML = 60,
  ML_MAXIMO = 5000;

/** Botões da garrafa: ¼, ½, ¾ e Toda. */
export type Fracao = 0.25 | 0.5 | 0.75 | 1;

const QUARTO_ML = GARRAFA_ML / 4;
const GARRAFAS_NA_META = META_ML / GARRAFA_ML;
/** mL por minuto no ritmo (2.000 mL em 840 min). */
const ML_POR_MINUTO = META_ML / (FIM_MIN - INICIO_MIN);
const PROXIMO_NO_MINIMO_MIN = 20;
const DIAS_NO_HISTORICO = 28;

/** Os goles do dia, por hora crescente. Lápides ficam de fora. */
export function goleDeHoje(registros: readonly AguaRegistro[], dia: string): AguaRegistro[] {
  return registros
    .filter((r) => r.data === dia && !r.apagado)
    .sort((a, b) => (a.hora < b.hora ? -1 : a.hora > b.hora ? 1 : a.atualizadoEm - b.atualizadoEm));
}

export function totalDoDia(registros: readonly AguaRegistro[], dia: string): number {
  return goleDeHoje(registros, dia).reduce((soma, r) => soma + r.ml, 0);
}

/** Quanto já devia ter bebido a esta hora: linha reta de 0 às 08:00 a 2.000 às 22:00. */
export function esperadoAgora(minuto: number): number {
  const parte = Math.max(0, Math.min(1, (minuto - INICIO_MIN) / (FIM_MIN - INICIO_MIN)));
  return Math.round(META_ML * parte);
}

export type Sugestao = { quartos: number; ml: number; botao: Fracao; texto: string };

export type Situacao =
  | { estado: 'meta'; total: number }
  | { estado: 'atras'; total: number; esperado: number; falta: number; sugestao: Sugestao }
  | { estado: 'em-dia'; total: number; esperado: number; folga: number; proximoMin: number };

/**
 * Atrás: falta mais de 60 mL para o esperado. Em dia: falta 60 ou menos (aí
 * `folga` pode ser negativa, até -60). Meta: total ≥ 2.000.
 */
export function situacao(total: number, minuto: number): Situacao {
  if (total >= META_ML) return { estado: 'meta', total };
  const esperado = esperadoAgora(minuto);
  const falta = esperado - total;
  if (falta > FOLGA_ML) return { estado: 'atras', total, esperado, falta, sugestao: sugestao(falta) };
  const folga = total - esperado;
  const proximoMin = Math.min(FIM_MIN, Math.round(minuto + Math.max(PROXIMO_NO_MINIMO_MIN, folga / ML_POR_MINUTO)));
  return { estado: 'em-dia', total, esperado, folga, proximoMin };
}

const NOME_DO_QUARTO = ['', '¼', '½', '¾'] as const;

/** A falta arredondada para cima em quartos de garrafa (no mínimo ¼). */
export function sugestao(faltaMl: number): Sugestao {
  // O `- 1e-9` evita que 250,0000001 vire 3 quartos.
  const quartos = Math.max(1, Math.ceil(faltaMl / QUARTO_ML - 1e-9));
  const inteiras = Math.floor(quartos / 4);
  const resto = quartos % 4;
  const botao: Fracao = inteiras > 0 ? 1 : (resto / 4 as Fracao);
  let texto: string;
  if (inteiras === 0) texto = `${NOME_DO_QUARTO[resto]} da garrafa`;
  else if (resto === 0) texto = inteiras === 1 ? 'a garrafa toda' : `${inteiras} garrafas inteiras`;
  else texto = `${inteiras === 1 ? '1 garrafa' : `${inteiras} garrafas`} e ${NOME_DO_QUARTO[resto]}`;
  return { quartos, ml: quartos * QUARTO_ML, botao, texto };
}

/** Qual das 4 garrafas do dia está aberta e quanto dela já foi (0 a 1). Meta batida: a 4ª cheia. */
export function garrafaDaVez(total: number): { numero: number; de: number; fracao: number } {
  if (total >= META_ML) return { numero: GARRAFAS_NA_META, de: GARRAFAS_NA_META, fracao: 1 };
  const bebido = Math.max(0, total);
  return {
    numero: Math.min(GARRAFAS_NA_META, Math.floor(bebido / GARRAFA_ML) + 1),
    de: GARRAFAS_NA_META,
    fracao: (bebido % GARRAFA_ML) / GARRAFA_ML,
  };
}

// Número com vírgula ou ponto decimal, e unidade opcional (ml, l, litro, litros).
const VALOR = /^(\d+(?:[.,]\d+)?)\s*(ml|l|litros?)?$/;

/**
 * "Outro valor": `350`, `350 ml`, `1,5 L`, `1.5l`. Número abaixo de 10 sem
 * unidade vale litros. Devolve mL inteiro de 1 a 5.000, ou `null`.
 */
export function lerValor(texto: string): number | null {
  const achado = VALOR.exec(texto.trim().toLowerCase());
  if (!achado) return null;
  const numero = Number(achado[1].replace(',', '.'));
  const unidade = achado[2];
  const emLitros = unidade ? unidade !== 'ml' : numero < 10;
  const ml = Math.round(emLitros ? numero * 1000 : numero);
  return ml >= 1 && ml <= ML_MAXIMO ? ml : null;
}

export type Historico = { porDia: { data: string; ml: number }[]; seguidos: number; media7: number; melhor: number };

/**
 * `porDia`: os últimos 28 dias, do mais antigo a hoje (dia sem goles = 0).
 * `seguidos`: dias na meta contados de ontem para trás, mais hoje se já bateu.
 * `media7`: média dos 7 dias anteriores a hoje, ao mL. `melhor`: maior dia dos 28, hoje incluído.
 */
export function historico(registros: readonly AguaRegistro[], hoje: string): Historico {
  const porData = new Map<string, number>();
  for (const r of registros) {
    if (r.apagado) continue;
    porData.set(r.data, (porData.get(r.data) ?? 0) + r.ml);
  }
  const mlDe = (data: string) => porData.get(data) ?? 0;

  const porDia = Array.from({ length: DIAS_NO_HISTORICO }, (_, i) => {
    const data = somarDias(hoje, i - (DIAS_NO_HISTORICO - 1));
    return { data, ml: mlDe(data) };
  });

  // Sem limite de 28 dias: um dia sem goles vale 0 e encerra a contagem.
  let seguidos = 0;
  for (let data = somarDias(hoje, -1); mlDe(data) >= META_ML; data = somarDias(data, -1)) seguidos++;
  if (mlDe(hoje) >= META_ML) seguidos++;

  const semana = porDia.slice(-8, -1);
  const media7 = Math.round(semana.reduce((soma, d) => soma + d.ml, 0) / semana.length);
  const melhor = Math.max(...porDia.map((d) => d.ml));

  return { porDia, seguidos, media7, melhor };
}
