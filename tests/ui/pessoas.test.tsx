import { fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { carregarMemoria } from '../../src/chat/memoria';
import { apagar, gravarDoServidor, listar, listarPendentes, salvar, semear } from '../../src/dados/loja';
import { Pessoas } from '../../src/ui/Pessoas';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-11-05T12:20:00Z'));
  await semear();
});

const campoNome = () => screen.getByLabelText('Nome') as HTMLInputElement;
const campoSala = () => screen.getByLabelText('Sala') as HTMLSelectElement;
const campoPapel = () => screen.getByLabelText('Papel (opcional)') as HTMLInputElement;
const cadastrar = () => fireEvent.click(screen.getByRole('button', { name: 'Cadastrar pessoa' }));

function preencher(nome: string, salaId: string, papel = '') {
  fireEvent.input(campoNome(), { target: { value: nome } });
  fireEvent.change(campoSala(), { target: { value: salaId } });
  fireEvent.input(campoPapel(), { target: { value: papel } });
}

async function pronta() {
  render(<Pessoas />);
  await waitFor(() => expect(campoSala().options.length).toBeGreaterThan(7));
}

describe('cadastro de pessoas', () => {
  it('a sala oferece as 7 salas, na ordem, e começa sem escolha', async () => {
    await pronta();
    expect(Array.from(campoSala().options).map((o) => o.textContent)).toEqual([
      'Escolha a sala',
      'Doutoramento',
      'Investigação',
      'Aulas',
      'Orientações',
      'MBA',
      'Pessoal',
      'Casa',
    ]);
    expect(campoSala().value).toBe('');
  });

  it('cadastra nome, sala e papel pela loja, com pendente para sincronizar', async () => {
    await pronta();
    preencher('  Marina  ', 'sala-orientacoes', 'aluna');
    cadastrar();

    await waitFor(async () => expect(await listar('pessoas')).toHaveLength(1));
    const [pessoa] = await listar('pessoas');
    expect(pessoa).toMatchObject({ nome: 'Marina', salaId: 'sala-orientacoes', papel: 'aluna' });
    expect(await listarPendentes()).toMatchObject([{ colecao: 'pessoas', id: pessoa.id }]);
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Marina cadastrada em Orientações.'));
  });

  it('papel em branco não é guardado', async () => {
    await pronta();
    preencher('Prof. Souza', 'sala-doutoramento', '   ');
    cadastrar();
    await waitFor(async () => expect(await listar('pessoas')).toHaveLength(1));
    expect('papel' in (await listar('pessoas'))[0]).toBe(false);
  });

  it('depois de cadastrar, limpa nome e papel, mantém a sala e põe o foco no nome', async () => {
    await pronta();
    preencher('Marina', 'sala-orientacoes', 'aluna');
    cadastrar();
    await screen.findByText('Marina cadastrada em Orientações.');
    expect(campoNome().value).toBe('');
    expect(campoPapel().value).toBe('');
    expect(campoSala().value).toBe('sala-orientacoes');
    expect(document.activeElement).toBe(campoNome());
  });

  it('quem já começou a digitar a pessoa seguinte não perde o texto quando a anterior termina de gravar', async () => {
    await pronta();
    preencher('Marina', 'sala-orientacoes');
    cadastrar();
    fireEvent.input(campoNome(), { target: { value: 'Rena' } });
    await screen.findByText('Marina cadastrada em Orientações.');
    expect(campoNome().value).toBe('Rena');
  });

  it('Enter no campo de nome cadastra', async () => {
    await pronta();
    preencher('Renata', 'sala-orientacoes');
    fireEvent.submit(campoNome().closest('form') as HTMLFormElement);
    await waitFor(async () => expect(await listar('pessoas')).toHaveLength(1));
  });

  it('sem nome: pede o nome, foca o campo e não grava', async () => {
    await pronta();
    preencher('   ', 'sala-aulas');
    cadastrar();
    expect((await screen.findByRole('alert')).textContent).toBe('Escreva o nome.');
    expect(document.activeElement).toBe(campoNome());
    expect(campoNome().getAttribute('aria-invalid')).toBe('true');
    expect(await listar('pessoas')).toEqual([]);
  });

  it('sem sala: pede a sala, foca o campo e não grava', async () => {
    await pronta();
    preencher('Marina', '');
    cadastrar();
    expect((await screen.findByRole('alert')).textContent).toBe('Escolha a sala.');
    expect(document.activeElement).toBe(campoSala());
    expect(await listar('pessoas')).toEqual([]);
  });

  it('o aviso some quando se corrige', async () => {
    await pronta();
    preencher('', 'sala-aulas');
    cadastrar();
    await screen.findByRole('alert');
    fireEvent.input(campoNome(), { target: { value: 'M' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('nome repetido (sem ligar para maiúscula ou acento) não cadastra de novo e diz onde está', async () => {
    await salvar('pessoas', { nome: 'Aurora', salaId: 'sala-orientacoes' });
    await pronta();
    preencher('ÁURORA', 'sala-casa');
    cadastrar();
    expect((await screen.findByRole('alert')).textContent).toBe('Aurora já está cadastrada em Orientações.');
    expect(await listar('pessoas')).toHaveLength(1);
  });

  it('pessoa apagada pode ser cadastrada de novo', async () => {
    const velha = await salvar('pessoas', { nome: 'Marina', salaId: 'sala-orientacoes' });
    await apagar('pessoas', velha.id);
    await pronta();
    preencher('Marina', 'sala-aulas');
    cadastrar();
    await waitFor(async () => expect(await listar('pessoas')).toHaveLength(1));
  });

  it('texto vira só texto: nada de HTML da digitação', async () => {
    await pronta();
    preencher('<img src=x onerror=alert(1)>', 'sala-aulas', '<b>papel</b>');
    cadastrar();
    await screen.findByText('<img src=x onerror=alert(1)> cadastrada em Aulas.');
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('b')).toBeNull();
  });
});

describe('lista de pessoas', () => {
  it('mostra por sala, na ordem das salas, com o papel', async () => {
    await salvar('pessoas', { nome: 'Renata', salaId: 'sala-orientacoes', papel: 'aluna' });
    await salvar('pessoas', { nome: 'Marina', salaId: 'sala-orientacoes' });
    await salvar('pessoas', { nome: 'Prof. Souza', salaId: 'sala-doutoramento', papel: 'orientador' });
    await pronta();

    const doutoramento = within(await screen.findByRole('group', { name: 'Doutoramento' }));
    expect(doutoramento.getByText('Prof. Souza')).toBeTruthy();
    expect(doutoramento.getByText('orientador')).toBeTruthy();
    const orientacoes = within(screen.getByRole('group', { name: 'Orientações' }));
    expect(orientacoes.getAllByRole('listitem').map((li) => li.querySelector('.pessoa-nome')?.textContent)).toEqual([
      'Marina',
      'Renata',
    ]);
    expect(screen.getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual(['Doutoramento', 'Orientações']);
  });

  it('sem ninguém, diz para que serve o cadastro', async () => {
    await pronta();
    expect(await screen.findByText('Nenhuma pessoa cadastrada.')).toBeTruthy();
    expect(screen.getByText('Cadastre quem aparece nas suas tarefas. O Chat passa a saber a sala delas.')).toBeTruthy();
  });

  it('pessoa que chega de outro aparelho aparece sem recarregar e sem tocar no que se digita', async () => {
    await pronta();
    fireEvent.input(campoNome(), { target: { value: 'Aur' } });
    campoNome().focus();
    await gravarDoServidor([
      {
        colecao: 'pessoas',
        registro: { id: 'p1', nome: 'Aurora', salaId: 'sala-mba', atualizadoEm: 1, aparelho: 'celular' },
      },
    ]);
    expect(await screen.findByText('Aurora')).toBeTruthy();
    expect(campoNome().value).toBe('Aur');
    expect(document.activeElement).toBe(campoNome());
  });

  it('Apagar remove da lista, avisa e oferece Desfazer, que traz a pessoa de volta', async () => {
    await salvar('pessoas', { nome: 'Marina', salaId: 'sala-orientacoes' });
    await pronta();
    fireEvent.click(await screen.findByRole('button', { name: 'Apagar Marina' }));

    await waitFor(async () => expect(await listar('pessoas')).toEqual([]));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Marina apagada.'));
    await waitFor(() => expect(screen.queryByText('Marina', { selector: '.pessoa-nome' })).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Desfazer' }));
    await waitFor(async () => expect(await listar('pessoas')).toHaveLength(1));
    expect(await screen.findByText('Marina', { selector: '.pessoa-nome' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Desfazer' })).toBeNull();
  });

  it('o chat passa a conhecer a pessoa cadastrada e esquece a apagada', async () => {
    await pronta();
    preencher('Marina', 'sala-orientacoes');
    cadastrar();
    await waitFor(async () => expect((await carregarMemoria()).pessoaPorId((await listar('pessoas'))[0]?.id ?? '')).toBeTruthy());
    const [marina] = await listar('pessoas');
    fireEvent.click(await screen.findByRole('button', { name: 'Apagar Marina' }));
    await waitFor(async () => expect((await carregarMemoria()).pessoaPorId(marina.id)).toBeUndefined());
  });

  it('apagar pessoa que já sumiu em outro aparelho não quebra', async () => {
    const p = await salvar('pessoas', { nome: 'Marina', salaId: 'sala-orientacoes' });
    await pronta();
    const botao = await screen.findByRole('button', { name: 'Apagar Marina' });
    await apagar('pessoas', p.id);
    fireEvent.click(botao);
    await new Promise((r) => setTimeout(r, 30));
    expect(await listar('pessoas')).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Desfazer' })).toBeNull();
  });
});

describe('cadastrar com dois toques seguidos', () => {
  it('cria uma pessoa só', async () => {
    await pronta();
    preencher('Marina', 'sala-orientacoes');
    cadastrar();
    cadastrar();
    await waitFor(async () => expect(await listar('pessoas')).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 40));
    expect(await listar('pessoas')).toHaveLength(1);
  });
});

describe('editar pessoa', () => {
  const editar = (nome: string) => fireEvent.click(screen.getByRole('button', { name: `Editar ${nome}` }));
  const nomeEditado = () => screen.getByLabelText('Nome da pessoa') as HTMLInputElement;

  it('Editar abre nome, sala e papel já preenchidos, com o foco no nome', async () => {
    await salvar('pessoas', { nome: 'Marina', salaId: 'sala-orientacoes', papel: 'aluna' });
    await pronta();
    await screen.findByText('Marina', { selector: '.pessoa-nome' });
    editar('Marina');
    expect(nomeEditado().value).toBe('Marina');
    expect((screen.getByLabelText('Sala da pessoa') as HTMLSelectElement).value).toBe('sala-orientacoes');
    expect((screen.getByLabelText('Papel da pessoa') as HTMLInputElement).value).toBe('aluna');
    await waitFor(() => expect(document.activeElement).toBe(nomeEditado()));
  });

  it('Salvar muda nome, sala e papel na loja (mesmo id, sem duplicar) e a pessoa muda de grupo', async () => {
    const m = await salvar('pessoas', { nome: 'Marnia', salaId: 'sala-orientacoes', emails: ['marina@exemplo.invalid'] });
    await pronta();
    await screen.findByText('Marnia', { selector: '.pessoa-nome' });
    editar('Marnia');
    fireEvent.input(nomeEditado(), { target: { value: 'Marina' } });
    fireEvent.change(screen.getByLabelText('Sala da pessoa'), { target: { value: 'sala-aulas' } });
    fireEvent.input(screen.getByLabelText('Papel da pessoa'), { target: { value: 'aluna' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(async () => expect(await listar('pessoas')).toMatchObject([{ id: m.id, nome: 'Marina', salaId: 'sala-aulas', papel: 'aluna', emails: ['marina@exemplo.invalid'] }]));
    const aulas = within(await screen.findByRole('group', { name: 'Aulas' }));
    expect(aulas.getByText('Marina')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Orientações' })).toBeNull();
    expect(screen.queryByLabelText('Nome da pessoa')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Editar Marina' })));
  });

  it('papel esvaziado some do registro', async () => {
    await salvar('pessoas', { nome: 'Marina', salaId: 'sala-orientacoes', papel: 'aluna' });
    await pronta();
    await screen.findByText('Marina', { selector: '.pessoa-nome' });
    editar('Marina');
    fireEvent.input(screen.getByLabelText('Papel da pessoa'), { target: { value: '  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(async () => expect('papel' in (await listar('pessoas'))[0]).toBe(false));
  });

  it('nome já usado por outra pessoa é recusado; o próprio nome (outra caixa) não', async () => {
    await salvar('pessoas', { nome: 'Renata', salaId: 'sala-aulas' });
    await salvar('pessoas', { nome: 'Marina', salaId: 'sala-orientacoes' });
    await pronta();
    await screen.findByText('Marina', { selector: '.pessoa-nome' });
    editar('Marina');
    fireEvent.input(nomeEditado(), { target: { value: 'renata' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Renata já está cadastrada em Aulas.');

    fireEvent.input(nomeEditado(), { target: { value: 'MARINA' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(async () => expect((await listar('pessoas')).map((p) => p.nome).sort()).toEqual(['MARINA', 'Renata']));
  });

  it('nome vazio é recusado; Cancelar e Esc fecham sem gravar', async () => {
    await salvar('pessoas', { nome: 'Marina', salaId: 'sala-orientacoes' });
    await pronta();
    await screen.findByText('Marina', { selector: '.pessoa-nome' });
    editar('Marina');
    fireEvent.input(nomeEditado(), { target: { value: '  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Escreva o nome.');
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByLabelText('Nome da pessoa')).toBeNull();
    editar('Marina');
    fireEvent.keyDown(nomeEditado(), { key: 'Escape' });
    expect(screen.queryByLabelText('Nome da pessoa')).toBeNull();
    expect((await listar('pessoas'))[0].nome).toBe('Marina');
  });

  it('o que se digita na edição não é refeito por atualização de outra pessoa', async () => {
    await salvar('pessoas', { nome: 'Marina', salaId: 'sala-orientacoes' });
    await pronta();
    await screen.findByText('Marina', { selector: '.pessoa-nome' });
    editar('Marina');
    const campo = nomeEditado();
    fireEvent.input(campo, { target: { value: 'Marina S' } });
    campo.focus();
    await salvar('pessoas', { nome: 'Aurora', salaId: 'sala-aulas' });
    await screen.findByText('Aurora', { selector: '.pessoa-nome' });
    expect(nomeEditado()).toBe(campo);
    expect(campo.value).toBe('Marina S');
    expect(document.activeElement).toBe(campo);
  });

  it('dois toques seguidos em Salvar gravam uma vez', async () => {
    await salvar('pessoas', { nome: 'Marina', salaId: 'sala-orientacoes' });
    await pronta();
    await screen.findByText('Marina', { selector: '.pessoa-nome' });
    editar('Marina');
    fireEvent.input(nomeEditado(), { target: { value: 'Marina B' } });
    const antes = (await listarPendentes()).length;
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(async () => expect((await listar('pessoas'))[0].nome).toBe('Marina B'));
    await new Promise((r) => setTimeout(r, 40));
    expect((await listarPendentes()).length).toBe(antes + 1);
  });
});
