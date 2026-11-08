import { expect, test, type Page } from '@playwright/test';

// Quinta-feira, 2026-11-05, 12:20 em Lisboa (inverno: UTC+0).
const AGORA = '2026-11-05T12:20:00+00:00';

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(AGORA);
});

/** Erros de página e de política de segurança, para provar que a CSP não derruba o app. */
function vigiarErros(page: Page) {
  const erros: string[] = [];
  page.on('pageerror', (erro) => erros.push(`pageerror: ${erro.message}`));
  page.on('console', (mensagem) => {
    if (mensagem.type() === 'error') erros.push(`console: ${mensagem.text()}`);
  });
  return erros;
}

/** Todo controle visível com menos de 44 px de lado, descrito para a mensagem de erro. */
async function pequenos(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const achados: string[] = [];
    const controles = document.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, summary');
    for (const controle of controles) {
      // A caixa de marcar é pequena por natureza: vale a etiqueta que a envolve.
      const alvo = controle instanceof HTMLInputElement && controle.type === 'checkbox' ? controle.closest('label') : controle;
      if (!alvo) {
        achados.push(`${controle.outerHTML.slice(0, 60)} sem etiqueta`);
        continue;
      }
      const caixa = alvo.getBoundingClientRect();
      if (caixa.width === 0 && caixa.height === 0) continue; // escondido
      if (caixa.height < 43.5 || caixa.width < 43.5) {
        achados.push(`${alvo.textContent?.trim().slice(0, 30)} (${Math.round(caixa.width)}x${Math.round(caixa.height)})`);
      }
    }
    return achados;
  });
}

const semRolagemDeLado = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test.describe('celular, 390 px', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('barra inferior com Mais, que leva ao que não cabe nela', async ({ page }) => {
    const erros = vigiarErros(page);
    await page.goto('/central-app/');
    const barra = page.getByRole('navigation', { name: 'Principal' });
    await expect(barra).toHaveAttribute('data-variante', 'barra');

    const caixa = (await barra.boundingBox())!;
    expect(caixa.y + caixa.height).toBeGreaterThan(844 - 20); // colada embaixo
    expect(caixa.width).toBeGreaterThan(390 - 30);
    await expect(page.getByRole('heading', { name: 'Calendário' })).toHaveCount(0);

    await barra.getByRole('button', { name: 'Mais' }).click();
    const folha = page.getByRole('dialog', { name: 'Mais' });
    for (const nome of ['Esta semana', 'Novembro', '2026', 'Quadro', 'Atividades', 'Sem prazo']) {
      await expect(folha.getByRole('link', { name: nome })).toBeVisible();
    }
    expect(await pequenos(page)).toEqual([]);

    await folha.getByRole('link', { name: 'Quadro' }).click();
    await expect(page).toHaveURL(/#\/quadro$/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: 'Quadro' })).toBeFocused();
    expect(erros).toEqual([]);
  });

  test('Esc fecha o Mais e devolve o foco ao botão', async ({ page }) => {
    await page.goto('/central-app/');
    const botao = page.getByRole('button', { name: 'Mais' });
    await botao.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(botao).toBeFocused();
  });

  test('a página não rola de lado e todo toque tem 44 px, em Painel e em Conectar', async ({ page }) => {
    for (const rota of ['', '#/conectar', '#/semana']) {
      await page.goto(`/central-app/${rota}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(await semRolagemDeLado(page), rota).toBe(true);
      expect(await pequenos(page), rota).toEqual([]);
    }
  });

  test('Conectar fica dentro da casca, com a barra e o caminho de volta', async ({ page }) => {
    await page.goto('/central-app/#/conectar');
    await expect(page.getByRole('navigation', { name: 'Principal' })).toBeVisible();
    await page.getByRole('link', { name: 'Voltar' }).click();
    await expect(page).toHaveURL(/#\/$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Painel do dia' })).toBeVisible();
  });
});

test.describe('tablet, 800 px', () => {
  test.use({ viewport: { width: 800, height: 1024 } });

  test('trilho à esquerda, sem menu completo nem painel direito', async ({ page }) => {
    const erros = vigiarErros(page);
    await page.goto('/central-app/');
    const trilho = page.getByRole('navigation', { name: 'Principal' });
    await expect(trilho).toHaveAttribute('data-variante', 'trilho');
    const caixa = (await trilho.boundingBox())!;
    expect(caixa.x).toBeLessThan(30);
    expect(caixa.height).toBeGreaterThan(caixa.width * 5);
    await expect(page.getByRole('heading', { name: 'Calendário' })).toHaveCount(0);
    await expect(page.getByRole('complementary')).toHaveCount(0);
    await expect(trilho.getByRole('button', { name: 'Mais' })).toBeVisible();

    await trilho.getByRole('button', { name: 'Mais' }).click();
    await expect(page.getByRole('dialog').getByRole('link', { name: 'Sem prazo' })).toBeVisible();
    expect(await pequenos(page)).toEqual([]);
    expect(erros).toEqual([]);
  });

  test('sem rolagem de lado e toques de 44 px', async ({ page }) => {
    for (const rota of ['', '#/conectar']) {
      await page.goto(`/central-app/${rota}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(await semRolagemDeLado(page), rota).toBe(true);
      expect(await pequenos(page), rota).toEqual([]);
    }
  });

  test('1100 px ainda é trilho', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.goto('/central-app/');
    await expect(page.getByRole('navigation', { name: 'Principal' })).toHaveAttribute('data-variante', 'trilho');
  });
});

test.describe('computador, 1280 px', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('menu à esquerda com mês e ano atuais, página e painel direito', async ({ page }) => {
    const erros = vigiarErros(page);
    await page.goto('/central-app/');
    const menu = page.getByRole('navigation', { name: 'Principal' });
    const lateral = (await menu.boundingBox())!;
    expect(lateral.x).toBeLessThan(30);

    for (const grupo of ['Calendário', 'Ver', 'Minhas salas']) {
      await expect(menu.getByRole('heading', { name: grupo })).toBeVisible();
    }
    await expect(menu.getByRole('link', { name: 'Novembro' })).toBeVisible();
    await expect(menu.getByRole('link', { name: '2026' })).toBeVisible();
    await expect(menu.getByRole('link', { name: 'Painel do dia' })).toHaveAttribute('aria-current', 'page');
    // As salas iniciais vêm do armazenamento do navegador, na ordem do dono.
    await expect(menu.getByRole('link', { name: 'Doutoramento' })).toBeVisible();
    await expect(menu.getByRole('link', { name: 'Casa' })).toBeVisible();

    const painel = page.getByRole('complementary', { name: 'Agora e chat' });
    await expect(painel.getByRole('heading', { name: 'Agora' })).toBeVisible();
    await expect(painel.getByRole('heading', { name: 'Chat' })).toBeVisible();
    const direita = (await painel.boundingBox())!;
    expect(direita.x).toBeGreaterThan(1280 - 420);
    expect(direita.x + direita.width).toBeLessThanOrEqual(1280);

    await expect(page.getByRole('button', { name: 'Mais' })).toHaveCount(0);
    expect(await semRolagemDeLado(page)).toBe(true);
    expect(erros).toEqual([]);
  });

  test('clicar no menu troca a página e marca o item', async ({ page }) => {
    await page.goto('/central-app/');
    const menu = page.getByRole('navigation', { name: 'Principal' });
    await menu.getByRole('link', { name: 'Sem prazo' }).click();
    await expect(page).toHaveURL(/#\/sem-prazo$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Sem prazo' })).toBeVisible();
    await expect(menu.getByRole('link', { name: 'Sem prazo' })).toHaveAttribute('aria-current', 'page');
    await expect(menu.locator('[aria-current]')).toHaveCount(1);

    await menu.getByRole('link', { name: 'Orientações' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Orientações' })).toBeVisible();
  });

  test('o estado da sincronia aparece em texto', async ({ page }) => {
    await page.goto('/central-app/');
    const estado = page.getByRole('status').first();
    await expect(estado).toBeVisible();
    // Sem aparelho conectado, a sincronia não consegue falar com o script.
    await expect(estado).toContainText(
      /Atualizado|Atualizando…|Sem internet|Por enviar|Problema com o código do aparelho/,
    );
  });

  test('toques de 44 px e a política de segurança deixa as fontes carregarem', async ({ page }) => {
    const erros = vigiarErros(page);
    await page.goto('/central-app/');
    await expect(page.getByRole('heading', { level: 1, name: 'Painel do dia' })).toBeVisible();
    expect(await pequenos(page)).toEqual([]);
    const fontes = await page.evaluate(async () => {
      await document.fonts.ready;
      return [document.fonts.check('40px "Instrument Serif"'), document.fonts.check('16px "Instrument Sans Variable"')];
    });
    expect(fontes).toEqual([true, true]);
    expect(erros).toEqual([]);
  });

  test('a política de segurança está na página e bloqueia script de fora', async ({ page }) => {
    await page.goto('/central-app/');
    const politica = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
    expect(politica).toContain("script-src 'self'");
    expect(politica).toContain("object-src 'none'");
    expect(politica).toContain('connect-src');
    const bloqueado = await page.evaluate(
      () =>
        new Promise<boolean>((resolver) => {
          document.addEventListener('securitypolicyviolation', () => resolver(true), { once: true });
          const s = document.createElement('script');
          s.src = 'https://exemplo.invalid/x.js';
          document.head.append(s);
          setTimeout(() => resolver(false), 3000);
        }),
    );
    expect(bloqueado).toBe(true);
  });
});
