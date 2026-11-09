// Ponto único do chat (Tarefa 8): frase -> itens para o cartão. Hoje são duas
// camadas, regras e memória. A Tarefa 21 acrescenta a IA local em
// `completarComIA`, sem mudar quem chama `interpretar`.

import { criarCompromisso, desfazerCompromisso, type SituacaoDaAgenda } from '../dados/compromisso';
import { desfazer } from '../dados/desfazer';
import { hojeEmLisboa } from '../dados/dia';
import { apagar, salvar } from '../dados/loja';
import type { ParaSalvar, Tarefa } from '../dados/tipos';
import { carregarMemoria, pessoaDesconhecida, type MemoriaDoChat } from './memoria';
import { interpretarRegras, type Item, type Resultado } from './regras';

/** Duração padrão de tarefa (restrições globais). */
export const DURACAO_PADRAO_MIN = 60;

/** O item como o cartão precisa: o das regras e mais o que a memória sabe dizer. */
export type ItemDoChat = Item & {
  /** `baixa`: o cartão pede confirmação antes de guardar. */
  certeza: 'alta' | 'baixa';
  /** Nome citado que ninguém conhece, quando o item ficou sem sala: o cartão pergunta. */
  pessoaNova?: string;
  /** A palavra guardada que decidiu a sala (`motivoSala: 'memoria'`). */
  termoSala?: string;
  /** Nome da pessoa cadastrada que a frase citou. */
  pessoaNome?: string;
};

// O dia de Lisboa mora em dados/dia.ts (a virada do dia também o usa); o chat segue importando daqui.
export { hojeEmLisboa };

/**
 * Lugar da IA local (Tarefa 21): título, sala quando regras e memória não
 * decidem, e frases longas com vários pedidos. Nunca decide data nem hora.
 * Enquanto a IA não existe ou não carregou, o resultado das regras segue igual.
 */
async function completarComIA(_frase: string, resultado: Resultado, _memoria: MemoriaDoChat): Promise<Resultado> {
  return resultado;
}

/** Interpreta a frase com o dia de hoje em Lisboa e a memória atual da loja. */
export async function interpretar(frase: string): Promise<ItemDoChat[]> {
  const memoria = await carregarMemoria();
  const pelasRegras = interpretarRegras(frase, hojeEmLisboa(), memoria);
  if (pelasRegras.vazia) return [];
  const { itens, certeza } = await completarComIA(frase, pelasRegras, memoria);

  return itens.map((item) => {
    const doChat: ItemDoChat = { ...item, certeza };
    if (item.motivoSala === 'memoria') {
      const termo = memoria.termoDaSala(frase);
      if (termo) doChat.termoSala = termo;
    }
    if (item.pessoaId) {
      const pessoa = memoria.pessoaPorId(item.pessoaId);
      if (pessoa) doChat.pessoaNome = pessoa.nome;
    }
    if (item.salaId === null && !item.pessoaId) {
      const nome = pessoaDesconhecida(frase, memoria);
      if (nome) doChat.pessoaNova = nome;
    }
    return doChat;
  });
}

const minutos = (hora: string) => {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
};

/** Minutos de `inicio` a `fim` do compromisso; `null` se não há as duas horas certas. */
function duracaoDita(item: Item): number | null {
  if (item.tipo !== 'compromisso' || !item.inicio || !item.fim) return null;
  const diferenca = minutos(item.fim) - minutos(item.inicio);
  return Number.isFinite(diferenca) && diferenca > 0 ? diferenca : null;
}

/**
 * A Tarefa que o item vira: só campos da Tarefa, nenhum vazio. Compromisso com
 * dia e horas não passa por aqui: vai para o Google Agenda (`criarItem`). Um
 * compromisso sem dia ou sem as duas horas, que as regras não produzem, ainda
 * vira tarefa, sem hora de início.
 */
export function paraTarefa(item: Item): ParaSalvar<Tarefa> {
  const dita = duracaoDita(item);
  const tarefa: ParaSalvar<Tarefa> = {
    titulo: item.titulo,
    salaId: item.salaId,
    duracaoMin: dita ?? DURACAO_PADRAO_MIN,
    // Compromisso disse início e fim; tarefa usa o padrão, que o dono ainda confirma.
    duracaoConfirmada: dita !== null,
    feito: false,
    fixada: false,
    marcar: item.marcar,
  };
  if (item.pessoaId) tarefa.pessoaId = item.pessoaId;
  if (item.data) tarefa.data = item.data;
  else if (item.semana) tarefa.semana = item.semana;
  if (item.tipo === 'tarefa' && item.data && item.prazoHora) tarefa.prazoHora = item.prazoHora;
  return tarefa;
}

/** O compromisso que tem tudo para ir ao Google Agenda: dia e as duas horas. */
type Compromisso = Item & { tipo: 'compromisso'; data: string; inicio: string; fim: string };
const vaiParaAgenda = (item: Item): item is Compromisso =>
  item.tipo === 'compromisso' && !!item.data && !!item.inicio && !!item.fim && item.fim > item.inicio;

/** Item que vira tarefa. */
export type ItemDeTarefa = Item & { tipo: 'tarefa' };

export type ItemCriado =
  | { tarefa: Tarefa; eventoId?: undefined; agenda?: undefined; desfazer: () => Promise<void> }
  | { tarefa?: undefined; eventoId: string; agenda: SituacaoDaAgenda; desfazer: () => Promise<void> };

/**
 * Guarda o item e registra o desfazer na pilha do app. O `desfazer` devolvido
 * desfaz este item, mesmo que outro tenha vindo depois. Se desfazer falhar,
 * chamar de novo tenta de novo; depois de dar certo, nada faz.
 * - tarefa: grava pela loja (sincroniza); desfazer apaga.
 * - compromisso: cria o evento no Google Agenda (sem internet, o pedido fica na
 *   fila `pendentes`, e `agenda` diz isso); desfazer remove o evento ou tira o
 *   pedido da fila.
 */
export function criarItem(item: ItemDeTarefa): Promise<{ tarefa: Tarefa; desfazer: () => Promise<void> }>;
export function criarItem(item: Item): Promise<ItemCriado>;
export async function criarItem(item: Item): Promise<ItemCriado> {
  if (vaiParaAgenda(item)) return criarNaAgenda(item);
  const tarefa = await salvar('tarefas', paraTarefa(item));
  let apagada = false;
  const apagarEsta = async () => {
    if (apagada) return;
    await apagar('tarefas', tarefa.id);
    apagada = true;
  };
  // A pilha tira a entrada antes de rodar: a nova tentativa vem de `apagarEsta`.
  const entrada = desfazer.registrar(`Item do chat: ${tarefa.titulo}`, apagarEsta);
  return {
    tarefa,
    desfazer: async () => {
      await entrada.reverter();
      await apagarEsta();
    },
  };
}

async function criarNaAgenda(item: Compromisso): Promise<ItemCriado> {
  const { eventoId, situacao } = await criarCompromisso({
    titulo: item.titulo,
    data: item.data,
    inicio: item.inicio,
    fim: item.fim,
    salaId: item.salaId,
  });
  let removido = false;
  const removerEste = async () => {
    if (removido) return;
    await desfazerCompromisso(eventoId);
    removido = true;
  };
  const entrada = desfazer.registrar(`Item do chat: ${item.titulo}`, removerEste);
  return {
    eventoId,
    agenda: situacao,
    desfazer: async () => {
      await entrada.reverter();
      await removerEste();
    },
  };
}
