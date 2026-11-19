import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { areaDoChat, falarNoChat } from '../apoio/chat-e2e';
import { planilhasNaMemoria } from '../apoio/planilhas-e2e';
import { conectar, scriptFalso } from '../apoio/script-e2e';
import { reconhecimentoFalso } from '../apoio/voz-e2e';

// Acessibilidade das telas novas da V02 (Tarefa 19), no navegador, com o Google de mentira: axe sem erro grave (todas as
// regras, em 1280 e 375 px), foco visível em cada parada do Tab e uso completo pelo teclado (Tab, Enter, Espaço, Esc) nos
// fluxos principais. O teste com leitor de tela (TalkBack) é do dono. Quinta-feira, 2026-11-05, 12:20 em Lisboa.
type HistoricoDaPlanilha = NonNullable<Parameters<typeof planilhasNaMemoria>[1]>['historico'];
const AGORA = '2026-11-05T12:20:00+00:00';

const compra = (Item: string, extra: Record<string, string> = {}) => ({ Item, Quantidade: '', Valor: '', Link: '', Prioridade: '', 'Comprado?': '', 'Quem pôs': 'Marina', Data: '2026-11-01', Observação: '', ...extra });
const gasto = (Data: string, Descrição: string, Categoria: string, Valor: string) => ({ Data, Descrição, Categoria, Tipo: 'Débito', Valor, Quem: 'Marina', Observação: '' });
const HISTORICO = {
  compras: [compra('Leite', { Quantidade: '2' }), compra('Pão'), compra('Ovos', { 'Comprado?': 'TRUE', 'Quem pôs': 'Renata' })],
  consumo: [
    { Data: '15/09/2026', Leitura: '980', Unidade: 'm³', Observação: '' },
    { Data: '01/10/2026', Leitura: '1000', Unidade: 'm³', Observação: '' },
    { Data: '01/11/2026', Leitura: '1012', Unidade: 'm³', Observação: '' },
  ],
  financeiro: [gasto('2026-11-01', 'Mercado', 'Alimentação', '42,30'), gasto('2026-11-04', 'Cinema', 'Lazer', '18,50'), gasto('2026-10-20', 'Aluguel', 'Casa', '600')],
};

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(AGORA);
});

async function abrirApp(page: Page, hash: string, historico: HistoricoDaPlanilha = HISTORICO) {
  await scriptFalso().ligarA(page);
  const planilhas = await planilhasNaMemoria(page, { historico });
  await page.goto('/central-app/');
  await conectar(page);
  await page.goto(`/central-app/${hash}`);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  return planilhas;
}

/** Na Casa, cria as 6 pastas padrão e entra na pasta que casa com `nome`. */
async function abrirPastaDaCasa(page: Page, nome: RegExp, titulo: string, historico?: HistoricoDaPlanilha) {
  const planilhas = await abrirApp(page, '#/sala/sala-casa', historico);
  const pastas = page.getByRole('region', { name: 'Pastas' });
  await pastas.getByRole('button', { name: 'Criar pastas padrão da Casa' }).click();
  await expect(pastas.getByRole('link')).toHaveCount(6);
  await pastas.getByRole('link', { name: nome }).click();
  await expect(page.getByRole('heading', { level: 1, name: titulo })).toBeVisible();
  return planilhas;
}

async function criarMetodologia(page: Page) {
  await abrirApp(page, '#/sala/sala-doutoramento');
  const pastas = page.getByRole('region', { name: 'Pastas' });
  await pastas.getByRole('button', { name: /Nova pasta/ }).click();
  await page.getByRole('form', { name: 'Nova pasta' }).getByLabel('Nome da pasta').fill('Metodologia');
  await page.getByRole('form', { name: 'Nova pasta' }).getByRole('button', { name: 'Criar pasta' }).click();
  await pastas.getByRole('link', { name: 'Abrir' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Metodologia' })).toBeVisible();
}

/** Escreve a frase no chat (painel no computador, página no celular) e manda. Devolve o cartão que ela cria. */
async function falar(page: Page, frase: string) {
  const { cartao } = await falarNoChat(page, frase);
  return cartao;
}

/** Erros graves do axe (todas as regras), no formato que diz onde olhar. */
async function errosGraves(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).analyze();
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}): ${v.help} -> ${v.nodes.slice(0, 4).map((n) => n.target.join(' ')).join(' | ')}`);
}

const semAchados = async (page: Page) => expect(await errosGraves(page)).toEqual([]);

/** Diz, para o elemento em foco, se há um sinal visível: contorno ou sombra nele ou no rótulo que o envolve. */
const focoVisivel = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return { ok: false, quem: 'nada em foco' };
    const quem = `${el.tagName.toLowerCase()}|${el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 30) ?? ''}`;
    // Título e cartão recebem o foco por programa (tabindex -1) para o leitor de tela anunciá-los: não são paradas do Tab.
    if (el.getAttribute('tabindex') === '-1') return { ok: true, quem };
    // O próprio elemento, ou (caixa de marcar e botão de escolha, que ficam escondidos) o rótulo que o envolve.
    for (const alvo of [el, el.closest<HTMLElement>('label')]) {
      if (!alvo) continue;
      const estilo = getComputedStyle(alvo);
      const contorno = estilo.outlineStyle !== 'none' && parseFloat(estilo.outlineWidth) > 0;
      if (contorno || estilo.boxShadow !== 'none') return { ok: true, quem };
    }
    return { ok: false, quem };
  });

/** Aperta Tab até `alvo` receber o foco (no máximo `max` vezes). Confere o sinal visível de cada parada. */
async function tabAte(page: Page, alvo: Locator, max = 60, semSinal: string[] = []) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const sinal = await focoVisivel(page);
    if (!sinal.ok && sinal.quem !== 'nada em foco') semSinal.push(sinal.quem);
    if (await alvo.evaluate((el) => el === document.activeElement).catch(() => false)) return;
  }
  throw new Error(`O Tab não chegou a ${alvo} em ${max} paradas`);
}

/** Percorre todas as paradas do Tab da tela (até `max`) e devolve as que ficaram sem sinal de foco. */
async function paradasSemSinal(page: Page, max = 80): Promise<string[]> {
  const sem: string[] = [];
  const vistos = new Set<string>();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const sinal = await focoVisivel(page);
    // Passou da última parada: o foco saiu da página (barra do navegador) e volta ao começo.
    if (sinal.quem === 'nada em foco') continue;
    if (vistos.has(sinal.quem) && vistos.size > 3) continue;
    vistos.add(sinal.quem);
    if (!sinal.ok) sem.push(sinal.quem);
  }
  return sem;
}

const semRolagemDeLado = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

/** 13 leituras, uma por mês (de nov/25 a nov/26): o gráfico do Registro passa de 12 meses. */
const TREZE_MESES = {
  ...HISTORICO,
  consumo: Array.from({ length: 13 }, (_, i) => {
    const mes = ((10 + i) % 12) + 1;
    const ano = 2025 + Math.floor((10 + i) / 12);
    return { Data: `01/${String(mes).padStart(2, '0')}/${ano}`, Leitura: String(1000 + i * 12), Unidade: 'm³', Observação: '' };
  }),
};

// Reflow (WCAG 1.4.10): com muitos meses, o gráfico rola no próprio quadro; a página nunca ganha rolagem de lado em 320 e 375 px.
for (const largura of [320, 375]) {
  test.describe(`reflow do Registro com 13 meses, ${largura} px`, () => {
    test.use({ viewport: { width: largura, height: 812 } });

    test('o gráfico rola no próprio quadro e a página não rola de lado', async ({ page }) => {
      await abrirPastaDaCasa(page, /Consumo de Água/, 'Consumo de Água', TREZE_MESES);
      const grafico = page.getByRole('list', { name: 'Consumo por mês' });
      await expect(grafico.getByRole('listitem')).toHaveCount(12);
      expect(await semRolagemDeLado(page)).toBe(true);
      const quadro = page.getByRole('region', { name: /Gráfico do consumo por mês/ });
      await expect(quadro).toHaveAttribute('tabindex', '0');
      expect(await quadro.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
      // A ordem lida é mês e depois o valor.
      await expect(grafico.getByRole('listitem').last()).toHaveText(/^nov\/26:\s*12 m³$/);
      await semAchados(page);
    });
  });
}

for (const [nome, viewport] of [
  ['computador, 1280 px', { width: 1280, height: 900 }],
  ['celular, 375 px', { width: 375, height: 812 }],
] as const) {
  test.describe(`axe e foco: ${nome}`, () => {
    test.use({ viewport });

    test('Ideias (com ideia, com a escolha de sala aberta)', async ({ page }) => {
      await abrirApp(page, '#/');
      await expect((await falar(page, 'ideia: Pensar no artigo da Aurora')).getByText('Guardado em Ideias')).toBeVisible();
      await page.goto('/central-app/#/ideias');
      await expect(page.getByRole('heading', { level: 1, name: 'Ideias' })).toBeVisible();
      await page.getByRole('main').getByRole('button', { name: /^(Outra sala|Escolher sala):/ }).click();
      await expect(page.getByRole('group', { name: /Sala para/ })).toBeVisible();
      await semAchados(page);
      expect(await paradasSemSinal(page)).toEqual([]);
    });

    test('Chat com o microfone, antes e com os cartões abertos (ideia, tarefa e gasto)', async ({ page }) => {
      await abrirApp(page, '#/');
      // O campo, o microfone, a chave "Gravar áudio" e o aviso de privacidade ficam à vista (painel aberto ou página do chat).
      const area = await areaDoChat(page);
      await expect(area.getByRole('button', { name: 'Falar' })).toBeVisible();
      await expect(area.getByRole('switch', { name: 'Gravar áudio' })).toBeVisible();
      await semAchados(page);
      expect(await paradasSemSinal(page)).toEqual([]);

      await expect((await falar(page, 'ideia: Pensar no artigo da Aurora')).getByText('Guardado em Ideias')).toBeVisible();
      await semAchados(page);
      expect(await paradasSemSinal(page)).toEqual([]);

      // O cartão da tarefa (com Trocar sala, Guardar como ideia e Desfazer) também passa.
      const tarefa = await falar(page, 'Preciso parafusar o apoio do banheiro');
      await expect(tarefa.getByRole('button', { name: 'Guardar como ideia' })).toBeVisible();
      await semAchados(page);
      expect(await paradasSemSinal(page)).toEqual([]);
    });

    test('Chat ouvindo (microfone ligado, texto ao vivo no campo)', async ({ page }) => {
      await reconhecimentoFalso(page, 'revisar o capítulo dois');
      await abrirApp(page, '#/');
      const area = await areaDoChat(page);
      await area.getByRole('button', { name: 'Falar' }).click();
      await expect(area.getByRole('button', { name: 'Falar' })).toHaveAttribute('aria-pressed', 'true');
      await expect(area.getByRole('textbox', { name: 'Escreva ou dite' })).toHaveValue('revisar o capítulo dois');
      await semAchados(page);
      expect(await paradasSemSinal(page)).toEqual([]);
    });

    test('pasta Lista', async ({ page }) => {
      await abrirPastaDaCasa(page, /Lista de Compras Semanais/, 'Lista de Compras Semanais');
      await expect(page.getByRole('list', { name: 'Itens a comprar' })).toBeVisible();
      await semAchados(page);
      expect(await paradasSemSinal(page)).toEqual([]);
    });

    test('pasta Registro', async ({ page }) => {
      await abrirPastaDaCasa(page, /Consumo de Água/, 'Consumo de Água');
      await expect(page.getByRole('table', { name: 'Leituras registradas' })).toBeVisible();
      await semAchados(page);
      expect(await paradasSemSinal(page)).toEqual([]);
    });

    test('Financeiro', async ({ page }) => {
      await abrirPastaDaCasa(page, /Financeiro/, 'Financeiro');
      // No computador (mouse), mesmo com a janela estreita (zoom), o Financeiro continua; o "Abra no computador" é só do celular de verdade.
      await expect(page.getByRole('table', { name: 'Gastos do mês' })).toBeVisible();
      await semAchados(page);
      expect(await paradasSemSinal(page)).toEqual([]);
    });

    test('Pasta comum', async ({ page }) => {
      await criarMetodologia(page);
      await expect(page.getByRole('main').getByRole('region', { name: 'Tarefas' })).toBeVisible();
      await semAchados(page);
      expect(await paradasSemSinal(page)).toEqual([]);
    });

    test('Nova pasta, na Casa (com tipos) e fora dela', async ({ page }) => {
      await abrirApp(page, '#/sala/sala-casa');
      await page.getByRole('region', { name: 'Pastas' }).getByRole('button', { name: /Nova pasta/ }).click();
      await expect(page.getByRole('form', { name: 'Nova pasta' }).getByRole('radio').first()).toBeVisible();
      await semAchados(page);
      expect(await paradasSemSinal(page)).toEqual([]);

      await page.goto('/central-app/#/sala/sala-aulas');
      await page.getByRole('region', { name: 'Pastas' }).getByRole('button', { name: /Nova pasta/ }).click();
      await expect(page.getByRole('form', { name: 'Nova pasta' })).toBeVisible();
      await semAchados(page);
      expect(await paradasSemSinal(page)).toEqual([]);
    });
  });
}

test.describe('só com o teclado, computador', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('Chat: Ctrl+Alt+N foca o campo e liga o microfone, Esc para, Enter grava, e Espaço em Desfazer desfaz', async ({ page }) => {
    await reconhecimentoFalso(page, null);
    await abrirApp(page, '#/');
    await page.keyboard.press('Control+Alt+KeyN');
    const painel = page.getByRole('complementary', { name: 'Agora, água e chat' });
    const campo = painel.getByRole('textbox', { name: 'Escreva ou dite' });
    const mic = painel.getByRole('button', { name: 'Falar' });
    await expect(campo).toBeFocused();
    await expect(mic).toHaveAttribute('aria-pressed', 'true');
    // Esc só para de ouvir (o painel não recolhe), e o foco continua no campo.
    await page.keyboard.press('Escape');
    await expect(mic).toHaveAttribute('aria-pressed', 'false');
    await expect(campo).toBeFocused();
    await expect(painel.getByRole('button', { name: /^Chat/ })).toHaveAttribute('aria-expanded', 'true');

    const semSinal: string[] = [];
    await page.keyboard.type('ideia: Pensar no artigo da Aurora');
    await page.keyboard.press('Enter');
    const cartao = painel.getByRole('article');
    await expect(cartao.getByText('Guardado em Ideias')).toBeVisible();
    // De volta, a partir do campo: o último botão do cartão é o Desfazer.
    await page.keyboard.press('Shift+Tab');
    await expect(cartao.getByRole('button', { name: 'Desfazer' })).toBeFocused();
    const sinal = await focoVisivel(page);
    if (!sinal.ok) semSinal.push(sinal.quem);
    await page.keyboard.press('Space');
    await expect(painel.getByText('Desfeito. Nada ficou guardado.')).toBeVisible();
    await expect(cartao).toBeFocused();
    expect(semSinal).toEqual([]);
  });

  test('Chat: o microfone e a chave de áudio se alcançam e se usam só com o teclado (Tab e Espaço)', async ({ page }) => {
    await reconhecimentoFalso(page, null);
    await abrirApp(page, '#/');
    const painel = page.getByRole('complementary', { name: 'Agora, água e chat' });
    await painel.getByRole('button', { name: /^Chat/ }).click();
    const semSinal: string[] = [];
    await tabAte(page, painel.getByRole('button', { name: 'Falar' }), 80, semSinal);
    await page.keyboard.press('Space');
    await expect(painel.getByRole('button', { name: 'Falar' })).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Space');
    await expect(painel.getByRole('button', { name: 'Falar' })).toHaveAttribute('aria-pressed', 'false');
    await tabAte(page, painel.getByRole('switch', { name: 'Gravar áudio' }), 5, semSinal);
    await page.keyboard.press('Space');
    await expect(painel.getByRole('switch', { name: 'Gravar áudio' })).toBeChecked();
    expect(semSinal).toEqual([]);
  });

  test('Ideias: escolher sala, levar, Desfazer e virar tarefa, tudo com Tab, Enter e Espaço', async ({ page }) => {
    await abrirApp(page, '#/');
    await expect((await falar(page, 'ideia: Pensar no artigo da Aurora')).getByText('Guardado em Ideias')).toBeVisible();
    await page.goto('/central-app/#/ideias');
    await expect(page.getByRole('heading', { level: 1, name: 'Ideias' })).toBeVisible();
    const semSinal: string[] = [];

    await tabAte(page, page.getByRole('main').getByRole('button', { name: /^(Outra sala|Escolher sala):/ }), 40, semSinal);
    await page.keyboard.press('Enter');
    const escolha = page.getByRole('group', { name: /Sala para/ });
    await expect(escolha).toBeVisible();
    await tabAte(page, escolha.getByRole('button', { name: 'Casa' }), 20, semSinal);
    await page.keyboard.press('Space');
    const cartao = page.getByRole('main').getByRole('article');
    await expect(cartao.getByText('Levada para Casa')).toBeVisible();
    await expect(cartao).toBeFocused();
    await tabAte(page, cartao.getByRole('button', { name: 'Desfazer' }), 20, semSinal);
    await page.keyboard.press('Enter');
    await expect(cartao.getByText('Desfeito')).toBeVisible();
    await expect(cartao).toBeFocused();

    await tabAte(page, page.getByRole('main').getByRole('button', { name: /^Virar tarefa:/ }), 30, semSinal);
    await page.keyboard.press('Enter');
    await expect(cartao.getByText('Virou tarefa de hoje')).toBeVisible();
    await expect(cartao).toBeFocused();
    expect(semSinal).toEqual([]);
  });

  test('pasta Lista: marcar com Espaço mantém o foco; novo item com Enter', async ({ page }) => {
    const planilhas = await abrirPastaDaCasa(page, /Lista de Compras Semanais/, 'Lista de Compras Semanais');
    const semSinal: string[] = [];
    const leite = page.getByRole('list', { name: 'Itens a comprar' }).getByRole('checkbox', { name: 'Leite' });
    await tabAte(page, leite, 40, semSinal);
    await page.keyboard.press('Space');
    await expect.poll(() => planilhas.linhas(1)[0]?.valores['Comprado?']).toBe('TRUE');
    await expect(page.getByRole('list', { name: 'Itens comprados' }).getByRole('checkbox', { name: 'Leite' })).toBeChecked();
    await expect(page.getByRole('list', { name: 'Itens comprados' }).getByRole('checkbox', { name: 'Leite' })).toBeFocused();

    const item = page.getByRole('form', { name: 'Novo item' }).getByLabel('Item');
    await page.getByRole('heading', { level: 1 }).focus(); // volta ao começo da página para o Tab
    await tabAte(page, item, 40, semSinal);
    await page.keyboard.type('Manteiga');
    await page.keyboard.press('Enter');
    const cartao = page.getByRole('article');
    await expect(cartao).toContainText('Item guardado');
    await tabAte(page, cartao.getByRole('button', { name: 'Desfazer' }), 20, semSinal);
    await page.keyboard.press('Enter');
    await expect(cartao).toContainText('Item desfeito');
    expect(semSinal).toEqual([]);
  });

  test('pasta Registro: leitura escrita no teclado, Enter grava', async ({ page }) => {
    const planilhas = await abrirPastaDaCasa(page, /Consumo de Água/, 'Consumo de Água');
    const semSinal: string[] = [];
    const form = page.getByRole('form', { name: 'Nova leitura' });
    await tabAte(page, form.getByLabel(/^Leitura/), 60, semSinal);
    await page.keyboard.type('1020,5');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('article')).toContainText('Leitura guardada');
    expect(planilhas.linhas(3).at(-1)?.valores).toMatchObject({ Leitura: '1020.5' });
    expect(semSinal).toEqual([]);
  });

  test('Financeiro: gasto escrito no teclado, Enter grava', async ({ page }) => {
    const planilhas = await abrirPastaDaCasa(page, /Financeiro/, 'Financeiro');
    const semSinal: string[] = [];
    const form = page.getByRole('form', { name: 'Novo gasto' });
    await tabAte(page, form.getByLabel('Valor (€)'), 60, semSinal);
    await page.keyboard.type('12,50');
    await page.keyboard.press('Tab');
    await page.keyboard.type('Livraria');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('article')).toContainText('Gasto guardado');
    expect(planilhas.linhas(6).at(-1)?.valores).toMatchObject({ Descrição: 'Livraria', Valor: '12.5' });
    expect(semSinal).toEqual([]);
  });

  test('Nova pasta: abrir com Enter, foco no campo, Esc fecha e devolve o foco ao botão', async ({ page }) => {
    await abrirApp(page, '#/sala/sala-doutoramento');
    const semSinal: string[] = [];
    const botao = page.getByRole('region', { name: 'Pastas' }).getByRole('button', { name: /Nova pasta/ });
    await tabAte(page, botao, 60, semSinal);
    await page.keyboard.press('Enter');
    const form = page.getByRole('form', { name: 'Nova pasta' });
    await expect(form.getByLabel('Nome da pasta')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(form).toBeHidden();
    await expect(botao).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(form.getByLabel('Nome da pasta')).toBeFocused();
    await page.keyboard.type('Metodologia');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('region', { name: 'Pastas' }).getByText('Pasta criada')).toBeVisible();
    expect(semSinal).toEqual([]);
  });

  test('Nova pasta na Casa: escolher o tipo com as setas', async ({ page }) => {
    await abrirApp(page, '#/sala/sala-casa');
    await page.getByRole('region', { name: 'Pastas' }).getByRole('button', { name: /Nova pasta/ }).click();
    const form = page.getByRole('form', { name: 'Nova pasta' });
    const radios = form.getByRole('radio');
    await expect(radios.first()).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(radios.nth(1)).toBeChecked();
    await expect(radios.nth(1)).toBeFocused();
  });

  test('Pasta comum: tarefa nova com Enter no campo', async ({ page }) => {
    await criarMetodologia(page);
    const semSinal: string[] = [];
    const tarefas = page.getByRole('main').getByRole('region', { name: 'Tarefas' });
    await tabAte(page, tarefas.getByRole('textbox', { name: 'Nova tarefa em Metodologia' }), 60, semSinal);
    await page.keyboard.type('Escrever a justificativa');
    await page.keyboard.press('Enter');
    await expect(tarefas.getByText('Escrever a justificativa', { exact: true })).toBeVisible();
    expect(semSinal).toEqual([]);
  });
});

// O foco nunca cai no body (WCAG 2.4.3): cada botão que some ao ser usado leva o foco a um destino estável. Só com o teclado.
const foraDoBody = (page: Page) => expect.poll(() => page.evaluate(() => document.activeElement !== document.body && document.activeElement !== null)).toBe(true);
const focoEm = (page: Page) =>
  page.evaluate(() => {
    const e = document.activeElement as HTMLElement | null;
    return `${e?.tagName.toLowerCase()}|${e?.getAttribute('aria-label') || e?.id || e?.textContent?.trim().slice(0, 30)}`;
  });
/** Mês de hoje com 45 gastos: passa das 40 linhas da tabela, então aparece "Mostrar todos os 45 gastos". */
const MUITOS_GASTOS = { ...HISTORICO, financeiro: Array.from({ length: 45 }, (_, i) => gasto('2026-11-02', `Gasto ${i + 1}`, 'Lazer', '1')) };

test.describe('foco que não se perde, só com o teclado (computador)', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('Ideias: Fechar o cartão leva o foco ao título da seção', async ({ page }) => {
    await abrirApp(page, '#/');
    await expect((await falar(page, 'ideia: Pensar no artigo da Aurora')).getByText('Guardado em Ideias')).toBeVisible();
    await page.goto('/central-app/#/ideias');
    await tabAte(page, page.getByRole('main').getByRole('button', { name: /^Virar tarefa:/ }), 70);
    await page.keyboard.press('Enter');
    const cartao = page.getByRole('main').getByRole('article');
    await expect(cartao).toBeFocused();
    await tabAte(page, cartao.getByRole('button', { name: 'Fechar' }), 20);
    await page.keyboard.press('Enter');
    await expect(cartao).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Caixa de entrada' })).toBeFocused();
  });

  test('Pastas da sala: Criar pastas e Fechar o cartão', async ({ page }) => {
    await abrirApp(page, '#/sala/sala-casa');
    const pastas = page.getByRole('region', { name: 'Pastas' });
    await tabAte(page, pastas.getByRole('button', { name: 'Criar pastas padrão da Casa' }), 60);
    await page.keyboard.press('Enter');
    const cartao = pastas.getByRole('article');
    await expect(cartao).toBeFocused();
    await tabAte(page, cartao.getByRole('button', { name: 'Fechar' }), 20);
    await page.keyboard.press('Enter');
    await expect(cartao).toHaveCount(0);
    await expect(pastas.getByRole('heading', { name: 'Pastas' })).toBeFocused();
  });

  test('Nova pasta, Registro: "Trocar a unidade" leva o foco ao seletor', async ({ page }) => {
    await abrirApp(page, '#/sala/sala-casa');
    await page.getByRole('region', { name: 'Pastas' }).getByRole('button', { name: /Nova pasta/ }).click();
    const form = page.getByRole('form', { name: 'Nova pasta' });
    await form.getByRole('radio', { name: 'Registro' }).check();
    await tabAte(page, form.getByRole('button', { name: 'Trocar a unidade' }), 30);
    await page.keyboard.press('Enter');
    await expect(form.getByLabel('Unidade')).toBeFocused();
  });

  test('Registro: Fechar o cartão volta ao campo Leitura; Mostrar todas vira Mostrar menos e o foco fica', async ({ page }) => {
    await abrirPastaDaCasa(page, /Consumo de Água/, 'Consumo de Água', TREZE_MESES);
    const form = page.getByRole('form', { name: 'Nova leitura' });
    await tabAte(page, form.getByLabel(/^Leitura/), 60);
    await page.keyboard.type('1200');
    await page.keyboard.press('Enter');
    const cartao = page.getByRole('article');
    await expect(cartao).toBeFocused();
    await tabAte(page, cartao.getByRole('button', { name: 'Fechar' }), 20);
    await page.keyboard.press('Enter');
    await expect(cartao).toHaveCount(0);
    await expect(form.getByLabel(/^Leitura/)).toBeFocused();

    const mostrar = page.getByRole('button', { name: /^(Mostrar todas as|Mostrar menos)/ });
    await tabAte(page, mostrar, 40);
    await page.keyboard.press('Enter');
    await expect(mostrar).toHaveText('Mostrar menos');
    await expect(mostrar).toHaveAttribute('aria-expanded', 'true');
    await expect(mostrar).toBeFocused();
  });

  test('Registro: data no futuro mostra a mensagem da Central, ligada ao campo Data', async ({ page }) => {
    await abrirPastaDaCasa(page, /Consumo de Água/, 'Consumo de Água');
    const form = page.getByRole('form', { name: 'Nova leitura' });
    await form.getByLabel('Data').fill('2026-12-01');
    await form.getByLabel(/^Leitura/).fill('1030');
    await form.getByRole('button', { name: 'Guardar leitura' }).click();
    const mensagem = form.getByText('A data da leitura não pode estar no futuro.');
    await expect(mensagem).toBeVisible();
    await expect(form.getByLabel('Data')).toHaveAttribute('aria-invalid', 'true');
    await expect(form.getByLabel('Data')).toHaveAttribute('aria-describedby', (await mensagem.getAttribute('id'))!);
    await expect(form.getByLabel('Data')).toBeFocused();
  });

  test('Lista: Limpar comprados passa o foco ao botão que mostra e oculta; ele fica em foco', async ({ page }) => {
    await abrirPastaDaCasa(page, /Lista de Compras Semanais/, 'Lista de Compras Semanais');
    await tabAte(page, page.getByRole('button', { name: 'Limpar comprados' }), 60);
    await page.keyboard.press('Enter');
    const alternar = page.getByRole('button', { name: /^(Mostrar|Ocultar) comprados/ });
    await expect(alternar).toBeFocused();
    await expect(alternar).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Enter');
    await expect(alternar).toHaveText('Ocultar comprados');
    await expect(alternar).toHaveAttribute('aria-expanded', 'true');
    await expect(alternar).toBeFocused();
    await page.keyboard.press('Space');
    await expect(alternar).toHaveText(/^Mostrar comprados/);
    await expect(alternar).toBeFocused();
  });

  test('Lista: Fechar o cartão volta ao campo Item', async ({ page }) => {
    await abrirPastaDaCasa(page, /Lista de Compras Semanais/, 'Lista de Compras Semanais');
    const form = page.getByRole('form', { name: 'Novo item' });
    await tabAte(page, form.getByLabel('Item'), 60);
    await page.keyboard.type('Manteiga');
    await page.keyboard.press('Enter');
    const cartao = page.getByRole('article');
    await expect(cartao).toBeFocused();
    await tabAte(page, cartao.getByRole('button', { name: 'Fechar' }), 20);
    await page.keyboard.press('Enter');
    await expect(form.getByLabel('Item')).toBeFocused();
  });

  test('Financeiro: mês no limite fica em foco, Fechar volta ao campo Valor e Mostrar todos vira Mostrar menos', async ({ page }) => {
    await abrirPastaDaCasa(page, /Financeiro/, 'Financeiro', MUITOS_GASTOS);
    const seguinte = page.getByRole('button', { name: 'Mês seguinte' });
    await expect(seguinte).toHaveAttribute('aria-disabled', 'true');
    await tabAte(page, seguinte, 30);
    await page.keyboard.press('Enter');
    await expect(seguinte).toBeFocused();
    await expect(page.getByText('novembro de 2026')).toBeVisible();

    const form = page.getByRole('form', { name: 'Novo gasto' });
    await tabAte(page, form.getByLabel('Valor (€)'), 30);
    await page.keyboard.type('12,50');
    await page.keyboard.press('Tab');
    await page.keyboard.type('Livraria');
    await page.keyboard.press('Enter');
    const cartao = page.getByRole('article');
    await expect(cartao).toBeFocused();
    await tabAte(page, cartao.getByRole('button', { name: 'Fechar' }), 20);
    await page.keyboard.press('Enter');
    await expect(form.getByLabel('Valor (€)')).toBeFocused();

    const mostrar = page.getByRole('button', { name: /^(Mostrar todos os|Mostrar menos)/ });
    await tabAte(page, mostrar, 60);
    await page.keyboard.press('Enter');
    await expect(mostrar).toHaveText('Mostrar menos');
    await expect(mostrar).toBeFocused();
  });

  test('Página da pasta: Apagar, Desfazer e Fechar mantêm o foco em algum controle', async ({ page }) => {
    await abrirPastaDaCasa(page, /Lista de Compras Semanais/, 'Lista de Compras Semanais');
    await tabAte(page, page.getByRole('button', { name: 'Apagar pasta' }), 60);
    await page.keyboard.press('Enter');
    const cartao = page.getByRole('article');
    await expect(cartao.getByText('Pasta apagada')).toBeVisible();
    await expect(cartao).toBeFocused();
    await tabAte(page, cartao.getByRole('button', { name: 'Desfazer' }), 20);
    await page.keyboard.press('Enter');
    await expect(cartao.getByText('Desfeito')).toBeVisible();
    await expect(cartao).toBeFocused(); // o mesmo cartão: a página não foi remontada
    await tabAte(page, cartao.getByRole('button', { name: 'Fechar' }), 20);
    await page.keyboard.press('Enter');
    await expect(cartao).toHaveCount(0);
    await foraDoBody(page);
    expect(await focoEm(page)).toContain('Renomear');
  });

  test('Chat: Guardar como ideia, no cartão da tarefa, leva o foco ao cartão (o botão apertado some)', async ({ page }) => {
    await abrirApp(page, '#/');
    const cartao = await falar(page, 'Preciso parafusar o apoio do banheiro');
    await expect(cartao.getByRole('button', { name: 'Guardar como ideia' })).toBeVisible();
    // O campo do chat vem logo depois do cartão: de lá, Shift+Tab chega ao último botão dele.
    await page.getByRole('complementary', { name: 'Agora, água e chat' }).getByRole('textbox', { name: 'Escreva ou dite' }).focus();
    await page.keyboard.press('Shift+Tab');
    await expect(cartao.getByRole('button', { name: 'Guardar como ideia' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(cartao.getByText(/Trocado por uma ideia/)).toBeVisible();
    await foraDoBody(page);
    await expect(cartao).toBeFocused();
  });
});
