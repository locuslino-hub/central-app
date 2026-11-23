// Bloco flutuante: janelinha sempre por cima (Document Picture-in-Picture) com as notas independentes da última pasta comum (ou da sala escolhida).
// Quinta-feira, 2026-11-05, 12:20 em Lisboa. Nomes e ids fictícios.
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { limparConversa } from '../../src/chat/conversa';
import { listar, salvar, semear, semearPalavras } from '../../src/dados/loja';
import { criarNota } from '../../src/dados/notas-independentes';
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
    await waitFor(() => expect(seletor.value).toBe('pasta:pasta-metodologia'));
    expect(await naJanela().findByRole('heading', { name: 'Notas · Metodologia' })).toBeTruthy();
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

  it('escrever uma nota na janela e salvar grava uma nota da subpasta, sem criar página', async () => {
    comApi();
    await metodologia();
    mostrar(HASH);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Bloco flutuante' }))[0]);
    fireEvent.click(await naJanela().findByRole('button', { name: /Nova nota/ }));
    fireEvent.click(await naJanela().findByRole('button', { name: 'Texto' }));
    fireEvent.input(await naJanela().findByRole('textbox', { name: 'Texto da nota' }), { target: { value: 'Ligar para a Renata' } });
    fireEvent.click(naJanela().getByRole('button', { name: 'Salvar nota' }));
    await waitFor(async () => expect(await listar('notas')).toEqual([expect.objectContaining({ salaId: 'sala-doutoramento', pastaId: 'pasta-metodologia', tipo: 'texto', texto: 'Ligar para a Renata' })]));
    expect(await naJanela().findByText('Ligar para a Renata')).toBeTruthy();
    expect(await listar('paginas')).toEqual([]);
  });

  it('fechar a janelinha antes de salvar perde o rascunho, mas a nota já salva fica', async () => {
    comApi();
    await metodologia();
    await criarNota({ salaId: 'sala-doutoramento', pastaId: 'pasta-metodologia', tipo: 'texto', texto: 'Nota já salva' });
    mostrar(HASH);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Bloco flutuante' }))[0]);
    fireEvent.click(await naJanela().findByRole('button', { name: /Nova nota/ }));
    fireEvent.click(await naJanela().findByRole('button', { name: 'Texto' }));
    fireEvent.input(await naJanela().findByRole('textbox', { name: 'Texto da nota' }), { target: { value: 'Rascunho não salvo' } });
    janela.disparar(new Event('pagehide'));
    await new Promise((r) => setTimeout(r, 200));
    expect((await listar('notas')).map((n) => n.texto)).toEqual(['Nota já salva']);
  });

  it('o campo aberto na janela não é redesenhado por uma versão que chega de fora', async () => {
    comApi();
    await metodologia();
    await criarNota({ salaId: 'sala-doutoramento', pastaId: 'pasta-metodologia', tipo: 'texto', texto: 'Nota existente' });
    mostrar(HASH);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Bloco flutuante' }))[0]);
    await naJanela().findByText('Nota existente');
    fireEvent.click(await naJanela().findByRole('button', { name: /Nova nota/ }));
    fireEvent.click(await naJanela().findByRole('button', { name: 'Texto' }));
    const campo = (await naJanela().findByRole('textbox', { name: 'Texto da nota' })) as HTMLTextAreaElement;
    fireEvent.input(campo, { target: { value: 'Ainda escrevendo' } });
    campo.focus();
    expect(janela.document.activeElement).toBe(campo);
    // Chega de outro aparelho outra nota da mesma subpasta, enquanto o dono está no campo.
    await criarNota({ salaId: 'sala-doutoramento', pastaId: 'pasta-metodologia', tipo: 'texto', texto: 'Chegou de fora' });
    expect(await naJanela().findByText('Chegou de fora')).toBeTruthy();
    expect(naJanela().getByRole('textbox', { name: 'Texto da nota' })).toBe(campo);
    expect(campo.value).toBe('Ainda escrevendo');
    expect(janela.document.activeElement).toBe(campo);
  });

  it('o seletor lista as salas e as pastas comuns, e escolher a sala mostra as notas dela', async () => {
    comApi();
    await metodologia();
    await criarNota({ salaId: 'sala-doutoramento', tipo: 'texto', texto: 'Nota da sala' });
    await criarNota({ salaId: 'sala-doutoramento', pastaId: 'pasta-metodologia', tipo: 'texto', texto: 'Nota da subpasta' });
    mostrar(HASH);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Bloco flutuante' }))[0]);
    const seletor = (await naJanela().findByRole('combobox', { name: 'Pasta' })) as HTMLSelectElement;
    await waitFor(() => expect(seletor.value).toBe('pasta:pasta-metodologia'));
    expect(Array.from(seletor.options).map((o) => o.textContent)).toEqual([
      'Doutoramento',
      'Doutoramento · Metodologia',
      'Investigação',
      'Aulas',
      'Orientações',
      'MBA',
      'Pessoal',
      'Casa',
    ]);
    expect(await naJanela().findByText('Nota da subpasta')).toBeTruthy();
    expect(naJanela().queryByText('Nota da sala')).toBeNull();

    fireEvent.change(seletor, { target: { value: 'sala:sala-doutoramento' } });
    expect(await naJanela().findByText('Nota da sala')).toBeTruthy();
    expect(naJanela().queryByText('Nota da subpasta')).toBeNull();
    expect(await naJanela().findByRole('heading', { name: 'Notas' })).toBeTruthy();
    expect(JSON.parse(localStorage.getItem('central.notas.ultimaPasta') ?? 'null')).toEqual({ salaId: 'sala-doutoramento' });
  });

  it('continua seguindo a última pasta comum aberta no app', async () => {
    comApi();
    await metodologia();
    await salvar('pastas', { id: 'pasta-etica', salaId: 'sala-doutoramento', tipo: 'comum', nome: 'Ética', ordem: 2 });
    mostrar(HASH);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Bloco flutuante' }))[0]);
    const seletor = (await naJanela().findByRole('combobox', { name: 'Pasta' })) as HTMLSelectElement;
    await waitFor(() => expect(seletor.value).toBe('pasta:pasta-metodologia'));
    act(() => {
      location.hash = '#/sala/sala-doutoramento/pasta/pasta-etica';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await waitFor(() => expect(seletor.value).toBe('pasta:pasta-etica'));
    expect(await naJanela().findByRole('heading', { name: 'Notas · Ética' })).toBeTruthy();
  });

  it('pasta apagada mostra o aviso', async () => {
    comApi();
    localStorage.setItem('central.notas.ultimaPasta', JSON.stringify({ salaId: 'sala-mba', pastaId: 'pasta-que-nao-existe' }));
    mostrar('#/');
    fireEvent.click(await screen.findByRole('button', { name: 'Bloco flutuante' }));
    expect(await naJanela().findByText('Abra uma subpasta ou escolha uma acima.')).toBeTruthy();
    expect(naJanela().queryByRole('heading', { name: /^Notas/ })).toBeNull();
  });
});
