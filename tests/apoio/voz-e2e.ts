// O reconhecimento de fala de verdade não roda no teste de ponta a ponta: um falso entra no lugar do `SpeechRecognition` do
// navegador e "ouve" uma frase ao começar (ou fica em silêncio, se `frase` for `null`). Conta quantas vezes começou, em
// `window.__inicios`.
import type { Page } from '@playwright/test';

export async function reconhecimentoFalso(page: Page, frase: string | null) {
  await page.addInitScript((fala) => {
    const w = window as unknown as Record<string, unknown>;
    w.__inicios = 0;
    class Falso {
      lang = '';
      continuous = false;
      interimResults = false;
      onresult: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        (w.__inicios as number)++;
        if (fala !== null) setTimeout(() => this.onresult?.({ results: [{ isFinal: false, 0: { transcript: fala } }] }), 50);
      }
      stop() {
        setTimeout(() => this.onend?.(), 10);
      }
      abort() {
        this.onend?.();
      }
    }
    w.SpeechRecognition = Falso;
    w.webkitSpeechRecognition = Falso;
  }, frase);
}

/** Quantas vezes o reconhecimento começou nesta página. */
export const inicios = (page: Page) => page.evaluate(() => (window as unknown as { __inicios: number }).__inicios);
