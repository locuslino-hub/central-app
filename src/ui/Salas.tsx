// Salas (menu "Salas"): as sete salas como cartões, cada uma com o que há de
// aberto nela, e embaixo o cadastro de pessoas. O cartão inteiro abre a sala
// (o link é só o nome; o resto do cartão é clicável por cima dele).
import type { Pessoa, Sala, Tarefa } from '../dados/tipos';
import { hrefDe } from '../rotas';
import { usePessoas, useSalas, useTarefas } from './hooks';
import { corDaSala } from './Menu';
import { Pagina } from './Pagina';
import { Pessoas } from './Pessoas';
import { contar, nTarefas } from './plural';
import './salas.css';

/** "2 tarefas abertas", "1 tarefa aberta". */
const abertas = (n: number) => `${nTarefas(n)} ${n === 1 ? 'aberta' : 'abertas'}`;
const nPessoas = (n: number) => contar(n, 'pessoa', 'pessoas');

type CartaoProps = { sala: Sala; tarefas: readonly Tarefa[] | undefined; pessoas: readonly Pessoa[] | undefined };

function CartaoDaSala({ sala, tarefas, pessoas }: CartaoProps) {
  const nTar = tarefas?.filter((t) => t.salaId === sala.id && !t.feito && !t.apagado).length;
  const nPes = pessoas?.filter((p) => p.salaId === sala.id && !p.apagado).length;
  return (
    <li class={`sala-cartao ${corDaSala(sala.id)}`}>
      <a class="sala-cartao-nome" href={hrefDe('sala', sala.id)}>
        {sala.nome}
      </a>
      <p class="sala-cartao-conta">
        {nTar === undefined ? '\u00a0' : nTar === 0 ? 'Nada em aberto' : abertas(nTar)}
        {nPes !== undefined && nPes > 0 && <span class="sala-cartao-pessoas">{nPessoas(nPes)}</span>}
      </p>
    </li>
  );
}

export function Salas({ titulo }: { titulo: string }) {
  const salas = useSalas();
  const tarefas = useTarefas();
  const pessoas = usePessoas();
  return (
    <Pagina titulo={titulo}>
      <div class="salas-pagina">
        <ul class="salas-cartoes" aria-label="Salas" aria-busy={salas.length === 0}>
          {salas.map((sala) => (
            <CartaoDaSala key={sala.id} sala={sala} tarefas={tarefas} pessoas={pessoas} />
          ))}
        </ul>
        <p class="salas-cores">
          <a class="botao-link" href={hrefDe('cores')}>
            Cores do Google
          </a>
          <span>Ligue cada cor da sua agenda a uma sala.</span>
        </p>
        <Pessoas />
      </div>
    </Pagina>
  );
}
