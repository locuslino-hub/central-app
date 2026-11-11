// Fechar o dia (spec, seção 8): mostra o que ficou, com ação para tarefas e
// e-mails, e termina num passo final de conclusão. Tudo tem Desfazer.
//   - Tarefa que ficou: Amanhã, Sem prazo (sem hora) ou Feita. Tarefa com
//     prazo não anda sozinha: Mudar prazo ou Feita.
//   - E-mail sem resposta: Agora não (volta amanhã) ou Feito. Nada muda no Gmail.
//   - Uma ação em lote por coluna ("Passar as 3 para amanhã", "Adiar os 2 e-mails").
//   - Passo final, a única ação principal: o dia fica fechado (nos ajustes, que
//     sincronizam). O que ficar aberto volta amanhã sozinho, pela virada do dia.
// Fica no fim do Painel do dia e numa aba do Agora.
import { useEffect, useRef, useState } from 'preact/hooks';
import { somarDias } from '../chat/datas';
import { EmParte, type Desfazivel } from '../dados/desfazer';
import type { Email } from '../dados/emails';
import { adiarEmail, adiarEmails, concluirEmail } from '../dados/emails-estado';
import { fecharDia, reabrirDia } from '../dados/fechar-dia';
import { concluirTarefa, moverTarefa, moverTarefas, mudarPrazo } from '../dados/tarefas';
import type { Sala, Tarefa } from '../dados/tipos';
import { AvisoDasAcoes, useAcoes, useMarcar, type Acoes } from './Acoes';
import { corDaSala } from './Menu';
import { contar, juntar, nEmails, nTarefas } from './plural';
import { quandoChegou } from './PorResponder';
import { daChecklist, porOrdem, quandoNaLista } from './tarefas-lista';
import type { AgoraDoDia } from './useAgoraDoDia';
import { useVerTudo } from './VerTudo';
import './painel.css';
import './tarefas.css';

const NADA = new Set<string>();

/** Ação em lote: se parou no meio, o que andou fica com Desfazer, e o aviso diz o que faltou. */
async function emLoteComAviso(fazer: () => Promise<Desfazivel | undefined>) {
  try {
    const entrada = await fazer();
    return entrada && { texto: entrada.rotulo, entrada };
  } catch (erro) {
    if (!(erro instanceof EmParte)) throw erro;
    console.error('Só parte foi feita', erro.causa);
    return { texto: `${erro.entrada.rotulo}. O resto não deu certo; tente de novo.`, entrada: erro.entrada };
  }
}

const comDesfazer = async (fazer: () => Promise<Desfazivel | undefined>) => {
  const entrada = await fazer();
  return entrada && { texto: entrada.rotulo, entrada };
};

// ---- Mudar prazo ----

type PrazoProps = { tarefa: Tarefa; hoje: string; acoes: Acoes; aoFechar: () => void };

/** Dia e hora do novo prazo. Esc ou Cancelar fecham e o foco volta ao "Mudar prazo". */
function MudarPrazo({ tarefa, hoje, acoes, aoFechar }: PrazoProps) {
  const [dia, setDia] = useState(tarefa.data && tarefa.data >= hoje ? tarefa.data : hoje);
  const [hora, setHora] = useState(tarefa.prazoHora ?? '');
  const [erro, setErro] = useState<string | null>(null);
  const campo = useRef<HTMLInputElement>(null);
  const id = `prazo-${tarefa.id}`;

  useEffect(() => {
    campo.current?.focus();
  }, []);

  function salvar(evento: Event) {
    evento.preventDefault();
    if (!dia || dia < hoje) return setErro('Escolha hoje ou um dia depois.');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) return setErro('Escolha a hora do prazo.');
    void acoes.agir(async () => {
      const entrada = await mudarPrazo(tarefa.id, dia, hora);
      if (!entrada) throw new Error('Prazo não mudou');
      aoFechar();
      return { texto: entrada.rotulo, entrada };
    }, 'Não consegui mudar o prazo. Tente de novo.');
  }

  return (
    <form
      class="fechar-prazo"
      noValidate
      onSubmit={salvar}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          aoFechar();
        }
      }}
    >
      <div class="fechar-prazo-campos">
        <label for={`${id}-dia`}>
          <span>Dia</span>
          <input id={`${id}-dia`} ref={campo} class="campo" type="date" min={hoje} value={dia} onInput={(e) => setDia((e.target as HTMLInputElement).value)} />
        </label>
        <label for={`${id}-hora`}>
          <span>Hora</span>
          <input id={`${id}-hora`} class="campo" type="time" value={hora} onInput={(e) => setHora((e.target as HTMLInputElement).value)} />
        </label>
      </div>
      {erro && (
        <p class="tarefa-erro" role="alert">
          {erro}
        </p>
      )}
      <div class="fechar-prazo-acoes">
        <button type="submit" class="botao">
          Salvar prazo
        </button>
        <button type="button" class="botao-texto" onClick={aoFechar}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

// ---- Uma tarefa que ficou ----

type ItemProps = { tarefa: Tarefa; salas: readonly Sala[]; hoje: string; acoes: Acoes; aoMarcar: (t: Tarefa) => void };

function TarefaQueFicou({ tarefa, salas, hoje, acoes, aoMarcar }: ItemProps) {
  const [prazoAberto, setPrazoAberto] = useState(false);
  const botaoPrazo = useRef<HTMLButtonElement>(null);
  const sala = tarefa.salaId === null ? undefined : salas.find((s) => s.id === tarefa.salaId);
  const quando = quandoNaLista(tarefa, hoje);
  const temPrazo = !!tarefa.prazoHora;
  const atrasada = tarefa.data !== undefined && tarefa.data < hoje;
  const fecharPrazo = () => {
    setPrazoAberto(false);
    botaoPrazo.current?.focus();
  };
  return (
    <li class="fechar-item">
      <div class="fechar-item-texto">
        <span class={`ponto-da-sala ${corDaSala(tarefa.salaId ?? '')}`} role="img" aria-label={`Sala: ${sala ? sala.nome : 'nenhuma'}`} />
        <p class="fechar-item-titulo">
          {tarefa.titulo || '(sem título)'}
          {atrasada && !temPrazo && <span class="fechar-item-quando">{' '}Ficou de antes</span>}
          {quando && <span class="fechar-item-quando">{' '}{quando}</span>}
        </p>
      </div>
      <div class="fechar-acoes" role="group" aria-label={`O que fazer com: ${tarefa.titulo}`}>
        {temPrazo ? (
          <button type="button" class="botao-pilula" ref={botaoPrazo} aria-expanded={prazoAberto} onClick={() => (prazoAberto ? fecharPrazo() : setPrazoAberto(true))}>
            Mudar prazo
          </button>
        ) : (
          <button
            type="button"
            class="botao-pilula"
            onClick={() => void acoes.agir(() => comDesfazer(() => moverTarefa(tarefa.id, { tipo: 'amanha', hoje })), 'Não consegui salvar. Tente de novo.')}
          >
            Amanhã
          </button>
        )}
        {!temPrazo && !tarefa.inicio && (
          <button
            type="button"
            class="botao-texto"
            onClick={() => void acoes.agir(() => comDesfazer(() => moverTarefa(tarefa.id, { tipo: 'sem-prazo' })), 'Não consegui salvar. Tente de novo.')}
          >
            Sem prazo
          </button>
        )}
        <button
          type="button"
          class="botao-texto"
          data-concluir={tarefa.id}
          onClick={() =>
            tarefa.marcar
              ? aoMarcar(tarefa)
              : void acoes.agir(() => comDesfazer(() => concluirTarefa(tarefa.id)), 'Não consegui salvar. Tente de novo.')
          }
        >
          Feita
        </button>
      </div>
      {prazoAberto && <MudarPrazo tarefa={tarefa} hoje={hoje} acoes={acoes} aoFechar={fecharPrazo} />}
    </li>
  );
}

// ---- Um e-mail sem resposta ----

function EmailSemResposta({ email, hoje, acoes }: { email: Email; hoje: string; acoes: Acoes }) {
  const assunto = email.assunto || '(sem assunto)';
  return (
    <li class="fechar-item">
      <div class="fechar-item-texto">
        <p class="fechar-item-titulo">
          {assunto}
          <span class="fechar-item-quando">{' '}{email.remetente || 'Remetente desconhecido'}</span>
          <span class="fechar-item-quando">{' '}{quandoChegou(email.data, hoje)}</span>
        </p>
      </div>
      <div class="fechar-acoes" role="group" aria-label={`O que fazer com: ${assunto}`}>
        <button
          type="button"
          class="botao-texto"
          onClick={() =>
            void acoes.agir(async () => {
              const entrada = await adiarEmail(email.id, hoje);
              return { texto: entrada.rotulo, entrada };
            }, 'Não consegui adiar. Tente de novo.')
          }
        >
          Agora não
        </button>
        <button
          type="button"
          class="botao-texto"
          onClick={() =>
            void acoes.agir(async () => {
              const entrada = await concluirEmail(email.id);
              return { texto: entrada.rotulo, entrada };
            }, 'Não consegui marcar como feito. Tente de novo.')
          }
        >
          Feito
        </button>
      </div>
    </li>
  );
}

// ---- Amanhã (só mostra) ----

/** A prévia é só uma olhada: passando disto, diz quantas ficam de fora. */
const MAX_NA_PREVIA = 5;

/** O que vai para amanhã: as que ficaram e voltam sozinhas (prazo de hora não anda) e as que já são de amanhã. */
function previaDeAmanha(tarefas: readonly Tarefa[] | undefined, hoje: string, voltam: readonly Tarefa[]): Tarefa[] {
  const amanha = somarDias(hoje, 1);
  const jaMarcadas = (tarefas ?? []).filter((t) => !t.feito && t.data === amanha);
  return [...voltam, ...jaMarcadas].sort(porOrdem);
}

// ---- O cartão ----

type Props = { dia: AgoraDoDia; salas: readonly Sala[] };

export function FecharDia({ dia, salas }: Props) {
  const { hoje, fechado } = dia;
  const acoes = useAcoes();
  const base = useRef<HTMLElement>(null);
  const marcar = useMarcar(hoje, acoes, base);
  /** O fechamento feito agora, nesta tela: o botão é Desfazer. Aberto de novo, é Reabrir o dia. */
  const [fecho, setFecho] = useState<Desfazivel | null>(null);
  const [erroDoFecho, setErroDoFecho] = useState<string | null>(null);
  const botaoFinal = useRef<HTMLButtonElement>(null);
  const botaoReabrir = useRef<HTMLButtonElement>(null);
  const focar = useRef<'final' | 'reabrir' | null>(null);

  const deHoje = (dia.tarefas ?? []).filter((t) => daChecklist(t, hoje, NADA));
  const feitas = deHoje.filter((t) => t.feito).length;
  const ficaram = deHoje.filter((t) => !t.feito).sort(porOrdem);
  // O prazo não anda em lote: fica com o seu dia até o dono mudar.
  const passam = ficaram.filter((t) => !t.prazoHora);
  const emails = (dia.fila ?? []).filter((item) => item.tipo === 'email' && item.email).map((item) => item.email!);
  const emailsLidos = dia.emails.lidoEm !== null;
  const amanha = previaDeAmanha(dia.tarefas, hoje, passam);
  const verTarefas = useVerTudo(ficaram.length);
  const verEmails = useVerTudo(emails.length);

  // O botão em que o dono tocou sumiu (fechar troca o passo final pelo "Dia fechado", e vice-versa).
  useEffect(() => {
    if (focar.current === 'reabrir') botaoReabrir.current?.focus();
    if (focar.current === 'final') botaoFinal.current?.focus();
    focar.current = null;
  }, [fechado]);

  const resumo = juntar([
    contar(feitas, 'tarefa feita', 'tarefas feitas'),
    `${ficaram.length} em aberto`,
    ...(emailsLidos ? [emails.length === 0 ? 'nenhum e-mail sem resposta' : `${nEmails(emails.length)} sem resposta`] : []),
  ]);

  async function fechar() {
    setErroDoFecho(null);
    focar.current = 'reabrir';
    try {
      const entrada = await fecharDia(hoje);
      acoes.limpar(); // o aviso da última ação não volta ao reabrir
      setFecho(entrada);
    } catch (falha) {
      focar.current = null;
      console.error('Não consegui fechar o dia', falha);
      setErroDoFecho('Não consegui fechar o dia. Tente de novo.');
    }
  }

  async function reabrir() {
    setErroDoFecho(null);
    focar.current = 'final';
    try {
      if (fecho) await fecho.reverter();
      else await reabrirDia();
      setFecho(null);
    } catch (falha) {
      focar.current = null;
      console.error('Não consegui reabrir o dia', falha);
      setErroDoFecho('Não consegui reabrir o dia. Tente de novo.');
    }
  }

  return (
    <section class="painel fechar-dia" ref={base} aria-labelledby="titulo-fechar-o-dia" aria-busy={dia.tarefas === undefined}>
      <h2 id="titulo-fechar-o-dia">Fechar o dia</h2>
      <p class="fechar-resumo">{`Hoje: ${resumo}.`}</p>

      {fechado ? (
        <div class="fechar-fechado" role="status">
          <p class="fechar-fechado-titulo">Dia fechado.</p>
          <p>
            {feitas === 0 ? 'Nenhuma tarefa concluída hoje.' : `Você concluiu ${nTarefas(feitas)} hoje.`}
            {ficaram.length > 0 && ` ${nTarefas(ficaram.length)} ${ficaram.length === 1 ? 'volta' : 'voltam'} amanhã.`}
          </p>
          <button type="button" class="tarefa-desfazer" ref={botaoReabrir} onClick={() => void reabrir()}>
            {fecho ? 'Desfazer' : 'Reabrir o dia'}
          </button>
        </div>
      ) : (
        <>
          <AvisoDasAcoes acoes={acoes} />
          <div class="fechar-corpo">
          <div class="fechar-colunas">
          <div class="fechar-grupos">
            <div class="fechar-grupo">
              <div class="fechar-grupo-topo">
                <h3 id="fechar-tarefas">Tarefas que ficaram</h3>
                {passam.length >= 2 && (
                  <button
                    type="button"
                    class="botao fechar-lote"
                    onClick={() =>
                      void acoes.agir(
                        () => emLoteComAviso(() => moverTarefas(passam.map((t) => t.id), { tipo: 'amanha', hoje })),
                        'Não consegui salvar. Tente de novo.',
                      )
                    }
                  >
                    {`Passar as ${passam.length} para amanhã`}
                  </button>
                )}
              </div>
              {dia.tarefas !== undefined && ficaram.length === 0 && <p class="lista-vazia-texto">Nenhuma tarefa ficou para trás.</p>}
              {ficaram.length > 0 && (
                <ul class="fechar-lista" aria-labelledby="fechar-tarefas">
                  {ficaram.slice(0, verTarefas.mostrar).map((tarefa) => (
                    <TarefaQueFicou key={tarefa.id} tarefa={tarefa} salas={salas} hoje={hoje} acoes={acoes} aoMarcar={marcar.abrir} />
                  ))}
                </ul>
              )}
              {verTarefas.botao}
            </div>

            <div class="fechar-grupo">
              <div class="fechar-grupo-topo">
                <h3 id="fechar-emails">E-mails sem resposta</h3>
                {emails.length >= 2 && (
                  <button
                    type="button"
                    class="botao fechar-lote"
                    onClick={() =>
                      void acoes.agir(
                        () => emLoteComAviso(() => adiarEmails(emails.map((e) => e.id), hoje)),
                        'Não consegui adiar. Tente de novo.',
                      )
                    }
                  >
                    {`Adiar os ${emails.length} e-mails`}
                  </button>
                )}
              </div>
              {!emailsLidos && <p class="lista-vazia-texto">Os e-mails ainda não carregaram.</p>}
              {emailsLidos && emails.length === 0 && <p class="lista-vazia-texto">Nenhum e-mail esperando resposta.</p>}
              {emails.length > 0 && (
                <ul class="fechar-lista" aria-labelledby="fechar-emails">
                  {emails.slice(0, verEmails.mostrar).map((email) => (
                    <EmailSemResposta key={email.id} email={email} hoje={hoje} acoes={acoes} />
                  ))}
                </ul>
              )}
              {verEmails.botao}
            </div>
          </div>

          <div class="fechar-grupo fechar-amanha">
            <div class="fechar-grupo-topo">
              <h3 id="fechar-amanha">Amanhã</h3>
              {amanha.length > 0 && <span class="fechar-amanha-conta">{nTarefas(amanha.length)}</span>}
            </div>
            {dia.tarefas !== undefined && amanha.length === 0 && <p class="lista-vazia-texto">Nada marcado para amanhã.</p>}
            {amanha.length > 0 && (
              <ul class="fechar-lista fechar-lista-amanha" aria-labelledby="fechar-amanha">
                {amanha.slice(0, MAX_NA_PREVIA).map((tarefa) => {
                  // Tudo aqui é de amanhã: o dia não se repete; só a hora, quando há.
                  const hora = tarefa.inicio ?? (tarefa.prazoHora ? `até ${tarefa.prazoHora}` : undefined);
                  return (
                    <li key={tarefa.id} class="fechar-item fechar-item-amanha">
                      <div class="fechar-item-texto">
                        <span class={`ponto-da-sala ${corDaSala(tarefa.salaId ?? '')}`} aria-hidden="true" />
                        <p class="fechar-item-titulo">
                          {tarefa.titulo || '(sem título)'}
                          {hora && <span class="fechar-item-quando">{' '}{hora}</span>}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {amanha.length > MAX_NA_PREVIA && <p class="lista-vazia-texto">{`E mais ${amanha.length - MAX_NA_PREVIA}.`}</p>}
          </div>
          </div>
          </div>

          <div class="fechar-final">
            <p>{ficaram.length > 0 || emails.length > 0 ? 'O que ficar em aberto volta amanhã sozinho.' : 'Tudo decidido por hoje.'}</p>
            <button type="button" class="botao primario" ref={botaoFinal} onClick={() => void fechar()}>
              Fechar o dia
            </button>
          </div>
        </>
      )}
      {erroDoFecho && (
        <p class="tarefa-erro" role="alert">
          {erroDoFecho}
        </p>
      )}
      {marcar.caixa}
    </section>
  );
}
