import { fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listar } from '../../src/dados/loja';
import type { Tarefa } from '../../src/dados/tipos';
import { Checklist } from '../../src/ui/Checklist';
import { DuracaoTarefa } from '../../src/ui/DuracaoTarefa';
import { criar } from '../apoio/tarefas';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 5, 12, 20));
});

const botaoDaDuracao = () => screen.getByRole('button', { name: /^Duração/ });

describe('DuracaoTarefa', () => {
  it('a tarefa nova tem 60 min e a tela diz "cerca de 1 h" até confirmar', async () => {
    const t = (await criar('Rever capítulo')) as Tarefa;
    expect(t.duracaoMin).toBe(60);
    expect(t.duracaoConfirmada).toBe(false);
    render(<DuracaoTarefa tarefa={t} />);
    expect(botaoDaDuracao().textContent).toBe('cerca de 1 h');
  });

  it('abre as opções, avisa o estado ao leitor de tela e fecha de novo', async () => {
    const t = (await criar('Rever capítulo')) as Tarefa;
    render(<DuracaoTarefa tarefa={t} />);
    expect(botaoDaDuracao().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('group', { name: 'Duração da tarefa' })).toBeNull();

    fireEvent.click(botaoDaDuracao());
    expect(botaoDaDuracao().getAttribute('aria-expanded')).toBe('true');
    const opcoes = within(screen.getByRole('group', { name: 'Duração da tarefa' }));
    expect(opcoes.getAllByRole('button').map((b) => b.textContent)).toEqual([
      '15 min',
      '30 min',
      '45 min',
      '1 h',
      '1 h 30',
      '2 h',
      '3 h',
      '4 h',
    ]);
    expect(screen.getByText('Quanto tempo leva?')).toBeTruthy();

    fireEvent.click(botaoDaDuracao());
    expect(screen.queryByRole('group', { name: 'Duração da tarefa' })).toBeNull();
  });

  it('tocar em 1 h confirma o padrão', async () => {
    const t = (await criar('Rever capítulo')) as Tarefa;
    render(<DuracaoTarefa tarefa={t} />);
    fireEvent.click(botaoDaDuracao());
    fireEvent.click(screen.getByRole('button', { name: '1 h' }));
    await waitFor(async () => expect((await listar('tarefas'))[0]).toMatchObject({ duracaoMin: 60, duracaoConfirmada: true }));
    expect(screen.queryByRole('group', { name: 'Duração da tarefa' })).toBeNull();
  });

  it('tocar em 30 min muda e confirma; o foco volta para o botão da duração', async () => {
    const t = (await criar('Rever capítulo')) as Tarefa;
    render(<DuracaoTarefa tarefa={t} />);
    fireEvent.click(botaoDaDuracao());
    fireEvent.click(screen.getByRole('button', { name: '30 min' }));
    await waitFor(async () => expect((await listar('tarefas'))[0]).toMatchObject({ duracaoMin: 30, duracaoConfirmada: true }));
    await waitFor(() => expect(document.activeElement).toBe(botaoDaDuracao()));
  });

  it('a opção atual aparece marcada só quando confirmada', async () => {
    const aberta = (await criar('Aberta')) as Tarefa;
    const { unmount } = render(<DuracaoTarefa tarefa={aberta} />);
    fireEvent.click(botaoDaDuracao());
    expect(screen.getByRole('button', { name: '1 h' }).getAttribute('aria-pressed')).toBe('false');
    unmount();

    const confirmada = (await criar('Confirmada', { duracaoMin: 90, duracaoConfirmada: true })) as Tarefa;
    render(<DuracaoTarefa tarefa={confirmada} />);
    expect(botaoDaDuracao().textContent).toBe('1 h 30');
    fireEvent.click(botaoDaDuracao());
    expect(screen.getByRole('button', { name: '1 h 30' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '1 h' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('Esc fecha as opções e devolve o foco', async () => {
    const t = (await criar('Rever capítulo')) as Tarefa;
    render(<DuracaoTarefa tarefa={t} />);
    fireEvent.click(botaoDaDuracao());
    fireEvent.keyDown(screen.getByRole('group', { name: 'Duração da tarefa' }), { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'Duração da tarefa' })).toBeNull();
    expect(document.activeElement).toBe(botaoDaDuracao());
  });

  it('o rótulo acompanha a tarefa: confirmada em outro aparelho, deixa de dizer "cerca de"', async () => {
    const t = (await criar('Rever capítulo', { data: '2026-11-05' })) as Tarefa;
    render(<Checklist />);
    expect(await screen.findByRole('button', { name: 'Duração: cerca de 1 h' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Duração: cerca de 1 h' }));
    fireEvent.click(screen.getByRole('button', { name: '2 h' }));
    expect(await screen.findByRole('button', { name: 'Duração: 2 h' })).toBeTruthy();
    expect(t.duracaoConfirmada).toBe(false);
  });

  it('abrir as opções não é desfeito por uma atualização de outra tarefa', async () => {
    await criar('Primeira', { data: '2026-11-05' });
    render(<Checklist />);
    const [botao] = await screen.findAllByRole('button', { name: /^Duração/ });
    fireEvent.click(botao);
    await criar('Chegou agora', { data: '2026-11-05' });
    await screen.findByRole('checkbox', { name: 'Chegou agora' });
    expect(screen.getByRole('group', { name: 'Duração da tarefa' })).toBeTruthy();
  });
});
