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

/**
 * Texto digitado nas notas que ainda não foi guardado no registro, por sala ou
 * pessoa. Só na memória: se a sala ou a pessoa some (apagada em outro
 * aparelho) com o texto por gravar, a página que aparece no lugar mostra o
 * campo com ele, para o dono não perder o que escreveu. Só serve para isso:
 * reabrir uma sala ou pessoa que existe descarta o texto (não grava por cima
 * de uma nota mais nova de outro aparelho).
 */
const porGuardar = new Map<string, string>();
const chaveDe = (colecao: DonoDeNotas, id: string) => `${colecao}:${id}`;

export function notasPorGuardar(colecao: DonoDeNotas, id: string): string | undefined {
  return porGuardar.get(chaveDe(colecao, id));
}

export function guardarNotasPorGuardar(colecao: DonoDeNotas, id: string, texto: string): void {
  porGuardar.set(chaveDe(colecao, id), texto);
}

/** O texto foi gravado: sai, a não ser que o dono já tenha digitado outro. */
export function notasGuardadas(colecao: DonoDeNotas, id: string, texto: string): void {
  if (porGuardar.get(chaveDe(colecao, id)) === texto) porGuardar.delete(chaveDe(colecao, id));
}

/** Esquece o texto por guardar de uma sala ou pessoa. */
export function descartarNotasPorGuardar(colecao: DonoDeNotas, id: string): void {
  porGuardar.delete(chaveDe(colecao, id));
}

/** Esquece todo texto por guardar (testes). */
export function esquecerNotasPorGuardar(): void {
  porGuardar.clear();
}
