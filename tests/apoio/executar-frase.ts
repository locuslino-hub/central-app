// `executarFrase` devolve `resultado` (gravado aqui: ideia dita, lista, leitura, gasto) ou `tarefa` (nada específico, ou a
// planilha não pôde receber: o chat segue com as regras de tarefa). Os testes de lista, leitura e gasto olham quase
// sempre o cartão: este atalho devolve o cartão, e, quando a frase segue como tarefa, um cartão de mentira com o título
// `SEGUE_COMO_TAREFA` e a nota no detalhe, para os testes dizerem "não foi para a planilha, e o porquê".
import { executarFrase as executarDeVerdade, type ContextoDaFrase, type ResultadoDaFrase } from '../../src/chat/executar';

export const SEGUE_COMO_TAREFA = 'Segue como tarefa';

export async function executarFrase(frase: string, ctx: ContextoDaFrase = {}): Promise<ResultadoDaFrase> {
  const saida = await executarDeVerdade(frase, ctx);
  if (saida.tipo === 'resultado') return saida.resultado;
  return { titulo: SEGUE_COMO_TAREFA, detalhe: saida.nota ?? '', ver: null, desfazer: async () => {} };
}
