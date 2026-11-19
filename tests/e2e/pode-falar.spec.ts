import { expect, test, type Page } from '@playwright/test';

// Pode falar (V02, Tarefa 6), no navegador. O reconhecimento de fala de verdade não roda no
// teste: um falso entra no lugar e "fala" quando o toque o inicia. Quinta-feira, 2026-11-05,
// 12:20 em Lisboa (inverno: UTC+0).
const AGORA = '2026-11-05T12:20:00+00:00';

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(AGORA);
});

function vigiarErros(page: Page) {
  const erros: string[] = [];
  page.on('pageerror', (erro) => erros.push(`pageerror: ${erro.message}`));
  page.on('console', (mensagem) => {
    if (mensagem.type() === 'error') erros.push(`console: ${mensagem.text()}`);
  });
  return erros;
}

/** Todo controle visível com menos de 44 px de lado. */
async function pequenos(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const achados: string[] = [];
    for (const controle of document.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, summary')) {
      // A chave "Gravar áudio" é pequena por natureza: vale a etiqueta que a envolve.
      const alvo = controle instanceof HTMLInputElement && controle.type === 'checkbox' ? controle.closest('label') : controle;
      if (!alvo) continue;
      const caixa = alvo.getBoundingClientRect();
      if (caixa.width === 0 && caixa.height === 0) continue;
      if (caixa.height < 43.5 || caixa.width < 43.5) {
        achados.push(`${alvo.textContent?.trim().slice(0, 30) || alvo.outerHTML.slice(0, 60)} (${Math.round(caixa.width)}x${Math.round(caixa.height)})`);
      }
    }
    return achados;
  });
}

const semRolagemDeLado = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

/** Um reconhecimento falso: ao começar, "ouve" uma frase. Conta quantas vezes começou. */
async function reconhecimentoFalso(page: Page, frase: string) {
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
        setTimeout(() => this.onresult?.({ results: [{ isFinal: false, 0: { transcript: fala } }] }), 50);
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

test.describe('celular, 390 px', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('#/falar abre a tela, com o microfone grande, sem escutar sozinha e sem estourar a tela', async ({ page }) => {
    const erros = vigiarErros(page);
    await reconhecimentoFalso(page, 'revisar o capítulo dois');
    await page.goto('/central-app/#/falar');

    await expect(page.getByRole('heading', { level: 1, name: 'Pode falar' })).toBeVisible();
    const mic = page.getByRole('button', { name: 'Falar' });
    await expect(mic).toBeVisible();
    const caixa = (await mic.boundingBox())!;
    expect(caixa.width).toBeGreaterThanOrEqual(88);
    expect(await page.evaluate(() => (window as unknown as { __inicios: number }).__inicios)).toBe(0);
    await expect(page.getByRole('switch', { name: 'Gravar áudio' })).not.toBeChecked();

    expect(await pequenos(page)).toEqual([]);
    expect(await semRolagemDeLado(page)).toBe(true);
    expect(erros).toEqual([]);
  });

  test('um toque escuta, mostra o texto ao vivo; Pronto grava a ideia com cartão, e Desfazer apaga', async ({ page }) => {
    const erros = vigiarErros(page);
    await reconhecimentoFalso(page, 'usar o artigo do Prof. Souza no capítulo 2');
    await page.goto('/central-app/#/falar');

    await page.getByRole('button', { name: 'Falar' }).click();
    await expect(page.getByText('usar o artigo do Prof. Souza no capítulo 2')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Falar' })).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: 'Pronto' }).click();
    const cartao = page.getByRole('article');
    await expect(cartao.getByText('Guardado em Ideias')).toBeVisible();
    expect(await pequenos(page)).toEqual([]);

    await cartao.getByRole('button', { name: 'Desfazer' }).click();
    await expect(page.getByText('Desfeito. Nada ficou guardado.')).toBeVisible();
    expect(erros).toEqual([]);
  });

  test('Pronto sem texto não grava e avisa', async ({ page }) => {
    await page.goto('/central-app/#/falar');
    await page.getByRole('button', { name: 'Pronto' }).click();
    await expect(page.getByText(/Ainda não ouvi nada/)).toBeVisible();
    await expect(page.getByRole('article')).toHaveCount(0);
  });

  test('o botão flutuante leva à tela e Cancelar volta de onde veio', async ({ page }) => {
    await page.goto('/central-app/#/atividades');
    const botao = page.getByRole('link', { name: 'Pode falar' });
    await expect(botao).toBeVisible();
    const barra = page.getByRole('navigation', { name: 'Principal' });
    // O botão fica acima da barra de baixo, sem cobri-la.
    expect((await botao.boundingBox())!.y + (await botao.boundingBox())!.height).toBeLessThanOrEqual((await barra.boundingBox())!.y);

    await botao.click();
    await expect(page.getByRole('heading', { level: 1, name: 'Pode falar' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page).toHaveURL(/#\/atividades$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Atividades' })).toBeVisible();
  });
});

test.describe('computador, 1280 px', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('Ctrl+Alt+N abre a tela e o botão do topo também', async ({ page }) => {
    const erros = vigiarErros(page);
    await page.goto('/central-app/#/semana');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await page.keyboard.press('Control+Alt+n');
    await expect(page.getByRole('heading', { level: 1, name: 'Pode falar' })).toBeVisible();

    await page.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page).toHaveURL(/#\/semana$/);
    await page.getByRole('link', { name: 'Pode falar' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Pode falar' })).toBeVisible();
    expect(await pequenos(page)).toEqual([]);
    expect(erros).toEqual([]);
  });

  test('o manifest tem o atalho para #/falar', async ({ page }) => {
    const resposta = await page.request.get('/central-app/manifest.webmanifest');
    const manifest = await resposta.json();
    expect(manifest.shortcuts).toEqual([expect.objectContaining({ name: 'Pode falar', url: '/central-app/#/falar' })]);
  });
});
