import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apagar, gravarDoServidor, listar, semear } from '../../src/dados/loja';
import { iniciarVirada } from '../../src/dados/virada';
import { Checklist } from '../../src/ui/Checklist';
import { criar } from '../apoio/tarefas';

// Quinta-feira, 2026-11-05, 12:20 (Europe/Lisbon). Só a data é falsa.
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 5, 12, 20));
  await semear();
});

const checkbox = (titulo: string | RegExp) => screen.findByRole('checkbox', { name: titulo });
const linha = (titulo: string) => screen.getByText(titulo).closest('li') as HTMLElement;

describe('Checklist do dia', () => {
  it('mostra as tarefas de hoje com a sala, e o título da seção', async () => {
    await criar('Rever capítulo 3 da dissertação', { data: '2026-11-05', salaId: 'sala-orientacoes' });
    render(<Checklist />);

    expect(await screen.findByRole('heading', { level: 2, name: 'Checklist do dia' })).toBeTruthy();
    await screen.findByText('Rever capítulo 3 da dissertação');
    const item = within(linha('Rever capítulo 3 da dissertação'));
    expect(await item.findByText('Orientações')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Rever capítulo 3 da dissertação' }).getAttribute('aria-checked')).toBe(
      'false',
    );
  });

  it('tarefa de ontem aberta aparece hoje, mesmo antes de a virada gravar', async () => {
    await criar('Validar dados do lagar', { data: '2026-11-04' });
    render(<Checklist />);
    expect(await checkbox('Validar dados do lagar')).toBeTruthy();
  });

  it('não mostra o que não é de hoje: amanhã, semana, sem prazo, feita de ontem, apagada', async () => {
    await criar('De amanhã', { data: '2026-11-06' });
    await criar('Da semana', { semana: '2026-11-02' });
    await criar('Sem prazo');
    await criar('Feita ontem', { data: '2026-11-04', feito: true });
    const apagada = await criar('Apagada', { data: '2026-11-05' });
    await apagar('tarefas', apagada.id);
    await criar('De hoje', { data: '2026-11-05' });
    render(<Checklist />);

    await checkbox('De hoje');
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
  });

  it('compromisso de hoje entra com a hora; compromisso de ontem não', async () => {
    await criar('Reunião sobre o projeto', { data: '2026-11-05', inicio: '11:00', duracaoMin: 60, duracaoConfirmada: true });
    await criar('Reunião de ontem', { data: '2026-11-04', inicio: '11:00' });
    render(<Checklist />);
    await checkbox('Reunião sobre o projeto');
    expect(within(linha('Reunião sobre o projeto')).getByText('11:00')).toBeTruthy();
    expect(screen.queryByText('Reunião de ontem')).toBeNull();
  });

  it('tarefa com prazo vencida fica na lista, dita atrasada, com o dia do prazo', async () => {
    await criar('Entrega do relatório', { data: '2026-11-03', prazoHora: '17:00' });
    render(<Checklist />);
    await checkbox('Entrega do relatório');
    const item = within(linha('Entrega do relatório'));
    expect(item.getByText('Atrasada')).toBeTruthy();
    expect(item.getByText('Até terça, 3/11, às 17:00')).toBeTruthy();
  });

  it('progresso: "1 de 4 feitas" com barra de progresso', async () => {
    await criar('A', { data: '2026-11-05' });
    await criar('B', { data: '2026-11-05' });
    await criar('C', { data: '2026-11-05' });
    await criar('D', { data: '2026-11-05', feito: true });
    render(<Checklist />);
    expect(await screen.findByText('1 de 4 feitas')).toBeTruthy();
    const barra = screen.getByRole('progressbar', { name: 'Progresso do dia' });
    expect(barra.getAttribute('aria-valuenow')).toBe('1');
    expect(barra.getAttribute('aria-valuemax')).toBe('4');
  });

  it('plural certo: "0 de 1 feita"', async () => {
    await criar('Só uma', { data: '2026-11-05' });
    render(<Checklist />);
    expect(await screen.findByText('0 de 1 feita')).toBeTruthy();
  });

  it('sem tarefas, convida a usar o chat', async () => {
    render(<Checklist />);
    expect(await screen.findByText('Nada para hoje.')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Abrir o Chat' });
    expect(link.getAttribute('href')).toBe('#/chat');
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('tarefa nova que chega de outro aparelho aparece sem recarregar', async () => {
    render(<Checklist />);
    await screen.findByText('Nada para hoje.');
    await gravarDoServidor([
      {
        colecao: 'tarefas',
        registro: {
          id: 'remota',
          titulo: 'Vinda do celular',
          salaId: null,
          data: '2026-11-05',
          duracaoMin: 60,
          duracaoConfirmada: false,
          feito: false,
          fixada: false,
          marcar: false,
          atualizadoEm: 1,
          aparelho: 'celular',
        },
      },
    ]);
    expect(await checkbox('Vinda do celular')).toBeTruthy();
  });

  it('fixada vem primeiro, depois por hora e por título, sem mudar de lugar ao concluir', async () => {
    await criar('Zebra', { data: '2026-11-05' });
    await criar('Abelha', { data: '2026-11-05' });
    await criar('Reunião', { data: '2026-11-05', inicio: '09:00' });
    await criar('Importante', { data: '2026-11-05', fixada: true });
    render(<Checklist />);
    await checkbox('Zebra');
    const ordem = () => screen.getAllByRole('checkbox').map((c) => c.getAttribute('aria-label'));
    expect(ordem()).toEqual(['Importante', 'Reunião', 'Abelha', 'Zebra']);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Importante' }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Importante' }).getAttribute('aria-checked')).toBe('true'));
    expect(ordem()).toEqual(['Importante', 'Reunião', 'Abelha', 'Zebra']);
  });
});

describe('concluir e Desfazer', () => {
  it('marcar conclui na loja e mostra Desfazer; Desfazer reabre', async () => {
    const t = await criar('Confirmar datas de avaliação', { data: '2026-11-05' });
    render(<Checklist />);
    fireEvent.click(await checkbox('Confirmar datas de avaliação'));

    await waitFor(async () => expect((await listar('tarefas'))[0].feito).toBe(true));
    const item = within(linha('Confirmar datas de avaliação'));
    expect(item.getByRole('checkbox').getAttribute('aria-checked')).toBe('true');
    expect(await screen.findByText('1 de 1 feita')).toBeTruthy();

    fireEvent.click(await item.findByRole('button', { name: /^Desfazer/ }));
    await waitFor(async () => expect((await listar('tarefas'))[0]).toMatchObject({ id: t.id, feito: false }));
    expect(await screen.findByText('0 de 1 feita')).toBeTruthy();
    expect(within(linha('Confirmar datas de avaliação')).queryByRole('button', { name: /^Desfazer/ })).toBeNull();
  });

  it('depois do Desfazer o foco volta para a caixa de marcar', async () => {
    await criar('Foco', { data: '2026-11-05' });
    render(<Checklist />);
    fireEvent.click(await checkbox('Foco'));
    fireEvent.click(await screen.findByRole('button', { name: /^Desfazer/ }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('checkbox', { name: 'Foco' })));
  });

  it('desmarcar a caixa também reabre', async () => {
    await criar('Feita', { data: '2026-11-05', feito: true });
    render(<Checklist />);
    fireEvent.click(await checkbox('Feita'));
    await waitFor(async () => expect((await listar('tarefas'))[0].feito).toBe(false));
  });

  it('o Desfazer não aparece em tarefa que já estava feita ao abrir', async () => {
    await criar('Já feita', { data: '2026-11-05', feito: true });
    render(<Checklist />);
    await checkbox('Já feita');
    expect(screen.queryByRole('button', { name: /^Desfazer/ })).toBeNull();
  });

  it('tarefa de ontem concluída hoje continua na lista com Desfazer, até sair da página', async () => {
    await criar('De ontem', { data: '2026-11-04' });
    render(<Checklist />);
    fireEvent.click(await checkbox('De ontem'));
    await waitFor(async () => expect((await listar('tarefas'))[0].feito).toBe(true));
    expect(await screen.findByRole('button', { name: /^Desfazer/ })).toBeTruthy();
    expect(screen.getByText('1 de 1 feita')).toBeTruthy();
  });

  it('concluir tarefa que sumiu em outro aparelho não quebra nem recria', async () => {
    const t = await criar('Sumindo', { data: '2026-11-05' });
    render(<Checklist />);
    const caixa = await checkbox('Sumindo');
    await apagar('tarefas', t.id);
    fireEvent.click(caixa);
    await new Promise((r) => setTimeout(r, 30));
    expect(await listar('tarefas')).toEqual([]);
  });
});

describe('duração na linha', () => {
  it('padrão 60: mostra "cerca de 1 h" até confirmar', async () => {
    await criar('Rever', { data: '2026-11-05' });
    render(<Checklist />);
    await checkbox('Rever');
    expect(within(linha('Rever')).getByRole('button', { name: /cerca de 1 h/ })).toBeTruthy();
  });

  it('duração confirmada vinda do chat (compromisso) mostra só o tempo', async () => {
    await criar('Reunião', { data: '2026-11-05', inicio: '11:00', duracaoMin: 90, duracaoConfirmada: true });
    render(<Checklist />);
    await checkbox('Reunião');
    const botao = within(linha('Reunião')).getByRole('button', { name: /1 h 30/ });
    expect(botao.textContent).toBe('1 h 30');
  });
});

describe('o dia vira com o app aberto', () => {
  it('meia-noite: a tarefa de hoje segue na lista (agora com a data nova), a feita de hoje sai, a de amanhã entra, sem recarregar', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(Date.parse('2026-11-05T23:59:30Z'));
    await criar('Ficou sem fazer', { data: '2026-11-05' });
    await criar('Fiz hoje', { data: '2026-11-05', feito: true });
    await criar('Para sexta', { data: '2026-11-06' });
    const parar = iniciarVirada();
    const { container } = render(<Checklist />);
    await vi.advanceTimersByTimeAsync(100);
    await checkbox('Ficou sem fazer');
    expect(screen.getByRole('checkbox', { name: 'Fiz hoje' })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'Para sexta' })).toBeNull();
    const raiz = container.firstElementChild;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000); // 00:00:01 de sexta
    });

    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Para sexta' })).toBeTruthy());
    expect(screen.getByRole('checkbox', { name: 'Ficou sem fazer' })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'Fiz hoje' })).toBeNull();
    expect(screen.getByText('0 de 2 feitas')).toBeTruthy();
    await vi.waitFor(async () =>
      expect((await listar('tarefas')).find((t) => t.titulo === 'Ficou sem fazer')?.data).toBe('2026-11-06'),
    );
    expect(container.firstElementChild).toBe(raiz);
    parar();
  });

  it('mesmo sem a virada gravar, a lista já usa o dia novo', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(Date.parse('2026-11-05T23:59:30Z'));
    await criar('Ficou sem fazer', { data: '2026-11-05' });
    render(<Checklist />);
    await checkbox('Ficou sem fazer');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });
    expect(screen.getByRole('checkbox', { name: 'Ficou sem fazer' })).toBeTruthy();
  });
});
