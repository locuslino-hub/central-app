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

  const copiaDe = (titulo: string) => ({
    formato: FORMATO_DA_COPIA,
    exportadoEm: '2026-11-04T10:00:00.000Z',
    colecoes: { tarefas: [{ ...tarefa(titulo), id: 't-1', atualizadoEm: 1, aparelho: 'antigo' }] },
  });
  const escolher = (arquivo: File) =>
    fireEvent.change(screen.getByLabelText('Restaurar a partir de uma cópia'), { target: { files: [arquivo] } });
  const arquivoDe = (corpo: unknown) => new File([JSON.stringify(corpo)], 'central-copia.json', { type: 'application/json' });

  it('restaurar pede confirmação com a contagem e o dia da cópia; só depois de Restaurar devolve, e o foco fica no campo do arquivo', async () => {
    render(<Exportar />);
    escolher(arquivoDe(copiaDe('Corrigir o capítulo da Renata')));
    const pergunta = await screen.findByText(/Vai devolver 1 item da cópia de 04\/11; o que mudou depois volta como estava/);
    expect(pergunta).toBeTruthy();
    expect(await listar('tarefas')).toEqual([]); // nada foi gravado ainda
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancelar' })));

    fireEvent.click(screen.getByRole('button', { name: 'Restaurar' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Cópia restaurada: 1 item devolvido.'));
    expect((await listar('tarefas')).map((t) => t.titulo)).toEqual(['Corrigir o capítulo da Renata']);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Restaurar a partir de uma cópia')));
  });

  it('Cancelar não grava nada e devolve o foco ao campo do arquivo', async () => {
    render(<Exportar />);
    escolher(arquivoDe(copiaDe('Corrigir o capítulo da Renata')));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Restauração cancelada. Nada foi mudado.'));
    expect(screen.queryByRole('button', { name: 'Restaurar' })).toBeNull();
    expect(await listar('tarefas')).toEqual([]);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Restaurar a partir de uma cópia')));
  });

  it('recusa um arquivo que não é cópia', async () => {
    render(<Exportar />);
    escolher(new File(['olá'], 'outro.json', { type: 'application/json' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/não é uma cópia da Central/));
    expect(screen.queryByRole('button', { name: 'Restaurar' })).toBeNull();
    expect(await listar('tarefas')).toEqual([]);
  });

  it('recusa arquivo com mais de 5 MB sem nem lê-lo', async () => {
    render(<Exportar />);
    const grande = new File(['{}'], 'enorme.json', { type: 'application/json' });
    Object.defineProperty(grande, 'size', { value: 5 * 1024 * 1024 + 1 });
    const ler = vi.spyOn(grande, 'text');
    escolher(grande);
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/grande demais.*5 MB/));
    expect(ler).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Restaurar' })).toBeNull();
  });

  it('a nota diz que os e-mails de contato vão na cópia e que a conexão e o Gmail não', () => {
    render(<Exportar />);
    const nota = document.querySelector('.exportar-nota')!.textContent!;
    expect(nota).toContain('e-mails de contato');
    expect(nota).toContain('não leva a conexão, o código de acesso nem as mensagens do Gmail');
  });
});
