// Ações com Desfazer para o Agora e o Fechar o dia (Tarefa 16): uma ação de
// cada vez (toque duplo não grava duas vezes), a última com Desfazer e, se der
// errado, um aviso em palavras simples. O Desfazer é o da pilha do app.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Desfazivel } from '../dados/desfazer';
import { colocarNaAgenda, concluirSemAgenda } from '../dados/marcar';
import type { Tarefa } from '../dados/tipos';
import { CaixaMarcar } from './CaixaMarcar';
import './tarefas.css';

export type Feito = { texto: string; entrada: Desfazivel };

export type Acoes = {
  feito: Feito | null;
  erro: string | null;
  /** `fazer` devolve o que mostrar com Desfazer, ou nada (nada mudou). */
  agir(fazer: () => Promise<Feito | null | undefined>, mensagemDeErro: string): Promise<void>;
  desfazer(): Promise<void>;
  /** Tira o aviso (sem desfazer): a tela mudou de assunto, como ao fechar o dia. */
  limpar(): void;
};

export function useAcoes(): Acoes {
  const [feito, setFeito] = useState<Feito | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const ocupado = useRef(false);

  return {
    feito,
    erro,
    async agir(fazer, mensagemDeErro) {
      if (ocupado.current) return;
      ocupado.current = true;
      setErro(null);
      try {
        const novo = await fazer();
        if (novo) setFeito(novo);
      } catch (falha) {
        console.error(mensagemDeErro, falha);
        setErro(mensagemDeErro);
      } finally {
        ocupado.current = false;
      }
    },
    async desfazer() {
      const atual = feito;
      if (!atual || ocupado.current) return;
      ocupado.current = true;
      setErro(null);
      try {
        await atual.entrada.reverter();
        setFeito(null);
      } catch (falha) {
        // A entrada volta para a pilha: Desfazer segue valendo para tentar de novo.
        console.error('Não consegui desfazer', falha);
        setErro('Não consegui desfazer. Tente de novo.');
      } finally {
        ocupado.current = false;
      }
    },
    limpar() {
      setFeito(null);
      setErro(null);
    },
  };
}

/**
 * O que acabou de acontecer, com Desfazer. O foco vem para o Desfazer: o
 * botão em que o dono tocou já saiu da tela com o item.
 */
export function AvisoDasAcoes({ acoes, rotuloDoDesfazer = 'Desfazer' }: { acoes: Acoes; rotuloDoDesfazer?: string }) {
  const botao = useRef<HTMLButtonElement>(null);
  const { feito, erro } = acoes;
  useEffect(() => {
    if (feito) botao.current?.focus();
  }, [feito]);
  return (
    <>
      {feito && (
        <div class="tarefa-apagada acao-feita" role="status">
          <span>{feito.texto}</span>
          <button type="button" class="tarefa-desfazer" ref={botao} onClick={() => void acoes.desfazer()}>
            {rotuloDoDesfazer}
          </button>
        </div>
      )}
      {erro && (
        <p class="tarefa-erro" role="alert">
          {erro}
        </p>
      )}
    </>
  );
}

/**
 * A caixa da tarefa de marcar ("ao concluir, pede dia e hora"), fora da linha
 * da tarefa: concluir tira a linha da tela (ou troca o destaque do Agora), e a
 * caixa, com o aviso da agenda se houver, não pode sumir junto. O foco volta ao
 * botão `[data-concluir="<id>"]` de `base` se o dono fechou sem concluir.
 */
export function useMarcar(hoje: string, acoes: Acoes, base: { current: HTMLElement | null }) {
  const [tarefa, setTarefa] = useState<Tarefa | null>(null);
  const concluiu = useRef(false);
  const caixa = tarefa && (
    <CaixaMarcar
      tarefaId={tarefa.id}
      titulo={tarefa.titulo}
      dia={tarefa.data}
      hoje={hoje}
      aoColocar={async (marcacao) => {
        const { entrada, agenda } = await colocarNaAgenda(tarefa, marcacao);
        if (entrada) {
          concluiu.current = true;
          await acoes.agir(async () => ({ texto: entrada.rotulo, entrada }), 'Não consegui concluir. Tente de novo.');
        }
        return agenda;
      }}
      aoConcluirSemAgenda={async () => {
        const entrada = await concluirSemAgenda(tarefa.id);
        if (entrada) {
          concluiu.current = true;
          await acoes.agir(async () => ({ texto: entrada.rotulo, entrada }), 'Não consegui concluir. Tente de novo.');
        }
      }}
      aoFechar={() => {
        setTarefa(null);
        // Concluiu: o foco já foi para o Desfazer. "Ainda não marquei": volta ao botão de concluir.
        if (!concluiu.current) base.current?.querySelector<HTMLElement>(`[data-concluir="${tarefa.id}"]`)?.focus();
        concluiu.current = false;
      }}
    />
  );
  return {
    abrir: (nova: Tarefa) => {
      concluiu.current = false;
      setTarefa(nova);
    },
    caixa,
  };
}
