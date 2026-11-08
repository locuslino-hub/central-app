import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { criarDesfazer } from '../../src/dados/desfazer';
import {
  apagar,
  assinar,
  lerConfig,
  listar,
  listarPendentes,
  salvar,
  semear,
} from '../../src/dados/loja';
import type { Colecao, Mudanca, ParaSalvar, Tarefa } from '../../src/dados/tipos';

// Relógio fixo: quinta, 2026-11-05, 12:20 em Lisboa (WET = UTC em novembro).
const AGORA = new Date('2026-11-05T12:20:00Z').getTime();
const CINCO_MIN = 5 * 60 * 1000;

function tarefa(titulo: string, extra: Partial<ParaSalvar<Tarefa>> = {}): ParaSalvar<Tarefa> {
  return {
    titulo,
    salaId: null,
    duracaoMin: 60,
    duracaoConfirmada: false,
    feito: false,
    fixada: false,
    marcar: false,
    ...extra,
  };
}

// Os ouvintes vivem no módulo da loja: cancelar ao fim de cada teste, mesmo se ele falhar.
function ouvir(ouvinte: (mudanca: Mudanca) => void) {
  const cancelar = assinar(ouvinte);
  onTestFinished(cancelar);
  return cancelar;
}

beforeEach(() => {
  // Só o Date é falso: o fake-indexeddb agenda trabalho com timers reais.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AGORA);
});

describe('salvar', () => {
  it('carimba a hora atual e o aparelho, gera id e o registro aparece em listar', async () => {
    const salva = await salvar('tarefas', tarefa('Ler capítulo com Marina'));

    expect(salva.id).toMatch(/\S/);
    expect(salva.atualizadoEm).toBe(AGORA);
    expect(salva.aparelho).toMatch(/\S/);
    expect(await listar('tarefas')).toEqual([salva]);
  });

  it('salvar de novo substitui o registro e troca atualizadoEm pela hora nova', async () => {
    const primeira = await salvar('tarefas', tarefa('Ler capítulo com Marina'));
    vi.setSystemTime(AGORA + CINCO_MIN);

    await salvar('tarefas', { ...primeira, titulo: 'Reler capítulo com Marina' });

    const lista = await listar('tarefas');
    expect(lista).toHaveLength(1);
    expect(lista[0].titulo).toBe('Reler capítulo com Marina');
    expect(lista[0].atualizadoEm).toBe(AGORA + CINCO_MIN);
  });

  it('ignora carimbo e aparelho vindos no registro', async () => {
    const minha = await salvar('tarefas', tarefa('Corrigir provas'));

    const salva = await salvar(
      'tarefas',
      tarefa('Enviar notas', { atualizadoEm: 1, aparelho: 'aparelho-de-outro' }),
    );

    expect(salva.atualizadoEm).toBe(AGORA);
    expect(salva.aparelho).toBe(minha.aparelho);
  });

  it('o aparelho é o mesmo em todas as escritas, mesmo nas primeiras simultâneas', async () => {
    const [a, b] = await Promise.all([
      salvar('tarefas', tarefa('Revisar artigo')),
      salvar('salas', { nome: 'Aurora', ordem: 9 }),
    ]);
    const c = await salvar('rascunhos', { texto: 'ligar para Renata' });

    expect(b.aparelho).toBe(a.aparelho);
    expect(c.aparelho).toBe(a.aparelho);
  });

  it('o aparelho não fica guardado junto das coleções', async () => {
    const salva = await salvar('tarefas', tarefa('Revisar artigo'));
    const colecoes = await Promise.all(
      (['salas', 'pessoas', 'palavras', 'documentos', 'paginas', 'estadosEmail', 'rascunhos', 'config'] as const).map(
        (colecao) => listar(colecao, { comApagados: true }),
      ),
    );
    expect(colecoes.flat()).toEqual([]);
    expect(await listar('tarefas', { comApagados: true })).toEqual([salva]);
  });

  it('cria um pendente com a coleção e o id', async () => {
    const salva = await salvar('tarefas', tarefa('Ler capítulo com Marina'));

    expect(await listarPendentes()).toEqual([
      { seq: expect.any(Number), tipo: 'registro', colecao: 'tarefas', id: salva.id },
    ]);
  });

  it('cada escrita acrescenta um pendente, na ordem das escritas', async () => {
    const a = await salvar('tarefas', tarefa('A'));
    const b = await salvar('pessoas', { nome: 'Prof. Souza', salaId: 'sala-orientacoes' });
    await salvar('tarefas', { ...a, feito: true });

    const pendentes = await listarPendentes();
    expect(pendentes.map((p) => [p.colecao, p.id])).toEqual([
      ['tarefas', a.id],
      ['pessoas', b.id],
      ['tarefas', a.id],
    ]);
    const seqs = pendentes.map((p) => p.seq);
    expect([...seqs].sort((x, y) => x - y)).toEqual(seqs);
    expect(new Set(seqs).size).toBe(3);
  });

  it('rascunhos, config e adiadaAte de e-mail entram em pendentes como o resto', async () => {
    const rascunho = await salvar('rascunhos', { texto: 'pedir parecer ao Prof. Souza', salaId: null });
    const config = await salvar('config', { id: 'geral', fimDoDia: '21:00' });
    const email = await salvar('estadosEmail', { id: 'email-ficticio-1', feito: false, adiadaAte: '2026-11-06' });

    expect((await listarPendentes()).map((p) => [p.colecao, p.id])).toEqual([
      ['rascunhos', rascunho.id],
      ['config', 'geral'],
      ['estadosEmail', email.id],
    ]);
    expect(config.atualizadoEm).toBe(AGORA);
    expect((await listar('estadosEmail'))[0].adiadaAte).toBe('2026-11-06');
  });

  const TODAS: [Colecao, Record<string, unknown>][] = [
    ['salas', { nome: 'Aurora', ordem: 8, notas: 'projeto novo' }],
    ['pessoas', { nome: 'Renata', salaId: 'sala-aulas', papel: 'monitora', emails: ['renata@exemplo.invalid'] }],
    ['tarefas', tarefa('Planejar aula', { data: '2026-11-06', prazoHora: '10:00' })],
    ['palavras', { termo: 'banca', salaId: 'sala-doutoramento' }],
    ['documentos', { titulo: 'Plano', url: 'https://exemplo.invalid/plano', arquivado: false }],
    ['paginas', { salaId: 'sala-aulas', titulo: 'Notas', blocos: [{ id: 'b1', tipo: 'painel', painel: 'agenda' }] }],
    ['estadosEmail', { feito: true }],
    ['rascunhos', { texto: 'rascunho' }],
    ['config', { fimDoDia: '19:30' }],
  ];
  it.each(TODAS)('guarda e lista registros de %s', async (colecao, registro) => {
    const salva = await salvar(colecao, registro as never);
    expect(await listar(colecao)).toEqual([salva]);
    expect(salva).toMatchObject(registro);
  });
});

describe('apagar', () => {
  it('esconde o registro de listar, sem esconder os outros', async () => {
    const fica = await salvar('tarefas', tarefa('Fica'));
    const sai = await salvar('tarefas', tarefa('Sai'));

    await apagar('tarefas', sai.id);

    expect(await listar('tarefas')).toEqual([fica]);
  });

  it('deixa lápide com apagado, hora nova e um pendente', async () => {
    const salva = await salvar('tarefas', tarefa('Sai'));
    vi.setSystemTime(AGORA + CINCO_MIN);

    await apagar('tarefas', salva.id);

    expect(await listar('tarefas', { comApagados: true })).toEqual([
      { ...salva, apagado: true, atualizadoEm: AGORA + CINCO_MIN },
    ]);
    expect((await listarPendentes()).map((p) => [p.colecao, p.id])).toEqual([
      ['tarefas', salva.id],
      ['tarefas', salva.id],
    ]);
  });

  it('devolve o registro como era antes de apagar', async () => {
    const salva = await salvar('tarefas', tarefa('Sai'));
    expect(await apagar('tarefas', salva.id)).toEqual(salva);
  });

  it('apagar de novo um registro já apagado não mexe na lápide nem cria pendente', async () => {
    const salva = await salvar('tarefas', tarefa('Sai'));
    await apagar('tarefas', salva.id);
    const lapide = await listar('tarefas', { comApagados: true });
    vi.setSystemTime(AGORA + CINCO_MIN);

    expect(await apagar('tarefas', salva.id)).toBeUndefined();

    expect(await listar('tarefas', { comApagados: true })).toEqual(lapide);
    expect(await listarPendentes()).toHaveLength(2);
  });

  it('id inexistente não grava nada nem cria pendente', async () => {
    expect(await apagar('tarefas', 'nao-existe')).toBeUndefined();
    expect(await listar('tarefas', { comApagados: true })).toEqual([]);
    expect(await listarPendentes()).toEqual([]);
  });
});

describe('assinar', () => {
  it('avisa o ouvinte depois de salvar e de apagar, com coleção e id', async () => {
    const recebidas: Mudanca[] = [];
    ouvir((mudanca) => recebidas.push(mudanca));

    const salva = await salvar('tarefas', tarefa('Revisar artigo'));
    await apagar('tarefas', salva.id);

    expect(recebidas).toEqual([
      { colecao: 'tarefas', id: salva.id },
      { colecao: 'tarefas', id: salva.id },
    ]);
  });

  it('quando o ouvinte é chamado, a escrita já está gravada', async () => {
    let vista: Promise<string[]> | undefined;
    ouvir(() => {
      vista = listar('tarefas').then((lista) => lista.map((t) => t.titulo));
    });

    await salvar('tarefas', tarefa('Revisar artigo'));

    expect(await vista).toEqual(['Revisar artigo']);
  });

  it('a função devolvida cancela a assinatura', async () => {
    const ouvinte = vi.fn();
    const cancelar = assinar(ouvinte);
    cancelar();

    await salvar('tarefas', tarefa('Revisar artigo'));

    expect(ouvinte).not.toHaveBeenCalled();
  });

  it('ouvinte que falha não impede os outros nem a escrita', async () => {
    const outro = vi.fn();
    ouvir(() => {
      throw new Error('ouvinte com defeito');
    });
    ouvir(outro);
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});

    const salva = await salvar('tarefas', tarefa('Revisar artigo'));

    expect(outro).toHaveBeenCalledWith({ colecao: 'tarefas', id: salva.id });
    expect(await listar('tarefas')).toEqual([salva]);
    expect(erro).toHaveBeenCalled();
  });

  it('apagar id inexistente não avisa', async () => {
    const ouvinte = vi.fn();
    ouvir(ouvinte);

    await apagar('tarefas', 'nao-existe');

    expect(ouvinte).not.toHaveBeenCalled();
  });
});

describe('desfazer', () => {
  it('sem nada registrado, ultimo é undefined', () => {
    expect(criarDesfazer().ultimo()).toBeUndefined();
  });

  it('apagar e desfazer traz o registro de volta em listar, com hora mais nova que a lápide', async () => {
    const pilha = criarDesfazer();
    const salva = await salvar('tarefas', tarefa('Ligar para Renata'));
    vi.setSystemTime(AGORA + CINCO_MIN);
    const antes = await apagar('tarefas', salva.id);
    pilha.registrar('Tarefa apagada', async () => {
      await salvar('tarefas', antes!);
    });
    vi.setSystemTime(AGORA + 2 * CINCO_MIN);

    const ultimo = pilha.ultimo();
    expect(ultimo?.rotulo).toBe('Tarefa apagada');
    await ultimo!.reverter();

    const lista = await listar('tarefas');
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ id: salva.id, titulo: 'Ligar para Renata' });
    expect(lista[0].apagado).toBeFalsy();
    expect(lista[0].atualizadoEm).toBe(AGORA + 2 * CINCO_MIN);
  });

  it('desfazer o último deixa o anterior como último', async () => {
    const pilha = criarDesfazer();
    const feitos: string[] = [];
    pilha.registrar('primeiro', () => {
      feitos.push('primeiro');
    });
    pilha.registrar('segundo', () => {
      feitos.push('segundo');
    });

    await pilha.ultimo()!.reverter();

    expect(feitos).toEqual(['segundo']);
    expect(pilha.ultimo()?.rotulo).toBe('primeiro');
    await pilha.ultimo()!.reverter();
    expect(feitos).toEqual(['segundo', 'primeiro']);
    expect(pilha.ultimo()).toBeUndefined();
  });

  it('reverter a mesma entrada duas vezes só desfaz uma vez', async () => {
    const pilha = criarDesfazer();
    const reverter = vi.fn();
    pilha.registrar('primeiro', () => {});
    pilha.registrar('segundo', reverter);

    const ultimo = pilha.ultimo()!;
    await ultimo.reverter();
    await ultimo.reverter();

    expect(reverter).toHaveBeenCalledTimes(1);
    expect(pilha.ultimo()?.rotulo).toBe('primeiro');
  });

  it('pilhas criadas à parte não se misturam', () => {
    const a = criarDesfazer();
    a.registrar('de a', () => {});
    expect(criarDesfazer().ultimo()).toBeUndefined();
  });
});

describe('semear', () => {
  const SALAS = ['Doutoramento', 'Investigação', 'Aulas', 'Orientações', 'MBA', 'Pessoal', 'Casa'];

  async function nomesNaOrdem() {
    const salas = await listar('salas');
    return [...salas].sort((a, b) => a.ordem - b.ordem).map((sala) => sala.nome);
  }

  it('cria as 7 salas na ordem da spec', async () => {
    await semear();

    expect(await nomesNaOrdem()).toEqual(SALAS);
    const ordens = (await listar('salas')).map((sala) => sala.ordem);
    expect(new Set(ordens).size).toBe(7);
  });

  it('rodar duas vezes não duplica', async () => {
    await semear();
    await semear();

    expect(await listar('salas')).toHaveLength(7);
  });

  it('não ressuscita sala apagada nem desfaz renomeação', async () => {
    await semear();
    const salas = await listar('salas');
    const casa = salas.find((sala) => sala.nome === 'Casa')!;
    const pessoal = salas.find((sala) => sala.nome === 'Pessoal')!;
    await apagar('salas', casa.id);
    await salvar('salas', { ...pessoal, nome: 'Vida pessoal' });

    await semear();

    const nomes = (await listar('salas')).map((sala) => sala.nome);
    expect(nomes).not.toContain('Casa');
    expect(nomes).not.toContain('Pessoal');
    expect(nomes).toContain('Vida pessoal');
    expect(nomes).toHaveLength(6);
  });

  it('dois aparelhos semeiam os mesmos ids, para a sincronia não duplicar salas', async () => {
    await semear();
    const idsNoNotebook = (await listar('salas')).map((sala) => sala.id).sort();
    globalThis.indexedDB = new IDBFactory();

    await semear();

    expect((await listar('salas')).map((sala) => sala.id).sort()).toEqual(idsNoNotebook);
  });

  it('salas semeadas têm atualizadoEm 0 e não geram pendentes, para perder de qualquer edição real', async () => {
    await semear();

    expect((await listar('salas')).map((sala) => sala.atualizadoEm)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(await listarPendentes()).toEqual([]);
  });

  it('avisa os ouvintes só das salas que criou', async () => {
    const mudancas: Mudanca[] = [];
    ouvir((mudanca) => mudancas.push(mudanca));

    await semear();

    expect(mudancas).toHaveLength(7);
    expect(mudancas.every((mudanca) => mudanca.colecao === 'salas')).toBe(true);
    mudancas.length = 0;
    await semear();
    expect(mudancas).toEqual([]);
  });

  it('não traz o link nem documentos do MBA (Tarefa 18)', async () => {
    await semear();

    expect(await listar('documentos')).toEqual([]);
  });
});

describe('lerConfig', () => {
  it('sem config salva, o fim do dia é 20:00', async () => {
    expect((await lerConfig()).fimDoDia).toBe('20:00');
  });

  it('config apagada volta ao padrão', async () => {
    await salvar('config', { ...(await lerConfig()), fimDoDia: '21:30' });
    await apagar('config', 'geral');

    expect((await lerConfig()).fimDoDia).toBe('20:00');
  });

  it('devolve o fim do dia salvo', async () => {
    const atual = await lerConfig();
    await salvar('config', { ...atual, fimDoDia: '21:30' });

    expect((await lerConfig()).fimDoDia).toBe('21:30');
    expect(await listar('config')).toHaveLength(1);
  });
});
