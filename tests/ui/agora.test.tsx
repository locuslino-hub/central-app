// Tarefa 16: o Agora (página e cartão do painel direito): destaque, tempo
// livre, fila A seguir, triagem de e-mails e Fechar o dia.
import { act, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { limparConversa } from '../../src/chat/conversa';
import { listar, semear, semearPalavras } from '../../src/dados/loja';
import { evento } from '../apoio/agenda-ui';
import { email } from '../apoio/emails-ui';
import { scriptDeTeste } from '../apoio/script-ui';
import { criar } from '../apoio/tarefas';

// Quinta-feira, 2026-11-05, 12:20 (Europe/Lisbon). Só a data é falsa.
configure({ asyncUtilTimeout: 5000 });

/** O texto inteiro de um elemento, mesmo com os números num <span class="num"> à parte. */
const inteiro = (t: string) => (_: string, el: Element | null) =>
  el?.textContent === t && !Array.from(el.children).some((filho) => filho.textContent === t);

beforeEach(async () => {
  localStorage.clear();
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

const principal = () => within(document.querySelector('main') as HTMLElement);
const destaque = () => within(principal().getByRole('region', { name: 'Em destaque' }));
/**
 * Espera achar no destaque. Ele é refeito a cada item novo (outro elemento), então
 * cada tentativa procura o destaque de novo, em vez de guardar o antigo.
 */
const noDestaque = <T,>(achar: (d: ReturnType<typeof destaque>) => T) => waitFor(() => achar(destaque()));
const REUNIAO = evento('Reunião de orientação', { inicio: '2026-11-05T14:00:00+00:00', fim: '2026-11-05T15:00:00+00:00' });
const tarefaPor = async (titulo: string) => (await listar('tarefas')).find((t) => t.titulo === titulo)!;

async function diaComum() {
  await criar('Ler artigo da Renata', { data: '2026-11-05', salaId: 'sala-investigacao', duracaoMin: 45, duracaoConfirmada: true });
  await criar('Rever capítulo 3', { data: '2026-11-05', salaId: 'sala-orientacoes' });
  return scriptDeTeste({
    eventos: [REUNIAO],
    emails: [
      email('Revisão do capítulo 2', { id: 'msg-marina', remetente: 'Marina', data: '2026-11-04T18:05:00+00:00' }),
      email('Dúvida sobre a prova', { id: 'msg-renata', remetente: 'Renata', data: '2026-11-05T09:15:00+00:00' }),
    ],
  });
}

describe('#/agora', () => {
  it('é uma tela de verdade: título, tempo livre, destaque e a fila depois dele', async () => {
    await diaComum();
    mostrar('#/agora', 1280);
    expect(principal().getByRole('heading', { level: 1, name: 'Agora' })).toBeTruthy();
    expect(principal().queryByText('Esta tela chega numa próxima versão.')).toBeNull();
    expect(await principal().findByText(inteiro('Livre até 14:00, quando começa Reunião de orientação.'))).toBeTruthy();
    expect(principal().getByText('Você tem 1 h 40.')).toBeTruthy();

    // O destaque é o primeiro da fila.
    expect(await noDestaque((d) => d.getByRole('heading', { name: 'Ler artigo da Renata' }))).toBeTruthy();
    expect(destaque().getByText('Por que agora: para hoje')).toBeTruthy();
    expect(destaque().getByText('45 min')).toBeTruthy();
    expect(destaque().getByText('Cabe agora')).toBeTruthy();
    expect(destaque().getByText('Investigação')).toBeTruthy();

    // A seguir: o resto, sem repetir o destaque.
    const seguir = within(principal().getByRole('region', { name: /^A seguir/ }));
    const linhas = seguir.getAllByRole('listitem');
    expect(linhas.map((li) => li.querySelector('.fila-titulo')?.textContent)).toEqual(['Rever capítulo 3', 'E-mail Revisão do capítulo 2', 'E-mail Dúvida sobre a prova']);
    expect(linhas[0].textContent).toContain('cerca de 1 h');
    // Não cabe: sem selo (a ordem já diz que vem depois).
    expect(within(linhas[0]).queryByText('Cabe agora')).toBeNull();
    expect(within(linhas[0]).queryByText('Depois')).toBeNull();
  });

  it('o painel direito não repete o Agora quando a página já é ele', async () => {
    await diaComum();
    mostrar('#/agora', 1280);
    const lado = within(screen.getByRole('complementary', { name: 'Agora, água e chat' }));
    expect(lado.queryByRole('heading', { name: 'Agora' })).toBeNull();
    expect(lado.getByRole('heading', { name: 'Chat' })).toBeTruthy();
  });

  it('Concluir o destaque: o próximo assume, e Desfazer devolve', async () => {
    await diaComum();
    mostrar('#/agora', 1280);
    fireEvent.click(await noDestaque((d) => d.getByRole('button', { name: 'Concluir: Ler artigo da Renata' })));
    expect(await noDestaque((d) => d.getByRole('heading', { name: 'Rever capítulo 3' }))).toBeTruthy();
    const desfazer = await principal().findByRole('button', { name: 'Desfazer' });
    expect(principal().getByText('Tarefa concluída: Ler artigo da Renata')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(desfazer));
    expect((await tarefaPor('Ler artigo da Renata')).feito).toBe(true);

    fireEvent.click(desfazer);
    expect(await noDestaque((d) => d.getByRole('heading', { name: 'Ler artigo da Renata' }))).toBeTruthy();
    expect((await tarefaPor('Ler artigo da Renata')).feito).toBe(false);
  });

  it('Agora não numa tarefa: sai da fila até amanhã; Desfazer devolve', async () => {
    await diaComum();
    mostrar('#/agora', 1280);
    fireEvent.click(await noDestaque((d) => d.getByRole('button', { name: 'Agora não: Ler artigo da Renata' })));
    expect(await noDestaque((d) => d.getByRole('heading', { name: 'Rever capítulo 3' }))).toBeTruthy();
    expect(principal().getByText('Volta amanhã: Ler artigo da Renata')).toBeTruthy();
    expect((await tarefaPor('Ler artigo da Renata')).adiadaAte).toBe('2026-11-06');
    fireEvent.click(principal().getByRole('button', { name: 'Desfazer' }));
    expect(await noDestaque((d) => d.getByRole('heading', { name: 'Ler artigo da Renata' }))).toBeTruthy();
  });

  it('e-mail em destaque: Responder, Virar tarefa, Agora não e Feito; nada muda no Gmail', async () => {
    const script = await scriptDeTeste({
      eventos: [],
      emails: [email('Revisão do capítulo 2', { id: 'msg-marina', remetente: 'Marina' }), email('Dúvida sobre a prova', { id: 'msg-renata', remetente: 'Renata' })],
    });
    mostrar('#/agora', 1280);
    expect(await noDestaque((d) => d.getByRole('heading', { name: 'Revisão do capítulo 2' }))).toBeTruthy();
    const grupo = within(destaque().getByRole('group', { name: 'Ações: Revisão do capítulo 2' }));
    const nomes = Array.from(destaque().getByRole('group', { name: 'Ações: Revisão do capítulo 2' }).querySelectorAll('a, button')).map((el) => el.textContent);
    expect(nomes).toEqual(['Responder', 'Virar tarefa', 'Agora não', 'Feito']);
    expect(grupo.getByRole('link', { name: /^Responder/ }).getAttribute('target')).toBe('_blank');

    fireEvent.click(grupo.getByRole('button', { name: 'Feito: Revisão do capítulo 2' }));
    expect(await noDestaque((d) => d.getByRole('heading', { name: 'Dúvida sobre a prova' }))).toBeTruthy();
    await vi.waitFor(async () => expect((await listar('estadosEmail')).find((e) => e.id === 'msg-marina')?.feito).toBe(true));

    fireEvent.click(within(destaque().getByRole('group', { name: 'Ações: Dúvida sobre a prova' })).getByRole('button', { name: 'Virar tarefa: Dúvida sobre a prova' }));
    // A tarefa nasce em Sem prazo, ligada ao e-mail (como no Por responder): sai da fila até ganhar dia.
    expect(await principal().findByText('Tarefa criada: Responder: Dúvida sobre a prova')).toBeTruthy();
    expect(await principal().findByText('Nada na fila agora.')).toBeTruthy();
    await vi.waitFor(async () => expect(await tarefaPor('Responder: Dúvida sobre a prova')).toMatchObject({ emailId: 'msg-renata' }));
    expect((await tarefaPor('Responder: Dúvida sobre a prova')).data).toBeUndefined();
    // Só leitura de e-mail saiu do aparelho: nada de Feito ou de tarefa vai para o Gmail.
    expect(script.acoes().filter((a) => a.toLowerCase().includes('mail'))).toEqual(expect.arrayContaining(['emails']));
    expect(script.acoes().filter((a) => a.toLowerCase().includes('mail') && a !== 'emails' && a !== 'atualizarEmails')).toEqual([]);
  });

  it('com um compromisso em andamento, não há tempo livre e nada cabe', async () => {
    await criar('Rever capítulo 3', { data: '2026-11-05' });
    await scriptDeTeste({ eventos: [evento('Aula de métodos', { inicio: '2026-11-05T12:00:00+00:00', fim: '2026-11-05T13:00:00+00:00' })] });
    mostrar('#/agora', 1280);
    expect(await principal().findByText(inteiro('Agora: Aula de métodos, até 13:00.'))).toBeTruthy();
    expect(await noDestaque((d) => d.getByRole('heading', { name: 'Rever capítulo 3' }))).toBeTruthy();
    expect(destaque().queryByText('Cabe agora')).toBeNull();
  });

  it('fila vazia diz isso com calma', async () => {
    await scriptDeTeste();
    mostrar('#/agora', 1280);
    expect(await principal().findByText('Nada na fila agora.')).toBeTruthy();
    expect(principal().queryByRole('region', { name: 'Em destaque' })).toBeNull();
  });

  it('tarefa de marcar: Concluir pergunta quando ficou marcado', async () => {
    await criar('Marcar reunião com a Marina', { data: '2026-11-05', marcar: true });
    await scriptDeTeste();
    mostrar('#/agora', 1280);
    fireEvent.click(await noDestaque((d) => d.getByRole('button', { name: 'Concluir: Marcar reunião com a Marina' })));
    const caixa = within(await screen.findByRole('dialog', { name: 'Quando ficou marcado?' }));
    fireEvent.click(caixa.getByRole('button', { name: 'Concluir sem agenda' }));
    expect(await principal().findByText('Tarefa concluída: Marcar reunião com a Marina')).toBeTruthy();
    expect((await tarefaPor('Marcar reunião com a Marina')).feito).toBe(true);
  });
});

describe('abas do Agora: Agora, Triagem e Fechar o dia', () => {
  const abas = () => within(principal().getByRole('tablist', { name: 'Modo do Agora' }));

  it('três abas, com a contagem da triagem; setas trocam de aba', async () => {
    await diaComum();
    mostrar('#/agora', 1280);
    await waitFor(() => expect(abas().getAllByRole('tab').map((t) => t.textContent)).toEqual(['Agora', 'Triagem (2)', 'Fechar o dia']));
    const [agora, triagem, fechar] = abas().getAllByRole('tab');
    expect(agora.getAttribute('aria-selected')).toBe('true');
    expect(triagem.getAttribute('tabindex')).toBe('-1');

    agora.focus();
    fireEvent.keyDown(agora, { key: 'ArrowRight' });
    expect(triagem.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(triagem);
    fireEvent.keyDown(triagem, { key: 'End' });
    expect(fechar.getAttribute('aria-selected')).toBe('true');
    expect(principal().getByRole('tabpanel', { name: 'Fechar o dia' })).toBeTruthy();
    fireEvent.keyDown(fechar, { key: 'ArrowRight' });
    expect(agora.getAttribute('aria-selected')).toBe('true');
  });

  it('Triagem: um e-mail de cada vez, do mais antigo; Feito passa ao próximo, com Desfazer', async () => {
    await diaComum();
    mostrar('#/agora', 1280);
    await waitFor(() => expect(abas().getByRole('tab', { name: 'Triagem (2)' })).toBeTruthy());
    fireEvent.click(abas().getByRole('tab', { name: 'Triagem (2)' }));
    const painel = within(principal().getByRole('tabpanel', { name: /Triagem/ }));
    expect(await painel.findByText('2 e-mails por decidir. Um de cada vez.')).toBeTruthy();
    expect(painel.getAllByRole('listitem')).toHaveLength(1);
    expect(painel.getByText('Revisão do capítulo 2')).toBeTruthy();

    fireEvent.click(painel.getByRole('button', { name: 'Feito: Revisão do capítulo 2' }));
    expect(await painel.findByText('Dúvida sobre a prova')).toBeTruthy();
    expect(painel.getByText('1 e-mail por decidir. Um de cada vez.')).toBeTruthy();
    fireEvent.click(painel.getByRole('button', { name: 'Desfazer' }));
    expect(await painel.findByText('Revisão do capítulo 2')).toBeTruthy();
  });

  it('Triagem vazia', async () => {
    await scriptDeTeste();
    mostrar('#/agora', 1280);
    fireEvent.click(await abas().findByRole('tab', { name: 'Triagem' }));
    expect(await principal().findByText('Nada por decidir. Cada e-mail já tem destino.')).toBeTruthy();
  });

  it('Fechar o dia mora numa aba do Agora', async () => {
    await diaComum();
    mostrar('#/agora', 1280);
    fireEvent.click(abas().getByRole('tab', { name: 'Fechar o dia' }));
    expect(within(principal().getByRole('tabpanel', { name: 'Fechar o dia' })).getByRole('button', { name: 'Fechar o dia' })).toBeTruthy();
  });
});

describe('cartão Agora no painel direito (computador)', () => {
  const lado = () => within(screen.getByRole('complementary', { name: 'Agora, água e chat' }).querySelector('.cartao-agora') as HTMLElement);

  it('tempo livre, destaque com ação e o caminho para o Agora; sem "Em breve" nem os próximos', async () => {
    await diaComum();
    mostrar('#/', 1280);
    expect(await lado().findByText('Livre até 14:00 · 1 h 40')).toBeTruthy();
    expect(await lado().findByText('Ler artigo da Renata')).toBeTruthy();
    expect(lado().getByRole('button', { name: 'Concluir: Ler artigo da Renata' })).toBeTruthy();
    // Os seguintes não se repetem no cartão: estão em A seguir, no Painel.
    expect(lado().queryByText('Rever capítulo 3')).toBeNull();
    expect(lado().getByRole('link', { name: 'Abrir o Agora' }).getAttribute('href')).toBe('#/agora');
    expect(lado().queryByText('Em breve')).toBeNull();
  });

  it('concluir no cartão do lado também atualiza o Painel', async () => {
    await diaComum();
    mostrar('#/', 1280);
    fireEvent.click(await lado().findByRole('button', { name: 'Concluir: Ler artigo da Renata' }));
    const checklist = within(principal().getByRole('region', { name: 'Checklist do dia' }));
    await waitFor(() => expect(checklist.getByRole('checkbox', { name: 'Ler artigo da Renata' }).getAttribute('aria-checked')).toBe('true'));
    expect(await lado().findByRole('button', { name: 'Desfazer' })).toBeTruthy();
    await act(async () => {
      fireEvent.click(lado().getByRole('button', { name: 'Desfazer' }));
    });
    await waitFor(() => expect(checklist.getByRole('checkbox', { name: 'Ler artigo da Renata' }).getAttribute('aria-checked')).toBe('false'));
  });
});

describe('Agora no celular', () => {
  it('a folha Mais leva ao Agora', async () => {
    await scriptDeTeste();
    mostrar('#/', 390);
    fireEvent.click(screen.getByRole('button', { name: 'Mais' }));
    const folha = within(screen.getByRole('dialog', { name: 'Mais' }));
    expect(folha.getByRole('link', { name: 'Agora' }).getAttribute('href')).toBe('#/agora');
  });
});
