// Agenda de hoje (spec, seção 7, item 4): compromissos do Google Agenda e tarefas
// com hora, num só lugar. Só leitura: clicar num evento mostra os detalhes.
import { useMemo } from 'preact/hooks';
import { montarCalendario } from '../dados/calendario';
import { AvisoDaAgenda } from './AvisoDaAgenda';
import { useDetalheDoEvento } from './DetalheEvento';
import { useAgora, useDia, useSalas, useTarefas } from './hooks';
import { ItemDeAgenda } from './ItemDeAgenda';
import { useEventos } from './useEventos';
import './calendario.css';

export function AgendaHoje() {
  const hoje = useDia();
  const agora = useAgora();
  const salas = useSalas();
  const tarefas = useTarefas();
  const { leitura, atualizar } = useEventos(hoje, hoje);
  const { abrir, detalhe } = useDetalheDoEvento(salas, hoje);

  const dia = useMemo(
    () => montarCalendario({ eventos: leitura.eventos, tarefas: tarefas ?? [], de: hoje, ate: hoje, agora }).dia(hoje),
    [leitura.eventos, tarefas, hoje, agora],
  );
  const itens = [...dia.diaInteiro, ...dia.horarios];
  const lido = leitura.lidoEm !== null && tarefas !== undefined;

  return (
    <section class="painel agenda-hoje" aria-labelledby="titulo-agenda-hoje" aria-busy={!lido && leitura.falha === null}>
      <h2 id="titulo-agenda-hoje">Agenda de hoje</h2>
      <AvisoDaAgenda leitura={leitura} aoTentar={atualizar} />
      {lido && itens.length === 0 && (
        <div>
          <p class="lista-vazia-titulo">Nada marcado para hoje.</p>
          <p class="lista-vazia-texto">Os compromissos do Google Agenda e as tarefas com hora aparecem aqui.</p>
        </div>
      )}
      {itens.length > 0 && (
        <ul class="cal-lista">
          {itens.map((item) => (
            <ItemDeAgenda key={item.chave} item={item} salas={salas} aoAbrir={abrir} />
          ))}
        </ul>
      )}
      {detalhe}
    </section>
  );
}
