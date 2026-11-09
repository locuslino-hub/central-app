// A página de uma sala (spec, seção 7): o que está aberto nela, os próximos
// compromissos, as pessoas, os e-mails por responder, as notas e os documentos.
// O alto resume tudo numa faixa na cor da sala; embaixo, um cartão por assunto.
import { useMemo } from 'preact/hooks';
import { somarDias } from '../chat/datas';
import { montarCalendario, type Item } from '../dados/calendario';
import type { Pessoa, Sala as SalaDoApp, Tarefa } from '../dados/tipos';
import { hrefDe } from '../rotas';
import { AvisoDaAgenda } from './AvisoDaAgenda';
import { pendenteHoje } from './CaixasSalas';
import { useDetalheDoEvento } from './DetalheEvento';
import { Caderno } from './Caderno';
import { Documentos } from './Documentos';
import { useAgora, useDia, usePessoas, useSala, useSalas, useTarefas } from './hooks';
import { ItemDeAgenda } from './ItemDeAgenda';
import { AvisoDeApagada, useConclusoes } from './LinhaDeTarefa';
import { ListaDeTarefas } from './ListaDeTarefas';
import { corDaSala } from './Menu';
import { Notas } from './Notas';
import { NovaTarefa } from './NovaTarefa';
import { Pagina } from './Pagina';
import { juntar, nEmails, nTarefas } from './plural';
import { AvisoDeEmail, EstadoDosEmails, ListaDeEmails } from './PorResponder';
import { nomeDoDia } from './quando';
import { useCaixaDeEmails } from './useEmails';
import { useEventos } from './useEventos';
import './salas.css';

/** Quantos dias à frente a sala olha em busca de compromissos. */
export const DIAS_DE_COMPROMISSOS = 14;
/** Quantos compromissos a sala mostra; o resto fica na Semana. */
const COMPROMISSOS_NA_SALA = 8;

const nCompromissos = (n: number) => `${n} ${n === 1 ? 'compromisso' : 'compromissos'}`;
const nPessoas = (n: number) => `${n} ${n === 1 ? 'pessoa' : 'pessoas'}`;

/** "2 tarefas · 1 e-mail": o que uma pessoa tem em aberto, para o painel dela. */
export function contaDaPessoa(tarefas: number, emails: number): string {
  const partes = [...(tarefas > 0 ? [nTarefas(tarefas)] : []), ...(emails > 0 ? [nEmails(emails)] : [])];
  return partes.length === 0 ? 'Nada em aberto' : partes.join(' · ');
}

type PainelProps = { pessoa: Pessoa; tarefas: number; emails: number };

/** O painel clicável de uma pessoa: o cartão todo leva à página dela. */
function PainelDaPessoa({ pessoa, tarefas, emails }: PainelProps) {
  return (
    <li>
      <a class="pessoa-painel" href={hrefDe('pessoa', pessoa.id)}>
        <span class="pessoa-painel-nome">{pessoa.nome}</span>
        {pessoa.papel && <span class="pessoa-painel-papel">{pessoa.papel}</span>}
        <span class="pessoa-painel-conta">{contaDaPessoa(tarefas, emails)}</span>
      </a>
    </li>
  );
}

function ConteudoDaSala({ sala }: { sala: SalaDoApp }) {
  const hoje = useDia();
  const agora = useAgora();
  const salas = useSalas();
  const tarefas = useTarefas();
  const pessoas = usePessoas();
  const conclusoes = useConclusoes();
  const caixa = useCaixaDeEmails();
  const ate = somarDias(hoje, DIAS_DE_COMPROMISSOS - 1);
  const { leitura, atualizar } = useEventos(hoje, ate);
  const { abrir, detalhe } = useDetalheDoEvento(salas, hoje);

  const daSala = (tarefas ?? []).filter((t: Tarefa) => t.salaId === sala.id && !t.apagado);
  const abertas = daSala.filter((t) => !t.feito);
  const paraHoje = abertas.filter((t) => pendenteHoje(t, hoje)).length;
  const paraDepois = abertas.length - paraHoje;
  const dasPessoas = (pessoas ?? [])
    .filter((p) => p.salaId === sala.id && !p.apagado)
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  // Compromissos: só os desta sala, ainda por vir, dia a dia.
  const dias = useMemo(() => {
    const calendario = montarCalendario({
      eventos: leitura.eventos.filter((e) => e.salaId === sala.id),
      tarefas: [],
      de: hoje,
      ate,
      agora,
    });
    const lista: { dia: string; itens: Item[] }[] = [];
    for (let dia = hoje; dia <= ate; dia = somarDias(dia, 1)) {
      const { diaInteiro, horarios } = calendario.dia(dia);
      const itens = [...diaInteiro, ...horarios].filter((item) => !item.passado);
      if (itens.length > 0) lista.push({ dia, itens });
    }
    return lista;
  }, [leitura.eventos, sala.id, hoje, ate, agora]);
  const totalDeCompromissos = dias.reduce((soma, { itens }) => soma + itens.length, 0);
  let restam = COMPROMISSOS_NA_SALA;
  const visiveis = dias
    .map(({ dia, itens }) => {
      const cabem = itens.slice(0, Math.max(0, restam));
      restam -= cabem.length;
      return { dia, itens: cabem };
    })
    .filter(({ itens }) => itens.length > 0);
  const agendaLida = leitura.lidoEm !== null;

  const emailsDaSala = (caixa.itens ?? []).filter((item) => item.origem.salaId === sala.id);
  const emailsDe = (pessoaId: string) => (caixa.itens ?? []).filter((item) => item.origem.pessoa?.id === pessoaId).length;
  const tarefasDe = (pessoaId: string) => abertas.filter((t) => t.pessoaId === pessoaId).length;

  const resumo = [
    tarefas === undefined ? null : paraHoje > 0 ? `${nTarefas(paraHoje)} ${paraHoje === 1 ? 'pendente' : 'pendentes'}` : 'Nada pendente hoje',
    paraDepois > 0 ? `${nTarefas(paraDepois)} para depois` : null,
    emailsDaSala.length > 0 ? `${nEmails(emailsDaSala.length)} por responder` : null,
    agendaLida && totalDeCompromissos > 0 ? `${nCompromissos(totalDeCompromissos)} nos próximos ${DIAS_DE_COMPROMISSOS} dias` : null,
  ].filter((parte): parte is string => parte !== null);

  return (
    <div class={`sala-pagina ${corDaSala(sala.id)}`}>
      <p class="sala-faixa">
        {resumo.length === 0 ? ' ' : `${juntar(resumo)}.`}
      </p>

      <div class="sala-grade">
        <div class="sala-coluna">
        <section class="painel sala-tarefas" aria-labelledby="titulo-sala-tarefas" aria-busy={tarefas === undefined}>
          <h2 id="titulo-sala-tarefas">Tarefas</h2>
          <NovaTarefa rotulo={`Nova tarefa em ${sala.nome}`} salaId={sala.id} />
          <AvisoDeApagada conclusoes={conclusoes} />
          {tarefas !== undefined && abertas.length === 0 && (
            <div>
              <p class="lista-vazia-titulo">Nada em aberto nesta sala.</p>
              <p class="lista-vazia-texto">O que você anotar para {sala.nome} no Chat aparece aqui.</p>
            </div>
          )}
          <ListaDeTarefas tarefas={daSala} salas={salas} hoje={hoje} conclusoes={conclusoes} prefixo="sala-tarefas" />
        </section>
        <Notas colecao="salas" id={sala.id} notas={sala.notas} dica={`Anote o que não pode esquecer sobre ${sala.nome}.`} />
        </div>

        <div class="sala-coluna">

        <section
          class="painel sala-compromissos"
          aria-labelledby="titulo-sala-compromissos"
          aria-busy={!agendaLida && leitura.falha === null}
        >
          <h2 id="titulo-sala-compromissos">Próximos compromissos</h2>
          <AvisoDaAgenda leitura={leitura} aoTentar={atualizar} />
          {agendaLida && visiveis.length === 0 && (
            <div>
              <p class="lista-vazia-titulo">{`Nada marcado nos próximos ${DIAS_DE_COMPROMISSOS} dias.`}</p>
              <p class="lista-vazia-texto">Os compromissos do Google Agenda desta sala aparecem aqui.</p>
            </div>
          )}
          {visiveis.map(({ dia, itens }) => (
            <div class="sala-dia" key={dia}>
              <h3 class="sala-dia-titulo">{nomeDoDia(dia, hoje)}</h3>
              <ul class="cal-lista">
                {itens.map((item) => (
                  <ItemDeAgenda key={item.chave} item={item} salas={salas} aoAbrir={abrir} />
                ))}
              </ul>
            </div>
          ))}
          {totalDeCompromissos > COMPROMISSOS_NA_SALA && (
            <p class="sala-mais">
              <a class="botao-link" href="#/semana">
                Ver a semana
              </a>
            </p>
          )}
          {detalhe}
        </section>

        <section class="painel sala-pessoas" aria-labelledby="titulo-sala-pessoas" aria-busy={pessoas === undefined}>
          <h2 id="titulo-sala-pessoas">Pessoas</h2>
          {pessoas !== undefined && dasPessoas.length === 0 && (
            <div>
              <p class="lista-vazia-titulo">Ninguém cadastrado nesta sala.</p>
              <p class="lista-vazia-texto">
                <a class="botao-link" href={hrefDe('salas')}>
                  Cadastrar pessoa
                </a>
              </p>
            </div>
          )}
          {dasPessoas.length > 0 && (
            <ul class="pessoas-paineis" aria-label={nPessoas(dasPessoas.length)}>
              {dasPessoas.map((pessoa) => (
                <PainelDaPessoa key={pessoa.id} pessoa={pessoa} tarefas={tarefasDe(pessoa.id)} emails={emailsDe(pessoa.id)} />
              ))}
            </ul>
          )}
        </section>

        {emailsDaSala.length > 0 && (
          <section class="painel por-responder sala-emails" aria-labelledby="titulo-sala-emails">
            <h2 id="titulo-sala-emails">Por responder</h2>
            <EstadoDosEmails caixa={caixa} />
            <AvisoDeEmail caixa={caixa} />
            <ListaDeEmails itens={emailsDaSala} caixa={caixa} />
          </section>
        )}

        <Documentos de="desta sala" salaId={sala.id} />
        </div>
      </div>
      <Caderno salaId={sala.id} nomeDaSala={sala.nome} />
    </div>
  );
}

export function Sala({ id }: { id: string }) {
  const sala = useSala(id);
  if (sala === null) {
    return (
      <Pagina titulo="Sala não encontrada">
        <p class="aviso">Esta sala não existe neste aparelho.</p>
        <p>
          <a class="botao-link" href={hrefDe('salas')}>
            Ver as salas
          </a>
        </p>
      </Pagina>
    );
  }
  return <Pagina titulo={sala?.nome ?? 'Sala'}>{sala && <ConteudoDaSala sala={sala} />}</Pagina>;
}
