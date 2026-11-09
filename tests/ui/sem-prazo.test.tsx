import { fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apagar, listar, semear } from '../../src/dados/loja';
import { SemPrazo } from '../../src/ui/SemPrazo';
import { criar } from '../apoio/tarefas';

// Quinta-feira, 2026-11-05, 12:20 (Europe/Lisbon). Só a data é falsa.
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 5, 12, 20));
  await semear();
});

const linha = (titulo: string) => screen.getByText(titulo).closest('li') as HTMLElement;
const aparecer = (titulo: string) => screen.findByText(titulo);
const unica = async () => (await listar('tarefas'))[0];

describe('Sem prazo', () => {
  it('lista só as tarefas abertas sem data e sem semana', async () => {
    await criar('Escrever o resumo', { salaId: 'sala-doutoramento' });
    await criar('Do dia', { data: '2026-11-05' });
    await criar('Da semana', { semana: '2026-11-02' });
    await criar('Feita', { feito: true });
    const apagada = await criar('Apagada');
    await apagar('tarefas', apagada.id);
    render(<SemPrazo />);

    expect(await screen.findByRole('heading', { level: 2, name: 'Sem prazo' })).toBeTruthy();
    await aparecer('Escrever o resumo');
    expect(await within(linha('Escrever o resumo')).findByText('Doutoramento')).toBeTruthy();
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
  });

  it('oferece Hoje, Esta semana e Escolher dia em cada tarefa', async () => {
    await criar('Escrever o resumo');
    await criar('Ler o artigo de Aurora');
    render(<SemPrazo />);
    await aparecer('Escrever o resumo');

    for (const titulo of ['Escrever o resumo', 'Ler o artigo de Aurora']) {
      const grupo = within(screen.getByRole('group', { name: `Quando fazer: ${titulo}` }));
      expect(grupo.getAllByRole('button').map((b) => b.textContent)).toEqual(['Hoje', 'Esta semana', 'Escolher dia']);
    }
  });

  it('Hoje: a tarefa recebe a data de hoje e sai de Sem prazo', async () => {
    await criar('Escrever o resumo');
    render(<SemPrazo />);
    await aparecer('Escrever o resumo');

    fireEvent.click(within(linha('Escrever o resumo')).getByRole('button', { name: 'Hoje' }));

    await waitFor(async () => expect((await unica()).data).toBe('2026-11-05'));
    await waitFor(() => expect(screen.queryByText('Escrever o resumo')).toBeNull());
    expect(await screen.findByText('Nada sem prazo.')).toBeTruthy();
  });

  it('Esta semana: a tarefa fica na semana (segunda-feira) e sem dia', async () => {
    await criar('Escrever o resumo');
    render(<SemPrazo />);
    await aparecer('Escrever o resumo');

    fireEvent.click(within(linha('Escrever o resumo')).getByRole('button', { name: 'Esta semana' }));

    await waitFor(async () => expect((await unica()).semana).toBe('2026-11-02'));
    expect((await unica()).data).toBeUndefined();
    await waitFor(() => expect(screen.queryByText('Escrever o resumo')).toBeNull());
  });

  it('Escolher dia: abre um campo de data; Definir dia grava a data escolhida', async () => {
    await criar('Escrever o resumo');
    render(<SemPrazo />);
    await aparecer('Escrever o resumo');

    fireEvent.click(within(linha('Escrever o resumo')).getByRole('button', { name: 'Escolher dia' }));
    const campo = screen.getByLabelText('Dia para Escrever o resumo') as HTMLInputElement;
    expect(campo.type).toBe('date');
    expect(campo.min).toBe('2026-11-05');
    await waitFor(() => expect(document.activeElement).toBe(campo));
    fireEvent.input(campo, { target: { value: '2026-11-12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Definir dia' }));

    await waitFor(async () => expect((await unica()).data).toBe('2026-11-12'));
    await waitFor(() => expect(screen.queryByText('Escrever o resumo')).toBeNull());
  });

  it('Escolher dia sem escolher nada pede o dia, e dia que já passou é recusado', async () => {
    await criar('Escrever o resumo');
    render(<SemPrazo />);
    await aparecer('Escrever o resumo');
    fireEvent.click(within(linha('Escrever o resumo')).getByRole('button', { name: 'Escolher dia' }));

    fireEvent.click(screen.getByRole('button', { name: 'Definir dia' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Escolha um dia.');

    fireEvent.input(screen.getByLabelText('Dia para Escrever o resumo'), { target: { value: '2026-11-04' } });
    fireEvent.click(screen.getByRole('button', { name: 'Definir dia' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Esse dia já passou. Escolha hoje ou depois.'));
    expect((await unica()).data).toBeUndefined();
  });

  it('Cancelar (e Esc) fecha o campo sem gravar', async () => {
    await criar('Escrever o resumo');
    render(<SemPrazo />);
    await aparecer('Escrever o resumo');
    const abrir = () => fireEvent.click(within(linha('Escrever o resumo')).getByRole('button', { name: 'Escolher dia' }));
    abrir();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByLabelText('Dia para Escrever o resumo')).toBeNull();
    abrir();
    fireEvent.keyDown(screen.getByLabelText('Dia para Escrever o resumo'), { key: 'Escape' });
    expect(screen.queryByLabelText('Dia para Escrever o resumo')).toBeNull();
    expect((await unica()).data).toBeUndefined();
  });

  it('o dia que está sendo escolhido não é apagado por uma atualização de outra tarefa', async () => {
    await criar('Escrever o resumo');
    render(<SemPrazo />);
    await aparecer('Escrever o resumo');
    fireEvent.click(within(linha('Escrever o resumo')).getByRole('button', { name: 'Escolher dia' }));
    const campo = screen.getByLabelText('Dia para Escrever o resumo') as HTMLInputElement;
    fireEvent.input(campo, { target: { value: '2026-11-20' } });
    campo.focus();

    await criar('Chegou de outro aparelho');
    await aparecer('Chegou de outro aparelho');

    expect(screen.getByLabelText('Dia para Escrever o resumo')).toBe(campo);
    expect(campo.value).toBe('2026-11-20');
    expect(document.activeElement).toBe(campo);
  });

  it('concluir daqui tem Desfazer, e a linha fica até sair da página', async () => {
    await criar('Escrever o resumo');
    render(<SemPrazo />);
    await aparecer('Escrever o resumo');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Escrever o resumo' }));
    await waitFor(async () => expect((await unica()).feito).toBe(true));
    const item = within(linha('Escrever o resumo'));
    fireEvent.click(await item.findByRole('button', { name: /^Desfazer/ }));
    await waitFor(async () => expect((await unica()).feito).toBe(false));
  });

  it('depois de mover uma tarefa, o foco vai para a próxima; na última, para o título da seção', async () => {
    await criar('A primeira');
    await criar('B segunda');
    render(<SemPrazo />);
    await aparecer('A primeira');

    fireEvent.click(within(linha('A primeira')).getByRole('button', { name: 'Hoje' }));
    await waitFor(() => expect(screen.queryByText('A primeira')).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(within(linha('B segunda')).getByRole('checkbox', { name: 'B segunda' })),
    );

    fireEvent.click(within(linha('B segunda')).getByRole('button', { name: 'Hoje' }));
    await waitFor(() => expect(screen.queryByText('B segunda')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Sem prazo' })));
  });

  it('semana vencida: mostra o aviso na tarefa, e "Entendi" tira só o aviso', async () => {
    await criar('Ler artigo da Aurora', { semanaVencida: '2026-10-26' });
    render(<SemPrazo />);
    await aparecer('Ler artigo da Aurora');

    const item = within(linha('Ler artigo da Aurora'));
    expect(item.getByText('Saiu de Esta semana: a semana de 26/10 acabou.')).toBeTruthy();
    fireEvent.click(item.getByRole('button', { name: 'Entendi' }));

    await waitFor(async () => expect((await unica()).semanaVencida).toBeUndefined());
    expect(screen.queryByText(/a semana de 26\/10 acabou/)).toBeNull();
    expect(screen.getByText('Ler artigo da Aurora')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('checkbox', { name: 'Ler artigo da Aurora' })));
  });

  it('escolher Hoje numa tarefa com aviso encerra o aviso junto', async () => {
    await criar('Ler artigo', { semanaVencida: '2026-10-26' });
    render(<SemPrazo />);
    await aparecer('Ler artigo');
    fireEvent.click(within(linha('Ler artigo')).getByRole('button', { name: 'Hoje' }));
    await waitFor(async () => expect((await unica()).data).toBe('2026-11-05'));
    expect((await unica()).semanaVencida).toBeUndefined();
  });

  it('o aviso mostra o ano quando a semana é de outro ano', async () => {
    await criar('Velha', { semanaVencida: '2025-12-29' });
    render(<SemPrazo />);
    await aparecer('Velha');
    expect(screen.getByText('Saiu de Esta semana: a semana de 29/12/2025 acabou.')).toBeTruthy();
  });

  it('sem tarefas, diz o que fica aqui', async () => {
    render(<SemPrazo />);
    expect(await screen.findByText('Nada sem prazo.')).toBeTruthy();
    expect(screen.getByText('O que você anotar sem dia aparece aqui.')).toBeTruthy();
  });

  it('sem o cabeçalho (na página própria), não repete o título', async () => {
    await criar('Escrever o resumo');
    render(<SemPrazo semCabecalho />);
    await aparecer('Escrever o resumo');
    expect(screen.queryByRole('heading', { name: 'Sem prazo' })).toBeNull();
  });
});
