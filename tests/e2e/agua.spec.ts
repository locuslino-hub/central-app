import { expect, test, type Locator, type Page } from '@playwright/test';
import { conectar, scriptFalso } from '../apoio/script-e2e';

// O cartão Água na coluna direita (e no topo do Agora, no celular), no navegador, com o
// script de verdade e o Google na memória. Quinta-feira, 2026-11-05, 12:20 em Lisboa
// (inverno: UTC+0): o esperado é 619 mL.
const AGORA = '2026-11-05T12:20:00+00:00';

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(AGORA);
});

async function abrir(page: Page, hash: string) {
  const script = scriptFalso();
  await script.ligarA(page);
  await page.goto('/central-app/');
  await conectar(page);
  await page.goto(`/central-app/${hash}`);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

const coluna = (page: Page) => page.getByRole('complementary', { name: 'Agora, água e chat' });
const cartao = (page: Page) => page.getByRole('region', { name: 'Água' });

/** O cartão e cada botão dele cabem: nada é cortado nem sai pelos lados. */
async function semTransbordar(alvo: Locator) {
  const problemas = await alvo.evaluate((secao) => {
    const achados: string[] = [];
    const confere = (el: Element, nome: string) => {
      if (el.scrollWidth > el.clientWidth) achados.push(`${nome}: scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`);
    };
    confere(secao, 'cartão');
    const caixa = secao.getBoundingClientRect();
    for (const botao of secao.querySelectorAll('button')) {
      const nome = (botao.getAttribute('aria-label') || botao.textContent || '').trim().slice(0, 24);
      confere(botao, `botão "${nome}"`);
      const b = botao.getBoundingClientRect();
      if (b.height < 43.5) achados.push(`botão "${nome}" com ${Math.round(b.height)} px de altura`);
      if (b.width < 43.5) achados.push(`botão "${nome}" com ${Math.round(b.width)} px de largura`);
      if (b.left < caixa.left - 0.5 || b.right > caixa.right + 0.5) achados.push(`botão "${nome}" sai do cartão`);
    }
    // Nenhum texto passa da borda direita do cartão.
    for (const el of secao.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > caixa.right + 0.5) achados.push(`<${el.tagName.toLowerCase()} class="${el.getAttribute('class') ?? ''}"> passa da borda direita`);
    }
    return achados;
  });
  expect(problemas).toEqual([]);
}

test.describe('computador, 1280 × 800', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('a coluna mostra Agora, Água e Chat; "Toda" soma 500; com o chat aberto o cartão encolhe', async ({ page }) => {
    const erros: string[] = [];
    page.on('pageerror', (erro) => erros.push(erro.message));
    await abrir(page, '#/');

    await expect(coluna(page).getByRole('heading', { level: 2 })).toHaveText(['Agora', 'Água', 'Chat']);
    const agua = cartao(page);
    await expect(agua.locator('.agua-total')).toHaveText('0 mL');
    await expect(agua.getByText('Atrás 619 mL')).toBeVisible();
    // O sugerido (1 garrafa e ¼) é "Toda".
    await expect(agua.getByRole('button', { name: 'Toda, 500 mL, sugerido' })).toBeVisible();

    await agua.getByRole('button', { name: /^Toda, 500 mL/ }).click();
    await expect(agua.locator('.agua-total')).toHaveText('500 mL');
    await expect(agua.getByText('Último: 12:20 · 500 mL')).toBeVisible();
    await expect(agua.getByText('Atrás 119 mL')).toBeVisible();

    // Desfazer tira só o gole de hoje.
    await agua.getByRole('button', { name: 'Desfazer o último gole' }).click();
    await expect(agua.locator('.agua-total')).toHaveText('0 mL');
    await expect(agua.getByRole('button', { name: 'Desfazer o último gole' })).toBeDisabled();
    await agua.getByRole('button', { name: /^Toda, 500 mL/ }).click();
    await expect(agua.locator('.agua-total')).toHaveText('500 mL');

    // Chat aberto: a versão curta, de no máximo 80 px de altura.
    const alturaCompleta = (await agua.boundingBox())!.height;
    await coluna(page).getByRole('button', { name: /^Chat/ }).click();
    const curta = page.locator('.cartao-agua.curto');
    await expect(curta).toBeVisible();
    await expect(page.locator('.cartao-agua')).toHaveCount(1);
    const altura = (await curta.boundingBox())!.height;
    expect(altura).toBeLessThanOrEqual(80);
    expect(altura).toBeLessThan(alturaCompleta);
    await expect(curta).toContainText('Água: 500 mL');
    await curta.getByRole('button', { name: /^\+¼, 125 mL, sugerido/ }).click();
    await expect(curta).toContainText('Água: 625 mL');
    expect(erros).toEqual([]);
  });
});

test.describe('largura mínima, 1101 × 800', () => {
  test.use({ viewport: { width: 1101, height: 800 } });

  test('o cartão completo não transborda e os botões mantêm 44 px (atrás, em dia e meta)', async ({ page }) => {
    await abrir(page, '#/');
    const agua = cartao(page);
    await expect(agua.locator('.agua-total')).toHaveText('0 mL');
    // Medida da coluna: cartão de uns 242 px.
    const largura = (await agua.boundingBox())!.width;
    expect(largura).toBeGreaterThan(235);
    expect(largura).toBeLessThan(260);
    await semTransbordar(agua); // atrás, com 1 garrafa e ¼

    await agua.getByRole('button', { name: /^Toda, 500 mL/ }).click();
    await agua.getByRole('button', { name: /^Toda, 500 mL/ }).click();
    await expect(agua.locator('.agua-total')).toHaveText('1.000 mL');
    await expect(agua.getByText('No ritmo')).toBeVisible();
    await semTransbordar(agua); // em dia

    await agua.getByRole('button', { name: /^Toda, 500 mL/ }).click();
    await agua.getByRole('button', { name: /^Toda, 500 mL/ }).click();
    await expect(agua.locator('.agua-total')).toHaveText('2.000 mL');
    await expect(agua.getByText('Meta batida ✓')).toBeVisible();
    await semTransbordar(agua); // meta batida
  });

  test('a versão curta também cabe, com o botão de 44 px', async ({ page }) => {
    await abrir(page, '#/');
    await coluna(page).getByRole('button', { name: /^Chat/ }).click();
    const curta = page.locator('.cartao-agua.curto');
    await expect(curta).toBeVisible();
    // Estado fixo: sem goles, a sugestão é a garrafa inteira ("+1 garrafa"), o texto mais largo do botão.
    await expect(curta.getByRole('button', { name: '+1 garrafa, 500 mL, sugerido' })).toBeVisible();
    await semTransbordar(curta);
    expect((await curta.boundingBox())!.height).toBeLessThanOrEqual(80);
  });
});

test.describe('celular, 390 × 844', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('o cartão aparece no topo de #/agora, cabe na tela e soma', async ({ page }) => {
    await abrir(page, '#/agora');
    const agua = page.getByRole('main').getByRole('region', { name: 'Água' });
    await expect(agua).toBeVisible();
    await expect(page.locator('.cartao-agua')).toHaveCount(1);
    await agua.getByRole('button', { name: /^½, 250 mL/ }).click();
    await expect(agua.locator('.agua-total')).toHaveText('250 mL');
    await semTransbordar(agua);
    const semRolagemDeLado = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    expect(semRolagemDeLado).toBe(true);
  });
});

// ---- A página expandida (diálogo) ----

const pagina = (page: Page) => page.getByRole('dialog', { name: 'Água' });

/** Abre a página pelo anel do cartão e espera os registros (a página abre com 0 mL enquanto lê). */
async function abrirPagina(page: Page, hash = '#/') {
  await abrir(page, hash);
  await expect(page.locator('.cartao-agua .agua-total')).toBeVisible();
  await page.locator('.cartao-agua .agua-resumo').click();
  await expect(pagina(page)).toBeVisible();
}

/** O diálogo cabe: o <dialog> e a folha têm a altura da tela ou menos e nada fica para rolar. */
async function cabeSemRolar(page: Page, alturaDaTela: number) {
  const medidas = await pagina(page).evaluate((dialogo) => {
    const folha = dialogo.querySelector('.agua-pag') as HTMLElement;
    const caixa = dialogo.getBoundingClientRect();
    return {
      alturaDoDialogo: caixa.height,
      rolagemDoDialogo: [dialogo.scrollHeight, dialogo.clientHeight],
      rolagemDaFolha: [folha.scrollHeight, folha.clientHeight],
      semRolagemDeLado: folha.scrollWidth <= folha.clientWidth,
      topo: caixa.top,
      base: caixa.bottom,
    };
  });
  expect(medidas.alturaDoDialogo).toBeLessThanOrEqual(alturaDaTela);
  expect(medidas.rolagemDoDialogo[0]).toBe(medidas.rolagemDoDialogo[1]);
  expect(medidas.rolagemDaFolha[0]).toBe(medidas.rolagemDaFolha[1]);
  expect(medidas.semRolagemDeLado).toBe(true);
  expect(medidas.topo).toBeGreaterThanOrEqual(0);
  expect(medidas.base).toBeLessThanOrEqual(alturaDaTela);
}

/** Verificações de acessibilidade que o projeto já faz sozinho (não há axe nas dependências): nomes, toque e foco preso. */
async function acessivel(page: Page) {
  const achados = await pagina(page).evaluate((dialogo) => {
    const problemas: string[] = [];
    if (!dialogo.hasAttribute('open')) problemas.push('o <dialog> não está aberto');
    if (!dialogo.getAttribute('aria-labelledby')) problemas.push('o <dialog> não tem nome');
    for (const el of dialogo.querySelectorAll('button, input')) {
      const nome = (el.getAttribute('aria-label') || el.textContent || '').trim();
      const rotulo = nome.slice(0, 24) || el.tagName;
      if (!nome) problemas.push(`${rotulo}: sem nome`);
      const r = el.getBoundingClientRect();
      if (r.height < 43.5) problemas.push(`${rotulo}: ${Math.round(r.height)} px de altura`);
      if (r.width < 43.5) problemas.push(`${rotulo}: ${Math.round(r.width)} px de largura`);
    }
    for (const svg of dialogo.querySelectorAll('svg')) {
      const escondido = svg.getAttribute('aria-hidden') === 'true';
      if (!escondido && svg.getAttribute('role') !== 'img') problemas.push('svg sem aria-hidden nem role="img"');
      if (!escondido && !svg.getAttribute('aria-label')) problemas.push('svg com role="img" sem nome');
    }
    for (const img of dialogo.querySelectorAll('[role="img"]:not(svg)')) {
      if (!img.getAttribute('aria-label')) problemas.push('role="img" sem nome');
    }
    return problemas;
  });
  expect(achados).toEqual([]);

  // O foco fica preso: dá a volta toda com Tab sem nunca parar em algo de trás do diálogo (que o navegador deixa inerte).
  // Passando do último botão, o foco vai para a barra do navegador: aí o elemento ativo é o <body>.
  const dentro = () =>
    page.evaluate(() => {
      const ativo = document.activeElement;
      return !ativo || ativo === document.body || !!ativo.closest('dialog');
    });
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Tab');
    expect(await dentro()).toBe(true);
  }
  await page.keyboard.press('Shift+Tab');
  expect(await dentro()).toBe(true);
}

test.describe('página da água, 1280 × 800', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('abre do anel, cabe sem rolar, em duas colunas; soma; fecha no Esc, no X e no fundo, e o foco volta ao anel', async ({ page }) => {
    const erros: string[] = [];
    page.on('pageerror', (erro) => erros.push(erro.message));
    await abrirPagina(page);
    const caixa = pagina(page);
    await expect(caixa.getByRole('heading', { level: 2, name: 'Água' })).toBeVisible();
    await cabeSemRolar(page, 800);

    // Duas colunas: o histórico fica à direita do gráfico, na mesma altura.
    const esquerda = (await caixa.locator('.agua-col1').boundingBox())!;
    const direita = (await caixa.locator('.agua-col2').boundingBox())!;
    expect(direita.x).toBeGreaterThan(esquerda.x + esquerda.width - 1);
    expect(Math.abs(direita.y - esquerda.y)).toBeLessThan(2);
    await expect(caixa.getByRole('heading', { name: 'Histórico' })).toBeVisible();
    await expect(caixa.locator('.agua-dia')).toHaveCount(28);
    await expect(caixa.locator('.agua-barra')).toHaveCount(7);
    await expect(caixa.locator('.agua-garrafa small')).toHaveText(['agora', '2ª', '3ª', '4ª']);

    // Outro valor: um valor ruim avisa e não registra; 1,5 L soma 1.500 mL.
    await caixa.getByRole('textbox', { name: 'Outro valor' }).fill('abc');
    await caixa.getByRole('button', { name: 'Somar' }).click();
    await expect(caixa.getByText('Valor inválido')).toBeVisible();
    await expect(caixa.locator('.agua-grande')).toHaveText('0 mL');
    await caixa.getByRole('textbox', { name: 'Outro valor' }).fill('1,5 L');
    await caixa.getByRole('button', { name: 'Somar' }).click();
    await expect(caixa.locator('.agua-grande')).toHaveText('1.500 mL');
    await expect(caixa.getByRole('textbox', { name: 'Outro valor' })).toHaveValue('');
    await expect(caixa.locator('svg.agua-grafico title')).toHaveText(['12:20 · 1.500 mL']);
    await cabeSemRolar(page, 800); // com as bolinhas novas, ainda cabe

    // Desfazer último, no título do gráfico.
    await caixa.getByRole('button', { name: /^Desfazer último/ }).click();
    await expect(caixa.locator('.agua-grande')).toHaveText('0 mL');
    await caixa.getByRole('button', { name: /^Toda, 500 mL/ }).click();
    await expect(caixa.locator('.agua-grande')).toHaveText('500 mL');

    // Esc fecha, o foco volta ao anel e o cartão da coluna mostra o mesmo total.
    await page.keyboard.press('Escape');
    await expect(pagina(page)).toHaveCount(0);
    await expect(page.locator('.cartao-agua .agua-resumo')).toBeFocused();
    await expect(page.locator('.cartao-agua .agua-total')).toHaveText('500 mL');

    // O X.
    await page.locator('.cartao-agua .agua-resumo').click();
    await expect(pagina(page)).toBeVisible();
    await pagina(page).getByRole('button', { name: 'Fechar' }).click();
    await expect(pagina(page)).toHaveCount(0);
    await expect(page.locator('.cartao-agua .agua-resumo')).toBeFocused();

    // O fundo (clique fora da folha); clicar dentro não fecha.
    await page.locator('.cartao-agua .agua-resumo').click();
    await expect(pagina(page)).toBeVisible();
    await pagina(page).locator('.agua-pag-sub').first().click();
    await expect(pagina(page)).toBeVisible();
    await page.mouse.click(8, 8);
    await expect(pagina(page)).toHaveCount(0);
    await expect(page.locator('.cartao-agua .agua-resumo')).toBeFocused();
    expect(erros).toEqual([]);
  });

  test('o foco fica preso no diálogo e todos os controles têm nome e 44 px', async ({ page }) => {
    await abrirPagina(page);
    await acessivel(page);
  });
});

test.describe('página da água, 1920 × 1080', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('também cabe sem rolar, e a letra maior (17 px) cresce junto', async ({ page }) => {
    await abrirPagina(page);
    await cabeSemRolar(page, 1080);
    const largura = (await pagina(page).boundingBox())!.width;
    expect(largura).toBeGreaterThan(900); // 57,33 rem × 17 px
  });
});

test.describe('página da água, 1101 × 800', () => {
  test.use({ viewport: { width: 1101, height: 800 } });

  test('na largura mínima do computador também cabe, em duas colunas', async ({ page }) => {
    await abrirPagina(page);
    await cabeSemRolar(page, 800);
    const esquerda = (await pagina(page).locator('.agua-col1').boundingBox())!;
    const direita = (await pagina(page).locator('.agua-col2').boundingBox())!;
    expect(direita.x).toBeGreaterThan(esquerda.x + esquerda.width - 1);
  });
});

test.describe('página da água, 390 × 844', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('as colunas empilham e a folha rola por dentro; abre do cartão do Agora; Esc devolve o foco', async ({ page }) => {
    await abrirPagina(page, '#/agora');
    const caixa = pagina(page);
    const esquerda = (await caixa.locator('.agua-col1').boundingBox())!;
    const direita = (await caixa.locator('.agua-col2').boundingBox())!;
    expect(direita.y).toBeGreaterThanOrEqual(esquerda.y + esquerda.height - 1);
    expect(Math.abs(direita.x - esquerda.x)).toBeLessThan(2);

    const medidas = await caixa.evaluate((dialogo) => {
      const folha = dialogo.querySelector('.agua-pag') as HTMLElement;
      const antes = folha.scrollTop;
      folha.scrollTop = 200;
      return {
        alturaDoDialogo: dialogo.getBoundingClientRect().height,
        largura: dialogo.getBoundingClientRect().width,
        rola: folha.scrollHeight > folha.clientHeight,
        rolou: folha.scrollTop > antes,
        cabecaFica: folha.querySelector('.agua-pag-cabeca')!.getBoundingClientRect().top - folha.getBoundingClientRect().top,
        pagina: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      };
    });
    expect(medidas.alturaDoDialogo).toBeLessThanOrEqual(844);
    expect(medidas.largura).toBeLessThanOrEqual(390);
    expect(medidas.rola).toBe(true);
    expect(medidas.rolou).toBe(true);
    expect(Math.abs(medidas.cabecaFica)).toBeLessThan(1); // o título e o X ficam à vista
    expect(medidas.pagina).toBe(true);
    await expect(caixa.getByRole('button', { name: 'Fechar' })).toBeInViewport();

    await acessivel(page);
    await page.keyboard.press('Escape');
    await expect(pagina(page)).toHaveCount(0);
    await expect(page.locator('main .cartao-agua .agua-resumo')).toBeFocused();
  });
});

// ---- Acabamentos da página da água ----

const verdeAcao = 'rgb(63, 107, 79)'; // --acao

/** Soma um valor pelo campo "Outro valor" da página e espera o total mudar. */
async function somar(page: Page, texto: string) {
  const caixa = pagina(page);
  await caixa.getByRole('textbox', { name: 'Outro valor' }).fill(texto);
  await caixa.getByRole('button', { name: 'Somar' }).click();
  await expect(caixa.getByRole('textbox', { name: 'Outro valor' })).toHaveValue('');
}

test.describe('página da água, acabamentos, 1280 × 800', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('"Desfazer último" usa a cor de ação (verde), não a tinta escura', async ({ page }) => {
    await abrirPagina(page);
    const cor = await pagina(page).getByRole('button', { name: /^Desfazer último/ }).evaluate((el) => getComputedStyle(el).color);
    expect(cor).toBe(verdeAcao);
  });

  test('a barra de hoje fica verde-escura quando a meta é batida, e mantém o contorno de hoje', async ({ page }) => {
    await abrirPagina(page);
    const barra = pagina(page).locator('.agua-barra.hoje');
    const fundo = () => barra.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(await fundo()).not.toBe(verdeAcao); // ainda não bateu a meta
    await somar(page, '2 L');
    await expect(pagina(page).locator('.agua-grande')).toHaveText('2.000 mL');
    expect(await fundo()).toBe(verdeAcao);
    const contorno = await barra.evaluate((el) => ({ estilo: getComputedStyle(el).outlineStyle, largura: getComputedStyle(el).outlineWidth }));
    expect(contorno).toEqual({ estilo: 'solid', largura: '2px' });
  });

  test('a altura do diálogo não pula entre atrás, em dia e meta', async ({ page }) => {
    await abrirPagina(page);
    const altura = async () => Math.round((await pagina(page).boundingBox())!.height);
    const dica = async () => Math.round((await pagina(page).locator('.agua-dica').boundingBox())!.height);
    const atras = [await altura(), await dica()];
    await somar(page, '1,5 L');
    await expect(pagina(page).locator('.agua-dica.ok')).toBeVisible();
    const emDia = [await altura(), await dica()];
    await somar(page, '600');
    await expect(pagina(page).locator('.agua-dica.meta')).toBeVisible();
    const meta = [await altura(), await dica()];
    expect(emDia).toEqual(atras);
    expect(meta).toEqual(atras);
  });
});

test.describe('página da água, acabamentos, janela baixa', () => {
  test.use({ viewport: { width: 1280, height: 520 } });

  test('no computador, quando o conteúdo rola, o cabeçalho fixo ganha a borda de baixo; no topo, não', async ({ page }) => {
    await abrirPagina(page);
    const cabeca = pagina(page).locator('.agua-pag-cabeca');
    const borda = () => cabeca.evaluate((el) => getComputedStyle(el).borderBottomWidth);
    expect(await pagina(page).locator('.agua-pag').evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    expect(await borda()).toBe('0px');
    await pagina(page).locator('.agua-pag').evaluate((el) => el.scrollTo(0, 120));
    await expect.poll(borda).toBe('1px');
    await pagina(page).locator('.agua-pag').evaluate((el) => el.scrollTo(0, 0));
    await expect.poll(borda).toBe('0px');
  });
});

test.describe('página da água, 880 × 1024 (uma coluna, janela larga de tablet)', () => {
  test.use({ viewport: { width: 880, height: 1024 } });

  test('o gráfico e as garrafas não esticam além de ~700 px e ficam centrados', async ({ page }) => {
    await abrirPagina(page, '#/agora');
    const caixa = pagina(page);
    const folha = (await caixa.locator('.agua-pag').boundingBox())!;
    for (const seletor of ['.agua-grafico', '.agua-garrafas']) {
      const alvo = (await caixa.locator(seletor).boundingBox())!;
      expect(alvo.width, seletor).toBeLessThanOrEqual(700.5);
    }
    const col = (await caixa.locator('.agua-col1').boundingBox())!;
    expect(Math.abs(col.x + col.width / 2 - (folha.x + folha.width / 2))).toBeLessThan(2);
  });
});

test.describe('página da água, acabamentos, 390 × 844', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('a altura do diálogo não pula entre atrás, em dia e meta', async ({ page }) => {
    await abrirPagina(page, '#/agora');
    const altura = async () => Math.round((await pagina(page).boundingBox())!.height);
    const dica = async () => Math.round((await pagina(page).locator('.agua-dica').boundingBox())!.height);
    const atras = [await altura(), await dica()];
    await somar(page, '1,5 L');
    await expect(pagina(page).locator('.agua-dica.ok')).toBeVisible();
    const emDia = [await altura(), await dica()];
    await somar(page, '600');
    await expect(pagina(page).locator('.agua-dica.meta')).toBeVisible();
    const meta = [await altura(), await dica()];
    expect(emDia).toEqual(atras);
    expect(meta).toEqual(atras);
  });
});
