// Caixas de pendências das salas (spec, seção 7, item 3): uma caixa por sala,
// com o que está pendente nela agora. Tocar abre a sala.
//   - Tarefas: abertas, de hoje ou de antes, Sem prazo e Esta semana (o que já
//     pode ser feito). Tarefa marcada para um dia que ainda não chegou não conta.
//   - E-mails: os por responder de quem é da sala (memória de pessoas), que
//     ainda não viraram tarefa (esses já contam como tarefa).
import { segundaDaSemana } from '../chat/datas';
import type { ItemFila } from '../dados/fila';
import { origemDoRemetente } from '../dados/remetentes';
import type { Pessoa, Sala, Tarefa } from '../dados/tipos';
import { hrefDe } from '../rotas';
import { corDaSala } from './Menu';
import { juntar, nEmails, nTarefas } from './plural';
import './painel.css';

const DIA = /^\d{4}-\d{2}-\d{2}$/;

/** A tarefa já pode ser feita hoje (e ainda não foi)? */
export function pendenteHoje(tarefa: Tarefa, hoje: string): boolean {
  if (tarefa.feito || tarefa.apagado) return false;
  if (tarefa.data !== undefined && DIA.test(tarefa.data)) return tarefa.data <= hoje;
  if (tarefa.semana !== undefined && DIA.test(tarefa.semana)) return tarefa.semana <= segundaDaSemana(hoje);
  return true;
}

type Props = {
  salas: readonly Sala[];
  tarefas: readonly Tarefa[] | undefined;
  fila: readonly ItemFila[] | undefined;
  pessoas: readonly Pessoa[];
  hoje: string;
};

export function CaixasSalas({ salas, tarefas, fila, pessoas, hoje }: Props) {
  const tarefasPorSala = new Map<string, number>();
  for (const tarefa of tarefas ?? []) {
    if (tarefa.salaId && pendenteHoje(tarefa, hoje)) tarefasPorSala.set(tarefa.salaId, (tarefasPorSala.get(tarefa.salaId) ?? 0) + 1);
  }
  const emailsPorSala = new Map<string, number>();
  for (const item of fila ?? []) {
    if (item.tipo !== 'email' || !item.email) continue;
    const { salaId } = origemDoRemetente(item.email.enderecoRemetente, pessoas);
    if (salaId) emailsPorSala.set(salaId, (emailsPorSala.get(salaId) ?? 0) + 1);
  }

  return (
    <section class="caixas-salas" aria-labelledby="titulo-caixas-salas" aria-busy={tarefas === undefined}>
      <h2 id="titulo-caixas-salas" class="so-leitor">
        Pendências das salas
      </h2>
      <ul
        class="caixas-salas-lista"
        // No celular a faixa rola de lado; no fim dela, a borda direita deixa de sumir.
        onScroll={(e) => {
          const ul = e.currentTarget as HTMLElement;
          ul.dataset.fim = String(ul.scrollLeft + ul.clientWidth >= ul.scrollWidth - 2);
        }}
      >
        {salas.map((sala) => {
          const t = tarefasPorSala.get(sala.id) ?? 0;
          const e = emailsPorSala.get(sala.id) ?? 0;
          const partes = [...(t > 0 ? [nTarefas(t)] : []), ...(e > 0 ? [nEmails(e)] : [])];
          // Um tipo só: o número grande já diz quantos, a legenda diz o quê. Os dois: a legenda detalha.
          const legenda =
            partes.length === 0 ? 'Em dia' : partes.length === 2 ? juntar(partes) : t > 0 ? (t === 1 ? 'tarefa' : 'tarefas') : e === 1 ? 'e-mail' : 'e-mails';
          return (
            <li key={sala.id}>
              <a
                class={`caixa-sala ${corDaSala(sala.id)}`}
                href={hrefDe('sala', sala.id)}
                aria-label={`${sala.nome}: ${partes.length > 0 ? juntar(partes) : 'em dia'}`}
                data-vazia={String(partes.length === 0)}
              >
                <span class="caixa-sala-nome">{sala.nome}</span>
                <span class="caixa-sala-numero" aria-hidden="true">
                  {t + e}
                </span>
                <span class="caixa-sala-conta">{legenda}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
