import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listar, salvar } from '../../src/dados/loja';
import { FORMATO_DA_COPIA } from '../../src/dados/exportar';
import { Exportar } from '../../src/ui/Exportar';

const AGORA = new Date('2026-11-05T12:20:00Z').getTime();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AGORA);
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

describe('Exportar', () => {
  it('baixa um arquivo com todas as coleções e avisa em região viva', async () => {
    await salvar('tarefas', tarefa('Mandar mensagem para a Marina'));
    const baixar = vi.fn();
    render(<Exportar baixar={baixar} />);
    fireEvent.click(screen.getByRole('button', { name: 'Baixar cópia dos dados' }));
    await waitFor(() => expect(baixar).toHaveBeenCalledOnce());
    const [nome, texto] = baixar.mock.calls[0] as [string, string];
    expect(nome).toBe('central-copia-2026-11-05.json');
    const copia = JSON.parse(texto);
    expect(copia.formato).toBe(FORMATO_DA_COPIA);
    expect(copia.colecoes.tarefas[0].titulo).toBe('Mandar mensagem para a Marina');
    expect(screen.getByRole('status').textContent).toBe(`Cópia baixada: ${nome}, com 1 item.`);
  });

  it('restaura de um arquivo de cópia', async () => {
    const copia = {
      formato: FORMATO_DA_COPIA,
      exportadoEm: '2026-11-04T10:00:00.000Z',
      colecoes: { tarefas: [{ ...tarefa('Corrigir o capítulo da Renata'), id: 't-1', atualizadoEm: 1, aparelho: 'antigo' }] },
    };
    render(<Exportar />);
    const arquivo = new File([JSON.stringify(copia)], 'central-copia.json', { type: 'application/json' });
    fireEvent.change(screen.getByLabelText('Restaurar a partir de uma cópia'), { target: { files: [arquivo] } });
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/^Cópia restaurada: 1 item devolvido\.$/));
    expect((await listar('tarefas')).map((t) => t.titulo)).toEqual(['Corrigir o capítulo da Renata']);
  });

  it('recusa um arquivo que não é cópia', async () => {
    render(<Exportar />);
    const arquivo = new File(['olá'], 'outro.json', { type: 'application/json' });
    fireEvent.change(screen.getByLabelText('Restaurar a partir de uma cópia'), { target: { files: [arquivo] } });
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/não é uma cópia da Central/));
    expect(await listar('tarefas')).toEqual([]);
  });
});
