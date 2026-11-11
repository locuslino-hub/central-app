import { act, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { criarCompromisso, desfazerCompromisso } from '../../src/dados/compromisso';
import { semear } from '../../src/dados/loja';
import { AgendaHoje } from '../../src/ui/AgendaHoje';
import { DetalheEvento } from '../../src/ui/DetalheEvento';
import { agendaDeTeste, evento } from '../apoio/agenda-ui';
import { criar } from '../apoio/tarefas';

// Quinta-feira, 2026-11-05, 12:20 (Europe/Lisbon). Só a data é falsa.
const AGORA = Date.parse('2026-11-05T12:20:00Z');

// Consultas por papel e nome são lentas no jsdom; o padrão de 1 s é curto para a primeira.
configure({ asyncUtilTimeout: 5000 });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AGORA);
});

const cartao = () => within(screen.getByRole('region', { name: 'Agenda de hoje' }));

const aula = () => evento('Aula de Modelagem', { inicio: '2026-11-05T09:00:00+00:00', fim: '2026-11-05T11:00:00+00:00', salaId: 'sala-aulas' });
const agoraMesmo = () => evento('Foco na dissertação', { inicio: '2026-11-05T12:00:00+00:00', fim: '2026-11-05T13:00:00+00:00' });
const reuniao = () => evento('Reunião de orientação', { inicio: '2026-11-05T16:30:00+00:00', fim: '2026-11-05T17:15:00+00:00', salaId: 'sala-orientacoes' });

describe('Agenda de hoje', () => {
  it('lista os compromissos de hoje, por hora, com a hora e o título', async () => {
    const agenda = await agendaDeTeste();
    agenda.responder([reuniao(), aula(), evento('Amanhã cedo', { inicio: '2026-11-06T08:00:00+00:00', fim: '2026-11-06T09:00:00+00:00' })]);
    // O script só devolve o que toca o dia pedido: o filtro por dia é do app, como na semana.
    agenda.responderPeloPeriodo([reuniao(), aula(), evento('Amanhã cedo', { inicio: '2026-11-06T08:00:00+00:00', fim: '2026-11-06T09:00:00+00:00' })]);
    render(<AgendaHoje />);

    const itens = await cartao().findAllByRole('listitem');
    expect(itens.map((i) => i.querySelector('.cal-titulo')?.textContent)).toEqual(['Aula de Modelagem', 'Reunião de orientação']);
    expect(itens[0].textContent).toContain('09:00 às 11:00');
    expect(itens[1].textContent).toContain('16:30 às 17:15');
    expect(cartao().queryByText('Amanhã cedo')).toBeNull();
    expect(agenda.leituras()[0].dados).toEqual({ de: '2026-11-05', ate: '2026-11-05' });
  });

  it('o que já passou fica atenuado e leva a palavra "passado"; o que ainda vale, não', async () => {
    const agenda = await agendaDeTeste();
    agenda.responder([aula(), agoraMesmo(), reuniao()]);
    render(<AgendaHoje />);

    const item = async (titulo: string) => (await cartao().findByText(titulo)).closest('li') as HTMLElement;
    const passada = await item('Aula de Modelagem');
    expect(passada.getAttribute('data-passado')).toBe('true');
    expect(within(passada).getByText('passado')).toBeTruthy();
    for (const titulo of ['Foco na dissertação', 'Reunião de orientação']) {
      const vale = await item(titulo);
      expect(vale.getAttribute('data-passado')).toBe('false');
      expect(within(vale).queryByText('passado')).toBeNull();
    }
  });

  it('o evento livre leva a palavra "livre" e fica mais leve; o recusado não aparece', async () => {
    const agenda = await agendaDeTeste();
    agenda.responder([
      evento('Bloqueio de foco', { livre: true, inicio: '2026-11-05T14:00:00+00:00', fim: '2026-11-05T15:00:00+00:00' }),
      evento('Convite recusado', { recusado: true, inicio: '2026-11-05T15:00:00+00:00', fim: '2026-11-05T16:00:00+00:00' }),
    ]);
    render(<AgendaHoje />);

    const livre = (await cartao().findByText('Bloqueio de foco')).closest('li') as HTMLElement;
    expect(livre.getAttribute('data-livre')).toBe('true');
    expect(within(livre).getByText('livre')).toBeTruthy();
    expect(cartao().queryByText('Convite recusado')).toBeNull();
  });

  it('dia inteiro vem primeiro, com a marca "Dia inteiro"', async () => {
    const agenda = await agendaDeTeste();
    agenda.responder([aula(), evento('Feriado de Aurora', { diaInteiro: true, inicio: '2026-11-05', fim: '2026-11-06' })]);
    render(<AgendaHoje />);
    const itens = await cartao().findAllByRole('listitem');
    expect(itens[0].textContent).toContain('Feriado de Aurora');
    expect(itens[0].textContent).toContain('Dia inteiro');
  });

  it('evento que cruza a meia-noite diz que continua; o que veio de ontem diz isso', async () => {
    const agenda = await agendaDeTeste();
    agenda.responder([
      evento('Plantão', { inicio: '2026-11-05T22:00:00+00:00', fim: '2026-11-06T06:00:00+00:00' }),
      evento('Congresso noturno', { inicio: '2026-11-04T23:00:00+00:00', fim: '2026-11-05T02:00:00+00:00' }),
    ]);
    render(<AgendaHoje />);
    expect((await cartao().findByText('Plantão')).closest('li')!.textContent).toContain('22:00, continua no dia seguinte');
    expect(cartao().getByText('Congresso noturno').closest('li')!.textContent).toContain('Continuação do dia anterior, até 02:00');
  });

  it('só o que tem hora entra: o prazo é um marcador, a tarefa com hora é um bloco; a só com dia fica na Checklist', async () => {
    const agenda = await agendaDeTeste();
    agenda.responder([aula()]);
    await criar('Entregar relatório', { data: '2026-11-05', prazoHora: '17:00' });
    await criar('Reunião com a Marina', { data: '2026-11-05', inicio: '15:30', duracaoMin: 60, salaId: 'sala-orientacoes' });
    await criar('Ligar para a Renata', { data: '2026-11-05' });
    await criar('Tarefa de amanhã', { data: '2026-11-06', prazoHora: '10:00' });
    await criar('Sem dia');
    render(<AgendaHoje />);

    await cartao().findByText('Aula de Modelagem');
    const prazo = (await cartao().findByText('Entregar relatório')).closest('li') as HTMLElement;
    expect(prazo.getAttribute('data-tipo')).toBe('prazo');
    expect(prazo.textContent).toContain('Prazo às 17:00');
    expect(prazo.querySelector('button')).toBeNull();

    const bloco = cartao().getByText('Reunião com a Marina').closest('li') as HTMLElement;
    expect(bloco.getAttribute('data-tipo')).toBe('bloco');
    expect(bloco.textContent).toContain('15:30 às 16:30');

    // Tarefa só com dia já está na Checklist ao lado: aqui não se repete (Tarefa 16, rodada 1).
    expect(cartao().queryByText('Ligar para a Renata')).toBeNull();

    expect(cartao().queryByText('Tarefa de amanhã')).toBeNull();
    expect(cartao().queryByText('Sem dia')).toBeNull();

    // Ordem: pela hora (aula 09:00, reunião 15:30, prazo 17:00).
    const ordem = cartao().getAllByRole('listitem').map((i) => i.querySelector('.cal-titulo')?.textContent);
    expect(ordem).toEqual(['Aula de Modelagem', 'Reunião com a Marina', 'Entregar relatório']);
  });

  it('tarefa com hora feita leva "feita"; prazo que já passou leva "passado"', async () => {
    const agenda = await agendaDeTeste();
    agenda.responder([]);
    await criar('Enviar o resumo', { data: '2026-11-05', prazoHora: '09:00' });
    await criar('Reservar a sala', { data: '2026-11-05', inicio: '16:00', feito: true });
    render(<AgendaHoje />);
    const prazo = (await cartao().findByText('Enviar o resumo')).closest('li') as HTMLElement;
    expect(prazo.getAttribute('data-passado')).toBe('true');
    expect(within(prazo).getByText('passado')).toBeTruthy();
    const feita = cartao().getByText('Reservar a sala').closest('li') as HTMLElement;
    expect(within(feita).getByText('feita')).toBeTruthy();
  });

  it('mostra a sala do compromisso pelo nome', async () => {
    await semear();
    const agenda = await agendaDeTeste();
    agenda.responder([aula()]);
    render(<AgendaHoje />);
    const item = (await cartao().findByText('Aula de Modelagem')).closest('li') as HTMLElement;
    await waitFor(() => expect(within(item).getByText('Aulas')).toBeTruthy());
  });

  it('evento sem título aparece como "(sem título)", e o texto nunca vira HTML', async () => {
    const agenda = await agendaDeTeste();
    agenda.responder([evento('', {}), evento('<b>negrito</b> & <img src=x onerror=alert(1)>', { inicio: '2026-11-05T13:00:00+00:00', fim: '2026-11-05T14:00:00+00:00' })]);
    render(<AgendaHoje />);
    expect(await cartao().findByText('(sem título)')).toBeTruthy();
    expect(cartao().getByText('<b>negrito</b> & <img src=x onerror=alert(1)>')).toBeTruthy();
    expect(document.querySelector('.agenda-hoje b, .agenda-hoje img')).toBeNull();
  });

  describe('sem compromissos', () => {
    it('diz que não há nada marcado, depois de ler', async () => {
      const agenda = await agendaDeTeste();
      agenda.responder([]);
      render(<AgendaHoje />);
      expect(await cartao().findByText('Nada marcado para hoje.')).toBeTruthy();
    });

    it('se a agenda não carregou, não afirma que está vazia', async () => {
      const agenda = await agendaDeTeste();
      agenda.falharEventosCom({ ok: false, erro: 'interno' });
      render(<AgendaHoje />);
      await cartao().findByText('Agenda não carregou');
      await new Promise((pronto) => setTimeout(pronto, 150)); // dá tempo de as tarefas terminarem de ler
      expect(cartao().queryByText('Nada marcado para hoje.')).toBeNull();
    });
  });

  describe('quando a agenda não carrega', () => {
    it('sem internet: linha discreta e botão para tentar de novo', async () => {
      const agenda = await agendaDeTeste();
      agenda.falharEventosCom('rede');
      render(<AgendaHoje />);
      expect(await cartao().findByText('Agenda não carregou')).toBeTruthy();
      expect(cartao().getByText('Sem internet.')).toBeTruthy();
      agenda.responder([aula()]);
      fireEvent.click(cartao().getByRole('button', { name: 'Tentar de novo' }));
      expect(await cartao().findByText('Aula de Modelagem')).toBeTruthy();
      expect(cartao().queryByText('Agenda não carregou')).toBeNull();
    });

    it('aparelho sem conexão: leva a Conectar aparelho, sem chamar o script', async () => {
      const agenda = await agendaDeTeste([], { conectar: false });
      render(<AgendaHoje />);
      expect(await cartao().findByText('Agenda não carregou')).toBeTruthy();
      expect(cartao().getByText('Este aparelho ainda não está conectado.')).toBeTruthy();
      expect(cartao().getByRole('link', { name: 'Conectar aparelho' }).getAttribute('href')).toBe('#/conectar');
      expect(agenda.pedidos).toEqual([]);
    });

    it('código inválido com o ping funcionando: agenda ainda não liberada, sem mandar reconectar', async () => {
      const agenda = await agendaDeTeste();
      agenda.falharEventosCom({ ok: false, erro: 'codigo-invalido' });
      render(<AgendaHoje />);
      expect(await cartao().findByText('Agenda ainda não liberada — falta aprovar a permissão no script')).toBeTruthy();
      expect(agenda.pedidos.map((p) => p.acao)).toEqual(['eventos', 'ping']);
      expect(cartao().queryByRole('link', { name: 'Conectar aparelho' })).toBeNull();
      expect(document.body.textContent).not.toMatch(/reconect|conecte/i);
    });

    it('código inválido e o ping também recusa: o código do aparelho não vale, e só aí leva a reconectar', async () => {
      const agenda = await agendaDeTeste();
      agenda.falharEventosCom({ ok: false, erro: 'codigo-invalido' });
      agenda.ping({ ok: false, erro: 'codigo-invalido' });
      render(<AgendaHoje />);
      expect(await cartao().findByText('Agenda não carregou')).toBeTruthy();
      expect(cartao().getByText('O código deste aparelho não vale mais.')).toBeTruthy();
      expect(cartao().getByRole('link', { name: 'Conectar aparelho' }).getAttribute('href')).toBe('#/conectar');
    });

    it('o Google ou o script recusou: "Agenda não carregou", sem culpar o código', async () => {
      const agenda = await agendaDeTeste();
      agenda.falharEventosCom({ ok: false, erro: 'interno' });
      render(<AgendaHoje />);
      expect(await cartao().findByText('Agenda não carregou')).toBeTruthy();
      expect(cartao().getByText('Tente de novo em instantes.')).toBeTruthy();
      expect(agenda.pedidos.map((p) => p.acao)).toEqual(['eventos']);
    });

    it('os avisos ficam numa região de status, quieta (não é alerta)', async () => {
      const agenda = await agendaDeTeste();
      agenda.falharEventosCom('rede');
      render(<AgendaHoje />);
      await cartao().findByText('Agenda não carregou');
      const aviso = document.querySelector('.cal-avisos') as HTMLElement;
      expect(aviso.getAttribute('role')).toBe('status');
      expect(document.querySelector('[role="alert"]')).toBeNull();
    });

    it('algumas agendas não carregaram: o que veio aparece, com a linha de aviso', async () => {
      const agenda = await agendaDeTeste();
      agenda.responder([aula()], true);
      render(<AgendaHoje />);
      expect(await cartao().findByText('Aula de Modelagem')).toBeTruthy();
      expect(cartao().getByText('Algumas agendas não carregaram')).toBeTruthy();
    });

    it('falha numa atualização não apaga o que já estava na tela', async () => {
      const agenda = await agendaDeTeste();
      agenda.responder([aula()]);
      render(<AgendaHoje />);
      await cartao().findByText('Aula de Modelagem');
      agenda.falharEventosCom('rede');
      vi.setSystemTime(AGORA + 60_000);
      fireEvent(document, new Event('visibilitychange'));
      await cartao().findByText('Agenda não carregou');
      expect(cartao().getByText('Aula de Modelagem')).toBeTruthy();
    });
  });

  describe('atualiza sozinha', () => {
    it('ao voltar ao app, depois de uma pausa; não repete se acabou de ler', async () => {
      const agenda = await agendaDeTeste();
      agenda.responder([aula()]);
      render(<AgendaHoje />);
      await cartao().findByText('Aula de Modelagem');
      expect(agenda.leituras()).toHaveLength(1);

      fireEvent(document, new Event('visibilitychange')); // logo em seguida: nada
      await act(async () => {});
      expect(agenda.leituras()).toHaveLength(1);

      vi.setSystemTime(AGORA + 31_000);
      fireEvent(document, new Event('visibilitychange'));
      await waitFor(() => expect(agenda.leituras()).toHaveLength(2));
    });

    it('a cada 15 minutos', async () => {
      const intervalos = vi.spyOn(globalThis, 'setInterval');
      const agenda = await agendaDeTeste();
      agenda.responder([aula()]);
      render(<AgendaHoje />);
      await cartao().findByText('Aula de Modelagem');
      expect(agenda.leituras()).toHaveLength(1);

      const quinzeMinutos = intervalos.mock.calls.filter(([, ms]) => ms === 15 * 60_000);
      expect(quinzeMinutos).toHaveLength(1);
      // Mesmo que a última leitura seja recente, o relógio de 15 minutos lê de novo.
      await act(async () => {
        (quinzeMinutos[0][0] as () => void)();
      });
      await waitFor(() => expect(agenda.leituras()).toHaveLength(2));
    });

    it('ao sair da tela, para de atualizar', async () => {
      const intervalos = vi.spyOn(globalThis, 'setInterval');
      const desligados = vi.spyOn(globalThis, 'clearInterval');
      const agenda = await agendaDeTeste();
      const { unmount } = render(<AgendaHoje />);
      await waitFor(() => expect(agenda.leituras()).toHaveLength(1));
      const id = intervalos.mock.results[intervalos.mock.calls.findIndex(([, ms]) => ms === 15 * 60_000)].value;
      act(() => unmount());
      expect(desligados.mock.calls.some(([desligado]) => desligado === id)).toBe(true);

      vi.setSystemTime(AGORA + 3_600_000);
      fireEvent(document, new Event('visibilitychange'));
      await act(async () => {});
      expect(agenda.leituras()).toHaveLength(1);
    });
  });

  describe('detalhes do evento', () => {
    const comLink = () =>
      evento('Reunião de orientação', {
        inicio: '2026-11-05T16:30:00+00:00',
        fim: '2026-11-05T17:15:00+00:00',
        salaId: 'sala-orientacoes',
        link: 'https://www.google.com/calendar/event?eid=ABC123',
      });

    it('clicar abre os detalhes: título, quando, agenda, sala e "Abrir no Google Agenda"', async () => {
      await semear();
      const agenda = await agendaDeTeste();
      agenda.responder([comLink()]);
      render(<AgendaHoje />);
      fireEvent.click(await cartao().findByRole('button', { name: /Reunião de orientação/ }));

      const dialogo = within(screen.getByRole('dialog', { name: 'Reunião de orientação' }));
      expect(dialogo.getByText('Hoje, das 16:30 às 17:15')).toBeTruthy();
      expect(dialogo.getByText('Agenda principal')).toBeTruthy();
      await waitFor(() => expect(dialogo.getByText('Orientações')).toBeTruthy());
      const abrir = dialogo.getByRole('link', { name: 'Abrir no Google Agenda' });
      expect(abrir.getAttribute('href')).toBe('https://www.google.com/calendar/event?eid=ABC123');
      expect(abrir.getAttribute('target')).toBe('_blank');
      expect(abrir.getAttribute('rel')).toBe('noopener noreferrer');
    });

    it('é só leitura: nada de editar, mover ou apagar, nem na lista nem nos detalhes', async () => {
      const agenda = await agendaDeTeste();
      agenda.responder([comLink()]);
      render(<AgendaHoje />);
      fireEvent.click(await cartao().findByRole('button', { name: /Reunião de orientação/ }));
      const dialogo = screen.getByRole('dialog');
      const nomes = [...dialogo.querySelectorAll('a, button')].map((e) => e.textContent);
      expect(nomes).toEqual(['Abrir no Google Agenda', 'Fechar']);
      expect(dialogo.textContent).toMatch(/Para editar, mover ou apagar, use o Google Agenda/);
      expect(document.body.textContent).not.toMatch(/Editar|Mover|Excluir|Apagar\b/);
      expect(document.querySelector('input, textarea, select')).toBeNull();
    });

    it('Fechar e Esc fecham e devolvem o foco ao evento', async () => {
      const agenda = await agendaDeTeste();
      agenda.responder([comLink()]);
      render(<AgendaHoje />);
      const botao = await cartao().findByRole('button', { name: /Reunião de orientação/ });
      fireEvent.click(botao);
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Fechar' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.activeElement).toBe(botao);

      fireEvent.click(botao);
      expect(document.activeElement).toBe(screen.getByRole('dialog'));
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.activeElement).toBe(botao);
    });

    it('o foco fica dentro dos detalhes: Tab dá a volta', async () => {
      const agenda = await agendaDeTeste();
      agenda.responder([comLink()]);
      render(<AgendaHoje />);
      fireEvent.click(await cartao().findByRole('button', { name: /Reunião de orientação/ }));
      const dialogo = screen.getByRole('dialog');
      const link = within(dialogo).getByRole('link', { name: 'Abrir no Google Agenda' });
      const fechar = within(dialogo).getByRole('button', { name: 'Fechar' });
      fechar.focus();
      fireEvent.keyDown(dialogo, { key: 'Tab' });
      expect(document.activeElement).toBe(link);
      fireEvent.keyDown(dialogo, { key: 'Tab', shiftKey: true });
      expect(document.activeElement).toBe(fechar);
    });

    it('evento sem link: não inventa botão', async () => {
      const agenda = await agendaDeTeste();
      agenda.responder([aula()]);
      render(<AgendaHoje />);
      fireEvent.click(await cartao().findByRole('button', { name: /Aula de Modelagem/ }));
      const dialogo = within(screen.getByRole('dialog'));
      expect(dialogo.queryByRole('link')).toBeNull();
      expect(dialogo.getByText('Este evento não tem link para o Google Agenda.')).toBeTruthy();
    });

    it('passado e livre aparecem nos detalhes, com palavras', async () => {
      const agenda = await agendaDeTeste();
      agenda.responder([evento('Bloqueio', { livre: true, inicio: '2026-11-05T08:00:00+00:00', fim: '2026-11-05T09:00:00+00:00' })]);
      render(<AgendaHoje />);
      fireEvent.click(await cartao().findByRole('button', { name: /Bloqueio/ }));
      const dialogo = within(screen.getByRole('dialog'));
      expect(dialogo.getByText('Já passou')).toBeTruthy();
      expect(dialogo.getByText('Livre: não ocupa tempo')).toBeTruthy();
    });

    it('tarefa não abre detalhes: é só uma linha', async () => {
      const agenda = await agendaDeTeste();
      agenda.responder([]);
      await criar('Ligar para a Renata', { data: '2026-11-05', prazoHora: '18:00' });
      render(<AgendaHoje />);
      await cartao().findByText('Ligar para a Renata');
      expect(cartao().queryByRole('button', { name: /Ligar para a Renata/ })).toBeNull();
    });
  });
});

describe('DetalheEvento', () => {
  const base = evento('Defesa de Aurora', { inicio: '2026-11-05T14:00:00+00:00', fim: '2026-11-05T15:00:00+00:00' });
  const abrirCom = (link: string | null) =>
    render(<DetalheEvento evento={{ ...base, link }} passado={false} salas={[]} hoje="2026-11-05" aoFechar={() => {}} />);

  it.each([
    ['https://www.google.com/calendar/event?eid=1', true],
    ['http://exemplo.com/evento', true],
    ['https://exemplo.com/evento', true],
    ['javascript:alert(1)', false],
    ['JaVaScRiPt:alert(1)', false],
    ['vbscript:x', false],
    ['data:text/html,<b>x</b>', false],
    ['ftp://exemplo.com/x', false],
    ['//exemplo.com/x', false],
    ['não é link', false],
    [null, false],
  ])('o link %j %s abre o Google Agenda', (link, abre) => {
    abrirCom(link);
    const achado = screen.queryByRole('link', { name: 'Abrir no Google Agenda' });
    expect(achado !== null).toBe(abre);
    if (achado) {
      expect(achado.getAttribute('target')).toBe('_blank');
      expect(achado.getAttribute('rel')).toBe('noopener noreferrer');
    }
  });

  it('agenda que não é a principal aparece como "Outra agenda" (o nome não vem do script)', () => {
    render(<DetalheEvento evento={{ ...base, agendaId: 'agenda-abc123def45' }} passado={false} salas={[]} hoje="2026-11-05" aoFechar={() => {}} />);
    expect(screen.getByText('Outra agenda')).toBeTruthy();
  });

  it('sem sala diz "Sem sala"', () => {
    abrirCom(null);
    expect(screen.getByText('Sem sala')).toBeTruthy();
  });
});

describe('Agenda de hoje: compromisso ainda na fila', () => {
  it('sem internet, o compromisso criado aparece na hora, marcado "a enviar" e sem caixa de feito; desfeito, some', async () => {
    const agenda = await agendaDeTeste();
    agenda.falharEventosCom('rede');
    render(<AgendaHoje />);
    await cartao().findByText('Sem internet.');

    const { eventoId } = await criarCompromisso({ titulo: 'Ligar para o banco', data: '2026-11-05', inicio: '18:00', fim: '19:00', salaId: null });

    const item = (await cartao().findByText('Ligar para o banco')).closest('li') as HTMLElement;
    expect(item.textContent).toContain('18:00 às 19:00');
    expect(within(item).getByText('a enviar')).toBeTruthy();
    expect(within(item).queryByRole('checkbox')).toBeNull();

    await act(async () => desfazerCompromisso(eventoId));
    await waitFor(() => expect(cartao().queryByText('Ligar para o banco')).toBeNull());
  });

  it('compromisso de outro dia na fila não entra na agenda de hoje', async () => {
    const agenda = await agendaDeTeste();
    agenda.falharEventosCom('rede');
    render(<AgendaHoje />);
    await criarCompromisso({ titulo: 'Consulta amanhã', data: '2026-11-06', inicio: '09:00', fim: '10:00', salaId: null });
    await criarCompromisso({ titulo: 'Reunião hoje', data: '2026-11-05', inicio: '15:00', fim: '16:00', salaId: null });

    await cartao().findByText('Reunião hoje');
    expect(cartao().queryByText('Consulta amanhã')).toBeNull();
  });
});
