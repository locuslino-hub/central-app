// Ideias (V02, Tarefa 4): coleção própria `ideias`, ligada pelo mesmo caminho
// da `agua` (tipos, esquema do script, VERSAO, exportar, sincronia).
import { openDB } from 'idb';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as loja from '../../src/dados/loja';
import { apagar, listar, listarPendentes, salvar, semear } from '../../src/dados/loja';
import { sincronizar } from '../../src/dados/sincronia';
import { montarCopia, restaurarCopia } from '../../src/dados/exportar';
import { guardarAudio, lerAudioPendente, listarAudios } from '../../src/voz/audios-pendentes';
import { apagarIdeia, atribuirSala, contarNovas, criarIdeia, restaurarIdeia, sugerirSala, virarTarefa, virarTarefaComDesfazer } from '../../src/dados/ideias';
import type { Ideia, Palavra, Pessoa, Sala } from '../../src/dados/tipos';
import { marcarProblemaDeAudio, problemasDosAudios } from '../../src/voz/audios-pendentes';
import { servidorDeTeste } from '../apoio/servidor';

// Relógio fixo: quinta, 2026-11-05, 12:20 em Lisboa (WET = UTC em novembro).
const AGORA = Date.parse('2026-11-05T12:20:00Z');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AGORA);
});

const base = { aparelho: 'notebook', atualizadoEm: 1 };
const salas: Sala[] = [
  { ...base, id: 'sala-orientacoes', nome: 'Orientações', ordem: 3 },
  { ...base, id: 'sala-casa', nome: 'Casa', ordem: 6 },
];
const pessoas: Pessoa[] = [{ ...base, id: 'p-marina', nome: 'Marina', salaId: 'sala-orientacoes' }];
const palavras: Palavra[] = [{ ...base, id: 'pa-1', termo: 'parafusar', salaId: 'sala-casa' }];

describe('criarIdeia', () => {
  it('grava estado nova e entra na fila de envio', async () => {
    const { ideia } = await criarIdeia('  Pensar no artigo da Aurora ');

    expect(ideia).toMatchObject({ texto: 'Pensar no artigo da Aurora', estado: 'nova', atualizadoEm: AGORA });
    expect(await listar('ideias')).toEqual([ideia]);
    expect(await listarPendentes()).toEqual([expect.objectContaining({ tipo: 'registro', colecao: 'ideias', id: ideia.id })]);
  });

  it('guarda o áudio quando vem junto', async () => {
    const { ideia } = await criarIdeia('Ideia falada', { audioId: 'a-1', audioSegundos: 42 });
    expect(ideia).toMatchObject({ audioId: 'a-1', audioSegundos: 42 });
  });

  it('texto vazio, só espaços ou com mais de 2000 caracteres lança texto_invalido', async () => {
    for (const texto of ['', '   ', 'x'.repeat(2001), '...', '?!', '—', '-', ' . , ; ']) {
      await expect(criarIdeia(texto)).rejects.toThrow('texto_invalido');
    }
    expect(await listar('ideias')).toEqual([]);
  });

  it('áudio com id fora do formato ou segundos negativos/infinitos lança audio_invalido', async () => {
    await expect(criarIdeia('Falada', { audioId: 'tem espaço' })).rejects.toThrow('audio_invalido');
    await expect(criarIdeia('Falada', { audioId: 'a'.repeat(101) })).rejects.toThrow('audio_invalido');
    for (const audioSegundos of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(criarIdeia('Falada', { audioId: 'a-1', audioSegundos })).rejects.toThrow('audio_invalido');
    }
    expect(await listar('ideias')).toEqual([]);
  });

  it('aceita texto com letra ou número no meio da pontuação', async () => {
    expect((await criarIdeia('... 2 ...')).ideia.texto).toBe('... 2 ...');
  });

  it('aceita exatamente 2000 caracteres', async () => {
    const { ideia } = await criarIdeia('x'.repeat(2000));
    expect(ideia.texto).toHaveLength(2000);
  });

  it('desfazer apaga a ideia (e chamar de novo não dá erro)', async () => {
    const { ideia, desfazer } = await criarIdeia('Efêmera');
    await desfazer();
    expect(await listar('ideias')).toEqual([]);
    expect(await listar('ideias', { comApagados: true })).toEqual([expect.objectContaining({ id: ideia.id, apagado: true })]);
    await expect(desfazer()).resolves.toBeUndefined();
  });
});

describe('sugerirSala', () => {
  it('acha Orientações pelo nome de aluna fictícia Marina', () => {
    expect(sugerirSala('Falar com a Marina sobre o capítulo', salas, pessoas, palavras)).toBe('sala-orientacoes');
  });

  it('acha a sala pela palavra guardada', () => {
    expect(sugerirSala('parafusar o apoio do banheiro', salas, pessoas, palavras)).toBe('sala-casa');
  });

  it('devolve null sem pista', () => {
    expect(sugerirSala('Pensar na vida', salas, pessoas, palavras)).toBeNull();
  });

  it('devolve null se a sala achada não existe na lista de salas', () => {
    expect(sugerirSala('Falar com a Marina', [salas[1]], pessoas, palavras)).toBeNull();
  });
});

describe('atribuirSala, virarTarefa e apagarIdeia', () => {
  beforeEach(async () => {
    await semear();
  });

  it('atribuirSala marca atribuida e guarda a sala; null volta para nova', async () => {
    const { ideia } = await criarIdeia('Rever o MBA');
    await atribuirSala(ideia.id, 'sala-mba');
    expect((await listar('ideias'))[0]).toMatchObject({ salaId: 'sala-mba', estado: 'atribuida' });
    await atribuirSala(ideia.id, null);
    expect((await listar('ideias'))[0]).toMatchObject({ salaId: null, estado: 'nova' });
  });

  it('virarTarefa cria tarefa na sala sugerida e marca a ideia', async () => {
    await salvar('pessoas', { nome: 'Marina', salaId: 'sala-orientacoes' });
    const { ideia } = await criarIdeia('Enviar o roteiro para a Marina');

    const tarefa = await virarTarefa(ideia.id);

    expect(tarefa).toMatchObject({ titulo: 'Enviar o roteiro para a Marina', salaId: 'sala-orientacoes', data: '2026-11-05', feito: false });
    expect((await listar('tarefas')).map((t) => t.id)).toEqual([tarefa.id]);
    expect((await listar('ideias'))[0]).toMatchObject({ id: ideia.id, estado: 'tarefa', salaId: 'sala-orientacoes' });
  });

  it('atribuirSala numa ideia que já virou tarefa muda só a sala e mantém o estado', async () => {
    const { ideia } = await criarIdeia('Rever o MBA');
    await virarTarefa(ideia.id);
    await atribuirSala(ideia.id, 'sala-casa');
    expect((await listar('ideias'))[0]).toMatchObject({ salaId: 'sala-casa', estado: 'tarefa' });
  });

  it('virarTarefa duas vezes cria uma tarefa só e devolve a mesma', async () => {
    const { ideia } = await criarIdeia('Rever o MBA');
    const primeira = await virarTarefa(ideia.id);
    const segunda = await virarTarefa(ideia.id);
    expect(segunda.id).toBe(primeira.id);
    expect(await listar('tarefas')).toHaveLength(1);
    expect((await listar('ideias'))[0]).toMatchObject({ estado: 'tarefa', tarefaId: primeira.id });
  });

  it('falha ao marcar a ideia depois de criar a tarefa: tentar de novo não duplica', async () => {
    const { ideia } = await criarIdeia('Rever o MBA');
    const original = loja.salvar;
    const espiao = vi.spyOn(loja, 'salvar').mockImplementation(((colecao: never, registro: never, opcoes?: never) => {
      if ((colecao as string) === 'ideias' && (registro as { estado?: string }).estado === 'tarefa') return Promise.reject(new Error('disco cheio'));
      return original(colecao, registro, opcoes);
    }) as typeof loja.salvar);
    await expect(virarTarefa(ideia.id)).rejects.toThrow('disco cheio');
    espiao.mockRestore();

    expect(await listar('tarefas')).toHaveLength(1);
    const tarefa = await virarTarefa(ideia.id);
    expect(await listar('tarefas')).toEqual([tarefa]);
    expect((await listar('ideias'))[0]).toMatchObject({ estado: 'tarefa', tarefaId: tarefa.id });
  });

  it('virarTarefa com a ideia apagada no meio dá erro claro e não cria tarefa', async () => {
    const { ideia } = await criarIdeia('Rever o MBA');
    await apagarIdeia(ideia.id);
    await expect(virarTarefa(ideia.id)).rejects.toThrow('ideia_nao_encontrada');
    expect(await listar('tarefas')).toEqual([]);
  });

  it('virarTarefa ignora salaId de sala que sumiu e cai na sugerida', async () => {
    await salvar('pessoas', { nome: 'Marina', salaId: 'sala-orientacoes' });
    const { ideia } = await criarIdeia('Enviar o roteiro para a Marina');
    await atribuirSala(ideia.id, 'sala-que-sumiu');
    expect(await virarTarefa(ideia.id)).toMatchObject({ salaId: 'sala-orientacoes' });
  });

  it('virarTarefa com sala apagada e sem pista fica sem sala', async () => {
    await apagar('salas', 'sala-casa');
    const { ideia } = await criarIdeia('Pensar na vida');
    await atribuirSala(ideia.id, 'sala-casa');
    expect(await virarTarefa(ideia.id)).toMatchObject({ salaId: null });
  });

  it('virarTarefa respeita a sala já atribuída à ideia', async () => {
    const { ideia } = await criarIdeia('Enviar o roteiro para a Marina');
    await atribuirSala(ideia.id, 'sala-mba');
    expect(await virarTarefa(ideia.id)).toMatchObject({ salaId: 'sala-mba' });
  });

  it('virarTarefaComDesfazer: Desfazer apaga a tarefa e devolve a ideia a como estava (nova, sem sala nem tarefa)', async () => {
    const { ideia } = await criarIdeia('Rever o MBA');
    const { tarefa, desfazer } = await virarTarefaComDesfazer(ideia.id);
    expect((await listar('ideias'))[0]).toMatchObject({ estado: 'tarefa', tarefaId: tarefa.id });

    await desfazer();

    expect(await listar('tarefas')).toEqual([]);
    const depois = (await listar('ideias'))[0]!;
    expect(depois).toMatchObject({ id: ideia.id, texto: 'Rever o MBA', estado: 'nova' });
    expect(depois.tarefaId).toBeUndefined();
    expect(contarNovas(await listar('ideias'))).toBe(1);
  });

  it('virarTarefaComDesfazer: Desfazer de ideia atribuída volta a atribuída, com a mesma sala', async () => {
    const { ideia } = await criarIdeia('Rever o MBA');
    await atribuirSala(ideia.id, 'sala-mba');
    const { desfazer } = await virarTarefaComDesfazer(ideia.id);
    await desfazer();
    expect((await listar('ideias'))[0]).toMatchObject({ estado: 'atribuida', salaId: 'sala-mba' });
    expect(await listar('tarefas')).toEqual([]);
  });

  it('virarTarefaComDesfazer: desfazer duas vezes não faz nada na segunda', async () => {
    const { ideia } = await criarIdeia('Rever o MBA');
    const { desfazer } = await virarTarefaComDesfazer(ideia.id);
    await desfazer();
    await desfazer();
    expect(await listar('tarefas')).toEqual([]);
    expect((await listar('ideias'))[0]).toMatchObject({ estado: 'nova' });
  });

  it('virarTarefaComDesfazer: chamada repetida devolve a tarefa que já existe e o Desfazer dela não apaga nada', async () => {
    const { ideia } = await criarIdeia('Rever o MBA');
    const primeira = await virarTarefaComDesfazer(ideia.id);
    const segunda = await virarTarefaComDesfazer(ideia.id);
    expect(segunda.tarefa.id).toBe(primeira.tarefa.id);

    await segunda.desfazer();

    expect(await listar('tarefas')).toHaveLength(1);
    expect((await listar('ideias'))[0]).toMatchObject({ estado: 'tarefa' });
  });

  it('virarTarefaComDesfazer: ideia apagada depois de virar tarefa: Desfazer só apaga a tarefa', async () => {
    const { ideia } = await criarIdeia('Rever o MBA');
    const { desfazer } = await virarTarefaComDesfazer(ideia.id);
    await apagarIdeia(ideia.id);
    await desfazer();
    expect(await listar('tarefas')).toEqual([]);
    expect(await listar('ideias')).toEqual([]);
  });

  it('ideia cuja tarefa foi apagada pode virar tarefa de novo (tarefa nova, mesma ideia)', async () => {
    const { ideia } = await criarIdeia('Rever o MBA');
    const primeira = await virarTarefa(ideia.id);
    await apagar('tarefas', primeira.id);

    const segunda = await virarTarefa(ideia.id);

    expect(segunda.id).not.toBe(primeira.id);
    expect(await listar('tarefas')).toEqual([segunda]);
    expect((await listar('ideias'))[0]).toMatchObject({ estado: 'tarefa', tarefaId: segunda.id });
  });

  it('virar de novo e desfazer volta ao estado de tarefa apagada (pode virar outra vez)', async () => {
    const { ideia } = await criarIdeia('Rever o MBA');
    const primeira = await virarTarefa(ideia.id);
    await apagar('tarefas', primeira.id);
    const { desfazer } = await virarTarefaComDesfazer(ideia.id);
    await desfazer();
    expect(await listar('tarefas')).toEqual([]);
    expect((await listar('ideias'))[0]).toMatchObject({ estado: 'tarefa', tarefaId: primeira.id });
    expect(await virarTarefa(ideia.id)).toMatchObject({ titulo: 'Rever o MBA' });
    expect(await listar('tarefas')).toHaveLength(1);
  });

  it('virarTarefa de ideia que não existe lança erro e não cria nada', async () => {
    await expect(virarTarefa('nao-existe')).rejects.toThrow();
    expect(await listar('tarefas')).toEqual([]);
  });

  it('apagarIdeia devolve a ideia como era e limpa o problema do áudio dela', async () => {
    const { ideia } = await criarIdeia('Descartar', { audioId: 'a-9', audioSegundos: 5 });
    await marcarProblemaDeAudio('a-9', 'recusado');
    await marcarProblemaDeAudio('outro', 'falhou');

    const antes = await apagarIdeia(ideia.id);

    expect(antes).toMatchObject({ id: ideia.id, texto: 'Descartar', audioId: 'a-9' });
    expect([...(await problemasDosAudios()).keys()]).toEqual(['outro']);
  });

  it('o desfazer de criarIdeia também limpa o problema do áudio', async () => {
    const { ideia, desfazer } = await criarIdeia('Descartar', { audioId: 'a-8' });
    await marcarProblemaDeAudio(ideia.audioId!, 'sem_espaco');
    await desfazer();
    expect((await problemasDosAudios()).size).toBe(0);
  });

  it('restaurarIdeia recria a ideia apagada com os mesmos campos, áudio incluído', async () => {
    await atribuirSala((await criarIdeia('Outra')).ideia.id, 'sala-casa');
    const { ideia } = await criarIdeia('Rever o MBA', { audioId: 'a-7', audioSegundos: 31 });
    await atribuirSala(ideia.id, 'sala-mba');
    const antes = (await apagarIdeia(ideia.id))!;
    expect((await listar('ideias')).map((i) => i.id)).not.toContain(ideia.id);

    await restaurarIdeia(antes);

    const volta = (await listar('ideias')).find((i) => i.id === ideia.id)!;
    expect(volta).toMatchObject({ texto: 'Rever o MBA', estado: 'atribuida', salaId: 'sala-mba', audioId: 'a-7', audioSegundos: 31 });
    expect(volta.apagado).toBeUndefined();
  });

  it('apagarIdeia tira da fila o áudio que ainda esperava rede; o Desfazer o devolve', async () => {
    await guardarAudio({ id: 'a-fila', bytes: new Uint8Array([1, 2, 3]).buffer, mime: 'audio/webm', guardadoEm: 1 });
    await guardarAudio({ id: 'a-outra', bytes: new Uint8Array([4]).buffer, mime: 'audio/webm', guardadoEm: 2 });
    const { ideia } = await criarIdeia('Descartar', { audioId: 'a-fila', audioSegundos: 3 });

    const antes = (await apagarIdeia(ideia.id))!;
    expect((await listarAudios()).map((a) => a.id)).toEqual(['a-outra']);

    await restaurarIdeia(antes);
    expect((await listarAudios()).map((a) => a.id)).toEqual(['a-fila', 'a-outra']);
    expect((await lerAudioPendente('a-fila'))!.bytes.byteLength).toBe(3);
  });

  it('apagarIdeia grava a lápide', async () => {
    const { ideia } = await criarIdeia('Descartar');
    await apagarIdeia(ideia.id);
    expect(await listar('ideias')).toEqual([]);
  });
});

describe('contarNovas', () => {
  it('ignora atribuídas, as que viraram tarefa e as apagadas', () => {
    const i = (estado: Ideia['estado'], apagado?: boolean): Ideia => ({ ...base, id: estado + String(apagado), texto: 'x', estado, apagado });
    expect(contarNovas([i('nova'), i('nova', true), i('atribuida'), i('tarefa')])).toBe(1);
    expect(contarNovas([])).toBe(0);
  });
});

describe('exportar e restaurar', () => {
  it('inclui ideias na cópia e devolve na restauração', async () => {
    const { ideia } = await criarIdeia('Ideia da Renata', { audioId: 'a-1', audioSegundos: 10 });
    const copia = await montarCopia();
    expect(copia.colecoes.ideias).toEqual([ideia]);

    await apagar('ideias', ideia.id);
    expect(await restaurarCopia(copia)).toEqual({ restaurados: 1, recusados: 0 });
    expect(await listar('ideias')).toEqual([expect.objectContaining({ id: ideia.id, texto: 'Ideia da Renata', estado: 'nova', audioId: 'a-1' })]);
  });

  it('cópia antiga com rascunhos continua ignorada (sem virar ideias)', async () => {
    const { ideia } = await criarIdeia('Fica');
    const copia = await montarCopia();
    (copia.colecoes as Record<string, unknown[]>).rascunhos = [];
    await apagar('ideias', ideia.id);

    expect(await restaurarCopia(copia)).toEqual({ restaurados: 1, recusados: 0 });
    expect((await listar('ideias')).map((x) => x.texto)).toEqual(['Fica']);
    expect(Object.keys((await montarCopia()).colecoes)).not.toContain('rascunhos');
  });
});

describe('migração do banco 5 -> 6', () => {
  it('sobe criando ideias sem tocar nos dados existentes', async () => {
    const antigo = await openDB('central-dados', 5, {
      upgrade(banco) {
        for (const c of ['salas', 'pessoas', 'tarefas', 'palavras', 'documentos', 'paginas', 'estadosEmail', 'config', 'eventosFeitos', 'coresDasSalas', 'agua']) {
          banco.createObjectStore(c, { keyPath: 'id' });
        }
        banco.createObjectStore('pendentes', { keyPath: 'seq', autoIncrement: true });
        banco.createObjectStore('avisos', { keyPath: 'id', autoIncrement: true });
        banco.createObjectStore('local');
        banco.createObjectStore('espelhos');
      },
    });
    const tarefa = { id: 't1', titulo: 'Antes', salaId: null, duracaoMin: 60, duracaoConfirmada: false, feito: false, fixada: false, marcar: false, atualizadoEm: AGORA, aparelho: 'notebook' };
    const gole = { id: 'g1', data: '2026-11-05', hora: '12:00', ml: 200, atualizadoEm: AGORA, aparelho: 'notebook' };
    await antigo.put('tarefas', tarefa);
    await antigo.put('agua', gole);
    await antigo.add('pendentes', { tipo: 'registro', colecao: 'tarefas', id: 't1' });
    antigo.close();

    expect(await listar('ideias')).toEqual([]);
    expect(await listar('tarefas')).toEqual([tarefa]);
    expect(await listar('agua')).toEqual([gole]);
    expect(await listarPendentes()).toEqual([{ seq: 1, tipo: 'registro', colecao: 'tarefas', id: 't1' }]);
    expect((await criarIdeia('Depois da subida')).ideia.estado).toBe('nova');
  });
});

describe('ideias em dois aparelhos', () => {
  it('a ideia criada num aparelho chega ao outro pela sincronia', async () => {
    const notebook = new IDBFactory();
    const celular = new IDBFactory();
    const servidor = servidorDeTeste();
    const sync = () => sincronizar({ chamar: servidor.chamar, esperar: () => Promise.resolve() });

    globalThis.indexedDB = notebook;
    const { ideia } = await criarIdeia('Ideia do notebook');
    expect(await sync()).toBe('atualizado');
    globalThis.indexedDB = celular;
    expect(await sync()).toBe('atualizado');

    expect(await listar('ideias')).toEqual([expect.objectContaining({ id: ideia.id, texto: 'Ideia do notebook' })]);
  });
});
