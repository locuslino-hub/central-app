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

/**
 * Grava de volta o que a cópia tem, como uma edição nova (vale mais que a
 * versão de agora e sincroniza com os outros aparelhos). Não apaga nada: o que
 * existe e não está na cópia continua. Registro com forma inválida é recusado
 * pela mesma conferência que o script faz.
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
    for (const registro of registros as unknown[]) {
      if (!registroValido(nome, registro, agora) || (registro as Registro).apagado) {
        recusados += 1;
        continue;
      }
      const { atualizadoEm: _hora, aparelho: _aparelho, apagado: _apagado, ...resto } = registro as Registro;
      await salvar(nome, resto as ParaSalvar<Colecoes[typeof nome]>);
      restaurados += 1;
    }
  }
  return { restaurados, recusados };
}
