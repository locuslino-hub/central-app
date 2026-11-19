// A tela da Lista de compras (V02, Tarefa 14): itens com caixa de marcar, "Limpar comprados", novo item, voz dentro da pasta.
// Quinta-feira, 2026-11-05, 12:20 em Lisboa. A planilha é de mentira (tests/apoio/planilhas-falsas.ts); o resto é o código de verdade.
// Nomes, ids e itens fictícios.
import { act, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { limparConversa } from '../../src/chat/conversa';
import { salvar, semear, semearPalavras } from '../../src/dados/loja';
import type { Pasta } from '../../src/dados/tipos';
import { abrirPodeFalar } from '../../src/ui/PodeFalar';
import { comoCelular, comoComputador } from '../apoio/aparelho';
import { CABECALHO_COMPRAS, falsoDasPlanilhas, reiniciarPlanilhas } from '../apoio/planilhas-falsas';

vi.mock('../../src/dados/planilhas', async (importar) => (await import('../apoio/planilhas-falsas')).comPlanilhasFalsas(await importar<typeof import('../../src/dados/planilhas')>()));

configure({ asyncUtilTimeout: 5000 });

const planilhas = falsoDasPlanilhas();
const PLANILHA = 'planilha-ficticia-compras';
const HASH = '#/sala/sala-casa/pasta/pasta-compras';

beforeEach(async () => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-11-05T12:20:00Z'));
  limparConversa();
  reiniciarPlanilhas();
  await semear();
  await semearPalavras();
});

function mostrar(hash: string, largura = 1280) {
  Object.defineProperty(window, 'innerWidth', { value: largura, configurable: true, writable: true });
  history.replaceState(null, '', `/${hash}`);
  return render(<App />);
}

const principal = () => within(document.querySelector('main') as HTMLElement);
const compra = (item: string, extra: Record<string, string> = {}) => ({
  Item: item,
  Quantidade: '',
  Valor: '',
  Link: '',
  Prioridade: '',
  'Comprado?': '',
  'Quem pôs': 'Marina',
  Data: '2026-11-01',
  Observação: '',
  ...extra,
});

function pastaDeCompras(extra: Partial<Pasta> = {}) {
  return salvar('pastas', {
    id: 'pasta-compras',
    salaId: 'sala-casa',
    tipo: 'lista',
    nome: 'Lista de Compras Semanais',
    ordem: 1,
    modelo: 'compras',
    planilhaId: PLANILHA,
    ...extra,
  });
}

const comItens = () =>
  planilhas.planilha(
    PLANILHA,
    [compra('Leite', { Quantidade: '2' }), compra('Pão'), compra('Ovos', { 'Comprado?': 'TRUE', 'Quem pôs': 'Renata' }), compra('Café', { 'Comprado?': 'sim' })],
    CABECALHO_COMPRAS,
  );

const itensAComprar = async () => within(await principal().findByRole('list', { name: 'Itens a comprar' }));
const comprados = () => principal().queryByRole('list', { name: 'Itens comprados' });
const anexos = () => planilhas.pedidos.filter((p) => p.acao === 'anexarLinha');
const atualizacoes = () => planilhas.pedidos.filter((p) => p.acao === 'atualizarLinha');

async function pôr(item: string, quantidade?: string) {
  const formulario = within(await principal().findByRole('form', { name: 'Novo item' }));
  fireEvent.input(formulario.getByLabelText('Item'), { target: { value: item } });
  if (quantidade) fireEvent.input(formulario.getByLabelText(/^Quantidade/), { target: { value: quantidade } });
  fireEvent.click(formulario.getByRole('button', { name: 'Pôr na lista' }));
}

describe('a tela da Lista', () => {
  it('lista mostra itens com caixa de marcar', async () => {
    await pastaDeCompras();
    comItens();
    mostrar(HASH);

    const aComprar = await itensAComprar();
    expect(aComprar.getAllByRole('checkbox')).toHaveLength(2);
    expect(aComprar.getByRole('checkbox', { name: 'Leite' })).toHaveProperty('checked', false);
    expect(aComprar.getByRole('checkbox', { name: 'Pão' })).toHaveProperty('checked', false);
    // Quantidade, quem pôs e data aparecem junto do item.
    const linhaDoLeite = aComprar.getByRole('checkbox', { name: 'Leite' }).closest('li')!;
    expect(linhaDoLeite.textContent).toMatch(/2/);
    expect(linhaDoLeite.textContent).toContain('Marina');
    expect(linhaDoLeite.textContent).toContain('01/11/2026');
    // Os comprados ficam à parte, já marcados: "TRUE" e "sim" valem.
    const lista = within(comprados()!);
    expect(lista.getByRole('checkbox', { name: 'Ovos' })).toHaveProperty('checked', true);
    expect(lista.getByRole('checkbox', { name: 'Café' })).toHaveProperty('checked', true);
    expect(lista.getByText(/Renata/)).toBeTruthy();
  });

  it('pasta sem itens mostra o vazio e o formulário', async () => {
    await pastaDeCompras();
    planilhas.planilha(PLANILHA, [], CABECALHO_COMPRAS);
    mostrar(HASH);

    expect(await principal().findByText(/A lista está vazia/)).toBeTruthy();
    expect(principal().getByRole('form', { name: 'Novo item' })).toBeTruthy();
  });

  it('linha sem Item, ou desfeita, não aparece', async () => {
    await pastaDeCompras();
    planilhas.planilha(PLANILHA, [compra('Leite'), compra(''), compra('Pão', { Observação: 'desfeito' })], CABECALHO_COMPRAS);
    mostrar(HASH);

    const aComprar = await itensAComprar();
    expect(aComprar.getAllByRole('checkbox')).toHaveLength(1);
  });

  it('marcar comprado atualiza a linha por id', async () => {
    await pastaDeCompras();
    comItens();
    mostrar(HASH);
    const aComprar = await itensAComprar();

    fireEvent.click(aComprar.getByRole('checkbox', { name: 'Leite' }));

    await waitFor(() => expect(planilhas.linhas(PLANILHA)[0]!.valores['Comprado?']).toBe('TRUE'));
    expect(atualizacoes()).toHaveLength(1);
    expect(atualizacoes()[0]!.dados).toMatchObject({ idDaLinha: planilhas.linhas(PLANILHA)[0]!.id, valores: { 'Comprado?': 'TRUE' } });
    // O item passa para os comprados.
    await waitFor(() => expect(within(comprados()!).getByRole('checkbox', { name: 'Leite' })).toHaveProperty('checked', true));
    expect((await itensAComprar()).queryByRole('checkbox', { name: 'Leite' })).toBeNull();
    // Nenhuma outra linha foi tocada, e nenhuma linha foi apagada.
    expect(planilhas.linhas(PLANILHA)).toHaveLength(4);
    expect(planilhas.linhas(PLANILHA)[1]!.valores['Comprado?']).toBe('');
  });

  it('desmarcar um comprado grava FALSE na linha e o item volta para "a comprar"', async () => {
    await pastaDeCompras();
    comItens();
    mostrar(HASH);
    await itensAComprar();

    fireEvent.click(within(comprados()!).getByRole('checkbox', { name: 'Ovos' }));

    await waitFor(() => expect(planilhas.linhas(PLANILHA)[2]!.valores['Comprado?']).toBe('FALSE'));
    await waitFor(async () => expect((await itensAComprar()).getByRole('checkbox', { name: 'Ovos' })).toHaveProperty('checked', false));
  });

  it('Limpar comprados oculta os comprados da vista sem apagar a linha', async () => {
    await pastaDeCompras();
    comItens();
    mostrar(HASH);
    await itensAComprar();
    const antes = JSON.stringify(planilhas.linhas(PLANILHA));
    const pedidosAntes = planilhas.pedidos.length;

    fireEvent.click(principal().getByRole('button', { name: 'Limpar comprados' }));

    await waitFor(() => expect(comprados()).toBeNull());
    expect(principal().getByRole('button', { name: /Mostrar comprados/ })).toBeTruthy();
    expect((await itensAComprar()).getAllByRole('checkbox')).toHaveLength(2);
    // Nada foi escrito na planilha: só a vista mudou.
    expect(JSON.stringify(planilhas.linhas(PLANILHA))).toBe(antes);
    expect(planilhas.linhas(PLANILHA)).toHaveLength(4);
    expect(planilhas.pedidos.slice(pedidosAntes).filter((p) => p.acao !== 'lerLinhas')).toEqual([]);
  });

  it('Mostrar comprados traz os ocultos de volta, e Ocultar os esconde de novo', async () => {
    await pastaDeCompras();
    comItens();
    mostrar(HASH);
    await itensAComprar();
    fireEvent.click(principal().getByRole('button', { name: 'Limpar comprados' }));
    await waitFor(() => expect(comprados()).toBeNull());

    fireEvent.click(principal().getByRole('button', { name: /Mostrar comprados/ }));
    expect(within(comprados()!).getAllByRole('checkbox')).toHaveLength(2);

    fireEvent.click(principal().getByRole('button', { name: /Ocultar comprados/ }));
    await waitFor(() => expect(comprados()).toBeNull());
  });

  it('os comprados limpos continuam ocultos ao abrir de novo a pasta', async () => {
    await pastaDeCompras();
    comItens();
    const { unmount } = mostrar(HASH);
    await itensAComprar();
    fireEvent.click(principal().getByRole('button', { name: 'Limpar comprados' }));
    await waitFor(() => expect(comprados()).toBeNull());
    unmount();

    mostrar(HASH);
    await itensAComprar();
    expect(comprados()).toBeNull();
    expect(principal().getByRole('button', { name: /Mostrar comprados/ })).toBeTruthy();
  });

  it('item oculto que volta a "a comprar" (desmarcado em outro aparelho) reaparece', async () => {
    await pastaDeCompras();
    comItens();
    const { unmount } = mostrar(HASH);
    await itensAComprar();
    fireEvent.click(principal().getByRole('button', { name: 'Limpar comprados' }));
    await waitFor(() => expect(comprados()).toBeNull());
    unmount();

    planilhas.planilha(PLANILHA, [compra('Leite'), compra('Pão'), compra('Ovos'), compra('Café', { 'Comprado?': 'sim' })], CABECALHO_COMPRAS);
    mostrar(HASH);

    expect((await itensAComprar()).getByRole('checkbox', { name: 'Ovos' })).toBeTruthy();
  });

  it('sem comprados não há "Limpar comprados"', async () => {
    await pastaDeCompras();
    planilhas.planilha(PLANILHA, [compra('Leite')], CABECALHO_COMPRAS);
    mostrar(HASH);
    await itensAComprar();

    expect(principal().queryByRole('button', { name: 'Limpar comprados' })).toBeNull();
  });
});

describe('novo item', () => {
  it('adicionar item anexa linha com Quem pôs e Data', async () => {
    await pastaDeCompras();
    comItens();
    mostrar(HASH);
    await itensAComprar();

    await pôr('Manteiga', '3');

    expect(await principal().findByText('Item guardado')).toBeTruthy();
    const linhas = planilhas.linhas(PLANILHA);
    expect(linhas).toHaveLength(5);
    expect(linhas[4]!.valores).toMatchObject({ Item: 'Manteiga', Quantidade: '3', 'Quem pôs': 'Central', Data: '2026-11-05' });
    await waitFor(async () => expect((await itensAComprar()).getByRole('checkbox', { name: 'Manteiga' })).toBeTruthy());
    // O formulário volta limpo.
    const formulario = within(principal().getByRole('form', { name: 'Novo item' }));
    expect((formulario.getByLabelText('Item') as HTMLInputElement).value).toBe('');

    // Desfazer: a linha continua na planilha, marcada "desfeito", e some da tela.
    fireEvent.click(principal().getByRole('button', { name: 'Desfazer' }));
    expect(await principal().findByText('Item desfeito')).toBeTruthy();
    expect(planilhas.linhas(PLANILHA)).toHaveLength(5);
    expect(planilhas.linhas(PLANILHA)[4]!.valores['Observação']).toBe('desfeito');
    await waitFor(async () => expect((await itensAComprar()).queryByRole('checkbox', { name: 'Manteiga' })).toBeNull());
  });

  it('item vazio não grava e explica', async () => {
    await pastaDeCompras();
    comItens();
    mostrar(HASH);
    await itensAComprar();

    await pôr('   ');

    expect(await principal().findByText(/Escreva o que comprar/)).toBeTruthy();
    expect(anexos()).toEqual([]);
  });

  it('item comprido demais não grava e explica', async () => {
    await pastaDeCompras();
    comItens();
    mostrar(HASH);
    await itensAComprar();

    await pôr('x'.repeat(81));

    expect(await principal().findByText(/no máximo 80 caracteres/)).toBeTruthy();
    expect(anexos()).toEqual([]);
  });

  it('toque duplo em "Pôr na lista" não duplica a linha', async () => {
    await pastaDeCompras();
    comItens();
    mostrar(HASH);
    await itensAComprar();
    const formulario = within(await principal().findByRole('form', { name: 'Novo item' }));
    fireEvent.input(formulario.getByLabelText('Item'), { target: { value: 'Manteiga' } });

    const botao = formulario.getByRole('button', { name: 'Pôr na lista' });
    fireEvent.click(botao);
    fireEvent.click(botao);
    fireEvent.submit(formulario.getByLabelText('Item').closest('form')!);

    await principal().findByText('Item guardado');
    await waitFor(() => expect(anexos()).toHaveLength(1));
    expect(planilhas.linhas(PLANILHA).filter((l) => l.valores['Item'] === 'Manteiga')).toHaveLength(1);
  });

  it('item duplicado pergunta antes de repetir (aviso no cartão)', async () => {
    await pastaDeCompras();
    comItens();
    mostrar(HASH);
    await itensAComprar();

    await pôr('leite');

    expect(await principal().findByText('Já está na lista')).toBeTruthy();
    expect(principal().getByText(/“leite” já está na lista/)).toBeTruthy();
    expect(anexos()).toEqual([]);
    expect(planilhas.linhas(PLANILHA)).toHaveLength(4);

    fireEvent.click(principal().getByRole('button', { name: 'Pôr mesmo assim' }));

    expect(await principal().findByText('Item guardado')).toBeTruthy();
    expect(planilhas.linhas(PLANILHA)).toHaveLength(5);
    expect(planilhas.linhas(PLANILHA)[4]!.valores['Item']).toBe('leite');
    expect(principal().queryByRole('button', { name: 'Pôr mesmo assim' })).toBeNull();
  });

  it('item igual a um já comprado entra normalmente (compra de novo)', async () => {
    await pastaDeCompras();
    comItens();
    mostrar(HASH);
    await itensAComprar();

    await pôr('ovos');

    expect(await principal().findByText('Item guardado')).toBeTruthy();
    expect(planilhas.linhas(PLANILHA)).toHaveLength(5);
  });

  it('o foco vai para o cartão a cada ação, mesmo com o mesmo título', async () => {
    await pastaDeCompras();
    comItens();
    mostrar(HASH);
    await itensAComprar();

    await pôr('Manteiga');
    await waitFor(() => expect(document.activeElement?.classList.contains('pastas-cartao')).toBe(true));
    (document.activeElement as HTMLElement).blur();
    await pôr('Biscoito');

    await waitFor(() => expect(planilhas.linhas(PLANILHA)).toHaveLength(6));
    await waitFor(() => expect(document.activeElement?.classList.contains('pastas-cartao')).toBe(true));
  });

  it('Desfazer que falha mostra o erro, não diz "desfeito" e pode ser tentado de novo', async () => {
    await pastaDeCompras();
    comItens();
    mostrar(HASH);
    await itensAComprar();
    await pôr('Manteiga');
    await principal().findByText('Item guardado');
    await waitFor(async () => expect((await itensAComprar()).getByRole('checkbox', { name: 'Manteiga' })).toBeTruthy());

    planilhas.falharAProxima();
    fireEvent.click(principal().getByRole('button', { name: 'Desfazer' }));
    expect(await principal().findByText(/Não consegui desfazer agora/)).toBeTruthy();
    expect(principal().queryByText('Item desfeito')).toBeNull();

    fireEvent.click(principal().getByRole('button', { name: 'Desfazer' }));
    expect(await principal().findByText('Item desfeito')).toBeTruthy();
    expect(planilhas.linhas(PLANILHA)[4]!.valores['Observação']).toBe('desfeito');
  });

  it('planilha que mudou (falta coluna) avisa e não grava', async () => {
    await pastaDeCompras();
    planilhas.planilha(PLANILHA, [compra('Leite')], ['Item', 'Quantidade', 'Observação', 'id']); // sem "Quem pôs" nem "Data"
    mostrar(HASH);

    expect(await principal().findByText(/A planilha mudou/)).toBeTruthy();
    await pôr('Manteiga');

    expect(await principal().findByText(/Nada foi gravado/)).toBeTruthy();
    expect(planilhas.linhas(PLANILHA)).toHaveLength(1);
  });
});

describe('sem rede, planilha mexida à mão e texto de terceiros', () => {
  it('offline mostra nota "salva ao voltar a rede"', async () => {
    await pastaDeCompras();
    comItens();
    mostrar(HASH);
    await itensAComprar();
    planilhas.cair();

    await pôr('Manteiga');

    expect(await principal().findByText(/Sem internet: salva ao voltar a rede/)).toBeTruthy();
    expect(planilhas.linhas(PLANILHA)).toHaveLength(4);
    // O item já aparece, marcado como esperando a rede.
    const aComprar = await itensAComprar();
    await waitFor(() => expect(aComprar.getByRole('checkbox', { name: 'Manteiga' })).toBeTruthy());
    expect(aComprar.getByText(/Salva ao voltar a rede/)).toBeTruthy();
  });

  it('marcar comprado sem rede vale na tela e avisa que salva ao voltar a rede', async () => {
    await pastaDeCompras();
    comItens();
    mostrar(HASH);
    const aComprar = await itensAComprar();
    planilhas.cair();

    fireEvent.click(aComprar.getByRole('checkbox', { name: 'Pão' }));

    await waitFor(() => expect(within(comprados()!).getByRole('checkbox', { name: 'Pão' })).toHaveProperty('checked', true));
    expect(await principal().findByText(/Sem internet: salva ao voltar a rede/)).toBeTruthy();
    expect(planilhas.linhas(PLANILHA)[1]!.valores['Comprado?']).toBe('');
  });

  it('abrir sem rede mostra o que o aparelho guardou e avisa', async () => {
    await pastaDeCompras();
    comItens();
    const { unmount } = mostrar(HASH);
    await itensAComprar();
    unmount();

    planilhas.cair();
    mostrar(HASH);

    expect(await principal().findByText(/Sem internet: mostrando o que este aparelho guardou/)).toBeTruthy();
    expect((await itensAComprar()).getAllByRole('checkbox')).toHaveLength(2);
  });

  it('item apagado da planilha à mão: marcar avisa e a lista é relida', async () => {
    await pastaDeCompras();
    comItens();
    mostrar(HASH);
    const aComprar = await itensAComprar();
    planilhas.planilha(PLANILHA, [], CABECALHO_COMPRAS); // alguém apagou as linhas à mão

    fireEvent.click(aComprar.getByRole('checkbox', { name: 'Leite' }));

    expect(await principal().findByText(/não está mais na planilha/)).toBeTruthy();
    expect(await principal().findByText(/A lista está vazia/)).toBeTruthy();
  });

  it('marcar com a planilha mudada (falta coluna) não grava, desfaz a marca e explica', async () => {
    await pastaDeCompras();
    comItens();
    mostrar(HASH);
    const aComprar = await itensAComprar();
    planilhas.mudarCabecalho(PLANILHA, ['Item', 'Quantidade', 'Quem pôs', 'Data', 'Observação', 'id']); // sem "Comprado?"

    fireEvent.click(aComprar.getByRole('checkbox', { name: 'Leite' }));

    expect(await principal().findByText(/A planilha mudou/)).toBeTruthy();
    expect(planilhas.linhas(PLANILHA)[0]!.valores['Comprado?']).toBe('');
    expect((await itensAComprar()).getByRole('checkbox', { name: 'Leite' })).toHaveProperty('checked', false);
  });

  it('marcar que falha por erro inesperado volta a caixa e diz para tentar de novo', async () => {
    await pastaDeCompras();
    comItens();
    mostrar(HASH);
    const aComprar = await itensAComprar();

    planilhas.falharAProxima();
    fireEvent.click(aComprar.getByRole('checkbox', { name: 'Leite' }));

    expect(await principal().findByText(/Não consegui marcar/)).toBeTruthy();
    expect((await itensAComprar()).getByRole('checkbox', { name: 'Leite' })).toHaveProperty('checked', false);
  });

  it('nunca usa HTML de dentro da planilha: o texto da planilha aparece como texto', async () => {
    await pastaDeCompras();
    planilhas.planilha(PLANILHA, [compra('<img src=x onerror=alert(1)>', { 'Quem pôs': '<b>Marina</b>' })], CABECALHO_COMPRAS);
    mostrar(HASH);

    const aComprar = await itensAComprar();
    expect(aComprar.getByRole('checkbox', { name: '<img src=x onerror=alert(1)>' })).toBeTruthy();
    expect(document.querySelector('main img')).toBeNull();
    expect(document.querySelector('main b')).toBeNull();
  });

  it('pasta sem planilha explica e não tenta ler', async () => {
    await pastaDeCompras({ planilhaId: undefined });
    mostrar(HASH);

    expect(await principal().findByText(/ainda não tem planilha/)).toBeTruthy();
    expect(principal().queryByRole('form', { name: 'Novo item' })).toBeNull();
    expect(planilhas.pedidos).toEqual([]);
  });
});

describe('Abrir planilha e o celular', () => {
  it('botão Abrir planilha mostra link no computador (mesmo com janela estreita) e não no celular', async () => {
    await pastaDeCompras();
    comItens();
    comoComputador();
    const { unmount } = mostrar(HASH, 1280);
    await itensAComprar();
    const link = principal().getByRole('link', { name: /Abrir no Google Planilhas/ });
    expect(link.getAttribute('href')).toBe(`https://docs.google.com/spreadsheets/d/${PLANILHA}`);
    unmount();

    const { unmount: fechar } = mostrar(HASH, 375); // computador com zoom: o link continua
    await itensAComprar();
    expect(principal().getByRole('link', { name: /Abrir no Google Planilhas/ })).toBeTruthy();
    fechar();

    comoCelular();
    mostrar(HASH, 375);
    await itensAComprar();
    expect(principal().queryByRole('link', { name: /Google Planilhas/ })).toBeNull();
  });

  it('no celular a lista e o formulário funcionam', async () => {
    await pastaDeCompras();
    comItens();
    comoCelular();
    mostrar(HASH, 375);
    const aComprar = await itensAComprar();

    fireEvent.click(aComprar.getByRole('checkbox', { name: 'Pão' }));
    await waitFor(() => expect(planilhas.linhas(PLANILHA)[1]!.valores['Comprado?']).toBe('TRUE'));
    await pôr('Manteiga');
    expect(await principal().findByText('Item guardado')).toBeTruthy();
  });
});

describe('Pode falar dentro da pasta', () => {
  it('"leite e pão" dito (ou escrito) dentro da pasta vai direto para ela', async () => {
    await pastaDeCompras();
    planilhas.planilha(PLANILHA, [compra('Café')], CABECALHO_COMPRAS);
    mostrar(HASH);
    await itensAComprar();

    act(() => abrirPodeFalar());
    fireEvent.input(await screen.findByRole('textbox', { name: 'Texto falado' }), { target: { value: 'leite e pão' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pronto' }));

    expect(await screen.findByText('2 itens guardados')).toBeTruthy();
    expect(planilhas.linhas(PLANILHA).map((l) => l.valores['Item'])).toEqual(['Café', 'leite', 'pão']);
  });

  it('o cartão do Pode falar tem "Pôr mesmo assim" para o item repetido', async () => {
    await pastaDeCompras();
    planilhas.planilha(PLANILHA, [compra('Café')], CABECALHO_COMPRAS);
    mostrar(HASH);
    await itensAComprar();

    act(() => abrirPodeFalar());
    fireEvent.input(await screen.findByRole('textbox', { name: 'Texto falado' }), { target: { value: 'café' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pronto' }));

    expect(await screen.findByText('Já está na lista')).toBeTruthy();
    expect(planilhas.linhas(PLANILHA)).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Pôr mesmo assim' }));

    expect(await screen.findByText('Item guardado')).toBeTruthy();
    expect(planilhas.linhas(PLANILHA)).toHaveLength(2);
  });
});

describe('correções da revisão da Tarefa 14', () => {
  it('ao marcar, o foco continua no mesmo item, que mudou de lista', async () => {
    await pastaDeCompras();
    comItens();
    mostrar(HASH);
    const aComprar = await itensAComprar();
    const caixa = aComprar.getByRole('checkbox', { name: 'Leite' });
    caixa.focus();

    fireEvent.click(caixa);

    await waitFor(() => {
      const ativo = document.activeElement as HTMLInputElement;
      expect(ativo.type).toBe('checkbox');
      expect(ativo.closest('li')?.textContent).toContain('Leite');
      expect(ativo.closest('ul')?.getAttribute('aria-label')).toBe('Itens comprados');
    });
    // E ao desmarcar, volta para a lista "a comprar".
    await waitFor(() => expect(planilhas.linhas(PLANILHA)[0]!.valores['Comprado?']).toBe('TRUE'));
    fireEvent.click(document.activeElement as HTMLInputElement);
    await waitFor(() => expect((document.activeElement as HTMLElement).closest('ul')?.getAttribute('aria-label')).toBe('Itens a comprar'));
  });

  it('planilha sem a coluna "Comprado?" avisa ao abrir', async () => {
    await pastaDeCompras();
    planilhas.planilha(PLANILHA, [compra('Leite')], ['Item', 'Quantidade', 'Quem pôs', 'Data', 'Observação', 'id']);
    mostrar(HASH);

    expect(await principal().findByText(/A planilha mudou: falta uma coluna/)).toBeTruthy();
  });

  it('o cartão "Já está na lista" não tem Desfazer, nem na tela nem no Pode falar', async () => {
    await pastaDeCompras();
    planilhas.planilha(PLANILHA, [compra('Café')], CABECALHO_COMPRAS);
    mostrar(HASH);
    await itensAComprar();
    await pôr('café');
    expect(await principal().findByText('Já está na lista')).toBeTruthy();
    expect(principal().queryByRole('button', { name: 'Desfazer' })).toBeNull();
    fireEvent.click(principal().getByRole('button', { name: 'Fechar' }));

    act(() => abrirPodeFalar());
    fireEvent.input(await screen.findByRole('textbox', { name: 'Texto falado' }), { target: { value: 'café' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pronto' }));
    expect(await screen.findByText('Já está na lista')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Desfazer' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Pôr mesmo assim' })).toBeTruthy();
  });

  it('o artigo do começo não é gravado na planilha', async () => {
    await pastaDeCompras();
    planilhas.planilha(PLANILHA, [], CABECALHO_COMPRAS);
    mostrar(HASH);

    await pôr('o leite integral');

    expect(await principal().findByText('Item guardado')).toBeTruthy();
    expect(planilhas.linhas(PLANILHA)[0]!.valores['Item']).toBe('leite integral');
  });
});

// ---- Acessibilidade (Tarefa 19, correções): foco, região viva ----

describe('acessibilidade da Lista', () => {
  it('Fechar o cartão leva o foco ao campo Item (nunca ao body)', async () => {
    await pastaDeCompras();
    comItens();
    mostrar(HASH);
    await itensAComprar();
    await pôr('Manteiga');
    const cartao = await principal().findByRole('article');
    await waitFor(() => expect(document.activeElement).toBe(cartao));
    fireEvent.click(within(cartao).getByRole('button', { name: 'Fechar' }));

    expect(principal().queryByRole('article')).toBeNull();
    expect(document.activeElement).toBe(within(principal().getByRole('form', { name: 'Novo item' })).getByLabelText('Item'));
  });

  it('o cartão não fica numa região viva, tem nome e descrição, e nenhuma região viva tem botão', async () => {
    await pastaDeCompras();
    comItens();
    mostrar(HASH);
    await itensAComprar();
    await pôr('Manteiga');
    const cartao = await principal().findByRole('article');

    expect(cartao.closest('[role="status"], [aria-live]')).toBeNull();
    expect(cartao.getAttribute('aria-labelledby')).toBeTruthy();
    expect(cartao.getAttribute('aria-describedby')).toBeTruthy();
    for (const regiao of document.querySelectorAll('main [role="status"], main [aria-live]')) expect(regiao.querySelector('button, a[href]')).toBeNull();
  });

  it('Limpar comprados passa o foco ao botão Mostrar comprados, que vira Ocultar no mesmo lugar (aria-expanded)', async () => {
    await pastaDeCompras();
    comItens();
    mostrar(HASH);
    await itensAComprar();

    const limpar = principal().getByRole('button', { name: 'Limpar comprados' });
    limpar.focus();
    fireEvent.click(limpar);

    const alternar = await principal().findByRole('button', { name: /Mostrar comprados \(2\)/ });
    expect(alternar.getAttribute('aria-expanded')).toBe('false');
    await waitFor(() => expect(document.activeElement).toBe(alternar));

    fireEvent.click(alternar);
    await waitFor(() => expect(alternar.textContent).toBe('Ocultar comprados'));
    expect(alternar.isConnected).toBe(true);
    expect(alternar.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(alternar);

    fireEvent.click(alternar);
    await waitFor(() => expect(alternar.textContent).toBe('Mostrar comprados (2)'));
    expect(document.activeElement).toBe(alternar);
  });

  it('os avisos de rede moram numa região viva que nasce vazia', async () => {
    await pastaDeCompras();
    comItens();
    const { unmount } = mostrar(HASH);
    await itensAComprar();
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
    mostrar(HASH);
    await itensAComprar();
    olho.disconnect();

    const regiao = document.querySelector<HTMLElement>('main .aviso-vivo');
    expect(regiao?.getAttribute('role')).toBe('status');
    expect(nasceuCom).toBe('');
    expect(regiao?.textContent).toMatch(/Sem internet: mostrando o que este aparelho guardou/);
  });
});
