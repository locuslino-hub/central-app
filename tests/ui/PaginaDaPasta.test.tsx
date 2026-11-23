// A página de uma pasta (V02, Tarefa 12): moldura, selo do tipo, link da planilha, renomear e apagar.
// O conteúdo de cada tipo chega nas Tarefas 13, 14, 16 e 17. Nomes e ids fictícios.
import { act, cleanup, configure, fireEvent, render, waitFor, within } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { limparConversa } from '../../src/chat/conversa';
import { listar, salvar, semear, semearPalavras } from '../../src/dados/loja';
import { NOME_DA_PASTA_NO_MAXIMO } from '../../src/dados/pastas';
import type { Pasta } from '../../src/dados/tipos';
import { falsoDoScript, reiniciarFalso } from '../apoio/pastas-falsas';

vi.mock('../../src/dados/pastas', async (importar) => (await import('../apoio/pastas-falsas')).comScriptFalso(await importar<typeof import('../../src/dados/pastas')>()));

configure({ asyncUtilTimeout: 5000 });

beforeEach(async () => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-11-05T12:20:00Z'));
  limparConversa();
  reiniciarFalso();
  await semear();
  await semearPalavras();
});

function mostrar(hash: string, largura = 1280) {
  Object.defineProperty(window, 'innerWidth', { value: largura, configurable: true, writable: true });
  history.replaceState(null, '', `/${hash}`);
  return render(<App />);
}

const principal = () => within(document.querySelector('main') as HTMLElement);

async function pasta(extra: Partial<Pasta> & Pick<Pasta, 'nome' | 'tipo'>) {
  return salvar('pastas', { id: 'pasta-1', salaId: 'sala-casa', ordem: 1, ...extra });
}
const compras = () => pasta({ nome: 'Compras da semana', tipo: 'lista', modelo: 'compras', planilhaId: 'planilha-ficticia-1' });

describe('a página da pasta', () => {
  it('mostra o nome como título, o selo do tipo, a sala e a volta para a sala', async () => {
    await compras();
    mostrar('#/sala/sala-casa/pasta/pasta-1');

    expect((await principal().findByRole('heading', { level: 1, name: 'Compras da semana' })).textContent).toBe('Compras da semana');
    expect(principal().getByText('Lista')).toBeTruthy();
    expect(principal().getByRole('link', { name: 'Casa' }).getAttribute('href')).toBe('#/sala/sala-casa');
    expect(principal().getByRole('link', { name: 'Voltar' }).getAttribute('href')).toBe('#/sala/sala-casa');
    await waitFor(() => expect(document.title).toBe('Compras da semana · Central de Comando'));
  });

  it('o resultado de apagar aparece num cartão na página', async () => {
    await compras();
    mostrar('#/sala/sala-casa/pasta/pasta-1');

    await principal().findByRole('button', { name: 'Apagar pasta' });
    expect(principal().queryByRole('article')).toBeNull();
    fireEvent.click(principal().getByRole('button', { name: 'Apagar pasta' }));
    expect(await within(await principal().findByRole('article')).findByText('Pasta apagada')).toBeTruthy();
  });

  it('a pasta de Planilha mostra o Financeiro (Tarefa 16)', async () => {
    await pasta({ nome: 'Contas', tipo: 'planilha', modelo: 'financeiro', planilhaId: 'planilha-ficticia-1' });
    mostrar('#/sala/sala-casa/pasta/pasta-1');

    const conteudo = await principal().findByRole('region', { name: 'Lançamentos' });
    expect(conteudo.getAttribute('data-tipo')).toBe('planilha');
    expect(within(conteudo).getByRole('form', { name: 'Novo gasto' })).toBeTruthy();
    expect(within(conteudo).queryByText(/chega numa próxima versão/)).toBeNull();
  });

  it('a pasta comum mostra tarefas, notas e documentos do tema (Tarefa 17)', async () => {
    await pasta({ nome: 'Metodologia', tipo: 'comum', salaId: 'sala-doutoramento' });
    mostrar('#/sala/sala-doutoramento/pasta/pasta-1');

    const conteudo = await principal().findByRole('group', { name: 'Notas, tarefas e documentos' });
    expect(conteudo.getAttribute('data-tipo')).toBe('comum');
    expect(within(conteudo).getByRole('region', { name: 'Tarefas' })).toBeTruthy();
    expect(within(conteudo).getByRole('region', { name: 'Notas · Metodologia' })).toBeTruthy();
    expect(within(conteudo).getByRole('region', { name: 'Documentos' })).toBeTruthy();
    expect(within(conteudo).queryByText(/chega numa próxima versão/)).toBeNull();
  });

  it('apagar a pasta comum diz que tarefas, notas e documentos continuam na sala', async () => {
    await pasta({ nome: 'Metodologia', tipo: 'comum', salaId: 'sala-doutoramento' });
    mostrar('#/sala/sala-doutoramento/pasta/pasta-1');

    fireEvent.click(await principal().findByRole('button', { name: 'Apagar pasta' }));

    expect(await principal().findByText('A pasta saiu da sala. As tarefas, notas e documentos dela continuam na sala.')).toBeTruthy();
  });

  it('a pasta de Lista mostra a lista de compras (Tarefa 14)', async () => {
    await compras();
    mostrar('#/sala/sala-casa/pasta/pasta-1');

    const conteudo = await principal().findByRole('region', { name: 'Itens' });
    expect(conteudo.getAttribute('data-tipo')).toBe('lista');
    expect(within(conteudo).getByRole('form', { name: 'Novo item' })).toBeTruthy();
    expect(within(conteudo).queryByText(/chega numa próxima versão/)).toBeNull();
  });

  it('pasta com planilha tem o link "Abrir no Google Planilhas", em outra aba e sem dar acesso à janela de origem', async () => {
    await pasta({ nome: 'Água', tipo: 'registro', modelo: 'consumo', servico: 'agua', planilhaId: 'plan-ficticia_9' });
    mostrar('#/sala/sala-casa/pasta/pasta-1');

    const link = await principal().findByRole('link', { name: /Abrir no Google Planilhas/ });
    expect(link.getAttribute('href')).toBe('https://docs.google.com/spreadsheets/d/plan-ficticia_9');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('o Financeiro tem o seu próprio "Abrir planilha": a página não repete o link', async () => {
    await pasta({ nome: 'Contas', tipo: 'planilha', modelo: 'financeiro', planilhaId: 'plan-ficticia_9' });
    mostrar('#/sala/sala-casa/pasta/pasta-1');

    const links = await principal().findAllByRole('link', { name: /Abrir planilha/ });
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute('href')).toBe('https://docs.google.com/spreadsheets/d/plan-ficticia_9');
    expect(principal().queryByRole('link', { name: /Abrir no Google Planilhas/ })).toBeNull();
  });

  it('o id da planilha é codificado no endereço', async () => {
    await pasta({ nome: 'Estranha', tipo: 'lista', modelo: 'compras', planilhaId: 'a/b?c' });
    mostrar('#/sala/sala-casa/pasta/pasta-1');

    const link = await principal().findByRole('link', { name: /Abrir no Google Planilhas/ });
    expect(link.getAttribute('href')).toBe('https://docs.google.com/spreadsheets/d/a%2Fb%3Fc');
  });

  it('pasta comum não tem planilha nem link', async () => {
    await pasta({ nome: 'Metodologia', tipo: 'comum', salaId: 'sala-doutoramento' });
    mostrar('#/sala/sala-doutoramento/pasta/pasta-1');

    expect(await principal().findByRole('heading', { level: 1, name: 'Metodologia' })).toBeTruthy();
    expect(principal().getByText('Comum')).toBeTruthy();
    expect(principal().queryByRole('link', { name: /Google Planilhas/ })).toBeNull();
  });

  it.each([
    ['uma pasta que não existe', '#/sala/sala-casa/pasta/nao-existe'],
    ['uma pasta de outra sala', '#/sala/sala-aulas/pasta/pasta-1'],
    ['uma sala que não existe', '#/sala/sala-fantasma/pasta/pasta-1'],
  ])('%s dá "Pasta não encontrada" com o caminho de volta', async (_nome, hash) => {
    await compras();
    mostrar(hash);

    expect(await principal().findByRole('heading', { level: 1, name: 'Pasta não encontrada' })).toBeTruthy();
    expect(principal().getByText(/Esta pasta não existe neste aparelho/)).toBeTruthy();
    expect(principal().getAllByRole('link').some((l) => /^Voltar para|^Ver as salas/.test(l.textContent ?? ''))).toBe(true);
  });

  it('pasta apagada também não é encontrada', async () => {
    const p = await compras();
    const { apagar } = await import('../../src/dados/loja');
    await apagar('pastas', p.id);
    mostrar('#/sala/sala-casa/pasta/pasta-1');

    expect(await principal().findByRole('heading', { level: 1, name: 'Pasta não encontrada' })).toBeTruthy();
  });

  it('o cartão da sala leva até a página (de ponta a ponta)', async () => {
    await compras();
    mostrar('#/sala/sala-casa');
    const secao = within(await principal().findByRole('region', { name: 'Pastas' }));

    fireEvent.click(await secao.findByRole('link', { name: /Compras da semana/ }));

    expect(await principal().findByRole('heading', { level: 1, name: 'Compras da semana' })).toBeTruthy();
    expect(location.hash).toBe('#/sala/sala-casa/pasta/pasta-1');
  });
});

describe('renomear', () => {
  it('troca o nome sem tocar no Drive', async () => {
    await compras();
    mostrar('#/sala/sala-casa/pasta/pasta-1');
    fireEvent.click(await principal().findByRole('button', { name: 'Renomear' }));

    const campo = principal().getByLabelText('Novo nome') as HTMLInputElement;
    expect(campo.value).toBe('Compras da semana');
    expect(campo.maxLength).toBe(NOME_DA_PASTA_NO_MAXIMO);
    fireEvent.input(campo, { target: { value: '  Compras do mês  ' } });
    fireEvent.click(principal().getByRole('button', { name: 'Salvar nome' }));

    expect(await principal().findByRole('heading', { level: 1, name: 'Compras do mês' })).toBeTruthy();
    expect(principal().queryByLabelText('Novo nome')).toBeNull();
    expect((await listar('pastas'))[0]).toMatchObject({ nome: 'Compras do mês', planilhaId: 'planilha-ficticia-1' });
    expect(falsoDoScript().pedidos).toEqual([]);
  });

  it('nome vazio mostra o aviso e mantém o nome antigo', async () => {
    await compras();
    mostrar('#/sala/sala-casa/pasta/pasta-1');
    fireEvent.click(await principal().findByRole('button', { name: 'Renomear' }));
    fireEvent.input(principal().getByLabelText('Novo nome'), { target: { value: '   ' } });

    fireEvent.click(principal().getByRole('button', { name: 'Salvar nome' }));

    expect(await principal().findByText('Escreva um nome para a pasta.')).toBeTruthy();
    expect((await listar('pastas'))[0].nome).toBe('Compras da semana');
  });

  it('Cancelar fecha o campo e devolve o foco ao botão', async () => {
    await compras();
    mostrar('#/sala/sala-casa/pasta/pasta-1');
    fireEvent.click(await principal().findByRole('button', { name: 'Renomear' }));

    fireEvent.click(principal().getByRole('button', { name: 'Cancelar' }));

    await waitFor(() => expect(principal().queryByLabelText('Novo nome')).toBeNull());
    expect(document.activeElement).toBe(principal().getByRole('button', { name: 'Renomear' }));
  });
});

describe('apagar', () => {
  it('tira a pasta da Central, avisa que a planilha continua no Drive e permite desfazer', async () => {
    await compras();
    mostrar('#/sala/sala-casa/pasta/pasta-1');

    fireEvent.click(await principal().findByRole('button', { name: 'Apagar pasta' }));

    expect(await principal().findByText('Pasta apagada')).toBeTruthy();
    expect(principal().getByText(/A planilha continua no seu Drive/)).toBeTruthy();
    expect(await listar('pastas')).toEqual([]);
    expect(falsoDoScript().pedidos).toEqual([]);
    expect(principal().getByRole('link', { name: 'Voltar para Casa' }).getAttribute('href')).toBe('#/sala/sala-casa');

    fireEvent.click(principal().getByRole('button', { name: 'Desfazer' }));

    await waitFor(async () => expect(await listar('pastas')).toHaveLength(1));
    expect(await principal().findByText('Desfeito')).toBeTruthy();
    expect((await listar('pastas'))[0]).toMatchObject({ id: 'pasta-1', nome: 'Compras da semana', planilhaId: 'planilha-ficticia-1' });
  });

  it('apagar quando a pasta já foi apagada em outro aparelho diz isso, sem Desfazer', async () => {
    await compras();
    mostrar('#/sala/sala-casa/pasta/pasta-1');
    const botao = await principal().findByRole('button', { name: 'Apagar pasta' });
    falsoDoScript().apagarRetornaVazio();

    fireEvent.click(botao);

    expect(await principal().findByText('Esta pasta já não estava aqui.')).toBeTruthy();
    expect(principal().queryByRole('button', { name: 'Desfazer' })).toBeNull();
    expect(principal().queryByText('Pasta apagada')).toBeNull();
  });

  it('se a pasta voltou a existir (restaurada em outro aparelho), o cartão de "apagada" sai', async () => {
    const p = await compras();
    mostrar('#/sala/sala-casa/pasta/pasta-1');
    fireEvent.click(await principal().findByRole('button', { name: 'Apagar pasta' }));
    await principal().findByText('Pasta apagada');

    await act(async () => {
      await salvar('pastas', { ...p, apagado: undefined });
    });

    expect(await principal().findByRole('heading', { level: 1, name: 'Compras da semana' })).toBeTruthy();
    await waitFor(() => expect(principal().queryByText('Pasta apagada')).toBeNull());
    expect(principal().getByRole('button', { name: 'Apagar pasta' })).toBeTruthy();
  });

  it('a pasta comum não fala de planilha ao apagar', async () => {
    await pasta({ nome: 'Metodologia', tipo: 'comum', salaId: 'sala-doutoramento' });
    mostrar('#/sala/sala-doutoramento/pasta/pasta-1');

    fireEvent.click(await principal().findByRole('button', { name: 'Apagar pasta' }));

    expect(await principal().findByText('Pasta apagada')).toBeTruthy();
    expect(principal().queryByText(/planilha/i)).toBeNull();
  });

  it('apagada em outro aparelho enquanto aberta: mostra "não encontrada", sem erro', async () => {
    const p = await compras();
    mostrar('#/sala/sala-casa/pasta/pasta-1');
    await principal().findByRole('heading', { level: 1, name: 'Compras da semana' });

    await act(async () => {
      const { apagar } = await import('../../src/dados/loja');
      await apagar('pastas', p.id);
    });

    expect(await principal().findByRole('heading', { level: 1, name: 'Pasta não encontrada' })).toBeTruthy();
  });
});

// ---- Acessibilidade (Tarefa 19, correções): foco e região viva ----

describe('acessibilidade da página da pasta', () => {
  it('o cartão de resultado não fica numa região viva: recebe o foco, com nome e descrição', async () => {
    await compras();
    mostrar('#/sala/sala-casa/pasta/pasta-1');

    fireEvent.click(await principal().findByRole('button', { name: 'Apagar pasta' }));
    const cartao = await principal().findByRole('article');
    expect(cartao.closest('[role="status"], [aria-live]')).toBeNull();
    expect(cartao.getAttribute('aria-labelledby')).toBeTruthy();
    expect(cartao.getAttribute('aria-describedby')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(cartao));
    for (const regiao of document.querySelectorAll('main [role="status"], main [aria-live]')) expect(regiao.querySelector('button, a[href]')).toBeNull();
  });

  it('Apagar e Desfazer mantêm o mesmo cartão na tela (a árvore não remonta) e o foco volta a ele', async () => {
    await compras();
    mostrar('#/sala/sala-casa/pasta/pasta-1');

    fireEvent.click(await principal().findByRole('button', { name: 'Apagar pasta' }));
    const cartao = await principal().findByRole('article');
    await waitFor(() => expect(document.activeElement).toBe(cartao));
    const titulo = document.querySelector('h1');

    fireEvent.click(within(cartao).getByRole('button', { name: 'Desfazer' }));
    await waitFor(() => expect(within(cartao).getByText('Desfeito')).toBeTruthy());
    expect(principal().getByRole('article')).toBe(cartao);
    expect(document.querySelector('h1')).toBe(titulo);
    await waitFor(() => expect(document.activeElement).toBe(cartao));
  });

  it('Fechar o cartão "Pasta apagada" leva o foco ao link Voltar para a sala', async () => {
    await compras();
    mostrar('#/sala/sala-casa/pasta/pasta-1');

    fireEvent.click(await principal().findByRole('button', { name: 'Apagar pasta' }));
    const cartao = await principal().findByRole('article');
    await waitFor(() => expect(document.activeElement).toBe(cartao));
    fireEvent.click(within(cartao).getByRole('button', { name: 'Fechar' }));
    expect(principal().queryByRole('article')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(principal().getByRole('link', { name: /Voltar para Casa/ })));
  });

  it('Fechar o cartão "Desfeito" leva o foco ao botão Renomear', async () => {
    await compras();
    mostrar('#/sala/sala-casa/pasta/pasta-1');

    fireEvent.click(await principal().findByRole('button', { name: 'Apagar pasta' }));
    const cartao = await principal().findByRole('article');
    await waitFor(() => expect(document.activeElement).toBe(cartao));
    fireEvent.click(within(cartao).getByRole('button', { name: 'Desfazer' }));
    await waitFor(() => expect(within(cartao).getByText('Desfeito')).toBeTruthy());
    await waitFor(() => expect(document.activeElement).toBe(cartao));
    fireEvent.click(within(cartao).getByRole('button', { name: 'Fechar' }));
    expect(principal().queryByRole('article')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(principal().getByRole('button', { name: 'Renomear' })));
  });
});
