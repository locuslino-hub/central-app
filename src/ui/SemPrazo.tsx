// Sem prazo (spec, seção 7): as tarefas sem data. Dali o dono conclui ou escolhe
// Hoje, Esta semana ou um dia. "Esta semana" deixa a tarefa na semana, sem dia fixo.
import { useEffect, useRef, useState } from 'preact/hooks';
import { moverParaDia, moverParaHoje, moverParaSemana } from '../dados/tarefas';
import type { Tarefa } from '../dados/tipos';
import { useDia, useSalas, useTarefas } from './hooks';
import { LinhaDeTarefa, useConclusoes } from './LinhaDeTarefa';
import { estaSemPrazo, porOrdem } from './tarefas-lista';
import './tarefas.css';

type AcoesProps = {
  tarefa: Tarefa;
  hoje: string;
  /** Avisa a lista antes de a tarefa sair dela, para o foco ir para a vizinha. */
  aoMover: () => void;
};

/** Hoje, Esta semana e Escolher dia, de uma tarefa. */
function Acoes({ tarefa, hoje, aoMover }: AcoesProps) {
  const [escolhendo, setEscolhendo] = useState(false);
  const [dia, setDia] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const campo = useRef<HTMLInputElement>(null);
  const botaoEscolher = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (escolhendo) campo.current?.focus();
  }, [escolhendo]);

  async function mover(fazer: () => Promise<boolean>) {
    setErro(null);
    aoMover();
    try {
      await fazer();
    } catch (falha) {
      console.error('Não consegui mover a tarefa', falha);
      setErro('Não consegui salvar. Tente de novo.');
    }
  }

  const fechar = () => {
    setEscolhendo(false);
    setDia('');
    setErro(null);
    botaoEscolher.current?.focus();
  };

  function definir(evento: Event) {
    evento.preventDefault();
    if (!dia) return setErro('Escolha um dia.');
    if (dia < hoje) return setErro('Esse dia já passou. Escolha hoje ou depois.');
    void mover(async () => {
      const gravou = await moverParaDia(tarefa.id, dia);
      if (!gravou) setErro('Esse dia não existe. Escolha outro.');
      return gravou;
    });
  }

  return (
    <>
      <div class="semprazo-acoes" role="group" aria-label={`Quando fazer: ${tarefa.titulo}`}>
        <button type="button" class="botao" onClick={() => void mover(() => moverParaHoje(tarefa.id, hoje))}>
          Hoje
        </button>
        <button type="button" class="botao" onClick={() => void mover(() => moverParaSemana(tarefa.id, hoje))}>
          Esta semana
        </button>
        <button
          type="button"
          class="botao"
          ref={botaoEscolher}
          aria-expanded={escolhendo}
          onClick={() => (escolhendo ? fechar() : setEscolhendo(true))}
        >
          Escolher dia
        </button>
      </div>
      {escolhendo && (
        <form class="semprazo-dia" noValidate onSubmit={definir} onKeyDown={(e) => e.key === 'Escape' && fechar()}>
          <label class="semprazo-dia-rotulo" for={`dia-${tarefa.id}`}>{`Dia para ${tarefa.titulo}`}</label>
          <div class="semprazo-dia-campos">
            <input
              id={`dia-${tarefa.id}`}
              ref={campo}
              class="campo"
              type="date"
              min={hoje}
              value={dia}
              aria-invalid={erro ? true : undefined}
              onInput={(e) => {
                setDia((e.target as HTMLInputElement).value);
                setErro(null);
              }}
            />
            <button type="submit" class="botao primario">
              Definir dia
            </button>
            <button type="button" class="botao" onClick={fechar}>
              Cancelar
            </button>
          </div>
        </form>
      )}
      {erro && (
        <p class="tarefa-erro" role="alert">
          {erro}
        </p>
      )}
    </>
  );
}

/** `semCabecalho`: na página própria o título da página já diz "Sem prazo". */
export function SemPrazo({ semCabecalho = false }: { semCabecalho?: boolean }) {
  const hoje = useDia();
  const tarefas = useTarefas();
  const salas = useSalas();
  const conclusoes = useConclusoes();
  const titulo = useRef<HTMLHeadingElement>(null);
  const lista = useRef<HTMLUListElement>(null);
  /** Para onde o foco vai quando a tarefa mexida sai da lista: a vizinha, ou o título. */
  const focoDepois = useRef<{ saiu: string; vizinha: string | null } | null>(null);

  const linhas = (tarefas ?? [])
    .filter((t) => estaSemPrazo(t, hoje) && (!t.feito || conclusoes.concluidasAgora.has(t.id)))
    .sort(porOrdem);

  useEffect(() => {
    const pedido = focoDepois.current;
    if (!pedido || linhas.some((t) => t.id === pedido.saiu)) return;
    focoDepois.current = null;
    const linha = Array.from(lista.current?.querySelectorAll<HTMLElement>('[data-id]') ?? []).find(
      (el) => el.dataset.id === pedido.vizinha,
    );
    (linha?.querySelector<HTMLElement>('.tarefa-caixa') ?? titulo.current)?.focus();
  });

  const lembrarVizinha = (id: string) => {
    const i = linhas.findIndex((t) => t.id === id);
    focoDepois.current = { saiu: id, vizinha: (linhas[i + 1] ?? linhas[i - 1])?.id ?? null };
  };

  return (
    <section
      class="painel semprazo"
      aria-labelledby={semCabecalho ? undefined : 'titulo-sem-prazo'}
      aria-label={semCabecalho ? 'Tarefas sem prazo' : undefined}
      aria-busy={tarefas === undefined}
    >
      {!semCabecalho && (
        <h2 id="titulo-sem-prazo" ref={titulo} tabIndex={-1}>
          Sem prazo
        </h2>
      )}
      {tarefas !== undefined && linhas.length === 0 && (
        <div>
          <p class="lista-vazia-titulo">Nada sem prazo.</p>
          <p class="lista-vazia-texto">O que você anotar sem dia aparece aqui.</p>
        </div>
      )}
      {linhas.length > 0 && (
        <ul class="tarefas" ref={lista}>
          {linhas.map((tarefa) => (
            <LinhaDeTarefa key={tarefa.id} tarefa={tarefa} salas={salas} hoje={hoje} conclusoes={conclusoes}>
              {!tarefa.feito && <Acoes tarefa={tarefa} hoje={hoje} aoMover={() => lembrarVizinha(tarefa.id)} />}
            </LinhaDeTarefa>
          ))}
        </ul>
      )}
    </section>
  );
}
