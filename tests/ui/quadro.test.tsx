// Tarefa 20: Quadro, uma coluna por sala com e-mails, compromissos e tarefas.
// Nomes fictícios (Marina, Renata, Prof. Souza, Aurora).
import { act, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { limparConversa } from '../../src/chat/conversa';
import { salvar, semear } from '../../src/dados/loja';
import { Quadro } from '../../src/ui/Quadro';
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
});

function larguraDaJanela(largura: number) {
  Object.defineProperty(window, 'innerWidth', { value: largura, configurable: true, writable: true });
}

function mostrar(largura = 1280) {
  larguraDaJanela(largura);
  return render(<Quadro />);
}

const NOMES = ['Doutoramento', 'Investigação', 'Aulas', 'Orientações', 'MBA', 'Pessoal', 'Casa'];
const colunas = () => screen.getAllByRole('region').filter((r) => r.classList.contains('quadro-coluna'));
const coluna = async (nome: string) => within(await screen.findByRole('region', { name: nome }));
const filtro = (nome: string) => screen.getByRole('button', { name: nome });
const em = (dia: string, inicio: string, fim: string, titulo: string, salaId: string) =>
  evento(titulo, { salaId, inicio: `${dia}T${inicio}:00+00:00`, fim: `${dia}T${fim}:00+00:00` });

async function cenario() {
  await salvar('pessoas', { id: 'p-marina', nome: 'Marina', salaId: 'sala-orientacoes', papel: 'aluna', emails: ['marina@exemplo.invalid'] });
  await salvar('pessoas', { id: 'p-souza', nome: 'Prof. Souza', salaId: 'sala-doutoramento', emails: ['souza@exemplo.invalid'] });
  await criar('Revisar capítulo 2', { salaId: 'sala-orientacoes', data: '2026-11-05' });
  await criar('Ler tese da Renata', { salaId: 'sala-orientacoes', data: '2026-11-19' });
  await criar('Preparar aula de Modelagem', { salaId: 'sala-aulas' });
  await criar('Relatório de bolsa', { salaId: 'sala-doutoramento', data: '2026-11-03' });
  return scriptDeTeste({
    eventos: [
      em('2026-11-06', '11:00', '12:00', 'Reunião de orientação', 'sala-orientacoes'),
      em('2026-11-12', '09:00', '10:00', 'Aula de Modelagem', 'sala-aulas'),
      em('2026-11-03', '09:00', '10:00', 'Seminário passado', 'sala-doutoramento'),
    ],
    emails: [
      email('Revisão do capítulo 2', { data: '2026-11-05T10:20:00+00:00' }),
      email('Relatório do semestre', { remetente: 'Prof. Souza', enderecoRemetente: 'souza@exemplo.invalid', data: '2026-10-28T16:40:00+00:00' }),
    ],
  });
}

describe('Quadro (computador)', () => {
  it('uma coluna por sala, na ordem das salas, cada uma com o nome levando à sala', async () => {
    mostrar();
    for (const nome of NOMES) await coluna(nome);
    expect(colunas().map((c) => c.querySelector('.quadro-nome')?.textContent)).toEqual(NOMES);
    expect(within(colunas()[3]).getByRole('link', { name: 'Orientações' }).getAttribute('href')).toBe('#/sala/sala-orientacoes');
  });

  it('cada coluna junta os e-mails, os compromissos e as tarefas daquela sala, e só dela', async () => {
    await cenario();
    mostrar();
    const ori = await coluna('Orientações');
    expect(await ori.findByText('Revisão do capítulo 2')).toBeTruthy();
    expect(await ori.findByText('Reunião de orientação')).toBeTruthy();
    expect(ori.getByText('Revisar capítulo 2')).toBeTruthy();
    expect(ori.queryByText('Preparar aula de Modelagem')).toBeNull();
    expect(ori.queryByText('Relatório do semestre')).toBeNull();

    const dout = await coluna('Doutoramento');
    expect(await dout.findByText('Relatório do semestre')).toBeTruthy();
    expect(dout.getByText('Relatório de bolsa')).toBeTruthy();
    // Compromisso que já passou não entra em Tudo (só olha para a frente).
    expect(dout.queryByText('Seminário passado')).toBeNull();

    const aulas = await coluna('Aulas');
    expect(aulas.getByText('Preparar aula de Modelagem')).toBeTruthy();
    expect(await aulas.findByText('Aula de Modelagem')).toBeTruthy();
  });

  it('o cabeçalho de cada coluna conta o que há nela, com o plural certo', async () => {
    await cenario();
    mostrar();
    const ori = await coluna('Orientações');
    await waitFor(() => expect(ori.getByText('2 tarefas · 1 compromisso · 1 e-mail')).toBeTruthy());
  });

  it('sala sem nada vira pílula "Em dia", que leva à sala; não ganha cartão', async () => {
    await cenario();
    mostrar();
    const emDia = within(await screen.findByRole('list', { name: 'Em dia:' }));
    await waitFor(() => expect(emDia.getAllByRole('link').map((a) => a.textContent)).toEqual(['Investigação', 'MBA', 'Pessoal', 'Casa']));
    expect(emDia.getByRole('link', { name: 'Casa' }).getAttribute('href')).toBe('#/sala/sala-casa');
    expect(screen.queryByRole('region', { name: 'Casa' })).toBeNull();
    const cartoes = screen.getByRole('region', { name: 'Salas com algo em aberto' });
    expect([...cartoes.querySelectorAll('h2 .quadro-nome')].map((n) => n.textContent)).toEqual(['Doutoramento', 'Aulas', 'Orientações']);
  });

  it('sem nada em nenhuma sala, diz que está tudo em dia', async () => {
    await scriptDeTeste();
    mostrar();
    expect(await screen.findByText('Tudo em dia: nada em aberto nas salas.')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Salas com algo em aberto' })).toBeNull();
  });

  it('Tudo é o filtro de partida e os filtros dizem qual está ligado', async () => {
    await scriptDeTeste();
    mostrar();
    const grupo = screen.getByRole('group', { name: 'Filtro do quadro' });
    expect(within(grupo).getAllByRole('button').map((b) => b.textContent)).toEqual(['Tudo', 'Esta semana', 'Só e-mails']);
    expect(filtro('Tudo').getAttribute('aria-pressed')).toBe('true');
    expect(filtro('Esta semana').getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(filtro('Esta semana'));
    expect(filtro('Tudo').getAttribute('aria-pressed')).toBe('false');
    expect(filtro('Esta semana').getAttribute('aria-pressed')).toBe('true');
  });

  it('Esta semana mostra só o que cai de segunda a domingo (e as tarefas atrasadas)', async () => {
    await cenario();
    mostrar();
    const aulas = await coluna('Aulas');
    await aulas.findByText('Aula de Modelagem');
    fireEvent.click(filtro('Esta semana'));

    const ori = await coluna('Orientações');
    expect(ori.getByText('Revisar capítulo 2')).toBeTruthy();
    expect(ori.queryByText('Ler tese da Renata')).toBeNull(); // dia 19
    expect(ori.getByText('Reunião de orientação')).toBeTruthy();
    expect(ori.getByText('Revisão do capítulo 2')).toBeTruthy();

    // Aula do dia 12 e tarefa sem prazo ficam para fora: Aulas fica em dia, sem cartão.
    expect(screen.queryByText('Aula de Modelagem')).toBeNull();
    expect(screen.queryByText('Preparar aula de Modelagem')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Aulas' })).toBeNull();

    // Doutoramento: tarefa atrasada e seminário de terça (da semana) entram; e-mail de 28/10 não.
    const dout = await coluna('Doutoramento');
    expect(dout.getByText('Relatório de bolsa')).toBeTruthy();
    expect(dout.getByText('Seminário passado')).toBeTruthy();
    expect(dout.queryByText('Relatório do semestre')).toBeNull();
  });

  it('Só e-mails esconde compromissos e tarefas', async () => {
    await cenario();
    mostrar();
    const ori = await coluna('Orientações');
    await ori.findByText('Revisão do capítulo 2');
    fireEvent.click(filtro('Só e-mails'));
    expect(ori.getByText('Revisão do capítulo 2')).toBeTruthy();
    expect(ori.queryByText('Reunião de orientação')).toBeNull();
    expect(ori.queryByText('Revisar capítulo 2')).toBeNull();
    expect((await coluna('Doutoramento')).getByText('Relatório do semestre')).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 3, name: 'Tarefas' })).toBeNull();
  });

  it('e-mail e tarefa sem sala vão para uma coluna "Sem sala", que só existe quando precisa', async () => {
    await scriptDeTeste({ emails: [email('Convite para o congresso', { remetente: 'Aurora', enderecoRemetente: 'aurora@exemplo.invalid' })] });
    await criar('Comprar tinta', { salaId: null });
    mostrar();
    const sem = await coluna('Sem sala');
    expect(await sem.findByText('Convite para o congresso')).toBeTruthy();
    expect(sem.getByText('Comprar tinta')).toBeTruthy();
    expect(colunas()).toHaveLength(8);
  });

  it('nunca altera o Gmail: só lê e-mails e agenda; Responder abre o Gmail em outra aba', async () => {
    const script = await cenario();
    mostrar();
    const ori = await coluna('Orientações');
    await ori.findByText('Revisão do capítulo 2');
    const permitidas = new Set(['eventos', 'emails', 'atualizarEmails', 'ping']);
    expect(script.acoes().filter((a) => !permitidas.has(a))).toEqual([]);
    const responder = ori.getByRole('link', { name: /^Responder/ });
    expect(responder.getAttribute('target')).toBe('_blank');
    expect(responder.getAttribute('rel')).toContain('noopener');
  });
});

describe('Quadro (celular e tablet)', () => {
  it('no celular as colunas ficam empilhadas e cada uma abre e fecha pelo cabeçalho', async () => {
    await cenario();
    mostrar(390);
    await screen.findByRole('button', { name: /Casa/ });
    const cabecalhos = screen.getAllByRole('heading', { level: 2 }).map((h) => within(h).getByRole('button'));
    expect(cabecalhos.map((b) => b.querySelector('.quadro-nome')?.textContent)).toEqual(NOMES);
    // A primeira com conteúdo já vem aberta; Casa, vazia, não.
    await waitFor(() => expect(cabecalhos[0].getAttribute('aria-expanded')).toBe('true'));
    const casa = cabecalhos[6];
    expect(casa.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Nada nesta sala.')).toBeNull();
    fireEvent.click(casa);
    expect(casa.getAttribute('aria-expanded')).toBe('true');
    expect(await (await coluna('Casa')).findByText('Nada nesta sala.')).toBeTruthy();
    fireEvent.click(casa);
    expect(casa.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Nada nesta sala.')).toBeNull();
  });

  it('no tablet, como no computador: cartões das salas com algo e pílulas das em dia', async () => {
    await cenario();
    mostrar(800);
    const area = await screen.findByRole('region', { name: 'Salas com algo em aberto' });
    await waitFor(() => expect([...area.querySelectorAll('h2 .quadro-nome')].map((n) => n.textContent)).toEqual(['Doutoramento', 'Aulas', 'Orientações']));
    expect(screen.getByRole('list', { name: 'Em dia:' })).toBeTruthy();
  });

  it('girar o aparelho troca a pilha pelas colunas', async () => {
    await scriptDeTeste();
    mostrar(390);
    expect(await screen.findAllByRole('button', { name: /Casa/ })).toHaveLength(1);
    larguraDaJanela(1280);
    act(() => void window.dispatchEvent(new Event('resize')));
    expect(screen.queryByRole('button', { name: /Casa/ })).toBeNull();
    expect(await screen.findByText('Tudo em dia: nada em aberto nas salas.')).toBeTruthy();
  });
});
