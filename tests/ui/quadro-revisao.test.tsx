// Tarefa 20, revisão: Só e-mails, limites da semana (inclusive horário de verão) e coluna aberta de partida.
// Nomes fictícios (Marina, Renata, Prof. Souza, Aurora).
import { configure, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { limparConversa } from '../../src/chat/conversa';
import { salvar, semear } from '../../src/dados/loja';
import { Quadro } from '../../src/ui/Quadro';
import { evento } from '../apoio/agenda-ui';
import { email } from '../apoio/emails-ui';
import { scriptDeTeste } from '../apoio/script-ui';
import { criar } from '../apoio/tarefas';

configure({ asyncUtilTimeout: 5000 });

beforeEach(async () => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-11-05T12:20:00Z'));
  limparConversa();
  await semear();
});

function mostrar(largura = 1280) {
  Object.defineProperty(window, 'innerWidth', { value: largura, configurable: true, writable: true });
  return render(<Quadro />);
}

const coluna = async (nome: string) => within(await screen.findByRole('region', { name: nome }));
const filtro = (nome: string) => screen.getByRole('button', { name: nome });
const em = (dia: string, inicio: string, fim: string, titulo: string) =>
  evento(titulo, { salaId: 'sala-orientacoes', inicio: `${dia}T${inicio}:00+00:00`, fim: `${dia}T${fim}:00+00:00` });
const emailEm = (assunto: string, data: string) => email(assunto, { data });
const marina = () =>
  salvar('pessoas', { id: 'p-marina', nome: 'Marina', salaId: 'sala-orientacoes', emails: ['marina@exemplo.invalid'] });

describe('Quadro: Só e-mails conta só e-mails', () => {
  it('o cabeçalho diz só os e-mails, e a sala só com tarefas diz que não tem e-mail', async () => {
    await marina();
    await criar('Revisar capítulo 2', { salaId: 'sala-orientacoes', data: '2026-11-05' });
    await criar('Preparar aula', { salaId: 'sala-aulas' });
    await scriptDeTeste({ emails: [email('Revisão do capítulo 2')] });
    mostrar();
    const ori = await coluna('Orientações');
    await ori.findByText('Revisão do capítulo 2');
    await waitFor(() => expect(ori.getByText('1 tarefa · 1 e-mail')).toBeTruthy());
    fireEvent.click(filtro('Só e-mails'));
    expect(ori.getByText('1 e-mail')).toBeTruthy();
    expect(ori.queryByText(/^d+ tarefas?/)).toBeNull();
    expect(ori.queryByText('Revisar capítulo 2')).toBeNull();
    // Aulas só tem tarefa: em Só e-mails vira pílula "Sem e-mail".
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Aulas' })).toBeNull());
    expect(within(screen.getByRole('list', { name: 'Sem e-mail:' })).getByRole('link', { name: 'Aulas' })).toBeTruthy();
  });
});

describe('Quadro: limites da semana', () => {
  it('hoje é domingo: o domingo entra e a segunda seguinte não', async () => {
    vi.setSystemTime(Date.parse('2026-11-08T12:20:00Z'));
    await marina();
    await criar('Tarefa de domingo', { salaId: 'sala-orientacoes', data: '2026-11-08' });
    await criar('Tarefa de segunda', { salaId: 'sala-orientacoes', data: '2026-11-09' });
    await scriptDeTeste({
      eventos: [em('2026-11-08', '18:00', '19:00', 'Jantar de domingo'), em('2026-11-09', '09:00', '10:00', 'Reunião de segunda')],
      emails: [emailEm('E-mail de domingo', '2026-11-08T10:00:00+00:00'), emailEm('E-mail de segunda', '2026-11-09T10:00:00+00:00')],
    });
    mostrar();
    const ori = await coluna('Orientações');
    await ori.findByText('Reunião de segunda');
    fireEvent.click(filtro('Esta semana'));
    expect(ori.getByText('Tarefa de domingo')).toBeTruthy();
    expect(ori.getByText('Jantar de domingo')).toBeTruthy();
    expect(ori.getByText('E-mail de domingo')).toBeTruthy();
    expect(ori.queryByText('Tarefa de segunda')).toBeNull();
    expect(ori.queryByText('Reunião de segunda')).toBeNull();
    expect(ori.queryByText('E-mail de segunda')).toBeNull();
  });

  it('hoje é segunda: o domingo anterior fica fora (menos a tarefa atrasada) e o domingo limite entra', async () => {
    vi.setSystemTime(Date.parse('2026-11-09T12:20:00Z'));
    await marina();
    await criar('Tarefa atrasada', { salaId: 'sala-orientacoes', data: '2026-11-08' });
    await criar('Tarefa do domingo limite', { salaId: 'sala-orientacoes', data: '2026-11-15' });
    await criar('Tarefa da outra segunda', { salaId: 'sala-orientacoes', data: '2026-11-16' });
    await scriptDeTeste({
      eventos: [
        em('2026-11-08', '18:00', '19:00', 'Jantar de domingo'),
        em('2026-11-09', '09:00', '10:00', 'Reunião de segunda'),
        em('2026-11-15', '09:00', '10:00', 'Passeio de domingo'),
        em('2026-11-16', '09:00', '10:00', 'Reunião da outra segunda'),
      ],
      emails: [emailEm('E-mail de domingo', '2026-11-08T10:00:00+00:00'), emailEm('E-mail de segunda', '2026-11-09T10:00:00+00:00')],
    });
    mostrar();
    const ori = await coluna('Orientações');
    await ori.findByText('Passeio de domingo');
    fireEvent.click(filtro('Esta semana'));
    expect(ori.getByText('Reunião de segunda')).toBeTruthy();
    expect(ori.getByText('Passeio de domingo')).toBeTruthy();
    expect(ori.queryByText('Jantar de domingo')).toBeNull();
    expect(ori.queryByText('Reunião da outra segunda')).toBeNull();
    expect(ori.getByText('E-mail de segunda')).toBeTruthy();
    expect(ori.queryByText('E-mail de domingo')).toBeNull();
    expect(ori.getByText('Tarefa atrasada')).toBeTruthy();
    expect(ori.getByText('Tarefa do domingo limite')).toBeTruthy();
    expect(ori.queryByText('Tarefa da outra segunda')).toBeNull();
  });

  it('em julho (horário de verão), o e-mail das 23:30 de Lisboa no domingo é da semana que acabou', async () => {
    // Segunda, 6 de julho, 12:20 em Lisboa (UTC+1).
    vi.setSystemTime(Date.parse('2026-07-06T11:20:00Z'));
    await marina();
    await scriptDeTeste({
      emails: [emailEm('E-mail da véspera', '2026-07-05T23:30:00+01:00'), emailEm('E-mail da segunda cedo', '2026-07-06T00:10:00+01:00')],
    });
    mostrar();
    const ori = await coluna('Orientações');
    await ori.findByText('E-mail da véspera');
    fireEvent.click(filtro('Esta semana'));
    expect(ori.queryByText('E-mail da véspera')).toBeNull();
    expect(ori.getByText('E-mail da segunda cedo')).toBeTruthy();
  });

  it('em julho, no domingo à noite, o e-mail das 23:30 ainda é da semana', async () => {
    // Domingo, 5 de julho, 23:45 em Lisboa = 22:45 UTC.
    vi.setSystemTime(Date.parse('2026-07-05T22:45:00Z'));
    await marina();
    await scriptDeTeste({ emails: [emailEm('E-mail de domingo à noite', '2026-07-05T23:30:00+01:00')] });
    mostrar();
    const ori = await coluna('Orientações');
    await ori.findByText('E-mail de domingo à noite');
    fireEvent.click(filtro('Esta semana'));
    expect(ori.getByText('E-mail de domingo à noite')).toBeTruthy();
  });
});

describe('Quadro (celular): coluna aberta de partida', () => {
  it('não muda sozinha ao trocar de filtro', async () => {
    await marina();
    await criar('Preparar aula', { salaId: 'sala-aulas' });
    await scriptDeTeste({ emails: [email('Revisão do capítulo 2')] });
    mostrar(390);
    const aulas = await screen.findByRole('button', { name: /^Aulas/ });
    await waitFor(() => expect(aulas.getAttribute('aria-expanded')).toBe('true'));
    const ori = screen.getByRole('button', { name: /^Orientações/ });
    expect(ori.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Só e-mails' }));
    expect(aulas.getAttribute('aria-expanded')).toBe('true');
    expect(ori.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Esta semana' }));
    expect(aulas.getAttribute('aria-expanded')).toBe('true');
    expect(ori.getAttribute('aria-expanded')).toBe('false');
  });
});
