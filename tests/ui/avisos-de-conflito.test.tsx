import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { gravarDoServidor, listar, listarAvisos, listarPendentes, salvar, semear } from '../../src/dados/loja';
import { AvisosDeConflito } from '../../src/ui/AvisosDeConflito';
import { tarefa } from '../apoio/tarefas';

// Quinta-feira, 2026-11-05, 12:20 (Europe/Lisbon). Só a data é falsa.
const AGORA = Date.parse('2026-11-05T12:20:00Z');
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AGORA);
  await semear();
});

/** O outro aparelho mudou o título depois; esta cópia (pendente, mais velha) perde e vira aviso. */
async function conflito(titulo: string, titulo_remoto: string, quando = 60_000) {
  const local = await salvar('tarefas', tarefa(titulo));
  await gravarDoServidor([
    { colecao: 'tarefas', registro: { ...local, titulo: titulo_remoto, atualizadoEm: AGORA + quando, aparelho: 'celular' } },
  ]);
  return local;
}

describe('aviso de conflito no Painel', () => {
  it('sem conflito, não mostra nada', async () => {
    const { container } = render(<AvisosDeConflito />);
    await new Promise((r) => setTimeout(r, 30));
    expect(container.textContent).toBe('');
  });

  it('mostra uma linha por conflito, com o título da versão que foi substituída', async () => {
    await conflito('Rever capítulo 3', 'Rever capítulo 4');
    render(<AvisosDeConflito />);
    expect(await screen.findByText('Duas mudanças na mesma tarefa; ficou a mais recente. A outra era: Rever capítulo 3')).toBeTruthy();
  });

  it('Entendi tira o aviso da tela e do armazenamento', async () => {
    await conflito('Rever capítulo 3', 'Rever capítulo 4');
    render(<AvisosDeConflito />);
    const botao = await screen.findByRole('button', { name: /^Entendi/ });
    expect(botao.getAttribute('aria-label')).toBe('Entendi: Rever capítulo 3');
    fireEvent.click(botao);
    await waitFor(() => expect(screen.queryByText(/A outra era/)).toBeNull());
    expect(await listarAvisos()).toEqual([]);
  });

  it('aparece sem recarregar quando o conflito chega com a tela aberta', async () => {
    render(<AvisosDeConflito />);
    await new Promise((r) => setTimeout(r, 30));
    await conflito('Comprar café', 'Comprar café e pão');
    expect(await screen.findByText(/A outra era: Comprar café$/)).toBeTruthy();
  });

  it('pessoa também: mostra o nome', async () => {
    const local = await salvar('pessoas', { nome: 'Marina', salaId: 'sala-orientacoes' });
    await gravarDoServidor([
      { colecao: 'pessoas', registro: { ...local, salaId: 'sala-aulas', atualizadoEm: AGORA + 60_000, aparelho: 'celular' } },
    ]);
    render(<AvisosDeConflito />);
    expect(await screen.findByText('Duas mudanças na mesma pessoa; ficou a mais recente. A outra era: Marina')).toBeTruthy();
  });

  it('muitos conflitos: mostra 3 e diz quantos faltam, no plural certo', async () => {
    for (let i = 1; i <= 4; i++) await conflito(`Tarefa ${i}`, `Tarefa ${i} nova`, i * 1000);
    render(<AvisosDeConflito />);
    await screen.findAllByText(/A outra era: Tarefa/);
    expect(screen.getAllByRole('button', { name: /^Entendi/ })).toHaveLength(3);
    expect(screen.getByText('Mais 1 aviso como este.')).toBeTruthy();

    await conflito('Tarefa 5', 'Tarefa 5 nova', 6000);
    await waitFor(() => expect(screen.getByText('Mais 2 avisos como este.')).toBeTruthy());
  });

  it('o aviso fica numa região viva e é texto puro (nada de HTML do título)', async () => {
    await conflito('<img src=x onerror=alert(1)>', 'Outro');
    const { container } = render(<AvisosDeConflito />);
    await screen.findByText(/A outra era/);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('region', { name: 'Avisos de mudanças' })).toBeTruthy();
  });
});

describe('Ver e Recuperar a versão que perdeu (C-03)', () => {
  /** Notas da Marina editadas nos dois aparelhos: o outro venceu, o texto local só existe no aviso. */
  async function conflitoDeNotas() {
    const local = await salvar('pessoas', { nome: 'Marina', salaId: 'sala-orientacoes', notas: 'Combinar com a Renata a revisão do capítulo 2' });
    await gravarDoServidor([
      { colecao: 'pessoas', registro: { ...local, notas: 'Falar com o Prof. Souza', atualizadoEm: AGORA + 60_000, aparelho: 'celular' } },
    ]);
    return local;
  }

  it('Ver mostra o conteúdo da versão que perdeu, e só depois de clicar', async () => {
    await conflitoDeNotas();
    render(<AvisosDeConflito />);
    const ver = await screen.findByRole('button', { name: /^Ver/ });
    expect(screen.queryByText(/Combinar com a Renata/)).toBeNull();
    fireEvent.click(ver);
    expect(await screen.findByText(/Combinar com a Renata a revisão do capítulo 2/)).toBeTruthy();
    // A versão que ficou não é a mostrada como perdida.
    expect(screen.queryByText(/Falar com o Prof. Souza/)).toBeNull();
  });

  it('os botões vêm antes do Entendi', async () => {
    await conflitoDeNotas();
    render(<AvisosDeConflito />);
    const nomes = (await screen.findAllByRole('button')).map((b) => b.textContent);
    expect(nomes).toEqual(['Ver', 'Recuperar', 'Entendi']);
  });

  it('Ver de uma tarefa mostra o título da versão perdida', async () => {
    await conflito('Rever capítulo 3', 'Rever capítulo 4');
    render(<AvisosDeConflito />);
    fireEvent.click(await screen.findByRole('button', { name: /^Ver/ }));
    expect(await screen.findByText('Título: Rever capítulo 3')).toBeTruthy();
  });

  it('Recuperar regrava a versão perdida, o aviso some e ela vai para a fila', async () => {
    await conflitoDeNotas();
    render(<AvisosDeConflito />);
    fireEvent.click(await screen.findByRole('button', { name: /^Recuperar/ }));
    await waitFor(() => expect(screen.queryByText(/A outra era/)).toBeNull());
    expect(await listarAvisos()).toEqual([]);
    const [marina] = await listar('pessoas');
    expect(marina.notas).toBe('Combinar com a Renata a revisão do capítulo 2');
    expect((await listarPendentes()).some((p) => p.tipo === 'registro' && p.colecao === 'pessoas')).toBe(true);
  });

  it('se a recuperação falha, mostra a mensagem e o aviso continua', async () => {
    await conflitoDeNotas();
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const original = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore) {
      throw new Error('disco cheio');
    });
    render(<AvisosDeConflito />);
    fireEvent.click(await screen.findByRole('button', { name: /^Recuperar/ }));
    expect(await screen.findByText('Não consegui recuperar. Tente de novo.')).toBeTruthy();
    vi.mocked(IDBObjectStore.prototype.put).mockRestore();
    expect(IDBObjectStore.prototype.put).toBe(original);
    erro.mockRestore();
    expect(await listarAvisos()).toHaveLength(1);
    expect(screen.getByText(/A outra era/)).toBeTruthy();
  });
});

describe('no Painel do dia', () => {
  it('o aviso aparece acima da checklist', async () => {
    await conflito('Rever capítulo 3', 'Rever capítulo 4');
    Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true, writable: true });
    history.replaceState(null, '', '/#/');
    render(<App />);
    const principal = within(document.querySelector('main') as HTMLElement);
    const aviso = await principal.findByText(/A outra era: Rever capítulo 3/);
    const checklist = principal.getByRole('heading', { name: 'Checklist do dia' });
    expect(aviso.compareDocumentPosition(checklist) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await act(async () => {});
  });
});
