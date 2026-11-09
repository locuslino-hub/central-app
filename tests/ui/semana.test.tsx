import { configure, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { semear } from '../../src/dados/loja';
import type { DiaDoCalendario, Item } from '../../src/dados/calendario';
import { horasDaSemana, posicoesNoDia, Semana } from '../../src/ui/Semana';
import { agendaDeTeste, evento } from '../apoio/agenda-ui';
import { criar } from '../apoio/tarefas';

// Quinta-feira, 2026-11-05, 12:20 (Europe/Lisbon). Só a data é falsa.
const AGORA = Date.parse('2026-11-05T12:20:00Z');

configure({ asyncUtilTimeout: 5000 });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AGORA);
  larguraDaJanela(1280);
});

function larguraDaJanela(largura: number) {
  Object.defineProperty(window, 'innerWidth', { value: largura, configurable: true, writable: true });
}

const em = (dia: string, inicio: string, fim: string, titulo: string, extra = {}) =>
  evento(titulo, { inicio: `${dia}T${inicio}:00+00:00`, fim: `${dia}T${fim}:00+00:00`, ...extra });

/** A seção de um dia, pelo nome por extenso no título. */
const secaoEl = (nome: RegExp | string) => screen.getByRole('heading', { level: 2, name: nome }).closest('section') as HTMLElement;
const secao = (nome: RegExp | string) => within(secaoEl(nome));

const titulos = (dentro: HTMLElement) => [...dentro.querySelectorAll('.cal-titulo')].map((e) => e.textContent);

describe('Semana (computador)', () => {
  it('abre na semana de hoje, de segunda a domingo, com hoje destacado e dito em palavras', async () => {
    const agenda = await agendaDeTeste();
    agenda.responder([]);
    render(<Semana />);

    const dias = screen.getAllByRole('heading', { level: 2 }).filter((h) => h.closest('.cal-dia'));
    expect(dias.map((h) => h.getAttribute('aria-label'))).toEqual([
      'Segunda-feira, 2 de novembro',
      'Terça-feira, 3 de novembro',
      'Quarta-feira, 4 de novembro',
      'Quinta-feira, 5 de novembro, hoje',
      'Sexta-feira, 6 de novembro',
      'Sábado, 7 de novembro',
      'Domingo, 8 de novembro',
    ]);
    const hoje = dias[3].closest('section') as HTMLElement;
    expect(hoje.getAttribute('data-hoje')).toBe('true');
    expect(dias[3].getAttribute('aria-current')).toBe('date');
    expect(within(hoje).getByText('hoje')).toBeTruthy();
    // Só um dia é "hoje".
    expect(document.querySelectorAll('[data-hoje="true"]')).toHaveLength(1);
    expect(screen.getByText('2 a 8 de novembro de 2026')).toBeTruthy();
    await waitFor(() => expect(agenda.leituras().map((p) => p.dados)).toContainEqual({ de: '2026-11-02', ate: '2026-11-08' }));
  });

  it('pede os eventos da semana toda, segunda a domingo', async () => {
    const agenda = await agendaDeTeste();
    render(<Semana />);
    await waitFor(() => expect(agenda.leituras().length).toBeGreaterThan(0));
    await screen.findAllByText('Nada marcado.');
    // Um pedido só para a semana toda, não um por dia.
    expect(agenda.leituras().every((p) => p.dados.de === '2026-11-02' && p.dados.ate === '2026-11-08')).toBe(true);
  });

  it('cada evento fica no seu dia, por hora', async () => {
    const agenda = await agendaDeTeste();
    agenda.responder([
      em('2026-11-05', '16:30', '17:15', 'Reunião de orientação'),
      em('2026-11-05', '09:00', '11:00', 'Aula de Modelagem'),
      em('2026-11-03', '10:00', '11:00', 'Seminário'),
      em('2026-11-08', '18:00', '19:00', 'Jantar'),
    ]);
    render(<Semana />);
    await screen.findByText('Seminário');
    expect(titulos(secaoEl(/^Quinta/))).toEqual(['Aula de Modelagem', 'Reunião de orientação']);
    expect(titulos(secaoEl(/^Terça/))).toEqual(['Seminário']);
    expect(titulos(secaoEl(/^Domingo/))).toEqual(['Jantar']);
    expect(secao(/^Segunda/).getByText('Nada marcado.')).toBeTruthy();
  });

  it('passado atenuado com a palavra; livre com a palavra; recusado escondido e contado', async () => {
    const agenda = await agendaDeTeste();
    agenda.responder([
      em('2026-11-04', '09:00', '10:00', 'Ontem'),
      em('2026-11-05', '12:00', '13:00', 'Agora mesmo'),
      em('2026-11-06', '09:00', '10:00', 'Bloqueio', { livre: true }),
      em('2026-11-06', '11:00', '12:00', 'Convite recusado', { recusado: true }),
    ]);
    render(<Semana />);
    const ontem = (await screen.findByText('Ontem')).closest('li') as HTMLElement;
    expect(ontem.getAttribute('data-passado')).toBe('true');
    expect(within(ontem).getByText('passado')).toBeTruthy();
    const agoraMesmo = screen.getByText('Agora mesmo').closest('li') as HTMLElement;
    expect(agoraMesmo.getAttribute('data-passado')).toBe('false');
    expect(within(agoraMesmo).queryByText('passado')).toBeNull();
    const livre = screen.getByText('Bloqueio').closest('li') as HTMLElement;
    expect(within(livre).getByText('livre')).toBeTruthy();
    expect(screen.queryByText('Convite recusado')).toBeNull();
    expect(screen.getByText('1 evento recusado fica escondido.')).toBeTruthy();
  });

  it('dia inteiro de vários dias aparece em cada dia que cobre; evento que cruza a meia-noite, nos dois', async () => {
    const agenda = await agendaDeTeste();
    agenda.responder([
      evento('Congresso', { diaInteiro: true, inicio: '2026-11-05', fim: '2026-11-08' }),
      em('2026-11-05', '22:00', '23:30', 'Plantão', { fim: '2026-11-06T01:00:00+00:00' }),
    ]);
    render(<Semana />);
    await screen.findAllByText('Congresso');
    expect(screen.getAllByText('Congresso')).toHaveLength(3);
    for (const dia of [/^Quinta/, /^Sexta/, /^Sábado/]) expect(secao(dia).getByText('Congresso')).toBeTruthy();
    expect(secao(/^Domingo/).queryByText('Congresso')).toBeNull();
    expect(secao(/^Quinta/).getByText('Plantão').closest('li')!.textContent).toContain('22:00, continua no dia seguinte');
    expect(secao(/^Sexta/).getByText('Plantão').closest('li')!.textContent).toContain('Continuação do dia anterior, até 01:00');
  });

  it('o dia inteiro vem antes dos horários, no começo do dia', async () => {
    const agenda = await agendaDeTeste();
    agenda.responder([em('2026-11-05', '08:00', '09:00', 'Cedo'), evento('Feriado', { diaInteiro: true, inicio: '2026-11-05', fim: '2026-11-06' })]);
    render(<Semana />);
    await screen.findByText('Cedo');
    expect(titulos(secaoEl(/^Quinta/))).toEqual(['Feriado', 'Cedo']);
  });

  describe('tarefas', () => {
    it('o prazo é um marcador no dia, sem bloco; a tarefa com hora é bloco; a só com dia vem no começo', async () => {
      const agenda = await agendaDeTeste();
      agenda.responder([]);
      await criar('Entregar relatório', { data: '2026-11-06', prazoHora: '17:00' });
      await criar('Reunião com a Marina', { data: '2026-11-06', inicio: '10:00', duracaoMin: 30 });
      await criar('Ligar para a Renata', { data: '2026-11-06' });
      render(<Semana />);

      const sexta = secao(/^Sexta/);
      await sexta.findByText('Entregar relatório');
      const prazo = sexta.getByText('Entregar relatório').closest('li') as HTMLElement;
      expect(prazo.getAttribute('data-tipo')).toBe('prazo');
      expect(prazo.textContent).toContain('Prazo às 17:00');
      expect(sexta.getByText('Reunião com a Marina').closest('li')!.getAttribute('data-tipo')).toBe('bloco');
      expect(titulos(secaoEl(/^Sexta/))).toEqual(['Ligar para a Renata', 'Reunião com a Marina', 'Entregar relatório']);
    });

    it('"Esta semana": as tarefas da semana sem dia aparecem no alto, só desta semana', async () => {
      const agenda = await agendaDeTeste();
      agenda.responder([]);
      await criar('Ler o artigo da Aurora', { semana: '2026-11-02' });
      await criar('Planejar o semestre', { semana: '2026-11-09' });
      render(<Semana />);
      const caixa = within((await screen.findByRole('heading', { level: 2, name: 'Tarefas da semana' })).closest('section') as HTMLElement);
      expect(await caixa.findByText('Ler o artigo da Aurora')).toBeTruthy();
      expect(caixa.queryByText('Planejar o semestre')).toBeNull();
    });

    it('sem tarefas da semana, a caixa não aparece', async () => {
      const agenda = await agendaDeTeste();
      agenda.responder([]);
      render(<Semana />);
      await screen.findAllByText('Nada marcado.');
      expect(screen.queryByRole('heading', { name: 'Tarefas da semana' })).toBeNull();
    });
  });

  describe('navegação', () => {
    it('semana anterior, próxima e hoje são links para as outras semanas', async () => {
      const agenda = await agendaDeTeste();
      agenda.responder([]);
      render(<Semana />);
      const nav = within(screen.getByRole('navigation', { name: 'Semanas' }));
      expect(nav.getByRole('link', { name: 'Semana anterior' }).getAttribute('href')).toBe('#/semana?d=2026-10-26');
      expect(nav.getByRole('link', { name: 'Próxima semana' }).getAttribute('href')).toBe('#/semana?d=2026-11-09');
      expect(nav.getByRole('link', { name: 'Hoje' }).getAttribute('href')).toBe('#/semana');
    });

    it('outra semana: lê aquela semana, não destaca nenhum dia e mostra o período', async () => {
      const agenda = await agendaDeTeste();
      agenda.responder([em('2026-11-10', '09:00', '10:00', 'Defesa de Aurora')]);
      render(<Semana data="2026-11-12" />);
      await screen.findByText('Defesa de Aurora');
      expect(screen.getByText('9 a 15 de novembro de 2026')).toBeTruthy();
      expect(document.querySelectorAll('[data-hoje="true"]')).toHaveLength(0);
      expect(agenda.leituras().map((p) => p.dados)).toContainEqual({ de: '2026-11-09', ate: '2026-11-15' });
      const nav = within(screen.getByRole('navigation', { name: 'Semanas' }));
      expect(nav.getByRole('link', { name: 'Semana anterior' }).getAttribute('href')).toBe('#/semana?d=2026-11-02');
      expect(nav.getByRole('link', { name: 'Próxima semana' }).getAttribute('href')).toBe('#/semana?d=2026-11-16');
    });

    it('a semana do fim do ano entra em 2027, com eventos dos dois anos', async () => {
      const agenda = await agendaDeTeste();
      agenda.responder([em('2026-12-31', '20:00', '23:00', 'Ceia'), em('2027-01-01', '12:00', '14:00', 'Almoço de ano novo')]);
      render(<Semana data="2026-12-31" />);
      await screen.findByText('Almoço de ano novo');
      expect(screen.getByText('28 de dezembro de 2026 a 3 de janeiro de 2027')).toBeTruthy();
      expect(secao(/^Quinta-feira, 31 de dezembro/).getByText('Ceia')).toBeTruthy();
      expect(secao(/^Sexta-feira, 1 de janeiro de 2027/).getByText('Almoço de ano novo')).toBeTruthy();
      expect(
        within(screen.getByRole('navigation', { name: 'Semanas' })).getByRole('link', { name: 'Próxima semana' }).getAttribute('href'),
      ).toBe('#/semana?d=2027-01-04');
    });

    it('a semana da mudança de hora (25/10): sete dias, e a hora repetida mostra os dois eventos', async () => {
      const agenda = await agendaDeTeste();
      agenda.responder([
        evento('Primeira 01:30', { inicio: '2026-10-25T01:30:00+01:00', fim: '2026-10-25T01:50:00+01:00' }),
        evento('Segunda 01:30', { inicio: '2026-10-25T01:30:00+00:00', fim: '2026-10-25T02:00:00+00:00' }),
        evento('Depois da mudança', { inicio: '2026-10-25T09:00:00+00:00', fim: '2026-10-25T10:00:00+00:00' }),
      ]);
      render(<Semana data="2026-10-25" />);
      await screen.findByText('Depois da mudança');
      const dias = screen.getAllByRole('heading', { level: 2 }).filter((h) => h.closest('.cal-dia'));
      expect(dias).toHaveLength(7);
      expect(dias[6].getAttribute('aria-label')).toBe('Domingo, 25 de outubro');
      expect(titulos(secaoEl(/^Domingo/))).toEqual(['Primeira 01:30', 'Segunda 01:30', 'Depois da mudança']);
      expect(secao(/^Domingo/).getByText('Depois da mudança').closest('li')!.textContent).toContain('09:00 às 10:00');
      expect(screen.getByText('19 a 25 de outubro de 2026')).toBeTruthy();
    });
  });

  describe('detalhes', () => {
    it('clicar num evento mostra os detalhes com "Abrir no Google Agenda", e não há como editar', async () => {
      await semear();
      const agenda = await agendaDeTeste();
      agenda.responder([
        em('2026-11-06', '10:00', '11:00', 'Defesa de Aurora', {
          salaId: 'sala-orientacoes',
          link: 'https://calendar.google.com/calendar/event?eid=XYZ',
        }),
      ]);
      render(<Semana />);
      const botao = await secao(/^Sexta/).findByRole('button', { name: /Defesa de Aurora/ });
      fireEvent.click(botao);
      const dialogo = within(screen.getByRole('dialog', { name: 'Defesa de Aurora' }));
      expect(dialogo.getByText('Sexta, 6/11, das 10:00 às 11:00')).toBeTruthy();
      const abrir = dialogo.getByRole('link', { name: 'Abrir no Google Agenda' });
      expect(abrir.getAttribute('href')).toBe('https://calendar.google.com/calendar/event?eid=XYZ');
      expect(abrir.getAttribute('target')).toBe('_blank');
      expect(abrir.getAttribute('rel')).toBe('noopener noreferrer');
      expect([...document.querySelectorAll('button')].map((b) => b.textContent).join('|')).not.toMatch(/Editar|Mover|Apagar|Excluir/);
      fireEvent.click(dialogo.getByRole('button', { name: 'Fechar' }));
      expect(document.activeElement).toBe(botao);
    });

    it('a tela inteira é só leitura: os únicos botões abrem detalhes', async () => {
      const agenda = await agendaDeTeste();
      agenda.responder([em('2026-11-06', '10:00', '11:00', 'Defesa de Aurora')]);
      await criar('Ligar para a Renata', { data: '2026-11-06' });
      render(<Semana />);
      await screen.findByText('Defesa de Aurora');
      const botoes = screen.getAllByRole('button');
      expect(botoes.map((b) => b.textContent)).toHaveLength(1);
      expect(botoes[0].textContent).toContain('Defesa de Aurora');
      expect(document.querySelector('input, textarea, select')).toBeNull();
    });
  });

  describe('quando a agenda não carrega', () => {
    it('avisa, e as tarefas continuam à vista', async () => {
      const agenda = await agendaDeTeste();
      agenda.falharEventosCom('rede');
      await criar('Ligar para a Renata', { data: '2026-11-06' });
      render(<Semana />);
      expect(await screen.findByText('Agenda não carregou')).toBeTruthy();
      expect(screen.getByText('Sem internet.')).toBeTruthy();
      expect(await secao(/^Sexta/).findByText('Ligar para a Renata')).toBeTruthy();
    });

    it('código inválido com o ping funcionando: ainda não liberada', async () => {
      const agenda = await agendaDeTeste();
      agenda.falharEventosCom({ ok: false, erro: 'codigo-invalido' });
      render(<Semana />);
      expect(await screen.findByText('Agenda ainda não liberada — falta aprovar a permissão no script')).toBeTruthy();
    });

    it('algumas agendas não carregaram', async () => {
      const agenda = await agendaDeTeste();
      agenda.responder([em('2026-11-06', '10:00', '11:00', 'Defesa de Aurora')], true);
      render(<Semana />);
      expect(await screen.findByText('Algumas agendas não carregaram')).toBeTruthy();
    });
  });
});

describe('Semana (celular, 390 px): um dia de cada vez', () => {
  beforeEach(() => larguraDaJanela(390));

  const dia = (nome: RegExp | string) => screen.getByRole('button', { name: nome });

  it('abre no dia de hoje, com a faixa dos sete dias e só o dia escolhido embaixo', async () => {
    const agenda = await agendaDeTeste();
    agenda.responder([em('2026-11-05', '09:00', '10:00', 'Aula de hoje'), em('2026-11-06', '09:00', '10:00', 'Aula de sexta')]);
    render(<Semana />);

    const faixa = within(screen.getByRole('group', { name: 'Dias da semana' }));
    expect(faixa.getAllByRole('button')).toHaveLength(7);
    expect(dia(/^Quinta-feira, 5 de novembro, hoje/).getAttribute('aria-pressed')).toBe('true');
    expect(dia(/^Sexta-feira/).getAttribute('aria-pressed')).toBe('false');
    expect(await screen.findByText('Aula de hoje')).toBeTruthy();
    expect(screen.queryByText('Aula de sexta')).toBeNull();
  });

  it('escolher outro dia troca o que aparece e quem está marcado', async () => {
    const agenda = await agendaDeTeste();
    agenda.responder([em('2026-11-05', '09:00', '10:00', 'Aula de hoje'), em('2026-11-06', '09:00', '10:00', 'Aula de sexta')]);
    render(<Semana />);
    await screen.findByText('Aula de hoje');
    fireEvent.click(dia(/^Sexta-feira/));
    expect(await screen.findByText('Aula de sexta')).toBeTruthy();
    expect(screen.queryByText('Aula de hoje')).toBeNull();
    expect(dia(/^Sexta-feira/).getAttribute('aria-pressed')).toBe('true');
    expect(dia(/^Quinta-feira/).getAttribute('aria-pressed')).toBe('false');
  });

  it('cada dia da faixa diz quantos itens tem', async () => {
    const agenda = await agendaDeTeste();
    agenda.responder([em('2026-11-06', '09:00', '10:00', 'A'), em('2026-11-06', '11:00', '12:00', 'B')]);
    render(<Semana />);
    await waitFor(() => expect(dia(/^Sexta-feira, 6 de novembro, 2 itens$/)).toBeTruthy());
    expect(dia(/^Segunda-feira, 2 de novembro, nada marcado$/)).toBeTruthy();
  });

  it('outra semana abre na segunda-feira; com ?d= abre no dia pedido', async () => {
    const agenda = await agendaDeTeste();
    agenda.responder([]);
    const { unmount } = render(<Semana data="2026-11-12" />);
    expect(dia(/^Quinta-feira, 12 de novembro/).getAttribute('aria-pressed')).toBe('true');
    unmount();
    render(<Semana data="2026-11-03" />);
    expect(dia(/^Terça-feira, 3 de novembro/).getAttribute('aria-pressed')).toBe('true');
  });

  it('semana sem hoje e sem dia pedido abre na segunda', async () => {
    const agenda = await agendaDeTeste();
    agenda.responder([]);
    render(<Semana data="2026-11-16" />);
    expect(dia(/^Segunda-feira, 16 de novembro/).getAttribute('aria-pressed')).toBe('true');
  });

  it('ao trocar de semana, o dia escolhido volta ao padrão da semana nova', async () => {
    const agenda = await agendaDeTeste();
    agenda.responder([]);
    const { rerender } = render(<Semana />);
    fireEvent.click(dia(/^Sábado/));
    expect(dia(/^Sábado/).getAttribute('aria-pressed')).toBe('true');
    rerender(<Semana data="2026-11-09" />);
    expect(dia(/^Segunda-feira, 9 de novembro/).getAttribute('aria-pressed')).toBe('true');
  });

  it('tem os mesmos links de semana anterior, próxima e hoje', async () => {
    const agenda = await agendaDeTeste();
    agenda.responder([]);
    render(<Semana />);
    const nav = within(screen.getByRole('navigation', { name: 'Semanas' }));
    expect(nav.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['#/semana?d=2026-10-26', '#/semana', '#/semana?d=2026-11-09']);
  });
});

describe('Semana (computador): grade de horas, como no modelo', () => {
  const bloco = (ini: number, fim: number, extra: Partial<{ continuaAntes: boolean; continuaDepois: boolean }> = {}) =>
    ({ tipo: 'evento', chave: `${ini}-${fim}`, ini, fim, continuaAntes: false, continuaDepois: false, ...extra }) as unknown as Item;
  const dia = (horarios: Item[]) => ({ data: '2026-11-05', diaInteiro: [], horarios, recusados: 0, total: horarios.length }) as DiaDoCalendario;

  it('a grade vai das 8h às 20h e cresce para o que começa antes ou acaba depois', () => {
    expect(horasDaSemana([dia([bloco(9 * 60, 10 * 60)])])).toEqual({ de: 8, ate: 20 });
    expect(horasDaSemana([dia([bloco(7 * 60 + 30, 9 * 60)]), dia([bloco(20 * 60, 21 * 60 + 15)])])).toEqual({ de: 7, ate: 22 });
    // O que cruza a meia-noite não estica a grade até 0h nem até 24h.
    expect(horasDaSemana([dia([bloco(22 * 60, 1440, { continuaDepois: true })]), dia([bloco(0, 60, { continuaAntes: true })])])).toEqual({ de: 8, ate: 23 });
  });

  it('cada bloco tem começo e duração na grade; o que se sobrepõe divide a largura', () => {
    const horas = { de: 8, ate: 20 };
    const [a, b, c, d] = posicoesNoDia([bloco(9 * 60, 11 * 60), bloco(10 * 60, 11 * 60), bloco(14 * 60, 15 * 60), bloco(15 * 60, 16 * 60)], horas);
    expect(a).toEqual({ ini: 60, fim: 180, coluna: 0, colunas: 2 });
    expect(b).toEqual({ ini: 120, fim: 180, coluna: 1, colunas: 2 });
    expect(c).toEqual({ ini: 360, fim: 420, coluna: 0, colunas: 1 });
    expect(d).toEqual({ ini: 420, fim: 480, coluna: 0, colunas: 1 });
    // Um bloco curto ocupa na tela pelo menos um toque: o seguinte, colado nele, vai para o lado.
    const [e, f] = posicoesNoDia([bloco(9 * 60, 9 * 60 + 15), bloco(9 * 60 + 30, 10 * 60)], horas);
    expect([e.colunas, f.coluna]).toEqual([2, 1]);
    // O que vem do dia anterior começa no alto.
    expect(posicoesNoDia([bloco(0, 60, { continuaAntes: true })], horas)[0]).toMatchObject({ ini: 0, fim: 0 });
  });

  it('a página mostra a régua das horas, os blocos posicionados e a linha de agora só em hoje', async () => {
    const agenda = await agendaDeTeste();
    agenda.responder([em('2026-11-05', '09:00', '10:30', 'Aula de métodos'), em('2026-11-03', '14:00', '15:00', 'Seminário')]);
    render(<Semana />);
    await screen.findByText('Aula de métodos');
    const regua = document.querySelector('.sem-regua') as HTMLElement;
    expect(regua.getAttribute('aria-hidden')).toBe('true');
    expect(regua.textContent).toContain('8h');
    expect(regua.textContent).toContain('19h');
    const aula = screen.getByText('Aula de métodos').closest('li') as HTMLElement;
    expect(aula.style.getPropertyValue('--ini')).toBe('60');
    expect(aula.style.getPropertyValue('--dur')).toBe('90');
    expect(document.querySelectorAll('.sem-agora')).toHaveLength(1);
    expect(secaoEl(/^Quinta/).querySelector('.sem-agora')).not.toBeNull();
    expect((secaoEl(/^Quinta/).querySelector('.sem-agora') as HTMLElement).style.getPropertyValue('--ini')).toBe(String(4 * 60 + 20));
  });
});
