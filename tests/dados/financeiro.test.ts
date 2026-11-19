// Financeiro (V02, Tarefa 15): ler a planilha de lançamentos, somar o mês e anexar gasto. A planilha é de mentira
// (tests/apoio/planilhas-falsas.ts); o cliente, o cache e a fila são os de verdade. Só nomes e valores fictícios.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canonicalizarCategoria,
  categoriasEmUso,
  CATEGORIA_PADRAO,
  lancamentosDeLinhas,
  lerLancamentos,
  quemEmUso,
  tiposEmUso,
  registrarGasto,
  resumoDoMes,
  trocarCategoria,
  TIPO_PADRAO,
  valorDeTexto,
  type Lancamento,
} from '../../src/dados/financeiro';
import { salvar, semear } from '../../src/dados/loja';
import type { LinhaDaPlanilha } from '../../src/dados/planilhas';
import type { Pasta } from '../../src/dados/tipos';
import { CABECALHO_FINANCEIRO, falsoDasPlanilhas, reiniciarPlanilhas } from '../apoio/planilhas-falsas';

vi.mock('../../src/dados/planilhas', async (importar) => (await import('../apoio/planilhas-falsas')).comPlanilhasFalsas(await importar<typeof import('../../src/dados/planilhas')>()));

const planilhas = falsoDasPlanilhas();
const PLANILHA = 'planilha-ficticia-financeiro';

beforeEach(async () => {
  reiniciarPlanilhas();
  await semear();
});

const pasta = (extra: Partial<Pasta> = {}) =>
  salvar('pastas', { id: 'pasta-financeiro', salaId: 'sala-casa', tipo: 'planilha', nome: 'Financeiro', ordem: 3, modelo: 'financeiro', planilhaId: PLANILHA, ...extra });

const gasto = (Data: string, Descrição: string, Categoria: string, Valor: string, extra: Record<string, string> = {}) => ({
  Data,
  Descrição,
  Categoria,
  Tipo: 'Débito',
  Valor,
  Quem: 'Marina',
  Observação: '',
  ...extra,
});
const novaPlanilha = (linhas: Record<string, string>[] = [], cabecalho = CABECALHO_FINANCEIRO) => planilhas.planilha(PLANILHA, linhas, cabecalho);
const anexos = () => planilhas.pedidos.filter((p) => p.acao === 'anexarLinha');

const lanc = (data: string, categoria: string, valor: number, tipo = 'Débito'): Lancamento => ({
  id: `${data}-${categoria}-${valor}`,
  data,
  descricao: 'x',
  categoria,
  tipo,
  valor,
  quem: 'Renata',
});

describe('lerLancamentos', () => {
  it('converte "1.250,75" e "5,50"', async () => {
    const p = await pasta();
    novaPlanilha([gasto('2026-11-02', 'Aluguel de Aurora', 'Casa', '1.250,75'), gasto('2026-11-03', 'Salgado', 'Alimentação', '5,50')]);

    const { lancamentos, avisos } = await lerLancamentos(p);

    expect(lancamentos.map((l) => [l.descricao, l.valor])).toEqual([['Aluguel de Aurora', 1250.75], ['Salgado', 5.5]]);
    expect(avisos).toEqual([]);
  });

  it('linha com valor ilegível vira aviso e não quebra', async () => {
    const p = await pasta();
    novaPlanilha([gasto('2026-11-02', 'Mercado', 'Alimentação', 'abc'), gasto('2026-11-03', 'Táxi', 'Transporte', '12,00'), gasto('2026-11-04', 'Cinema', 'Lazer', '')]);

    const { lancamentos, avisos } = await lerLancamentos(p);

    expect(lancamentos.map((l) => l.descricao)).toEqual(['Táxi']);
    expect(avisos).toHaveLength(2);
    expect(avisos[0]).toContain('Mercado');
    expect(avisos[1]).toContain('Cinema');
  });

  it('lê por nome de cabeçalho, com coluna fora de ordem, e devolve id, quem, tipo e categoria', async () => {
    const p = await pasta();
    planilhas.planilha(
      PLANILHA,
      [{ Valor: '7,25', Quem: 'Renata', Data: '2026-11-05', Tipo: 'Crédito', Descrição: 'Padaria', Categoria: 'Alimentação' }],
      ['Quem', 'Valor', 'Categoria', 'Data', 'Tipo', 'Descrição', 'Observação', 'id'],
    );

    const { lancamentos } = await lerLancamentos(p);

    expect(lancamentos).toEqual([expect.objectContaining({ data: '2026-11-05', descricao: 'Padaria', categoria: 'Alimentação', tipo: 'Crédito', valor: 7.25, quem: 'Renata' })]);
    expect(lancamentos[0]!.id).toBeTruthy();
  });

  it('linha "(desfeito)" não entra nos lançamentos nem no resumo', async () => {
    const p = await pasta();
    novaPlanilha([gasto('2026-11-02', 'Mercado', 'Alimentação', '10,00'), gasto('2026-11-03', 'Errado', 'Alimentação', '99,00', { Observação: 'desfeito' })]);

    const { lancamentos } = await lerLancamentos(p);

    expect(lancamentos.map((l) => l.descricao)).toEqual(['Mercado']);
    expect(resumoDoMes(lancamentos, '2026-11').total).toBe(10);
  });

  it('sem rede, usa o cache e o anexo na fila aparece marcado', async () => {
    const p = await pasta();
    novaPlanilha([gasto('2026-11-02', 'Mercado', 'Alimentação', '10,00')]);
    await lerLancamentos(p); // guarda no cache
    planilhas.cair();
    const gravado = await registrarGasto(p, { valor: 4.5, data: '2026-11-04', descricao: 'Café' });
    expect(gravado.situacao).toBe('na_fila');

    const leitura = await lerLancamentos(p);

    expect(leitura.doCache).toBe(true);
    expect(leitura.lancamentos.map((l) => [l.descricao, l.valor, l.pendente])).toEqual([['Mercado', 10, undefined], ['Café', 4.5, 'fila']]);
  });

  it('coluna faltando: mostra o que dá e avisa "planilha_mudou"', async () => {
    const p = await pasta();
    novaPlanilha([gasto('2026-11-02', 'Mercado', 'Alimentação', '10,00')], CABECALHO_FINANCEIRO.filter((c) => c !== 'Tipo'));

    const leitura = await lerLancamentos(p);

    expect(leitura.aviso).toBe('planilha_mudou');
    expect(leitura.lancamentos).toHaveLength(1);
  });
});

describe('lancamentosDeLinhas', () => {
  const linha = (id: string, valores: Record<string, string>, extra: Partial<LinhaDaPlanilha> = {}): LinhaDaPlanilha => ({ id, valores, ...extra });

  it('aceita data ISO e dd/mm/aaaa (e as devolve como ISO); data ilegível vira aviso', () => {
    const r = lancamentosDeLinhas([
      linha('a', gasto('2026-11-02', 'Mercado', 'Alimentação', '10')),
      linha('b', gasto('03/11/2026', 'Táxi', 'Transporte', '12')),
      linha('c', gasto('ontem', 'Cinema', 'Lazer', '30')),
    ]);
    expect(r.lancamentos.map((l) => l.data)).toEqual(['2026-11-02', '2026-11-03']);
    expect(r.avisos).toHaveLength(1);
    expect(r.avisos[0]).toContain('Cinema');
  });

  it('o mês do resumo conta datas dd/mm/aaaa e ISO da planilha', () => {
    const r = lancamentosDeLinhas([
      linha('a', gasto('2026-11-02', 'Mercado', 'Alimentação', '10')),
      linha('b', gasto('03/11/2026', 'Táxi', 'Transporte', '12')),
      linha('c', gasto('03/10/2026', 'Antigo', 'Transporte', '99')),
    ]);
    expect(resumoDoMes(r.lancamentos, '2026-11').total).toBe(22);
  });

  it('linha totalmente em branco é ignorada em silêncio; categoria vazia vira "Outros"', () => {
    const r = lancamentosDeLinhas([linha('a', {}), linha('b', gasto('2026-11-02', 'Presente', '', '20'))]);
    expect(r.lancamentos).toEqual([expect.objectContaining({ id: 'b', categoria: CATEGORIA_PADRAO })]);
    expect(r.avisos).toEqual([]);
  });

  it('"(desfeito)" em Observação fica fora, mesmo se chegar direto', () => {
    const r = lancamentosDeLinhas([linha('a', gasto('2026-11-02', 'Mercado', 'Alimentação', '10', { Observação: ' Desfeito ' }))]);
    expect(r.lancamentos).toEqual([]);
  });

  it('anexo parado fica em naoSalvos, fora da conta', () => {
    const r = lancamentosDeLinhas([linha('a', gasto('2026-11-02', 'Mercado', 'Alimentação', '10'), { pendente: 'parada' })]);
    expect(r.lancamentos).toEqual([]);
    expect(r.naoSalvos).toEqual([{ id: 'a', descricao: 'Mercado', valor: '10' }]);
  });

  it('valor com sinal e moeda ("€ 5,50", "-5,50") é lido; reembolso fica negativo', () => {
    const r = lancamentosDeLinhas([linha('a', gasto('2026-11-02', 'Mercado', 'Alimentação', '€ 5,50')), linha('b', gasto('2026-11-03', 'Estorno', 'Alimentação', '-5,50'))]);
    expect(r.lancamentos.map((l) => l.valor)).toEqual([5.5, -5.5]);
  });
});

describe('valorDeTexto', () => {
  it.each([
    ['1.250,75', 1250.75],
    ['5,50', 5.5],
    ['1250.75', 1250.75],
    ['€ 5,50', 5.5],
    ['5,50 €', 5.5],
    ['€5,50', 5.5],
    ['EUR 5,50', 5.5],
    ['-5,50', -5.5],
    ['€ -5,50', -5.5],
    ['−5,50', -5.5],
    ['+5,50', 5.5],
    ['0', 0],
    [' 12 ', 12],
    ['1 250,75', 1250.75],
    ['1 250', 1250],
    ['12 250 000', 12250000],
    ['(5,50)', -5.5],
    ['(€ 5,50)', -5.5],
    ['€ (1.250,75)', -1250.75],
    ['(0)', 0],
    ['0,005', 0.005],
    ['1.000.000.000', 1_000_000_000],
  ])('%s → %s', (texto, esperado) => expect(valorDeTexto(texto)).toBe(esperado));

  // Separador único seguido de exatamente 3 dígitos é milhar: "1,250" numa planilha en-US é mil duzentos e cinquenta.
  it.each([
    ['1.250', 1250],
    ['1,250', 1250],
    ['12.345', 12345],
    ['12,345', 12345],
    ['123.456', 123456],
    ['1,250,000', 1250000],
    ['1.250,750', 1250.75],
    ['0,250', 0.25],
    ['0.250', 0.25],
    ['1,25', 1.25],
    ['1.25', 1.25],
    ['1250,5', 1250.5],
    ['-1.250', -1250],
  ])('milhar: %s → %s', (texto, esperado) => expect(valorDeTexto(texto)).toBe(esperado));

  it.each([
    '',
    'abc',
    '€',
    '5,50,2',
    '1,2,3',
    '--5',
    '12 euros e 3',
    '=1+1',
    'R$ 5,50',
    'R$ 1.250,75',
    'US$ 5',
    '$5',
    '5$',
    '5 5',
    '1 2500',
    '1  250',
    '(-5,50)',
    '(5,50',
    '0,0000001',
    '0,004',
    '1000000000,01',
    '5,',
    '2026-11-05',
  ])('"%s" não é valor', (texto) => expect(valorDeTexto(texto)).toBeNull());
});

describe('linhas fora da conta', () => {
  const linha = (id: string, valor: string): LinhaDaPlanilha => ({ id, valores: gasto('2026-11-02', `Gasto ${id}`, 'Casa', valor) });

  it('R$ e valor minúsculo viram aviso, fora da conta', () => {
    const r = lancamentosDeLinhas([linha('a', 'R$ 5,50'), linha('b', '0,0000001'), linha('c', '7')]);
    expect(r.lancamentos.map((l) => l.id)).toEqual(['c']);
    expect(r.foraDaConta).toBe(2);
    expect(r.avisos).toHaveLength(2);
  });

  it('cabeçalho sem Valor: até 20 avisos e "e mais N linhas fora da conta"; foraDaConta conta todas', () => {
    const muitas = Array.from({ length: 25 }, (_, i) => ({ id: `l${i}`, valores: { Data: '2026-11-02', Descrição: `Gasto ${i}`, Categoria: 'Casa' } }));
    const r = lancamentosDeLinhas(muitas);
    expect(r.lancamentos).toEqual([]);
    expect(r.foraDaConta).toBe(25);
    expect(r.avisos).toHaveLength(21);
    expect(r.avisos[20]).toBe('e mais 5 linhas fora da conta');
  });

  it('21 linhas: "e mais 1 linha fora da conta"; 20 linhas: sem a frase extra', () => {
    const feitas = (n: number) => lancamentosDeLinhas(Array.from({ length: n }, (_, i) => linha(`l${i}`, 'xyz')));
    expect(feitas(21).avisos.at(-1)).toBe('e mais 1 linha fora da conta');
    expect(feitas(20).avisos).toHaveLength(20);
    expect(feitas(0).foraDaConta).toBe(0);
  });
});

describe('resumoDoMes', () => {
  it('soma por categoria e por tipo, do maior para o menor', () => {
    const r = resumoDoMes(
      [lanc('2026-11-02', 'Alimentação', 10), lanc('2026-11-03', 'Casa', 100, 'Crédito'), lanc('2026-11-04', 'Alimentação', 5.5), lanc('2026-11-30', 'Lazer', 20.25)],
      '2026-11',
    );
    expect(r.total).toBe(135.75);
    expect(r.porCategoria).toEqual([{ categoria: 'Casa', total: 100 }, { categoria: 'Lazer', total: 20.25 }, { categoria: 'Alimentação', total: 15.5 }].sort((a, b) => b.total - a.total));
    expect(r.porTipo).toEqual([{ tipo: 'Crédito', total: 100 }, { tipo: 'Débito', total: 35.75 }]);
  });

  it('ignora outros meses (inclusive o mesmo mês de outro ano)', () => {
    const r = resumoDoMes([lanc('2026-10-31', 'Casa', 50), lanc('2026-11-01', 'Casa', 10), lanc('2026-12-01', 'Casa', 70), lanc('2025-11-15', 'Casa', 90)], '2026-11');
    expect(r.total).toBe(10);
    expect(r.porCategoria).toEqual([{ categoria: 'Casa', total: 10 }]);
  });

  it('mês sem lançamentos → total 0', () => {
    expect(resumoDoMes([lanc('2026-10-01', 'Casa', 50)], '2026-11')).toEqual({ total: 0, porCategoria: [], porTipo: [] });
    expect(resumoDoMes([], '2026-11')).toEqual({ total: 0, porCategoria: [], porTipo: [] });
  });

  it('soma em centavos, sem erro de ponto flutuante', () => {
    const r = resumoDoMes([lanc('2026-11-01', 'Casa', 0.1), lanc('2026-11-02', 'Casa', 0.2)], '2026-11');
    expect(r.total).toBe(0.3);
    expect(r.porCategoria[0]!.total).toBe(0.3);
  });

  it('categoria e tipo iguais, só com maiúscula ou acento diferente, ficam juntos', () => {
    const r = resumoDoMes([lanc('2026-11-01', 'Alimentação', 10, 'Débito'), lanc('2026-11-02', 'alimentacao', 5, 'débito'), lanc('2026-11-03', ' Alimentação ', 1)], '2026-11');
    expect(r.porCategoria).toEqual([{ categoria: 'Alimentação', total: 16 }]);
    expect(r.porTipo).toEqual([{ tipo: 'Débito', total: 16 }]);
  });

  it('reembolso (valor negativo) abate; data dd/mm/aaaa em lançamento montado à mão conta', () => {
    const r = resumoDoMes([lanc('2026-11-01', 'Casa', 30), lanc('05/11/2026', 'Casa', -10)], '2026-11');
    expect(r.total).toBe(20);
  });

  it('lançamento sem Tipo entra no grupo "(sem tipo)"', () => {
    const r = resumoDoMes([lanc('2026-11-01', 'Casa', 10, ''), lanc('2026-11-02', 'Casa', 5, '  '), lanc('2026-11-03', 'Casa', 1, 'Débito')], '2026-11');
    expect(r.porTipo).toEqual([{ tipo: '(sem tipo)', total: 15 }, { tipo: 'Débito', total: 1 }]);
  });

  it('o nome do grupo é a grafia mais frequente; empate fica com a que tem acento', () => {
    const r = resumoDoMes(
      [lanc('2026-11-01', 'alimentacao', 1), lanc('2026-11-02', 'alimentacao', 1), lanc('2026-11-03', 'Alimentação', 1), lanc('2026-11-04', 'saude', 1), lanc('2026-11-05', 'Saúde', 1)],
      '2026-11',
    );
    expect(r.porCategoria).toEqual([{ categoria: 'alimentacao', total: 3 }, { categoria: 'Saúde', total: 2 }]);
  });

  it('valor minúsculo montado à mão (1e-7) não quebra a soma', () => {
    const r = resumoDoMes([lanc('2026-11-01', 'Casa', 1e-7), lanc('2026-11-02', 'Casa', 2)], '2026-11');
    expect(r.total).toBe(2);
  });

  it('mês em formato errado → resumo vazio, não quebra', () => {
    expect(resumoDoMes([lanc('2026-11-01', 'Casa', 30)], 'novembro')).toEqual({ total: 0, porCategoria: [], porTipo: [] });
  });
});

describe('categoriasEmUso', () => {
  it('sem duplicatas (maiúscula e acento não duplicam), em ordem alfabética', () => {
    const r = categoriasEmUso([lanc('2026-11-01', 'Lazer', 1), lanc('2026-11-02', 'Alimentação', 1), lanc('2026-11-03', 'alimentacao', 1), lanc('2026-11-04', 'Lazer', 1), lanc('2026-11-05', '  ', 1)]);
    expect(r).toEqual(['Alimentação', 'Lazer', 'Outros']);
  });

  it('sem lançamentos → lista vazia', () => {
    expect(categoriasEmUso([])).toEqual([]);
  });

  it('mostra a grafia mais usada; empate fica com a que tem acento e maiúscula', () => {
    const mais = categoriasEmUso([lanc('2026-11-01', 'transporte', 1), lanc('2026-11-02', 'transporte', 1), lanc('2026-11-03', 'Transporte', 1)]);
    expect(mais).toEqual(['transporte']);
    const empate = categoriasEmUso([lanc('2026-11-01', 'saude', 1), lanc('2026-11-02', 'Saúde', 1)]);
    expect(empate).toEqual(['Saúde']);
  });
});

describe('quemEmUso', () => {
  it('sem duplicata por acento ou maiúscula, sem vazios, em ordem alfabética', () => {
    const r = quemEmUso([
      { ...lanc('2026-11-01', 'Casa', 1), quem: 'Renata' },
      { ...lanc('2026-11-02', 'Casa', 1), quem: 'marina' },
      { ...lanc('2026-11-03', 'Casa', 1), quem: 'Marina' },
      { ...lanc('2026-11-04', 'Casa', 1), quem: 'renata' },
      { ...lanc('2026-11-05', 'Casa', 1), quem: '  ' },
      { ...lanc('2026-11-06', 'Casa', 1), quem: 'Aurora' },
    ]);
    expect(r).toEqual(['Aurora', 'Marina', 'Renata']);
  });

  it('sem lançamentos → lista vazia', () => {
    expect(quemEmUso([])).toEqual([]);
  });
});

describe('tiposEmUso', () => {
  it('sem duplicata por acento ou maiúscula, sem vazios, em ordem alfabética', () => {
    const r = tiposEmUso([
      { ...lanc('2026-11-01', 'Casa', 1), tipo: 'Débito' },
      { ...lanc('2026-11-02', 'Casa', 1), tipo: 'debito' },
      { ...lanc('2026-11-03', 'Casa', 1), tipo: 'Crédito' },
      { ...lanc('2026-11-04', 'Casa', 1), tipo: '' },
    ]);
    expect(r).toEqual(['Crédito', 'Débito']);
    expect(tiposEmUso([])).toEqual([]);
  });
});

describe('canonicalizarCategoria', () => {
  const existentes = ['Alimentação', 'Saúde', 'Transporte'];

  it('devolve a grafia que já existe, sem contar acento, maiúscula nem espaço', () => {
    expect(canonicalizarCategoria('alimentacao', existentes)).toBe('Alimentação');
    expect(canonicalizarCategoria('  SAÚDE ', existentes)).toBe('Saúde');
    expect(canonicalizarCategoria('trans porte', existentes)).toBe('trans porte');
  });

  it('categoria nova fica como veio (limpa); vazia vira "Outros"; "Outros" existente é reaproveitada', () => {
    expect(canonicalizarCategoria('  Pets  de   casa ', existentes)).toBe('Pets de casa');
    expect(canonicalizarCategoria('   ', existentes)).toBe('Outros');
    expect(canonicalizarCategoria('', ['outros'])).toBe('outros');
    expect(canonicalizarCategoria('lazer', [])).toBe('lazer');
  });
});

describe('trocarCategoria', () => {
  it('atualiza a coluna Categoria da linha pelo id e devolve o resultado de atualizar', async () => {
    const p = await pasta();
    novaPlanilha();
    const r = await registrarGasto(p, { valor: 5, data: '2026-11-05', descricao: 'Café', categoria: 'Outros' });
    if (!r.gravado) throw new Error('devia gravar');

    const resultado = await trocarCategoria(p, r.idDaLinha, '  Alimentação ');

    expect(resultado).toBe('ok');
    expect(planilhas.linhas(PLANILHA)[0]!.valores['Categoria']).toBe('Alimentação');
    expect((await lerLancamentos(p)).lancamentos[0]!.categoria).toBe('Alimentação');
  });

  it('categoria vazia vira "Outros"; longa demais não grava', async () => {
    const p = await pasta();
    novaPlanilha([gasto('2026-11-05', 'Café', 'Lazer', '5')]);
    const id = planilhas.linhas(PLANILHA)[0]!.id;

    expect(await trocarCategoria(p, id, 'x'.repeat(61))).toBe('categoria_invalida');
    expect(planilhas.linhas(PLANILHA)[0]!.valores['Categoria']).toBe('Lazer');
    expect(await trocarCategoria(p, id, ' ')).toBe('ok');
    expect(planilhas.linhas(PLANILHA)[0]!.valores['Categoria']).toBe('Outros');
    expect(await trocarCategoria(p, id, 'x'.repeat(60))).toBe('ok');
  });

  it('linha que sumiu da planilha: devolve o resultado de atualizar, sem quebrar', async () => {
    const p = await pasta();
    novaPlanilha();
    expect(await trocarCategoria(p, 'id-que-nao-existe', 'Lazer')).toBe('sumiu');
  });

  it('sem rede: a troca espera na fila', async () => {
    const p = await pasta();
    novaPlanilha();
    const r = await registrarGasto(p, { valor: 5, data: '2026-11-05', descricao: 'Café' });
    if (!r.gravado) throw new Error('devia gravar');
    planilhas.cair();
    const resultado = await trocarCategoria(p, r.idDaLinha, 'Lazer');
    expect(resultado).toBe('na_fila');
  });
});

describe('registrarGasto', () => {
  it('anexa linha com Tipo Débito por padrão', async () => {
    const p = await pasta();
    novaPlanilha();

    const r = await registrarGasto(p, { valor: 5.5, data: '2026-11-05', descricao: 'Salgado', categoria: 'Alimentação' });

    expect(r.gravado).toBe(true);
    expect(r.situacao).toBe('enviada');
    const linhas = planilhas.linhas(PLANILHA);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]!.valores).toEqual({ Data: '2026-11-05', Descrição: 'Salgado', Categoria: 'Alimentação', Tipo: 'Débito', Valor: '5.5', Quem: 'Central' });
    expect(TIPO_PADRAO).toBe('Débito');
  });

  it('o que foi gravado volta a ser lido igual (ida e volta)', async () => {
    const p = await pasta();
    novaPlanilha();
    await registrarGasto(p, { valor: 1250.75, data: '2026-11-05', descricao: 'Aluguel de Aurora', categoria: 'Casa', quem: 'Renata', tipo: 'Crédito' });

    const { lancamentos } = await lerLancamentos(p);

    expect(lancamentos).toEqual([expect.objectContaining({ data: '2026-11-05', descricao: 'Aluguel de Aurora', categoria: 'Casa', tipo: 'Crédito', valor: 1250.75, quem: 'Renata' })]);
  });

  it('sempre anexa linha nova, mesmo com gasto igual no mesmo dia', async () => {
    const p = await pasta();
    novaPlanilha([gasto('2026-11-05', 'Salgado', 'Alimentação', '5,50')]);

    await registrarGasto(p, { valor: 5.5, data: '2026-11-05', descricao: 'Salgado', categoria: 'Alimentação' });

    expect(planilhas.linhas(PLANILHA)).toHaveLength(2);
  });

  it('categoria vazia ou ausente vai como "Outros"; descrição ganha espaços juntos e sem quebra de linha', async () => {
    const p = await pasta();
    novaPlanilha();

    await registrarGasto(p, { valor: 3, data: '2026-11-05', descricao: '  Pilhas \n  AA ', categoria: '  ' });
    await registrarGasto(p, { valor: 4, data: '2026-11-05', descricao: 'Troco', categoria: null });

    const linhas = planilhas.linhas(PLANILHA);
    expect(linhas.map((l) => [l.valores['Descrição'], l.valores['Categoria']])).toEqual([['Pilhas AA', 'Outros'], ['Troco', 'Outros']]);
  });

  it('valor com mais de 2 casas é arredondado para centavos, com aviso', async () => {
    const p = await pasta();
    novaPlanilha();

    const r = await registrarGasto(p, { valor: 5.555, data: '2026-11-05', descricao: 'Café' });

    expect(r.gravado).toBe(true);
    expect(planilhas.linhas(PLANILHA)[0]!.valores['Valor']).toBe('5.56');
    expect(r.avisos.join(' ')).toContain('centavos');
  });

  it.each([
    ['zero', 0],
    ['negativo', -5.5],
    ['NaN', Number.NaN],
    ['infinito', Number.POSITIVE_INFINITY],
    ['gigante', 1e12],
    ['texto', '5,50' as unknown as number],
    ['nulo', null as unknown as number],
  ])('valor %s: não grava e diz o motivo', async (_nome, valor) => {
    const p = await pasta();
    novaPlanilha();

    const r = await registrarGasto(p, { valor, data: '2026-11-05', descricao: 'Café' });

    expect(r).toMatchObject({ gravado: false, situacao: 'recusada', motivo: 'valor_invalido' });
    expect(anexos()).toHaveLength(0);
    expect(planilhas.linhas(PLANILHA)).toHaveLength(0);
  });

  it.each([
    ['data ilegível', { data: 'ontem' }, 'data_invalida'],
    ['data inexistente', { data: '2026-02-30' }, 'data_invalida'],
    ['descrição longa demais', { descricao: 'x'.repeat(201) }, 'texto_longo'],
    ['categoria longa demais', { categoria: 'x'.repeat(61) }, 'texto_longo'],
    ['moeda diferente de €', { moeda: 'R$' as const }, 'moeda_diferente'],
    ['tipo longo demais', { tipo: 'x'.repeat(31) }, 'texto_longo'],
    ['quem longo demais', { quem: 'x'.repeat(61) }, 'texto_longo'],
    ['observação longa demais', { observacao: 'x'.repeat(501) }, 'texto_longo'],
    ['descrição vazia', { descricao: '' }, 'descricao_vazia'],
    ['descrição só de espaços', { descricao: ' \n\t ' }, 'descricao_vazia'],
    ['ano antes de 2000', { data: '1999-12-31' }, 'data_invalida'],
    ['ano depois de 2100', { data: '2101-01-01' }, 'data_invalida'],
    ['valor 1e9 + 1 centavo', { valor: 1_000_000_000.01 }, 'valor_invalido'],
  ])('%s: não grava e diz o motivo', async (_nome, extra, motivo) => {
    const p = await pasta();
    novaPlanilha();

    const r = await registrarGasto(p, { valor: 5, data: '2026-11-05', descricao: 'Café', ...extra });

    expect(r).toMatchObject({ gravado: false, situacao: 'recusada', motivo });
    expect(anexos()).toHaveLength(0);
  });

  it.each([
    ['descrição com 200', { descricao: 'x'.repeat(200) }],
    ['categoria com 60', { categoria: 'x'.repeat(60) }],
    ['tipo com 30', { tipo: 'x'.repeat(30) }],
    ['quem com 60', { quem: 'x'.repeat(60) }],
    ['observação com 500', { observacao: 'x'.repeat(500) }],
    ['valor 1e9', { valor: 1_000_000_000 }],
    ['ano 2000', { data: '2000-01-01' }],
    ['ano 2100', { data: '2100-12-31', avisos: ['x'] }],
    ['valor 0,01', { valor: 0.01 }],
  ])('limite: %s grava', async (_nome, extra) => {
    const p = await pasta();
    novaPlanilha();

    const r = await registrarGasto(p, { valor: 5, data: '2026-11-05', descricao: 'Café', ...extra });

    expect(r.gravado).toBe(true);
    expect(planilhas.linhas(PLANILHA)).toHaveLength(1);
  });

  it('valor 0,004 (arredonda para 0): não grava', async () => {
    const p = await pasta();
    novaPlanilha();
    expect(await registrarGasto(p, { valor: 0.004, data: '2026-11-05', descricao: 'Café' })).toMatchObject({ gravado: false, motivo: 'valor_invalido' });
    expect(await registrarGasto(p, { valor: 1e-7, data: '2026-11-05', descricao: 'Café' })).toMatchObject({ gravado: false, motivo: 'valor_invalido' });
  });

  it('data no futuro grava, com aviso; hoje e o passado, sem aviso', async () => {
    const p = await pasta();
    novaPlanilha();

    const futuro = await registrarGasto(p, { valor: 5, data: '2026-11-06', descricao: 'Café' }, { hoje: '2026-11-05' });
    const hoje = await registrarGasto(p, { valor: 5, data: '2026-11-05', descricao: 'Café' }, { hoje: '2026-11-05' });
    const passado = await registrarGasto(p, { valor: 5, data: '2026-11-04', descricao: 'Café' }, { hoje: '2026-11-05' });

    expect(futuro.gravado).toBe(true);
    expect(futuro.avisos.join(' ')).toContain('ainda não chegou');
    expect(hoje.avisos).toEqual([]);
    expect(passado.avisos).toEqual([]);
    expect(planilhas.linhas(PLANILHA)).toHaveLength(3);
  });

  it('valor com 2 casas não avisa de arredondamento', async () => {
    const p = await pasta();
    novaPlanilha();
    const r = await registrarGasto(p, { valor: 5.55, data: '2026-11-05', descricao: 'Café' }, { hoje: '2026-11-05' });
    expect(r.avisos).toEqual([]);
  });

  it('aceita o nome de "Quem" dado por quem chama, e tipo e observação', async () => {
    const p = await pasta();
    novaPlanilha();
    await registrarGasto(p, { valor: 5, data: '2026-11-05', descricao: 'Café', quem: 'Renata' });
    expect(planilhas.linhas(PLANILHA)[0]!.valores['Quem']).toBe('Renata');
  });

  it('fórmula em descrição ou categoria segue como texto (a proteção é do script)', async () => {
    const p = await pasta();
    novaPlanilha();
    const r = await registrarGasto(p, { valor: 5, data: '2026-11-05', descricao: '=SOMA(A1:A9)', categoria: '+cmd|calc' });
    expect(r.gravado).toBe(true);
    expect(planilhas.linhas(PLANILHA)[0]!.valores).toMatchObject({ Descrição: '=SOMA(A1:A9)', Categoria: '+cmd|calc' });
    const { lancamentos } = await lerLancamentos(p);
    expect(lancamentos[0]).toMatchObject({ descricao: '=SOMA(A1:A9)', categoria: '+cmd|calc', valor: 5 });
  });

  it.each(['sem_acesso', 'planilha_cheia', 'fora_da_pasta'] as const)('script responde %s: bloqueada, nada gravado', async (erro) => {
    const p = await pasta();
    novaPlanilha();

    const r = await registrarGasto(p, { valor: 5, data: '2026-11-05', descricao: 'Café' }, { chamar: (async () => ({ erro })) as never });

    expect(r).toMatchObject({ gravado: false, situacao: 'bloqueada', aviso: erro });
    expect(planilhas.linhas(PLANILHA)).toHaveLength(0);
  });

  it('data dd/mm/aaaa é gravada como ISO', async () => {
    const p = await pasta();
    novaPlanilha();
    await registrarGasto(p, { valor: 5, data: '05/11/2026', descricao: 'Café' });
    expect(planilhas.linhas(PLANILHA)[0]!.valores['Data']).toBe('2026-11-05');
  });

  it('sem rede: fica na fila (situação "na_fila") e o desfazer tira da fila', async () => {
    const p = await pasta();
    novaPlanilha();
    planilhas.cair();

    const r = await registrarGasto(p, { valor: 5, data: '2026-11-05', descricao: 'Café' });

    expect(r).toMatchObject({ gravado: true, situacao: 'na_fila' });
    if (!r.gravado) return;
    expect(await r.desfazer()).toBe('tirada_da_fila');
    planilhas.voltar();
    expect((await lerLancamentos(p)).lancamentos).toEqual([]);
  });

  it('coluna faltando: bloqueada com aviso, nada gravado', async () => {
    const p = await pasta();
    novaPlanilha([], CABECALHO_FINANCEIRO.filter((c) => c !== 'Categoria'));

    const r = await registrarGasto(p, { valor: 5, data: '2026-11-05', descricao: 'Café' });

    expect(r).toMatchObject({ gravado: false, situacao: 'bloqueada', aviso: 'planilha_mudou' });
    expect(planilhas.linhas(PLANILHA)).toHaveLength(0);
  });

  it('desfazer marca "desfeito" em Observação, nunca apaga, e some da leitura; pode repetir', async () => {
    const p = await pasta();
    novaPlanilha();
    const r = await registrarGasto(p, { valor: 5, data: '2026-11-05', descricao: 'Café' });
    if (!r.gravado) throw new Error('devia gravar');

    expect(await r.desfazer()).toBe('marcada');
    expect(await r.desfazer()).toBe('marcada');

    const linhas = planilhas.linhas(PLANILHA);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]!.valores['Observação']).toBe('desfeito');
    expect((await lerLancamentos(p)).lancamentos).toEqual([]);
  });

  it('observação "desfeito" digitada vira "(Desfeito)" e a linha continua aparecendo', async () => {
    const p = await pasta();
    novaPlanilha();
    await registrarGasto(p, { valor: 5, data: '2026-11-05', descricao: 'Café', observacao: 'Desfeito' });
    expect(planilhas.linhas(PLANILHA)[0]!.valores['Observação']).toBe('(Desfeito)');
    expect((await lerLancamentos(p)).lancamentos).toHaveLength(1);
  });

  it('repassa os avisos do roteador (gasto da voz) e devolve o lançamento gravado', async () => {
    const p = await pasta();
    novaPlanilha();

    const r = await registrarGasto(p, { valor: 5, moeda: '€', data: '2026-11-05', descricao: 'Café', categoria: null, avisos: ['usei a data de hoje'] });

    expect(r.avisos).toContain('usei a data de hoje');
    if (!r.gravado) throw new Error('devia gravar');
    expect(r.lancamento).toMatchObject({ id: r.idDaLinha, data: '2026-11-05', valor: 5, categoria: 'Outros', tipo: 'Débito', quem: 'Central' });
  });

  it('pasta sem planilha: erro claro, como as outras pastas', async () => {
    const p = await pasta({ planilhaId: undefined });
    await expect(registrarGasto(p, { valor: 5, data: '2026-11-05', descricao: 'Café' })).rejects.toThrow();
  });
});
