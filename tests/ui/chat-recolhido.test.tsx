import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { enviar, limparConversa } from '../../src/chat/conversa';
import { semear, semearPalavras } from '../../src/dados/loja';
import { CHAVE_DO_CHAT } from '../../src/ui/PainelDireito';

// Chat do painel direito recolhido por padrão (computador). Quinta-feira, 2026-11-05, 12:20.
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 5, 12, 20));
  localStorage.removeItem(CHAVE_DO_CHAT);
  limparConversa();
  await semear();
  await semearPalavras();
});

function mostrar(hash: string, largura: number) {
  Object.defineProperty(window, 'innerWidth', { value: largura, configurable: true, writable: true });
  history.replaceState(null, '', `/${hash}`);
  render(<App />);
}

const lado = () => screen.getByRole('complementary', { name: 'Agora e chat' });
const alternar = () => within(lado()).getByRole('button', { name: /^Chat/ });
const campo = () => within(lado()).queryByRole('textbox', { name: 'Escreva ou dite' }) as HTMLInputElement | null;

describe('chat do painel direito, recolhido', () => {
  it('começa recolhido: só a barra com o botão, o campo escondido e o Agora com o espaço', () => {
    mostrar('#/', 1280);
    const botao = alternar();
    expect(botao.getAttribute('aria-expanded')).toBe('false');
    const controlado = document.getElementById(botao.getAttribute('aria-controls')!);
    expect(controlado).not.toBeNull();
    expect(controlado!.hidden).toBe(true);
    expect(campo()).toBeNull();
    expect(lado().getAttribute('data-chat')).toBe('recolhido');
    // O título continua sendo "Chat" (o botão está dentro dele).
    expect(within(lado()).getByRole('heading', { name: 'Chat' })).toBeTruthy();
  });

  it('abrir mostra a conversa e põe o foco no campo; fica guardado no aparelho', async () => {
    mostrar('#/', 1280);
    fireEvent.click(alternar());
    expect(alternar().getAttribute('aria-expanded')).toBe('true');
    await waitFor(() => expect(document.activeElement).toBe(campo()));
    expect(lado().getAttribute('data-chat')).toBe('aberto');
    expect(localStorage.getItem(CHAVE_DO_CHAT)).toBe('1');
  });

  it('Esc recolhe e devolve o foco ao botão', async () => {
    mostrar('#/', 1280);
    fireEvent.click(alternar());
    await waitFor(() => expect(document.activeElement).toBe(campo()));
    fireEvent.keyDown(campo()!, { key: 'Escape' });
    expect(alternar().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(alternar());
    expect(campo()).toBeNull();
    expect(localStorage.getItem(CHAVE_DO_CHAT)).toBe('0');
  });

  it('o mesmo botão recolhe de novo, e o que se digitou continua lá ao reabrir', async () => {
    mostrar('#/', 1280);
    fireEvent.click(alternar());
    fireEvent.input(campo()!, { target: { value: 'Ligar para a Aurora' } });
    fireEvent.click(alternar());
    expect(campo()).toBeNull();
    fireEvent.click(alternar());
    expect(campo()!.value).toBe('Ligar para a Aurora');
  });

  it('lembra que estava aberto, sem roubar o foco ao abrir o app', () => {
    localStorage.setItem(CHAVE_DO_CHAT, '1');
    mostrar('#/', 1280);
    expect(alternar().getAttribute('aria-expanded')).toBe('true');
    expect(campo()).not.toBeNull();
    expect(document.activeElement).not.toBe(campo());
  });

  it('sem acesso ao armazenamento: começa recolhido e abre do mesmo jeito', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    mostrar('#/', 1280);
    expect(alternar().getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(alternar());
    expect(alternar().getAttribute('aria-expanded')).toBe('true');
  });

  it('resposta que chega com o chat recolhido acende um sinal; abrir apaga', async () => {
    mostrar('#/', 1280);
    expect(lado().querySelector('.chat-sinal')).toBeNull();

    await act(async () => {
      await enviar('Preciso parafusar o apoio do banheiro');
    });

    await waitFor(() => expect(lado().querySelector('.chat-sinal')).not.toBeNull());
    expect(alternar().textContent).toContain('resposta nova');
    expect(within(lado()).getByText('Resposta nova no chat.')).toBeTruthy();

    fireEvent.click(alternar());
    expect(lado().querySelector('.chat-sinal')).toBeNull();
    expect(within(lado()).getByRole('article')).toBeTruthy();

    // Recolher de novo, sem nada novo: sem sinal.
    fireEvent.click(alternar());
    expect(lado().querySelector('.chat-sinal')).toBeNull();
    expect(within(lado()).queryByText('Resposta nova no chat.')).toBeNull();
  });

  it('a conversa que já existia quando o painel apareceu não acende o sinal', async () => {
    await enviar('Comprar pão');
    mostrar('#/', 1280);
    expect(lado().querySelector('.chat-sinal')).toBeNull();
  });

  it('no celular nada muda: o chat é a página, sem botão de recolher', () => {
    mostrar('#/chat', 390);
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(document.getElementById('chat-do-painel')).toBeNull();
    expect(within(screen.getByRole('main')).getByRole('textbox', { name: 'Escreva ou dite' })).toBeTruthy();
  });
});
