// A linha de uma tarefa, igual na Checklist, em Sem prazo e em Atividades:
// caixa de concluir (com Desfazer), título, sala, quando e duração.
import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';
import type { Desfazivel } from '../dados/desfazer';
import { concluirTarefa, darCiencia, reabrirTarefa } from '../dados/tarefas';
import type { Sala, Tarefa } from '../dados/tipos';
import { DuracaoTarefa } from './DuracaoTarefa';
import { corDaSala } from './Menu';
import { diaMes } from './quando';
import { estaAtrasada, quandoNaLista } from './tarefas-lista';
import './tarefas.css';

export type Conclusoes = {
  /** Tarefas concluídas nesta página: a linha fica, com Desfazer, até o dono sair daqui. */
  concluidasAgora: ReadonlySet<string>;
  temDesfazer(id: string): boolean;
  alternar(tarefa: Tarefa): Promise<void>;
  desfazer(id: string): Promise<void>;
};

/**
 * Concluir e desfazer, para uma página. O Desfazer é o da pilha do app
 * (`dados/desfazer`), o mesmo do cartão do chat: cada conclusão guarda a sua
 * entrada, e desfazer reabre aquela tarefa, não "a última coisa feita".
 */
export function useConclusoes(): Conclusoes {
  const entradas = useRef(new Map<string, Desfazivel>());
  const [concluidasAgora, setConcluidas] = useState<ReadonlySet<string>>(new Set());
  const [, redesenhar] = useState(0);
  const atualizar = () => redesenhar((n) => n + 1);

  return {
    concluidasAgora,
    temDesfazer: (id) => entradas.current.has(id),
    async alternar(tarefa) {
      if (tarefa.feito) {
        const entrada = entradas.current.get(tarefa.id);
        entradas.current.delete(tarefa.id);
        await (entrada ? entrada.reverter() : reabrirTarefa(tarefa.id));
        atualizar();
        return;
      }
      // Marca já, antes de gravar: a lista se refaz quando a loja avisa, e a linha não pode sumir nesse instante.
      setConcluidas((antes) => new Set(antes).add(tarefa.id));
      const entrada = await concluirTarefa(tarefa.id);
      if (entrada) {
        entradas.current.set(tarefa.id, entrada);
        atualizar();
      }
    },
    async desfazer(id) {
      const entrada = entradas.current.get(id);
      if (!entrada) return;
      entradas.current.delete(id);
      atualizar();
      await entrada.reverter();
    },
  };
}

type Props = {
  tarefa: Tarefa;
  salas: readonly Sala[];
  hoje: string;
  conclusoes: Conclusoes;
  /** Ações próprias da página (Sem prazo põe Hoje, Esta semana e Escolher dia aqui). */
  children?: ComponentChildren;
};

export function LinhaDeTarefa({ tarefa, salas, hoje, conclusoes, children }: Props) {
  const caixa = useRef<HTMLButtonElement>(null);
  const [falha, setFalha] = useState(false);
  const sala = tarefa.salaId === null ? undefined : salas.find((s) => s.id === tarefa.salaId);
  const quando = quandoNaLista(tarefa, hoje);
  const atrasada = estaAtrasada(tarefa, hoje);

  // Falha de gravação: o dono sabe, e o foco não se perde.
  async function executar(acao: () => Promise<void>) {
    setFalha(false);
    try {
      await acao();
    } catch (erro) {
      console.error('Não consegui salvar a tarefa', erro);
      setFalha(true);
    }
    caixa.current?.focus();
  }

  return (
    <li class="tarefa" data-feita={tarefa.feito} data-id={tarefa.id}>
      <button
        type="button"
        class="tarefa-caixa"
        role="checkbox"
        aria-checked={tarefa.feito}
        aria-label={String(tarefa.titulo ?? '')}
        ref={caixa}
        onClick={() => void executar(() => conclusoes.alternar(tarefa))}
      >
        <span class="tarefa-marca" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" focusable="false">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        </span>
      </button>
      <div class="tarefa-corpo">
        <p class="tarefa-titulo">{String(tarefa.titulo ?? '')}</p>
        <div class="tarefa-meta">
          <span class={`etiqueta ${corDaSala(tarefa.salaId ?? '')}`}>{sala ? sala.nome : 'Sem sala'}</span>
          {atrasada && <span class="etiqueta etiqueta-atrasada">Atrasada</span>}
          {quando && <span class="tarefa-quando">{quando}</span>}
          <DuracaoTarefa tarefa={tarefa} />
          {tarefa.feito && conclusoes.temDesfazer(tarefa.id) && (
            <button
              type="button"
              class="tarefa-desfazer"
              aria-label={`Desfazer: ${tarefa.titulo}`}
              onClick={() => void executar(() => conclusoes.desfazer(tarefa.id))}
            >
              Desfazer
            </button>
          )}
        </div>
        {tarefa.semanaVencida && (
          <p class="tarefa-aviso">
            <span>Saiu de Esta semana: a semana de {diaMes(tarefa.semanaVencida, hoje)} acabou.</span>
            <button
              type="button"
              class="tarefa-entendi"
              onClick={() => void executar(async () => void (await darCiencia(tarefa.id)))}
            >
              Entendi
            </button>
          </p>
        )}
        {falha && (
          <p class="tarefa-erro" role="alert">
            Não consegui salvar. Tente de novo.
          </p>
        )}
        {children}
      </div>
    </li>
  );
}
