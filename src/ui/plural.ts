// Contagens com o plural certo ("1 tarefa", "2 tarefas") e listas em frase
// ("a, b e c"). Um lugar só, para nenhuma tela escrever "1 tarefas".

/** `3 tarefas`, `1 tarefa`, `0 tarefas`. */
export const contar = (n: number, um: string, varios: string): string => `${n} ${n === 1 ? um : varios}`;

export const nTarefas = (n: number) => contar(n, 'tarefa', 'tarefas');
export const nEmails = (n: number) => contar(n, 'e-mail', 'e-mails');
export const nItens = (n: number) => contar(n, 'item', 'itens');

/** "a", "a e b", "a, b e c". */
export function juntar(partes: readonly string[]): string {
  if (partes.length <= 1) return partes.join('');
  return `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}`;
}
