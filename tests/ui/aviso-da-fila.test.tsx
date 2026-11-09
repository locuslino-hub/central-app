import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { criarCompromisso } from '../../src/dados/compromisso';
import { listarPendentes, registrarTentativa, semear, TENTATIVAS_NO_MAXIMO } from '../../src/dados/loja';
import { AvisoDaFila } from '../../src/ui/AvisoDaFila';
import { agendaEscrita } from '../apoio/agenda-escrita';

// Quinta-feira, 2026-11-05, 12:20 (Europe/Lisbon). Só a data é falsa.
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 5, 12, 20));
  await semear();
});

const novo = { titulo: 'Banca', data: '2026-11-06', inicio: '11:00', fim: '12:00', salaId: null };

async function esgotar() {
  const agenda = agendaEscrita();
  await agenda.instalar();
  agenda.modo('recusar');
  await criarCompromisso(novo);
  const [{ seq }] = await listarPendentes();
  for (let i = 0; i < TENTATIVAS_NO_MAXIMO; i++) await registrarTentativa(seq);
  return agenda;
}

describe('aviso da fila da agenda', () => {
  it('sem nada parado, não mostra nada', async () => {
    const agenda = agendaEscrita();
    await agenda.instalar();
    agenda.modo('recusar');
    await criarCompromisso(novo);
    const { container } = render(<AvisoDaFila />);
    await new Promise((r) => setTimeout(r, 30));
    expect(container.textContent).toBe('');
  });

  it('com o pedido parado, diz que o compromisso não entrou na agenda e guarda o pedido', async () => {
    await esgotar();
    render(<AvisoDaFila />);

    expect(await screen.findByText('1 compromisso não entrou na agenda.')).toBeTruthy();
    expect(await listarPendentes()).toHaveLength(1);
  });

  it('Tentar de novo libera o pedido e envia', async () => {
    const agenda = await esgotar();
    agenda.modo('ok');
    render(<AvisoDaFila />);

    fireEvent.click(await screen.findByRole('button', { name: 'Tentar de novo' }));

    await waitFor(() => expect(agenda.eventos.size).toBe(1));
    await waitFor(() => expect(screen.queryByText('1 compromisso não entrou na agenda.')).toBeNull());
    expect(await listarPendentes()).toEqual([]);
  });

  it('Descartar tira o pedido da fila, só quando o dono pede', async () => {
    await esgotar();
    render(<AvisoDaFila />);

    fireEvent.click(await screen.findByRole('button', { name: 'Descartar' }));

    await waitFor(() => expect(screen.queryByText('1 compromisso não entrou na agenda.')).toBeNull());
    expect(await listarPendentes()).toEqual([]);
  });
});

describe('aviso da fila: espelho no Google parado', () => {
  it('tarefas e "✓ " que não chegaram ao Google aparecem; Descartar não mexe nas tarefas', async () => {
    const { criarTarefa } = await import('../../src/dados/tarefas');
    const { enfileirarMarcaDeFeito, listar } = await import('../../src/dados/loja');
    const tarefa = (await criarTarefa('Ligar para a Aurora', { data: '2026-11-05' }))!;
    await criarTarefa('Revisar parágrafo');
    await enfileirarMarcaDeFeito('meu1', true);
    for (const p of await listarPendentes()) if (p.tipo === 'espelho') {
      for (let i = 0; i < TENTATIVAS_NO_MAXIMO; i++) await registrarTentativa(p.seq);
    }
    render(<AvisoDaFila />);

    expect(await screen.findByText('2 tarefas não chegaram ao Google Tarefas.')).toBeTruthy();
    expect(screen.getByText('1 compromisso feito não foi marcado no Google Agenda.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }));
    await waitFor(() => expect(screen.queryByText('2 tarefas não chegaram ao Google Tarefas.')).toBeNull());
    expect((await listarPendentes()).filter((p) => p.tipo === 'espelho')).toEqual([]);
    expect((await listar('tarefas')).map((t) => t.id)).toContain(tarefa.id);
  });
});
