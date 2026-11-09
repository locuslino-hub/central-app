// A moldura de toda página: título (h1) e título da aba.
import type { ComponentChildren } from 'preact';
import { useTituloDaAba } from './hooks';

export function Pagina({ titulo, children }: { titulo: string; children?: ComponentChildren }) {
  useTituloDaAba(titulo);
  return (
    <>
      <h1>{titulo}</h1>
      {children}
    </>
  );
}
