// Checklist do dia (spec, seção 7, item 4): o que é de hoje e o que ficou de
// dias anteriores, com progresso. Cada linha tem Desfazer ao concluir.
import { useDia, useSalas, useTarefas } from './hooks';
import { AvisoDeApagada, LinhaDeTarefa, useConclusoes } from './LinhaDeTarefa';
import { NovaTarefa } from './NovaTarefa';
import { daChecklist, porOrdem } from './tarefas-lista';
import './tarefas.css';

export function Checklist() {
  const hoje = useDia();
  const tarefas = useTarefas();
  const salas = useSalas();
  const conclusoes = useConclusoes();

  const doDia = (tarefas ?? []).filter((t) => daChecklist(t, hoje, conclusoes.concluidasAgora)).sort(porOrdem);
  const feitas = doDia.filter((t) => t.feito).length;

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
      {doDia.length > 0 && (
        <>
          <div
            class="progresso"
            role="progressbar"
            aria-label="Progresso do dia"
            aria-valuemin={0}
            aria-valuemax={doDia.length}
            aria-valuenow={feitas}
          >
            <span class="progresso-cheio" style={{ width: `${(feitas / doDia.length) * 100}%` }} />
          </div>
          <p class="progresso-texto">
            {`${feitas} de ${doDia.length} ${doDia.length === 1 ? 'feita' : 'feitas'}`}
          </p>
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
