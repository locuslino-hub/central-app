// Notas independentes (texto e lista) de uma sala ou de uma subpasta comum: coleção própria `notas`, um registro por
// nota, com data de criação. Sincroniza como as outras; vale a gravação mais recente de cada nota.
//
// Também traz a migração, por versão, do que existia antes: o campo único de notas da sala e a página "Notas"
// automática da subpasta (v0.2.3). A migração nunca apaga nem muda o dado antigo (só deixa de aparecer na tela).
import { NOTA_ITEM_TEXTO_NO_MAXIMO, NOTA_ITENS_NO_MAXIMO, NOTA_TEXTO_NO_MAXIMO, ID_VALIDO } from '../../script/colecoes';
import { apagar, lerRegistros, listar, salvar } from './loja';
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
 * Troca o texto (nota de texto) ou os itens (nota de lista), relendo a nota antes de gravar: a sala, a subpasta, a
 * data de criação e a marca (`feito`) de cada item não mudam (a marca só muda por `marcarItem`). `nota_nao_encontrada` se ela não existe mais; `nota_vazia` (nada muda) se ficaria vazia.
 */
export function editarNota(id: string, mudanca: { texto?: string; itens?: ItemDeNota[] }): Promise<Nota> {
  return naFila(id, async () => {
    const atual = await lerNota(id);
    if (!atual) throw new Error(NOTA_NAO_ENCONTRADA);
    if (atual.tipo === 'lista') {
      if (mudanca.itens === undefined) return atual;
      // O formulário nunca muda a marca: ela vem da nota relida agora (por id do item); item novo começa sem marca.
      const marcados = new Set((atual.itens ?? []).filter((i) => i.feito).map((i) => i.id));
      const itens = itensLimpos(mudanca.itens.map(({ id, texto }): ItemDeNota => (marcados.has(id) ? { id, texto, feito: true } : { id, texto })));
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

/** Id curto o bastante (até 64 caracteres, o que o script aceita): se a chave não cabe, entra um resumo dela. */
function idDaMigracao(prefixo: string, chave: string, versao: number, parte?: number): string {
  const fim = `-${versao}${parte === undefined ? '' : `-${parte}`}`;
  if (prefixo.length + chave.length + fim.length <= 64) return `${prefixo}${chave}${fim}`;
  let resumo = 0;
  for (const letra of chave) resumo = (Math.imul(resumo, 31) + letra.charCodeAt(0)) >>> 0;
  return `${prefixo}${chave.slice(0, 20)}-${resumo.toString(36)}${fim}`;
}

/** O id da nota que nasceu do texto antigo das notas da sala, nessa versão da sala (`atualizadoEm`). */
export const idDaNotaAntiga = (salaId: string, versao: number, parte?: number) => idDaMigracao('nota-antiga-', salaId, versao, parte);
/** O id da nota que nasceu da página "Notas" automática da subpasta, nessa versão da página. */
export const idDaNotaDaPagina = (pastaId: string, versao: number, parte?: number) => idDaMigracao('nota-pagina-', pastaId, versao, parte);

/** Quebra o texto em partes de até 20 000 caracteres (de preferência numa quebra de linha), sem perder nada. */
function emPartes(texto: string): string[] {
  const partes: string[] = [];
  let resto = texto;
  while (resto.length > NOTA_NO_MAXIMO) {
    const quebra = resto.lastIndexOf('\n', NOTA_NO_MAXIMO - 1);
    const corte = quebra > NOTA_NO_MAXIMO / 2 ? quebra + 1 : NOTA_NO_MAXIMO;
    partes.push(resto.slice(0, corte));
    resto = resto.slice(corte);
  }
  if (resto !== '') partes.push(resto);
  return partes.filter((parte) => parte.trim() !== '');
}

/**
 * Grava o texto de uma versão antiga como nota(s) de texto, com ids que dependem da versão (`idDe(parte)`): o mesmo
 * texto dá sempre os mesmos ids, então dois aparelhos que migram a mesma versão gravam o mesmo registro, e versões
 * diferentes viram notas diferentes (nada é sobrescrito). Não cria nada se o texto é vazio, se o id já existe (viva ou
 * apagada pelo dono) ou se uma nota do mesmo lugar (viva ou apagada) já tem exatamente esse texto. Texto de mais de
 * 20 000 caracteres vira várias notas (`-1`, `-2`...), nunca é cortado. Carimbo automático: perde para qualquer versão
 * da mesma nota que já exista em outro aparelho.
 */
async function guardarComoNotas(
  texto: string | undefined,
  lugar: { salaId: string; pastaId?: string },
  criadaEm: number,
  idDe: (parte?: number) => string,
  jaMigrada: (nota: Nota) => boolean = () => false,
): Promise<void> {
  const partes = texto === undefined ? [] : emPartes(texto);
  if (partes.length === 0) return;
  const ids = partes.map((_, i) => idDe(partes.length > 1 ? i + 1 : undefined));
  const [existente] = await lerRegistros([{ colecao: 'notas', id: ids[0] }]);
  if (existente) return;
  const doLugar = (await listar('notas', { comApagados: true })).filter((n) => n.salaId === lugar.salaId && (lugar.pastaId ? n.pastaId === lugar.pastaId : !n.pastaId));
  if (doLugar.some((n) => n.texto === partes[0] || jaMigrada(n))) return;
  for (const [i, parte] of partes.entries()) {
    await salvar('notas', { id: ids[i], ...lugar, tipo: 'texto', texto: parte, criadaEm }, { automatico: true });
  }
}

/**
 * O texto antigo das notas da sala (campo único) vira nota(s) de texto, com a data da última mudança da sala. O id leva
 * essa data (`nota-antiga-<sala>-<atualizadoEm>`): se um aparelho antigo editar o texto depois, vira mais uma nota, e
 * nada se perde. A nota do esquema anterior (`nota-antiga-<sala>`, sem versão) conta como já migrada para a versão cuja
 * data ela guarda. O campo `notas` da sala não é apagado nem mudado.
 */
export function migrarNotasAntigas(salaId: string): Promise<void> {
  return umaVez(`sala:${salaId}`, async () => {
    const [sala] = await lerRegistros([{ colecao: 'salas', id: salaId }]);
    if (!sala || sala.apagado) return;
    const texto = (sala as Sala).notas;
    const versao = sala.atualizadoEm;
    await guardarComoNotas(
      texto,
      { salaId },
      versao,
      (parte) => idDaNotaAntiga(salaId, versao, parte),
      (nota) => nota.id === `nota-antiga-${salaId}` && nota.criadaEm === versao,
    );
  });
}

/**
 * A página "Notas" que a v0.2.3 criava sozinha na subpasta (id `nota-<pastaId>`): o texto dela (as linhas unidas por
 * quebra de linha) vira nota(s) de texto, com a data da última mudança da página, e o id leva essa data
 * (`nota-pagina-<pasta>-<atualizadoEm>`). A página NUNCA é apagada: se um aparelho antigo a mudar depois, o novo texto
 * vira mais uma nota. A tela do caderno esconde essas páginas (já aparecem como notas). Outras páginas não mudam.
 */
export function migrarPaginaDaPasta(salaId: string, pastaId: string): Promise<void> {
  return umaVez(`pasta:${pastaId}`, async () => {
    const [pagina] = await lerRegistros([{ colecao: 'paginas', id: `nota-${pastaId}` }]);
    if (!pagina || pagina.apagado) return;
    const linhas = (pagina as Pagina).blocos.filter((b) => b.tipo !== 'painel').map((b) => b.texto ?? '');
    const versao = pagina.atualizadoEm;
    await guardarComoNotas(linhas.join('\n').trim(), { salaId, pastaId }, versao, (parte) => idDaNotaDaPagina(pastaId, versao, parte));
  });
}
