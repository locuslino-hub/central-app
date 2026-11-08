import { openDB, type IDBPDatabase, type IDBPTransaction } from 'idb';
import { NOMES_DAS_COLECOES, colecaoConhecida, registroValido, type NomeDaColecao } from '../../script/colecoes';
import { vence } from '../../script/dados';
import type {
  Aviso,
  Colecao,
  Colecoes,
  Config,
  Mudanca,
  ParaSalvar,
  Pendente,
  Registro,
  Remoto,
  Sala,
} from './tipos';

// Banco próprio, separado de `central-conexao`: a exportação dos dados nunca
// leva o código do aparelho. O id do aparelho mora em `local`, fora das coleções.
const BANCO = 'central-dados';
// 1: coleções, pendentes, local. 2: avisos (Tarefa 5).
const VERSAO = 2;
const PENDENTES = 'pendentes';
const AVISOS = 'avisos';
const LOCAL = 'local';
const CHAVE_APARELHO = 'aparelho';
/** Carimbo do servidor até onde este aparelho já puxou (R5). */
const CHAVE_DESDE = 'desde';

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
  const entrada: Omit<Pendente, 'seq'> = { tipo: 'registro', colecao, id };
  return tx.objectStore(PENDENTES).add(entrada);
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
    await loja.put({ ...atual, apagado: true, atualizadoEm: carimbo(atual), aparelho });
    await enfileirar(tx, colecao, id);
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

/**
 * Cria as salas iniciais que faltam. Sementes têm `atualizadoEm` 0 e não entram
 * em `pendentes`: todo aparelho as cria igual, e qualquer edição real vence.
 * Id já existente (mesmo apagado ou renomeado) é deixado como está.
 */
export async function semear(): Promise<void> {
  const criadas = await comBanco(async (banco) => {
    const tx = escrever(banco, ['salas']);
    const salas = tx.objectStore('salas');
    const ids: string[] = [];
    for (const [ordem, [id, nome]] of SALAS_INICIAIS.entries()) {
      if (await salas.getKey(id)) continue;
      const sala: Sala = { id, nome, ordem, atualizadoEm: 0, aparelho: SEMENTE };
      await salas.put(sala);
      ids.push(id);
    }
    await tx.done;
    return ids;
  });
  for (const id of criadas) notificar({ colecao: 'salas', id });
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
  return perdedora.atualizadoEm > 0 && perdedora.aparelho !== vencedora.aparelho;
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
          if (local.atualizadoEm > 0) await guardarAviso(colecao, local, remoto);
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
        if (!vencedora) continue;
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
