import { fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listar, listarPendentes, semear } from '../../src/dados/loja';
import { fimSugerido, tituloDoCompromisso } from '../../src/dados/marcar';
import { Checklist } from '../../src/ui/Checklist';
import { agendaEscrita } from '../apoio/agenda-escrita';
import { criar } from '../apoio/tarefas';

// Quinta-feira, 2026-11-05, 12:20 (Europe/Lisbon). Só a data é falsa.
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-11-05T12:20:00Z'));
  await semear();
});

const TITULO = 'Marcar reunião com a Marina';

async function abrir() {
  const agenda = agendaEscrita();
  await agenda.instalar();
  const tarefa = await criar(TITULO, { data: '2026-11-05', salaId: 'sala-orientacoes', marcar: true });
  render(<Checklist />);
  fireEvent.click(await screen.findByRole('checkbox', { name: TITULO }));
  const caixa = await screen.findByRole('dialog');
  return { agenda, tarefa, caixa: within(caixa), elemento: caixa };
}

const campo = (caixa: ReturnType<typeof within>, nome: string) => caixa.getByLabelText(nome) as HTMLInputElement;
const botaoDeConcluir = () => screen.getByRole('checkbox', { name: TITULO });
const feita = async () => (await listar('tarefas'))[0].feito;

function preencher(caixa: ReturnType<typeof within>, inicio: string) {
  fireEvent.input(campo(caixa, 'Início'), { target: { value: inicio } });
}

describe('funções da caixa', () => {
  it('o fim sugerido é uma hora depois do início, sem passar do dia', () => {
    expect(fimSugerido('15:30')).toBe('16:30');
    expect(fimSugerido('09:00')).toBe('10:00');
    expect(fimSugerido('23:30')).toBe('23:59');
    expect(fimSugerido('')).toBe('');
    expect(fimSugerido('25:00')).toBe('');
  });

  it('o título na agenda não leva o "Marcar" do começo', () => {
    expect(tituloDoCompromisso('Marcar reunião com a Marina')).toBe('Reunião com a Marina');
    expect(tituloDoCompromisso('marcar banca')).toBe('Banca');
    expect(tituloDoCompromisso('Remarcar aula')).toBe('Remarcar aula');
    expect(tituloDoCompromisso('Marcar')).toBe('Marcar');
  });
});

describe('concluir uma tarefa de marcar', () => {
  it('abre a caixa com Dia, Início e Fim, e não conclui ainda', async () => {
    const { caixa, elemento } = await abrir();

    expect(elemento.getAttribute('aria-modal')).toBe('true');
    expect(caixa.getByRole('heading', { name: 'Quando ficou marcado?' })).toBeTruthy();
    expect(caixa.getByText(TITULO)).toBeTruthy();
    expect(campo(caixa, 'Dia').value).toBe('2026-11-05');
    expect(campo(caixa, 'Início').value).toBe('');
    expect(campo(caixa, 'Fim').value).toBe('');
    for (const nome of ['Colocar na agenda', 'Concluir sem agenda', 'Ainda não marquei']) {
      expect(caixa.getByRole('button', { name: nome })).toBeTruthy();
    }
    expect(await feita()).toBe(false);
    expect(document.activeElement).toBe(elemento);
  });

  it('tarefa que não é de marcar conclui direto, sem caixa', async () => {
    await criar('Rever o capítulo', { data: '2026-11-05' });
    render(<Checklist />);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Rever o capítulo' }));
    await waitFor(async () => expect(await feita()).toBe(true));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('início 15:30 sugere fim 16:30; o fim que o dono escolheu não é mais trocado', async () => {
    const { caixa } = await abrir();

    preencher(caixa, '15:30');
    expect(campo(caixa, 'Fim').value).toBe('16:30');

    fireEvent.input(campo(caixa, 'Fim'), { target: { value: '17:15' } });
    preencher(caixa, '16:00');
    expect(campo(caixa, 'Fim').value).toBe('17:15');
  });

  it('Colocar na agenda cria o compromisso e conclui a tarefa', async () => {
    const { caixa, agenda } = await abrir();
    preencher(caixa, '15:30');
    fireEvent.input(campo(caixa, 'Dia'), { target: { value: '2026-11-06' } });

    fireEvent.click(caixa.getByRole('button', { name: 'Colocar na agenda' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(agenda.de('criarEvento')).toHaveLength(1);
    expect(agenda.de('criarEvento')[0].dados).toMatchObject({
      titulo: 'Reunião com a Marina',
      data: '2026-11-06',
      inicio: '15:30',
      fim: '16:30',
      salaId: 'sala-orientacoes',
    });
    expect(await feita()).toBe(true);
    expect(botaoDeConcluir().getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(botaoDeConcluir());
  });

  it('o Desfazer da linha remove o compromisso e reabre a tarefa', async () => {
    const { caixa, agenda } = await abrir();
    preencher(caixa, '15:30');
    fireEvent.click(caixa.getByRole('button', { name: 'Colocar na agenda' }));
    await waitFor(() => expect(agenda.eventos.size).toBe(1));

    fireEvent.click(await screen.findByRole('button', { name: `Desfazer: ${TITULO}` }));

    await waitFor(() => expect(agenda.eventos.size).toBe(0));
    await waitFor(async () => expect(await feita()).toBe(false));
  });

  it('Concluir sem agenda só conclui: nada vai para a agenda nem para a fila', async () => {
    const { caixa, agenda } = await abrir();

    fireEvent.click(caixa.getByRole('button', { name: 'Concluir sem agenda' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await feita()).toBe(true);
    expect(agenda.pedidos).toEqual([]);
    expect((await listarPendentes()).filter((p) => p.tipo === 'agenda')).toEqual([]);
  });

  it('Ainda não marquei fecha a caixa e a tarefa segue aberta', async () => {
    const { caixa, agenda } = await abrir();

    fireEvent.click(caixa.getByRole('button', { name: 'Ainda não marquei' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await feita()).toBe(false);
    expect(botaoDeConcluir().getAttribute('aria-checked')).toBe('false');
    expect(agenda.pedidos).toEqual([]);
    expect(document.activeElement).toBe(botaoDeConcluir());
  });

  it('Esc fecha sem concluir e devolve o foco à caixa de concluir', async () => {
    const { elemento, agenda } = await abrir();

    fireEvent.keyDown(elemento, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await feita()).toBe(false);
    expect(agenda.pedidos).toEqual([]);
    expect(document.activeElement).toBe(botaoDeConcluir());
  });

  it('o foco fica preso na caixa: Tab no último volta ao primeiro, Shift+Tab no primeiro vai ao último', async () => {
    const { caixa, elemento } = await abrir();
    const ultimo = caixa.getByRole('button', { name: 'Ainda não marquei' });
    const primeiro = campo(caixa, 'Dia');

    ultimo.focus();
    fireEvent.keyDown(ultimo, { key: 'Tab' });
    expect(document.activeElement).toBe(primeiro);

    primeiro.focus();
    fireEvent.keyDown(primeiro, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(ultimo);

    elemento.focus();
    fireEvent.keyDown(elemento, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(ultimo);
  });

  it('sem hora de início, avisa e não cria nada', async () => {
    const { caixa, agenda } = await abrir();

    fireEvent.click(caixa.getByRole('button', { name: 'Colocar na agenda' }));

    const alerta = await caixa.findByRole('alert');
    expect(alerta.textContent).toBe('Escolha a hora de início.');
    expect(campo(caixa, 'Início').getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(campo(caixa, 'Início'));
    expect(agenda.pedidos).toEqual([]);
    expect(await feita()).toBe(false);
  });

  it('fim antes do início e dia que já passou também avisam', async () => {
    const { caixa } = await abrir();
    preencher(caixa, '15:30');
    fireEvent.input(campo(caixa, 'Fim'), { target: { value: '15:00' } });
    fireEvent.click(caixa.getByRole('button', { name: 'Colocar na agenda' }));
    expect((await caixa.findByRole('alert')).textContent).toBe('O fim precisa ser depois do início.');

    fireEvent.input(campo(caixa, 'Dia'), { target: { value: '2026-11-04' } });
    fireEvent.click(caixa.getByRole('button', { name: 'Colocar na agenda' }));
    await waitFor(() => expect(caixa.getByRole('alert').textContent).toBe('Esse dia já passou. Escolha hoje ou depois.'));
  });

  it('sem internet, o compromisso fica em `pendentes` com o id, a tarefa conclui e a caixa avisa', async () => {
    const { caixa, agenda } = await abrir();
    agenda.modo('rede');
    preencher(caixa, '15:30');

    fireEvent.click(caixa.getByRole('button', { name: 'Colocar na agenda' }));

    const aviso = await caixa.findByRole('status');
    expect(aviso.textContent).toContain('Sem internet. O compromisso entra na agenda quando a conexão voltar.');
    const naFila = (await listarPendentes()).filter((p) => p.tipo === 'agenda');
    expect(naFila).toEqual([
      expect.objectContaining({
        acao: 'criarEvento',
        evento: expect.objectContaining({ id: expect.stringMatching(/^[0-9a-f]{32}$/), titulo: 'Reunião com a Marina', inicio: '15:30', fim: '16:30' }),
      }),
    ]);
    expect(await feita()).toBe(true);

    fireEvent.click(caixa.getByRole('button', { name: 'Entendi' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('o Desfazer de uma tarefa concluída com o compromisso ainda na fila só tira o pedido da fila', async () => {
    const { caixa, agenda } = await abrir();
    agenda.modo('rede');
    preencher(caixa, '15:30');
    fireEvent.click(caixa.getByRole('button', { name: 'Colocar na agenda' }));
    fireEvent.click(await caixa.findByRole('button', { name: 'Entendi' }));
    agenda.modo('ok');

    fireEvent.click(await screen.findByRole('button', { name: `Desfazer: ${TITULO}` }));

    await waitFor(async () => expect(await feita()).toBe(false));
    expect((await listarPendentes()).filter((p) => p.tipo === 'agenda')).toEqual([]);
    expect(agenda.eventos.size).toBe(0);
  });
});
