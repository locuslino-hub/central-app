import { describe, expect, it, vi } from 'vitest';
import { SALAS_FIXAS, type ServicoDeAgenda } from '../../script/agenda';
import { tratar } from '../../script/api';
import { ErroConexao, ErroScript } from '../../src/conexao/cliente';
import { salvarConexao } from '../../src/conexao/guarda';
import {
  ErroAgenda,
  criarEvento,
  eventoValido,
  listarEventos,
  novoIdDeEvento,
  removerEvento,
  trocarSalaEvento,
  type Evento,
} from '../../src/dados/agenda';
import { listar, semear } from '../../src/dados/loja';
import { armazemNaMemoria } from '../apoio/armazem';
import { agendasDoDono, type CalendarioFalso } from '../apoio/calendario';

const CODIGO = 'codigo-ficticio-de-teste-0123456789abcdef';
const PRINCIPAL = 'marina.ficticia@example.com';

/** O script de verdade, com o Google Agenda falso, no lugar de `chamar`; dados passam por JSON. */
function scriptDeTeste(cal: CalendarioFalso = agendasDoDono()) {
  const pedidos: { acao: string; dados: unknown }[] = [];
  const ambiente = {
    lerCodigo: () => CODIGO,
    armazem: armazemNaMemoria(),
    calendario: () => cal.servico as unknown as ServicoDeAgenda,
  };
  async function chamar<T>(acao: string, dados: object = {}): Promise<T> {
    const copia = JSON.parse(JSON.stringify(dados));
    pedidos.push({ acao, dados: copia });
    const resposta = tratar({ codigo: CODIGO, acao, dados: copia }, ambiente);
    if (!resposta.ok) throw new ErroScript(resposta.erro);
    return JSON.parse(JSON.stringify(resposta.dados)) as T;
  }
  return { cal, pedidos, chamar };
}

const reuniao = { titulo: 'Orientação com Renata', data: '2026-10-26', inicio: '11:00', fim: '12:00', salaId: 'sala-orientacoes' };

/** Hora de parede no fuso dos testes (Europe/Lisbon, ver tests/setup-fuso.ts). */
const horaLocal = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

async function falhaDe(promessa: Promise<unknown>) {
  const erro = await promessa.then(
    () => null,
    (e: unknown) => e,
  );
  expect(erro).toBeInstanceOf(ErroAgenda);
  return (erro as ErroAgenda).falha;
}

describe('agenda no app: o caminho todo até o script', () => {
  it.each(['2026-10-23', '2026-10-26'])('criado às 11:00 de %s aparece às 11:00 no aparelho', async (data) => {
    const { chamar } = scriptDeTeste();
    const criado = await criarEvento({ ...reuniao, data }, { chamar });
    expect(horaLocal(criado.inicio)).toBe('11:00');
    const [lido] = (await listarEventos({ de: data, ate: data }, { chamar })).eventos;
    expect(lido).toEqual(criado);
    expect(horaLocal(lido.inicio)).toBe('11:00');
    expect(horaLocal(lido.fim)).toBe('12:00');
  });

  it('manda as ações e os dados do brief', async () => {
    const { chamar, pedidos } = scriptDeTeste();
    const criado = await criarEvento(reuniao, { chamar });
    await listarEventos({ de: '2026-10-26', ate: '2026-10-26' }, { chamar });
    await trocarSalaEvento(criado.id, 'sala-casa', { chamar });
    await removerEvento(criado.id, { chamar });
    expect(pedidos).toEqual([
      { acao: 'criarEvento', dados: { ...reuniao, id: criado.id } },
      { acao: 'eventos', dados: { de: '2026-10-26', ate: '2026-10-26' } },
      { acao: 'trocarSalaEvento', dados: { id: criado.id, salaId: 'sala-casa' } },
      { acao: 'removerEvento', dados: { id: criado.id } },
    ]);
  });

  it('desfazer remove e, repetido, diz que já não estava lá', async () => {
    const { chamar } = scriptDeTeste();
    const criado = await criarEvento(reuniao, { chamar });
    expect(await removerEvento(criado.id, { chamar })).toEqual({ removido: true });
    expect(await listarEventos({ de: '2026-10-26', ate: '2026-10-26' }, { chamar })).toEqual({ eventos: [], incompleto: false });
    expect(await removerEvento(criado.id, { chamar })).toEqual({ removido: false });
  });

  it('trocar a sala devolve o evento com a sala nova; null tira a sala', async () => {
    const { chamar } = scriptDeTeste();
    const criado = await criarEvento(reuniao, { chamar });
    expect((await trocarSalaEvento(criado.id, 'sala-mba', { chamar })).salaId).toBe('sala-mba');
    expect((await trocarSalaEvento(criado.id, null, { chamar })).salaId).toBeNull();
  });

  it('marcadores de dia inteiro, livre e recusado chegam ao app', async () => {
    const cal = agendasDoDono();
    cal.evento(PRINCIPAL, { id: 'd1', summary: 'Congresso', inicio: '2026-10-26', fim: '2026-10-27' });
    cal.evento(PRINCIPAL, { id: 'l1', summary: 'Lembrete', inicio: '2026-10-26T09:00:00Z', fim: '2026-10-26T09:30:00Z', transparency: 'transparent' });
    cal.evento(PRINCIPAL, {
      id: 'r1',
      summary: 'Banca',
      inicio: '2026-10-26T15:00:00Z',
      fim: '2026-10-26T16:00:00Z',
      attendees: [{ self: true, responseStatus: 'declined' }],
    });
    const { chamar } = scriptDeTeste(cal);
    const { eventos } = await listarEventos({ de: '2026-10-26', ate: '2026-10-26' }, { chamar });
    expect(eventos.map((e) => [e.id, e.diaInteiro, e.livre, e.recusado])).toEqual([
      ['d1', true, false, false],
      ['l1', false, true, false],
      ['r1', false, false, true],
    ]);
  });

  it('apagar evento do dono criado fora do app falha e o evento fica', async () => {
    const cal = agendasDoDono();
    cal.evento(PRINCIPAL, { id: 'dono1', summary: 'Consulta', inicio: '2026-10-26T09:00:00Z', fim: '2026-10-26T10:00:00Z' });
    const { chamar } = scriptDeTeste(cal);
    expect(await falhaDe(removerEvento('dono1', { chamar }))).toBe('falhou');
    expect(cal.agendas.get(PRINCIPAL)!.eventos.get('dono1')!.status).toBe('confirmed');
  });
});

describe('erros da agenda no app', () => {
  const lancar = (erro: unknown) => vi.fn(async () => Promise.reject(erro)) as unknown as <T>(acao: string, dados?: object) => Promise<T>;

  it.each([
    ['sem rede', 'sem-internet', new ErroConexao()],
    ['código errado', 'codigo-invalido', new ErroScript('codigo-invalido')],
    ['script recusou', 'falhou', new ErroScript('interno')],
    ['script ocupado', 'falhou', new ErroScript('ocupado')],
    ['erro inesperado', 'falhou', new TypeError('quebrou')],
  ])('%s -> %s, nas quatro funções', async (_caso, falha, erro) => {
    const chamar = lancar(erro);
    expect(await falhaDe(listarEventos({ de: '2026-10-26', ate: '2026-10-26' }, { chamar }))).toBe(falha);
    expect(await falhaDe(criarEvento(reuniao, { chamar }))).toBe(falha);
    expect(await falhaDe(removerEvento('abc123', { chamar }))).toBe(falha);
    expect(await falhaDe(trocarSalaEvento('abc123', 'sala-casa', { chamar }))).toBe(falha);
  });

  it('pedido inválido é recusado no aparelho, sem chamar o script', async () => {
    const chamar = vi.fn();
    const opcoes = { chamar: chamar as unknown as <T>(acao: string, dados?: object) => Promise<T> };
    expect(await falhaDe(criarEvento({ ...reuniao, fim: '10:00' }, opcoes))).toBe('invalido');
    expect(await falhaDe(criarEvento({ ...reuniao, titulo: 'a'.repeat(201) }, opcoes))).toBe('invalido');
    expect(await falhaDe(criarEvento({ ...reuniao, salaId: 'sala-x' }, opcoes))).toBe('invalido');
    expect(await falhaDe(listarEventos({ de: '2026-10-27', ate: '2026-10-26' }, opcoes))).toBe('invalido');
    expect(await falhaDe(listarEventos({ de: '2026-01-01', ate: '2028-01-01' }, opcoes))).toBe('invalido');
    expect(await falhaDe(removerEvento('a/b', opcoes))).toBe('invalido');
    expect(await falhaDe(trocarSalaEvento('abc', 'sala-x', opcoes))).toBe('invalido');
    expect(chamar).not.toHaveBeenCalled();
  });

  const valido: Evento = {
    id: 'abc123',
    agendaId: 'primary',
    titulo: 'Aula da Aurora',
    inicio: '2026-10-26T11:00:00+00:00',
    fim: '2026-10-26T12:00:00+00:00',
    diaInteiro: false,
    livre: false,
    recusado: false,
    salaId: 'sala-aulas',
    link: 'https://www.google.com/calendar/event?eid=abc123',
  };
  const responde = (dados: unknown) => (async () => dados) as unknown as <T>(acao: string, dados?: object) => Promise<T>;

  it('resposta em forma errada vira falhou', async () => {
    expect(await falhaDe(listarEventos({ de: '2026-10-26', ate: '2026-10-26' }, { chamar: responde({}) }))).toBe('falhou');
    expect(await falhaDe(listarEventos({ de: '2026-10-26', ate: '2026-10-26' }, { chamar: responde([]) }))).toBe('falhou');
    expect(
      await falhaDe(listarEventos({ de: '2026-10-26', ate: '2026-10-26' }, { chamar: responde({ eventos: [], incompleto: 'não' }) })),
    ).toBe('falhou');
    expect(await falhaDe(criarEvento(reuniao, { chamar: responde({ ...valido, inicio: 'amanhã' }) }))).toBe('falhou');
    expect(await falhaDe(trocarSalaEvento('abc123', 'sala-casa', { chamar: responde(null) }))).toBe('falhou');
    expect(await falhaDe(removerEvento('abc123', { chamar: responde({ removido: 'sim' }) }))).toBe('falhou');
  });

  it('na lista, só os itens em forma errada ficam de fora, e a lista fica marcada incompleta', async () => {
    const lista = [valido, { ...valido, id: 'x', link: 'javascript:alert(1)' }, { ...valido, id: 'y', salaId: 'sala-x' }, 'lixo'];
    const resposta = await listarEventos({ de: '2026-10-26', ate: '2026-10-26' }, { chamar: responde({ eventos: lista, incompleto: false }) });
    expect(resposta).toEqual({ eventos: [valido], incompleto: true });
  });

  it('incompleto do script chega ao app', async () => {
    const resposta = await listarEventos({ de: '2026-10-26', ate: '2026-10-26' }, { chamar: responde({ eventos: [valido], incompleto: true }) });
    expect(resposta).toEqual({ eventos: [valido], incompleto: true });
  });

  it('ErroAgenda tem nome e mensagem sem dados do pedido', async () => {
    const erro = await criarEvento({ ...reuniao, titulo: 'Segredo da Marina', fim: '10:00' }, { chamar: vi.fn() as never }).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroAgenda);
    expect((erro as Error).name).toBe('ErroAgenda');
    expect((erro as Error).message).not.toContain('Segredo');
  });

  it('sem opções, usa o chamar da conexão salva', async () => {
    await salvarConexao({ url: 'https://script.google.com/macros/s/ID-FICTICIO/exec', codigo: CODIGO });
    const falso = vi.fn(
      async (_url: string, _opcoes: RequestInit) => new Response(JSON.stringify({ ok: true, dados: { eventos: [], incompleto: false } })),
    );
    vi.stubGlobal('fetch', falso);
    expect(await listarEventos({ de: '2026-10-26', ate: '2026-10-26' })).toEqual({ eventos: [], incompleto: false });
    expect(JSON.parse(falso.mock.calls[0][1].body as string)).toMatchObject({ acao: 'eventos', dados: { de: '2026-10-26', ate: '2026-10-26' } });
  });
});

describe('eventoValido', () => {
  const base: Evento = {
    id: 'abc123',
    agendaId: 'primary',
    titulo: '',
    inicio: '2026-10-26',
    fim: '2026-10-27',
    diaInteiro: true,
    livre: false,
    recusado: false,
    salaId: null,
    link: null,
  };

  it('aceita dia inteiro e horário com fuso', () => {
    expect(eventoValido(base)).toBe(true);
    expect(eventoValido({ ...base, diaInteiro: false, inicio: '2026-10-26T11:00:00+00:00', fim: '2026-10-26T12:00:00+00:00' })).toBe(true);
  });

  it.each([
    ['dia inteiro com horário', { inicio: '2026-10-26T11:00:00+00:00' }],
    ['horário sem fuso', { diaInteiro: false, inicio: '2026-10-26T11:00:00', fim: '2026-10-26T12:00:00' }],
    ['id vazio', { id: '' }],
    ['agenda não texto', { agendaId: 1 }],
    ['título não texto', { titulo: null }],
    ['livre não booleano', { livre: 'true' }],
    ['sala desconhecida', { salaId: 'sala-x' }],
    ['link http', { link: 'http://www.google.com/calendar/event?eid=a' }],
  ])('recusa %s', (_caso, troca) => {
    expect(eventoValido({ ...base, ...troca })).toBe(false);
  });
});

describe('salas fixas do script', () => {
  it('são as mesmas 7 salas semeadas pelo app', async () => {
    await semear();
    const salas = await listar('salas');
    expect([...SALAS_FIXAS].sort()).toEqual(salas.map((s) => s.id).sort());
  });
});

describe('rodada 1: id do evento gerado no aparelho', () => {
  it('novoIdDeEvento é base32hex de 32 caracteres e muda a cada chamada', () => {
    const a = novoIdDeEvento();
    const b = novoIdDeEvento();
    expect(a).toMatch(/^[a-v0-9]{32}$/);
    expect(b).toMatch(/^[a-v0-9]{32}$/);
    expect(a).not.toBe(b);
  });

  it('criarEvento sem id gera um; com id, usa o dado', async () => {
    const { chamar, pedidos } = scriptDeTeste();
    const primeiro = await criarEvento(reuniao, { chamar });
    const segundo = await criarEvento(reuniao, { chamar });
    expect(primeiro.id).toMatch(/^[a-v0-9]{32}$/);
    expect(segundo.id).not.toBe(primeiro.id);
    await criarEvento({ ...reuniao, id: 'abcdef0123' }, { chamar });
    expect((pedidos.at(-1)!.dados as { id: string }).id).toBe('abcdef0123');
  });

  it('repetir com o mesmo id (fila offline) devolve o mesmo evento e não duplica', async () => {
    const { chamar } = scriptDeTeste();
    const id = novoIdDeEvento();
    const primeiro = await criarEvento({ ...reuniao, id }, { chamar });
    expect(await criarEvento({ ...reuniao, id }, { chamar })).toEqual(primeiro);
    expect((await listarEventos({ de: '2026-10-26', ate: '2026-10-26' }, { chamar })).eventos).toHaveLength(1);
  });

  it('id inválido é recusado no aparelho', async () => {
    const chamar = vi.fn();
    expect(await falhaDe(criarEvento({ ...reuniao, id: 'ID_RUIM' }, { chamar: chamar as never }))).toBe('invalido');
    expect(chamar).not.toHaveBeenCalled();
  });

  it('hora que não existe em Lisboa (troca de março) é recusada no aparelho', async () => {
    const chamar = vi.fn();
    expect(
      await falhaDe(criarEvento({ ...reuniao, data: '2026-03-29', inicio: '01:30', fim: '03:00' }, { chamar: chamar as never })),
    ).toBe('invalido');
    expect(chamar).not.toHaveBeenCalled();
  });
});
