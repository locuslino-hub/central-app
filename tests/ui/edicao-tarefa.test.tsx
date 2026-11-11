import { fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apagar, gravarDoServidor, listar, listarPendentes, semear } from '../../src/dados/loja';
import { Atividades } from '../../src/ui/Atividades';
import { Checklist } from '../../src/ui/Checklist';
import { SemPrazo } from '../../src/ui/SemPrazo';
import { criar } from '../apoio/tarefas';

// Quinta-feira, 2026-11-05, 12:20 (Europe/Lisbon). Só a data é falsa.
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-11-05T12:20:00Z'));
  await semear();
});

const linha = (titulo: string) => screen.getByText(titulo).closest('li') as HTMLElement;
const botaoEditar = (titulo: string) => screen.getByRole('button', { name: `Editar: ${titulo}` });
const unica = async () => (await listar('tarefas'))[0];

async function abrir(titulo: string) {
  await screen.findByText(titulo);
  fireEvent.click(botaoEditar(titulo));
  return within(linha(titulo));
}

describe('editar tarefa na linha', () => {
  it('cada linha tem Editar, e abrir leva o foco ao título, já preenchido', async () => {
    await criar('Rever capítulo 3', { data: '2026-11-05', salaId: 'sala-orientacoes' });
    render(<Checklist />);
    const dentro = await abrir('Rever capítulo 3');
    const campo = dentro.getByLabelText('Título') as HTMLInputElement;
    expect(campo.value).toBe('Rever capítulo 3');
    await waitFor(() => expect(document.activeElement).toBe(campo));
    expect(botaoEditar('Rever capítulo 3').getAttribute('aria-expanded')).toBe('true');
    const sala = dentro.getByLabelText('Sala') as HTMLSelectElement;
    await waitFor(() => expect(sala.value).toBe('sala-orientacoes'));
    expect(Array.from(sala.options).map((o) => o.textContent)).toEqual([
      'Sem sala',
      'Doutoramento',
      'Investigação',
      'Aulas',
      'Orientações',
      'MBA',
      'Pessoal',
      'Casa',
    ]);
  });

  it('Salvar muda título e sala na loja e na linha, e devolve o foco a Editar', async () => {
    await criar('Rever capitulo', { data: '2026-11-05' });
    render(<Checklist />);
    const dentro = await abrir('Rever capitulo');
    fireEvent.input(dentro.getByLabelText('Título'), { target: { value: 'Rever capítulo 3' } });
    await waitFor(() => expect((dentro.getByLabelText('Sala') as HTMLSelectElement).options.length).toBe(8));
    fireEvent.change(dentro.getByLabelText('Sala'), { target: { value: 'sala-orientacoes' } });
    fireEvent.click(dentro.getByRole('button', { name: 'Salvar' }));

    await waitFor(async () => expect(await unica()).toMatchObject({ titulo: 'Rever capítulo 3', salaId: 'sala-orientacoes' }));
    expect(await screen.findByText('Rever capítulo 3')).toBeTruthy();
    expect(within(linha('Rever capítulo 3')).getByText('Orientações')).toBeTruthy();
    expect(screen.queryByLabelText('Título')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(botaoEditar('Rever capítulo 3')));
  });

  it('Cancelar e Esc fecham sem gravar', async () => {
    await criar('Rever', { data: '2026-11-05' });
    render(<Checklist />);
    const dentro = await abrir('Rever');
    fireEvent.input(dentro.getByLabelText('Título'), { target: { value: 'Outro' } });
    fireEvent.click(dentro.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByLabelText('Título')).toBeNull();
    await abrir('Rever');
    fireEvent.keyDown(screen.getByLabelText('Título'), { key: 'Escape' });
    expect(screen.queryByLabelText('Título')).toBeNull();
    expect((await unica()).titulo).toBe('Rever');
    expect(document.activeElement).toBe(botaoEditar('Rever'));
  });

  it('título vazio: pede o título, foca o campo e não grava', async () => {
    await criar('Rever', { data: '2026-11-05' });
    render(<Checklist />);
    const dentro = await abrir('Rever');
    fireEvent.input(dentro.getByLabelText('Título'), { target: { value: '   ' } });
    fireEvent.click(dentro.getByRole('button', { name: 'Salvar' }));
    expect((await dentro.findByRole('alert')).textContent).toBe('Escreva o título.');
    expect(document.activeElement).toBe(dentro.getByLabelText('Título'));
    expect((await unica()).titulo).toBe('Rever');
  });

  it('o que se digita não é refeito por atualização de outra tarefa', async () => {
    await criar('Primeira', { data: '2026-11-05' });
    render(<Checklist />);
    const dentro = await abrir('Primeira');
    const campo = dentro.getByLabelText('Título') as HTMLInputElement;
    fireEvent.input(campo, { target: { value: 'Primeira, editada' } });
    campo.focus();
    await criar('Chegou de outro aparelho', { data: '2026-11-05' });
    await screen.findByText('Chegou de outro aparelho');
    expect(within(linha('Primeira')).getByLabelText('Título')).toBe(campo);
    expect(campo.value).toBe('Primeira, editada');
    expect(document.activeElement).toBe(campo);
  });

  it('falha ao gravar: avisa, mantém o formulário aberto e o texto', async () => {
    await criar('Rever', { data: '2026-11-05' });
    render(<Checklist />);
    const dentro = await abrir('Rever');
    fireEvent.input(dentro.getByLabelText('Título'), { target: { value: 'Rever 2' } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new Error('disco cheio');
    });
    fireEvent.click(dentro.getByRole('button', { name: 'Salvar' }));
    expect((await dentro.findByRole('alert')).textContent).toBe('Não consegui salvar. Tente de novo.');
    expect((dentro.getByLabelText('Título') as HTMLInputElement).value).toBe('Rever 2');
  });
});

describe('editar só o que mudou', () => {
  it('o título só vai na gravação se foi mudado: outra edição do título feita em outro aparelho não é desfeita', async () => {
    const t = await criar('Rever capitulo', { data: '2026-11-05' });
    render(<Checklist />);
    const dentro = await abrir('Rever capitulo');
    await waitFor(() => expect((dentro.getByLabelText('Sala') as HTMLSelectElement).options.length).toBe(8));
    // Enquanto o formulário está aberto, o título muda em outro aparelho.
    await gravarDoServidor([
      { colecao: 'tarefas', registro: { ...t, titulo: 'Rever capítulo 3', atualizadoEm: Date.now() + 5000, aparelho: 'celular' } },
    ]);
    fireEvent.change(dentro.getByLabelText('Sala'), { target: { value: 'sala-aulas' } });
    fireEvent.click(dentro.getByRole('button', { name: 'Salvar' }));
    await waitFor(async () => expect((await unica()).salaId).toBe('sala-aulas'));
    expect((await unica()).titulo).toBe('Rever capítulo 3');
  });

  it('sem nenhuma mudança, Salvar só fecha: nada é gravado', async () => {
    await criar('Rever', { data: '2026-11-05' });
    render(<Checklist />);
    const dentro = await abrir('Rever');
    const pendentes = (await listarPendentes()).length;
    fireEvent.click(dentro.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(screen.queryByLabelText('Título')).toBeNull());
    expect((await listarPendentes()).length).toBe(pendentes);
  });

  it('tarefa apagada em outro aparelho: diz "Esta tarefa não existe mais." e mantém o formulário aberto', async () => {
    const t = await criar('Sumindo', { data: '2026-11-05' });
    render(<Checklist />);
    const dentro = await abrir('Sumindo');
    fireEvent.input(dentro.getByLabelText('Título'), { target: { value: 'Sumindo mesmo' } });
    // Apagada por baixo dos panos, sem aviso da loja: a tela ainda não sabe (a janela da corrida).
    await new Promise<void>((pronto, falha) => {
      const abrir = indexedDB.open('central-dados');
      abrir.onsuccess = () => {
        const tx = abrir.result.transaction('tarefas', 'readwrite');
        tx.objectStore('tarefas').put({ ...t, apagado: true });
        tx.oncomplete = () => pronto();
        tx.onerror = () => falha(tx.error);
      };
    });
    fireEvent.click(dentro.getByRole('button', { name: 'Salvar' }));
    expect((await dentro.findByRole('alert')).textContent).toBe('Esta tarefa não existe mais.');
    expect((dentro.getByLabelText('Título') as HTMLInputElement).value).toBe('Sumindo mesmo');
    expect(await listar('tarefas')).toEqual([]);
  });
});

describe('editar o quando', () => {
  it('tarefa sem prazo: Sem prazo, Hoje, Esta semana ou Outro dia', async () => {
    await criar('Comprar café');
    render(<SemPrazo />);
    const dentro = await abrir('Comprar café');
    const quando = dentro.getByLabelText('Quando') as HTMLSelectElement;
    expect(quando.value).toBe('sem-prazo');
    expect(Array.from(quando.options).map((o) => o.textContent)).toEqual(['Sem prazo', 'Hoje', 'Esta semana', 'Outro dia']);
  });

  it('Hoje: a tarefa vai para hoje e sai de Sem prazo', async () => {
    await criar('Comprar café');
    render(<SemPrazo />);
    const dentro = await abrir('Comprar café');
    fireEvent.change(dentro.getByLabelText('Quando'), { target: { value: 'hoje' } });
    fireEvent.click(dentro.getByRole('button', { name: 'Salvar' }));
    await waitFor(async () => expect((await unica()).data).toBe('2026-11-05'));
    await waitFor(() => expect(screen.queryByText('Comprar café')).toBeNull());
  });

  it('Outro dia: mostra o campo de data; sem escolher, pede o dia; dia passado é recusado; dia bom grava', async () => {
    await criar('Comprar café');
    render(<SemPrazo />);
    const dentro = await abrir('Comprar café');
    fireEvent.change(dentro.getByLabelText('Quando'), { target: { value: 'dia' } });
    const data = dentro.getByLabelText('Dia') as HTMLInputElement;
    expect(data.type).toBe('date');
    expect(data.min).toBe('2026-11-05');

    fireEvent.click(dentro.getByRole('button', { name: 'Salvar' }));
    expect((await dentro.findByRole('alert')).textContent).toBe('Escolha um dia.');
    fireEvent.input(data, { target: { value: '2026-11-04' } });
    fireEvent.click(dentro.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(dentro.getByRole('alert').textContent).toBe('Esse dia já passou. Escolha hoje ou depois.'));
    fireEvent.input(data, { target: { value: '2026-11-12' } });
    fireEvent.click(dentro.getByRole('button', { name: 'Salvar' }));
    await waitFor(async () => expect((await unica()).data).toBe('2026-11-12'));
  });

  it('tarefa de hoje para Sem prazo: perde a data e passa a Sem prazo (sai da Checklist)', async () => {
    await criar('Validar dados', { data: '2026-11-05' });
    render(<Checklist />);
    const dentro = await abrir('Validar dados');
    expect((dentro.getByLabelText('Quando') as HTMLSelectElement).value).toBe('hoje');
    fireEvent.change(dentro.getByLabelText('Quando'), { target: { value: 'sem-prazo' } });
    fireEvent.click(dentro.getByRole('button', { name: 'Salvar' }));
    await waitFor(async () => expect('data' in (await unica())).toBe(false));
    await waitFor(() => expect(screen.queryByText('Validar dados')).toBeNull());
  });

  it('tarefa de outro dia: o campo de data já vem com o dia dela', async () => {
    await criar('Preparar aula', { data: '2026-11-10' });
    render(<Atividades />);
    const dentro = await abrir('Preparar aula');
    expect((dentro.getByLabelText('Quando') as HTMLSelectElement).value).toBe('dia');
    expect((dentro.getByLabelText('Dia') as HTMLInputElement).value).toBe('2026-11-10');
  });

  it('semana que não é a de hoje: a opção "Como está" guarda a semana', async () => {
    await criar('Planejar semestre', { semana: '2026-11-23' });
    render(<Atividades />);
    const dentro = await abrir('Planejar semestre');
    const quando = dentro.getByLabelText('Quando') as HTMLSelectElement;
    expect(quando.value).toBe('manter');
    expect(Array.from(quando.options)[0].textContent).toBe('Semana de 23/11');
    fireEvent.input(dentro.getByLabelText('Título'), { target: { value: 'Planejar o semestre' } });
    fireEvent.click(dentro.getByRole('button', { name: 'Salvar' }));
    await waitFor(async () => expect(await unica()).toMatchObject({ titulo: 'Planejar o semestre', semana: '2026-11-23' }));
  });

  it('compromisso e prazo não têm "Quando" (a hora está ligada ao dia)', async () => {
    await criar('Reunião de grupo', { data: '2026-11-05', inicio: '14:00' });
    render(<Checklist />);
    const dentro = await abrir('Reunião de grupo');
    expect(dentro.queryByLabelText('Quando')).toBeNull();
    expect(dentro.getByLabelText('Título')).toBeTruthy();
  });
});

describe('apagar tarefa', () => {
  it('Apagar remove da lista e oferece Desfazer, que traz de volta', async () => {
    await criar('Validar dados', { data: '2026-11-05', salaId: 'sala-aulas' });
    render(<Checklist />);
    const dentro = await abrir('Validar dados');
    fireEvent.click(dentro.getByRole('button', { name: 'Apagar' }));

    await waitFor(async () => expect(await listar('tarefas')).toEqual([]));
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: 'Validar dados' })).toBeNull());
    const aviso = await screen.findByText('Tarefa apagada: Validar dados').then((texto) => texto.closest('[role="status"]') as HTMLElement);
    expect(aviso.textContent).toContain('Tarefa apagada: Validar dados');
    const desfazer = within(aviso).getByRole('button', { name: 'Desfazer' });
    await waitFor(() => expect(document.activeElement).toBe(desfazer));

    fireEvent.click(desfazer);
    expect(await screen.findByRole('checkbox', { name: 'Validar dados' })).toBeTruthy();
    expect(await unica()).toMatchObject({ titulo: 'Validar dados', salaId: 'sala-aulas', data: '2026-11-05' });
    await waitFor(() => expect(screen.queryByText(/Tarefa apagada/)).toBeNull());
  });

  it('em Atividades e em Sem prazo também', async () => {
    await criar('Comprar café');
    const { unmount } = render(<SemPrazo />);
    fireEvent.click(await (await abrir('Comprar café')).findByRole('button', { name: 'Apagar' }));
    expect(await screen.findByText(/Tarefa apagada: Comprar café/)).toBeTruthy();
    unmount();

    await criar('Preparar aula', { data: '2026-11-10' });
    render(<Atividades />);
    fireEvent.click(await (await abrir('Preparar aula')).findByRole('button', { name: 'Apagar' }));
    expect(await screen.findByText(/Tarefa apagada: Preparar aula/)).toBeTruthy();
  });

  it('apagar tarefa que já sumiu em outro aparelho não quebra nem mostra Desfazer', async () => {
    const t = await criar('Sumindo', { data: '2026-11-05' });
    render(<Checklist />);
    const dentro = await abrir('Sumindo');
    const botao = dentro.getByRole('button', { name: 'Apagar' });
    await apagar('tarefas', t.id);
    fireEvent.click(botao);
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole('button', { name: 'Desfazer' })).toBeNull();
  });
});
