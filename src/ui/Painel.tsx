// Painel do dia (spec, seção 7), nesta ordem, fixa:
//   1. Mensagem do dia.
//   2. Linha horizontal do dia.
//   3. Caixas de pendências das salas.
//   4. Checklist do dia ao lado de Agenda de hoje.
//   5. Por responder ao lado de A seguir.
//   6. Sem prazo.
//   7. Fechar o dia.
// No celular as duplas viram uma coluna, na mesma ordem. Onde não há painel
// direito (celular e tablet), o cartão do Agora vem no alto, antes de tudo.
// A seguir começa depois do destaque do Agora (que está no painel direito ou
// no alto): a mesma tarefa não aparece duas vezes.
import { useMemo } from 'preact/hooks';
import { horaDe, montarCalendario } from '../dados/calendario';
import { minutoEmLisboa } from '../dados/dia';
import { AgendaHoje } from './AgendaHoje';
import { AgoraCurto } from './Agora';
import { ASeguir, textoDoTempoLivre } from './ASeguir';
import { AvisoDaFila } from './AvisoDaFila';
import { AvisosDeConflito } from './AvisosDeConflito';
import { CaixasSalas } from './CaixasSalas';
import { Checklist } from './Checklist';
import { FecharDia } from './FecharDia';
import { usePessoas, useSalas, useTela } from './hooks';
import { LinhaDia } from './LinhaDia';
import { juntar, nEmails, nTarefas } from './plural';
import { PorResponder } from './PorResponder';
import { diaPorExtenso } from './quando';
import { SemPrazo } from './SemPrazo';
import { daChecklist } from './tarefas-lista';
import { useAdivinharSala } from './useAdivinharSala';
import { useAgoraDoDia, type AgoraDoDia } from './useAgoraDoDia';
import './painel.css';
import './tarefas.css';

const NADA = new Set<string>();

/** Pela hora de Lisboa: bom dia das 5h ao meio-dia, boa tarde até as 19h, boa noite no resto. */
export function saudacao(agora: Date): string {
  const hora = Math.floor(minutoEmLisboa(agora) / 60);
  if (hora >= 5 && hora < 12) return 'Bom dia';
  if (hora >= 12 && hora < 19) return 'Boa tarde';
  return 'Boa noite';
}

const minutosDe = (hora: string) => {
  const [h, m] = hora.split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : 20 * 60;
};

/** O resumo do dia numa frase, com o que já se sabe (e-mails e agenda só depois de lidos). */
export function resumoDoDia(dia: AgoraDoDia): string {
  if (dia.fechado) return 'Dia fechado. O que ficou em aberto volta amanhã.';
  const abertas = (dia.tarefas ?? []).filter((t) => !t.feito && daChecklist(t, dia.hoje, NADA)).length;
  const partes = [abertas === 0 ? 'nenhuma tarefa em aberto' : `${nTarefas(abertas)} em aberto`];
  if (dia.emails.lidoEm !== null) {
    const emails = (dia.fila ?? []).filter((item) => item.tipo === 'email').length;
    partes.push(emails === 0 ? 'nada por responder' : `${nEmails(emails)} por responder`);
  }
  if (dia.livreConhecido) {
    const { proximo, minutos } = dia.livre;
    const titulo = (proximo?.titulo ?? '').trim() || '(sem título)';
    if (proximo && minutos === 0 && Date.parse(proximo.inicio) <= dia.agora.getTime()) {
      partes.push(`${titulo} em andamento, até ${horaDe(proximo.fim)}`);
    } else if (proximo) {
      partes.push(`o próximo compromisso às ${dia.livre.ate}, ${titulo}`);
    } else if (minutos > 0) {
      partes.push('nenhum compromisso até o fim do dia');
    }
  }
  return `Hoje: ${juntar(partes)}.`;
}

function MensagemDoDia({ dia }: { dia: AgoraDoDia }) {
  const acabou = dia.livreConhecido && dia.livre.minutos === 0 && !dia.livre.proximo;
  const irParaFechar = () => {
    const titulo = document.getElementById('titulo-fechar-o-dia');
    if (!titulo) return;
    titulo.tabIndex = -1;
    titulo.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    titulo.focus();
  };
  return (
    <section class="mensagem-do-dia" aria-label="Mensagem do dia">
      <p class="mensagem-saudacao">{saudacao(dia.agora)}</p>
      <p class="mensagem-data">{diaPorExtenso(dia.hoje, dia.hoje)}</p>
      <p class="mensagem-resumo" aria-live="polite">
        {resumoDoDia(dia)}
      </p>
      {acabou && !dia.fechado && (
        <p class="mensagem-fim">
          <span>{`O dia de trabalho acabou às ${dia.fimDoDia}.`}</span>
          <button type="button" class="tarefa-entendi" onClick={irParaFechar}>
            Ir para Fechar o dia
          </button>
        </p>
      )}
    </section>
  );
}

function LinhaDoDia({ dia }: { dia: AgoraDoDia }) {
  const salas = useSalas();
  const adivinhar = useAdivinharSala();
  const calendario = useMemo(
    () => montarCalendario({ eventos: dia.eventos.eventos, tarefas: dia.tarefas ?? [], de: dia.hoje, ate: dia.hoje, agora: dia.agora }),
    [dia.eventos.eventos, dia.tarefas, dia.hoje, dia.agora],
  );
  return (
    <section class="painel linha-do-dia-cartao" aria-labelledby="titulo-linha-do-dia">
      <div class="cartao-topo">
        <h2 id="titulo-linha-do-dia">Linha do dia</h2>
        <p class="cartao-topo-nota">{textoDoTempoLivre(dia).curto}</p>
      </div>
      <LinhaDia dia={calendario.dia(dia.hoje)} agora={dia.agora} salas={salas} fimDoDia={minutosDe(dia.fimDoDia)} adivinhar={adivinhar} />
    </section>
  );
}

export function Painel() {
  const dia = useAgoraDoDia();
  const salas = useSalas();
  const pessoas = usePessoas() ?? [];
  const tela = useTela();
  return (
    <>
      <AvisosDeConflito />
      <AvisoDaFila />
      <div class="painel-do-dia">
        {tela !== 'computador' && (
          <section class="painel agora-no-painel" aria-labelledby="titulo-agora-no-painel">
            <h2 id="titulo-agora-no-painel">Agora</h2>
            <AgoraCurto />
          </section>
        )}
        <MensagemDoDia dia={dia} />
        <LinhaDoDia dia={dia} />
        <CaixasSalas salas={salas} tarefas={dia.tarefas} fila={dia.fila} pessoas={pessoas} hoje={dia.hoje} />
        <div class="hoje-grade">
          <Checklist />
          <AgendaHoje />
        </div>
        <div class="hoje-grade">
          <PorResponder />
          <ASeguir dia={dia} salas={salas} pular={1} limite={6} comLink />
        </div>
        <div class="hoje-grade">
          <SemPrazo />
        </div>
        <FecharDia dia={dia} salas={salas} />
      </div>
    </>
  );
}
