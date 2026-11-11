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

describe('Notas: texto por guardar ao reabrir uma sala que existe', () => {
  it('não grava por cima da nota mais nova que veio de outro aparelho', async () => {
    const { guardarNotasPorGuardar, notasPorGuardar } = await import('../../src/dados/notas');
    const { gravarDoServidor, lerRegistros } = await import('../../src/dados/loja');
    // Uma gravação que falhou deixou este texto por guardar.
    guardarNotasPorGuardar('salas', 'sala-orientacoes', 'Texto velho que falhou');
    const [sala] = await lerRegistros([{ colecao: 'salas', id: 'sala-orientacoes' }]);
    await gravarDoServidor([
      { colecao: 'salas', registro: { ...sala!, notas: 'Nota nova do celular', atualizadoEm: Date.now() + 5000, aparelho: 'celular-fake' } },
    ]);

    render(<Notas colecao="salas" id="sala-orientacoes" notas="Nota nova do celular" dica="Anote" />);

    // O texto velho sai da memória (na versão com defeito, só depois de gravar por cima).
    await waitFor(() => expect(notasPorGuardar('salas', 'sala-orientacoes')).toBeUndefined());
    const [depois] = await lerRegistros([{ colecao: 'salas', id: 'sala-orientacoes' }]);
    expect((depois as { notas?: string }).notas).toBe('Nota nova do celular');
    expect((screen.getByRole('textbox', { name: 'Notas' }) as HTMLTextAreaElement).value).toBe('Nota nova do celular');
    expect(screen.queryByText('Salvo')).toBeNull();
  });
});
