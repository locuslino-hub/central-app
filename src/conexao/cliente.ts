import type { ErroDoScript } from '../../script/api';
import { enderecoAceito, lerConexao, type Conexao } from './guarda';

const TEMPO_LIMITE_MS = 30_000;

const ERROS_DO_SCRIPT: readonly unknown[] = [
  'codigo-invalido',
  'ocupado',
  'interno',
] satisfies ErroDoScript[];

/**
 * Não chegou resposta nenhuma do script: sem conexão salva, rede ou tempo limite.
 * Página que não é JSON e JSON fora do combinado (inclusive `ok` sem `dados`)
 * são `ErroScript('interno')`: o script respondeu, mas mal (C-04).
 */
export class ErroConexao extends Error {
  constructor(mensagem = 'Sem conexão com o script') {
    super(mensagem);
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

async function postar(conexao: Conexao, acao: string, dados: object, tempoLimiteMs: number): Promise<string> {
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), tempoLimiteMs);
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
    throw new ErroScript('interno');
  }
  if (corpo?.ok === true) {
    // Toda ação do script devolve algo (ping devolve `{}`): sem `dados`, a
    // resposta não é do combinado, e quem chamou não recebe `undefined` calado.
    if (!Object.prototype.hasOwnProperty.call(corpo, 'dados')) throw new ErroScript('interno');
    return corpo.dados as T;
  }
  if (corpo?.ok === false && ERROS_DO_SCRIPT.includes(corpo.erro)) {
    throw new ErroScript(corpo.erro as ErroDoScript);
  }
  throw new ErroScript('interno');
}

async function chamarEm<T>(conexao: Conexao, acao: string, dados: object, tempoLimiteMs = TEMPO_LIMITE_MS): Promise<T> {
  if (!enderecoAceito(conexao.url)) throw new ErroConexao();
  return interpretar<T>(await postar(conexao, acao, dados, tempoLimiteMs));
}

/** `tempoLimiteMs`: só para pedidos pesados (áudio), que levam mais que os 30 s padrão. */
export async function chamar<T>(acao: string, dados: object = {}, opcoes: { tempoLimiteMs?: number } = {}): Promise<T> {
  const conexao = await lerConexao().catch(() => null);
  if (!conexao) throw new ErroConexao();
  return chamarEm<T>(conexao, acao, dados, opcoes.tempoLimiteMs);
}

/** Testa uma conexão, salva ou não, e devolve quanto levou em milissegundos. */
export async function ping(conexao: Conexao): Promise<number> {
  const inicio = performance.now();
  await chamarEm(conexao, 'ping', {});
  return performance.now() - inicio;
}
