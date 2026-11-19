// As planilhas da Casa, de mentira, para os testes de ponta a ponta no navegador (V02, Tarefa 13 em diante): responde
// `criarPlanilha`, `lerLinhas`, `anexarLinha` e `atualizarLinha` do script, com a mesma forma do script de verdade
// (script/planilhas.ts), e deixa o resto (sincronia, agenda...) para o script falso de `script-e2e.ts`.
// Toda planilha nasce com as linhas de `historico` (ou as do seu modelo). Só valores fictícios.
import type { Page } from '@playwright/test';
import { URL_DO_SCRIPT } from './script-e2e';

const CABECALHOS: Record<string, string[]> = {
  consumo: ['Data', 'Leitura', 'Unidade', 'Consumo desde a anterior', 'Observação', 'id'],
  compras: ['Item', 'Quantidade', 'Valor', 'Link', 'Prioridade', 'Comprado?', 'Quem pôs', 'Data', 'Observação', 'id'],
  financeiro: ['Data', 'Descrição', 'Categoria', 'Tipo', 'Valor', 'Quem', 'Observação', 'id'],
};

type Linha = { id: string; valores: Record<string, string> };

type Historico = Record<string, string>[];

/** `historico`: as mesmas linhas em toda planilha, ou (por modelo) as linhas de cada modelo. */
export async function planilhasNaMemoria(page: Page, { historico = [] as Historico | Partial<Record<string, Historico>> } = {}) {
  const planilhas = new Map<string, { cabecalho: string[]; linhas: Linha[] }>();
  const criadas: { nome: string; modelo: string; planilhaId: string }[] = [];
  const pedidos: { acao: string; dados: Record<string, any> }[] = [];

  await page.route(URL_DO_SCRIPT, async (rota) => {
    const { acao, dados } = rota.request().postDataJSON() as { acao: string; dados: Record<string, any> };
    if (!['criarPlanilha', 'lerLinhas', 'anexarLinha', 'atualizarLinha'].includes(acao)) return rota.fallback();
    pedidos.push({ acao, dados });
    const responder = (corpo: unknown) =>
      rota.fulfill({ headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: JSON.stringify({ ok: true, dados: corpo }) });

    if (acao === 'criarPlanilha') {
      const planilhaId = `planilha-ficticia-${criadas.length + 1}`;
      criadas.push({ nome: dados.nome, modelo: dados.modelo, planilhaId });
      planilhas.set(planilhaId, {
        cabecalho: [...CABECALHOS[dados.modelo]!],
        linhas: (Array.isArray(historico) ? historico : (historico[dados.modelo] ?? [])).map((valores, i) => ({ id: `linha-${criadas.length}-${i + 1}`, valores: { ...valores } })),
      });
      return responder({ planilhaId });
    }
    const planilha = planilhas.get(String(dados.planilhaId));
    if (!planilha) return responder({ erro: 'fora_da_pasta' });
    if (acao === 'lerLinhas') return responder({ cabecalho: planilha.cabecalho, linhas: planilha.linhas });
    if (acao === 'anexarLinha') {
      if (!planilha.linhas.some((l) => l.id === dados.idDaLinha)) planilha.linhas.push({ id: dados.idDaLinha, valores: { ...dados.valores } });
      return responder({ ok: true });
    }
    const linha = planilha.linhas.find((l) => l.id === dados.idDaLinha);
    if (!linha) return responder({ erro: 'linha_nao_achada' });
    Object.assign(linha.valores, dados.valores);
    return responder({ ok: true, valores: Object.fromEntries(Object.keys(dados.valores).map((c) => [c, linha.valores[c]])) });
  });

  return {
    criadas,
    pedidos,
    /** As linhas da planilha criada em `ordem` (1 = a primeira criada). */
    linhas: (ordem: number) => planilhas.get(`planilha-ficticia-${ordem}`)?.linhas ?? [],
  };
}
