// Falar com o chat do painel direito (computador), como o dono faz: abre a barra recolhida, escreve no campo e manda.
// A voz de verdade não existe no teste; escrever e falar seguem o mesmo caminho (`enviar`).
import { fireEvent, screen, within } from '@testing-library/preact';

export function painelDoChat(): HTMLElement {
  return screen.getByRole('complementary', { name: 'Agora, água e chat' });
}

/** Abre o chat do painel (começa recolhido), escreve a frase e manda. Devolve o painel. */
export function escreverNoChatDoPainel(frase: string): HTMLElement {
  const painel = painelDoChat();
  const botao = within(painel).getByRole('button', { name: /^Chat/ });
  if (botao.getAttribute('aria-expanded') === 'false') fireEvent.click(botao);
  fireEvent.input(within(painel).getByRole('textbox', { name: 'Escreva ou dite' }), { target: { value: frase } });
  fireEvent.click(within(painel).getByRole('button', { name: 'Enviar' }));
  return painel;
}
