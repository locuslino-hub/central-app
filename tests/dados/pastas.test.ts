// Pastas (V02, Tarefa 9): coleção própria `pastas`, ligada pelo mesmo caminho da
// `agua` e das `ideias`. A planilha é criada pelo script; falha dele não deixa
// pasta pela metade e a mesma pasta nunca cria duas planilhas.
import { openDB } from 'idb';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apagar, listar, listarPendentes, salvar } from '../../src/dados/loja';
import { sincronizar } from '../../src/dados/sincronia';
import { montarCopia, restaurarCopia } from '../../src/dados/exportar';
import { ErroConexao } from '../../src/conexao/cliente';
import { anexar, lerPlanilha } from '../../src/dados/planilhas';
import { apagarPasta, chaveDosOcultos, criarPasta, criarPastasPadraoDaCasa, faltamPadraoDaCasa, listarPastas, renomearPasta, restaurarPasta } from '../../src/dados/pastas';
import type { Pasta } from '../../src/dados/tipos';
import { servidorDeTeste } from '../apoio/servidor';

const AGORA = Date.parse('2026-11-05T12:20:00Z');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AGORA);
});

type Chamar = <T>(acao: string, dados?: object) => Promise<T>;

/** Script de mentira: devolve `planilha-teste-N` e guarda o que lhe pediram. */
function scriptDeMentira() {
  const chamadas: { acao: string; dados: Record<string, unknown> }[] = [];
  let n = 0;
  const espiao = vi.fn(async (acao: string, dados?: object) => {
    chamadas.push({ acao, dados: (dados ?? {}) as Record<string, unknown> });
    n += 1;
    return { planilhaId: `planilha-teste-${n}` };
  });
  const sincronizar = async () => 'atualizado' as const;
  return { chamar: espiao as unknown as Chamar, chamadas, espiao, opcoes: { chamar: espiao as unknown as Chamar, sincronizar } };
}

describe('criarPasta', () => {
  it('lista cria a planilha e guarda o id', async () => {
    const script = scriptDeMentira();
    const pasta = await criarPasta({ salaId: 'sala-casa', tipo: 'lista', nome: 'Compras da Renata', modelo: 'compras' }, { chamar: script.chamar });

    expect(script.chamadas).toEqual([{ acao: 'criarPlanilha', dados: { nome: 'Compras da Renata', modelo: 'compras' } }]);
    expect(pasta).toMatchObject({ salaId: 'sala-casa', tipo: 'lista', nome: 'Compras da Renata', modelo: 'compras', planilhaId: 'planilha-teste-1', ordem: 1 });
    expect(await listar('pastas')).toEqual([pasta]);
    expect(await listarPendentes()).toEqual([expect.objectContaining({ tipo: 'registro', colecao: 'pastas', id: pasta.id })]);
  });

  it('registro e planilha também criam a planilha; comum não chama o script', async () => {
    const script = scriptDeMentira();
    await criarPasta({ salaId: 'sala-casa', tipo: 'registro', nome: 'Água', modelo: 'consumo', servico: 'agua', unidade: 'm³', diaDeEnvio: 5 }, { chamar: script.chamar });
    await criarPasta({ salaId: 'sala-casa', tipo: 'planilha', nome: 'Contas', modelo: 'financeiro' }, { chamar: script.chamar });
    const comum = await criarPasta({ salaId: 'sala-doutoramento', tipo: 'comum', nome: 'Capítulo 2' }, { chamar: script.chamar });

    expect(script.chamadas.map((c) => c.dados.modelo)).toEqual(['consumo', 'financeiro']);
    expect(comum.planilhaId).toBeUndefined();
    expect(comum.ordem).toBe(1);
  });

  it('lista, registro e planilha sem modelo lançam modelo_obrigatorio e não chamam o script', async () => {
    const script = scriptDeMentira();
    for (const tipo of ['lista', 'registro', 'planilha'] as const) {
      await expect(criarPasta({ salaId: 'sala-casa', tipo, nome: 'X' }, { chamar: script.chamar })).rejects.toThrow('modelo_obrigatorio');
    }
    expect(script.chamadas).toEqual([]);
    expect(await listar('pastas')).toEqual([]);
  });

  it('nome vazio ou grande demais lança nome_invalido', async () => {
    const script = scriptDeMentira();
    for (const nome of ['', '   ', 'x'.repeat(101)]) {
      await expect(criarPasta({ salaId: 'sala-casa', tipo: 'comum', nome }, { chamar: script.chamar })).rejects.toThrow('nome_invalido');
    }
    expect(await listar('pastas')).toEqual([]);
  });

  it('falha do script não grava a pasta', async () => {
    const chamar = (async () => {
      throw new Error('sem rede');
    }) as unknown as Chamar;
    await expect(criarPasta({ salaId: 'sala-casa', tipo: 'lista', nome: 'Compras', modelo: 'compras' }, { chamar })).rejects.toThrow('sem rede');
    expect(await listar('pastas', { comApagados: true })).toEqual([]);
    expect(await listarPendentes()).toEqual([]);
  });

  it('resposta do script sem planilhaId válido não grava a pasta', async () => {
    for (const resposta of [{}, { planilhaId: '' }, { planilhaId: 5 }, { erro: 'fora_da_pasta' }, null]) {
      const chamar = (async () => resposta) as unknown as Chamar;
      await expect(criarPasta({ salaId: 'sala-casa', tipo: 'lista', nome: 'Compras', modelo: 'compras' }, { chamar })).rejects.toThrow('planilha_nao_criada');
    }
    expect(await listar('pastas')).toEqual([]);
  });

  it('erro organizar_pastas do script (Casa ainda na raiz do Drive) sobe como organizar_pastas e não grava a pasta', async () => {
    const chamar = (async () => ({ erro: 'organizar_pastas' })) as unknown as Chamar;
    await expect(criarPasta({ salaId: 'sala-casa', tipo: 'lista', nome: 'Compras', modelo: 'compras' }, { chamar })).rejects.toThrow('organizar_pastas');
    expect(await listar('pastas', { comApagados: true })).toEqual([]);
    expect(await listarPendentes()).toEqual([]);
  });

  it('duas chamadas iguais ao mesmo tempo criam uma planilha só', async () => {
    let solta: () => void = () => {};
    const espera = new Promise<void>((r) => (solta = r));
    const chamar = vi.fn(async () => {
      await espera;
      return { planilhaId: 'planilha-teste-1' };
    });
    const dados = { salaId: 'sala-casa', tipo: 'lista', nome: 'Compras', modelo: 'compras' } as const;

    const a = criarPasta(dados, { chamar: chamar as unknown as Chamar });
    const b = criarPasta(dados, { chamar: chamar as unknown as Chamar });
    solta();
    const [pa, pb] = await Promise.all([a, b]);

    expect(chamar).toHaveBeenCalledTimes(1);
    expect(pb.id).toBe(pa.id);
    expect(await listar('pastas')).toHaveLength(1);
  });

  it('depois de terminar, criar de novo é outra pasta (e outra planilha)', async () => {
    const script = scriptDeMentira();
    const dados = { salaId: 'sala-casa', tipo: 'lista', nome: 'Compras', modelo: 'compras' } as const;
    const a = await criarPasta(dados, { chamar: script.chamar });
    const b = await criarPasta(dados, { chamar: script.chamar });
    expect(b.id).not.toBe(a.id);
    expect(b.ordem).toBe(2);
    expect(script.chamadas).toHaveLength(2);
  });
});

describe('lista, registro e planilha só existem na Casa', () => {
  it.each([
    ['lista', 'compras'],
    ['registro', 'consumo'],
    ['planilha', 'financeiro'],
  ] as const)('%s fora da Casa dá tipo_so_na_casa, antes de chamar o script e sem gravar nada', async (tipo, modelo) => {
    const script = scriptDeMentira();
    await expect(criarPasta({ salaId: 'sala-doutoramento', tipo, nome: 'Fora do lugar', modelo }, { chamar: script.chamar })).rejects.toThrow('tipo_so_na_casa');
    // Também sem modelo: a regra da sala vem antes da do modelo.
    await expect(criarPasta({ salaId: 'sala-aulas', tipo, nome: 'Fora do lugar' }, { chamar: script.chamar })).rejects.toThrow('tipo_so_na_casa');
    expect(script.espiao).not.toHaveBeenCalled();
    expect(await listar('pastas')).toEqual([]);
  });

  it('pasta comum cabe em qualquer sala', async () => {
    const script = scriptDeMentira();
    const pasta = await criarPasta({ salaId: 'sala-doutoramento', tipo: 'comum', nome: 'Metodologia' }, { chamar: script.chamar });
    expect(pasta).toMatchObject({ salaId: 'sala-doutoramento', tipo: 'comum' });
    expect(script.espiao).not.toHaveBeenCalled();
  });
});

describe('listarPastas, renomearPasta, apagarPasta', () => {
  it('lista só as da sala, por ordem, sem as apagadas', async () => {
    const script = scriptDeMentira();
    const um = await criarPasta({ salaId: 'sala-casa', tipo: 'comum', nome: 'Um' }, { chamar: script.chamar });
    const dois = await criarPasta({ salaId: 'sala-casa', tipo: 'comum', nome: 'Dois' }, { chamar: script.chamar });
    await criarPasta({ salaId: 'sala-aulas', tipo: 'comum', nome: 'Outra sala' }, { chamar: script.chamar });
    await apagarPasta(um.id);
    expect((await listarPastas('sala-casa')).map((p) => p.id)).toEqual([dois.id]);
  });

  it('renomeia e recusa nome inválido ou pasta que não existe', async () => {
    const script = scriptDeMentira();
    const p = await criarPasta({ salaId: 'sala-casa', tipo: 'comum', nome: 'Velho' }, { chamar: script.chamar });
    await renomearPasta(p.id, '  Novo  ');
    expect((await listarPastas('sala-casa'))[0].nome).toBe('Novo');
    await expect(renomearPasta(p.id, '  ')).rejects.toThrow('nome_invalido');
    await expect(renomearPasta('nao-existe', 'X')).rejects.toThrow('pasta_nao_encontrada');
    await apagarPasta(p.id);
    await expect(renomearPasta(p.id, 'X')).rejects.toThrow('pasta_nao_encontrada');
  });

  it('apagarPasta deixa lápide e não chama o Drive', async () => {
    const script = scriptDeMentira();
    const p = await criarPasta({ salaId: 'sala-casa', tipo: 'lista', nome: 'Compras', modelo: 'compras' }, { chamar: script.chamar });
    script.espiao.mockClear();

    await apagarPasta(p.id);

    expect(script.espiao).not.toHaveBeenCalled();
    expect(await listar('pastas')).toEqual([]);
    expect(await listar('pastas', { comApagados: true })).toEqual([expect.objectContaining({ id: p.id, apagado: true, planilhaId: 'planilha-teste-1' })]);
    await apagarPasta(p.id); // de novo não faz nada
    expect(script.espiao).not.toHaveBeenCalled();
  });

  it('apagarPasta esquece o cache da planilha e os itens limpos da vista, mas não a fila de envio', async () => {
    const script = scriptDeMentira();
    const p = await criarPasta({ salaId: 'sala-casa', tipo: 'lista', nome: 'Compras', modelo: 'compras' }, { chamar: script.chamar });
    const outra = await criarPasta({ salaId: 'sala-casa', tipo: 'lista', nome: 'Outra', modelo: 'compras' }, { chamar: script.chamar });
    // Cache: uma leitura boa de cada pasta (linha de outra pessoa).
    const lida = async () => ({ cabecalho: ['Item', 'id'], linhas: [{ id: 'l1', valores: { Item: 'leite', id: 'l1' } }] });
    await lerPlanilha(p, { chamar: lida as never });
    await lerPlanilha(outra, { chamar: lida as never });
    // Fila: um anexo que ainda não foi enviado.
    await anexar(p, { Item: 'pilhas' }, { chamar: (async () => { throw new ErroConexao(); }) as never });
    localStorage.setItem(chaveDosOcultos(p.id), '["l1"]');
    localStorage.setItem(chaveDosOcultos(outra.id), '["l1"]');
    const nasChaves = async () => {
      const banco = await openDB('central-planilhas', 1);
      try {
        return (await banco.getAllKeys('cache')) as string[];
      } finally {
        banco.close();
      }
    };
    expect((await nasChaves()).sort()).toEqual([outra.id, p.id].sort());
    const daPlanilha = async () => (await listarPendentes()).filter((e) => e.tipo === 'planilha').length;
    expect(await daPlanilha()).toBe(1);

    await apagarPasta(p.id);

    expect(await nasChaves()).toEqual([outra.id]);
    expect(localStorage.getItem(chaveDosOcultos(p.id))).toBeNull();
    expect(localStorage.getItem(chaveDosOcultos(outra.id))).toBe('["l1"]');
    expect(await daPlanilha()).toBe(1);
  });

  it('restaurarPasta devolve a pasta apagada, com o mesmo id e a mesma planilha, sem chamar o Drive', async () => {
    const script = scriptDeMentira();
    const p = await criarPasta({ salaId: 'sala-casa', tipo: 'lista', nome: 'Compras', modelo: 'compras' }, { chamar: script.chamar });
    const antes = await apagarPasta(p.id);
    script.espiao.mockClear();

    const volta = await restaurarPasta(antes!);

    expect(volta).toMatchObject({ id: p.id, nome: 'Compras', planilhaId: 'planilha-teste-1', ordem: p.ordem });
    expect(volta.apagado).toBeUndefined();
    expect(await listarPastas('sala-casa')).toEqual([volta]);
    expect(script.espiao).not.toHaveBeenCalled();
  });
});

describe('apagar pasta e Desfazer devolvem os itens limpos da vista', () => {
  it('restaurarPasta devolve a lista de ocultos que apagarPasta tirou', async () => {
    const script = scriptDeMentira();
    const p = await criarPasta({ salaId: 'sala-casa', tipo: 'lista', nome: 'Compras', modelo: 'compras' }, { chamar: script.chamar });
    localStorage.setItem(chaveDosOcultos(p.id), '["l1","l2"]');

    const antes = await apagarPasta(p.id);
    expect(localStorage.getItem(chaveDosOcultos(p.id))).toBeNull();
    await restaurarPasta(antes!);

    expect(localStorage.getItem(chaveDosOcultos(p.id))).toBe('["l1","l2"]');
  });

  it('pasta sem itens limpos: restaurar não inventa nada', async () => {
    const script = scriptDeMentira();
    const p = await criarPasta({ salaId: 'sala-casa', tipo: 'lista', nome: 'Compras', modelo: 'compras' }, { chamar: script.chamar });
    localStorage.removeItem(chaveDosOcultos(p.id));
    const antes = await apagarPasta(p.id);
    await restaurarPasta(antes!);
    expect(localStorage.getItem(chaveDosOcultos(p.id))).toBeNull();
  });

  it('leitura que termina depois de apagar a pasta não recria o cache', async () => {
    const script = scriptDeMentira();
    const p = await criarPasta({ salaId: 'sala-casa', tipo: 'lista', nome: 'Compras', modelo: 'compras' }, { chamar: script.chamar });
    await apagarPasta(p.id);
    const apagada = (await listar('pastas', { comApagados: true })).find((x) => x.id === p.id)!;
    const lida = async () => ({ cabecalho: ['Item', 'id'], linhas: [{ id: 'l1', valores: { Item: 'leite', id: 'l1' } }] });

    await lerPlanilha(apagada, { chamar: lida as never });

    const banco = await openDB('central-planilhas', 1);
    try {
      expect(await banco.getAllKeys('cache')).toEqual([]);
    } finally {
      banco.close();
    }
  });
});

describe('restaurarPasta com a pasta já viva', () => {
  it('não sobrescreve: devolve a que está viva (outro aparelho a restaurou e renomeou)', async () => {
    const script = scriptDeMentira();
    const p = await criarPasta({ salaId: 'sala-casa', tipo: 'lista', nome: 'Compras', modelo: 'compras' }, { chamar: script.chamar });
    const antes = await apagarPasta(p.id);
    await salvar('pastas', { ...antes!, apagado: undefined, nome: 'Compras do mês' });

    const volta = await restaurarPasta(antes!);

    expect(volta.nome).toBe('Compras do mês');
    expect((await listarPastas('sala-casa')).map((x) => x.nome)).toEqual(['Compras do mês']);
  });
});

describe('faltamPadraoDaCasa e o andamento', () => {
  it('é verdade enquanto faltar qualquer padrão, mesmo com outras pastas; falso com as 6 (renomeada também conta)', async () => {
    const script = scriptDeMentira();
    expect(faltamPadraoDaCasa([])).toBe(true);
    await criarPasta({ salaId: 'sala-casa', tipo: 'comum', nome: 'Reformas' }, { chamar: script.chamar });
    expect(faltamPadraoDaCasa(await listarPastas('sala-casa'))).toBe(true);

    const seis = await criarPastasPadraoDaCasa(script.opcoes);
    await renomearPasta(seis[0].id, 'Mercado');
    expect(faltamPadraoDaCasa(await listarPastas('sala-casa'))).toBe(false);

    await apagarPasta(seis[4].id);
    expect(faltamPadraoDaCasa(await listarPastas('sala-casa'))).toBe(true);
  });

  it('aoAndar avisa qual das 6 está sendo criada, só das que faltam', async () => {
    const script = scriptDeMentira();
    const passos: [number, number][] = [];
    await criarPastasPadraoDaCasa({ ...script.opcoes, aoAndar: (n, total) => passos.push([n, total]) });
    expect(passos).toEqual([[1, 6], [2, 6], [3, 6], [4, 6], [5, 6], [6, 6]]);

    const outros: [number, number][] = [];
    await apagarPasta((await listarPastas('sala-casa'))[2].id);
    await criarPastasPadraoDaCasa({ ...script.opcoes, aoAndar: (n, total) => outros.push([n, total]) });
    expect(outros).toEqual([[3, 6]]);
  });
});

describe('criarPastasPadraoDaCasa', () => {
  it('cria as 6 com tipo, modelo, serviço e unidade certos', async () => {
    const script = scriptDeMentira();
    const pastas = await criarPastasPadraoDaCasa(script.opcoes);

    expect(pastas.map((p) => p.nome)).toEqual([
      'Lista de Compras Semanais',
      'Lista de Compras para Casa',
      'Consumo de Água',
      'Consumo de Luz',
      'Consumo de Gás',
      'Financeiro',
    ]);
    expect(pastas.map((p) => [p.tipo, p.modelo, p.servico, p.unidade])).toEqual([
      ['lista', 'compras', undefined, undefined],
      ['lista', 'compras', undefined, undefined],
      ['registro', 'consumo', 'agua', 'm³'],
      ['registro', 'consumo', 'luz', 'kWh'],
      ['registro', 'consumo', 'gas', 'm³'],
      ['planilha', 'financeiro', undefined, undefined],
    ]);
    expect(pastas.every((p) => p.salaId === 'sala-casa')).toBe(true);
    expect(pastas.map((p) => p.ordem)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(new Set(pastas.map((p) => p.planilhaId)).size).toBe(6);
    expect(script.chamadas).toHaveLength(6);
    expect(await listarPastas('sala-casa')).toHaveLength(6);
  });

  it('é idempotente: repetir não cria planilha nem pasta', async () => {
    const script = scriptDeMentira();
    const primeira = await criarPastasPadraoDaCasa(script.opcoes);
    const segunda = await criarPastasPadraoDaCasa(script.opcoes);

    expect(script.chamadas).toHaveLength(6);
    expect(segunda.map((p) => p.id)).toEqual(primeira.map((p) => p.id));
    expect(await listar('pastas')).toHaveLength(6);
  });

  it('só cria as que faltam (pasta do dono com o mesmo nome conta)', async () => {
    const script = scriptDeMentira();
    await criarPasta({ salaId: 'sala-casa', tipo: 'registro', nome: 'consumo de luz', modelo: 'consumo', servico: 'luz', unidade: 'kWh' }, { chamar: script.chamar });
    script.chamadas.length = 0;

    const pastas = await criarPastasPadraoDaCasa(script.opcoes);

    expect(pastas).toHaveLength(6);
    expect(script.chamadas).toHaveLength(5);
    expect(await listar('pastas')).toHaveLength(6);
  });

  it('duas chamadas ao mesmo tempo (duplo toque) criam 6 planilhas, não 12', async () => {
    const script = scriptDeMentira();
    const [a, b] = await Promise.all([criarPastasPadraoDaCasa(script.opcoes), criarPastasPadraoDaCasa(script.opcoes)]);

    expect(script.chamadas).toHaveLength(6);
    expect(b.map((p) => p.id)).toEqual(a.map((p) => p.id));
    expect(await listar('pastas')).toHaveLength(6);
  });

  it('se o script falha no meio, guarda as já criadas; repetir cria só as que faltam', async () => {
    let n = 0;
    let falha = true;
    const chamadas: string[] = [];
    const chamar = (async (_acao: string, dados?: { nome: string }) => {
      if (falha && dados?.nome === 'Consumo de Luz') throw new Error('sem rede');
      chamadas.push(dados!.nome);
      n += 1;
      return { planilhaId: `planilha-teste-${n}` };
    }) as unknown as Chamar;

    await expect(criarPastasPadraoDaCasa({ chamar, sincronizar: async () => 'atualizado' })).rejects.toThrow('sem rede');
    expect((await listarPastas('sala-casa')).map((p) => p.nome)).toEqual(['Lista de Compras Semanais', 'Lista de Compras para Casa', 'Consumo de Água']);

    falha = false;
    const pastas = await criarPastasPadraoDaCasa({ chamar, sincronizar: async () => 'atualizado' });
    expect(pastas).toHaveLength(6);
    expect(chamadas).toEqual(['Lista de Compras Semanais', 'Lista de Compras para Casa', 'Consumo de Água', 'Consumo de Luz', 'Consumo de Gás', 'Financeiro']);
  });

  it('pasta padrão apagada volta a ser criada', async () => {
    const script = scriptDeMentira();
    const antes = await criarPastasPadraoDaCasa(script.opcoes);
    await apagarPasta(antes[5].id);
    const depois = await criarPastasPadraoDaCasa(script.opcoes);
    expect(depois).toHaveLength(6);
    expect(script.chamadas).toHaveLength(7);
    expect(await listar('pastas')).toHaveLength(6);
  });
});

describe('correções da revisão', () => {
  it('pasta padrão renomeada não é sobrescrita nem recriada (planilhaId fica)', async () => {
    const script = scriptDeMentira();
    const antes = await criarPastasPadraoDaCasa(script.opcoes);
    await renomearPasta(antes[5].id, 'Dinheiro');
    script.chamadas.length = 0;

    const depois = await criarPastasPadraoDaCasa(script.opcoes);

    expect(script.chamadas).toEqual([]);
    expect(depois[5]).toMatchObject({ id: antes[5].id, nome: 'Dinheiro', planilhaId: antes[5].planilhaId });
    expect(await listar('pastas')).toHaveLength(6);
  });

  it('comum chamada Financeiro não conta como a pasta padrão', async () => {
    const script = scriptDeMentira();
    await criarPasta({ salaId: 'sala-casa', tipo: 'comum', nome: 'Financeiro' }, { chamar: script.chamar });
    const pastas = await criarPastasPadraoDaCasa(script.opcoes);
    expect(pastas[5]).toMatchObject({ tipo: 'planilha', nome: 'Financeiro' });
    expect(script.chamadas).toHaveLength(6);
  });

  it('sem conseguir sincronizar não cria nada e lança sem_conexao', async () => {
    const script = scriptDeMentira();
    for (const sincronizar of [async () => 'sem-internet' as const, async () => { throw new Error('x'); }]) {
      await expect(criarPastasPadraoDaCasa({ chamar: script.chamar, sincronizar })).rejects.toThrow('sem_conexao');
    }
    expect(script.chamadas).toEqual([]);
    expect(await listar('pastas')).toEqual([]);
  });

  it('entrada parada na fila (por-enviar) não impede criar se a rodada puxou do servidor; sem puxar, lança sem_conexao', async () => {
    const script = scriptDeMentira();
    const parada = async () => 'por-enviar' as const;
    await expect(criarPastasPadraoDaCasa({ chamar: script.chamar, sincronizar: parada, puxou: () => false })).rejects.toThrow('sem_conexao');
    expect(script.chamadas).toEqual([]);
    const seis = await criarPastasPadraoDaCasa({ chamar: script.chamar, sincronizar: parada, puxou: () => true });
    expect(seis).toHaveLength(6);
  });

  it('padrão criadas no aparelho A não são recriadas no B (sincroniza antes)', async () => {
    const notebook = new IDBFactory();
    const celular = new IDBFactory();
    const servidor = servidorDeTeste();
    const sync = () => sincronizar({ chamar: servidor.chamar, esperar: () => Promise.resolve() });
    const a = scriptDeMentira();
    const b = scriptDeMentira();

    globalThis.indexedDB = notebook;
    const criadas = await criarPastasPadraoDaCasa({ chamar: a.chamar, sincronizar: sync });
    await sync();
    globalThis.indexedDB = celular;
    const vistas = await criarPastasPadraoDaCasa({ chamar: b.chamar, sincronizar: sync });

    expect(a.chamadas).toHaveLength(6);
    expect(b.chamadas).toEqual([]);
    expect(vistas.map((p) => p.id)).toEqual(criadas.map((p) => p.id));
  });

  it('salaId fora do formato lança sala_invalida', async () => {
    const script = scriptDeMentira();
    for (const salaId of ['', 'com espaço', 'a'.repeat(65), 'sala/casa']) {
      await expect(criarPasta({ salaId, tipo: 'comum', nome: 'X' }, { chamar: script.chamar })).rejects.toThrow('sala_invalida');
    }
    expect(script.chamadas).toEqual([]);
  });
});

describe('exportar e restaurar', () => {
  it('preservam pastas', async () => {
    const script = scriptDeMentira();
    const pasta = await criarPasta(
      { salaId: 'sala-casa', tipo: 'registro', nome: 'Água', modelo: 'consumo', servico: 'agua', unidade: 'm³', diaDeEnvio: 5, categorias: ['Mercado'] },
      { chamar: script.chamar },
    );
    const copia = await montarCopia();
    expect(copia.colecoes.pastas).toEqual([pasta]);

    await apagar('pastas', pasta.id);
    expect(await restaurarCopia(copia)).toEqual({ restaurados: 1, recusados: 0 });
    expect(await listar('pastas')).toEqual([
      expect.objectContaining({ id: pasta.id, nome: 'Água', planilhaId: 'planilha-teste-1', servico: 'agua', unidade: 'm³', diaDeEnvio: 5, categorias: ['Mercado'] }),
    ]);
  });
});

describe('migração do banco 6 -> 7', () => {
  it('sobe criando pastas sem tocar nos dados existentes', async () => {
    const antigo = await openDB('central-dados', 6, {
      upgrade(banco) {
        for (const c of ['salas', 'pessoas', 'tarefas', 'palavras', 'documentos', 'paginas', 'estadosEmail', 'config', 'eventosFeitos', 'coresDasSalas', 'agua', 'ideias']) {
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

    expect(await listar('pastas')).toEqual([]);
    expect(await listar('ideias')).toEqual([ideia]);
    const script = scriptDeMentira();
    expect((await criarPasta({ salaId: 'sala-casa', tipo: 'comum', nome: 'Depois' }, { chamar: script.chamar })).nome).toBe('Depois');
  });
});

describe('pastas em dois aparelhos', () => {
  it('a pasta criada num aparelho chega ao outro pela sincronia', async () => {
    const notebook = new IDBFactory();
    const celular = new IDBFactory();
    const servidor = servidorDeTeste();
    const sync = () => sincronizar({ chamar: servidor.chamar, esperar: () => Promise.resolve() });
    const script = scriptDeMentira();

    globalThis.indexedDB = notebook;
    const pasta: Pasta = await criarPasta({ salaId: 'sala-casa', tipo: 'lista', nome: 'Compras', modelo: 'compras' }, { chamar: script.chamar });
    expect(await sync()).toBe('atualizado');
    globalThis.indexedDB = celular;
    expect(await sync()).toBe('atualizado');

    expect(await listar('pastas')).toEqual([expect.objectContaining({ id: pasta.id, planilhaId: 'planilha-teste-1' })]);
  });
});
