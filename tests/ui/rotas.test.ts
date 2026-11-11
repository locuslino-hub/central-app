import { describe, expect, it } from 'vitest';
import { hrefDe, hrefDoCalendario, nomeDoMes, resolverRota } from '../../src/rotas';

// Quinta-feira, 2026-11-05, 12:20 (Europe/Lisbon).
const AGORA = new Date(2026, 10, 5, 12, 20);

describe('resolverRota', () => {
  it.each([
    ['', 'hoje', 'Painel do dia'],
    ['#', 'hoje', 'Painel do dia'],
    ['#/', 'hoje', 'Painel do dia'],
    ['#/agora', 'agora', 'Agora'],
    ['#/semana', 'semana', 'Esta semana'],
    ['#/mes', 'mes', 'Novembro'],
    ['#/ano', 'ano', '2026'],
    ['#/salas', 'salas', 'Salas'],
    ['#/caixa', 'caixa', 'Caixa'],
    ['#/quadro', 'quadro', 'Quadro'],
    ['#/atividades', 'atividades', 'Atividades'],
    // A página Sem prazo deixou de existir: o endereço antigo leva a Atividades.
    ['#/sem-prazo', 'atividades', 'Atividades'],
    ['#/chat', 'chat', 'Chat'],
    ['#/conectar', 'conectar', 'Conectar aparelho'],
  ])('%j abre %s com o título %j', (hash, id, titulo) => {
    const rota = resolverRota(hash, AGORA);
    expect(rota.id).toBe(id);
    expect(rota.titulo).toBe(titulo);
  });

  it('as rotas com id levam o id', () => {
    expect(resolverRota('#/sala/sala-mba', AGORA)).toMatchObject({ id: 'sala', param: 'sala-mba', titulo: 'Sala' });
    expect(resolverRota('#/pessoa/p1', AGORA)).toMatchObject({ id: 'pessoa', param: 'p1', titulo: 'Pessoa' });
  });

  it('o id com caracteres especiais é decodificado', () => {
    expect(resolverRota('#/sala/sala%20x', AGORA).param).toBe('sala x');
    // %E0%A4%A é uma sequência inválida: vira "não encontrada", não erro.
    expect(resolverRota('#/sala/%E0%A4%A', AGORA).id).toBe('nao-encontrada');
  });

  it.each([
    '#/sala',
    '#/sala/',
    '#/sala/a/b',
    '#/pessoa/',
    '#/nada',
    '#/semana/extra',
    'semana',
    '#/__proto__',
    '#semana',
    '#//semana',
    '#/semana//',
    '#///',
    '/semana',
  ])(
    '%j é "não encontrada"',
    (hash) => {
      const rota = resolverRota(hash, AGORA);
      expect(rota.id).toBe('nao-encontrada');
      expect(rota.titulo).toBe('Página não encontrada');
    },
  );

  it('barra no fim e texto depois de ? são ignorados', () => {
    expect(resolverRota('#/semana/', AGORA).id).toBe('semana');
    expect(resolverRota('#/quadro?x=1', AGORA).id).toBe('quadro');
  });

  it('só as rotas sem nada a voltar não têm voltarPara; Conectar volta ao painel', () => {
    expect(resolverRota('#/conectar', AGORA).voltarPara).toBe('#/');
    expect(resolverRota('#/semana', AGORA).voltarPara).toBeUndefined();
  });

  it('o título do mês e do ano segue a data', () => {
    expect(resolverRota('#/mes', new Date(2026, 11, 1)).titulo).toBe('Dezembro');
    expect(resolverRota('#/ano', new Date(2027, 0, 1)).titulo).toBe('2027');
  });
});

describe('semana, mês e ano com data (?d=AAAA-MM-DD)', () => {
  it('a data vai para a rota e o título segue a data', () => {
    expect(resolverRota('#/semana?d=2026-11-03', AGORA)).toMatchObject({ id: 'semana', data: '2026-11-03', titulo: 'Esta semana' });
    expect(resolverRota('#/semana?d=2026-11-16', AGORA)).toMatchObject({ data: '2026-11-16', titulo: 'Semana de 16/11' });
    expect(resolverRota('#/semana?d=2026-11-09', AGORA).titulo).toBe('Próxima semana');
    expect(resolverRota('#/mes?d=2026-12-10', AGORA)).toMatchObject({ id: 'mes', data: '2026-12-10', titulo: 'Dezembro' });
    expect(resolverRota('#/mes?d=2027-01-05', AGORA).titulo).toBe('Janeiro de 2027');
    expect(resolverRota('#/ano?d=2027-03-01', AGORA)).toMatchObject({ id: 'ano', data: '2027-03-01', titulo: '2027' });
  });

  it('sem data (ou com data que não existe) vale hoje, e a rota não leva data', () => {
    for (const hash of ['#/semana', '#/semana?d=', '#/semana?d=abc', '#/semana?d=2026-02-30', '#/semana?d=2026-13-01', '#/semana?x=1']) {
      const rota = resolverRota(hash, AGORA);
      expect(rota.id).toBe('semana');
      expect(rota.data, hash).toBeUndefined();
      expect(rota.titulo).toBe('Esta semana');
    }
    expect(resolverRota('#/mes?d=2026-02-30', AGORA).titulo).toBe('Novembro');
  });

  it('a data é lida com outros parâmetros ao lado, e só nas três telas do calendário', () => {
    expect(resolverRota('#/semana?x=1&d=2026-11-16', AGORA).data).toBe('2026-11-16');
    expect(resolverRota('#/quadro?d=2026-11-16', AGORA).data).toBeUndefined();
    expect(resolverRota('#/', AGORA).data).toBeUndefined();
  });

  it('monta o endereço de cada tela com a data', () => {
    expect(hrefDoCalendario('semana', '2026-11-16')).toBe('#/semana?d=2026-11-16');
    expect(hrefDoCalendario('mes', '2026-12-01')).toBe('#/mes?d=2026-12-01');
    expect(hrefDoCalendario('ano')).toBe('#/ano');
  });
});

describe('nomeDoMes', () => {
  it('começa com maiúscula e usa o idioma do app, qualquer que seja o do aparelho', () => {
    expect(nomeDoMes(AGORA)).toBe('Novembro');
    expect(nomeDoMes(new Date(2026, 2, 10))).toBe('Março');
  });
});

describe('hrefDe', () => {
  it('monta o hash de cada rota', () => {
    expect(hrefDe('hoje')).toBe('#/');
    expect(hrefDe('semana')).toBe('#/semana');
    expect(hrefDe('sala', 'sala-mba')).toBe('#/sala/sala-mba');
    expect(hrefDe('pessoa', 'a b')).toBe('#/pessoa/a%20b');
  });
});
