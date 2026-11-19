// Itens da lista de compras (V02, Tarefa 14): ler "Comprado?", comparar nomes e tirar o artigo. Só itens fictícios.
import { describe, expect, it } from 'vitest';
import { estaComprado, itemSemArtigo, nomeComparavel } from '../../src/dados/lista';

describe('estaComprado', () => {
  it.each(['TRUE', 'true', 'sim', 'x', '✓', '✔', '✔️', '☑️', '✅', ' Sim '])('"%s" é comprado', (valor) => {
    expect(estaComprado(valor)).toBe(true);
  });
  it.each(['', 'FALSE', 'não', undefined, 'talvez'])('"%s" não é comprado', (valor) => {
    expect(estaComprado(valor)).toBe(false);
  });
});

describe('nomeComparavel', () => {
  it('ignora maiúscula, acento, artigo do começo, pontuação das pontas e o "s" do plural', () => {
    expect(nomeComparavel('O Leite.')).toBe(nomeComparavel('leite'));
    expect(nomeComparavel('um ovo')).toBe(nomeComparavel('Ovos'));
    expect(nomeComparavel('  Pão!! ')).toBe(nomeComparavel('pao'));
    expect(nomeComparavel('as bananas')).toBe(nomeComparavel('banana'));
  });
  it('não junta itens diferentes nem mexe em palavra curta', () => {
    expect(nomeComparavel('gás')).not.toBe(nomeComparavel('ga'));
    expect(nomeComparavel('leite')).not.toBe(nomeComparavel('leite de coco'));
    expect(nomeComparavel('ovos')).not.toBe(nomeComparavel('ovo de codorna'));
  });
});

describe('itemSemArtigo', () => {
  it('tira só o artigo do começo e mantém a escrita do resto', () => {
    expect(itemSemArtigo('o Leite integral')).toBe('Leite integral');
    expect(itemSemArtigo('Uma melancia')).toBe('melancia');
    expect(itemSemArtigo('as pilhas AA')).toBe('pilhas AA');
  });
  it('item que é só o artigo, ou sem artigo, fica como está', () => {
    expect(itemSemArtigo('a')).toBe('a');
    expect(itemSemArtigo('uma')).toBe('uma');
    expect(itemSemArtigo('arroz')).toBe('arroz');
  });
});
