// Pastas na sala (V02, Tarefa 12). Quinta-feira, 2026-11-05, 12:20 em Lisboa. Nomes fictícios.
import { act, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { limparConversa } from '../../src/chat/conversa';
import { apagarPasta, criarPasta } from '../../src/dados/pastas';
import { listar, salvar, semear, semearPalavras } from '../../src/dados/loja';
import type { Pasta } from '../../src/dados/tipos';
import { falsoDoScript, reiniciarFalso } from '../apoio/pastas-falsas';

// O script do Google é de mentira (planilha-ficticia-N); o resto é o código de verdade.
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
const secaoDePastas = async () => within(await principal().findByRole('region', { name: 'Pastas' }));

/** Pastas prontas (sem passar pelo script): o que o dono já tinha. */
async function pastaPronta(extra: Partial<Pasta> & Pick<Pasta, 'nome' | 'tipo'>) {
  return salvar('pastas', { salaId: 'sala-casa', ordem: 1, ...extra });
}

describe('a sala mostra as pastas', () => {
  it('um cartão por pasta, em ordem, com selo do tipo e link para a pasta', async () => {
    const lista = await pastaPronta({ id: 'pasta-1', nome: 'Compras da semana', tipo: 'lista', modelo: 'compras', planilhaId: 'planilha-ficticia-1', ordem: 1 });
    await pastaPronta({ id: 'pasta-2', nome: 'Consumo de Água', tipo: 'registro', modelo: 'consumo', servico: 'agua', unidade: 'm³', planilhaId: 'planilha-ficticia-2', ordem: 2 });
    await pastaPronta({ id: 'pasta-3', nome: 'Financeiro', tipo: 'planilha', modelo: 'financeiro', planilhaId: 'planilha-ficticia-3', ordem: 3 });
    await pastaPronta({ id: 'pasta-4', nome: 'Reformas', tipo: 'comum', ordem: 4 });
    mostrar('#/sala/sala-casa');

    const pastas = await secaoDePastas();
    const links = await pastas.findAllByRole('link');
    expect(links.map((l) => l.querySelector('.pasta-nome')?.textContent)).toEqual(['Compras da semana', 'Consumo de Água', 'Financeiro', 'Reformas']);
    expect(links.map((l) => l.querySelector('.pasta-selo')?.textContent)).toEqual(['Lista', 'Registro', 'Planilha', 'Comum']);
    expect(links[0].getAttribute('href')).toBe(`#/sala/sala-casa/pasta/${lista.id}`);
    expect(links[1].textContent).toContain('Água · m³');
  });

  it('não mostra pasta de outra sala nem pasta apagada', async () => {
    await pastaPronta({ id: 'pasta-1', nome: 'Da Casa', tipo: 'comum' });
    await pastaPronta({ id: 'pasta-2', nome: 'Das Aulas', tipo: 'comum', salaId: 'sala-aulas' });
    const apagada = await pastaPronta({ id: 'pasta-3', nome: 'Velha', tipo: 'comum' });
    await apagarPasta(apagada.id);
    mostrar('#/sala/sala-casa');

    const pastas = await secaoDePastas();
    expect(await pastas.findByText('Da Casa')).toBeTruthy();
    expect(pastas.queryByText('Das Aulas')).toBeNull();
    expect(pastas.queryByText('Velha')).toBeNull();
  });

  it('em Orientações as alunas continuam como Pessoa: nenhuma vira pasta', async () => {
    await salvar('pessoas', { id: 'p-marina', nome: 'Marina', salaId: 'sala-orientacoes', papel: 'aluna' });
    mostrar('#/sala/sala-orientacoes');

    const pessoas = within(await principal().findByRole('region', { name: 'Pessoas' }));
    expect((await pessoas.findByRole('link', { name: /Marina/ })).getAttribute('href')).toBe('#/pessoa/p-marina');
    const pastas = await secaoDePastas();
    expect(pastas.queryByText('Marina')).toBeNull();
    expect(pastas.queryAllByRole('link')).toEqual([]);
    // A sala ainda oferece pastas por tema.
    expect(pastas.getByRole('button', { name: /Nova pasta/ })).toBeTruthy();
    expect(await listar('pastas')).toEqual([]);
  });

  it('sala sem pastas mostra só uma linha fina com "Nova pasta": sem texto de vazio, sem cartão grande, sem pastas padrão', async () => {
    mostrar('#/sala/sala-aulas');

    const pastas = await secaoDePastas();
    const nova = await pastas.findByRole('button', { name: /Nova pasta/ });
    expect(nova.classList.contains('pastas-nova-linha')).toBe(true);
    expect(pastas.queryByText(/Nenhuma pasta/)).toBeNull();
    expect(document.querySelector('.pasta-nova')).toBeNull();
    expect(pastas.queryByRole('button', { name: 'Criar pastas padrão da Casa' })).toBeNull();
  });

  it('com pastas, "Nova pasta" volta a ser o cartão tracejado no fim da grade', async () => {
    await pastaPronta({ nome: 'Provas', tipo: 'comum', salaId: 'sala-aulas' });
    mostrar('#/sala/sala-aulas');

    const pastas = await secaoDePastas();
    await pastas.findByText('Provas');
    expect(document.querySelector('.pasta-nova')).toBeTruthy();
    expect(document.querySelector('.pastas-nova-linha')).toBeNull();
  });

  it('acompanha o que muda: a pasta criada em outro lugar aparece sem recarregar', async () => {
    mostrar('#/sala/sala-aulas');
    const pastas = await secaoDePastas();
    await pastas.findByRole('button', { name: /Nova pasta/ });

    await act(async () => {
      await pastaPronta({ nome: 'Provas', tipo: 'comum', salaId: 'sala-aulas' });
    });

    expect(await pastas.findByText('Provas')).toBeTruthy();
  });
});

describe('Casa sem pastas', () => {
  it('oferece "Criar pastas padrão da Casa" e as cria, com cartão de resultado', async () => {
    mostrar('#/sala/sala-casa');
    const pastas = await secaoDePastas();

    const padrao = await pastas.findByRole('button', { name: 'Criar pastas padrão da Casa' });
    // É a ação principal da Casa vazia (estilo coral) e o cartão grande de Nova pasta dá lugar à linha fina.
    expect(padrao.classList.contains('pastas-padrao')).toBe(true);
    expect(padrao.classList.contains('botao') && padrao.classList.contains('primario')).toBe(true);
    expect(document.querySelector('.pasta-nova')).toBeNull();
    expect(pastas.getByRole('button', { name: /Nova pasta/ }).classList.contains('pastas-nova-linha')).toBe(true);

    fireEvent.click(padrao);

    await waitFor(() => expect(pastas.getAllByRole('link')).toHaveLength(6));
    const nomes = pastas.getAllByRole('link').map((l) => l.querySelector('.pasta-nome')?.textContent);
    expect(nomes).toEqual([
      'Lista de Compras Semanais',
      'Lista de Compras para Casa',
      'Consumo de Água',
      'Consumo de Luz',
      'Consumo de Gás',
      'Financeiro',
    ]);
    expect(pastas.queryByRole('button', { name: 'Criar pastas padrão da Casa' })).toBeNull();
    expect(falsoDoScript().planilhasCriadas).toBe(6);
    expect(pastas.getByText('Pastas da Casa criadas')).toBeTruthy();
  });

  it('o botão fica desligado enquanto cria: toque duplo não repete', async () => {
    const segurar = falsoDoScript().segurarProximaCriacao();
    mostrar('#/sala/sala-casa');
    const pastas = await secaoDePastas();
    const botao = await pastas.findByRole('button', { name: 'Criar pastas padrão da Casa' });

    fireEvent.click(botao);
    fireEvent.click(botao);

    const criando = await pastas.findByRole('button', { name: /Criando as pastas/ });
    expect((criando as HTMLButtonElement).disabled).toBe(true);
    // O andamento é dito em voz alta: qual das 6 está sendo criada.
    expect((await pastas.findByText('Criando 1 de 6…')).closest('[role="status"]')).toBeTruthy();
    segurar.soltar();
    await waitFor(() => expect(pastas.getAllByRole('link')).toHaveLength(6));
    expect(falsoDoScript().planilhasCriadas).toBe(6);
  });

  it('sem conexão mostra o aviso, não cria nada e mantém o botão para tentar de novo', async () => {
    falsoDoScript().cair();
    mostrar('#/sala/sala-casa');
    const pastas = await secaoDePastas();

    fireEvent.click(await pastas.findByRole('button', { name: 'Criar pastas padrão da Casa' }));

    const alerta = await pastas.findByRole('alert');
    expect(alerta.textContent).toMatch(/conexão/i);
    expect(alerta.textContent).toMatch(/nada foi criado/i);
    expect(await listar('pastas')).toEqual([]);
    const botao = pastas.getByRole('button', { name: 'Criar pastas padrão da Casa' }) as HTMLButtonElement;
    expect(botao.disabled).toBe(false);

    // A internet volta: o mesmo botão funciona.
    falsoDoScript().voltar();
    fireEvent.click(botao);
    await waitFor(() => expect(pastas.getAllByRole('link')).toHaveLength(6));
    expect(pastas.queryByRole('alert')).toBeNull();
  });

  it('Casa ainda solta na raiz do Drive: o aviso manda rodar organizarPastaCentral, não cria nada e funciona depois', async () => {
    falsoDoScript().pedirParaOrganizarPastas();
    mostrar('#/sala/sala-casa');
    const pastas = await secaoDePastas();

    fireEvent.click(await pastas.findByRole('button', { name: 'Criar pastas padrão da Casa' }));

    const alerta = await pastas.findByRole('alert');
    expect(alerta.textContent).toMatch(/Rode organizarPastaCentral no script \(veja o GUIA\) e tente de novo/);
    expect(alerta.textContent).not.toMatch(/organizar_pastas/);
    expect(await listar('pastas')).toEqual([]);

    falsoDoScript().organizarFeito();
    fireEvent.click(pastas.getByRole('button', { name: 'Criar pastas padrão da Casa' }));
    await waitFor(() => expect(pastas.getAllByRole('link')).toHaveLength(6));
  });

  it('o Google recusa na 4ª: as 3 criadas ficam, o botão continua e o segundo toque cria as 3 que faltam', async () => {
    falsoDoScript().falharNaCriacao(4);
    mostrar('#/sala/sala-casa');
    const pastas = await secaoDePastas();

    fireEvent.click(await pastas.findByRole('button', { name: 'Criar pastas padrão da Casa' }));

    const alerta = await pastas.findByRole('alert');
    expect(alerta.textContent).toMatch(/tente de novo/i);
    expect(alerta.textContent).toMatch(/já criadas ficam/i);
    await waitFor(() => expect(pastas.getAllByRole('link')).toHaveLength(3));
    // O botão não some só porque já existem pastas: faltam padrão.
    const botao = pastas.getByRole('button', { name: 'Criar pastas padrão da Casa' }) as HTMLButtonElement;
    expect(botao.disabled).toBe(false);

    fireEvent.click(botao);

    await waitFor(() => expect(pastas.getAllByRole('link')).toHaveLength(6));
    expect(falsoDoScript().planilhasCriadas).toBe(6);
    expect(pastas.queryByRole('alert')).toBeNull();
    expect(pastas.queryByRole('button', { name: 'Criar pastas padrão da Casa' })).toBeNull();
  });

  it('o aviso de erro é o bloco pêssego, com "Tentar de novo" dentro dele', async () => {
    falsoDoScript().cair();
    mostrar('#/sala/sala-casa');
    const pastas = await secaoDePastas();
    fireEvent.click(await pastas.findByRole('button', { name: 'Criar pastas padrão da Casa' }));

    const alerta = await pastas.findByRole('alert');
    expect(alerta.classList.contains('pastas-erro')).toBe(true);
    falsoDoScript().voltar();
    fireEvent.click(within(alerta).getByRole('button', { name: 'Tentar de novo' }));

    await waitFor(() => expect(pastas.getAllByRole('link')).toHaveLength(6));
  });

  it('se nenhuma foi criada, o aviso não diz que "as já criadas ficam"', async () => {
    falsoDoScript().falharNaCriacao(1);
    mostrar('#/sala/sala-casa');
    const pastas = await secaoDePastas();

    fireEvent.click(await pastas.findByRole('button', { name: 'Criar pastas padrão da Casa' }));

    const alerta = await pastas.findByRole('alert');
    expect(alerta.textContent).toMatch(/nada foi criado/i);
    expect(alerta.textContent).not.toMatch(/já criadas/i);
  });

  it('com outras pastas já criadas, mas faltando padrão, o botão continua', async () => {
    await criarPasta({ salaId: 'sala-casa', tipo: 'comum', nome: 'Reformas' });
    mostrar('#/sala/sala-casa');

    const pastas = await secaoDePastas();
    expect(await pastas.findByText('Reformas')).toBeTruthy();
    expect(pastas.getByRole('button', { name: 'Criar pastas padrão da Casa' })).toBeTruthy();
    // Com pastas, o cartão tracejado volta.
    expect(document.querySelector('.pasta-nova')).toBeTruthy();
  });

  it('o registro de água, luz e gás mostra o ícone do serviço', async () => {
    mostrar('#/sala/sala-casa');
    const pastas = await secaoDePastas();
    fireEvent.click(await pastas.findByRole('button', { name: 'Criar pastas padrão da Casa' }));
    await waitFor(() => expect(pastas.getAllByRole('link')).toHaveLength(6));

    const icone = (nome: string) => pastas.getByRole('link', { name: new RegExp(nome) }).querySelector('svg path')?.getAttribute('d');
    expect(new Set([icone('Consumo de Água'), icone('Consumo de Luz'), icone('Consumo de Gás')]).size).toBe(3);
  });
});

describe('celular (375 px)', () => {
  it('mostra o botão das padrão e a linha de Nova pasta', async () => {
    mostrar('#/sala/sala-casa', 375);
    const pastas = await secaoDePastas();
    expect(await pastas.findByRole('button', { name: 'Criar pastas padrão da Casa' })).toBeTruthy();
    expect(pastas.getByRole('button', { name: /Nova pasta/ })).toBeTruthy();
  });
});

// ---- Acessibilidade (Tarefa 19, correções): foco, região viva e nome do cartão ----

describe('acessibilidade das pastas da sala', () => {
  it('o nome do link da pasta começa pelo nome dela (o selo do tipo vem depois)', async () => {
    await pastaPronta({ id: 'pasta-1', nome: 'Compras da semana', tipo: 'lista', modelo: 'compras', planilhaId: 'planilha-ficticia-1', ordem: 1 });
    mostrar('#/sala/sala-casa');

    const pastas = await secaoDePastas();
    const link = await pastas.findByRole('link', { name: /Compras da semana/ });
    expect(link.textContent?.startsWith('Compras da semana')).toBe(true);
    expect(link.querySelector('.pasta-selo')?.textContent).toBe('Lista');
  });

  it('o cartão de resultado não fica numa região viva, recebe o foco e Fechar leva o foco ao título Pastas', async () => {
    mostrar('#/sala/sala-casa');
    const pastas = await secaoDePastas();
    fireEvent.click(await pastas.findByRole('button', { name: 'Criar pastas padrão da Casa' }));

    const cartao = await pastas.findByRole('article');
    expect(cartao.closest('[role="status"], [aria-live]')).toBeNull();
    expect(cartao.getAttribute('aria-labelledby')).toBeTruthy();
    expect(cartao.getAttribute('aria-describedby')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(cartao));
    for (const regiao of document.querySelectorAll('main .pastas-da-sala [role="status"], main .pastas-da-sala [aria-live]')) expect(regiao.querySelector('button, a[href]')).toBeNull();

    fireEvent.click(within(cartao).getByRole('button', { name: 'Fechar' }));
    expect(pastas.queryByRole('article')).toBeNull();
    expect(document.activeElement).toBe(pastas.getByRole('heading', { name: 'Pastas' }));
  });

  it('o andamento "Criando N de 6…" entra numa região viva que já existia vazia', async () => {
    const segurar = falsoDoScript().segurarProximaCriacao();
    mostrar('#/sala/sala-casa');
    const pastas = await secaoDePastas();
    const botao = await pastas.findByRole('button', { name: 'Criar pastas padrão da Casa' });
    const regiao = document.querySelector('main .pastas-da-sala .aviso-vivo') as HTMLElement;
    expect(regiao.getAttribute('role')).toBe('status');
    expect(regiao.textContent).toBe('');

    fireEvent.click(botao);
    await waitFor(() => expect(regiao.textContent).toBe('Criando 1 de 6…'));
    expect(document.querySelector('main .pastas-da-sala .aviso-vivo')).toBe(regiao);
    segurar.soltar();
    await waitFor(() => expect(pastas.getAllByRole('link')).toHaveLength(6));
  });
});
