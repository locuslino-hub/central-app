// O número de pendências ao lado do nome de um destino do menu (Ideias novas).
import { nIdeiasNovas } from './plural';

/** À vista só o número; o leitor de tela diz o que ele conta. */
export function Contagem({ n, classe = 'contagem' }: { n: number; classe?: string }) {
  return (
    <>
      <span class={classe} aria-hidden="true">
        {n}
      </span>
      <span class="so-leitor">{nIdeiasNovas(n)}</span>
    </>
  );
}
