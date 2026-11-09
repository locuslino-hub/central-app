// Agenda de hoje (spec, seção 7, item 4): compromissos do Google Agenda e tarefas
// com hora (prazo, compromisso antigo), num só lugar. A tarefa só com dia não
// entra: ela já está na Checklist ao lado. Clicar num evento mostra os detalhes;
// a caixa ao lado marca o compromisso como feito (feito espelhado: fica na
// Central e, nos compromissos do dono, vira "✓ " no Google). No celular, depois
// de 3 itens, o resto fica em "Ver tudo".
import { useMemo, useState } from 'preact/hooks';
import { montarCalendario, type ItemDeEvento } from '../dados/calendario';
import { marcarCompromissoFeito } from '../dados/eventos-feitos';
import { AvisoDaAgenda } from './AvisoDaAgenda';
import { useDetalheDoEvento } from './DetalheEvento';
import { useAgora, useDia, useSalas, useTarefas } from './hooks';
import { ItemDeAgenda } from './ItemDeAgenda';
import { useAdivinharSala } from './useAdivinharSala';
import { useComFeito, useEventos } from './useEventos';
import { useVerTudo } from './VerTudo';
import './calendario.css';
import './tarefas.css';

export function AgendaHoje() {
  const hoje = useDia();
  const agora = useAgora();
  const salas = useSalas();
  const adivinhar = useAdivinharSala();
  const tarefas = useTarefas();
  const { leitura, atualizar } = useEventos(hoje, hoje);
  const { abrir, detalhe } = useDetalheDoEvento(salas, hoje);
  const eventos = useComFeito(leitura.eventos);
  const [falhou, setFalhou] = useState(false);

  const dia = useMemo(
    () => montarCalendario({ eventos, tarefas: tarefas ?? [], de: hoje, ate: hoje, agora }).dia(hoje),
    [eventos, tarefas, hoje, agora],
  );
  const marcar = (item: ItemDeEvento, feito: boolean) => {
    setFalhou(false);
    marcarCompromissoFeito(item.evento, feito, hoje).catch((erro: unknown) => {
      console.error('Não consegui marcar o compromisso', erro);
      setFalhou(true);
    });
  };
  const itens = [...dia.diaInteiro, ...dia.horarios].filter((item) => item.tipo !== 'tarefa');
  const { mostrar, botao } = useVerTudo(itens.length);
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
          {itens.slice(0, mostrar).map((item) => (
            <ItemDeAgenda
              key={item.chave}
              item={item}
              salas={salas}
              aoAbrir={abrir}
              adivinhar={adivinhar}
              aoMarcarFeito={item.tipo === 'evento' ? marcar : undefined}
            />
          ))}
        </ul>
      )}
      {falhou && <p class="tarefa-erro">Não consegui marcar. Tente de novo.</p>}
      {botao}
      {detalhe}
    </section>
  );
}
