// Os eventos de um período, atualizados ao abrir a tela, ao voltar ao app e a
// cada 15 minutos (src/dados/eventos.ts guarda e lê).
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Evento } from '../dados/agenda';
import { assinarEventos, atualizarEventos, eventosAEnviar, eventosEnviados, lerEventos, type Leitura } from '../dados/eventos';
import { aplicarFeitos } from '../dados/eventos-feitos';
import { listarPendentes } from '../dados/loja';
import type { PendenteCriarEvento } from '../dados/tipos';
import { useEventosFeitos } from './hooks';

export const ATUALIZAR_A_CADA_MS = 15 * 60_000;
/** Abrir telas ou voltar ao app em sequência não repete a chamada antes disto. */
export const INTERVALO_MINIMO_MS = 30_000;

/** Os compromissos que este aparelho pôs na fila da agenda (sem internet, ou o Google recusou). */
async function lerCriacoesNaFila(): Promise<PendenteCriarEvento[]> {
  const fila = await listarPendentes();
  return fila.filter((p): p is PendenteCriarEvento => p.tipo === 'agenda' && p.acao === 'criarEvento');
}

/**
 * `atualizar` ignora o intervalo mínimo (botão "Tentar de novo"). A leitura
 * que já existe aparece de imediato, enquanto a nova chega. O compromisso que
 * ainda está na fila entra na leitura, marcado "a enviar" (`eventosAEnviar`):
 * sem internet, o que o dono acabou de criar já aparece.
 */
export function useEventos(de: string, ate: string): { leitura: Leitura; atualizar: () => void } {
  // A leitura é lida na hora de desenhar, do período pedido agora: depois de uma
  // troca de período nunca aparece, por um instante, a leitura do período antigo.
  const [versao, refazer] = useState(0);
  const [fila, setFila] = useState<PendenteCriarEvento[]>([]);
  const lida = lerEventos(de, ate);
  const leitura = useMemo(() => {
    // Criado por este aparelho e ainda não trazido por uma leitura: continua à vista.
    const enviados = eventosEnviados(de, ate, lida.eventos);
    const vistos = enviados.length ? [...lida.eventos, ...enviados] : lida.eventos;
    const aEnviar = eventosAEnviar(fila, de, ate, vistos);
    return vistos === lida.eventos && !aEnviar.length ? lida : { ...lida, eventos: [...vistos, ...aEnviar] };
    // `versao` muda a cada aviso dos eventos: os enviados podem ter mudado.
  }, [lida, fila, de, ate, versao]);

  useEffect(() => {
    let ligado = true;
    let ultimaFila = '[]';
    const relerFila = () => {
      lerCriacoesNaFila().then(
        (nova) => {
          const texto = JSON.stringify(nova.map((p) => p.evento));
          if (!ligado || texto === ultimaFila) return;
          ultimaFila = texto;
          setFila(nova);
        },
        (erro: unknown) => console.error('Não consegui ler a fila da agenda', erro),
      );
    };
    refazer((n) => n + 1); // a leitura pode ter mudado entre o desenho e a assinatura
    relerFila();
    const parar = assinarEventos(() => {
      refazer((n) => n + 1);
      relerFila();
      // Um evento foi criado ou removido por este aparelho: lê de novo sem esperar o intervalo.
      const atual = lerEventos(de, ate);
      if (atual.obsoleta && !atual.carregando) void atualizarEventos(de, ate);
    });
    const tentar = (forcar: boolean) => {
      const atual = lerEventos(de, ate);
      if (atual.carregando) return;
      // Obsoleta: este aparelho criou ou removeu um evento com a tela fechada
      // (no celular o chat é outra página). Ao abrir, lê de novo sem esperar.
      if (forcar || atual.obsoleta || atual.tentadoEm === null || Date.now() - atual.tentadoEm >= INTERVALO_MINIMO_MS) {
        void atualizarEventos(de, ate);
      }
    };
    const aoVoltar = () => {
      if (document.visibilityState !== 'hidden') tentar(false);
    };
    tentar(false);
    document.addEventListener('visibilitychange', aoVoltar);
    // Com o app escondido não vale gastar chamada; ao voltar, `aoVoltar` lê de novo.
    const relogio = setInterval(() => {
      if (document.visibilityState !== 'hidden') tentar(true);
    }, ATUALIZAR_A_CADA_MS);
    return () => {
      ligado = false;
      parar();
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', aoVoltar);
      clearInterval(relogio);
    };
  }, [de, ate]);

  return { leitura, atualizar: () => void atualizarEventos(de, ate) };
}

/**
 * A leitura já guardada do período, acompanhando as mudanças, sem pedir ao
 * script: para quem só soma o que outra parte da tela já leu (o progresso
 * da Checklist usa o que a Agenda de hoje lê).
 */
export function useLeituraGuardada(de: string, ate: string): Leitura {
  const [, refazer] = useState(0);
  useEffect(() => {
    refazer((n) => n + 1);
    return assinarEventos(() => refazer((n) => n + 1));
  }, [de, ate]);
  return lerEventos(de, ate);
}

/** Os eventos com o feito que vale (o marcado na Central, senão o do Google). */
export function useComFeito(eventos: Evento[]): Evento[] {
  const feitos = useEventosFeitos();
  return useMemo(() => aplicarFeitos(eventos, feitos), [eventos, feitos]);
}
