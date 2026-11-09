// Fechar o dia (spec, seção 8): mostra o que ficou, com ação para tarefas e
// e-mails, e termina num passo final de conclusão. Tudo tem Desfazer.
//   - Tarefa que ficou: Amanhã, Sem prazo (se não tem hora) ou Feita.
//   - E-mail sem resposta: Agora não (volta amanhã) ou Feito. Nada muda no Gmail.
//   - Passo final: o dia fica fechado (nos ajustes, que sincronizam). O que
//     ficar aberto volta amanhã sozinho, pela virada do dia.
// Fica no fim do Painel do dia e numa aba do Agora.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Desfazivel } from '../dados/desfazer';
import { adiarEmail, concluirEmail } from '../dados/emails-estado';
import { fecharDia, reabrirDia } from '../dados/fechar-dia';
import { concluirTarefa, moverTarefa, moverTarefas } from '../dados/tarefas';
import type { Sala } from '../dados/tipos';
import { AvisoDasAcoes, useAcoes, useMarcar } from './Acoes';
import { corDaSala } from './Menu';
import { contar, juntar, nEmails, nTarefas } from './plural';
import { quandoChegou } from './PorResponder';
import { daChecklist, porOrdem, quandoNaLista } from './tarefas-lista';
import type { AgoraDoDia } from './useAgoraDoDia';
import './painel.css';
import './tarefas.css';

const NADA = new Set<string>();

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
  const emails = (dia.fila ?? []).filter((item) => item.tipo === 'email' && item.email).map((item) => item.email!);
  const emailsLidos = dia.emails.lidoEm !== null;

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
    try {
      const entrada = await fecharDia(hoje);
      focar.current = 'reabrir';
      setFecho(entrada);
    } catch (falha) {
      console.error('Não consegui fechar o dia', falha);
      setErroDoFecho('Não consegui fechar o dia. Tente de novo.');
    }
  }

  async function reabrir() {
    setErroDoFecho(null);
    try {
      focar.current = 'final';
      if (fecho) await fecho.reverter();
      else await reabrirDia();
      setFecho(null);
    } catch (falha) {
      focar.current = null;
      console.error('Não consegui reabrir o dia', falha);
      setErroDoFecho('Não consegui reabrir o dia. Tente de novo.');
    }
  }

  const acaoDaTarefa = (fazer: () => Promise<Desfazivel | undefined>) =>
    void acoes.agir(async () => {
      const entrada = await fazer();
      return entrada && { texto: entrada.rotulo, entrada };
    }, 'Não consegui salvar. Tente de novo.');

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
          <div class="fechar-grupos">
            <div class="fechar-grupo">
              <div class="fechar-grupo-topo">
                <h3 id="fechar-tarefas">Tarefas que ficaram</h3>
                {ficaram.length >= 2 && (
                  <button
                    type="button"
                    class="tarefa-entendi"
                    onClick={() =>
                      void acoes.agir(async () => {
                        const entrada = await moverTarefas(
                          ficaram.map((t) => t.id),
                          { tipo: 'amanha', hoje },
                        );
                        return entrada && { texto: entrada.rotulo, entrada };
                      }, 'Não consegui salvar. Tente de novo.')
                    }
                  >
                    {`Passar as ${ficaram.length} para amanhã`}
                  </button>
                )}
              </div>
              {dia.tarefas !== undefined && ficaram.length === 0 && <p class="lista-vazia-texto">Nenhuma tarefa ficou para trás.</p>}
              {ficaram.length > 0 && (
                <ul class="fechar-lista" aria-labelledby="fechar-tarefas">
                  {ficaram.map((tarefa) => {
                    const sala = tarefa.salaId === null ? undefined : salas.find((s) => s.id === tarefa.salaId);
                    const quando = quandoNaLista(tarefa, hoje);
                    const temHora = !!(tarefa.inicio || tarefa.prazoHora);
                    return (
                      <li key={tarefa.id} class="fechar-item">
                        <div class="fechar-item-texto">
                          <p class="fechar-item-titulo">{tarefa.titulo || '(sem título)'}</p>
                          <p class="fechar-item-meta">
                            <span class={`etiqueta ${corDaSala(tarefa.salaId ?? '')}`}>{sala ? sala.nome : 'Sem sala'}</span>
                            {tarefa.data !== undefined && tarefa.data < hoje && !temHora && <span>Ficou de antes</span>}
                            {quando && <span>{quando}</span>}
                          </p>
                        </div>
                        <div class="fechar-acoes" role="group" aria-label={`O que fazer com: ${tarefa.titulo}`}>
                          <button type="button" class="botao" onClick={() => acaoDaTarefa(() => moverTarefa(tarefa.id, { tipo: 'amanha', hoje }))}>
                            Amanhã
                          </button>
                          {!temHora && (
                            <button type="button" class="botao" onClick={() => acaoDaTarefa(() => moverTarefa(tarefa.id, { tipo: 'sem-prazo' }))}>
                              Sem prazo
                            </button>
                          )}
                          <button
                            type="button"
                            class="botao"
                            data-concluir={tarefa.id}
                            onClick={() => (tarefa.marcar ? marcar.abrir(tarefa) : acaoDaTarefa(() => concluirTarefa(tarefa.id)))}
                          >
                            Feita
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div class="fechar-grupo">
              <div class="fechar-grupo-topo">
                <h3 id="fechar-emails">E-mails sem resposta</h3>
              </div>
              {!emailsLidos && <p class="lista-vazia-texto">Os e-mails ainda não carregaram.</p>}
              {emailsLidos && emails.length === 0 && <p class="lista-vazia-texto">Nenhum e-mail esperando resposta.</p>}
              {emails.length > 0 && (
                <ul class="fechar-lista" aria-labelledby="fechar-emails">
                  {emails.map((email) => {
                    const assunto = email.assunto || '(sem assunto)';
                    return (
                      <li key={email.id} class="fechar-item">
                        <div class="fechar-item-texto">
                          <p class="fechar-item-titulo">{assunto}</p>
                          <p class="fechar-item-meta">
                            <span>{email.remetente || 'Remetente desconhecido'}</span>
                            <span>{quandoChegou(email.data, hoje)}</span>
                          </p>
                        </div>
                        <div class="fechar-acoes" role="group" aria-label={`O que fazer com: ${assunto}`}>
                          <button
                            type="button"
                            class="botao"
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
                            class="botao"
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
                  })}
                </ul>
              )}
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
