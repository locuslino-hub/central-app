import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { gravarDoServidor, listarAvisos, salvar, semear } from '../../src/dados/loja';
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
    expect(await screen.findByText('Uma mudança feita em outro aparelho substituiu esta: Rever capítulo 3')).toBeTruthy();
  });

  it('Entendi tira o aviso da tela e do armazenamento', async () => {
    await conflito('Rever capítulo 3', 'Rever capítulo 4');
    render(<AvisosDeConflito />);
    const botao = await screen.findByRole('button', { name: /^Entendi/ });
    expect(botao.getAttribute('aria-label')).toBe('Entendi: Rever capítulo 3');
    fireEvent.click(botao);
    await waitFor(() => expect(screen.queryByText(/substituiu esta/)).toBeNull());
    expect(await listarAvisos()).toEqual([]);
  });

  it('aparece sem recarregar quando o conflito chega com a tela aberta', async () => {
    render(<AvisosDeConflito />);
    await new Promise((r) => setTimeout(r, 30));
    await conflito('Comprar café', 'Comprar café e pão');
    expect(await screen.findByText(/substituiu esta: Comprar café$/)).toBeTruthy();
  });

  it('pessoa também: mostra o nome', async () => {
    const local = await salvar('pessoas', { nome: 'Marina', salaId: 'sala-orientacoes' });
    await gravarDoServidor([
      { colecao: 'pessoas', registro: { ...local, salaId: 'sala-aulas', atualizadoEm: AGORA + 60_000, aparelho: 'celular' } },
    ]);
    render(<AvisosDeConflito />);
    expect(await screen.findByText('Uma mudança feita em outro aparelho substituiu esta: Marina')).toBeTruthy();
  });

  it('muitos conflitos: mostra 3 e diz quantos faltam, no plural certo', async () => {
    for (let i = 1; i <= 4; i++) await conflito(`Tarefa ${i}`, `Tarefa ${i} nova`, i * 1000);
    render(<AvisosDeConflito />);
    await screen.findAllByText(/substituiu esta: Tarefa/);
    expect(screen.getAllByRole('button', { name: /^Entendi/ })).toHaveLength(3);
    expect(screen.getByText('Mais 1 aviso como este.')).toBeTruthy();

    await conflito('Tarefa 5', 'Tarefa 5 nova', 6000);
    await waitFor(() => expect(screen.getByText('Mais 2 avisos como este.')).toBeTruthy());
  });

  it('o aviso fica numa região viva e é texto puro (nada de HTML do título)', async () => {
    await conflito('<img src=x onerror=alert(1)>', 'Outro');
    const { container } = render(<AvisosDeConflito />);
    await screen.findByText(/substituiu esta/);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('region', { name: 'Avisos de mudanças' })).toBeTruthy();
  });
});

describe('no Painel do dia', () => {
  it('o aviso aparece acima da checklist', async () => {
    await conflito('Rever capítulo 3', 'Rever capítulo 4');
    Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true, writable: true });
    history.replaceState(null, '', '/#/');
    render(<App />);
    const principal = within(document.querySelector('main') as HTMLElement);
    const aviso = await principal.findByText(/substituiu esta: Rever capítulo 3/);
    const checklist = principal.getByRole('heading', { name: 'Checklist do dia' });
    expect(aviso.compareDocumentPosition(checklist) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await act(async () => {});
  });
});
