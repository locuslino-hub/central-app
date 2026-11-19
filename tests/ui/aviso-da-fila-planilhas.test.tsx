// Aviso da fila: linhas de planilha que a sincronia desistiu de enviar (V02, Tarefa 10).
import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enfileirarPlanilha, INTERVALO_ENTRE_TENTATIVAS_MS, listarPendentes, registrarTentativa, TENTATIVAS_NO_MAXIMO } from '../../src/dados/loja';
import { AvisoDaFila } from '../../src/ui/AvisoDaFila';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 5, 12, 20));
});

async function recusarAte(...seqs: number[]) {
  for (let i = 0; i < TENTATIVAS_NO_MAXIMO; i++) {
    for (const seq of seqs) await registrarTentativa(seq);
    vi.setSystemTime(Date.now() + INTERVALO_ENTRE_TENTATIVAS_MS);
  }
}

const anexo = (idDaLinha: string) =>
  enfileirarPlanilha({ tipo: 'planilha', acao: 'anexar', planilhaId: 'planilha-teste-1', idDaLinha, valores: { Item: 'Leite' } });

describe('aviso da fila: planilhas', () => {
  it('sem entrada parada, não mostra nada', async () => {
    await anexo('linha-1');
    const { container } = render(<AvisoDaFila />);
    await new Promise((r) => setTimeout(r, 30));
    expect(container.textContent).toBe('');
  });

  it('linha de planilha parada aparece, no singular e no plural, e fica guardada', async () => {
    const a = await anexo('linha-1');
    await recusarAte(a);
    const { unmount } = render(<AvisoDaFila />);
    expect(await screen.findByText('1 linha de planilha não chegou à planilha.')).toBeTruthy();
    unmount();

    const b = await anexo('linha-2');
    await recusarAte(b);
    render(<AvisoDaFila />);
    expect(await screen.findByText('2 linhas de planilha não chegaram à planilha.')).toBeTruthy();
    expect(await listarPendentes()).toHaveLength(2);
  });

  it('Tentar de novo devolve a entrada à fila, Descartar a tira', async () => {
    const a = await anexo('linha-1');
    await recusarAte(a);
    const primeira = render(<AvisoDaFila />);
    fireEvent.click(await screen.findByRole('button', { name: 'Tentar de novo' }));
    await waitFor(() => expect(screen.queryByText('1 linha de planilha não chegou à planilha.')).toBeNull());
    expect(await listarPendentes()).toHaveLength(1);
    primeira.unmount();

    await recusarAte(a);
    render(<AvisoDaFila />);
    fireEvent.click(await screen.findByRole('button', { name: 'Descartar' }));
    await waitFor(() => expect(screen.queryByText('1 linha de planilha não chegou à planilha.')).toBeNull());
    expect(await listarPendentes()).toEqual([]);
  });
});

describe('aviso da fila: planilha que mudou em outro lugar', () => {
  const mudanca = (idDaLinha: string, conflito: boolean) =>
    enfileirarPlanilha({ tipo: 'planilha', acao: 'atualizar', planilhaId: 'planilha-teste-1', idDaLinha, valores: { Quantidade: '3' }, antes: { Quantidade: '2' }, ...(conflito ? { conflito: true } : {}) });

  it('mostra mensagem própria, no singular e no plural, separada das outras', async () => {
    const a = await mudanca('linha-1', true);
    await recusarAte(a);
    const { unmount } = render(<AvisoDaFila />);
    expect(await screen.findByText('1 alteração não foi gravada porque a linha mudou em outro lugar. Tentar de novo grava a sua por cima.')).toBeTruthy();
    expect(screen.queryByText(/não chegou à planilha/)).toBeNull();
    unmount();

    const b = await mudanca('linha-2', true);
    const c = await anexo('linha-3');
    await recusarAte(b, c);
    render(<AvisoDaFila />);
    expect(await screen.findByText('2 alterações não foram gravadas porque as linhas mudaram em outro lugar. Tentar de novo grava as suas por cima.')).toBeTruthy();
    expect(screen.getByText('1 linha de planilha não chegou à planilha.')).toBeTruthy();
  });

  it('Tentar de novo tira o antes da entrada em conflito', async () => {
    const a = await mudanca('linha-1', true);
    await recusarAte(a);
    render(<AvisoDaFila />);
    fireEvent.click(await screen.findByRole('button', { name: 'Tentar de novo' }));
    await waitFor(async () => expect(await listarPendentes()).toEqual([expect.objectContaining({ tentativas: 0 })]));
    expect(((await listarPendentes())[0] as { antes?: unknown }).antes).toBeUndefined();
  });
});
