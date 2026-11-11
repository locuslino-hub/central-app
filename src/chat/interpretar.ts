// Ponto único do chat (Tarefa 8): frase -> itens para o cartão. Três camadas:
// regras, memória e, quando pronta no aparelho, a IA local (Tarefa 21).
//
// Mesclagem com a IA: data, hora e tipo vêm sempre das regras; a IA dá o
// título, a sala quando regras e memória não decidem, e a divisão de frases
// longas em vários itens. Pessoa conhecida citada fica no título. A sala que a
// IA escolhe não baixa a certeza: o item é guardado e o cartão oferece Trocar
// sala, como na sala das regras. A IA só é
// chamada com certeza baixa, sala indefinida ou frase com mais de 20 palavras,
// e tem 30 s para responder; sem resposta útil, valem as regras.

import { criarCompromisso, desfazerCompromisso, type SituacaoDaAgenda } from '../dados/compromisso';
import { desfazer } from '../dados/desfazer';
import { hojeEmLisboa } from '../dados/dia';
import { apagar, listar, salvar } from '../dados/loja';
import type { ParaSalvar, Sala, Tarefa } from '../dados/tipos';
import { ia as iaDoApp, type IA } from '../ia/ia';
import type { ContextoIA, ItemIA } from '../ia/instrucoes';
import { normalizar } from './datas';
import { carregarMemoria, pessoaDesconhecida, type MemoriaDoChat } from './memoria';
import { garantirNome, interpretarRegras, type Item } from './regras';

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

/** Tempo que a IA tem para responder; depois disso valem as regras. */
export const LIMITE_IA_MS = 30_000;
/** Frase com mais palavras que isto pode ter vários pedidos: a IA divide. */
const PALAVRAS_PARA_IA = 20;

let motor: IA = iaDoApp;

/** Troca a IA do chat (testes usam uma IA falsa). */
export function usarIA(outra: IA) {
  motor = outra;
}

/** O item das regras, com o que a memória sabe dizer sobre o trecho da frase. */
function paraChat(item: Item, trecho: string, certeza: ItemDoChat['certeza'], memoria: MemoriaDoChat): ItemDoChat {
  const doChat: ItemDoChat = { ...item, certeza };
  if (item.motivoSala === 'memoria') {
    const termo = memoria.termoDaSala(trecho);
    if (termo) doChat.termoSala = termo;
  }
  if (item.pessoaId) {
    const pessoa = memoria.pessoaPorId(item.pessoaId);
    if (pessoa) doChat.pessoaNome = pessoa.nome;
  }
  if (item.salaId === null && !item.pessoaId) {
    const nome = pessoaDesconhecida(trecho, memoria);
    if (nome) doChat.pessoaNova = nome;
  }
  return doChat;
}

const contarPalavras = (frase: string) => frase.trim().split(/\s+/).filter(Boolean).length;

/**
 * Pergunta à IA com o que a loja sabe. `null` se a loja falhar, ou a IA não
 * responder a tempo ou falhar: o chat segue com as regras.
 */
async function perguntarIA(frase: string, hoje: string): Promise<{ itens: ItemIA[]; salas: Sala[] } | null> {
  const controle = new AbortController();
  let relogio: ReturnType<typeof setTimeout> | undefined;
  try {
    const [salas, pessoas] = await Promise.all([listar('salas'), listar('pessoas')]);
    const contexto: ContextoIA = {
      hoje,
      salas: salas.map(({ id, nome, notas }) => (notas ? { id, nome, notas } : { id, nome })),
      pessoas: pessoas.map(({ nome, salaId, papel }) => (papel ? { nome, salaId, papel } : { nome, salaId })),
      sinal: controle.signal,
    };
    const limite = new Promise<null>((resolver) => {
      relogio = setTimeout(() => {
        controle.abort();
        resolver(null);
      }, LIMITE_IA_MS);
    });
    const itens = await Promise.race([motor.interpretar(frase, contexto), limite]);
    return itens?.length ? { itens, salas } : null;
  } catch (erro) {
    console.error('A IA local não respondeu; seguem as regras', erro);
    return null;
  } finally {
    clearTimeout(relogio);
  }
}

/** "Orientação" e "orientacoes" acham Orientações. */
const singular = (nome: string) => normalizar(nome).trim().replace(/oes$/, 'ao').replace(/s$/, '');

function salaPeloNome(nome: string, salas: Sala[]): string | null {
  if (!nome.trim()) return null;
  const procurado = singular(nome);
  return salas.find((sala) => singular(sala.nome) === procurado)?.id ?? null;
}

/** Palavras comuns que não ligam um título a um trecho. */
const COMUNS = new Set([
  'para', 'pela', 'pelo', 'pelas', 'pelos', 'tambem', 'entao', 'aqui', 'isso', 'essa', 'esse', 'esta', 'este',
  'mais', 'muito', 'sobre', 'tenho', 'preciso', 'precisa', 'depois', 'ainda', 'agora', 'fazer', 'coisa',
  'aquilo', 'aquele', 'aquela', 'mesmo', 'com',
]);

/** Começos das palavras que contam (4 letras ou mais, sem as comuns). */
function raizes(texto: string): Set<string> {
  return new Set(
    (normalizar(texto).match(/[a-z0-9]+/g) ?? []).filter((p) => p.length >= 4 && !COMUNS.has(p)).map((p) => p.slice(0, 5)),
  );
}

/**
 * O trecho da frase de cada item da IA, para as regras acharem data e hora
 * daquele pedido. A frase é cortada em vírgulas e "e"; cada pedaço vai para o
 * item com mais palavras em comum. Pedaço sem nada em comum ("às 11h", "ah")
 * fica com o item do pedaço anterior; os do começo, com o primeiro item achado.
 * Item que não aparece na frase fica com `''`.
 */
function dividir(frase: string, titulos: string[]): string[] {
  const pedacos = frase.split(/[,;!?]+|\s+e\s+/).map((p) => p.trim()).filter(Boolean);
  const dosTitulos = titulos.map(raizes);
  const dono: (number | null)[] = pedacos.map((pedaco) => {
    const doPedaco = raizes(pedaco);
    let melhor: { item: number; pontos: number } | null = null;
    dosTitulos.forEach((titulo, item) => {
      let pontos = 0;
      for (const raiz of titulo) if (doPedaco.has(raiz)) pontos++;
      if (pontos > 0 && (!melhor || pontos > melhor.pontos)) melhor = { item, pontos };
    });
    return melhor ? (melhor as { item: number }).item : null;
  });
  const primeiro = dono.find((d) => d !== null) ?? null;
  let anterior = primeiro;
  for (let i = 0; i < dono.length; i++) {
    if (dono[i] === null) dono[i] = anterior;
    anterior = dono[i];
  }
  return titulos.map((_, item) => pedacos.filter((_, i) => dono[i] === item).join(', '));
}

/** Cada item da IA, com data, hora e tipo das regras do seu trecho. */
function mesclar(frase: string, hoje: string, daIA: ItemIA[], memoria: MemoriaDoChat, salas: Sala[]): ItemDoChat[] {
  const varios = daIA.length > 1;
  const trechos = varios ? dividir(frase, daIA.map((item) => item.titulo)) : [frase];
  return daIA.map((sugestao, i) => {
    const trecho = trechos[i];
    const regras = trecho ? interpretarRegras(trecho, hoje, memoria) : null;
    const achado = regras && !regras.vazia ? regras.itens[0] : null;
    // Item que não aparece na frase: sem data, e o dono confere.
    const item: Item = achado
      ? { ...achado, titulo: sugestao.titulo }
      : { tipo: 'tarefa', titulo: sugestao.titulo, salaId: null, data: undefined, marcar: false };
    let certeza: ItemDoChat['certeza'] = !achado || regras!.certeza === 'baixa' || varios ? 'baixa' : 'alta';

    const pessoa = item.pessoaId ? memoria.pessoaPorId(item.pessoaId) : undefined;
    if (pessoa) item.titulo = garantirNome(item.titulo, pessoa.nome);
    const nova = !item.pessoaId && trecho ? pessoaDesconhecida(trecho, memoria) : null;
    if (nova) item.titulo = garantirNome(item.titulo, nova);

    // A sala da IA só vale se regras e memória não decidiram, e sem pessoa
    // desconhecida: aí o cartão pergunta a sala dela, e a memória aprende.
    if (item.salaId === null && !item.pessoaId && !nova) {
      const sala = salaPeloNome(sugestao.sala, salas);
      if (sala) {
        item.salaId = sala;
        item.motivoSala = 'ia';
      }
    }
    return paraChat(item, trecho, certeza, memoria);
  });
}

/** Interpreta a frase com o dia de hoje em Lisboa e a memória atual da loja. */
export async function interpretar(frase: string): Promise<ItemDoChat[]> {
  const memoria = await carregarMemoria();
  const hoje = hojeEmLisboa();
  const pelasRegras = interpretarRegras(frase, hoje, memoria);
  if (pelasRegras.vazia) return [];

  const precisa =
    pelasRegras.certeza === 'baixa' ||
    pelasRegras.itens.some((item) => item.salaId === null) ||
    contarPalavras(frase) > PALAVRAS_PARA_IA;
  if (precisa && motor.estado() === 'pronta') {
    const daIA = await perguntarIA(frase, hoje);
    if (daIA) return mesclar(frase, hoje, daIA.itens, memoria, daIA.salas);
  }
  return pelasRegras.itens.map((item) => paraChat(item, frase, pelasRegras.certeza, memoria));
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
