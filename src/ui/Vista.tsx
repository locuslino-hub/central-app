// A página de cada rota. Toda rota do app tem a sua tela.
import type { RotaAtual } from '../rotas';
import { AgoraPagina } from './Agora';
import { Ano } from './Ano';
import { Atividades } from './Atividades';
import { Caixa } from './Caixa';
import { Chat } from './Chat';
import { Conectar } from './Conectar';
import { CoresDoGoogle } from './CoresDoGoogle';
import { ConfigIA } from './ConfigIA';
import { useTituloDaAba } from './hooks';
import { Mes } from './Mes';
import { Painel } from './Painel';
import { Pagina } from './Pagina';
import { Pessoa } from './Pessoa';
import { Quadro } from './Quadro';
import { Sala } from './Sala';
import { Salas } from './Salas';
import { Semana } from './Semana';
import { SeuNome } from './SeuNome';
import './tarefas.css';

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

function ConfigIANaCasca({ titulo }: { titulo: string }) {
  useTituloDaAba(titulo);
  return <ConfigIA />;
}

function ConectarNaCasca({ titulo }: { titulo: string }) {
  useTituloDaAba(titulo);
  return (
    <div class="ajustes-do-aparelho">
      <Conectar />
      <SeuNome />
    </div>
  );
}

export function Vista({ rota }: { rota: RotaAtual }) {
  switch (rota.id) {
    case 'hoje':
      return (
        <Pagina titulo={rota.titulo} tituloEscondido>
          <Painel />
        </Pagina>
      );
    case 'agora':
      return (
        <Pagina titulo={rota.titulo}>
          <AgoraPagina />
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
    case 'caixa':
      return (
        <Pagina titulo={rota.titulo}>
          <div class="semprazo-pagina">
            <Caixa />
          </div>
        </Pagina>
      );
    case 'quadro':
      return (
        <Pagina titulo={rota.titulo}>
          <Quadro />
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
    case 'cores':
      return (
        <Pagina titulo={rota.titulo}>
          <CoresDoGoogle />
        </Pagina>
      );
    case 'conectar':
      return <ConectarNaCasca titulo={rota.titulo} />;
    case 'ia':
      return <ConfigIANaCasca titulo={rota.titulo} />;
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
