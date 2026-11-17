import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// C-17: classes de CSS que nenhuma tela usa. Se voltarem a ser usadas, saem desta lista.
const MORTAS = ['foco-vazio', 'salas-links', 'sala-bloco', 'cal-prazo'];
const PASTA = join(__dirname, '../../src/ui');

describe('CSS sem classes mortas (C-17)', () => {
  it.each(MORTAS)('a classe %s não aparece nos arquivos .css de src/ui', (classe) => {
    const comAClasse = readdirSync(PASTA)
      .filter((arquivo) => arquivo.endsWith('.css'))
      .filter((arquivo) => new RegExp(`\.${classe}(?![\w-])`).test(readFileSync(join(PASTA, arquivo), 'utf8')));
    expect(comAClasse).toEqual([]);
  });
});
