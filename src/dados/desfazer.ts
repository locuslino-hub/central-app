export type Desfazivel = { rotulo: string; reverter: () => Promise<void> };

/**
 * Pilha de desfazer. `ultimo()` só espia o topo (a tela mostra o rótulo);
 * rodar o `reverter` devolvido tira a entrada da pilha e desfaz uma única vez.
 */
export function criarDesfazer() {
  const pilha: Desfazivel[] = [];

  return {
    registrar(rotulo: string, reverter: () => void | Promise<void>): void {
      const entrada: Desfazivel = {
        rotulo,
        async reverter() {
          const posicao = pilha.indexOf(entrada);
          if (posicao === -1) return;
          pilha.splice(posicao, 1);
          await reverter();
        },
      };
      pilha.push(entrada);
    },
    ultimo(): Desfazivel | undefined {
      return pilha[pilha.length - 1];
    },
  };
}

export const desfazer = criarDesfazer();
