// Tarefa 18: a caixa de documentos de uma sala ou de uma pessoa.
// Nomes fictícios (Marina, Renata, Prof. Souza, Aurora).
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { limparConversa } from '../../src/chat/conversa';
import { gravarDoServidor, listar, salvar, semear, semearPalavras } from '../../src/dados/loja';
import type { Documento } from '../../src/dados/tipos';
import { Documentos } from '../../src/ui/Documentos';
import { scriptDeTeste } from '../apoio/script-ui';

// Quinta-feira, 2026-11-05, 12:20 (Europe/Lisbon). Só a data é falsa.
configure({ asyncUtilTimeout: 5000 });

/** Imita o navegador real: com a feature noopener devolve sempre null; sem ela, a janela. */
const navegadorReal = (_url?: string | URL, _alvo?: string, features?: string) =>
  features?.includes('noopener') ? null : ({ opener: {} } as unknown as Window);

beforeEach(async () => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-11-05T12:20:00Z'));
  limparConversa();
  await semear();
  await semearPalavras();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const caixa = async () => within(await screen.findByRole('region', { name: 'Documentos' }));

function guardar(extra: Partial<Documento> & { titulo: string; url: string }) {
  return salvar('documentos', { arquivado: false, salaId: 'sala-doutoramento', ...extra });
}

async function abrirFormulario() {
  const c = await caixa();
  fireEvent.click(c.getByRole('button', { name: 'Adicionar documento' }));
  return within(await screen.findByRole('form', { name: 'Novo documento' }));
}

describe('Documentos: lista', () => {
  it('caixa vazia diz que não há documentos', async () => {
    render(<Documentos de="desta sala" salaId="sala-aulas" />);
    expect(await (await caixa()).findByText('Nenhum documento ainda.')).toBeTruthy();
  });

  it('cada documento mostra o tipo em texto e o título; só os da própria sala', async () => {
    await guardar({ titulo: 'Capítulo 2', url: 'https://1drv.ms/w/s!Aurora123' });
    await guardar({ titulo: 'Aula 3', url: 'https://1drv.ms/p/s!Aurora123' });
    await guardar({ titulo: 'Notas', url: 'https://exemplo.invalid/n.xlsx' });
    await guardar({ titulo: 'Artigo', url: 'https://exemplo.invalid/a.pdf' });
    await guardar({ titulo: 'Portal', url: 'https://exemplo.invalid/portal' });
    await guardar({ titulo: 'De outra sala', url: 'https://exemplo.invalid/o', salaId: 'sala-aulas' });
    await guardar({ titulo: 'Da Marina', url: 'https://exemplo.invalid/m', salaId: 'sala-doutoramento', pessoaId: 'p-marina' });
    render(<Documentos de="desta sala" salaId="sala-doutoramento" />);
    const c = await caixa();
    const itens = await c.findAllByRole('listitem');
    const por = (titulo: string) => itens.find((li) => within(li).queryByRole('link', { name: titulo })) as HTMLElement;
    expect(itens).toHaveLength(5);
    expect(por('Capítulo 2').textContent).toContain('Word');
    expect(por('Aula 3').textContent).toContain('PowerPoint');
    expect(por('Notas').textContent).toContain('Excel');
    expect(por('Artigo').textContent).toContain('PDF');
    expect(por('Portal').textContent).toContain('Site');
    expect(c.queryByText('De outra sala')).toBeNull();
    expect(c.queryByText('Da Marina')).toBeNull();
  });

  it('na página da pessoa, mostra só os dela', async () => {
    await guardar({ titulo: 'Da Marina', url: 'https://exemplo.invalid/m', salaId: 'sala-orientacoes', pessoaId: 'p-marina' });
    await guardar({ titulo: 'Da Renata', url: 'https://exemplo.invalid/r', salaId: 'sala-orientacoes', pessoaId: 'p-renata' });
    await guardar({ titulo: 'Da sala', url: 'https://exemplo.invalid/s', salaId: 'sala-orientacoes' });
    render(<Documentos de="de Marina" salaId="sala-orientacoes" pessoaId="p-marina" />);
    const c = await caixa();
    expect(await c.findByRole('link', { name: 'Da Marina' })).toBeTruthy();
    expect(c.queryByText('Da Renata')).toBeNull();
    expect(c.queryByText('Da sala')).toBeNull();
  });

  it('clicar abre pelo abrirDocumento, em janela nova', async () => {
    const abrir = vi.spyOn(window, 'open').mockImplementation(navegadorReal);
    await guardar({ titulo: 'Capítulo 2', url: 'https://1drv.ms/w/s!Aurora123' });
    render(<Documentos de="desta sala" salaId="sala-doutoramento" />);
    fireEvent.click(await (await caixa()).findByRole('link', { name: 'Capítulo 2' }));
    expect(abrir).toHaveBeenCalledWith('https://1drv.ms/w/s!Aurora123', '_blank');
  });

  it('navegador real (devolve a janela): clique que funcionou não mostra aviso falso', async () => {
    vi.spyOn(window, 'open').mockImplementation(navegadorReal);
    await guardar({ titulo: 'Capítulo 2', url: 'https://1drv.ms/w/s!Aurora123' });
    render(<Documentos de="desta sala" salaId="sala-doutoramento" />);
    const c = await caixa();
    fireEvent.click(await c.findByRole('link', { name: 'Capítulo 2' }));
    expect(window.open).toHaveBeenCalledTimes(1);
    expect(c.queryByRole('alert')).toBeNull();
  });

  it('janela bloqueada: avisa em palavras simples', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    await guardar({ titulo: 'Capítulo 2', url: 'https://1drv.ms/w/s!Aurora123' });
    render(<Documentos de="desta sala" salaId="sala-doutoramento" />);
    fireEvent.click(await (await caixa()).findByRole('link', { name: 'Capítulo 2' }));
    expect((await caixa()).getByRole('alert').textContent).toMatch(/bloqueou/);
  });

  it('link que não é https (veio de outro aparelho) aparece sem abrir', async () => {
    const abrir = vi.spyOn(window, 'open').mockImplementation(navegadorReal);
    await guardar({ titulo: 'Velho', url: 'http://exemplo.invalid/velho' });
    render(<Documentos de="desta sala" salaId="sala-doutoramento" />);
    const c = await caixa();
    await c.findByText('Velho');
    expect(c.queryByRole('link', { name: 'Velho' })).toBeNull();
    expect(c.getByText(/não é seguro/)).toBeTruthy();
    expect(abrir).not.toHaveBeenCalled();
  });
});

describe('Documentos: adicionar', () => {
  it('cola o link, dá o título, escolhe a sala e guarda', async () => {
    render(<Documentos de="desta sala" salaId="sala-doutoramento" />);
    const form = await abrirFormulario();
    fireEvent.input(form.getByLabelText('Link'), { target: { value: ' https://1drv.ms/w/s!Aurora123 ' } });
    fireEvent.input(form.getByLabelText('Título'), { target: { value: 'Relatório 1' } });
    await waitFor(() => expect(form.getByRole('option', { name: 'Aulas' })).toBeTruthy());
    fireEvent.change(form.getByLabelText('Guardar em'), { target: { value: 'sala:sala-aulas' } });
    fireEvent.click(form.getByRole('button', { name: 'Guardar' }));

    await waitFor(async () => expect(await listar('documentos')).toHaveLength(1));
    const [doc] = await listar('documentos');
    expect(doc).toMatchObject({ titulo: 'Relatório 1', url: 'https://1drv.ms/w/s!Aurora123', salaId: 'sala-aulas', arquivado: false });
    expect((await caixa()).getByRole('status').textContent).toContain('Guardado em Aulas');
  });

  it('o destino começa na sala da página e pode ser uma pessoa', async () => {
    await salvar('pessoas', { id: 'p-marina', nome: 'Marina', salaId: 'sala-orientacoes' });
    render(<Documentos de="desta sala" salaId="sala-orientacoes" />);
    const form = await abrirFormulario();
    await waitFor(() => expect((form.getByLabelText('Guardar em') as HTMLSelectElement).value).toBe('sala:sala-orientacoes'));
    await waitFor(() => expect(form.getByRole('option', { name: 'Marina' })).toBeTruthy());
    fireEvent.input(form.getByLabelText('Link'), { target: { value: 'https://exemplo.invalid/m.pptx' } });
    fireEvent.input(form.getByLabelText('Título'), { target: { value: 'Aula da Marina' } });
    fireEvent.change(form.getByLabelText('Guardar em'), { target: { value: 'pessoa:p-marina' } });
    fireEvent.click(form.getByRole('button', { name: 'Guardar' }));
    await waitFor(async () => expect(await listar('documentos')).toHaveLength(1));
    expect((await listar('documentos'))[0]).toMatchObject({ pessoaId: 'p-marina', salaId: 'sala-orientacoes' });
  });

  it('aceita link de site', async () => {
    render(<Documentos de="desta sala" salaId="sala-mba" />);
    const form = await abrirFormulario();
    fireEvent.input(form.getByLabelText('Link'), { target: { value: 'https://exemplo.invalid/portal' } });
    fireEvent.input(form.getByLabelText('Título'), { target: { value: 'Portal' } });
    fireEvent.click(form.getByRole('button', { name: 'Guardar' }));
    const c = await caixa();
    expect(await c.findByRole('link', { name: 'Portal' })).toBeTruthy();
    expect(c.getByText('Site')).toBeTruthy();
  });

  it('recusa o que não for https:, sem gravar, e diz por quê', async () => {
    render(<Documentos de="desta sala" salaId="sala-mba" />);
    const form = await abrirFormulario();
    fireEvent.input(form.getByLabelText('Título'), { target: { value: 'Algo' } });
    for (const texto of ['http://exemplo.invalid/a', 'javascript:alert(1)', 'exemplo.invalid/a']) {
      fireEvent.input(form.getByLabelText('Link'), { target: { value: texto } });
      fireEvent.click(form.getByRole('button', { name: 'Guardar' }));
      expect((await screen.findByRole('alert')).textContent).toContain('https://');
      expect(form.getByLabelText('Link').getAttribute('aria-invalid')).toBe('true');
    }
    expect(await listar('documentos')).toHaveLength(0);
  });

  it('pede o título quando falta', async () => {
    render(<Documentos de="desta sala" salaId="sala-mba" />);
    const form = await abrirFormulario();
    fireEvent.input(form.getByLabelText('Link'), { target: { value: 'https://exemplo.invalid/a' } });
    fireEvent.click(form.getByRole('button', { name: 'Guardar' }));
    expect((await screen.findByRole('alert')).textContent).toContain('título');
    expect(await listar('documentos')).toHaveLength(0);
  });

  it('atualização de outro aparelho não mexe no campo em edição', async () => {
    render(<Documentos de="desta sala" salaId="sala-doutoramento" />);
    const form = await abrirFormulario();
    const campo = form.getByLabelText('Link') as HTMLInputElement;
    campo.focus();
    fireEvent.input(campo, { target: { value: 'https://exemplo.invalid/meio' } });
    await act(async () => {
      await gravarDoServidor([
        { colecao: 'documentos', registro: { id: 'd-remoto', titulo: 'Remoto', url: 'https://exemplo.invalid/r', salaId: 'sala-doutoramento', arquivado: false, atualizadoEm: Date.now() - 1000, aparelho: 'outro' } },
      ]);
    });
    expect(await (await caixa()).findByRole('link', { name: 'Remoto' })).toBeTruthy();
    const depois = form.getByLabelText('Link') as HTMLInputElement;
    expect(depois).toBe(campo);
    expect(depois.value).toBe('https://exemplo.invalid/meio');
    expect(document.activeElement).toBe(campo);
  });

  it('campos e botão do formulário usam as classes .campo e .botao (que dão o toque de 44 px no CSS)', async () => {
    render(<Documentos de="desta sala" salaId="sala-mba" />);
    const form = await abrirFormulario();
    for (const el of [form.getByLabelText('Link'), form.getByLabelText('Título'), form.getByLabelText('Guardar em'), form.getByRole('button', { name: 'Guardar' })]) {
      expect(el.className).toMatch(/\b(campo|botao)\b/);
    }
  });
});

describe('Documentos: arquivar', () => {
  it('Arquivar tira da caixa sem apagar e o Desfazer devolve', async () => {
    await guardar({ titulo: 'Capítulo 2', url: 'https://1drv.ms/w/s!Aurora123' });
    render(<Documentos de="desta sala" salaId="sala-doutoramento" />);
    const c = await caixa();
    fireEvent.click(await c.findByRole('button', { name: 'Arquivar Capítulo 2' }));

    await waitFor(() => expect(c.queryByRole('link', { name: 'Capítulo 2' })).toBeNull());
    expect(c.getByText('Nenhum documento ainda.')).toBeTruthy();
    const registro = (await listar('documentos'))[0];
    expect(registro.arquivado).toBe(true);
    expect(registro.apagado).toBeUndefined();
    expect(c.getByRole('status').textContent).toContain('Documento arquivado: Capítulo 2');

    fireEvent.click(c.getByRole('button', { name: 'Desfazer' }));
    expect(await c.findByRole('link', { name: 'Capítulo 2' })).toBeTruthy();
    expect((await listar('documentos'))[0].arquivado).toBe(false);
  });
});

describe('Documentos: nas páginas', () => {
  function mostrar(hash: string) {
    Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true, writable: true });
    history.replaceState(null, '', `/${hash}`);
    return render(<App />);
  }

  it('a página da sala mostra o documento guardado nela', async () => {
    await scriptDeTeste();
    await salvar('documentos', { id: 'doc-curso', titulo: 'Portal do curso', url: 'https://exemplo.org/curso', salaId: 'sala-mba', arquivado: false });
    mostrar('#/sala/sala-mba');
    const c = await caixa();
    expect(await c.findByRole('link', { name: 'Portal do curso' })).toBeTruthy();
    expect(c.getByText('Site')).toBeTruthy();
  });

  it('a página da pessoa guarda o documento nela', async () => {
    await scriptDeTeste();
    await salvar('pessoas', { id: 'p-marina', nome: 'Marina', salaId: 'sala-orientacoes', papel: 'aluna' });
    mostrar('#/pessoa/p-marina');
    await screen.findByRole('heading', { level: 1, name: 'Marina' });
    const form = await abrirFormulario();
    await waitFor(() => expect((form.getByLabelText('Guardar em') as HTMLSelectElement).value).toBe('pessoa:p-marina'));
    fireEvent.input(form.getByLabelText('Link'), { target: { value: 'https://exemplo.invalid/t.docx' } });
    fireEvent.input(form.getByLabelText('Título'), { target: { value: 'Tese da Marina' } });
    fireEvent.click(form.getByRole('button', { name: 'Guardar' }));
    expect(await (await caixa()).findByRole('link', { name: 'Tese da Marina' })).toBeTruthy();
    expect((await listar('documentos'))[0]).toMatchObject({ pessoaId: 'p-marina', salaId: 'sala-orientacoes' });
  });
});
