export type Desfazivel = { rotulo: string; reverter: () => Promise<void> };

/**
 * Pilha de desfazer. `ultimo()` só espia o topo (a tela mostra o rótulo);
 * rodar o `reverter` devolvido tira a entrada da pilha e desfaz uma única vez.
 * `registrar` devolve a própria entrada, para quem desfaz um item certo (o
 * cartão do chat) e não o último da pilha. Se o desfazer falha, a entrada
 * volta ao lugar e o erro sobe: o dono pode tentar de novo.
 */
export function criarDesfazer() {
  const pilha: Desfazivel[] = [];

  return {
    registrar(rotulo: string, reverter: () => void | Promise<void>): Desfazivel {
      const entrada: Desfazivel = {
        rotulo,
        async reverter() {
          const posicao = pilha.indexOf(entrada);
          if (posicao === -1) return;
          pilha.splice(posicao, 1);
          try {
            await reverter();
          } catch (erro) {
            pilha.splice(Math.min(posicao, pilha.length), 0, entrada);
            throw erro;
          }
        },
      };
      pilha.push(entrada);
      return entrada;
    },
    ultimo(): Desfazivel | undefined {
      return pilha[pilha.length - 1];
    },
  };
}

export const desfazer = criarDesfazer();
