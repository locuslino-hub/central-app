// Uma linha de agenda: evento (botão que abre os detalhes) ou tarefa (só texto).
// O que passou, o que é livre e o que está feito diz isso em palavras: a cor só reforça.
import { descreverHorario, formatarMinutos, type Item, type ItemDeEvento } from '../dados/calendario';
import type { Sala } from '../dados/tipos';
import { corDaSala } from './Menu';

type Props = {
  item: Item;
  salas: Sala[];
  aoAbrir: (item: ItemDeEvento, botao: HTMLElement) => void;
};

export function ItemDeAgenda({ item, salas, aoAbrir }: Props) {
  const salaId = item.tipo === 'evento' ? item.evento.salaId : item.tarefa.salaId;
  const sala = salaId === null ? undefined : salas.find((s) => s.id === salaId);
  const etiqueta = sala && <span class={`etiqueta ${corDaSala(sala.id)}`}>{sala.nome}</span>;

  if (item.tipo === 'evento') {
    const { evento } = item;
    // "09:00 às 10:00": a hora grande já diz o começo; nas colunas estreitas da semana este texto só fica para o leitor de tela.
    const simples = !item.diaInteiro && !item.continuaAntes && !item.continuaDepois;
    return (
      <li
        class={`cal-item cal-evento ${sala ? corDaSala(sala.id) : 'sala-outra'}`}
        data-tipo="evento"
        data-passado={String(item.passado)}
        data-livre={String(evento.livre)}
      >
        <button type="button" class="cal-botao" aria-haspopup="dialog" onClick={(e) => aoAbrir(item, e.currentTarget)}>
          {!item.diaInteiro && (
            <span class="cal-hora" aria-hidden="true">
              {formatarMinutos(item.ini)}
            </span>
          )}
          <span class="cal-corpo">
            <span class="cal-titulo">{evento.titulo === '' ? '(sem título)' : evento.titulo}</span>
            <span class="cal-meta">
              <span class={simples ? 'cal-quando cal-quando-simples' : 'cal-quando'}>{descreverHorario(item)}</span>
              {etiqueta}
              {evento.livre && <span class="cal-nota">livre</span>}
              {item.passado && <span class="cal-nota">passado</span>}
            </span>
          </span>
        </button>
      </li>
    );
  }

  const { tarefa } = item;
  return (
    <li
      class={`cal-item cal-tarefa ${sala ? corDaSala(sala.id) : 'sala-outra'}`}
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
