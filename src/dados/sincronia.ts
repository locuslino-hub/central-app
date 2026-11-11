// Sincronia com o script: puxa o que mudou no servidor, mescla registro a
// registro (loja.gravarDoServidor) e envia a fila `pendentes`. Nada da fila sai
// antes de o servidor confirmar.
import { TAMANHO_MAXIMO_DO_CORPO } from '../../script/dados';
import { ErroConexao, ErroScript, chamar as chamarScript } from '../conexao/cliente';
import { dataValida } from '../../script/agenda';
import { LOTE_NO_MAXIMO } from '../../script/tarefas-google';
import {
  ErroAgenda,
  criarEvento,
  espelharTarefas,
  marcarEventoFeito,
  marcarTarefaGoogle,
  removerEvento,
  type ItemDoEspelho,
} from './agenda';
import { marcarEventosObsoletos } from './eventos';
import { concluirMarcaDeTarefa } from './eventos-feitos';
import {
  assinar as assinarLoja,
  concluirEnvio,
  enfileirarAgenda,
  espelhoDaTarefa,
  esquecerIdDoEspelho,
  gravarDoServidor,
  guardarIdDoEspelho,
  lerIdsDoEspelho,
  lerDesde,
  agendaEsgotada,
  lerPendente,
  lerRegistros,
  listarPendentes,
  registrarTentativa,
  removerPendentes,
  retirarPendente,
  salvarDesde,
  salvarRelogioDoServidor,
} from './loja';
import type {
  Colecao,
  Mudanca,
  PendenteAgenda,
  PendenteEspelharTarefa,
  PendenteEspelho,
  PendenteRegistro,
  Registro,
  Tarefa,
} from './tipos';

export type EstadoSync = 'atualizado' | 'atualizando' | 'sem-internet' | 'por-enviar' | 'erro-codigo';

/** Mesmo formato de `chamar` (conexao/cliente.ts). */
export type Chamar = <T>(acao: string, dados?: object) => Promise<T>;

export type OpcoesSync = {
  chamar?: Chamar;
  /** Pausa entre tentativas quando o script está ocupado. */
  esperar?: (ms: number) => Promise<void>;
};

export const TENTATIVAS_SE_OCUPADO = 3;
const ESPERA_SE_OCUPADO_MS = 1500;
export const ESPERA_APOS_ESCRITA_MS = 2000;
export const INTERVALO_MS = 60_000;
// O script recusa corpo acima de 256 KB; a folga cobre o código e o envelope.
const LIMITE_DO_LOTE = TAMANHO_MAXIMO_DO_CORPO - 4 * 1024;

type RespostaPuxar = { registros: unknown[]; agora: number; agoraDoServidor?: number };
type RespostaEnviar = {
  aceitas: { colecao: string; id: string }[];
  conflitos: unknown[];
  /** Forma inválida para o script: ficam na fila (sem tela ainda; Tarefa 6). */
  recusadas: unknown[];
  substituidas: unknown[];
  /** Relógio do servidor, para conferir carimbos do futuro (0 se não veio). */
  agora: number;
};

// ---- Estado, para a tela (Tarefa 6) ----

let estado: EstadoSync = 'atualizando';
const ouvintesDoEstado = new Set<(estado: EstadoSync) => void>();

export function estadoAtual(): EstadoSync {
  return estado;
}

/** O ouvinte recebe cada troca de estado. Devolve a função que cancela. */
export function assinarEstado(ouvinte: (estado: EstadoSync) => void): () => void {
  ouvintesDoEstado.add(ouvinte);
  return () => {
    ouvintesDoEstado.delete(ouvinte);
  };
}

function mudarEstado(novo: EstadoSync) {
  estado = novo;
  for (const ouvinte of [...ouvintesDoEstado]) {
    try {
      ouvinte(novo);
    } catch (erro) {
      console.error('Ouvinte do estado da sincronia falhou', erro);
    }
  }
}

// ---- Uma rodada ----

const esperarDeVerdade = (ms: number) => new Promise<void>((pronto) => setTimeout(pronto, ms));

function ocupado(erro: unknown): boolean {
  return erro instanceof ErroScript && erro.erro === 'ocupado';
}

async function comTentativas<T>(fazer: () => Promise<T>, esperar: (ms: number) => Promise<void>) {
  for (let vez = 1; ; vez++) {
    try {
      return await fazer();
    } catch (erro) {
      if (!ocupado(erro) || vez >= TENTATIVAS_SE_OCUPADO) throw erro;
      await esperar(ESPERA_SE_OCUPADO_MS * vez);
    }
  }
}

function respostaPuxar(valor: unknown): RespostaPuxar {
  const resposta = valor as RespostaPuxar | null;
  if (!resposta || !Array.isArray(resposta.registros) || !Number.isFinite(resposta.agora)) {
    throw new ErroScript('interno');
  }
  return resposta;
}

function respostaEnviar(valor: unknown): RespostaEnviar {
  const resposta = valor as RespostaEnviar | null;
  if (!resposta || !Array.isArray(resposta.aceitas) || !Array.isArray(resposta.conflitos)) {
    throw new ErroScript('interno');
  }
  const lista = (valor: unknown) => (Array.isArray(valor) ? valor : []);
  return {
    ...resposta,
    recusadas: lista(resposta.recusadas),
    substituidas: lista(resposta.substituidas),
    agora: Number.isFinite(resposta.agora) ? resposta.agora : 0,
  };
}

async function puxar(chamar: Chamar, esperar: (ms: number) => Promise<void>) {
  const desde = await lerDesde();
  const pedir = (de: number) =>
    comTentativas(async () => respostaPuxar(await chamar('puxar', { desde: de })), esperar);
  let resposta = await pedir(desde);
  // Carimbo do servidor menor que o já visto: o arquivo voltou no tempo (cópia
  // restaurada). Puxa tudo; o que este aparelho tem de mais novo volta à fila.
  if (resposta.agora < desde) resposta = await pedir(0);
  // `agora` do servidor como relógio: este aparelho pode estar atrasado.
  await gravarDoServidor(resposta.registros, resposta.agora);
  await salvarDesde(resposta.agora);
  // Script antigo não manda `agoraDoServidor`: a marca é apagada e a conferência de relógio é pulada.
  await salvarRelogioDoServidor(typeof resposta.agoraDoServidor === 'number' ? resposta.agoraDoServidor : null);
}

const chaveDe = (colecao: string, id: string) => JSON.stringify([colecao, id]);

type Envio = { colecao: Colecao; id: string; seqs: number[]; registro: Registro };

/** Lotes abaixo do limite do script. Registro que sozinho passa do limite fica na fila. */
function emLotes(envios: Envio[]): Envio[][] {
  const lotes: Envio[][] = [];
  let atual: Envio[] = [];
  let tamanho = 0;
  for (const envio of envios) {
    const proprio = JSON.stringify({ colecao: envio.colecao, registro: envio.registro }).length + 1;
    if (proprio > LIMITE_DO_LOTE) continue;
    if (atual.length > 0 && tamanho + proprio > LIMITE_DO_LOTE) {
      lotes.push(atual);
      atual = [];
      tamanho = 0;
    }
    atual.push(envio);
    tamanho += proprio;
  }
  if (atual.length > 0) lotes.push(atual);
  return lotes;
}

async function enviar(chamar: Chamar, esperar: (ms: number) => Promise<void>) {
  const pendentes = (await listarPendentes()).filter((p): p is PendenteRegistro => p.tipo === 'registro');
  if (pendentes.length === 0) return;

  // Um envio por registro, na ordem da primeira escrita, com a versão atual.
  const grupos = new Map<string, { colecao: Colecao; id: string; seqs: number[] }>();
  for (const { colecao, id, seq } of pendentes) {
    const chave = chaveDe(colecao, id);
    const grupo = grupos.get(chave) ?? { colecao, id, seqs: [] };
    grupo.seqs.push(seq);
    grupos.set(chave, grupo);
  }
  const lista = [...grupos.values()];
  const registros = await lerRegistros(lista);
  const envios: Envio[] = [];
  const semRegistro: number[] = [];
  lista.forEach((grupo, i) => {
    const registro = registros[i];
    if (registro) envios.push({ ...grupo, registro });
    else semRegistro.push(...grupo.seqs); // nada a enviar: a loja nunca apaga sem lápide
  });
  await removerPendentes(semRegistro);
  // O desde deste puxar: o servidor devolve em `substituidas` o que sobrescrever
  // de outro aparelho e que este ainda não tinha visto.
  const desde = await lerDesde();

  for (const lote of emLotes(envios)) {
    const mudancas = lote.map(({ colecao, registro }) => ({ colecao, registro }));
    const resposta = await comTentativas(
      async () => respostaEnviar(await chamar('enviar', { desde, mudancas })),
      esperar,
    );
    // Conflitos: o servidor tinha versão mais nova. A mesclagem grava a dele,
    // guarda a nossa em avisos e tira os pendentes desse registro.
    await gravarDoServidor(resposta.conflitos, resposta.agora);
    const aceitas = new Set(resposta.aceitas.map(({ colecao, id }) => chaveDe(colecao, id)));
    // Só os seq lidos antes do envio: escrita feita durante o envio fica na fila.
    // Avisos das substituídas e saída dos pendentes vão juntos (uma escrita).
    await concluirEnvio(
      resposta.substituidas,
      lote.filter(({ colecao, id }) => aceitas.has(chaveDe(colecao, id))).flatMap(({ seqs }) => seqs),
      resposta.agora,
    );
  }
}

/**
 * Ações do Google Agenda na fila (Tarefa 12), na ordem em que entraram. Cada
 * uma sai só depois de o script confirmar; o id do evento é do cliente, então
 * tentar de novo nunca duplica.
 * - sem internet: para (a fila fica como está) e a rodada diz `por-enviar`;
 * - pedido inválido: nunca daria certo, sai da fila;
 * - o script ou o Google recusou (ex.: permissão ainda não aprovada, ou script
 *   que ainda não conhece a ação, que responde "código inválido"): a recusa é
 *   contada, a ação fica na fila em silêncio e a próxima rodada tenta de novo.
 *   Passando do limite (`agendaEsgotada`) a sincronia deixa de tentar, mas a
 *   entrada fica guardada e o Painel avisa (AvisoDaFila).
 * Pedido antigo da migração (`migrarTarefaId`, tarefa com hora → compromisso)
 * não vai mais ao Google: tarefa com hora fica tarefa (11/11). Sai da fila e a
 * tarefa fica como está (`largarMigracoesDaFila` faz o mesmo ao abrir o app).
 */
async function enviarAgenda(chamar: Chamar): Promise<void> {
  const acoes = (await listarPendentes()).filter((p): p is PendenteAgenda => p.tipo === 'agenda');
  let mudou = false;
  for (const acao of acoes) {
    if (acao.acao === 'criarEvento' && acao.migrarTarefaId) {
      await retirarPendente(acao.seq);
      continue;
    }
    if (agendaEsgotada(acao)) continue;
    // Lê de novo: o dono pode ter desfeito a criação desde que a fila foi lida.
    if (!(await lerPendente(acao.seq))) continue;
    try {
      if (acao.acao === 'criarEvento') {
        await criarEvento(acao.evento, { chamar });
        mudou = true;
        if (!(await retirarPendente(acao.seq))) {
          // Desfeito enquanto era enviado: o evento já existe e precisa sair.
          await removerEventoCriadoSemQuerer(acao.evento.id, chamar);
        }
      } else {
        await removerEvento(acao.id, { chamar });
        mudou = true;
        await retirarPendente(acao.seq);
      }
    } catch (erro) {
      if (!(erro instanceof ErroAgenda)) throw erro;
      if (erro.falha === 'sem-internet') throw new ErroConexao();
      if (erro.falha === 'invalido') await retirarPendente(acao.seq);
      else await registrarTentativa(acao.seq);
    }
  }
  if (mudou) marcarEventosObsoletos();
}

async function removerEventoCriadoSemQuerer(id: string, chamar: Chamar) {
  try {
    await removerEvento(id, { chamar });
  } catch {
    await enfileirarAgenda({ tipo: 'agenda', acao: 'removerEvento', id });
  }
}

/** Recusa de uma ação de espelho: sem internet para a rodada; pedido inválido sai; o resto conta tentativa. */
async function tratarFalhaDoEspelho(erro: unknown, seqs: readonly number[]) {
  if (!(erro instanceof ErroAgenda)) throw erro;
  if (erro.falha === 'sem-internet') throw new ErroConexao();
  if (erro.falha === 'invalido') await removerPendentes(seqs);
  else for (const seq of seqs) await registrarTentativa(seq);
}

/** Uma tarefa como a espelho a recebe, com o id da espelho se já se sabe. */
function itemDoEspelho(tarefa: Tarefa, googleId: string | undefined): ItemDoEspelho {
  const item: ItemDoEspelho = { id: tarefa.id, titulo: String(tarefa.titulo ?? '').slice(0, 2000), feito: !!tarefa.feito, apagado: !!tarefa.apagado };
  // Dia que não existe nem sai: o script recusaria o lote inteiro.
  if (dataValida(tarefa.data)) item.data = tarefa.data;
  if (googleId !== undefined && /^[A-Za-z0-9_-]{1,256}$/.test(googleId)) item.googleId = googleId;
  return item;
}

/**
 * O espelho no Google (feito espelhado), depois dos registros e da agenda:
 * - `marcarEventoFeito` e `marcarTarefaGoogle` (bloco do Google Tarefas), na
 *   ordem; `gravado: false` (convite, outra agenda, tarefa que sumiu, sem
 *   permissão) só tira da fila: o feito já está na Central;
 * - `espelharTarefa`, uma por tarefa, com a versão atual dela, em lotes. Só
 *   saem da fila as entradas lidas antes do envio: mudança feita durante o
 *   envio vai na próxima rodada. O id da espelho que voltar fica só neste
 *   aparelho (não muda a tarefa: não disputa com edições do outro aparelho).
 *   Tarefa que sumiu ou deixou de ser espelhável sai da fila sem chamada.
 * Falhas como na agenda: sem internet para; o resto conta tentativa e fica.
 */
async function enviarEspelhos(chamar: Chamar): Promise<boolean> {
  const agora = Date.now();
  const espelhos = (await listarPendentes()).filter(
    (p): p is PendenteEspelho => p.tipo === 'espelho' && !agendaEsgotada(p, agora),
  );
  let marcou = false;
  let registrosMudaram = false;
  for (const acao of espelhos) {
    if (acao.acao === 'espelharTarefa' || !(await lerPendente(acao.seq))) continue;
    try {
      const { gravado } =
        acao.acao === 'marcarTarefaGoogle'
          ? await marcarTarefaGoogle(acao.taskId, acao.feito, acao.dia, { chamar })
          : await marcarEventoFeito(acao.id, acao.feito, { chamar });
      if (gravado) marcou = true;
      await retirarPendente(acao.seq);
      // O registro do bloco deixa de estar pendente; não gravado, fica só na Central.
      if (acao.acao === 'marcarTarefaGoogle' && acao.feitoId && (await concluirMarcaDeTarefa(acao.feitoId, acao.feito, gravado))) {
        registrosMudaram = true;
      }
    } catch (erro) {
      await tratarFalhaDoEspelho(erro, [acao.seq]);
      // Pedido recusado como inválido sai da fila: o feito fica só na Central.
      if (acao.acao === 'marcarTarefaGoogle' && acao.feitoId && erro instanceof ErroAgenda && erro.falha === 'invalido') {
        if (await concluirMarcaDeTarefa(acao.feitoId, acao.feito, false)) registrosMudaram = true;
      }
    }
  }
  if (marcou) marcarEventosObsoletos();

  const porTarefa = new Map<string, number[]>();
  for (const acao of espelhos.filter((p): p is PendenteEspelharTarefa => p.acao === 'espelharTarefa')) {
    porTarefa.set(acao.tarefaId, [...(porTarefa.get(acao.tarefaId) ?? []), acao.seq]);
  }
  const ids = [...porTarefa.keys()];
  const registros = (await lerRegistros(ids.map((id) => ({ colecao: 'tarefas' as const, id })))) as (Tarefa | undefined)[];
  const idsDoGoogle = await lerIdsDoEspelho(ids);
  const grupos: { tarefa: Tarefa; seqs: number[]; googleId: string | undefined }[] = [];
  const descartar: number[] = [];
  ids.forEach((id, i) => {
    const tarefa = registros[i];
    // Sumiu, ou deixou de ser espelhável (virou compromisso com hora) sem ser apagada: nada a mandar.
    if (!tarefa || (espelhoDaTarefa(tarefa) === null && !tarefa.apagado)) descartar.push(...porTarefa.get(id)!);
    else grupos.push({ tarefa, seqs: porTarefa.get(id)!, googleId: idsDoGoogle[i] });
  });
  await removerPendentes(descartar);

  for (let i = 0; i < grupos.length; i += LOTE_NO_MAXIMO) {
    const lote = grupos.slice(i, i + LOTE_NO_MAXIMO);
    let resultados;
    try {
      ({ resultados } = await espelharTarefas(lote.map(({ tarefa, googleId }) => itemDoEspelho(tarefa, googleId)), { chamar }));
    } catch (erro) {
      await tratarFalhaDoEspelho(erro, lote.flatMap(({ seqs }) => seqs));
      continue;
    }
    const porId = new Map(resultados.map((r) => [r.id, r]));
    for (const { tarefa, seqs, googleId } of lote) {
      const resultado = porId.get(tarefa.id);
      if (!resultado?.ok) {
        for (const seq of seqs) await registrarTentativa(seq);
        continue;
      }
      await removerPendentes(seqs);
      if (tarefa.apagado || !resultado.googleId) await esquecerIdDoEspelho(tarefa.id);
      else if (resultado.googleId !== googleId) await guardarIdDoEspelho(tarefa.id, resultado.googleId);
    }
  }
  return registrosMudaram;
}

/**
 * Há o que enviar? O espelho no Google não conta: os dados já estão na fila
 * de registros (ou no Drive), e o Google só copia.
 */
async function temPendentes(): Promise<boolean> {
  try {
    return (await listarPendentes()).some((p) => p.tipo !== 'espelho');
  } catch {
    return true;
  }
}

/**
 * R14: código recusado ou script com problema dão `erro-codigo`; sem rede ou
 * script ocupado demais, `por-enviar` se há o que enviar, senão `sem-internet`.
 * Em todos os casos a fila fica como está.
 */
async function estadoDoErro(erro: unknown): Promise<EstadoSync> {
  if (erro instanceof ErroConexao || ocupado(erro)) {
    return (await temPendentes()) ? 'por-enviar' : 'sem-internet';
  }
  // Só o erro, nunca dados: o conteúdo é do dono.
  if (!(erro instanceof ErroScript)) console.error('Falha inesperada na sincronia', erro);
  return 'erro-codigo';
}

async function rodada({ chamar = chamarScript, esperar = esperarDeVerdade }: OpcoesSync) {
  mudarEstado('atualizando');
  let final: EstadoSync;
  try {
    await puxar(chamar, esperar);
    await enviar(chamar, esperar);
    await enviarAgenda(chamar);
    // O resultado dos blocos do Google Tarefas muda registros: saem já nesta rodada.
    if (await enviarEspelhos(chamar)) await enviar(chamar, esperar);
    final = (await temPendentes()) ? 'por-enviar' : 'atualizado';
  } catch (erro) {
    final = await estadoDoErro(erro);
  }
  mudarEstado(final);
  return final;
}

let emAndamento: Promise<EstadoSync> | null = null;
let deNovo = false;

/**
 * Uma sincronia por vez. Chamada durante outra devolve a mesma promessa e
 * pede mais uma rodada no fim, para levar o que foi escrito nesse meio tempo.
 * Nunca rejeita.
 */
export function sincronizar(opcoes: OpcoesSync = {}): Promise<EstadoSync> {
  if (emAndamento) {
    deNovo = true;
    return emAndamento;
  }
  emAndamento = (async () => {
    try {
      let final: EstadoSync;
      do {
        deNovo = false;
        final = await rodada(opcoes);
      } while (deNovo);
      return final;
    } finally {
      emAndamento = null;
    }
  })();
  return emAndamento;
}

// ---- Quando sincronizar ----

export type OpcoesInicio = {
  sincronizar?: () => Promise<EstadoSync>;
  assinar?: (ouvinte: (mudanca: Mudanca) => void) => () => void;
};

/**
 * Sincroniza ao abrir, ao voltar ao app, quando a internet volta, 2 s depois
 * da última escrita local e a cada 60 s com o app à vista. Devolve a função
 * que desliga tudo.
 */
export function iniciarSincronia(opcoes: OpcoesInicio = {}): () => void {
  const rodar = opcoes.sincronizar ?? (() => sincronizar());
  const disparar = () => {
    rodar().catch((erro: unknown) => console.error('Falha ao sincronizar', erro));
  };

  let espera: ReturnType<typeof setTimeout> | undefined;
  const aoEscrever = (mudanca: Mudanca) => {
    if (mudanca.remota) return; // veio do servidor: não há o que enviar
    clearTimeout(espera);
    espera = setTimeout(disparar, ESPERA_APOS_ESCRITA_MS);
  };
  const aoMudarVisibilidade = () => {
    if (document.visibilityState === 'visible') disparar();
  };

  const pararDeOuvir = (opcoes.assinar ?? assinarLoja)(aoEscrever);
  document.addEventListener('visibilitychange', aoMudarVisibilidade);
  window.addEventListener('online', disparar);
  const relogio = setInterval(() => {
    if (document.visibilityState !== 'hidden') disparar();
  }, INTERVALO_MS);
  disparar();

  return () => {
    pararDeOuvir();
    clearTimeout(espera);
    clearInterval(relogio);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', aoMudarVisibilidade);
    if (typeof window !== 'undefined') window.removeEventListener('online', disparar);
  };
}
