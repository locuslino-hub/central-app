// Sala pela cor do Google (spec 2026-11-09): a tela Cores do Google liga cada
// cor a uma sala, e todas as telas passam a mostrar a sala resolvida
// (gravada -> cor -> título -> neutro). Blocos do Google Tarefas: ocupados e
// com o ✓ indo ao Google Tarefas.
import { configure, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Evento } from '../../src/dados/agenda';
import { ligarCor } from '../../src/dados/cores';
import { marcarCompromissoFeito } from '../../src/dados/eventos-feitos';
import { tempoLivre } from '../../src/dados/fila';
import { listar, listarPendentes, semear } from '../../src/dados/loja';
import { resolverRota } from '../../src/rotas';
import { AgendaHoje } from '../../src/ui/AgendaHoje';
import { CoresDoGoogle } from '../../src/ui/CoresDoGoogle';
import { GRUPOS_DO_MAIS } from '../../src/ui/Mais';
import { Quadro } from '../../src/ui/Quadro';
import { Mes } from '../../src/ui/Mes';
import { Sala } from '../../src/ui/Sala';
import { Salas } from '../../src/ui/Salas';
import { Semana } from '../../src/ui/Semana';
import { agendaDeTeste, evento } from '../apoio/agenda-ui';

// Quinta-feira, 2026-11-05, 12:20 (Europe/Lisbon). Só a data é falsa.
const AGORA = Date.parse('2026-11-05T12:20:00Z');
configure({ asyncUtilTimeout: 5000 });

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AGORA);
  await semear();
});

const AZUL = { chave: 'cor:9', hex: '#3f51b5' };
const VERDE = { chave: 'label:etq1', hex: '#0b8043' };
const hoje = (titulo: string, inicio: string, fim: string, extra: Partial<Evento> = {}) =>
  evento(titulo, { inicio: `2026-11-05T${inicio}:00+00:00`, fim: `2026-11-05T${fim}:00+00:00`, ...extra });

describe('tela Cores do Google', () => {
  it('lista as cores vistas com amostra, contagem e até 2 exemplos; o seletor liga a cor a uma sala', async () => {
    const agenda = await agendaDeTeste();
    agenda.responder([
      hoje('Capítulo 2', '09:00', '10:00', { cor: AZUL }),
      hoje('Capítulo 3', '10:00', '11:00', { cor: AZUL }),
      hoje('Leitura', '11:00', '12:00', { cor: AZUL }),
      hoje('Aula de métodos', '14:00', '15:00', { cor: VERDE }),
      hoje('Sem cor', '16:00', '17:00'),
    ]);
    render(<CoresDoGoogle />);
    const azul = await screen.findByRole('group', { name: /Mirtilo/ });
    await waitFor(() => expect(within(azul).getByText('3 na agenda (compromissos e atividades)')).toBeTruthy());
    expect(within(azul).getByText(/Capítulo 2.*Capítulo 3/)).toBeTruthy();
    expect(within(azul).queryByText(/Leitura/)).toBeNull();
    expect((azul.querySelector('.cor-amostra') as HTMLElement).style.background).toMatch(/63, 81, 181|#3f51b5/);
    // O período lido: 60 dias para trás e para a frente.
    expect(agenda.leituras().at(-1)!.dados).toEqual({ de: '2026-09-06', ate: '2027-01-04' });

    fireEvent.change(within(azul).getByLabelText('Sala'), { target: { value: 'sala-doutoramento' } });
    await waitFor(async () => expect(await listar('coresDasSalas')).toMatchObject([{ chave: 'cor:9', salaId: 'sala-doutoramento' }]));
    await waitFor(() => expect((within(azul).getByLabelText('Sala') as HTMLSelectElement).value).toBe('sala-doutoramento'));

    fireEvent.click(within(azul).getByRole('button', { name: 'Sem sala' }));
    await waitFor(async () => expect(await listar('coresDasSalas')).toMatchObject([{ chave: 'cor:9', salaId: null }]));
    expect(screen.getByRole('group', { name: /Etiqueta do Google/ })).toBeTruthy();
  });

  it('sem eventos com cor, explica e ainda lista as 11 cores do Google para ligar a uma sala', async () => {
    const agenda = await agendaDeTeste();
    agenda.responder([hoje('Sem cor', '16:00', '17:00')]);
    render(<CoresDoGoogle />);
    expect(await screen.findByText(/Nenhuma cor/)).toBeTruthy();
    expect(screen.getAllByRole('group')).toHaveLength(11);
    const tomate = screen.getByRole('group', { name: /Tomate/ });
    expect(within(tomate).getByText('Nada com esta cor nestes meses')).toBeTruthy();
    fireEvent.change(within(tomate).getByLabelText('Sala'), { target: { value: 'sala-mba' } });
    await waitFor(async () => expect(await listar('coresDasSalas')).toMatchObject([{ chave: 'cor:11', salaId: 'sala-mba' }]));
  });

  it('com eventos coloridos, as cores vistas vêm primeiro e as outras do Google depois, sem repetir', async () => {
    const agenda = await agendaDeTeste();
    agenda.responder([hoje('Capítulo 2', '09:00', '10:00', { cor: AZUL })]);
    render(<CoresDoGoogle />);
    const nomesAgora = () => screen.getAllByRole('group').map((g) => g.querySelector('.cor-nome')!.textContent ?? '');
    await waitFor(() => expect(nomesAgora()[0]).toMatch(/Mirtilo/));
    const nomes = nomesAgora();
    expect(nomes).toHaveLength(11);
    expect(nomes.filter((n) => /Mirtilo/.test(n ?? ''))).toHaveLength(1);
  });

  it('tem rota própria, link na página de Salas e entrada no Mais do celular', () => {
    expect(resolverRota('#/cores')).toMatchObject({ id: 'cores', titulo: 'Cores do Google', voltarPara: '#/salas' });
    expect(GRUPOS_DO_MAIS.flatMap((g) => g.destinos.map((d) => d.id))).toContain('cores');
    render(<Salas titulo="Salas" />);
    expect(screen.getByRole('link', { name: /Cores do Google/ }).getAttribute('href')).toBe('#/cores');
  });
});

describe('a sala resolvida em todas as telas', () => {
  it('Agenda de hoje: a cor ligada pinta e dá o nome da sala; a gravada vale antes', async () => {
    await ligarCor('cor:9', 'sala-doutoramento');
    const agenda = await agendaDeTeste();
    agenda.responder([hoje('Capítulo 2', '14:00', '15:00', { cor: AZUL }), hoje('Aula', '16:00', '17:00', { cor: AZUL, salaId: 'sala-mba' })]);
    render(<AgendaHoje />);
    const cartao = within(screen.getByRole('region', { name: 'Agenda de hoje' }));
    const item = async (t: string) => (await cartao.findByText(t)).closest('li') as HTMLElement;
    await waitFor(async () => expect((await item('Capítulo 2')).className).toContain('sala-dout'));
    expect(within(await item('Capítulo 2')).getByText('Doutoramento')).toBeTruthy();
    expect((await item('Aula')).className).toContain('sala-mba');
  });

  it('detalhe do compromisso diz a sala resolvida, não "Sem sala"', async () => {
    await ligarCor('cor:9', 'sala-doutoramento');
    const agenda = await agendaDeTeste();
    agenda.responder([hoje('Capítulo 2', '14:00', '15:00', { cor: AZUL })]);
    render(<AgendaHoje />);
    fireEvent.click(await screen.findByRole('button', { name: /Capítulo 2/ }));
    const detalhe = await screen.findByRole('dialog');
    await waitFor(() => expect(within(detalhe).getByText('Doutoramento')).toBeTruthy());
    expect(within(detalhe).queryByText('Sem sala')).toBeNull();
  });

  it('Quadro: o compromisso entra na coluna da sala resolvida pela cor', async () => {
    await ligarCor('label:etq1', 'sala-aulas');
    const agenda = await agendaDeTeste();
    agenda.responder([hoje('Encontro de turma', '16:00', '17:00', { cor: VERDE })]);
    render(<Quadro />);
    const coluna = await screen.findByRole('region', { name: 'Aulas' });
    await waitFor(() => expect(within(coluna).getByText('Encontro de turma')).toBeTruthy());
    expect(within(coluna).getByText('1 compromisso')).toBeTruthy();
  });

  it('página da Sala: mostra o compromisso resolvido pela cor', async () => {
    await ligarCor('label:etq1', 'sala-aulas');
    const agenda = await agendaDeTeste();
    agenda.responder([hoje('Encontro de turma', '16:00', '17:00', { cor: VERDE })]);
    render(<Sala id="sala-aulas" />);
    const secao = await screen.findByRole('region', { name: 'Próximos compromissos' });
    await waitFor(() => expect(within(secao).getByText('Encontro de turma')).toBeTruthy());
  });
});

describe('bloco do Google Tarefas na tela', () => {
  const bloco = () => hoje('Revisar capítulo', '14:00', '15:00', { id: 'bloco1', tarefaGoogleId: 'web1', livre: true });

  it('não aparece como "livre" e o ✓ vai para a fila como marcarTarefaGoogle', async () => {
    const agenda = await agendaDeTeste();
    agenda.responder([bloco()]);
    render(<AgendaHoje />);
    const cartao = within(screen.getByRole('region', { name: 'Agenda de hoje' }));
    const li = (await cartao.findByText('Revisar capítulo')).closest('li') as HTMLElement;
    expect(within(li).queryByText('livre')).toBeNull();
    fireEvent.click(within(li).getByRole('checkbox'));
    await waitFor(async () =>
      expect((await listarPendentes()).filter((p) => p.tipo === 'espelho')).toMatchObject([{ acao: 'marcarTarefaGoogle', taskId: 'web1', feito: true }]),
    );
  });

  it('conta como ocupado no tempo livre (mesmo vindo como disponível do Google)', async () => {
    const agenda = await agendaDeTeste();
    agenda.responder([bloco()]);
    render(<AgendaHoje />);
    await screen.findByText('Revisar capítulo');
    const livre = await tempoLivre(new Date(Date.parse('2026-11-05T14:20:00Z')));
    expect(livre).toMatchObject({ minutos: 0, proximo: { id: 'bloco1' } });
  });
});

describe('revisão: cores ligadas sem eventos e feitos no Mês e na Semana', () => {
  it('cor ligada a uma sala sem eventos no período aparece, para dar para desligar', async () => {
    await ligarCor('cor:5', 'sala-casa');
    const agenda = await agendaDeTeste();
    agenda.responder([]);
    render(<CoresDoGoogle />);
    const banana = await screen.findByRole('group', { name: /Banana/ });
    expect(within(banana).getByText('Nada com esta cor nestes meses')).toBeTruthy();
    fireEvent.click(within(banana).getByRole('button', { name: 'Sem sala' }));
    await waitFor(async () => expect(await listar('coresDasSalas')).toMatchObject([{ chave: 'cor:5', salaId: null }]));
  });

  it('o Mês e a Semana mostram o feito marcado na Central', async () => {
    const reuniao = hoje('Reunião da Renata', '16:00', '17:00', { id: 'r1' });
    await marcarCompromissoFeito(reuniao, true, '2026-11-05');
    const agenda = await agendaDeTeste();
    agenda.responder([reuniao]);
    const { unmount } = render(<Mes data="2026-11-05" />);
    await waitFor(() => {
      const titulo = [...document.querySelectorAll('.mes-titulo')].find((e) => e.textContent === 'Reunião da Renata');
      expect(titulo?.getAttribute('data-feito')).toBe('true');
    });
    unmount();
    render(<Semana data="2026-11-05" />);
    await waitFor(() => {
      const item = screen.getAllByText('Reunião da Renata')[0].closest('li');
      expect(item?.getAttribute('data-feito')).toBe('true');
    });
  });
});
