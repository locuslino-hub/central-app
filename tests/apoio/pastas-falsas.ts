// O script do Google, de mentira, para as telas de pastas: `criarPasta` e `criarPastasPadraoDaCasa`
// recebem um `chamar` e um `sincronizar` falsos, e o resto do código (banco, hooks, telas) é o de verdade.
// Uso: `vi.mock('../../src/dados/pastas', async (importar) => (await import('../apoio/pastas-falsas')).comScriptFalso(await importar()))`.
import { ErroConexao, ErroScript } from '../../src/conexao/cliente';

type Estado = {
  planilhasCriadas: number;
  pedidos: { acao: string; dados: Record<string, unknown> }[];
  offline: boolean;
  falharNa: number | null;
  segurando: Promise<void> | null;
  apagarNada: boolean;
  organizarPastas: boolean;
};

let estado: Estado = novo();

function novo(): Estado {
  return { planilhasCriadas: 0, pedidos: [], offline: false, falharNa: null, segurando: null, apagarNada: false, organizarPastas: false };
}

export function reiniciarFalso() {
  estado = novo();
}

export function falsoDoScript() {
  return {
    get planilhasCriadas() {
      return estado.planilhasCriadas;
    },
    get pedidos() {
      return estado.pedidos;
    },
    cair() {
      estado.offline = true;
    },
    /** A criação de planilha responde `organizar_pastas` (a Casa ainda está solta na raiz do Drive), até `voltar()`. */
    pedirParaOrganizarPastas() {
      estado.organizarPastas = true;
    },
    organizarFeito() {
      estado.organizarPastas = false;
    },
    voltar() {
      estado.offline = false;
    },
    /** A criação de ordem `n` (1, 2, 3...) falha com erro interno do script. */
    falharNaCriacao(n: number) {
      estado.falharNa = n;
    },
    /** `apagarPasta` não acha a pasta (já apagada em outro aparelho): devolve `undefined` sem apagar. */
    apagarRetornaVazio() {
      estado.apagarNada = true;
    },
    /** A próxima criação de planilha espera por `soltar()`. */
    segurarProximaCriacao() {
      let soltar!: () => void;
      estado.segurando = new Promise<void>((resolver) => {
        soltar = resolver;
      });
      return { soltar };
    },
  };
}

async function chamar<T>(acao: string, dados: object = {}): Promise<T> {
  if (estado.offline) throw new ErroConexao();
  estado.pedidos.push({ acao, dados: dados as Record<string, unknown> });
  if (acao !== 'criarPlanilha') return {} as T;
  const espera = estado.segurando;
  if (espera) {
    estado.segurando = null;
    await espera;
  }
  if (estado.organizarPastas) return { erro: 'organizar_pastas' } as T;
  const ordem = estado.planilhasCriadas + 1;
  if (estado.falharNa === ordem) {
    estado.falharNa = null;
    throw new ErroScript('interno');
  }
  estado.planilhasCriadas = ordem;
  return { planilhaId: `planilha-ficticia-${ordem}` } as T;
}

const sincronizar = async () => (estado.offline ? ('sem-internet' as const) : ('atualizado' as const));

type Real = typeof import('../../src/dados/pastas');

export function comScriptFalso(real: Real): Real {
  return {
    ...real,
    apagarPasta: (id) => (estado.apagarNada ? Promise.resolve(undefined) : real.apagarPasta(id)),
    criarPasta: (dados, opcoes) => real.criarPasta(dados, { chamar, ...opcoes }),
    criarPastasPadraoDaCasa: (opcoes) => real.criarPastasPadraoDaCasa({ chamar, sincronizar, ...opcoes }),
  };
}
