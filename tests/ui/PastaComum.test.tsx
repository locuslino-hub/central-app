// A pasta comum (V02, Tarefa 17): tarefas, notas e documentos de um tema, ligados à pasta por `pastaId`.
// Quinta-feira, 2026-11-05, 12:20 em Lisboa. Nomes, ids e links fictícios.
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { limparConversa } from '../../src/chat/conversa';
import { apagarPasta } from '../../src/dados/pastas';
import { listar, salvar, semear, semearPalavras } from '../../src/dados/loja';
import { criarNota } from '../../src/dados/notas-independentes';
import { criar } from '../apoio/tarefas';

configure({ asyncUtilTimeout: 5000 });

beforeEach(async () => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-11-05T12:20:00Z'));
  limparConversa();
  await semear();
  await semearPalavras();
});

// Desmontar grava o que ficou por gravar no caderno; espera antes de o próximo teste trocar o banco.
afterEach(async () => {
  cleanup();
  await new Promise((r) => setTimeout(r, 150));
});

function mostrar(hash: string, largura = 1280) {
  Object.defineProperty(window, 'innerWidth', { value: largura, configurable: true, writable: true });
  history.replaceState(null, '', `/${hash}`);
  return render(<App />);
}

const principal = () => within(document.querySelector('main') as HTMLElement);
const HASH = '#/sala/sala-doutoramento/pasta/pasta-metodologia';

const metodologia = () => salvar('pastas', { id: 'pasta-metodologia', salaId: 'sala-doutoramento', tipo: 'comum', nome: 'Metodologia', ordem: 1 });
const outroTema = () => salvar('pastas', { id: 'pasta-etica', salaId: 'sala-doutoramento', tipo: 'comum', nome: 'Ética', ordem: 2 });

/** Uma página do caderno ligada ao tema, com uma linha de texto. */
const notaDoTema = (titulo: string, texto: string, pastaId = 'pasta-metodologia') =>
  salvar('paginas', { salaId: 'sala-doutoramento', titulo, pastaId, blocos: [{ id: `b-${titulo}`, tipo: 'texto', texto }] });

const regiao = (nome: string) => principal().findByRole('region', { name: nome });
const NOTAS = 'Notas · Metodologia';

describe('notas da pasta comum', () => {
  it('abre com o quadro de notas da subpasta, sem criar página nenhuma', async () => {
    await metodologia();
    mostrar(HASH);
    const notas = within(await regiao(NOTAS));
    expect(await notas.findByRole('button', { name: /Nova nota/ })).toBeTruthy();
    expect(await notas.findByText(/Nenhuma nota ainda/)).toBeTruthy();
    expect(notas.queryByRole('textbox')).toBeNull();
    expect(await listar('paginas')).toEqual([]);
  });

  it('a página Notas automática da versão anterior vira uma nota e some', async () => {
    await metodologia();
    await salvar('paginas', { id: 'nota-pasta-metodologia', salaId: 'sala-doutoramento', pastaId: 'pasta-metodologia', titulo: 'Notas', blocos: [{ id: 'b1', tipo: 'texto', texto: 'Falar com o Prof. Souza' }] });
    mostrar(HASH);
    expect(await within(await regiao(NOTAS)).findByText('Falar com o Prof. Souza')).toBeTruthy();
    await waitFor(async () => expect((await listar('paginas')).filter((p) => !p.apagado)).toEqual([]));
  });

  it('Notas vêm antes de Tarefas', async () => {
    await metodologia();
    mostrar(HASH);
    const notas = await regiao(NOTAS);
    const tarefas = await regiao('Tarefas');
    expect(notas.compareDocumentPosition(tarefas) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('lembra a última pasta comum', async () => {
    await metodologia();
    mostrar(HASH);
    await regiao(NOTAS);
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem('central.notas.ultimaPasta') ?? 'null')).toEqual({ salaId: 'sala-doutoramento', pastaId: 'pasta-metodologia' }),
    );
  });
});

describe('a pasta comum', () => {
  it('pasta comum mostra tarefas, notas e documentos do tema', async () => {
    await metodologia();
    await outroTema();
    await criar('Revisar capítulo de métodos', { salaId: 'sala-doutoramento', pastaId: 'pasta-metodologia', data: '2026-11-05' });
    await criar('Ler artigo sobre ética', { salaId: 'sala-doutoramento', pastaId: 'pasta-etica', data: '2026-11-05' });
    await criar('Tarefa da sala sem tema', { salaId: 'sala-doutoramento', data: '2026-11-05' });
    await criar('Tarefa já feita do tema', { salaId: 'sala-doutoramento', pastaId: 'pasta-metodologia', data: '2026-11-05', feito: true });
    await criarNota({ salaId: 'sala-doutoramento', pastaId: 'pasta-metodologia', tipo: 'texto', texto: 'Definir o tamanho da amostra' });
    await criarNota({ salaId: 'sala-doutoramento', pastaId: 'pasta-etica', tipo: 'texto', texto: 'Parecer do comitê' });
    await criarNota({ salaId: 'sala-doutoramento', tipo: 'texto', texto: 'Nota solta da sala' });
    await salvar('documentos', { titulo: 'Protocolo do estudo', url: 'https://exemplo.invalid/protocolo.docx', salaId: 'sala-doutoramento', pastaId: 'pasta-metodologia', arquivado: false });
    await salvar('documentos', { titulo: 'Termo de consentimento', url: 'https://exemplo.invalid/termo.docx', salaId: 'sala-doutoramento', pastaId: 'pasta-etica', arquivado: false });
    await salvar('documentos', { titulo: 'Documento solto da sala', url: 'https://exemplo.invalid/solto.docx', salaId: 'sala-doutoramento', arquivado: false });

    mostrar(HASH);

    expect(await principal().findByRole('heading', { level: 1, name: 'Metodologia' })).toBeTruthy();
    const tarefas = within(await regiao('Tarefas'));
    expect(await tarefas.findByText('Revisar capítulo de métodos')).toBeTruthy();
    expect(tarefas.queryByText('Ler artigo sobre ética')).toBeNull();
    expect(tarefas.queryByText('Tarefa da sala sem tema')).toBeNull();
    expect(tarefas.queryByText('Tarefa já feita do tema')).toBeNull();

    const notas = within(await regiao(NOTAS));
    expect(await notas.findByText('Definir o tamanho da amostra')).toBeTruthy();
    expect(notas.queryByText('Parecer do comitê')).toBeNull();
    expect(notas.queryByText('Nota solta da sala')).toBeNull();

    const documentos = within(await regiao('Documentos'));
    expect(await documentos.findByRole('link', { name: 'Protocolo do estudo' })).toBeTruthy();
    expect(documentos.queryByRole('link', { name: 'Termo de consentimento' })).toBeNull();
    expect(documentos.queryByRole('link', { name: 'Documento solto da sala' })).toBeNull();
  });

  it('só entra no tema o que é da sala da pasta: pastaId de pasta de outra sala não aparece', async () => {
    await metodologia();
    await criar('Tarefa de outra sala com o mesmo tema', { salaId: 'sala-aulas', pastaId: 'pasta-metodologia', data: '2026-11-05' });
    await criar('Tarefa certa', { salaId: 'sala-doutoramento', pastaId: 'pasta-metodologia', data: '2026-11-05' });
    await salvar('documentos', { titulo: 'Documento de outra sala', url: 'https://exemplo.invalid/o.docx', salaId: 'sala-aulas', pastaId: 'pasta-metodologia', arquivado: false });
    await salvar('documentos', { titulo: 'Documento certo', url: 'https://exemplo.invalid/c.docx', salaId: 'sala-doutoramento', pastaId: 'pasta-metodologia', arquivado: false });
    mostrar(HASH);

    const tarefas = within(await regiao('Tarefas'));
    expect(await tarefas.findByText('Tarefa certa')).toBeTruthy();
    expect(tarefas.queryByText('Tarefa de outra sala com o mesmo tema')).toBeNull();
    const documentos = within(await regiao('Documentos'));
    expect(await documentos.findByRole('link', { name: 'Documento certo' })).toBeTruthy();
    expect(documentos.queryByRole('link', { name: 'Documento de outra sala' })).toBeNull();
  });

  it('tema vazio diz o que fazer em cada parte', async () => {
    await metodologia();
    mostrar(HASH);

    const tarefas = within(await regiao('Tarefas'));
    expect(await tarefas.findByText('Nada em aberto neste tema.')).toBeTruthy();
    expect(await within(await regiao(NOTAS)).findByText(/Nenhuma nota ainda/)).toBeTruthy();
    expect(await within(await regiao('Documentos')).findByText('Nenhum documento ainda.')).toBeTruthy();
  });

  it('nova tarefa pela pasta já nasce no tema, na sala da pasta e para hoje', async () => {
    await metodologia();
    mostrar(HASH);
    const tarefas = within(await regiao('Tarefas'));

    fireEvent.input(await tarefas.findByRole('textbox', { name: 'Nova tarefa em Metodologia' }), { target: { value: 'Escrever a justificativa' } });
    fireEvent.click(tarefas.getByRole('button', { name: 'Adicionar' }));

    await waitFor(async () => expect(await listar('tarefas')).toHaveLength(1));
    expect((await listar('tarefas'))[0]).toMatchObject({ titulo: 'Escrever a justificativa', salaId: 'sala-doutoramento', pastaId: 'pasta-metodologia', data: '2026-11-05' });
    expect(await tarefas.findByText('Escrever a justificativa')).toBeTruthy();
  });

  it('nova nota pela pasta já nasce na subpasta, na sala da pasta', async () => {
    await metodologia();
    mostrar(HASH);
    const notas = within(await regiao(NOTAS));

    fireEvent.click(await notas.findByRole('button', { name: /Nova nota/ }));
    fireEvent.click(await notas.findByRole('button', { name: 'Texto' }));
    fireEvent.input(await notas.findByRole('textbox', { name: 'Texto da nota' }), { target: { value: 'Definir o tamanho da amostra' } });
    fireEvent.click(notas.getByRole('button', { name: 'Salvar nota' }));

    await waitFor(async () => expect(await listar('notas')).toHaveLength(1));
    expect((await listar('notas'))[0]).toMatchObject({ salaId: 'sala-doutoramento', pastaId: 'pasta-metodologia', tipo: 'texto', texto: 'Definir o tamanho da amostra' });
    expect(await notas.findByText('Definir o tamanho da amostra')).toBeTruthy();
    expect(await listar('paginas')).toEqual([]);
  });

  it('novo documento pela pasta já nasce no tema, sem perguntar onde guardar', async () => {
    await metodologia();
    mostrar(HASH);
    const documentos = within(await regiao('Documentos'));

    fireEvent.click(await documentos.findByRole('button', { name: 'Adicionar documento' }));
    const form = within(await screen.findByRole('form', { name: 'Novo documento' }));
    expect(form.queryByLabelText('Guardar em')).toBeNull();
    fireEvent.input(form.getByLabelText('Link'), { target: { value: 'https://exemplo.invalid/plano.pptx' } });
    fireEvent.input(form.getByLabelText('Título'), { target: { value: 'Plano de métodos' } });
    fireEvent.click(form.getByRole('button', { name: 'Guardar' }));

    await waitFor(async () => expect(await listar('documentos')).toHaveLength(1));
    expect((await listar('documentos'))[0]).toMatchObject({ titulo: 'Plano de métodos', salaId: 'sala-doutoramento', pastaId: 'pasta-metodologia', arquivado: false });
    expect(await documentos.findByRole('link', { name: 'Plano de métodos' })).toBeTruthy();
    expect(documentos.getByRole('status').textContent).toContain('Guardado em Metodologia');
  });

  it('o documento e a nota do tema continuam na sala: apagar a pasta não esconde nada', async () => {
    const pasta = await metodologia();
    await salvar('documentos', { titulo: 'Protocolo do estudo', url: 'https://exemplo.invalid/p.docx', salaId: 'sala-doutoramento', pastaId: pasta.id, arquivado: false });
    await notaDoTema('Amostragem', 'Definir o tamanho da amostra');
    await apagarPasta(pasta.id);

    mostrar('#/sala/sala-doutoramento');

    const caixa = within(await principal().findByRole('region', { name: 'Documentos' }));
    expect(await caixa.findByRole('link', { name: 'Protocolo do estudo' })).toBeTruthy();
    const caderno = within(await principal().findByRole('region', { name: 'Caderno' }));
    expect(await caderno.findByRole('button', { name: 'Amostragem' })).toBeTruthy();
  });

  it('apagar a pasta não esconde as notas dela: continuam na sala', async () => {
    const pasta = await metodologia();
    await criarNota({ salaId: 'sala-doutoramento', pastaId: pasta.id, tipo: 'texto', texto: 'Definir o tamanho da amostra' });
    await criarNota({ salaId: 'sala-doutoramento', tipo: 'texto', texto: 'Nota da própria sala' });
    await apagarPasta(pasta.id);

    mostrar('#/sala/sala-doutoramento');

    const quadro = within(await principal().findByRole('region', { name: 'Notas' }));
    expect(await quadro.findByText('Definir o tamanho da amostra')).toBeTruthy();
    expect(quadro.getByText('Nota da própria sala')).toBeTruthy();
  });

  it('tarefa com pastaId continua aparecendo no Painel e na Checklist', async () => {
    await metodologia();
    await criar('Revisar capítulo de métodos', { salaId: 'sala-doutoramento', pastaId: 'pasta-metodologia', data: '2026-11-05' });
    mostrar('#/');

    const checklist = within((await principal().findByRole('heading', { name: 'Checklist do dia' })).closest('section') as HTMLElement);
    expect(await checklist.findByRole('checkbox', { name: 'Revisar capítulo de métodos' })).toBeTruthy();
    expect(await principal().findByRole('link', { name: 'Doutoramento: 1 tarefa' })).toBeTruthy();
  });

  it('concluir a tarefa pela pasta tira da lista da pasta e continua feita na Checklist', async () => {
    await metodologia();
    await criar('Revisar capítulo de métodos', { salaId: 'sala-doutoramento', pastaId: 'pasta-metodologia', data: '2026-11-05' });
    mostrar(HASH);
    const tarefas = within(await regiao('Tarefas'));

    fireEvent.click(await tarefas.findByRole('checkbox', { name: 'Revisar capítulo de métodos' }));

    await waitFor(async () => expect((await listar('tarefas'))[0]!.feito).toBe(true));
  });

  it('apagada a pasta, a página some mas as tarefas seguem vivas na sala e no Painel', async () => {
    const pasta = await metodologia();
    await criar('Revisar capítulo de métodos', { salaId: 'sala-doutoramento', pastaId: pasta.id, data: '2026-11-05' });
    await apagarPasta(pasta.id);

    mostrar(HASH);
    expect(await principal().findByText(/Esta pasta não existe neste aparelho/)).toBeTruthy();

    cleanup();
    mostrar('#/sala/sala-doutoramento');
    const daSala = within(await principal().findByRole('region', { name: 'Tarefas' }));
    expect(await daSala.findByText('Revisar capítulo de métodos')).toBeTruthy();
  });

  it('as tarefas do tema aparecem logo que chegam de outro aparelho', async () => {
    await metodologia();
    mostrar(HASH);
    const tarefas = within(await regiao('Tarefas'));
    await tarefas.findByText('Nada em aberto neste tema.');

    await act(async () => {
      await criar('Chegou do outro aparelho', { salaId: 'sala-doutoramento', pastaId: 'pasta-metodologia', data: '2026-11-05' });
    });

    expect(await tarefas.findByText('Chegou do outro aparelho')).toBeTruthy();
  });

  it('no celular (390 px) a pasta tem as três partes', async () => {
    await metodologia();
    mostrar(HASH, 390);
    expect(await regiao('Tarefas')).toBeTruthy();
    expect(await regiao(NOTAS)).toBeTruthy();
    expect(await regiao('Documentos')).toBeTruthy();
  });
});
