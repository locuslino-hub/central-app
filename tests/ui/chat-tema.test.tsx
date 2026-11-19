// "nas tarefas do tema X" no Chat e no Pode falar (V02, Tarefa 17). Quinta-feira, 2026-11-05, 12:20 em Lisboa. Nomes fictícios.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { limparConversa } from '../../src/chat/conversa';
import { executarFrase } from '../../src/chat/executar';
import { listar, salvar, semear, semearPalavras } from '../../src/dados/loja';
import { apagarPasta } from '../../src/dados/pastas';
import { Chat } from '../../src/ui/Chat';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 5, 12, 20));
  limparConversa();
  await semear();
  await semearPalavras();
});

const metodologia = () => salvar('pastas', { id: 'pasta-metodologia', salaId: 'sala-doutoramento', tipo: 'comum', nome: 'Metodologia', ordem: 1 });

function dizer(frase: string) {
  fireEvent.input(screen.getByRole('textbox', { name: 'Escreva ou dite' }), { target: { value: frase } });
  fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
}

async function ultimoCartao(): Promise<HTMLElement> {
  await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(1));
  return screen.getAllByRole('article')[0]!;
}

const FRASE = 'adicione revisar capítulo nas tarefas do tema Metodologia';

describe('Chat: tema', () => {
  it('"adicione revisar capítulo nas tarefas do tema Metodologia" cria tarefa com pastaId e o cartão diz o tema', async () => {
    await metodologia();
    render(<Chat />);
    dizer(FRASE);
    const cartao = within(await ultimoCartao());

    expect(cartao.getByText('Revisar capítulo')).toBeTruthy();
    expect(cartao.getByText('Doutoramento')).toBeTruthy();
    expect(cartao.getByText('Tema: Metodologia.')).toBeTruthy();
    await waitFor(async () => expect(await listar('tarefas')).toHaveLength(1));
    expect((await listar('tarefas'))[0]).toMatchObject({ titulo: 'Revisar capítulo', salaId: 'sala-doutoramento', pastaId: 'pasta-metodologia', data: '2026-11-05' });
  });

  it('tema inexistente cria tarefa na sala e avisa no cartão', async () => {
    render(<Chat />);
    dizer('adicione revisar capítulo do doutoramento nas tarefas do tema Metodologia');
    const cartao = within(await ultimoCartao());

    expect(cartao.getByText('Não achei o tema Metodologia; ficou na sala.')).toBeTruthy();
    await waitFor(async () => expect(await listar('tarefas')).toHaveLength(1));
    const [tarefa] = await listar('tarefas');
    expect(tarefa).toMatchObject({ titulo: 'Revisar capítulo do doutoramento', salaId: 'sala-doutoramento' });
    expect(Object.keys(tarefa!)).not.toContain('pastaId');
  });

  it('tema inexistente e sem sala na frase: o aviso não diz "na sala"', async () => {
    render(<Chat />);
    dizer(FRASE);
    const cartao = within(await ultimoCartao());

    expect(cartao.getByText('Não achei o tema Metodologia; a tarefa ficou sem tema.')).toBeTruthy();
    expect(cartao.queryByText(/ficou na sala/)).toBeNull();
  });

  it('pasta apagada conta como tema inexistente', async () => {
    const pasta = await metodologia();
    await apagarPasta(pasta.id);
    render(<Chat />);
    dizer(FRASE);

    expect(within(await ultimoCartao()).getByText(/Não achei o tema Metodologia/)).toBeTruthy();
    await waitFor(async () => expect(await listar('tarefas')).toHaveLength(1));
    expect(Object.keys((await listar('tarefas'))[0]!)).not.toContain('pastaId');
  });

  it('Trocar sala tira a tarefa do tema (a pasta é de uma sala só)', async () => {
    await metodologia();
    render(<Chat />);
    dizer(FRASE);
    const cartao = within(await ultimoCartao());
    await waitFor(async () => expect(await listar('tarefas')).toHaveLength(1));

    fireEvent.click(await cartao.findByRole('button', { name: 'Trocar sala' }));
    fireEvent.click(cartao.getByRole('button', { name: 'Aulas' }));

    await waitFor(async () => expect((await listar('tarefas'))[0]!.salaId).toBe('sala-aulas'));
    expect(Object.keys((await listar('tarefas'))[0]!)).not.toContain('pastaId');
    await waitFor(() => expect(cartao.queryByText('Tema: Metodologia.')).toBeNull());
  });

  it('escolher a mesma sala do tema mantém o tema', async () => {
    await metodologia();
    render(<Chat />);
    dizer(FRASE);
    const cartao = within(await ultimoCartao());
    await waitFor(async () => expect(await listar('tarefas')).toHaveLength(1));

    fireEvent.click(await cartao.findByRole('button', { name: 'Trocar sala' }));
    fireEvent.click(cartao.getByRole('button', { name: 'Doutoramento' }));

    await waitFor(() => expect(cartao.queryByRole('group', { name: 'Escolher sala' })).toBeNull());
    expect((await listar('tarefas'))[0]).toMatchObject({ pastaId: 'pasta-metodologia', salaId: 'sala-doutoramento' });
    expect(cartao.getByText('Tema: Metodologia.')).toBeTruthy();
  });

  it('Desfazer apaga a tarefa do tema', async () => {
    await metodologia();
    render(<Chat />);
    dizer(FRASE);
    const cartao = within(await ultimoCartao());
    await waitFor(async () => expect(await listar('tarefas')).toHaveLength(1));
    fireEvent.click(await cartao.findByRole('button', { name: 'Desfazer' }));
    await waitFor(async () => expect(await listar('tarefas')).toHaveLength(0));
  });
});

describe('Pode falar: tema', () => {
  it('a frase vira tarefa do tema (não ideia), e o cartão leva à pasta', async () => {
    await metodologia();
    const r = await executarFrase(FRASE);

    expect(r.titulo).toBe('Tarefa guardada');
    expect(r.detalhe).toContain('Revisar capítulo');
    expect(r.detalhe).toContain('Doutoramento');
    expect(r.detalhe).toContain('Tema Metodologia');
    expect(r.ver).toBe('#/sala/sala-doutoramento/pasta/pasta-metodologia');
    expect((await listar('tarefas'))[0]).toMatchObject({ pastaId: 'pasta-metodologia' });
    expect(await listar('ideias')).toHaveLength(0);
  });

  it('tema inexistente: a tarefa fica na sala, com o aviso no cartão (frase com o pedido de tarefa não vira ideia)', async () => {
    const r = await executarFrase(FRASE);
    expect(r.titulo).toBe('Tarefa guardada');
    expect(r.detalhe).toContain('Não achei o tema Metodologia');
    expect(r.ver).toBe('#/atividades');
    expect(await listar('ideias')).toHaveLength(0);
    expect(await listar('tarefas')).toHaveLength(1);
  });
});

describe('as frases de sempre seguem iguais com pastas de tema no banco', () => {
  it.each([
    ['Adicione em atividades do dia mandar mensagem para Renata', { titulo: 'Mandar mensagem para Renata', data: '2026-11-05' }],
    ['Adicione Revisar paragrafo do relatório 1 nas tarefas do doutoramento', { salaId: 'sala-doutoramento' }],
    ['Preciso parafusar o apoio do banheiro', { salaId: 'sala-casa' }],
  ])('%s', async (frase, esperado) => {
    await metodologia();
    await salvar('pastas', { id: 'pasta-doutoramento', salaId: 'sala-doutoramento', tipo: 'comum', nome: 'Doutoramento', ordem: 2 });
    await executarFrase(frase);
    const [tarefa] = await listar('tarefas');
    expect(tarefa).toMatchObject(esperado);
    expect(Object.keys(tarefa!)).not.toContain('pastaId');
  });
});
