import { expect, test, type Page } from '@playwright/test';
import { areaDoChat, falarNoChat } from '../apoio/chat-e2e';
import { inicios, reconhecimentoFalso } from '../apoio/voz-e2e';

// A voz dentro do chat (V02.1), no navegador. O reconhecimento de fala de verdade não roda no teste: um falso entra no
// lugar e "fala" quando o toque o inicia. Quinta-feira, 2026-11-05, 12:20 em Lisboa (inverno: UTC+0). Só nomes fictícios.
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

test.describe('celular, 390 px', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('o microfone mora no campo do chat, não escuta sozinho, a chave de áudio vem desligada e nada estoura a tela', async ({ page }) => {
    const erros = vigiarErros(page);
    await reconhecimentoFalso(page, 'revisar o capítulo dois');
    await page.goto('/central-app/#/chat');

    const campo = page.getByRole('textbox', { name: 'Escreva ou dite' });
    const mic = page.getByRole('button', { name: 'Falar' });
    await expect(mic).toBeVisible();
    // O microfone fica ao lado do campo, na mesma linha, antes do Enviar.
    const caixaDoCampo = (await campo.boundingBox())!;
    const caixaDoMic = (await mic.boundingBox())!;
    expect(Math.abs(caixaDoMic.y + caixaDoMic.height / 2 - (caixaDoCampo.y + caixaDoCampo.height / 2))).toBeLessThan(8);
    expect(await inicios(page)).toBe(0);
    await expect(page.getByRole('switch', { name: 'Gravar áudio' })).not.toBeChecked();
    await expect(page.getByText(/envia o áudio ao Google/)).toBeVisible();

    expect(await pequenos(page)).toEqual([]);
    expect(await semRolagemDeLado(page)).toBe(true);
    expect(erros).toEqual([]);
  });

  test('um toque escuta e mostra o texto ao vivo no campo; Enviar guarda a ideia com cartão, e Desfazer apaga', async ({ page }) => {
    const erros = vigiarErros(page);
    await reconhecimentoFalso(page, 'ideia: usar o artigo do Prof. Souza no capítulo 2');
    await page.goto('/central-app/#/chat');

    await page.getByRole('button', { name: 'Falar' }).click();
    await expect(page.getByRole('textbox', { name: 'Escreva ou dite' })).toHaveValue('ideia: usar o artigo do Prof. Souza no capítulo 2');
    await expect(page.getByRole('button', { name: 'Falar' })).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: 'Enviar' }).click();
    const cartao = page.getByRole('article');
    await expect(cartao.getByText('Guardado em Ideias')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Escreva ou dite' })).toHaveValue('');
    expect(await pequenos(page)).toEqual([]);

    await cartao.getByRole('button', { name: 'Desfazer' }).click();
    await expect(page.getByText('Desfeito. Nada ficou guardado.')).toBeVisible();
    expect(erros).toEqual([]);
  });

  test('frase falada que não é nada específico vira tarefa de hoje, com Trocar sala e Guardar como ideia', async ({ page }) => {
    await reconhecimentoFalso(page, 'usar o artigo do Prof. Souza no capítulo 2');
    await page.goto('/central-app/#/chat');

    await page.getByRole('button', { name: 'Falar' }).click();
    await page.getByRole('button', { name: 'Enviar' }).click();

    const cartao = page.getByRole('article');
    await expect(cartao.getByText('Hoje')).toBeVisible();
    await expect(cartao.getByRole('button', { name: 'Guardar como ideia' })).toBeVisible();
    await cartao.getByRole('button', { name: 'Guardar como ideia' }).click();
    await expect(page.getByText('Guardado em Ideias')).toBeVisible();
  });

  test('Enviar sem nada no campo não grava nem reclama', async ({ page }) => {
    await page.goto('/central-app/#/chat');
    await page.getByRole('button', { name: 'Enviar' }).click();
    await expect(page.getByRole('article')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('não há botão flutuante nem a tela Pode falar: #/falar leva ao chat ouvindo', async ({ page }) => {
    await reconhecimentoFalso(page, null);
    await page.goto('/central-app/#/atividades');
    await expect(page.getByRole('link', { name: /Pode falar/ })).toHaveCount(0);

    await page.goto('/central-app/#/falar');

    await expect(page).toHaveURL(/#\/chat$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Chat' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Falar' })).toHaveAttribute('aria-pressed', 'true');
    expect(await inicios(page)).toBe(1);
  });

  test('o endereço do atalho do ícone, #/?falar=1, abre o chat já ouvindo', async ({ page }) => {
    await reconhecimentoFalso(page, null);
    await page.goto('/central-app/#/?falar=1');

    await expect(page).toHaveURL(/#\/chat$/);
    await expect(page.getByRole('button', { name: 'Falar' })).toHaveAttribute('aria-pressed', 'true');
    expect(await inicios(page)).toBe(1);
  });
});

test.describe('computador, 1280 px', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('Ctrl+Alt+N, de qualquer tela, abre o chat do painel, põe o foco no campo e liga o microfone', async ({ page }) => {
    const erros = vigiarErros(page);
    await reconhecimentoFalso(page, 'revisar o capítulo dois');
    await page.goto('/central-app/#/semana');
    const painel = page.getByRole('complementary', { name: 'Agora, água e chat' });
    await expect(painel.getByRole('button', { name: /^Chat/ })).toHaveAttribute('aria-expanded', 'false');

    await page.keyboard.press('Control+Alt+n');

    await expect(painel.getByRole('button', { name: /^Chat/ })).toHaveAttribute('aria-expanded', 'true');
    const campo = painel.getByRole('textbox', { name: 'Escreva ou dite' });
    await expect(campo).toBeFocused();
    await expect(painel.getByRole('button', { name: 'Falar' })).toHaveAttribute('aria-pressed', 'true');
    await expect(campo).toHaveValue('revisar o capítulo dois');
    expect(await inicios(page)).toBe(1);
    await expect(page).toHaveURL(/#\/semana$/); // o chat é o painel: a página não muda
    expect(await pequenos(page)).toEqual([]);
    expect(erros).toEqual([]);
  });

  test('não há pílula "Pode falar" no topo', async ({ page }) => {
    await page.goto('/central-app/#/semana');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: /Pode falar/ })).toHaveCount(0);
  });

  test('o endereço do atalho do ícone, #/?falar=1, abre o app com o painel do chat aberto e ouvindo', async ({ page }) => {
    await reconhecimentoFalso(page, null);
    await page.goto('/central-app/#/?falar=1');

    const painel = page.getByRole('complementary', { name: 'Agora, água e chat' });
    await expect(painel.getByRole('button', { name: 'Falar' })).toHaveAttribute('aria-pressed', 'true');
    await expect(painel.getByRole('textbox', { name: 'Escreva ou dite' })).toBeFocused();
    await expect(page).toHaveURL(/#\/$/);
    expect(await inicios(page)).toBe(1);
  });

  test('falar uma lista: o cartão aparece no chat, sem sair da tela', async ({ page }) => {
    await page.goto('/central-app/#/atividades');
    const { cartao } = await falarNoChat(page, 'comprar leite amanhã');
    await expect(cartao.getByText('Comprar leite')).toBeVisible();
    await expect(page).toHaveURL(/#\/atividades$/);
  });

  test('"ideia: ..." escrita no chat vai para Ideias, com o Ver do cartão', async ({ page }) => {
    await page.goto('/central-app/#/');
    const { cartao } = await falarNoChat(page, 'ideia: app de receitas');
    await expect(cartao.getByText('Guardado em Ideias')).toBeVisible();
    await cartao.getByRole('link', { name: 'Ver' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Ideias' })).toBeVisible();
    await expect(page.getByRole('main').getByText('app de receitas')).toBeVisible();
    expect(await (await areaDoChat(page)).getByRole('article').count()).toBe(1);
  });

  test('o manifest tem o atalho do ícone, que abre o chat ouvindo', async ({ page }) => {
    const resposta = await page.request.get('/central-app/manifest.webmanifest');
    const manifest = await resposta.json();
    expect(manifest.shortcuts).toEqual([expect.objectContaining({ name: 'Falar no chat', url: '/central-app/#/?falar=1' })]);
  });
});
