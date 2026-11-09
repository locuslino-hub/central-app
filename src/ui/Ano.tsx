// O ano: doze meses pequenos. Cada mês abre o mês; os dias com compromissos
// aparecem marcados (na página larga, num círculo na cor da sala). Só leitura.
import { useMemo } from 'preact/hooks';
import { mesesDoAno, montarCalendario, periodoDoAno } from '../dados/calendario';
import { AvisoDaAgenda } from './AvisoDaAgenda';
import { useAgora, useDia, useTarefas } from './hooks';
import { corDaSalaDoItem } from './Mes';
import { useSalaDoEvento } from './useAdivinharSala';
import { NavegacaoDoCalendario } from './NavegacaoDoCalendario';
import { NOMES_DOS_MESES } from './quando';
import { useEventos } from './useEventos';
import './calendario.css';

/** Inicial de cada dia, de segunda a domingo, para o cabeçalho do mini calendário. */
const LETRAS_DA_SEMANA = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'];

export function Ano({ data }: { data?: string }) {
  const hoje = useDia();
  const agora = useAgora();
  const tarefas = useTarefas();
  const adivinhar = useSalaDoEvento();

  const base = data ?? hoje;
  const ano = Number(base.slice(0, 4));
  const { de, ate } = periodoDoAno(base);
  const { leitura, atualizar } = useEventos(de, ate);

  const calendario = useMemo(
    () => montarCalendario({ eventos: leitura.eventos, tarefas: tarefas ?? [], de, ate, agora }),
    [leitura.eventos, tarefas, de, ate, agora],
  );
  const meses = useMemo(() => mesesDoAno(ano), [ano]);
  const recusados = leitura.eventos.filter((e) => e.recusado).length;

  return (
    <div class="ano">
      <div class="cal-topo">
        <NavegacaoDoCalendario
          rotulo="Anos"
          anterior={{ href: `#/ano?d=${ano - 1}-01-01`, nome: 'Ano anterior' }}
          proximo={{ href: `#/ano?d=${ano + 1}-01-01`, nome: 'Próximo ano' }}
          hoje="#/ano"
        />
      </div>
      <AvisoDaAgenda leitura={leitura} aoTentar={atualizar} recusados={recusados} />

      <div class="ano-meses">
        {meses.map(({ mes, primeiro, semanas }) => {
          const dias = semanas.flat().filter((dia) => Number(dia.slice(5, 7)) === mes);
          const comItens = dias.filter((dia) => calendario.dia(dia).total > 0).length;
          const atual = hoje.slice(0, 7) === primeiro.slice(0, 7);
          return (
            <section key={primeiro} class="painel ano-mes" aria-labelledby={`ano-mes-${mes}`}>
              <h2 id={`ano-mes-${mes}`} class="ano-mes-titulo">
                <a class="ano-mes-link" href={`#/mes?d=${primeiro}`} aria-current={atual ? 'date' : undefined}>
                  {NOMES_DOS_MESES[mes - 1]}
                </a>
                {atual && <span class="ano-atual">mês atual</span>}
              </h2>
              <p class="ano-contagem">
                {comItens === 0
                  ? 'Sem compromissos'
                  : `${comItens} ${comItens === 1 ? 'dia com compromisso' : 'dias com compromissos'}`}
              </p>
              <div class="ano-mini" aria-hidden="true">
                {LETRAS_DA_SEMANA.map((letra, i) => (
                  <span key={i} class="ano-letra">
                    {letra}
                  </span>
                ))}
                {semanas.flat().map((dia) => {
                  if (Number(dia.slice(5, 7)) !== mes) return <span key={dia} class="ano-dia ano-dia-fora" />;
                  const doDia = calendario.dia(dia);
                  const primeiro = doDia.diaInteiro[0] ?? doDia.horarios[0];
                  return (
                    <span
                      key={dia}
                      class={`ano-dia${primeiro ? ` ${corDaSalaDoItem(primeiro, adivinhar)}` : ''}`}
                      data-hoje={String(dia === hoje)}
                      data-tem={String(doDia.total > 0)}
                      data-passado={String(dia < hoje)}
                    >
                      {Number(dia.slice(8))}
                    </span>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
