// A moldura de toda página: título (h1) e título da aba.
import type { ComponentChildren } from 'preact';
import { useTituloDaAba } from './hooks';

type Props = {
  titulo: string;
  /** O título só para o leitor de tela (o Painel do dia mostra a saudação no lugar). */
  tituloEscondido?: boolean;
  children?: ComponentChildren;
};

export function Pagina({ titulo, tituloEscondido = false, children }: Props) {
  useTituloDaAba(titulo);
  return (
    <>
      <h1 class={tituloEscondido ? 'so-leitor' : undefined}>{titulo}</h1>
      {children}
    </>
  );
}
