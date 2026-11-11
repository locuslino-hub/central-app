// Esta semana: sete dias, de segunda a domingo, com os eventos do Google Agenda
// e as tarefas. Só leitura. No computador é uma grade de horas, como no modelo:
// sete colunas, o dia inteiro no alto e cada compromisso como bloco na hora dele
// (ou uma lista de dias, se a página for estreita); no celular, um dia de cada vez.
import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
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
import { minutoEmLisboa } from '../dados/dia';
import type { Sala } from '../dados/tipos';
import { AvisoDaAgenda } from './AvisoDaAgenda';
import { useDetalheDoEvento } from './DetalheEvento';
import { useAgora, useDia, useSalas, useTarefas, useTela } from './hooks';
import { ItemDeAgenda } from './ItemDeAgenda';
import { useSalaDoEvento, type SalaDoEvento } from './useAdivinharSala';
import { NavegacaoDoCalendario } from './NavegacaoDoCalendario';
import { abreviacaoDoDia, diaPorExtenso, periodoPorExtenso } from './quando';
import { useComFeito, useEventos } from './useEventos';
import './calendario.css';

const contagem = (total: number) => (total === 0 ? 'nada marcado' : total === 1 ? '1 item' : `${total} itens`);

// ---- Grade de horas ----

/** A grade vai pelo menos das 8h às 20h, e cresce para caber o que começa antes ou acaba depois. */
const PRIMEIRA_HORA = 8;
const ULTIMA_HORA = 20;
/** Na tela, um bloco tem pelo menos a altura de um toque (44 px): para não se cobrirem, conta como 55 min. */
const MINUTOS_MINIMOS = 55;

export type Horas = { de: number; ate: number };

/** O fim que vale para a grade: o que continua no dia seguinte não estica a grade até a meia-noite. */
const fimNaGrade = (item: Item) => (item.tipo === 'evento' && item.continuaDepois ? item.ini + 60 : item.fim);

export function horasDaSemana(dias: DiaDoCalendario[]): Horas {
  let de = PRIMEIRA_HORA;
  let ate = ULTIMA_HORA;
  for (const dia of dias) {
    for (const item of dia.horarios) {
      // O que vem do dia anterior começa no alto da grade, sem puxá-la para a madrugada.
      if (!(item.tipo === 'evento' && item.continuaAntes)) de = Math.min(de, Math.floor(item.ini / 60));
      ate = Math.max(ate, Math.ceil(fimNaGrade(item) / 60));
    }
  }
  return { de, ate: Math.min(24, Math.max(ate, de + 1)) };
}

export type Posicao = { ini: number; fim: number; coluna: number; colunas: number };

/**
 * Onde cada bloco do dia fica: começo e fim em minutos a partir do alto da grade, e a
 * coluna (o que se sobrepõe divide a largura, contando a altura mínima de cada bloco).
 */
export function posicoesNoDia(itens: Item[], horas: Horas): Posicao[] {
  const minimo = horas.de * 60;
  const maximo = horas.ate * 60;
  const blocos = itens.map((item) => {
    const ini = Math.min(Math.max(item.ini, minimo), maximo);
    const fim = Math.min(Math.max(fimNaGrade(item), ini), maximo);
    return { ini, fim, visivelAte: Math.max(fim, ini + MINUTOS_MINIMOS) };
  });
  const ordem = blocos.map((_, i) => i).sort((a, b) => blocos[a].ini - blocos[b].ini || blocos[b].fim - blocos[a].fim);
  const colunaDe = new Array<number>(blocos.length).fill(0);
  const colunasDe = new Array<number>(blocos.length).fill(1);
  let grupo: number[] = [];
  let ocupadas: number[] = [];
  let fimDoGrupo = -1;
  const fecharGrupo = () => {
    for (const i of grupo) colunasDe[i] = ocupadas.length;
    grupo = [];
    ocupadas = [];
  };
  for (const i of ordem) {
    const { ini, visivelAte } = blocos[i];
    if (grupo.length > 0 && ini >= fimDoGrupo) fecharGrupo();
    let coluna = ocupadas.findIndex((ate) => ate <= ini);
    if (coluna < 0) coluna = ocupadas.length;
    ocupadas[coluna] = visivelAte;
    colunaDe[i] = coluna;
    fimDoGrupo = grupo.length === 0 ? visivelAte : Math.max(fimDoGrupo, visivelAte);
    grupo.push(i);
  }
  fecharGrupo();
  return blocos.map((b, i) => ({ ini: b.ini - minimo, fim: b.fim - minimo, coluna: colunaDe[i], colunas: colunasDe[i] }));
}

/** As horas da régua, à esquerda da grade. Só desenho: cada bloco diz a hora em palavras. */
function ReguaDasHoras({ horas }: { horas: Horas }) {
  return (
    <div class="sem-regua" aria-hidden="true">
      <span />
      <span />
      <span class="sem-regua-horas">
        {Array.from({ length: horas.ate - horas.de }, (_, i) => (
          <span key={i}>{`${horas.de + i}h`}</span>
        ))}
      </span>
    </div>
  );
}

type DiaProps = {
  dia: DiaDoCalendario;
  hoje: string;
  salas: Sala[];
  aoAbrir: (item: ItemDeEvento, botao: HTMLElement) => void;
  salaDoEvento: SalaDoEvento;
  /** Computador e tablet: o dia é uma coluna da grade de horas. */
  horas?: Horas;
  /** Minuto de agora (Lisboa): a linha da hora atual, só no dia de hoje. */
  agora?: number;
};

function DiaDaSemana({ dia, hoje, salas, aoAbrir, salaDoEvento, horas, agora }: DiaProps) {
  const eHoje = dia.data === hoje;
  const itens: Item[] = [...dia.diaInteiro, ...dia.horarios];
  const id = `dia-${dia.data}`;
  const titulo = (
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
  );

  if (horas) {
    return (
      <section class="cal-dia sem-coluna" data-hoje={String(eHoje)} aria-labelledby={id}>
        {titulo}
        <div class="sem-topo">
          {dia.diaInteiro.length > 0 && (
            <ul class="cal-lista">
              {dia.diaInteiro.map((item) => (
                <ItemDeAgenda key={item.chave} item={item} salas={salas} aoAbrir={aoAbrir} salaDoEvento={salaDoEvento} />
              ))}
            </ul>
          )}
          {itens.length === 0 && <p class="cal-vazio">Nada marcado.</p>}
        </div>
        <HorasDoDia
          itens={dia.horarios}
          horas={horas}
          agora={eHoje ? agora : undefined}
          salas={salas}
          aoAbrir={aoAbrir}
          salaDoEvento={salaDoEvento}
        />
      </section>
    );
  }

  return (
    <section class="cal-dia" data-hoje={String(eHoje)} aria-labelledby={id}>
      {titulo}
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

type HorasDoDiaProps = Pick<DiaProps, 'salas' | 'aoAbrir' | 'salaDoEvento' | 'agora'> & { itens: Item[]; horas: Horas };

/**
 * Os blocos do dia na grade. A posição vai em variáveis CSS em cada linha da lista
 * (a linha é do ItemDeAgenda, que não recebe estilo): a ordem das linhas é a dos itens.
 */
function HorasDoDia({ itens, horas, agora, salas, aoAbrir, salaDoEvento }: HorasDoDiaProps) {
  const lista = useRef<HTMLUListElement>(null);
  const posicoes = useMemo(() => posicoesNoDia(itens, horas), [itens, horas]);
  useLayoutEffect(() => {
    const linhas = lista.current?.children;
    if (!linhas) return;
    posicoes.forEach((p, i) => {
      const linha = linhas[i] as HTMLElement | undefined;
      if (!linha) return;
      linha.style.setProperty('--ini', String(p.ini));
      linha.style.setProperty('--dur', String(p.fim - p.ini));
      linha.style.setProperty('--coluna', String(p.coluna));
      linha.style.setProperty('--colunas', String(p.colunas));
    });
  });
  const inicio = horas.de * 60;
  const linhaDeAgora = agora !== undefined && agora >= inicio && agora <= horas.ate * 60 ? agora - inicio : undefined;
  return (
    <div class="sem-horas" style={{ '--minutos': String((horas.ate - horas.de) * 60) }}>
      {itens.length > 0 && (
        <ul class="cal-lista sem-blocos" ref={lista}>
          {itens.map((item) => (
            <ItemDeAgenda key={item.chave} item={item} salas={salas} aoAbrir={aoAbrir} salaDoEvento={salaDoEvento} />
          ))}
        </ul>
      )}
      {linhaDeAgora !== undefined && <span class="sem-agora" aria-hidden="true" style={{ '--ini': String(linhaDeAgora) }} />}
    </div>
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
  // O feito que vale (marcado na Central ou no Google), como na Agenda de hoje.
  const eventos = useComFeito(leitura.eventos);
  const { abrir, detalhe } = useDetalheDoEvento(salas, hoje);

  const calendario = useMemo(
    () => montarCalendario({ eventos, tarefas: tarefas ?? [], de, ate, agora }),
    [eventos, tarefas, de, ate, agora],
  );
  const daSemana = useMemo(() => tarefasDaSemana(tarefas ?? [], base), [tarefas, base]);
  const recusados = leitura.eventos.filter((e) => e.recusado).length;

  // No celular: o dia pedido (`?d=`), senão hoje, se estiver nesta semana, senão a segunda.
  const [escolha, setEscolha] = useState<{ semana: string; dia: string } | null>(null);
  const padrao = data !== undefined ? data : dias.includes(hoje) ? hoje : segunda;
  const escolhido = escolha?.semana === segunda ? escolha.dia : padrao;

  const celular = tela === 'celular';
  const props = { hoje, salas, aoAbrir: abrir, salaDoEvento };
  const daGrade = useMemo(() => dias.map((dia) => calendario.dia(dia)), [calendario, segunda]); // eslint-disable-line react-hooks/exhaustive-deps
  const horas = useMemo(() => horasDaSemana(daGrade), [daGrade]);

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
                  onClick={() => setEscolha({ semana: segunda, dia })}
                >
                  {/* O nome vem de um texto só para o leitor de tela, e não de aria-label: a abreviação e o número que se veem ficam de fora dele. */}
                  <span class="so-leitor">{`${diaPorExtenso(dia, hoje)}${dia === hoje ? ', hoje' : ''}, ${contagem(total)}`}</span>
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
        <div class="semana-corpo painel">
          <div class="semana-dias" style={{ '--horas': String(horas.ate - horas.de) }}>
            <ReguaDasHoras horas={horas} />
            {daGrade.map((dia) => (
              <DiaDaSemana key={dia.data} dia={dia} {...props} horas={horas} agora={minutoEmLisboa(agora)} />
            ))}
          </div>
        </div>
      )}
      {detalhe}
    </div>
  );
}
