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

const CAMINHO_DE_WEB_APP = /^\/(a\/macros\/[^/]+\/|macros\/)s\/[\w-]+\/exec$/;

/**
 * Limita para onde o código pode ir: só web apps do Apps Script, em https, sem
 * porta nem usuário. Não prova que o script é do dono: qualquer pessoa pode
 * publicar um web app nesse endereço.
 */
export function enderecoAceito(url: string): boolean {
  try {
    const { protocol, host, username, password, pathname } = new URL(url);
    return (
      protocol === 'https:' &&
      host === 'script.google.com' &&
      !username &&
      !password &&
      CAMINHO_DE_WEB_APP.test(pathname)
    );
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
  if (!enderecoAceito(conexao.url)) throw new Error('Endereço não é de um web app do Apps Script');
  await comBanco((banco) => banco.put(LOJA, conexao, CHAVE));
}
