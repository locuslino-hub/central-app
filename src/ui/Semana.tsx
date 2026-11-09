// Esta semana: sete dias, de segunda a domingo, com os eventos do Google Agenda
// e as tarefas. Só leitura. No computador são sete colunas (ou uma lista de dias,
// se a página for estreita); no celular, um dia de cada vez.
import { useMemo, useState } from 'preact/hooks';
import { somarDias } from '../chat/datas';
import {
  diasDaSemana,
  montarCalendario,
  periodoDaSemana,
  tarefasDaSemana,
  type DiaDoCalendario,
  type Item,
  type ItemDeEvento,
} from '../dados/calendario';
import type { Sala } from '../dados/tipos';
import { AvisoDaAgenda } from './AvisoDaAgenda';
import { useDetalheDoEvento } from './DetalheEvento';
import { useAgora, useDia, useSalas, useTarefas, useTela } from './hooks';
import { ItemDeAgenda } from './ItemDeAgenda';
import { useSalaDoEvento, type SalaDoEvento } from './useAdivinharSala';
import { NavegacaoDoCalendario } from './NavegacaoDoCalendario';
import { abreviacaoDoDia, diaPorExtenso, periodoPorExtenso } from './quando';
import { useEventos } from './useEventos';
import './calendario.css';

const contagem = (total: number) => (total === 0 ? 'nada marcado' : total === 1 ? '1 item' : `${total} itens`);

type DiaProps = {
  dia: DiaDoCalendario;
  hoje: string;
  salas: Sala[];
  aoAbrir: (item: ItemDeEvento, botao: HTMLElement) => void;
  salaDoEvento: SalaDoEvento;
};

function DiaDaSemana({ dia, hoje, salas, aoAbrir, salaDoEvento }: DiaProps) {
  const eHoje = dia.data === hoje;
  const itens: Item[] = [...dia.diaInteiro, ...dia.horarios];
  const id = `dia-${dia.data}`;
  return (
    <section class="cal-dia" data-hoje={String(eHoje)} aria-labelledby={id}>
      <h2
        id={id}
        class="cal-dia-titulo"
        aria-current={eHoje ? 'date' : undefined}
        aria-label={`${diaPorExtenso(dia.data, hoje)}${eHoje ? ', hoje' : ''}`}
      >
        <span class="cal-dia-nome" aria-hidden="true">
          {abreviacaoDoDia(dia.data)}
        </span>
        <span class="cal-dia-numero" aria-hidden="true">
          {Number(dia.data.slice(8))}
        </span>
        {eHoje && (
          <span class="cal-hoje" aria-hidden="true">
            hoje
          </span>
        )}
      </h2>
      {itens.length === 0 ? (
        <p class="cal-vazio">Nada marcado.</p>
      ) : (
        <ul class="cal-lista">
          {itens.map((item) => (
            <ItemDeAgenda key={item.chave} item={item} salas={salas} aoAbrir={aoAbrir} salaDoEvento={salaDoEvento} />
          ))}
        </ul>
      )}
    </section>
  );
}

export function Semana({ data }: { data?: string }) {
  const hoje = useDia();
  const agora = useAgora();
  const tela = useTela();
  const salas = useSalas();
  const salaDoEvento = useSalaDoEvento();
  const tarefas = useTarefas();

  const base = data ?? hoje;
  const dias = diasDaSemana(base);
  const segunda = dias[0];
  const { de, ate } = periodoDaSemana(base);
  const { leitura, atualizar } = useEventos(de, ate);
  const { abrir, detalhe } = useDetalheDoEvento(salas, hoje);

  const calendario = useMemo(
    () => montarCalendario({ eventos: leitura.eventos, tarefas: tarefas ?? [], de, ate, agora }),
    [leitura.eventos, tarefas, de, ate, agora],
  );
  const daSemana = useMemo(() => tarefasDaSemana(tarefas ?? [], base), [tarefas, base]);
  const recusados = leitura.eventos.filter((e) => e.recusado).length;

  // No celular: o dia pedido (`?d=`), senão hoje, se estiver nesta semana, senão a segunda.
  const [escolha, setEscolha] = useState<{ semana: string; dia: string } | null>(null);
  const padrao = data !== undefined ? data : dias.includes(hoje) ? hoje : segunda;
  const escolhido = escolha?.semana === segunda ? escolha.dia : padrao;

  const celular = tela === 'celular';
  const props = { hoje, salas, aoAbrir: abrir, salaDoEvento };

  return (
    <div class="semana" data-modo={celular ? 'dia' : 'dias'}>
      <div class="cal-topo">
        <p class="cal-periodo">{periodoPorExtenso(de, ate)}</p>
        <NavegacaoDoCalendario
          rotulo="Semanas"
          anterior={{ href: `#/semana?d=${somarDias(segunda, -7)}`, nome: 'Semana anterior' }}
          proximo={{ href: `#/semana?d=${somarDias(segunda, 7)}`, nome: 'Próxima semana' }}
          hoje="#/semana"
        />
      </div>

      <AvisoDaAgenda leitura={leitura} aoTentar={atualizar} recusados={recusados} />

      {daSemana.length > 0 && (
        <section class="painel cal-tarefas-semana" aria-labelledby="titulo-tarefas-semana">
          <h2 id="titulo-tarefas-semana" class="cal-tarefas-titulo">Tarefas da semana</h2>
          <p class="cal-nota-do-cartao">Sem dia fixo.</p>
          <ul class="cal-lista">
            {daSemana.map((tarefa) => (
              <ItemDeAgenda
                key={tarefa.id}
                item={{ tipo: 'tarefa', chave: tarefa.id, tarefa, dia: base, ini: 0, fim: 0, passado: false }}
                salas={salas}
                aoAbrir={abrir}
              />
            ))}
          </ul>
        </section>
      )}

      {celular ? (
        <>
          <div class="cal-faixa" role="group" aria-label="Dias da semana">
            {dias.map((dia) => {
              const total = calendario.dia(dia).total;
              return (
                <button
                  key={dia}
                  type="button"
                  class="cal-faixa-dia"
                  data-hoje={String(dia === hoje)}
                  data-tem={String(total > 0)}
                  aria-pressed={dia === escolhido}
                  aria-label={`${diaPorExtenso(dia, hoje)}${dia === hoje ? ', hoje' : ''}, ${contagem(total)}`}
                  onClick={() => setEscolha({ semana: segunda, dia })}
                >
                  <span aria-hidden="true">{abreviacaoDoDia(dia)}</span>
                  <span class="cal-faixa-numero" aria-hidden="true">
                    {Number(dia.slice(8))}
                  </span>
                  <span class="cal-faixa-ponto" aria-hidden="true" />
                </button>
              );
            })}
          </div>
          <DiaDaSemana dia={calendario.dia(escolhido)} {...props} />
        </>
      ) : (
        <div class="semana-corpo">
          <div class="semana-dias">
            {dias.map((dia) => (
              <DiaDaSemana key={dia} dia={calendario.dia(dia)} {...props} />
            ))}
          </div>
        </div>
      )}
      {detalhe}
    </div>
  );
}
