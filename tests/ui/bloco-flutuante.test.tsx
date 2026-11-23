// Bloco flutuante: janelinha sempre por cima (Document Picture-in-Picture) com as notas da última pasta comum.
// Quinta-feira, 2026-11-05, 12:20 em Lisboa. Nomes e ids fictícios.
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { limparConversa } from '../../src/chat/conversa';
import { listar, salvar, semear, semearPalavras } from '../../src/dados/loja';
import { fecharBlocoFlutuante } from '../../src/ui/bloco-flutuante';

configure({ asyncUtilTimeout: 5000 });

type JanelaFalsa = {
  document: Document;
  addEventListener: EventTarget['addEventListener'];
  removeEventListener: EventTarget['removeEventListener'];
  focus: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  disparar: (e: Event) => void;
};

let janela: JanelaFalsa;
let pedir: ReturnType<typeof vi.fn>;

function novaJanela(): JanelaFalsa {
  const alvo = new EventTarget();
  // Um iframe dá um documento com janela própria, como a janelinha de verdade.
  const quadro = document.createElement('iframe');
  document.documentElement.append(quadro);
  return {
    document: quadro.contentDocument as Document,
    addEventListener: alvo.addEventListener.bind(alvo),
    removeEventListener: alvo.removeEventListener.bind(alvo),
    focus: vi.fn(),
    close: vi.fn(() => alvo.dispatchEvent(new Event('pagehide'))),
    disparar: (e) => alvo.dispatchEvent(e),
  };
}

beforeEach(async () => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-11-05T12:20:00Z'));
  limparConversa();
  await semear();
  await semearPalavras();
  janela = novaJanela();
  pedir = vi.fn(async () => janela);
});

afterEach(async () => {
  fecharBlocoFlutuante();
  cleanup();
  document.querySelectorAll('iframe').forEach((quadro) => quadro.remove());
  delete (window as unknown as Record<string, unknown>).documentPictureInPicture;
  await new Promise((r) => setTimeout(r, 150));
});

function comApi() {
  (window as unknown as Record<string, unknown>).documentPictureInPicture = { requestWindow: pedir };
}

function mostrar(hash: string, largura = 1280) {
  Object.defineProperty(window, 'innerWidth', { value: largura, configurable: true, writable: true });
  history.replaceState(null, '', `/${hash}`);
  return render(<App />);
}

const HASH = '#/sala/sala-doutoramento/pasta/pasta-metodologia';
const metodologia = () => salvar('pastas', { id: 'pasta-metodologia', salaId: 'sala-doutoramento', tipo: 'comum', nome: 'Metodologia', ordem: 1 });
const naJanela = () => within(janela.document.body);

describe('bloco flutuante', () => {
  it('sem a API o botão não aparece', async () => {
    await metodologia();
    mostrar(HASH);
    await screen.findByRole('heading', { level: 1, name: 'Metodologia' });
    expect(screen.queryByRole('button', { name: 'Bloco flutuante' })).toBeNull();
  });

  it('com a API o botão aparece no menu e na pasta', async () => {
    comApi();
    await metodologia();
    mostrar(HASH);
    await screen.findByRole('heading', { level: 1, name: 'Metodologia' });
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Bloco flutuante' })).toHaveLength(2));
  });

  it('abre a janela com as notas da última pasta', async () => {
    comApi();
    await metodologia();
    mostrar(HASH);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Bloco flutuante' }))[0]);
    await waitFor(() => expect(pedir).toHaveBeenCalledTimes(1));
    const seletor = (await naJanela().findByRole('combobox', { name: 'Pasta' })) as HTMLSelectElement;
    await waitFor(() => expect(seletor.value).toBe('pasta-metodologia'));
    expect(await naJanela().findByRole('heading', { name: 'Notas' })).toBeTruthy();
  });

  it('não abre duas', async () => {
    comApi();
    await metodologia();
    mostrar(HASH);
    const [botao] = await screen.findAllByRole('button', { name: 'Bloco flutuante' });
    fireEvent.click(botao);
    await waitFor(() => expect(pedir).toHaveBeenCalledTimes(1));
    await naJanela().findByRole('combobox', { name: 'Pasta' });
    fireEvent.click(botao);
    await waitFor(() => expect(janela.focus).toHaveBeenCalled());
    expect(pedir).toHaveBeenCalledTimes(1);
  });

  it('escrever na janela grava a página', async () => {
    comApi();
    await metodologia();
    mostrar(HASH);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Bloco flutuante' }))[0]);
    const campo = await naJanela().findByRole('textbox', { name: 'Texto' });
    fireEvent.input(campo, { target: { value: 'Ligar para a Renata' } });
    janela.disparar(new Event('pagehide'));
    await waitFor(async () => {
      const pagina = (await listar('paginas')).find((p) => p.id === 'nota-pasta-metodologia');
      expect(pagina?.blocos.map((b) => b.texto)).toContain('Ligar para a Renata');
    });
  });

  it('o campo em uso na janela não é redesenhado por uma versão que chega de fora', async () => {
    comApi();
    await metodologia();
    mostrar(HASH);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Bloco flutuante' }))[0]);
    const campo = (await naJanela().findByRole('textbox', { name: 'Texto' })) as HTMLInputElement;
    campo.focus();
    expect(janela.document.activeElement).toBe(campo);
    await waitFor(async () => expect((await listar('paginas')).some((p) => p.id === 'nota-pasta-metodologia')).toBe(true));
    const [pagina] = (await listar('paginas')).filter((p) => p.id === 'nota-pasta-metodologia');
    // Chega de outro aparelho a mesma linha com outro texto, enquanto o dono está no campo.
    await salvar('paginas', { ...pagina, blocos: [{ ...pagina.blocos[0], texto: 'Texto de fora' }] });
    await new Promise((r) => setTimeout(r, 300));
    expect(campo.value).toBe('');
  });

  it('pasta apagada mostra o aviso', async () => {
    comApi();
    localStorage.setItem('central.notas.ultimaPasta', JSON.stringify({ salaId: 'sala-mba', pastaId: 'pasta-que-nao-existe' }));
    mostrar('#/');
    fireEvent.click(await screen.findByRole('button', { name: 'Bloco flutuante' }));
    expect(await naJanela().findByText('Abra uma subpasta ou escolha uma acima.')).toBeTruthy();
    expect(naJanela().queryByRole('heading', { name: 'Notas' })).toBeNull();
  });
});
