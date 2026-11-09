// Checklist do dia (spec, seção 7, item 4): o que é de hoje e o que ficou de
// dias anteriores, com progresso. Cada linha tem Desfazer ao concluir. O
// progresso conta também os compromissos de hoje da Agenda de hoje (feito
// espelhado), menos os marcados como livres e os recusados.
import { somarDias } from '../chat/datas';
import type { Evento } from '../dados/agenda';
import { useDia, useSalas, useTarefas } from './hooks';
import { AvisoDeApagada, LinhaDeTarefa, useConclusoes } from './LinhaDeTarefa';
import { NovaTarefa } from './NovaTarefa';
import { daChecklist, porOrdem } from './tarefas-lista';
import { useComFeito, useLeituraGuardada } from './useEventos';
import './tarefas.css';

export function Checklist() {
  const hoje = useDia();
  const tarefas = useTarefas();
  const salas = useSalas();
  const conclusoes = useConclusoes();

  const doDia = (tarefas ?? []).filter((t) => daChecklist(t, hoje, conclusoes.concluidasAgora)).sort(porOrdem);
  const compromissos = useComFeito(useLeituraGuardada(hoje, hoje).eventos).filter((e) => contaNoDia(e, hoje));
  const feitas = doDia.filter((t) => t.feito).length + compromissos.filter((e) => e.feito).length;
  const total = doDia.length + compromissos.length;

  return (
    <section class="painel checklist" aria-labelledby="titulo-checklist" aria-busy={tarefas === undefined}>
      <h2 id="titulo-checklist">Checklist do dia</h2>
      <NovaTarefa rotulo="Nova tarefa para hoje" data={hoje} />
      <AvisoDeApagada conclusoes={conclusoes} />
      {tarefas !== undefined && doDia.length === 0 && (
        <div>
          <p class="lista-vazia-titulo">Nada para hoje.</p>
          <p class="lista-vazia-texto">Diga ao Chat o que precisa fazer e a tarefa aparece aqui.</p>
          <p class="lista-vazia-texto">
            <a class="botao-link" href="#/chat">
              Abrir o Chat
            </a>
          </p>
        </div>
      )}
      {total > 0 && (
        <>
          <div
            class="progresso"
            role="progressbar"
            aria-label="Progresso do dia"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={feitas}
          >
            <span class="progresso-cheio" style={{ width: `${(feitas / total) * 100}%` }} />
          </div>
          <p class="progresso-texto">{`${feitas} de ${total} ${total === 1 ? 'feita' : 'feitas'}`}</p>
        </>
      )}
      {doDia.length > 0 && (
        <>
          <ul class="tarefas">
            {doDia.map((tarefa) => (
              <LinhaDeTarefa key={tarefa.id} tarefa={tarefa} salas={salas} hoje={hoje} conclusoes={conclusoes} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/**
 * O compromisso conta no progresso de hoje? Acontece hoje e não é livre nem
 * recusado. Terminar à meia-noite em ponto não toca o dia seguinte (como na
 * Agenda de hoje, src/dados/calendario.ts).
 */
function contaNoDia(evento: Evento, hoje: string): boolean {
  if (evento.livre || evento.recusado) return false;
  const inicio = evento.inicio.slice(0, 10);
  if (evento.diaInteiro) return inicio <= hoje && hoje < evento.fim;
  let ultimo = evento.fim.slice(0, 10);
  if (ultimo > inicio && evento.fim.slice(11, 16) === '00:00') ultimo = somarDias(ultimo, -1);
  return inicio <= hoje && hoje <= ultimo;
}
