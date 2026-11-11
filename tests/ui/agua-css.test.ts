import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/ui/agua.css'), 'utf8');

/** O corpo da primeira regra cujo seletor é exatamente `seletor`. */
function regra(seletor: string): string {
  const achada = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].find((m) => m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim() === seletor);
  expect(achada, `regra ${seletor}`).toBeTruthy();
  return achada![2];
}

describe('agua.css', () => {
  it('as garrafinhas coral que quebram de linha ficam alinhadas à esquerda, não à direita', () => {
    const corpo = regra('.garrafinhas');
    expect(corpo).toContain('flex-wrap: wrap');
    expect(corpo).toContain('justify-content: flex-start');
  });

  it('o quadro de dica guarda o espaço de duas linhas, para a altura não pular entre atrás, em dia e meta', () => {
    expect(regra('.agua-dica')).toMatch(/min-height:/);
  });
});
