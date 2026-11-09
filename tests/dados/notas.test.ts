import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apagar, listar, listarPendentes, salvar, semear } from '../../src/dados/loja';
import { NOTAS_NO_MAXIMO, salvarNotas } from '../../src/dados/notas';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-11-05T12:20:00Z'));
  await semear();
});

const sala = async () => (await listar('salas')).find((s) => s.id === 'sala-orientacoes')!;

describe('salvarNotas', () => {
  it('grava as notas na sala, mantém o resto e enfileira para sincronizar', async () => {
    expect(await salvarNotas('salas', 'sala-orientacoes', 'Combinar entregas')).toBe(true);
    expect(await sala()).toMatchObject({ nome: 'Orientações', ordem: 3, notas: 'Combinar entregas' });
    expect(await listarPendentes()).toMatchObject([{ colecao: 'salas', id: 'sala-orientacoes' }]);
  });

  it('grava as notas da pessoa sem tocar nos e-mails dela', async () => {
    const marina = await salvar('pessoas', { nome: 'Marina', salaId: 'sala-orientacoes', emails: ['marina@exemplo.invalid'] });
    await salvarNotas('pessoas', marina.id, 'Prefere terças');
    expect((await listar('pessoas'))[0]).toMatchObject({ nome: 'Marina', emails: ['marina@exemplo.invalid'], notas: 'Prefere terças' });
  });

  it('texto vazio tira o campo do registro', async () => {
    await salvarNotas('salas', 'sala-orientacoes', 'Algo');
    await salvarNotas('salas', 'sala-orientacoes', '');
    expect('notas' in (await sala())).toBe(false);
  });

  it('o mesmo texto não grava de novo (nada novo para sincronizar)', async () => {
    await salvarNotas('salas', 'sala-orientacoes', 'Algo');
    const antes = await sala();
    await salvarNotas('salas', 'sala-orientacoes', 'Algo');
    expect(await sala()).toEqual(antes);
  });

  it('sala apagada ou que não existe: false, nada gravado', async () => {
    expect(await salvarNotas('salas', 'nao-existe', 'x')).toBe(false);
    await apagar('salas', 'sala-casa');
    expect(await salvarNotas('salas', 'sala-casa', 'x')).toBe(false);
  });

  it('corta o que passa do teto, para uma colagem enorme não pesar o arquivo do Drive', async () => {
    await salvarNotas('salas', 'sala-orientacoes', 'a'.repeat(NOTAS_NO_MAXIMO + 50));
    expect((await sala()).notas).toHaveLength(NOTAS_NO_MAXIMO);
  });
});
