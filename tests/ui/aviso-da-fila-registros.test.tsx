// C-05: registros que nunca sairão (recusados ou grandes demais) aparecem no aviso
// da fila, com Tentar de novo e Descartar. Nomes fictícios.
import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listarPendentes, pararPendentes, salvar, semear } from '../../src/dados/loja';
import type { PendenteRegistro } from '../../src/dados/tipos';
import { AvisoDaFila } from '../../src/ui/AvisoDaFila';

const sincronizar = vi.hoisted(() => vi.fn(async () => 'atualizado'));
vi.mock('../../src/dados/sincronia', async (importarOriginal) => ({
  ...(await importarOriginal<typeof import('../../src/dados/sincronia')>()),
  sincronizar,
}));

beforeEach(async () => {
  sincronizar.mockClear();
  await semear();
});

const tarefa = (titulo: string) => ({
  titulo,
  salaId: null,
  duracaoMin: 60,
  duracaoConfirmada: false,
  feito: false,
  fixada: false,
  marcar: false,
});

const registros = async () => (await listarPendentes()).filter((p): p is PendenteRegistro => p.tipo === 'registro');

async function comParadas(quantas: number, motivo: 'recusada' | 'grande-demais' = 'recusada') {
  for (let i = 0; i < quantas; i++) await salvar('tarefas', tarefa(`Entrega da Marina ${i}`));
  await pararPendentes((await registros()).map((p) => p.seq), motivo);
}

describe('aviso da fila: registros parados', () => {
  it('sem parada, não mostra nada', async () => {
    await salvar('tarefas', tarefa('Entrega da Marina'));
    const { container } = render(<AvisoDaFila />);
    await new Promise((r) => setTimeout(r, 30));
    expect(container.textContent).toBe('');
  });

  it('uma parada: diz que 1 alteração não pôde ser enviada e está guardada no aparelho', async () => {
    await comParadas(1);
    render(<AvisoDaFila />);
    expect(await screen.findByText('1 alteração não pôde ser enviada e está guardada neste aparelho.')).toBeTruthy();
  });

  it('várias paradas: conta no plural, também as grandes demais', async () => {
    await comParadas(2, 'grande-demais');
    render(<AvisoDaFila />);
    expect(await screen.findByText('2 alterações não puderam ser enviadas e estão guardadas neste aparelho.')).toBeTruthy();
  });

  it('Tentar de novo retoma as paradas e sincroniza', async () => {
    await comParadas(1);
    render(<AvisoDaFila />);

    fireEvent.click(await screen.findByRole('button', { name: 'Tentar de novo' }));

    await waitFor(() => expect(screen.queryByText(/não pôde ser enviada/)).toBeNull());
    expect(sincronizar).toHaveBeenCalled();
    const fila = await registros();
    expect(fila).toHaveLength(1);
    expect(fila[0].parada).toBeUndefined();
  });

  it('Descartar tira as paradas da fila', async () => {
    await comParadas(1);
    render(<AvisoDaFila />);

    fireEvent.click(await screen.findByRole('button', { name: 'Descartar' }));

    await waitFor(() => expect(screen.queryByText(/não pôde ser enviada/)).toBeNull());
    expect(await registros()).toEqual([]);
  });
});
