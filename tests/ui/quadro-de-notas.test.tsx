// Quadro de notas independentes (texto e lista) da sala e da subpasta. Nomes fictícios.
// Quinta-feira, 2026-11-05, 12:20 em Lisboa (WET = UTC em novembro).
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apagar, listar, salvar, semear } from '../../src/dados/loja';
import { criarNota, editarNota } from '../../src/dados/notas-independentes';
import type { Nota, Sala } from '../../src/dados/tipos';
import { QuadroDeNotas, dataDaNota } from '../../src/ui/QuadroDeNotas';

configure({ asyncUtilTimeout: 5000 });

const AGORA = Date.parse('2026-11-05T12:20:00Z');
const SALA = 'sala-doutoramento';
const PASTA = 'pasta-metodologia';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AGORA);
  await semear();
});

afterEach(async () => {
  cleanup();
  await new Promise((r) => setTimeout(r, 150));
});

const montar = (props: { salaId?: string; pastaId?: string; titulo?: string } = {}) =>
  render(<QuadroDeNotas salaId={props.salaId ?? SALA} pastaId={props.pastaId} titulo={props.titulo ?? 'Notas'} />);

async function abrirNova(tipo: 'Texto' | 'Lista') {
  fireEvent.click(await screen.findByRole('button', { name: /Nova nota/ }));
  fireEvent.click(screen.getByRole('button', { name: tipo }));
}

const guardadas = async () => (await listar('notas')).sort((a, b) => b.criadaEm - a.criadaEm);
const cartoes = () => screen.queryAllByRole('listitem', { name: /^Nota de / });

describe('dataDaNota', () => {
  it('dia/mês e hora de Lisboa; o ano só quando não é o de agora', () => {
    expect(dataDaNota(Date.parse('2026-11-23T15:40:00Z'), AGORA)).toBe('23/11 15:40');
    expect(dataDaNota(Date.parse('2026-07-01T10:05:00Z'), AGORA)).toBe('01/07 11:05'); // verão: WEST = UTC+1
    expect(dataDaNota(Date.parse('2025-12-31T23:59:00Z'), AGORA)).toBe('31/12/2025 23:59');
  });
});

describe('nota de texto', () => {
  it('Nova nota → Texto → escrever → Salvar nota: o cartão aparece e o formulário some', async () => {
    montar();
    expect(await screen.findByRole('heading', { name: 'Notas' })).toBeTruthy();
    await abrirNova('Texto');
    const campo = await screen.findByRole('textbox', { name: 'Texto da nota' });
    expect(document.activeElement).toBe(campo);
    fireEvent.input(campo, { target: { value: 'Revisar os dados do solo da parcela 3.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar nota' }));

    await waitFor(() => expect(cartoes()).toHaveLength(1));
    expect(screen.queryByRole('form')).toBeNull();
    const cartao = within(cartoes()[0]);
    expect(cartao.getByText('Revisar os dados do solo da parcela 3.')).toBeTruthy();
    expect(cartao.getByText('05/11 12:20')).toBeTruthy();
    expect(await guardadas()).toEqual([expect.objectContaining({ salaId: SALA, tipo: 'texto', texto: 'Revisar os dados do solo da parcela 3.', criadaEm: AGORA })]);
    expect((await guardadas())[0].pastaId).toBeUndefined();
  });

  it('Ctrl+Enter salva', async () => {
    montar();
    await abrirNova('Texto');
    const campo = await screen.findByRole('textbox', { name: 'Texto da nota' });
    fireEvent.input(campo, { target: { value: 'Salva pelo teclado' } });
    fireEvent.keyDown(campo, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(cartoes()).toHaveLength(1));
    expect((await guardadas())[0].texto).toBe('Salva pelo teclado');
  });

  it('nota vazia não grava: diz "Escreva algo antes de salvar." e o formulário continua', async () => {
    montar();
    await abrirNova('Texto');
    fireEvent.input(await screen.findByRole('textbox', { name: 'Texto da nota' }), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar nota' }));
    expect(await screen.findByText('Escreva algo antes de salvar.')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Texto da nota' })).toBeTruthy();
    expect(await listar('notas')).toEqual([]);
  });

  it('Cancelar fecha o formulário sem gravar, e o foco volta ao Nova nota', async () => {
    montar();
    await abrirNova('Texto');
    fireEvent.input(await screen.findByRole('textbox', { name: 'Texto da nota' }), { target: { value: 'Desisti' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('form')).toBeNull());
    expect(await listar('notas')).toEqual([]);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: /Nova nota/ })));
  });

  it('Esc dentro do formulário é Cancelar: fecha sem gravar e o foco volta ao Nova nota', async () => {
    montar();
    await abrirNova('Texto');
    const campo = await screen.findByRole('textbox', { name: 'Texto da nota' });
    fireEvent.input(campo, { target: { value: 'Desisti com Esc' } });
    fireEvent.keyDown(campo, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('form')).toBeNull());
    expect(await listar('notas')).toEqual([]);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: /Nova nota/ })));
  });

  it('Esc com o foco em Texto ou Lista fecha o menu e devolve o foco ao Nova nota', async () => {
    montar();
    const botao = await screen.findByRole('button', { name: /Nova nota/ });
    fireEvent.click(botao);
    const texto = screen.getByRole('button', { name: 'Texto' });
    texto.focus();
    fireEvent.keyDown(texto, { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'Tipo da nota' })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(botao));
    fireEvent.click(botao);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Lista' }), { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'Tipo da nota' })).toBeNull();
  });

  it('o cursor já está no campo logo que o formulário abre, e no item novo logo depois do Enter (sem esperar)', async () => {
    montar();
    await abrirNova('Lista');
    const primeiro = screen.getByRole('textbox', { name: 'Item 1' });
    expect(document.activeElement).toBe(primeiro);
    fireEvent.input(primeiro, { target: { value: 'Baixar dados' } });
    fireEvent.keyDown(primeiro, { key: 'Enter' });
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Item 2' }));
  });

  it('o menu Nova nota tem Texto e Lista e fecha com Esc', async () => {
    montar();
    const botao = await screen.findByRole('button', { name: /Nova nota/ });
    fireEvent.click(botao);
    const menu = within(screen.getByRole('group', { name: 'Tipo da nota' }));
    expect(menu.getByRole('button', { name: 'Texto' })).toBeTruthy();
    expect(menu.getByRole('button', { name: 'Lista' })).toBeTruthy();
    fireEvent.keyDown(botao, { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'Tipo da nota' })).toBeNull();
  });
});

describe('nota de lista', () => {
  it('Enter cria o próximo item; itens vazios são descartados ao salvar', async () => {
    montar();
    await abrirNova('Lista');
    const primeiro = await screen.findByRole('textbox', { name: 'Item 1' });
    fireEvent.input(primeiro, { target: { value: 'Baixar dados' } });
    fireEvent.keyDown(primeiro, { key: 'Enter' });
    const segundo = await screen.findByRole('textbox', { name: 'Item 2' });
    await waitFor(() => expect(document.activeElement).toBe(segundo));
    fireEvent.input(segundo, { target: { value: 'Limpar planilha' } });
    fireEvent.keyDown(segundo, { key: 'Enter' });
    await screen.findByRole('textbox', { name: 'Item 3' }); // fica vazio
    fireEvent.click(screen.getByRole('button', { name: 'Salvar nota' }));

    await waitFor(() => expect(cartoes()).toHaveLength(1));
    const [nota] = await guardadas();
    expect(nota.tipo).toBe('lista');
    expect(nota.itens!.map((i) => i.texto)).toEqual(['Baixar dados', 'Limpar planilha']);
    const cartao = within(cartoes()[0]);
    expect(cartao.getByText('05/11 12:20 · Lista')).toBeTruthy();
    expect(cartao.getAllByRole('checkbox')).toHaveLength(2);
  });

  it('+ item acrescenta e Remover item tira; lista sem texto não salva', async () => {
    montar();
    await abrirNova('Lista');
    fireEvent.click(await screen.findByRole('button', { name: '+ item' }));
    expect(await screen.findByRole('textbox', { name: 'Item 2' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remover item 2' }));
    expect(screen.queryByRole('textbox', { name: 'Item 2' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Salvar nota' }));
    expect(await screen.findByText('Escreva algo antes de salvar.')).toBeTruthy();
    expect(await listar('notas')).toEqual([]);
  });

  it('marcar o item no cartão grava feito na hora, sem abrir o Editar; desmarcar também', async () => {
    const nota = await criarNota({ salaId: SALA, tipo: 'lista', itens: [{ id: 'a', texto: 'Baixar dados' }, { id: 'b', texto: 'Limpar planilha' }] });
    montar();
    const caixa = (await screen.findByRole('checkbox', { name: 'Baixar dados' })) as HTMLInputElement;
    expect(caixa.checked).toBe(false);
    fireEvent.click(caixa);
    await waitFor(async () => expect((await listar('notas'))[0].itens).toEqual([{ id: 'a', texto: 'Baixar dados', feito: true }, { id: 'b', texto: 'Limpar planilha' }]));
    expect(screen.queryByRole('form')).toBeNull();
    await waitFor(() => expect((screen.getByRole('checkbox', { name: 'Baixar dados' }) as HTMLInputElement).checked).toBe(true));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Baixar dados' }));
    await waitFor(async () => expect((await listar('notas'))[0].itens![0].feito).toBeUndefined());
    expect((await listar('notas'))[0].id).toBe(nota.id);
  });
});

describe('editar e apagar', () => {
  it('Editar abre o formulário com o conteúdo; Salvar nota grava e mostra o novo texto', async () => {
    const nota = await criarNota({ salaId: SALA, tipo: 'texto', texto: 'Primeira versão' });
    montar();
    await screen.findByText('Primeira versão');
    fireEvent.click(screen.getByRole('button', { name: /Editar a nota de/ }));
    const campo = (await screen.findByRole('textbox', { name: 'Texto da nota' })) as HTMLTextAreaElement;
    expect(campo.value).toBe('Primeira versão');
    fireEvent.input(campo, { target: { value: 'Segunda versão' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar nota' }));
    expect(await screen.findByText('Segunda versão')).toBeTruthy();
    expect(screen.queryByRole('form')).toBeNull();
    const [guardada] = await guardadas();
    expect(guardada).toMatchObject({ id: nota.id, texto: 'Segunda versão', criadaEm: AGORA });
  });

  it('Editar e Cancelar volta como estava', async () => {
    await criarNota({ salaId: SALA, tipo: 'texto', texto: 'Fica assim' });
    montar();
    await screen.findByText('Fica assim');
    fireEvent.click(screen.getByRole('button', { name: /Editar a nota de/ }));
    fireEvent.input(await screen.findByRole('textbox', { name: 'Texto da nota' }), { target: { value: 'Mudei de ideia' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(await screen.findByText('Fica assim')).toBeTruthy();
    expect(screen.queryByRole('form')).toBeNull();
    expect((await guardadas())[0].texto).toBe('Fica assim');
  });

  it('editar uma lista: troca o item e acrescenta outro', async () => {
    await criarNota({ salaId: SALA, tipo: 'lista', itens: [{ id: 'a', texto: 'Um', feito: true }] });
    montar();
    fireEvent.click(await screen.findByRole('button', { name: /Editar a nota de/ }));
    const item1 = (await screen.findByRole('textbox', { name: 'Item 1' })) as HTMLInputElement;
    expect(item1.value).toBe('Um');
    fireEvent.input(item1, { target: { value: 'Um, revisado' } });
    fireEvent.click(screen.getByRole('button', { name: '+ item' }));
    fireEvent.input(await screen.findByRole('textbox', { name: 'Item 2' }), { target: { value: 'Dois' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar nota' }));
    await waitFor(async () => expect((await guardadas())[0].itens).toEqual([{ id: 'a', texto: 'Um, revisado', feito: true }, expect.objectContaining({ texto: 'Dois' })]));
  });

  it('Apagar de um clique: o cartão some, o aviso "Nota apagada." traz Desfazer, e Desfazer devolve a nota', async () => {
    const nota = await criarNota({ salaId: SALA, tipo: 'texto', texto: 'Vou apagar' });
    montar();
    await screen.findByText('Vou apagar');
    fireEvent.click(screen.getByRole('button', { name: /Apagar a nota de/ }));
    await waitFor(() => expect(screen.queryByText('Vou apagar')).toBeNull());
    expect(await screen.findByText('Nota apagada.')).toBeTruthy();
    expect(await listar('notas')).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'Desfazer' }));
    expect(await screen.findByText('Vou apagar')).toBeTruthy();
    expect(await listar('notas')).toEqual([expect.objectContaining({ id: nota.id, texto: 'Vou apagar', criadaEm: AGORA })]);
    expect(screen.queryByText('Nota apagada.')).toBeNull();
  });
});

describe('o que o quadro mostra', () => {
  it('a mais recente em cima, pela data de criação', async () => {
    for (const [texto, minutos] of [['Do meio', 10], ['A mais nova', 20], ['A mais velha', 0]] as const) {
      vi.setSystemTime(AGORA + minutos * 60_000);
      await criarNota({ salaId: SALA, tipo: 'texto', texto });
    }
    montar();
    await waitFor(() => expect(cartoes()).toHaveLength(3));
    expect(cartoes().map((c) => within(c).getByText(/^A mais|^Do meio/).textContent)).toEqual(['A mais nova', 'Do meio', 'A mais velha']);
  });

  it('a sala mostra só as notas da sala; a subpasta, só as dela; outra sala não aparece', async () => {
    await salvar('pastas', { id: PASTA, salaId: SALA, tipo: 'comum', nome: 'Metodologia', ordem: 1 });
    await salvar('pastas', { id: 'pasta-etica', salaId: SALA, tipo: 'comum', nome: 'Ética', ordem: 2 });
    await criarNota({ salaId: SALA, tipo: 'texto', texto: 'Da sala' });
    await criarNota({ salaId: SALA, pastaId: PASTA, tipo: 'texto', texto: 'Da subpasta Metodologia' });
    await criarNota({ salaId: SALA, pastaId: 'pasta-etica', tipo: 'texto', texto: 'Da subpasta Ética' });
    await criarNota({ salaId: 'sala-aulas', tipo: 'texto', texto: 'De Aulas' });

    montar();
    expect(await screen.findByText('Da sala')).toBeTruthy();
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.queryByText('Da subpasta Metodologia')).toBeNull();
    expect(screen.queryByText('Da subpasta Ética')).toBeNull();
    expect(screen.queryByText('De Aulas')).toBeNull();
    cleanup();

    montar({ pastaId: PASTA, titulo: 'Notas · Metodologia' });
    expect(await screen.findByRole('heading', { name: 'Notas · Metodologia' })).toBeTruthy();
    expect(await screen.findByText('Da subpasta Metodologia')).toBeTruthy();
    expect(screen.queryByText('Da sala')).toBeNull();
    expect(screen.queryByText('Da subpasta Ética')).toBeNull();
  });

  it('a subpasta apagada não esconde as notas dela: passam a aparecer na sala', async () => {
    await salvar('pastas', { id: PASTA, salaId: SALA, tipo: 'comum', nome: 'Metodologia', ordem: 1 });
    await criarNota({ salaId: SALA, pastaId: PASTA, tipo: 'texto', texto: 'Da subpasta Metodologia' });
    montar();
    await screen.findByText(/Nenhuma nota ainda/);
    await act(async () => {
      await apagar('pastas', PASTA);
    });
    expect(await screen.findByText('Da subpasta Metodologia')).toBeTruthy();
  });

  it('sem notas diz o que fazer', async () => {
    montar();
    expect(await screen.findByText(/Nenhuma nota ainda/)).toBeTruthy();
  });

  it('o texto antigo da sala aparece como uma nota (e o campo antigo continua na sala)', async () => {
    const sala = (await listar('salas')).find((s) => s.id === SALA) as Sala;
    await salvar('salas', { ...sala, notas: 'Combinar as entregas com a Marina.' });
    montar();
    expect(await screen.findByText('Combinar as entregas com a Marina.')).toBeTruthy();
    expect((await guardadas())[0].id).toMatch(/^nota-antiga-sala-doutoramento-\d+$/);
    expect(((await listar('salas')).find((s) => s.id === SALA) as Sala).notas).toBe('Combinar as entregas com a Marina.');
    cleanup();
    montar(); // abrir de novo não duplica
    await screen.findByText('Combinar as entregas com a Marina.');
    expect(await listar('notas')).toHaveLength(1);
  });

  it('a página Notas automática da subpasta vira uma nota, e a página continua guardada (nada é apagado)', async () => {
    await salvar('paginas', { id: `nota-${PASTA}`, salaId: SALA, pastaId: PASTA, titulo: 'Notas', blocos: [{ id: 'b1', tipo: 'texto', texto: 'Falar com o Prof. Souza' }] });
    montar({ pastaId: PASTA, titulo: 'Notas · Metodologia' });
    expect(await screen.findByText('Falar com o Prof. Souza')).toBeTruthy();
    expect((await guardadas())[0]).toMatchObject({ pastaId: PASTA });
    expect((await guardadas())[0].id).toMatch(/^nota-pagina-pasta-metodologia-\d+$/);
    expect((await listar('paginas')).filter((p) => !p.apagado).map((p) => p.id)).toEqual([`nota-${PASTA}`]);
  });
});

describe('versões que chegam de outro aparelho', () => {
  const doOutroAparelho = (nota: Nota, mudanca: Partial<Nota>) =>
    act(async () => {
      await editarNota(nota.id, { texto: mudanca.texto });
    });

  it('o formulário aberto não é redesenhado nem apagado quando outra nota chega ou muda', async () => {
    const outra = await criarNota({ salaId: SALA, tipo: 'texto', texto: 'Outra nota' });
    montar();
    await screen.findByText('Outra nota');
    await abrirNova('Texto');
    const campo = (await screen.findByRole('textbox', { name: 'Texto da nota' })) as HTMLTextAreaElement;
    fireEvent.input(campo, { target: { value: 'Ainda escrevendo' } });
    campo.focus();

    await doOutroAparelho(outra, { texto: 'Outra nota, mudada de fora' });
    await act(async () => {
      await criarNota({ salaId: SALA, tipo: 'texto', texto: 'Chegou uma nova' });
    });
    expect(await screen.findByText('Chegou uma nova')).toBeTruthy();
    expect(await screen.findByText('Outra nota, mudada de fora')).toBeTruthy();
    const depois = screen.getByRole('textbox', { name: 'Texto da nota' }) as HTMLTextAreaElement;
    expect(depois).toBe(campo);
    expect(depois.value).toBe('Ainda escrevendo');
    expect(document.activeElement).toBe(campo);
  });

  it('editando uma nota que muda de fora: o formulário guarda o que mostra, e o Salvar grava isso', async () => {
    const nota = await criarNota({ salaId: SALA, tipo: 'texto', texto: 'Versão inicial' });
    montar();
    fireEvent.click(await screen.findByRole('button', { name: /Editar a nota de/ }));
    const campo = (await screen.findByRole('textbox', { name: 'Texto da nota' })) as HTMLTextAreaElement;
    fireEvent.input(campo, { target: { value: 'Minha edição' } });
    await doOutroAparelho(nota, { texto: 'Edição do celular' });
    await new Promise((r) => setTimeout(r, 100));
    expect((screen.getByRole('textbox', { name: 'Texto da nota' }) as HTMLTextAreaElement).value).toBe('Minha edição');
    fireEvent.click(screen.getByRole('button', { name: 'Salvar nota' }));
    await waitFor(async () => expect((await guardadas())[0].texto).toBe('Minha edição'));
  });

  it('a nota editada foi apagada em outro aparelho: o formulário e o texto ficam, e o Salvar avisa em vez de gravar', async () => {
    const nota = await criarNota({ salaId: SALA, tipo: 'texto', texto: 'Vai sumir' });
    montar();
    fireEvent.click(await screen.findByRole('button', { name: /Editar a nota de/ }));
    const campo = await screen.findByRole('textbox', { name: 'Texto da nota' });
    fireEvent.input(campo, { target: { value: 'Texto que não pode sumir' } });
    await act(async () => {
      await apagar('notas', nota.id);
    });
    await new Promise((r) => setTimeout(r, 100));
    expect((screen.getByRole('textbox', { name: 'Texto da nota' }) as HTMLTextAreaElement).value).toBe('Texto que não pode sumir');

    fireEvent.click(screen.getByRole('button', { name: 'Salvar nota' }));
    expect(await screen.findByText(/foi apagada em outro aparelho/)).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Texto da nota' }) as HTMLTextAreaElement).value).toBe('Texto que não pode sumir');
    expect(await listar('notas')).toEqual([]);
  });
});
