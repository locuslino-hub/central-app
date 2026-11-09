import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { assinarConversa, lerConversa, limparConversa } from '../../src/chat/conversa';
import type { ItemDoChat } from '../../src/chat/interpretar';
import { listar, salvar, semear, semearPalavras } from '../../src/dados/loja';
import { descreverQuando } from '../../src/ui/Cartao';
import { Chat } from '../../src/ui/Chat';

// Quinta-feira, 2026-11-05, 12:20 (Europe/Lisbon). Só a data é falsa.
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 5, 12, 20));
  limparConversa();
  await semear();
  await semearPalavras();
});

const campo = () => screen.getByRole('textbox', { name: 'Escreva ou dite' }) as HTMLInputElement;

function dizer(frase: string, dentro: HTMLElement = document.body) {
  const entrada = within(dentro).getByRole('textbox', { name: 'Escreva ou dite' });
  fireEvent.input(entrada, { target: { value: frase } });
  fireEvent.click(within(dentro).getByRole('button', { name: 'Enviar' }));
}

/** O cartão mais novo, depois que a resposta chegou. */
async function ultimoCartao(quantos = 1): Promise<HTMLElement> {
  await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(quantos));
  const cartoes = screen.getAllByRole('article');
  return cartoes[cartoes.length - 1];
}

async function tarefas() {
  return listar('tarefas');
}

async function esperarTarefas(n: number) {
  await waitFor(async () => expect(await tarefas()).toHaveLength(n));
  return tarefas();
}

describe('cartão do chat', () => {
  it('cartão mostra tipo, título, sala, quando e motivo', async () => {
    render(<Chat />);
    dizer('Adicione reunião sobre o projeto na sexta feira com inicio às 11:00 e termino 12:00');
    const cartao = within(await ultimoCartao());

    expect(cartao.getByText('Compromisso')).toBeTruthy();
    expect(cartao.getByText('Reunião sobre o projeto')).toBeTruthy();
    expect(cartao.getByText('Investigação')).toBeTruthy();
    expect(cartao.getByText('Sexta, 6/11, 11:00 às 12:00')).toBeTruthy();
    expect(cartao.getByText('"Projeto" costuma ser Investigação.')).toBeTruthy();
  });

  it('Marina cadastrada em Orientações dá sala certa e o nome fica no título', async () => {
    await salvar('pessoas', { nome: 'Marina', salaId: 'sala-orientacoes' });
    render(<Chat />);
    dizer('Marcar reunião com a Marina');
    const cartao = within(await ultimoCartao());

    expect(cartao.getByText('Marcar reunião com a Marina')).toBeTruthy();
    expect(cartao.getByText('Orientações')).toBeTruthy();
    expect(cartao.getByText('Hoje')).toBeTruthy();
    expect(cartao.getByText('Marina fica em Orientações.')).toBeTruthy();
    const [salva] = await esperarTarefas(1);
    expect(salva).toMatchObject({ salaId: 'sala-orientacoes', marcar: true, data: '2026-11-05' });
    expect(salva.titulo).toContain('Marina');
  });

  it('pessoa desconhecida mostra "Em que sala fica Renata?" e, depois de escolher, a próxima frase não pergunta', async () => {
    render(<Chat />);
    dizer('Adicione em atividades do dia mandar mensagem para Renata');
    const primeiro = await ultimoCartao();

    expect(within(primeiro).getByText('Em que sala fica Renata?')).toBeTruthy();
    expect(within(primeiro).getByText('Sem sala')).toBeTruthy();
    await esperarTarefas(1);

    fireEvent.click(within(primeiro).getByRole('button', { name: 'Orientações' }));
    await within(primeiro).findByText('Vou lembrar: Renata fica em Orientações.');
    expect(within(primeiro).queryByText('Em que sala fica Renata?')).toBeNull();

    const renata = (await listar('pessoas')).find((p) => p.nome === 'Renata')!;
    expect(renata.salaId).toBe('sala-orientacoes');
    await waitFor(async () =>
      expect((await tarefas())[0]).toMatchObject({ salaId: 'sala-orientacoes', pessoaId: renata.id }),
    );

    dizer('Ligar para Renata amanhã');
    const segundo = within(await ultimoCartao(2));
    expect(segundo.getByText('Orientações')).toBeTruthy();
    expect(segundo.getByText('Renata fica em Orientações.')).toBeTruthy();
    expect(screen.queryByText(/Em que sala fica/)).toBeNull();
    expect(await listar('pessoas')).toHaveLength(1);
  });

  it('Trocar sala aprende: muda a sala do item e a próxima frase com a mesma palavra vai para a sala nova', async () => {
    render(<Chat />);
    dizer('Trocar a lâmpada da garagem');
    const cartao = await ultimoCartao();
    expect(within(cartao).getByText('Casa')).toBeTruthy();
    expect(within(cartao).getByText('"Lâmpada" costuma ser Casa.')).toBeTruthy();
    const [salva] = await esperarTarefas(1);

    fireEvent.click(within(cartao).getByRole('button', { name: 'Trocar sala' }));
    fireEvent.click(within(cartao).getByRole('button', { name: 'Pessoal' }));

    await within(cartao).findByText('Vou lembrar: "lâmpada" fica em Pessoal.');
    expect(within(cartao).queryByText('Casa')).toBeNull();
    expect(within(cartao).getByText('Pessoal')).toBeTruthy();
    await waitFor(async () => expect((await tarefas())[0]).toMatchObject({ id: salva.id, salaId: 'sala-pessoal' }));
    const lampadas = (await listar('palavras')).filter((p) => p.termo === 'lâmpada');
    expect(lampadas).toEqual([expect.objectContaining({ id: 'palavra-lampada', salaId: 'sala-pessoal' })]);

    dizer('Comprar lâmpada nova');
    const segundo = within(await ultimoCartao(2));
    expect(segundo.getByText('Pessoal')).toBeTruthy();
    expect(segundo.getByText('"Lâmpada" costuma ser Pessoal.')).toBeTruthy();
  });

  it('Trocar sala de pessoa cadastrada muda a sala da pessoa', async () => {
    const marina = await salvar('pessoas', { nome: 'Marina', salaId: 'sala-orientacoes' });
    render(<Chat />);
    dizer('Ligar para a Marina');
    const cartao = await ultimoCartao();
    await esperarTarefas(1);

    fireEvent.click(within(cartao).getByRole('button', { name: 'Trocar sala' }));
    fireEvent.click(within(cartao).getByRole('button', { name: 'Aulas' }));

    await within(cartao).findByText('Vou lembrar: Marina fica em Aulas.');
    await waitFor(async () =>
      expect((await listar('pessoas')).find((p) => p.id === marina.id)?.salaId).toBe('sala-aulas'),
    );
  });

  it('Trocar sala quando a frase disse a sala não cria palavra', async () => {
    render(<Chat />);
    dizer('Adicione Revisar paragrafo do relatório 1 nas tarefas do doutoramento');
    const cartao = await ultimoCartao();
    expect(within(cartao).getByText('Doutoramento')).toBeTruthy();
    expect(within(cartao).getByText('A frase diz a sala.')).toBeTruthy();
    await esperarTarefas(1);
    const antes = await listar('palavras');

    fireEvent.click(within(cartao).getByRole('button', { name: 'Trocar sala' }));
    fireEvent.click(within(cartao).getByRole('button', { name: 'Investigação' }));

    await within(cartao).findByText('Sala escolhida por você.');
    await waitFor(async () => expect((await tarefas())[0].salaId).toBe('sala-investigacao'));
    expect(await listar('palavras')).toEqual(antes);
  });

  it('sem sala e sem pessoa, as salas já aparecem para escolher', async () => {
    render(<Chat />);
    dizer('Comprar pão');
    const cartao = await ultimoCartao();
    expect(within(cartao).getByText('Sem sala')).toBeTruthy();
    expect(within(cartao).getByText('Nada na frase indica a sala.')).toBeTruthy();
    await esperarTarefas(1);

    fireEvent.click(within(cartao).getByRole('button', { name: 'Casa' }));

    await within(cartao).findByText('Sala escolhida por você.');
    await waitFor(async () => expect((await tarefas())[0].salaId).toBe('sala-casa'));
  });

  it('Desfazer remove', async () => {
    render(<Chat />);
    dizer('Preciso parafusar o apoio do banheiro');
    const cartao = await ultimoCartao();
    await esperarTarefas(1);

    fireEvent.click(within(cartao).getByRole('button', { name: 'Desfazer' }));

    await within(cartao).findByText('Desfeito. Nada ficou guardado.');
    expect(await tarefas()).toEqual([]);
    expect(within(cartao).queryByRole('button')).toBeNull();
  });

  it('Desfazer depois de Trocar sala também remove', async () => {
    render(<Chat />);
    dizer('Trocar a lâmpada da garagem');
    const cartao = await ultimoCartao();
    await esperarTarefas(1);
    fireEvent.click(within(cartao).getByRole('button', { name: 'Trocar sala' }));
    fireEvent.click(within(cartao).getByRole('button', { name: 'Pessoal' }));
    await within(cartao).findByText('Vou lembrar: "lâmpada" fica em Pessoal.');

    fireEvent.click(within(cartao).getByRole('button', { name: 'Desfazer' }));

    await within(cartao).findByText('Desfeito. Nada ficou guardado.');
    await waitFor(async () => expect(await tarefas()).toEqual([]));
  });

  it('com certeza baixa, o cartão pede confirmação e não guarda sozinho', async () => {
    render(<Chat />);
    dizer('asdf qwer');
    const cartao = await ultimoCartao();

    expect(within(cartao).getByText('Confira antes de guardar.')).toBeTruthy();
    expect(within(cartao).queryByRole('button', { name: 'Desfazer' })).toBeNull();
    await new Promise((pronto) => setTimeout(pronto, 30));
    expect(await tarefas()).toEqual([]);

    fireEvent.click(within(cartao).getByRole('button', { name: 'Guardar' }));

    await within(cartao).findByRole('button', { name: 'Desfazer' });
    expect(within(cartao).queryByText('Confira antes de guardar.')).toBeNull();
    expect((await esperarTarefas(1))[0].titulo).toBe('Asdf qwer');
  });

  it('com certeza baixa, Descartar não guarda nada', async () => {
    render(<Chat />);
    dizer('asdf qwer');
    const cartao = await ultimoCartao();

    fireEvent.click(within(cartao).getByRole('button', { name: 'Descartar' }));

    await within(cartao).findByText('Descartado. Nada ficou guardado.');
    expect(await tarefas()).toEqual([]);
  });

  it('com certeza baixa, trocar a sala antes de guardar guarda na sala escolhida', async () => {
    render(<Chat />);
    dizer('asdf qwer');
    const cartao = await ultimoCartao();
    fireEvent.click(within(cartao).getByRole('button', { name: 'MBA' }));
    await within(cartao).findByText('Sala escolhida por você.');
    expect(await tarefas()).toEqual([]);

    fireEvent.click(within(cartao).getByRole('button', { name: 'Guardar' }));

    expect((await esperarTarefas(1))[0].salaId).toBe('sala-mba');
  });
});

/** Faz o IndexedDB falhar até chamar a função devolvida. */
function quebrarBanco() {
  const real = globalThis.indexedDB;
  globalThis.indexedDB = { open() { throw new Error('disco cheio'); } } as unknown as IDBFactory;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  return () => {
    globalThis.indexedDB = real;
  };
}

const esperar = (ms = 40) => new Promise((pronto) => setTimeout(pronto, ms));

describe('pessoa e aprendizado (rodada 1)', () => {
  it('"Viagem para Lisboa": Não é pessoa tira a pergunta e a sala escolhida não cria pessoa', async () => {
    render(<Chat />);
    // Sem verbo: certeza baixa, o cartão espera o Guardar.
    dizer('Viagem para Lisboa');
    const cartao = await ultimoCartao();
    expect(within(cartao).getByText('Em que sala fica Lisboa?')).toBeTruthy();

    fireEvent.click(within(cartao).getByRole('button', { name: 'Não é pessoa' }));

    expect(within(cartao).queryByText('Em que sala fica Lisboa?')).toBeNull();
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Doutoramento'));
    fireEvent.click(within(cartao).getByRole('button', { name: 'Pessoal' }));
    await within(cartao).findByText('Sala escolhida por você.');
    fireEvent.click(within(cartao).getByRole('button', { name: 'Guardar' }));

    expect((await esperarTarefas(1))[0].salaId).toBe('sala-pessoal');
    expect(await listar('pessoas')).toEqual([]);
  });

  it('item já guardado: Não é pessoa e depois a sala não cria pessoa e muda a tarefa', async () => {
    render(<Chat />);
    dizer('Comprar passagem para Lisboa');
    const cartao = await ultimoCartao();
    expect(within(cartao).getByText('Em que sala fica Lisboa?')).toBeTruthy();
    await esperarTarefas(1);

    fireEvent.click(within(cartao).getByRole('button', { name: 'Não é pessoa' }));
    fireEvent.click(within(cartao).getByRole('button', { name: 'Pessoal' }));

    await within(cartao).findByText('Sala escolhida por você.');
    await waitFor(async () => expect((await tarefas())[0].salaId).toBe('sala-pessoal'));
    expect(await listar('pessoas')).toEqual([]);
  });

  it('certeza baixa: a pessoa nova só é guardada ao Guardar', async () => {
    render(<Chat />);
    dizer('mensagem para Renata às 15h');
    const cartao = await ultimoCartao();
    expect(within(cartao).getByText('Confira antes de guardar.')).toBeTruthy();

    fireEvent.click(within(cartao).getByRole('button', { name: 'Orientações' }));
    await within(cartao).findByText('Vou lembrar: Renata fica em Orientações.');
    await esperar();
    expect(await listar('pessoas')).toEqual([]);

    fireEvent.click(within(cartao).getByRole('button', { name: 'Guardar' }));

    const [salva] = await esperarTarefas(1);
    const pessoas = await listar('pessoas');
    expect(pessoas).toEqual([expect.objectContaining({ nome: 'Renata', salaId: 'sala-orientacoes' })]);
    expect(salva).toMatchObject({ salaId: 'sala-orientacoes', pessoaId: pessoas[0].id });
  });

  it('certeza baixa: Descartar depois de responder a pergunta não guarda a pessoa', async () => {
    render(<Chat />);
    dizer('mensagem para Renata às 15h');
    const cartao = await ultimoCartao();
    fireEvent.click(within(cartao).getByRole('button', { name: 'Orientações' }));
    await within(cartao).findByText('Vou lembrar: Renata fica em Orientações.');

    fireEvent.click(within(cartao).getByRole('button', { name: 'Descartar' }));

    await within(cartao).findByText('Descartado. Nada ficou guardado.');
    await esperar();
    expect(await listar('pessoas')).toEqual([]);
    expect(await tarefas()).toEqual([]);
  });

  it('certeza baixa: Trocar sala só aprende a palavra ao Guardar, e Descartar não aprende', async () => {
    const salaDaLampada = async () => (await listar('palavras')).find((p) => p.id === 'palavra-lampada')?.salaId;
    render(<Chat />);
    dizer('Trocar a lâmpada às 15h');
    const primeiro = await ultimoCartao();
    expect(within(primeiro).getByText('Confira antes de guardar.')).toBeTruthy();
    fireEvent.click(within(primeiro).getByRole('button', { name: 'Trocar sala' }));
    fireEvent.click(within(primeiro).getByRole('button', { name: 'Pessoal' }));
    await within(primeiro).findByText('Vou lembrar: "lâmpada" fica em Pessoal.');
    await esperar();
    expect(await salaDaLampada()).toBe('sala-casa');

    fireEvent.click(within(primeiro).getByRole('button', { name: 'Descartar' }));
    await within(primeiro).findByText('Descartado. Nada ficou guardado.');
    expect(await salaDaLampada()).toBe('sala-casa');

    dizer('Trocar a lâmpada às 16h');
    const segundo = await ultimoCartao(2);
    fireEvent.click(within(segundo).getByRole('button', { name: 'Trocar sala' }));
    fireEvent.click(within(segundo).getByRole('button', { name: 'Pessoal' }));
    await within(segundo).findByText('Vou lembrar: "lâmpada" fica em Pessoal.');
    fireEvent.click(within(segundo).getByRole('button', { name: 'Guardar' }));

    expect((await esperarTarefas(1))[0].salaId).toBe('sala-pessoal');
    expect(await salaDaLampada()).toBe('sala-pessoal');
  });

  it('Trocar sala enquanto o item ainda está sendo guardado vale para a tarefa guardada', async () => {
    render(<Chat />);
    dizer('Trocar a lâmpada da garagem');
    const cartao = await screen.findByRole('article');
    fireEvent.click(within(cartao).getByRole('button', { name: 'Trocar sala' }));
    fireEvent.click(within(cartao).getByRole('button', { name: 'Pessoal' }));

    await within(cartao).findByText('Vou lembrar: "lâmpada" fica em Pessoal.');
    await waitFor(async () => expect(await tarefas()).toEqual([expect.objectContaining({ salaId: 'sala-pessoal' })]));
  });

  it('responder a pergunta enquanto o item ainda está sendo guardado liga a pessoa à tarefa', async () => {
    render(<Chat />);
    dizer('Adicione em atividades do dia mandar mensagem para Renata');
    const cartao = await screen.findByRole('article');
    fireEvent.click(within(cartao).getByRole('button', { name: 'Orientações' }));

    await within(cartao).findByText('Vou lembrar: Renata fica em Orientações.');
    await waitFor(async () => {
      const [renata] = await listar('pessoas');
      expect(renata).toBeTruthy();
      expect(await tarefas()).toEqual([expect.objectContaining({ salaId: 'sala-orientacoes', pessoaId: renata.id })]);
    });
  });

  it('Trocar sala e Desfazer logo em seguida: a tarefa não volta', async () => {
    render(<Chat />);
    dizer('Trocar a lâmpada da garagem');
    const cartao = await ultimoCartao();
    await esperarTarefas(1);
    fireEvent.click(within(cartao).getByRole('button', { name: 'Trocar sala' }));
    fireEvent.click(within(cartao).getByRole('button', { name: 'Pessoal' }));
    fireEvent.click(within(cartao).getByRole('button', { name: 'Desfazer' }));

    await within(cartao).findByText('Desfeito. Nada ficou guardado.');
    await esperar(80);
    expect(await tarefas()).toEqual([]);
  });
});

describe('erros, foco e campo (rodada 1)', () => {
  it('erro ao guardar: o cartão avisa e Guardar tenta de novo', async () => {
    render(<Chat />);
    dizer('asdf qwer');
    const cartao = await ultimoCartao();
    const consertar = quebrarBanco();

    fireEvent.click(within(cartao).getByRole('button', { name: 'Guardar' }));
    await within(cartao).findByText('Não consegui guardar. Tente de novo.');
    consertar();

    fireEvent.click(within(cartao).getByRole('button', { name: 'Guardar' }));
    await within(cartao).findByRole('button', { name: 'Desfazer' });
    expect(await esperarTarefas(1)).toHaveLength(1);
  });

  it('erro ao desfazer: o item continua guardado, com aviso, e Desfazer tenta de novo', async () => {
    render(<Chat />);
    dizer('Preciso parafusar o apoio do banheiro');
    const cartao = await ultimoCartao();
    await esperarTarefas(1);
    const consertar = quebrarBanco();

    fireEvent.click(within(cartao).getByRole('button', { name: 'Desfazer' }));
    await within(cartao).findByText('Não consegui desfazer. Tente de novo.');
    consertar();
    expect(await tarefas()).toHaveLength(1);

    fireEvent.click(within(cartao).getByRole('button', { name: 'Desfazer' }));
    await within(cartao).findByText('Desfeito. Nada ficou guardado.');
    expect(await tarefas()).toEqual([]);
  });

  it('o cartão só diz Desfeito depois de apagar: com erro, nunca passa por desfeito', async () => {
    render(<Chat />);
    dizer('Preciso parafusar o apoio do banheiro');
    const cartao = await ultimoCartao();
    await esperarTarefas(1);
    const vistas: string[] = [];
    const parar = assinarConversa(() => {
      for (const m of lerConversa()) if (m.de === 'central') for (const c of m.cartoes) vistas.push(c.situacao);
    });
    const consertar = quebrarBanco();

    fireEvent.click(within(cartao).getByRole('button', { name: 'Desfazer' }));
    await within(cartao).findByText('Não consegui desfazer. Tente de novo.');
    consertar();
    parar();

    expect(vistas).toContain('desfazendo');
    expect(vistas).not.toContain('desfeito');
  });

  it.each([
    ['Guardar', 'Descartar'],
    ['Descartar', 'Guardar'],
  ])('%s e logo %s: só a primeira vale, e o foco fica no cartão', async (primeiro, segundo) => {
    render(<Chat />);
    dizer('asdf qwer');
    const cartao = await ultimoCartao();

    fireEvent.click(within(cartao).getByRole('button', { name: primeiro }));
    fireEvent.click(within(cartao).getByRole('button', { name: segundo }));

    if (primeiro === 'Guardar') await within(cartao).findByRole('button', { name: 'Desfazer' });
    else await within(cartao).findByText('Descartado. Nada ficou guardado.');
    await waitFor(() => expect(document.activeElement).toBe(cartao));
    expect(await tarefas()).toHaveLength(primeiro === 'Guardar' ? 1 : 0);
  });

  it('Manter a sala fecha a escolha sem mudar nada e devolve o foco a Trocar sala', async () => {
    render(<Chat />);
    dizer('Trocar a lâmpada da garagem');
    const cartao = await ultimoCartao();
    await esperarTarefas(1);
    fireEvent.click(within(cartao).getByRole('button', { name: 'Trocar sala' }));

    fireEvent.click(within(cartao).getByRole('button', { name: 'Manter a sala' }));

    expect(within(cartao).queryByRole('button', { name: 'Pessoal' })).toBeNull();
    expect(within(cartao).getByText('Casa')).toBeTruthy();
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Trocar sala'));
    await esperar();
    expect((await tarefas())[0].salaId).toBe('sala-casa');
  });

  it.each([
    ['Guardar', 'asdf qwer', 'Desfazer'],
    ['Descartar', 'asdf qwer', 'Descartado. Nada ficou guardado.'],
    ['Desfazer', 'Preciso parafusar o apoio do banheiro', 'Desfeito. Nada ficou guardado.'],
  ])('depois de %s, o foco fica no cartão', async (botao, frase, depois) => {
    render(<Chat />);
    dizer(frase);
    const cartao = await ultimoCartao();
    if (botao === 'Desfazer') await esperarTarefas(1);

    fireEvent.click(within(cartao).getByRole('button', { name: botao }));

    await within(cartao).findAllByText(depois);
    await waitFor(() => expect(document.activeElement).toBe(cartao));
  });

  it('com o campo em uso, respostas e mudanças na loja não apagam o texto nem tiram o foco', async () => {
    render(<Chat />);
    dizer('Preciso parafusar o apoio do banheiro');
    const entrada = campo();
    entrada.focus();
    fireEvent.input(entrada, { target: { value: 'Comprar' } });

    const cartao = await ultimoCartao();
    await esperarTarefas(1);
    const casa = (await listar('salas')).find((sala) => sala.id === 'sala-casa')!;
    await salvar('salas', { ...casa, nome: 'Lar' });
    await within(cartao).findByText('Lar');

    expect(campo().value).toBe('Comprar');
    expect(document.activeElement).toBe(campo());
  });

  it('a região que o leitor de tela acompanha existe antes da primeira mensagem e é a mesma depois', async () => {
    render(<Chat />);
    const regiao = screen.getByRole('log');
    dizer('Preciso parafusar o apoio do banheiro');
    await ultimoCartao();
    expect(screen.getByRole('log')).toBe(regiao);
    expect(within(regiao).getByText('Anotei.')).toBeTruthy();
  });
});

describe('conversa', () => {
  it('a frase aparece como mensagem do dono e o campo fica limpo', async () => {
    render(<Chat />);
    dizer('Preciso parafusar o apoio do banheiro');
    await ultimoCartao();

    // O título do cartão repete a frase; a mensagem do dono é a que está fora do cartão.
    const doDono = screen.getAllByText('Preciso parafusar o apoio do banheiro').filter((el) => !el.closest('article'));
    expect(doDono).toHaveLength(1);
    expect(campo().value).toBe('');
    expect(screen.getByText('Anotei.')).toBeTruthy();
  });

  it('Enter no campo envia', async () => {
    render(<Chat />);
    fireEvent.input(campo(), { target: { value: 'Preciso parafusar o apoio do banheiro' } });
    fireEvent.submit(campo().closest('form')!);
    await ultimoCartao();
    await esperarTarefas(1);
  });

  it('frase em branco não envia nada', async () => {
    render(<Chat />);
    dizer('    ');
    await new Promise((pronto) => setTimeout(pronto, 30));
    expect(screen.queryAllByRole('article')).toEqual([]);
    expect(within(screen.getByRole('log')).queryAllByText(/./)).toEqual([]);
  });

  it('sem conversa, diz o que fazer', () => {
    render(<Chat />);
    expect(screen.getByText(/Escreva o que precisa fazer/)).toBeTruthy();
  });

  it('o texto é mostrado como texto: nada de HTML da frase vira elemento', async () => {
    render(<Chat />);
    dizer('<img src=x onerror="alert(1)"> Comprar pão');
    await ultimoCartao();

    expect(document.querySelector('img')).toBeNull();
    const literais = screen.getAllByText('<img src=x onerror="alert(1)"> Comprar pão');
    expect(literais.filter((el) => !el.closest('article'))).toHaveLength(1);
  });

  it('não tem botão de microfone: o ditado é o do teclado', () => {
    render(<Chat />);
    expect(screen.queryByRole('button', { name: /microfone|ditar|falar|voz/i })).toBeNull();
    const formulario = campo().closest('form')!;
    expect(within(formulario).getAllByRole('button').map((b) => b.textContent)).toEqual(['Enviar']);
  });

  it('pessoa desconhecida: a resposta avisa que ainda não conhece', async () => {
    render(<Chat />);
    dizer('Adicione em atividades do dia mandar mensagem para Renata');
    await ultimoCartao();
    expect(screen.getByText('Anotei. Ainda não conheço Renata.')).toBeTruthy();
  });

  it('com certeza baixa, a resposta diz para conferir', async () => {
    render(<Chat />);
    dizer('asdf qwer');
    await ultimoCartao();
    expect(screen.getByText('Não tenho certeza. Confira o cartão.')).toBeTruthy();
  });

  it('o que se digita não é apagado quando a resposta chega', async () => {
    render(<Chat />);
    dizer('Preciso parafusar o apoio do banheiro');
    fireEvent.input(campo(), { target: { value: 'Comprar' } });
    await ultimoCartao();
    await esperarTarefas(1);
    expect(campo().value).toBe('Comprar');
  });

  it('Trocar sala leva o foco à primeira sala', async () => {
    render(<Chat />);
    dizer('Trocar a lâmpada da garagem');
    const cartao = await ultimoCartao();
    await esperarTarefas(1);

    fireEvent.click(within(cartao).getByRole('button', { name: 'Trocar sala' }));

    await waitFor(() => expect(document.activeElement?.textContent).toBe('Doutoramento'));
  });

  it('as salas da escolha seguem a ordem do dono e o nome atual', async () => {
    const [primeira] = (await listar('salas')).sort((a, b) => a.ordem - b.ordem);
    await salvar('salas', { ...primeira, nome: 'Tese' });
    render(<Chat />);
    dizer('Comprar pão');
    const cartao = await ultimoCartao();

    await waitFor(() =>
      expect(within(cartao).getAllByRole('button').map((b) => b.textContent).slice(0, 7)).toEqual([
        'Tese', 'Investigação', 'Aulas', 'Orientações', 'MBA', 'Pessoal', 'Casa',
      ]),
    );
  });

  it('dois itens enviados em seguida ficam na ordem em que foram ditos', async () => {
    render(<Chat />);
    dizer('Primeira coisa a fazer');
    dizer('Segunda coisa a fazer');
    await ultimoCartao(2);
    const cartoes = screen.getAllByRole('article');
    expect(within(cartoes[0]).getByText('Primeira coisa a fazer')).toBeTruthy();
    expect(within(cartoes[1]).getByText('Segunda coisa a fazer')).toBeTruthy();
  });
});

describe('o chat na casca', () => {
  function irPara(hash: string, largura: number) {
    Object.defineProperty(window, 'innerWidth', { value: largura, configurable: true, writable: true });
    history.replaceState(null, '', `/${hash}`);
  }

  it('no computador, o painel direito tem o chat', async () => {
    irPara('#/', 1280);
    render(<App />);
    const painel = screen.getByRole('complementary', { name: 'Agora e chat' });

    dizer('Preciso parafusar o apoio do banheiro', painel);

    expect(within(await within(painel).findByRole('article')).getByText('Casa')).toBeTruthy();
    expect(screen.queryByText('Aqui você escreve para a Central, como falaria com uma pessoa.')).toBeNull();
  });

  it('em #/chat no celular, o chat é a página', async () => {
    irPara('#/chat', 390);
    render(<App />);
    const principal = screen.getByRole('main');
    expect(within(principal).getByRole('heading', { level: 1, name: 'Chat' })).toBeTruthy();

    dizer('Preciso parafusar o apoio do banheiro', principal);
    expect(within(await within(principal).findByRole('article')).getByText('Casa')).toBeTruthy();
  });

  it('em #/chat no computador há um chat só (o do painel some)', () => {
    irPara('#/chat', 1280);
    render(<App />);
    expect(screen.getAllByRole('textbox', { name: 'Escreva ou dite' })).toHaveLength(1);
    expect(within(screen.getByRole('main')).getByRole('textbox', { name: 'Escreva ou dite' })).toBeTruthy();
    const painel = screen.getByRole('complementary', { name: 'Agora e chat' });
    expect(within(painel).queryByRole('heading', { name: 'Chat' })).toBeNull();
  });

  it('a conversa continua ao trocar do painel para a página do chat', async () => {
    irPara('#/', 1280);
    render(<App />);
    const painel = screen.getByRole('complementary', { name: 'Agora e chat' });
    dizer('Preciso parafusar o apoio do banheiro', painel);
    await within(painel).findByRole('article');
    await esperarTarefas(1);

    act(() => {
      location.hash = '#/chat';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });

    const principal = screen.getByRole('main');
    expect(within(principal).getAllByText('Preciso parafusar o apoio do banheiro')).toHaveLength(2);
    expect(within(principal).getByRole('article')).toBeTruthy();
    // Voltar a mostrar o cartão não guarda de novo.
    await new Promise((pronto) => setTimeout(pronto, 30));
    expect(await tarefas()).toHaveLength(1);
  });
});

describe('descreverQuando', () => {
  const HOJE = '2026-11-05';
  const item = (extra: Partial<ItemDoChat>): ItemDoChat => ({
    tipo: 'tarefa', titulo: 'x', salaId: null, marcar: false, certeza: 'alta', ...extra,
  });

  it.each<[string, Partial<ItemDoChat>, string]>([
    ['sem prazo', {}, 'Sem prazo'],
    ['hoje', { data: '2026-11-05' }, 'Hoje'],
    ['amanhã: o dia da semana confirma qual sexta', { data: '2026-11-06' }, 'Sexta, 6/11'],
    ['outro dia', { data: '2026-11-09' }, 'Segunda, 9/11'],
    ['outro ano', { data: '2027-01-04' }, 'Segunda, 4/1/2027'],
    ['esta semana', { semana: '2026-11-02' }, 'Esta semana'],
    ['próxima semana', { semana: '2026-11-09' }, 'Próxima semana'],
    ['semana mais longe', { semana: '2026-11-23' }, 'Semana de 23/11'],
    ['prazo com hora', { data: '2026-11-06', prazoHora: '17:00' }, 'Até sexta, 6/11, às 17:00'],
    ['prazo hoje', { data: '2026-11-05', prazoHora: '18:00' }, 'Até hoje, às 18:00'],
    ['prazo sem hora', { data: '2026-11-06' }, 'Sexta, 6/11'],
    ['prazo noutro dia', { data: '2026-11-10', prazoHora: '09:30' }, 'Até terça, 10/11, às 09:30'],
    ['compromisso hoje', { tipo: 'compromisso', data: '2026-11-05', inicio: '15:00', fim: '16:00' }, 'Hoje, 15:00 às 16:00'],
    ['compromisso sexta', { tipo: 'compromisso', data: '2026-11-06', inicio: '11:00', fim: '12:00' }, 'Sexta, 6/11, 11:00 às 12:00'],
    ['compromisso sábado', { tipo: 'compromisso', data: '2026-11-07', inicio: '11:00', fim: '12:00' }, 'Sábado, 7/11, 11:00 às 12:00'],
  ])('%s', (_nome, extra, texto) => {
    expect(descreverQuando(item(extra), HOJE)).toBe(texto);
  });
});
