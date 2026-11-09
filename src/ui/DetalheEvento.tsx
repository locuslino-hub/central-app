// Detalhes de um evento do Google Agenda (só leitura): título, quando, agenda,
// sala (a resolvida: gravada, pela cor do Google ou pelo título) e um link
// para abrir no Google Agenda. Editar, mover e apagar ficam lá.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Evento } from '../dados/agenda';
import type { ItemDeEvento } from '../dados/calendario';
import type { Sala } from '../dados/tipos';
import { quandoDoEvento } from './quando';
import { useSalaDoEvento } from './useAdivinharSala';

const FOCAVEIS = 'a[href], button:not([disabled])';

/**
 * Só http e https abrem. O link vem do script, que já aceita só o do Google
 * Agenda (e a conferência de `listarEventos` repete isso); a tela confere o protocolo mesmo assim.
 */
function linkParaAbrir(link: string | null): string | null {
  if (link === null) return null;
  try {
    const { protocol } = new URL(link);
    return protocol === 'https:' || protocol === 'http:' ? link : null;
  } catch {
    return null;
  }
}

type Props = {
  evento: Evento;
  /** O evento todo já acabou. */
  passado: boolean;
  salas: Sala[];
  /** Hoje em Lisboa, `AAAA-MM-DD`. */
  hoje: string;
  aoFechar: () => void;
};

export function DetalheEvento({ evento, passado, salas, hoje, aoFechar }: Props) {
  const caixa = useRef<HTMLDivElement>(null);
  const salaDoEvento = useSalaDoEvento();
  useEffect(() => {
    caixa.current?.focus();
  }, []);

  function aoTeclar(tecla: KeyboardEvent) {
    if (tecla.key === 'Escape') {
      tecla.stopPropagation();
      aoFechar();
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

  const salaId = salaDoEvento(evento);
  const sala = salaId === null ? undefined : salas.find((s) => s.id === salaId);
  const link = linkParaAbrir(evento.link);
  const situacoes = [
    passado && 'Já passou',
    evento.livre && 'Livre: não ocupa tempo',
    evento.tarefaGoogleId !== undefined && 'Tarefa do Google Tarefas: o feito vai para lá',
  ].filter(Boolean) as string[];

  return (
    <>
      <div class="detalhe-fundo" aria-hidden="true" onClick={aoFechar} />
      <div
        class="detalhe"
        role="dialog"
        aria-modal="true"
        aria-labelledby="detalhe-titulo"
        tabIndex={-1}
        ref={caixa}
        onKeyDown={aoTeclar}
      >
        <h2 id="detalhe-titulo" class="detalhe-titulo">{evento.titulo === '' ? '(sem título)' : evento.titulo}</h2>
        <dl class="detalhe-dados">
          <dt>Quando</dt>
          <dd>{quandoDoEvento(evento, hoje)}</dd>
          <dt>Agenda</dt>
          <dd>{evento.agendaId === 'primary' ? 'Agenda principal' : 'Outra agenda'}</dd>
          <dt>Sala</dt>
          <dd>{sala?.nome ?? 'Sem sala'}</dd>
          {situacoes.length > 0 && (
            <>
              <dt>Situação</dt>
              {situacoes.map((texto) => (
                <dd key={texto}>{texto}</dd>
              ))}
            </>
          )}
        </dl>
        {link ? (
          <a class="botao primario" href={link} target="_blank" rel="noopener noreferrer">
            Abrir no Google Agenda
          </a>
        ) : (
          <p class="detalhe-nota">Este evento não tem link para o Google Agenda.</p>
        )}
        <p class="detalhe-nota">Para editar, mover ou apagar, use o Google Agenda.</p>
        <button type="button" class="botao" onClick={aoFechar}>
          Fechar
        </button>
      </div>
    </>
  );
}

/**
 * O estado dos detalhes de uma tela: `abrir` com o item e o botão clicado;
 * `detalhe` é o que a tela desenha (nada, se fechado). Ao fechar, o foco volta ao botão.
 */
export function useDetalheDoEvento(salas: Sala[], hoje: string) {
  const [aberto, setAberto] = useState<{ evento: Evento; passado: boolean } | null>(null);
  const gatilho = useRef<HTMLElement | null>(null);

  const abrir = (item: ItemDeEvento, botao: HTMLElement) => {
    gatilho.current = botao;
    setAberto({ evento: item.evento, passado: item.passado });
  };
  const fechar = () => {
    setAberto(null);
    const botao = gatilho.current;
    gatilho.current = null;
    if (botao?.isConnected) botao.focus();
    else document.querySelector<HTMLElement>('main')?.focus();
  };

  const detalhe = aberto && (
    <DetalheEvento evento={aberto.evento} passado={aberto.passado} salas={salas} hoje={hoje} aoFechar={fechar} />
  );
  return { abrir, detalhe };
}
