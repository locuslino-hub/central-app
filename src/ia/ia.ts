// A IA local do lado da tela (Tarefa 21). Fala com o trabalhador
// (src/ia/trabalhador.ts) e diz em que pé ela está:
//
// - `ausente`: o modelo não está no aparelho. Nada é baixado sozinho: só quando
//   o dono pede em IA local (src/ui/ConfigIA.tsx).
// - `baixando`: download em curso, com progresso.
// - `carregando`: abrindo o modelo em segundo plano. O chat já funciona.
// - `pronta`: o chat pode perguntar.
// - `indisponivel`: o aparelho não roda a IA, algo falhou, ou uma versão nova
//   do app já assumiu e esta tela é a velha (`desatualizado`: o trabalhador da
//   versão velha pode nem existir mais no servidor). O chat segue com regras e
//   memória.
//
// A IA é opcional: `interpretar` nunca lança erro. Sem IA pronta, resposta
// quebrada, falha ou desistência, devolve `null` e o chat usa as regras.

import { lerResposta, montarInstrucoes, type ContextoIA, type ItemIA } from './instrucoes';
import { novaVersaoPronta } from '../pwa';
import type { Motivo, Pedido, Resposta } from './trabalhador';

export type EstadoIA = 'ausente' | 'baixando' | 'carregando' | 'pronta' | 'indisponivel';

/** O que o chat usa da IA. */
export type IA = {
  estado(): EstadoIA;
  interpretar(frase: string, contexto: ContextoIA): Promise<ItemIA[] | null>;
};

/** Por que a IA está indisponível: os do trabalhador e `desatualizado` (versão nova do app ativa). */
export type MotivoIA = Motivo | 'desatualizado';

export type DetalhesIA = {
  estado: EstadoIA;
  /** Por que está indisponível. */
  motivo?: MotivoIA;
  /** Download em curso, em bytes. */
  progresso?: { baixados: number; total: number };
  /** Resposta de `navigator.storage.persist()` no último download. */
  persistente?: boolean | null;
};

/** O que a tela de IA local usa a mais. */
export type IALocal = IA & {
  /** Vê se o modelo está guardado e, se estiver, abre em segundo plano. */
  iniciar(): Promise<void>;
  /**
   * Depois de uma falha: se o modelo inteiro ainda está no aparelho, tenta
   * abrir de novo e devolve `true`. `false`: é preciso baixar.
   */
  reabrir(): Promise<boolean>;
  /** Baixa o modelo (só a pedido do dono) e abre. */
  baixar(): Promise<void>;
  cancelarDownload(): void;
  /** Tira o modelo do aparelho. */
  apagar(): Promise<void>;
  detalhes(): DetalhesIA;
  assinar(ouvinte: () => void): () => void;
};

/** O trabalhador como a IA o usa (o `Worker` do navegador serve). */
export type Trabalhador = {
  postMessage(pedido: Pedido): void;
  onmessage: ((evento: { data: Resposta }) => void) | null;
  onerror: ((evento: unknown) => void) | null;
  terminate(): void;
};

/** O que vem do navegador; os testes trocam por um falso. */
export type Ambiente = {
  /** WebGPU, trabalhador e pasta privada existem. */
  suportado(): boolean;
  criarTrabalhador(): Trabalhador;
  persistir(): Promise<boolean | null>;
  /** Uma versão nova do app já assumiu (src/pwa.ts): é preciso recarregar antes de abrir a IA. */
  desatualizado(): boolean;
  /** Endereço completo da pasta `litertlm/<versão>/` do app, com `/` no fim. */
  caminhoWasm: string;
};

type Espera = { aceita: (resposta: Resposta) => boolean; resolver: (resposta: Resposta | null) => void };

export function criarIA(ambiente: Ambiente = ambienteDoNavegador()): IALocal {
  let detalhes: DetalhesIA = { estado: 'ausente' };
  const ouvintes = new Set<() => void>();
  const esperas = new Set<Espera>();
  let trabalhador: Trabalhador | null = null;
  let inicio: Promise<void> | null = null;
  let proximoId = 0;

  function mudar(novos: DetalhesIA) {
    detalhes = novos;
    for (const ouvinte of [...ouvintes]) ouvinte();
  }

  function quebrou(erro: unknown) {
    const desatualizado = ambiente.desatualizado();
    if (!desatualizado) console.error('A IA local parou', erro);
    trabalhador?.terminate();
    trabalhador = null;
    inicio = null;
    mudar({ estado: 'indisponivel', motivo: desatualizado ? 'desatualizado' : 'falhou' });
    for (const espera of [...esperas]) espera.resolver(null);
    esperas.clear();
  }

  function obterTrabalhador(): Trabalhador {
    if (trabalhador) return trabalhador;
    // Com a versão nova no comando, o arquivo do trabalhador desta versão já saiu do aparelho.
    if (ambiente.desatualizado()) throw new Error('Versão nova do app ativa: recarregue para usar a IA');
    const novo = ambiente.criarTrabalhador();
    novo.onmessage = ({ data }) => {
      if (data.tipo === 'progresso') {
        if (detalhes.estado === 'baixando') {
          mudar({ ...detalhes, progresso: { baixados: data.baixados, total: data.total } });
        }
        return;
      }
      for (const espera of [...esperas]) {
        if (!espera.aceita(data)) continue;
        esperas.delete(espera);
        espera.resolver(data);
        return;
      }
    };
    novo.onerror = quebrou;
    trabalhador = novo;
    return novo;
  }

  /** Manda o pedido e espera a resposta aceita; `null` se o trabalhador quebrar. */
  function pedir(pedido: Pedido, aceita: (resposta: Resposta) => boolean): Promise<Resposta | null> {
    let alvo: Trabalhador;
    try {
      alvo = obterTrabalhador();
    } catch (erro) {
      quebrou(erro); // o navegador recusou o trabalhador
      return Promise.resolve(null);
    }
    const resposta = new Promise<Resposta | null>((resolver) => esperas.add({ aceita, resolver }));
    alvo.postMessage(pedido);
    return resposta;
  }

  const daEtapa = (tipo: Resposta['tipo'], etapa: string) => (r: Resposta) =>
    r.tipo === tipo || (r.tipo === 'erro' && r.etapa === etapa && r.id === undefined);

  async function carregar() {
    mudar({ ...detalhes, estado: 'carregando', motivo: undefined, progresso: undefined });
    const resposta = await pedir({ tipo: 'carregar', wasm: ambiente.caminhoWasm }, daEtapa('carregada', 'carregar'));
    if (resposta?.tipo === 'carregada') mudar({ ...detalhes, estado: 'pronta' });
    else if (resposta) mudar({ ...detalhes, estado: 'indisponivel', motivo: 'falhou' });
  }

  async function verificarECarregar() {
    if (!ambiente.suportado()) {
      mudar({ estado: 'indisponivel', motivo: 'sem-suporte' });
      return;
    }
    const resposta = await pedir({ tipo: 'verificar' }, daEtapa('verificado', 'verificar'));
    if (!resposta) return;
    if (resposta.tipo !== 'verificado') {
      mudar({ estado: 'indisponivel', motivo: 'sem-suporte' });
      return;
    }
    if (resposta.guardado) await carregar();
    else mudar({ estado: 'ausente' });
  }

  const ia: IALocal = {
    estado: () => detalhes.estado,
    detalhes: () => detalhes,

    assinar(ouvinte) {
      ouvintes.add(ouvinte);
      return () => {
        ouvintes.delete(ouvinte);
      };
    },

    iniciar() {
      inicio ??= verificarECarregar();
      return inicio;
    },

    async reabrir() {
      const { estado, motivo } = detalhes;
      if (estado !== 'indisponivel' || motivo === 'sem-suporte' || motivo === 'desatualizado') return false;
      const resposta = await pedir({ tipo: 'verificar' }, daEtapa('verificado', 'verificar'));
      if (resposta?.tipo !== 'verificado' || !resposta.guardado) return false;
      await carregar();
      return true;
    },

    async baixar() {
      const { estado, motivo } = detalhes;
      const podeBaixar =
        estado === 'ausente' || (estado === 'indisponivel' && motivo !== 'sem-suporte' && motivo !== 'desatualizado');
      if (!podeBaixar || !ambiente.suportado()) return;
      let persistente: boolean | null;
      try {
        persistente = await ambiente.persistir();
      } catch {
        persistente = null;
      }
      mudar({ estado: 'baixando', persistente, progresso: undefined });
      const resposta = await pedir({ tipo: 'baixar' }, daEtapa('baixado', 'baixar'));
      if (!resposta) return;
      if (resposta.tipo === 'baixado') {
        await carregar();
      } else if (resposta.tipo === 'erro') {
        mudar(
          resposta.motivo === 'cancelado'
            ? { estado: 'ausente', persistente }
            : { estado: 'indisponivel', motivo: resposta.motivo, persistente },
        );
      }
    },

    cancelarDownload() {
      if (detalhes.estado === 'baixando') trabalhador?.postMessage({ tipo: 'cancelar-download' });
    },

    async apagar() {
      if (detalhes.estado === 'indisponivel' && detalhes.motivo === 'sem-suporte') return;
      const resposta = await pedir({ tipo: 'apagar' }, daEtapa('apagado', 'apagar'));
      if (resposta?.tipo === 'apagado') mudar({ estado: 'ausente' });
      else if (resposta) mudar({ estado: 'indisponivel', motivo: 'falhou' });
    },

    async interpretar(frase, contexto) {
      if (detalhes.estado !== 'pronta' || !trabalhador) return null;
      const { sinal } = contexto;
      if (sinal?.aborted) return null;
      const id = ++proximoId;
      const sistema = montarInstrucoes(contexto, frase);
      const resposta = pedir(
        { tipo: 'perguntar', id, sistema, frase },
        (r) => (r.tipo === 'resposta' || r.tipo === 'erro') && r.id === id,
      );
      const desistencia = new Promise<null>((resolver) => {
        sinal?.addEventListener(
          'abort',
          () => {
            trabalhador?.postMessage({ tipo: 'cancelar', id });
            resolver(null);
          },
          { once: true },
        );
      });
      const final = await Promise.race([resposta, desistencia]);
      return final?.tipo === 'resposta' ? lerResposta(final.texto) : null;
    },
  };
  return ia;
}

/** O navegador de verdade. */
export function ambienteDoNavegador(): Ambiente {
  return {
    suportado: () =>
      typeof Worker !== 'undefined' &&
      typeof navigator !== 'undefined' &&
      'gpu' in navigator &&
      typeof navigator.storage?.getDirectory === 'function',
    // Trabalhador clássico: o carregador do wasm usa `importScripts`.
    criarTrabalhador: () =>
      new Worker(new URL('./trabalhador.ts', import.meta.url), { name: 'ia-local' }) as unknown as Trabalhador,
    async persistir() {
      try {
        return (await navigator.storage?.persist?.()) ?? null;
      } catch {
        return null;
      }
    },
    desatualizado: novaVersaoPronta,
    get caminhoWasm() {
      return new URL(`${import.meta.env.BASE_URL}litertlm/${__VERSAO_LITERTLM__}/`, location.href).href;
    },
  };
}

/** A IA do app. */
export const ia: IALocal = criarIA();
