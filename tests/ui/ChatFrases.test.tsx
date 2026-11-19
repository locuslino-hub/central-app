// As frases reais do dono, todas no chat (V02.1): o que cada uma vira e que o resultado aparece no chat. Nomes fictícios
// (Marina, Renata, Prof. Souza, Aurora). Quinta-feira, 2026-11-05, 12:20. As planilhas são de mentira
// (tests/apoio/planilhas-falsas.ts); o resto é o código de verdade.
import { configure, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { limparConversa } from '../../src/chat/conversa';
import { listar, salvar, semear, semearPalavras } from '../../src/dados/loja';
import { Chat } from '../../src/ui/Chat';
import { comoCelular, comoComputador } from '../apoio/aparelho';
import { agendaEscrita } from '../apoio/agenda-escrita';
import { CABECALHO_COMPRAS, CABECALHO_CONSUMO, CABECALHO_FINANCEIRO, falsoDasPlanilhas, reiniciarPlanilhas } from '../apoio/planilhas-falsas';

vi.mock('../../src/dados/planilhas', async (importar) => (await import('../apoio/planilhas-falsas')).comPlanilhasFalsas(await importar<typeof import('../../src/dados/planilhas')>()));

configure({ asyncUtilTimeout: 5000 });

const planilhas = falsoDasPlanilhas();
const COMPRAS = 'planilha-ficticia-compras';
const AGUA = 'planilha-ficticia-agua';
const FINANCEIRO = 'planilha-ficticia-financeiro';

beforeEach(async () => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 5, 12, 20));
  history.replaceState(null, '', '/#/chat');
  limparConversa();
  reiniciarPlanilhas();
  await semear();
  await semearPalavras();
});

const pastaDeLista = () =>
  salvar('pastas', { id: 'pasta-compras', salaId: 'sala-casa', tipo: 'lista', nome: 'Compras', ordem: 1, modelo: 'compras', planilhaId: COMPRAS });
const pastaDeAgua = () =>
  salvar('pastas', { id: 'pasta-agua', salaId: 'sala-casa', tipo: 'registro', nome: 'Consumo de Água', ordem: 2, modelo: 'consumo', servico: 'agua', unidade: 'm³', planilhaId: AGUA });
const pastaFinanceiro = () =>
  salvar('pastas', { id: 'pasta-financeiro', salaId: 'sala-casa', tipo: 'planilha', nome: 'Financeiro', ordem: 3, modelo: 'financeiro', planilhaId: FINANCEIRO });

function dizer(frase: string) {
  fireEvent.input(screen.getByRole('textbox', { name: 'Escreva ou dite' }), { target: { value: frase } });
  fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
}

/** O último cartão (artigo) da conversa, depois que a resposta chegou. */
async function ultimoCartao(): Promise<ReturnType<typeof within>> {
  await waitFor(() => expect(screen.getAllByRole('article').length).toBeGreaterThan(0));
  const cartoes = screen.getAllByRole('article');
  return within(cartoes[cartoes.length - 1]!);
}

describe('as frases do dono no chat: tarefas e compromissos (o chat de sempre)', () => {
  it('"Adicione em atividades do dia mandar mensagem para Marina": tarefa de hoje', async () => {
    render(<Chat />);
    dizer('Adicione em atividades do dia mandar mensagem para Marina');
    const cartao = await ultimoCartao();
    expect(cartao.getByText('Mandar mensagem para Marina')).toBeTruthy();
    expect(cartao.getByText('Hoje')).toBeTruthy();
    await waitFor(async () => expect(await listar('tarefas')).toHaveLength(1));
    expect(await listar('ideias')).toEqual([]);
  });

  it('"Adicione reunião sobre o projeto na sexta feira com inicio às 11:00 e termino 12:00": compromisso na Agenda', async () => {
    const agenda = agendaEscrita();
    await agenda.instalar();
    render(<Chat />);
    dizer('Adicione reunião sobre o projeto na sexta feira com inicio às 11:00 e termino 12:00');
    const cartao = await ultimoCartao();
    expect(cartao.getByText('Compromisso')).toBeTruthy();
    await waitFor(() => expect(agenda.eventos.size).toBe(1));
    expect(await listar('tarefas')).toEqual([]);
  });

  it('"Adicione Revisar paragrafo do relatório 1 nas tarefas do doutoramento": tarefa na sala Doutoramento', async () => {
    render(<Chat />);
    dizer('Adicione Revisar paragrafo do relatório 1 nas tarefas do doutoramento');
    const cartao = await ultimoCartao();
    expect(cartao.getByText('Doutoramento')).toBeTruthy();
    await waitFor(async () => expect((await listar('tarefas'))[0]).toMatchObject({ salaId: 'sala-doutoramento' }));
  });

  it('"Preciso parafusar o apoio do banheiro": tarefa na sala Casa, com Guardar como ideia no cartão', async () => {
    render(<Chat />);
    dizer('Preciso parafusar o apoio do banheiro');
    const cartao = await ultimoCartao();
    expect(cartao.getByText('Casa')).toBeTruthy();
    expect(await cartao.findByRole('button', { name: 'Guardar como ideia' })).toBeTruthy();
    expect(cartao.getByRole('button', { name: 'Trocar sala' })).toBeTruthy();
    expect(cartao.getByRole('button', { name: 'Desfazer' })).toBeTruthy();
    expect(await listar('ideias')).toEqual([]);
  });

  it('frase solta, sem sala, dia nem hora, é tarefa de hoje (não ideia), com Trocar sala e Guardar como ideia', async () => {
    render(<Chat />);
    dizer('Usar o artigo do Prof. Souza no capítulo 2');
    const cartao = await ultimoCartao();
    expect(cartao.getByText('Hoje')).toBeTruthy();
    expect(await cartao.findByRole('button', { name: 'Guardar como ideia' })).toBeTruthy();
    expect(await listar('ideias')).toEqual([]);
    await waitFor(async () => expect(await listar('tarefas')).toHaveLength(1));
  });

  it('"comprar leite amanhã": tarefa, mesmo com a lista de compras à mão', async () => {
    await pastaDeLista();
    planilhas.planilha(COMPRAS, [], CABECALHO_COMPRAS);
    render(<Chat />);
    dizer('comprar leite amanhã');
    const cartao = await ultimoCartao();
    expect(cartao.getByText('Comprar leite')).toBeTruthy();
    await waitFor(async () => expect(await listar('tarefas')).toHaveLength(1));
    expect(planilhas.pedidos).toEqual([]);
  });
});

describe('as frases do dono no chat: listas', () => {
  it.each([
    'Coloca na lista de compra comprar pão de forma comprar café comprar beterraba',
    'eu preciso comprar pão de forma, comprar café e beterraba',
  ])('"%s": três itens na lista de compras, com cartão', async (frase) => {
    await pastaDeLista();
    planilhas.planilha(COMPRAS, [], CABECALHO_COMPRAS);
    render(<Chat />);

    dizer(frase);

    const cartao = await ultimoCartao();
    expect(await cartao.findByText('3 itens guardados')).toBeTruthy();
    expect(cartao.getByText(/“pão de forma”/)).toBeTruthy();
    expect(cartao.getByRole('button', { name: 'Desfazer' })).toBeTruthy();
    expect(cartao.getByRole('button', { name: 'Guardar como ideia' })).toBeTruthy();
    expect(cartao.getByRole('link', { name: 'Ver' }).getAttribute('href')).toBe('#/sala/sala-casa/pasta/pasta-compras');
    expect(planilhas.linhas(COMPRAS).map((l) => l.valores['Item'])).toEqual(['pão de forma', 'café', 'beterraba']);
    expect(await listar('tarefas')).toEqual([]);
    expect(await listar('ideias')).toEqual([]);
  });

  it('"Comprar pão" sem pasta de Lista com planilha: tarefa "Comprar pão" (não ideia), sem nota de lista', async () => {
    render(<Chat />);
    dizer('Comprar pão');
    const cartao = await ultimoCartao();
    expect(cartao.getByText('Comprar pão')).toBeTruthy();
    expect(cartao.queryByText(/Não achei a lista/)).toBeNull();
    await waitFor(async () => expect(await listar('tarefas')).toHaveLength(1));
    expect(await listar('ideias')).toEqual([]);
  });

  it('"Comprar pão" com pasta de Lista: item da lista', async () => {
    await pastaDeLista();
    planilhas.planilha(COMPRAS, [], CABECALHO_COMPRAS);
    render(<Chat />);
    dizer('Comprar pão');
    expect(await (await ultimoCartao()).findByText('Item guardado')).toBeTruthy();
    expect(await listar('tarefas')).toEqual([]);
  });

  it('pedido de lista sem a pasta: tarefa, e o cartão explica por que a lista não recebeu', async () => {
    render(<Chat />);
    dizer('põe leite e pão nas compras da semana');
    const cartao = await ultimoCartao();
    expect(cartao.getByText(/Não achei a lista de compras da semana/)).toBeTruthy();
    expect(await listar('ideias')).toEqual([]);
  });
});

describe('as frases do dono no chat: leitura, gasto e ideia', () => {
  it('"leitura da água 1234": registro na pasta de Consumo', async () => {
    await pastaDeAgua();
    planilhas.planilha(AGUA, [], CABECALHO_CONSUMO);
    render(<Chat />);

    dizer('leitura da água 1234');

    const cartao = await ultimoCartao();
    expect(await cartao.findByText('Leitura guardada')).toBeTruthy();
    expect(cartao.getByRole('button', { name: 'Guardar como ideia' })).toBeTruthy();
    expect(planilhas.linhas(AGUA)[0]!.valores).toMatchObject({ Leitura: '1234', Unidade: 'm³', Data: '2026-11-05' });
  });

  it('"ideia: app de receitas": vai para Ideias, sem Guardar como ideia', async () => {
    render(<Chat />);
    dizer('ideia: app de receitas');
    const cartao = await ultimoCartao();
    expect(cartao.getByText('Guardado em Ideias')).toBeTruthy();
    expect(cartao.getByText(/app de receitas/)).toBeTruthy();
    expect(cartao.queryByRole('button', { name: 'Guardar como ideia' })).toBeNull();
    expect((await listar('ideias')).map((i) => i.texto)).toEqual(['app de receitas']);
    expect(await listar('tarefas')).toEqual([]);
  });

  describe.each([
    ['no computador', 1280, comoComputador],
    ['no celular', 390, comoCelular],
  ])('"gastei 5,50 no mercado" %s', (_onde, largura, aparelho) => {
    it('grava o gasto no Financeiro, com Trocar categoria, e fica no chat', async () => {
      aparelho();
      await pastaFinanceiro();
      planilhas.planilha(
        FINANCEIRO,
        [{ Data: '2026-11-01', Descrição: 'Cinema', Categoria: 'Lazer', Tipo: 'Débito', Valor: '18,50', Quem: 'Renata', Observação: '' }],
        CABECALHO_FINANCEIRO,
      );
      Object.defineProperty(window, 'innerWidth', { value: largura, configurable: true, writable: true });
      history.replaceState(null, '', '/#/chat');
      render(<App />);
      const principal = within(screen.getByRole('main'));

      dizer('gastei 5,50 no mercado');

      const cartao = within(await principal.findByRole('article'));
      expect(await cartao.findByText('Gasto guardado')).toBeTruthy();
      expect(cartao.getByText(/€ 5,50 · Alimentação · Débito/)).toBeTruthy();
      expect(cartao.getByRole('button', { name: 'Trocar categoria' })).toBeTruthy();
      expect(cartao.getByRole('button', { name: 'Desfazer' })).toBeTruthy();
      expect(planilhas.linhas(FINANCEIRO)[1]!.valores).toMatchObject({ Descrição: 'mercado', Valor: '5.5' });
      expect(location.hash).toBe('#/chat'); // o resultado fica no chat
    });
  });
});
