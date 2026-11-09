import { openDB, type IDBPDatabase, type IDBPTransaction } from 'idb';
import { NOMES_DAS_COLECOES, colecaoConhecida, registroValido, type NomeDaColecao } from '../../script/colecoes';
import { vence } from '../../script/dados';
import type {
  Aviso,
  Colecao,
  Colecoes,
  Config,
  ControleDaFila,
  EventoPendente,
  Mudanca,
  Palavra,
  ParaSalvar,
  Pendente,
  PendenteAgenda,
  PendenteEspelho,
  PendenteRegistro,
  Registro,
  Remoto,
  Sala,
  Tarefa,
} from './tipos';

// Banco próprio, separado de `central-conexao`: a exportação dos dados nunca
// leva o código do aparelho. O id do aparelho mora em `local`, fora das coleções.
const BANCO = 'central-dados';
// 1: coleções, pendentes, local. 2: avisos (Tarefa 5). 3: eventosFeitos e
// espelhos (feito espelhado). 4: coresDasSalas.
const VERSAO = 4;
const PENDENTES = 'pendentes';
const AVISOS = 'avisos';
const LOCAL = 'local';
/**
 * Id da tarefa na Central -> id da espelho no Google Tarefas. Só deste
 * aparelho: não sincroniza (gravar na tarefa poderia vencer uma edição feita
 * offline no outro aparelho). Sem ele, o script acha a espelho pelas notas.
 */
const ESPELHOS = 'espelhos';
const CHAVE_APARELHO = 'aparelho';
/** Carimbo do servidor até onde este aparelho já puxou (R5). */
const CHAVE_DESDE = 'desde';
/** Relógio do servidor menos o deste aparelho, em ms, medido no último puxar (nulo: o script não informou). */
const CHAVE_RELOGIO = 'relogio';

// Nova coleção: acrescentar em script/colecoes.ts (o script valida pela mesma
// lista) e em `Colecoes`, e subir VERSAO. As duas linhas abaixo não compilam se
// as listas divergirem.
const _todasNoModulo: Record<Colecao, unknown> = {} as Record<NomeDaColecao, unknown>;
const _nadaAMais: Record<NomeDaColecao, unknown> = {} as Record<Colecao, unknown>;
void _todasNoModulo;
void _nadaAMais;

/** Avisos guardados no máximo; os mais velhos saem. */
export const AVISOS_NO_MAXIMO = 200;

/** Quem gravou as sementes: igual em todo aparelho, para as cópias serem idênticas. */
const SEMENTE = 'semente';

// Ids fixos: dois aparelhos semeiam as mesmas salas, e a sincronia não duplica.
const SALAS_INICIAIS: [id: string, nome: string][] = [
  ['sala-doutoramento', 'Doutoramento'],
  ['sala-investigacao', 'Investigação'],
  ['sala-aulas', 'Aulas'],
  ['sala-orientacoes', 'Orientações'],
  ['sala-mba', 'MBA'],
  ['sala-pessoal', 'Pessoal'],
  ['sala-casa', 'Casa'],
];

/**
 * Palavras que a memória do chat já conhece (Tarefa 8): `termo` como o dono
 * escreveria, ligado a uma sala, no singular e no plural (a memória compara
 * palavra inteira). Ids fixos pelo mesmo motivo das salas.
 */
export const PALAVRAS_INICIAIS: readonly [id: string, termo: string, salaId: string][] = [
  ['palavra-banheiro', 'banheiro', 'sala-casa'],
  ['palavra-banheiros', 'banheiros', 'sala-casa'],
  ['palavra-cozinha', 'cozinha', 'sala-casa'],
  ['palavra-cozinhas', 'cozinhas', 'sala-casa'],
  ['palavra-lampada', 'lâmpada', 'sala-casa'],
  ['palavra-lampadas', 'lâmpadas', 'sala-casa'],
  ['palavra-chuveiro', 'chuveiro', 'sala-casa'],
  ['palavra-chuveiros', 'chuveiros', 'sala-casa'],
  ['palavra-torneira', 'torneira', 'sala-casa'],
  ['palavra-torneiras', 'torneiras', 'sala-casa'],
  ['palavra-projeto', 'projeto', 'sala-investigacao'],
  ['palavra-projetos', 'projetos', 'sala-investigacao'],
  ['palavra-tese', 'tese', 'sala-doutoramento'],
  ['palavra-teses', 'teses', 'sala-doutoramento'],
  ['palavra-aula', 'aula', 'sala-aulas'],
  ['palavra-aulas', 'aulas', 'sala-aulas'],
  ['palavra-orientacao', 'orientação', 'sala-orientacoes'],
  ['palavra-orientacoes', 'orientações', 'sala-orientacoes'],
  ['palavra-aluna', 'aluna', 'sala-orientacoes'],
  ['palavra-alunas', 'alunas', 'sala-orientacoes'],
  ['palavra-mba', 'MBA', 'sala-mba'],
];

const ID_CONFIG = 'geral';
const CONFIG_PADRAO: Config = { id: ID_CONFIG, atualizadoEm: 0, aparelho: SEMENTE, fimDoDia: '20:00' };

type Ouvinte = (mudanca: Mudanca) => void;
const ouvintes = new Set<Ouvinte>();

function abrir(): Promise<IDBPDatabase> {
  return openDB(BANCO, VERSAO, {
    // Só cria o que falta: nada que já existe é apagado na subida de versão.
    upgrade(banco, versaoAntiga, _versaoNova, tx) {
      for (const colecao of NOMES_DAS_COLECOES) {
        if (!banco.objectStoreNames.contains(colecao)) banco.createObjectStore(colecao, { keyPath: 'id' });
      }
      if (!banco.objectStoreNames.contains(PENDENTES)) {
        banco.createObjectStore(PENDENTES, { keyPath: 'seq', autoIncrement: true });
      }
      if (!banco.objectStoreNames.contains(AVISOS)) {
        banco.createObjectStore(AVISOS, { keyPath: 'id', autoIncrement: true });
      }
      if (!banco.objectStoreNames.contains(LOCAL)) banco.createObjectStore(LOCAL);
      if (!banco.objectStoreNames.contains(ESPELHOS)) banco.createObjectStore(ESPELHOS);
      // Versão nova pode trazer coleção nova, que antes era ignorada ao puxar:
      // a marca volta a 0 e o próximo puxar traz tudo de novo.
      if (versaoAntiga > 0) tx.objectStore(LOCAL).delete(CHAVE_DESDE).catch(() => {});
    },
  });
}

type Banco = IDBPDatabase;
type Escrita = IDBPTransaction<unknown, string[], 'readwrite'>;

/**
 * Transação de escrita. Se um pedido falha, quem o espera já recebe o erro;
 * sem o catch, a rejeição de `done` (transação abortada) ficaria solta.
 */
function escrever(banco: Banco, lojas: string[]): Escrita {
  const tx = banco.transaction(lojas, 'readwrite');
  tx.done.catch(() => {});
  return tx;
}

// Abre e fecha a cada operação: não segura conexão que trave a subida de versão.
async function comBanco<T>(usar: (banco: Banco) => Promise<T>): Promise<T> {
  const banco = await abrir();
  try {
    return await usar(banco);
  } finally {
    banco.close();
  }
}

// Lido e criado dentro da transação de escrita: escritas simultâneas no
// primeiro uso enxergam o mesmo id.
async function aparelhoNa(tx: Escrita): Promise<string> {
  const local = tx.objectStore(LOCAL);
  const atual: string | undefined = await local.get(CHAVE_APARELHO);
  if (atual) return atual;
  const novo = crypto.randomUUID();
  await local.put(novo, CHAVE_APARELHO);
  return novo;
}

function notificar(mudanca: Mudanca) {
  for (const ouvinte of [...ouvintes]) {
    try {
      ouvinte(mudanca);
    } catch (erro) {
      console.error('Ouvinte da loja falhou', erro);
    }
  }
}

/** Grava (inserindo ou substituindo) com a hora atual e este aparelho, e enfileira em `pendentes`. */
export async function salvar<C extends Colecao>(
  colecao: C,
  registro: ParaSalvar<Colecoes[C]>,
): Promise<Colecoes[C]> {
  const salvo = await comBanco(async (banco) => {
    const tx = escrever(banco, [colecao, PENDENTES, LOCAL]);
    const aparelho = await aparelhoNa(tx);
    const loja = tx.objectStore(colecao);
    // Config é um registro só, sempre 'geral': é esse que lerConfig lê.
    const id = colecao === 'config' ? ID_CONFIG : registro.id || crypto.randomUUID();
    const atual: Registro | undefined = id === registro.id || colecao === 'config' ? await loja.get(id) : undefined;
    const novo = { ...registro, id, atualizadoEm: carimbo(atual), aparelho } as Colecoes[C];
    await loja.put(novo);
    await enfileirar(tx, colecao, novo.id);
    if (colecao === 'tarefas') await espelharSeMudou(tx, atual as Tarefa | undefined, novo as Tarefa);
    await tx.done;
    return novo;
  });
  notificar({ colecao, id: salvo.id });
  return salvo;
}

/**
 * Hora atual, mas sempre acima do carimbo que o registro já tem: relógio que
 * voltou ou versão recebida de aparelho adiantado não fazem a edição nova perder.
 */
function carimbo(atual: Registro | undefined): number {
  return Math.max(Date.now(), atual ? atual.atualizadoEm + 1 : 0);
}

function enfileirar(tx: Escrita, colecao: Colecao, id: string) {
  const entrada: Omit<PendenteRegistro, 'seq'> = { tipo: 'registro', colecao, id };
  return tx.objectStore(PENDENTES).add(entrada);
}

// ---- Espelho no Google (feito espelhado) ----

/**
 * O que a tarefa espelho no Google Tarefas mostra. `null`: a tarefa não é
 * espelhada (não existe, ou é compromisso antigo com hora, que vai para o
 * Google Agenda pela migração).
 */
export function espelhoDaTarefa(tarefa: Tarefa | undefined): string | null {
  if (!tarefa || tarefa.inicio) return null;
  return JSON.stringify([String(tarefa.titulo ?? ''), tarefa.data ?? null, !!tarefa.feito, !!tarefa.apagado]);
}

/**
 * Na mesma escrita da tarefa: se o que a espelho mostra mudou, entra um
 * `espelharTarefa` na fila. Mudar só a duração, a sala ou o id da espelho não
 * mexe no Google; apagar o que nunca foi espelhado também não.
 */
async function espelharSeMudou(tx: Escrita, antes: Tarefa | undefined, depois: Tarefa) {
  const de = espelhoDaTarefa(antes);
  const para = espelhoDaTarefa(depois);
  if (para === null || para === de || (de === null && depois.apagado)) return;
  await tx.objectStore(PENDENTES).add(entradaDeEspelho({ tipo: 'espelho', acao: 'espelharTarefa', tarefaId: depois.id }));
}

type AcaoDeEspelho =
  | Omit<Extract<PendenteEspelho, { acao: 'espelharTarefa' }>, 'seq' | 'criadoEm' | 'tentativas'>
  | Omit<Extract<PendenteEspelho, { acao: 'marcarEventoFeito' }>, 'seq' | 'criadoEm' | 'tentativas'>
  | Omit<Extract<PendenteEspelho, { acao: 'marcarTarefaGoogle' }>, 'seq' | 'criadoEm' | 'tentativas'>;

function entradaDeEspelho(acao: AcaoDeEspelho): Omit<PendenteEspelho, 'seq'> {
  return { ...acao, criadoEm: Date.now(), tentativas: 0 };
}

/**
 * Põe o "✓ " de um compromisso na fila. Um pedido anterior do mesmo evento
 * que ainda não saiu é trocado por este: vale o último toque.
 */
export async function enfileirarMarcaDeFeito(id: string, feito: boolean): Promise<number> {
  return comBanco(async (banco) => {
    const tx = escrever(banco, [PENDENTES]);
    const fila = tx.objectStore(PENDENTES);
    const todas: Pendente[] = await fila.getAll();
    for (const p of todas) {
      if (p.tipo === 'espelho' && p.acao === 'marcarEventoFeito' && p.id === id) await fila.delete(p.seq);
    }
    const seq = (await fila.add(entradaDeEspelho({ tipo: 'espelho', acao: 'marcarEventoFeito', id, feito }))) as number;
    await tx.done;
    return seq;
  });
}

/**
 * Põe o feito de um bloco do Google Tarefas na fila (conclui ou reabre a
 * tarefa lá). Como no "✓ ": um pedido anterior da mesma tarefa que ainda não
 * saiu é trocado por este.
 */
export async function enfileirarMarcaDeTarefa(taskId: string, feito: boolean): Promise<number> {
  return comBanco(async (banco) => {
    const tx = escrever(banco, [PENDENTES]);
    const fila = tx.objectStore(PENDENTES);
    const todas: Pendente[] = await fila.getAll();
    for (const p of todas) {
      if (p.tipo === 'espelho' && p.acao === 'marcarTarefaGoogle' && p.taskId === taskId) await fila.delete(p.seq);
    }
    const seq = (await fila.add(entradaDeEspelho({ tipo: 'espelho', acao: 'marcarTarefaGoogle', taskId, feito }))) as number;
    await tx.done;
    return seq;
  });
}

/** O script respondeu o id da espelho: fica só neste aparelho (ver ESPELHOS). Não mexe na tarefa nem na fila. */
export async function guardarIdDoEspelho(tarefaId: string, googleId: string): Promise<void> {
  await comBanco((banco) => banco.put(ESPELHOS, googleId, tarefaId));
}

/** A espelho foi apagada: o id guardado sai. */
export async function esquecerIdDoEspelho(tarefaId: string): Promise<void> {
  await comBanco((banco) => banco.delete(ESPELHOS, tarefaId));
}

/** Os ids das espelhos guardados neste aparelho, na ordem pedida (`undefined` onde não há). */
export async function lerIdsDoEspelho(tarefaIds: readonly string[]): Promise<(string | undefined)[]> {
  if (tarefaIds.length === 0) return [];
  return comBanco(async (banco) => {
    const tx = banco.transaction(ESPELHOS, 'readonly');
    tx.done.catch(() => {});
    const ids: unknown[] = await Promise.all(tarefaIds.map((id) => tx.objectStore(ESPELHOS).get(id)));
    return ids.map((id) => (typeof id === 'string' ? id : undefined));
  });
}

/**
 * Tarefas abertas que ainda não têm espelho (criadas antes do espelho, ou em
 * outro aparelho com versão antiga) entram na fila, sem repetir as que já
 * estão lá. Concluídas antigas não vão: o Google não precisa do histórico.
 * Devolve quantas entraram.
 */
export async function enfileirarEspelhosQueFaltam(): Promise<number> {
  return comBanco(async (banco) => {
    const tx = escrever(banco, ['tarefas', PENDENTES, ESPELHOS]);
    const tarefas: Tarefa[] = await tx.objectStore('tarefas').getAll();
    const comEspelho = new Set((await tx.objectStore(ESPELHOS).getAllKeys()).map(String));
    const fila = tx.objectStore(PENDENTES);
    const todas: Pendente[] = await fila.getAll();
    const naFila = new Set(todas.flatMap((p) => (p.tipo === 'espelho' && p.acao === 'espelharTarefa' ? [p.tarefaId] : [])));
    let quantas = 0;
    for (const tarefa of tarefas) {
      if (tarefa.apagado || tarefa.feito || comEspelho.has(tarefa.id) || naFila.has(tarefa.id)) continue;
      if (espelhoDaTarefa(tarefa) === null) continue;
      await fila.add(entradaDeEspelho({ tipo: 'espelho', acao: 'espelharTarefa', tarefaId: tarefa.id }));
      quantas++;
    }
    await tx.done;
    return quantas;
  });
}

/** Registros da coleção. Lápides (`apagado`) só aparecem com `comApagados`. */
export async function listar<C extends Colecao>(
  colecao: C,
  opcoes: { comApagados?: boolean } = {},
): Promise<Colecoes[C][]> {
  const todos: Colecoes[C][] = await comBanco((banco) => banco.getAll(colecao));
  return opcoes.comApagados ? todos : todos.filter((registro) => !registro.apagado);
}

/**
 * Marca `apagado` (lápide, para a exclusão sincronizar) e enfileira em `pendentes`.
 * Devolve o registro como era antes, para quem quiser registrar o desfazer;
 * `undefined` se não havia registro vivo com esse id.
 */
export async function apagar<C extends Colecao>(colecao: C, id: string): Promise<Colecoes[C] | undefined> {
  const antes = await comBanco(async (banco) => {
    const tx = escrever(banco, [colecao, PENDENTES, LOCAL]);
    const loja = tx.objectStore(colecao);
    const atual: Colecoes[C] | undefined = await loja.get(id);
    if (!atual || atual.apagado) {
      await tx.done;
      return undefined;
    }
    const aparelho = await aparelhoNa(tx);
    const lapide = { ...atual, apagado: true, atualizadoEm: carimbo(atual), aparelho };
    await loja.put(lapide);
    await enfileirar(tx, colecao, id);
    if (colecao === 'tarefas') await espelharSeMudou(tx, atual as Tarefa, lapide as Tarefa);
    await tx.done;
    return atual;
  });
  if (antes) notificar({ colecao, id });
  return antes;
}

/** O ouvinte é chamado depois de cada escrita gravada. Devolve a função que cancela. */
export function assinar(ouvinte: Ouvinte): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

/** Fila do que ainda não foi enviado, na ordem das escritas. */
export async function listarPendentes(): Promise<Pendente[]> {
  return comBanco((banco) => banco.getAll(PENDENTES));
}

// ---- Ações do Google Agenda na fila (Tarefa 12) ----

/** Tentativas recusadas, ou dias na fila, depois dos quais a sincronia desiste de tentar sozinha. */
export const TENTATIVAS_NO_MAXIMO = 20;
export const DIAS_NA_FILA_NO_MAXIMO = 7;

/** A ação, como se entrega a `enfileirarAgenda`: o `seq` e o controle são postos aqui. */
export type AcaoDeAgenda =
  | Omit<Extract<PendenteAgenda, { acao: 'criarEvento' }>, 'seq' | 'criadoEm' | 'tentativas'>
  | Omit<Extract<PendenteAgenda, { acao: 'removerEvento' }>, 'seq' | 'criadoEm' | 'tentativas'>;

/** A sincronia parou de tentar esta ação (de agenda ou de espelho): muitas recusas ou muito tempo na fila. */
export function agendaEsgotada(acao: ControleDaFila, agora = Date.now()): boolean {
  if ((acao.tentativas ?? 0) >= TENTATIVAS_NO_MAXIMO) return true;
  return acao.criadoEm !== undefined && agora - acao.criadoEm > DIAS_NA_FILA_NO_MAXIMO * 24 * 60 * 60 * 1000;
}

/** Põe a ação na fila `pendentes`, junto das de registro. Devolve o `seq`. */
export async function enfileirarAgenda(acao: AcaoDeAgenda): Promise<number> {
  return comBanco(async (banco) => {
    const tx = escrever(banco, [PENDENTES]);
    const seq = (await tx.objectStore(PENDENTES).add({ ...acao, criadoEm: Date.now(), tentativas: 0 })) as number;
    await tx.done;
    return seq;
  });
}

/**
 * Tira uma entrada da fila de uma vez só. `true` se ela estava lá: quem a
 * enviou com sucesso e recebe `false` sabe que alguém a desfez no meio do envio.
 */
export async function retirarPendente(seq: number): Promise<boolean> {
  return comBanco(async (banco) => {
    const tx = escrever(banco, [PENDENTES]);
    const fila = tx.objectStore(PENDENTES);
    const havia = (await fila.getKey(seq)) !== undefined;
    if (havia) await fila.delete(seq);
    await tx.done;
    return havia;
  });
}

/** Conta uma recusa do script ou do Google (sem internet não conta). */
export async function registrarTentativa(seq: number): Promise<void> {
  await comBanco(async (banco) => {
    const tx = escrever(banco, [PENDENTES]);
    const fila = tx.objectStore(PENDENTES);
    const atual: Pendente | undefined = await fila.get(seq);
    if (atual?.tipo === 'agenda' || atual?.tipo === 'espelho') await fila.put({ ...atual, tentativas: (atual.tentativas ?? 0) + 1 });
    await tx.done;
  });
}

/** "Tentar de novo": as ações paradas voltam a valer, com a contagem e o prazo zerados. */
export async function reiniciarAgendaParada(): Promise<void> {
  await comBanco(async (banco) => {
    const tx = escrever(banco, [PENDENTES]);
    const fila = tx.objectStore(PENDENTES);
    const agora = Date.now();
    const todas: Pendente[] = await fila.getAll();
    for (const p of todas) {
      if ((p.tipo === 'agenda' || p.tipo === 'espelho') && agendaEsgotada(p, agora)) {
        await fila.put({ ...p, criadoEm: agora, tentativas: 0 });
      }
    }
    await tx.done;
  });
}

/**
 * Migração, fase 1: põe na fila o `criarEvento` de cada tarefa antiga com hora.
 * A tarefa continua à vista. Lê a tarefa de novo dentro da escrita e pula a que
 * já foi levada, apagada, ou cujo título, dia ou hora mudaram desde o plano;
 * pula também a que já tem um pedido na fila. Devolve quantas entraram.
 */
export async function levarTarefasParaAgenda(planos: readonly { tarefaId: string; evento: EventoPendente }[]): Promise<number> {
  let levadas = 0;
  for (const { tarefaId, evento } of planos) {
    const levou = await comBanco(async (banco) => {
      const tx = escrever(banco, ['tarefas', PENDENTES]);
      const atual: Colecoes['tarefas'] | undefined = await tx.objectStore('tarefas').get(tarefaId);
      const fila = tx.objectStore(PENDENTES);
      const todas: Pendente[] = await fila.getAll();
      const jaNaFila = todas.some((p) => p.tipo === 'agenda' && p.acao === 'criarEvento' && p.migrarTarefaId === tarefaId);
      const mudou =
        !atual || atual.apagado || atual.titulo !== evento.titulo || atual.data !== evento.data || atual.inicio !== evento.inicio;
      if (jaNaFila || mudou) {
        await tx.done;
        return false;
      }
      await fila.add({ tipo: 'agenda', acao: 'criarEvento', evento, migrarTarefaId: tarefaId, criadoEm: Date.now(), tentativas: 0 });
      await tx.done;
      return true;
    });
    if (levou) levadas++;
  }
  return levadas;
}

/**
 * Migração, fase 2: o script confirmou o evento. Numa escrita só, tira a
 * entrada da fila e resolve a tarefa antiga: se segue como no plano, vira
 * lápide (sincroniza); se o dono a mudou nesse meio tempo, fica, só sem a hora
 * de início (o evento já existe; nada do que ele escreveu se perde).
 */
export async function concluirMigracao(seq: number, tarefaId: string, evento: EventoPendente): Promise<void> {
  const mudada = await comBanco(async (banco) => {
    const tx = escrever(banco, ['tarefas', PENDENTES, LOCAL]);
    await tx.objectStore(PENDENTES).delete(seq);
    const loja = tx.objectStore('tarefas');
    const atual: Colecoes['tarefas'] | undefined = await loja.get(tarefaId);
    if (!atual || atual.apagado || !atual.inicio) {
      await tx.done;
      return false;
    }
    const aparelho = await aparelhoNa(tx);
    const igual = atual.titulo === evento.titulo && atual.data === evento.data && atual.inicio === evento.inicio;
    if (igual) {
      await loja.put({ ...atual, apagado: true, atualizadoEm: carimbo(atual), aparelho });
    } else {
      const { inicio: _inicio, ...semHora } = atual;
      const tarefa = { ...semHora, atualizadoEm: carimbo(atual), aparelho };
      await loja.put(tarefa);
      // Sem a hora, ela passa a ser tarefa comum: vai para o Google Tarefas.
      await espelharSeMudou(tx, atual, tarefa);
    }
    await enfileirar(tx, 'tarefas', tarefaId);
    await tx.done;
    return true;
  });
  if (mudada) notificar({ colecao: 'tarefas', id: tarefaId });
}

/** Uma entrada da fila, ou `undefined` se já saiu (enviada ou desfeita). */
export async function lerPendente(seq: number): Promise<Pendente | undefined> {
  return comBanco((banco) => banco.get(PENDENTES, seq));
}

/**
 * Tira da fila o `criarEvento` ainda não enviado desse evento, de uma vez só.
 * `true` se havia: o evento nunca chegou à agenda por aqui e não há o que remover.
 */
export async function retirarCriacaoPendente(eventoId: string): Promise<boolean> {
  return comBanco(async (banco) => {
    const tx = escrever(banco, [PENDENTES]);
    const fila = tx.objectStore(PENDENTES);
    const todas: Pendente[] = await fila.getAll();
    const achadas = todas.filter((p) => p.tipo === 'agenda' && p.acao === 'criarEvento' && p.evento.id === eventoId);
    for (const achada of achadas) await fila.delete(achada.seq);
    await tx.done;
    return achadas.length > 0;
  });
}

/** Troca a sala de um `criarEvento` ainda na fila. `false` se ele já não está lá. */
export async function trocarSalaPendente(eventoId: string, salaId: string | null): Promise<boolean> {
  return comBanco(async (banco) => {
    const tx = escrever(banco, [PENDENTES]);
    const fila = tx.objectStore(PENDENTES);
    const todas: Pendente[] = await fila.getAll();
    let achou = false;
    for (const p of todas) {
      if (p.tipo === 'agenda' && p.acao === 'criarEvento' && p.evento.id === eventoId) {
        await fila.put({ ...p, evento: { ...p.evento, salaId } });
        achou = true;
      }
    }
    await tx.done;
    return achou;
  });
}

/**
 * Grava as sementes que faltam numa coleção. Sementes têm `atualizadoEm` 0 e
 * não entram em `pendentes`: todo aparelho as cria igual, e qualquer edição
 * real vence. Id já existente (mesmo apagado ou alterado) é deixado como está.
 * Os ouvintes só ouvem das que foram criadas agora.
 */
async function semearColecao<C extends 'salas' | 'palavras'>(colecao: C, sementes: Colecoes[C][]): Promise<void> {
  const criadas = await comBanco(async (banco) => {
    const tx = escrever(banco, [colecao]);
    const loja = tx.objectStore(colecao);
    const ids: string[] = [];
    for (const semente of sementes) {
      if (await loja.getKey(semente.id)) continue;
      await loja.put(semente);
      ids.push(semente.id);
    }
    await tx.done;
    return ids;
  });
  for (const id of criadas) notificar({ colecao, id });
}

/** Cria as salas iniciais que faltam (ver `semearColecao`). */
export async function semear(): Promise<void> {
  const salas = SALAS_INICIAIS.map(
    ([id, nome], ordem): Sala => ({ id, nome, ordem, atualizadoEm: 0, aparelho: SEMENTE }),
  );
  await semearColecao('salas', salas);
}

/** Cria as palavras iniciais da memória do chat que faltam, com a mesma regra das salas. */
export async function semearPalavras(): Promise<void> {
  const palavras = PALAVRAS_INICIAIS.map(
    ([id, termo, salaId]): Palavra => ({ id, termo, salaId, atualizadoEm: 0, aparelho: SEMENTE }),
  );
  await semearColecao('palavras', palavras);
}

/** Ajustes atuais; sem nada salvo, os padrões (fim do dia 20:00). Salvar com `salvar('config', …)`. */
export async function lerConfig(): Promise<Config> {
  const salva: Config | undefined = await comBanco((banco) => banco.get('config', ID_CONFIG));
  return salva && !salva.apagado ? salva : { ...CONFIG_PADRAO };
}


// ---- Para a sincronia (Tarefa 5) ----

/** Lê vários registros, lápides incluídas, numa leitura só. `undefined` onde não há. */
export async function lerRegistros(chaves: readonly Mudanca[]): Promise<(Registro | undefined)[]> {
  if (chaves.length === 0) return [];
  const colecoes = [...new Set(chaves.map((chave) => chave.colecao))];
  return comBanco(async (banco) => {
    const tx = banco.transaction(colecoes, 'readonly');
    tx.done.catch(() => {});
    return Promise.all(chaves.map(({ colecao, id }) => tx.objectStore(colecao).get(id)));
  });
}

/** Tira da fila as entradas já enviadas. Seq que não existe é ignorado. */
export async function removerPendentes(seqs: readonly number[]): Promise<void> {
  if (seqs.length === 0) return;
  await comBanco(async (banco) => {
    const tx = escrever(banco, [PENDENTES]);
    for (const seq of seqs) await tx.objectStore(PENDENTES).delete(seq);
    await tx.done;
  });
}

export async function lerDesde(): Promise<number> {
  const desde: unknown = await comBanco((banco) => banco.get(LOCAL, CHAVE_DESDE));
  return typeof desde === 'number' ? desde : 0;
}

/**
 * Guarda a diferença entre o relógio do servidor (`agoraDoServidor` do puxar)
 * e o deste aparelho. `null` (script antigo, que não informa) apaga a marca:
 * quem confere o relógio passa a não conferir.
 */
export async function salvarRelogioDoServidor(agoraDoServidor: number | null): Promise<void> {
  await comBanco(async (banco) => {
    if (agoraDoServidor === null || !Number.isFinite(agoraDoServidor)) await banco.delete(LOCAL, CHAVE_RELOGIO);
    else await banco.put(LOCAL, agoraDoServidor - Date.now(), CHAVE_RELOGIO);
  });
}

/** Servidor menos aparelho, em ms, ou `null` se o servidor não informou. */
export async function lerDiferencaDeRelogio(): Promise<number | null> {
  const diferenca: unknown = await comBanco((banco) => banco.get(LOCAL, CHAVE_RELOGIO));
  return typeof diferenca === 'number' ? diferenca : null;
}

export async function salvarDesde(desde: number): Promise<void> {
  await comBanco((banco) => banco.put(LOCAL, desde, CHAVE_DESDE));
}

/** Conflitos resolvidos neste aparelho, do mais antigo ao mais novo. */
export async function listarAvisos(): Promise<Aviso[]> {
  return comBanco((banco) => banco.getAll(AVISOS));
}

export async function dispensarAviso(id: number): Promise<void> {
  await comBanco((banco) => banco.delete(AVISOS, id));
}

function objeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

/**
 * Aceita só o que o script também aceitaria (script/colecoes.ts): coleção
 * conhecida, ids e campos com a forma certa, carimbo até 10 min no futuro.
 * O "agora" é o maior entre este relógio e o do servidor: aparelho com
 * relógio atrasado não descarta o que o servidor já aceitou.
 */
function validadorRemoto(relogioDoServidor: number) {
  const agora = Math.max(Date.now(), Number.isFinite(relogioDoServidor) ? relogioDoServidor : 0);
  return (valor: unknown): Remoto[] => {
    if (!objeto(valor)) return [];
    const { colecao, registro } = valor;
    if (!colecaoConhecida(colecao) || !registroValido(colecao, registro, agora)) return [];
    return [{ colecao, registro: registro as Registro }];
  };
}

/**
 * Houve mudança dos dois lados que alguém precisa saber? Não quando a perdedora
 * é semente (`atualizadoEm` 0) nem quando as duas vêm do mesmo aparelho: aí é
 * só uma versão antiga da mesma sequência de edições.
 */
function houveConflito(perdedora: Registro, vencedora: Registro): boolean {
  return perdedora.atualizadoEm > 0 && perdedora.aparelho !== vencedora.aparelho && !mesmoConteudo(perdedora, vencedora);
}

/** Valor com as chaves em ordem, para comparar objetos pelo conteúdo. */
function canonico(valor: unknown): string {
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(',')}]`;
  if (objeto(valor)) {
    const chaves = Object.keys(valor).filter((chave) => valor[chave] !== undefined).sort();
    return `{${chaves.map((chave) => `${JSON.stringify(chave)}:${canonico(valor[chave])}`).join(',')}}`;
  }
  return JSON.stringify(valor) ?? 'null';
}

/**
 * Os dois registros dizem a mesma coisa, só a hora e o aparelho da escrita
 * diferem? Acontece quando os dois aparelhos fazem a mesma mudança por conta
 * própria, como a virada do dia: nada se perdeu, então não há o que avisar.
 */
function mesmoConteudo(a: Registro, b: Registro): boolean {
  const { atualizadoEm: _horaA, aparelho: _aparelhoA, ...restoA } = a;
  const { atualizadoEm: _horaB, aparelho: _aparelhoB, ...restoB } = b;
  return canonico(restoA) === canonico(restoB);
}

/**
 * Grava o que veio do servidor com a hora e o aparelho de origem, sem criar
 * pendentes. Mesclagem por registro: maior `atualizadoEm` vence (`vence`, a
 * mesma regra do script). Só é conflito quando este aparelho tinha alteração
 * por enviar; aí a versão que perde vai para `avisos`. Se a remota vence, os
 * pendentes desse registro saem: a versão local perdeu e não deve ser enviada.
 * Itens malformados ou de coleção desconhecida são ignorados.
 */
export async function gravarDoServidor(itens: readonly unknown[], relogioDoServidor = 0): Promise<void> {
  const remotos = itens.flatMap(validadorRemoto(relogioDoServidor));
  if (remotos.length === 0) return;
  const colecoes = [...new Set(remotos.map((remoto) => remoto.colecao))];

  const mudadas = await comBanco(async (banco) => {
    const tx = escrever(banco, [...colecoes, PENDENTES, AVISOS]);
    const fila = tx.objectStore(PENDENTES);
    const pendentes: Pendente[] = await fila.getAll();
    const mudadas: Mudanca[] = [];
    const guardarAviso = (colecao: Colecao, perdedora: Registro, vencedora: Registro) => {
      const aviso: Omit<Aviso, 'id'> = {
        colecao,
        registroId: vencedora.id,
        perdedora,
        vencedora,
        criadoEm: Date.now(),
      };
      return tx.objectStore(AVISOS).add(aviso);
    };

    for (const { colecao, registro: remoto } of remotos) {
      const loja = tx.objectStore(colecao);
      const local: Registro | undefined = await loja.get(remoto.id);
      const seqs = pendentes
        .filter((p) => p.tipo === 'registro' && p.colecao === colecao && p.id === remoto.id)
        .map((p) => p.seq);
      const temPendente = seqs.length > 0;

      if (local && local.atualizadoEm === remoto.atualizadoEm && local.aparelho === remoto.aparelho) {
        continue; // a mesma versão, inclusive a que este aparelho acabou de enviar
      }
      if (!local || vence(remoto, local)) {
        await loja.put(remoto);
        mudadas.push({ colecao, id: remoto.id, remota: true });
        if (local && temPendente) {
          for (const seq of seqs) await fila.delete(seq);
          // Alteração por enviar perdeu: sempre avisa, mesmo do mesmo aparelho.
          if (local.atualizadoEm > 0 && !mesmoConteudo(local, remoto)) await guardarAviso(colecao, local, remoto);
        }
      } else if (temPendente) {
        // A local vence e segue na fila para o servidor.
        if (houveConflito(remoto, local)) await guardarAviso(colecao, remoto, local);
      } else if (local.atualizadoEm > 0) {
        // O servidor tem uma versão mais velha do que este aparelho já tinha
        // (cópia restaurada): a local volta para a fila, para nada sumir.
        await enfileirar(tx, colecao, local.id);
      }
    }
    await aparar(tx);
    await tx.done;
    return mudadas;
  });
  for (const mudanca of mudadas) notificar(mudanca);
}

/** Deixa só os AVISOS_NO_MAXIMO avisos mais novos (ids crescem com a chegada). */
async function aparar(tx: Escrita) {
  const avisos = tx.objectStore(AVISOS);
  const chaves = await avisos.getAllKeys();
  for (const chave of chaves.slice(0, Math.max(0, chaves.length - AVISOS_NO_MAXIMO))) {
    await avisos.delete(chave);
  }
}

/**
 * Fecha um lote enviado, numa escrita só: as versões de outro aparelho que o
 * envio sobrescreveu no servidor (a corrida entre puxar e enviar) viram
 * avisos, com a versão local atual como vencedora, e os pendentes aceitos
 * saem da fila. Se algo falha, nada muda: os pendentes ficam para a próxima.
 */
export async function concluirEnvio(
  substituidas: readonly unknown[],
  seqsAceitos: readonly number[],
  relogioDoServidor = 0,
): Promise<void> {
  const remotos = substituidas
    .flatMap(validadorRemoto(relogioDoServidor))
    .filter(({ registro }) => registro.atualizadoEm > 0);
  if (remotos.length === 0 && seqsAceitos.length === 0) return;
  const colecoes = [...new Set(remotos.map((remoto) => remoto.colecao))];
  await comBanco(async (banco) => {
    const tx = escrever(banco, [...colecoes, AVISOS, PENDENTES]);
    try {
      for (const seq of seqsAceitos) await tx.objectStore(PENDENTES).delete(seq);
      for (const { colecao, registro: perdedora } of remotos) {
        const vencedora: Registro | undefined = await tx.objectStore(colecao).get(perdedora.id);
        if (!vencedora || mesmoConteudo(perdedora, vencedora)) continue;
        const aviso: Omit<Aviso, 'id'> = {
          colecao,
          registroId: perdedora.id,
          perdedora,
          vencedora,
          criadoEm: Date.now(),
        };
        await tx.objectStore(AVISOS).add(aviso);
      }
      await aparar(tx);
    } catch (erro) {
      // Erro síncrono não aborta sozinho: desfaz o que já foi pedido.
      tx.abort();
      throw erro;
    }
    await tx.done;
  });
}
