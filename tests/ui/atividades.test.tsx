import { fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apagar, listar, semear } from '../../src/dados/loja';
import { Atividades } from '../../src/ui/Atividades';
import { criar } from '../apoio/tarefas';

// Quinta-feira, 2026-11-05, 12:20 (Europe/Lisbon). Só a data é falsa.
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-11-05T12:20:00Z'));
  await semear();
});

const grupo = (nome: string) => within(screen.getByRole('region', { name: nome }));
const nomesDosGrupos = () => screen.getAllByRole('region').map((r) => r.querySelector('h2')?.textContent);

describe('Atividades', () => {
  it('agrupa as tarefas abertas: Atrasadas, Hoje, Próximos dias, semanas e Sem prazo, nessa ordem', async () => {
    await criar('Entrega do relatório', { data: '2026-11-03', prazoHora: '17:00' });
    await criar('Rever capítulo 3', { data: '2026-11-04' }); // ontem: já é de hoje
    await criar('Validar dados', { data: '2026-11-05' });
    await criar('Reunião de grupo', { data: '2026-11-05', inicio: '14:00' });
    await criar('Preparar aula', { data: '2026-11-10' });
    await criar('Ler artigo', { semana: '2026-11-02' });
    await criar('Escrever resumo', { semana: '2026-11-09' });
    await criar('Planejar semestre', { semana: '2026-11-23' });
    await criar('Comprar café');
    render(<Atividades />);

    await screen.findByText('Comprar café');
    expect(nomesDosGrupos()).toEqual([
      'Atrasadas',
      'Hoje',
      'Próximos dias',
      'Esta semana',
      'Próxima semana',
      'Semana de 23/11',
      'Sem prazo',
    ]);
    expect(grupo('Atrasadas').getByText('Entrega do relatório')).toBeTruthy();
    for (const titulo of ['Rever capítulo 3', 'Validar dados', 'Reunião de grupo']) {
      expect(grupo('Hoje').getByText(titulo)).toBeTruthy();
    }
    expect(grupo('Próximos dias').getByText('Preparar aula')).toBeTruthy();
    expect(grupo('Esta semana').getByText('Ler artigo')).toBeTruthy();
    expect(grupo('Próxima semana').getByText('Escrever resumo')).toBeTruthy();
    expect(grupo('Semana de 23/11').getByText('Planejar semestre')).toBeTruthy();
    expect(grupo('Sem prazo').getByText('Comprar café')).toBeTruthy();
  });

  it('cada título de grupo é um h2', async () => {
    await criar('Validar dados', { data: '2026-11-05' });
    render(<Atividades />);
    expect(await screen.findByRole('heading', { level: 2, name: 'Hoje' })).toBeTruthy();
  });

  it('não lista o que já foi feito nem o que foi apagado', async () => {
    await criar('Feita', { data: '2026-11-05', feito: true });
    const apagada = await criar('Apagada', { data: '2026-11-05' });
    await apagar('tarefas', apagada.id);
    await criar('Reunião de ontem já feita', { data: '2026-11-04', inicio: '11:00', feito: true });
    await criar('Aberta', { data: '2026-11-05' });
    render(<Atividades />);
    await screen.findByText('Aberta');
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
  });

  it('compromisso que passou sem ser concluído não some: fica em Atrasadas, com o dia e a hora', async () => {
    await criar('Reunião de ontem', { data: '2026-11-04', inicio: '11:00' });
    render(<Atividades />);
    await screen.findByText('Reunião de ontem');
    const atrasadas = grupo('Atrasadas');
    expect(atrasadas.getByText('Reunião de ontem')).toBeTruthy();
    expect(atrasadas.getByText('Quarta, 4/11 · 11:00')).toBeTruthy();
    expect(atrasadas.getByText('Atrasada')).toBeTruthy();
  });

  it('compromisso futuro mostra o dia e a hora', async () => {
    await criar('Reunião de sexta', { data: '2026-11-13', inicio: '11:00' });
    render(<Atividades />);
    await screen.findByText('Reunião de sexta');
    expect(grupo('Próximos dias').getByText('Sexta, 13/11 · 11:00')).toBeTruthy();
  });

  it('mostra o quando de cada linha onde ajuda: dia nos próximos dias, hora no compromisso', async () => {
    await criar('Preparar aula', { data: '2026-11-10' });
    await criar('Reunião de grupo', { data: '2026-11-05', inicio: '14:00' });
    render(<Atividades />);
    await screen.findByText('Preparar aula');
    expect(within(screen.getByText('Preparar aula').closest('li') as HTMLElement).getByText('Terça, 10/11')).toBeTruthy();
    expect(within(screen.getByText('Reunião de grupo').closest('li') as HTMLElement).getByText('14:00')).toBeTruthy();
  });

  it('dentro de um grupo, por data e depois por título', async () => {
    await criar('Zeta', { data: '2026-11-12' });
    await criar('Beta', { data: '2026-11-10' });
    await criar('Alfa', { data: '2026-11-10' });
    render(<Atividades />);
    await screen.findByText('Zeta');
    expect(grupo('Próximos dias').getAllByRole('checkbox').map((c) => c.getAttribute('aria-label'))).toEqual([
      'Alfa',
      'Beta',
      'Zeta',
    ]);
  });

  it('semana que já acabou, antes de a virada gravar, aparece em Sem prazo', async () => {
    await criar('Ler artigo', { semana: '2026-10-26' });
    render(<Atividades />);
    await screen.findByText('Ler artigo');
    expect(nomesDosGrupos()).toEqual(['Sem prazo']);
  });

  it('concluir tem Desfazer e a linha fica no grupo até sair da página', async () => {
    await criar('Validar dados', { data: '2026-11-05' });
    render(<Atividades />);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Validar dados' }));
    await waitFor(async () => expect((await listar('tarefas'))[0].feito).toBe(true));
    fireEvent.click(await screen.findByRole('button', { name: /^Desfazer/ }));
    await waitFor(async () => expect((await listar('tarefas'))[0].feito).toBe(false));
    expect(screen.getByRole('checkbox', { name: 'Validar dados' }).getAttribute('aria-checked')).toBe('false');
  });

  it('sem nada aberto, diz o que fica aqui', async () => {
    render(<Atividades />);
    expect(await screen.findByText('Nenhuma atividade aberta.')).toBeTruthy();
    expect(screen.getByText('O que você anotar no Chat aparece aqui.')).toBeTruthy();
  });

  it('mostra a duração com "cerca de" até confirmar', async () => {
    await criar('Validar dados', { data: '2026-11-05' });
    render(<Atividades />);
    expect(await screen.findByRole('button', { name: 'Duração de Validar dados: cerca de 1 h' })).toBeTruthy();
  });
});
