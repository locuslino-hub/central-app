// Sincronia com o script: puxa o que mudou no servidor, mescla registro a
// registro (loja.gravarDoServidor) e envia a fila `pendentes`. Nada da fila sai
// antes de o servidor confirmar.
import { TAMANHO_MAXIMO_DO_CORPO } from '../../script/dados';
import { ErroConexao, ErroScript, chamar as chamarScript } from '../conexao/cliente';
import { ErroAgenda, criarEvento, removerEvento } from './agenda';
import { marcarEventosObsoletos } from './eventos';
import {
  assinar as assinarLoja,
  concluirEnvio,
  enfileirarAgenda,
  gravarDoServidor,
  lerDesde,
  lerPendente,
  lerRegistros,
  listarPendentes,
  removerPendentes,
  salvarDesde,
  salvarRelogioDoServidor,
} from './loja';
import type { Colecao, Mudanca, PendenteAgenda, PendenteRegistro, Registro } from './tipos';

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
 *   que ainda não conhece a ação, que responde "código inválido"): fica na fila,
 *   em silêncio, e a próxima rodada tenta de novo. Código de fato recusado já
 *   parou a rodada em `puxar`.
 */
async function enviarAgenda(chamar: Chamar) {
  const acoes = (await listarPendentes()).filter((p): p is PendenteAgenda => p.tipo === 'agenda');
  let mudou = false;
  for (const acao of acoes) {
    // Lê de novo: o dono pode ter desfeito a criação desde que a fila foi lida.
    if (!(await lerPendente(acao.seq))) continue;
    try {
      if (acao.acao === 'criarEvento') {
        await criarEvento(acao.evento, { chamar });
        mudou = true;
        if (await lerPendente(acao.seq)) {
          await removerPendentes([acao.seq]);
        } else {
          // Desfeito enquanto era enviado: o evento já existe e precisa sair.
          await removerEventoCriadoSemQuerer(acao.evento.id, chamar);
        }
      } else {
        await removerEvento(acao.id, { chamar });
        mudou = true;
        await removerPendentes([acao.seq]);
      }
    } catch (erro) {
      if (!(erro instanceof ErroAgenda)) throw erro;
      if (erro.falha === 'sem-internet') throw new ErroConexao();
      if (erro.falha === 'invalido') await removerPendentes([acao.seq]);
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

async function temPendentes(): Promise<boolean> {
  try {
    return (await listarPendentes()).length > 0;
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
    document.removeEventListener('visibilitychange', aoMudarVisibilidade);
    window.removeEventListener('online', disparar);
  };
}
