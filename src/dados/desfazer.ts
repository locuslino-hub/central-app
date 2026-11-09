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

/**
 * Uma ação em lote andou só em parte e depois falhou: o erro sobe com o
 * Desfazer do que já andou (registrado na pilha), para nada ficar sem volta.
 */
export class EmParte extends Error {
  constructor(
    readonly entrada: Desfazivel,
    readonly causa: unknown,
  ) {
    super('Só parte foi feita');
  }
}

/**
 * Roda `passos` em ordem; cada um devolve a sua volta (ou nada, se não mudou
 * nada). No fim, mesmo com falha no meio, registra um Desfazer só com o que
 * andou. `rotulo(n)`: o texto para `n` itens que andaram.
 */
export async function emLote(
  passos: readonly (() => Promise<(() => Promise<void>) | undefined>)[],
  rotulo: (n: number) => string,
): Promise<Desfazivel | undefined> {
  const voltas: (() => Promise<void>)[] = [];
  let falha: { causa: unknown } | undefined;
  let entrada: Desfazivel | undefined;
  try {
    for (const passo of passos) {
      const volta = await passo();
      if (volta) voltas.push(volta);
    }
  } catch (causa) {
    falha = { causa };
  } finally {
    if (voltas.length > 0) {
      entrada = desfazer.registrar(rotulo(voltas.length), async () => {
        for (const voltar of [...voltas].reverse()) await voltar();
      });
    }
  }
  if (falha) {
    if (entrada) throw new EmParte(entrada, falha.causa);
    throw falha.causa;
  }
  return entrada;
}
