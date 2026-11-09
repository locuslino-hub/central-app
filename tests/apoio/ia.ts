// Trabalhador falso da IA local: responde como src/ia/trabalhador.ts, sem modelo.
import type { Ambiente } from '../../src/ia/ia';
import type { Pedido, Resposta } from '../../src/ia/trabalhador';

type Opcoes = {
  /** O modelo já está guardado no aparelho. */
  guardado?: boolean;
  /** O texto que o "modelo" responde a cada pergunta. */
  resposta?: string;
  /** Não responde às perguntas (para o tempo limite). */
  mudo?: boolean;
  /** Falha ao carregar o modelo. */
  falhaAoCarregar?: boolean;
  /** Falha no download, com este motivo. */
  falhaAoBaixar?: 'sem-espaco' | 'sem-internet' | 'falhou';
  /** Passos do download, em bytes já baixados. */
  passos?: number[];
  /** O aparelho roda a IA (WebGPU, trabalhador e pasta privada). */
  suportado?: boolean;
  /** Resposta de `navigator.storage.persist()`. */
  persistente?: boolean | null;
  /** Segura o download até `soltarDownload()`. */
  segurarDownload?: boolean;
  /** Uma versão nova do app já assumiu (service worker) e esta tela é a velha. */
  desatualizado?: boolean;
};

export type AmbienteFalso = Ambiente & {
  /** Falha ao carregar o modelo (pode mudar no meio do teste). */
  falhaAoCarregar: boolean;
  /** Versão nova do app já ativa (pode mudar no meio do teste). */
  versaoNova: boolean;
  pedidos: Pedido[];
  perguntas: { id: number; sistema: string; frase: string }[];
  persistiu: number;
  soltarDownload(): void;
  /** Simula o trabalhador quebrando (falta de memória, por exemplo). */
  quebrar(): void;
};

export const TOTAL_FALSO = 3_000;

export function trabalhadorFalso(opcoes: Opcoes = {}): AmbienteFalso {
  let guardado = opcoes.guardado ?? false;
  let soltar: (() => void) | null = null;
  let cancelado = false;
  let atual: { onmessage: ((e: { data: Resposta }) => void) | null; onerror: ((e: unknown) => void) | null } | null =
    null;

  const ambiente: AmbienteFalso = {
    falhaAoCarregar: opcoes.falhaAoCarregar ?? false,
    versaoNova: opcoes.desatualizado ?? false,
    desatualizado: () => ambiente.versaoNova,
    pedidos: [],
    perguntas: [],
    persistiu: 0,
    caminhoWasm: 'http://localhost/central-app/litertlm/',
    suportado: () => opcoes.suportado ?? true,
    persistir: async () => {
      ambiente.persistiu++;
      return opcoes.persistente ?? true;
    },
    soltarDownload: () => soltar?.(),
    quebrar: () => atual?.onerror?.(new Event('error')),
    criarTrabalhador() {
      const trabalhador = {
        onmessage: null as ((e: { data: Resposta }) => void) | null,
        onerror: null as ((e: unknown) => void) | null,
        terminate() {},
        postMessage(pedido: Pedido) {
          ambiente.pedidos.push(pedido);
          void responder(pedido);
        },
      };
      atual = trabalhador;
      const enviar = (resposta: Resposta) => trabalhador.onmessage?.({ data: resposta });

      async function responder(pedido: Pedido) {
        await Promise.resolve();
        switch (pedido.tipo) {
          case 'verificar':
            enviar({ tipo: 'verificado', guardado });
            return;
          case 'cancelar-download':
            if (soltar) {
              cancelado = true;
              soltar();
            }
            return;
          case 'baixar':
            if (opcoes.segurarDownload) await new Promise<void>((r) => (soltar = r));
            soltar = null;
            if (cancelado) {
              cancelado = false;
              enviar({ tipo: 'erro', etapa: 'baixar', motivo: 'cancelado' });
              return;
            }
            if (opcoes.falhaAoBaixar) {
              enviar({ tipo: 'erro', etapa: 'baixar', motivo: opcoes.falhaAoBaixar });
              return;
            }
            for (const baixados of opcoes.passos ?? [1_000, TOTAL_FALSO]) {
              enviar({ tipo: 'progresso', baixados, total: TOTAL_FALSO });
            }
            guardado = true;
            enviar({ tipo: 'baixado' });
            return;
          case 'carregar':
            enviar(ambiente.falhaAoCarregar ? { tipo: 'erro', etapa: 'carregar', motivo: 'falhou' } : { tipo: 'carregada' });
            return;
          case 'perguntar':
            ambiente.perguntas.push({ id: pedido.id, sistema: pedido.sistema, frase: pedido.frase });
            if (!opcoes.mudo) enviar({ tipo: 'resposta', id: pedido.id, texto: opcoes.resposta ?? '{"itens":[]}' });
            return;
          case 'apagar':
            guardado = false;
            enviar({ tipo: 'apagado' });
            return;
          default:
            return;
        }
      }
      return trabalhador;
    },
  };
  return ambiente;
}
