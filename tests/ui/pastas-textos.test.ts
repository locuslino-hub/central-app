// Textos e links das pastas (V02, Tarefa 12). Nomes e ids fictícios.
import { describe, expect, it } from 'vitest';
import { ErroConexao, ErroScript } from '../../src/conexao/cliente';
import type { Pasta } from '../../src/dados/tipos';
import { EXPLICACAO_DO_TIPO, descricaoDaPasta, eurosEmBr, iconeDaPasta, linkDaPlanilha, mensagemDeErroDePasta, modeloDoTipo, textosDoGasto, unidadeDoServico } from '../../src/ui/pastas-textos';

const base = { id: 'p1', atualizadoEm: 1, aparelho: 'a', salaId: 'sala-casa', ordem: 1 };

describe('modeloDoTipo', () => {
  it('cada tipo com planilha tem o seu modelo; a pasta comum não tem', () => {
    expect(modeloDoTipo('lista')).toBe('compras');
    expect(modeloDoTipo('registro')).toBe('consumo');
    expect(modeloDoTipo('planilha')).toBe('financeiro');
    expect(modeloDoTipo('comum')).toBeUndefined();
  });
});

describe('unidadeDoServico', () => {
  it('água e gás em m³, luz em kWh', () => {
    expect(unidadeDoServico('agua')).toBe('m³');
    expect(unidadeDoServico('luz')).toBe('kWh');
    expect(unidadeDoServico('gas')).toBe('m³');
  });
});

describe('linkDaPlanilha', () => {
  it('monta o endereço do Google Planilhas com o id codificado', () => {
    expect(linkDaPlanilha('plan-ficticia_1')).toBe('https://docs.google.com/spreadsheets/d/plan-ficticia_1');
    expect(linkDaPlanilha('a/b?c')).toBe('https://docs.google.com/spreadsheets/d/a%2Fb%3Fc');
  });
});

describe('descricaoDaPasta', () => {
  it('diz o que cada pasta guarda', () => {
    const p = (extra: Partial<Pasta>): Pasta => ({ ...base, tipo: 'comum', nome: 'X', ...extra }) as Pasta;
    expect(descricaoDaPasta(p({ tipo: 'lista', modelo: 'compras' }))).toBe('Itens numa planilha de compras');
    expect(descricaoDaPasta(p({ tipo: 'registro', servico: 'agua', unidade: 'm³' }))).toBe('Água · m³');
    expect(descricaoDaPasta(p({ tipo: 'registro', servico: 'luz', unidade: 'kWh', diaDeEnvio: 5 }))).toBe('Luz · kWh · envio no dia 5');
    expect(descricaoDaPasta(p({ tipo: 'registro' }))).toBe('Leituras numa planilha');
    expect(descricaoDaPasta(p({ tipo: 'planilha', modelo: 'financeiro' }))).toBe('Planilha com tela própria');
    expect(descricaoDaPasta(p({ tipo: 'comum' }))).toBe('Tarefas, notas e documentos do tema');
  });
});

describe('iconeDaPasta', () => {
  it('cada tipo tem o seu; o registro usa o do serviço (gota, raio, chama)', () => {
    const p = (extra: Partial<Pasta>): Pasta => ({ ...base, tipo: 'comum', nome: 'X', ...extra }) as Pasta;
    expect(iconeDaPasta(p({ tipo: 'lista' }))).toBe('lista');
    expect(iconeDaPasta(p({ tipo: 'planilha' }))).toBe('planilha');
    expect(iconeDaPasta(p({ tipo: 'comum' }))).toBe('pasta');
    expect(iconeDaPasta(p({ tipo: 'registro' }))).toBe('registro');
    expect(iconeDaPasta(p({ tipo: 'registro', servico: 'agua' }))).toBe('gota');
    expect(iconeDaPasta(p({ tipo: 'registro', servico: 'luz' }))).toBe('raio');
    expect(iconeDaPasta(p({ tipo: 'registro', servico: 'gas' }))).toBe('chama');
  });
});

describe('explicações dos tipos', () => {
  it('cada uma cabe numa linha curta', () => {
    for (const texto of Object.values(EXPLICACAO_DO_TIPO)) expect(texto.length).toBeLessThanOrEqual(48);
  });
});

describe('mensagemDeErroDePasta', () => {
  it.each([
    ['nome_invalido', /nome/i],
    ['modelo_obrigatorio', /modelo/i],
    ['planilha_nao_criada', /planilha/i],
    ['organizar_pastas', /organizarPastaCentral/],
    ['sem_conexao', /conex/i],
    ['sala_invalida', /sala/i],
    ['tipo_so_na_casa', /só existem na Casa/],
  ])('o código %s vira uma frase em português', (codigo, esperado) => {
    const texto = mensagemDeErroDePasta(new Error(codigo));
    expect(texto).toMatch(esperado);
    expect(texto).not.toContain(codigo);
  });

  it('organizar_pastas diz o que fazer, que nada foi criado, e aponta o guia', () => {
    const texto = mensagemDeErroDePasta(new Error('organizar_pastas'));
    expect(texto).toBe('Rode organizarPastaCentral no script (veja o GUIA) e tente de novo. Nada foi criado.');
  });

  it('sem conexão e erro de rede dizem a mesma coisa e que nada foi criado', () => {
    const a = mensagemDeErroDePasta(new Error('sem_conexao'));
    expect(mensagemDeErroDePasta(new ErroConexao())).toBe(a);
    expect(a).toMatch(/nada foi criado/i);
  });

  it('os erros do script têm frase própria', () => {
    expect(mensagemDeErroDePasta(new ErroScript('ocupado'))).toMatch(/ocupado/i);
    expect(mensagemDeErroDePasta(new ErroScript('codigo-invalido'))).toMatch(/Conectar aparelho/);
    expect(mensagemDeErroDePasta(new ErroScript('interno'))).toMatch(/nada foi criado/i);
  });

  it('erro desconhecido ainda dá uma frase útil, sem vazar o texto técnico', () => {
    const texto = mensagemDeErroDePasta(new TypeError('x is undefined'));
    expect(texto).toMatch(/tente de novo/i);
    expect(texto).not.toContain('undefined');
    expect(texto).toMatch(/nada foi criado/i);
    expect(mensagemDeErroDePasta('qualquer coisa')).toMatch(/tente de novo/i);
    expect(mensagemDeErroDePasta('qualquer coisa', { criando: false })).not.toMatch(/criado/i);
  });
});

describe('eurosEmBr', () => {
  it('sempre com a moeda e duas casas, no jeito do Brasil', () => {
    expect(eurosEmBr(5.5)).toBe('€ 5,50');
    expect(eurosEmBr(1250.75)).toBe('€ 1.250,75');
    expect(eurosEmBr(0)).toBe('€ 0,00');
    expect(eurosEmBr(40)).toBe('€ 40,00');
  });

  it('reembolso (negativo) leva o sinal na frente da moeda', () => {
    expect(eurosEmBr(-5.5)).toBe('−€ 5,50');
  });
});

describe('textosDoGasto', () => {
  const gasto = { valor: 5.5, categoria: 'Alimentação', tipo: 'Débito', descricao: 'salgado', data: '2026-11-05' };

  it('mostra € valor · categoria · Tipo, a descrição, a data e a pasta', () => {
    const { titulo, detalhe } = textosDoGasto('Financeiro', gasto, 'enviada');
    expect(titulo).toBe('Gasto guardado');
    expect(detalhe).toBe('€ 5,50 · Alimentação · Débito. “salgado” em 05/11/2026, na pasta Financeiro.');
  });

  it('avisos do roteador viram frase; o ponto decimal do valor arredondado vira vírgula; sem rede avisa', () => {
    const { detalhe } = textosDoGasto('Financeiro', gasto, 'na_fila', ['data inválida', 'Valor arredondado para centavos: 5.56']);
    expect(detalhe).toContain('Não entendi a data, então usei a de hoje.');
    expect(detalhe).toContain('Valor arredondado para centavos: 5,56.');
    expect(detalhe).toMatch(/Sem internet: o gasto fica neste aparelho e vai para a planilha quando a rede voltar\.$/);
  });
});
