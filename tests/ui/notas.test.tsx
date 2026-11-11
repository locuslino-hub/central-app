// O campo de notas sozinho: o que ele diz quando a gravação não vale.
import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { semear } from '../../src/dados/loja';
import { Notas } from '../../src/ui/Notas';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-11-05T12:20:00Z'));
  await semear();
});

describe('Notas de um registro que não existe mais', () => {
  it('não diz "Salvo": avisa que a sala foi apagada e o texto digitado fica no campo', async () => {
    render(<Notas colecao="salas" id="sala-que-sumiu" notas={undefined} dica="Anote" />);
    const campo = screen.getByRole('textbox', { name: 'Notas' }) as HTMLTextAreaElement;
    campo.focus();
    fireEvent.input(campo, { target: { value: 'Combinar entregas' } });
    fireEvent.blur(campo);

    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Esta sala foi apagada; a nota não foi guardada.'));
    expect(screen.queryByText('Salvo')).toBeNull();
    expect(campo.value).toBe('Combinar entregas');
  });

  it('pessoa: o aviso fala da pessoa', async () => {
    render(<Notas colecao="pessoas" id="p-que-sumiu" notas={undefined} dica="Anote" />);
    const campo = screen.getByRole('textbox', { name: 'Notas' }) as HTMLTextAreaElement;
    fireEvent.input(campo, { target: { value: 'Prefere terças' } });
    fireEvent.blur(campo);

    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Esta pessoa foi apagada; a nota não foi guardada.'));
    expect(campo.value).toBe('Prefere terças');
  });
});
