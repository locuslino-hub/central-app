// Acessibilidade que só o CSS resolve (Tarefa 19, correções): reflow (coluna única que nunca passa da tela), foco legível nos
// cartões escuros e cores forçadas (alto contraste do Windows). O jsdom não calcula estilos, então o teste lê o texto das
// regras; o que a página faz de verdade é conferido nos testes de ponta a ponta (tests/e2e/acessibilidade-v02.spec.ts).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ler = (arquivo: string) => readFileSync(resolve(process.cwd(), 'src/ui', arquivo), 'utf8').replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '');
const pastas = ler('pastas.css');
const chat = ler('chat.css');
const ideias = ler('ideias.css');
const tema = ler('tema.css');

/** O corpo da primeira regra cujo seletor, sem espaços de sobra, é exatamente `seletor`. */
function regra(css: string, seletor: string): string {
  const alvo = seletor.replace(/\s+/g, ' ').trim();
  const achada = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((m) => m[1]!.replace(/\s+/g, ' ').trim() === alvo);
  expect(achada, `regra ${seletor}`).toBeTruthy();
  return achada![2]!;
}

/** O bloco `@media (forced-colors: active) { ... }`, com as regras de dentro. */
function coresForcadas(css: string): string {
  const inicio = css.indexOf('@media (forced-colors: active)');
  expect(inicio, 'bloco forced-colors').toBeGreaterThanOrEqual(0);
  let fundo = css.indexOf('{', inicio);
  let nivel = 1;
  let i = fundo + 1;
  while (nivel > 0 && i < css.length) {
    if (css[i] === '{') nivel++;
    if (css[i] === '}') nivel--;
    i++;
  }
  return css.slice(fundo + 1, i - 1);
}

const luz = (hex: string) => {
  const canais = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * canais[0]! + 0.7152 * canais[1]! + 0.0722 * canais[2]!;
};
const contraste = (a: string, b: string) => {
  const [claro, escuro] = [luz(a), luz(b)].sort((x, y) => y - x);
  return (claro! + 0.05) / (escuro! + 0.05);
};

describe('reflow: a coluna única da pasta nunca passa da tela', () => {
  it('Registro, Lista e Financeiro, e os blocos de dentro, usam minmax(0, 1fr)', () => {
    for (const seletor of ['.registro', '.lista', '.financeiro', '.registro-figura', '.registro-tabela-area', '.fin-bloco']) {
      expect(regra(pastas, seletor), seletor).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    }
  });

  it('o gráfico e a tabela de gastos rolam dentro do próprio quadro', () => {
    expect(regra(pastas, '.registro-grafico-rolagem')).toMatch(/overflow-x:\s*auto/);
    expect(regra(pastas, '.fin-tabela-rolagem')).toMatch(/overflow-x:\s*auto/);
  });

  it('o rótulo do gráfico não fica menor que 0,8rem no celular', () => {
    const celular = pastas.slice(pastas.indexOf('@media (max-width: 699px) {\n  .registro-grafico'));
    expect(celular.slice(0, 260)).toMatch(/font-size:\s*0\.8rem/);
  });
});

describe('foco legível nos cartões escuros', () => {
  const tinta = /--tinta:\s*(#[0-9a-f]{6})/i.exec(tema)![1]!;

  it('o cartão das Ideias tem fundo escuro (--tinta) e contorno de foco branco', () => {
    expect(regra(ideias, '.ideias-cartao')).toContain('background: var(--tinta)');
    expect(regra(ideias, '.ideias-cartao :focus-visible')).toMatch(/outline-color:\s*#fff\b/);
  });

  it('o branco sobre o fundo do cartão passa de 3:1 (WCAG 1.4.11); o verde de ação não passa', () => {
    expect(contraste('#ffffff', tinta)).toBeGreaterThanOrEqual(3);
    const acao = /--acao:\s*(#[0-9a-f]{6})/i.exec(tema)![1]!;
    expect(contraste(acao, tinta)).toBeLessThan(3);
  });
});

describe('cores forçadas (alto contraste)', () => {
  it('a chave "Gravar áudio" e o botão do microfone ganham borda; a chave mantém a bolinha visível', () => {
    const bloco = coresForcadas(chat);
    expect(regra(bloco, '.chat-gravar input')).toMatch(/border:\s*2px solid ButtonText/);
    expect(regra(bloco, '.chat-mic')).toMatch(/border:\s*2px solid ButtonText/);
    expect(regra(bloco, '.chat-gravar input::after')).toMatch(/background:\s*ButtonText/);
  });

  it('as barras do gráfico e das categorias não somem: forced-color-adjust none e cor do texto do sistema', () => {
    const corpo = regra(coresForcadas(pastas), '.registro-barra, .fin-barra');
    expect(corpo).toMatch(/forced-color-adjust:\s*none/);
    expect(corpo).toMatch(/background:\s*CanvasText/);
  });
});
