// O script do Google, de mentira, para as telas e o executor que leem e gravam planilhas (V02, Tarefa 13 em diante):
// as planilhas ficam na memória e respondem como o script de verdade (script/planilhas.ts): `lerLinhas`,
// `anexarLinha` (idempotente pelo id) e `atualizarLinha`. O cliente (`src/dados/planilhas.ts`), o banco, a fila e as telas
// são os de verdade. Só valores e nomes fictícios.
// Uso: `vi.mock('../../src/dados/planilhas', async (importar) => (await import('../apoio/planilhas-falsas')).comPlanilhasFalsas(await importar()))`.
import { ErroConexao, ErroScript } from '../../src/conexao/cliente';

export const CABECALHO_CONSUMO = ['Data', 'Leitura', 'Unidade', 'Consumo desde a anterior', 'Observação', 'id'];
export const CABECALHO_FINANCEIRO = ['Data', 'Descrição', 'Categoria', 'Tipo', 'Valor', 'Quem', 'Observação', 'id'];
export const CABECALHO_COMPRAS = ['Item', 'Quantidade', 'Valor', 'Link', 'Prioridade', 'Comprado?', 'Quem pôs', 'Data', 'Observação', 'id'];

type Linha = Record<string, string>;
type Planilha = { cabecalho: string[]; linhas: { id: string; valores: Linha }[] };
type Estado = {
  planilhas: Map<string, Planilha>;
  offline: boolean;
  /** A próxima chamada ao script falha com um erro qualquer (nem de rede, nem do script). */
  falharAProxima: boolean;
  /** Respostas que o script dá no lugar da normal, na ordem, para a ação indicada (uma por chamada). */
  forcadas: { acao: string; resposta: unknown }[];
  /** A próxima chamada a esta ação espera esta promessa (depois de registrada em `pedidos`). */
  seguradas: { acao: string; ate: Promise<void> }[];
  pedidos: { acao: string; dados: Record<string, any> }[];
};

let estado: Estado = novo();

function novo(): Estado {
  return { planilhas: new Map(), offline: false, falharAProxima: false, forcadas: [], seguradas: [], pedidos: [] };
}

export function reiniciarPlanilhas() {
  estado = novo();
}

export function falsoDasPlanilhas() {
  const planilha = (id: string): Planilha => {
    let p = estado.planilhas.get(id);
    if (!p) {
      p = { cabecalho: [...CABECALHO_CONSUMO], linhas: [] };
      estado.planilhas.set(id, p);
    }
    return p;
  };
  return {
    /** Cria (ou troca) a planilha `id`, com as linhas `[id, valores]` já nela. */
    planilha(id: string, linhas: Linha[] = [], cabecalho: string[] = CABECALHO_CONSUMO) {
      estado.planilhas.set(id, { cabecalho: [...cabecalho], linhas: linhas.map((valores, i) => ({ id: `linha-${id}-${i + 1}`, valores: { ...valores } })) });
    },
    linhas: (id: string) => planilha(id).linhas.map((l) => ({ id: l.id, valores: { ...l.valores } })),
    /** Outra pessoa muda a planilha à mão (coluna apagada, por exemplo). */
    mudarCabecalho(id: string, cabecalho: string[]) {
      planilha(id).cabecalho = [...cabecalho];
    },
    get pedidos() {
      return estado.pedidos;
    },
    cair() {
      estado.offline = true;
    },
    voltar() {
      estado.offline = false;
    },
    falharAProxima() {
      estado.falharAProxima = true;
    },
    /** A próxima chamada à ação `acao` fica esperando até chamar o `liberar` devolvido (para testar botões desligados durante a gravação). */
    segurarAProxima(acao: string): () => void {
      let liberar = () => {};
      estado.seguradas.push({ acao, ate: new Promise<void>((r) => (liberar = r)) });
      return () => liberar();
    },
    /** A próxima chamada à ação `acao` recebe `resposta` do script (por exemplo `{ conflito: true }`). */
    responderAProxima(acao: string, resposta: unknown) {
      estado.forcadas.push({ acao, resposta });
    },
  };
}

async function chamar<T>(acao: string, dados: object = {}): Promise<T> {
  const d = dados as Record<string, any>;
  if (estado.offline) throw new ErroConexao();
  if (estado.falharAProxima) {
    estado.falharAProxima = false;
    throw new Error('falha de teste');
  }
  estado.pedidos.push({ acao, dados: d });
  const segurada = estado.seguradas.findIndex((f) => f.acao === acao);
  if (segurada >= 0) await estado.seguradas.splice(segurada, 1)[0]!.ate;
  const forcada = estado.forcadas.findIndex((f) => f.acao === acao);
  if (forcada >= 0) return estado.forcadas.splice(forcada, 1)[0]!.resposta as T;
  const p = estado.planilhas.get(String(d.planilhaId));
  if (!p) return { erro: 'fora_da_pasta' } as T;
  if (acao === 'lerLinhas') {
    if (!p.cabecalho.includes('id')) return { erro: 'coluna_faltando', colunas: ['id'] } as T;
    return { cabecalho: [...p.cabecalho], linhas: p.linhas.map((l) => ({ id: l.id, valores: { ...l.valores } })) } as T;
  }
  const faltam = Object.keys(d.valores ?? {}).filter((c) => !p.cabecalho.includes(c));
  if (faltam.length > 0) return { erro: 'coluna_faltando', colunas: faltam } as T;
  if (acao === 'anexarLinha') {
    if (!p.linhas.some((l) => l.id === d.idDaLinha)) p.linhas.push({ id: d.idDaLinha, valores: { ...d.valores } });
    return { ok: true } as T;
  }
  if (acao === 'atualizarLinha') {
    const linha = p.linhas.find((l) => l.id === d.idDaLinha);
    if (!linha) return { erro: 'linha_nao_achada' } as T;
    Object.assign(linha.valores, d.valores);
    return { ok: true, valores: Object.fromEntries(Object.keys(d.valores).map((c) => [c, linha.valores[c]!])) } as T;
  }
  throw new ErroScript('interno');
}

/** O `chamar` de mentira, para quem precisa enviar a fila (`enviarFilaDePlanilhas`) à mão. */
export const chamarFalso = chamar;

type Real = typeof import('../../src/dados/planilhas');

export function comPlanilhasFalsas(real: Real): Real {
  return {
    ...real,
    lerPlanilha: (pasta, opcoes) => real.lerPlanilha(pasta, { chamar, ...opcoes }),
    anexar: (pasta, valores, opcoes) => real.anexar(pasta, valores, { chamar, ...opcoes }),
    atualizar: (pasta, idDaLinha, valores, opcoes) => real.atualizar(pasta, idDaLinha, valores, { chamar, ...opcoes }),
  };
}
