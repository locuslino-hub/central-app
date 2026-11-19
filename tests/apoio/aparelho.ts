// Faz o jsdom parecer um aparelho: com toque como ponteiro principal (`(pointer: coarse)`) e uma tela física de tal largura.
// Sem isto o jsdom é um computador (sem `matchMedia`). Os globais voltam ao normal no `afterEach` do setup (unstubAllGlobals).
import { vi } from 'vitest';

type Aparelho = { toque: boolean; larguraFisica?: number; alturaFisica?: number };

export function simularAparelho({ toque, larguraFisica = 1920, alturaFisica = 1080 }: Aparelho): void {
  vi.stubGlobal('matchMedia', (consulta: string) => ({
    matches: /pointer:\s*coarse/.test(consulta) ? toque : false,
    media: consulta,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
  vi.stubGlobal('screen', { width: larguraFisica, height: alturaFisica });
}

/** Um celular de verdade: toque e tela estreita (em pé). */
export const comoCelular = () => simularAparelho({ toque: true, larguraFisica: 375, alturaFisica: 812 });
/** Um computador com a janela apertada (ou com zoom): mouse e tela larga. */
export const comoComputador = () => simularAparelho({ toque: false, larguraFisica: 1920, alturaFisica: 1080 });
