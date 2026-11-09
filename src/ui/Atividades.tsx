// Atividades: as tarefas abertas, agrupadas por quando são. Atrasadas, Hoje,
// Próximos dias, uma seção por semana e Sem prazo, nessa ordem; seção vazia não aparece.
// (O dono chama de "atividades" o que o app chama de Tarefa: spec, seção 9.)
import { useDia, useSalas, useTarefas } from './hooks';
import { LinhaDeTarefa, useConclusoes } from './LinhaDeTarefa';
import { diaParaOrdenar, grupoDaAtividade, porOrdem, type GrupoDeAtividade } from './tarefas-lista';
import './tarefas.css';

export function Atividades() {
  const hoje = useDia();
  const tarefas = useTarefas();
  const salas = useSalas();
  const conclusoes = useConclusoes();

  const grupos = new Map<string, { grupo: GrupoDeAtividade; linhas: NonNullable<typeof tarefas> }>();
  for (const tarefa of tarefas ?? []) {
    if (tarefa.feito && !conclusoes.concluidasAgora.has(tarefa.id)) continue;
    const grupo = grupoDaAtividade(tarefa, hoje);
    if (!grupo) continue;
    const atual = grupos.get(grupo.chave) ?? { grupo, linhas: [] };
    atual.linhas.push(tarefa);
    grupos.set(grupo.chave, atual);
  }
  const secoes = [...grupos.values()].sort(
    (a, b) => a.grupo.ordem - b.grupo.ordem || a.grupo.chave.localeCompare(b.grupo.chave),
  );

  if (tarefas !== undefined && secoes.length === 0) {
    return (
      <section class="painel atividades" aria-label="Atividades">
        <div>
          <p class="lista-vazia-titulo">Nenhuma atividade aberta.</p>
          <p class="lista-vazia-texto">O que você anotar no Chat aparece aqui.</p>
          <p class="lista-vazia-texto">
            <a class="botao-link" href="#/chat">
              Abrir o Chat
            </a>
          </p>
        </div>
      </section>
    );
  }

  return (
    <div class="atividades-grupos" aria-busy={tarefas === undefined}>
      {secoes.map(({ grupo, linhas }) => (
        <section class="painel atividades" key={grupo.chave} aria-labelledby={`atividades-${grupo.chave}`}>
          <h2 id={`atividades-${grupo.chave}`}>{grupo.titulo}</h2>
          <ul class="tarefas">
            {linhas
              .sort((a, b) => (grupo.ordenaPorDia ? diaParaOrdenar(a).localeCompare(diaParaOrdenar(b)) : 0) || porOrdem(a, b))
              .map((tarefa) => (
                <LinhaDeTarefa key={tarefa.id} tarefa={tarefa} salas={salas} hoje={hoje} conclusoes={conclusoes} />
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
