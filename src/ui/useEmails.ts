// Os e-mails do Por responder: lidos ao abrir a tela, ao voltar ao app e a cada
// hora (src/dados/emails.ts guarda e lê), mais o que o dono já fez com cada um
// (Feito, Agora não) e as ações. Nada aqui altera o Gmail.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Desfazivel } from '../dados/desfazer';
import { assinarEmails, atualizarEmails, lerEmails, type Email, type LeituraDeEmails } from '../dados/emails';
import { adiarEmail, aparece, concluirEmail, podarEstados, virarTarefa } from '../dados/emails-estado';
import { lembrarComoPessoa, lembrarComoSala, origemDoRemetente, type Origem } from '../dados/remetentes';
import type { Tarefa } from '../dados/tipos';
import { useDia, useEstadosDeEmail, usePessoas, useTarefas } from './hooks';

export const ATUALIZAR_A_CADA_MS = 60 * 60_000;
/** Abrir telas ou voltar ao app em sequência não repete a chamada antes disto. */
export const INTERVALO_MINIMO_MS = 30_000;

/** A leitura de e-mails, atualizada sozinha. `atualizar` é o botão "Atualizar agora". */
export function useEmails(): { leitura: LeituraDeEmails; atualizar: () => Promise<void> } {
  const [, refazer] = useState(0);
  const leitura = lerEmails();

  useEffect(() => {
    refazer((n) => n + 1); // a leitura pode ter mudado entre o desenho e a assinatura
    const parar = assinarEmails(() => refazer((n) => n + 1));
    const tentar = () => {
      const atual = lerEmails();
      if (atual.carregando) return;
      if (atual.tentadoEm === null || Date.now() - atual.tentadoEm >= INTERVALO_MINIMO_MS) void atualizarEmails();
    };
    const aoVoltar = () => {
      if (document.visibilityState !== 'hidden') tentar();
    };
    tentar();
    document.addEventListener('visibilitychange', aoVoltar);
    // Com o app escondido não vale gastar chamada; ao voltar, `aoVoltar` lê de novo.
    const relogio = setInterval(() => {
      if (document.visibilityState !== 'hidden') void atualizarEmails();
    }, ATUALIZAR_A_CADA_MS);
    return () => {
      parar();
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', aoVoltar);
      clearInterval(relogio);
    };
  }, []);

  return { leitura, atualizar: () => atualizarEmails(true).then(() => undefined) };
}

export type ItemDeEmail = {
  email: Email;
  origem: Origem;
  /** A tarefa que nasceu deste e-mail, se há (viva). */
  tarefa?: Tarefa;
};

export type Aviso = { texto: string; entrada: Desfazivel };

export type Caixa = {
  leitura: LeituraDeEmails;
  atualizar: () => Promise<void>;
  /** Os e-mails de hoje: sem os Feito e sem os adiados para depois de hoje. `undefined` enquanto lê os estados. */
  itens: ItemDeEmail[] | undefined;
  /** A última ação, com Desfazer. */
  aviso: Aviso | null;
  falhou: string | null;
  feito(email: Email): Promise<void>;
  adiar(email: Email): Promise<void>;
  virarTarefa(item: ItemDeEmail): Promise<void>;
  desfazer(): Promise<void>;
  /** "Quem é" ou "de que sala é": `p:id` (pessoa), `s:id` (sala) ou `n` (sem sala). */
  responderSala(email: Email, escolha: string): Promise<boolean>;
};

/** Tudo o que Por responder e Caixa mostram e fazem. */
export function useCaixaDeEmails(): Caixa {
  const { leitura, atualizar } = useEmails();
  const hoje = useDia();
  const estados = useEstadosDeEmail();
  const pessoas = usePessoas();
  const tarefas = useTarefas();
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [falhou, setFalhou] = useState<string | null>(null);
  const [, refazer] = useState(0);
  const ocupado = useRef(false);

  useEffect(() => {
    podarEstados().catch((erro: unknown) => console.error('Não consegui limpar os estados de e-mail', erro));
  }, []);

  const porId = new Map((estados ?? []).map((estado) => [estado.id, estado]));
  const tarefaDe = new Map<string, Tarefa>();
  for (const tarefa of tarefas ?? []) if (tarefa.emailId && !tarefaDe.has(tarefa.emailId)) tarefaDe.set(tarefa.emailId, tarefa);

  const itens =
    estados === undefined || pessoas === undefined || tarefas === undefined
      ? undefined
      : leitura.emails
          .filter((email) => aparece(porId.get(email.id), hoje))
          .map((email) => ({ email, origem: origemDoRemetente(email.enderecoRemetente, pessoas), tarefa: tarefaDe.get(email.id) }));

  /** Uma ação de cada vez: toque duplo não grava duas vezes. */
  async function agir(fazer: () => Promise<Aviso | null>, mensagemDeErro: string) {
    if (ocupado.current) return;
    ocupado.current = true;
    setFalhou(null);
    try {
      const novo = await fazer();
      if (novo) setAviso(novo);
    } catch (erro) {
      console.error(mensagemDeErro, erro);
      setFalhou(mensagemDeErro);
    } finally {
      ocupado.current = false;
    }
  }

  return {
    leitura,
    atualizar,
    itens,
    aviso,
    falhou,
    feito: (email) =>
      agir(async () => {
        const entrada = await concluirEmail(email.id);
        return { texto: entrada.rotulo, entrada };
      }, 'Não consegui marcar como feito. Tente de novo.'),
    adiar: (email) =>
      agir(async () => {
        const entrada = await adiarEmail(email.id, hoje);
        return { texto: `${entrada.rotulo}. Ele volta amanhã.`, entrada };
      }, 'Não consegui adiar. Tente de novo.'),
    virarTarefa: (item) =>
      agir(async () => {
        const feita = await virarTarefa(item.email, { salaId: item.origem.salaId, pessoaId: item.origem.pessoa?.id });
        if (!feita) throw new Error('Tarefa não criada');
        return feita.entrada ? { texto: `Tarefa criada: ${feita.tarefa.titulo}`, entrada: feita.entrada } : null;
      }, 'Não consegui criar a tarefa. Tente de novo.'),
    async desfazer() {
      const atual = aviso;
      if (!atual) return;
      setFalhou(null);
      try {
        await atual.entrada.reverter();
        setAviso(null);
      } catch (erro) {
        console.error('Não consegui desfazer', erro);
        setFalhou('Não consegui desfazer. Tente de novo.');
      }
    },
    async responderSala(email, escolha) {
      try {
        if (escolha.startsWith('p:')) {
          if (!(await lembrarComoPessoa(email.enderecoRemetente, escolha.slice(2)))) return false;
        } else if (escolha.startsWith('s:')) {
          lembrarComoSala(email.enderecoRemetente, escolha.slice(2));
        } else if (escolha === 'n') {
          lembrarComoSala(email.enderecoRemetente, null);
        } else {
          return false;
        }
        refazer((n) => n + 1);
        return true;
      } catch (erro) {
        console.error('Não consegui guardar a resposta', erro);
        return false;
      }
    },
  };
}
