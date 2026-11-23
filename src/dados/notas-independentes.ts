// Notas independentes (texto e lista) de uma sala ou de uma subpasta comum: coleção própria `notas`, um registro por
// nota, com data de criação. Sincroniza como as outras; vale a gravação mais recente de cada nota.
//
// Também traz a migração, uma vez por sala e por subpasta, do que existia antes: o campo único de notas da sala e a
// página "Notas" automática da subpasta (v0.2.3). Nada é apagado do dado antigo da sala (só deixa de aparecer).
import { NOTA_ITEM_TEXTO_NO_MAXIMO, NOTA_ITENS_NO_MAXIMO, NOTA_TEXTO_NO_MAXIMO, ID_VALIDO } from '../../script/colecoes';
import { apagar, lerRegistros, salvar } from './loja';
import type { ItemDeNota, Nota, ParaSalvar, Pagina, Sala } from './tipos';

export const NOTA_NO_MAXIMO = NOTA_TEXTO_NO_MAXIMO;
export const ITENS_NO_MAXIMO = NOTA_ITENS_NO_MAXIMO;
export const ITEM_NO_MAXIMO = NOTA_ITEM_TEXTO_NO_MAXIMO;
/** Texto vazio, ou lista sem nenhum item com texto: a nota não é gravada. */
export const NOTA_VAZIA = 'nota_vazia';
export const NOTA_NAO_ENCONTRADA = 'nota_nao_encontrada';

export type DadosDeNota = {
  salaId: string;
  /** A subpasta comum da nota; sem ele, é nota da sala. */
  pastaId?: string;
  tipo: 'texto' | 'lista';
  texto?: string;
  itens?: ItemDeNota[];
};

/** Texto da nota cortado no teto; `undefined` se não sobra nada além de espaço. */
function textoLimpo(texto: string | undefined): string | undefined {
  if (typeof texto !== 'string' || texto.trim() === '') return undefined;
  return texto.slice(0, NOTA_NO_MAXIMO);
}

/**
 * Itens prontos para gravar: sem os vazios, com id válido e único (o que não tem ganha um), texto cortado, no máximo
 * 200. `feito` só vai quando verdadeiro. `undefined` se não sobra item nenhum.
 */
function itensLimpos(itens: readonly ItemDeNota[] | undefined): ItemDeNota[] | undefined {
  if (!Array.isArray(itens)) return undefined;
  const usados = new Set<string>();
  const limpos: ItemDeNota[] = [];
  for (const item of itens) {
    const texto = typeof item?.texto === 'string' ? item.texto.trim().slice(0, ITEM_NO_MAXIMO) : '';
    if (texto === '') continue;
    if (limpos.length >= ITENS_NO_MAXIMO) break;
    let id = typeof item.id === 'string' && ID_VALIDO.test(item.id) && !usados.has(item.id) ? item.id : crypto.randomUUID();
    while (usados.has(id)) id = crypto.randomUUID();
    usados.add(id);
    limpos.push(item.feito === true ? { id, texto, feito: true } : { id, texto });
  }
  return limpos.length > 0 ? limpos : undefined;
}

// Uma fila por nota: marcar um item, editar e apagar não se cruzam (cada um relê a nota antes de gravar).
const filas = new Map<string, Promise<unknown>>();

function naFila<T>(id: string, tarefa: () => Promise<T>): Promise<T> {
  const anterior = filas.get(id) ?? Promise.resolve();
  const atual = anterior.then(tarefa, tarefa);
  const guardada = atual.catch(() => {});
  filas.set(id, guardada);
  void guardada.then(() => {
    if (filas.get(id) === guardada) filas.delete(id);
  });
  return atual;
}

async function lerNota(id: string): Promise<Nota | undefined> {
  const [lido] = await lerRegistros([{ colecao: 'notas', id }]);
  return lido && !lido.apagado ? (lido as Nota) : undefined;
}

/**
 * Cria a nota, com a hora de agora como data de criação. Lança `nota_vazia` (e nada é gravado) se o texto está vazio
 * ou a lista não tem item com texto; o que passa dos limites (20 000 caracteres, 200 itens, 500 por item) é cortado.
 */
export async function criarNota(dados: DadosDeNota): Promise<Nota> {
  const nova: ParaSalvar<Nota> = { salaId: dados.salaId, tipo: dados.tipo, criadaEm: Date.now() };
  if (dados.pastaId) nova.pastaId = dados.pastaId;
  if (dados.tipo === 'lista') {
    const itens = itensLimpos(dados.itens);
    if (!itens) throw new Error(NOTA_VAZIA);
    nova.itens = itens;
  } else {
    const texto = textoLimpo(dados.texto);
    if (texto === undefined) throw new Error(NOTA_VAZIA);
    nova.texto = texto;
  }
  return salvar('notas', nova);
}

/**
 * Troca o texto (nota de texto) ou os itens (nota de lista), relendo a nota antes de gravar: a sala, a subpasta e a
 * data de criação não mudam. `nota_nao_encontrada` se ela não existe mais; `nota_vazia` (nada muda) se ficaria vazia.
 */
export function editarNota(id: string, mudanca: { texto?: string; itens?: ItemDeNota[] }): Promise<Nota> {
  return naFila(id, async () => {
    const atual = await lerNota(id);
    if (!atual) throw new Error(NOTA_NAO_ENCONTRADA);
    if (atual.tipo === 'lista') {
      if (mudanca.itens === undefined) return atual;
      const itens = itensLimpos(mudanca.itens);
      if (!itens) throw new Error(NOTA_VAZIA);
      if (JSON.stringify(itens) === JSON.stringify(atual.itens)) return atual;
      return salvar('notas', { ...atual, itens });
    }
    if (mudanca.texto === undefined) return atual;
    const texto = textoLimpo(mudanca.texto);
    if (texto === undefined) throw new Error(NOTA_VAZIA);
    if (texto === atual.texto) return atual;
    return salvar('notas', { ...atual, texto });
  });
}

/**
 * Marca ou desmarca um item de uma lista, lendo a nota de novo antes de gravar: o texto dos outros itens que mudou em
 * outro lugar não é regravado por uma cópia velha. `nota_nao_encontrada` se a nota ou o item não existe.
 */
export function marcarItem(id: string, itemId: string, feito: boolean): Promise<Nota> {
  return naFila(id, async () => {
    const atual = await lerNota(id);
    const item = atual?.itens?.find((i) => i.id === itemId);
    if (!atual || !item) throw new Error(NOTA_NAO_ENCONTRADA);
    if (!!item.feito === feito) return atual;
    const itens = atual.itens!.map((i): ItemDeNota => {
      if (i.id !== itemId) return i;
      const { feito: _antes, ...resto } = i;
      return feito ? { ...resto, feito: true } : resto;
    });
    return salvar('notas', { ...atual, itens });
  });
}

/** Apaga (lápide). Devolve a nota como era, para o Desfazer (`restaurarNota`); `undefined` se não havia. */
export function apagarNota(id: string): Promise<Nota | undefined> {
  return naFila(id, () => apagar('notas', id));
}

/** Desfaz `apagarNota`: grava de novo a nota, com o mesmo id, a mesma data de criação e o mesmo conteúdo. */
export function restaurarNota(nota: Nota): Promise<Nota> {
  const { apagado: _apagado, ...viva } = nota;
  return naFila(nota.id, () => salvar('notas', viva as ParaSalvar<Nota>));
}

// ---- Migração do que existia antes ----

// A mesma migração pedida de novo enquanto anda (duas telas abertas, ou o quadro remontado) espera a primeira.
const migrando = new Map<string, Promise<void>>();

function umaVez(chave: string, migrar: () => Promise<void>): Promise<void> {
  const andando = migrando.get(chave);
  if (andando) return andando;
  const feita = migrar().finally(() => migrando.delete(chave));
  migrando.set(chave, feita);
  return feita;
}

/** O id da nota que nasceu do texto antigo das notas da sala. */
export const idDaNotaAntiga = (salaId: string) => `nota-antiga-${salaId}`;
/** O id da nota que nasceu da página "Notas" automática da subpasta. */
export const idDaNotaDaPagina = (pastaId: string) => `nota-pagina-${pastaId}`;

/**
 * O texto antigo das notas da sala (campo único) vira uma nota de texto, com a data da última mudança da sala. Uma vez
 * só: se o id fixo já existe (nota viva ou apagada pelo dono), não faz nada. O campo `notas` da sala não é apagado.
 * Grava com carimbo automático: perde para qualquer versão desta nota que já exista em outro aparelho.
 */
export function migrarNotasAntigas(salaId: string): Promise<void> {
  return umaVez(`sala:${salaId}`, async () => {
    const id = idDaNotaAntiga(salaId);
    const [sala, existente] = await lerRegistros([
      { colecao: 'salas', id: salaId },
      { colecao: 'notas', id },
    ]);
    if (existente || !sala || sala.apagado) return;
    const texto = textoLimpo((sala as Sala).notas);
    if (texto === undefined) return;
    await salvar('notas', { id, salaId, tipo: 'texto', texto, criadaEm: sala.atualizadoEm }, { automatico: true });
  });
}

/**
 * A página "Notas" que a v0.2.3 criava sozinha na subpasta (id `nota-<pastaId>`): se tem texto, vira uma nota de texto
 * (as linhas unidas por quebra de linha, a data da última mudança da página) e a página é apagada; se está vazia, só
 * é apagada. Se a nota já existe (viva ou apagada pelo dono), nada é criado de novo e a página só sai. Outras páginas
 * da subpasta não mudam.
 */
export function migrarPaginaDaPasta(salaId: string, pastaId: string): Promise<void> {
  return umaVez(`pasta:${pastaId}`, async () => {
    const paginaId = `nota-${pastaId}`;
    const [pagina] = await lerRegistros([{ colecao: 'paginas', id: paginaId }]);
    if (!pagina || pagina.apagado) return;
    const linhas = (pagina as Pagina).blocos.filter((b) => b.tipo !== 'painel').map((b) => b.texto ?? '');
    const texto = textoLimpo(linhas.join('\n').trim());
    if (texto !== undefined) {
      const id = idDaNotaDaPagina(pastaId);
      const [existente] = await lerRegistros([{ colecao: 'notas', id }]);
      if (!existente) await salvar('notas', { id, salaId, pastaId, tipo: 'texto', texto, criadaEm: pagina.atualizadoEm }, { automatico: true });
    }
    await apagar('paginas', paginaId);
  });
}
