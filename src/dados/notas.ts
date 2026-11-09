// Notas de uma sala ou de uma pessoa: um texto livre guardado no próprio
// registro (`notas`), que sincroniza com ele. Vazio apaga o campo.
import { lerRegistros, salvar } from './loja';
import type { Pessoa, Sala } from './tipos';

export type DonoDeNotas = 'salas' | 'pessoas';

/** Teto do texto: protege o arquivo do Drive de uma colagem enorme. */
export const NOTAS_NO_MAXIMO = 20_000;

/**
 * Grava as notas lendo o registro de novo antes: o nome, a sala e o resto que
 * mudaram em outro aparelho não são regravados por uma cópia velha.
 * `false` se a sala ou a pessoa não existe mais.
 */
export async function salvarNotas(colecao: DonoDeNotas, id: string, texto: string): Promise<boolean> {
  const [lido] = await lerRegistros([{ colecao, id }]);
  if (!lido || lido.apagado) return false;
  const { notas: antigas, ...resto } = lido as Sala | Pessoa;
  const novas = texto.slice(0, NOTAS_NO_MAXIMO);
  if ((antigas ?? '') === novas) return true;
  // `as never`: `resto` e `notas` valem para as duas coleções; o compilador não une as duas formas.
  await salvar(colecao, (novas === '' ? resto : { ...resto, notas: novas }) as never);
  return true;
}
