// As tarefas abertas de uma sala ou de uma pessoa, agrupadas como em Atividades:
// Atrasadas, Hoje, Próximos dias, uma seção por semana e Sem prazo. Seção vazia não aparece.
import type { Sala, Tarefa } from '../dados/tipos';
import { LinhaDeTarefa, type Conclusoes } from './LinhaDeTarefa';
import { diaParaOrdenar, grupoDaAtividade, porOrdem, type GrupoDeAtividade } from './tarefas-lista';
import './tarefas.css';

type Props = {
  tarefas: readonly Tarefa[];
  salas: Sala[];
  hoje: string;
  conclusoes: Conclusoes;
  /** Id do título do cartão, para as seções se ligarem a ele. */
  prefixo: string;
};

export function ListaDeTarefas({ tarefas, salas, hoje, conclusoes, prefixo }: Props) {
  const grupos = new Map<string, { grupo: GrupoDeAtividade; linhas: Tarefa[] }>();
  for (const tarefa of tarefas) {
    if (tarefa.feito && !conclusoes.concluidasAgora.has(tarefa.id)) continue;
    const grupo = grupoDaAtividade(tarefa, hoje);
    const atual = grupos.get(grupo.chave) ?? { grupo, linhas: [] };
    atual.linhas.push(tarefa);
    grupos.set(grupo.chave, atual);
  }
  const secoes = [...grupos.values()].sort((a, b) => a.grupo.ordem - b.grupo.ordem || a.grupo.chave.localeCompare(b.grupo.chave));
  // Um grupo só não precisa de subtítulo: a lista já é "o que há aqui".
  const comSubtitulo = secoes.length > 1;

  return (
    <>
      {secoes.map(({ grupo, linhas }) => (
        <div class="tarefas-grupo" key={grupo.chave}>
          {comSubtitulo && (
            <h3 class="tarefas-grupo-titulo" id={`${prefixo}-${grupo.chave}`}>
              {grupo.titulo}
            </h3>
          )}
          <ul class="tarefas" aria-labelledby={comSubtitulo ? `${prefixo}-${grupo.chave}` : undefined}>
            {linhas
              .sort((a, b) => (grupo.ordenaPorDia ? diaParaOrdenar(a).localeCompare(diaParaOrdenar(b)) : 0) || porOrdem(a, b))
              .map((tarefa) => (
                <LinhaDeTarefa key={tarefa.id} tarefa={tarefa} salas={salas} hoje={hoje} conclusoes={conclusoes} />
              ))}
          </ul>
        </div>
      ))}
    </>
  );
}
