// A tela do Financeiro (V02, Tarefa 16): cartões do mês, tabela "Gastos do mês", barras por categoria, gasto manual com
// Desfazer. Só no computador. Quinta-feira, 2026-11-05, 12:20 em Lisboa. A planilha é de mentira
// (tests/apoio/planilhas-falsas.ts); o resto é o código de verdade. Nomes, descrições e valores fictícios.
import { configure, fireEvent, render, waitFor, within } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { limparConversa } from '../../src/chat/conversa';
import { salvar, semear, semearPalavras } from '../../src/dados/loja';
import type { Pasta } from '../../src/dados/tipos';
import { comoCelular, comoComputador, simularAparelho } from '../apoio/aparelho';
import { CABECALHO_FINANCEIRO, falsoDasPlanilhas, reiniciarPlanilhas } from '../apoio/planilhas-falsas';

vi.mock('../../src/dados/planilhas', async (importar) => (await import('../apoio/planilhas-falsas')).comPlanilhasFalsas(await importar<typeof import('../../src/dados/planilhas')>()));

configure({ asyncUtilTimeout: 5000 });

const planilhas = falsoDasPlanilhas();
const PLANILHA = 'planilha-ficticia-financeiro';
const ROTA = '#/sala/sala-casa/pasta/pasta-financeiro';

beforeEach(async () => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-11-05T12:20:00Z'));
  limparConversa();
  reiniciarPlanilhas();
  await semear();
  await semearPalavras();
});

function mostrar(hash = ROTA, largura = 1280) {
  Object.defineProperty(window, 'innerWidth', { value: largura, configurable: true, writable: true });
  history.replaceState(null, '', `/${hash}`);
  return render(<App />);
}

const principal = () => within(document.querySelector('main') as HTMLElement);

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

/** Novembro: Mercado 42,30 + Gasolina 30 + Cinema 18,50 = 90,80. Outubro: Aluguel 600. */
const historico = () => [
  lancamento('2026-11-01', 'Mercado', 'Alimentação', '42,30'),
  lancamento('2026-11-03', 'Gasolina', 'Transporte', '30', { Tipo: 'Crédito', Quem: 'Renata' }),
  lancamento('2026-11-04', 'Cinema', 'Lazer', '18,50'),
  lancamento('2026-10-20', 'Aluguel', 'Casa', '600'),
];
const comHistorico = (linhas = historico()) => planilhas.planilha(PLANILHA, linhas, CABECALHO_FINANCEIRO);

const tabela = async () => within(await principal().findByRole('table', { name: 'Gastos do mês' }));
const linhasDaTabela = async () => (await tabela()).getAllByRole('row').slice(1);
const formulario = async () => within(await principal().findByRole('form', { name: 'Novo gasto' }));

/** O gasto anterior já terminou de gravar (o botão volta a funcionar). */
const esperarLivre = () => waitFor(() => expect((principal().getByRole('button', { name: 'Guardar gasto' }) as HTMLButtonElement).disabled).toBe(false));

async function lancar(campos: { valor?: string; descricao?: string; categoria?: string; tipo?: string; quem?: string; data?: string }) {
  const f = await formulario();
  if (campos.valor !== undefined) fireEvent.input(f.getByLabelText(/^Valor/), { target: { value: campos.valor } });
  if (campos.descricao !== undefined) fireEvent.input(f.getByLabelText(/^Descrição/), { target: { value: campos.descricao } });
  if (campos.categoria !== undefined) fireEvent.input(f.getByLabelText(/^Categoria/), { target: { value: campos.categoria } });
  if (campos.tipo !== undefined) fireEvent.input(f.getByLabelText(/^Tipo/), { target: { value: campos.tipo } });
  if (campos.quem !== undefined) fireEvent.input(f.getByLabelText(/^Quem/), { target: { value: campos.quem } });
  if (campos.data !== undefined) fireEvent.input(f.getByLabelText(/^Data/), { target: { value: campos.data } });
  fireEvent.click(f.getByRole('button', { name: 'Guardar gasto' }));
}

describe('a tela do Financeiro', () => {
  it('mostra cartões, tabela do mês e barras por categoria', async () => {
    await pastaFinanceiro();
    comHistorico();
    mostrar();
    await linhasDaTabela(); // enquanto lê, os cartões mostram "—"

    // Cartões do mês: total, maior categoria, número de lançamentos.
    const cartoes = within(await principal().findByRole('list', { name: 'Resumo do mês' }));
    const itens = cartoes.getAllByRole('listitem');
    expect(itens).toHaveLength(3);
    expect(itens[0]!.textContent).toContain('Total do mês');
    expect(itens[0]!.textContent).toContain('€ 90,80');
    expect(itens[1]!.textContent).toContain('Maior categoria');
    expect(itens[1]!.textContent).toContain('Alimentação');
    expect(itens[1]!.textContent).toContain('€ 42,30');
    expect(itens[2]!.textContent).toContain('Lançamentos');
    expect(itens[2]!.textContent).toMatch(/3/);

    // Tabela do mês: só novembro, a data mais recente primeiro; o valor sempre com a moeda.
    const linhas = await linhasDaTabela();
    expect(linhas).toHaveLength(3);
    expect(linhas.map((l) => within(l).getAllByRole('cell')[1]!.textContent)).toEqual(['CinemaMarina', 'GasolinaRenata', 'MercadoMarina']); // descrição e, embaixo, quem
    expect(linhas[0]!.textContent).toContain('04/11'); // na tabela, só dia e mês (o ano está no título do mês)
    expect(linhas[0]!.textContent).not.toContain('2026');
    expect(linhas[0]!.textContent).toContain('€ 18,50');
    expect(linhas[1]!.textContent).toContain('Crédito');
    expect(linhas[1]!.textContent).toContain('Renata');
    expect(await principal().findByRole('heading', { name: 'Gastos do mês' })).toBeTruthy();

    // Barras por categoria: do maior para o menor, com o valor em texto.
    const barras = within(principal().getByRole('list', { name: 'Gastos por categoria' })).getAllByRole('listitem');
    expect(barras.map((b) => b.textContent)).toEqual([expect.stringContaining('Alimentação'), expect.stringContaining('Transporte'), expect.stringContaining('Lazer')]);
    expect(barras[0]!.textContent).toContain('€ 42,30');
    expect(barras[2]!.textContent).toContain('€ 18,50');
    expect(principal().getByText('novembro de 2026')).toBeTruthy();
  });

  it('no celular (toque e tela física estreita) mostra "Abra no computador" e esconde a tabela', async () => {
    await pastaFinanceiro();
    comHistorico();
    comoCelular();
    mostrar(ROTA, 375);

    expect(await principal().findByText('Abra no computador')).toBeTruthy();
    expect(principal().getByText(/gastei 5,50/i)).toBeTruthy(); // diz que a voz funciona aqui
    expect(principal().queryByRole('table')).toBeNull();
    expect(principal().queryByRole('form', { name: 'Novo gasto' })).toBeNull();
    expect(principal().queryByRole('list', { name: 'Resumo do mês' })).toBeNull();
    expect(principal().queryByRole('link', { name: /Planilha/ })).toBeNull();
    // Nem lê a planilha: a tela não existe nesse aparelho.
    expect(planilhas.pedidos).toEqual([]);
  });

  it('no computador, janela estreita ou com zoom de 200 a 400% continua com a tela inteira', async () => {
    await pastaFinanceiro();
    comHistorico();
    for (const largura of [640, 320]) {
      comoComputador();
      const { unmount } = mostrar(ROTA, largura);
      expect(await principal().findByRole('table', { name: 'Gastos do mês' })).toBeTruthy();
      expect(principal().getByRole('form', { name: 'Novo gasto' })).toBeTruthy();
      expect(principal().queryByText('Abra no computador')).toBeNull();
      unmount();
    }
  });

  it('o celular é o aparelho, não a janela: tela física de 375 px com janela larga ainda é celular; tablet de toque com tela larga não', async () => {
    await pastaFinanceiro();
    comHistorico();
    // Celular deitado: a janela passa de 700 px, a menor medida da tela física não.
    simularAparelho({ toque: true, larguraFisica: 844, alturaFisica: 390 });
    const { unmount } = mostrar(ROTA, 844);
    expect(await principal().findByText('Abra no computador')).toBeTruthy();
    unmount();

    simularAparelho({ toque: true, larguraFisica: 1024, alturaFisica: 768 });
    mostrar(ROTA, 600);
    expect(await principal().findByRole('table', { name: 'Gastos do mês' })).toBeTruthy();
  });

  it('botão Abrir planilha ↗ abre o link, em outra aba e sem dar acesso à janela de origem', async () => {
    await pastaFinanceiro({ planilhaId: 'plan-ficticia_9' });
    planilhas.planilha('plan-ficticia_9', historico(), CABECALHO_FINANCEIRO);
    mostrar();

    const links = await principal().findAllByRole('link', { name: /Abrir planilha/ });
    expect(links).toHaveLength(1); // a página não repete o link
    expect(links[0]!.getAttribute('href')).toBe('https://docs.google.com/spreadsheets/d/plan-ficticia_9');
    expect(links[0]!.getAttribute('target')).toBe('_blank');
    expect(links[0]!.getAttribute('rel')).toContain('noopener');
    expect(principal().queryByRole('link', { name: /Abrir no Google Planilhas/ })).toBeNull();
  });

  it('o seletor de mês mostra o mês anterior e volta; mês sem lançamentos diz isso', async () => {
    await pastaFinanceiro();
    comHistorico();
    mostrar();
    await linhasDaTabela();

    fireEvent.click(principal().getByRole('button', { name: 'Mês anterior' }));
    expect(await principal().findByText('outubro de 2026')).toBeTruthy();
    const linhas = await linhasDaTabela();
    expect(linhas).toHaveLength(1);
    expect(linhas[0]!.textContent).toContain('Aluguel');
    expect(principal().getByRole('list', { name: 'Resumo do mês' }).textContent).toContain('€ 600,00');
    // Não há o que ver antes do primeiro lançamento.
    expect(principal().getByRole('button', { name: 'Mês anterior' }).getAttribute('aria-disabled')).toBe('true');

    fireEvent.click(principal().getByRole('button', { name: 'Mês seguinte' }));
    expect(await principal().findByText('novembro de 2026')).toBeTruthy();
    expect(await linhasDaTabela()).toHaveLength(3);
    // Nem depois do mês de hoje.
    expect(principal().getByRole('button', { name: 'Mês seguinte' }).getAttribute('aria-disabled')).toBe('true');
  });

  it('mês sem lançamentos: não mostra tabela vazia e diz como lançar', async () => {
    await pastaFinanceiro();
    comHistorico([lancamento('2026-09-10', 'Mercado', 'Alimentação', '20')]);
    mostrar();

    expect(await principal().findByText(/Ainda não há gastos em novembro de 2026/)).toBeTruthy();
    expect(principal().queryByRole('table')).toBeNull();
    expect(principal().getByRole('list', { name: 'Resumo do mês' }).textContent).toContain('€ 0,00');
    expect(principal().getByRole('form', { name: 'Novo gasto' })).toBeTruthy();
  });

  it('linhas com valor ou data ilegível ficam fora da conta, com aviso', async () => {
    await pastaFinanceiro();
    comHistorico([...historico(), lancamento('2026-11-02', 'Padaria', 'Alimentação', 'abc'), lancamento('ontem', 'Farmácia', 'Saúde', '10')]);
    mostrar();

    expect(await principal().findByText(/2 linhas da planilha ficaram fora da conta/)).toBeTruthy();
    expect((await linhasDaTabela()).length).toBe(3);
    expect(principal().getByRole('list', { name: 'Resumo do mês' }).textContent).toContain('€ 90,80');
    expect(principal().getByText(/Valor ilegível no lançamento "Padaria"/)).toBeTruthy();
    expect(principal().getByText(/Data ilegível no lançamento "Farmácia"/)).toBeTruthy();
  });

  it('o texto da planilha aparece como texto, nunca como HTML', async () => {
    await pastaFinanceiro();
    comHistorico([lancamento('2026-11-02', '<img src=x onerror="window.__xss=1"> Teste', '<b>Negrito</b>', '5')]);
    mostrar();

    expect((await linhasDaTabela())[0]!.textContent).toContain('<img src=x onerror="window.__xss=1"> Teste');
    expect(principal().getByRole('list', { name: 'Gastos por categoria' }).textContent).toContain('<b>Negrito</b>');
    expect(document.querySelector('main img')).toBeNull();
    expect(document.querySelector('main b')).toBeNull();
    expect((window as unknown as { __xss?: number }).__xss).toBeUndefined();
  });

  it('planilha vazia ou pasta sem planilha: mensagens claras', async () => {
    await pastaFinanceiro({ planilhaId: undefined });
    mostrar();

    expect(await principal().findByText('Esta pasta ainda não tem planilha.')).toBeTruthy();
    expect(principal().queryByRole('form', { name: 'Novo gasto' })).toBeNull();
  });

  it('planilha que mudou (falta coluna): avisa no alto e não deixa gravar', async () => {
    await pastaFinanceiro();
    planilhas.planilha(PLANILHA, [lancamento('2026-11-02', 'Mercado', 'Alimentação', '20')], CABECALHO_FINANCEIRO.filter((c) => c !== 'Tipo'));
    mostrar();

    expect(await principal().findByText(/A planilha mudou: falta uma coluna/)).toBeTruthy();
    await lancar({ valor: '5,50', descricao: 'Salgado' });

    expect(await principal().findByRole('alert')).toBeTruthy();
    expect(principal().getByText(/Nada foi gravado/)).toBeTruthy();
    expect(planilhas.linhas(PLANILHA)).toHaveLength(1);
  });

  it('Reler a planilha traz o que outra pessoa lançou; ao voltar a rede, relê sozinha', async () => {
    await pastaFinanceiro();
    comHistorico();
    mostrar();
    expect(await linhasDaTabela()).toHaveLength(3);

    comHistorico([...historico(), lancamento('2026-11-05', 'Café', 'Alimentação', '2', { Quem: 'Renata' })]);
    fireEvent.click(principal().getByRole('button', { name: 'Reler a planilha' }));
    await waitFor(async () => expect(await linhasDaTabela()).toHaveLength(4));

    comHistorico([...historico(), lancamento('2026-11-05', 'Café', 'Alimentação', '2'), lancamento('2026-11-05', 'Jornal', 'Lazer', '1,50')]);
    window.dispatchEvent(new Event('online'));
    await waitFor(async () => expect(await linhasDaTabela()).toHaveLength(5));
  });

  it('sem internet mostra o que o aparelho guardou e avisa', async () => {
    await pastaFinanceiro();
    comHistorico();
    mostrar();
    await linhasDaTabela();

    planilhas.cair();
    fireEvent.click(principal().getByRole('button', { name: 'Reler a planilha' }));

    expect(await principal().findByText(/Sem internet: mostrando o que este aparelho guardou/)).toBeTruthy();
    expect(await linhasDaTabela()).toHaveLength(3);
  });

  it('falha de leitura sem nada guardado: "Não consegui ler" e Tentar de novo', async () => {
    await pastaFinanceiro();
    comHistorico();
    planilhas.falharAProxima();
    mostrar();

    expect(await principal().findByText(/Não consegui ler a planilha agora/)).toBeTruthy();
    fireEvent.click(principal().getByRole('button', { name: 'Tentar de novo' }));
    expect(await linhasDaTabela()).toHaveLength(3);
  });
});

describe('gasto manual', () => {
  it('guarda o gasto, mostra o cartão e a linha aparece na tabela e nos totais', async () => {
    await pastaFinanceiro();
    comHistorico();
    mostrar();
    await linhasDaTabela();

    await lancar({ valor: '12,50', descricao: 'Livraria', categoria: 'Lazer' });

    const cartao = await principal().findByRole('article');
    expect(await within(cartao).findByText('Gasto guardado')).toBeTruthy();
    expect(cartao.textContent).toContain('€ 12,50 · Lazer · Débito');
    const novas = planilhas.linhas(PLANILHA);
    expect(novas).toHaveLength(5);
    expect(novas[4]!.valores).toMatchObject({ Data: '2026-11-05', Descrição: 'Livraria', Categoria: 'Lazer', Tipo: 'Débito', Valor: '12.5', Quem: 'Central' });
    await waitFor(async () => expect(await linhasDaTabela()).toHaveLength(4));
    expect((await linhasDaTabela())[0]!.textContent).toContain('Livraria');
    expect(principal().getByRole('list', { name: 'Resumo do mês' }).textContent).toContain('€ 103,30');
    // O formulário volta limpo (data de hoje, Débito).
    const f = await formulario();
    expect((f.getByLabelText(/^Valor/) as HTMLInputElement).value).toBe('');
    expect((f.getByLabelText(/^Descrição/) as HTMLInputElement).value).toBe('');
    expect((f.getByLabelText(/^Tipo/) as HTMLSelectElement).value).toBe('Débito');
    expect((f.getByLabelText(/^Data/) as HTMLInputElement).value).toBe('2026-11-05');
  });

  it('categoria e quem têm sugestões da planilha; o tipo, Débito e os já usados', async () => {
    await pastaFinanceiro();
    comHistorico();
    mostrar();
    const f = await formulario();
    await linhasDaTabela();

    const opcoes = (rotulo: RegExp) => {
      const campo = f.getByLabelText(rotulo) as HTMLInputElement;
      const lista = document.getElementById(campo.getAttribute('list') ?? '--');
      return Array.from(lista?.querySelectorAll('option') ?? []).map((o) => o.getAttribute('value'));
    };
    expect(opcoes(/^Categoria/)).toEqual(['Alimentação', 'Casa', 'Lazer', 'Transporte']);
    expect(f.getByText('Escolha uma já usada ou digite outra.')).toBeTruthy();
    expect(opcoes(/^Quem/)).toEqual(['Marina', 'Renata']);
    // O Tipo é uma lista: Débito, Crédito e os já usados na planilha.
    const tipo = f.getByLabelText(/^Tipo/) as HTMLSelectElement;
    expect(tipo.tagName).toBe('SELECT');
    expect(Array.from(tipo.options).map((o) => o.value)).toEqual(['Crédito', 'Débito']);
    expect(tipo.value).toBe('Débito');
  });

  it('categoria digitada de outro jeito usa a grafia da planilha ("alimentacao" → "Alimentação"); vazia vira "Outros"', async () => {
    await pastaFinanceiro();
    comHistorico();
    mostrar();
    await linhasDaTabela();

    await lancar({ valor: '3', descricao: 'Pão', categoria: ' alimentacao ' });
    await waitFor(() => expect(planilhas.linhas(PLANILHA)).toHaveLength(5));
    expect(planilhas.linhas(PLANILHA)[4]!.valores['Categoria']).toBe('Alimentação');
    await esperarLivre();

    await lancar({ valor: '4', descricao: 'Troço', categoria: '' });
    await waitFor(() => expect(planilhas.linhas(PLANILHA)).toHaveLength(6));
    expect(planilhas.linhas(PLANILHA)[5]!.valores['Categoria']).toBe('Outros');
  });

  it('tipo, quem e data escolhidos vão para a planilha', async () => {
    await pastaFinanceiro();
    comHistorico();
    mostrar();
    await linhasDaTabela();

    await lancar({ valor: '1.250,75', descricao: 'Sofá', categoria: 'Casa', tipo: 'Crédito', quem: 'Aurora', data: '2026-11-02' });

    await waitFor(() => expect(planilhas.linhas(PLANILHA)).toHaveLength(5));
    expect(planilhas.linhas(PLANILHA)[4]!.valores).toMatchObject({ Data: '2026-11-02', Valor: '1250.75', Tipo: 'Crédito', Quem: 'Aurora' });
  });

  it.each([
    ['valor vazio', { valor: '', descricao: 'Algo' }, /Digite o valor/],
    ['valor que não é número', { valor: 'cinco', descricao: 'Algo' }, /Digite o valor/],
    ['valor zero', { valor: '0', descricao: 'Algo' }, /maior que zero/],
    ['valor em reais', { valor: 'R$ 12', descricao: 'Algo' }, /só em €|só €/],
    ['sem descrição', { valor: '5', descricao: '  ' }, /descrição/],
    ['data no futuro', { valor: '5', descricao: 'Algo', data: '2026-11-20' }, /não pode estar no futuro/],
    ['data apagada', { valor: '5', descricao: 'Algo', data: '' }, /Escolha a data/],
  ])('%s: avisa e não grava', async (_nome, campos, aviso) => {
    await pastaFinanceiro();
    comHistorico();
    mostrar();
    await linhasDaTabela();

    await lancar(campos);

    expect(await principal().findByText(aviso)).toBeTruthy();
    expect(planilhas.linhas(PLANILHA)).toHaveLength(4);
    expect(principal().queryByText('Gasto guardado')).toBeNull();
  });

  it('Desfazer: a linha continua na planilha, marcada "desfeito", e some da tela e dos totais', async () => {
    await pastaFinanceiro();
    comHistorico();
    mostrar();
    await linhasDaTabela();
    await lancar({ valor: '12,50', descricao: 'Livraria', categoria: 'Lazer' });
    await principal().findByText('Gasto guardado');
    await waitFor(async () => expect(await linhasDaTabela()).toHaveLength(4));

    fireEvent.click(principal().getByRole('button', { name: 'Desfazer' }));

    expect(await principal().findByText('Gasto desfeito')).toBeTruthy();
    await waitFor(async () => expect(await linhasDaTabela()).toHaveLength(3));
    expect(planilhas.linhas(PLANILHA)).toHaveLength(5);
    expect(planilhas.linhas(PLANILHA)[4]!.valores['Observação']).toBe('desfeito');
    expect(principal().getByRole('list', { name: 'Resumo do mês' }).textContent).toContain('€ 90,80');
    expect(principal().queryByRole('button', { name: 'Desfazer' })).toBeNull();
  });

  it('Desfazer que falha mostra o erro, não diz "desfeito" e pode ser tentado de novo', async () => {
    await pastaFinanceiro();
    comHistorico();
    mostrar();
    await linhasDaTabela();
    await lancar({ valor: '12,50', descricao: 'Livraria', categoria: 'Lazer' });
    await principal().findByText('Gasto guardado');
    await waitFor(async () => expect(await linhasDaTabela()).toHaveLength(4));

    planilhas.falharAProxima();
    fireEvent.click(principal().getByRole('button', { name: 'Desfazer' }));
    expect(await principal().findByText(/Não consegui desfazer agora/)).toBeTruthy();
    expect(principal().queryByText('Gasto desfeito')).toBeNull();

    fireEvent.click(principal().getByRole('button', { name: 'Desfazer' }));
    expect(await principal().findByText('Gasto desfeito')).toBeTruthy();
  });

  it('sem internet o gasto espera na fila: cartão avisa e a tabela o mostra como "Esperando a rede"', async () => {
    await pastaFinanceiro();
    comHistorico();
    mostrar();
    await linhasDaTabela();
    planilhas.cair();

    await lancar({ valor: '7', descricao: 'Sorvete', categoria: 'Lazer' });

    expect(await principal().findByText(/Sem internet: o gasto fica neste aparelho/)).toBeTruthy();
    await waitFor(async () => expect((await linhasDaTabela())[0]!.textContent).toContain('Esperando a rede'));
    expect(planilhas.linhas(PLANILHA)).toHaveLength(4);
  });

  it('toque duplo em "Guardar gasto" grava uma vez só', async () => {
    await pastaFinanceiro();
    comHistorico();
    mostrar();
    await linhasDaTabela();
    const f = await formulario();
    fireEvent.input(f.getByLabelText(/^Valor/), { target: { value: '9' } });
    fireEvent.input(f.getByLabelText(/^Descrição/), { target: { value: 'Revista' } });
    const botao = f.getByRole('button', { name: 'Guardar gasto' });

    fireEvent.click(botao);
    fireEvent.click(botao);

    await principal().findByText('Gasto guardado');
    await new Promise((r) => setTimeout(r, 50));
    expect(planilhas.linhas(PLANILHA)).toHaveLength(5);
  });

  it('o foco vai para o cartão a cada gasto guardado, mesmo com o mesmo título', async () => {
    await pastaFinanceiro();
    comHistorico();
    mostrar();
    await linhasDaTabela();

    await lancar({ valor: '2', descricao: 'Bala' });
    await waitFor(() => expect(document.activeElement?.classList.contains('pastas-cartao')).toBe(true));
    (document.activeElement as HTMLElement).blur();
    await esperarLivre();
    await lancar({ valor: '3', descricao: 'Chiclete' });

    await waitFor(() => expect(planilhas.linhas(PLANILHA)).toHaveLength(6));
    await waitFor(() => expect(document.activeElement?.classList.contains('pastas-cartao')).toBe(true));
  });

  it('observação nunca é escrita pela tela (a coluna é só do Desfazer)', async () => {
    await pastaFinanceiro();
    comHistorico();
    mostrar();
    await linhasDaTabela();

    await lancar({ valor: '2', descricao: 'desfeito' });

    await waitFor(() => expect(planilhas.linhas(PLANILHA)).toHaveLength(5));
    expect(planilhas.linhas(PLANILHA)[4]!.valores['Observação'] ?? '').toBe('');
    expect(planilhas.linhas(PLANILHA)[4]!.valores['Descrição']).toBe('desfeito');
  });
});

describe('trocar de pasta recomeça a tela (key)', () => {
  it('abrir uma segunda pasta de planilha não leva o formulário, o mês nem o cartão da primeira', async () => {
    await pastaFinanceiro();
    await pastaFinanceiro({ id: 'pasta-contas', nome: 'Contas', ordem: 7, planilhaId: 'planilha-ficticia-contas' });
    comHistorico();
    planilhas.planilha('planilha-ficticia-contas', [lancamento('2026-11-02', 'Chuveiro', 'Casa', '25')], CABECALHO_FINANCEIRO);
    mostrar();
    await linhasDaTabela();
    await lancar({ valor: '9', descricao: 'Revista' });
    await principal().findByText('Gasto guardado');
    fireEvent.click(principal().getByRole('button', { name: 'Mês anterior' }));
    expect(await principal().findByText('outubro de 2026')).toBeTruthy();

    history.replaceState(null, '', '/#/sala/sala-casa/pasta/pasta-contas');
    window.dispatchEvent(new HashChangeEvent('hashchange'));

    await principal().findByRole('heading', { level: 1, name: 'Contas' }).catch(() => undefined);
    await waitFor(async () => expect((await linhasDaTabela())[0]!.textContent).toContain('Chuveiro'));
    expect(principal().getByText('novembro de 2026')).toBeTruthy();
    expect(principal().queryByText('Gasto guardado')).toBeNull();
    expect((within(principal().getByRole('form', { name: 'Novo gasto' })).getByLabelText(/^Descrição/) as HTMLInputElement).value).toBe('');
  });
});

describe('o dia e o mês valem em Lisboa', () => {
  it('23:30 UTC de 31/jul já é agosto: o seletor, a tabela e a data padrão do formulário', async () => {
    vi.setSystemTime(Date.parse('2026-07-31T23:30:00Z'));
    await pastaFinanceiro();
    comHistorico([lancamento('2026-08-01', 'Café', 'Alimentação', '2'), lancamento('2026-07-31', 'Jantar', 'Alimentação', '20')]);
    mostrar();

    expect(await principal().findByText('agosto de 2026')).toBeTruthy();
    const linhas = await linhasDaTabela();
    expect(linhas).toHaveLength(1);
    expect(linhas[0]!.textContent).toContain('Café');
    expect(((await formulario()).getByLabelText(/^Data/) as HTMLInputElement).value).toBe('2026-08-01');
    fireEvent.click(principal().getByRole('button', { name: 'Mês anterior' }));
    expect(await principal().findByText('julho de 2026')).toBeTruthy();
    expect((await linhasDaTabela())[0]!.textContent).toContain('Jantar');
  });

  it('o seletor atravessa a virada do ano nos dois sentidos', async () => {
    vi.setSystemTime(Date.parse('2026-01-15T12:00:00Z'));
    await pastaFinanceiro();
    comHistorico([lancamento('2026-01-10', 'Mercado', 'Alimentação', '10'), lancamento('2025-12-20', 'Presente', 'Lazer', '30')]);
    mostrar();
    await linhasDaTabela();

    fireEvent.click(principal().getByRole('button', { name: 'Mês anterior' }));
    expect(await principal().findByText('dezembro de 2025')).toBeTruthy();
    expect((await linhasDaTabela())[0]!.textContent).toContain('Presente');
    fireEvent.click(principal().getByRole('button', { name: 'Mês seguinte' }));
    expect(await principal().findByText('janeiro de 2026')).toBeTruthy();
    expect((await linhasDaTabela())[0]!.textContent).toContain('Mercado');
  });
});

describe('limites do formulário (200 e 60 caracteres)', () => {
  it('os campos limitam o que se digita', async () => {
    await pastaFinanceiro();
    comHistorico();
    mostrar();
    const f = await formulario();

    expect(f.getByLabelText(/^Descrição/).getAttribute('maxlength')).toBe('200');
    expect(f.getByLabelText(/^Categoria/).getAttribute('maxlength')).toBe('60');
  });

  it.each([
    ['descrição com 201 caracteres', { valor: '5', descricao: 'x'.repeat(201) }, /200 caracteres/],
    ['categoria com 61 caracteres', { valor: '5', descricao: 'Algo', categoria: 'y'.repeat(61) }, /60 caracteres/],
  ])('%s (colada): avisa e não grava', async (_nome, campos, aviso) => {
    await pastaFinanceiro();
    comHistorico();
    mostrar();
    await linhasDaTabela();

    await lancar(campos);

    expect(await principal().findByText(aviso)).toBeTruthy();
    expect(planilhas.linhas(PLANILHA)).toHaveLength(4);
  });

  it('descrição com 200 caracteres vale', async () => {
    await pastaFinanceiro();
    comHistorico();
    mostrar();
    await linhasDaTabela();

    await lancar({ valor: '5', descricao: 'x'.repeat(200) });

    await waitFor(() => expect(planilhas.linhas(PLANILHA)).toHaveLength(5));
  });
});

describe('ordem, leitura e erros (revisão da Tarefa 16)', () => {
  it('a ordem da tela: mês, totais, Novo gasto, resultado, Por categoria, tabela', async () => {
    await pastaFinanceiro();
    comHistorico();
    mostrar();
    await linhasDaTabela();

    const ordem = [
      principal().getByRole('group', { name: 'Mês' }),
      principal().getByRole('list', { name: 'Resumo do mês' }),
      principal().getByRole('form', { name: 'Novo gasto' }),
      document.querySelector('main .financeiro .pastas-resultado') as HTMLElement,
      principal().getByRole('list', { name: 'Gastos por categoria' }),
      principal().getByRole('table', { name: 'Gastos do mês' }),
    ];
    for (let i = 1; i < ordem.length; i++) {
      expect(ordem[i - 1]!.compareDocumentPosition(ordem[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('"Reler a planilha" fica no alto, mostra "Lendo…" enquanto lê e volta ao texto', async () => {
    await pastaFinanceiro();
    comHistorico();
    mostrar();
    await linhasDaTabela();
    const topo = principal().getByRole('link', { name: /Abrir planilha/ }).parentElement as HTMLElement;
    expect(within(topo).getByRole('button', { name: 'Reler a planilha' })).toBeTruthy();

    const liberar = planilhas.segurarAProxima('lerLinhas');
    fireEvent.click(within(topo).getByRole('button', { name: 'Reler a planilha' }));
    expect(await within(topo).findByRole('button', { name: 'Lendo…' })).toBeTruthy();
    // Durante a leitura a tabela continua na tela.
    expect(principal().getByRole('table', { name: 'Gastos do mês' })).toBeTruthy();
    liberar();

    expect(await within(topo).findByRole('button', { name: 'Reler a planilha' })).toBeTruthy();
  });

  it('releitura que falha com dados na tela: mantém a tabela e avisa; a próxima que der certo tira o aviso', async () => {
    await pastaFinanceiro();
    comHistorico();
    mostrar();
    await linhasDaTabela();

    planilhas.falharAProxima();
    fireEvent.click(principal().getByRole('button', { name: 'Reler a planilha' }));

    expect(await principal().findByText('Não consegui atualizar. Mostrando a última leitura.')).toBeTruthy();
    expect(await linhasDaTabela()).toHaveLength(3);
    expect(principal().queryByText(/Não consegui ler a planilha agora/)).toBeNull();

    fireEvent.click(await principal().findByRole('button', { name: 'Reler a planilha' }));
    await waitFor(() => expect(principal().queryByText('Não consegui atualizar. Mostrando a última leitura.')).toBeNull());
  });

  it('o erro de um campo marca só esse campo (aria-invalid e aria-describedby) e leva o foco para ele', async () => {
    await pastaFinanceiro();
    comHistorico();
    mostrar();
    await linhasDaTabela();
    const f = await formulario();
    const marcados = () => Array.from(document.querySelectorAll('main [aria-invalid="true"]')).map((e) => e.id);

    await lancar({ valor: 'cinco', descricao: 'Algo' });
    expect(await principal().findByRole('alert')).toBeTruthy();
    expect(marcados()).toEqual(['fin-valor']);
    expect(f.getByLabelText(/^Valor/).getAttribute('aria-describedby')).toBe('fin-erro');
    expect(document.getElementById('fin-erro')?.textContent).toMatch(/Digite o valor/);
    expect(document.activeElement).toBe(f.getByLabelText(/^Valor/));
    expect(f.getByLabelText(/^Descrição/).getAttribute('aria-describedby')).toBeNull();

    // Corrigir o campo tira o erro; o próximo erro marca outro campo.
    fireEvent.input(f.getByLabelText(/^Valor/), { target: { value: '5' } });
    expect(marcados()).toEqual([]);
    fireEvent.input(f.getByLabelText(/^Descrição/), { target: { value: ' ' } });
    fireEvent.click(f.getByRole('button', { name: 'Guardar gasto' }));
    await waitFor(() => expect(marcados()).toEqual(['fin-descricao']));
    expect(document.activeElement).toBe(f.getByLabelText(/^Descrição/));

    fireEvent.input(f.getByLabelText(/^Descrição/), { target: { value: 'Algo' } });
    fireEvent.input(f.getByLabelText(/^Data/), { target: { value: '2026-11-20' } });
    fireEvent.click(f.getByRole('button', { name: 'Guardar gasto' }));
    await waitFor(() => expect(marcados()).toEqual(['fin-data']));
    expect(f.getByLabelText(/^Data/).getAttribute('aria-describedby')).toBe('fin-erro');
  });

  it('erro geral (planilha mudou) aparece sem marcar campo nenhum', async () => {
    await pastaFinanceiro();
    planilhas.planilha(PLANILHA, [lancamento('2026-11-02', 'Mercado', 'Alimentação', '20')], CABECALHO_FINANCEIRO.filter((c) => c !== 'Tipo'));
    mostrar();
    await principal().findByText(/A planilha mudou: falta uma coluna/);

    await lancar({ valor: '5,50', descricao: 'Salgado' });

    expect(await principal().findByRole('alert')).toBeTruthy();
    expect(document.querySelectorAll('main [aria-invalid="true"]')).toHaveLength(0);
  });

  it('o Tipo usa a grafia da planilha e não repete Débito; a barra menor tem pelo menos 6% da largura', async () => {
    await pastaFinanceiro();
    comHistorico([lancamento('2026-11-01', 'Aluguel', 'Casa', '1000', { Tipo: 'debito' }), lancamento('2026-11-02', 'Bala', 'Doces', '1', { Tipo: 'debito' })]);
    mostrar();
    await linhasDaTabela();

    const tipo = (await formulario()).getByLabelText(/^Tipo/) as HTMLSelectElement;
    expect(Array.from(tipo.options).map((o) => o.value)).toEqual(['Crédito', 'debito']);
    expect(tipo.value).toBe('debito');

    const barras = within(principal().getByRole('list', { name: 'Gastos por categoria' })).getAllByRole('listitem');
    const largura = (li: HTMLElement) => parseFloat((li.querySelector('.fin-barra') as HTMLElement).style.width);
    expect(largura(barras[0]!)).toBe(100);
    expect(largura(barras[1]!)).toBe(6);
  });
});

// ---- Acessibilidade (Tarefa 19, correções): foco, região viva, botões de mês ----

describe('acessibilidade do Financeiro', () => {
  it('o título da seção não repete o do alto da página', async () => {
    await pastaFinanceiro();
    comHistorico();
    mostrar();
    await linhasDaTabela();

    expect(principal().queryByRole('heading', { level: 2, name: 'Financeiro' })).toBeNull();
    expect(principal().getByRole('heading', { level: 2, name: 'Lançamentos' })).toBeTruthy();
  });

  it('os botões de mês no limite usam aria-disabled (o foco não se perde) e não fazem nada', async () => {
    await pastaFinanceiro();
    comHistorico();
    mostrar();
    await linhasDaTabela();

    const seguinte = principal().getByRole('button', { name: 'Mês seguinte' });
    expect(seguinte.hasAttribute('disabled')).toBe(false);
    expect(seguinte.getAttribute('aria-disabled')).toBe('true');
    seguinte.focus();
    fireEvent.click(seguinte);
    expect(principal().getByText('novembro de 2026')).toBeTruthy();
    expect(document.activeElement).toBe(seguinte);

    const anterior = principal().getByRole('button', { name: 'Mês anterior' });
    expect(anterior.hasAttribute('aria-disabled')).toBe(false);
    fireEvent.click(anterior);
    expect(await principal().findByText('outubro de 2026')).toBeTruthy();
    // No limite, o botão em foco continua em foco e a tela fica onde estava.
    anterior.focus();
    expect(anterior.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(anterior);
    expect(principal().getByText('outubro de 2026')).toBeTruthy();
    expect(document.activeElement).toBe(anterior);
    expect(anterior.hasAttribute('disabled')).toBe(false);
  });

  it('Fechar o cartão leva o foco ao campo Valor (nunca ao body)', async () => {
    await pastaFinanceiro();
    comHistorico();
    mostrar();
    await linhasDaTabela();
    await lancar({ valor: '12,50', descricao: 'Livraria' });
    const cartao = await principal().findByRole('article');
    await waitFor(() => expect(document.activeElement).toBe(cartao));
    fireEvent.click(within(cartao).getByRole('button', { name: 'Fechar' }));

    expect(principal().queryByRole('article')).toBeNull();
    expect(document.activeElement).toBe((await formulario()).getByLabelText(/^Valor/));
  });

  it('o cartão não fica numa região viva, tem nome e descrição, e nenhuma região viva tem botão', async () => {
    await pastaFinanceiro();
    comHistorico();
    mostrar();
    await linhasDaTabela();
    await lancar({ valor: '12,50', descricao: 'Livraria' });
    const cartao = await principal().findByRole('article');

    expect(cartao.closest('[role="status"], [aria-live]')).toBeNull();
    expect(cartao.getAttribute('aria-labelledby')).toBeTruthy();
    expect(cartao.getAttribute('aria-describedby')).toBeTruthy();
    for (const regiao of document.querySelectorAll('main [role="status"], main [aria-live]')) expect(regiao.querySelector('button, a[href]')).toBeNull();
  });

  it('"Mostrar todos os N gastos" vira "Mostrar menos" no mesmo botão e o foco fica nele', async () => {
    await pastaFinanceiro();
    comHistorico(Array.from({ length: 45 }, (_, i) => lancamento('2026-11-02', `Gasto ${i + 1}`, 'Lazer', '1')));
    mostrar();
    expect(await linhasDaTabela()).toHaveLength(40);

    const botao = principal().getByRole('button', { name: 'Mostrar todos os 45 gastos' });
    expect(botao.getAttribute('aria-expanded')).toBe('false');
    botao.focus();
    fireEvent.click(botao);

    await waitFor(() => expect(botao.textContent).toBe('Mostrar menos'));
    expect(botao.isConnected).toBe(true);
    expect(botao.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(botao);
    expect(await linhasDaTabela()).toHaveLength(45);

    fireEvent.click(botao);
    await waitFor(() => expect(botao.textContent).toBe('Mostrar todos os 45 gastos'));
    expect(await linhasDaTabela()).toHaveLength(40);
    expect(document.activeElement).toBe(botao);
  });

  it('os avisos de rede moram numa região viva que nasce vazia', async () => {
    await pastaFinanceiro();
    comHistorico();
    const { unmount } = mostrar();
    await linhasDaTabela();
    unmount();

    planilhas.cair();
    let nasceuCom: string | null = null;
    const olho = new MutationObserver((mudancas) => {
      for (const m of mudancas)
        for (const no of m.addedNodes) {
          const achada = no instanceof HTMLElement ? (no.matches('.aviso-vivo') ? no : no.querySelector('.aviso-vivo')) : null;
          if (achada && nasceuCom === null) nasceuCom = achada.textContent ?? '';
        }
    });
    olho.observe(document.body, { childList: true, subtree: true });
    mostrar();
    await linhasDaTabela();
    olho.disconnect();

    const regiao = document.querySelector<HTMLElement>('main .aviso-vivo');
    expect(regiao?.getAttribute('role')).toBe('status');
    expect(nasceuCom).toBe('');
    expect(regiao?.textContent).toMatch(/Sem internet: mostrando o que este aparelho guardou/);
  });
});
