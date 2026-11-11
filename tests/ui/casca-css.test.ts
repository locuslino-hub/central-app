import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/ui/casca.css'), 'utf8');

/** O corpo da primeira regra cujo seletor é exatamente `seletor` (lista separada por vírgula, na ordem escrita). */
function regra(seletor: string): string {
  const achada = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].find((m) => m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim().replace(/\s+/g, ' ') === seletor);
  expect(achada, `regra ${seletor}`).toBeTruthy();
  return achada![2];
}

describe('casca.css', () => {
  it('o hover da barra e do trilho se vê sobre o fundo da folha (não repete --poco, quase igual a ele)', () => {
    const corpo = regra('.atalhos a:hover, .atalhos button.mais:hover');
    expect(corpo).toContain('rgb(var(--som-rgb) / 0.08)');
    expect(corpo).not.toContain('var(--poco)');
  });
});
