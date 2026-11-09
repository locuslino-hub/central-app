import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listar, semear } from '../../src/dados/loja';
import { Checklist } from '../../src/ui/Checklist';
import { SemPrazo } from '../../src/ui/SemPrazo';

// Quinta-feira, 2026-11-05, 12:20 (Europe/Lisbon). Só a data é falsa.
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-11-05T12:20:00Z'));
  await semear();
});

const campo = (nome: string) => screen.findByLabelText(nome) as Promise<HTMLInputElement>;
const adicionar = () => fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }));

describe('nova tarefa na Checklist (vai para hoje)', () => {
  it('escrever e adicionar cria a tarefa de hoje, que aparece na lista; o campo esvazia e mantém o foco', async () => {
    render(<Checklist />);
    const entrada = await campo('Nova tarefa para hoje');
    fireEvent.input(entrada, { target: { value: '  Ligar para a Marina  ' } });
    adicionar();

    expect(await screen.findByRole('checkbox', { name: 'Ligar para a Marina' })).toBeTruthy();
    expect(await listar('tarefas')).toMatchObject([{ titulo: 'Ligar para a Marina', data: '2026-11-05', salaId: null }]);
    expect(entrada.value).toBe('');
    expect(document.activeElement).toBe(entrada);
  });

  it('Enter também adiciona', async () => {
    render(<Checklist />);
    const entrada = await campo('Nova tarefa para hoje');
    fireEvent.input(entrada, { target: { value: 'Validar dados' } });
    fireEvent.submit(entrada.closest('form') as HTMLFormElement);
    await waitFor(async () => expect(await listar('tarefas')).toHaveLength(1));
  });

  it('o campo existe mesmo com a lista vazia', async () => {
    render(<Checklist />);
    expect(await screen.findByText('Nada para hoje.')).toBeTruthy();
    expect(await campo('Nova tarefa para hoje')).toBeTruthy();
  });

  it('vazio: pede a tarefa, foca o campo e não grava', async () => {
    render(<Checklist />);
    const entrada = await campo('Nova tarefa para hoje');
    fireEvent.input(entrada, { target: { value: '   ' } });
    adicionar();
    expect((await screen.findByRole('alert')).textContent).toBe('Escreva a tarefa.');
    expect(document.activeElement).toBe(entrada);
    expect(await listar('tarefas')).toEqual([]);
    fireEvent.input(entrada, { target: { value: 'a' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('dois toques seguidos em Adicionar criam uma tarefa só', async () => {
    render(<Checklist />);
    const entrada = await campo('Nova tarefa para hoje');
    fireEvent.input(entrada, { target: { value: 'Uma só' } });
    adicionar();
    adicionar();
    await screen.findByRole('checkbox', { name: 'Uma só' });
    await new Promise((r) => setTimeout(r, 30));
    expect(await listar('tarefas')).toHaveLength(1);
  });

  it('quem já começou a digitar a próxima não perde o texto quando a anterior termina de gravar', async () => {
    render(<Checklist />);
    const entrada = await campo('Nova tarefa para hoje');
    fireEvent.input(entrada, { target: { value: 'Primeira' } });
    adicionar();
    fireEvent.input(entrada, { target: { value: 'Segun' } });
    await screen.findByRole('checkbox', { name: 'Primeira' });
    expect(entrada.value).toBe('Segun');
  });

  it('falha ao gravar: avisa e mantém o texto', async () => {
    render(<Checklist />);
    const entrada = await campo('Nova tarefa para hoje');
    fireEvent.input(entrada, { target: { value: 'Importante' } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new Error('disco cheio');
    });
    adicionar();
    expect((await screen.findByRole('alert')).textContent).toBe('Não consegui salvar. Tente de novo.');
    expect(entrada.value).toBe('Importante');
  });

  it('o campo tem tamanho de fonte que não faz o celular aproximar a tela (16 px) e 44 px de altura, por classe', async () => {
    render(<Checklist />);
    const entrada = await campo('Nova tarefa para hoje');
    expect(entrada.classList.contains('campo')).toBe(true);
    expect(entrada.closest('form')?.classList.contains('nova-tarefa')).toBe(true);
  });
});

describe('nova tarefa em Sem prazo (sem dia)', () => {
  it('cria a tarefa sem data, e ela aparece em Sem prazo', async () => {
    render(<SemPrazo />);
    const entrada = await campo('Nova tarefa sem prazo');
    fireEvent.input(entrada, { target: { value: 'Preciso parafusar o apoio do banheiro' } });
    adicionar();
    expect(await screen.findByRole('checkbox', { name: 'Preciso parafusar o apoio do banheiro' })).toBeTruthy();
    const [salva] = await listar('tarefas');
    expect('data' in salva).toBe(false);
    expect('semana' in salva).toBe(false);
  });
});
