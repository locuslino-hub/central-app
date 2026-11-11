export type Desfazivel = { rotulo: string; reverter: () => Promise<void> };

/** Entradas guardadas na pilha; as mais velhas saem. */
export const DESFAZER_NO_MAXIMO = 50;

/**
 * Pilha de desfazer. `ultimo()` só espia o topo (a tela mostra o rótulo);
 * rodar o `reverter` devolvido desfaz uma única vez. `registrar` devolve a
 * própria entrada, para quem desfaz um item certo (o cartão do chat) e não o
 * último da pilha; ela vale mesmo depois de sair da pilha pelo limite.
 * A entrada só sai da pilha quando o desfazer dá certo: se ele falha, fica no
 * lugar e o erro sobe, e o dono pode tentar de novo. Enquanto ele anda,
 * `ultimo()` não a mostra, e chamar de novo espera o mesmo desfazer (não
 * desfaz duas vezes).
 */
export function criarDesfazer() {
  const pilha: Desfazivel[] = [];
  const andando = new Set<Desfazivel>();

  return {
    registrar(rotulo: string, reverter: () => void | Promise<void>): Desfazivel {
      let feito = false;
      let emAndamento: Promise<void> | undefined;
      const entrada: Desfazivel = {
        rotulo,
        reverter() {
          if (feito) return Promise.resolve();
          if (emAndamento) return emAndamento;
          andando.add(entrada);
          // Um passo adiante: `emAndamento` já está guardado quando o `finally` o limpa,
          // mesmo se o desfazer falhar na hora.
          emAndamento = Promise.resolve()
            .then(reverter)
            .then(() => {
              feito = true;
              const posicao = pilha.indexOf(entrada);
              if (posicao !== -1) pilha.splice(posicao, 1);
            })
            .finally(() => {
              andando.delete(entrada);
              emAndamento = undefined;
            });
          return emAndamento;
        },
      };
      pilha.push(entrada);
      if (pilha.length > DESFAZER_NO_MAXIMO) pilha.splice(0, pilha.length - DESFAZER_NO_MAXIMO);
      return entrada;
    },
    ultimo(): Desfazivel | undefined {
      for (let i = pilha.length - 1; i >= 0; i--) if (!andando.has(pilha[i])) return pilha[i];
      return undefined;
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
