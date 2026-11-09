// Ponto único do chat (Tarefa 8): frase -> itens para o cartão. Hoje são duas
// camadas, regras e memória. A Tarefa 21 acrescenta a IA local em
// `completarComIA`, sem mudar quem chama `interpretar`.

import { desfazer } from '../dados/desfazer';
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

/** `AAAA-MM-DD` do dia em Lisboa, no instante dado. */
export function hojeEmLisboa(agora: Date = new Date()): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Lisbon',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(agora);
  const parte = (tipo: string) => partes.find((p) => p.type === tipo)!.value;
  return `${parte('year')}-${parte('month')}-${parte('day')}`;
}

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
 * A Tarefa que o item vira: só campos da Tarefa, nenhum vazio. Até a Tarefa
 * 10–12 levar compromissos ao Google Agenda, eles também são Tarefa: com a
 * data, a hora de início (`inicio`, R28) e a duração de `inicio` a `fim`.
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
  // R28: o compromisso guarda a hora de início até a Tarefa 10 levá-lo ao Google Agenda.
  if (item.tipo === 'compromisso' && item.data && item.inicio) tarefa.inicio = item.inicio;
  return tarefa;
}

/**
 * Guarda o item (pela loja: sincroniza) e registra o desfazer na pilha do app.
 * O `desfazer` devolvido desfaz este item, mesmo que outro tenha vindo depois.
 * Se apagar falhar, chamar de novo tenta de novo; depois de dar certo, nada faz.
 */
export async function criarItem(item: Item): Promise<{ tarefa: Tarefa; desfazer: () => Promise<void> }> {
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
