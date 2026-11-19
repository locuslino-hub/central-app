// Como o chat ouve sem a tela "Pode falar" (V02.1): Ctrl+Alt+N, o atalho do ícone instalado (`#/?falar=1`, e o antigo
// `#/falar`), o botão "Nova ideia" das Ideias, e o que sumiu (a pílula do topo e o botão flutuante do celular).
// Quinta-feira, 2026-11-05, 12:20. Só nomes fictícios.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { limparConversa } from '../../src/chat/conversa';
import { semear, semearPalavras } from '../../src/dados/loja';
import { enderecoSemPedidoDeVoz } from '../../src/ui/Casca';
import { CHAVE_DO_CHAT } from '../../src/ui/PainelDireito';
import { limparPedidoDeVoz } from '../../src/ui/pedido-de-voz';
import { iniciarEscuta } from '../../src/voz/reconhecimento';

vi.mock('../../src/voz/reconhecimento', () => ({ iniciarEscuta: vi.fn() }));
vi.mock('../../src/voz/gravador', () => ({
  iniciarGravacao: vi.fn(),
  enviarAudio: vi.fn(),
  reenviarAudiosPendentes: vi.fn(async () => ({ enviados: [], descartados: [], restantes: 0, falhas: [] })),
}));

const escutaMock = vi.mocked(iniciarEscuta);

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 5, 12, 20));
  localStorage.removeItem(CHAVE_DO_CHAT);
  vi.clearAllMocks();
  limparConversa();
  limparPedidoDeVoz();
  await semear();
  await semearPalavras();
});

/** Uma escuta falsa: guarda os avisos de erro, para o teste fazer o navegador falhar. */
function escutaFalsa() {
  let aoErro: (erro: string) => void = () => {};
  const escuta = { parar: vi.fn(async () => ''), cancelar: vi.fn() };
  escutaMock.mockImplementation(((_t: unknown, e: typeof aoErro) => {
    aoErro = e;
    return escuta;
  }) as unknown as typeof iniciarEscuta);
  return { escuta, falhar: (erro: string) => act(() => aoErro(erro)) };
}

function mostrar(hash: string, largura: number) {
  Object.defineProperty(window, 'innerWidth', { value: largura, configurable: true, writable: true });
  history.replaceState(null, '', `/${hash}`);
  return render(<App />);
}

const atalho = (alvo: Window | Element = window, extra: KeyboardEventInit = {}) =>
  fireEvent.keyDown(alvo, { key: 'n', code: 'KeyN', ctrlKey: true, altKey: true, bubbles: true, ...extra });
const painel = () => screen.getByRole('complementary', { name: 'Agora, água e chat' });
const campoDoPainel = () => within(painel()).getByRole('textbox', { name: 'Escreva ou dite' }) as HTMLInputElement;
const microfone = () => screen.getByRole('button', { name: 'Falar' });

describe('Ctrl+Alt+N no computador', () => {
  it('abre o chat recolhido do painel, põe o foco no campo e liga o microfone', async () => {
    escutaFalsa();
    mostrar('#/', 1280);
    expect(within(painel()).getByRole('button', { name: /^Chat/ }).getAttribute('aria-expanded')).toBe('false');

    atalho();

    await waitFor(() => expect(within(painel()).getByRole('button', { name: /^Chat/ }).getAttribute('aria-expanded')).toBe('true'));
    await waitFor(() => expect(escutaMock).toHaveBeenCalledTimes(1));
    expect(document.activeElement).toBe(campoDoPainel());
    expect(microfone().getAttribute('aria-pressed')).toBe('true');
    expect(location.hash).toBe('#/'); // o chat é o painel: nenhuma página nova
  });

  it('com o chat do painel já aberto, também foca e liga; o atalho de novo para a escuta', async () => {
    const voz = escutaFalsa();
    localStorage.setItem(CHAVE_DO_CHAT, '1');
    mostrar('#/semana', 1280);

    atalho();
    await waitFor(() => expect(escutaMock).toHaveBeenCalledTimes(1));
    expect(document.activeElement).toBe(campoDoPainel());

    atalho(campoDoPainel()); // dentro do campo do chat o atalho vale
    await waitFor(() => expect(voz.escuta.parar).toHaveBeenCalled());
    expect(microfone().getAttribute('aria-pressed')).toBe('false');
  });

  it('na página #/chat (computador) o campo da página ganha o foco e ouve', async () => {
    escutaFalsa();
    mostrar('#/chat', 1280);

    atalho();

    await waitFor(() => expect(escutaMock).toHaveBeenCalledTimes(1));
    expect(document.activeElement).toBe(within(screen.getByRole('main')).getByRole('textbox', { name: 'Escreva ou dite' }));
  });

  it('foco no campo de outra tela: o atalho é ignorado', async () => {
    escutaFalsa();
    mostrar('#/', 1280);
    const outro = document.createElement('input');
    document.body.append(outro);
    outro.focus();

    atalho(outro);

    await new Promise((pronto) => setTimeout(pronto, 30));
    expect(escutaMock).not.toHaveBeenCalled();
    expect(within(painel()).getByRole('button', { name: /^Chat/ }).getAttribute('aria-expanded')).toBe('false');
    outro.remove();
  });

  it('tecla segurada (repeat) não repete o pedido', async () => {
    escutaFalsa();
    mostrar('#/', 1280);

    atalho(window, { repeat: true });

    await new Promise((pronto) => setTimeout(pronto, 30));
    expect(escutaMock).not.toHaveBeenCalled();
  });
});

describe('Ctrl+Alt+N no celular e no tablet', () => {
  it.each([390, 820])('leva à página do chat (%i px) e liga o microfone', async (largura) => {
    escutaFalsa();
    mostrar('#/semana', largura);

    atalho();

    await waitFor(() => expect(location.hash).toBe('#/chat'));
    await waitFor(() => expect(escutaMock).toHaveBeenCalledTimes(1));
    const principal = within(screen.getByRole('main'));
    expect(principal.getByRole('heading', { level: 1, name: 'Chat' })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(principal.getByRole('textbox', { name: 'Escreva ou dite' })));
  });
});

describe('o atalho do ícone instalado abre o app já ouvindo', () => {
  it.each(['#/?falar=1', '#/falar'])('no computador, %s abre o painel do chat ouvindo e limpa o endereço', async (hash) => {
    escutaFalsa();
    mostrar(hash, 1280);

    await waitFor(() => expect(escutaMock).toHaveBeenCalledTimes(1));
    expect(within(painel()).getByRole('button', { name: /^Chat/ }).getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(campoDoPainel());
    expect(location.hash).toBe('#/');
    expect(screen.getByRole('heading', { level: 1, name: 'Painel do dia' })).toBeTruthy();
  });

  it.each(['#/?falar=1', '#/falar'])('no celular, %s leva ao chat ouvindo (sem deixar o endereço antigo no histórico)', async (hash) => {
    escutaFalsa();
    const voltas = vi.spyOn(history, 'pushState');
    mostrar(hash, 390);

    await waitFor(() => expect(location.hash).toBe('#/chat'));
    await waitFor(() => expect(escutaMock).toHaveBeenCalledTimes(1));
    expect(within(screen.getByRole('main')).getByRole('heading', { level: 1, name: 'Chat' })).toBeTruthy();
    expect(voltas).not.toHaveBeenCalled();
  });

  it('se o navegador recusar a escuta sem toque, o aviso manda tocar no microfone, e o campo continua', async () => {
    const voz = escutaFalsa();
    mostrar('#/?falar=1', 1280);
    await waitFor(() => expect(escutaMock).toHaveBeenCalledTimes(1));

    voz.falhar('permissao_negada');

    expect(await screen.findByText(/não começou sozinho\. Toque no microfone/)).toBeTruthy();
    expect(campoDoPainel().readOnly).toBe(false);
  });

  it('enderecoSemPedidoDeVoz: reconhece o pedido, tira só ele, e deixa em paz os outros endereços', () => {
    expect(enderecoSemPedidoDeVoz('#/?falar=1')).toBe('#/');
    expect(enderecoSemPedidoDeVoz('#/falar')).toBe('#/');
    expect(enderecoSemPedidoDeVoz('#/falar/')).toBe('#/');
    expect(enderecoSemPedidoDeVoz('#/semana?d=2026-11-16&falar=1')).toBe('#/semana?d=2026-11-16');
    expect(enderecoSemPedidoDeVoz('#/')).toBeNull();
    expect(enderecoSemPedidoDeVoz('#/chat')).toBeNull();
    expect(enderecoSemPedidoDeVoz('#/semana?d=2026-11-16')).toBeNull();
    expect(enderecoSemPedidoDeVoz('#/?falar=2')).toBeNull();
  });
});

describe('o que saiu com a tela Pode falar', () => {
  it.each([1280, 820, 390])('não há pílula "Pode falar" no topo nem botão flutuante (%i px)', async (largura) => {
    escutaFalsa();
    mostrar('#/', largura);
    await screen.findByRole('heading', { level: 1, name: 'Painel do dia' });

    expect(screen.queryByRole('link', { name: /Pode falar/ })).toBeNull();
    expect(screen.queryByText('Pode falar')).toBeNull();
  });
});

describe('Nova ideia, nas Ideias', () => {
  it('leva ao chat com "Ideia: " já no campo, sem ligar o microfone', async () => {
    escutaFalsa();
    mostrar('#/ideias', 1280);

    fireEvent.click(await screen.findByRole('button', { name: /Nova ideia/ }));

    await waitFor(() => expect(campoDoPainel().value).toBe('Ideia: '));
    expect(document.activeElement).toBe(campoDoPainel());
    expect(escutaMock).not.toHaveBeenCalled();
  });

  it('no celular leva à página do chat', async () => {
    escutaFalsa();
    mostrar('#/ideias', 390);

    fireEvent.click(await screen.findByRole('button', { name: /Nova ideia/ }));

    await waitFor(() => expect(location.hash).toBe('#/chat'));
    const campo = (await within(screen.getByRole('main')).findByRole('textbox', { name: 'Escreva ou dite' })) as HTMLInputElement;
    await waitFor(() => expect(campo.value).toBe('Ideia: '));
    expect(escutaMock).not.toHaveBeenCalled();
  });
});
