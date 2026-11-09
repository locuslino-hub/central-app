// Os eventos de um período, atualizados ao abrir a tela, ao voltar ao app e a
// cada 15 minutos (src/dados/eventos.ts guarda e lê).
import { useEffect, useState } from 'preact/hooks';
import { assinarEventos, atualizarEventos, lerEventos, type Leitura } from '../dados/eventos';

export const ATUALIZAR_A_CADA_MS = 15 * 60_000;
/** Abrir telas ou voltar ao app em sequência não repete a chamada antes disto. */
export const INTERVALO_MINIMO_MS = 30_000;

/**
 * `atualizar` ignora o intervalo mínimo (botão "Tentar de novo"). A leitura
 * que já existe aparece de imediato, enquanto a nova chega.
 */
export function useEventos(de: string, ate: string): { leitura: Leitura; atualizar: () => void } {
  const [leitura, setLeitura] = useState(() => lerEventos(de, ate));

  useEffect(() => {
    setLeitura(lerEventos(de, ate));
    const parar = assinarEventos(() => setLeitura(lerEventos(de, ate)));
    const tentar = (forcar: boolean) => {
      const atual = lerEventos(de, ate);
      if (atual.carregando) return;
      if (forcar || atual.tentadoEm === null || Date.now() - atual.tentadoEm >= INTERVALO_MINIMO_MS) {
        void atualizarEventos(de, ate);
      }
    };
    const aoVoltar = () => {
      if (document.visibilityState !== 'hidden') tentar(false);
    };
    tentar(false);
    document.addEventListener('visibilitychange', aoVoltar);
    const relogio = setInterval(() => tentar(true), ATUALIZAR_A_CADA_MS);
    return () => {
      parar();
      document.removeEventListener('visibilitychange', aoVoltar);
      clearInterval(relogio);
    };
  }, [de, ate]);

  return { leitura, atualizar: () => void atualizarEventos(de, ate) };
}
