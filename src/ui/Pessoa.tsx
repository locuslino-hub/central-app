// A página de uma pessoa (spec, seção 7): as pendências dela, os e-mails dela no
// Gmail (só leitura), as notas e os documentos. A sala e o papel ficam no alto.
// O que o chat anota "com" ela (`pessoaId` da tarefa) cai em Pendências.
import { useRef, useState } from 'preact/hooks';
import type { Pessoa as PessoaDoApp } from '../dados/tipos';
import { hrefDe } from '../rotas';
import { Documentos } from './Documentos';
import { useDia, usePessoa, useSalas, useTarefas } from './hooks';
import { AvisoDeApagada, useConclusoes } from './LinhaDeTarefa';
import { ListaDeTarefas } from './ListaDeTarefas';
import { corDaSala } from './Menu';
import { notasPorGuardar } from '../dados/notas';
import { Notas } from './Notas';
import { NovaTarefa } from './NovaTarefa';
import { Pagina } from './Pagina';
import { EdicaoDePessoa } from './Pessoas';
import { nEmails } from './plural';
import { AvisoDeEmail, EstadoDosEmails, ListaDeEmails } from './PorResponder';
import { useCaixaDeEmails } from './useEmails';
import './salas.css';

function ConteudoDaPessoa({ pessoa }: { pessoa: PessoaDoApp }) {
  const hoje = useDia();
  const salas = useSalas();
  const tarefas = useTarefas();
  const conclusoes = useConclusoes();
  const caixa = useCaixaDeEmails();
  const [editando, setEditando] = useState(false);
  const botaoEditar = useRef<HTMLButtonElement>(null);

  const sala = salas.find((s) => s.id === pessoa.salaId);
  const nomeDaSala = (id: string) => salas.find((s) => s.id === id)?.nome ?? 'sala apagada';
  const dela = (tarefas ?? []).filter((t) => t.pessoaId === pessoa.id && !t.apagado);
  const abertas = dela.filter((t) => !t.feito);
  const emails = (caixa.itens ?? []).filter((item) => item.origem.pessoa?.id === pessoa.id);
  const lidos = caixa.itens !== undefined && caixa.leitura.lidoEm !== null;

  return (
    <div class={`pessoa-pagina ${sala ? corDaSala(sala.id) : 'sala-outra'}`}>
      <div class="pessoa-faixa">
        {sala ? (
          <a class={`etiqueta ${corDaSala(sala.id)} pessoa-sala`} href={hrefDe('sala', sala.id)}>
            {sala.nome}
          </a>
        ) : (
          <span class="etiqueta sala-outra pessoa-sala">Sem sala</span>
        )}
        {pessoa.papel && <span class="pessoa-faixa-papel">{pessoa.papel}</span>}
        <span class="pessoa-faixa-conta">
          {[abertas.length > 0 ? `${abertas.length} ${abertas.length === 1 ? 'tarefa aberta' : 'tarefas abertas'}` : null, emails.length > 0 ? `${nEmails(emails.length)} por responder` : null]
            .filter(Boolean)
            .join(' · ') || 'Nada em aberto'}
        </span>
        {!editando && (
          <button
            type="button"
            class="botao-texto pessoa-faixa-editar"
            ref={botaoEditar}
            aria-label={`Editar ${pessoa.nome}`}
            onClick={() => setEditando(true)}
          >
            Editar
          </button>
        )}
      </div>

      {editando && (
        <section class="painel pessoa-edicao" aria-label={`Editar ${pessoa.nome}`}>
          <EdicaoDePessoa
            pessoa={pessoa}
            salas={salas}
            nomeDaSala={nomeDaSala}
            aoFechar={() => {
              setEditando(false);
              // O botão Editar volta a existir no próximo desenho.
              setTimeout(() => botaoEditar.current?.focus(), 0);
            }}
          />
        </section>
      )}

      <div class="sala-grade">
        <div class="sala-coluna">
        <section class="painel pessoa-tarefas" aria-labelledby="titulo-pessoa-tarefas" aria-busy={tarefas === undefined}>
          <h2 id="titulo-pessoa-tarefas">Pendências</h2>
          <NovaTarefa rotulo={`Nova tarefa com ${pessoa.nome}`} salaId={pessoa.salaId} pessoaId={pessoa.id} data={hoje} />
          <AvisoDeApagada conclusoes={conclusoes} />
          {tarefas !== undefined && abertas.length === 0 && (
            <div>
              <p class="lista-vazia-titulo">{`Nada pendente com ${pessoa.nome}.`}</p>
              <p class="lista-vazia-texto">{`As tarefas que o Chat anotar com ${pessoa.nome} aparecem aqui.`}</p>
            </div>
          )}
          <ListaDeTarefas tarefas={dela} salas={salas} hoje={hoje} conclusoes={conclusoes} prefixo="pessoa-tarefas" />
        </section>
        <Notas colecao="pessoas" id={pessoa.id} notas={pessoa.notas} dica={`Anote o que lembrar sobre ${pessoa.nome}.`} />
        </div>

        <div class="sala-coluna">

        <section class="painel por-responder pessoa-emails" aria-labelledby="titulo-pessoa-emails" aria-busy={!lidos && caixa.leitura.falha === null}>
          <h2 id="titulo-pessoa-emails">E-mails</h2>
          <EstadoDosEmails caixa={caixa} />
          <AvisoDeEmail caixa={caixa} />
          {lidos && emails.length === 0 && (
            <div>
              <p class="lista-vazia-titulo">{`Nenhum e-mail de ${pessoa.nome} por responder.`}</p>
              <p class="lista-vazia-texto">
                Quando chegar um e-mail dela, responda à pergunta “De quem é este e-mail?” e ele passa a aparecer aqui.
              </p>
            </div>
          )}
          {emails.length > 0 && <ListaDeEmails itens={emails} caixa={caixa} />}
        </section>

        <Documentos de={`de ${pessoa.nome}`} salaId={pessoa.salaId} pessoaId={pessoa.id} />
        </div>
      </div>
    </div>
  );
}

export function Pessoa({ id }: { id: string }) {
  const pessoa = usePessoa(id);
  if (pessoa === null) {
    return (
      <Pagina titulo="Pessoa não encontrada">
        <p class="aviso">Esta pessoa não existe neste aparelho.</p>
        {/* Apagada com a nota por gravar: o texto que o dono escreveu continua aqui. */}
        {notasPorGuardar('pessoas', id) !== undefined && <Notas colecao="pessoas" id={id} notas={undefined} dica="Notas" apagado />}
        <p>
          <a class="botao-link" href={hrefDe('salas')}>
            Ver as salas
          </a>
        </p>
      </Pagina>
    );
  }
  return <Pagina titulo={pessoa?.nome ?? 'Pessoa'}>{pessoa && <ConteudoDaPessoa pessoa={pessoa} />}</Pagina>;
}
