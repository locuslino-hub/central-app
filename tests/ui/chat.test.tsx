import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { limparConversa } from '../../src/chat/conversa';
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
