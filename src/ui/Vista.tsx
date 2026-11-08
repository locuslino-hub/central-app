// A página de cada rota. Só o Painel do dia e Conectar existem; as demais mostram
// o título e dizem que ainda não estão prontas, até a tarefa delas chegar.
import type { ComponentChildren } from 'preact';
import type { RotaAtual } from '../rotas';
import { Conectar } from './Conectar';
import { usePessoa, useSala, useTituloDaAba } from './hooks';
import { ProvaSincronia } from './ProvaSincronia';

function Pagina({ titulo, children }: { titulo: string; children?: ComponentChildren }) {
  useTituloDaAba(titulo);
  return (
    <>
      <h1>{titulo}</h1>
      {children}
    </>
  );
}

const AindaNaoPronta = () => <p class="aviso">Esta tela ainda não está pronta.</p>;

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
      // Temporário: a Tarefa 9 troca a prova pela checklist e pelas caixas do dia.
      return (
        <Pagina titulo={rota.titulo}>
          <ProvaSincronia />
        </Pagina>
      );
    case 'conectar':
      return <ConectarNaCasca titulo={rota.titulo} />;
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
