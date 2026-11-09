// O mês: grade de semanas inteiras, de segunda a domingo. Cada dia mostra pontos
// (cheio: evento; anel: tarefa) e leva à semana daquele dia. Só leitura.
// No computador a grade ocupa o painel central inteiro (calendario.css) e cada dia
// mostra tantos títulos quantos couberem na altura dele; o resto vira "+N".
import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { diasDoMes, montarCalendario, periodoDoMes, type DiaDoCalendario, type Item } from '../dados/calendario';
import { AvisoDaAgenda } from './AvisoDaAgenda';
import { useAgora, useDia, useTarefas, useTela } from './hooks';
import { NavegacaoDoCalendario } from './NavegacaoDoCalendario';
import { NOMES_DOS_MESES, abreviacaoDoDia, diaPorExtenso } from './quando';
import { useEventos } from './useEventos';
import './calendario.css';

const PONTOS_NO_MAXIMO = 3;
const ANEIS_NO_MAXIMO = 2;
/** Fora do computador (ou antes de medir): os títulos dos dois primeiros eventos. */
const TITULOS_SEM_MEDIR = 2;

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** "3 eventos e 1 tarefa", "sem compromissos". */
function resumo(eventos: number, tarefas: number): string {
  const partes = [eventos > 0 && plural(eventos, 'evento', 'eventos'), tarefas > 0 && plural(tarefas, 'tarefa', 'tarefas')].filter(Boolean);
  return partes.length === 0 ? 'sem compromissos' : partes.join(' e ');
}

/**
 * Quantas linhas de título cabem na área de títulos de um dia. Todos os dias da grade
 * têm a mesma altura no computador: basta medir o primeiro.
 */
function titulosQueCabem(tabela: HTMLElement): number | null {
  const area = tabela.querySelector<HTMLElement>('tbody .mes-titulos');
  if (!area) return null;
  const estilo = getComputedStyle(area);
  if (estilo.display === 'none') return null; // página estreita: sem títulos, só os pontos
  const linha = parseFloat(estilo.lineHeight);
  const vao = parseFloat(estilo.rowGap) || 0;
  if (!(linha > 0)) return null;
  return Math.max(0, Math.floor((area.clientHeight + vao) / (linha + vao)));
}

/** Mede a grade e mede de novo quando a janela muda de tamanho. Só no computador. */
function useTitulosQueCabem(tabela: { current: HTMLElement | null }, medir: boolean): number | null {
  const [cabem, setCabem] = useState<number | null>(null);
  useLayoutEffect(() => {
    const alvo = tabela.current;
    if (!medir || !alvo || typeof ResizeObserver === 'undefined') {
      setCabem(null);
      return;
    }
    const atualizar = () => setCabem(titulosQueCabem(alvo));
    atualizar();
    const observador = new ResizeObserver(atualizar);
    observador.observe(alvo);
    return () => observador.disconnect();
  }, [tabela, medir]);
  return cabem;
}

/** O primeiro dia do mês `passo` meses depois (ou antes, se negativo). */
function primeiroDoMes(ano: number, mes: number, passo: number): string {
  const total = ano * 12 + (mes - 1) + passo;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-01`;
}

export function Mes({ data }: { data?: string }) {
  const hoje = useDia();
  const agora = useAgora();
  const tarefas = useTarefas();
  const tela = useTela();
  const grade = useRef<HTMLTableElement>(null);
  const cabem = useTitulosQueCabem(grade, tela === 'computador');

  const base = data ?? hoje;
  const ano = Number(base.slice(0, 4));
  const mes = Number(base.slice(5, 7));
  const semanas = diasDoMes(ano, mes);
  const { de, ate } = periodoDoMes(base);
  const { leitura, atualizar } = useEventos(de, ate);

  const calendario = useMemo(
    () => montarCalendario({ eventos: leitura.eventos, tarefas: tarefas ?? [], de, ate, agora }),
    [leitura.eventos, tarefas, de, ate, agora],
  );
  const recusados = leitura.eventos.filter((e) => e.recusado).length;
  const nomeDoMes = `${NOMES_DOS_MESES[mes - 1]} de ${ano}`;

  return (
    <div class="mes">
      <div class="cal-topo">
        <p class="cal-periodo">{ano}</p>
        <NavegacaoDoCalendario
          rotulo="Meses"
          anterior={{ href: `#/mes?d=${primeiroDoMes(ano, mes, -1)}`, nome: 'Mês anterior' }}
          proximo={{ href: `#/mes?d=${primeiroDoMes(ano, mes, 1)}`, nome: 'Próximo mês' }}
          hoje="#/mes"
        />
      </div>
      <AvisoDaAgenda leitura={leitura} aoTentar={atualizar} recusados={recusados} />

      <div class="painel mes-quadro">
        <table class="mes-grade" aria-label={nomeDoMes} ref={grade}>
          <thead>
            <tr>
              {semanas[0].map((dia) => (
                <th key={dia} scope="col">
                  {abreviacaoDoDia(dia)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {semanas.map((semana) => (
              <tr key={semana[0]}>
                {semana.map((dia) => (
                  <td key={dia}>
                    <CelulaDoDia dia={calendario.dia(dia)} hoje={hoje} doMes={Number(dia.slice(5, 7)) === mes} cabem={cabem} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p class="cal-legenda">Ponto cheio: evento. Anel: tarefa. Dias que já passaram ficam mais claros.</p>
      </div>
    </div>
  );
}

const tituloDoItem = (item: Item) =>
  item.tipo === 'evento' ? (item.evento.titulo === '' ? '(sem título)' : item.evento.titulo) : item.tarefa.titulo;

/**
 * Os títulos do dia. Sem medida: os dois primeiros eventos, como sempre foi. Medido
 * (computador): eventos e depois tarefas, até onde cabe; quantos ficaram de fora
 * aparece como "+N" ao lado dos pontos.
 */
function titulosDoDia(eventos: Item[], tarefas: Item[], cabem: number | null): { itens: Item[]; fora: number } {
  if (cabem === null) return { itens: eventos.slice(0, TITULOS_SEM_MEDIR), fora: 0 };
  const todos = [...eventos, ...tarefas];
  return { itens: todos.slice(0, cabem), fora: Math.max(0, todos.length - cabem) };
}

function CelulaDoDia({ dia, hoje, doMes, cabem }: { dia: DiaDoCalendario; hoje: string; doMes: boolean; cabem: number | null }) {
  const itens = [...dia.diaInteiro, ...dia.horarios];
  const eventos = itens.filter((i) => i.tipo === 'evento');
  const itensDeTarefa = itens.filter((i) => i.tipo !== 'evento');
  const tarefas = dia.total - eventos.length;
  const titulos = titulosDoDia(eventos, itensDeTarefa, cabem);
  const eHoje = dia.data === hoje;
  const passado = dia.data < hoje;
  const pontos = Math.min(eventos.length, PONTOS_NO_MAXIMO);
  const aneis = Math.min(tarefas, ANEIS_NO_MAXIMO);
  // Medido, o "+N" conta o que não coube nos títulos; sem medir, o que não coube nos pontos.
  const extra = cabem === null ? eventos.length - pontos + (tarefas - aneis) : titulos.fora;
  const nome = `${diaPorExtenso(dia.data, hoje)}${eHoje ? ', hoje' : passado ? ', passado' : ''}, ${resumo(eventos.length, tarefas)}`;

  return (
    <a
      class="mes-dia"
      href={`#/semana?d=${dia.data}`}
      aria-label={nome}
      aria-current={eHoje ? 'date' : undefined}
      data-hoje={String(eHoje)}
      data-fora={String(!doMes)}
      data-passado={String(passado)}
    >
      <span class="mes-numero" aria-hidden="true">
        {Number(dia.data.slice(8))}
      </span>
      <span class="mes-pontos" aria-hidden="true">
        {Array.from({ length: pontos }, (_, i) => (
          <span key={`p${i}`} class="mes-ponto" />
        ))}
        {Array.from({ length: aneis }, (_, i) => (
          <span key={`a${i}`} class="mes-anel" />
        ))}
        {extra > 0 && <span class="mes-extra">{`+${extra}`}</span>}
      </span>
      <span class="mes-titulos" aria-hidden="true">
        {titulos.itens.map((item) => (
          <span key={item.chave} class="mes-titulo" data-tipo={item.tipo === 'evento' ? 'evento' : 'tarefa'}>
            {tituloDoItem(item)}
          </span>
        ))}
      </span>
    </a>
  );
}
