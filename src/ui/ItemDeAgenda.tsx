// Uma linha de agenda: evento (botão que abre os detalhes) ou tarefa (só texto).
// O que passou, o que é livre e o que está feito diz isso em palavras: a cor só reforça.
// Com `aoMarcarFeito` (Agenda de hoje), o evento ganha a caixa de feito, igual à das tarefas.
import { descreverHorario, formatarMinutos, type Item, type ItemDeEvento } from '../dados/calendario';
import type { Sala } from '../dados/tipos';
import { corDaSala } from './Menu';
import type { Adivinhar } from './useAdivinharSala';

type Props = {
  item: Item;
  salas: Sala[];
  aoAbrir: (item: ItemDeEvento, botao: HTMLElement) => void;
  /** Compromisso sem sala (veio do Google): a sala adivinhada pelo título. */
  adivinhar?: Adivinhar;
  /** Marcar ou desmarcar o compromisso como feito. Sem isto, não há caixa. */
  aoMarcarFeito?: (item: ItemDeEvento, feito: boolean) => void;
};

/** A caixa redonda de feito, a mesma das tarefas (tarefas.css). */
export function CaixaDeFeito({ feito, rotulo, aoTocar }: { feito: boolean; rotulo: string; aoTocar: () => void }) {
  return (
    <button type="button" class="tarefa-caixa cal-caixa" role="checkbox" aria-checked={feito} aria-label={rotulo} onClick={aoTocar}>
      <span class="tarefa-marca" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" focusable="false">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </span>
    </button>
  );
}

/** A sala do item: a gravada; num compromisso sem sala, a adivinhada pelo título. */
export function salaDoItem(item: Item, adivinhar?: Adivinhar): string | null {
  if (item.tipo !== 'evento') return item.tarefa.salaId;
  return item.evento.salaId ?? adivinhar?.(item.evento.titulo) ?? null;
}

export function ItemDeAgenda({ item, salas, aoAbrir, adivinhar, aoMarcarFeito }: Props) {
  const salaId = salaDoItem(item, adivinhar);
  const sala = salaId === null ? undefined : salas.find((s) => s.id === salaId);
  const cor = salaId === null ? 'sala-outra' : corDaSala(salaId);
  const etiqueta = sala && <span class={`etiqueta ${cor}`}>{sala.nome}</span>;

  if (item.tipo === 'evento') {
    const { evento } = item;
    // "09:00 às 10:00": a hora grande já diz o começo; nas colunas estreitas da semana este texto só fica para o leitor de tela.
    const simples = !item.diaInteiro && !item.continuaAntes && !item.continuaDepois;
    const feito = evento.feito === true;
    const titulo = evento.titulo === '' ? '(sem título)' : evento.titulo;
    return (
      <li
        class={`cal-item cal-evento ${cor}${aoMarcarFeito ? ' cal-com-caixa' : ''}`}
        data-tipo="evento"
        data-passado={String(item.passado)}
        data-livre={String(evento.livre)}
        data-feito={String(feito)}
      >
        {aoMarcarFeito && <CaixaDeFeito feito={feito} rotulo={titulo} aoTocar={() => aoMarcarFeito(item, !feito)} />}
        <button type="button" class="cal-botao" aria-haspopup="dialog" onClick={(e) => aoAbrir(item, e.currentTarget)}>
          {!item.diaInteiro && (
            <span class="cal-hora" aria-hidden="true">
              {formatarMinutos(item.ini)}
            </span>
          )}
          <span class="cal-corpo">
            <span class="cal-titulo">{titulo}</span>
            <span class="cal-meta">
              <span class={simples ? 'cal-quando cal-quando-simples' : 'cal-quando'}>{descreverHorario(item)}</span>
              {etiqueta}
              {evento.livre && <span class="cal-nota">livre</span>}
              {feito && <span class="cal-nota">feito</span>}
              {item.passado && !feito && <span class="cal-nota">passado</span>}
            </span>
          </span>
        </button>
      </li>
    );
  }

  const { tarefa } = item;
  return (
    <li
      class={`cal-item cal-tarefa ${cor}`}
      data-tipo={item.tipo}
      data-passado={String(item.passado)}
      data-feita={String(tarefa.feito)}
    >
      <span class="cal-hora" aria-hidden="true">
        {item.tipo === 'tarefa' ? '' : formatarMinutos(item.ini)}
      </span>
      <span class="cal-corpo">
        <span class="cal-titulo">{tarefa.titulo}</span>
        <span class="cal-meta">
          {item.tipo === 'prazo' && <span>{`Prazo às ${formatarMinutos(item.ini)}`}</span>}
          {item.tipo === 'bloco' && (
            <span class="cal-quando cal-quando-simples">{`${formatarMinutos(item.ini)} às ${formatarMinutos(item.fim)}`}</span>
          )}
          {item.tipo !== 'prazo' && <span class="cal-nota">{item.tipo === 'bloco' ? 'tarefa' : 'Tarefa'}</span>}
          {etiqueta}
          {tarefa.feito && <span class="cal-nota">feita</span>}
          {item.passado && !tarefa.feito && <span class="cal-nota">passado</span>}
        </span>
      </span>
    </li>
  );
}
