import { describe, expect, it } from 'vitest';
import {
  descreverHorario,
  diasDaSemana,
  diasDoMes,
  empilhar,
  horaDe,
  mesesDoAno,
  montarCalendario,
  periodoDaSemana,
  periodoDoAno,
  periodoDoMes,
  tarefasDaSemana,
  type ItemDeEvento,
  type ItemDeTarefa,
} from '../../src/dados/calendario';
import { quandoDoEvento } from '../../src/ui/quando';
import type { Evento } from '../../src/dados/agenda';
import type { Tarefa } from '../../src/dados/tipos';

// Quinta-feira, 2026-11-05, 12:20 (Europe/Lisbon, UTC+0 no inverno).
const AGORA = new Date('2026-11-05T12:20:00Z');

let n = 0;
function evento(extra: Partial<Evento> = {}): Evento {
  n += 1;
  return {
    id: `e${n}`,
    agendaId: 'primary',
    titulo: `Evento ${n}`,
    inicio: '2026-11-05T09:00:00+00:00',
    fim: '2026-11-05T10:00:00+00:00',
    diaInteiro: false,
    livre: false,
    recusado: false,
    salaId: null,
    link: null,
    ...extra,
  };
}

function tarefa(extra: Partial<Tarefa> = {}): Tarefa {
  n += 1;
  return {
    id: `t${n}`,
    atualizadoEm: 1,
    aparelho: 'a',
    titulo: `Tarefa ${n}`,
    salaId: null,
    duracaoMin: 60,
    duracaoConfirmada: false,
    feito: false,
    fixada: false,
    marcar: false,
    ...extra,
  };
}

const diaInteiro = (inicio: string, fim: string, extra: Partial<Evento> = {}) =>
  evento({ diaInteiro: true, inicio, fim, ...extra });

function montar(eventos: Evento[], tarefas: Tarefa[] = [], de = '2026-11-02', ate = '2026-11-08') {
  return montarCalendario({ eventos, tarefas, de, ate, agora: AGORA });
}

const doEvento = (i: unknown) => i as ItemDeEvento;
const daTarefa = (i: unknown) => i as ItemDeTarefa;

describe('semana, mês e ano', () => {
  it('a semana vai de segunda a domingo, de qualquer dia dela', () => {
    expect(diasDaSemana('2026-11-02')).toEqual([
      '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08',
    ]);
    expect(diasDaSemana('2026-11-08')[0]).toBe('2026-11-02'); // domingo
    expect(diasDaSemana('2026-11-05')[0]).toBe('2026-11-02');
    expect(periodoDaSemana('2026-11-05')).toEqual({ de: '2026-11-02', ate: '2026-11-08' });
  });

  it('a semana da mudança de hora (25/10/2026) tem os sete dias, sem pular nem repetir', () => {
    expect(diasDaSemana('2026-10-25')).toEqual([
      '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25',
    ]);
    expect(diasDaSemana('2026-10-26')[0]).toBe('2026-10-26');
    // A de março (29/03/2026) também.
    expect(diasDaSemana('2026-03-29')).toHaveLength(7);
    expect(new Set(diasDaSemana('2026-03-29')).size).toBe(7);
  });

  it('a semana do fim de 2026 entra em 2027', () => {
    expect(diasDaSemana('2026-12-31')).toEqual([
      '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03',
    ]);
  });

  it('o mês é uma grade de semanas inteiras, de segunda a domingo', () => {
    const novembro = diasDoMes(2026, 11);
    expect(novembro).toHaveLength(6); // 1/11 é domingo; 30/11 é segunda
    expect(novembro[0][0]).toBe('2026-10-26');
    expect(novembro[0][6]).toBe('2026-11-01');
    expect(novembro[5][0]).toBe('2026-11-30');
    expect(novembro[5][6]).toBe('2026-12-06');
    expect(novembro.every((semana) => semana.length === 7)).toBe(true);
  });

  it('fevereiro de 2027 cabe em quatro semanas; dezembro de 2026 passa para 2027', () => {
    expect(diasDoMes(2027, 2)).toHaveLength(4);
    const dezembro = diasDoMes(2026, 12);
    expect(dezembro[0][0]).toBe('2026-11-30');
    expect(dezembro.at(-1)!.at(-1)).toBe('2027-01-03');
    expect(periodoDoMes('2026-12-10')).toEqual({ de: '2026-11-30', ate: '2027-01-03' });
  });

  it('o ano tem doze meses; o período é de 1/1 a 31/12', () => {
    expect(mesesDoAno(2026)).toHaveLength(12);
    expect(mesesDoAno(2026)[0].semanas[0][0]).toBe('2025-12-29');
    expect(periodoDoAno('2026-11-05')).toEqual({ de: '2026-01-01', ate: '2026-12-31' });
    // O ano bissexto cabe no limite de 400 dias do script.
    expect(periodoDoAno('2028-06-01')).toEqual({ de: '2028-01-01', ate: '2028-12-31' });
  });
});

describe('eventos em cada dia', () => {
  it('um evento de horário vira um bloco com início e fim em minutos', () => {
    const dia = montar([evento({ inicio: '2026-11-05T09:00:00+00:00', fim: '2026-11-05T10:30:00+00:00' })]).dia('2026-11-05');
    expect(dia.horarios).toHaveLength(1);
    expect(doEvento(dia.horarios[0])).toMatchObject({ tipo: 'evento', ini: 540, fim: 630, continuaAntes: false, continuaDepois: false });
    expect(dia.diaInteiro).toEqual([]);
  });

  it('as horas são as de Lisboa que o script mandou, não as do aparelho', () => {
    // 09:00 no verão (+01:00) continua 09:00 na tela, qualquer que seja o fuso do aparelho.
    const dia = montar(
      [evento({ inicio: '2026-07-14T09:00:00+01:00', fim: '2026-07-14T10:00:00+01:00' })],
      [],
      '2026-07-13',
      '2026-07-19',
    ).dia('2026-07-14');
    expect(doEvento(dia.horarios[0])).toMatchObject({ ini: 540, fim: 600 });
  });

  it('evento que cruza a meia-noite aparece nos dois dias, cada um com a sua parte', () => {
    const cal = montar([evento({ inicio: '2026-11-05T22:00:00+00:00', fim: '2026-11-06T01:00:00+00:00' })]);
    expect(doEvento(cal.dia('2026-11-05').horarios[0])).toMatchObject({ ini: 1320, fim: 1440, continuaAntes: false, continuaDepois: true });
    expect(doEvento(cal.dia('2026-11-06').horarios[0])).toMatchObject({ ini: 0, fim: 60, continuaAntes: true, continuaDepois: false });
    expect(cal.dia('2026-11-04').horarios).toEqual([]);
    expect(cal.dia('2026-11-07').horarios).toEqual([]);
  });

  it('evento que termina à meia-noite em ponto fica só no dia em que começou', () => {
    const cal = montar([evento({ inicio: '2026-11-05T23:00:00+00:00', fim: '2026-11-06T00:00:00+00:00' })]);
    expect(doEvento(cal.dia('2026-11-05').horarios[0])).toMatchObject({ ini: 1380, fim: 1440, continuaDepois: false });
    expect(cal.dia('2026-11-06').horarios).toEqual([]);
  });

  it('evento de vários dias com horário tem um bloco inteiro nos dias do meio', () => {
    const cal = montar([evento({ inicio: '2026-11-04T18:00:00+00:00', fim: '2026-11-06T09:00:00+00:00' })]);
    expect(doEvento(cal.dia('2026-11-04').horarios[0])).toMatchObject({ ini: 1080, fim: 1440, continuaDepois: true });
    expect(doEvento(cal.dia('2026-11-05').horarios[0])).toMatchObject({ ini: 0, fim: 1440, continuaAntes: true, continuaDepois: true });
    expect(doEvento(cal.dia('2026-11-06').horarios[0])).toMatchObject({ ini: 0, fim: 540, continuaAntes: true, continuaDepois: false });
  });

  it('dia inteiro: o fim é o dia seguinte ao último (como no Google)', () => {
    const cal = montar([diaInteiro('2026-11-05', '2026-11-06', { titulo: 'Feriado de Aurora' })]);
    expect(cal.dia('2026-11-05').diaInteiro).toHaveLength(1);
    expect(doEvento(cal.dia('2026-11-05').diaInteiro[0])).toMatchObject({ diaInteiro: true });
    expect(cal.dia('2026-11-05').horarios).toEqual([]);
    expect(cal.dia('2026-11-06').diaInteiro).toEqual([]);
    expect(cal.dia('2026-11-04').diaInteiro).toEqual([]);
  });

  it('dia inteiro de vários dias aparece em cada dia, e só neles', () => {
    const cal = montar([diaInteiro('2026-11-05', '2026-11-08', { titulo: 'Congresso' })]);
    for (const d of ['2026-11-05', '2026-11-06', '2026-11-07']) expect(cal.dia(d).diaInteiro, d).toHaveLength(1);
    expect(cal.dia('2026-11-08').diaInteiro).toEqual([]);
    expect(doEvento(cal.dia('2026-11-06').diaInteiro[0])).toMatchObject({ continuaAntes: true, continuaDepois: true });
    expect(doEvento(cal.dia('2026-11-05').diaInteiro[0])).toMatchObject({ continuaAntes: false, continuaDepois: true });
    expect(doEvento(cal.dia('2026-11-07').diaInteiro[0])).toMatchObject({ continuaAntes: true, continuaDepois: false });
  });

  it('a virada de 2026 para 2027: dia inteiro e horário atravessam o ano', () => {
    const cal = montar(
      [
        diaInteiro('2026-12-31', '2027-01-03', { titulo: 'Recesso' }),
        evento({ inicio: '2026-12-31T23:00:00+00:00', fim: '2027-01-01T01:00:00+00:00', titulo: 'Brinde' }),
      ],
      [],
      '2026-12-28',
      '2027-01-03',
    );
    expect(cal.dia('2026-12-31').diaInteiro).toHaveLength(1);
    expect(cal.dia('2027-01-01').diaInteiro).toHaveLength(1);
    expect(cal.dia('2027-01-02').diaInteiro).toHaveLength(1);
    expect(cal.dia('2027-01-03').diaInteiro).toEqual([]);
    expect(doEvento(cal.dia('2026-12-31').horarios[0])).toMatchObject({ ini: 1380, fim: 1440, continuaDepois: true });
    expect(doEvento(cal.dia('2027-01-01').horarios[0])).toMatchObject({ ini: 0, fim: 60, continuaAntes: true });
  });

  it('na mudança de hora de outubro (25/10), a hora repetida não gera bloco de fim antes do início', () => {
    // 01:30 (+01:00) a 01:15 (+00:00): 45 minutos reais, e o relógio de parede volta de 01:30 para 01:15.
    const cal = montar(
      [evento({ inicio: '2026-10-25T01:30:00+01:00', fim: '2026-10-25T01:15:00+00:00', titulo: 'Plantão' })],
      [],
      '2026-10-19',
      '2026-10-25',
    );
    const bloco = doEvento(cal.dia('2026-10-25').horarios[0]);
    expect(bloco.ini).toBe(90);
    expect(bloco.fim).toBeGreaterThanOrEqual(bloco.ini);
    expect(bloco.fim).toBe(135); // 45 minutos reais depois do início
  });

  it('um evento depois da mudança de hora fica na hora de parede de Lisboa', () => {
    const cal = montar(
      [evento({ inicio: '2026-10-25T09:00:00+00:00', fim: '2026-10-25T10:00:00+00:00' })],
      [],
      '2026-10-19',
      '2026-10-25',
    );
    expect(doEvento(cal.dia('2026-10-25').horarios[0])).toMatchObject({ ini: 540, fim: 600 });
  });

  it('na hora repetida, os eventos ficam na ordem do relógio de parede; empates, pelo instante', () => {
    const cal = montar(
      [
        evento({ titulo: 'B', inicio: '2026-10-25T01:30:00+00:00', fim: '2026-10-25T02:00:00+00:00' }),
        evento({ titulo: 'A', inicio: '2026-10-25T01:30:00+01:00', fim: '2026-10-25T01:50:00+01:00' }),
      ],
      [],
      '2026-10-19',
      '2026-10-25',
    );
    expect(cal.dia('2026-10-25').horarios.map((i) => doEvento(i).evento.titulo)).toEqual(['A', 'B']);
  });

  it('fica de fora o que não toca o período pedido', () => {
    const cal = montar([
      evento({ inicio: '2026-11-01T09:00:00+00:00', fim: '2026-11-01T10:00:00+00:00' }),
      evento({ inicio: '2026-11-09T09:00:00+00:00', fim: '2026-11-09T10:00:00+00:00' }),
    ]);
    for (const d of diasDaSemana('2026-11-05')) expect(cal.dia(d).horarios).toEqual([]);
    expect(cal.dia('2026-11-01').horarios).toEqual([]);
  });

  it('evento que começou antes do período e entra nele aparece no primeiro dia', () => {
    const cal = montar([evento({ inicio: '2026-11-01T22:00:00+00:00', fim: '2026-11-02T02:00:00+00:00' })]);
    expect(doEvento(cal.dia('2026-11-02').horarios[0])).toMatchObject({ ini: 0, fim: 120, continuaAntes: true });
  });

  it('dia inteiro com fim mal formado vale só o dia do início, sem quebrar', () => {
    const cal = montar([diaInteiro('2026-11-05', 'lixo', { titulo: 'Sem fim' })]);
    expect(cal.dia('2026-11-05').diaInteiro).toHaveLength(1);
    expect(cal.dia('2026-11-06').diaInteiro).toEqual([]);
  });

  it('evento de dia inteiro enorme é cortado no período (não gera dias demais)', () => {
    const cal = montar([diaInteiro('2020-01-01', '2030-01-01', { titulo: 'Bolsa' })]);
    expect(cal.dia('2026-11-05').diaInteiro).toHaveLength(1);
    expect(cal.dia('2026-11-09').diaInteiro).toEqual([]);
  });

  it('recusado fica escondido e é contado; livre continua e leva a marca', () => {
    const cal = montar([
      evento({ titulo: 'Recusada', recusado: true }),
      evento({ titulo: 'Livre', livre: true, inicio: '2026-11-05T11:00:00+00:00', fim: '2026-11-05T12:00:00+00:00' }),
    ]);
    const dia = cal.dia('2026-11-05');
    expect(dia.horarios.map((i) => doEvento(i).evento.titulo)).toEqual(['Livre']);
    expect(dia.recusados).toBe(1);
    expect(montar([]).dia('2026-11-05').recusados).toBe(0);
  });

  it('ordena por hora e, no empate, por título; o dia inteiro fica à parte', () => {
    const cal = montar([
      evento({ titulo: 'Tarde', inicio: '2026-11-05T15:00:00+00:00', fim: '2026-11-05T16:00:00+00:00' }),
      evento({ titulo: 'Cedo B', inicio: '2026-11-05T08:00:00+00:00', fim: '2026-11-05T09:00:00+00:00' }),
      evento({ titulo: 'Cedo A', inicio: '2026-11-05T08:00:00+00:00', fim: '2026-11-05T08:30:00+00:00' }),
      diaInteiro('2026-11-05', '2026-11-06', { titulo: 'Dia todo' }),
    ]);
    const dia = cal.dia('2026-11-05');
    expect(dia.horarios.map((i) => doEvento(i).evento.titulo)).toEqual(['Cedo A', 'Cedo B', 'Tarde']);
    expect(dia.diaInteiro.map((i) => doEvento(i).evento.titulo)).toEqual(['Dia todo']);
  });

  it('um dia sem nada devolve listas vazias; dia fora do período também', () => {
    const dia = montar([]).dia('2026-11-06');
    expect(dia).toMatchObject({ data: '2026-11-06', diaInteiro: [], horarios: [], recusados: 0, total: 0 });
    expect(montar([]).dia('2030-01-01').total).toBe(0);
  });

  it('total conta o que aparece no dia (eventos e tarefas), sem os recusados', () => {
    const cal = montar(
      [evento(), diaInteiro('2026-11-05', '2026-11-06'), evento({ recusado: true })],
      [tarefa({ data: '2026-11-05' }), tarefa({ data: '2026-11-05', prazoHora: '17:00' })],
    );
    expect(cal.dia('2026-11-05').total).toBe(4);
  });
});

describe('passado', () => {
  const passado = (e: Evento, dia = '2026-11-05') => doEvento([...montar([e]).dia(dia).horarios, ...montar([e]).dia(dia).diaInteiro][0]).passado;

  it('acabou antes de agora (12:20): passado; ainda rola ou vem depois: não', () => {
    expect(passado(evento({ inicio: '2026-11-05T09:00:00+00:00', fim: '2026-11-05T10:00:00+00:00' }))).toBe(true);
    expect(passado(evento({ inicio: '2026-11-05T12:00:00+00:00', fim: '2026-11-05T13:00:00+00:00' }))).toBe(false);
    expect(passado(evento({ inicio: '2026-11-05T14:00:00+00:00', fim: '2026-11-05T15:00:00+00:00' }))).toBe(false);
  });

  it('terminar exatamente agora já é passado', () => {
    expect(passado(evento({ inicio: '2026-11-05T11:20:00+00:00', fim: '2026-11-05T12:20:00+00:00' }))).toBe(true);
  });

  it('o instante decide, não o texto da hora (o fuso do texto conta)', () => {
    // 11:00 UTC = 12:00 em Lisboa no verão, mas aqui é novembro: 12:00+01:00 é 11:00Z, antes de agora.
    expect(passado(evento({ inicio: '2026-11-05T11:00:00+01:00', fim: '2026-11-05T12:00:00+01:00' }))).toBe(true);
    // 12:30+01:00 é 11:30Z: passou. 13:30+01:00 é 12:30Z: não passou.
    expect(passado(evento({ inicio: '2026-11-05T13:00:00+01:00', fim: '2026-11-05T13:30:00+01:00' }))).toBe(false);
  });

  it('dia inteiro: ontem é passado, hoje e amanhã não', () => {
    expect(passado(diaInteiro('2026-11-04', '2026-11-05'), '2026-11-04')).toBe(true);
    expect(passado(diaInteiro('2026-11-05', '2026-11-06'))).toBe(false);
    expect(passado(diaInteiro('2026-11-06', '2026-11-07'), '2026-11-06')).toBe(false);
  });

  it('dia inteiro de vários dias que ainda não acabou não é passado, mesmo nos dias que já passaram', () => {
    expect(passado(diaInteiro('2026-11-03', '2026-11-07'), '2026-11-03')).toBe(false);
    expect(passado(diaInteiro('2026-11-02', '2026-11-04'), '2026-11-02')).toBe(true);
  });

  it('evento que cruza a meia-noite e já acabou é passado nos dois dias', () => {
    const e = evento({ inicio: '2026-11-04T22:00:00+00:00', fim: '2026-11-05T01:00:00+00:00' });
    expect(passado(e, '2026-11-04')).toBe(true);
    expect(passado(e, '2026-11-05')).toBe(true);
  });
});

describe('tarefas junto dos eventos', () => {
  it('tarefa com prazo vira marcador na hora do prazo: sem bloco (início e fim iguais)', () => {
    const cal = montar([], [tarefa({ titulo: 'Entregar relatório', data: '2026-11-06', prazoHora: '17:00' })]);
    const item = daTarefa(cal.dia('2026-11-06').horarios[0]);
    expect(item).toMatchObject({ tipo: 'prazo', ini: 1020, fim: 1020 });
    expect(item.tarefa.titulo).toBe('Entregar relatório');
    expect(cal.dia('2026-11-06').diaInteiro).toEqual([]);
  });

  it('tarefa com hora de início (R28) vira bloco com a duração dela', () => {
    const cal = montar([], [tarefa({ titulo: 'Reunião com a Marina', data: '2026-11-05', inicio: '15:30', duracaoMin: 45 })]);
    expect(daTarefa(cal.dia('2026-11-05').horarios[0])).toMatchObject({ tipo: 'bloco', ini: 930, fim: 975 });
  });

  it('bloco de tarefa não passa da meia-noite', () => {
    const cal = montar([], [tarefa({ data: '2026-11-05', inicio: '23:30', duracaoMin: 120 })]);
    expect(daTarefa(cal.dia('2026-11-05').horarios[0])).toMatchObject({ ini: 1410, fim: 1440 });
    expect(cal.dia('2026-11-06').horarios).toEqual([]);
  });

  it('tarefa só com dia vai para a linha de dia inteiro e tarefas', () => {
    const cal = montar([diaInteiro('2026-11-05', '2026-11-06', { titulo: 'Feriado' })], [tarefa({ titulo: 'Ligar para a Renata', data: '2026-11-05' })]);
    const itens = cal.dia('2026-11-05').diaInteiro;
    expect(itens.map((i) => i.tipo)).toEqual(['evento', 'tarefa']);
    expect(cal.dia('2026-11-05').horarios).toEqual([]);
  });

  it('prazo e bloco passados ficam marcados como passado; a tarefa feita leva a marca feita', () => {
    const cal = montar(
      [],
      [
        tarefa({ titulo: 'P1', data: '2026-11-05', prazoHora: '09:00' }),
        tarefa({ titulo: 'P2', data: '2026-11-05', prazoHora: '17:00' }),
        tarefa({ titulo: 'B1', data: '2026-11-05', inicio: '10:00', duracaoMin: 30 }),
        tarefa({ titulo: 'B2', data: '2026-11-05', inicio: '12:00', duracaoMin: 60 }),
        tarefa({ titulo: 'D1', data: '2026-11-04' }),
        tarefa({ titulo: 'D2', data: '2026-11-05', feito: true }),
      ],
    );
    const por = (d: string) =>
      Object.fromEntries([...cal.dia(d).horarios, ...cal.dia(d).diaInteiro].map((i) => [daTarefa(i).tarefa.titulo, daTarefa(i)]));
    const hoje = por('2026-11-05');
    expect(hoje.P1.passado).toBe(true);
    expect(hoje.P2.passado).toBe(false);
    expect(hoje.B1.passado).toBe(true);
    expect(hoje.B2.passado).toBe(false);
    expect(hoje.D2.passado).toBe(false);
    expect(hoje.D2.tarefa.feito).toBe(true);
    expect(por('2026-11-04').D1.passado).toBe(true);
  });

  it('tarefa com data fora do período, apagada ou só de semana não entra em nenhum dia', () => {
    const cal = montar(
      [],
      [
        tarefa({ data: '2026-11-20' }),
        tarefa({ data: '2026-11-05', apagado: true }),
        tarefa({ semana: '2026-11-02' }),
        tarefa({}),
      ],
    );
    for (const d of diasDaSemana('2026-11-05')) expect(cal.dia(d).total, d).toBe(0);
  });

  it('data mal formada na tarefa é ignorada, sem quebrar', () => {
    const cal = montar([], [tarefa({ data: 'amanhã' }), tarefa({ data: '2026-11-05', prazoHora: '25:99' }), tarefa({ data: '2026-11-05', inicio: 'cedo' })]);
    expect(cal.dia('2026-11-05').horarios).toEqual([]);
    // Sem hora válida, a tarefa ainda aparece no dia, na linha de tarefas.
    expect(cal.dia('2026-11-05').diaInteiro).toHaveLength(2);
  });

  it('ordena marcadores, blocos de tarefa e eventos pela hora', () => {
    const cal = montar(
      [evento({ titulo: 'Aula', inicio: '2026-11-05T09:00:00+00:00', fim: '2026-11-05T10:00:00+00:00' })],
      [
        tarefa({ titulo: 'Prazo', data: '2026-11-05', prazoHora: '09:00' }),
        tarefa({ titulo: 'Reunião', data: '2026-11-05', inicio: '08:30', duracaoMin: 30 }),
      ],
    );
    const nomes = cal.dia('2026-11-05').horarios.map((i) => (i.tipo === 'evento' ? i.evento.titulo : daTarefa(i).tarefa.titulo));
    expect(nomes).toEqual(['Reunião', 'Aula', 'Prazo']);
  });

  it('as tarefas de Esta semana são as da segunda-feira dela, sem dia, abertas ou feitas', () => {
    const lista = [
      tarefa({ titulo: 'Ler artigo', semana: '2026-11-02' }),
      tarefa({ titulo: 'Feita', semana: '2026-11-02', feito: true }),
      tarefa({ titulo: 'Outra semana', semana: '2026-11-09' }),
      tarefa({ titulo: 'Com dia', data: '2026-11-05', semana: '2026-11-02' }),
      tarefa({ titulo: 'Apagada', semana: '2026-11-02', apagado: true }),
    ];
    expect(tarefasDaSemana(lista, '2026-11-02').map((t) => t.titulo)).toEqual(['Feita', 'Ler artigo']);
    // De qualquer dia da semana.
    expect(tarefasDaSemana(lista, '2026-11-05')).toHaveLength(2);
  });
});

describe('empilhar (linhas da linha do dia)', () => {
  it('o que se sobrepõe vai para outra linha; o que não, volta para a primeira', () => {
    expect(empilhar([{ ini: 0, fim: 60 }, { ini: 30, fim: 90 }, { ini: 60, fim: 120 }])).toEqual([0, 1, 0]);
  });

  it('blocos separados ficam todos na linha 0', () => {
    expect(empilhar([{ ini: 0, fim: 30 }, { ini: 60, fim: 90 }])).toEqual([0, 0]);
  });

  it('um marcador (fim = início) ocupa um pouco de espaço, para não esconder o vizinho', () => {
    expect(empilhar([{ ini: 600, fim: 600 }, { ini: 600, fim: 660 }])).toEqual([0, 1]);
  });

  it('três ao mesmo tempo usam três linhas', () => {
    expect(empilhar([{ ini: 0, fim: 60 }, { ini: 0, fim: 60 }, { ini: 0, fim: 60 }])).toEqual([0, 1, 2]);
  });
});

describe('textos do horário', () => {
  const cal = montar([
    evento({ titulo: 'Normal', inicio: '2026-11-05T09:00:00+00:00', fim: '2026-11-05T10:30:00+00:00' }),
    evento({ titulo: 'Noite', inicio: '2026-11-05T22:00:00+00:00', fim: '2026-11-06T01:00:00+00:00' }),
    diaInteiro('2026-11-05', '2026-11-08', { titulo: 'Congresso' }),
  ]);
  const itemDe = (d: string, titulo: string) =>
    doEvento([...cal.dia(d).horarios, ...cal.dia(d).diaInteiro].find((i) => doEvento(i).evento.titulo === titulo));

  it('horaDe pega HH:MM do texto do script', () => {
    expect(horaDe('2026-11-05T09:05:00+00:00')).toBe('09:05');
    expect(horaDe('2026-07-05T23:59:00+01:00')).toBe('23:59');
  });

  it('dentro do dia: "09:00 às 10:30"', () => {
    expect(descreverHorario(itemDe('2026-11-05', 'Normal'))).toBe('09:00 às 10:30');
  });

  it('que continua no dia seguinte, ou veio do anterior, diz isso', () => {
    expect(descreverHorario(itemDe('2026-11-05', 'Noite'))).toBe('22:00, continua no dia seguinte');
    expect(descreverHorario(itemDe('2026-11-06', 'Noite'))).toBe('Continuação do dia anterior, até 01:00');
  });

  it('dia inteiro', () => {
    expect(descreverHorario(itemDe('2026-11-05', 'Congresso'))).toBe('Dia inteiro');
  });

  it('quandoDoEvento: o evento todo, com os dias', () => {
    const hoje = '2026-11-05';
    expect(quandoDoEvento(evento({ inicio: '2026-11-05T09:00:00+00:00', fim: '2026-11-05T10:30:00+00:00' }), hoje)).toBe('Hoje, das 09:00 às 10:30');
    expect(quandoDoEvento(evento({ inicio: '2026-11-06T09:00:00+00:00', fim: '2026-11-06T10:00:00+00:00' }), hoje)).toBe('Sexta, 6/11, das 09:00 às 10:00');
    expect(quandoDoEvento(evento({ inicio: '2026-11-05T22:00:00+00:00', fim: '2026-11-06T01:00:00+00:00' }), hoje)).toBe(
      'Hoje, 22:00, até sexta, 6/11, 01:00',
    );
    expect(quandoDoEvento(diaInteiro('2026-11-06', '2026-11-07'), hoje)).toBe('Sexta, 6/11, dia inteiro');
    expect(quandoDoEvento(diaInteiro('2026-11-05', '2026-11-08'), hoje)).toBe('De hoje até sábado, 7/11, dia inteiro');
    expect(quandoDoEvento(diaInteiro('2026-12-31', '2027-01-02'), hoje)).toBe('De quinta, 31/12 até sexta, 1/1/2027, dia inteiro');
  });
});
