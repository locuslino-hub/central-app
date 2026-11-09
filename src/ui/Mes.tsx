// O mês: grade de semanas inteiras, de segunda a domingo. Cada dia mostra pontos
// (cheio: evento; anel: tarefa) e leva à semana daquele dia. Só leitura.
import { useMemo } from 'preact/hooks';
import { diasDoMes, montarCalendario, periodoDoMes, type DiaDoCalendario } from '../dados/calendario';
import { AvisoDaAgenda } from './AvisoDaAgenda';
import { useAgora, useDia, useTarefas } from './hooks';
import { NavegacaoDoCalendario } from './NavegacaoDoCalendario';
import { NOMES_DOS_MESES, abreviacaoDoDia, diaPorExtenso } from './quando';
import { useEventos } from './useEventos';
import './calendario.css';

const PONTOS_NO_MAXIMO = 3;
const ANEIS_NO_MAXIMO = 2;

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** "3 eventos e 1 tarefa", "sem compromissos". */
function resumo(eventos: number, tarefas: number): string {
  const partes = [eventos > 0 && plural(eventos, 'evento', 'eventos'), tarefas > 0 && plural(tarefas, 'tarefa', 'tarefas')].filter(Boolean);
  return partes.length === 0 ? 'sem compromissos' : partes.join(' e ');
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
        <table class="mes-grade" aria-label={nomeDoMes}>
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
                    <CelulaDoDia dia={calendario.dia(dia)} hoje={hoje} doMes={Number(dia.slice(5, 7)) === mes} />
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

function CelulaDoDia({ dia, hoje, doMes }: { dia: DiaDoCalendario; hoje: string; doMes: boolean }) {
  const eventos = [...dia.diaInteiro, ...dia.horarios].filter((i) => i.tipo === 'evento');
  const tarefas = dia.total - eventos.length;
  const eHoje = dia.data === hoje;
  const passado = dia.data < hoje;
  const pontos = Math.min(eventos.length, PONTOS_NO_MAXIMO);
  const aneis = Math.min(tarefas, ANEIS_NO_MAXIMO);
  const extra = eventos.length - pontos + (tarefas - aneis);
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
      {eventos.slice(0, 2).map((item) => (
        <span key={item.chave} class="mes-titulo" aria-hidden="true">
          {item.tipo === 'evento' && (item.evento.titulo === '' ? '(sem título)' : item.evento.titulo)}
        </span>
      ))}
    </a>
  );
}
