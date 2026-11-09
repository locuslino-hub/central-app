// Tarefa 19: o caderno de uma sala. Nomes fictícios (Marina, Renata, Prof. Souza, Aurora).
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { limparConversa } from '../../src/chat/conversa';
import { criarPagina, novoBloco, novoPainel, removerBloco } from '../../src/dados/caderno';
import { gravarDoServidor, lerRegistros, listar, salvar, semear, semearPalavras } from '../../src/dados/loja';
import type { Bloco, Pagina, Tarefa } from '../../src/dados/tipos';
import { Caderno } from '../../src/ui/Caderno';
import { scriptDeTeste } from '../apoio/script-ui';

// Quinta-feira, 2026-11-05, 12:20 (Europe/Lisbon). Só a data é falsa.
configure({ asyncUtilTimeout: 5000 });

beforeEach(async () => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-11-05T12:20:00Z'));
  limparConversa();
  await semear();
  await semearPalavras();
});

// Desmontar grava o que ficou por gravar; espera terminar antes de o próximo teste trocar o banco.
afterEach(async () => {
  cleanup();
  await new Promise((r) => setTimeout(r, 150));
});

const espera = (ms = 100) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });

const caderno = async () => within(await screen.findByRole('region', { name: 'Caderno' }));
const paginaGuardada = async (id: string) => (await lerRegistros([{ colecao: 'paginas', id }]))[0] as Pagina;

/** Uma página da sala MBA com as linhas dadas, já guardada. */
async function comBlocos(blocos: Bloco[]) {
  const pagina = await criarPagina('sala-mba', 'Reunião do grupo');
  return salvar('paginas', { ...pagina, blocos });
}
const comLinhas = (...textos: string[]) => comBlocos(textos.map((t) => novoBloco('texto', t)));

function abrir() {
  return render(<Caderno salaId="sala-mba" nomeDaSala="MBA" />);
}

type Regiao = ReturnType<typeof within>;
// Pelo DOM: com o menu aberto o campo vira combobox e sai da busca por textbox.
const linhas = (c: Regiao) => [...(c.getByRole('navigation', { name: 'Páginas do caderno' }).closest('section') as HTMLElement).querySelectorAll<HTMLInputElement>('input.caderno-campo')];
const linha = (c: Regiao, n = 0) => linhas(c)[n];

describe('Caderno: páginas', () => {
  it('sem páginas, convida a criar uma; "Nova página" abre uma com uma linha em branco', async () => {
    abrir();
    const c = await caderno();
    expect(await c.findByText('Nenhuma página ainda.')).toBeTruthy();
    fireEvent.click(c.getByRole('button', { name: 'Nova página' }));
    await waitFor(() => expect(c.getByRole('textbox', { name: 'Título da página' })).toBeTruthy());
    expect((await listar('paginas'))[0]).toMatchObject({ salaId: 'sala-mba', titulo: 'Página 1' });
    expect(linha(c).value).toBe('');
  });

  it('mostra só as páginas da própria sala', async () => {
    await criarPagina('sala-mba', 'Do MBA');
    await criarPagina('sala-casa', 'Da casa');
    abrir();
    const c = await caderno();
    const nav = await c.findByRole('navigation', { name: 'Páginas do caderno' });
    expect(within(nav).getByRole('button', { name: 'Do MBA' })).toBeTruthy();
    expect(within(nav).queryByRole('button', { name: 'Da casa' })).toBeNull();
  });

  it('escrever grava um instante depois', async () => {
    const { id } = await comLinhas('');
    abrir();
    const c = await caderno();
    await waitFor(() => linha(c));
    fireEvent.input(linha(c), { target: { value: 'Pedir a ata ao Prof. Souza' } });
    await waitFor(async () => expect((await paginaGuardada(id)).blocos[0].texto).toBe('Pedir a ata ao Prof. Souza'), { timeout: 3000 });
  });
});

describe('Caderno: menu do "/"', () => {
  async function comPaginaVazia() {
    const pagina = await comLinhas('');
    abrir();
    const c = await caderno();
    await waitFor(() => linha(c));
    return { c, pagina };
  }

  it('"/" abre o menu com os blocos possíveis', async () => {
    const { c } = await comPaginaVazia();
    expect(c.queryByRole('listbox')).toBeNull();
    fireEvent.input(linha(c), { target: { value: '/' } });
    const menu = await c.findByRole('listbox', { name: 'Inserir bloco' });
    expect(within(menu).getAllByRole('option').map((o) => o.querySelector('.bloco-menu-rotulo')?.textContent)).toEqual([
      'Texto', 'Título', 'Lista', 'Agenda', 'Checklist', 'Semana',
    ]);
  });

  it('o que vem depois da barra filtra as opções', async () => {
    const { c } = await comPaginaVazia();
    fireEvent.input(linha(c), { target: { value: '/che' } });
    const menu = await c.findByRole('listbox');
    expect(within(menu).getAllByRole('option')).toHaveLength(1);
    fireEvent.input(linha(c), { target: { value: '/zzz' } });
    expect(await c.findByText('Nada com esse nome.')).toBeTruthy();
  });

  it('escolher Checklist insere o painel, guarda e deixa uma linha nova com o cursor', async () => {
    const { c, pagina } = await comPaginaVazia();
    fireEvent.input(linha(c), { target: { value: '/' } });
    fireEvent.click(await c.findByRole('option', { name: /Checklist/ }));
    expect(await screen.findByRole('region', { name: 'Checklist do dia' })).toBeTruthy();
    expect(c.queryByRole('listbox')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(linha(c)));
    expect(linha(c).value).toBe('');
    await waitFor(
      async () => {
        const { blocos } = await paginaGuardada(pagina.id);
        expect(blocos.map((b) => [b.tipo, b.painel])).toEqual([['painel', 'checklist'], ['texto', undefined]]);
      },
      { timeout: 3000 },
    );
  });

  it('escolher Título troca a linha por um título; Lista, por um item de lista', async () => {
    const { c } = await comPaginaVazia();
    fireEvent.input(linha(c), { target: { value: '/' } });
    fireEvent.click(await c.findByRole('option', { name: /Título/ }));
    await c.findByRole('textbox', { name: 'Título' });
    fireEvent.input(c.getByRole('textbox', { name: 'Título' }), { target: { value: '/lis' } });
    fireEvent.click(await c.findByRole('option', { name: /Lista/ }));
    expect(await c.findByRole('textbox', { name: 'Item da lista' })).toBeTruthy();
  });

  it('setas e Enter escolhem sem o mouse; Escape fecha e mantém o texto', async () => {
    const { c } = await comPaginaVazia();
    fireEvent.input(linha(c), { target: { value: '/' } });
    await c.findByRole('listbox');
    fireEvent.keyDown(linha(c), { key: 'ArrowDown' });
    fireEvent.keyDown(linha(c), { key: 'Enter' });
    await c.findByRole('textbox', { name: 'Título' });
    fireEvent.input(c.getByRole('textbox', { name: 'Título' }), { target: { value: '/' } });
    await c.findByRole('listbox');
    fireEvent.keyDown(c.getByRole('combobox', { name: 'Título' }), { key: 'Escape' });
    expect(c.queryByRole('listbox')).toBeNull();
    expect((c.getByRole('textbox', { name: 'Título' }) as HTMLInputElement).value).toBe('/');
  });

  it('o botão Adicionar bloco faz o mesmo no celular, sem digitar a barra', async () => {
    const { c, pagina } = await comPaginaVazia();
    fireEvent.click(c.getByRole('button', { name: 'Adicionar bloco' }));
    fireEvent.click(await c.findByRole('button', { name: /Semana/ }));
    await waitFor(
      async () => {
        const { blocos } = await paginaGuardada(pagina.id);
        expect(blocos.map((b) => b.tipo)).toEqual(['texto', 'painel', 'texto']);
        expect(blocos[1].painel).toBe('semana');
      },
      { timeout: 3000 },
    );
  });

  it('Enter numa linha abre outra logo abaixo, com o cursor; em lista, continua a lista', async () => {
    const { c } = await comPaginaVazia();
    fireEvent.input(linha(c), { target: { value: '/' } });
    fireEvent.click(await c.findByRole('option', { name: /Lista/ }));
    const item = await c.findByRole('textbox', { name: 'Item da lista' });
    fireEvent.input(item, { target: { value: 'Café' } });
    fireEvent.keyDown(item, { key: 'Enter' });
    await waitFor(() => expect(c.getAllByRole('textbox', { name: 'Item da lista' })).toHaveLength(2));
    await waitFor(() => expect(document.activeElement).toBe(c.getAllByRole('textbox', { name: 'Item da lista' })[1]));
  });
});

describe('Caderno: remover bloco', () => {
  it('remover tira o bloco e oferece Desfazer, que o devolve no mesmo lugar', async () => {
    const { id } = await comLinhas('Primeira', 'Segunda', 'Terceira');
    abrir();
    const c = await caderno();
    await waitFor(() => expect(linhas(c)).toHaveLength(3));
    fireEvent.click(c.getByRole('button', { name: 'Remover bloco: Segunda' }));
    await waitFor(() => expect(linhas(c)).toHaveLength(2));
    await waitFor(async () => expect((await paginaGuardada(id)).blocos.map((b) => b.texto)).toEqual(['Primeira', 'Terceira']));
    expect(await c.findByText('Bloco removido.')).toBeTruthy();

    fireEvent.click(await c.findByRole('button', { name: 'Desfazer' }));
    await waitFor(() => expect(linhas(c)).toHaveLength(3));
    expect(linhas(c).map((i) => i.value)).toEqual(['Primeira', 'Segunda', 'Terceira']);
    expect((await paginaGuardada(id)).blocos.map((b) => b.texto)).toEqual(['Primeira', 'Segunda', 'Terceira']);
  });

  it('remover um painel também tem Desfazer', async () => {
    await comBlocos([novoPainel('checklist'), novoBloco('texto', 'Depois')]);
    abrir();
    const c = await caderno();
    await screen.findByRole('region', { name: 'Checklist do dia' });
    fireEvent.click(c.getByRole('button', { name: 'Remover bloco: Checklist' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Checklist do dia' })).toBeNull());
    fireEvent.click(await c.findByRole('button', { name: 'Desfazer' }));
    expect(await screen.findByRole('region', { name: 'Checklist do dia' })).toBeTruthy();
  });

  it('o texto digitado e ainda não gravado entra antes de remover', async () => {
    const { id } = await comLinhas('Primeira', 'Segunda');
    abrir();
    const c = await caderno();
    await waitFor(() => expect(linhas(c)).toHaveLength(2));
    fireEvent.input(linha(c, 1), { target: { value: 'Segunda, editada' } });
    fireEvent.click(c.getByRole('button', { name: 'Remover bloco: Primeira' }));
    await waitFor(async () => expect((await paginaGuardada(id)).blocos.map((b) => b.texto)).toEqual(['Segunda, editada']));
  });

  it('remover bloco que não existe mais não faz nada', async () => {
    const { id } = await comLinhas('Só esta');
    expect(await removerBloco(id, 'nao-existe')).toBeUndefined();
  });
});

describe('Caderno: linha com data vira item', () => {
  const tarefas = async () => (await listar('tarefas')) as Tarefa[];

  async function escrever(texto: string, saida: 'Enter' | 'blur' = 'Enter') {
    await comLinhas('');
    abrir();
    const c = await caderno();
    await waitFor(() => linha(c));
    const campo = linha(c);
    campo.focus();
    fireEvent.input(campo, { target: { value: texto } });
    if (saida === 'Enter') fireEvent.keyDown(campo, { key: 'Enter' });
    else fireEvent.blur(campo);
    return c;
  }

  it('cria a tarefa pelo interpretar, guarda o itemId no bloco e avisa em texto', async () => {
    const c = await escrever('Revisar parágrafo do relatório amanhã');
    const aviso = await c.findByText(/Virou tarefa/);
    expect(aviso.textContent).toMatch(/Virou tarefa em MBA, para sexta, 6\/11/);
    await waitFor(async () => expect(await tarefas()).toHaveLength(1));
    const [tarefa] = await tarefas();
    expect(tarefa).toMatchObject({ data: '2026-11-06', feito: false });
    expect(tarefa.titulo.toLowerCase()).toContain('revisar parágrafo');
    const [pagina] = await listar('paginas');
    await waitFor(async () => expect((await paginaGuardada(pagina.id)).blocos[0].itemId).toBe(tarefa.id));
  });

  it('a sala do item é a sala da página, mesmo que a frase cite outra', async () => {
    await escrever('Rever tese de doutoramento amanhã');
    await waitFor(async () => expect(await tarefas()).toHaveLength(1));
    expect((await tarefas())[0].salaId).toBe('sala-mba');
  });

  it('sair da linha (sem Enter) também cria', async () => {
    await escrever('Ligar para a Renata amanhã', 'blur');
    await waitFor(async () => expect(await tarefas()).toHaveLength(1));
  });

  it('linha sem data continua só texto', async () => {
    const c = await escrever('Pedir a ata ao Prof. Souza');
    await waitFor(() => expect(linhas(c)).toHaveLength(2));
    await espera();
    expect(await tarefas()).toHaveLength(0);
    expect(c.queryByText(/Virou/)).toBeNull();
  });

  it('não cria duas vezes a mesma linha (Enter e depois sair do campo)', async () => {
    const c = await escrever('Entregar relatório amanhã');
    await c.findByText(/Virou tarefa/);
    fireEvent.blur(linha(c));
    await espera();
    expect(await tarefas()).toHaveLength(1);
  });

  it('Desfazer do aviso apaga a tarefa e solta a linha', async () => {
    const c = await escrever('Entregar relatório amanhã');
    await c.findByText(/Virou tarefa/);
    fireEvent.click(c.getByRole('button', { name: 'Desfazer' }));
    await waitFor(async () => expect(await tarefas()).toHaveLength(0));
    const [pagina] = await listar('paginas');
    await waitFor(async () => expect((await paginaGuardada(pagina.id)).blocos[0].itemId).toBeUndefined());
    await waitFor(() => expect(c.queryByText(/Virou tarefa/)).toBeNull());
  });
});

describe('Caderno: campo em edição e sincronia', () => {
  /** Outro aparelho grava a página, mais nova (o que a sincronia entrega). */
  const doCelular = (pagina: Pagina, blocos: Bloco[], titulo = pagina.titulo) =>
    gravarDoServidor([{ colecao: 'paginas', registro: { ...pagina, titulo, blocos, atualizadoEm: Date.now() + 5000, aparelho: 'celular-fake' } }]);

  it('atualização de outro aparelho não tira foco, texto nem cursor de quem digita', async () => {
    const pagina = await comLinhas('Primeira', 'Segunda');
    abrir();
    const c = await caderno();
    await waitFor(() => expect(linhas(c)).toHaveLength(2));
    const campo = linha(c, 1);
    campo.focus();
    fireEvent.input(campo, { target: { value: 'Segunda, com mais um pouco' } });
    campo.setSelectionRange(9, 9);
    const [primeira, segunda] = pagina.blocos;

    await act(async () => {
      await doCelular(await paginaGuardada(pagina.id), [
        { ...primeira, texto: 'Primeira, vinda do celular' },
        { ...segunda, texto: 'Segunda do celular' },
        novoBloco('texto', 'Terceira do celular'),
      ]);
    });
    await espera();

    // Mesmo elemento, mesmo foco, mesmo texto, mesmo cursor.
    expect(linha(c, 1)).toBe(campo);
    expect(campo.isConnected).toBe(true);
    expect(document.activeElement).toBe(campo);
    expect(campo.value).toBe('Segunda, com mais um pouco');
    expect(campo.selectionStart).toBe(9);
  });

  it('com o campo em foco e nada digitado, a versão do celular espera o dono sair do campo', async () => {
    const pagina = await comLinhas('Anotação');
    abrir();
    const c = await caderno();
    await waitFor(() => linha(c));
    const campo = linha(c);
    campo.focus();
    await act(async () => {
      await doCelular(await paginaGuardada(pagina.id), [{ ...pagina.blocos[0], texto: 'Anotação do celular' }]);
    });
    await espera();
    expect(document.activeElement).toBe(campo);
    expect(campo.value).toBe('Anotação');
    fireEvent.blur(campo);
    await waitFor(() => expect(linha(c).value).toBe('Anotação do celular'));
  });

  it('com o campo fora de uso, a versão do celular aparece', async () => {
    const pagina = await comLinhas('Anotação');
    abrir();
    const c = await caderno();
    await waitFor(() => expect(linha(c).value).toBe('Anotação'));
    await act(async () => {
      await doCelular(await paginaGuardada(pagina.id), [{ ...pagina.blocos[0], texto: 'Anotação do celular' }, novoBloco('lista', 'Item novo')]);
    });
    await waitFor(() => expect(linha(c).value).toBe('Anotação do celular'));
    expect(c.getByRole('textbox', { name: 'Item da lista' })).toBeTruthy();
  });

  it('o título da página também não é redesenhado em edição', async () => {
    const pagina = await comLinhas('x');
    abrir();
    const c = await caderno();
    const titulo = (await c.findByRole('textbox', { name: 'Título da página' })) as HTMLInputElement;
    titulo.focus();
    fireEvent.input(titulo, { target: { value: 'Reunião do grupo, nova' } });
    await act(async () => {
      await doCelular(await paginaGuardada(pagina.id), pagina.blocos, 'Título do celular');
    });
    await espera();
    expect(c.getByRole('textbox', { name: 'Título da página' })).toBe(titulo);
    expect(document.activeElement).toBe(titulo);
    expect(titulo.value).toBe('Reunião do grupo, nova');
  });
});

describe('Caderno: na página da sala', () => {
  it('aparece na sala certa, com o nome dela nos textos', async () => {
    await scriptDeTeste();
    Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true, writable: true });
    history.replaceState(null, '', '/#/sala/sala-aulas');
    render(<App />);
    const main = within(document.querySelector('main') as HTMLElement);
    const regiao = within(await main.findByRole('region', { name: 'Caderno' }));
    expect(await regiao.findByText(/Crie uma página para anotar o que for de Aulas/)).toBeTruthy();
  });
});

describe('Caderno: toque mínimo de 44 px', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/ui/salas.css'), 'utf8');
  it.each(['.caderno-campo', '.caderno-remover', '.caderno-aba', '.bloco-menu-opcao', '.caderno-adicionar', '.caderno-nova'])(
    '%s tem altura mínima do toque',
    (seletor) => {
      const regras = css
        .split('}')
        .filter((parte) => parte.split('{')[0].split(',').map((s) => s.trim()).includes(seletor))
        .map((parte) => parte.split('{')[1] ?? '')
        .join(';');
      expect(regras).toMatch(/(min-)?height:\s*var\(--toque\)/);
    },
  );
});
