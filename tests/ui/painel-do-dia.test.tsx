import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { limparConversa } from '../../src/chat/conversa';
import { listar, salvar, semear, semearPalavras } from '../../src/dados/loja';
import { iniciarVirada } from '../../src/dados/virada';
import { criar } from '../apoio/tarefas';

// Quinta-feira, 2026-11-05, 12:20 (Europe/Lisbon). Só a data é falsa.
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-11-05T12:20:00Z'));
  limparConversa();
  await semear();
  await semearPalavras();
});

function mostrar(hash: string, largura: number) {
  Object.defineProperty(window, 'innerWidth', { value: largura, configurable: true, writable: true });
  history.replaceState(null, '', `/${hash}`);
  render(<App />);
}

function navegar(hash: string) {
  act(() => {
    location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}

const principal = () => within(document.querySelector('main') as HTMLElement);

describe('Painel do dia', () => {
  it('mostra a checklist de hoje e Sem prazo, sem a prova da sincronia', async () => {
    await criar('Rever capítulo 3', { data: '2026-11-04', salaId: 'sala-orientacoes' });
    await criar('Comprar café');
    mostrar('#/', 1280);

    expect(await principal().findByRole('checkbox', { name: 'Rever capítulo 3' })).toBeTruthy();
    expect(principal().getByRole('heading', { level: 2, name: 'Checklist do dia' })).toBeTruthy();
    expect(principal().getByRole('heading', { level: 2, name: 'Sem prazo' })).toBeTruthy();
    expect(await principal().findByRole('checkbox', { name: 'Comprar café' })).toBeTruthy();
    expect(screen.queryByText('Prova da sincronia')).toBeNull();
  });

  it('o que sai de Sem prazo com "Hoje" entra na checklist, na mesma tela', async () => {
    await criar('Comprar café');
    mostrar('#/', 1280);
    const semPrazo = within((await principal().findByRole('heading', { name: 'Sem prazo' })).closest('section') as HTMLElement);
    fireEvent.click(await semPrazo.findByRole('button', { name: 'Hoje' }));

    const checklist = within(principal().getByRole('heading', { name: 'Checklist do dia' }).closest('section') as HTMLElement);
    expect(await checklist.findByRole('checkbox', { name: 'Comprar café' })).toBeTruthy();
    expect(await semPrazo.findByText('Nada sem prazo.')).toBeTruthy();
  });

  it('no celular (390 px) a mesma página funciona', async () => {
    await criar('Comprar café', { data: '2026-11-05' });
    mostrar('#/', 390);
    expect(await principal().findByRole('checkbox', { name: 'Comprar café' })).toBeTruthy();
  });

  it('com o app aberto na virada, a lista muda sem recarregar', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(Date.parse('2026-11-05T23:59:30Z'));
    await criar('Ficou sem fazer', { data: '2026-11-05' });
    await criar('Para sexta', { data: '2026-11-06' });
    const parar = iniciarVirada();
    mostrar('#/', 1280);
    await vi.advanceTimersByTimeAsync(100);
    await principal().findByRole('checkbox', { name: 'Ficou sem fazer' });
    expect(principal().queryByRole('checkbox', { name: 'Para sexta' })).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });
    await waitFor(() => expect(principal().getByRole('checkbox', { name: 'Para sexta' })).toBeTruthy());
    await vi.waitFor(async () => expect((await listar('tarefas')).find((t) => t.titulo === 'Ficou sem fazer')?.data).toBe('2026-11-06'));
    parar();
  });
});

describe('Sem prazo e Atividades como páginas', () => {
  it('#/sem-prazo: o título da página é o h1 e a seção não o repete', async () => {
    await criar('Comprar café');
    mostrar('#/sem-prazo', 1280);
    expect(await principal().findByRole('checkbox', { name: 'Comprar café' })).toBeTruthy();
    expect(principal().getByRole('heading', { level: 1, name: 'Sem prazo' })).toBeTruthy();
    expect(principal().queryByRole('heading', { level: 2, name: 'Sem prazo' })).toBeNull();
    const grupo = within(principal().getByRole('group', { name: 'Quando fazer: Comprar café' }));
    expect(grupo.getAllByRole('button').map((b) => b.textContent)).toEqual(['Hoje', 'Esta semana', 'Escolher dia']);
  });

  it('#/atividades: lista agrupada', async () => {
    await criar('Comprar café');
    await criar('Validar dados', { data: '2026-11-05' });
    mostrar('#/atividades', 1280);
    expect(await principal().findByRole('heading', { level: 2, name: 'Hoje' })).toBeTruthy();
    expect(principal().getByRole('heading', { level: 2, name: 'Sem prazo' })).toBeTruthy();
  });

  it('navegar entre elas mantém tudo vivo: o que se conclui numa aparece na outra', async () => {
    await criar('Validar dados', { data: '2026-11-05' });
    mostrar('#/', 1280);
    fireEvent.click(await principal().findByRole('checkbox', { name: 'Validar dados' }));
    await waitFor(async () => expect((await listar('tarefas'))[0].feito).toBe(true));
    navegar('#/atividades');
    expect(principal().getByRole('heading', { level: 1, name: 'Atividades' })).toBeTruthy();
    expect(await principal().findByText('Nenhuma atividade aberta.')).toBeTruthy();
  });
});

describe('o passo do dono: cadastrar pessoas e ver o chat usá-las', () => {
  it('#/salas tem as 7 salas e o cadastro; Marina cadastrada em Orientações é usada pelo chat', async () => {
    mostrar('#/salas', 1280);
    const links = await principal().findAllByRole('link', { name: /Doutoramento|Investigação|Aulas|Orientações|MBA|Pessoal|Casa/ });
    expect(links.map((l) => l.textContent)).toEqual([
      'Doutoramento',
      'Investigação',
      'Aulas',
      'Orientações',
      'MBA',
      'Pessoal',
      'Casa',
    ]);

    const nome = principal().getByLabelText('Nome');
    await waitFor(() => expect((principal().getByLabelText('Sala') as HTMLSelectElement).options.length).toBe(8));
    fireEvent.input(nome, { target: { value: 'Marina' } });
    fireEvent.change(principal().getByLabelText('Sala'), { target: { value: 'sala-orientacoes' } });
    fireEvent.click(principal().getByRole('button', { name: 'Cadastrar pessoa' }));
    await principal().findByText('Marina cadastrada em Orientações.');

    // Agora o chat (no painel da direita) sabe a sala dela.
    const painel = within(screen.getByRole('complementary'));
    // O chat do painel começa recolhido: abre na barra.
    if (painel.getByRole('button', { name: /^Chat/ }).getAttribute('aria-expanded') === 'false') {
      fireEvent.click(painel.getByRole('button', { name: /^Chat/ }));
    }
    fireEvent.input(painel.getByRole('textbox', { name: 'Escreva ou dite' }), { target: { value: 'Marcar reunião com a Marina' } });
    fireEvent.click(painel.getByRole('button', { name: 'Enviar' }));
    const cartao = within(await painel.findByRole('article'));
    expect(await cartao.findByText('Marina fica em Orientações.')).toBeTruthy();
    await waitFor(async () => expect((await listar('tarefas'))[0]).toMatchObject({ salaId: 'sala-orientacoes', data: '2026-11-05' }));

    // E a tarefa dela já está na checklist de hoje.
    navegar('#/');
    expect(await principal().findByRole('checkbox', { name: /Marcar reunião com a Marina/ })).toBeTruthy();
  });

  it('a pessoa que chega de outro aparelho aparece na tela de Salas', async () => {
    mostrar('#/salas', 1280);
    await principal().findByText('Nenhuma pessoa cadastrada.');
    await salvar('pessoas', { nome: 'Prof. Souza', salaId: 'sala-doutoramento' });
    expect(await principal().findByText('Prof. Souza')).toBeTruthy();
  });
});
