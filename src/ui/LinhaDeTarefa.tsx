// A linha de uma tarefa, igual na Checklist, em Sem prazo e em Atividades:
// caixa de concluir (com Desfazer), título, sala, quando, duração e Editar
// (título, sala, quando e Apagar, também com Desfazer).
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { segundaDaSemana } from '../chat/datas';
import type { Desfazivel } from '../dados/desfazer';
import type { SituacaoDaAgenda } from '../dados/compromisso';
import { colocarNaAgenda, type Marcacao } from '../dados/marcar';
import { apagarTarefa, concluirTarefa, darCiencia, editarTarefa, reabrirTarefa, type Edicao } from '../dados/tarefas';
import type { Sala, Tarefa } from '../dados/tipos';
import { CaixaMarcar } from './CaixaMarcar';
import { DuracaoTarefa } from './DuracaoTarefa';
import { corDaSala } from './Menu';
import { diaMes, nomeDaSemana } from './quando';
import { estaAtrasada, quandoNaLista } from './tarefas-lista';
import './tarefas.css';

type Apagada = { titulo: string; entrada: Desfazivel };

export type Conclusoes = {
  /** Tarefas concluídas nesta página: a linha fica, com Desfazer, até o dono sair daqui. */
  concluidasAgora: ReadonlySet<string>;
  /** A última tarefa apagada nesta página, para o Desfazer (a linha já não existe). */
  apagada: Apagada | null;
  temDesfazer(id: string): boolean;
  alternar(tarefa: Tarefa): Promise<void>;
  /** Tarefa de marcar: cria o compromisso no Google Agenda e conclui (Desfazer remove os dois). */
  colocarNaAgenda(tarefa: Tarefa, marcacao: Marcacao): Promise<SituacaoDaAgenda>;
  desfazer(id: string): Promise<void>;
  apagar(tarefa: Tarefa): Promise<void>;
  desfazerApagada(): Promise<void>;
};

/**
 * Concluir, apagar e desfazer, para uma página. O Desfazer é o da pilha do app
 * (`dados/desfazer`), o mesmo do cartão do chat: cada ação guarda a sua
 * entrada, e desfazer refaz aquela tarefa, não "a última coisa feita".
 */
export function useConclusoes(): Conclusoes {
  const entradas = useRef(new Map<string, Desfazivel>());
  const [concluidasAgora, setConcluidas] = useState<ReadonlySet<string>>(new Set());
  const [apagada, setApagada] = useState<Apagada | null>(null);
  const [, redesenhar] = useState(0);
  const atualizar = () => redesenhar((n) => n + 1);

  return {
    concluidasAgora,
    apagada,
    temDesfazer: (id) => entradas.current.has(id),
    async alternar(tarefa) {
      if (tarefa.feito) {
        const entrada = entradas.current.get(tarefa.id);
        entradas.current.delete(tarefa.id);
        try {
          await (entrada ? entrada.reverter() : reabrirTarefa(tarefa.id));
        } catch (erro) {
          // Não desfez: a entrada volta, e Desfazer segue valendo para tentar de novo.
          if (entrada) entradas.current.set(tarefa.id, entrada);
          atualizar();
          throw erro;
        }
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
    async colocarNaAgenda(tarefa, marcacao) {
      setConcluidas((antes) => new Set(antes).add(tarefa.id));
      try {
        const { entrada, agenda } = await colocarNaAgenda(tarefa, marcacao);
        if (entrada) {
          entradas.current.set(tarefa.id, entrada);
          atualizar();
        }
        return agenda;
      } catch (erro) {
        setConcluidas((antes) => {
          const depois = new Set(antes);
          depois.delete(tarefa.id);
          return depois;
        });
        throw erro;
      }
    },
    async desfazer(id) {
      const entrada = entradas.current.get(id);
      if (!entrada) return;
      entradas.current.delete(id);
      atualizar();
      try {
        await entrada.reverter();
      } catch (erro) {
        // Não desfez: a entrada volta, e Desfazer segue valendo para tentar de novo.
        entradas.current.set(id, entrada);
        atualizar();
        throw erro;
      }
    },
    async apagar(tarefa) {
      const entrada = await apagarTarefa(tarefa.id);
      if (entrada) setApagada({ titulo: tarefa.titulo, entrada });
    },
    async desfazerApagada() {
      const atual = apagada;
      if (!atual) return;
      setApagada(null);
      await atual.entrada.reverter();
    },
  };
}

/** "Tarefa apagada: X" com Desfazer. O foco vem para o Desfazer: o botão em que o dono tocou já não existe. */
export function AvisoDeApagada({ conclusoes }: { conclusoes: Conclusoes }) {
  const botao = useRef<HTMLButtonElement>(null);
  const { apagada } = conclusoes;
  const [falha, setFalha] = useState(false);
  useEffect(() => {
    if (apagada) botao.current?.focus();
  }, [apagada]);
  if (!apagada) return null;
  return (
    <div class="tarefa-apagada" role="status">
      <span>{`Tarefa apagada: ${apagada.titulo}`}</span>
      <button
        type="button"
        class="tarefa-desfazer"
        ref={botao}
        onClick={() => {
          setFalha(false);
          conclusoes.desfazerApagada().catch((erro: unknown) => {
            console.error('Não consegui desfazer', erro);
            setFalha(true);
          });
        }}
      >
        Desfazer
      </button>
      {falha && <span class="tarefa-erro">Não consegui desfazer. Tente de novo.</span>}
    </div>
  );
}

// ---- Edição ----

type ValorDoQuando = 'manter' | 'sem-prazo' | 'hoje' | 'semana' | 'dia';

/** Onde a tarefa está, como as listas a mostram (data passada já conta como hoje; semana que acabou, como Sem prazo). */
function quandoAtual(tarefa: Tarefa, hoje: string): { valor: ValorDoQuando; dia: string } {
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(tarefa.data ?? '') ? (tarefa.data as string) : '';
  if (dia) return dia <= hoje ? { valor: 'hoje', dia: '' } : { valor: 'dia', dia };
  const semana = /^\d{4}-\d{2}-\d{2}$/.test(tarefa.semana ?? '') ? (tarefa.semana as string) : '';
  if (semana && semana >= segundaDaSemana(hoje)) {
    return { valor: semana === segundaDaSemana(hoje) ? 'semana' : 'manter', dia: '' };
  }
  return { valor: 'sem-prazo', dia: '' };
}

type EdicaoProps = {
  tarefa: Tarefa;
  salas: readonly Sala[];
  hoje: string;
  /** `false`: a tarefa não existe mais (apagada em outro aparelho). */
  aoSalvar: (edicao: Edicao) => Promise<boolean>;
  aoApagar: () => Promise<void>;
  aoFechar: () => void;
};

function EdicaoDeTarefa({ tarefa, salas, hoje, aoSalvar, aoApagar, aoFechar }: EdicaoProps) {
  const inicial = quandoAtual(tarefa, hoje);
  const [titulo, setTitulo] = useState(tarefa.titulo);
  const [salaId, setSalaId] = useState(tarefa.salaId ?? '');
  const [quando, setQuando] = useState<ValorDoQuando>(inicial.valor);
  const [dia, setDia] = useState(inicial.dia);
  const [erro, setErro] = useState<string | null>(null);
  const campoTitulo = useRef<HTMLInputElement>(null);
  const campoDia = useRef<HTMLInputElement>(null);
  const emAndamento = useRef(false);
  const idBase = `edicao-${tarefa.id}`;
  // Compromisso e prazo têm hora: o dia fica com eles.
  const temQuando = !tarefa.inicio && !tarefa.prazoHora;

  useEffect(() => {
    campoTitulo.current?.focus();
  }, []);
  useEffect(() => {
    if (quando === 'dia' && !dia) campoDia.current?.focus();
  }, [quando]);

  async function salvar(evento: Event) {
    evento.preventDefault();
    if (emAndamento.current) return;
    if (!titulo.trim()) {
      setErro('Escreva o título.');
      return campoTitulo.current?.focus();
    }
    const edicao: Edicao = {};
    // Só o que mudou: o título não é regravado por cima de uma edição feita em outro aparelho.
    if (titulo.trim() !== tarefa.titulo.trim()) edicao.titulo = titulo;
    if (salaId !== (tarefa.salaId ?? '')) edicao.salaId = salaId === '' ? null : salaId;
    if (temQuando && (quando !== inicial.valor || (quando === 'dia' && dia !== inicial.dia))) {
      if (quando === 'dia') {
        if (!dia) {
          setErro('Escolha um dia.');
          return campoDia.current?.focus();
        }
        if (dia < hoje) {
          setErro('Esse dia já passou. Escolha hoje ou depois.');
          return campoDia.current?.focus();
        }
        edicao.quando = { tipo: 'dia', dia };
      } else if (quando === 'hoje') edicao.quando = { tipo: 'hoje', hoje };
      else if (quando === 'semana') edicao.quando = { tipo: 'semana', hoje };
      else if (quando === 'sem-prazo') edicao.quando = { tipo: 'sem-prazo' };
    }
    if (Object.keys(edicao).length === 0) return aoFechar(); // nada mudou: nada a gravar
    emAndamento.current = true;
    setErro(null);
    try {
      if (!(await aoSalvar(edicao))) setErro('Esta tarefa não existe mais.');
    } catch (falha) {
      console.error('Não consegui salvar a tarefa', falha);
      setErro('Não consegui salvar. Tente de novo.');
    } finally {
      emAndamento.current = false;
    }
  }

  async function apagar() {
    if (emAndamento.current) return;
    emAndamento.current = true;
    try {
      await aoApagar();
    } catch (falha) {
      console.error('Não consegui apagar a tarefa', falha);
      setErro('Não consegui apagar. Tente de novo.');
    } finally {
      emAndamento.current = false;
    }
  }

  return (
    <form
      class="tarefa-edicao"
      noValidate
      onSubmit={salvar}
      onKeyDown={(evento) => {
        if (evento.key === 'Escape') {
          evento.stopPropagation();
          aoFechar();
        }
      }}
    >
      <div class="formulario-campo">
        <label for={`${idBase}-titulo`}>Título</label>
        <input
          id={`${idBase}-titulo`}
          ref={campoTitulo}
          class="campo"
          value={titulo}
          aria-invalid={erro === 'Escreva o título.' ? true : undefined}
          onInput={(e) => {
            setTitulo((e.target as HTMLInputElement).value);
            setErro(null);
          }}
        />
      </div>
      <div class="formulario-campo">
        <label for={`${idBase}-sala`}>Sala</label>
        <select
          id={`${idBase}-sala`}
          class="campo"
          value={salaId}
          onChange={(e) => setSalaId((e.target as HTMLSelectElement).value)}
        >
          <option value="">Sem sala</option>
          {salas.map((sala) => (
            <option key={sala.id} value={sala.id}>
              {sala.nome}
            </option>
          ))}
        </select>
      </div>
      {temQuando && (
        <div class="formulario-campo">
          <label for={`${idBase}-quando`}>Quando</label>
          <select
            id={`${idBase}-quando`}
            class="campo"
            value={quando}
            onChange={(e) => {
              setQuando((e.target as HTMLSelectElement).value as ValorDoQuando);
              setErro(null);
            }}
          >
            {inicial.valor === 'manter' && (
              <option value="manter">{nomeDaSemana(tarefa.semana as string, hoje)}</option>
            )}
            <option value="sem-prazo">Sem prazo</option>
            <option value="hoje">Hoje</option>
            <option value="semana">Esta semana</option>
            <option value="dia">Outro dia</option>
          </select>
        </div>
      )}
      {temQuando && quando === 'dia' && (
        <div class="formulario-campo">
          <label for={`${idBase}-dia`}>Dia</label>
          <input
            id={`${idBase}-dia`}
            ref={campoDia}
            class="campo"
            type="date"
            min={hoje}
            value={dia}
            aria-invalid={erro && erro !== 'Escreva o título.' && erro.includes('dia') ? true : undefined}
            onInput={(e) => {
              setDia((e.target as HTMLInputElement).value);
              setErro(null);
            }}
          />
        </div>
      )}
      {erro && (
        <p class="tarefa-erro" role="alert">
          {erro}
        </p>
      )}
      <div class="tarefa-edicao-acoes">
        <button type="submit" class="botao primario">
          Salvar
        </button>
        <button type="button" class="botao" onClick={aoFechar}>
          Cancelar
        </button>
        <button type="button" class="botao tarefa-apagar" onClick={() => void apagar()}>
          Apagar
        </button>
      </div>
    </form>
  );
}

// ---- A linha ----

type Props = {
  tarefa: Tarefa;
  salas: readonly Sala[];
  hoje: string;
  conclusoes: Conclusoes;
  /**
   * A lista chama isto antes de uma edição ou exclusão que pode tirar a linha da
   * página e devolve o que confirma o pedido de foco (só depois de gravar com sucesso).
   */
  prepararFoco?: (id: string) => () => void;
  /** Ações próprias da página (Sem prazo põe Hoje, Esta semana e Escolher dia aqui). */
  children?: ComponentChildren;
};

export function LinhaDeTarefa({ tarefa, salas, hoje, conclusoes, prepararFoco, children }: Props) {
  const caixa = useRef<HTMLButtonElement>(null);
  const botaoEditar = useRef<HTMLButtonElement>(null);
  const [falha, setFalha] = useState(false);
  const [editando, setEditando] = useState(false);
  const [marcando, setMarcando] = useState(false);
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

  // Fecha a caixa de marcar e devolve o foco à caixa de concluir (a caixa de marcar sai da tela).
  const fecharMarcar = () => {
    setMarcando(false);
    caixa.current?.focus();
  };

  const fecharEdicao = () => {
    setEditando(false);
    botaoEditar.current?.focus();
  };

  return (
    <li class="tarefa" data-feita={tarefa.feito} data-id={tarefa.id}>
      <button
        type="button"
        class="tarefa-caixa"
        role="checkbox"
        aria-checked={tarefa.feito}
        aria-label={String(tarefa.titulo ?? '')}
        ref={caixa}
        onClick={() => {
          // Tarefa de marcar: concluir pergunta antes quando fica marcado.
          if (!tarefa.feito && tarefa.marcar) setMarcando(true);
          else void executar(() => conclusoes.alternar(tarefa));
        }}
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
          <button
            type="button"
            class="tarefa-editar"
            ref={botaoEditar}
            aria-expanded={editando}
            aria-label={`Editar: ${tarefa.titulo}`}
            onClick={() => (editando ? fecharEdicao() : setEditando(true))}
          >
            Editar
          </button>
        </div>
        {tarefa.semanaVencida && (
          <p class="tarefa-aviso">
            <span>Saiu de Esta semana: a semana de {diaMes(tarefa.semanaVencida, hoje)} acabou.</span>
            <button
              type="button"
              class="tarefa-entendi"
              aria-label={`Entendi: ${tarefa.titulo}`}
              onClick={() => void executar(async () => void (await darCiencia(tarefa.id)))}
            >
              Entendi
            </button>
          </p>
        )}
        {editando && (
          <EdicaoDeTarefa
            tarefa={tarefa}
            salas={salas}
            hoje={hoje}
            aoFechar={fecharEdicao}
            aoSalvar={async (edicao) => {
              const confirmar = prepararFoco?.(tarefa.id);
              const gravou = await editarTarefa(tarefa.id, edicao);
              if (!gravou) return false; // o formulário fica aberto, com o aviso
              confirmar?.();
              fecharEdicao();
              return true;
            }}
            aoApagar={() => conclusoes.apagar(tarefa)}
          />
        )}
        {marcando && (
          <CaixaMarcar
            tarefaId={tarefa.id}
            titulo={tarefa.titulo}
            dia={tarefa.data}
            hoje={hoje}
            aoColocar={(marcacao) => conclusoes.colocarNaAgenda(tarefa, marcacao)}
            aoConcluirSemAgenda={() => conclusoes.alternar(tarefa)}
            aoFechar={fecharMarcar}
          />
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
