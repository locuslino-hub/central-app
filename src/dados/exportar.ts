// Cópia de segurança (Tarefa 23): todas as coleções deste aparelho num arquivo
// JSON que o dono guarda onde quiser, e a volta dela. A cópia nunca leva a
// conexão com o script nem o código do aparelho (ficam em outro banco), nem os
// e-mails (só ficam na memória), nem o que já foi apagado.
import { NOMES_DAS_COLECOES, colecaoConhecida, registroValido } from '../../script/colecoes';
import { listar, salvar } from './loja';
import type { Colecao, Colecoes, ParaSalvar, Registro } from './tipos';

export const FORMATO_DA_COPIA = 'central-de-comando-copia-1';

export type Copia = {
  formato: typeof FORMATO_DA_COPIA;
  /** ISO 8601, em UTC. */
  exportadoEm: string;
  colecoes: { [C in Colecao]: Colecoes[C][] };
};

export async function montarCopia(): Promise<Copia> {
  const colecoes: Record<string, unknown[]> = {};
  for (const nome of NOMES_DAS_COLECOES) colecoes[nome] = await listar(nome);
  return { formato: FORMATO_DA_COPIA, exportadoEm: new Date().toISOString(), colecoes: colecoes as Copia['colecoes'] };
}

export function nomeDoArquivoDaCopia(quando: Date = new Date()): string {
  return `central-copia-${quando.toISOString().slice(0, 10)}.json`;
}

/** O texto de um arquivo de cópia; `null` se não for um. */
export function lerCopia(texto: string): Copia | null {
  let valor: unknown;
  try {
    valor = JSON.parse(texto);
  } catch {
    return null;
  }
  if (typeof valor !== 'object' || valor === null) return null;
  const { formato, colecoes } = valor as Record<string, unknown>;
  if (formato !== FORMATO_DA_COPIA || typeof colecoes !== 'object' || colecoes === null || Array.isArray(colecoes)) return null;
  return valor as Copia;
}

/** Maior arquivo de cópia que o app aceita ler (a cópia de um uso grande tem bem menos que isso). */
export const TAMANHO_MAXIMO_DA_COPIA = 5 * 1024 * 1024;

/**
 * O que a restauração NÃO devolve: a configuração (é deste aparelho e do dia), e as marcas do caminho até o
 * Google (`pendenteNoGoogle`, `soNaCentral`): uma marca velha faria o app achar que há um ✓ a caminho do Google.
 */
const NAO_RESTAURA = new Set<string>(['config']);
const MARCAS_DO_GOOGLE = ['pendenteNoGoogle', 'soNaCentral'];

/** O registro como a restauração o grava: forma conferida e sem as marcas do Google; `null` se não vale. */
function paraRestaurar(nome: string, registro: unknown, agora: number): ParaSalvar<Colecoes[Colecao]> | null {
  if (!colecaoConhecida(nome) || NAO_RESTAURA.has(nome)) return null;
  if (!registroValido(nome, registro, agora, { estrito: true }) || (registro as Registro).apagado) return null;
  const { atualizadoEm: _hora, aparelho: _aparelho, apagado: _apagado, ...resto } = registro as Registro & Record<string, unknown>;
  for (const marca of MARCAS_DO_GOOGLE) delete resto[marca];
  return resto as ParaSalvar<Colecoes[Colecao]>;
}

/** Quantos itens a restauração devolveria e de que dia é a cópia (`DD/MM`), para o dono confirmar. */
export function resumoDaCopia(copia: Copia): { itens: number; dia: string } {
  const agora = Date.now();
  let itens = 0;
  for (const [nome, registros] of Object.entries(copia.colecoes)) {
    if (!Array.isArray(registros)) continue;
    itens += (registros as unknown[]).filter((registro) => paraRestaurar(nome, registro, agora) !== null).length;
  }
  const [, mes, dia] = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(copia.exportadoEm))?.slice(1) ?? [];
  return { itens, dia: dia && mes ? `${dia}/${mes}` : 'data desconhecida' };
}

/**
 * Grava de volta o que a cópia tem, como uma edição nova (vale mais que a
 * versão de agora e sincroniza com os outros aparelhos). Não apaga nada: o que
 * existe e não está na cópia continua. Registro com forma inválida é recusado
 * pela mesma conferência que o script faz (estrita). Nada vai ao Google: a
 * configuração não volta, as marcas de envio ao Google saem, e a tarefa que
 * volta não entra na fila do espelho do Google Tarefas.
 */
export async function restaurarCopia(copia: Copia): Promise<{ restaurados: number; recusados: number }> {
  let restaurados = 0;
  let recusados = 0;
  const agora = Date.now();
  for (const [nome, registros] of Object.entries(copia.colecoes)) {
    if (!colecaoConhecida(nome) || !Array.isArray(registros)) {
      recusados += Array.isArray(registros) ? registros.length : 1;
      continue;
    }
    if (NAO_RESTAURA.has(nome)) continue;
    for (const registro of registros as unknown[]) {
      const pronto = paraRestaurar(nome, registro, agora);
      if (!pronto) {
        recusados += 1;
        continue;
      }
      await salvar(nome, pronto as never, { semEspelho: true });
      restaurados += 1;
    }
  }
  return { restaurados, recusados };
}
