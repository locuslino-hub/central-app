// Tarefa 19, correções da revisão: corridas de gravação, remover, compromisso, acessibilidade.
// Nomes fictícios (Marina, Renata, Prof. Souza, Aurora).
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { limparConversa } from '../../src/chat/conversa';
import { criarPagina, gravarBlocos, novoBloco, removerBloco, renomearPagina } from '../../src/dados/caderno';
import { lerRegistros, listar, listarPendentes, salvar, semear, semearPalavras } from '../../src/dados/loja';
import type { Bloco, Pagina } from '../../src/dados/tipos';
import { Caderno } from '../../src/ui/Caderno';
import { scriptDeTeste } from '../apoio/script-ui';

// Segura a criação do item quando o teste pede (corrida: linha removida enquanto o item nasce).
const porta = vi.hoisted(() => ({ espera: null as Promise<void> | null }));
vi.mock('../../src/chat/interpretar', async (original) => {
  const real = await original<typeof import('../../src/chat/interpretar')>();
  return {
    ...real,
    criarItem: (async (item: never) => {
      if (porta.espera) await porta.espera;
      return real.criarItem(item);
    }) as typeof real.criarItem,
  };
});

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
async function comBlocos(blocos: Bloco[]) {
  const pagina = await criarPagina('sala-mba', 'Reunião do grupo');
  return salvar('paginas', { ...pagina, blocos });
}
const comLinhas = (...textos: string[]) => comBlocos(textos.map((t) => novoBloco('texto', t)));
const abrir = () => render(<Caderno salaId="sala-mba" nomeDaSala="MBA" />);
type Regiao = ReturnType<typeof within>;
const linhas = (c: Regiao) =>
  [...(c.getByRole('navigation', { name: 'Páginas do caderno' }).closest('section') as HTMLElement).querySelectorAll<HTMLInputElement>('input.caderno-campo')];
const linha = (c: Regiao, n = 0) => linhas(c)[n];

describe('M1: uma fila de gravação por página', () => {
  it('título e corpo gravados ao mesmo tempo: nada se perde', async () => {
    const pagina = await comLinhas('antigo');
    await Promise.all([gravarBlocos(pagina.id, [novoBloco('texto', 'corpo novo')]), renomearPagina(pagina.id, 'Título novo')]);
    const salva = await paginaGuardada(pagina.id);
    expect(salva.titulo).toBe('Título novo');
    expect(salva.blocos.map((b) => b.texto)).toEqual(['corpo novo']);
  });

  it('título perde o foco com o corpo ainda por gravar (tela): os dois chegam', async () => {
    const pagina = await comLinhas('x');
    abrir();
    const c = await caderno();
    await waitFor(() => linha(c));
    const titulo = c.getByRole('textbox', { name: 'Título da página' }) as HTMLInputElement;
    fireEvent.input(linha(c), { target: { value: 'corpo digitado' } });
    fireEvent.input(titulo, { target: { value: 'Título digitado' } });
    fireEvent.blur(titulo);
    await waitFor(
      async () => {
        const s = await paginaGuardada(pagina.id);
        expect([s.titulo, s.blocos[0].texto]).toEqual(['Título digitado', 'corpo digitado']);
      },
      { timeout: 3000 },
    );
  });
});

describe('M2: remover vale na tela na hora', () => {
  it('remover e digitar logo depois não traz o bloco de volta', async () => {
    const { id } = await comLinhas('Primeira', 'Segunda');
    abrir();
    const c = await caderno();
    await waitFor(() => expect(linhas(c)).toHaveLength(2));
    fireEvent.click(c.getByRole('button', { name: 'Remover bloco: Primeira' }));
    expect(linhas(c)).toHaveLength(1);
    fireEvent.input(linha(c, 0), { target: { value: 'Segunda, editada' } });
    await espera(700);
    expect(linhas(c).map((i) => i.value)).toEqual(['Segunda, editada']);
    await waitFor(async () => expect((await paginaGuardada(id)).blocos.map((b) => b.texto)).toEqual(['Segunda, editada']));
  });

  it('o Desfazer continua devolvendo o bloco', async () => {
    const { id } = await comLinhas('Primeira', 'Segunda');
    abrir();
    const c = await caderno();
    await waitFor(() => expect(linhas(c)).toHaveLength(2));
    fireEvent.click(c.getByRole('button', { name: 'Remover bloco: Primeira' }));
    fireEvent.click(await c.findByRole('button', { name: 'Desfazer' }));
    await waitFor(() => expect(linhas(c).map((i) => i.value)).toEqual(['Primeira', 'Segunda']));
    await waitFor(async () => expect((await paginaGuardada(id)).blocos.map((b) => b.texto)).toEqual(['Primeira', 'Segunda']));
  });
});

describe('B1, B2, B4, B6', () => {
  it('B1: com o menu aberto o campo é um combobox ligado à lista', async () => {
    await comLinhas('');
    abrir();
    const c = await caderno();
    await waitFor(() => linha(c));
    fireEvent.input(linha(c), { target: { value: '/' } });
    const combo = await c.findByRole('combobox');
    expect(combo.getAttribute('aria-expanded')).toBe('true');
    expect(combo.getAttribute('aria-haspopup')).toBe('listbox');
  });

  it('B2: sair da página, esconder o app e desmontar gravam sem esperar o atraso', async () => {
    const { id } = await comLinhas('');
    abrir();
    const c = await caderno();
    await waitFor(() => linha(c));
    fireEvent.input(linha(c), { target: { value: 'por pagehide' } });
    window.dispatchEvent(new Event('pagehide'));
    await waitFor(async () => expect((await paginaGuardada(id)).blocos[0].texto).toBe('por pagehide'), { timeout: 250 });
    fireEvent.input(linha(c), { target: { value: 'por visibilidade' } });
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(async () => expect((await paginaGuardada(id)).blocos[0].texto).toBe('por visibilidade'), { timeout: 250 });
    fireEvent.input(linha(c), { target: { value: 'ao desmontar' } });
    cleanup();
    await waitFor(async () => expect((await paginaGuardada(id)).blocos[0].texto).toBe('ao desmontar'), { timeout: 250 });
  });

  it('B2: o atraso de gravar é curto', async () => {
    const { ATRASO_DO_CADERNO_MS } = await import('../../src/ui/Caderno');
    expect(ATRASO_DO_CADERNO_MS).toBeLessThanOrEqual(300);
  });

  it('B4: Desfazer reinsere depois do bloco que vinha antes, não por posição', async () => {
    const { id, blocos } = await comLinhas('a', 'b', 'c');
    const entrada = await removerBloco(id, blocos[1].id);
    await gravarBlocos(id, [novoBloco('texto', 'x'), ...(await paginaGuardada(id)).blocos]);
    await entrada!.reverter();
    expect((await paginaGuardada(id)).blocos.map((b) => b.texto)).toEqual(['x', 'a', 'b', 'c']);
  });

  it('B6: as abas ordenam números como números', async () => {
    await criarPagina('sala-mba', 'Página 10');
    await criarPagina('sala-mba', 'Página 2');
    abrir();
    const c = await caderno();
    const nav = await c.findByRole('navigation', { name: 'Páginas do caderno' });
    await waitFor(() => expect(within(nav).getAllByRole('button').map((b) => b.textContent)).toEqual(['Página 2', 'Página 10']));
  });
});

describe('compromisso (B3) e corrida com a remoção', () => {
  const FRASE = 'Reunião sobre o projeto na sexta-feira com início às 11:00 e término 12:00';
  async function campo() {
    await comLinhas('');
    await scriptDeTeste();
    abrir();
    const c = await caderno();
    await waitFor(() => linha(c));
    linha(c).focus();
    fireEvent.input(linha(c), { target: { value: FRASE } });
    return c;
  }
  const agenda = async () => (await listarPendentes()).filter((p) => p.tipo === 'agenda');

  it('Enter: a linha vira compromisso no Google Agenda e guarda o id do evento', async () => {
    const c = await campo();
    fireEvent.keyDown(linha(c), { key: 'Enter' });
    expect(await c.findByText(/Virou compromisso no Google Agenda: sexta, 6\/11, às 11:00/)).toBeTruthy();
    expect((await listar('tarefas')).filter((t) => !t.apagado)).toHaveLength(0);
    const [pagina] = await listar('paginas');
    await waitFor(async () => expect((await paginaGuardada(pagina.id)).blocos[0].itemId).toBeTruthy());
  });

  it('B3: sair do campo não cria compromisso; Enter depois cria', async () => {
    const c = await campo();
    fireEvent.blur(linha(c));
    await espera();
    expect(await agenda()).toHaveLength(0);
    expect(c.queryByText(/Virou/)).toBeNull();
    fireEvent.keyDown(linha(c), { key: 'Enter' });
    await c.findByText(/Virou compromisso/);
  });

  it('linha removida enquanto o item nasce não deixa item solto', async () => {
    let soltar!: () => void;
    porta.espera = new Promise<void>((r) => (soltar = r));
    try {
      await comLinhas('');
      abrir();
      const c = await caderno();
      await waitFor(() => linha(c));
      linha(c).focus();
      fireEvent.input(linha(c), { target: { value: 'Entregar relatório amanhã' } });
      fireEvent.keyDown(linha(c), { key: 'Enter' });
      await espera();
      fireEvent.click(c.getByRole('button', { name: 'Remover bloco: Entregar relatório amanhã' }));
      await espera(200);
    } finally {
      soltar();
      porta.espera = null;
    }
    await espera(400);
    expect((await listar('tarefas')).filter((t) => !t.apagado)).toHaveLength(0);
  });
});
