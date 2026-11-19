// O menu lateral lista as pastas da Casa debaixo dela (V02, Tarefa 12). Nomes fictícios.
import { configure, render, waitFor, within } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { limparConversa } from '../../src/chat/conversa';
import { salvar, semear, semearPalavras } from '../../src/dados/loja';

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

const menu = () => within(document.querySelector('nav.menu') as HTMLElement);

describe('submenu da Casa', () => {
  it('lista as pastas da Casa, em ordem, debaixo do link da sala', async () => {
    await salvar('pastas', { id: 'p2', salaId: 'sala-casa', tipo: 'registro', nome: 'Consumo de Água', ordem: 2 });
    await salvar('pastas', { id: 'p1', salaId: 'sala-casa', tipo: 'lista', nome: 'Compras da semana', ordem: 1 });
    await salvar('pastas', { id: 'p3', salaId: 'sala-aulas', tipo: 'comum', nome: 'Provas', ordem: 1 });
    mostrar('#/');

    const sub = within(await menu().findByRole('list', { name: 'Pastas da Casa' }));
    const links = sub.getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['Compras da semana', 'Consumo de Água']);
    expect(links[0].getAttribute('href')).toBe('#/sala/sala-casa/pasta/p1');
    // O submenu fica dentro do item da Casa, não solto.
    const casa = menu().getByRole('link', { name: 'Casa' });
    expect(casa.closest('li')!.contains(links[0])).toBe(true);
    // Outras salas não ganham submenu.
    expect(menu().queryByRole('list', { name: 'Pastas de Aulas' })).toBeNull();
    expect(menu().queryByText('Provas')).toBeNull();
  });

  it('marca a pasta aberta como a página atual', async () => {
    await salvar('pastas', { id: 'p1', salaId: 'sala-casa', tipo: 'lista', nome: 'Compras da semana', ordem: 1 });
    await salvar('pastas', { id: 'p2', salaId: 'sala-casa', tipo: 'comum', nome: 'Reformas', ordem: 2 });
    mostrar('#/sala/sala-casa/pasta/p2');

    const atual = await menu().findByRole('link', { name: 'Reformas' });
    await waitFor(() => expect(atual.getAttribute('aria-current')).toBe('page'));
    expect(menu().getByRole('link', { name: 'Compras da semana' }).getAttribute('aria-current')).toBeNull();
    expect(menu().getByRole('link', { name: 'Casa' }).getAttribute('aria-current')).toBeNull();
  });

  it('sem pastas, a Casa fica sem submenu', async () => {
    mostrar('#/');
    await menu().findByRole('link', { name: 'Casa' });
    expect(menu().queryByRole('list', { name: 'Pastas da Casa' })).toBeNull();
  });

  it('no celular a barra de baixo continua igual: Salas fica marcada dentro de uma pasta', async () => {
    await salvar('pastas', { id: 'p1', salaId: 'sala-casa', tipo: 'comum', nome: 'Reformas', ordem: 1 });
    mostrar('#/sala/sala-casa/pasta/p1', 375);

    const barra = within(document.querySelector('nav.atalhos') as HTMLElement);
    expect(barra.getByRole('link', { name: 'Salas' }).getAttribute('aria-current')).toBe('true');
  });
});
