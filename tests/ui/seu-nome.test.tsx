import { fireEvent, render, screen } from '@testing-library/preact';
import { beforeEach, describe, expect, it } from 'vitest';
import { guardarNome, lerNome } from '../../src/dados/nome';
import { SeuNome } from '../../src/ui/SeuNome';

// O nome da saudação ("Boa tarde, Marina.") fica só neste aparelho.
beforeEach(() => localStorage.clear());

describe('nome guardado no aparelho', () => {
  it('sem nome: vazio', () => {
    expect(lerNome()).toBe('');
  });

  it('guarda sem espaços sobrando; vazio apaga', () => {
    guardarNome('  Marina   Souza ');
    expect(lerNome()).toBe('Marina Souza');
    guardarNome('   ');
    expect(lerNome()).toBe('');
  });

  it('nome comprido é cortado em 40 letras', () => {
    guardarNome('A'.repeat(60));
    expect(lerNome()).toHaveLength(40);
  });
});

describe('SeuNome (ajuste do aparelho)', () => {
  it('mostra o nome guardado e guarda o novo', () => {
    guardarNome('Aurora');
    render(<SeuNome />);
    const campo = screen.getByLabelText('Como a saudação te chama') as HTMLInputElement;
    expect(campo.value).toBe('Aurora');
    fireEvent.input(campo, { target: { value: 'Renata' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar nome' }));
    expect(lerNome()).toBe('Renata');
    expect(screen.getByRole('status').textContent).toBe('Guardado. A saudação agora diz "Renata".');
  });

  it('campo vazio tira o nome da saudação', () => {
    guardarNome('Aurora');
    render(<SeuNome />);
    fireEvent.input(screen.getByLabelText('Como a saudação te chama'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar nome' }));
    expect(lerNome()).toBe('');
    expect(screen.getByRole('status').textContent).toBe('Sem nome. A saudação fica sem nome.');
  });
});
