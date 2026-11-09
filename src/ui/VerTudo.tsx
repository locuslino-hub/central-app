// Listas longas no celular (Tarefa 16, rodada 1): depois de 3 itens, o resto
// fica atrás de "Ver tudo (N)". O botão diz se está aberto (aria-expanded) e o
// foco fica nele; no computador a lista aparece inteira.
import { useState } from 'preact/hooks';
import { useTela } from './hooks';

export const ITENS_NO_CELULAR = 3;

/** Quantos mostrar e o botão que abre ou fecha o resto (`null` quando não precisa). */
export function useVerTudo(total: number, limite = ITENS_NO_CELULAR) {
  const tela = useTela();
  const [aberto, setAberto] = useState(false);
  const recolhe = tela === 'celular' && total > limite;
  const mostrar = recolhe && !aberto ? limite : total;
  const botao = recolhe ? (
    <button type="button" class="botao-texto ver-tudo" aria-expanded={aberto} onClick={() => setAberto((a) => !a)}>
      {aberto ? 'Mostrar menos' : `Ver tudo (${total})`}
    </button>
  ) : null;
  return { mostrar, botao };
}
