import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Evento } from '../../src/dados/agenda';
import { atualizarEmails, type Email } from '../../src/dados/emails';
import { esquecerEventos } from '../../src/dados/eventos';
import {
  cabeAgora,
  calcularFila,
  calcularTempoLivre,
  montarFila,
  tempoLivre,
  type ItemFila,
} from '../../src/dados/fila';
import { salvar } from '../../src/dados/loja';
import type { EstadoEmail, ParaSalvar, Tarefa } from '../../src/dados/tipos';

// Quinta-feira, 2026-11-05, 12:20 em Lisboa (WET = UTC em novembro).
const AGORA = new Date('2026-11-05T12:20:00Z');
const HOJE = '2026-11-05';

let proximoId = 0;

function tarefa(titulo: string, extra: Partial<Tarefa> = {}): Tarefa {
  return {
    id: `t${++proximoId}`,
    atualizadoEm: 1,
    aparelho: 'teste',
    titulo,
    salaId: null,
    duracaoMin: 60,
    duracaoConfirmada: true,
    feito: false,
    fixada: false,
    marcar: false,
    ...extra,
  };
}

function email(id: string, data: string, extra: Partial<Email> = {}): Email {
  return {
    id,
    remetente: 'Marina',
    enderecoRemetente: 'marina@exemplo.com',
    assunto: `Assunto ${id}`,
    trecho: 'Olá, tudo bem?',
    data,
    link: `https://mail.google.com/mail/u/0/#inbox/${id}`,
    ...extra,
  };
}

function estado(id: string, extra: Partial<EstadoEmail> = {}): EstadoEmail {
  return { id, atualizadoEm: 1, aparelho: 'teste', feito: false, ...extra };
}

function evento(titulo: string, inicio: string, fim: string, extra: Partial<Evento> = {}): Evento {
  return {
    id: titulo,
    agendaId: 'primary',
    titulo,
    inicio,
    fim,
    diaInteiro: false,
    livre: false,
    recusado: false,
    salaId: null,
    link: null,
    ...extra,
  };
}

const fila = (
  tarefas: Tarefa[],
  emails: Email[] = [],
  estadosEmail: EstadoEmail[] = [],
  agora: Date = AGORA,
): ItemFila[] => calcularFila({ agora, tarefas, emails, estadosEmail });

const titulos = (itens: ItemFila[]) => itens.map((item) => item.titulo);

beforeEach(() => {
  proximoId = 0;
});

describe('calcularFila: ordem', () => {
  it('põe fixadas, atrasadas, hoje, prazos próximos, esta semana e e-mails, nesta ordem', () => {
    const itens = fila(
      [
        tarefa('Prazo da sexta', { data: '2026-11-06', prazoHora: '17:00' }),
        tarefa('Ligar para o Prof. Souza', { data: HOJE }),
        tarefa('Revisar relatório', { data: '2026-11-03' }),
        tarefa('Organizar a semana', { semana: '2026-11-02' }),
        tarefa('Preparar aula da Aurora', { fixada: true, data: '2026-11-20' }),
      ],
      [email('m1', '2026-11-05T09:00:00+00:00')],
    );

    expect(titulos(itens)).toEqual([
      'Preparar aula da Aurora',
      'Revisar relatório',
      'Ligar para o Prof. Souza',
      'Prazo da sexta',
      'Organizar a semana',
      'Responder: Assunto m1',
    ]);
    expect(itens.map((item) => item.grupo)).toEqual(['fixada', 'atrasada', 'hoje', 'prazo', 'semana', 'email']);
  });

  it('fixada fica no topo mesmo sem prazo, e uma fixada atrasada não aparece duas vezes', () => {
    const itens = fila([
      tarefa('Comum de hoje', { data: HOJE }),
      tarefa('Fixada sem prazo', { fixada: true }),
      tarefa('Fixada atrasada', { fixada: true, data: '2026-11-01' }),
    ]);
    expect(titulos(itens)).toEqual(['Fixada atrasada', 'Fixada sem prazo', 'Comum de hoje']);
    expect(new Set(itens.map((item) => item.chave)).size).toBe(3);
  });

  it('atrasadas: a mais antiga primeiro', () => {
    const itens = fila([
      tarefa('Terça', { data: '2026-11-03' }),
      tarefa('Domingo', { data: '2026-11-01' }),
      tarefa('Quarta', { data: '2026-11-04' }),
    ]);
    expect(titulos(itens)).toEqual(['Domingo', 'Terça', 'Quarta']);
    expect(itens.every((item) => item.grupo === 'atrasada')).toBe(true);
  });

  it('hoje: quem tem hora de prazo vem primeiro, pela hora; o resto por título', () => {
    const itens = fila([
      tarefa('Zeta', { data: HOJE }),
      tarefa('Entrega às 18', { data: HOJE, prazoHora: '18:00' }),
      tarefa('Alfa', { data: HOJE }),
      tarefa('Entrega às 15', { data: HOJE, prazoHora: '15:00' }),
    ]);
    expect(titulos(itens)).toEqual(['Entrega às 15', 'Entrega às 18', 'Alfa', 'Zeta']);
  });

  it('prazos: entram a 7 dias, na ordem da data; passou de 7 dias fica de fora', () => {
    const itens = fila([
      tarefa('Prazo em 7 dias', { data: '2026-11-12', prazoHora: '10:00' }),
      tarefa('Prazo em 8 dias', { data: '2026-11-13', prazoHora: '10:00' }),
      tarefa('Prazo amanhã', { data: '2026-11-06', prazoHora: '09:00' }),
      tarefa('Prazo em 3 dias', { data: '2026-11-08', prazoHora: '09:00' }),
    ]);
    expect(titulos(itens)).toEqual(['Prazo amanhã', 'Prazo em 3 dias', 'Prazo em 7 dias']);
    expect(itens.every((item) => item.grupo === 'prazo')).toBe(true);
  });

  it('tarefa comum de outro dia (sem prazo marcado) não entra', () => {
    expect(fila([tarefa('Amanhã', { data: '2026-11-06' }), tarefa('Sem prazo')])).toEqual([]);
  });

  it('prazo vencido vira atrasada', () => {
    const [item] = fila([tarefa('Entrega que passou', { data: '2026-11-04', prazoHora: '17:00' })]);
    expect(item.grupo).toBe('atrasada');
  });

  it('Esta semana: só a da semana atual, sem dia; semana que passou não entra', () => {
    const itens = fila([
      tarefa('Desta semana', { semana: '2026-11-02' }),
      tarefa('Da semana passada', { semana: '2026-10-26' }),
      tarefa('Da próxima', { semana: '2026-11-09' }),
    ]);
    expect(titulos(itens)).toEqual(['Desta semana']);
  });

  it('concluídas, apagadas e adiadas para depois de hoje ficam de fora', () => {
    const itens = fila([
      tarefa('Feita', { data: HOJE, feito: true }),
      tarefa('Apagada', { data: HOJE, apagado: true }),
      tarefa('Adiada para amanhã', { data: HOJE, adiadaAte: '2026-11-06' }),
      tarefa('Adiada até hoje', { data: HOJE, adiadaAte: HOJE }),
      tarefa('Fixada adiada', { fixada: true, adiadaAte: '2026-11-06' }),
    ]);
    expect(titulos(itens)).toEqual(['Adiada até hoje']);
  });

  it('usa o dia de Lisboa: 00:30 de 6/11 em Lisboa já é outro dia', () => {
    const itens = fila([tarefa('Hoje de verdade', { data: '2026-11-06' })], [], [], new Date('2026-11-06T00:30:00Z'));
    expect(itens[0].grupo).toBe('hoje');
  });
});

describe('calcularFila: e-mails', () => {
  it('do mais antigo ao mais novo, com 5 minutos e sem "cerca de"', () => {
    const itens = fila(
      [],
      [
        email('novo', '2026-11-05T10:00:00+00:00'),
        email('velho', '2026-11-01T08:00:00+00:00'),
        email('meio', '2026-11-03T08:00:00+00:00'),
      ],
    );
    expect(itens.map((item) => item.email?.id)).toEqual(['velho', 'meio', 'novo']);
    expect(itens.every((item) => item.tipo === 'email' && item.minutos === 5 && item.estimada === false)).toBe(true);
  });

  it('compara pelo instante, não pelo texto (fusos diferentes)', () => {
    const itens = fila(
      [],
      [email('b', '2026-11-05T10:00:00+01:00'), email('a', '2026-11-05T09:30:00+00:00')],
    );
    // 10:00+01:00 = 09:00Z, antes de 09:30Z
    expect(itens.map((item) => item.email?.id)).toEqual(['b', 'a']);
  });

  it('Feito e Agora não escondem; Agora não volta no dia seguinte', () => {
    const emails = [email('feito', '2026-11-01T08:00:00+00:00'), email('adiado', '2026-11-02T08:00:00+00:00'), email('livre', '2026-11-03T08:00:00+00:00')];
    const estados = [estado('feito', { feito: true }), estado('adiado', { adiadaAte: '2026-11-06' })];
    expect(fila([], emails, estados).map((item) => item.email?.id)).toEqual(['livre']);
    const amanha = new Date('2026-11-06T09:00:00Z');
    expect(fila([], emails, estados, amanha).map((item) => item.email?.id)).toEqual(['adiado', 'livre']);
  });

  it('estado apagado (lápide) não esconde o e-mail', () => {
    const itens = fila([], [email('m1', '2026-11-01T08:00:00+00:00')], [estado('m1', { feito: true, apagado: true })]);
    expect(itens).toHaveLength(1);
  });

  it('tarefa ligada a e-mail é um item só: a tarefa, com o e-mail junto', () => {
    const itens = fila(
      [tarefa('Responder: Assunto m1', { data: HOJE, emailId: 'm1' })],
      [email('m1', '2026-11-01T08:00:00+00:00'), email('m2', '2026-11-02T08:00:00+00:00')],
    );
    expect(titulos(itens)).toEqual(['Responder: Assunto m1', 'Responder: Assunto m2']);
    expect(itens[0]).toMatchObject({ tipo: 'tarefa', grupo: 'hoje', minutos: 60 });
    expect(itens[0].email?.id).toBe('m1');
    expect(itens[1].tipo).toBe('email');
  });

  it('tarefa ligada ao e-mail ainda sem prazo: o e-mail não volta como item solto', () => {
    const itens = fila([tarefa('Responder: Assunto m1', { emailId: 'm1' })], [email('m1', '2026-11-01T08:00:00+00:00')]);
    expect(itens).toEqual([]);
  });

  it('tarefa apagada que era do e-mail devolve o e-mail à fila', () => {
    const itens = fila([tarefa('Responder', { emailId: 'm1', apagado: true })], [email('m1', '2026-11-01T08:00:00+00:00')]);
    expect(itens.map((item) => item.tipo)).toEqual(['email']);
  });
});

describe('calcularFila: duração', () => {
  it('duração não confirmada sai como estimada; confirmada, não', () => {
    const itens = fila([
      tarefa('Sem confirmar', { data: HOJE, duracaoConfirmada: false }),
      tarefa('Confirmada', { data: HOJE, duracaoMin: 25, duracaoConfirmada: true }),
    ]);
    const por = Object.fromEntries(itens.map((item) => [item.titulo, item]));
    expect(por['Sem confirmar']).toMatchObject({ minutos: 60, estimada: true });
    expect(por['Confirmada']).toMatchObject({ minutos: 25, estimada: false });
  });

  it('duração inválida vale 60 min, estimada', () => {
    const itens = fila([
      tarefa('Zero', { data: HOJE, duracaoMin: 0 }),
      tarefa('Negativa', { data: HOJE, duracaoMin: -5 }),
      tarefa('Texto', { data: HOJE, duracaoMin: Number.NaN }),
    ]);
    expect(itens.map((item) => [item.minutos, item.estimada])).toEqual([[60, true], [60, true], [60, true]]);
  });

  it('não muda os dados de entrada', () => {
    const tarefas = [tarefa('B', { data: HOJE }), tarefa('A', { data: HOJE })];
    const copia = structuredClone(tarefas);
    fila(tarefas);
    expect(tarefas).toEqual(copia);
  });
});

describe('cabeAgora', () => {
  const item = (titulo: string, minutos: number, estimada = false): ItemFila => ({
    chave: `tarefa:${titulo}`,
    tipo: 'tarefa',
    grupo: 'hoje',
    titulo,
    minutos,
    estimada,
  });

  it('soma as durações na ordem: cabe até estourar, o resto é Depois', () => {
    const resultado = cabeAgora([item('A', 30), item('B', 40), item('C', 20)], 100);
    expect(resultado.map((r) => [r.item.titulo, r.cabe, r.acumulado])).toEqual([
      ['A', true, 30],
      ['B', true, 70],
      ['C', true, 90],
    ]);
    const apertado = cabeAgora([item('A', 30), item('B', 40), item('C', 40)], 100);
    expect(apertado.map((r) => r.cabe)).toEqual([true, true, false]);
  });

  it('cabe exatamente no limite', () => {
    expect(cabeAgora([item('A', 60), item('B', 40)], 100).map((r) => r.cabe)).toEqual([true, true]);
  });

  it('depois do primeiro que não cabe, nada mais cabe (a ordem da fila manda)', () => {
    const resultado = cabeAgora([item('A', 30), item('Grande', 90), item('Pequena', 5)], 100);
    expect(resultado.map((r) => r.cabe)).toEqual([true, false, false]);
  });

  it('sem tempo livre nada cabe; fila vazia dá lista vazia', () => {
    expect(cabeAgora([item('A', 5)], 0).map((r) => r.cabe)).toEqual([false]);
    expect(cabeAgora([item('A', 5)], -10).map((r) => r.cabe)).toEqual([false]);
    expect(cabeAgora([], 100)).toEqual([]);
  });

  it('guarda a mesma ordem e os mesmos itens da fila', () => {
    const a = item('A', 10);
    const b = item('B', 10, true);
    expect(cabeAgora([a, b], 100).map((r) => r.item)).toEqual([a, b]);
  });
});

describe('calcularTempoLivre', () => {
  const livre = (eventos: Evento[], agora = AGORA, fimDoDia?: string) =>
    calcularTempoLivre({ agora, eventos, ...(fimDoDia ? { fimDoDia } : {}) });

  it('12:20 com evento às 14:00: 100 minutos, até 14:00', () => {
    const reuniao = evento('Reunião', '2026-11-05T14:00:00+00:00', '2026-11-05T15:00:00+00:00');
    expect(livre([reuniao])).toEqual({ ate: '14:00', minutos: 100, proximo: reuniao });
  });

  it('sem evento: até as 20:00', () => {
    expect(livre([])).toEqual({ ate: '20:00', minutos: 460 });
  });

  it('o fim do dia é ajustável', () => {
    expect(livre([], AGORA, '18:30')).toEqual({ ate: '18:30', minutos: 370 });
  });

  it('fim do dia inválido volta para 20:00', () => {
    expect(livre([], AGORA, 'tarde').ate).toBe('20:00');
    expect(livre([], AGORA, '25:00').ate).toBe('20:00');
  });

  it('vale o primeiro compromisso que vem, mesmo fora de ordem', () => {
    const depois = evento('Depois', '2026-11-05T17:00:00+00:00', '2026-11-05T18:00:00+00:00');
    const antes = evento('Antes', '2026-11-05T13:00:00+00:00', '2026-11-05T13:30:00+00:00');
    expect(livre([depois, antes])).toEqual({ ate: '13:00', minutos: 40, proximo: antes });
  });

  it('dia inteiro, livre e recusado não contam', () => {
    const eventos = [
      evento('Feriado', '2026-11-05', '2026-11-06', { diaInteiro: true }),
      evento('Lembrete', '2026-11-05T13:00:00+00:00', '2026-11-05T13:30:00+00:00', { livre: true }),
      evento('Recusado', '2026-11-05T13:10:00+00:00', '2026-11-05T14:00:00+00:00', { recusado: true }),
    ];
    expect(livre(eventos)).toEqual({ ate: '20:00', minutos: 460 });
  });

  it('compromisso que já terminou não conta', () => {
    const manha = evento('Manhã', '2026-11-05T09:00:00+00:00', '2026-11-05T10:00:00+00:00');
    expect(livre([manha])).toEqual({ ate: '20:00', minutos: 460 });
  });

  it('compromisso em andamento: 0 minuto livre, e ele aparece como próximo', () => {
    const aula = evento('Aula', '2026-11-05T12:00:00+00:00', '2026-11-05T13:00:00+00:00');
    expect(livre([aula])).toEqual({ ate: '12:20', minutos: 0, proximo: aula });
  });

  it('compromisso que começa agora (12:20 em ponto) já está em andamento', () => {
    const agora = evento('Agora', '2026-11-05T12:20:00+00:00', '2026-11-05T12:50:00+00:00');
    expect(livre([agora]).minutos).toBe(0);
  });

  it('compromisso que começa depois do fim do dia não limita o tempo livre', () => {
    const noite = evento('Jantar', '2026-11-05T21:00:00+00:00', '2026-11-05T22:30:00+00:00');
    expect(livre([noite])).toEqual({ ate: '20:00', minutos: 460 });
  });

  it('compromisso de amanhã não limita o dia de hoje', () => {
    const amanha = evento('Amanhã', '2026-11-06T09:00:00+00:00', '2026-11-06T10:00:00+00:00');
    expect(livre([amanha])).toEqual({ ate: '20:00', minutos: 460 });
  });

  it('depois do fim do dia: 0 minuto, sem próximo', () => {
    expect(livre([], new Date('2026-11-05T20:30:00Z'))).toEqual({ ate: '20:00', minutos: 0 });
  });

  it('usa a hora de Lisboa no verão (UTC+1)', () => {
    const agora = new Date('2026-07-15T11:20:00Z'); // 12:20 em Lisboa
    const reuniao = evento('Reunião', '2026-07-15T14:00:00+01:00', '2026-07-15T15:00:00+01:00');
    expect(livre([reuniao], agora)).toEqual({ ate: '14:00', minutos: 100, proximo: reuniao });
  });

  it('data ou hora ilegíveis no evento são ignoradas', () => {
    const quebrado = evento('Quebrado', 'amanhã cedo', '2026-11-05T15:00:00+00:00');
    expect(livre([quebrado])).toEqual({ ate: '20:00', minutos: 460 });
  });
});

describe('montarFila e tempoLivre: leem o estado atual', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(AGORA);
    esquecerEventos();
  });

  const paraSalvar = (titulo: string, extra: Partial<ParaSalvar<Tarefa>> = {}): ParaSalvar<Tarefa> => {
    const { id: _id, atualizadoEm: _a, aparelho: _ap, ...resto } = tarefa(titulo, extra);
    return resto;
  };

  it('montarFila junta tarefas do banco, e-mails da memória e estados do banco', async () => {
    await salvar('tarefas', paraSalvar('Revisar capítulo 2', { data: HOJE }));
    await salvar('tarefas', paraSalvar('Fora', { data: '2026-12-01' }));
    await salvar('estadosEmail', { id: 'm2', feito: true });
    await atualizarEmails(false, {
      conectado: async () => true,
      pingar: async () => ({}),
      agora: () => 1,
      buscar: async () => [email('m1', '2026-11-04T09:00:00+00:00'), email('m2', '2026-11-03T09:00:00+00:00')],
    });

    expect(titulos(await montarFila())).toEqual(['Revisar capítulo 2', 'Responder: Assunto m1']);
    // Sem o argumento, vale a hora do relógio; um dia depois, a tarefa de hoje vira atrasada.
    expect((await montarFila(new Date('2026-11-06T09:00:00Z')))[0].grupo).toBe('atrasada');
  });

  it('tempoLivre lê os eventos de hoje da memória e o fim do dia dos ajustes', async () => {
    const { atualizarEventos } = await import('../../src/dados/eventos');
    const reuniao = evento('Reunião', '2026-11-05T14:00:00+00:00', '2026-11-05T15:00:00+00:00');
    await atualizarEventos(HOJE, HOJE, {
      conectado: async () => true,
      listar: async () => ({ eventos: [reuniao], incompleto: false }),
      pingar: async () => ({}),
      agora: () => 1,
    });
    expect(await tempoLivre()).toEqual({ ate: '14:00', minutos: 100, proximo: reuniao });
  });

  it('tempoLivre sem leitura de eventos: até o fim do dia padrão', async () => {
    expect(await tempoLivre()).toEqual({ ate: '20:00', minutos: 460 });
  });

  it('tempoLivre respeita o fim do dia salvo nos ajustes', async () => {
    await salvar('config', { id: 'config', fimDoDia: '18:00' });
    expect(await tempoLivre()).toEqual({ ate: '18:00', minutos: 340 });
  });
});
