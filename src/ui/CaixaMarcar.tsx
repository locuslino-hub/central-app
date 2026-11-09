// Caixa da tarefa de marcar (Tarefa 12): ao concluir "Marcar reunião com a
// Marina", pergunta Dia, Início e Fim e põe o compromisso no Google Agenda.
// Três saídas: Colocar na agenda (cria e conclui), Concluir sem agenda (só
// conclui) e Ainda não marquei (fecha, e a tarefa segue aberta). Esc fecha sem
// concluir. Diálogo acessível: foco preso, campos com rótulo, toque de 44 px.
import { useEffect, useRef, useState } from 'preact/hooks';
import { avisoDaAgenda, type SituacaoDaAgenda } from '../dados/compromisso';
import { erroDaMarcacao, fimSugerido, type Marcacao } from '../dados/marcar';
import './calendario.css';
import './tarefas.css';

const FOCAVEIS = 'input:not([disabled]), button:not([disabled])';

type Props = {
  /** Id da tarefa: faz os ids dos campos únicos quando há mais de uma caixa na página. */
  tarefaId: string;
  titulo: string;
  /** Dia que a tarefa já tinha, se tinha (`AAAA-MM-DD`). */
  dia?: string;
  /** Hoje em Lisboa, `AAAA-MM-DD`. */
  hoje: string;
  /** Cria o compromisso e conclui. Rejeita se não deu para gravar. */
  aoColocar: (marcacao: Marcacao) => Promise<SituacaoDaAgenda>;
  /** Conclui sem criar nada. Rejeita se não deu para gravar. */
  aoConcluirSemAgenda: () => Promise<void>;
  /** Fecha sem concluir (Ainda não marquei, Esc, fundo) ou depois de ler o aviso. */
  aoFechar: () => void;
};

export function CaixaMarcar({ tarefaId, titulo, dia: diaDaTarefa, hoje, aoColocar, aoConcluirSemAgenda, aoFechar }: Props) {
  const [dia, setDia] = useState(diaDaTarefa && diaDaTarefa >= hoje ? diaDaTarefa : hoje);
  const [inicio, setInicio] = useState('');
  const [fim, setFim] = useState('');
  const [erro, setErro] = useState<{ campo: keyof Marcacao | 'geral'; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  /** Depois de Colocar na agenda com a criação na fila: o aviso a ler antes de fechar. */
  const [aviso, setAviso] = useState<string | null>(null);
  // Enquanto o dono não mexe no Fim, ele acompanha o Início (uma hora depois).
  const fimMexido = useRef(false);
  const caixa = useRef<HTMLDivElement>(null);
  const campoDia = useRef<HTMLInputElement>(null);
  const campoInicio = useRef<HTMLInputElement>(null);
  const campoFim = useRef<HTMLInputElement>(null);
  const emAndamento = useRef(false);
  const botaoEntendi = useRef<HTMLButtonElement>(null);
  const id = `marcar-${tarefaId}`;

  useEffect(() => {
    caixa.current?.focus();
  }, []);

  // O aviso troca o formulário pelo botão Entendi: o foco vai para ele, não se perde.
  useEffect(() => {
    if (aviso) botaoEntendi.current?.focus();
  }, [aviso]);

  // Enquanto grava, fechar deixaria a tarefa concluída por trás de uma caixa que sumiu.
  const fechar = () => {
    if (!emAndamento.current) aoFechar();
  };

  function aoTeclar(tecla: KeyboardEvent) {
    if (tecla.key === 'Escape') {
      tecla.stopPropagation();
      fechar();
      return;
    }
    if (tecla.key !== 'Tab') return;
    const itens = [...(caixa.current?.querySelectorAll<HTMLElement>(FOCAVEIS) ?? [])];
    if (itens.length === 0) return;
    const primeiro = itens[0];
    const ultimo = itens[itens.length - 1];
    const ativo = document.activeElement;
    if (tecla.shiftKey && (ativo === primeiro || ativo === caixa.current)) {
      tecla.preventDefault();
      ultimo.focus();
    } else if (!tecla.shiftKey && ativo === ultimo) {
      tecla.preventDefault();
      primeiro.focus();
    }
  }

  function mudouInicio(novo: string) {
    setInicio(novo);
    if (!fimMexido.current) setFim(fimSugerido(novo));
    setErro(null);
  }

  /** Roda a ação sem deixar duas ao mesmo tempo; falha vira aviso na caixa. */
  async function rodar(acao: () => Promise<void>) {
    if (emAndamento.current) return;
    emAndamento.current = true;
    setOcupado(true);
    setErro(null);
    try {
      await acao();
    } catch (falha) {
      console.error('Não consegui concluir a tarefa de marcar', falha);
      setErro({ campo: 'geral', texto: 'Não consegui salvar. Tente de novo.' });
    } finally {
      emAndamento.current = false;
      setOcupado(false);
    }
  }

  function colocar(evento: Event) {
    evento.preventDefault();
    const marcacao: Marcacao = { dia, inicio, fim };
    const problema = erroDaMarcacao(marcacao, hoje);
    if (problema) {
      setErro(problema);
      const campo = problema.campo === 'dia' ? campoDia : problema.campo === 'inicio' ? campoInicio : campoFim;
      campo.current?.focus();
      return;
    }
    void rodar(async () => {
      const situacao = await aoColocar(marcacao);
      const nota = avisoDaAgenda(situacao);
      if (nota) setAviso(nota);
      else aoFechar();
    });
  }

  const concluirSemAgenda = () =>
    void rodar(async () => {
      await aoConcluirSemAgenda();
      aoFechar();
    });

  const invalido = (campo: keyof Marcacao) => (erro?.campo === campo ? true : undefined);

  return (
    <>
      <div class="detalhe-fundo" aria-hidden="true" onClick={fechar} />
      <div
        class="detalhe marcar"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-titulo`}
        aria-describedby={`${id}-tarefa`}
        tabIndex={-1}
        ref={caixa}
        onKeyDown={aoTeclar}
      >
        <h2 id={`${id}-titulo`} class="detalhe-titulo">
          Quando ficou marcado?
        </h2>
        <p id={`${id}-tarefa`} class="detalhe-nota">
          {titulo}
        </p>
        {aviso ? (
          <>
            <p class="marcar-aviso" role="status">
              Tarefa concluída. {aviso}
            </p>
            <button type="button" class="botao primario" ref={botaoEntendi} onClick={aoFechar}>
              Entendi
            </button>
          </>
        ) : (
          <form class="marcar-form" noValidate onSubmit={colocar}>
            <div class="formulario-campo">
              <label for={`${id}-dia`}>Dia</label>
              <input
                id={`${id}-dia`}
                ref={campoDia}
                class="campo"
                type="date"
                min={hoje}
                value={dia}
                aria-invalid={invalido('dia')}
                onInput={(e) => {
                  setDia((e.target as HTMLInputElement).value);
                  setErro(null);
                }}
              />
            </div>
            <div class="marcar-horas">
              <div class="formulario-campo">
                <label for={`${id}-inicio`}>Início</label>
                <input
                  id={`${id}-inicio`}
                  ref={campoInicio}
                  class="campo"
                  type="time"
                  value={inicio}
                  aria-invalid={invalido('inicio')}
                  onInput={(e) => mudouInicio((e.target as HTMLInputElement).value)}
                />
              </div>
              <div class="formulario-campo">
                <label for={`${id}-fim`}>Fim</label>
                <input
                  id={`${id}-fim`}
                  ref={campoFim}
                  class="campo"
                  type="time"
                  value={fim}
                  aria-invalid={invalido('fim')}
                  onInput={(e) => {
                    fimMexido.current = true;
                    setFim((e.target as HTMLInputElement).value);
                    setErro(null);
                  }}
                />
              </div>
            </div>
            {erro && (
              <p class="tarefa-erro" role="alert">
                {erro.texto}
              </p>
            )}
            <button type="submit" class="botao primario" disabled={ocupado}>
              Colocar na agenda
            </button>
            <button type="button" class="botao" disabled={ocupado} onClick={concluirSemAgenda}>
              Concluir sem agenda
            </button>
            <button type="button" class="botao" disabled={ocupado} onClick={aoFechar}>
              Ainda não marquei
            </button>
          </form>
        )}
      </div>
    </>
  );
}
