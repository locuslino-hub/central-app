// A primeira página das Notas de uma pasta comum nasce sozinha, com id fixo. Nomes fictícios.
import { beforeEach, describe, expect, it } from 'vitest';
import { criarPagina, garantirPaginaDaPasta } from '../../src/dados/caderno';
import { apagar, gravarDoServidor, listar, listarAvisos, semear } from '../../src/dados/loja';

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

  it('a página automática perde para o texto de outro aparelho, sem aviso de conflito', async () => {
    await garantirPaginaDaPasta(SALA, PASTA);
    const remota = {
      id: 'nota-pasta-metodologia', salaId: SALA, pastaId: PASTA, titulo: 'Notas',
      blocos: [{ id: 'b-1', tipo: 'texto', texto: 'Conversar com o Prof. Souza' }],
      atualizadoEm: Date.now() - 60_000, aparelho: 'outro',
    };
    await gravarDoServidor([{ colecao: 'paginas', registro: remota }]);
    const [pagina] = await daPasta();
    expect(pagina.blocos.map((b) => b.texto)).toEqual(['Conversar com o Prof. Souza']);
    expect(await listarAvisos()).toEqual([]);
  });

  it('a página automática perde para a exclusão feita noutro aparelho', async () => {
    await garantirPaginaDaPasta(SALA, PASTA);
    await gravarDoServidor([
      {
        colecao: 'paginas',
        registro: { id: 'nota-pasta-metodologia', salaId: SALA, pastaId: PASTA, titulo: 'Notas', blocos: [], apagado: true, atualizadoEm: Date.now() - 60_000, aparelho: 'outro' },
      },
    ]);
    expect(await daPasta()).toHaveLength(0);
  });

  it('duas páginas automáticas são iguais (mesmo bloco)', async () => {
    const a = await garantirPaginaDaPasta(SALA, PASTA);
    expect(a?.blocos[0].id).toBe('nota-pasta-metodologia-1');
  });

  it('não ressuscita a página apagada', async () => {
    await garantirPaginaDaPasta(SALA, PASTA);
    await apagar('paginas', 'nota-pasta-metodologia');
    expect(await garantirPaginaDaPasta(SALA, PASTA)).toBeUndefined();
    expect(await daPasta()).toHaveLength(0);
  });
});
