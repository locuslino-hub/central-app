// A conversa do chat (Tarefa 8): mensagens e o estado de cada cartão. Mora
// fora dos componentes para o chat do painel direito e o da página `#/chat`
// mostrarem a mesma conversa, e para voltar a uma tela não guardar de novo.
// Não é guardada nem sincronizada: o que fica são os itens criados. Todo item
// é guardado na hora, mesmo com certeza baixa (o app pode ser fechado logo
// depois); o cartão mostra o resultado com Trocar sala e Desfazer para corrigir.
//
// Cada cartão tem a sua fila: guardar, trocar a sala e desfazer o mesmo
// cartão acontecem um depois do outro, na ordem em que o dono apertou.

import { avisoDaAgenda, trocarSalaDoCompromisso } from '../dados/compromisso';
import { lerRegistros, salvar } from '../dados/loja';
import type { Tarefa } from '../dados/tipos';
import { criarItem, interpretar, type ItemDoChat } from './interpretar';
import { aprender, lembrarPessoa } from './memoria';

/**
 * `salvando`: gravação em curso. `salvo`: guardado, com Desfazer.
 * `desfazendo`: apagando. `desfeito` e `descartado`: nada ficou. `erro`: não
 * guardou (falha da loja); Guardar tenta de novo, Descartar desiste.
 */
export type Situacao = 'salvando' | 'salvo' | 'desfazendo' | 'desfeito' | 'descartado' | 'erro';

/** Por que a sala mudou no cartão, para dizer o que foi (ou será) aprendido. */
export type Escolha =
  | { tipo: 'pessoa-nova'; nome: string }
  | { tipo: 'palavra'; termo: string }
  | { tipo: 'pessoa'; nome: string }
  | { tipo: 'sem-aprender' };

/** O que a memória aprende com a escolha. Em cartão que não guardou (erro), espera o Guardar. */
export type Aprendizado = { tipo: 'pessoa-nova'; nome: string } | { tipo: 'termo'; termo: string };

export type EstadoCartao = {
  id: string;
  item: ItemDoChat;
  situacao: Situacao;
  /** As salas estão abertas para escolher (Trocar sala, Não é pessoa). */
  trocando: boolean;
  escolha?: Escolha;
  /** Aprendizado à espera do Guardar; some com Descartar. */
  pendente?: Aprendizado;
  /** Falha que o dono precisa saber ("Não consegui desfazer…"). */
  aviso?: string;
  tarefaId?: string;
  /** Compromisso: o id do evento no Google Agenda (do cliente, também na fila se ainda não saiu). */
  eventoId?: string;
  /** Cresce a cada ação concluída no cartão: a tela usa para mover o foco. */
  passos: number;
  /** Qual ação concluiu por último (mesmo sem mudar nada). */
  ultimaAcao?: Acao;
};

/** Ações do dono no cartão; a tela pede foco para depois de uma delas. */
export type Acao = 'guardar' | 'descartar' | 'desfazer' | 'trocar' | 'manter' | 'nao-e-pessoa' | 'escolher';

export type Mensagem =
  | { id: string; de: 'dono'; texto: string }
  | { id: string; de: 'central'; texto: string; cartoes: EstadoCartao[]; esperando: boolean };

let mensagens: Mensagem[] = [];
let contador = 0;
/** Desfazer de cada cartão guardado. Fora do estado: é função, não dado da tela. */
const desfazeres = new Map<string, () => Promise<void>>();
/** A última ação de cada cartão: a próxima espera por ela. */
const filas = new Map<string, Promise<void>>();
const ouvintes = new Set<() => void>();

const novoId = () => `m${++contador}`;

function mudar(novas: Mensagem[]) {
  mensagens = novas;
  for (const ouvinte of [...ouvintes]) ouvinte();
}

export function lerConversa(): readonly Mensagem[] {
  return mensagens;
}

export function assinarConversa(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

/** Começa uma conversa vazia (testes). */
export function limparConversa() {
  contador = 0;
  desfazeres.clear();
  filas.clear();
  mudar([]);
}

function acharCartao(id: string): EstadoCartao | undefined {
  for (const mensagem of mensagens) {
    if (mensagem.de !== 'central') continue;
    const cartao = mensagem.cartoes.find((c) => c.id === id);
    if (cartao) return cartao;
  }
  return undefined;
}

function mudarCartao(id: string, mudanca: Partial<EstadoCartao>) {
  mudar(
    mensagens.map((mensagem) =>
      mensagem.de === 'central' && mensagem.cartoes.some((c) => c.id === id)
        ? { ...mensagem, cartoes: mensagem.cartoes.map((c) => (c.id === id ? { ...c, ...mudanca } : c)) }
        : mensagem,
    ),
  );
}

/**
 * Mudança que encerra uma ação: conta um passo e diz qual ação foi, para a
 * tela mover o foco só depois da ação que pediu. Ação que não muda nada também
 * conclui, para nenhum pedido de foco ficar esperando.
 */
function concluir(id: string, acao: Acao, mudanca: Partial<EstadoCartao> = {}) {
  const cartao = acharCartao(id);
  if (cartao) mudarCartao(id, { ...mudanca, passos: cartao.passos + 1, ultimaAcao: acao });
}

/** Roda a ação depois das anteriores do mesmo cartão. Erro não trava a fila. */
function naFila(id: string, acao: () => Promise<void>): Promise<void> {
  const vez = (filas.get(id) ?? Promise.resolve()).then(acao).catch((erro: unknown) => {
    console.error('Ação do cartão falhou', erro);
  });
  filas.set(id, vez);
  return vez;
}

function mudarMensagem(id: string, mudanca: Partial<Extract<Mensagem, { de: 'central' }>>) {
  mudar(mensagens.map((m) => (m.id === id && m.de === 'central' ? { ...m, ...mudanca } : m)));
}

/** A resposta da Central acima dos cartões. */
export function fala(itens: readonly ItemDoChat[]): string {
  if (itens.some((item) => item.certeza === 'baixa')) return 'Anotei. Confira o cartão.';
  const nova = itens.find((item) => item.pessoaNova)?.pessoaNova;
  return nova ? `Anotei. Ainda não conheço ${nova}.` : 'Anotei.';
}

/** Grava na memória o que a escolha ensinou, e devolve o item com a pessoa, se houver. */
async function aplicar(aprendizado: Aprendizado, item: ItemDoChat): Promise<ItemDoChat> {
  if (item.salaId === null) return item;
  if (aprendizado.tipo === 'pessoa-nova') {
    const pessoa = await lembrarPessoa(aprendizado.nome, item.salaId);
    return { ...item, pessoaId: pessoa.id, pessoaNome: pessoa.nome };
  }
  await aprender(aprendizado.termo, item.salaId);
  return item;
}

/** Grava o item do cartão, com o que estava à espera do Guardar. */
async function gravar(id: string) {
  const cartao = acharCartao(id);
  if (!cartao) return;
  mudarCartao(id, { situacao: 'salvando' });
  try {
    const item = cartao.pendente ? await aplicar(cartao.pendente, cartao.item) : cartao.item;
    const criado = await criarItem(item);
    desfazeres.set(id, criado.desfazer);
    concluir(id, 'guardar', {
      situacao: 'salvo',
      item,
      tarefaId: criado.tarefa?.id,
      eventoId: criado.eventoId,
      pendente: undefined,
      // Compromisso que não chegou à agenda: o dono sabe, e a fila tenta de novo.
      aviso: criado.agenda ? (avisoDaAgenda(criado.agenda) ?? undefined) : undefined,
    });
  } catch (erro) {
    console.error('Não consegui guardar o item do chat', erro);
    concluir(id, 'guardar', { situacao: 'erro' });
  }
}

/**
 * Manda a frase. A mensagem do dono e o lugar da resposta entram na hora, na
 * ordem em que foram ditas, e cada item já é guardado, com qualquer certeza.
 */
export async function enviar(frase: string): Promise<void> {
  const texto = frase.trim();
  if (!texto) return;
  const resposta = novoId();
  mudar([
    ...mensagens,
    { id: novoId(), de: 'dono', texto },
    { id: resposta, de: 'central', texto: '', cartoes: [], esperando: true },
  ]);

  let itens: ItemDoChat[];
  try {
    itens = await interpretar(texto);
  } catch (erro) {
    console.error('Não consegui entender a frase', erro);
    mudarMensagem(resposta, { texto: 'Não consegui ler a frase agora. Tente de novo.', esperando: false });
    return;
  }
  if (itens.length === 0) {
    mudarMensagem(resposta, { texto: 'Não entendi. Pode dizer de outro jeito?', esperando: false });
    return;
  }
  const cartoes: EstadoCartao[] = itens.map((item) => ({
    id: novoId(),
    item,
    situacao: 'salvando',
    // Sem sala e sem pessoa nova para perguntar: as salas já ficam à vista.
    trocando: item.salaId === null && !item.pessoaNova,
    passos: 0,
  }));
  mudarMensagem(resposta, { texto: fala(itens), cartoes, esperando: false });
  await Promise.all(cartoes.map((cartao) => naFila(cartao.id, () => gravar(cartao.id))));
}

/** Guardar de novo o item que não guardou (erro da loja). */
export function confirmar(id: string): Promise<void> {
  return naFila(id, async () => {
    const situacao = acharCartao(id)?.situacao;
    if (situacao === 'erro') await gravar(id);
    else concluir(id, 'guardar');
  });
}

/** Descartar o item que não guardou: o que esperava o Guardar também não é aprendido. */
export function descartar(id: string): Promise<void> {
  return naFila(id, async () => {
    const situacao = acharCartao(id)?.situacao;
    if (situacao === 'erro') {
      concluir(id, 'descartar', { situacao: 'descartado', pendente: undefined });
    } else concluir(id, 'descartar');
  });
}

/**
 * Desfazer do cartão: apaga este item (ver `criarItem`). Só depois de apagar o
 * cartão diz "Desfeito"; se falhar, o item segue guardado e o cartão avisa.
 */
export function desfazerCartao(id: string): Promise<void> {
  return naFila(id, async () => {
    const reverter = desfazeres.get(id);
    const cartao = acharCartao(id);
    if (!reverter || cartao?.situacao !== 'salvo') {
      concluir(id, 'desfazer');
      return;
    }
    mudarCartao(id, { situacao: 'desfazendo', aviso: undefined });
    try {
      await reverter();
      desfazeres.delete(id);
      concluir(id, 'desfazer', { situacao: 'desfeito' });
    } catch (erro) {
      console.error('Não consegui desfazer o item do chat', erro);
      concluir(id, 'desfazer', { situacao: 'salvo', aviso: 'Não consegui desfazer. Tente de novo.' });
    }
  });
}

export function abrirTroca(id: string) {
  concluir(id, 'trocar', { trocando: true });
}

/** "Manter a sala": fecha a escolha sem mudar nada. */
export function fecharTroca(id: string) {
  concluir(id, 'manter', { trocando: false });
}

/** "Não é pessoa": tira a pergunta e abre as salas; a sala escolhida não cria pessoa. */
export function naoEPessoa(id: string) {
  const cartao = acharCartao(id);
  if (!cartao?.item.pessoaNova) {
    concluir(id, 'nao-e-pessoa');
    return;
  }
  concluir(id, 'nao-e-pessoa', { item: { ...cartao.item, pessoaNova: undefined }, trocando: true });
}

/**
 * Escolha de sala no cartão.
 * - Resposta a "Em que sala fica Renata?": guarda a pessoa com essa sala, e a
 *   próxima frase não pergunta.
 * - Trocar sala: aprende com o termo que decidiu (a palavra guardada ou a
 *   pessoa cadastrada).
 * - Sala dita na frase, item sem pista ou "Não é pessoa": só troca.
 * Em cartão que não guardou (erro), o aprendizado espera o Guardar.
 */
export function escolherSala(id: string, salaId: string): Promise<void> {
  return naFila(id, async () => {
    const cartao = acharCartao(id);
    if (!cartao || !['erro', 'salvo'].includes(cartao.situacao)) {
      concluir(id, 'escolher');
      return;
    }
    const { item } = cartao;
    let novo: ItemDoChat = { ...item, salaId };
    let aprendizado: Aprendizado | undefined;
    let escolha: Escolha;

    if (item.pessoaNova && item.salaId === null) {
      aprendizado = { tipo: 'pessoa-nova', nome: item.pessoaNova };
      escolha = { tipo: 'pessoa-nova', nome: item.pessoaNova };
      novo = { ...novo, pessoaNova: undefined, pessoaNome: item.pessoaNova, motivoSala: 'pessoa' };
    } else if (cartao.pendente?.tipo === 'pessoa-nova') {
      // A pessoa nova ainda espera o Guardar: vai para a sala escolhida por último.
      aprendizado = cartao.pendente;
      escolha = { tipo: 'pessoa-nova', nome: cartao.pendente.nome };
    } else if (item.motivoSala === 'memoria' && item.termoSala) {
      aprendizado = { tipo: 'termo', termo: item.termoSala };
      escolha = { tipo: 'palavra', termo: item.termoSala };
    } else if (item.motivoSala === 'pessoa' && item.pessoaNome) {
      aprendizado = { tipo: 'termo', termo: item.pessoaNome };
      escolha = { tipo: 'pessoa', nome: item.pessoaNome };
    } else {
      escolha = { tipo: 'sem-aprender' };
    }

    const guardado = cartao.situacao === 'salvo';
    if (guardado && aprendizado) {
      try {
        novo = await aplicar(aprendizado, novo);
      } catch (erro) {
        console.error('Não consegui guardar o que aprendi', erro);
        escolha = { tipo: 'sem-aprender' };
      }
    }
    concluir(id, 'escolher', { item: novo, trocando: false, escolha, pendente: guardado ? undefined : aprendizado });
    if (guardado && cartao.tarefaId) await moverTarefa(id, cartao.tarefaId, novo);
    else if (guardado && cartao.eventoId) await moverCompromisso(id, cartao.eventoId, novo);
  });
}

/**
 * Lê a tarefa na hora (pode ter mudado no outro aparelho) e troca só sala e
 * pessoa. Confere de novo, logo antes de gravar, que o cartão segue guardado:
 * nunca regrava um item desfeito.
 */
async function moverTarefa(cartaoId: string, tarefaId: string, item: ItemDoChat) {
  try {
    const [guardada] = (await lerRegistros([{ colecao: 'tarefas', id: tarefaId }])) as (Tarefa | undefined)[];
    if (!guardada || guardada.apagado) return;
    if (acharCartao(cartaoId)?.situacao !== 'salvo') return;
    const tarefa: Tarefa = { ...guardada, salaId: item.salaId };
    if (item.pessoaId) tarefa.pessoaId = item.pessoaId;
    await salvar('tarefas', tarefa);
  } catch (erro) {
    console.error('Não consegui trocar a sala do item', erro);
  }
}

/** Troca a sala do compromisso (na fila ou no Google Agenda); se falhar, o cartão avisa. */
async function moverCompromisso(cartaoId: string, eventoId: string, item: ItemDoChat) {
  try {
    if (acharCartao(cartaoId)?.situacao !== 'salvo') return;
    await trocarSalaDoCompromisso(eventoId, item.salaId);
  } catch (erro) {
    console.error('Não consegui trocar a sala do compromisso', erro);
    mudarCartao(cartaoId, { aviso: 'Não consegui trocar a sala na agenda.' });
  }
}
