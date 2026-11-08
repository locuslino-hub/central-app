// A conversa do chat (Tarefa 8): mensagens e o estado de cada cartão. Mora
// fora dos componentes para o chat do painel direito e o da página `#/chat`
// mostrarem a mesma conversa, e para voltar a uma tela não guardar de novo.
// Não é guardada nem sincronizada: o que fica são os itens criados.

import { lerRegistros, salvar } from '../dados/loja';
import type { Tarefa } from '../dados/tipos';
import { criarItem, interpretar, type ItemDoChat } from './interpretar';
import { aprender, lembrarPessoa } from './memoria';

/**
 * `confirmar`: certeza baixa, esperando o dono. `salvando`: gravação em curso.
 * `salvo`: guardado, com Desfazer. `desfeito` e `descartado`: nada ficou.
 */
export type Situacao = 'confirmar' | 'salvando' | 'salvo' | 'desfeito' | 'descartado' | 'erro';

/** Por que a sala mudou no cartão, para dizer o que foi aprendido. */
export type Escolha =
  | { tipo: 'pessoa-nova'; nome: string }
  | { tipo: 'palavra'; termo: string }
  | { tipo: 'pessoa'; nome: string }
  | { tipo: 'sem-aprender' };

export type EstadoCartao = {
  id: string;
  item: ItemDoChat;
  situacao: Situacao;
  /** As salas estão abertas para escolher (Trocar sala). */
  trocando: boolean;
  escolha?: Escolha;
  tarefaId?: string;
};

export type Mensagem =
  | { id: string; de: 'dono'; texto: string }
  | { id: string; de: 'central'; texto: string; cartoes: EstadoCartao[]; esperando: boolean };

let mensagens: Mensagem[] = [];
let contador = 0;
/** Desfazer de cada cartão guardado. Fora do estado: é função, não dado da tela. */
const desfazeres = new Map<string, () => Promise<void>>();
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

function mudarMensagem(id: string, mudanca: Partial<Extract<Mensagem, { de: 'central' }>>) {
  mudar(mensagens.map((m) => (m.id === id && m.de === 'central' ? { ...m, ...mudanca } : m)));
}

/** A resposta da Central acima dos cartões. */
export function fala(itens: readonly ItemDoChat[]): string {
  if (itens.some((item) => item.certeza === 'baixa')) return 'Não tenho certeza. Confira o cartão.';
  const nova = itens.find((item) => item.pessoaNova)?.pessoaNova;
  return nova ? `Anotei. Ainda não conheço ${nova}.` : 'Anotei.';
}

/** Grava o item do cartão. Se a sala mudou enquanto gravava, a tarefa acompanha. */
async function gravar(id: string) {
  const cartao = acharCartao(id);
  if (!cartao) return;
  mudarCartao(id, { situacao: 'salvando' });
  try {
    const { tarefa, desfazer } = await criarItem(cartao.item);
    desfazeres.set(id, desfazer);
    mudarCartao(id, { situacao: 'salvo', tarefaId: tarefa.id });
    const depois = acharCartao(id);
    if (depois && (depois.item.salaId !== tarefa.salaId || (depois.item.pessoaId ?? undefined) !== tarefa.pessoaId)) {
      await moverTarefa(tarefa.id, depois.item);
    }
  } catch (erro) {
    console.error('Não consegui guardar o item do chat', erro);
    mudarCartao(id, { situacao: 'erro' });
  }
}

/**
 * Manda a frase. A mensagem do dono e o lugar da resposta entram na hora, na
 * ordem em que foram ditas; com certeza alta o item já é guardado.
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
    situacao: item.certeza === 'baixa' ? 'confirmar' : 'salvando',
    // Sem sala e sem pessoa nova para perguntar: as salas já ficam à vista.
    trocando: item.salaId === null && !item.pessoaNova,
  }));
  mudarMensagem(resposta, { texto: fala(itens), cartoes, esperando: false });
  for (const cartao of cartoes) if (cartao.situacao === 'salvando') await gravar(cartao.id);
}

/** Guardar o item de certeza baixa (ou tentar de novo depois de erro). */
export async function confirmar(id: string): Promise<void> {
  const situacao = acharCartao(id)?.situacao;
  if (situacao === 'confirmar' || situacao === 'erro') await gravar(id);
}

export function descartar(id: string) {
  const cartao = acharCartao(id);
  if (cartao?.situacao === 'confirmar' || cartao?.situacao === 'erro') mudarCartao(id, { situacao: 'descartado' });
}

/** Desfazer do cartão: apaga este item (ver `criarItem`). */
export async function desfazerCartao(id: string): Promise<void> {
  const reverter = desfazeres.get(id);
  if (!reverter || acharCartao(id)?.situacao !== 'salvo') return;
  desfazeres.delete(id);
  mudarCartao(id, { situacao: 'desfeito' });
  try {
    await reverter();
  } catch (erro) {
    console.error('Não consegui desfazer o item do chat', erro);
  }
}

export function abrirTroca(id: string) {
  mudarCartao(id, { trocando: true });
}

/** "Manter a sala": fecha a escolha sem mudar nada. */
export function fecharTroca(id: string) {
  mudarCartao(id, { trocando: false });
}

/**
 * Escolha de sala no cartão. Pessoa nova: guarda a pessoa com essa sala, e a
 * próxima frase não pergunta. Trocar sala: aprende com o termo que decidiu
 * (a palavra guardada ou a pessoa cadastrada). Sala dita na frase ou item sem
 * pista: só troca, porque não há termo a aprender.
 */
export async function escolherSala(id: string, salaId: string): Promise<void> {
  const cartao = acharCartao(id);
  if (!cartao || cartao.situacao === 'desfeito' || cartao.situacao === 'descartado') return;
  const { item } = cartao;
  let novo: ItemDoChat = { ...item, salaId };
  let escolha: Escolha;

  try {
    if (item.pessoaNova && item.salaId === null) {
      const pessoa = await lembrarPessoa(item.pessoaNova, salaId);
      novo = { ...novo, pessoaId: pessoa.id, pessoaNome: pessoa.nome, pessoaNova: undefined, motivoSala: 'pessoa' };
      escolha = { tipo: 'pessoa-nova', nome: pessoa.nome };
    } else if (item.motivoSala === 'memoria' && item.termoSala) {
      await aprender(item.termoSala, salaId);
      escolha = { tipo: 'palavra', termo: item.termoSala };
    } else if (item.motivoSala === 'pessoa' && item.pessoaNome) {
      await aprender(item.pessoaNome, salaId);
      escolha = { tipo: 'pessoa', nome: item.pessoaNome };
    } else {
      escolha = { tipo: 'sem-aprender' };
    }
  } catch (erro) {
    console.error('Não consegui guardar o que aprendi', erro);
    escolha = { tipo: 'sem-aprender' };
  }

  const atual = acharCartao(id);
  if (!atual) return;
  mudarCartao(id, { item: novo, trocando: false, escolha });
  if (atual.situacao === 'salvo' && atual.tarefaId) await moverTarefa(atual.tarefaId, novo);
}

/** Lê a tarefa na hora (pode ter mudado no outro aparelho) e troca só sala e pessoa. */
async function moverTarefa(tarefaId: string, item: ItemDoChat) {
  try {
    const [guardada] = (await lerRegistros([{ colecao: 'tarefas', id: tarefaId }])) as (Tarefa | undefined)[];
    if (!guardada || guardada.apagado) return;
    const tarefa: Tarefa = { ...guardada, salaId: item.salaId };
    if (item.pessoaId) tarefa.pessoaId = item.pessoaId;
    await salvar('tarefas', tarefa);
  } catch (erro) {
    console.error('Não consegui trocar a sala do item', erro);
  }
}
