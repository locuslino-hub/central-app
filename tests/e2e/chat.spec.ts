import { expect, test, type Page } from '@playwright/test';

// Quinta-feira, 2026-11-05, 12:20 em Lisboa (inverno: UTC+0).
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

test.describe('celular, 390 px', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('a frase vira cartão com a sala das palavras iniciais, e Desfazer remove', async ({ page }) => {
    const erros = vigiarErros(page);
    await page.goto('/central-app/#/chat');
    const principal = page.getByRole('main');
    await expect(principal.getByRole('heading', { level: 1, name: 'Chat' })).toBeVisible();

    const campo = principal.getByRole('textbox', { name: 'Escreva ou dite' });
    await campo.fill('Preciso parafusar o apoio do banheiro');
    await campo.press('Enter');

    const cartao = principal.getByRole('article');
    await expect(cartao.getByText('Casa', { exact: true })).toBeVisible();
    await expect(cartao.getByText('"Banheiro" costuma ser Casa.')).toBeVisible();
    await expect(cartao.getByText('Sem prazo')).toBeVisible();
    await expect(campo).toHaveValue('');

    expect(await pequenos(page)).toEqual([]);
    expect(await semRolagemDeLado(page)).toBe(true);

    await cartao.getByRole('button', { name: 'Desfazer' }).click();
    await expect(cartao.getByText('Desfeito. Nada ficou guardado.')).toBeVisible();
    expect(erros).toEqual([]);
  });

  test('depois de cada frase, o cartão novo e o campo ficam acima da barra de baixo', async ({ page }) => {
    await page.goto('/central-app/#/chat');
    const principal = page.getByRole('main');
    const campo = principal.getByRole('textbox', { name: 'Escreva ou dite' });
    const barra = page.getByRole('navigation', { name: 'Principal' });
    const frases = [
      'Preciso parafusar o apoio do banheiro',
      'Adicione em atividades do dia mandar mensagem para Renata',
      'Comprar pão',
      'Marcar reunião com a Marina',
      'Ligar para a Aurora amanhã às 15h',
      'Revisar o relatório 2 nas tarefas do doutoramento',
    ];
    for (const [i, frase] of frases.entries()) {
      await campo.fill(frase);
      await campo.press('Enter');
      await expect(principal.getByRole('article')).toHaveCount(i + 1);
      await page.waitForTimeout(300);
      const topoDaBarra = (await barra.boundingBox())!.y;
      const cartao = (await principal.getByRole('article').last().boundingBox())!;
      const entrada = (await campo.boundingBox())!;
      expect(cartao.y + cartao.height, `cartão ${i + 1} acima da barra`).toBeLessThanOrEqual(topoDaBarra + 1);
      expect(entrada.y + entrada.height, `campo depois da frase ${i + 1} acima da barra`).toBeLessThanOrEqual(topoDaBarra + 1);
      await expect(campo).toBeInViewport();
      await expect(principal.getByRole('article').last()).toBeInViewport();
    }
  });

  test('pessoa desconhecida: escolher a sala uma vez, e a próxima frase não pergunta', async ({ page }) => {
    await page.goto('/central-app/#/chat');
    const principal = page.getByRole('main');
    const campo = principal.getByRole('textbox', { name: 'Escreva ou dite' });

    await campo.fill('Adicione em atividades do dia mandar mensagem para Renata');
    await campo.press('Enter');
    const primeiro = principal.getByRole('article').first();
    await expect(primeiro.getByText('Em que sala fica Renata?')).toBeVisible();
    expect(await pequenos(page)).toEqual([]);
    expect(await semRolagemDeLado(page)).toBe(true);

    await primeiro.getByRole('button', { name: 'Orientações' }).click();
    await expect(primeiro.getByText('Vou lembrar: Renata fica em Orientações.')).toBeVisible();

    await campo.fill('Ligar para Renata amanhã');
    await campo.press('Enter');
    const segundo = principal.getByRole('article').nth(1);
    await expect(segundo.getByText('Orientações', { exact: true })).toBeVisible();
    await expect(page.getByText(/Em que sala fica/)).toHaveCount(0);
  });

  test('a região da conversa existe para o leitor de tela antes da primeira mensagem', async ({ page }) => {
    await page.goto('/central-app/#/chat');
    const regiao = page.getByRole('main').getByRole('log', { name: 'Conversa' });
    await expect(regiao).toBeAttached();
    expect(await regiao.evaluate((el) => getComputedStyle(el).display)).not.toBe('none');
    expect(await regiao.evaluate((el) => getComputedStyle(el).visibility)).toBe('visible');
  });

  test('não há botão de microfone', async ({ page }) => {
    await page.goto('/central-app/#/chat');
    const formulario = page.getByRole('main').locator('form');
    await expect(formulario.getByRole('button')).toHaveText(['Enviar']);
  });
});

test.describe('computador, 1280 px', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('o chat do painel começa recolhido no pé da coluna; abre, recolhe com Esc e o aparelho lembra', async ({ page }) => {
    const erros = vigiarErros(page);
    await page.goto('/central-app/');
    const painel = page.getByRole('complementary', { name: 'Agora e chat' });
    const botao = painel.getByRole('button', { name: 'Chat' });
    const campo = painel.getByRole('textbox', { name: 'Escreva ou dite' });

    // Recolhido: a barra fica no pé da coluna e o Agora ocupa o resto.
    await expect(botao).toHaveAttribute('aria-expanded', 'false');
    await expect(campo).toBeHidden();
    const barra = (await painel.locator('.cartao-chat').boundingBox())!;
    const coluna = (await painel.boundingBox())!;
    expect(barra.height).toBeLessThan(80);
    expect(coluna.y + coluna.height - (barra.y + barra.height)).toBeLessThan(30);
    // O Agora cresce e a Água fica logo acima da barra (o cartão Água vem entre os dois).
    const agua = (await painel.locator('.cartao-agua').boundingBox())!;
    expect(barra.y - (agua.y + agua.height)).toBeLessThan(30);
    expect(await pequenos(page)).toEqual([]);

    // Abrir: o foco vai para o campo.
    await botao.click();
    await expect(botao).toHaveAttribute('aria-expanded', 'true');
    await expect(campo).toBeFocused();

    // Esc recolhe e devolve o foco ao botão.
    await page.keyboard.press('Escape');
    await expect(botao).toHaveAttribute('aria-expanded', 'false');
    await expect(botao).toBeFocused();
    await expect(campo).toBeHidden();

    // Aberto fica guardado no aparelho.
    await botao.click();
    await page.reload();
    await expect(painel.getByRole('button', { name: 'Chat' })).toHaveAttribute('aria-expanded', 'true');
    await expect(campo).toBeVisible();
    expect(erros).toEqual([]);
  });

  test('o chat do painel direito funciona e todo toque tem 44 px', async ({ page }) => {
    const erros = vigiarErros(page);
    await page.goto('/central-app/');
    const painel = page.getByRole('complementary', { name: 'Agora e chat' });
    await painel.getByRole('button', { name: 'Chat' }).click();
    const campo = painel.getByRole('textbox', { name: 'Escreva ou dite' });

    await campo.fill('Adicione reunião sobre o projeto na sexta feira com inicio às 11:00 e termino 12:00');
    await campo.press('Enter');

    const cartao = painel.getByRole('article');
    await expect(cartao.getByText('Compromisso', { exact: true })).toBeVisible();
    await expect(cartao.getByText('Sexta, 6/11, 11:00 às 12:00')).toBeVisible();
    await cartao.getByRole('button', { name: 'Trocar sala' }).click();
    await expect(cartao.getByRole('button', { name: 'Doutoramento' })).toBeFocused();

    expect(await pequenos(page)).toEqual([]);
    expect(await semRolagemDeLado(page)).toBe(true);
    expect(erros).toEqual([]);
  });

  test('conversa longa no painel: a conversa rola dentro do cartão e o campo fica à vista', async ({ page }) => {
    await page.goto('/central-app/');
    const painel = page.getByRole('complementary', { name: 'Agora e chat' });
    await painel.getByRole('button', { name: 'Chat' }).click();
    const campo = painel.getByRole('textbox', { name: 'Escreva ou dite' });
    for (const frase of ['Comprar pão', 'Mandar mensagem para Renata', 'Preciso parafusar o apoio do banheiro', 'asdf qwer']) {
      await campo.fill(frase);
      await campo.press('Enter');
    }
    await expect(painel.getByRole('article')).toHaveCount(4);

    await expect(campo).toBeInViewport();
    await expect(painel.getByRole('button', { name: 'Enviar' })).toBeInViewport();
    const cartao = (await painel.locator('.cartao-chat').boundingBox())!;
    const formulario = (await painel.locator('form').boundingBox())!;
    expect(formulario.y + formulario.height).toBeLessThanOrEqual(cartao.y + cartao.height);
    // A mais nova fica à vista.
    await expect(painel.getByRole('article').last().getByRole('button', { name: 'Guardar' })).toBeInViewport();
  });

  test('em #/chat o painel não repete o chat', async ({ page }) => {
    await page.goto('/central-app/#/chat');
    await expect(page.getByRole('textbox', { name: 'Escreva ou dite' })).toHaveCount(1);
    await expect(page.getByRole('main').getByRole('textbox', { name: 'Escreva ou dite' })).toBeVisible();
  });
});
