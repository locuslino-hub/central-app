// @vitest-environment node
// "Feito" de compromisso espelhado no Google Agenda (spec 2026-11-09): o título
// ganha "✓ " e a marca privada centralFeito; convites de outras pessoas e
// eventos de outras agendas continuam aparecendo, só sem gravar no Google.
import { describe, expect, it } from 'vitest';
import { PedidoInvalido, criarEvento, listarEventos, marcarEventoFeito, type ServicoDeAgenda } from '../../script/agenda';
import { tratar, type Ambiente } from '../../script/api';
import { armazemNaMemoria } from '../apoio/armazem';
import { agendasDoDono, type CalendarioFalso } from '../apoio/calendario';

const PRINCIPAL = 'marina.ficticia@example.com';
const AULAS = 'aulas-ficticias@group.example.com';
const CODIGO = 'codigo-ficticio-de-teste-0123456789abcdef';
const HORA = { inicio: '2026-10-23T11:00:00+01:00', fim: '2026-10-23T12:00:00+01:00' };

const servico = (cal: CalendarioFalso) => cal.servico as unknown as ServicoDeAgenda;
const lista = (cal: CalendarioFalso) => listarEventos({ de: '2026-10-23', ate: '2026-10-23' }, servico(cal)).eventos;
const guardado = (cal: CalendarioFalso, id: string) => cal.agendas.get(PRINCIPAL)!.eventos.get(id)!;

/** Convite mandado por uma pessoa de fora: ela organiza, o dono é convidado. */
function convite(cal: CalendarioFalso, id = 'convite1') {
  return cal.evento(PRINCIPAL, {
    id,
    summary: 'Banca com Prof. Souza',
    ...HORA,
    organizer: { email: 'souza.ficticio@example.com' },
    creator: { email: 'souza.ficticio@example.com' },
    attendees: [
      { email: 'souza.ficticio@example.com', organizer: true, responseStatus: 'accepted' },
      { email: PRINCIPAL, self: true, responseStatus: 'accepted' },
    ],
  });
}

describe('eventos criados por outras pessoas continuam na Central', () => {
  it('convite (organizer.self false) na agenda principal é listado, com título e hora', () => {
    const cal = agendasDoDono();
    convite(cal);
    const [evento] = lista(cal);
    expect(evento).toMatchObject({
      id: 'convite1',
      agendaId: 'primary',
      titulo: 'Banca com Prof. Souza',
      inicio: HORA.inicio,
      fim: HORA.fim,
      recusado: false,
      somenteLeitura: true,
    });
    expect(evento.feito).toBeUndefined();
  });

  it('convite com organizer.self false explícito também é listado', () => {
    const cal = agendasDoDono();
    cal.evento(PRINCIPAL, { id: 'c2', summary: 'Reunião da Renata', ...HORA, organizer: { email: 'renata.ficticia@example.com', self: false } });
    expect(lista(cal).map((e) => e.id)).toEqual(['c2']);
  });

  it('evento do próprio dono não leva somenteLeitura; o de outra agenda leva', () => {
    const cal = agendasDoDono();
    cal.evento(PRINCIPAL, { id: 'meu', summary: 'Café', ...HORA, organizer: { self: true } });
    cal.evento(AULAS, { id: 'aula', summary: 'Aula da Aurora', ...HORA });
    const [aula, meu] = [lista(cal).find((e) => e.id === 'aula')!, lista(cal).find((e) => e.id === 'meu')!];
    expect(meu.somenteLeitura).toBeUndefined();
    expect(aula.somenteLeitura).toBe(true);
  });

  it('resposta sem organizador: falha fechado, vale como somente leitura e não grava', () => {
    const cal = agendasDoDono();
    cal.evento(PRINCIPAL, { id: 'semorg', summary: 'Sem organizador', ...HORA, organizer: undefined });
    expect(lista(cal)[0].somenteLeitura).toBe(true);
    expect(marcarEventoFeito({ id: 'semorg', feito: true }, servico(cal))).toEqual({ feito: true, gravado: false });
    expect(cal.de('Events.patch')).toEqual([]);
  });

  it('aniversário e outros tipos especiais não são gravados pelo app', () => {
    const cal = agendasDoDono();
    cal.evento(PRINCIPAL, { id: 'niver', summary: 'Aniversário da Aurora', inicio: '2026-10-23', fim: '2026-10-24', eventType: 'birthday' });
    expect(lista(cal)[0].somenteLeitura).toBe(true);
  });

  it('pede o organizador (só o self), nunca o e-mail dele', () => {
    const cal = agendasDoDono();
    lista(cal);
    const campos = (cal.de('Events.list')[0].args[1] as { fields: string }).fields;
    expect(campos).toContain('organizer(self)');
    expect(campos).not.toMatch(/email/);
  });
});

describe('leitura do feito', () => {
  it('título com "✓ " no começo: feito, e o título sai sem a marca', () => {
    const cal = agendasDoDono();
    cal.evento(PRINCIPAL, { id: 'f1', summary: '✓ Orientação com Renata', ...HORA });
    expect(lista(cal)[0]).toMatchObject({ titulo: 'Orientação com Renata', feito: true });
  });

  it('marca privada centralFeito "1": feito, mesmo sem o "✓ "', () => {
    const cal = agendasDoDono();
    cal.evento(PRINCIPAL, { id: 'f2', summary: 'Café', ...HORA, extendedProperties: { private: { centralFeito: '1' } } });
    expect(lista(cal)[0]).toMatchObject({ titulo: 'Café', feito: true });
  });

  it('"✓" sem espaço é do dono, não marca do app: não é feito e o título fica inteiro', () => {
    const cal = agendasDoDono();
    cal.evento(PRINCIPAL, { id: 'f4', summary: '✓Checklist do laboratório', ...HORA });
    const [evento] = lista(cal);
    expect(evento.titulo).toBe('✓Checklist do laboratório');
    expect(evento.feito).toBeUndefined();
  });

  it('centralFeito "" (desmarcado pelo app) vale mais que um "✓ " que ficou no título', () => {
    const cal = agendasDoDono();
    cal.evento(PRINCIPAL, { id: 'f5', summary: '✓ Café', ...HORA, extendedProperties: { private: { centralFeito: '' } } });
    expect(lista(cal)[0]).toMatchObject({ titulo: 'Café' });
    expect(lista(cal)[0].feito).toBeUndefined();
  });

  it('sem marca: não feito, e o "✓" no meio do título fica', () => {
    const cal = agendasDoDono();
    cal.evento(PRINCIPAL, { id: 'f3', summary: 'Lista ✓ revisada', ...HORA, extendedProperties: { private: { centralFeito: '' } } });
    const [evento] = lista(cal);
    expect(evento.titulo).toBe('Lista ✓ revisada');
    expect(evento.feito).toBeUndefined();
  });
});

describe('marcarEventoFeito', () => {
  function meu(cal: CalendarioFalso, extra = {}) {
    return cal.evento(PRINCIPAL, { id: 'meu1', summary: 'Orientação com Renata', ...HORA, organizer: { self: true }, ...extra });
  }

  it('marcar: título com "✓ " e centralFeito "1", só na principal e sem notificar', () => {
    const cal = agendasDoDono();
    meu(cal, { extendedProperties: { private: { centralSala: 'sala-orientacoes' }, shared: { outroApp: 'x' } } });
    expect(marcarEventoFeito({ id: 'meu1', feito: true }, servico(cal))).toEqual({ feito: true, gravado: true });
    const [chamada] = cal.de('Events.patch');
    expect(chamada.args[1]).toBe('primary');
    expect(chamada.args[3]).toEqual({ sendUpdates: 'none' });
    expect(Object.keys(chamada.args[0] as object).sort()).toEqual(['extendedProperties', 'summary']);
    expect(Object.keys((chamada.args[0] as { extendedProperties: object }).extendedProperties)).toEqual(['private']);
    expect(guardado(cal, 'meu1').summary).toBe('✓ Orientação com Renata');
    expect(guardado(cal, 'meu1').extendedProperties).toEqual({
      private: { centralSala: 'sala-orientacoes', centralFeito: '1' },
      shared: { outroApp: 'x' },
    });
    expect(cal.notificacoes).toEqual([]);
    expect(lista(cal)[0]).toMatchObject({ titulo: 'Orientação com Renata', feito: true, salaId: 'sala-orientacoes' });
  });

  it('desmarcar tira o "✓ " e a marca', () => {
    const cal = agendasDoDono();
    meu(cal);
    marcarEventoFeito({ id: 'meu1', feito: true }, servico(cal));
    expect(marcarEventoFeito({ id: 'meu1', feito: false }, servico(cal))).toEqual({ feito: false, gravado: true });
    expect(guardado(cal, 'meu1').summary).toBe('Orientação com Renata');
    expect(guardado(cal, 'meu1').extendedProperties!.private!.centralFeito).toBe('');
    expect(lista(cal)[0].feito).toBeUndefined();
  });

  it('repetir (fila que reenvia) não põe dois "✓" nem grava de novo', () => {
    const cal = agendasDoDono();
    meu(cal);
    marcarEventoFeito({ id: 'meu1', feito: true }, servico(cal));
    marcarEventoFeito({ id: 'meu1', feito: true }, servico(cal));
    expect(guardado(cal, 'meu1').summary).toBe('✓ Orientação com Renata');
    expect(cal.de('Events.patch')).toHaveLength(1);
  });

  it('título que já começa com "✓" (do dono) não ganha outro; desmarcar não tira o dele', () => {
    const cal = agendasDoDono();
    meu(cal, { summary: '✓Checklist do laboratório' });
    marcarEventoFeito({ id: 'meu1', feito: true }, servico(cal));
    expect(guardado(cal, 'meu1').summary).toBe('✓Checklist do laboratório');
    expect(lista(cal)[0]).toMatchObject({ titulo: '✓Checklist do laboratório', feito: true });
    marcarEventoFeito({ id: 'meu1', feito: false }, servico(cal));
    expect(guardado(cal, 'meu1').summary).toBe('✓Checklist do laboratório');
    expect(lista(cal)[0].feito).toBeUndefined();
  });

  it('com convidados, o título não muda (iria para eles): só a marca privada da cópia do dono', () => {
    const cal = agendasDoDono();
    meu(cal, {
      attendees: [
        { email: 'renata.ficticia@example.com', responseStatus: 'accepted' },
        { email: PRINCIPAL, self: true, organizer: true, responseStatus: 'accepted' },
      ],
    });
    expect(marcarEventoFeito({ id: 'meu1', feito: true }, servico(cal))).toEqual({ feito: true, gravado: true });
    const [chamada] = cal.de('Events.patch');
    expect(Object.keys(chamada.args[0] as object)).toEqual(['extendedProperties']);
    expect(chamada.args[3]).toEqual({ sendUpdates: 'none' });
    expect(guardado(cal, 'meu1').summary).toBe('Orientação com Renata');
    expect(guardado(cal, 'meu1').extendedProperties!.private!.centralFeito).toBe('1');
    expect(cal.notificacoes).toEqual([]);
    expect(lista(cal)[0]).toMatchObject({ titulo: 'Orientação com Renata', feito: true });

    marcarEventoFeito({ id: 'meu1', feito: false }, servico(cal));
    expect(guardado(cal, 'meu1').summary).toBe('Orientação com Renata');
    expect(lista(cal)[0].feito).toBeUndefined();
  });

  it('lê os convidados (só o self) antes de gravar, nunca o e-mail deles', () => {
    const cal = agendasDoDono();
    meu(cal);
    marcarEventoFeito({ id: 'meu1', feito: true }, servico(cal));
    const campos = (cal.de('Events.get')[0].args[2] as { fields: string }).fields;
    expect(campos).toContain('attendees(self)');
    expect(campos).not.toMatch(/email/);
  });

  it('evento criado pela Central pode ser marcado e mantém a marca do app', () => {
    const cal = agendasDoDono();
    const criado = criarEvento({ titulo: 'Reunião com Aurora', data: '2026-10-23', inicio: '11:00', fim: '12:00', salaId: null }, servico(cal));
    marcarEventoFeito({ id: criado.id, feito: true }, servico(cal));
    expect(guardado(cal, criado.id).extendedProperties!.private).toEqual({ centralCriado: '1', centralFeito: '1' });
  });

  it('convite de outra pessoa: não grava no Google e responde gravado false, sem erro', () => {
    const cal = agendasDoDono();
    convite(cal);
    expect(marcarEventoFeito({ id: 'convite1', feito: true }, servico(cal))).toEqual({ feito: true, gravado: false });
    expect(cal.de('Events.patch')).toEqual([]);
    expect(guardado(cal, 'convite1').summary).toBe('Banca com Prof. Souza');
  });

  it('evento que não está na principal, apagado ou que sumiu: gravado false, sem erro', () => {
    const cal = agendasDoDono();
    cal.evento(AULAS, { id: 'aula1', summary: 'Aula', ...HORA });
    cal.evento(PRINCIPAL, { id: 'apagado1', summary: 'Velho', ...HORA, status: 'cancelled' });
    for (const id of ['aula1', 'apagado1', 'naoexiste']) {
      expect(marcarEventoFeito({ id, feito: true }, servico(cal))).toEqual({ feito: true, gravado: false });
    }
    expect(cal.de('Events.patch')).toEqual([]);
  });

  it('Google recusando a escrita (403): gravado false, sem erro', () => {
    const cal = agendasDoDono();
    meu(cal);
    cal.servico.Events.patch = () => {
      const erro = new Error('API call to calendar.events.patch failed with error: Forbidden');
      (erro as Error & { details: unknown }).details = { code: 403 };
      throw erro;
    };
    expect(marcarEventoFeito({ id: 'meu1', feito: true }, servico(cal))).toEqual({ feito: true, gravado: false });
  });

  it('outra falha do Google sobe (a fila tenta de novo)', () => {
    const cal = agendasDoDono();
    meu(cal);
    cal.servico.Events.patch = () => {
      throw new Error('API call to calendar.events.patch failed with error: Backend Error');
    };
    expect(() => marcarEventoFeito({ id: 'meu1', feito: true }, servico(cal))).toThrow(/Backend Error/);
  });

  it.each([
    [{ id: 'meu1' }],
    [{ id: 'meu1', feito: 'sim' }],
    [{ id: 'a/b', feito: true }],
    [{ feito: true }],
    [null],
  ])('pedido inválido %j: recusado antes de chamar o Google', (dados) => {
    const cal = agendasDoDono();
    expect(() => marcarEventoFeito(dados, servico(cal))).toThrow(PedidoInvalido);
    expect(cal.chamadas).toEqual([]);
  });

  it('pela ação do script, e o registro de erro não leva título nem id', () => {
    const cal = agendasDoDono();
    meu(cal, { id: 'segredoid1234567890abcdef', summary: 'Segredo da Marina' });
    const ambiente: Ambiente = { lerCodigo: () => CODIGO, armazem: armazemNaMemoria(), calendario: () => servico(cal) };
    expect(tratar({ codigo: CODIGO, acao: 'marcarEventoFeito', dados: { id: 'segredoid1234567890abcdef', feito: true } }, ambiente)).toEqual({
      ok: true,
      dados: { feito: true, gravado: true },
    });
    const erros: string[] = [];
    const original = console.error;
    console.error = (...partes: unknown[]) => void erros.push(partes.map(String).join(' '));
    try {
      cal.servico.Events.patch = () => {
        throw new Error('API call to calendar.events.patch failed with error: Backend Error segredoid1234567890abcdef Segredo');
      };
      expect(tratar({ codigo: CODIGO, acao: 'marcarEventoFeito', dados: { id: 'segredoid1234567890abcdef', feito: false } }, ambiente)).toEqual({
        ok: false,
        erro: 'interno',
      });
    } finally {
      console.error = original;
    }
    expect(erros).toHaveLength(1);
    for (const proibido of ['Segredo', 'segredoid', 'marina']) expect(erros.join('\n')).not.toContain(proibido);
  });
});
