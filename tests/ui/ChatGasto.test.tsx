// O cartão do gasto no chat (V02, Tarefa 16; no chat desde a V02.1): "Trocar categoria", Desfazer e Guardar como ideia.
// Quinta-feira, 2026-11-05, 12:20 em Lisboa. A planilha é de mentira (tests/apoio/planilhas-falsas.ts). Valores fictícios.
import { act, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { limparConversa } from '../../src/chat/conversa';
import { listar, salvar, semear, semearPalavras } from '../../src/dados/loja';
import { escreverNoChatDoPainel } from '../apoio/chat-do-painel';
import { CABECALHO_FINANCEIRO, falsoDasPlanilhas, reiniciarPlanilhas } from '../apoio/planilhas-falsas';

vi.mock('../../src/dados/planilhas', async (importar) => (await import('../apoio/planilhas-falsas')).comPlanilhasFalsas(await importar<typeof import('../../src/dados/planilhas')>()));

configure({ asyncUtilTimeout: 5000 });

const planilhas = falsoDasPlanilhas();
const PLANILHA = 'planilha-ficticia-financeiro';

beforeEach(async () => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-11-05T12:20:00Z'));
  limparConversa();
  reiniciarPlanilhas();
  await semear();
  await semearPalavras();
  await salvar('pastas', { id: 'pasta-financeiro', salaId: 'sala-casa', tipo: 'planilha', nome: 'Financeiro', ordem: 6, modelo: 'financeiro', planilhaId: PLANILHA });
  planilhas.planilha(
    PLANILHA,
    [
      { Data: '2026-11-01', Descrição: 'Mercado', Categoria: 'Alimentação', Tipo: 'Débito', Valor: '42,30', Quem: 'Marina', Observação: '' },
      { Data: '2026-11-02', Descrição: 'Cinema', Categoria: 'Lazer', Tipo: 'Débito', Valor: '18,50', Quem: 'Renata', Observação: '' },
    ],
    CABECALHO_FINANCEIRO,
  );
});

function abrirComFrase(frase: string, hash = '#/') {
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true, writable: true });
  history.replaceState(null, '', `/${hash}`);
  render(<App />);
  return (async () => {
    const painel = escreverNoChatDoPainel(frase);
    return within(await within(painel).findByRole('article'));
  })();
}

const linhas = () => planilhas.linhas(PLANILHA);

describe('cartão do gasto no chat', () => {
  it('mostra € 5,50 · categoria · Tipo e os botões Desfazer, Trocar categoria e Guardar como ideia', async () => {
    const cartao = await abrirComFrase('gastei 5,50 hoje comprando salgado');

    expect(cartao.getByText('Gasto guardado')).toBeTruthy();
    expect(cartao.getByText(/€ 5,50 · Alimentação · Débito/)).toBeTruthy();
    expect(cartao.getByRole('button', { name: 'Desfazer' })).toBeTruthy();
    expect(cartao.getByRole('button', { name: 'Trocar categoria' })).toBeTruthy();
    expect(cartao.getByRole('button', { name: 'Guardar como ideia' })).toBeTruthy();
    expect(cartao.getByRole('link', { name: 'Ver' }).getAttribute('href')).toBe('#/sala/sala-casa/pasta/pasta-financeiro');
    expect(linhas()).toHaveLength(3);
  });

  it('Trocar categoria: escolhe uma das em uso e a linha da planilha e o cartão mudam', async () => {
    const cartao = await abrirComFrase('gastei 5,50 hoje comprando salgado');

    fireEvent.click(cartao.getByRole('button', { name: 'Trocar categoria' }));
    const troca = within(await screen.findByRole('group', { name: 'Trocar categoria' }));
    expect(troca.getByRole('button', { name: 'Alimentação' }).getAttribute('aria-pressed')).toBe('true');
    expect(troca.getByRole('button', { name: 'Lazer' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(troca.getByRole('button', { name: 'Lazer' }));

    await waitFor(() => expect(linhas()[2]!.valores['Categoria']).toBe('Lazer'));
    expect(await screen.findByText(/€ 5,50 · Lazer · Débito/)).toBeTruthy();
    // O painel fecha e o foco volta para o cartão.
    expect(screen.queryByRole('group', { name: 'Trocar categoria' })).toBeNull();
    await waitFor(() => expect((document.activeElement as HTMLElement).tagName).toBe('ARTICLE'));
  });

  it('Trocar categoria: digita outra e usa a grafia que a planilha já tem', async () => {
    const cartao = await abrirComFrase('gastei 5,50 hoje comprando salgado');

    fireEvent.click(cartao.getByRole('button', { name: 'Trocar categoria' }));
    const campo = await screen.findByRole('textbox', { name: 'Outra categoria' });
    expect(document.activeElement).toBe(campo);
    fireEvent.input(campo, { target: { value: ' lazer ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Trocar' }));

    await waitFor(() => expect(linhas()[2]!.valores['Categoria']).toBe('Lazer'));
    expect(await screen.findByText(/€ 5,50 · Lazer · Débito/)).toBeTruthy();
  });

  it('Trocar categoria: cartão com a escolhida ao vivo mostra a nova categoria como atual e pode trocar de novo', async () => {
    const cartao = await abrirComFrase('gastei 5,50 hoje comprando salgado');
    fireEvent.click(cartao.getByRole('button', { name: 'Trocar categoria' }));
    fireEvent.click(within(await screen.findByRole('group', { name: 'Trocar categoria' })).getByRole('button', { name: 'Lazer' }));
    await screen.findByText(/€ 5,50 · Lazer · Débito/);

    fireEvent.click(screen.getByRole('button', { name: 'Trocar categoria' }));
    fireEvent.input(await screen.findByRole('textbox', { name: 'Outra categoria' }), { target: { value: 'Mercado' } });
    fireEvent.click(screen.getByRole('button', { name: 'Trocar' }));

    await waitFor(() => expect(linhas()[2]!.valores['Categoria']).toBe('Mercado'));
    expect(await screen.findByText(/€ 5,50 · Mercado · Débito/)).toBeTruthy();
  });

  it('categoria vazia no campo não troca: avisa', async () => {
    const cartao = await abrirComFrase('gastei 5,50 hoje comprando salgado');
    fireEvent.click(cartao.getByRole('button', { name: 'Trocar categoria' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Trocar' }));

    const mensagem = await screen.findByText(/Escolha uma categoria/);
    expect(linhas()[2]!.valores['Categoria']).toBe('Alimentação');
    // A mensagem fica junto do campo e ligada a ele (e só a ele): aria-invalid, aria-describedby e o foco.
    const campo = screen.getByRole('textbox', { name: 'Outra categoria' });
    expect(mensagem.getAttribute('role')).toBe('alert');
    expect(mensagem.closest('form')).toBe(campo.closest('form'));
    expect(campo.getAttribute('aria-invalid')).toBe('true');
    expect(campo.getAttribute('aria-describedby')).toBe(mensagem.id);
    await waitFor(() => expect(document.activeElement).toBe(campo));

    fireEvent.input(campo, { target: { value: 'M' } });
    expect(campo.getAttribute('aria-invalid')).toBeNull();
    expect(screen.queryByText(/Escolha uma categoria/)).toBeNull();
  });

  it('linha que sumiu da planilha: o cartão avisa e a categoria continua como estava', async () => {
    const cartao = await abrirComFrase('gastei 5,50 hoje comprando salgado');
    planilhas.planilha(PLANILHA, [{ Data: '2026-11-01', Descrição: 'Mercado', Categoria: 'Alimentação', Tipo: 'Débito', Valor: '42,30', Quem: 'Marina', Observação: '' }], CABECALHO_FINANCEIRO);

    fireEvent.click(cartao.getByRole('button', { name: 'Trocar categoria' }));
    fireEvent.click(within(await screen.findByRole('group', { name: 'Trocar categoria' })).getByRole('button', { name: 'Lazer' }));

    expect(await screen.findByText(/não está mais na planilha/)).toBeTruthy();
    expect(screen.getByText(/€ 5,50 · Alimentação · Débito/)).toBeTruthy();
    // O painel continua aberto: dá para escolher de novo ou fechar.
    expect(screen.getByRole('group', { name: 'Trocar categoria' })).toBeTruthy();
  });

  it('Desfazer marca a linha "desfeito" e o cartão diz que nada ficou guardado', async () => {
    const cartao = await abrirComFrase('gastei 5,50 hoje comprando salgado');

    fireEvent.click(cartao.getByRole('button', { name: 'Desfazer' }));

    expect(await screen.findByText('Desfeito. Nada ficou guardado.')).toBeTruthy();
    expect(linhas()[2]!.valores['Observação']).toBe('desfeito');
    expect(screen.queryByRole('button', { name: 'Trocar categoria' })).toBeNull();
  });

  it('Guardar como ideia: a linha fica "desfeito" e a ideia guarda a frase', async () => {
    const cartao = await abrirComFrase('gastei 5,50 hoje comprando salgado');

    fireEvent.click(cartao.getByRole('button', { name: 'Guardar como ideia' }));

    expect(await screen.findByText('Guardado em Ideias')).toBeTruthy();
    expect(linhas()[2]!.valores['Observação']).toBe('desfeito');
    expect((await listar('ideias')).map((i) => i.texto)).toEqual(['gastei 5,50 hoje comprando salgado']);
  });

  it('sem pasta Financeiro a frase vira tarefa de hoje (não ideia), com a nota do porquê, e sem Trocar categoria', async () => {
    const { apagar } = await import('../../src/dados/loja');
    await apagar('pastas', 'pasta-financeiro');

    const cartao = await abrirComFrase('gastei 5,50 hoje comprando salgado');

    expect(cartao.getByText('Tarefa')).toBeTruthy();
    expect(cartao.getByText(/Não achei a pasta Financeiro/)).toBeTruthy();
    expect(cartao.queryByRole('button', { name: 'Trocar categoria' })).toBeNull();
    expect(await cartao.findByRole('button', { name: 'Guardar como ideia' })).toBeTruthy();
    expect(linhas()).toHaveLength(2);
    expect(await listar('ideias')).toEqual([]);
    await waitFor(async () => expect(await listar('tarefas')).toHaveLength(1));
  });

  it('o chat aberto dentro da pasta Financeiro grava nela', async () => {
    const cartao = await abrirComFrase('gastei 3 hoje no café', '#/sala/sala-casa/pasta/pasta-financeiro');

    expect(cartao.getByText('Gasto guardado')).toBeTruthy();
    expect(linhas()).toHaveLength(3);
  });
});

describe('a pasta aberta ao lado do chat se atualiza', () => {
  it('o gasto falado no chat aparece na tabela do Financeiro que está aberto, e o Desfazer o marca como desfeito', async () => {
    const cartao = await abrirComFrase('gastei 3 hoje no café', '#/sala/sala-casa/pasta/pasta-financeiro');
    const tabela = await screen.findByRole('table', { name: 'Gastos do mês' });

    await waitFor(() => expect(within(tabela).getByText('café')).toBeTruthy());

    fireEvent.click(await cartao.findByRole('button', { name: 'Desfazer' }));
    await screen.findByText('Desfeito. Nada ficou guardado.');
    await waitFor(() => expect(linhas()[2]!.valores['Observação']).toBe('desfeito'));
  });
});

describe('uma ação do cartão por vez', () => {
  it('durante o Desfazer os outros botões ficam desligados e um segundo toque não repete', async () => {
    const cartao = await abrirComFrase('gastei 5,50 hoje comprando salgado');
    const liberar = planilhas.segurarAProxima('atualizarLinha');

    fireEvent.click(cartao.getByRole('button', { name: 'Desfazer' }));
    await waitFor(() => expect(planilhas.pedidos.filter((p) => p.acao === 'atualizarLinha')).toHaveLength(1));

    for (const nome of ['Desfazer', 'Trocar categoria', 'Guardar como ideia']) {
      expect((cartao.getByRole('button', { name: nome }) as HTMLButtonElement).disabled).toBe(true);
    }
    fireEvent.click(cartao.getByRole('button', { name: 'Guardar como ideia' }));
    liberar();

    expect(await screen.findByText('Desfeito. Nada ficou guardado.')).toBeTruthy();
    expect(await listar('ideias')).toEqual([]);
  });
});

describe('painel de trocar a categoria (revisão da Tarefa 16)', () => {
  it('abre depois dos botões do cartão; a categoria atual marcada com ✓ não grava nada ao ser tocada', async () => {
    const cartao = await abrirComFrase('gastei 5,50 hoje comprando salgado');
    fireEvent.click(cartao.getByRole('button', { name: 'Trocar categoria' }));
    const painel = await screen.findByRole('group', { name: 'Trocar categoria' });
    const acoes = screen.getByRole('button', { name: 'Guardar como ideia' }).parentElement as HTMLElement;
    expect(acoes.compareDocumentPosition(painel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const atual = within(painel).getByRole('button', { name: 'Alimentação' });
    expect(atual.textContent).toBe('✓ Alimentação');
    expect(atual.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(atual);
    await new Promise((r) => setTimeout(r, 30));

    expect(planilhas.pedidos.filter((p) => p.acao === 'atualizarLinha')).toEqual([]);
    expect(screen.getByRole('group', { name: 'Trocar categoria' })).toBeTruthy();
    const outra = within(painel).getByRole('button', { name: 'Lazer' });
    expect(outra.getAttribute('aria-disabled')).toBeNull();
    expect(outra.textContent).toBe('Lazer');
  });
});
