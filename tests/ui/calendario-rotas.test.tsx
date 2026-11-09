import { act, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { agendaDeTeste, evento } from '../apoio/agenda-ui';

// Quinta-feira, 2026-11-05, 12:20 (Europe/Lisbon). Só a data é falsa.
const AGORA = Date.parse('2026-11-05T12:20:00Z');

configure({ asyncUtilTimeout: 5000 });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AGORA);
});

function mostrar(hash: string, largura = 1280) {
  Object.defineProperty(window, 'innerWidth', { value: largura, configurable: true, writable: true });
  history.replaceState(null, '', `/${hash}`);
  render(<App />);
}

function navegar(hash: string) {
  act(() => {
    location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}

const principal = () => within(document.querySelector('main') as HTMLElement);
const titulo = () => screen.getByRole('heading', { level: 1 }).textContent;

describe('as telas de calendário na casca', () => {
  it('Esta semana abre com título, título da aba e sem o cartão "Em breve"', async () => {
    const agenda = await agendaDeTeste();
    agenda.responder([]);
    mostrar('#/semana');
    expect(titulo()).toBe('Esta semana');
    expect(document.title).toBe('Esta semana · Central de Comando');
    expect(principal().queryByText('Esta tela chega numa próxima versão.')).toBeNull();
    expect(principal().getByRole('navigation', { name: 'Semanas' })).toBeTruthy();
  });

  it('semana anterior e próxima mudam a página, o título e a leitura', async () => {
    const agenda = await agendaDeTeste();
    agenda.responderPeloPeriodo([
      evento('Seminário', { inicio: '2026-10-28T10:00:00+00:00', fim: '2026-10-28T11:00:00+00:00' }),
      evento('Defesa de Aurora', { inicio: '2026-11-10T10:00:00+00:00', fim: '2026-11-10T11:00:00+00:00' }),
    ]);
    mostrar('#/semana');
    const nav = () => within(principal().getByRole('navigation', { name: 'Semanas' }));

    fireEvent.click(nav().getByRole('link', { name: 'Semana anterior' }));
    navegar('#/semana?d=2026-10-26');
    expect(await principal().findByText('Seminário')).toBeTruthy();
    expect(titulo()).toBe('Semana de 26/10');
    expect(document.title).toBe('Semana de 26/10 · Central de Comando');
    expect(principal().getByText('26 de outubro a 1 de novembro de 2026')).toBeTruthy();

    navegar('#/semana?d=2026-11-09');
    expect(await principal().findByText('Defesa de Aurora')).toBeTruthy();
    expect(titulo()).toBe('Próxima semana');
    expect(principal().queryByText('Seminário')).toBeNull();

    navegar('#/semana');
    expect(titulo()).toBe('Esta semana');
  });

  it('do mês para o dia: o dia abre a semana, no dia pedido', async () => {
    const agenda = await agendaDeTeste();
    agenda.responder([]);
    mostrar('#/mes', 390);
    expect(titulo()).toBe('Novembro');
    const dia = principal().getByRole('link', { name: /^Terça-feira, 17 de novembro/ });
    expect(dia.getAttribute('href')).toBe('#/semana?d=2026-11-17');
    navegar('#/semana?d=2026-11-17');
    expect(titulo()).toBe('Semana de 16/11');
    // No celular, a semana abre no dia que veio do mês.
    expect(principal().getByRole('button', { name: /^Terça-feira, 17 de novembro/ }).getAttribute('aria-pressed')).toBe('true');
  });

  it('do ano para o mês: o mês abre pelo nome, com o título do mês', async () => {
    const agenda = await agendaDeTeste();
    agenda.responder([]);
    mostrar('#/ano');
    expect(titulo()).toBe('2026');
    expect(principal().getByRole('link', { name: 'Março' }).getAttribute('href')).toBe('#/mes?d=2026-03-01');
    navegar('#/mes?d=2026-03-01');
    expect(titulo()).toBe('Março');
    navegar('#/mes?d=2027-01-01');
    expect(titulo()).toBe('Janeiro de 2027');
  });

  it('o menu marca o mês e o ano atuais mesmo dentro de outro período', async () => {
    const agenda = await agendaDeTeste();
    agenda.responder([]);
    mostrar('#/mes?d=2026-12-01');
    const menu = screen.getByRole('navigation', { name: 'Principal' });
    expect(within(menu).getByRole('link', { name: 'Novembro' }).getAttribute('aria-current')).toBe('page');
  });

  it('o Painel do dia tem a Agenda de hoje ao lado da Checklist', async () => {
    const agenda = await agendaDeTeste();
    agenda.responder([evento('Aula de Modelagem', { inicio: '2026-11-05T09:00:00+00:00', fim: '2026-11-05T11:00:00+00:00' })]);
    mostrar('#/');
    const checklist = principal().getByRole('region', { name: 'Checklist do dia' });
    const agendaHoje = principal().getByRole('region', { name: 'Agenda de hoje' });
    expect(checklist.parentElement).toBe(agendaHoje.parentElement);
    expect(checklist.nextElementSibling).toBe(agendaHoje);
    expect(await within(agendaHoje).findByText('Aula de Modelagem')).toBeTruthy();
  });

  it('sem o aparelho conectado, a agenda diz isso sem travar o resto do Painel', async () => {
    mostrar('#/');
    const agendaHoje = principal().getByRole('region', { name: 'Agenda de hoje' });
    expect(await within(agendaHoje).findByText('Agenda não carregou')).toBeTruthy();
    expect(principal().getByRole('region', { name: 'Checklist do dia' })).toBeTruthy();
    await waitFor(() => expect(principal().getByRole('region', { name: 'Sem prazo' })).toBeTruthy());
  });
});
