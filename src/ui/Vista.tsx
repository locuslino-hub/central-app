// A página de cada rota. Painel do dia (checklist, agenda de hoje e Sem prazo), Semana, Mês,
// Ano, Sem prazo, Atividades, Salas (com o cadastro de pessoas), Conectar e Chat existem; as
// demais mostram o título e dizem que ainda não estão prontas, até a tarefa delas chegar.
import type { ComponentChildren } from 'preact';
import { hrefDe, type RotaAtual } from '../rotas';
import { AgendaHoje } from './AgendaHoje';
import { Ano } from './Ano';
import { Atividades } from './Atividades';
import { AvisosDeConflito } from './AvisosDeConflito';
import { Chat } from './Chat';
import { Checklist } from './Checklist';
import { Conectar } from './Conectar';
import { usePessoa, useSala, useSalas, useTituloDaAba } from './hooks';
import { corDaSala } from './Menu';
import { Mes } from './Mes';
import { Pessoas } from './Pessoas';
import { SemPrazo } from './SemPrazo';
import { Semana } from './Semana';
import './tarefas.css';

function Pagina({ titulo, children }: { titulo: string; children?: ComponentChildren }) {
  useTituloDaAba(titulo);
  return (
    <>
      <h1>{titulo}</h1>
      {children}
    </>
  );
}

/** Tela que chega numa tarefa seguinte: diz isso e leva ao que já funciona. */
const AindaNaoPronta = () => (
  <section class="painel em-breve-cartao">
    <p class="em-breve">Em breve</p>
    <p class="em-breve-texto">Esta tela chega numa próxima versão.</p>
    <p>
      <a class="botao-link" href="#/">
        Voltar ao Painel do dia
      </a>
    </p>
  </section>
);

/** Temporária: a Tarefa 17 traz a página de cada sala. Por ora, os atalhos e o cadastro de pessoas. */
function Salas({ titulo }: { titulo: string }) {
  const salas = useSalas();
  return (
    <Pagina titulo={titulo}>
      <div class="salas-pagina">
        <section class="painel" aria-labelledby="titulo-salas">
          <h2 id="titulo-salas">Minhas salas</h2>
          <ul class="salas-links">
            {salas.map((sala) => (
              <li key={sala.id}>
                <a class={`sala-bloco ${corDaSala(sala.id)}`} href={hrefDe('sala', sala.id)}>
                  {sala.nome}
                </a>
              </li>
            ))}
          </ul>
        </section>
        <Pessoas />
      </div>
    </Pagina>
  );
}

function Sala({ id }: { id: string }) {
  const sala = useSala(id);
  if (sala === null) {
    return (
      <Pagina titulo="Sala não encontrada">
        <p class="aviso">Esta sala não existe neste aparelho.</p>
        <p>
          <a class="botao-link" href="#/salas">
            Ver as salas
          </a>
        </p>
      </Pagina>
    );
  }
  return (
    <Pagina titulo={sala?.nome ?? 'Sala'}>
      <AindaNaoPronta />
    </Pagina>
  );
}

function Pessoa({ id }: { id: string }) {
  const pessoa = usePessoa(id);
  if (pessoa === null) {
    return (
      <Pagina titulo="Pessoa não encontrada">
        <p class="aviso">Esta pessoa não existe neste aparelho.</p>
        <p>
          <a class="botao-link" href="#/salas">
            Ver as salas
          </a>
        </p>
      </Pagina>
    );
  }
  return (
    <Pagina titulo={pessoa?.nome ?? 'Pessoa'}>
      <AindaNaoPronta />
    </Pagina>
  );
}

function ConectarNaCasca({ titulo }: { titulo: string }) {
  useTituloDaAba(titulo);
  return <Conectar />;
}

export function Vista({ rota }: { rota: RotaAtual }) {
  switch (rota.id) {
    case 'hoje':
      // A Tarefa 17 monta o resto do Painel (mensagem do dia, linha do dia, caixas das salas...).
      return (
        <Pagina titulo={rota.titulo}>
          <AvisosDeConflito />
          <div class="hoje-grade">
            <Checklist />
            <AgendaHoje />
          </div>
          <div class="hoje-grade">
            <SemPrazo />
          </div>
        </Pagina>
      );
    case 'semana':
      return (
        <Pagina titulo={rota.titulo}>
          <Semana data={rota.data} />
        </Pagina>
      );
    case 'mes':
      return (
        <Pagina titulo={rota.titulo}>
          <Mes data={rota.data} />
        </Pagina>
      );
    case 'ano':
      return (
        <Pagina titulo={rota.titulo}>
          <Ano data={rota.data} />
        </Pagina>
      );
    case 'sem-prazo':
      return (
        <Pagina titulo={rota.titulo}>
          <div class="semprazo-pagina">
            <SemPrazo semCabecalho />
          </div>
        </Pagina>
      );
    case 'atividades':
      return (
        <Pagina titulo={rota.titulo}>
          <Atividades />
        </Pagina>
      );
    case 'salas':
      return <Salas titulo={rota.titulo} />;
    case 'conectar':
      return <ConectarNaCasca titulo={rota.titulo} />;
    case 'chat':
      return (
        <Pagina titulo={rota.titulo}>
          <div class="painel chat-pagina">
            <Chat />
          </div>
        </Pagina>
      );
    case 'sala':
      return <Sala key={rota.param} id={rota.param!} />;
    case 'pessoa':
      return <Pessoa key={rota.param} id={rota.param!} />;
    case 'nao-encontrada':
      return (
        <Pagina titulo={rota.titulo}>
          <p class="aviso">Esse endereço não existe no app.</p>
          <p>
            <a class="botao-link" href="#/">
              Ir para o Painel do dia
            </a>
          </p>
        </Pagina>
      );
    default:
      return (
        <Pagina titulo={rota.titulo}>
          <AindaNaoPronta />
        </Pagina>
      );
  }
}
