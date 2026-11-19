// A planilha de uma pasta (Lista, Registro, Financeiro) mudou por fora da tela da pasta: o chat gravou, desfez ou trocou
// algo enquanto a pasta estava aberta ao lado. A tela da pasta relê a planilha, como faz quando a internet volta.
export const PLANILHA_MUDOU = 'central:planilha-mudou';

export function avisarPlanilhaMudou(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(PLANILHA_MUDOU));
}
