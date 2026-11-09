// O script de verdade (tratar + dados.ts) com o Drive na memória, no lugar de `chamar`.
// Os dados passam por JSON nos dois sentidos, como na rede.
import { tratar } from '../../script/api';
import { ErroScript } from '../../src/conexao/cliente';
import type { ServicoDeAgenda } from '../../script/agenda';
import type { ServicoDeTarefas } from '../../script/tarefas-google';
import type { CalendarioFalso } from './calendario';
import { armazemNaMemoria } from './armazem';
import { tarefasGoogleFalso } from './tarefas-google';

const CODIGO = 'codigo-ficticio-de-teste-0123456789abcdef';

export type Pedido = { acao: string; dados: any; tamanho: number };

/**
 * `comTarefasGoogle`: o script tem o Google Tarefas (espelho). Sem ele, como
 * um script ainda sem a permissão, `espelharTarefas` responde `interno` e o
 * espelho fica na fila, sem afetar os registros.
 */
export function servidorDeTeste({
  comTarefasGoogle = false,
  agenda,
}: { comTarefasGoogle?: boolean; /** Google Agenda falso (apoio/calendario.ts), para as ações de agenda. */ agenda?: CalendarioFalso } = {}) {
  const armazem = armazemNaMemoria();
  armazem.agora = () => Date.now();
  const pedidos: Pedido[] = [];
  /** O Google Tarefas do espelho (feito espelhado). */
  const tarefasGoogle = tarefasGoogleFalso();
  /** Devolve um erro para lançar no lugar da resposta, ou nada para atender. */
  let antes: ((acao: string, vez: number) => Error | undefined) | undefined;
  let depois: ((acao: string) => Promise<void> | void) | undefined;

  async function chamar<T>(acao: string, dados: object = {}): Promise<T> {
    const corpo = JSON.stringify({ codigo: CODIGO, acao, dados });
    const copia = JSON.parse(corpo).dados;
    pedidos.push({ acao, dados: copia, tamanho: corpo.length });
    const erro = antes?.(acao, pedidos.filter((p) => p.acao === acao).length);
    if (erro) throw erro;
    const resposta = tratar({ codigo: CODIGO, acao, dados: copia }, {
      lerCodigo: () => CODIGO,
      armazem,
      ...(comTarefasGoogle ? { tarefasGoogle: () => tarefasGoogle.servico as unknown as ServicoDeTarefas } : {}),
      ...(agenda ? { calendario: () => agenda.servico as unknown as ServicoDeAgenda } : {}),
    });
    await depois?.(acao);
    if (!resposta.ok) throw new ErroScript(resposta.erro);
    return JSON.parse(JSON.stringify(resposta.dados)) as T;
  }

  return {
    armazem,
    pedidos,
    tarefasGoogle,
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
