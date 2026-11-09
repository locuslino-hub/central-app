import { fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { limparConversa } from '../../src/chat/conversa';
import { listar, listarPendentes, semear, semearPalavras } from '../../src/dados/loja';
import { Chat } from '../../src/ui/Chat';
import { agendaEscrita } from '../apoio/agenda-escrita';

// Quinta-feira, 2026-11-05, 12:20 (Europe/Lisbon). Só a data é falsa.
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 5, 12, 20));
  limparConversa();
  await semear();
  await semearPalavras();
});

const FRASE = 'Adicione reunião sobre o projeto na sexta feira com inicio às 11:00 e termino 12:00';

function dizer(frase: string) {
  fireEvent.input(screen.getByRole('textbox', { name: 'Escreva ou dite' }), { target: { value: frase } });
  fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
}

const agendaPendente = async () => (await listarPendentes()).filter((p) => p.tipo === 'agenda');

describe('frase de compromisso no chat', () => {
  it('cria o evento no Google Agenda (e nenhuma tarefa), e Desfazer o remove', async () => {
    const agenda = agendaEscrita();
    await agenda.instalar();
    render(<Chat />);

    dizer(FRASE);
    const cartao = within(await screen.findByRole('article'));
    await cartao.findByRole('button', { name: 'Desfazer' });

    expect(agenda.eventos.size).toBe(1);
    expect([...agenda.eventos.values()][0]).toMatchObject({
      titulo: 'Reunião sobre o projeto',
      inicio: '2026-11-06T11:00:00+00:00',
      fim: '2026-11-06T12:00:00+00:00',
      salaId: 'sala-investigacao',
    });
    expect(await listar('tarefas')).toEqual([]);
    expect(await agendaPendente()).toEqual([]);
    expect(cartao.queryByRole('status')).toBeNull();

    fireEvent.click(cartao.getByRole('button', { name: 'Desfazer' }));
    await cartao.findByText('Desfeito. Nada ficou guardado.');
    expect(agenda.eventos.size).toBe(0);
  });

  it('trocar a sala do cartão troca a sala do evento', async () => {
    const agenda = agendaEscrita();
    await agenda.instalar();
    render(<Chat />);
    dizer(FRASE);
    const cartao = within(await screen.findByRole('article'));
    await cartao.findByRole('button', { name: 'Desfazer' });

    fireEvent.click(cartao.getByRole('button', { name: 'Trocar sala' }));
    fireEvent.click(cartao.getByRole('button', { name: 'Pessoal' }));

    await waitFor(() => expect([...agenda.eventos.values()][0].salaId).toBe('sala-pessoal'));
  });

  it('sem internet: o evento fica em `pendentes`, o cartão avisa, e Desfazer tira da fila', async () => {
    const agenda = agendaEscrita();
    await agenda.instalar();
    agenda.modo('rede');
    render(<Chat />);

    dizer(FRASE);
    const cartao = within(await screen.findByRole('article'));
    const aviso = await cartao.findByRole('status');

    expect(aviso.textContent).toBe('Sem internet. O compromisso entra na agenda quando a conexão voltar.');
    const fila = await agendaPendente();
    expect(fila).toEqual([
      expect.objectContaining({
        acao: 'criarEvento',
        evento: expect.objectContaining({ titulo: 'Reunião sobre o projeto', data: '2026-11-06', inicio: '11:00', fim: '12:00' }),
      }),
    ]);
    expect(await listar('tarefas')).toEqual([]);

    fireEvent.click(cartao.getByRole('button', { name: 'Desfazer' }));
    await cartao.findByText('Desfeito. Nada ficou guardado.');
    expect(await agendaPendente()).toEqual([]);
  });

  it('o Google recusando a criação: fica na fila com um aviso calmo', async () => {
    const agenda = agendaEscrita();
    await agenda.instalar();
    agenda.modo('recusar');
    render(<Chat />);

    dizer(FRASE);
    const aviso = await within(await screen.findByRole('article')).findByRole('status');

    expect(aviso.textContent).toBe('A agenda do Google não aceitou agora. Vou tentar de novo mais tarde.');
    expect(await agendaPendente()).toHaveLength(1);
  });

  it('se o Desfazer não consegue remover o evento, o cartão avisa e segue guardado', async () => {
    const agenda = agendaEscrita();
    await agenda.instalar();
    render(<Chat />);
    dizer(FRASE);
    const cartao = within(await screen.findByRole('article'));
    await cartao.findByRole('button', { name: 'Desfazer' });
    agenda.modo('recusar');

    fireEvent.click(cartao.getByRole('button', { name: 'Desfazer' }));

    await cartao.findByText('Não consegui desfazer. Tente de novo.');
    expect(agenda.eventos.size).toBe(1);

    agenda.modo('ok');
    fireEvent.click(cartao.getByRole('button', { name: 'Desfazer' }));
    await cartao.findByText('Desfeito. Nada ficou guardado.');
    expect(agenda.eventos.size).toBe(0);
  });

  it('"Marcar reunião" continua tarefa de hoje, não compromisso', async () => {
    const agenda = agendaEscrita();
    await agenda.instalar();
    render(<Chat />);

    dizer('Marcar reunião com a Marina');
    await within(await screen.findByRole('article')).findByRole('button', { name: 'Desfazer' });

    expect(agenda.pedidos).toEqual([]);
    expect(await listar('tarefas')).toEqual([expect.objectContaining({ marcar: true, data: '2026-11-05' })]);
  });
});
