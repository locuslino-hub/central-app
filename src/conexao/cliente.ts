import type { ErroDoScript } from '../../script/api';
import { enderecoAceito, lerConexao, type Conexao } from './guarda';

const TEMPO_LIMITE_MS = 30_000;

const ERROS_DO_SCRIPT: readonly unknown[] = [
  'codigo-invalido',
  'ocupado',
  'interno',
] satisfies ErroDoScript[];

/** Não chegou uma resposta válida do script: rede, tempo limite ou página que não é JSON. */
export class ErroConexao extends Error {
  constructor() {
    super('Sem conexão com o script');
    this.name = 'ErroConexao';
  }
}

/** O script respondeu e recusou o pedido. */
export class ErroScript extends Error {
  readonly erro: ErroDoScript;

  constructor(erro: ErroDoScript) {
    super(`O script recusou o pedido: ${erro}`);
    this.name = 'ErroScript';
    this.erro = erro;
  }
}

async function postar(conexao: Conexao, acao: string, dados: object): Promise<string> {
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), TEMPO_LIMITE_MS);
  try {
    const resposta = await fetch(conexao.url, {
      method: 'POST',
      // text/plain e nenhum outro cabeçalho: assim o navegador não faz preflight,
      // que o Apps Script não sabe responder.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ codigo: conexao.codigo, acao, dados }),
      redirect: 'follow',
      signal: controle.signal,
    });
    return await resposta.text();
  } catch {
    throw new ErroConexao();
  } finally {
    clearTimeout(relogio);
  }
}

function interpretar<T>(texto: string): T {
  let corpo: { ok?: unknown; dados?: T; erro?: ErroDoScript } | null;
  try {
    corpo = JSON.parse(texto);
  } catch {
    throw new ErroConexao();
  }
  if (corpo?.ok === true) return corpo.dados as T;
  if (corpo?.ok === false && ERROS_DO_SCRIPT.includes(corpo.erro)) {
    throw new ErroScript(corpo.erro as ErroDoScript);
  }
  throw new ErroConexao();
}

async function chamarEm<T>(conexao: Conexao, acao: string, dados: object): Promise<T> {
  if (!enderecoAceito(conexao.url)) throw new ErroConexao();
  return interpretar<T>(await postar(conexao, acao, dados));
}

export async function chamar<T>(acao: string, dados: object = {}): Promise<T> {
  const conexao = await lerConexao().catch(() => null);
  if (!conexao) throw new ErroConexao();
  return chamarEm<T>(conexao, acao, dados);
}

/** Testa uma conexão, salva ou não, e devolve quanto levou em milissegundos. */
export async function ping(conexao: Conexao): Promise<number> {
  const inicio = performance.now();
  await chamarEm(conexao, 'ping', {});
  return performance.now() - inicio;
}
