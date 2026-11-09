// Tarefa 16: o Painel do dia inteiro, na ordem da especificação (seção 7).
import { act, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { limparConversa } from '../../src/chat/conversa';
import { listar, salvar, semear, semearPalavras } from '../../src/dados/loja';
import { email } from '../apoio/emails-ui';
import { evento } from '../apoio/agenda-ui';
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
const regiao = (nome: string | RegExp) => within(principal().getByRole('region', { name: nome }));

const REUNIAO = evento('Reunião de orientação', { inicio: '2026-11-05T14:00:00+00:00', fim: '2026-11-05T15:00:00+00:00' });

/** Um dia comum: reunião às 14:00, duas tarefas de hoje e um e-mail da Marina. */
async function diaComum(extra: { emails?: ReturnType<typeof email>[] } = {}) {
  await criar('Ler artigo da Renata', { data: '2026-11-05', salaId: 'sala-investigacao', duracaoMin: 45, duracaoConfirmada: true });
  await criar('Rever capítulo 3', { data: '2026-11-05', salaId: 'sala-orientacoes' });
  return scriptDeTeste({
    eventos: [REUNIAO],
    emails: extra.emails ?? [email('Revisão do capítulo 2', { id: 'msg-marina', remetente: 'Marina', data: '2026-11-05T10:20:00+00:00' })],
  });
}

const ORDEM = [
  'Mensagem do dia',
  'Linha do dia',
  'Pendências das salas',
  'Checklist do dia',
  'Agenda de hoje',
  /^Por responder/,
  /^A seguir/,
  'Sem prazo',
  'Fechar o dia',
];

describe('Painel do dia: a ordem da especificação', () => {
  it('mensagem do dia, linha do dia, caixas das salas, Checklist ao lado de Agenda, Por responder ao lado de A seguir, Sem prazo, Fechar o dia', async () => {
    await diaComum();
    mostrar('#/', 1280);
    await principal().findByRole('region', { name: 'Fechar o dia' });

    const nomes = principal()
      .getAllByRole('region')
      .map((r) => r.getAttribute('aria-label') ?? document.getElementById(r.getAttribute('aria-labelledby') ?? '')?.textContent ?? '')
      .filter((nome) => ORDEM.some((esperado) => (typeof esperado === 'string' ? esperado === nome : esperado.test(nome))));
    expect(nomes.map((n) => n.replace(/\d+ (itens|item|e-mails?)$/, '').trim())).toEqual([
      'Mensagem do dia',
      'Linha do dia',
      'Pendências das salas',
      'Checklist do dia',
      'Agenda de hoje',
      'Por responder',
      'A seguir',
      'Sem prazo',
      'Fechar o dia',
    ]);

    // "Ao lado": os dois de cada par dividem a mesma linha da grade.
    const secao = (nome: string | RegExp) => principal().getByRole('region', { name: nome });
    expect(secao('Checklist do dia').parentElement).toBe(secao('Agenda de hoje').parentElement);
    expect(secao(/^Por responder/).parentElement).toBe(secao(/^A seguir/).parentElement);
    expect(secao(/^Por responder/).parentElement?.classList.contains('hoje-grade')).toBe(true);
    expect(secao('Sem prazo').parentElement).not.toBe(secao(/^A seguir/).parentElement);
  });

  it('no celular (390 px) a ordem é a mesma', async () => {
    await diaComum();
    mostrar('#/', 390);
    await principal().findByRole('region', { name: 'Fechar o dia' });
    const posicao = (nome: string | RegExp) => principal().getAllByRole('region').indexOf(principal().getByRole('region', { name: nome }));
    const posicoes = ORDEM.map(posicao);
    expect([...posicoes].sort((a, b) => a - b)).toEqual(posicoes);
  });

  it('mantém a agenda de hoje sendo lida (o tempo livre depende dela)', async () => {
    const script = await diaComum();
    mostrar('#/', 390);
    await waitFor(() => expect(script.leiturasDaAgenda()).toContainEqual({ de: '2026-11-05', ate: '2026-11-05' }));
  });
});

describe('Mensagem do dia', () => {
  it('saudação, a data e o resumo do dia, com plurais certos', async () => {
    await diaComum({
      emails: [email('Revisão do capítulo 2', { remetente: 'Marina' }), email('Dúvida sobre a prova', { remetente: 'Renata' })],
    });
    mostrar('#/', 1280);
    const mensagem = regiao('Mensagem do dia');
    expect(mensagem.getByText('Boa tarde')).toBeTruthy();
    expect(mensagem.getByText('Quinta-feira, 5 de novembro')).toBeTruthy();
    expect(
      await mensagem.findByText(
        'Hoje: 2 tarefas em aberto, 2 e-mails por responder e o próximo compromisso às 14:00, Reunião de orientação.',
      ),
    ).toBeTruthy();
  });

  it('no singular: 1 tarefa, 1 e-mail', async () => {
    await criar('Rever capítulo 3', { data: '2026-11-05' });
    await scriptDeTeste({ emails: [email('Revisão do capítulo 2')] });
    mostrar('#/', 1280);
    expect(
      await regiao('Mensagem do dia').findByText('Hoje: 1 tarefa em aberto, 1 e-mail por responder e nenhum compromisso até o fim do dia.'),
    ).toBeTruthy();
  });

  it('de manhã, bom dia; à noite, boa noite', async () => {
    vi.setSystemTime(Date.parse('2026-11-05T08:10:00Z'));
    const { unmount } = render(<App />);
    expect(regiao('Mensagem do dia').getByText('Bom dia')).toBeTruthy();
    unmount();
    vi.setSystemTime(Date.parse('2026-11-05T21:30:00Z'));
    render(<App />);
    expect(regiao('Mensagem do dia').getByText('Boa noite')).toBeTruthy();
  });
});

describe('Linha do dia', () => {
  it('mostra o compromisso de hoje na hora dele e o tempo livre até ele', async () => {
    await diaComum();
    mostrar('#/', 1280);
    const linha = regiao('Linha do dia');
    expect(await linha.findByText('14:00 às 15:00: Reunião de orientação')).toBeTruthy();
    expect(await linha.findByText('Livre até 14:00 · 1 h 40')).toBeTruthy();
  });
});

describe('Caixas das salas', () => {
  it('uma caixa por sala, com as pendências no plural certo; sala sem nada fica "Em dia"', async () => {
    await criar('Rever capítulo 3', { data: '2026-11-05', salaId: 'sala-orientacoes' });
    await criar('Marcar banca', { salaId: 'sala-orientacoes' });
    await criar('Ler artigo', { data: '2026-11-04', salaId: 'sala-investigacao' });
    await criar('Feita hoje', { data: '2026-11-05', salaId: 'sala-casa', feito: true });
    await criar('Só na semana que vem', { data: '2026-11-12', salaId: 'sala-casa' });
    await scriptDeTeste();
    mostrar('#/', 1280);
    const caixas = regiao('Pendências das salas');
    await caixas.findByRole('link', { name: 'Orientações: 2 tarefas' });
    expect(caixas.getAllByRole('link').map((a) => a.getAttribute('aria-label'))).toEqual([
      'Doutoramento: em dia',
      'Investigação: 1 tarefa',
      'Aulas: em dia',
      'Orientações: 2 tarefas',
      'MBA: em dia',
      'Pessoal: em dia',
      // A feita e a da semana que vem não são pendência de hoje.
      'Casa: em dia',
    ]);
    expect(caixas.getByRole('link', { name: 'Orientações: 2 tarefas' }).getAttribute('href')).toBe('#/sala/sala-orientacoes');
    // Na tela, como no modelo: o nome e, embaixo, o número e a palavra no plural certo.
    const tile = (nome: string) => caixas.getByRole('link', { name: nome });
    expect(tile('Investigação: 1 tarefa').querySelector('.caixa-sala-numero')?.textContent).toBe('1');
    expect(tile('Investigação: 1 tarefa').querySelector('.caixa-sala-conta')?.textContent).toBe('1 tarefa');
    expect(tile('Orientações: 2 tarefas').querySelector('.caixa-sala-conta')?.textContent).toBe('2 tarefas');
    expect(tile('Casa: em dia').querySelector('.caixa-sala-conta')?.textContent).toBe('Em dia');
    expect(tile('Casa: em dia').querySelector('.caixa-sala-numero')).toBeNull();
  });

  it('o e-mail de quem é de uma sala conta na caixa dela', async () => {
    await salvar('pessoas', { nome: 'Marina', salaId: 'sala-orientacoes', emails: ['marina@exemplo.invalid'] });
    await criar('Rever capítulo 3', { data: '2026-11-05', salaId: 'sala-orientacoes' });
    await scriptDeTeste({ emails: [email('Revisão do capítulo 2'), email('Nova versão')] });
    mostrar('#/', 1280);
    expect(await regiao('Pendências das salas').findByRole('link', { name: 'Orientações: 1 tarefa e 2 e-mails' })).toBeTruthy();
  });
});

describe('A seguir', () => {
  const linhas = () => regiao(/^A seguir/).getAllByRole('listitem');
  const textoDe = (li: HTMLElement) => li.textContent ?? '';

  it('a fila em ordem depois do destaque do Agora, com "cerca de" e "Cabe agora" só no que cabe', async () => {
    await criar('Arquivar notas', { data: '2026-11-05', duracaoMin: 30, duracaoConfirmada: true });
    await diaComum();
    mostrar('#/', 1280);
    const seguir = regiao(/^A seguir/);
    expect(await seguir.findByText(inteiro('Livre até 14:00, quando começa Reunião de orientação.'))).toBeTruthy();
    expect(seguir.getByText('Você tem 1 h 40.')).toBeTruthy();
    // O primeiro da fila é o destaque do Agora (painel direito): não se repete aqui.
    const lado = within(screen.getByRole('complementary', { name: 'Agora e chat' }));
    expect(await lado.findByText('Arquivar notas')).toBeTruthy();
    await waitFor(() => expect(linhas()).toHaveLength(3));
    expect(seguir.queryByText('Arquivar notas')).toBeNull();
    const [a, b, c] = linhas();
    // 30 + 45 cabem nos 100 livres; + 60 não: dali em diante, sem selo.
    expect(textoDe(a)).toContain('Ler artigo da Renata');
    expect(textoDe(a)).toContain('45 min');
    expect(textoDe(a)).not.toContain('cerca de');
    expect(within(a).getByText('Cabe agora')).toBeTruthy();
    expect(textoDe(b)).toContain('Rever capítulo 3');
    expect(textoDe(b)).toContain('cerca de 1 h');
    expect(within(b).queryByText('Cabe agora')).toBeNull();
    expect(textoDe(c)).toContain('Revisão do capítulo 2');
    // E-mail na fila: curto, a etiqueta e o assunto, sem Responder (ele está no Por responder).
    expect(within(c).getByText('E-mail')).toBeTruthy();
    expect(within(c).queryByRole('link', { name: /^Responder/ })).toBeNull();
    expect(within(c).queryByText('Cabe agora')).toBeNull();
    expect(seguir.queryByText('Depois')).toBeNull();
    expect(seguir.getByRole('heading', { name: /A seguir/ }).textContent).toContain('3 itens');
  });

  it('1 item no singular', async () => {
    await criar('Arquivar notas', { data: '2026-11-05' });
    await criar('Rever capítulo 3', { data: '2026-11-05' });
    await scriptDeTeste();
    mostrar('#/', 1280);
    await waitFor(() => expect(regiao(/^A seguir/).getByRole('heading', { name: /A seguir/ }).textContent).toContain('1 item'));
    expect(regiao(/^A seguir/).getByRole('heading', { name: /A seguir/ }).textContent).not.toContain('1 itens');
  });

  it('sem a agenda, o app não promete o que cabe', async () => {
    await criar('Arquivar notas', { data: '2026-11-05' });
    await criar('Rever capítulo 3', { data: '2026-11-05' });
    await scriptDeTeste({ agendaFalha: true });
    mostrar('#/', 1280);
    const seguir = regiao(/^A seguir/);
    expect(await seguir.findByText('A agenda não carregou: ainda não sei quanto tempo livre há.')).toBeTruthy();
    await seguir.findByText('Rever capítulo 3');
    expect(screen.queryByText('Cabe agora')).toBeNull();
  });

  it('no celular o Agora vem no alto do Painel; A seguir mostra 3 e o resto em "Ver tudo"', async () => {
    for (const t of ['A', 'B', 'C', 'D', 'E']) await criar(`Tarefa ${t}`, { data: '2026-11-05' });
    await scriptDeTeste();
    mostrar('#/', 390);
    const regioes = () => principal().getAllByRole('region');
    const agora = await principal().findByRole('region', { name: 'Agora' });
    expect(regioes().indexOf(agora)).toBeLessThan(regioes().indexOf(principal().getByRole('region', { name: 'Mensagem do dia' })));
    expect(await within(agora).findByText('Tarefa A')).toBeTruthy();
    await waitFor(() => expect(linhas()).toHaveLength(3));
    expect(regiao(/^A seguir/).queryByText('Tarefa A')).toBeNull();
    fireEvent.click(regiao(/^A seguir/).getByRole('button', { name: 'Ver tudo (4)' }));
    expect(linhas()).toHaveLength(4);
  });

  it('tarefa ligada a e-mail tem Responder; se o e-mail já está Feito, não', async () => {
    await criar('Arquivar notas', { data: '2026-11-05' }); // o destaque do Agora
    await criar('Responder: Revisão do capítulo 2', { data: '2026-11-05', emailId: 'msg-marina' });
    await scriptDeTeste({ eventos: [REUNIAO], emails: [email('Revisão do capítulo 2', { id: 'msg-marina' })] });
    mostrar('#/', 1280);
    const seguir = regiao(/^A seguir/);
    const responder = await seguir.findByRole('link', { name: /^Responder: Revisão do capítulo 2/ });
    expect(responder.getAttribute('href')).toMatch(/^https:\/\/mail\.google\.com\/mail\/u\/0\/#all\//);
    expect(responder.getAttribute('target')).toBe('_blank');
    expect(responder.getAttribute('rel')).toBe('noopener noreferrer');

    await act(async () => {
      await salvar('estadosEmail', { id: 'msg-marina', feito: true });
    });
    await waitFor(() => expect(seguir.queryByRole('link', { name: /^Responder/ })).toBeNull());
    // A tarefa continua na fila: só o link sumiu.
    expect(seguir.getByText('Responder: Revisão do capítulo 2')).toBeTruthy();
  });

  it('leva ao Agora', async () => {
    await scriptDeTeste();
    mostrar('#/', 1280);
    expect(regiao(/^A seguir/).getByRole('link', { name: 'Abrir o Agora' }).getAttribute('href')).toBe('#/agora');
  });
});

describe('tarefa Sem prazo ligada a e-mail continua à vista', () => {
  it('fica em Sem prazo e o e-mail, no Por responder, diz que virou tarefa', async () => {
    await criar('Responder: Revisão do capítulo 2', { emailId: 'msg-marina' });
    await scriptDeTeste({ emails: [email('Revisão do capítulo 2', { id: 'msg-marina' })] });
    mostrar('#/', 1280);
    expect(await regiao('Sem prazo').findByRole('checkbox', { name: 'Responder: Revisão do capítulo 2' })).toBeTruthy();
    const porResponder = regiao(/^Por responder/);
    const item = within((await porResponder.findByText('Revisão do capítulo 2')).closest('li') as HTMLElement);
    expect(item.getByText('Virou tarefa')).toBeTruthy();
  });
});

describe('Painel e Sem prazo juntos', () => {
  it('Hoje em Sem prazo leva a tarefa para a checklist e para a fila', async () => {
    await criar('Comprar café');
    await scriptDeTeste();
    mostrar('#/', 1280);
    fireEvent.click(await regiao('Sem prazo').findByRole('button', { name: 'Hoje' }));
    expect(await regiao('Checklist do dia').findByRole('checkbox', { name: 'Comprar café' })).toBeTruthy();
    // E entra na fila: sozinha, ela é o destaque do Agora.
    expect(await within(screen.getByRole('complementary', { name: 'Agora e chat' })).findByText('Comprar café')).toBeTruthy();
    await vi.waitFor(async () => expect((await listar('tarefas'))[0].data).toBe('2026-11-05'));
  });
});
