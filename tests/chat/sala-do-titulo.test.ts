import { describe, expect, it } from 'vitest';
import { montarMemoria } from '../../src/chat/memoria';
import { salaDoTitulo } from '../../src/chat/regras';
import { PALAVRAS_INICIAIS } from '../../src/dados/loja';
import type { Palavra, Pessoa } from '../../src/dados/tipos';

// Compromissos que vêm do Google não têm sala gravada: a Central adivinha pelo
// título, com as mesmas regras das tarefas (nome da sala, palavra guardada, pessoa).

const base = { atualizadoEm: 1, aparelho: 'a' };
const PALAVRAS: Palavra[] = PALAVRAS_INICIAIS.map(([id, termo, salaId]) => ({ id, termo, salaId, ...base }));
const PESSOAS: Pessoa[] = [
  { id: 'p-renata', nome: 'Renata', salaId: 'sala-orientacoes', ...base } as Pessoa,
  { id: 'p-souza', nome: 'Prof. Souza', salaId: 'sala-doutoramento', ...base } as Pessoa,
];
const memoria = montarMemoria(PESSOAS, PALAVRAS, []);
const sala = (titulo: string) => salaDoTitulo(titulo, memoria);

describe('salaDoTitulo: a sala de um compromisso sem sala, pelo título', () => {
  it('o nome da sala no título decide', () => {
    expect(sala('Seminário do doutoramento')).toBe('sala-doutoramento');
    expect(sala('Reunião de Investigação')).toBe('sala-investigacao');
    expect(sala('Aula do MBA')).toBe('sala-mba');
    expect(sala('Aulas de métodos')).toBe('sala-aulas');
  });

  it('o nome específico vale antes da palavra comum ("Aula do MBA" é MBA, não Aulas)', () => {
    expect(sala('Aula do MBA')).toBe('sala-mba');
  });

  it('sem acento e sem maiúscula: "ORIENTACAO" acha Orientações', () => {
    expect(sala('ORIENTACAO semanal')).toBe('sala-orientacoes');
  });

  it('palavra guardada na memória ("projeto" é Investigação, "tese" é Doutoramento)', () => {
    expect(sala('Reunião do projeto Aurora')).toBe('sala-investigacao');
    expect(sala('Foco: correção da tese')).toBe('sala-doutoramento');
    expect(sala('Trocar a lâmpada da cozinha')).toBe('sala-casa');
  });

  it('pessoa cadastrada citada: a sala da pessoa', () => {
    expect(sala('Conversa com a Renata')).toBe('sala-orientacoes');
    expect(sala('Café com o Prof. Souza')).toBe('sala-doutoramento');
  });

  it('a sala dita no título vale antes da pessoa', () => {
    expect(sala('Aula com a Renata')).toBe('sala-aulas');
  });

  it('nada bate: fica sem sala (neutro)', () => {
    expect(sala('Dentista')).toBeNull();
    expect(sala('')).toBeNull();
    expect(sala('   ')).toBeNull();
  });

  it('palavra inteira: "projetor" não é "projeto", "casamento" não é "casa"', () => {
    expect(sala('Buscar o projetor')).toBeNull();
    expect(sala('Casamento da Aurora')).toBeNull();
  });
});
