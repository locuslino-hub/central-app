import { configure, render, screen, waitFor, within } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Ano } from '../../src/ui/Ano';
import { Mes } from '../../src/ui/Mes';
import { agendaDeTeste, evento } from '../apoio/agenda-ui';
import { criar } from '../apoio/tarefas';

// Quinta-feira, 2026-11-05, 12:20 (Europe/Lisbon). Só a data é falsa.
const AGORA = Date.parse('2026-11-05T12:20:00Z');

configure({ asyncUtilTimeout: 5000 });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AGORA);
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true, writable: true });
});

const em = (dia: string, inicio: string, fim: string, titulo: string, extra = {}) =>
  evento(titulo, { inicio: `${dia}T${inicio}:00+00:00`, fim: `${dia}T${fim}:00+00:00`, ...extra });

const celula = (nome: RegExp | string) => screen.getByRole('link', { name: nome });

describe('Mês', () => {
  it('abre no mês de hoje: grade de segunda a domingo, em semanas inteiras', async () => {
    const agenda = await agendaDeTeste();
    agenda.responder([]);
    render(<Mes />);

    const grade = within(screen.getByRole('table', { name: 'Novembro de 2026' }));
    expect(grade.getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']);
    expect(grade.getAllByRole('row')).toHaveLength(1 + 6); // cabeçalho e seis semanas
    expect(grade.getAllByRole('link')).toHaveLength(42);
    // 1/11 é domingo: a primeira linha começa em 26/10 e a última termina em 6/12.
    expect(grade.getAllByRole('link')[0].getAttribute('href')).toBe('#/semana?d=2026-10-26');
    expect(grade.getAllByRole('link')[41].getAttribute('href')).toBe('#/semana?d=2026-12-06');
    await waitFor(() => expect(agenda.leituras().map((p) => p.dados)).toContainEqual({ de: '2026-10-26', ate: '2026-12-06' }));
  });

  it('hoje fica marcado em palavras; os dias de outros meses são marcados como de fora', async () => {
    const agenda = await agendaDeTeste();
    agenda.responder([]);
    render(<Mes />);
    const hoje = celula(/^Quinta-feira, 5 de novembro, hoje/);
    expect(hoje.getAttribute('aria-current')).toBe('date');
    expect(hoje.getAttribute('data-hoje')).toBe('true');
    expect(document.querySelectorAll('[aria-current="date"]')).toHaveLength(1);
    const fora = celula(/^Segunda-feira, 26 de outubro/);
    expect(fora.getAttribute('data-fora')).toBe('true');
    expect(celula(/^Segunda-feira, 2 de novembro/).getAttribute('data-fora')).toBe('false');
  });

  it('cada dia leva à semana daquele dia, no dia', async () => {
    const agenda = await agendaDeTeste();
    agenda.responder([]);
    render(<Mes />);
    expect(celula(/^Quarta-feira, 18 de novembro/).getAttribute('href')).toBe('#/semana?d=2026-11-18');
  });

  it('o dia diz quantos eventos e tarefas tem; vazio diz "sem compromissos"', async () => {
    const agenda = await agendaDeTeste();
    agenda.responder([
      em('2026-11-10', '09:00', '10:00', 'Aula'),
      em('2026-11-10', '11:00', '12:00', 'Seminário'),
      em('2026-11-10', '14:00', '15:00', 'Reunião'),
      em('2026-11-11', '09:00', '10:00', 'Defesa'),
    ]);
    await criar('Entregar relatório', { data: '2026-11-10', prazoHora: '17:00' });
    await criar('Ligar para a Renata', { data: '2026-11-11' });
    await criar('Ligar para o Prof. Souza', { data: '2026-11-11' });
    render(<Mes />);
    expect(await screen.findByRole('link', { name: 'Terça-feira, 10 de novembro, 3 eventos e 1 tarefa' })).toBeTruthy();
    expect(celula('Quarta-feira, 11 de novembro, 1 evento e 2 tarefas')).toBeTruthy();
    expect(celula('Quinta-feira, 12 de novembro, sem compromissos')).toBeTruthy();
  });

  it('pontos cheios são eventos, anéis são tarefas; o que passa de três vira "+N"', async () => {
    const agenda = await agendaDeTeste();
    agenda.responder([
      em('2026-11-10', '08:00', '09:00', 'A'),
      em('2026-11-10', '09:00', '10:00', 'B'),
      em('2026-11-10', '10:00', '11:00', 'C'),
      em('2026-11-10', '11:00', '12:00', 'D'),
      em('2026-11-10', '12:00', '13:00', 'E'),
    ]);
    await criar('Tarefa do dia', { data: '2026-11-10' });
    render(<Mes />);
    const x = await screen.findByRole('link', { name: /5 eventos e 1 tarefa/ });
    expect(x.querySelectorAll('.mes-ponto')).toHaveLength(3);
    expect(x.querySelectorAll('.mes-anel')).toHaveLength(1);
    expect(within(x).getByText('+2')).toBeTruthy();
  });

  it('o dia mostra os títulos dos dois primeiros eventos (a tela larga decide se cabem)', async () => {
    const agenda = await agendaDeTeste();
    agenda.responder([em('2026-11-10', '09:00', '10:00', 'Aula'), em('2026-11-10', '11:00', '12:00', 'Seminário'), em('2026-11-10', '14:00', '15:00', 'Reunião')]);
    render(<Mes />);
    const x = await screen.findByRole('link', { name: /^Terça-feira, 10 de novembro, 3 eventos/ });
    expect([...x.querySelectorAll('.mes-titulo')].map((e) => e.textContent)).toEqual(['Aula', 'Seminário']);
  });

  it('dia que já passou fica atenuado e diz "passado"; hoje e os próximos, não', async () => {
    const agenda = await agendaDeTeste();
    agenda.responder([]);
    render(<Mes />);
    const ontem = celula(/^Quarta-feira, 4 de novembro/);
    expect(ontem.getAttribute('data-passado')).toBe('true');
    expect(ontem.getAttribute('aria-label')).toContain('passado');
    expect(celula(/^Quinta-feira, 5 de novembro/).getAttribute('data-passado')).toBe('false');
    expect(celula(/^Sexta-feira, 6 de novembro/).getAttribute('data-passado')).toBe('false');
    expect(celula(/^Sexta-feira, 6 de novembro/).getAttribute('aria-label')).not.toContain('passado');
  });

  it('a legenda explica pontos, anéis e dias passados', async () => {
    const agenda = await agendaDeTeste();
    agenda.responder([]);
    render(<Mes />);
    expect(screen.getByText('Ponto cheio: evento. Anel: tarefa. Dias que já passaram ficam mais claros.')).toBeTruthy();
  });

  it('evento de dia inteiro de vários dias conta em cada dia; o que cruza a meia-noite, nos dois; o recusado, em nenhum', async () => {
    const agenda = await agendaDeTeste();
    agenda.responder([
      evento('Congresso', { diaInteiro: true, inicio: '2026-11-12', fim: '2026-11-15' }),
      em('2026-11-20', '22:00', '23:00', 'Plantão', { fim: '2026-11-21T02:00:00+00:00' }),
      em('2026-11-22', '09:00', '10:00', 'Convite recusado', { recusado: true }),
    ]);
    render(<Mes />);
    await screen.findByRole('link', { name: /^Quinta-feira, 12 de novembro, 1 evento/ });
    for (const d of [/^Quinta-feira, 12 de novembro, 1 evento/, /^Sexta-feira, 13 de novembro, 1 evento/, /^Sábado, 14 de novembro, 1 evento/]) {
      expect(celula(d)).toBeTruthy();
    }
    expect(celula('Domingo, 15 de novembro, sem compromissos')).toBeTruthy();
    expect(celula(/^Sexta-feira, 20 de novembro, 1 evento/)).toBeTruthy();
    expect(celula(/^Sábado, 21 de novembro, 1 evento/)).toBeTruthy();
    expect(celula('Domingo, 22 de novembro, sem compromissos')).toBeTruthy();
    expect(screen.getByText('1 evento recusado fica escondido.')).toBeTruthy();
  });

  describe('outros meses', () => {
    it('navegação: mês anterior, próximo e hoje', async () => {
      const agenda = await agendaDeTeste();
      agenda.responder([]);
      render(<Mes />);
      const nav = within(screen.getByRole('navigation', { name: 'Meses' }));
      expect(nav.getByRole('link', { name: 'Mês anterior' }).getAttribute('href')).toBe('#/mes?d=2026-10-01');
      expect(nav.getByRole('link', { name: 'Próximo mês' }).getAttribute('href')).toBe('#/mes?d=2026-12-01');
      expect(nav.getByRole('link', { name: 'Hoje' }).getAttribute('href')).toBe('#/mes');
    });

    it('dezembro de 2026 passa para janeiro de 2027, e janeiro de 2027 volta a dezembro', async () => {
      const agenda = await agendaDeTeste();
      agenda.responder([]);
      const { unmount } = render(<Mes data="2026-12-10" />);
      expect(within(screen.getByRole('navigation', { name: 'Meses' })).getByRole('link', { name: 'Próximo mês' }).getAttribute('href')).toBe('#/mes?d=2027-01-01');
      // A grade de dezembro termina em 3/1/2027.
      expect(celula(/^Domingo, 3 de janeiro de 2027/).getAttribute('data-fora')).toBe('true');
      unmount();
      render(<Mes data="2027-01-15" />);
      expect(screen.getByRole('table', { name: 'Janeiro de 2027' })).toBeTruthy();
      expect(within(screen.getByRole('navigation', { name: 'Meses' })).getByRole('link', { name: 'Mês anterior' }).getAttribute('href')).toBe('#/mes?d=2026-12-01');
      expect(celula(/^Segunda-feira, 28 de dezembro,/).getAttribute('data-fora')).toBe('true');
    });

    it('as semanas de fora do mês também mostram os eventos delas', async () => {
      const agenda = await agendaDeTeste();
      agenda.responderPeloPeriodo([em('2026-12-31', '20:00', '23:00', 'Ceia'), em('2027-01-02', '12:00', '13:00', 'Almoço')]);
      render(<Mes data="2027-01-15" />);
      expect(await screen.findByRole('link', { name: /^Quinta-feira, 31 de dezembro, 1 evento/ })).toBeTruthy();
      expect(celula(/^Sábado, 2 de janeiro de 2027, 1 evento/)).toBeTruthy();
      await waitFor(() => expect(agenda.leituras().map((p) => p.dados)).toContainEqual({ de: '2026-12-28', ate: '2027-01-31' }));
    });

    it('fevereiro de 2027 cabe em quatro semanas', async () => {
      const agenda = await agendaDeTeste();
      agenda.responder([]);
      render(<Mes data="2027-02-10" />);
      expect(within(screen.getByRole('table', { name: 'Fevereiro de 2027' })).getAllByRole('link')).toHaveLength(28);
    });

    it('mês que não é o de hoje não marca nenhum dia como hoje', async () => {
      const agenda = await agendaDeTeste();
      agenda.responder([]);
      render(<Mes data="2026-12-10" />);
      expect(document.querySelectorAll('[aria-current="date"]')).toHaveLength(0);
      // Todos de dezembro estão no futuro; os de novembro na grade (30/11) são de hoje em diante também.
      expect(celula(/^Segunda-feira, 30 de novembro/).getAttribute('data-passado')).toBe('false');
    });
  });

  it('a agenda que não carrega avisa, e as tarefas continuam na grade', async () => {
    const agenda = await agendaDeTeste();
    agenda.falharEventosCom('rede');
    await criar('Ligar para a Renata', { data: '2026-11-11' });
    render(<Mes />);
    expect(await screen.findByText('Agenda não carregou')).toBeTruthy();
    expect(await screen.findByRole('link', { name: 'Quarta-feira, 11 de novembro, 1 tarefa' })).toBeTruthy();
  });

  it('é só leitura: só há links e o botão de tentar de novo', async () => {
    const agenda = await agendaDeTeste();
    agenda.responder([em('2026-11-10', '09:00', '10:00', 'Aula')]);
    render(<Mes />);
    await screen.findByRole('link', { name: /1 evento/ });
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(document.querySelector('input, textarea, select')).toBeNull();
  });
});

describe('Ano', () => {
  const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

  it('mostra os doze meses, cada um com um link que abre o mês', async () => {
    const agenda = await agendaDeTeste();
    agenda.responder([]);
    render(<Ano />);
    const links = screen.getAllByRole('link').filter((a) => a.closest('.ano-mes'));
    expect(links.map((a) => a.textContent)).toEqual(MESES);
    expect(links[0].getAttribute('href')).toBe('#/mes?d=2026-01-01');
    expect(links[10].getAttribute('href')).toBe('#/mes?d=2026-11-01');
    expect(links[11].getAttribute('href')).toBe('#/mes?d=2026-12-01');
  });

  it('lê o ano inteiro de uma vez', async () => {
    const agenda = await agendaDeTeste();
    agenda.responder([]);
    render(<Ano />);
    await waitFor(() => expect(agenda.leituras().length).toBeGreaterThan(0));
    // Um pedido só para o ano inteiro, não um por mês.
    expect(agenda.leituras().every((p) => p.dados.de === '2026-01-01' && p.dados.ate === '2026-12-31')).toBe(true);
  });

  it('o mês de hoje fica marcado, em palavras; hoje no mini calendário também', async () => {
    const agenda = await agendaDeTeste();
    agenda.responder([]);
    render(<Ano />);
    const novembro = screen.getByRole('link', { name: 'Novembro' });
    expect(novembro.getAttribute('aria-current')).toBe('date');
    expect(document.querySelectorAll('[aria-current="date"]')).toHaveLength(1);
    const mini = novembro.closest('.ano-mes') as HTMLElement;
    expect(within(mini).getByText('mês atual')).toBeTruthy();
    expect(mini.querySelectorAll('[data-hoje="true"]')).toHaveLength(1);
    expect(mini.querySelector('[data-hoje="true"]')?.textContent).toBe('5');
  });

  it('cada mês diz quantos dias têm compromissos, e os dias aparecem marcados no mini calendário', async () => {
    const agenda = await agendaDeTeste();
    agenda.responder([
      em('2026-11-10', '09:00', '10:00', 'Aula'),
      em('2026-11-10', '11:00', '12:00', 'Seminário'),
      em('2026-11-11', '09:00', '10:00', 'Defesa'),
      em('2026-03-02', '09:00', '10:00', 'Início do semestre'),
    ]);
    await criar('Entregar relatório', { data: '2026-11-20', prazoHora: '17:00' });
    render(<Ano />);
    const mes = (nome: string) => screen.getByRole('link', { name: nome }).closest('.ano-mes') as HTMLElement;
    await waitFor(() => expect(within(mes('Novembro')).getByText('3 dias com compromissos')).toBeTruthy());
    expect(within(mes('Março')).getByText('1 dia com compromisso')).toBeTruthy();
    expect(within(mes('Janeiro')).getByText('Sem compromissos')).toBeTruthy();
    const marcados = [...mes('Novembro').querySelectorAll('[data-tem="true"]')].map((e) => e.textContent);
    expect(marcados).toEqual(['10', '11', '20']);
  });

  it('o mini calendário não aparece para o leitor de tela (a contagem já diz), e os dias de fora do mês ficam vazios', async () => {
    const agenda = await agendaDeTeste();
    agenda.responder([]);
    render(<Ano />);
    const mini = screen.getByRole('link', { name: 'Novembro' }).closest('.ano-mes')!.querySelector('.ano-mini') as HTMLElement;
    expect(mini.getAttribute('aria-hidden')).toBe('true');
    // Novembro de 2026: 30 dias numerados; o resto das semanas é vazio.
    expect([...mini.querySelectorAll('.ano-dia')].filter((d) => d.textContent !== '')).toHaveLength(30);
  });

  it('navegação: ano anterior, próximo e hoje', async () => {
    const agenda = await agendaDeTeste();
    agenda.responder([]);
    render(<Ano />);
    const nav = within(screen.getByRole('navigation', { name: 'Anos' }));
    expect(nav.getByRole('link', { name: 'Ano anterior' }).getAttribute('href')).toBe('#/ano?d=2025-01-01');
    expect(nav.getByRole('link', { name: 'Próximo ano' }).getAttribute('href')).toBe('#/ano?d=2027-01-01');
    expect(nav.getByRole('link', { name: 'Hoje' }).getAttribute('href')).toBe('#/ano');
  });

  it('2027: lê o ano de 2027, sem marcar mês atual, e mostra o que atravessa a virada', async () => {
    const agenda = await agendaDeTeste();
    agenda.responderPeloPeriodo([
      evento('Recesso', { diaInteiro: true, inicio: '2026-12-31', fim: '2027-01-03' }),
      em('2027-06-15', '09:00', '10:00', 'Defesa'),
    ]);
    const { unmount } = render(<Ano data="2027-03-01" />);
    await waitFor(() => expect(agenda.leituras().map((p) => p.dados)).toContainEqual({ de: '2027-01-01', ate: '2027-12-31' }));
    const janeiro = screen.getByRole('link', { name: 'Janeiro' }).closest('.ano-mes') as HTMLElement;
    await waitFor(() => expect(within(janeiro).getByText('2 dias com compromissos')).toBeTruthy());
    expect([...janeiro.querySelectorAll('[data-tem="true"]')].map((e) => e.textContent)).toEqual(['1', '2']);
    expect(document.querySelectorAll('[aria-current="date"]')).toHaveLength(0);
    unmount();

    render(<Ano />);
    const dezembro = screen.getByRole('link', { name: 'Dezembro' }).closest('.ano-mes') as HTMLElement;
    await waitFor(() => expect(within(dezembro).getByText('1 dia com compromisso')).toBeTruthy());
    expect([...dezembro.querySelectorAll('[data-tem="true"]')].map((e) => e.textContent)).toEqual(['31']);
  });

  it('ano bissexto: fevereiro de 2028 tem 29 dias numerados, e o pedido cabe no limite do script', async () => {
    const agenda = await agendaDeTeste();
    agenda.responder([]);
    render(<Ano data="2028-05-01" />);
    const fev = screen.getByRole('link', { name: 'Fevereiro' }).closest('.ano-mes') as HTMLElement;
    expect([...fev.querySelectorAll('.ano-dia')].filter((d) => d.textContent !== '')).toHaveLength(29);
    await waitFor(() => expect(agenda.leituras()[0].dados).toEqual({ de: '2028-01-01', ate: '2028-12-31' }));
  });

  it('a agenda que não carrega avisa; é só leitura', async () => {
    const agenda = await agendaDeTeste();
    agenda.falharEventosCom({ ok: false, erro: 'interno' });
    render(<Ano />);
    expect(await screen.findByText('Agenda não carregou')).toBeTruthy();
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Tentar de novo']);
  });
});
