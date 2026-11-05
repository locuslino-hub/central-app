// Lógica pura do script: nada aqui toca serviços do Google. Tudo o que vem de
// fora chega por `Ambiente`, para rodar igual nos testes e no Apps Script.

export type ErroDoScript = 'codigo-invalido' | 'ocupado' | 'interno';

export type Resposta = { ok: true; dados: unknown } | { ok: false; erro: ErroDoScript };

export interface Ambiente {
  lerCodigo(): string | null;
}

type Acao = (dados: unknown, ambiente: Ambiente) => unknown;

const TAMANHO_MINIMO_DO_CODIGO = 32;

// Map, e não objeto: `acoes.get('constructor')` não acha nada herdado.
const acoes = new Map<unknown, Acao>([['ping', () => ({})]]);

function recusa(erro: ErroDoScript): Resposta {
  return { ok: false, erro };
}

/**
 * Compara sem sair no primeiro caractere diferente. O número de passos depende
 * só do texto enviado, que quem envia já conhece, e nunca do código guardado.
 */
export function iguais(enviado: string, guardado: string): boolean {
  let diferenca = enviado.length ^ guardado.length;
  for (let i = 0; i < enviado.length; i++) {
    // Além do fim do guardado, charCodeAt dá NaN, que o ^ trata como 0.
    diferenca |= enviado.charCodeAt(i) ^ guardado.charCodeAt(i);
  }
  return diferenca === 0;
}

function codigoConfere(enviado: unknown, guardado: string | null): boolean {
  if (typeof enviado !== 'string') return false;
  if (guardado === null || guardado.length < TAMANHO_MINIMO_DO_CODIGO) return false;
  return iguais(enviado, guardado);
}

export function tratar(pedido: unknown, ambiente: Ambiente): Resposta {
  try {
    const { codigo, acao, dados } = (pedido ?? {}) as Record<string, unknown>;
    // O código vem antes da ação: sem ele, ninguém descobre quais ações existem.
    if (!codigoConfere(codigo, ambiente.lerCodigo())) return recusa('codigo-invalido');
    const executar = acoes.get(acao);
    if (!executar) return recusa('interno');
    return { ok: true, dados: executar(dados, ambiente) };
  } catch {
    return recusa('interno');
  }
}

export function tratarCorpo(corpo: string | undefined, ambiente: Ambiente): Resposta {
  let pedido: unknown;
  try {
    pedido = JSON.parse(corpo as string);
  } catch {
    return recusa('interno');
  }
  return tratar(pedido, ambiente);
}

/** Dois UUIDs v4 sem hífens: 64 caracteres, 244 bits aleatórios. */
export function novoCodigo(gerarUuid: () => string): string {
  return (gerarUuid() + gerarUuid()).replace(/-/g, '');
}
