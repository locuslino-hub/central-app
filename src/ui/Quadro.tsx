// Quadro (menu "Ver"): uma coluna por sala, com os e-mails por responder, os
// compromissos do Google Agenda e as tarefas abertas daquela sala. Só leitura
// de e-mail e agenda: a Central nunca envia nem altera e-mail.
//
// Filtros: Tudo (o que está aberto e os próximos 14 dias), Esta semana (de
// segunda a domingo) e Só e-mails.
// Telas: no computador e no tablet as colunas ficam lado a lado, numa área que
// rola para o lado; no celular ficam empilhadas, cada uma abrindo e fechando
// pelo cabeçalho (rolar de lado com o dedo esconde as salas vizinhas).
import { useEffect, useMemo, useState } from 'preact/hooks';
import { segundaDaSemana, somarDias } from '../chat/datas';
import { montarCalendario, type Item } from '../dados/calendario';
import type { Sala, Tarefa } from '../dados/tipos';
import { hrefDe } from '../rotas';
import { AvisoDaAgenda } from './AvisoDaAgenda';
import { useDetalheDoEvento } from './DetalheEvento';
import { useAgora, useDia, useSalas, useTarefas, useTela } from './hooks';
import { ItemDeAgenda } from './ItemDeAgenda';
import { AvisoDeApagada, useConclusoes } from './LinhaDeTarefa';
import { ListaDeTarefas } from './ListaDeTarefas';
import { corDaSala } from './Menu';
import { nEmails, nTarefas } from './plural';
import { AvisoDeEmail, EstadoDosEmails, ListaDeEmails } from './PorResponder';
import { nomeDoDia } from './quando';
import { useSalaDoEvento, type SalaDoEvento } from './useAdivinharSala';
import { useCaixaDeEmails, type ItemDeEmail } from './useEmails';
import { useEventos } from './useEventos';
import './emails.css';
import './quadro.css';
import './salas.css';

export type FiltroDoQuadro = 'tudo' | 'semana' | 'emails';

const FILTROS: readonly { id: FiltroDoQuadro; nome: string }[] = [
  { id: 'tudo', nome: 'Tudo' },
  { id: 'semana', nome: 'Esta semana' },
  { id: 'emails', nome: 'Só e-mails' },
];

/** Quantos dias à frente o filtro Tudo olha em busca de compromissos. */
export const DIAS_DO_QUADRO = 14;

const SEM_SALA = 'sem-sala';
const nCompromissos = (n: number) => `${n} ${n === 1 ? 'compromisso' : 'compromissos'}`;

type Periodo = { segunda: string; domingo: string };

/**
 * A tarefa entra em Esta semana? Tem dia até domingo (as atrasadas entram: ainda
 * pedem atenção), ou está na semana sem dia fixo. Sem prazo e dias depois ficam fora.
 */
export function tarefaDaSemana(tarefa: Tarefa, { segunda, domingo }: Periodo): boolean {
  if (tarefa.data !== undefined) return tarefa.data <= domingo;
  if (tarefa.semana !== undefined) return tarefa.semana <= segunda;
  return false;
}

/** O e-mail chegou nesta semana? A data do e-mail já vem com a hora de Lisboa. */
export function emailDaSemana(item: ItemDeEmail, { segunda, domingo }: Periodo): boolean {
  const dia = item.email.data.slice(0, 10);
  return dia >= segunda && dia <= domingo;
}

type Coluna = {
  sala: Sala | null;
  id: string;
  nome: string;
  tarefas: Tarefa[];
  /** Todas as tarefas da sala, abertas ou concluídas agora (a lista esconde as feitas). */
  paraLista: Tarefa[];
  emails: ItemDeEmail[];
  dias: { dia: string; itens: Item[] }[];
  compromissos: number;
};

function Cabecalho({ coluna }: { coluna: Coluna }) {
  const partes = [
    coluna.tarefas.length > 0 ? nTarefas(coluna.tarefas.length) : null,
    coluna.compromissos > 0 ? nCompromissos(coluna.compromissos) : null,
    coluna.emails.length > 0 ? nEmails(coluna.emails.length) : null,
  ].filter((p): p is string => p !== null);
  return <span class="quadro-conta">{partes.length === 0 ? 'Nada' : partes.join(' · ')}</span>;
}

type CorpoProps = {
  coluna: Coluna;
  filtro: FiltroDoQuadro;
  carregando: boolean;
  salas: Sala[];
  hoje: string;
  caixa: ReturnType<typeof useCaixaDeEmails>;
  conclusoes: ReturnType<typeof useConclusoes>;
  aoAbrir: Parameters<typeof ItemDeAgenda>[0]['aoAbrir'];
  salaDoEvento: SalaDoEvento;
};

function CorpoDaColuna({ coluna, filtro, carregando, salas, hoje, caixa, conclusoes, aoAbrir, salaDoEvento }: CorpoProps) {
  const mostrarAgenda = filtro !== 'emails';
  const vazia = coluna.tarefas.length === 0 && coluna.emails.length === 0 && (!mostrarAgenda || coluna.compromissos === 0);
  const idBase = `quadro-${coluna.id}`;
  return (
    <div class="quadro-corpo">
      {vazia && !carregando && <p class="quadro-vazio">{filtro === 'emails' ? 'Nenhum e-mail nesta sala.' : 'Nada nesta sala.'}</p>}

      {mostrarAgenda && coluna.compromissos > 0 && (
        <section aria-labelledby={`${idBase}-agenda`}>
          <h3 id={`${idBase}-agenda`} class="quadro-secao">
            Compromissos
          </h3>
          {coluna.dias.map(({ dia, itens }) => (
            <div class="sala-dia" key={dia}>
              <h4 class="sala-dia-titulo">{nomeDoDia(dia, hoje)}</h4>
              <ul class="cal-lista">
                {itens.map((item) => (
                  <ItemDeAgenda key={item.chave} item={item} salas={salas} aoAbrir={aoAbrir} salaDoEvento={salaDoEvento} />
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      {mostrarAgenda && coluna.tarefas.length > 0 && (
        <section aria-labelledby={`${idBase}-tarefas`}>
          <h3 id={`${idBase}-tarefas`} class="quadro-secao">
            Tarefas
          </h3>
          <ListaDeTarefas tarefas={coluna.paraLista} salas={salas} hoje={hoje} conclusoes={conclusoes} prefixo={`${idBase}-t`} />
        </section>
      )}

      {coluna.emails.length > 0 && (
        <section aria-labelledby={`${idBase}-emails`}>
          <h3 id={`${idBase}-emails`} class="quadro-secao">
            E-mails
          </h3>
          <ListaDeEmails itens={coluna.emails} caixa={caixa} />
        </section>
      )}
    </div>
  );
}

export function Quadro() {
  const hoje = useDia();
  const agora = useAgora();
  const tela = useTela();
  const salas = useSalas();
  const tarefas = useTarefas();
  const conclusoes = useConclusoes();
  const caixa = useCaixaDeEmails();
  const [filtro, setFiltro] = useState<FiltroDoQuadro>('tudo');
  const [escolhas, setEscolhas] = useState<Record<string, boolean>>({});
  const salaDoEvento = useSalaDoEvento();

  const segunda = segundaDaSemana(hoje);
  const periodo: Periodo = { segunda, domingo: somarDias(segunda, 6) };
  const ate = somarDias(hoje, DIAS_DO_QUADRO - 1);
  const { leitura, atualizar } = useEventos(segunda, ate);
  const { abrir, detalhe } = useDetalheDoEvento(salas, hoje);

  const calendario = useMemo(
    () => montarCalendario({ eventos: leitura.eventos, tarefas: [], de: segunda, ate, agora }),
    [leitura.eventos, segunda, ate, agora],
  );

  const colunas: Coluna[] = useMemo(() => {
    const vivas = (tarefas ?? []).filter((t) => !t.apagado);
    const emails = caixa.itens ?? [];
    const daSala = (sala: Sala | null): Coluna => {
      const idSala = sala?.id ?? null;
      // Só e-mails: tarefas e compromissos não entram nem na conta nem na lista.
      const paraLista =
        filtro === 'emails' ? [] : vivas.filter((t) => (t.salaId ?? null) === idSala && (filtro !== 'semana' || tarefaDaSemana(t, periodo)));
      const dias: Coluna['dias'] = [];
      if (sala && filtro !== 'emails') {
        // Tudo olha para a frente, a partir de hoje; Esta semana mostra a semana inteira, com o que já passou.
        const primeiro = filtro === 'semana' ? segunda : hoje;
        const ultimo = filtro === 'semana' ? periodo.domingo : ate;
        for (let dia = primeiro; dia <= ultimo; dia = somarDias(dia, 1)) {
          const { diaInteiro, horarios } = calendario.dia(dia);
          const itens = [...diaInteiro, ...horarios].filter(
            (item) => item.tipo === 'evento' && salaDoEvento(item.evento) === sala.id && (filtro === 'semana' || !item.passado),
          );
          if (itens.length > 0) dias.push({ dia, itens });
        }
      }
      return {
        sala,
        id: sala?.id ?? SEM_SALA,
        nome: sala?.nome ?? 'Sem sala',
        paraLista,
        tarefas: paraLista.filter((t) => !t.feito),
        emails: emails.filter((e) => (e.origem.salaId ?? null) === idSala && (filtro !== 'semana' || emailDaSemana(e, periodo))),
        dias,
        compromissos: dias.reduce((soma, { itens }) => soma + itens.length, 0),
      };
    };
    const todas = salas.map((sala) => daSala(sala));
    // "Sem sala" só existe quando há e-mail ou tarefa sem sala para mostrar.
    const sem = daSala(null);
    const mostrarSem = sem.emails.length > 0 || (filtro !== 'emails' && sem.tarefas.length > 0);
    return mostrarSem ? [...todas, sem] : todas;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salas, tarefas, caixa.itens, calendario, filtro, hoje, segunda, ate, salaDoEvento]);

  const carregando = tarefas === undefined || caixa.itens === undefined;
  const empilhado = tela === 'celular';
  // No celular, a primeira coluna com algo vem aberta de partida; as outras, um toque. A escolha
  // é feita uma vez, quando a leitura termina, e não muda mais ao trocar de filtro.
  const pronto = !carregando && (leitura.lidoEm !== null || leitura.falha !== null);
  const [inicial, setInicial] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (inicial === undefined && pronto) {
      setInicial(colunas.find((c) => c.tarefas.length + c.emails.length + c.compromissos > 0)?.id ?? null);
    }
  }, [inicial, pronto, colunas]);
  const aberta = (id: string) => escolhas[id] ?? id === inicial;

  const props = { filtro, carregando, salas, hoje, caixa, conclusoes, aoAbrir: abrir, salaDoEvento };

  return (
    <div class="quadro" data-modo={empilhado ? 'pilha' : 'colunas'}>
      <div class="email-filtros quadro-filtros" role="group" aria-label="Filtro do quadro">
        {FILTROS.map(({ id, nome }) => (
          <button key={id} type="button" class="email-filtro" aria-pressed={filtro === id} onClick={() => setFiltro(id)}>
            {nome}
          </button>
        ))}
      </div>

      {filtro !== 'emails' && <AvisoDaAgenda leitura={leitura} aoTentar={atualizar} />}
      <EstadoDosEmails caixa={caixa} />
      <AvisoDeEmail caixa={caixa} />
      <AvisoDeApagada conclusoes={conclusoes} />

      {empilhado ? (
        <div class="quadro-pilha">
          {colunas.map((coluna) => {
            const idNome = `quadro-nome-${coluna.id}`;
            const idCorpo = `quadro-corpo-${coluna.id}`;
            const aberto = aberta(coluna.id);
            return (
              <section
                key={coluna.id}
                class={`quadro-coluna ${corDaSala(coluna.id)}`}
                aria-labelledby={idNome}
                aria-busy={carregando}
              >
                <h2 class="quadro-topo">
                  <button
                    type="button"
                    class="quadro-alternar"
                    aria-expanded={aberto}
                    aria-controls={idCorpo}
                    onClick={() => setEscolhas({ ...escolhas, [coluna.id]: !aberto })}
                  >
                    <span id={idNome} class="quadro-nome">
                      {coluna.nome}
                    </span>
                    <Cabecalho coluna={coluna} />
                  </button>
                </h2>
                <div id={idCorpo} hidden={!aberto}>
                  {aberto && (
                    <>
                      {coluna.sala && (
                        <a class="botao-link quadro-ir" href={hrefDe('sala', coluna.sala.id)}>
                          {`Abrir a sala ${coluna.nome}`}
                        </a>
                      )}
                      <CorpoDaColuna coluna={coluna} {...props} />
                    </>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div class="quadro-colunas" role="region" aria-label="Colunas das salas" tabIndex={0}>
          {colunas.map((coluna) => {
            const idNome = `quadro-nome-${coluna.id}`;
            return (
              <section
                key={coluna.id}
                class={`quadro-coluna ${corDaSala(coluna.id)}`}
                aria-labelledby={idNome}
                aria-busy={carregando}
              >
                <h2 class="quadro-topo">
                  {coluna.sala ? (
                    <a id={idNome} class="quadro-nome" href={hrefDe('sala', coluna.sala.id)}>
                      {coluna.nome}
                    </a>
                  ) : (
                    <span id={idNome} class="quadro-nome">
                      {coluna.nome}
                    </span>
                  )}
                  <Cabecalho coluna={coluna} />
                </h2>
                <CorpoDaColuna coluna={coluna} {...props} />
              </section>
            );
          })}
        </div>
      )}
      {detalhe}
    </div>
  );
}
