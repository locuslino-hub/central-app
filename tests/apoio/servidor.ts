// O script de verdade (tratar + dados.ts) com o Drive na memória, no lugar de `chamar`.
// Os dados passam por JSON nos dois sentidos, como na rede.
import { tratar } from '../../script/api';
import { ErroScript } from '../../src/conexao/cliente';
import { armazemNaMemoria } from './armazem';

const CODIGO = 'codigo-ficticio-de-teste-0123456789abcdef';

export type Pedido = { acao: string; dados: any; tamanho: number };

export function servidorDeTeste() {
  const armazem = armazemNaMemoria();
  armazem.agora = () => Date.now();
  const pedidos: Pedido[] = [];
  /** Devolve um erro para lançar no lugar da resposta, ou nada para atender. */
  let antes: ((acao: string, vez: number) => Error | undefined) | undefined;
  let depois: ((acao: string) => Promise<void> | void) | undefined;

  async function chamar<T>(acao: string, dados: object = {}): Promise<T> {
    const corpo = JSON.stringify({ codigo: CODIGO, acao, dados });
    const copia = JSON.parse(corpo).dados;
    pedidos.push({ acao, dados: copia, tamanho: corpo.length });
    const erro = antes?.(acao, pedidos.filter((p) => p.acao === acao).length);
    if (erro) throw erro;
    const resposta = tratar({ codigo: CODIGO, acao, dados: copia }, { lerCodigo: () => CODIGO, armazem });
    await depois?.(acao);
    if (!resposta.ok) throw new ErroScript(resposta.erro);
    return JSON.parse(JSON.stringify(resposta.dados)) as T;
  }

  return {
    armazem,
    pedidos,
    chamar,
    /** Pedidos de uma ação, na ordem. */
    de: (acao: string) => pedidos.filter((p) => p.acao === acao),
    falharAntes(regra: typeof antes) {
      antes = regra;
    },
    /** Roda algo depois de o servidor atender e antes de a resposta chegar ao app. */
    aoResponder(acao: typeof depois) {
      depois = acao;
    },
  };
}
