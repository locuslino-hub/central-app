import { openDB } from 'idb';

export interface Conexao {
  url: string;
  codigo: string;
}

// Banco separado do armazenamento de dados: uma exportação futura dos dados
// nunca leva o código do aparelho junto.
const BANCO = 'central-conexao';
const LOJA = 'conexao';
const CHAVE = 'atual';

/** Só o Google recebe o código: https, o host exato, sem porta nem usuário. */
export function enderecoAceito(url: string): boolean {
  try {
    const { protocol, host, username, password } = new URL(url);
    return protocol === 'https:' && host === 'script.google.com' && !username && !password;
  } catch {
    return false;
  }
}

async function comBanco<T>(usar: (banco: Awaited<ReturnType<typeof abrir>>) => Promise<T>) {
  const banco = await abrir();
  try {
    return await usar(banco);
  } finally {
    banco.close();
  }
}

function abrir() {
  return openDB(BANCO, 1, {
    upgrade(banco) {
      banco.createObjectStore(LOJA);
    },
  });
}

export async function lerConexao(): Promise<Conexao | null> {
  const salva: Conexao | undefined = await comBanco((banco) => banco.get(LOJA, CHAVE));
  return salva ?? null;
}

export async function salvarConexao(conexao: Conexao): Promise<void> {
  if (!enderecoAceito(conexao.url)) throw new Error('Endereço fora de script.google.com');
  await comBanco((banco) => banco.put(LOJA, conexao, CHAVE));
}
