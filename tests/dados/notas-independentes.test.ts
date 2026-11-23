// Notas independentes (texto e lista): coleção `notas`, por sala ou por subpasta. Nomes fictícios.
import { openDB } from 'idb';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ITENS_NO_MAXIMO,
  ITEM_NO_MAXIMO,
  NOTA_NO_MAXIMO,
  apagarNota,
  criarNota,
  editarNota,
  marcarItem,
  migrarNotasAntigas,
  migrarPaginaDaPasta,
  restaurarNota,
} from '../../src/dados/notas-independentes';
import { apagar, gravarDoServidor, lerRegistros, listar, listarAvisos, listarPendentes, salvar, semear } from '../../src/dados/loja';
import { montarCopia, restaurarCopia } from '../../src/dados/exportar';
import { sincronizar } from '../../src/dados/sincronia';
import type { Nota, Sala } from '../../src/dados/tipos';
import { servidorDeTeste } from '../apoio/servidor';

// Relógio fixo: quinta, 2026-11-05, 12:20 em Lisboa (WET = UTC em novembro).
const AGORA = Date.parse('2026-11-05T12:20:00Z');

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AGORA);
  await semear();
});

const SALA = 'sala-doutoramento';
const PASTA = 'pasta-metodologia';
const vivas = async () => (await listar('notas')).sort((a, b) => a.criadaEm - b.criadaEm);

describe('criarNota', () => {
  it('cria nota de texto e entra na fila de envio', async () => {
    const nota = await criarNota({ salaId: SALA, tipo: 'texto', texto: 'Revisar os dados do solo da parcela 3.' });
    expect(nota).toMatchObject({ salaId: SALA, tipo: 'texto', texto: 'Revisar os dados do solo da parcela 3.', criadaEm: AGORA });
    expect(nota.pastaId).toBeUndefined();
    expect(await vivas()).toEqual([nota]);
    expect(await listarPendentes()).toEqual([expect.objectContaining({ tipo: 'registro', colecao: 'notas', id: nota.id })]);
  });

  it('cria nota de lista: tira itens vazios, dá id aos itens e guarda a subpasta', async () => {
    const nota = await criarNota({
      salaId: SALA,
      pastaId: PASTA,
      tipo: 'lista',
      itens: [
        { id: '', texto: ' Baixar dados ' },
        { id: '', texto: '   ' },
        { id: 'i-fixo', texto: 'Limpar planilha', feito: true },
      ],
    });
    expect(nota.pastaId).toBe(PASTA);
    expect(nota.texto).toBeUndefined();
    expect(nota.itens).toHaveLength(2);
    expect(nota.itens![0]).toMatchObject({ texto: 'Baixar dados' });
    expect(nota.itens![0].id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(nota.itens![0].feito).toBeUndefined();
    expect(nota.itens![1]).toEqual({ id: 'i-fixo', texto: 'Limpar planilha', feito: true });
  });

  it('nota vazia lança nota_vazia e não grava', async () => {
    await expect(criarNota({ salaId: SALA, tipo: 'texto', texto: '   \n ' })).rejects.toThrow('nota_vazia');
    await expect(criarNota({ salaId: SALA, tipo: 'texto' })).rejects.toThrow('nota_vazia');
    await expect(criarNota({ salaId: SALA, tipo: 'lista', itens: [{ id: 'a', texto: '  ' }] })).rejects.toThrow('nota_vazia');
    await expect(criarNota({ salaId: SALA, tipo: 'lista', itens: [] })).rejects.toThrow('nota_vazia');
    expect(await vivas()).toEqual([]);
  });

  it('corta nos limites: 20 000 caracteres, 200 itens, 500 por item', async () => {
    const grande = await criarNota({ salaId: SALA, tipo: 'texto', texto: 'x'.repeat(NOTA_NO_MAXIMO + 50) });
    expect(grande.texto).toHaveLength(NOTA_NO_MAXIMO);
    const itens = Array.from({ length: ITENS_NO_MAXIMO + 5 }, (_, i) => ({ id: `i-${i}`, texto: 'y'.repeat(ITEM_NO_MAXIMO + 10) }));
    const lista = await criarNota({ salaId: SALA, tipo: 'lista', itens });
    expect(lista.itens).toHaveLength(ITENS_NO_MAXIMO);
    expect(lista.itens![0].texto).toHaveLength(ITEM_NO_MAXIMO);
  });
});

describe('editarNota', () => {
  it('troca o texto e mantém a data de criação', async () => {
    const nota = await criarNota({ salaId: SALA, tipo: 'texto', texto: 'Primeira' });
    vi.setSystemTime(AGORA + 60_000);
    const nova = await editarNota(nota.id, { texto: 'Segunda' });
    expect(nova).toMatchObject({ id: nota.id, texto: 'Segunda', criadaEm: AGORA });
    expect(nova.atualizadoEm).toBe(AGORA + 60_000);
  });

  it('troca os itens de uma lista; o item novo começa sem marca', async () => {
    const nota = await criarNota({ salaId: SALA, tipo: 'lista', itens: [{ id: 'a', texto: 'Um' }] });
    const nova = await editarNota(nota.id, { itens: [{ id: 'a', texto: 'Um, revisado' }, { id: 'b', texto: 'Dois', feito: true }] });
    expect(nova.itens).toEqual([{ id: 'a', texto: 'Um, revisado' }, { id: 'b', texto: 'Dois' }]);
  });

  it('a marca de um item vem da nota relida: o formulário, aberto antes de marcar, não a desfaz', async () => {
    const nota = await criarNota({ salaId: SALA, tipo: 'lista', itens: [{ id: 'a', texto: 'Um' }, { id: 'b', texto: 'Dois', feito: true }] });
    // O formulário abriu com a nota como estava; depois a caixinha de "a" foi marcada e a de "b" desmarcada.
    await marcarItem(nota.id, 'a', true);
    await marcarItem(nota.id, 'b', false);
    const nova = await editarNota(nota.id, { itens: [{ id: 'a', texto: 'Um' }, { id: 'b', texto: 'Dois', feito: true }, { id: 'c', texto: 'Três' }] });
    expect(nova.itens).toEqual([{ id: 'a', texto: 'Um', feito: true }, { id: 'b', texto: 'Dois' }, { id: 'c', texto: 'Três' }]);
  });

  it('esvaziar a nota lança nota_vazia e não muda nada', async () => {
    const nota = await criarNota({ salaId: SALA, tipo: 'texto', texto: 'Fica' });
    await expect(editarNota(nota.id, { texto: '  ' })).rejects.toThrow('nota_vazia');
    expect((await vivas())[0].texto).toBe('Fica');
  });

  it('nota que não existe (ou foi apagada) lança nota_nao_encontrada', async () => {
    await expect(editarNota('nota-que-nao-existe', { texto: 'x' })).rejects.toThrow('nota_nao_encontrada');
    const nota = await criarNota({ salaId: SALA, tipo: 'texto', texto: 'Some' });
    await apagarNota(nota.id);
    await expect(editarNota(nota.id, { texto: 'x' })).rejects.toThrow('nota_nao_encontrada');
  });
});

describe('marcarItem', () => {
  it('marca e desmarca um item, relendo a nota antes de gravar', async () => {
    const nota = await criarNota({ salaId: SALA, tipo: 'lista', itens: [{ id: 'a', texto: 'Baixar dados' }, { id: 'b', texto: 'Limpar planilha' }] });
    const marcada = await marcarItem(nota.id, 'b', true);
    expect(marcada.itens).toEqual([{ id: 'a', texto: 'Baixar dados' }, { id: 'b', texto: 'Limpar planilha', feito: true }]);
    // O texto mudou em outro lugar entre as duas chamadas: marcar não o desfaz.
    await editarNota(nota.id, { itens: [{ id: 'a', texto: 'Baixar dados novos' }, { id: 'b', texto: 'Limpar planilha', feito: true }] });
    const desmarcada = await marcarItem(nota.id, 'b', false);
    expect(desmarcada.itens).toEqual([{ id: 'a', texto: 'Baixar dados novos' }, { id: 'b', texto: 'Limpar planilha' }]);
  });

  it('duas marcações ao mesmo tempo valem as duas', async () => {
    const nota = await criarNota({ salaId: SALA, tipo: 'lista', itens: [{ id: 'a', texto: 'Um' }, { id: 'b', texto: 'Dois' }] });
    await Promise.all([marcarItem(nota.id, 'a', true), marcarItem(nota.id, 'b', true)]);
    expect((await vivas())[0].itens!.map((i) => i.feito)).toEqual([true, true]);
  });

  it('nota ou item que não existe lança nota_nao_encontrada', async () => {
    const nota = await criarNota({ salaId: SALA, tipo: 'lista', itens: [{ id: 'a', texto: 'Um' }] });
    await expect(marcarItem('nota-que-nao-existe', 'a', true)).rejects.toThrow('nota_nao_encontrada');
    await expect(marcarItem(nota.id, 'item-que-nao-existe', true)).rejects.toThrow('nota_nao_encontrada');
  });
});

describe('apagarNota e restaurarNota', () => {
  it('apaga (lápide) devolvendo a nota como era, e restaura com o mesmo id e a mesma data', async () => {
    const nota = await criarNota({ salaId: SALA, pastaId: PASTA, tipo: 'lista', itens: [{ id: 'a', texto: 'Um', feito: true }] });
    const antes = await apagarNota(nota.id);
    expect(antes).toEqual(nota);
    expect(await vivas()).toEqual([]);
    const volta = await restaurarNota(antes!);
    expect(volta).toMatchObject({ id: nota.id, criadaEm: AGORA, pastaId: PASTA, itens: [{ id: 'a', texto: 'Um', feito: true }] });
    expect(volta.apagado).toBeUndefined();
    expect(await vivas()).toHaveLength(1);
  });

  it('apagar uma nota que não existe devolve undefined', async () => {
    expect(await apagarNota('nota-que-nao-existe')).toBeUndefined();
  });
});

const salaComNotas = async (notas: string, salaId = SALA) => {
  const sala = (await listar('salas')).find((s) => s.id === salaId) as Sala;
  return salvar('salas', { ...sala, notas });
};
/** O id da nota da migração: leva a versão (a hora da última mudança) da sala. */
const antiga = (salaId = SALA, versao = AGORA) => `nota-antiga-${salaId}-${versao}`;

describe('migrarNotasAntigas', () => {
  it('o texto antigo da sala vira uma nota de texto com a data da última mudança da sala; o campo antigo fica', async () => {
    const sala = await salaComNotas('Combinar as entregas com a Marina.');
    await migrarNotasAntigas(SALA);
    const [nota] = await vivas();
    expect(nota).toMatchObject({ id: antiga(SALA, sala.atualizadoEm), salaId: SALA, tipo: 'texto', texto: 'Combinar as entregas com a Marina.', criadaEm: sala.atualizadoEm });
    expect(nota.pastaId).toBeUndefined();
    const [lida] = (await lerRegistros([{ colecao: 'salas', id: SALA }])) as Sala[];
    expect(lida.notas).toBe('Combinar as entregas com a Marina.');
  });

  it('sala sem notas, ou só com espaços, não cria nada', async () => {
    await migrarNotasAntigas(SALA);
    await salaComNotas('  \n ');
    await migrarNotasAntigas(SALA);
    expect(await vivas()).toEqual([]);
  });

  it('duas aberturas ao mesmo tempo dão uma nota só', async () => {
    await salaComNotas('Texto antigo');
    await Promise.all([migrarNotasAntigas(SALA), migrarNotasAntigas(SALA)]);
    await migrarNotasAntigas(SALA);
    expect(await vivas()).toHaveLength(1);
  });

  it('não ressuscita a nota que o dono apagou (a lápide do id da versão bloqueia)', async () => {
    await salaComNotas('Texto antigo');
    await migrarNotasAntigas(SALA);
    await apagar('notas', antiga());
    await migrarNotasAntigas(SALA);
    expect(await vivas()).toEqual([]);
  });

  it('não recria nada se a nota já existe, mesmo editada', async () => {
    await salaComNotas('Texto antigo');
    await migrarNotasAntigas(SALA);
    await editarNota(antiga(), { texto: 'Texto editado' });
    await migrarNotasAntigas(SALA);
    expect((await vivas()).map((n) => n.texto)).toEqual(['Texto editado']);
  });

  it('a nota migrada perde para a versão que já existe em outro aparelho, sem aviso de conflito', async () => {
    await salaComNotas('Texto antigo');
    await migrarNotasAntigas(SALA);
    const remota: Nota = {
      id: antiga(), salaId: SALA, tipo: 'texto', texto: 'Texto já editado no celular', criadaEm: AGORA - 3_600_000,
      atualizadoEm: AGORA - 60_000, aparelho: 'celular-fake',
    };
    await gravarDoServidor([{ colecao: 'notas', registro: remota }]);
    expect((await vivas()).map((n) => n.texto)).toEqual(['Texto já editado no celular']);
    expect(await listarAvisos()).toEqual([]);
  });

  it('cada sala migra a sua: o id leva o id da sala', async () => {
    await salaComNotas('Da Doutoramento');
    await salaComNotas('Das Aulas', 'sala-aulas');
    await migrarNotasAntigas(SALA);
    await migrarNotasAntigas('sala-aulas');
    expect((await vivas()).map((n) => n.id).sort()).toEqual([antiga('sala-aulas'), antiga()].sort());
  });

  it('sala que não existe não faz nada', async () => {
    await migrarNotasAntigas('sala-que-nao-existe');
    expect(await vivas()).toEqual([]);
  });

  it('texto editado na sala depois da migração (aparelho antigo) vira uma segunda nota; nada se perde', async () => {
    await salaComNotas('Primeiro texto');
    await migrarNotasAntigas(SALA);
    vi.setSystemTime(AGORA + 60_000);
    await salaComNotas('Primeiro texto, com um acréscimo do aparelho antigo');
    await migrarNotasAntigas(SALA);
    const notas = await vivas();
    expect(notas.map((n) => n.id).sort()).toEqual([antiga(), antiga(SALA, AGORA + 60_000)].sort());
    expect(notas.map((n) => n.texto).sort()).toEqual(['Primeiro texto', 'Primeiro texto, com um acréscimo do aparelho antigo']);
    await migrarNotasAntigas(SALA);
    expect(await vivas()).toHaveLength(2);
  });

  it('a sala só mudou de nome depois da migração: o texto igual não vira nota repetida (viva ou apagada)', async () => {
    await salaComNotas('Texto antigo');
    await migrarNotasAntigas(SALA);
    vi.setSystemTime(AGORA + 60_000);
    const sala = (await listar('salas')).find((s) => s.id === SALA) as Sala;
    await salvar('salas', { ...sala, nome: 'Doutoramento 2' });
    await migrarNotasAntigas(SALA);
    expect(await vivas()).toHaveLength(1);
    await apagar('notas', antiga());
    vi.setSystemTime(AGORA + 120_000);
    await salvar('salas', { ...sala, nome: 'Doutoramento 3' });
    await migrarNotasAntigas(SALA);
    expect(await vivas()).toEqual([]);
  });

  it('a nota do esquema anterior (id sem versão) conta como a versão já migrada', async () => {
    const sala = await salaComNotas('Texto antigo');
    await salvar('notas', { id: `nota-antiga-${SALA}`, salaId: SALA, tipo: 'texto', texto: 'Texto antigo, já editado', criadaEm: sala.atualizadoEm });
    await migrarNotasAntigas(SALA);
    expect((await vivas()).map((n) => n.id)).toEqual([`nota-antiga-${SALA}`]);
    // Outra versão do texto da sala (editada num aparelho antigo): essa é nova e entra.
    vi.setSystemTime(AGORA + 60_000);
    await salaComNotas('Outro texto');
    await migrarNotasAntigas(SALA);
    expect((await vivas()).map((n) => n.texto).sort()).toEqual(['Outro texto', 'Texto antigo, já editado']);
  });

  it('texto da sala acima de 20 000 caracteres vira várias notas, sem cortar nada', async () => {
    const texto = 'y'.repeat(NOTA_NO_MAXIMO + 10);
    await salaComNotas(texto);
    await migrarNotasAntigas(SALA);
    await migrarNotasAntigas(SALA);
    const notas = await vivas();
    expect(notas.map((n) => n.id).sort()).toEqual([`${antiga()}-1`, `${antiga()}-2`]);
    expect(notas.sort((a, b) => a.id.localeCompare(b.id)).map((n) => n.texto).join('')).toBe(texto);
  });
});

const PAGINA = `nota-${PASTA}`;
const pagina = (blocos: { id: string; tipo: string; texto?: string }[], extra: Record<string, unknown> = {}) =>
  salvar('paginas', { id: PAGINA, salaId: SALA, pastaId: PASTA, titulo: 'Notas', blocos, ...extra } as never);
const paginasVivas = async () => (await listar('paginas')).filter((p) => !p.apagado);
const daPagina = (versao: number, sufixo = '') => `nota-pagina-${PASTA}-${versao}${sufixo}`;

describe('migrarPaginaDaPasta', () => {
  it('a página Notas automática com texto vira uma nota de texto (linhas unidas por \\n; a linha em branco do meio fica); a página continua', async () => {
    const original = await pagina([
      { id: 'b1', tipo: 'texto', texto: 'Definir a amostra' },
      { id: 'b2', tipo: 'texto', texto: '' },
      { id: 'b3', tipo: 'texto', texto: 'Falar com o Prof. Souza' },
    ]);
    await migrarPaginaDaPasta(SALA, PASTA);
    const [nota] = await vivas();
    expect(nota).toMatchObject({ id: daPagina(original.atualizadoEm), salaId: SALA, pastaId: PASTA, tipo: 'texto', texto: 'Definir a amostra\n\nFalar com o Prof. Souza', criadaEm: original.atualizadoEm });
    expect((await paginasVivas()).map((p) => p.id)).toEqual([PAGINA]);
  });

  it('página vazia não cria nota e não é apagada', async () => {
    await pagina([{ id: 'b1', tipo: 'texto', texto: '' }]);
    await migrarPaginaDaPasta(SALA, PASTA);
    expect(await vivas()).toEqual([]);
    expect((await paginasVivas()).map((p) => p.id)).toEqual([PAGINA]);
  });

  it('outras páginas da pasta não mudam', async () => {
    await salvar('paginas', { id: 'p-amostragem', salaId: SALA, pastaId: PASTA, titulo: 'Amostragem', blocos: [{ id: 'x', tipo: 'texto', texto: 'Tamanho da amostra' }] });
    await migrarPaginaDaPasta(SALA, PASTA);
    expect((await paginasVivas()).map((p) => p.id)).toEqual(['p-amostragem']);
    expect(await vivas()).toEqual([]);
  });

  it('sem página nenhuma não faz nada', async () => {
    await migrarPaginaDaPasta(SALA, PASTA);
    expect(await vivas()).toEqual([]);
  });

  it('duas aberturas ao mesmo tempo dão uma nota só; depois da migração não repete', async () => {
    await pagina([{ id: 'b1', tipo: 'texto', texto: 'Uma linha' }]);
    await Promise.all([migrarPaginaDaPasta(SALA, PASTA), migrarPaginaDaPasta(SALA, PASTA)]);
    await migrarPaginaDaPasta(SALA, PASTA);
    expect(await vivas()).toHaveLength(1);
  });

  it('não ressuscita a nota apagada pelo dono: a lápide bloqueia, e a página continua onde estava', async () => {
    const original = await pagina([{ id: 'b1', tipo: 'texto', texto: 'Uma linha' }]);
    await migrarPaginaDaPasta(SALA, PASTA);
    await apagar('notas', daPagina(original.atualizadoEm));
    await migrarPaginaDaPasta(SALA, PASTA);
    expect(await vivas()).toEqual([]);
    expect((await paginasVivas()).map((p) => p.id)).toEqual([PAGINA]);
  });

  it('a nota migrada perde para a versão que já existe em outro aparelho', async () => {
    const original = await pagina([{ id: 'b1', tipo: 'texto', texto: 'Uma linha' }]);
    await migrarPaginaDaPasta(SALA, PASTA);
    const remota: Nota = {
      id: daPagina(original.atualizadoEm), salaId: SALA, pastaId: PASTA, tipo: 'texto', texto: 'Escrito no celular', criadaEm: AGORA - 1000,
      atualizadoEm: AGORA - 60_000, aparelho: 'celular-fake',
    };
    await gravarDoServidor([{ colecao: 'notas', registro: remota }]);
    expect((await vivas()).map((n) => n.texto)).toEqual(['Escrito no celular']);
    expect(await listarAvisos()).toEqual([]);
  });

  it('a página que volta com outro texto (aparelho antigo) vira uma segunda nota; nada se perde', async () => {
    const v1 = await pagina([{ id: 'b1', tipo: 'texto', texto: 'Primeiro texto' }]);
    await migrarPaginaDaPasta(SALA, PASTA);
    vi.setSystemTime(AGORA + 60_000);
    const v2 = await pagina([{ id: 'b1', tipo: 'texto', texto: 'Primeiro texto, com acréscimo' }]);
    await migrarPaginaDaPasta(SALA, PASTA);
    const notas = await vivas();
    expect(notas.map((n) => n.id).sort()).toEqual([daPagina(v1.atualizadoEm), daPagina(v2.atualizadoEm)].sort());
    expect(notas.map((n) => n.texto).sort()).toEqual(['Primeiro texto', 'Primeiro texto, com acréscimo']);
    await migrarPaginaDaPasta(SALA, PASTA);
    expect(await vivas()).toHaveLength(2);
  });

  it('a página regravada com o mesmo texto não repete a nota (viva ou apagada)', async () => {
    await pagina([{ id: 'b1', tipo: 'texto', texto: 'Mesmo texto' }]);
    await migrarPaginaDaPasta(SALA, PASTA);
    vi.setSystemTime(AGORA + 60_000);
    await pagina([{ id: 'b1', tipo: 'texto', texto: 'Mesmo texto' }]);
    await migrarPaginaDaPasta(SALA, PASTA);
    expect(await vivas()).toHaveLength(1);
    await apagar('notas', daPagina(AGORA));
    vi.setSystemTime(AGORA + 120_000);
    await pagina([{ id: 'b1', tipo: 'texto', texto: 'Mesmo texto' }]);
    await migrarPaginaDaPasta(SALA, PASTA);
    expect(await vivas()).toEqual([]);
  });

  it('uma nota viva da subpasta com o mesmo texto já basta: não cria outra', async () => {
    await criarNota({ salaId: SALA, pastaId: PASTA, tipo: 'texto', texto: 'Texto que o dono já tem em nota' });
    await pagina([{ id: 'b1', tipo: 'texto', texto: 'Texto que o dono já tem em nota' }]);
    await migrarPaginaDaPasta(SALA, PASTA);
    expect(await vivas()).toHaveLength(1);
  });

  it('página de 45 000 caracteres vira 3 notas, sem cortar nada', async () => {
    const texto = 'x'.repeat(45_000);
    const original = await pagina([{ id: 'b1', tipo: 'texto', texto }]);
    await migrarPaginaDaPasta(SALA, PASTA);
    await migrarPaginaDaPasta(SALA, PASTA);
    const notas = (await vivas()).sort((a, b) => a.id.localeCompare(b.id));
    expect(notas.map((n) => n.id)).toEqual([daPagina(original.atualizadoEm, '-1'), daPagina(original.atualizadoEm, '-2'), daPagina(original.atualizadoEm, '-3')]);
    expect(notas.map((n) => n.texto!.length)).toEqual([20_000, 20_000, 5000]);
    expect(notas.map((n) => n.texto).join('')).toBe(texto);
  });

  it('dois aparelhos migrando versões diferentes da página dão duas notas em cada um, e nenhuma se perde', async () => {
    const notebook = new IDBFactory();
    const celular = new IDBFactory();
    const servidor = servidorDeTeste();
    const sync = () => sincronizar({ chamar: servidor.chamar, esperar: () => Promise.resolve() });

    globalThis.indexedDB = notebook;
    await semear();
    await pagina([{ id: 'b1', tipo: 'texto', texto: 'Escrito no notebook' }]);
    await migrarPaginaDaPasta(SALA, PASTA);

    globalThis.indexedDB = celular;
    await semear();
    vi.setSystemTime(AGORA + 5000);
    await pagina([{ id: 'b1', tipo: 'texto', texto: 'Escrito no celular' }]);
    await migrarPaginaDaPasta(SALA, PASTA);

    expect(await sync()).toBe('atualizado');
    globalThis.indexedDB = notebook;
    expect(await sync()).toBe('atualizado');
    await migrarPaginaDaPasta(SALA, PASTA);
    expect((await vivas()).map((n) => n.texto).sort()).toEqual(['Escrito no celular', 'Escrito no notebook']);
    globalThis.indexedDB = celular;
    expect(await sync()).toBe('atualizado');
    await migrarPaginaDaPasta(SALA, PASTA);
    const notas = await vivas();
    expect(notas.map((n) => n.texto).sort()).toEqual(['Escrito no celular', 'Escrito no notebook']);
    expect(new Set(notas.map((n) => n.id)).size).toBe(2);
  });
});

describe('exportar e restaurar', () => {
  it('preservam as notas (a apagada não vai para a cópia) e a restauração devolve a nota apagada depois', async () => {
    const texto = await criarNota({ salaId: SALA, tipo: 'texto', texto: 'Ler o artigo da Aurora' });
    const lista = await criarNota({ salaId: SALA, pastaId: PASTA, tipo: 'lista', itens: [{ id: 'a', texto: 'Um', feito: true }] });
    const apagada = await criarNota({ salaId: SALA, tipo: 'texto', texto: 'Esta sai' });
    await apagarNota(apagada.id);
    const copia = await montarCopia();
    expect((copia.colecoes.notas ?? []).map((n) => n.id).sort()).toEqual([texto.id, lista.id].sort());
    await apagarNota(lista.id);

    expect(await restaurarCopia(copia)).toEqual({ restaurados: 7 + 2, recusados: 0 }); // as 7 salas semeadas e as 2 notas
    expect((await vivas()).map((n) => n.id).sort()).toEqual([texto.id, lista.id].sort());
    expect((await vivas()).find((n) => n.id === lista.id)).toMatchObject({ pastaId: PASTA, itens: [{ id: 'a', texto: 'Um', feito: true }], criadaEm: AGORA });
  });
});

describe('migração do banco 7 -> 8', () => {
  it('sobe criando notas sem tocar nos dados existentes', async () => {
    globalThis.indexedDB = new IDBFactory(); // o `semear` do beforeEach já abriu a versão nova
    const antigo = await openDB('central-dados', 7, {
      upgrade(banco) {
        for (const c of ['salas', 'pessoas', 'tarefas', 'palavras', 'documentos', 'paginas', 'estadosEmail', 'config', 'eventosFeitos', 'coresDasSalas', 'agua', 'ideias', 'pastas']) {
          banco.createObjectStore(c, { keyPath: 'id' });
        }
        banco.createObjectStore('pendentes', { keyPath: 'seq', autoIncrement: true });
        banco.createObjectStore('avisos', { keyPath: 'id', autoIncrement: true });
        banco.createObjectStore('local');
        banco.createObjectStore('espelhos');
      },
    });
    const ideia = { id: 'i1', texto: 'Antes', estado: 'nova', atualizadoEm: AGORA, aparelho: 'notebook' };
    await antigo.put('ideias', ideia);
    antigo.close();

    expect(await listar('notas')).toEqual([]);
    expect(await listar('ideias')).toEqual([ideia]);
    expect((await criarNota({ salaId: SALA, tipo: 'texto', texto: 'Depois da subida' })).tipo).toBe('texto');
  });
});

describe('notas em dois aparelhos', () => {
  it('a nota criada e a marca do item chegam ao outro aparelho pela sincronia (script de verdade)', async () => {
    const notebook = new IDBFactory();
    const celular = new IDBFactory();
    const servidor = servidorDeTeste();
    const sync = () => sincronizar({ chamar: servidor.chamar, esperar: () => Promise.resolve() });

    globalThis.indexedDB = notebook;
    const lista = await criarNota({ salaId: SALA, pastaId: PASTA, tipo: 'lista', itens: [{ id: 'a', texto: 'Baixar dados' }, { id: 'b', texto: 'Limpar planilha' }] });
    expect(await sync()).toBe('atualizado');
    globalThis.indexedDB = celular;
    expect(await sync()).toBe('atualizado');
    expect(await vivas()).toEqual([expect.objectContaining({ id: lista.id, pastaId: PASTA, criadaEm: AGORA })]);

    vi.setSystemTime(AGORA + 60_000);
    await marcarItem(lista.id, 'a', true);
    expect(await sync()).toBe('atualizado');
    globalThis.indexedDB = notebook;
    expect(await sync()).toBe('atualizado');
    expect((await vivas())[0].itens).toEqual([{ id: 'a', texto: 'Baixar dados', feito: true }, { id: 'b', texto: 'Limpar planilha' }]);
  });
});
