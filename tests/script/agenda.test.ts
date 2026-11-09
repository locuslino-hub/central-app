// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  AGENDAS_NO_MAXIMO,
  DIAS_NO_MAXIMO,
  EVENTOS_NO_MAXIMO,
  PedidoInvalido,
  SALAS_FIXAS,
  criarEvento,
  listarEventos,
  hojeEmLisboa,
  paraLisboa,
  provarAgenda,
  removerEvento,
  trocarSalaEvento,
  type Evento,
  type ServicoDeAgenda,
} from '../../script/agenda';
import { tratar, type Ambiente } from '../../script/api';
import { armazemNaMemoria } from '../apoio/armazem';
import { agendasDoDono, calendarioFalso, noFuso, type CalendarioFalso, type OpcoesDoFalso } from '../apoio/calendario';

const PRINCIPAL = 'marina.ficticia@example.com';
const AULAS = 'aulas-ficticias@group.example.com';
const FERIADOS = 'feriados-ficticios@group.example.com';
const CODIGO = 'codigo-ficticio-de-teste-0123456789abcdef';

const servico = (cal: CalendarioFalso) => cal.servico as unknown as ServicoDeAgenda;
/** Só a lista de eventos da resposta de `eventos`. */
const lista = (dados: unknown, s: ServicoDeAgenda) => listarEventos(dados, s).eventos;
/** Alias opaco de agenda: nunca o id do Google (e-mail). */
const ALIAS = /^agenda-[a-z0-9]{6,16}$/;

function reuniao(extra: Record<string, unknown> = {}) {
  return { titulo: 'Reunião com Prof. Souza', data: '2026-10-23', inicio: '11:00', fim: '12:00', salaId: 'sala-orientacoes', ...extra };
}

/** Hora de parede em Lisboa de um ISO com fuso, pelo Intl (independente do script). */
function horaEmLisboa(iso: string) {
  return new Intl.DateTimeFormat('pt-PT', { timeZone: 'Europe/Lisbon', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(
    new Date(iso),
  );
}

describe('paraLisboa: hora com fuso de Lisboa', () => {
  it.each([
    ['2026-10-23T10:00:00Z', '2026-10-23T11:00:00+01:00'],
    ['2026-10-26T11:00:00Z', '2026-10-26T11:00:00+00:00'],
    ['2026-10-26T06:00:00-05:00', '2026-10-26T11:00:00+00:00'],
    ['2026-10-23T11:00:00+01:00', '2026-10-23T11:00:00+01:00'],
    ['2026-07-01T23:30:00.000Z', '2026-07-02T00:30:00+01:00'],
    // Troca de hora: 01:00 UTC no último domingo de março e de outubro.
    ['2026-03-29T00:59:59Z', '2026-03-29T00:59:59+00:00'],
    ['2026-03-29T01:00:00Z', '2026-03-29T02:00:00+01:00'],
    ['2026-10-25T00:59:59Z', '2026-10-25T01:59:59+01:00'],
    ['2026-10-25T01:00:00Z', '2026-10-25T01:00:00+00:00'],
  ])('%s -> %s', (entrada, saida) => {
    expect(paraLisboa(entrada)).toBe(saida);
  });

  it('bate com o tzdata do Intl a cada 3 horas de 2025 a 2028', () => {
    const fim = Date.parse('2029-01-01T00:00:00Z');
    for (let ms = Date.parse('2025-01-01T00:00:00Z'); ms < fim; ms += 3 * 60 * 60 * 1000) {
      expect(paraLisboa(new Date(ms).toISOString())).toBe(noFuso(ms, 'Europe/Lisbon'));
    }
  });

  it.each(['', '2026-10-23', '2026-10-23T11:00:00', 'amanhã', '2026-13-01T00:00:00Z'])('recusa %j', (valor) => {
    expect(() => paraLisboa(valor)).toThrow();
  });
});

describe('criarEvento: troca de hora em Portugal (Tarefa 10)', () => {
  it.each([
    ['2026-10-23', '+01:00'],
    ['2026-10-26', '+00:00'],
    ['2026-03-27', '+00:00'],
    ['2026-03-30', '+01:00'],
  ])('criado às 11:00 de %s volta às 11:00 (fuso %s), na criação e na leitura', (data, fuso) => {
    const cal = agendasDoDono();
    const criado = criarEvento(reuniao({ data }), servico(cal));
    expect(criado.inicio).toBe(`${data}T11:00:00${fuso}`);
    expect(criado.fim).toBe(`${data}T12:00:00${fuso}`);

    const [lido] = lista({ de: data, ate: data }, servico(cal));
    expect(lido.inicio).toBe(`${data}T11:00:00${fuso}`);
    expect(horaEmLisboa(lido.inicio)).toBe('11:00');
    expect(horaEmLisboa(lido.fim)).toBe('12:00');
  });

  it('agenda principal com fuso de outro país ainda grava 11:00 de Lisboa', () => {
    const cal = calendarioFalso();
    cal.agenda({ id: PRINCIPAL, primary: true, timeZone: 'America/Sao_Paulo' });
    const criado = criarEvento(reuniao({ data: '2026-10-26' }), servico(cal));
    expect(horaEmLisboa(criado.inicio)).toBe('11:00');
    expect(lista({ de: '2026-10-26', ate: '2026-10-26' }, servico(cal))[0].inicio).toBe(
      '2026-10-26T11:00:00+00:00',
    );
  });

  it('manda hora local com timeZone Europe/Lisbon, na principal, sem convidados e sem notificar', () => {
    const cal = agendasDoDono();
    criarEvento(reuniao(), servico(cal));
    const [chamada] = cal.de('Events.insert');
    const [corpo, agendaId, args] = chamada.args as [Record<string, any>, string, Record<string, unknown>];
    expect(agendaId).toBe('primary');
    expect(args).toEqual({ sendUpdates: 'none' });
    expect(corpo.start).toEqual({ dateTime: '2026-10-23T11:00:00+01:00', timeZone: 'Europe/Lisbon' });
    expect(corpo.end).toEqual({ dateTime: '2026-10-23T12:00:00+01:00', timeZone: 'Europe/Lisbon' });
    expect(corpo.summary).toBe('Reunião com Prof. Souza');
    expect(corpo).not.toHaveProperty('attendees');
    expect(corpo.extendedProperties).toEqual({ private: { centralCriado: '1', centralSala: 'sala-orientacoes' } });
    expect(cal.notificacoes).toEqual([]);
  });

  it('devolve o Evento completo, com a sala e o link', () => {
    const cal = agendasDoDono();
    const criado = criarEvento(reuniao(), servico(cal));
    expect(criado).toEqual({
      id: expect.stringMatching(/^[A-Za-z0-9_-]+$/),
      agendaId: 'primary',
      titulo: 'Reunião com Prof. Souza',
      inicio: '2026-10-23T11:00:00+01:00',
      fim: '2026-10-23T12:00:00+01:00',
      diaInteiro: false,
      livre: false,
      recusado: false,
      salaId: 'sala-orientacoes',
      link: expect.stringMatching(/^https:\/\/www\.google\.com\/calendar\//),
    } satisfies Evento);
  });

  it('sem sala: não grava centralSala e o Evento sai com salaId null', () => {
    const cal = agendasDoDono();
    const criado = criarEvento(reuniao({ salaId: null }), servico(cal));
    const [corpo] = cal.de('Events.insert')[0].args as [Record<string, any>];
    expect(corpo.extendedProperties).toEqual({ private: { centralCriado: '1' } });
    expect(criado.salaId).toBeNull();
  });

  it('título com espaços nas pontas é aparado', () => {
    const cal = agendasDoDono();
    expect(criarEvento(reuniao({ titulo: '  Aula da Aurora  ' }), servico(cal)).titulo).toBe('Aula da Aurora');
  });

  it('título de 200 caracteres é aceito', () => {
    const cal = agendasDoDono();
    expect(criarEvento(reuniao({ titulo: 'a'.repeat(200) }), servico(cal)).titulo).toHaveLength(200);
  });
});

describe('validação antes de qualquer chamada ao Google Agenda', () => {
  const invalidosDeCriar: [string, unknown][] = [
    ['sem dados', undefined],
    ['dados nulos', null],
    ['dados em lista', [reuniao()]],
    ['título vazio', reuniao({ titulo: '' })],
    ['título só com espaços', reuniao({ titulo: '   ' })],
    ['título com 201 caracteres', reuniao({ titulo: 'a'.repeat(201) })],
    ['título número', reuniao({ titulo: 42 })],
    ['título com quebra de linha', reuniao({ titulo: 'Aula\nda Aurora' })],
    ['título com caractere de controle', reuniao({ titulo: 'Aula\u0000' })],
    ['data inexistente', reuniao({ data: '2026-02-30' })],
    ['data sem zero', reuniao({ data: '2026-1-05' })],
    ['data com hora', reuniao({ data: '2026-10-23T11:00' })],
    ['data número', reuniao({ data: 20261023 })],
    ['ano fora da faixa', reuniao({ data: '1899-12-31' })],
    ['início 24:00', reuniao({ inicio: '24:00' })],
    ['início 11:0', reuniao({ inicio: '11:0' })],
    ['início com segundos', reuniao({ inicio: '11:00:00' })],
    ['fim igual ao início', reuniao({ fim: '11:00' })],
    ['fim antes do início', reuniao({ fim: '10:59' })],
    ['sem fim', reuniao({ fim: undefined })],
    ['sala desconhecida', reuniao({ salaId: 'sala-ficticia' })],
    ['sala constructor', reuniao({ salaId: 'constructor' })],
    ['sala ausente', reuniao({ salaId: undefined })],
    ['sala número', reuniao({ salaId: 1 })],
  ];

  it.each(invalidosDeCriar)('criarEvento: %s', (_nome, dados) => {
    const cal = agendasDoDono();
    expect(() => criarEvento(dados, servico(cal))).toThrow(PedidoInvalido);
    expect(cal.chamadas).toEqual([]);
  });

  const invalidosDeListar: [string, unknown][] = [
    ['sem dados', undefined],
    ['de ausente', { ate: '2026-10-23' }],
    ['ate ausente', { de: '2026-10-23' }],
    ['de inexistente', { de: '2026-02-29', ate: '2026-03-01' }],
    ['ate antes de de', { de: '2026-10-24', ate: '2026-10-23' }],
    [`mais de ${DIAS_NO_MAXIMO} dias`, { de: '2026-01-01', ate: '2027-02-06' }],
    ['de com hora', { de: '2026-10-23T00:00:00Z', ate: '2026-10-24' }],
    ['de número', { de: 1, ate: '2026-10-24' }],
  ];

  it.each(invalidosDeListar)('eventos: %s', (_nome, dados) => {
    const cal = agendasDoDono();
    expect(() => listarEventos(dados, servico(cal))).toThrow(PedidoInvalido);
    expect(cal.chamadas).toEqual([]);
  });

  it(`eventos aceita exatamente ${DIAS_NO_MAXIMO} dias e o mesmo dia`, () => {
    const cal = agendasDoDono();
    expect(listarEventos({ de: '2026-01-01', ate: '2027-02-05' }, servico(cal))).toEqual({ eventos: [], incompleto: false });
    expect(listarEventos({ de: '2026-10-23', ate: '2026-10-23' }, servico(cal))).toEqual({ eventos: [], incompleto: false });
  });

  const idsInvalidos: [string, unknown][] = [
    ['vazio', ''],
    ['com barra', 'abc/def'],
    ['com ponto', '..'],
    ['com espaço', 'abc def'],
    ['com @', 'marina@example'],
    ['com 1025 caracteres', 'a'.repeat(1025)],
    ['número', 123],
    ['ausente', undefined],
  ];

  it.each(idsInvalidos)('removerEvento: id %s', (_nome, id) => {
    const cal = agendasDoDono();
    expect(() => removerEvento({ id }, servico(cal))).toThrow(PedidoInvalido);
    expect(cal.chamadas).toEqual([]);
  });

  it.each(idsInvalidos)('trocarSalaEvento: id %s', (_nome, id) => {
    const cal = agendasDoDono();
    expect(() => trocarSalaEvento({ id, salaId: 'sala-casa' }, servico(cal))).toThrow(PedidoInvalido);
    expect(cal.chamadas).toEqual([]);
  });

  it.each([['desconhecida', 'sala-x'], ['ausente', undefined], ['__proto__', '__proto__']])(
    'trocarSalaEvento: sala %s',
    (_nome, salaId) => {
      const cal = agendasDoDono();
      expect(() => trocarSalaEvento({ id: 'abc123', salaId }, servico(cal))).toThrow(PedidoInvalido);
      expect(cal.chamadas).toEqual([]);
    },
  );

  it('ids do Google com sublinhado e carimbo de repetição são aceitos', () => {
    const cal = agendasDoDono();
    cal.evento(PRINCIPAL, { id: 'abc123_20261023T100000Z', summary: 'Aula', inicio: '2026-10-23T10:00:00Z', fim: '2026-10-23T11:00:00Z' });
    expect(trocarSalaEvento({ id: 'abc123_20261023T100000Z', salaId: 'sala-aulas' }, servico(cal)).salaId).toBe('sala-aulas');
  });

  it('as 7 salas fixas', () => {
    expect([...SALAS_FIXAS]).toEqual([
      'sala-doutoramento',
      'sala-investigacao',
      'sala-aulas',
      'sala-orientacoes',
      'sala-mba',
      'sala-pessoal',
      'sala-casa',
    ]);
  });
});

describe('eventos: todas as agendas marcadas', () => {
  function semana(opcoes?: OpcoesDoFalso) {
    const cal = agendasDoDono(opcoes);
    cal.evento(PRINCIPAL, { id: 'p1', summary: 'Orientação com Renata', inicio: '2026-10-23T14:00:00+01:00', fim: '2026-10-23T15:00:00+01:00' });
    cal.evento(AULAS, { id: 'a1', summary: 'Aula da Aurora', inicio: '2026-10-23T09:00:00+01:00', fim: '2026-10-23T10:00:00+01:00' });
    cal.evento(FERIADOS, { id: 'f1', summary: 'Feriado fictício', inicio: '2026-10-23', fim: '2026-10-24', transparency: 'transparent' });
    return cal;
  }

  it('lê a principal e as agendas marcadas, em ordem de início; a principal vem como "primary"', () => {
    const cal = semana();
    const eventos = lista({ de: '2026-10-23', ate: '2026-10-23' }, servico(cal));
    expect(eventos.map((e) => e.id)).toEqual(['f1', 'a1', 'p1']);
    expect(eventos[2].agendaId).toBe('primary');
    expect(eventos[0].agendaId).toMatch(ALIAS);
    expect(eventos[1].agendaId).toMatch(ALIAS);
    expect(eventos[0].agendaId).not.toBe(eventos[1].agendaId);
  });

  it('agendaId das outras agendas é um apelido opaco e estável, nunca o id do Google', () => {
    const cal = semana();
    const primeira = lista({ de: '2026-10-23', ate: '2026-10-23' }, servico(cal));
    const segunda = lista({ de: '2026-10-23', ate: '2026-10-23' }, servico(cal));
    expect(segunda.map((e) => e.agendaId)).toEqual(primeira.map((e) => e.agendaId));
    const texto = JSON.stringify(primeira);
    for (const proibido of [AULAS, FERIADOS, 'example.com', '@']) expect(texto).not.toContain(proibido);
  });

  it('agenda desmarcada ou escondida fica de fora; a principal entra mesmo desmarcada', () => {
    const cal = semana();
    cal.agendas.get(AULAS)!.entrada.selected = false;
    cal.agendas.get(FERIADOS)!.entrada.hidden = true;
    cal.agendas.get(PRINCIPAL)!.entrada.selected = false;
    const eventos = lista({ de: '2026-10-23', ate: '2026-10-23' }, servico(cal));
    expect(eventos.map((e) => e.id)).toEqual(['p1']);
    expect(cal.de('Events.list').map((c) => c.args[0])).toEqual(['primary']);
  });

  it('pede eventos únicos, por início, no fuso de Lisboa, do começo de "de" ao fim de "ate"', () => {
    const cal = semana();
    lista({ de: '2026-10-23', ate: '2026-10-26' }, servico(cal));
    for (const chamada of cal.de('Events.list')) {
      expect(chamada.args[1]).toMatchObject({
        singleEvents: true,
        orderBy: 'startTime',
        timeZone: 'Europe/Lisbon',
        timeMin: '2026-10-23T00:00:00+01:00',
        timeMax: '2026-10-27T00:00:00+00:00',
        maxResults: 2500,
      });
    }
  });

  it('só pede os campos usados: sem descrição nem e-mail de convidados', () => {
    const cal = semana();
    lista({ de: '2026-10-23', ate: '2026-10-23' }, servico(cal));
    const campos = (cal.de('Events.list')[0].args[1] as { fields: string }).fields;
    expect(campos).toContain('nextPageToken');
    for (const campo of ['summary', 'start', 'end', 'transparency', 'htmlLink', 'extendedProperties', 'responseStatus', 'self']) {
      expect(campos).toContain(campo);
    }
    expect(campos).not.toMatch(/description|email|location/);
  });

  it('o Evento tem só os 10 campos, mesmo quando a API manda mais', () => {
    const cal = semana();
    cal.evento(PRINCIPAL, {
      id: 'p2',
      summary: 'Com descrição',
      description: 'Texto longo da Marina',
      inicio: '2026-10-23T16:00:00+01:00',
      fim: '2026-10-23T17:00:00+01:00',
      attendees: [{ email: 'renata.ficticia@example.com', responseStatus: 'accepted' }],
    });
    const p2 = lista({ de: '2026-10-23', ate: '2026-10-23' }, servico(cal)).find((e) => e.id === 'p2')!;
    expect(Object.keys(p2).sort()).toEqual(
      ['agendaId', 'diaInteiro', 'fim', 'id', 'inicio', 'link', 'livre', 'recusado', 'salaId', 'titulo'].sort(),
    );
  });

  describe('marcadores', () => {
    function um(evento: Parameters<CalendarioFalso['evento']>[1]) {
      const cal = agendasDoDono();
      cal.evento(PRINCIPAL, evento);
      return lista({ de: '2026-10-23', ate: '2026-10-23' }, servico(cal))[0];
    }
    const hora = { inicio: '2026-10-23T11:00:00+01:00', fim: '2026-10-23T12:00:00+01:00' };

    it('dia inteiro: diaInteiro, datas AAAA-MM-DD e fim exclusivo', () => {
      expect(um({ id: 'd', summary: 'Congresso', inicio: '2026-10-23', fim: '2026-10-24' })).toMatchObject({
        diaInteiro: true,
        inicio: '2026-10-23',
        fim: '2026-10-24',
        livre: false,
        recusado: false,
      });
    });

    it('livre: transparency transparent', () => {
      expect(um({ id: 'l', summary: 'Lembrete', ...hora, transparency: 'transparent' })).toMatchObject({ livre: true, diaInteiro: false });
      expect(um({ id: 'o', summary: 'Ocupado', ...hora, transparency: 'opaque' }).livre).toBe(false);
    });

    it('recusado: o próprio dono (self) recusou', () => {
      const convite = (eu: string, outro: string) => ({
        id: 'r',
        summary: 'Banca',
        ...hora,
        attendees: [
          { email: 'souza.ficticio@example.com', organizer: true, responseStatus: outro },
          { email: 'marina.ficticia@example.com', self: true, responseStatus: eu },
        ],
      });
      expect(um(convite('declined', 'accepted')).recusado).toBe(true);
      expect(um(convite('accepted', 'declined')).recusado).toBe(false);
      expect(um(convite('needsAction', 'declined')).recusado).toBe(false);
      expect(um(convite('tentative', 'accepted')).recusado).toBe(false);
    });

    it('evento comum: nenhum marcador', () => {
      expect(um({ id: 'c', summary: 'Café', ...hora })).toMatchObject({ diaInteiro: false, livre: false, recusado: false });
    });

    it('sala vem da propriedade privada centralSala; sem ela ou inválida, null', () => {
      expect(um({ id: 's', summary: 'a', ...hora, extendedProperties: { private: { centralSala: 'sala-mba' } } }).salaId).toBe('sala-mba');
      expect(um({ id: 's', summary: 'a', ...hora, extendedProperties: { private: { centralSala: 'sala-x' } } }).salaId).toBeNull();
      expect(um({ id: 's', summary: 'a', ...hora, extendedProperties: { shared: { centralSala: 'sala-mba' } } }).salaId).toBeNull();
      expect(um({ id: 's', summary: 'a', ...hora, extendedProperties: { private: { centralSala: '' } } }).salaId).toBeNull();
      expect(um({ id: 's', summary: 'a', ...hora }).salaId).toBeNull();
    });

    it('sem título vira texto vazio', () => {
      expect(um({ id: 't', ...hora }).titulo).toBe('');
    });

    it('link só se for https do Google Agenda', () => {
      expect(um({ id: 'k', summary: 'a', ...hora }).link).toBe('https://www.google.com/calendar/event?eid=k');
      expect(um({ id: 'k', summary: 'a', ...hora, htmlLink: 'javascript:alert(1)' }).link).toBeNull();
      expect(um({ id: 'k', summary: 'a', ...hora, htmlLink: 'https://exemplo.invalid/calendar/x' }).link).toBeNull();
      expect(um({ id: 'k', summary: 'a', ...hora, htmlLink: 'http://www.google.com/calendar/event?eid=k' }).link).toBeNull();
    });
  });

  it('evento apagado e local de trabalho ficam de fora', () => {
    const cal = semana();
    cal.evento(PRINCIPAL, { id: 'x', summary: 'Apagado', status: 'cancelled', inicio: '2026-10-23T08:00:00+01:00', fim: '2026-10-23T09:00:00+01:00' });
    cal.evento(PRINCIPAL, { id: 'w', summary: 'Em casa', eventType: 'workingLocation', inicio: '2026-10-23', fim: '2026-10-24' });
    const ids = lista({ de: '2026-10-23', ate: '2026-10-23' }, servico(cal)).map((e) => e.id);
    expect(ids).not.toContain('x');
    expect(ids).not.toContain('w');
  });

  it('segue as páginas da lista de agendas e de eventos, mesmo quando a API devolve menos que o pedido', () => {
    const cal = agendasDoDono({ paginaMaxima: 1 });
    for (let i = 0; i < 4; i++) {
      cal.evento(PRINCIPAL, { id: `p${i}`, summary: 'a', inicio: `2026-10-23T1${i}:00:00+01:00`, fim: `2026-10-23T1${i}:30:00+01:00` });
    }
    cal.evento(AULAS, { id: 'a1', summary: 'b', inicio: '2026-10-23T09:00:00+01:00', fim: '2026-10-23T09:30:00+01:00' });
    const eventos = lista({ de: '2026-10-23', ate: '2026-10-23' }, servico(cal));
    expect(eventos.map((e) => e.id)).toEqual(['a1', 'p0', 'p1', 'p2', 'p3']);
    expect(cal.de('CalendarList.list').length).toBe(3);
  });

  it(`com 600 eventos, traz todos; com mais de ${EVENTOS_NO_MAXIMO}, para em ${EVENTOS_NO_MAXIMO}`, () => {
    const cal = agendasDoDono();
    const base = Date.parse('2026-01-01T00:00:00Z');
    for (let i = 0; i < EVENTOS_NO_MAXIMO + 100; i++) {
      const inicio = new Date(base + i * 3 * 60 * 60 * 1000).toISOString();
      const fim = new Date(base + i * 3 * 60 * 60 * 1000 + 30 * 60 * 1000).toISOString();
      cal.evento(i % 2 ? PRINCIPAL : AULAS, { id: `e${i}`, summary: 'a', inicio, fim });
    }
    expect(lista({ de: '2026-01-01', ate: '2026-03-16' }, servico(cal))).toHaveLength(600);
    const todos = lista({ de: '2026-01-01', ate: '2027-01-01' }, servico(cal));
    expect(todos).toHaveLength(EVENTOS_NO_MAXIMO);
    const inicios = todos.map((e) => Date.parse(e.inicio));
    expect(inicios).toEqual([...inicios].sort((a, b) => a - b));
  });

  it('agenda assinada que falha é pulada; as outras seguem', () => {
    const cal = semana();
    const original = cal.servico.Events.list;
    cal.servico.Events.list = (id: string, args?: Record<string, unknown>) => {
      if (id === FERIADOS) throw new Error('API call to calendar.events.list failed with error: Not Found');
      return original(id, args);
    };
    const ids = lista({ de: '2026-10-23', ate: '2026-10-23' }, servico(cal)).map((e) => e.id);
    expect(ids).toEqual(['a1', 'p1']);
  });

  it('falha na agenda principal derruba o pedido (nada de agenda vazia enganosa)', () => {
    const cal = semana();
    const original = cal.servico.Events.list;
    cal.servico.Events.list = (id: string, args?: Record<string, unknown>) => {
      if (id === 'primary') throw new Error('API call to calendar.events.list failed with error: Backend Error');
      return original(id, args);
    };
    expect(() => lista({ de: '2026-10-23', ate: '2026-10-23' }, servico(cal))).toThrow(/Backend Error/);
  });
});

describe('removerEvento: desfazer a criação', () => {
  it('desfazer remove o evento criado pelo app, sem notificar ninguém', () => {
    const cal = agendasDoDono();
    const criado = criarEvento(reuniao(), servico(cal));
    expect(removerEvento({ id: criado.id }, servico(cal))).toEqual({ removido: true });

    expect(lista({ de: '2026-10-23', ate: '2026-10-23' }, servico(cal))).toEqual([]);
    const [chamada] = cal.de('Events.remove');
    expect(chamada.args).toEqual(['primary', criado.id, { sendUpdates: 'none' }]);
    expect(cal.notificacoes).toEqual([]);
  });

  it('nunca apaga evento do dono criado fora do app', () => {
    const cal = agendasDoDono();
    cal.evento(PRINCIPAL, { id: 'dono1', summary: 'Consulta', inicio: '2026-10-23T09:00:00+01:00', fim: '2026-10-23T10:00:00+01:00' });
    expect(() => removerEvento({ id: 'dono1' }, servico(cal))).toThrow();
    expect(cal.de('Events.remove')).toEqual([]);
    expect(cal.agendas.get(PRINCIPAL)!.eventos.get('dono1')!.status).toBe('confirmed');
  });

  it.each([
    ['marca diferente de "1"', { private: { centralCriado: 'sim' } }],
    ['marca compartilhada, não privada', { shared: { centralCriado: '1' } }],
    ['só a sala (trocada pelo app)', { private: { centralSala: 'sala-casa' } }],
  ])('não apaga com %s', (_nome, extendedProperties) => {
    const cal = agendasDoDono();
    cal.evento(PRINCIPAL, { id: 'dono2', summary: 'a', inicio: '2026-10-23T09:00:00+01:00', fim: '2026-10-23T10:00:00+01:00', extendedProperties });
    expect(() => removerEvento({ id: 'dono2' }, servico(cal))).toThrow();
    expect(cal.de('Events.remove')).toEqual([]);
  });

  it('só olha a agenda principal: id de evento de outra agenda não apaga nada', () => {
    const cal = agendasDoDono();
    cal.evento(AULAS, {
      id: 'aula1',
      summary: 'Aula',
      inicio: '2026-10-23T09:00:00+01:00',
      fim: '2026-10-23T10:00:00+01:00',
      extendedProperties: { private: { centralCriado: '1' } },
    });
    // Na principal ele não existe (404): nada a desfazer, e a outra agenda fica intacta.
    expect(removerEvento({ id: 'aula1' }, servico(cal))).toEqual({ removido: false });
    expect(cal.de('Events.get').map((c) => c.args[0])).toEqual(['primary']);
    expect(cal.de('Events.remove')).toEqual([]);
    expect(cal.agendas.get(AULAS)!.eventos.get('aula1')!.status).toBe('confirmed');
  });

  it('desfazer de novo (já apagado) responde removido: false, sem apagar outra vez', () => {
    const cal = agendasDoDono();
    const criado = criarEvento(reuniao(), servico(cal));
    removerEvento({ id: criado.id }, servico(cal));
    expect(removerEvento({ id: criado.id }, servico(cal))).toEqual({ removido: false });
    expect(cal.de('Events.remove')).toHaveLength(1);
  });

  it('desfazer continua valendo depois de trocar a sala, com patch que mescla ou que substitui', () => {
    for (const patch of ['mescla', 'substitui'] as const) {
      const cal = agendasDoDono({ patch });
      const criado = criarEvento(reuniao(), servico(cal));
      trocarSalaEvento({ id: criado.id, salaId: 'sala-casa' }, servico(cal));
      expect(removerEvento({ id: criado.id }, servico(cal))).toEqual({ removido: true });
    }
  });
});

describe('trocarSalaEvento', () => {
  const fora = { id: 'dono1', summary: 'Consulta', inicio: '2026-10-23T09:00:00+01:00', fim: '2026-10-23T10:00:00+01:00' };

  it('evento criado fora do app ganha a sala na propriedade privada, sem notificar', () => {
    const cal = agendasDoDono();
    cal.evento(PRINCIPAL, { ...fora, attendees: [{ email: 'renata.ficticia@example.com', responseStatus: 'accepted' }, { self: true, responseStatus: 'accepted' }] });
    const evento = trocarSalaEvento({ id: 'dono1', salaId: 'sala-pessoal' }, servico(cal));
    expect(evento).toMatchObject({ id: 'dono1', agendaId: 'primary', salaId: 'sala-pessoal', titulo: 'Consulta' });
    const [chamada] = cal.de('Events.patch');
    expect(chamada.args[1]).toBe('primary');
    expect(chamada.args[3]).toEqual({ sendUpdates: 'none' });
    expect(Object.keys(chamada.args[0] as object)).toEqual(['extendedProperties']);
    expect(cal.notificacoes).toEqual([]);
    expect(cal.agendas.get(PRINCIPAL)!.eventos.get('dono1')!.extendedProperties!.private).toEqual({ centralSala: 'sala-pessoal' });
  });

  it.each(['mescla', 'substitui'] as const)(
    'com patch que %s, manda só as privadas e mantém a marca do app e as compartilhadas',
    (patch) => {
      const cal = agendasDoDono({ patch });
      cal.evento(PRINCIPAL, { ...fora, extendedProperties: { private: { centralCriado: '1', outra: 'x' }, shared: { deOutroApp: 'y' } } });
      trocarSalaEvento({ id: 'dono1', salaId: 'sala-mba' }, servico(cal));
      const [corpo] = cal.de('Events.patch')[0].args as [{ extendedProperties: Record<string, unknown> }];
      expect(Object.keys(corpo.extendedProperties)).toEqual(['private']);
      expect(cal.agendas.get(PRINCIPAL)!.eventos.get('dono1')!.extendedProperties).toEqual({
        private: { centralCriado: '1', outra: 'x', centralSala: 'sala-mba' },
        shared: { deOutroApp: 'y' },
      });
    },
  );

  it('sala null tira a sala (fica vazia) e o Evento sai com salaId null', () => {
    const cal = agendasDoDono();
    const criado = criarEvento(reuniao(), servico(cal));
    expect(trocarSalaEvento({ id: criado.id, salaId: null }, servico(cal)).salaId).toBeNull();
    expect(lista({ de: '2026-10-23', ate: '2026-10-23' }, servico(cal))[0].salaId).toBeNull();
  });

  it('evento apagado ou de outra agenda: falha sem gravar', () => {
    const cal = agendasDoDono();
    const criado = criarEvento(reuniao(), servico(cal));
    removerEvento({ id: criado.id }, servico(cal));
    expect(() => trocarSalaEvento({ id: criado.id, salaId: 'sala-casa' }, servico(cal))).toThrow();
    cal.evento(AULAS, { ...fora, id: 'aula1' });
    expect(() => trocarSalaEvento({ id: 'aula1', salaId: 'sala-casa' }, servico(cal))).toThrow();
    expect(cal.de('Events.patch')).toEqual([]);
  });
});

describe('ações de agenda por tratar', () => {
  function ambiente(cal: CalendarioFalso | null): Ambiente {
    return {
      lerCodigo: () => CODIGO,
      armazem: armazemNaMemoria(),
      ...(cal ? { calendario: () => servico(cal) } : {}),
    };
  }
  const pedir = (amb: Ambiente, acao: string, dados: unknown, codigo = CODIGO) => tratar({ codigo, acao, dados }, amb);

  it('as quatro ações respondem ok', () => {
    const cal = agendasDoDono();
    const amb = ambiente(cal);
    const criado = pedir(amb, 'criarEvento', reuniao());
    expect(criado.ok).toBe(true);
    const id = (criado as { dados: Evento }).dados.id;
    expect(pedir(amb, 'eventos', { de: '2026-10-23', ate: '2026-10-23' })).toEqual({
      ok: true,
      dados: { eventos: [(criado as { dados: Evento }).dados], incompleto: false },
    });
    expect(pedir(amb, 'trocarSalaEvento', { id, salaId: 'sala-casa' })).toMatchObject({ ok: true, dados: { salaId: 'sala-casa' } });
    expect(pedir(amb, 'removerEvento', { id })).toEqual({ ok: true, dados: { removido: true } });
  });

  it('código errado não toca o Google Agenda', () => {
    const cal = agendasDoDono();
    expect(pedir(ambiente(cal), 'criarEvento', reuniao(), 'outro-codigo')).toEqual({ ok: false, erro: 'codigo-invalido' });
    expect(cal.chamadas).toEqual([]);
  });

  it('pedido inválido vira interno, sem chamada ao Google Agenda', () => {
    const cal = agendasDoDono();
    expect(pedir(ambiente(cal), 'criarEvento', reuniao({ salaId: 'sala-x' }))).toEqual({ ok: false, erro: 'interno' });
    expect(pedir(ambiente(cal), 'eventos', { de: '2026-01-01', ate: '2028-01-01' })).toEqual({ ok: false, erro: 'interno' });
    expect(cal.chamadas).toEqual([]);
  });

  it('sem o serviço do Google Agenda, interno', () => {
    expect(pedir(ambiente(null), 'eventos', { de: '2026-10-23', ate: '2026-10-23' })).toEqual({ ok: false, erro: 'interno' });
  });

  it('apagar evento do dono vira interno', () => {
    const cal = agendasDoDono();
    cal.evento(PRINCIPAL, { id: 'dono1', summary: 'Consulta', inicio: '2026-10-23T09:00:00+01:00', fim: '2026-10-23T10:00:00+01:00' });
    expect(pedir(ambiente(cal), 'removerEvento', { id: 'dono1' })).toEqual({ ok: false, erro: 'interno' });
  });

  it('o registro de erro não leva título, e-mail, id do evento nem nome de agenda', () => {
    const cal = agendasDoDono();
    const erros: string[] = [];
    const original = console.error;
    console.error = (...partes: unknown[]) => void erros.push(partes.map(String).join(' '));
    try {
      cal.evento(PRINCIPAL, {
        id: 'segredoid1234567890abcdef',
        summary: 'Segredo da Marina',
        inicio: '2026-10-23T09:00:00+01:00',
        fim: '2026-10-23T10:00:00+01:00',
      });
      pedir(ambiente(cal), 'removerEvento', { id: 'segredoid1234567890abcdef' });
      pedir(ambiente(cal), 'criarEvento', reuniao({ titulo: 'Segredo da Marina', salaId: 'sala-x' }));
      cal.servico.Events.list = () => {
        throw new Error(`API call to calendar.events.list failed with error: Not Found: ${PRINCIPAL} Segredo`);
      };
      pedir(ambiente(cal), 'eventos', { de: '2026-10-23', ate: '2026-10-23' });
    } finally {
      console.error = original;
    }
    const registrado = erros.join('\n');
    expect(erros.length).toBe(3);
    for (const proibido of ['Segredo', 'segredoid', PRINCIPAL, 'marina', 'example.com', 'sala-x']) {
      expect(registrado).not.toContain(proibido);
    }
  });
});

describe('rodada 1: criarEvento repetido não duplica (id do cliente)', () => {
  const ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

  it('id do cliente vai para o insert e volta no Evento', () => {
    const cal = agendasDoDono();
    const criado = criarEvento(reuniao({ id: ID }), servico(cal));
    expect(criado.id).toBe(ID);
    const [corpo] = cal.de('Events.insert')[0].args as [Record<string, unknown>];
    expect(corpo.id).toBe(ID);
  });

  it('sem id, o insert não leva id (o Google gera)', () => {
    const cal = agendasDoDono();
    criarEvento(reuniao(), servico(cal));
    expect(cal.de('Events.insert')[0].args[0]).not.toHaveProperty('id');
  });

  it('repetir com o mesmo id (409) devolve o evento já criado, sem criar outro', () => {
    const cal = agendasDoDono();
    const primeiro = criarEvento(reuniao({ id: ID }), servico(cal));
    const segundo = criarEvento(reuniao({ id: ID }), servico(cal));
    expect(segundo).toEqual(primeiro);
    expect(lista({ de: '2026-10-23', ate: '2026-10-23' }, servico(cal))).toHaveLength(1);
    expect(cal.de('Events.get').at(-1)!.args.slice(0, 2)).toEqual(['primary', ID]);
  });

  it('409 em evento sem a marca do app: falha e não devolve o evento do dono', () => {
    const cal = agendasDoDono();
    cal.evento(PRINCIPAL, { id: ID, summary: 'Consulta', inicio: '2026-10-23T09:00:00+01:00', fim: '2026-10-23T10:00:00+01:00' });
    expect(() => criarEvento(reuniao({ id: ID }), servico(cal))).toThrow();
  });

  it('409 de evento do app já desfeito: falha (não ressuscita nem finge criar)', () => {
    const cal = agendasDoDono();
    criarEvento(reuniao({ id: ID }), servico(cal));
    removerEvento({ id: ID }, servico(cal));
    expect(() => criarEvento(reuniao({ id: ID }), servico(cal))).toThrow();
  });

  it('409 reconhecido também só pela mensagem do Google', () => {
    const cal = agendasDoDono();
    const primeiro = criarEvento(reuniao({ id: ID }), servico(cal));
    cal.servico.Events.insert = () => {
      throw new Error('API call to calendar.events.insert failed with error: The requested identifier already exists.');
    };
    expect(criarEvento(reuniao({ id: ID }), servico(cal))).toEqual(primeiro);
  });

  it('outra falha do insert não vira get', () => {
    const cal = agendasDoDono();
    cal.servico.Events.insert = () => {
      throw new Error('API call to calendar.events.insert failed with error: Backend Error');
    };
    expect(() => criarEvento(reuniao({ id: ID }), servico(cal))).toThrow(/Backend Error/);
    expect(cal.de('Events.get')).toEqual([]);
  });

  it.each([
    ['curto demais', 'abcd'],
    ['letra fora do base32hex', 'abcdwxyz'],
    ['maiúscula', 'ABCDEF12'],
    ['sublinhado', 'abc_def12'],
    ['1025 caracteres', 'a'.repeat(1025)],
    ['número', 12345],
    ['nulo', null],
  ])('id %s é recusado antes de chamar o Google', (_nome, id) => {
    const cal = agendasDoDono();
    expect(() => criarEvento(reuniao({ id }), servico(cal))).toThrow(PedidoInvalido);
    expect(cal.chamadas).toEqual([]);
  });

  it('id de 5 e de 1024 caracteres é aceito', () => {
    const cal = agendasDoDono();
    expect(criarEvento(reuniao({ id: 'abcde' }), servico(cal)).id).toBe('abcde');
    expect(criarEvento(reuniao({ id: 'v'.repeat(1024) }), servico(cal)).id).toBe('v'.repeat(1024));
  });
});

describe('rodada 1: removerEvento com evento que sumiu', () => {
  it.each([
    ['404 no get', 'Not Found', 404],
    ['410 no get', 'Resource has been deleted', 410],
  ])('%s responde removido: false', (_nome, texto, status) => {
    const cal = agendasDoDono();
    cal.servico.Events.get = () => {
      const erro = new Error(`API call to calendar.events.get failed with error: ${texto}`) as Error & { details?: unknown };
      erro.details = { code: status, message: texto };
      throw erro;
    };
    expect(removerEvento({ id: 'abc123' }, servico(cal))).toEqual({ removido: false });
    expect(cal.de('Events.remove')).toEqual([]);
  });

  it('404 reconhecido só pela mensagem; e evento inexistente no falso também', () => {
    const cal = agendasDoDono();
    expect(removerEvento({ id: 'naoexiste123' }, servico(cal))).toEqual({ removido: false });
    cal.servico.Events.get = () => {
      throw new Error('API call to calendar.events.get failed with error: Not Found');
    };
    expect(removerEvento({ id: 'abc123' }, servico(cal))).toEqual({ removido: false });
  });

  it('410 no delete (apagado entre o get e o delete) responde removido: false', () => {
    const cal = agendasDoDono();
    const criado = criarEvento(reuniao(), servico(cal));
    const original = cal.servico.Events.remove;
    cal.servico.Events.remove = (agendaId: string, id: string, args?: Record<string, unknown>) => {
      original(agendaId, id, args);
      original(agendaId, id, args);
    };
    expect(removerEvento({ id: criado.id }, servico(cal))).toEqual({ removido: false });
  });

  it('outra falha no get continua sendo erro', () => {
    const cal = agendasDoDono();
    cal.servico.Events.get = () => {
      throw new Error('API call to calendar.events.get failed with error: Forbidden');
    };
    expect(() => removerEvento({ id: 'abc123' }, servico(cal))).toThrow(/Forbidden/);
  });
});

describe('rodada 1: troca de hora (horas que não existem e que existem duas vezes)', () => {
  it.each(['01:00', '01:30', '01:59'])('29/03/2026 às %s não existe em Lisboa: início recusado sem chamar o Google', (hora) => {
    const cal = agendasDoDono();
    expect(() => criarEvento(reuniao({ data: '2026-03-29', inicio: hora, fim: '03:00' }), servico(cal))).toThrow(PedidoInvalido);
    expect(cal.chamadas).toEqual([]);
  });

  it('fim numa hora que não existe também é recusado', () => {
    const cal = agendasDoDono();
    expect(() => criarEvento(reuniao({ data: '2026-03-29', inicio: '00:30', fim: '01:30' }), servico(cal))).toThrow(PedidoInvalido);
  });

  it('em volta do buraco: 00:59 e 02:00 existem', () => {
    const cal = agendasDoDono();
    const criado = criarEvento(reuniao({ data: '2026-03-29', inicio: '00:59', fim: '02:00' }), servico(cal));
    expect(criado.inicio).toBe('2026-03-29T00:59:00+00:00');
    expect(criado.fim).toBe('2026-03-29T02:00:00+01:00');
  });

  it('a mesma hora noutro domingo de março existe', () => {
    const cal = agendasDoDono();
    expect(criarEvento(reuniao({ data: '2026-03-22', inicio: '01:30', fim: '02:30' }), servico(cal)).inicio).toBe(
      '2026-03-22T01:30:00+00:00',
    );
  });

  it('25/10/2026 entre 01:00 e 01:59 existe duas vezes: vale a primeira (ainda horário de verão, +01:00)', () => {
    const cal = agendasDoDono();
    const criado = criarEvento(reuniao({ data: '2026-10-25', inicio: '01:30', fim: '01:45' }), servico(cal));
    const [corpo] = cal.de('Events.insert')[0].args as [Record<string, any>];
    expect(corpo.start.dateTime).toBe('2026-10-25T01:30:00+01:00');
    expect(criado.inicio).toBe('2026-10-25T01:30:00+01:00');
    expect(criado.fim).toBe('2026-10-25T01:45:00+01:00');
    expect(Date.parse(criado.inicio)).toBe(Date.parse('2026-10-25T00:30:00Z'));
  });

  it('25/10/2026: 00:30 é verão e 02:00 já é inverno', () => {
    const cal = agendasDoDono();
    const criado = criarEvento(reuniao({ data: '2026-10-25', inicio: '00:30', fim: '02:00' }), servico(cal));
    expect(criado.inicio).toBe('2026-10-25T00:30:00+01:00');
    expect(criado.fim).toBe('2026-10-25T02:00:00+00:00');
  });
});

describe('rodada 1: data de Lisboa no editor', () => {
  it.each([
    [Date.parse('2026-07-01T23:30:00Z'), '2026-07-02'],
    [Date.parse('2026-07-01T22:59:00Z'), '2026-07-01'],
    [Date.parse('2026-12-31T23:30:00Z'), '2026-12-31'],
  ])('hojeEmLisboa(%i) = %s', (agora, dia) => {
    expect(hojeEmLisboa(agora)).toBe(dia);
  });

  it('provarAgenda lê o dia de Lisboa, não o de UTC', () => {
    const cal = agendasDoDono();
    provarAgenda(servico(cal), Date.parse('2026-07-01T23:30:00Z'));
    expect(cal.de('Events.list').at(-1)!.args[1]).toMatchObject({
      timeMin: '2026-07-02T00:00:00+01:00',
      timeMax: '2026-07-03T00:00:00+01:00',
    });
  });
});

describe('rodada 1: eventos diz quando a lista está incompleta', () => {
  it('tudo lido: incompleto false', () => {
    const cal = agendasDoDono();
    cal.evento(PRINCIPAL, { id: 'p1', summary: 'a', inicio: '2026-10-23T09:00:00Z', fim: '2026-10-23T10:00:00Z' });
    expect(listarEventos({ de: '2026-10-23', ate: '2026-10-23' }, servico(cal)).incompleto).toBe(false);
  });

  it('agenda assinada pulada: incompleto true', () => {
    const cal = agendasDoDono();
    const original = cal.servico.Events.list;
    cal.servico.Events.list = (id: string, args?: Record<string, unknown>) => {
      if (id === FERIADOS) throw new Error('API call to calendar.events.list failed with error: Not Found');
      return original(id, args);
    };
    expect(listarEventos({ de: '2026-10-23', ate: '2026-10-23' }, servico(cal)).incompleto).toBe(true);
  });

  it(`teto de ${EVENTOS_NO_MAXIMO} eventos atingido: incompleto true`, () => {
    const cal = agendasDoDono();
    const base = Date.parse('2026-01-01T00:00:00Z');
    for (let i = 0; i < EVENTOS_NO_MAXIMO + 1; i++) {
      const ms = base + i * 3 * 60 * 60 * 1000;
      cal.evento(i % 2 ? PRINCIPAL : AULAS, { id: `e${i}`, summary: 'a', inicio: new Date(ms).toISOString(), fim: new Date(ms + 60_000).toISOString() });
    }
    const resposta = listarEventos({ de: '2026-01-01', ate: '2027-01-01' }, servico(cal));
    expect(resposta.eventos).toHaveLength(EVENTOS_NO_MAXIMO);
    expect(resposta.incompleto).toBe(true);
  });

  it(`exatamente ${EVENTOS_NO_MAXIMO} eventos: completo`, () => {
    const cal = agendasDoDono();
    const base = Date.parse('2026-01-01T00:00:00Z');
    for (let i = 0; i < EVENTOS_NO_MAXIMO; i++) {
      const ms = base + i * 3 * 60 * 60 * 1000;
      cal.evento(PRINCIPAL, { id: `e${i}`, summary: 'a', inicio: new Date(ms).toISOString(), fim: new Date(ms + 60_000).toISOString() });
    }
    expect(listarEventos({ de: '2026-01-01', ate: '2027-01-01' }, servico(cal)).incompleto).toBe(false);
  });

  it(`mais de ${AGENDAS_NO_MAXIMO} agendas marcadas: incompleto true`, () => {
    const cal = agendasDoDono();
    for (let i = 0; i < AGENDAS_NO_MAXIMO; i++) cal.agenda({ id: `extra${i}@group.example.com`, accessRole: 'reader' });
    expect(listarEventos({ de: '2026-10-23', ate: '2026-10-23' }, servico(cal)).incompleto).toBe(true);
  });
});

describe('rodada 1 da T13: motivo do erro só de uma lista fechada', () => {
  function falhaDoGet(texto: string): Error {
    const cal = agendasDoDono();
    cal.servico.Events.get = () => {
      throw new Error(`API call to calendar.events.get failed with error: ${texto}`);
    };
    try {
      removerEvento({ id: 'abc123' }, servico(cal));
    } catch (erro) {
      return erro as Error;
    }
    throw new Error('não falhou');
  }

  it('motivo fora da lista vira "falhou": nem o começo de um endereço passa', () => {
    const erro = falhaDoGet('Not Allowed marina@exemplo.invalid "Reunião secreta"');
    expect(erro.message).toBe('Google Agenda (events.get): falhou');
  });

  it('motivo conhecido fica inteiro, mesmo com mais de 40 caracteres', () => {
    const erro = falhaDoGet('Request had insufficient authentication scopes. marina@exemplo.invalid');
    expect(erro.message).toBe('Google Agenda (events.get): Request had insufficient authentication scopes');
  });

  it('o que vem depois de um motivo conhecido não passa', () => {
    expect(falhaDoGet('Forbidden: marina segredo').message).toBe('Google Agenda (events.get): Forbidden');
  });

  it('texto sem o formato da API vira "falhou"', () => {
    const cal = agendasDoDono();
    cal.servico.Events.get = () => {
      throw new Error('Marina Aurora');
    };
    expect(() => removerEvento({ id: 'abc123' }, servico(cal))).toThrow(/^Google Agenda \(events\.get\): falhou$/);
  });
});
