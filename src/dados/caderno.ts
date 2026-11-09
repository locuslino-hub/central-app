// Caderno (Tarefa 19): páginas de uma sala, cada uma com blocos (texto, título,
// lista ou um painel como Agenda e Checklist). A página inteira é um registro da
// coleção `paginas`; sincroniza como os outros, vale a gravação mais recente.
// Linha com data vira tarefa ou compromisso pelo mesmo `interpretar` do chat.
import { criarItem, interpretar } from '../chat/interpretar';
import { desfazer, type Desfazivel } from './desfazer';
import { lerRegistros, salvar } from './loja';
import type { Bloco, Pagina } from './tipos';

export type TipoDeBloco = Bloco['tipo'];
export type Painel = NonNullable<Bloco['painel']>;

export const TEXTO_DO_BLOCO_NO_MAXIMO = 2000;
export const BLOCOS_NO_MAXIMO = 300;
export const TITULO_DA_PAGINA_NO_MAXIMO = 120;

export function novoBloco(tipo: Exclude<TipoDeBloco, 'painel'>, texto = ''): Bloco {
  return { id: crypto.randomUUID(), tipo, texto };
}

export function novoPainel(painel: Painel): Bloco {
  return { id: crypto.randomUUID(), tipo: 'painel', painel };
}

/** Corta o que passa dos limites e tira campos que o tipo não usa. */
function limpar(blocos: readonly Bloco[]): Bloco[] {
  return blocos.slice(0, BLOCOS_NO_MAXIMO).map((b) => {
    const limpo: Bloco = { id: b.id, tipo: b.tipo };
    if (b.tipo === 'painel') limpo.painel = b.painel;
    else limpo.texto = (b.texto ?? '').slice(0, TEXTO_DO_BLOCO_NO_MAXIMO);
    if (b.itemId) limpo.itemId = b.itemId;
    return limpo;
  });
}

async function lerPagina(id: string): Promise<Pagina | undefined> {
  const [lido] = await lerRegistros([{ colecao: 'paginas', id }]);
  return lido && !lido.apagado ? (lido as Pagina) : undefined;
}

/**
 * Uma fila por página: ler e gravar de cada operação andam juntos, uma de cada
 * vez. Sem isso, dois gravadores (corpo e título, ou o Desfazer) leriam a mesma
 * cópia e o último a gravar apagaria o que o outro mudou.
 */
const filas = new Map<string, Promise<unknown>>();
function naFila<T>(paginaId: string, fazer: () => Promise<T>): Promise<T> {
  const anterior = filas.get(paginaId) ?? Promise.resolve();
  const esta = anterior.then(fazer, fazer);
  const marca = esta.catch(() => undefined);
  filas.set(paginaId, marca);
  void marca.then(() => {
    if (filas.get(paginaId) === marca) filas.delete(paginaId);
  });
  return esta;
}

export async function criarPagina(salaId: string, titulo: string): Promise<Pagina> {
  return salvar('paginas', {
    salaId,
    titulo: titulo.trim().slice(0, TITULO_DA_PAGINA_NO_MAXIMO) || 'Página sem título',
    blocos: [novoBloco('texto')],
  });
}

/**
 * Grava os blocos lendo a página de novo antes: o título e o resto que mudaram
 * em outro aparelho não são regravados por uma cópia velha. `false` se a página
 * não existe mais.
 */
export function gravarBlocos(id: string, blocos: readonly Bloco[]): Promise<boolean> {
  return naFila(id, async () => {
    const atual = await lerPagina(id);
    if (!atual) return false;
    const novos = limpar(blocos);
    if (JSON.stringify(atual.blocos) === JSON.stringify(novos)) return true;
    await salvar('paginas', { ...atual, blocos: novos });
    return true;
  });
}

export function renomearPagina(id: string, titulo: string): Promise<boolean> {
  return naFila(id, async () => {
    const atual = await lerPagina(id);
    if (!atual) return false;
    const novo = titulo.trim().slice(0, TITULO_DA_PAGINA_NO_MAXIMO);
    // Título vazio não vale: a página ficaria sem nome na lista.
    if (!novo || novo === atual.titulo) return true;
    await salvar('paginas', { ...atual, titulo: novo });
    return true;
  });
}

/**
 * O Desfazer de uma remoção: põe o bloco de volta depois do bloco que vinha
 * antes dele (`anteriorId`, ou no começo), não numa posição fixa: a página pode
 * ter mudado desde então.
 */
export function desfazerDeRemocao(paginaId: string, bloco: Bloco, anteriorId: string | null): Desfazivel {
  return desfazer.registrar('Bloco removido', () =>
    naFila(paginaId, async () => {
      const agora = await lerPagina(paginaId);
      if (!agora || agora.blocos.some((b) => b.id === bloco.id)) return;
      const blocos = [...agora.blocos];
      const depoisDe = anteriorId === null ? -1 : blocos.findIndex((b) => b.id === anteriorId);
      blocos.splice(depoisDe + 1, 0, bloco);
      await salvar('paginas', { ...agora, blocos });
    }),
  );
}

/**
 * Tira o bloco da página e devolve o Desfazer. Tarefa ou compromisso que o bloco
 * criou continua onde está: só a linha some.
 */
export async function removerBloco(paginaId: string, blocoId: string): Promise<Desfazivel | undefined> {
  const feito = await naFila(paginaId, async () => {
    const atual = await lerPagina(paginaId);
    const posicao = atual?.blocos.findIndex((b) => b.id === blocoId) ?? -1;
    if (!atual || posicao === -1) return undefined;
    await salvar('paginas', { ...atual, blocos: atual.blocos.filter((b) => b.id !== blocoId) });
    return { bloco: atual.blocos[posicao], anteriorId: atual.blocos[posicao - 1]?.id ?? null };
  });
  return feito && desfazerDeRemocao(paginaId, feito.bloco, feito.anteriorId);
}

export type Situacao = 'parado' | 'salvando' | 'salvo' | 'erro';

/**
 * Grava um instante depois da última chamada de `agendar`; `esvaziar` grava já.
 * As gravações andam em fila. Se uma falha, o valor continua pendente.
 */
export function criarGravador<T>(gravar: (valor: T) => Promise<unknown>, aoMudar: (s: Situacao) => void, atrasoMs: number) {
  let pendente: { valor: T } | null = null;
  let relogio: ReturnType<typeof setTimeout> | undefined;
  let fila: Promise<void> = Promise.resolve();

  function esvaziar(): Promise<void> {
    clearTimeout(relogio);
    fila = fila.then(async () => {
      if (!pendente) return;
      const { valor } = pendente;
      pendente = null;
      aoMudar('salvando');
      try {
        await gravar(valor);
        aoMudar(pendente ? 'parado' : 'salvo');
      } catch (erro) {
        console.error('Não consegui salvar o caderno', erro);
        pendente ??= { valor };
        aoMudar('erro');
      }
    });
    return fila;
  }

  return {
    agendar(valor: T) {
      pendente = { valor };
      aoMudar('parado');
      clearTimeout(relogio);
      relogio = setTimeout(() => void esvaziar(), atrasoMs);
    },
    esvaziar,
    sujo: () => pendente !== null,
  };
}

export type ItemDaLinha = {
  /** Id da tarefa, ou do evento no Google Agenda. */
  itemId: string;
  tipo: 'tarefa' | 'compromisso';
  titulo: string;
  data?: string;
  semana?: string;
  inicio?: string;
  /** Desfaz o que foi criado (apaga a tarefa ou remove o evento). */
  desfazer: () => Promise<void>;
};

/** A linha é um compromisso e só o Enter cria (evento de verdade no Google Agenda). */
export const SO_COM_ENTER = 'so-com-enter';

/**
 * A linha tem data? Então vira item, pelo `interpretar` do chat, na sala da
 * página (a sala que a frase citar não vale aqui: o dono escreveu nesta página).
 * Compromisso só nasce com `compromisso: true` (Enter): sair do campo devolve
 * `SO_COM_ENTER`. `null` se não tem data, se a frase tem mais de um pedido ou se nada saiu dela.
 */
export async function itemDaLinha(texto: string, salaId: string, opcoes: { compromisso: boolean }): Promise<ItemDaLinha | typeof SO_COM_ENTER | null> {
  const itens = await interpretar(texto);
  if (itens.length !== 1) return null;
  const item = itens[0];
  if (!item.data && !item.semana) return null;
  if (item.tipo === 'compromisso' && !opcoes.compromisso) return SO_COM_ENTER;
  const { certeza: _certeza, pessoaNova: _nova, termoSala: _termo, pessoaNome: _nome, ...puro } = item;
  const criado = await criarItem({ ...puro, salaId });
  const base = { titulo: item.titulo, data: item.data, semana: item.semana, inicio: item.inicio, desfazer: criado.desfazer };
  return criado.tarefa
    ? { ...base, itemId: criado.tarefa.id, tipo: 'tarefa' }
    : { ...base, itemId: criado.eventoId, tipo: 'compromisso' };
}
