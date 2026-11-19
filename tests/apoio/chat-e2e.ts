// Falar com o chat nos testes de ponta a ponta (V02.1), como o dono faz: no computador é o painel da direita (abre a barra
// recolhida); no celular e no tablet é a página #/chat. Escrever e falar seguem o mesmo caminho; o reconhecimento de voz
// de verdade não roda no teste (`reconhecimentoFalso`, nos testes que ouvem).
import { expect, type Locator, type Page } from '@playwright/test';

/** O computador (colunas) começa acima de 1100 px; abaixo disso o chat é a página. */
const LARGURA_DO_COMPUTADOR = 1100;

/** A área onde o chat mora agora: o painel da direita (computador) ou a página (celular e tablet). */
export async function areaDoChat(page: Page): Promise<Locator> {
  const largura = page.viewportSize()?.width ?? 1280;
  if (largura > LARGURA_DO_COMPUTADOR) {
    const painel = page.getByRole('complementary', { name: 'Agora, água e chat' });
    const alternar = painel.getByRole('button', { name: /^Chat/ });
    if ((await alternar.getAttribute('aria-expanded')) === 'false') await alternar.click();
    return painel;
  }
  // Muda só o hash: a conversa (que mora na memória do app) continua.
  if (!/#\/chat$/.test(page.url())) await page.evaluate(() => (location.hash = '#/chat'));
  await expect(page.getByRole('heading', { level: 1, name: 'Chat' })).toBeVisible();
  return page.getByRole('main');
}

/**
 * Escreve a frase no chat e manda. Devolve a área do chat e o cartão que essa frase vai criar (o seguinte aos que já
 * estavam na conversa: o chat guarda a conversa inteira, então `last()` poderia ser o cartão da frase anterior).
 */
export async function falarNoChat(page: Page, frase: string): Promise<{ area: Locator; cartao: Locator }> {
  const area = await areaDoChat(page);
  const antes = await area.getByRole('article').count();
  await area.getByRole('textbox', { name: 'Escreva ou dite' }).fill(frase);
  await area.getByRole('button', { name: 'Enviar' }).click();
  return { area, cartao: area.getByRole('article').nth(antes) };
}
