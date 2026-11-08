import { openDB, type IDBPTransaction } from 'idb';
import type { Colecao, Colecoes, Config, Mudanca, ParaSalvar, Pendente, Sala } from './tipos';

// Banco próprio, separado de `central-conexao`: a exportação dos dados nunca
// leva o código do aparelho. O id do aparelho mora em `local`, fora das coleções.
const BANCO = 'central-dados';
const VERSAO = 1;
const PENDENTES = 'pendentes';
const LOCAL = 'local';
const CHAVE_APARELHO = 'aparelho';

// Nova coleção: acrescentar aqui e em `Colecoes`, e subir VERSAO.
const COLECOES: Record<Colecao, true> = {
  salas: true,
  pessoas: true,
  tarefas: true,
  palavras: true,
  documentos: true,
  paginas: true,
  estadosEmail: true,
  rascunhos: true,
  config: true,
};

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

function abrir() {
  return openDB(BANCO, VERSAO, {
    upgrade(banco) {
      for (const colecao of Object.keys(COLECOES)) {
        if (!banco.objectStoreNames.contains(colecao)) banco.createObjectStore(colecao, { keyPath: 'id' });
      }
      if (!banco.objectStoreNames.contains(PENDENTES)) {
        banco.createObjectStore(PENDENTES, { keyPath: 'seq', autoIncrement: true });
      }
      if (!banco.objectStoreNames.contains(LOCAL)) banco.createObjectStore(LOCAL);
    },
  });
}

type Banco = Awaited<ReturnType<typeof abrir>>;

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
async function aparelhoNa(tx: IDBPTransaction<unknown, string[], 'readwrite'>): Promise<string> {
  const local = tx.objectStore(LOCAL);
  const atual: string | undefined = await local.get(CHAVE_APARELHO);
  if (atual) return atual;
  const novo = crypto.randomUUID();
  await local.put(novo, CHAVE_APARELHO);
  return novo;
}

function avisar(mudanca: Mudanca) {
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
    const tx = banco.transaction([colecao, PENDENTES, LOCAL], 'readwrite');
    const aparelho = await aparelhoNa(tx);
    const novo = {
      ...registro,
      id: registro.id || crypto.randomUUID(),
      atualizadoEm: Date.now(),
      aparelho,
    } as Colecoes[C];
    await tx.objectStore(colecao).put(novo);
    await enfileirar(tx, colecao, novo.id);
    await tx.done;
    return novo;
  });
  avisar({ colecao, id: salvo.id });
  return salvo;
}

function enfileirar(tx: IDBPTransaction<unknown, string[], 'readwrite'>, colecao: Colecao, id: string) {
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
    const tx = banco.transaction([colecao, PENDENTES, LOCAL], 'readwrite');
    const loja = tx.objectStore(colecao);
    const atual: Colecoes[C] | undefined = await loja.get(id);
    if (!atual || atual.apagado) {
      await tx.done;
      return undefined;
    }
    const aparelho = await aparelhoNa(tx);
    await loja.put({ ...atual, apagado: true, atualizadoEm: Date.now(), aparelho });
    await enfileirar(tx, colecao, id);
    await tx.done;
    return atual;
  });
  if (antes) avisar({ colecao, id });
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
    const tx = banco.transaction('salas', 'readwrite');
    const ids: string[] = [];
    for (const [ordem, [id, nome]] of SALAS_INICIAIS.entries()) {
      if (await tx.store.getKey(id)) continue;
      const sala: Sala = { id, nome, ordem, atualizadoEm: 0, aparelho: SEMENTE };
      await tx.store.put(sala);
      ids.push(id);
    }
    await tx.done;
    return ids;
  });
  for (const id of criadas) avisar({ colecao: 'salas', id });
}

/** Ajustes atuais; sem nada salvo, os padrões (fim do dia 20:00). Salvar com `salvar('config', …)`. */
export async function lerConfig(): Promise<Config> {
  const salva: Config | undefined = await comBanco((banco) => banco.get('config', ID_CONFIG));
  return salva && !salva.apagado ? salva : { ...CONFIG_PADRAO };
}
