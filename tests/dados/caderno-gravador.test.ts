import { describe, expect, it, vi } from 'vitest';
import { criarGravador, type Situacao } from '../../src/dados/caderno';

describe('criarGravador', () => {
  it('grava e diz "salvo" quando a gravação vale', async () => {
    const situacoes: Situacao[] = [];
    const g = criarGravador(async () => true, (s) => situacoes.push(s), 10_000);
    g.agendar('texto');
    await g.esvaziar();
    expect(situacoes.at(-1)).toBe('salvo');
    expect(g.sujo()).toBe(false);
  });

  it('página que não existe mais (gravar devolve false): não diz "salvo", avisa e guarda o texto por gravar', async () => {
    const situacoes: Situacao[] = [];
    const gravar = vi.fn(async (_valor: string) => false);
    const g = criarGravador(gravar, (s) => situacoes.push(s), 10_000);
    g.agendar('texto que não pode sumir');
    await g.esvaziar();
    expect(situacoes).not.toContain('salvo');
    expect(situacoes.at(-1)).toBe('apagado');
    expect(g.sujo()).toBe(true);
    // Tentar de novo leva o mesmo texto.
    await g.esvaziar();
    expect(gravar).toHaveBeenLastCalledWith('texto que não pode sumir');
  });
});
