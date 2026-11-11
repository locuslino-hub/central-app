import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** Com CAPTURAS_T12 definida, as imagens vão para essa pasta (conferência visual). */
const CAPTURAS = process.env.CAPTURAS_T12;
async function capturar(page: Page, nome: string) {
  if (!CAPTURAS) return;
  mkdirSync(CAPTURAS, { recursive: true });
  await page.screenshot({ path: join(CAPTURAS, `${nome}.png`) });
}

// Quinta-feira, 2026-11-05, 12:20 em Lisboa (inverno: UTC+0).
const AGORA = '2026-11-05T12:20:00+00:00';

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
      const caixa = controle.getBoundingClientRect();
      if (caixa.width === 0 && caixa.height === 0) continue;
      if (caixa.height < 43.5 || caixa.width < 43.5) {
        achados.push(`${controle.textContent?.trim().slice(0, 30) || controle.outerHTML.slice(0, 60)} (${Math.round(caixa.width)}x${Math.round(caixa.height)})`);
      }
    }
    return achados;
  });
}

const semRolagemDeLado = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

async function dizerAoChat(page: Page, frase: string) {
  await page.goto('/central-app/#/chat');
  const principal = page.getByRole('main');
  const campo = principal.getByRole('textbox', { name: 'Escreva ou dite' });
  await campo.fill(frase);
  // Conta os "Desfazer" antes: o da mensagem anterior já está na tela e não prova que esta foi gravada.
  const desfazeres = principal.getByRole('article').getByRole('button', { name: 'Desfazer' });
  const antes = await desfazeres.count();
  await campo.press('Enter');
  await expect(desfazeres).toHaveCount(antes + 1);
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(AGORA);
});

for (const [nome, viewport] of [
  ['celular, 390 px', { width: 390, height: 844 }],
  ['computador, 1280 px', { width: 1280, height: 800 }],
] as const) {
  test.describe(nome, () => {
    test.use({ viewport });

    test('concluir "Marcar reunião" abre a caixa; cabe na tela, com toque de 44 px; Esc não conclui', async ({ page }) => {
      const erros = vigiarErros(page);
      await dizerAoChat(page, 'Marcar reunião com a Marina');
      await page.goto('/central-app/#/');
      const checklist = page.getByRole('main').getByRole('region', { name: 'Checklist do dia' });
      const caixaDeConcluir = checklist.getByRole('checkbox', { name: 'Marcar reunião com a Marina' });
      await caixaDeConcluir.click();

      const caixa = page.getByRole('dialog', { name: 'Quando ficou marcado?' });
      await expect(caixa).toBeVisible();
      await expect(caixa).toBeFocused();
      await expect(caixa.getByLabel('Dia')).toHaveValue('2026-11-05');
      await caixa.getByLabel('Início').fill('15:30');
      await expect(caixa.getByLabel('Fim')).toHaveValue('16:30');

      // Espera a animação de entrada acabar: antes disso a caixa está um pouco fora do lugar.
      await page.evaluate(() =>
        Promise.all(
          document
            .getAnimations()
            .filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime as number))
            .map((a) => a.finished.catch(() => undefined)),
        ),
      );
      expect(await pequenos(page)).toEqual([]);
      expect(await semRolagemDeLado(page)).toBe(true);
      await capturar(page, `caixa-marcar-${viewport.width}`);
      const { top, bottom, left, right } = await caixa.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
      });
      expect(top).toBeGreaterThanOrEqual(0);
      expect(bottom).toBeLessThanOrEqual(viewport.height);
      expect(left).toBeGreaterThanOrEqual(0);
      expect(right).toBeLessThanOrEqual(viewport.width);

      await page.keyboard.press('Escape');
      await expect(caixa).toBeHidden();
      await expect(caixaDeConcluir).toHaveAttribute('aria-checked', 'false');
      await expect(caixaDeConcluir).toBeFocused();
      expect(erros).toEqual([]);
    });

    test('Colocar na agenda sem conexão: avisa que fica na fila e a tarefa conclui', async ({ page }) => {
      const erros = vigiarErros(page);
      await dizerAoChat(page, 'Marcar reunião com a Marina');
      await page.goto('/central-app/#/');
      const checklist = page.getByRole('main').getByRole('region', { name: 'Checklist do dia' });
      await checklist.getByRole('checkbox', { name: 'Marcar reunião com a Marina' }).click();
      const caixa = page.getByRole('dialog', { name: 'Quando ficou marcado?' });

      await caixa.getByRole('button', { name: 'Colocar na agenda' }).click();
      await expect(caixa.getByRole('alert')).toHaveText('Escolha a hora de início.');
      await caixa.getByLabel('Início').fill('15:30');
      await caixa.getByRole('button', { name: 'Colocar na agenda' }).click();

      await expect(caixa.getByRole('status')).toContainText('Sem internet. O compromisso entra na agenda quando a conexão voltar.');
      expect(await pequenos(page)).toEqual([]);
      await caixa.getByRole('button', { name: 'Entendi' }).click();
      await expect(caixa).toBeHidden();
      await expect(checklist.getByRole('checkbox', { name: 'Marcar reunião com a Marina' })).toHaveAttribute('aria-checked', 'true');
      expect(erros.filter((e) => !/Failed to load resource|ERR_/.test(e))).toEqual([]);
    });

    test('frase de compromisso: o cartão avisa que está na fila (sem conexão) e Desfazer limpa', async ({ page }) => {
      await page.goto('/central-app/#/chat');
      const principal = page.getByRole('main');
      const campo = principal.getByRole('textbox', { name: 'Escreva ou dite' });
      await campo.fill('Adicione reunião sobre o projeto na sexta feira com inicio às 11:00 e termino 12:00');
      await campo.press('Enter');

      const cartao = principal.getByRole('article').last();
      await expect(cartao.getByText('Compromisso', { exact: true })).toBeVisible();
      await expect(cartao.getByRole('status')).toHaveText('Sem internet. O compromisso entra na agenda quando a conexão voltar.');
      expect(await pequenos(page)).toEqual([]);
      expect(await semRolagemDeLado(page)).toBe(true);

      await cartao.getByRole('button', { name: 'Desfazer' }).click();
      await expect(cartao.getByText('Desfeito. Nada ficou guardado.')).toBeVisible();
    });
  });
}
