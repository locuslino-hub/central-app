// Voz de gasto (V02, Tarefa 16): "gastei 5,50 hoje comprando salgado" grava na pasta Financeiro, com cartão (Desfazer,
// Trocar categoria, Guardar como ideia). Quinta-feira, 2026-11-05, 12:20 em Lisboa. A planilha é de mentira
// (tests/apoio/planilhas-falsas.ts); o resto é o código de verdade. Nomes, descrições e valores fictícios.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResultadoDaFrase } from '../../src/chat/executar';
import { executarFrase, SEGUE_COMO_TAREFA } from '../apoio/executar-frase';
import { usarIA } from '../../src/chat/interpretar';
import type { IA } from '../../src/ia/ia';
import { listar, listarPendentes, salvar, semear, semearPalavras } from '../../src/dados/loja';
import type { Pasta } from '../../src/dados/tipos';
import { CABECALHO_FINANCEIRO, falsoDasPlanilhas, reiniciarPlanilhas } from '../apoio/planilhas-falsas';

vi.mock('../../src/dados/planilhas', async (importar) => (await import('../apoio/planilhas-falsas')).comPlanilhasFalsas(await importar<typeof import('../../src/dados/planilhas')>()));

const SEM_IA: IA = { estado: () => 'ausente', interpretar: async () => null };
const planilhas = falsoDasPlanilhas();
const PLANILHA = 'planilha-ficticia-financeiro';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 5, 12, 20));
  reiniciarPlanilhas();
  usarIA(SEM_IA);
  await semear();
  await semearPalavras();
});
afterEach(() => usarIA(SEM_IA));

const pastaFinanceiro = (extra: Partial<Pasta> = {}) =>
  salvar('pastas', { id: 'pasta-financeiro', salaId: 'sala-casa', tipo: 'planilha', nome: 'Financeiro', ordem: 6, modelo: 'financeiro', planilhaId: PLANILHA, ...extra });

const lancamento = (Data: string, Descrição: string, Categoria: string, Valor: string, extra: Record<string, string> = {}) => ({
  Data,
  Descrição,
  Categoria,
  Tipo: 'Débito',
  Valor,
  Quem: 'Marina',
  Observação: '',
  ...extra,
});

const planilhaComHistorico = () => planilhas.planilha(PLANILHA, [lancamento('2026-11-01', 'Mercado', 'Alimentação', '42,30'), lancamento('2026-11-02', 'Gasolina', 'Transporte', '30')], CABECALHO_FINANCEIRO);
const linhas = () => planilhas.linhas(PLANILHA);
const nada = () => expect(linhas().filter((l) => l.valores['Observação'] !== 'desfeito')).toEqual([]);

describe('gasto por voz', () => {
  it('"gastei 5,50 hoje comprando salgado" anexa a linha e o cartão mostra € 5,50, categoria e Tipo', async () => {
    await pastaFinanceiro();
    planilhaComHistorico();

    const resultado = await executarFrase('gastei 5,50 hoje comprando salgado');

    expect(linhas()).toHaveLength(3);
    expect(linhas()[2]!.valores).toMatchObject({ Data: '2026-11-05', Descrição: 'salgado', Categoria: 'Alimentação', Tipo: 'Débito', Valor: '5.5', Quem: 'Central' });
    expect(resultado.titulo).toBe('Gasto guardado');
    expect(resultado.detalhe).toContain('€ 5,50 · Alimentação · Débito');
    expect(resultado.detalhe).toContain('salgado');
    expect(resultado.detalhe).toContain('05/11/2026');
    expect(resultado.detalhe).toContain('Financeiro');
    expect(resultado.ver).toBe('#/sala/sala-casa/pasta/pasta-financeiro');
    expect(resultado.guardarComoIdeia).toBeTypeOf('function');
    expect(resultado.trocarCategoria).toBeDefined();
    expect(await listar('ideias')).toEqual([]);
  });

  it('a frase do dono, "gastei 5,50 no mercado" (sem moeda dita), é gasto em euros na pasta Financeiro', async () => {
    await pastaFinanceiro();
    planilhaComHistorico();

    const resultado = await executarFrase('gastei 5,50 no mercado');

    expect(linhas()[2]!.valores).toMatchObject({ Descrição: 'mercado', Categoria: 'Alimentação', Valor: '5.5', Data: '2026-11-05' });
    expect(resultado.titulo).toBe('Gasto guardado');
    expect(resultado.detalhe).toContain('€ 5,50');
  });

  it('Desfazer não apaga a linha: marca "desfeito" na Observação, e pode ser repetido', async () => {
    await pastaFinanceiro();
    planilhaComHistorico();
    const resultado = await executarFrase('gastei 5,50 hoje comprando salgado');

    await resultado.desfazer();
    await resultado.desfazer();

    expect(linhas()).toHaveLength(3);
    expect(linhas()[2]!.valores['Observação']).toBe('desfeito');
  });

  it('a categoria que a planilha já usa vale, mesmo escrita de outro jeito ("alimentacao")', async () => {
    await pastaFinanceiro();
    planilhas.planilha(PLANILHA, [lancamento('2026-11-01', 'Mercado', 'alimentacao', '42,30')], CABECALHO_FINANCEIRO);

    const resultado = await executarFrase('gastei 5,50 hoje comprando salgado');

    expect(linhas()[1]!.valores['Categoria']).toBe('alimentacao');
    expect(resultado.detalhe).toContain('alimentacao');
  });

  it('sem categoria entendida, vai "Outros"', async () => {
    await pastaFinanceiro();
    planilhaComHistorico();

    const resultado = await executarFrase('gastei 40 numa coisa');

    expect(linhas()[2]!.valores['Categoria']).toBe('Outros');
    expect(resultado.detalhe).toContain('€ 40,00 · Outros · Débito');
  });

  it('a data dita vale ("ontem")', async () => {
    await pastaFinanceiro();
    planilhaComHistorico();

    await executarFrase('gastei 8 ontem no café');

    expect(linhas()[2]!.valores).toMatchObject({ Data: '2026-11-04', Valor: '8' });
  });

  it('vale também dentro de uma pasta de Registro ou Lista (a pasta de destino é a Financeiro)', async () => {
    await pastaFinanceiro();
    await salvar('pastas', { id: 'pasta-agua', salaId: 'sala-casa', tipo: 'registro', nome: 'Consumo de Água', ordem: 1, modelo: 'consumo', servico: 'agua', planilhaId: 'planilha-ficticia-agua' });
    planilhaComHistorico();

    const resultado = await executarFrase('gastei 5,50 hoje comprando salgado', { pastaAtual: 'pasta-agua' });

    expect(resultado.titulo).toBe('Gasto guardado');
    expect(linhas()).toHaveLength(3);
  });

  it('com duas pastas de planilha vale a de menor ordem; dentro de uma delas, a atual', async () => {
    await pastaFinanceiro({ id: 'pasta-b', nome: 'Contas B', ordem: 8, planilhaId: 'planilha-ficticia-b' });
    await pastaFinanceiro({ id: 'pasta-a', nome: 'Contas A', ordem: 4, planilhaId: 'planilha-ficticia-a' });
    planilhas.planilha('planilha-ficticia-a', [], CABECALHO_FINANCEIRO);
    planilhas.planilha('planilha-ficticia-b', [], CABECALHO_FINANCEIRO);

    const primeira = await executarFrase('gastei 5,50 hoje comprando salgado');
    expect(primeira.detalhe).toContain('Contas A');
    expect(planilhas.linhas('planilha-ficticia-a')).toHaveLength(1);
    expect(planilhas.linhas('planilha-ficticia-b')).toHaveLength(0);

    const dentro = await executarFrase('gastei 3 hoje no café', { pastaAtual: 'pasta-b' });
    expect(dentro.detalhe).toContain('Contas B');
    expect(planilhas.linhas('planilha-ficticia-b')).toHaveLength(1);
  });

  it('sem rede o gasto fica na fila e o cartão avisa; Desfazer tira da fila', async () => {
    await pastaFinanceiro();
    planilhaComHistorico();
    planilhas.cair();

    const resultado = await executarFrase('gastei 5,50 hoje comprando salgado');

    expect(resultado.titulo).toBe('Gasto guardado');
    expect(resultado.detalhe).toMatch(/Sem internet/);
    expect(resultado.detalhe).toMatch(/quando a rede voltar/);
    const fila = (await listarPendentes()).filter((p) => p.tipo === 'planilha');
    expect(fila).toHaveLength(1);
    expect(fila[0]).toMatchObject({ acao: 'anexar', planilhaId: PLANILHA, valores: { Valor: '5.5', Descrição: 'salgado' } });

    await resultado.desfazer();
    expect((await listarPendentes()).filter((p) => p.tipo === 'planilha')).toEqual([]);
  });

  it('"Guardar como ideia" troca o gasto por uma ideia com a mesma frase (a linha fica "desfeito")', async () => {
    await pastaFinanceiro();
    planilhaComHistorico();
    const resultado = await executarFrase('gastei 5,50 hoje comprando salgado');

    const ideia = await resultado.guardarComoIdeia!();

    expect(ideia.titulo).toBe('Guardado em Ideias');
    expect((await listar('ideias')).map((i) => i.texto)).toEqual(['gastei 5,50 hoje comprando salgado']);
    expect(linhas()[2]!.valores['Observação']).toBe('desfeito');
  });
});

describe('Trocar categoria', () => {
  async function gastoGuardado(): Promise<ResultadoDaFrase> {
    await pastaFinanceiro();
    planilhaComHistorico();
    return executarFrase('gastei 5,50 hoje comprando salgado');
  }

  it('oferece as categorias em uso e a trocada atualiza a linha e o cartão', async () => {
    const resultado = await gastoGuardado();
    const troca = resultado.trocarCategoria!;
    expect(troca.atual).toBe('Alimentação');
    expect(troca.opcoes).toEqual(['Alimentação', 'Transporte']);

    const feito = await troca.trocar('Lazer');

    expect(feito.mudou).toBe(true);
    expect(linhas()[2]!.valores['Categoria']).toBe('Lazer');
    if (feito.mudou) {
      expect(feito.resultado.detalhe).toContain('€ 5,50 · Lazer · Débito');
      expect(feito.resultado.trocarCategoria!.atual).toBe('Lazer');
      expect(feito.resultado.trocarCategoria!.opcoes).toContain('Lazer');
      // O Desfazer do cartão novo segue sendo o do gasto.
      await feito.resultado.desfazer();
      expect(linhas()[2]!.valores['Observação']).toBe('desfeito');
    }
  });

  it('usa a grafia que a planilha já tem ("transporte" vira "Transporte")', async () => {
    const resultado = await gastoGuardado();

    await resultado.trocarCategoria!.trocar('  transporte ');

    expect(linhas()[2]!.valores['Categoria']).toBe('Transporte');
  });

  it('categoria vazia vira "Outros"', async () => {
    const resultado = await gastoGuardado();

    await resultado.trocarCategoria!.trocar('   ');

    expect(linhas()[2]!.valores['Categoria']).toBe('Outros');
  });

  it('categoria com mais de 60 caracteres não é gravada', async () => {
    const resultado = await gastoGuardado();

    const feito = await resultado.trocarCategoria!.trocar('x'.repeat(61));

    expect(feito).toMatchObject({ mudou: false });
    expect(feito.mudou === false && feito.mensagem).toMatch(/60 caracteres/);
    expect(linhas()[2]!.valores['Categoria']).toBe('Alimentação');
  });

  it('a linha que sumiu da planilha: avisa e nada muda', async () => {
    const resultado = await gastoGuardado();
    planilhas.planilha(PLANILHA, [lancamento('2026-11-01', 'Mercado', 'Alimentação', '42,30')], CABECALHO_FINANCEIRO); // outra pessoa apagou a linha

    const feito = await resultado.trocarCategoria!.trocar('Lazer');

    expect(feito.mudou).toBe(false);
    expect(feito.mudou === false && feito.mensagem).toMatch(/não está mais na planilha/);
  });

  it('conflito (alguém mudou a linha ao mesmo tempo): avisa e nada muda', async () => {
    const resultado = await gastoGuardado();
    planilhas.responderAProxima('atualizarLinha', { conflito: true });
    planilhas.responderAProxima('atualizarLinha', { conflito: true });

    const feito = await resultado.trocarCategoria!.trocar('Lazer');

    expect(feito.mudou).toBe(false);
    expect(feito.mudou === false && feito.mensagem).toMatch(/ao mesmo tempo/);
    expect(linhas()[2]!.valores['Categoria']).toBe('Alimentação');
  });

  it('planilha que mudou (falta coluna): avisa e nada muda', async () => {
    const resultado = await gastoGuardado();
    planilhas.mudarCabecalho(PLANILHA, CABECALHO_FINANCEIRO.filter((c) => c !== 'Categoria'));

    const feito = await resultado.trocarCategoria!.trocar('Lazer');

    expect(feito.mudou).toBe(false);
    expect(feito.mudou === false && feito.mensagem).toMatch(/planilha mudou/i);
  });

  it('planilha indisponível: avisa e nada muda', async () => {
    const resultado = await gastoGuardado();
    planilhas.responderAProxima('atualizarLinha', { erro: 'sem_acesso' });

    const feito = await resultado.trocarCategoria!.trocar('Lazer');

    expect(feito.mudou).toBe(false);
    expect(feito.mudou === false && feito.mensagem).toMatch(/não conseguiu abrir esta planilha/);
  });

  it('sem rede a troca espera na fila e o cartão avisa', async () => {
    const resultado = await gastoGuardado();
    planilhas.cair();

    const feito = await resultado.trocarCategoria!.trocar('Lazer');

    expect(feito.mudou).toBe(true);
    if (feito.mudou) {
      expect(feito.resultado.detalhe).toContain('Lazer');
      expect(feito.resultado.detalhe).toMatch(/Sem internet/);
    }
  });

  it('erro inesperado vira aviso, não exceção', async () => {
    const resultado = await gastoGuardado();
    planilhas.falharAProxima();

    const feito = await resultado.trocarCategoria!.trocar('Lazer');

    expect(feito).toMatchObject({ mudou: false });
    expect(feito.mudou === false && feito.mensagem).toMatch(/Nada mudou/);
  });
});

describe('o que não vai para a planilha segue como tarefa de hoje, com a nota do porquê (nada vira ideia sem o dono pedir)', () => {
  it('sem pasta Financeiro', async () => {
    const resultado = await executarFrase('gastei 5,50 hoje comprando salgado');

    expect(resultado.titulo).toBe(SEGUE_COMO_TAREFA);
    expect(resultado.detalhe).toContain('Não achei a pasta Financeiro');
    expect(resultado.ver).toBeNull();
    expect(await listar('ideias')).toEqual([]);
    expect(planilhas.pedidos).toEqual([]);
  });

  it('pasta de planilha sem planilha ligada', async () => {
    await pastaFinanceiro({ planilhaId: undefined });

    const resultado = await executarFrase('gastei 5,50 hoje comprando salgado');

    expect(resultado.titulo).toBe(SEGUE_COMO_TAREFA);
    expect(resultado.detalhe).toContain('Não achei a pasta Financeiro');
  });

  it('gasto em reais não vai para a planilha (só €)', async () => {
    await pastaFinanceiro();
    planilhaComHistorico();

    const resultado = await executarFrase('gastei R$ 12 no mercado');

    expect(resultado.titulo).toBe(SEGUE_COMO_TAREFA);
    expect(resultado.detalhe).toContain('Gasto em reais não vai para a planilha (só €).');
    expect(linhas()).toHaveLength(2);
    expect(await listar('ideias')).toEqual([]);
  });

  it('descrição vazia', async () => {
    await pastaFinanceiro();
    planilhaComHistorico();

    const resultado = await executarFrase('gastei 5 euros');

    expect(resultado.titulo).toBe(SEGUE_COMO_TAREFA);
    expect(resultado.detalhe).toMatch(/descrição/);
    expect(resultado.detalhe).toContain('o gasto não foi para a planilha');
    expect(linhas()).toHaveLength(2);
  });

  it('data no futuro não grava (como a leitura)', async () => {
    await pastaFinanceiro();
    planilhaComHistorico();

    const resultado = await executarFrase('paguei 20 em 30/11 de gasolina');

    expect(resultado.titulo).toBe(SEGUE_COMO_TAREFA);
    expect(resultado.detalhe).toContain('A data é no futuro; o gasto não foi para a planilha.');
    expect(linhas()).toHaveLength(2);
  });

  it('data com ano fora do aceito', async () => {
    await pastaFinanceiro();
    planilhaComHistorico();

    const resultado = await executarFrase('gastei 5 em 01/03/1999 no café');

    expect(resultado.titulo).toBe(SEGUE_COMO_TAREFA);
    expect(resultado.detalhe).toMatch(/data/i);
    expect(resultado.detalhe).toContain('o gasto não foi para a planilha');
    expect(linhas()).toHaveLength(2);
  });

  it('planilha bloqueada (falta coluna): "O gasto não foi para a planilha."', async () => {
    await pastaFinanceiro();
    planilhas.planilha(PLANILHA, [], ['Data', 'Descrição', 'Categoria', 'Valor', 'Observação', 'id']); // sem Tipo e Quem

    const resultado = await executarFrase('gastei 5,50 hoje comprando salgado');

    expect(resultado.titulo).toBe(SEGUE_COMO_TAREFA);
    expect(resultado.detalhe).toMatch(/planilha mudou/i);
    expect(resultado.detalhe).toContain('O gasto não foi para a planilha.');
    expect(resultado.detalhe).not.toContain('Nada foi gravado');
    expect(linhas()).toEqual([]);
    expect(await listar('ideias')).toEqual([]);
  });

  it('planilha sem acesso (não deixou gravar)', async () => {
    await pastaFinanceiro();
    planilhaComHistorico();
    planilhas.responderAProxima('anexarLinha', { erro: 'sem_acesso' });

    const resultado = await executarFrase('gastei 5,50 hoje comprando salgado');

    expect(resultado.titulo).toBe(SEGUE_COMO_TAREFA);
    expect(resultado.detalhe).toContain('O gasto não foi para a planilha.');
    expect(linhas()).toHaveLength(2);
  });

  it('não consegue ler a planilha antes (erro inesperado): o gasto ainda é gravado', async () => {
    await pastaFinanceiro();
    planilhaComHistorico();
    planilhas.falharAProxima(); // a leitura das categorias falha; a gravação seguinte funciona

    const resultado = await executarFrase('gastei 5,50 hoje comprando salgado');

    expect(resultado.titulo).toBe('Gasto guardado');
    expect(linhas()).toHaveLength(3);
  });
});

describe('a voz não sequestra frase comum (nada vai para o Financeiro)', () => {
  it.each([
    'preciso pagar 50 de luz amanhã',
    'vou gastar 20',
    'reunião às 14',
    'pagar a conta dia 10',
    'comprei 3 maçãs',
    'Adicione pagar o aluguel dia 5 nas tarefas da casa',
    'marcar reunião com a Renata dia 10 às 14',
  ])('"%s"', async (frase) => {
    await pastaFinanceiro();
    planilhaComHistorico();

    const resultado = await executarFrase(frase);
    const dentro = await executarFrase(frase, { pastaAtual: 'pasta-financeiro' });

    expect(resultado.titulo).not.toBe('Gasto guardado');
    expect(dentro.titulo).not.toBe('Gasto guardado');
    expect(linhas()).toHaveLength(2);
    expect(planilhas.pedidos.filter((p) => p.acao === 'anexarLinha')).toEqual([]);
  });
});

// Revisão da Tarefa 16: frase que parece gasto mas é tempo, contagem, pergunta ou pedido não vai para o Financeiro.
describe('frases que não são gasto não gravam na planilha', () => {
  it.each([
    'gastei 2 horas',
    'gastei 3 horas revisando o capítulo 2',
    'gastei 8 horas trabalhando',
    'gastei 90 minutos',
    'gastei 5 minutos',
    'gastei 1 hora',
    'gastei 2 dias',
    'paguei 3 alunos',
    'paguei 2 aulas',
    'gastei 4 aulas',
    'paguei 15 de manhã',
    'gastei 3 de manhã',
    'gastei 40% do orçamento',
    'paguei 3 a Marina',
    'será que gastei 20 euros?',
    'paguei 30 euros ao Prof. Souza?',
    'tarefa: paguei 20 euros',
    'lembrete paguei 20 euros',
    'adicione gastei 20 euros',
    'paguei 2 contas',
    'gastei 3 cafés',
    'paguei 4 livros',
    'comprei 2 pães',
    'gastei 8 e pouco no almoço',
  ])('"%s"', async (frase) => {
    await pastaFinanceiro();
    planilhaComHistorico();

    const fora = await executarFrase(frase);
    const dentro = await executarFrase(frase, { pastaAtual: 'pasta-financeiro' });

    expect(fora.titulo).not.toBe('Gasto guardado');
    expect(dentro.titulo).not.toBe('Gasto guardado');
    expect(linhas()).toHaveLength(2);
    expect(planilhas.pedidos.filter((p) => p.acao === 'anexarLinha')).toEqual([]);
  });

  it.each([
    ['gastei 5,50 hoje comprando salgado', '5.5'],
    ['paguei 30 euros de luz', '30'],
    ['gastei 12 no mercado', '12'],
    ['comprei pão por 2,50', '2.5'],
    ['gastei 20 na farmácia ontem', '20'],
    ['paguei 2 euros de café', '2'],
  ])('mas "%s" segue gravando', async (frase, valor) => {
    await pastaFinanceiro();
    planilhaComHistorico();

    const resultado = await executarFrase(frase);

    expect(resultado.titulo).toBe('Gasto guardado');
    expect(linhas()[2]!.valores['Valor']).toBe(valor);
  });
});

describe('Trocar categoria em outros caminhos (revisão)', () => {
  it('gasto ainda na fila: a troca se junta ao anexo, sem pedir nada ao script', async () => {
    await pastaFinanceiro();
    planilhaComHistorico();
    planilhas.cair();
    const resultado = await executarFrase('gastei 5,50 hoje comprando salgado');

    const feito = await resultado.trocarCategoria!.trocar('Lazer');

    expect(feito.mudou).toBe(true);
    const fila = (await listarPendentes()).filter((p) => p.tipo === 'planilha');
    expect(fila).toHaveLength(1);
    expect(fila[0]).toMatchObject({ acao: 'anexar', valores: { Categoria: 'Lazer', Valor: '5.5' } });
    expect(planilhas.pedidos.filter((p) => p.acao === 'atualizarLinha')).toEqual([]);
  });

  it('trocar e depois Guardar como ideia: a ideia guarda a frase e a linha fica "desfeito"', async () => {
    await pastaFinanceiro();
    planilhaComHistorico();
    const resultado = await executarFrase('gastei 5,50 hoje comprando salgado');
    const feito = await resultado.trocarCategoria!.trocar('Lazer');
    expect(feito.mudou).toBe(true);
    if (!feito.mudou) return;

    const ideia = await feito.resultado.guardarComoIdeia!();

    expect(ideia.titulo).toBe('Guardado em Ideias');
    expect((await listar('ideias')).map((i) => i.texto)).toEqual(['gastei 5,50 hoje comprando salgado']);
    expect(linhas()[2]!.valores).toMatchObject({ Categoria: 'Lazer', Observação: 'desfeito' });
  });

  it('trocar duas vezes e depois Desfazer: a linha fica "desfeito"', async () => {
    await pastaFinanceiro();
    planilhaComHistorico();
    const resultado = await executarFrase('gastei 5,50 hoje comprando salgado');
    const primeira = await resultado.trocarCategoria!.trocar('Lazer');
    if (!primeira.mudou) throw new Error('não trocou');
    const segunda = await primeira.resultado.trocarCategoria!.trocar('Transporte');
    if (!segunda.mudou) throw new Error('não trocou');

    await segunda.resultado.desfazer();

    expect(linhas()[2]!.valores).toMatchObject({ Categoria: 'Transporte', Observação: 'desfeito' });
  });
});

describe('o dia vale em Lisboa', () => {
  it('23:30 UTC de 31/jul já é 1º de agosto em Lisboa: o gasto por voz grava essa data', async () => {
    vi.setSystemTime(new Date('2026-07-31T23:30:00Z'));
    await pastaFinanceiro();
    planilhaComHistorico();

    await executarFrase('gastei 5,50 hoje comprando salgado');

    expect(linhas()[2]!.valores['Data']).toBe('2026-08-01');
  });
});
