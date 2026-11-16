// C-05: página grande demais para o lote do script não é gravada. Nomes fictícios.
import { beforeEach, describe, expect, it } from 'vitest';
import { criarPagina, gravarBlocos, novoBloco, PAGINA_NO_MAXIMO } from '../../src/dados/caderno';
import { lerRegistros, listarPendentes, semear } from '../../src/dados/loja';
import type { Pagina } from '../../src/dados/tipos';

beforeEach(async () => {
  await semear();
});

const guardada = async (id: string) => (await lerRegistros([{ colecao: 'paginas', id }]))[0] as Pagina;
const blocosGrandes = (n: number) => Array.from({ length: n }, () => novoBloco('texto', 'a'.repeat(2000)));

describe('limite do tamanho da página do caderno', () => {
  it('o limite fica abaixo do lote de envio', () => {
    expect(PAGINA_NO_MAXIMO).toBe(200_000);
  });

  it('página dentro do limite grava', async () => {
    const pagina = await criarPagina('sala-mba', 'Reunião da Aurora');
    expect(await gravarBlocos(pagina.id, blocosGrandes(50))).toBe(true);
    expect((await guardada(pagina.id)).blocos).toHaveLength(50);
  });

  it('página acima do limite não grava e devolve "grande-demais"', async () => {
    const pagina = await criarPagina('sala-mba', 'Reunião da Aurora');
    const antes = await guardada(pagina.id);
    const filaAntes = (await listarPendentes()).length;

    expect(await gravarBlocos(pagina.id, blocosGrandes(120))).toBe('grande-demais');

    expect((await guardada(pagina.id)).blocos).toEqual(antes.blocos);
    expect(await listarPendentes()).toHaveLength(filaAntes);
  });
});
