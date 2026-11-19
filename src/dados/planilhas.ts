// Cliente das planilhas da Casa (V02, Tarefa 10): ler, anexar e atualizar linhas
// pelo script, com cache local por pasta e fila para quando não há rede.
//
// - Só se anexa e se atualiza: nenhuma ação daqui apaga linha da planilha. O
//   "desfazer" de um anexo grava "desfeito" na coluna Observação e esconde a
//   linha; se ela ainda estava na fila, sai da fila e nada chega a ser enviado.
// - O id da linha nasce aqui (UUID). O script não duplica uma linha com id que
//   já existe, então reenviar a fila (resposta perdida, duas rodadas) é seguro.
// - O cache é um banco próprio (`central-planilhas`), só deste aparelho: não
//   sincroniza, não entra na cópia de segurança e não mexe na versão de
//   `central-dados`. Cada leitura boa o substitui: linha apagada à mão some.
// - O texto da planilha é dado de terceiros: este módulo nunca o interpreta.
import { openDB } from 'idb';
import { CABECALHOS } from '../../script/planilhas';
import { ErroConexao, ErroScript, chamar as chamarScript } from '../conexao/cliente';
import {
  agendaEsgotada,
  alterarPendentePlanilha,
  descartarPendentes,
  enfileirarPlanilha,
  lerPendente,
  lerRegistros,
  listarPendentes,
  registrarTentativa,
  removerPendentes,
  retirarPendente,
} from './loja';
import type { Pasta, PendentePlanilha } from './tipos';

/** Mesmo formato de `chamar` (conexao/cliente.ts); os testes entregam um de mentira. */
export type Chamar = <T>(acao: string, dados?: object) => Promise<T>;
export type OpcoesDePlanilha = { chamar?: Chamar };

/** `pendente`: só na vista. `fila` = anexo que espera rede; `parada` = a sincronia desistiu, não está salvo. */
export type LinhaDaPlanilha = { id: string; valores: Record<string, string>; pendente?: 'fila' | 'parada' };

/** O que impede de usar a planilha agora (além de `planilha_mudou`, que é a coluna que faltou). */
export type AvisoDePlanilha = 'planilha_mudou' | 'fora_da_pasta' | 'sem_acesso' | 'planilha_cheia';

export const PASTA_SEM_PLANILHA = 'pasta_sem_planilha';
export const COLUNA_DO_DESFEITO = 'Observação';
export const MARCA_DO_DESFEITO = 'desfeito';

// ---------- cache ----------

const BANCO = 'central-planilhas';
const CACHE = 'cache';

type Cache = {
  pastaId: string;
  /** Para achar o cache a partir de uma entrada da fila (que só conhece a planilha). */
  planilhaId?: string;
  cabecalho: string[];
  linhas: LinhaDaPlanilha[];
  /** Ids escondidos por "desfeito" (ou outra vista); some do cache só quando a planilha deixa de ter a linha. */
  ocultas: string[];
};

async function comCache<T>(usar: (banco: Awaited<ReturnType<typeof abrirCache>>) => Promise<T>): Promise<T> {
  const banco = await abrirCache();
  try {
    return await usar(banco);
  } finally {
    banco.close();
  }
}

function abrirCache() {
  return openDB(BANCO, 1, {
    upgrade(banco) {
      if (!banco.objectStoreNames.contains(CACHE)) banco.createObjectStore(CACHE, { keyPath: 'pastaId' });
    },
  });
}

/** Tira do cache deste aparelho o que se leu da planilha da pasta (ao apagar a pasta). A fila de envio não é tocada. */
export async function esquecerCacheDaPasta(pastaId: string): Promise<void> {
  await comCache((banco) => banco.delete(CACHE, pastaId));
}

const vazio = (pastaId: string): Cache => ({ pastaId, cabecalho: [], linhas: [], ocultas: [] });

async function lerCache(pastaId: string): Promise<Cache> {
  const lido: Cache | undefined = await comCache((banco) => banco.get(CACHE, pastaId));
  return lido ?? vazio(pastaId);
}

/** Lê, muda e grava o cache da pasta numa transação só. */
async function mudarCache(pasta: Pasta, mudar: (cache: Cache) => void): Promise<void> {
  const pastaId = pasta.id;
  // Pasta apagada (lápide): uma leitura que estava a caminho não recria o cache que `apagarPasta` acabou de esquecer.
  const [registro] = await lerRegistros([{ colecao: 'pastas', id: pastaId }]).catch(() => []);
  if (registro?.apagado) return;
  await comCache(async (banco) => {
    const tx = banco.transaction(CACHE, 'readwrite');
    tx.done.catch(() => {});
    const cache: Cache = (await tx.store.get(pastaId)) ?? vazio(pastaId);
    mudar(cache);
    if (pasta.planilhaId) cache.planilhaId = pasta.planilhaId;
    await tx.store.put(cache);
    await tx.done;
  });
}

// ---------- chamadas ao script ----------

type ErroDeColuna = { erro: 'coluna_faltando'; colunas: string[] };
type RespostaDeLeitura = { cabecalho: string[]; linhas: LinhaDaPlanilha[] } | { erro: 'fora_da_pasta' | 'sem_acesso' } | ErroDeColuna;
type RespostaDeAnexo = { ok: true } | ErroDeColuna | { erro: 'fora_da_pasta' | 'sem_acesso' | 'planilha_cheia' };
type RespostaDeAtualizacao =
  | { ok: true; valores: Record<string, string> }
  | { conflito: true }
  | { erro: 'linha_nao_achada' | 'fora_da_pasta' | 'sem_acesso' }
  | ErroDeColuna;

function planilhaDa(pasta: Pasta): string {
  if (typeof pasta.planilhaId !== 'string' || pasta.planilhaId === '') throw new Error(PASTA_SEM_PLANILHA);
  return pasta.planilhaId;
}

/** Sem rede ou script ocupado: o pedido pode esperar na fila. Qualquer outro erro sobe. */
function podeEsperar(erro: unknown): boolean {
  return erro instanceof ErroConexao || (erro instanceof ErroScript && erro.erro === 'ocupado');
}

// A resposta vem de fora: só passa o que tem exatamente a forma do contrato do script.
const objeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const textos = (v: unknown): v is Record<string, string> => objeto(v) && Object.values(v).every((t) => typeof t === 'string');
const comColunas = (r: Record<string, unknown>) => r.erro === 'coluna_faltando' && Array.isArray(r.colunas) && r.colunas.every((c) => typeof c === 'string');

function formaDaLeitura(r: unknown): r is RespostaDeLeitura {
  if (!objeto(r)) return false;
  if ('linhas' in r) {
    return (
      Array.isArray(r.cabecalho) &&
      r.cabecalho.every((c) => typeof c === 'string') &&
      Array.isArray(r.linhas) &&
      r.linhas.every((l) => objeto(l) && typeof l.id === 'string' && textos(l.valores))
    );
  }
  return r.erro === 'fora_da_pasta' || r.erro === 'sem_acesso' || comColunas(r);
}

function formaDoAnexo(r: unknown): r is RespostaDeAnexo {
  if (!objeto(r)) return false;
  return r.ok === true || r.erro === 'fora_da_pasta' || r.erro === 'sem_acesso' || r.erro === 'planilha_cheia' || comColunas(r);
}

function formaDaAtualizacao(r: unknown): r is RespostaDeAtualizacao {
  if (!objeto(r)) return false;
  if (r.ok === true) return textos(r.valores);
  if (r.conflito === true) return true;
  return r.erro === 'linha_nao_achada' || r.erro === 'fora_da_pasta' || r.erro === 'sem_acesso' || comColunas(r);
}

const FORMAS: Record<string, (r: unknown) => boolean> = { lerLinhas: formaDaLeitura, anexarLinha: formaDoAnexo, atualizarLinha: formaDaAtualizacao };

/** Chama e confere a forma da resposta: o que não é do contrato vira `ErroScript('interno')`. Erros de rede sobem. */
async function chamarConferindo<T>(chamar: Chamar, acao: string, dados: object): Promise<T> {
  const resposta = await chamar<unknown>(acao, dados);
  if (!FORMAS[acao]!(resposta)) throw new ErroScript('interno');
  return resposta as T;
}

/** `null` = sem rede (ou ocupado): o pedido pode esperar na fila. */
async function pedir<T>(chamar: Chamar, acao: string, dados: object): Promise<T | null> {
  try {
    return await chamarConferindo<T>(chamar, acao, dados);
  } catch (erro) {
    if (podeEsperar(erro)) return null;
    throw erro;
  }
}

const eDesfeito = (linha: LinhaDaPlanilha) => (linha.valores[COLUNA_DO_DESFEITO] ?? '').trim().toLowerCase() === MARCA_DO_DESFEITO;

/** Colunas do modelo da pasta que a planilha não tem. A Observação é opcional: planilha antiga não a tem. */
function colunasQueFaltam(pasta: Pasta, cabecalho: readonly string[]): string[] {
  const modelo = pasta.modelo;
  if (!modelo || !(modelo in CABECALHOS)) return [];
  return CABECALHOS[modelo].filter((nome) => nome !== COLUNA_DO_DESFEITO && !cabecalho.includes(nome));
}

const chaveDaLinha = (planilhaId: string, idDaLinha: string) => JSON.stringify([planilhaId, idDaLinha]);

/** As ações de planilha da fila, na ordem em que entraram. */
async function acoesDaFila(planilhaId?: string): Promise<PendentePlanilha[]> {
  return (await listarPendentes()).filter((p): p is PendentePlanilha => p.tipo === 'planilha' && (planilhaId === undefined || p.planilhaId === planilhaId));
}

// ---------- ler ----------

export type LeituraDePlanilha = { linhas: LinhaDaPlanilha[]; doCache: boolean; aviso?: AvisoDePlanilha };

/**
 * A vista: o que se sabe da planilha, mais os anexos que esperam na fila
 * (`pendente: 'fila'`, ou `'parada'` se a sincronia desistiu deles: não estão
 * salvos), com as mudanças que esperam na fila por cima, sem as linhas "desfeito"
 * nem as escondidas.
 */
async function vista(cache: Cache, planilhaId: string): Promise<LinhaDaPlanilha[]> {
  const fila = await acoesDaFila(planilhaId);
  const agora = Date.now();
  const linhas = new Map<string, LinhaDaPlanilha>();
  for (const l of cache.linhas) linhas.set(l.id, { id: l.id, valores: { ...l.valores } });
  for (const p of fila) {
    if (p.acao === 'anexar' && !linhas.has(p.idDaLinha)) {
      linhas.set(p.idDaLinha, { id: p.idDaLinha, valores: { ...p.valores }, pendente: agendaEsgotada(p, agora) ? 'parada' : 'fila' });
    }
  }
  for (const p of fila) {
    if (p.acao === 'atualizar') {
      const linha = linhas.get(p.idDaLinha);
      if (linha) Object.assign(linha.valores, p.valores);
    }
  }
  const ocultas = new Set(cache.ocultas);
  return [...linhas.values()].filter((l) => !ocultas.has(l.id) && !eDesfeito(l));
}

/** Lê no script e, se veio linha, troca o cache por ela. `null`: sem rede. */
async function lerDoScript(pasta: Pasta, chamar: Chamar): Promise<{ resposta: RespostaDeLeitura; cache: Cache } | null> {
  const planilhaId = planilhaDa(pasta);
  const resposta = await pedir<RespostaDeLeitura>(chamar, 'lerLinhas', { planilhaId });
  if (!resposta) return null;
  if (!('linhas' in resposta)) return { resposta, cache: await lerCache(pasta.id) };
  const ids = new Set(resposta.linhas.map((l) => l.id));
  let guardado = vazio(pasta.id);
  await mudarCache(pasta, (cache) => {
    const escondidas = new Set(cache.ocultas.filter((id) => ids.has(id)));
    for (const linha of resposta.linhas) if (eDesfeito(linha)) escondidas.add(linha.id);
    cache.cabecalho = [...resposta.cabecalho];
    cache.linhas = resposta.linhas.map((l) => ({ id: l.id, valores: { ...l.valores } }));
    cache.ocultas = [...escondidas];
    guardado = { ...cache };
  });
  return { resposta, cache: guardado };
}

/**
 * As linhas da planilha da pasta. Com rede, lê no script e guarda no cache
 * (linha apagada à mão some). Sem rede (ou script ocupado), devolve o cache com
 * `doCache: true`. Anexos ainda na fila aparecem (`pendente`), com as mudanças
 * da fila por cima; linhas "desfeito", não.
 * `aviso`: `planilha_mudou` (faltou coluna do modelo ou a coluna `id`; mostra o
 * que dá e não deve gravar), `fora_da_pasta` ou `sem_acesso` (mostra o cache).
 */
export async function lerPlanilha(pasta: Pasta, opcoes: OpcoesDePlanilha = {}): Promise<LeituraDePlanilha> {
  const { chamar = chamarScript } = opcoes;
  const planilhaId = planilhaDa(pasta);
  const lido = await lerDoScript(pasta, chamar);
  if (!lido) return { linhas: await vista(await lerCache(pasta.id), planilhaId), doCache: true };
  const { resposta, cache } = lido;
  if (!('linhas' in resposta)) {
    const aviso: AvisoDePlanilha = resposta.erro === 'coluna_faltando' ? 'planilha_mudou' : resposta.erro;
    return { linhas: await vista(cache, planilhaId), doCache: true, aviso };
  }
  const linhas = await vista(cache, planilhaId);
  return colunasQueFaltam(pasta, cache.cabecalho).length > 0 ? { linhas, doCache: false, aviso: 'planilha_mudou' } : { linhas, doCache: false };
}

// ---------- anexar ----------

export type ResultadoDoAnexo = {
  idDaLinha: string;
  /** `enviada`: já está na planilha; `na_fila`: sem rede, sai ao voltar; `bloqueada`: nada foi gravado nem guardado (veja `aviso`). */
  situacao: 'enviada' | 'na_fila' | 'bloqueada';
  aviso?: AvisoDePlanilha;
  /**
   * Nunca apaga linha da planilha. Se ainda estava na fila, nada é enviado (`tirada_da_fila`); se já estava na
   * planilha, a linha fica marcada "desfeito" (`marcada`). Devolve o que de fato aconteceu, que pode diferir do
   * `situacao` de quando o anexo foi feito (a fila pode ter sido enviada nesse meio tempo). Pode ser chamado mais de
   * uma vez (devolve o mesmo); se falhar, relança e uma nova chamada tenta de novo.
   */
  desfazer: () => Promise<ResultadoDoDesfazer>;
};

export type ResultadoDoDesfazer = 'tirada_da_fila' | 'marcada';

const dasColunas = (valores: Record<string, string>, colunas: Iterable<string>) => {
  const recorte: Record<string, string> = {};
  for (const coluna of colunas) if (Object.prototype.hasOwnProperty.call(valores, coluna)) recorte[coluna] = valores[coluna]!;
  return recorte;
};

/**
 * Anexa uma linha. O id é gerado aqui. Com rede, vai direto; sem rede (ou
 * script ocupado), entra na fila e aparece na vista, e a sincronia a envia ao
 * voltar a rede, na ordem. Coluna que falta na planilha: `bloqueada` com aviso
 * `planilha_mudou`; nada é gravado nem guardado. `fora_da_pasta`, `sem_acesso` e
 * `planilha_cheia` também bloqueiam (a pasta não é apagada).
 */
export async function anexar(pasta: Pasta, valores: Record<string, string>, opcoes: OpcoesDePlanilha = {}): Promise<ResultadoDoAnexo> {
  const { chamar = chamarScript } = opcoes;
  const planilhaId = planilhaDa(pasta);
  const idDaLinha = crypto.randomUUID();
  const copia = { ...valores };
  let situacao: ResultadoDoAnexo['situacao'];
  let aviso: AvisoDePlanilha | undefined;
  const resposta = await pedir<RespostaDeAnexo>(chamar, 'anexarLinha', { planilhaId, idDaLinha, valores: copia });
  if (resposta === null) {
    await enfileirarPlanilha({ tipo: 'planilha', acao: 'anexar', planilhaId, idDaLinha, valores: copia });
    situacao = 'na_fila';
  } else if ('ok' in resposta) {
    await mudarCache(pasta, (cache) => {
      if (!cache.linhas.some((l) => l.id === idDaLinha)) cache.linhas.push({ id: idDaLinha, valores: { ...copia } });
    });
    situacao = 'enviada';
  } else {
    situacao = 'bloqueada';
    aviso = resposta.erro === 'coluna_faltando' ? 'planilha_mudou' : resposta.erro;
  }

  // Uma só execução: chamar de novo (ou ao mesmo tempo) devolve a mesma. Se falhar, solta a trava e relança,
  // para a nova tentativa fazer o trabalho de verdade.
  let andamento: Promise<ResultadoDoDesfazer> | null = null;
  const desfazer = (): Promise<ResultadoDoDesfazer> => {
    if (situacao === 'bloqueada') return Promise.resolve('tirada_da_fila');
    if (!andamento) {
      const este = desfazerAnexo(pasta, planilhaId, idDaLinha, chamar);
      andamento = este;
      este.catch(() => {
        if (andamento === este) andamento = null;
      });
    }
    return andamento;
  };
  return { idDaLinha, situacao, ...(aviso ? { aviso } : {}), desfazer };
}

const DESFEITO = { [COLUNA_DO_DESFEITO]: MARCA_DO_DESFEITO };

/**
 * Põe uma mudança na fila. Se já há uma mudança na fila para a mesma linha, as
 * duas viram uma só e o `antes` de cada coluna continua sendo o do primeiro
 * pedido (a coluna que a mudança anterior já tocou não é lida do cache, que já
 * tem o valor novo).
 */
async function enfileirarMudanca(planilhaId: string, idDaLinha: string, valores: Record<string, string>, lido?: Record<string, string>): Promise<void> {
  const agora = Date.now();
  // Entrada inerte (a sincronia desistiu) não recebe mais nada: a mudança nova entra à parte.
  const anterior = (await acoesDaFila(planilhaId)).find((p) => p.acao === 'atualizar' && p.idDaLinha === idDaLinha && !agendaEsgotada(p, agora));
  const colunas = Object.keys(valores);
  if (!anterior) {
    const antes = lido ? dasColunas(lido, colunas) : {};
    await enfileirarPlanilha({ tipo: 'planilha', acao: 'atualizar', planilhaId, idDaLinha, valores: { ...valores }, ...(Object.keys(antes).length > 0 ? { antes } : {}) });
    return;
  }
  const antes: Record<string, string> = {};
  for (const coluna of colunas) {
    if (coluna in anterior.valores) {
      if (anterior.antes && coluna in anterior.antes) antes[coluna] = anterior.antes[coluna]!;
    } else if (lido && coluna in lido) antes[coluna] = lido[coluna]!;
  }
  const juntou = await alterarPendentePlanilha(anterior.seq, (p) => {
    const { antes: _velho, ...resto } = p;
    const todos = { ...(p.antes ?? {}), ...antes };
    return { ...resto, valores: { ...p.valores, ...valores }, ...(Object.keys(todos).length > 0 ? { antes: todos } : {}) };
  });
  if (!juntou) await enfileirarMudanca(planilhaId, idDaLinha, valores, lido);
}

async function desfazerAnexo(pasta: Pasta, planilhaId: string, idDaLinha: string, chamar: Chamar): Promise<ResultadoDoDesfazer> {
  // Ainda na fila: sai da fila e nada vai à planilha.
  const naFila = (await acoesDaFila(planilhaId)).find((p) => p.acao === 'anexar' && p.idDaLinha === idDaLinha);
  if (naFila && (await retirarPendente(naFila.seq))) {
    await mudarCache(pasta, (cache) => {
      cache.linhas = cache.linhas.filter((l) => l.id !== idDaLinha);
    });
    return 'tirada_da_fila';
  }
  // Já na planilha: esconde aqui e marca "desfeito" lá; a linha continua existindo.
  await mudarCache(pasta, (cache) => {
    if (!cache.ocultas.includes(idDaLinha)) cache.ocultas.push(idDaLinha);
  });
  try {
    const resposta = await pedir<RespostaDeAtualizacao>(chamar, 'atualizarLinha', { planilhaId, idDaLinha, valores: DESFEITO });
    // Sem rede, ou o script não deixou gravar agora: a marca espera na fila. Planilha antiga sem a
    // coluna Observação, ou linha que sumiu: fica escondida só neste aparelho. Nada apaga linha.
    if (resposta === null || ('erro' in resposta && (resposta.erro === 'sem_acesso' || resposta.erro === 'fora_da_pasta'))) {
      await enfileirarMudanca(planilhaId, idDaLinha, DESFEITO);
    }
  } catch (erro) {
    // Resposta fora do combinado ou recusa do script: a linha já está escondida; a marca não se perde.
    if (!(erro instanceof ErroScript)) throw erro;
    await enfileirarMudanca(planilhaId, idDaLinha, DESFEITO);
  }
  return 'marcada';
}

// ---------- atualizar ----------

export type ResultadoDaAtualizacao = 'ok' | 'conflito' | 'sumiu' | 'na_fila' | 'planilha_mudou' | 'indisponivel';

/**
 * Muda células da linha pelo id. Manda junto o que o app tinha lido nessas
 * colunas: se alguém mexeu depois, o script responde conflito; aí relê a planilha
 * e tenta de novo uma vez (valendo o que está lá agora como "antes"). `sumiu`:
 * a linha foi apagada à mão (sai do cache). `na_fila`: sem rede, a mudança vale
 * na vista e é enviada ao voltar, com o `antes` guardado (conflito ao enviar
 * deixa a entrada na fila e, passado o limite, o aviso da fila a mostra). Linha
 * que só existe na fila (anexo ainda não enviado): a mudança é juntada ao anexo
 * e o script nem é chamado (`na_fila`). `planilha_mudou`: falta coluna; nada
 * gravado. `indisponivel`: `fora_da_pasta` ou `sem_acesso`.
 */
export async function atualizar(
  pasta: Pasta,
  idDaLinha: string,
  valores: Record<string, string>,
  opcoes: OpcoesDePlanilha = {},
): Promise<ResultadoDaAtualizacao> {
  const { chamar = chamarScript } = opcoes;
  const planilhaId = planilhaDa(pasta);
  const colunas = Object.keys(valores);

  const anexo = (await acoesDaFila(planilhaId)).find((p) => p.acao === 'anexar' && p.idDaLinha === idDaLinha);
  if (anexo && (await alterarPendentePlanilha(anexo.seq, (p) => ({ ...p, valores: { ...p.valores, ...valores } })))) return 'na_fila';

  const noCache = async () => (await lerCache(pasta.id)).linhas.find((l) => l.id === idDaLinha);
  let usada = await noCache();
  const tentar = async (linha: LinhaDaPlanilha | undefined) => {
    usada = linha;
    const antes = linha ? dasColunas(linha.valores, colunas) : undefined;
    return pedir<RespostaDeAtualizacao>(chamar, 'atualizarLinha', { planilhaId, idDaLinha, valores, ...(antes ? { antes } : {}) });
  };

  let resposta = await tentar(usada);
  if (resposta && 'conflito' in resposta) {
    const lido = await lerDoScript(pasta, chamar);
    if (!lido) resposta = null;
    else {
      const fresca = 'linhas' in lido.resposta ? lido.cache.linhas.find((l) => l.id === idDaLinha) : undefined;
      if (!fresca) return 'sumiu';
      resposta = await tentar(fresca);
    }
  }

  if (resposta === null) {
    await enfileirarMudanca(planilhaId, idDaLinha, valores, usada?.valores);
    await mudarCache(pasta, (cache) => {
      const linha = cache.linhas.find((l) => l.id === idDaLinha);
      if (linha) Object.assign(linha.valores, valores);
    });
    return 'na_fila';
  }
  if ('conflito' in resposta) return 'conflito';
  if ('ok' in resposta) {
    await mudarCache(pasta, (cache) => {
      const linha = cache.linhas.find((l) => l.id === idDaLinha);
      if (linha) Object.assign(linha.valores, resposta.valores);
    });
    return 'ok';
  }
  if (resposta.erro === 'linha_nao_achada') {
    await mudarCache(pasta, (cache) => {
      cache.linhas = cache.linhas.filter((l) => l.id !== idDaLinha);
    });
    return 'sumiu';
  }
  return resposta.erro === 'coluna_faltando' ? 'planilha_mudou' : 'indisponivel';
}

// ---------- fila ----------

/**
 * "Desfeito" de um anexo que acabou de ser enviado, quando o dono o desfez no
 * meio do envio. A marca nunca se perde: qualquer falha a deixa na fila.
 */
async function marcarDesfeitoDepoisDoEnvio(chamar: Chamar, planilhaId: string, idDaLinha: string): Promise<void> {
  try {
    const marca = await chamarConferindo<RespostaDeAtualizacao>(chamar, 'atualizarLinha', { planilhaId, idDaLinha, valores: DESFEITO });
    if ('conflito' in marca || ('erro' in marca && (marca.erro === 'sem_acesso' || marca.erro === 'fora_da_pasta'))) {
      await enfileirarMudanca(planilhaId, idDaLinha, DESFEITO);
    }
  } catch (erro) {
    await enfileirarMudanca(planilhaId, idDaLinha, DESFEITO);
    // Sem rede o resto da fila também espera; recusa do script não impede as outras entradas.
    if (podeEsperar(erro) || !(erro instanceof ErroScript)) throw erro;
  }
}

/**
 * Envia as ações de planilha da fila, na ordem em que entraram (`seq`). Cada uma
 * sai só depois de o script confirmar. Sem rede (ou ocupado): para e deixa tudo.
 * - Recusa do script (coluna que faltou, sem acesso, fora da pasta, cheia,
 *   conflito, resposta fora do combinado): a ação fica na fila e conta uma
 *   tentativa (no máximo uma por hora). Passado o limite ela fica inerte: a
 *   sincronia a pula e o aviso da fila a mostra. Nada é gravado pela metade.
 * - Mudança de linha cujo anexo ainda está na fila: espera o anexo, sem contar
 *   tentativa. Mudança de linha que já não existe: sai da fila.
 * - Se o dono desfez um anexo enquanto ele era enviado, a marca "desfeito" vai em seguida.
 */
export async function enviarFilaDePlanilhas(chamar: Chamar): Promise<void> {
  const acoes = await acoesDaFila();
  const agora = Date.now();
  const anexosNaFila = new Set(acoes.filter((p) => p.acao === 'anexar').map((p) => chaveDaLinha(p.planilhaId, p.idDaLinha)));
  for (const acao of acoes) {
    if (agendaEsgotada(acao, agora)) continue;
    const { planilhaId, idDaLinha, valores } = acao;
    // A mudança espera o anexo da mesma linha; sem ele a planilha não tem a linha.
    if (acao.acao === 'atualizar' && anexosNaFila.has(chaveDaLinha(planilhaId, idDaLinha))) continue;
    // Lê de novo: o dono pode ter desfeito o anexo desde que a fila foi lida.
    if (!(await lerPendente(acao.seq))) continue;
    try {
      if (acao.acao === 'anexar') {
        const resposta = await chamarConferindo<RespostaDeAnexo>(chamar, 'anexarLinha', { planilhaId, idDaLinha, valores });
        if ('ok' in resposta) {
          anexosNaFila.delete(chaveDaLinha(planilhaId, idDaLinha));
          // Mudança juntada ao anexo enquanto ele era enviado: o que não foi, vai como mudança à parte.
          const agora2 = await lerPendente(acao.seq);
          if (agora2?.tipo === 'planilha') {
            const diff = Object.fromEntries(Object.entries(agora2.valores).filter(([coluna, valor]) => valores[coluna] !== valor));
            if (Object.keys(diff).length > 0) await enfileirarMudanca(planilhaId, idDaLinha, diff);
          }
          // Desfeito durante o envio: a linha já existe, então só se marca.
          if (!(await retirarPendente(acao.seq))) await marcarDesfeitoDepoisDoEnvio(chamar, planilhaId, idDaLinha);
        } else await registrarTentativa(acao.seq);
      } else {
        const resposta = await chamarConferindo<RespostaDeAtualizacao>(chamar, 'atualizarLinha', {
          planilhaId,
          idDaLinha,
          valores,
          ...(acao.antes ? { antes: acao.antes } : {}),
        });
        if ('ok' in resposta || ('erro' in resposta && resposta.erro === 'linha_nao_achada')) await removerPendentes([acao.seq]);
        else {
          if ('conflito' in resposta) await alterarPendentePlanilha(acao.seq, (p) => ({ ...p, conflito: true }));
          await registrarTentativa(acao.seq);
        }
      }
    } catch (erro) {
      if (podeEsperar(erro) || !(erro instanceof ErroScript)) throw erro;
      await registrarTentativa(acao.seq);
    }
  }
}

// ---------- descartar ----------

/**
 * "Descartar" do aviso da fila para entradas que podem ser de planilha. Uma
 * mudança descartada devolve ao cache o que ele tinha antes dela (`antes`), para
 * a tela não continuar mostrando um valor que nunca chegou à planilha; só as
 * colunas que ainda valem o que a mudança pôs (uma edição mais nova não é
 * pisada). Anexo descartado some da vista porque a vista nasce da fila.
 */
export async function descartarEntradasDePlanilha(seqs: readonly number[]): Promise<void> {
  const quais = new Set(seqs);
  const mudancas = (await acoesDaFila()).filter((p) => quais.has(p.seq) && p.acao === 'atualizar' && p.antes);
  if (mudancas.length > 0) {
    await comCache(async (banco) => {
      const tx = banco.transaction(CACHE, 'readwrite');
      tx.done.catch(() => {});
      for (const cache of (await tx.store.getAll()) as Cache[]) {
        let mexeu = false;
        for (const p of mudancas) {
          if (cache.planilhaId !== p.planilhaId) continue;
          const linha = cache.linhas.find((l) => l.id === p.idDaLinha);
          if (!linha) continue;
          for (const [coluna, antigo] of Object.entries(p.antes!)) {
            if (linha.valores[coluna] === p.valores[coluna]) {
              linha.valores[coluna] = antigo;
              mexeu = true;
            }
          }
        }
        if (mexeu) await tx.store.put(cache);
      }
      await tx.done;
    });
  }
  await descartarPendentes(seqs);
}
