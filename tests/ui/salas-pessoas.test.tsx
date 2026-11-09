// Tarefa 17: Salas, a página de cada sala e a página de cada pessoa.
// Nomes fictícios (Marina, Renata, Prof. Souza, Aurora).
import { act, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { limparConversa } from '../../src/chat/conversa';
import { gravarDoServidor, listar, lerRegistros, salvar, semear, semearPalavras } from '../../src/dados/loja';
import type { Pessoa, Sala } from '../../src/dados/tipos';
import { ATRASO_DAS_NOTAS_MS } from '../../src/ui/Notas';
import { evento } from '../apoio/agenda-ui';
import { email } from '../apoio/emails-ui';
import { scriptDeTeste } from '../apoio/script-ui';
import { criar } from '../apoio/tarefas';

// Quinta-feira, 2026-11-05, 12:20 (Europe/Lisbon). Só a data é falsa.
configure({ asyncUtilTimeout: 5000 });

beforeEach(async () => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-11-05T12:20:00Z'));
  limparConversa();
  await semear();
  await semearPalavras();
});

function mostrar(hash: string, largura = 1280) {
  Object.defineProperty(window, 'innerWidth', { value: largura, configurable: true, writable: true });
  history.replaceState(null, '', `/${hash}`);
  return render(<App />);
}

function navegar(hash: string) {
  act(() => {
    location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}

const principal = () => within(document.querySelector('main') as HTMLElement);
/** A seção aparece quando a página termina de ler os dados. */
const secao = async (nome: string | RegExp) => within(await principal().findByRole('region', { name: nome }));

const NOMES_DAS_SALAS = ['Doutoramento', 'Investigação', 'Aulas', 'Orientações', 'MBA', 'Pessoal', 'Casa'];

async function marina(extra: Partial<Pessoa> = {}) {
  return salvar('pessoas', { id: 'p-marina', nome: 'Marina', salaId: 'sala-orientacoes', papel: 'aluna', ...extra });
}

describe('Salas (#/salas)', () => {
  it('mostra as 7 salas, na ordem, cada uma levando à sua página', async () => {
    mostrar('#/salas');
    const lista = await principal().findByRole('list', { name: 'Salas' });
    const links = await within(lista).findAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(NOMES_DAS_SALAS);
    expect(links[3].getAttribute('href')).toBe('#/sala/sala-orientacoes');
    expect(links[4].getAttribute('href')).toBe('#/sala/sala-mba');
  });

  it('cada cartão diz o que há aberto na sala e quantas pessoas tem', async () => {
    await criar('Revisar capítulo 2', { salaId: 'sala-orientacoes' });
    await criar('Preparar aula', { salaId: 'sala-orientacoes', data: '2026-11-09' });
    await criar('Ler artigo', { salaId: 'sala-aulas', feito: true });
    await marina();
    mostrar('#/salas');
    const lista = within(await principal().findByRole('list', { name: 'Salas' }));
    const cartao = (nome: string) => lista.getByRole('link', { name: nome }).closest('li') as HTMLElement;
    await waitFor(() => expect(cartao('Orientações').textContent).toContain('2 tarefas abertas'));
    await waitFor(() => expect(cartao('Orientações').textContent).toContain('1 pessoa'));
    expect(cartao('Aulas').textContent).toContain('Nada em aberto');
    expect(cartao('Casa').textContent).toContain('Nada em aberto');
  });

  it('o nome de cada pessoa do cadastro leva à página dela', async () => {
    await marina();
    mostrar('#/salas');
    const link = await principal().findByRole('link', { name: 'Marina' });
    expect(link.getAttribute('href')).toBe('#/pessoa/p-marina');
  });

  it('o menu leva de volta: a página da sala tem o link Voltar para Salas', async () => {
    mostrar('#/sala/sala-aulas');
    await screen.findByRole('heading', { level: 1, name: 'Aulas' });
    expect(screen.getByRole('link', { name: 'Voltar' }).getAttribute('href')).toBe('#/salas');
  });
});

describe('página da sala', () => {
  it('mostra Tarefas, Próximos compromissos, Pessoas, Notas e Documentos', async () => {
    await scriptDeTeste();
    mostrar('#/sala/sala-orientacoes');
    await screen.findByRole('heading', { level: 1, name: 'Orientações' });
    for (const nome of ['Tarefas', 'Próximos compromissos', 'Pessoas', 'Notas', 'Documentos']) {
      expect(await principal().findByRole('region', { name: nome })).toBeTruthy();
    }
  });

  it('lista só as tarefas abertas da sala, agrupadas, com a sala de cada uma', async () => {
    await criar('Revisar capítulo 2 da Marina', { salaId: 'sala-orientacoes', data: '2026-11-05' });
    await criar('Escrever pauta da reunião', { salaId: 'sala-orientacoes' });
    await criar('Preparar a aula de estatística', { salaId: 'sala-aulas' });
    await criar('Tarefa já feita', { salaId: 'sala-orientacoes', feito: true });
    await scriptDeTeste();
    mostrar('#/sala/sala-orientacoes');
    const tarefas = await secao('Tarefas');
    expect(await tarefas.findByRole('checkbox', { name: /Revisar capítulo 2 da Marina/ })).toBeTruthy();
    expect(tarefas.getByRole('checkbox', { name: /Escrever pauta da reunião/ })).toBeTruthy();
    expect(tarefas.queryByText(/Preparar a aula/)).toBeNull();
    expect(tarefas.queryByText(/Tarefa já feita/)).toBeNull();
    // Dois grupos (Hoje e Sem prazo): ganham subtítulo.
    expect(tarefas.getByRole('heading', { level: 3, name: 'Hoje' })).toBeTruthy();
    expect(tarefas.getByRole('heading', { level: 3, name: 'Sem prazo' })).toBeTruthy();
  });

  it('sem tarefas diz isso e leva ao Chat, em palavras simples', async () => {
    await scriptDeTeste();
    mostrar('#/sala/sala-casa');
    expect(await (await secao('Tarefas')).findByText('Nada em aberto nesta sala.')).toBeTruthy();
  });

  it('escrever uma tarefa na página cria a tarefa já na sala', async () => {
    await scriptDeTeste();
    mostrar('#/sala/sala-aulas');
    const campo = await (await secao('Tarefas')).findByRole('textbox', { name: 'Nova tarefa em Aulas' });
    fireEvent.input(campo, { target: { value: 'Corrigir provas' } });
    fireEvent.click((await secao('Tarefas')).getByRole('button', { name: 'Adicionar' }));
    await waitFor(async () =>
      expect((await listar('tarefas')).find((t) => t.titulo === 'Corrigir provas')).toMatchObject({ salaId: 'sala-aulas' }),
    );
    expect(await (await secao('Tarefas')).findByRole('checkbox', { name: /Corrigir provas/ })).toBeTruthy();
  });

  it('mostra os próximos compromissos só desta sala, com o dia, e não os que já passaram', async () => {
    await scriptDeTeste({
      eventos: [
        evento('Reunião de orientação', { salaId: 'sala-orientacoes', inicio: '2026-11-06T11:00:00+00:00', fim: '2026-11-06T12:00:00+00:00' }),
        evento('Defesa de dissertação', { salaId: 'sala-orientacoes', inicio: '2026-11-12T15:00:00+00:00', fim: '2026-11-12T16:00:00+00:00' }),
        evento('Aula de estatística', { salaId: 'sala-aulas', inicio: '2026-11-06T09:00:00+00:00', fim: '2026-11-06T10:00:00+00:00' }),
        evento('Café com a Renata', { salaId: null, inicio: '2026-11-06T16:00:00+00:00', fim: '2026-11-06T17:00:00+00:00' }),
        evento('Reunião de ontem', { salaId: 'sala-orientacoes', inicio: '2026-11-05T09:00:00+00:00', fim: '2026-11-05T10:00:00+00:00' }),
      ],
    });
    mostrar('#/sala/sala-orientacoes');
    const compromissos = await secao('Próximos compromissos');
    expect(await compromissos.findByText('Reunião de orientação')).toBeTruthy();
    expect(compromissos.getByText('Defesa de dissertação')).toBeTruthy();
    expect(compromissos.queryByText('Aula de estatística')).toBeNull();
    expect(compromissos.queryByText('Café com a Renata')).toBeNull();
    expect(compromissos.queryByText('Reunião de ontem')).toBeNull();
    // Cada dia tem o seu título, com o dia da semana e a data.
    expect(compromissos.getByRole('heading', { level: 3, name: 'Sexta, 6/11' })).toBeTruthy();
    expect(compromissos.getByRole('heading', { level: 3, name: 'Quinta, 12/11' })).toBeTruthy();
  });

  it('sem compromissos nos próximos dias, diz isso depois de ler a agenda', async () => {
    await scriptDeTeste({ eventos: [] });
    mostrar('#/sala/sala-pessoal');
    expect(await (await secao('Próximos compromissos')).findByText('Nada marcado nos próximos 14 dias.')).toBeTruthy();
  });

  it('a faixa do alto resume tarefas, e-mails e compromissos numa frase', async () => {
    await criar('Revisar capítulo 2', { salaId: 'sala-orientacoes', data: '2026-11-05' });
    await criar('Ler tese', { salaId: 'sala-orientacoes', data: '2026-11-12' });
    await marina({ emails: ['marina@exemplo.invalid'] });
    await scriptDeTeste({
      eventos: [evento('Reunião de orientação', { salaId: 'sala-orientacoes', inicio: '2026-11-06T11:00:00+00:00', fim: '2026-11-06T12:00:00+00:00' })],
      emails: [email('Revisão do capítulo 2')],
    });
    mostrar('#/sala/sala-orientacoes');
    await waitFor(() =>
      expect(principal().getByText(/1 tarefa pendente, 1 tarefa para depois, 1 e-mail por responder e 1 compromisso nos próximos 14 dias\./)).toBeTruthy(),
    );
  });

  it('mostra os e-mails por responder de quem é da sala', async () => {
    await marina({ emails: ['marina@exemplo.invalid'] });
    await scriptDeTeste({
      emails: [
        email('Revisão do capítulo 2'),
        email('Promoção de livros', { remetente: 'Livraria', enderecoRemetente: 'livraria@exemplo.invalid' }),
      ],
    });
    mostrar('#/sala/sala-orientacoes');
    const emails = await secao('Por responder');
    expect(await emails.findByText('Revisão do capítulo 2')).toBeTruthy();
    expect(emails.queryByText('Promoção de livros')).toBeNull();
  });

  it('Pessoas: um painel clicável por pessoa, com o que ela tem em aberto', async () => {
    await marina({ emails: ['marina@exemplo.invalid'] });
    await salvar('pessoas', { id: 'p-renata', nome: 'Renata', salaId: 'sala-orientacoes' });
    await salvar('pessoas', { id: 'p-souza', nome: 'Prof. Souza', salaId: 'sala-doutoramento' });
    await criar('Revisar capítulo 2', { salaId: 'sala-orientacoes', pessoaId: 'p-marina' });
    await criar('Marcar reunião com a Marina', { salaId: 'sala-orientacoes', pessoaId: 'p-marina' });
    await scriptDeTeste({ emails: [email('Revisão do capítulo 2')] });
    mostrar('#/sala/sala-orientacoes');
    const pessoas = await secao('Pessoas');
    const painelMarina = await pessoas.findByRole('link', { name: /Marina/ });
    expect(painelMarina.getAttribute('href')).toBe('#/pessoa/p-marina');
    await waitFor(() => expect(painelMarina.textContent).toContain('2 tarefas · 1 e-mail'));
    expect(painelMarina.textContent).toContain('aluna');
    expect(pessoas.getByRole('link', { name: /Renata/ }).textContent).toContain('Nada em aberto');
    expect(pessoas.queryByText('Prof. Souza')).toBeNull();
  });

  it('Pessoas sem ninguém cadastrado leva ao cadastro', async () => {
    await scriptDeTeste();
    mostrar('#/sala/sala-mba');
    const pessoas = await secao('Pessoas');
    expect(await pessoas.findByText('Ninguém cadastrado nesta sala.')).toBeTruthy();
    expect(pessoas.getByRole('link', { name: 'Cadastrar pessoa' }).getAttribute('href')).toBe('#/salas');
  });

  it('Documentos: sala sem documentos mostra a caixa vazia', async () => {
    await scriptDeTeste();
    mostrar('#/sala/sala-aulas');
    const documentos = await secao('Documentos');
    expect(await documentos.findByText('Nenhum documento ainda.')).toBeTruthy();
  });

  it('o painel clicável de Marina abre a página dela, com pendências, documentos e e-mails', async () => {
    await marina({ emails: ['marina@exemplo.invalid'] });
    await criar('Revisar capítulo 2', { salaId: 'sala-orientacoes', pessoaId: 'p-marina' });
    await scriptDeTeste({ emails: [email('Revisão do capítulo 2')] });
    mostrar('#/sala/sala-orientacoes');
    fireEvent.click(await (await secao('Pessoas')).findByRole('link', { name: /Marina/ }));
    // O clique em link só muda o endereço; o app acompanha o hash.
    navegar('#/pessoa/p-marina');
    await screen.findByRole('heading', { level: 1, name: 'Marina' });
    expect(await (await secao('Pendências')).findByRole('checkbox', { name: /Revisar capítulo 2/ })).toBeTruthy();
    expect(await (await secao('E-mails')).findByText('Revisão do capítulo 2')).toBeTruthy();
    expect((await secao('Documentos')).getByText('Nenhum documento ainda.')).toBeTruthy();
    expect(principal().getByRole('region', { name: 'Notas' })).toBeTruthy();
  });
});

describe('página da pessoa', () => {
  it('Pendências lista só as tarefas dela; as de outras pessoas e da sala toda ficam de fora', async () => {
    await marina();
    await salvar('pessoas', { id: 'p-renata', nome: 'Renata', salaId: 'sala-orientacoes' });
    await criar('Corrigir o resumo da Marina', { salaId: 'sala-orientacoes', pessoaId: 'p-marina' });
    await criar('Corrigir a introdução da Renata', { salaId: 'sala-orientacoes', pessoaId: 'p-renata' });
    await criar('Reservar a sala 3', { salaId: 'sala-orientacoes' });
    await scriptDeTeste();
    mostrar('#/pessoa/p-marina');
    const pendencias = await secao('Pendências');
    expect(await pendencias.findByRole('checkbox', { name: /Corrigir o resumo da Marina/ })).toBeTruthy();
    expect(pendencias.queryByText(/Renata/)).toBeNull();
    expect(pendencias.queryByText(/Reservar a sala 3/)).toBeNull();
  });

  it('sem pendências diz isso com o nome da pessoa', async () => {
    await marina();
    await scriptDeTeste();
    mostrar('#/pessoa/p-marina');
    expect(await (await secao('Pendências')).findByText('Nada pendente com Marina.')).toBeTruthy();
  });

  it('escrever uma tarefa na página cria a tarefa com a pessoa e a sala dela', async () => {
    await marina();
    await scriptDeTeste();
    mostrar('#/pessoa/p-marina');
    const campo = await (await secao('Pendências')).findByRole('textbox', { name: 'Nova tarefa com Marina' });
    fireEvent.input(campo, { target: { value: 'Enviar o modelo do capítulo' } });
    fireEvent.click((await secao('Pendências')).getByRole('button', { name: 'Adicionar' }));
    await waitFor(async () =>
      expect((await listar('tarefas')).find((t) => t.titulo === 'Enviar o modelo do capítulo')).toMatchObject({
        pessoaId: 'p-marina',
        salaId: 'sala-orientacoes',
      }),
    );
  });

  it('E-mails mostra só os dela, sem endereços na tela, e diz como fazer quando não há', async () => {
    await marina({ emails: ['marina@exemplo.invalid'] });
    await scriptDeTeste({
      emails: [email('Revisão do capítulo 2'), email('Convite', { remetente: 'Prof. Souza', enderecoRemetente: 'souza@exemplo.invalid' })],
    });
    mostrar('#/pessoa/p-marina');
    const emails = await secao('E-mails');
    expect(await emails.findByText('Revisão do capítulo 2')).toBeTruthy();
    expect(emails.queryByText('Convite')).toBeNull();
    expect(principal().queryByText(/marina@exemplo\.invalid/)).toBeNull();
  });

  it('sem e-mails dela, o texto explica como o e-mail passa a aparecer', async () => {
    await marina();
    await scriptDeTeste({ emails: [] });
    mostrar('#/pessoa/p-marina');
    const emails = await secao('E-mails');
    expect(await emails.findByText('Nenhum e-mail de Marina por responder.')).toBeTruthy();
  });

  it('a sala dela fica no alto como link, e Editar muda o nome e o título da página', async () => {
    await marina();
    await scriptDeTeste();
    mostrar('#/pessoa/p-marina');
    const alto = await principal().findByRole('link', { name: 'Orientações' });
    expect(alto.getAttribute('href')).toBe('#/sala/sala-orientacoes');

    fireEvent.click(principal().getByRole('button', { name: 'Editar Marina' }));
    const nome = await principal().findByLabelText('Nome da pessoa');
    fireEvent.input(nome, { target: { value: 'Marina Souza' } });
    fireEvent.click(principal().getByRole('button', { name: 'Salvar' }));
    await screen.findByRole('heading', { level: 1, name: 'Marina Souza' });
    await waitFor(() => expect(document.title).toBe('Marina Souza · Central de Comando'));
    await waitFor(() => expect(document.activeElement).toBe(principal().getByRole('button', { name: 'Editar Marina Souza' })));
  });

  it('pessoa que não existe mais mostra o aviso', async () => {
    mostrar('#/pessoa/p-ninguem');
    expect(await screen.findByRole('heading', { level: 1, name: 'Pessoa não encontrada' })).toBeTruthy();
  });
});

describe('notas', () => {
  const campo = () => principal().getByRole('textbox', { name: 'Notas' }) as HTMLTextAreaElement;
  const salaGuardada = async () => (await lerRegistros([{ colecao: 'salas', id: 'sala-orientacoes' }]))[0] as Sala;

  /** Outro aparelho grava a sala com outra nota, mais nova (o que a sincronia entrega). */
  const notaDoCelular = (antes: Sala) =>
    gravarDoServidor([{ colecao: 'salas', registro: { ...antes, notas: 'Nota escrita no celular', atualizadoEm: Date.now() + 5000, aparelho: 'celular-fake' } }]);

  async function abrirNotas() {
    await scriptDeTeste();
    mostrar('#/sala/sala-orientacoes');
    await principal().findByRole('textbox', { name: 'Notas' });
  }

  it('salvam sozinhas, um instante depois de parar de digitar, e sincronizam (pendente)', async () => {
    await abrirNotas();
    fireEvent.input(campo(), { target: { value: 'Combinar o calendário de entregas.' } });
    expect((await salaGuardada()).notas).toBeUndefined(); // ainda não: espera o atraso
    await waitFor(async () => expect((await salaGuardada()).notas).toBe('Combinar o calendário de entregas.'), {
      timeout: ATRASO_DAS_NOTAS_MS + 3000,
    });
    expect(await screen.findByText('Salvo')).toBeTruthy();
    const sala = await salaGuardada();
    expect(sala.nome).toBe('Orientações');
  });

  it('sair do campo grava na hora, sem esperar o atraso', async () => {
    await abrirNotas();
    campo().focus();
    fireEvent.input(campo(), { target: { value: 'Lembrar da Aurora.' } });
    fireEvent.blur(campo());
    await waitFor(async () => expect((await salaGuardada()).notas).toBe('Lembrar da Aurora.'), { timeout: 1500 });
  });

  it('trocar de página com texto por gravar grava antes de sair', async () => {
    await abrirNotas();
    campo().focus();
    fireEvent.input(campo(), { target: { value: 'Rascunho que não pode se perder.' } });
    navegar('#/salas');
    await waitFor(async () => expect((await salaGuardada()).notas).toBe('Rascunho que não pode se perder.'), { timeout: 1500 });
  });

  it('apagar tudo remove o campo do registro', async () => {
    await salvar('salas', { ...((await listar('salas')).find((s) => s.id === 'sala-orientacoes') as Sala), notas: 'Algo antigo' });
    await abrirNotas();
    await waitFor(() => expect(campo().value).toBe('Algo antigo'));
    campo().focus();
    fireEvent.input(campo(), { target: { value: '' } });
    fireEvent.blur(campo());
    await waitFor(async () => expect('notas' in (await salaGuardada())).toBe(false), { timeout: 1500 });
  });

  it('uma atualização vinda de outro aparelho não tira o foco, o texto nem o cursor de quem está digitando', async () => {
    await abrirNotas();
    campo().focus();
    fireEvent.input(campo(), { target: { value: 'Primeira ideia, ainda por terminar' } });
    campo().setSelectionRange(9, 9);
    expect(document.activeElement).toBe(campo());

    const antes = await salaGuardada();
    // Outro aparelho grava a sala com outra nota, mais nova.
    await act(async () => {
      await notaDoCelular(antes);
    });
    // A tela se refaz (a lista de salas é lida de novo), mas o campo em uso fica como estava.
    await waitFor(async () => expect((await salaGuardada()).notas).toBe('Nota escrita no celular'));
    await new Promise((resolver) => setTimeout(resolver, 150));
    expect(document.activeElement).toBe(campo());
    expect(campo().value).toBe('Primeira ideia, ainda por terminar');
    expect(campo().selectionStart).toBe(9);
    expect(campo().selectionEnd).toBe(9);

    // O que o dono digitou vale mais: ao sair do campo grava por cima, com carimbo acima do que chegou.
    fireEvent.blur(campo());
    await waitFor(async () => expect((await salaGuardada()).notas).toBe('Primeira ideia, ainda por terminar'), { timeout: 1500 });
    expect(campo().value).toBe('Primeira ideia, ainda por terminar');
  });

  it('com o campo em uso e nada digitado, a nota nova só aparece quando ele sai do campo', async () => {
    await abrirNotas();
    campo().focus();
    const antes = await salaGuardada();
    await act(async () => {
      await notaDoCelular(antes);
    });
    await new Promise((resolver) => setTimeout(resolver, 150));
    expect(campo().value).toBe('');
    expect(document.activeElement).toBe(campo());
    fireEvent.blur(campo());
    await waitFor(() => expect(campo().value).toBe('Nota escrita no celular'));
  });

  it('com o campo parado, a nota nova de outro aparelho aparece sozinha', async () => {
    await abrirNotas();
    const antes = await salaGuardada();
    await act(async () => {
      await notaDoCelular(antes);
    });
    await waitFor(() => expect(campo().value).toBe('Nota escrita no celular'));
  });

  it('as notas da pessoa ficam na pessoa, e as da sala na sala', async () => {
    await marina();
    await scriptDeTeste();
    mostrar('#/pessoa/p-marina');
    const notas = await principal().findByRole('textbox', { name: 'Notas' });
    fireEvent.input(notas, { target: { value: 'Prefere reunião às terças.' } });
    fireEvent.blur(notas);
    await waitFor(async () => expect((await listar('pessoas'))[0].notas).toBe('Prefere reunião às terças.'), { timeout: 1500 });
    expect((await salaGuardada()).notas).toBeUndefined();
  });
});
