import { describe, expect, it } from 'vitest';
import { PAINEIS_DIREITOS, hrefDe, nomeDoMes, resolverRota } from '../../src/rotas';

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
    ['#/sem-prazo', 'sem-prazo', 'Sem prazo'],
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

  it.each(['#/sala', '#/sala/', '#/sala/a/b', '#/pessoa/', '#/nada', '#/semana/extra', 'semana', '#/__proto__'])(
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

describe('painel direito', () => {
  it('aceita Agora e Chat', () => {
    expect([...PAINEIS_DIREITOS]).toEqual(['agora', 'chat']);
  });
});
