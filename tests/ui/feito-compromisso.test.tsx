// Caixa de feito nos compromissos (feito espelhado, spec 2026-11-09): na Agenda
// de hoje, contando no progresso do dia e riscado na Linha do dia. Convites de
// outras pessoas continuam aparecendo e podem ser marcados (só na Central).
import { configure, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { montarCalendario } from '../../src/dados/calendario';
import { idDoFeito } from '../../src/dados/eventos-feitos';
import { listar, listarPendentes, salvar, semear } from '../../src/dados/loja';
import { AgendaHoje } from '../../src/ui/AgendaHoje';
import { Checklist } from '../../src/ui/Checklist';
import { LinhaDia } from '../../src/ui/LinhaDia';
import { agendaDeTeste, evento } from '../apoio/agenda-ui';
import { criar } from '../apoio/tarefas';

// Quinta-feira, 2026-11-05, 12:20 (Europe/Lisbon). Só a data é falsa.
const AGORA = Date.parse('2026-11-05T12:20:00Z');
configure({ asyncUtilTimeout: 5000 });

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AGORA);
  await semear();
});

const agendaDeHoje = () => within(screen.getByRole('region', { name: 'Agenda de hoje' }));
const orientacao = () =>
  evento('Orientação com Renata', { id: 'meu1', inicio: '2026-11-05T14:00:00+00:00', fim: '2026-11-05T15:00:00+00:00' });
const banca = () =>
  evento('Banca do Prof. Souza', {
    id: 'convite1',
    inicio: '2026-11-05T16:00:00+00:00',
    fim: '2026-11-05T17:00:00+00:00',
    somenteLeitura: true,
  });

describe('Agenda de hoje: caixa de feito', () => {
  it('cada compromisso tem a caixa; marcar risca, diz "feito", grava na Central e põe o "✓ " na fila', async () => {
    const agenda = await agendaDeTeste();
    agenda.responder([orientacao()]);
    render(<AgendaHoje />);

    const caixa = await agendaDeHoje().findByRole('checkbox', { name: 'Orientação com Renata' });
    expect(caixa.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(caixa);

    await waitFor(() => expect(caixa.getAttribute('aria-checked')).toBe('true'));
    const item = caixa.closest('li') as HTMLElement;
    expect(item.getAttribute('data-feito')).toBe('true');
    expect(within(item).getByText('feito')).toBeTruthy();
    expect(await listar('eventosFeitos')).toMatchObject([
      { id: idDoFeito('primary', 'meu1'), eventoId: 'meu1', agendaId: 'primary', data: '2026-11-05', feito: true },
    ]);
    expect((await listarPendentes()).filter((p) => p.tipo === 'espelho')).toMatchObject([
      { acao: 'marcarEventoFeito', id: 'meu1', feito: true },
    ]);

    fireEvent.click(caixa);
    await waitFor(() => expect(caixa.getAttribute('aria-checked')).toBe('false'));
    expect(await listar('eventosFeitos')).toMatchObject([{ feito: false }]);
  });

  it('compromisso já marcado no Google ("✓ ") aparece marcado, com o título sem a marca', async () => {
    const agenda = await agendaDeTeste();
    agenda.responder([{ ...orientacao(), feito: true }]);
    render(<AgendaHoje />);
    const caixa = await agendaDeHoje().findByRole('checkbox', { name: 'Orientação com Renata' });
    expect(caixa.getAttribute('aria-checked')).toBe('true');
  });

  it('convite de outra pessoa aparece na Agenda de hoje e pode ser marcado, só na Central', async () => {
    const agenda = await agendaDeTeste();
    agenda.responder([banca()]);
    render(<AgendaHoje />);

    expect(await agendaDeHoje().findByText('Banca do Prof. Souza')).toBeTruthy();
    const caixa = agendaDeHoje().getByRole('checkbox', { name: 'Banca do Prof. Souza' });
    fireEvent.click(caixa);
    await waitFor(() => expect(caixa.getAttribute('aria-checked')).toBe('true'));
    expect(await listar('eventosFeitos')).toMatchObject([{ eventoId: 'convite1', feito: true }]);
    expect((await listarPendentes()).filter((p) => p.tipo === 'espelho')).toEqual([]);
    expect(screen.queryByText(/Não consegui marcar/)).toBeNull();
  });

  it('o feito marcado no outro aparelho (registro sincronizado) aparece aqui', async () => {
    await salvar('eventosFeitos', {
      id: idDoFeito('primary', 'meu1'),
      eventoId: 'meu1',
      agendaId: 'primary',
      data: '2026-11-05',
      feito: true,
    });
    const agenda = await agendaDeTeste();
    agenda.responder([orientacao()]);
    render(<AgendaHoje />);
    const caixa = await agendaDeHoje().findByRole('checkbox', { name: 'Orientação com Renata' });
    expect(caixa.getAttribute('aria-checked')).toBe('true');
  });

  it('tarefa com prazo na Agenda de hoje não ganha caixa (ela tem a da Checklist)', async () => {
    await criar('Entregar relatório', { data: '2026-11-05', prazoHora: '18:00' });
    const agenda = await agendaDeTeste();
    agenda.responder([]);
    render(<AgendaHoje />);
    expect(await agendaDeHoje().findByText('Entregar relatório')).toBeTruthy();
    expect(agendaDeHoje().queryAllByRole('checkbox')).toEqual([]);
  });
});

describe('progresso do dia com os compromissos', () => {
  it('conta tarefas e compromissos de hoje; o livre não conta; marcar o compromisso anda a barra', async () => {
    await criar('Revisar parágrafo', { data: '2026-11-05' });
    const agenda = await agendaDeTeste();
    agenda.responder([
      orientacao(),
      banca(),
      evento('Lembrete livre', { inicio: '2026-11-05T18:00:00+00:00', fim: '2026-11-05T18:30:00+00:00', livre: true }),
    ]);
    render(
      <>
        <Checklist />
        <AgendaHoje />
      </>,
    );

    await waitFor(() => expect(screen.getByText('0 de 3 feitas')).toBeTruthy());
    fireEvent.click(await agendaDeHoje().findByRole('checkbox', { name: 'Orientação com Renata' }));
    await waitFor(() => expect(screen.getByText('1 de 3 feitas')).toBeTruthy());
    const barra = screen.getByRole('progressbar', { name: 'Progresso do dia' });
    expect(barra.getAttribute('aria-valuemax')).toBe('3');
    expect(barra.getAttribute('aria-valuenow')).toBe('1');
  });

  it('sem tarefas, mas com compromissos: a barra aparece e a Checklist ainda diz que não há tarefas', async () => {
    const agenda = await agendaDeTeste();
    agenda.responder([orientacao()]);
    render(
      <>
        <Checklist />
        <AgendaHoje />
      </>,
    );
    await waitFor(() => expect(screen.getByText('0 de 1 feita')).toBeTruthy());
    expect(screen.getByText('Nada para hoje.')).toBeTruthy();
  });
});

describe('Linha do dia', () => {
  it('compromisso feito fica riscado e o leitor de tela ouve "feito"', () => {
    const dia = montarCalendario({
      eventos: [{ ...orientacao(), feito: true }],
      tarefas: [],
      de: '2026-11-05',
      ate: '2026-11-05',
      agora: new Date(AGORA),
    }).dia('2026-11-05');
    const { container } = render(<LinhaDia dia={dia} agora={new Date(AGORA)} salas={[]} />);
    expect(container.querySelector('[data-titulo="Orientação com Renata"]')!.getAttribute('data-feito')).toBe('true');
    expect(screen.getByText('14:00 às 15:00: Orientação com Renata, feito')).toBeTruthy();
  });
});
