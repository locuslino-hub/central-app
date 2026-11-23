// A primeira página das Notas de uma pasta comum nasce sozinha, com id fixo. Nomes fictícios.
import { beforeEach, describe, expect, it } from 'vitest';
import { criarPagina, garantirPaginaDaPasta } from '../../src/dados/caderno';
import { apagar, listar, semear } from '../../src/dados/loja';

beforeEach(async () => {
  await semear();
});

const SALA = 'sala-doutoramento';
const PASTA = 'pasta-metodologia';
const daPasta = async () => (await listar('paginas')).filter((p) => p.pastaId === PASTA && !p.apagado);

describe('garantirPaginaDaPasta', () => {
  it('cria a página Notas com id fixo', async () => {
    const pagina = await garantirPaginaDaPasta(SALA, PASTA);
    expect(pagina?.id).toBe('nota-pasta-metodologia');
    expect(pagina?.titulo).toBe('Notas');
    expect(pagina?.pastaId).toBe(PASTA);
    expect(pagina?.salaId).toBe(SALA);
    expect(pagina?.blocos).toHaveLength(1);
    expect(pagina?.blocos[0]).toMatchObject({ tipo: 'texto', texto: '' });
  });

  it('duas chamadas ao mesmo tempo dão uma página', async () => {
    await Promise.all([garantirPaginaDaPasta(SALA, PASTA), garantirPaginaDaPasta(SALA, PASTA)]);
    expect(await daPasta()).toHaveLength(1);
  });

  it('não cria se a pasta já tem página', async () => {
    await criarPagina(SALA, 'Rascunho', PASTA);
    expect(await garantirPaginaDaPasta(SALA, PASTA)).toBeUndefined();
    expect(await daPasta()).toHaveLength(1);
  });

  it('não ressuscita a página apagada', async () => {
    await garantirPaginaDaPasta(SALA, PASTA);
    await apagar('paginas', 'nota-pasta-metodologia');
    expect(await garantirPaginaDaPasta(SALA, PASTA)).toBeUndefined();
    expect(await daPasta()).toHaveLength(0);
  });
});
