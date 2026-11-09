import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/ui/tarefas.css'), 'utf8');

describe('tarefas.css', () => {
  it('respeita prefers-reduced-motion: sem transição na barra de progresso e na caixa de concluir', () => {
    const bloco = /@media \(prefers-reduced-motion: reduce\)\s*\{([^}]*\{[^}]*\})+[^}]*\}/.exec(css);
    expect(bloco).not.toBeNull();
    expect(bloco![0]).toContain('.progresso-cheio');
    expect(bloco![0]).toContain('.tarefa-marca');
    expect(bloco![0]).toContain('transition: none');
  });

  it('só seletores de classe (sem elementos nus como regra de nível raiz)', () => {
    const seletores = css
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/@media[^{]*\{/g, '')
      .split('}')
      .map((parte) => parte.split('{')[0].trim())
      .filter(Boolean)
      .flatMap((lista) => lista.split(','))
      .map((seletor) => seletor.trim());
    const nus = seletores.filter((seletor) => /^[a-z][a-z0-9]*(?![a-z0-9-])(?!\.)/.test(seletor) && !seletor.startsWith('.'));
    expect(nus).toEqual([]);
  });
});
