// Tarefa 16: Fechar o dia mostra o que ficou, com ação para tarefas e
// e-mails, e termina num passo final. Tudo tem Desfazer.
import { configure, fireEvent, render, waitFor, within } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { limparConversa } from '../../src/chat/conversa';
import { lerConfig, listar, semear, semearPalavras } from '../../src/dados/loja';
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

function mostrar(largura = 1280) {
  Object.defineProperty(window, 'innerWidth', { value: largura, configurable: true, writable: true });
  history.replaceState(null, '', '/#/');
  return render(<App />);
}

const fechar = () => within(within(document.querySelector('main') as HTMLElement).getByRole('region', { name: 'Fechar o dia' }));
const tarefas = () => within(fechar().getByRole('list', { name: 'Tarefas que ficaram' }));
/** As listas aparecem depois de ler o banco (e os e-mails, o script): espera por elas. */
const listaDeTarefas = async () => within(await fechar().findByRole('list', { name: 'Tarefas que ficaram' }));
const listaDeEmails = async () => within(await fechar().findByRole('list', { name: 'E-mails sem resposta' }));
const tarefaPor = async (titulo: string) => (await listar('tarefas')).find((t) => t.titulo === titulo)!;

async function diaComSobras() {
  await criar('Feita de manhã', { data: '2026-11-05', feito: true });
  await criar('Rever capítulo 3', { data: '2026-11-05', salaId: 'sala-orientacoes' });
  await criar('Ler artigo', { data: '2026-11-04' });
  return scriptDeTeste({ emails: [email('Revisão do capítulo 2', { id: 'msg-marina', remetente: 'Marina' })] });
}

describe('Fechar o dia: o que ficou', () => {
  it('resume o dia com plurais certos', async () => {
    await diaComSobras();
    mostrar();
    expect(await fechar().findByText('Hoje: 1 tarefa feita, 2 em aberto e 1 e-mail sem resposta.')).toBeTruthy();
  });

  it('plural: 2 tarefas feitas, 1 em aberto, nenhum e-mail', async () => {
    await criar('A', { data: '2026-11-05', feito: true });
    await criar('B', { data: '2026-11-05', feito: true });
    await criar('C', { data: '2026-11-05' });
    await scriptDeTeste();
    mostrar();
    expect(await fechar().findByText('Hoje: 2 tarefas feitas, 1 em aberto e nenhum e-mail sem resposta.')).toBeTruthy();
    expect(fechar().getByText('Nenhum e-mail esperando resposta.')).toBeTruthy();
  });

  it('cada tarefa tem Amanhã, Sem prazo e Feita; Amanhã muda a data e Desfazer volta', async () => {
    await diaComSobras();
    mostrar();
    await waitFor(() => expect(tarefas().getAllByRole('listitem')).toHaveLength(2));
    const grupo = within(tarefas().getByRole('group', { name: 'O que fazer com: Rever capítulo 3' }));
    expect(grupo.getAllByRole('button').map((b) => b.textContent)).toEqual(['Amanhã', 'Sem prazo', 'Feita']);

    fireEvent.click(grupo.getByRole('button', { name: 'Amanhã' }));
    await vi.waitFor(async () => expect((await tarefaPor('Rever capítulo 3')).data).toBe('2026-11-06'));
    expect(await fechar().findByText('Para amanhã: Rever capítulo 3')).toBeTruthy();
    await waitFor(() => expect(tarefas().getAllByRole('listitem')).toHaveLength(1));
    const desfazer = fechar().getByRole('button', { name: 'Desfazer' });
    await waitFor(() => expect(document.activeElement).toBe(desfazer));

    fireEvent.click(desfazer);
    await vi.waitFor(async () => expect((await tarefaPor('Rever capítulo 3')).data).toBe('2026-11-05'));
    await waitFor(() => expect(tarefas().getAllByRole('listitem')).toHaveLength(2));
  });

  it('Sem prazo tira a data; Feita conclui; os dois com Desfazer', async () => {
    await diaComSobras();
    mostrar();
    const grupoDe = async (titulo: string) => within(await (await listaDeTarefas()).findByRole('group', { name: `O que fazer com: ${titulo}` }));

    fireEvent.click((await grupoDe('Ler artigo')).getByRole('button', { name: 'Sem prazo' }));
    await vi.waitFor(async () => expect((await tarefaPor('Ler artigo')).data).toBeUndefined());
    expect(await fechar().findByText('Em Sem prazo: Ler artigo')).toBeTruthy();
    fireEvent.click(fechar().getByRole('button', { name: 'Desfazer' }));
    await vi.waitFor(async () => expect((await tarefaPor('Ler artigo')).data).toBe('2026-11-04'));

    fireEvent.click((await grupoDe('Rever capítulo 3')).getByRole('button', { name: 'Feita' }));
    await vi.waitFor(async () => expect((await tarefaPor('Rever capítulo 3')).feito).toBe(true));
    expect(await fechar().findByText('Tarefa concluída: Rever capítulo 3')).toBeTruthy();
    fireEvent.click(fechar().getByRole('button', { name: 'Desfazer' }));
    await vi.waitFor(async () => expect((await tarefaPor('Rever capítulo 3')).feito).toBe(false));
  });

  it('prazo vencido não vai para Sem prazo (tem hora)', async () => {
    await criar('Entrega do relatório', { data: '2026-11-04', prazoHora: '17:00' });
    await scriptDeTeste();
    mostrar();
    const grupo = within(await (await listaDeTarefas()).findByRole('group', { name: 'O que fazer com: Entrega do relatório' }));
    expect(grupo.getAllByRole('button').map((b) => b.textContent)).toEqual(['Amanhã', 'Feita']);
  });

  it('Passar todas para amanhã, com um Desfazer só', async () => {
    await diaComSobras();
    mostrar();
    fireEvent.click(await fechar().findByRole('button', { name: 'Passar as 2 para amanhã' }));
    await vi.waitFor(async () => {
      expect((await tarefaPor('Rever capítulo 3')).data).toBe('2026-11-06');
      expect((await tarefaPor('Ler artigo')).data).toBe('2026-11-06');
    });
    expect(await fechar().findByText('2 tarefas para amanhã')).toBeTruthy();
    expect(await fechar().findByText('Nenhuma tarefa ficou para trás.')).toBeTruthy();
    fireEvent.click(fechar().getByRole('button', { name: 'Desfazer' }));
    await vi.waitFor(async () => {
      expect((await tarefaPor('Rever capítulo 3')).data).toBe('2026-11-05');
      expect((await tarefaPor('Ler artigo')).data).toBe('2026-11-04');
    });
  });

  it('cada e-mail tem Agora não e Feito, com Desfazer; o Gmail não muda', async () => {
    const script = await diaComSobras();
    mostrar();
    const grupo = within(await (await listaDeEmails()).findByRole('group', { name: 'O que fazer com: Revisão do capítulo 2' }));
    expect(grupo.getAllByRole('button').map((b) => b.textContent)).toEqual(['Agora não', 'Feito']);

    fireEvent.click(grupo.getByRole('button', { name: 'Agora não' }));
    await vi.waitFor(async () => expect((await listar('estadosEmail'))[0]).toMatchObject({ id: 'msg-marina', adiadaAte: '2026-11-06' }));
    expect(await fechar().findByText('E-mail adiado para amanhã')).toBeTruthy();
    expect(await fechar().findByText('Nenhum e-mail esperando resposta.')).toBeTruthy();
    fireEvent.click(fechar().getByRole('button', { name: 'Desfazer' }));
    await vi.waitFor(async () => expect(await listar('estadosEmail')).toEqual([]));

    fireEvent.click(within(await (await listaDeEmails()).findByRole('group', { name: 'O que fazer com: Revisão do capítulo 2' })).getByRole('button', { name: 'Feito' }));
    await vi.waitFor(async () => expect((await listar('estadosEmail'))[0]).toMatchObject({ id: 'msg-marina', feito: true }));
    expect(script.acoes().filter((a) => a.toLowerCase().includes('mail') && a !== 'emails')).toEqual([]);
  });
});

describe('Fechar o dia: o passo final', () => {
  it('fecha o dia (guardado nos ajustes) e Desfazer reabre', async () => {
    await diaComSobras();
    mostrar();
    expect(await fechar().findByText('O que ficar em aberto volta amanhã sozinho.')).toBeTruthy();
    fireEvent.click(fechar().getByRole('button', { name: 'Fechar o dia' }));
    expect(await fechar().findByText('Dia fechado.')).toBeTruthy();
    expect(fechar().getByText('Você concluiu 1 tarefa hoje. 2 tarefas voltam amanhã.')).toBeTruthy();
    await vi.waitFor(async () => expect((await lerConfig()).diaFechado).toBe('2026-11-05'));
    // As listas do que ficou saem de cena: o dia acabou.
    expect(fechar().queryByRole('list', { name: 'Tarefas que ficaram' })).toBeNull();
    const desfazer = fechar().getByRole('button', { name: 'Desfazer' });
    await waitFor(() => expect(document.activeElement).toBe(desfazer));

    fireEvent.click(desfazer);
    expect(await fechar().findByRole('button', { name: 'Fechar o dia' })).toBeTruthy();
    await vi.waitFor(async () => expect((await lerConfig()).diaFechado).toBeUndefined());
  });

  it('o dia fechado continua fechado ao abrir o app de novo, com Reabrir o dia', async () => {
    await diaComSobras();
    const { unmount } = mostrar();
    fireEvent.click(await fechar().findByRole('button', { name: 'Fechar o dia' }));
    await vi.waitFor(async () => expect((await lerConfig()).diaFechado).toBe('2026-11-05'));
    unmount();
    mostrar();
    expect(await fechar().findByText('Dia fechado.')).toBeTruthy();
    fireEvent.click(fechar().getByRole('button', { name: 'Reabrir o dia' }));
    expect(await fechar().findByRole('button', { name: 'Fechar o dia' })).toBeTruthy();
  });

  it('a mensagem do dia acompanha', async () => {
    await diaComSobras();
    mostrar();
    fireEvent.click(await fechar().findByRole('button', { name: 'Fechar o dia' }));
    const mensagem = within(within(document.querySelector('main') as HTMLElement).getByRole('region', { name: 'Mensagem do dia' }));
    expect(await mensagem.findByText('Dia fechado. O que ficou em aberto volta amanhã.')).toBeTruthy();
  });

  it('uma tarefa só volta no singular', async () => {
    await criar('Rever capítulo 3', { data: '2026-11-05' });
    await scriptDeTeste();
    mostrar();
    fireEvent.click(await fechar().findByRole('button', { name: 'Fechar o dia' }));
    expect(await fechar().findByText('Nenhuma tarefa concluída hoje. 1 tarefa volta amanhã.')).toBeTruthy();
  });
});
