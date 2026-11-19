// A conversa do chat (Tarefa 8): mensagens e o estado de cada cartão. Mora
// fora dos componentes para o chat do painel direito e o da página `#/chat`
// mostrarem a mesma conversa, e para voltar a uma tela não guardar de novo.
// Não é guardada nem sincronizada: o que fica são os itens criados. Todo item
// é guardado na hora, mesmo com certeza baixa (o app pode ser fechado logo
// depois); o cartão mostra o resultado com Trocar sala e Desfazer para corrigir.
//
// Cada cartão tem a sua fila: guardar, trocar a sala e desfazer o mesmo
// cartão acontecem um depois do outro, na ordem em que o dono apertou.
//
// V02.1: o chat também entende o que o "Pode falar" entendia. Ideia dita, lista, leitura e gasto não viram cartão de
// tarefa: viram um cartão de resultado (`EstadoResultado`, com Desfazer, Guardar como ideia, Trocar categoria, Pôr mesmo
// assim). Tudo o mais é tarefa de hoje (ou compromisso), com o cartão de sempre e um botão "Guardar como ideia".
// O áudio gravado junto (opcional) só fica numa ideia: se a frase virou tarefa, ele espera o "Guardar como ideia".

import { horaEmLisboa } from '../../script/agenda';
import { ErroAgenda } from '../dados/agenda';
import { avisoDaAgenda, trocarSalaDoCompromisso } from '../dados/compromisso';
import { lerRegistros, listar, salvar } from '../dados/loja';
import type { Tarefa } from '../dados/tipos';
import { apagarAudioDoDrive } from '../voz/apagar-audio';
import { limparProblemaDeAudio, marcarProblemaDeAudio, removerAudio } from '../voz/audios-pendentes';
import { enviarAudio } from '../voz/gravador';
import { TEXTO_DA_TROCA_QUE_FALHOU } from '../ui/pastas-textos';
import { executarFrase, guardarFraseComoIdeia, validarFrase, type ResultadoDaFrase } from './executar';
import { criarItem, interpretar, type ItemDoChat } from './interpretar';
import { aprender, lembrarPessoa } from './memoria';

/**
 * `salvando`: gravação em curso. `salvo`: guardado, com Desfazer.
 * `desfazendo`: apagando. `desfeito` e `descartado`: nada ficou. `trocado`: virou ideia. `erro`: não
 * guardou (falha da loja); Guardar tenta de novo, Descartar desiste.
 */
export type Situacao = 'salvando' | 'salvo' | 'desfazendo' | 'desfeito' | 'descartado' | 'trocado' | 'erro';

/** Por que a sala mudou no cartão, para dizer o que foi (ou será) aprendido. */
export type Escolha =
  | { tipo: 'pessoa-nova'; nome: string }
  | { tipo: 'palavra'; termo: string }
  | { tipo: 'pessoa'; nome: string }
  | { tipo: 'sem-aprender' };

/** O que a memória aprende com a escolha. Em cartão que não guardou (erro), espera o Guardar. */
export type Aprendizado = { tipo: 'pessoa-nova'; nome: string } | { tipo: 'termo'; termo: string };

export type EstadoCartao = {
  id: string;
  item: ItemDoChat;
  situacao: Situacao;
  /** As salas estão abertas para escolher (Trocar sala, Não é pessoa). */
  trocando: boolean;
  escolha?: Escolha;
  /** Aprendizado à espera do Guardar; some com Descartar. */
  pendente?: Aprendizado;
  /** Falha que o dono precisa saber ("Não consegui desfazer…"). */
  aviso?: string;
  tarefaId?: string;
  /** Compromisso: o id do evento no Google Agenda (do cliente, também na fila se ainda não saiu). */
  eventoId?: string;
  /** Cresce a cada ação concluída no cartão: a tela usa para mover o foco. */
  passos: number;
  /** Qual ação concluiu por último (mesmo sem mudar nada). */
  ultimaAcao?: Acao;
  /** A frase inteira, para o "Guardar como ideia". */
  frase?: string;
  /** O que a Central diz sobre este cartão desde o começo (por que a planilha não recebeu, o áudio que espera). */
  nota?: string;
};

/** Ações do dono no cartão; a tela pede foco para depois de uma delas. */
export type Acao = 'guardar' | 'descartar' | 'desfazer' | 'trocar' | 'manter' | 'nao-e-pessoa' | 'escolher' | 'ideia';

/** O cartão de resultado: o que foi gravado numa ideia, lista, leitura ou gasto, com os botões do `ResultadoDaFrase`. */
export type EstadoResultado = {
  id: string;
  frase: string;
  resultado: ResultadoDaFrase;
  desfeito: boolean;
  /** Uma ação do cartão em andamento: os botões ficam desligados. */
  ocupado: boolean;
  /** Falha ou aviso que o dono precisa ler (`role="alert"`). */
  aviso?: string;
  /** O avanço do envio do áudio ("Enviando o áudio…"), numa região viva do cartão. */
  avisoDoAudio: string | null;
  /** Cresce a cada ação concluída: a tela leva o foco ao cartão. */
  foco: number;
  /** O áudio que este cartão guarda (só ideia). */
  audioId: string | null;
};

export type Mensagem =
  | { id: string; de: 'dono'; texto: string }
  | { id: string; de: 'central'; texto: string; cartoes: EstadoCartao[]; resultados: EstadoResultado[]; esperando: boolean };

/** O áudio gravado junto da frase. */
export type AudioGravado = { blob: Blob; segundos: number };
export type OpcoesDaFrase = {
  /** A pasta onde o dono está (`#/sala/:id/pasta/:pastaId`): a fala vai direto para ela. */
  pastaAtual?: string;
  audio?: AudioGravado;
};

let mensagens: Mensagem[] = [];
let contador = 0;
/** Desfazer de cada cartão guardado. Fora do estado: é função, não dado da tela. */
const desfazeres = new Map<string, () => Promise<void>>();
/** A última ação de cada cartão: a próxima espera por ela. */
const filas = new Map<string, Promise<void>>();
const ouvintes = new Set<() => void>();
/** O áudio gravado cuja frase não virou ideia, por mensagem da Central: espera o "Guardar como ideia" (ou se perde). */
const audiosEsperando = new Map<string, AudioGravado>();
/** Ids de áudio cujo Desfazer já foi feito: se o envio voltar tarde, nada fica nem aparece. */
const cancelados = new Set<string>();

const novoId = () => `m${++contador}`;

function mudar(novas: Mensagem[]) {
  mensagens = novas;
  for (const ouvinte of [...ouvintes]) ouvinte();
}

export function lerConversa(): readonly Mensagem[] {
  return mensagens;
}

export function assinarConversa(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

/** Começa uma conversa vazia (testes). */
export function limparConversa() {
  contador = 0;
  desfazeres.clear();
  filas.clear();
  audiosEsperando.clear();
  cancelados.clear();
  mudar([]);
}

function acharCartao(id: string): EstadoCartao | undefined {
  for (const mensagem of mensagens) {
    if (mensagem.de !== 'central') continue;
    const cartao = mensagem.cartoes.find((c) => c.id === id);
    if (cartao) return cartao;
  }
  return undefined;
}

function mudarCartao(id: string, mudanca: Partial<EstadoCartao>) {
  mudar(
    mensagens.map((mensagem) =>
      mensagem.de === 'central' && mensagem.cartoes.some((c) => c.id === id)
        ? { ...mensagem, cartoes: mensagem.cartoes.map((c) => (c.id === id ? { ...c, ...mudanca } : c)) }
        : mensagem,
    ),
  );
}

/**
 * Mudança que encerra uma ação: conta um passo e diz qual ação foi, para a
 * tela mover o foco só depois da ação que pediu. Ação que não muda nada também
 * conclui, para nenhum pedido de foco ficar esperando.
 */
function concluir(id: string, acao: Acao, mudanca: Partial<EstadoCartao> = {}) {
  const cartao = acharCartao(id);
  if (cartao) mudarCartao(id, { ...mudanca, passos: cartao.passos + 1, ultimaAcao: acao });
}

/** Roda a ação depois das anteriores do mesmo cartão. Erro não trava a fila. */
function naFila(id: string, acao: () => Promise<void>): Promise<void> {
  const vez = (filas.get(id) ?? Promise.resolve()).then(acao).catch((erro: unknown) => {
    console.error('Ação do cartão falhou', erro);
  });
  filas.set(id, vez);
  return vez;
}

type MensagemDaCentral = Extract<Mensagem, { de: 'central' }>;

function mudarMensagem(id: string, mudanca: Partial<MensagemDaCentral>) {
  mudar(mensagens.map((m) => (m.id === id && m.de === 'central' ? { ...m, ...mudanca } : m)));
}

function mensagemDoCartao(id: string): MensagemDaCentral | undefined {
  return mensagens.find((m): m is MensagemDaCentral => m.de === 'central' && m.cartoes.some((c) => c.id === id));
}

function mensagemDoResultado(id: string): MensagemDaCentral | undefined {
  return mensagens.find((m): m is MensagemDaCentral => m.de === 'central' && m.resultados.some((r) => r.id === id));
}

function acharResultado(id: string): EstadoResultado | undefined {
  return mensagemDoResultado(id)?.resultados.find((r) => r.id === id);
}

function mudarResultado(id: string, mudanca: Partial<EstadoResultado>) {
  mudar(
    mensagens.map((m) =>
      m.de === 'central' && m.resultados.some((r) => r.id === id)
        ? { ...m, resultados: m.resultados.map((r) => (r.id === id ? { ...r, ...mudanca } : r)) }
        : m,
    ),
  );
}

/** Termina uma ação do cartão de resultado e pede o foco para ele (o botão apertado sumiu ou mudou). */
function concluirResultado(id: string, mudanca: Partial<EstadoResultado> = {}) {
  const atual = acharResultado(id);
  if (atual) mudarResultado(id, { ...mudanca, ocupado: false, foco: atual.foco + 1 });
}

function novoResultado(frase: string, resultado: ResultadoDaFrase): EstadoResultado {
  return { id: novoId(), frase, resultado, desfeito: false, ocupado: false, avisoDoAudio: null, foco: 0, audioId: resultado.audioId ?? null };
}

/** A resposta da Central acima dos cartões. */
export function fala(itens: readonly ItemDoChat[]): string {
  if (itens.some((item) => item.certeza === 'baixa')) return 'Anotei. Confira o cartão.';
  const nova = itens.find((item) => item.pessoaNova)?.pessoaNova;
  return nova ? `Anotei. Ainda não conheço ${nova}.` : 'Anotei.';
}

/** Grava na memória o que a escolha ensinou, e devolve o item com a pessoa, se houver. */
async function aplicar(aprendizado: Aprendizado, item: ItemDoChat): Promise<ItemDoChat> {
  if (item.salaId === null) return item;
  if (aprendizado.tipo === 'pessoa-nova') {
    const pessoa = await lembrarPessoa(aprendizado.nome, item.salaId);
    return { ...item, pessoaId: pessoa.id, pessoaNome: pessoa.nome };
  }
  await aprender(aprendizado.termo, item.salaId);
  return item;
}

/** Compromisso numa hora que não existe em Lisboa (último domingo de março, 01:00 às 01:59). */
function naoExisteEmLisboa(item: ItemDoChat): boolean {
  if (item.tipo !== 'compromisso' || !item.data || !item.inicio || !item.fim) return false;
  return horaEmLisboa(item.data, item.inicio) === null || horaEmLisboa(item.data, item.fim) === null;
}

/** Grava o item do cartão, com o que estava à espera do Guardar. */
async function gravar(id: string) {
  const cartao = acharCartao(id);
  if (!cartao) return;
  mudarCartao(id, { situacao: 'salvando' });
  try {
    const item = cartao.pendente ? await aplicar(cartao.pendente, cartao.item) : cartao.item;
    const criado = await criarItem(item);
    desfazeres.set(id, criado.desfazer);
    concluir(id, 'guardar', {
      situacao: 'salvo',
      item,
      tarefaId: criado.tarefa?.id,
      eventoId: criado.eventoId,
      pendente: undefined,
      // Compromisso que não chegou à agenda: o dono sabe, e a fila tenta de novo.
      aviso: criado.agenda ? (avisoDaAgenda(criado.agenda) ?? undefined) : undefined,
    });
  } catch (erro) {
    console.error('Não consegui guardar o item do chat', erro);
    // Hora do salto do horário de verão: tentar de novo falharia sempre igual.
    const horaInexistente = erro instanceof ErroAgenda && erro.falha === 'invalido' && naoExisteEmLisboa(cartao.item);
    concluir(id, 'guardar', {
      situacao: 'erro',
      aviso: horaInexistente ? 'Essa hora não existe em Lisboa neste dia' : undefined,
    });
  }
}

const TEXTO_DO_AUDIO_SEM_IDEIA = 'Só ideias guardam áudio. Toque em Guardar como ideia para guardar este áudio.';
const TEXTO_AUDIO_NO_DRIVE = 'O áudio continua no Drive.';

/** Relê a ideia dona do áudio: apagada (lápide) ou inexistente. Se a leitura falhar, não presume nada. */
async function ideiaApagadaOuSumida(audioId: string): Promise<boolean> {
  try {
    const dona = (await listar('ideias', { comApagados: true })).find((i) => i.audioId === audioId);
    return !dona || dona.apagado === true;
  } catch {
    return false;
  }
}

/** Pede ao Drive que apague o áudio de uma ideia desfeita; se não der, o cartão avisa. */
function apagarDoDrive(audioId: string, resultadoId: string) {
  void apagarAudioDoDrive(audioId).then((apagou) => {
    if (!apagou) mudarResultado(resultadoId, { aviso: TEXTO_AUDIO_NO_DRIVE });
  });
}

/**
 * Envia o áudio da ideia ao Drive, DEPOIS de o texto estar gravado: um áudio que falha nunca leva o texto junto.
 * O avanço aparece no cartão enquanto ele for o do áudio e a ideia não tiver sido desfeita.
 */
async function enviarOAudio(resultadoId: string, audioId: string, audio: AudioGravado) {
  const vigente = () => acharResultado(resultadoId)?.audioId === audioId && !cancelados.has(audioId);
  const dizer = (texto: string | null) => {
    if (vigente()) mudarResultado(resultadoId, { avisoDoAudio: texto });
  };
  dizer('Enviando o áudio…');
  try {
    const envio = await enviarAudio(audioId, audio.blob);
    if ('erro' in envio && !cancelados.has(audioId)) await marcarProblemaDeAudio(audioId, 'sem_espaco').catch(() => {});
    if (cancelados.has(audioId)) {
      // Desfez a ideia enquanto o áudio ia: o que ficou na fila sai; o que já está no Drive vai para a lixeira (privacidade).
      if ('fila' in envio) await removerAudio(audioId).catch(() => {});
      else if ('driveId' in envio) apagarDoDrive(audioId, resultadoId);
      return;
    }
    // A ideia pode ter sido apagada (em outra tela ou aparelho) enquanto o áudio ia: o áudio não fica no Drive.
    if ('driveId' in envio && (await ideiaApagadaOuSumida(audioId))) {
      apagarDoDrive(audioId, resultadoId);
      return;
    }
    if ('driveId' in envio) dizer('Áudio guardado no Drive.');
    else if ('fila' in envio) dizer('O áudio vai para o Drive quando a internet voltar.');
    else dizer('O áudio não coube neste aparelho; só o texto ficou guardado.');
  } catch (erro) {
    // Recusado de vez pelo Drive ou falha do envio: a ideia mostra o aviso mesmo depois de este cartão sair.
    if (!cancelados.has(audioId)) {
      const recusado = (erro as { name?: string } | null)?.name === 'ErroAudioRecusado';
      await marcarProblemaDeAudio(audioId, recusado ? 'recusado' : 'falhou').catch(() => {});
    }
    dizer('O texto ficou guardado, mas o áudio não pôde ser enviado.');
  }
}

/** Põe um cartão de resultado na mensagem, e manda o áudio ao Drive se ele ficou numa ideia. */
function mostrarResultado(mensagemId: string, frase: string, resultado: ResultadoDaFrase, audio?: AudioGravado): EstadoResultado {
  const estado = novoResultado(frase, resultado);
  const atual = mensagens.find((m): m is MensagemDaCentral => m.id === mensagemId && m.de === 'central');
  mudarMensagem(mensagemId, { resultados: [...(atual?.resultados ?? []), estado], esperando: false });
  if (audio && resultado.audioId) void enviarOAudio(estado.id, resultado.audioId, audio);
  return estado;
}

/**
 * Manda a frase. A mensagem do dono e o lugar da resposta entram na hora, na ordem em que foram ditas. Ideia dita, lista,
 * leitura e gasto viram um cartão de resultado; o resto é tarefa ou compromisso, e cada item já é guardado, com qualquer
 * certeza. Frase vazia ou longa demais não é mandada (a tela mostra o aviso antes: `validarFrase`).
 */
export async function enviar(frase: string, opcoes: OpcoesDaFrase = {}): Promise<void> {
  const texto = frase.trim();
  if (validarFrase(texto)) return;
  const resposta = novoId();
  mudar([
    ...mensagens,
    { id: novoId(), de: 'dono', texto },
    { id: resposta, de: 'central', texto: '', cartoes: [], resultados: [], esperando: true },
  ]);

  const { audio, pastaAtual } = opcoes;
  const audioId = audio ? crypto.randomUUID() : undefined;
  let nota: string | undefined;
  try {
    const saida = await executarFrase(texto, {
      ...(pastaAtual ? { pastaAtual } : {}),
      ...(audio && audioId ? { audio: { id: audioId, segundos: audio.segundos } } : {}),
    });
    if (saida.tipo === 'resultado') {
      // O texto já está gravado; só então o áudio vai ao Drive (se a frase virou ideia).
      if (audio && !saida.resultado.audioId) audiosEsperando.set(resposta, audio);
      mudarMensagem(resposta, { texto: 'Anotei.' });
      const estado = mostrarResultado(resposta, texto, saida.resultado, audio);
      if (audio && !saida.resultado.audioId) mudarResultado(estado.id, { avisoDoAudio: TEXTO_DO_AUDIO_SEM_IDEIA });
      return;
    }
    nota = saida.nota;
  } catch (erro) {
    console.error('Não consegui guardar a frase', erro);
    mudarMensagem(resposta, { texto: 'Não consegui guardar agora. Tente de novo.', esperando: false });
    return;
  }

  let itens: ItemDoChat[];
  try {
    itens = await interpretar(texto);
  } catch (erro) {
    console.error('Não consegui entender a frase', erro);
    mudarMensagem(resposta, { texto: 'Não consegui ler a frase agora. Tente de novo.', esperando: false });
    return;
  }
  if (audio) {
    audiosEsperando.set(resposta, audio);
    nota = [nota, TEXTO_DO_AUDIO_SEM_IDEIA].filter(Boolean).join(' ');
  }
  const cartoes: EstadoCartao[] = itens.map((item) => ({
    id: novoId(),
    item,
    situacao: 'salvando',
    // Sem sala e sem pessoa nova para perguntar: as salas já ficam à vista.
    trocando: item.salaId === null && !item.pessoaNova,
    passos: 0,
    frase: texto,
    ...(nota ? { nota } : {}),
  }));
  mudarMensagem(resposta, { texto: fala(itens), cartoes, esperando: false });
  await Promise.all(cartoes.map((cartao) => naFila(cartao.id, () => gravar(cartao.id))));
}

/** Guardar de novo o item que não guardou (erro da loja). */
export function confirmar(id: string): Promise<void> {
  return naFila(id, async () => {
    const situacao = acharCartao(id)?.situacao;
    if (situacao === 'erro') await gravar(id);
    else concluir(id, 'guardar');
  });
}

/** Descartar o item que não guardou: o que esperava o Guardar também não é aprendido. */
export function descartar(id: string): Promise<void> {
  return naFila(id, async () => {
    const situacao = acharCartao(id)?.situacao;
    if (situacao === 'erro') {
      concluir(id, 'descartar', { situacao: 'descartado', pendente: undefined });
    } else concluir(id, 'descartar');
  });
}

/**
 * Desfazer do cartão: apaga este item (ver `criarItem`). Só depois de apagar o
 * cartão diz "Desfeito"; se falhar, o item segue guardado e o cartão avisa.
 */
export function desfazerCartao(id: string): Promise<void> {
  return naFila(id, async () => {
    const reverter = desfazeres.get(id);
    const cartao = acharCartao(id);
    if (!reverter || cartao?.situacao !== 'salvo') {
      concluir(id, 'desfazer');
      return;
    }
    mudarCartao(id, { situacao: 'desfazendo', aviso: undefined });
    try {
      await reverter();
      desfazeres.delete(id);
      concluir(id, 'desfazer', { situacao: 'desfeito' });
    } catch (erro) {
      console.error('Não consegui desfazer o item do chat', erro);
      concluir(id, 'desfazer', { situacao: 'salvo', aviso: 'Não consegui desfazer. Tente de novo.' });
    }
  });
}

export function abrirTroca(id: string) {
  concluir(id, 'trocar', { trocando: true });
}

/** "Manter a sala": fecha a escolha sem mudar nada. */
export function fecharTroca(id: string) {
  concluir(id, 'manter', { trocando: false });
}

/** "Não é pessoa": tira a pergunta e abre as salas; a sala escolhida não cria pessoa. */
export function naoEPessoa(id: string) {
  const cartao = acharCartao(id);
  if (!cartao?.item.pessoaNova) {
    concluir(id, 'nao-e-pessoa');
    return;
  }
  concluir(id, 'nao-e-pessoa', { item: { ...cartao.item, pessoaNova: undefined }, trocando: true });
}

/**
 * Escolha de sala no cartão.
 * - Resposta a "Em que sala fica Renata?": guarda a pessoa com essa sala, e a
 *   próxima frase não pergunta.
 * - Trocar sala: aprende com o termo que decidiu (a palavra guardada ou a
 *   pessoa cadastrada).
 * - Sala dita na frase, item sem pista ou "Não é pessoa": só troca.
 * Em cartão que não guardou (erro), o aprendizado espera o Guardar.
 */
export function escolherSala(id: string, salaId: string): Promise<void> {
  return naFila(id, async () => {
    const cartao = acharCartao(id);
    if (!cartao || !['erro', 'salvo'].includes(cartao.situacao)) {
      concluir(id, 'escolher');
      return;
    }
    const { item } = cartao;
    let novo: ItemDoChat = { ...item, salaId };
    if (item.pastaId && salaId !== item.salaId) {
      // A pasta comum é de uma sala só: em outra sala a tarefa deixa o tema.
      const { pastaId: _pasta, temaNome: _tema, ...semTema } = novo;
      novo = semTema;
    }
    let aprendizado: Aprendizado | undefined;
    let escolha: Escolha;

    if (item.pessoaNova && item.salaId === null) {
      aprendizado = { tipo: 'pessoa-nova', nome: item.pessoaNova };
      escolha = { tipo: 'pessoa-nova', nome: item.pessoaNova };
      novo = { ...novo, pessoaNova: undefined, pessoaNome: item.pessoaNova, motivoSala: 'pessoa' };
    } else if (cartao.pendente?.tipo === 'pessoa-nova') {
      // A pessoa nova ainda espera o Guardar: vai para a sala escolhida por último.
      aprendizado = cartao.pendente;
      escolha = { tipo: 'pessoa-nova', nome: cartao.pendente.nome };
    } else if (item.motivoSala === 'memoria' && item.termoSala) {
      aprendizado = { tipo: 'termo', termo: item.termoSala };
      escolha = { tipo: 'palavra', termo: item.termoSala };
    } else if (item.motivoSala === 'pessoa' && item.pessoaNome) {
      aprendizado = { tipo: 'termo', termo: item.pessoaNome };
      escolha = { tipo: 'pessoa', nome: item.pessoaNome };
    } else {
      escolha = { tipo: 'sem-aprender' };
    }

    const guardado = cartao.situacao === 'salvo';
    if (guardado && aprendizado) {
      try {
        novo = await aplicar(aprendizado, novo);
      } catch (erro) {
        console.error('Não consegui guardar o que aprendi', erro);
        escolha = { tipo: 'sem-aprender' };
      }
    }
    concluir(id, 'escolher', { item: novo, trocando: false, escolha, pendente: guardado ? undefined : aprendizado });
    if (guardado && cartao.tarefaId) await moverTarefa(id, cartao.tarefaId, novo, cartao);
    else if (guardado && cartao.eventoId) await moverCompromisso(id, cartao.eventoId, novo);
  });
}

/**
 * Lê a tarefa na hora (pode ter mudado no outro aparelho) e troca só sala e
 * pessoa. Confere de novo, logo antes de gravar, que o cartão segue guardado:
 * nunca regrava um item desfeito. Se não gravar, o cartão volta à sala antiga
 * (`antes`) e avisa, como em moverCompromisso.
 */
async function moverTarefa(cartaoId: string, tarefaId: string, item: ItemDoChat, antes: EstadoCartao) {
  try {
    const [guardada] = (await lerRegistros([{ colecao: 'tarefas', id: tarefaId }])) as (Tarefa | undefined)[];
    if (!guardada || guardada.apagado) return;
    if (acharCartao(cartaoId)?.situacao !== 'salvo') return;
    let tarefa: Tarefa = { ...guardada, salaId: item.salaId };
    if (guardada.pastaId && guardada.salaId !== item.salaId) {
      const { pastaId: _pasta, ...semTema } = tarefa;
      tarefa = semTema;
    }
    if (item.pessoaId) tarefa.pessoaId = item.pessoaId;
    await salvar('tarefas', tarefa);
  } catch (erro) {
    console.error('Não consegui trocar a sala do item', erro);
    // O cartão já mostrava a sala nova: volta à antiga, que é a que a tarefa tem.
    mudarCartao(cartaoId, {
      item: antes.item,
      escolha: antes.escolha,
      pendente: antes.pendente,
      aviso: 'Não consegui trocar a sala. Tente de novo.',
    });
  }
}

/** Troca a sala do compromisso (na fila ou no Google Agenda); se falhar, o cartão avisa. */
async function moverCompromisso(cartaoId: string, eventoId: string, item: ItemDoChat) {
  try {
    if (acharCartao(cartaoId)?.situacao !== 'salvo') return;
    await trocarSalaDoCompromisso(eventoId, item.salaId);
  } catch (erro) {
    console.error('Não consegui trocar a sala do compromisso', erro);
    mudarCartao(cartaoId, { aviso: 'Não consegui trocar a sala na agenda.' });
  }
}

/**
 * "Guardar como ideia" no cartão de tarefa ou compromisso: a ideia nasce primeiro (a frase nunca se perde), depois os
 * itens desta frase saem. Item que não puder sair continua guardado e o cartão avisa: nada some em silêncio nem fica
 * em dobro sem aviso. O áudio gravado junto, se houver, vai com a ideia.
 */
export function guardarComoIdeia(id: string): Promise<void> {
  return naFila(id, async () => {
    const mensagem = mensagemDoCartao(id);
    const cartao = acharCartao(id);
    if (!mensagem || cartao?.situacao !== 'salvo' || !cartao.frase) {
      concluir(id, 'ideia');
      return;
    }
    // Os outros itens da mesma frase terminam de guardar antes (eles também saem).
    await Promise.all(mensagem.cartoes.filter((c) => c.id !== id).map((c) => filas.get(c.id)));
    const alvos = (mensagemDoCartao(id)?.cartoes ?? []).filter((c) => c.id === id || c.situacao === 'salvo');
    for (const alvo of alvos) mudarCartao(alvo.id, { situacao: 'desfazendo', aviso: undefined });
    const audio = audiosEsperando.get(mensagem.id);
    let ideia: ResultadoDaFrase;
    try {
      const audioId = audio ? crypto.randomUUID() : null;
      ideia = await guardarFraseComoIdeia(cartao.frase, audio && audioId ? { audio: { id: audioId, segundos: audio.segundos } } : {});
    } catch (erro) {
      console.error('Não consegui guardar como ideia', erro);
      for (const alvo of alvos) mudarCartao(alvo.id, { situacao: 'salvo' });
      concluir(id, 'ideia', { aviso: 'Não consegui guardar como ideia. O item continua como estava; tente de novo.' });
      return;
    }
    audiosEsperando.delete(mensagem.id);
    const saidas = await Promise.allSettled(alvos.map((alvo) => desfazeres.get(alvo.id)?.() ?? Promise.resolve()));
    const ficaram: ItemDoChat[] = [];
    alvos.forEach((alvo, i) => {
      if (saidas[i]!.status === 'fulfilled') {
        desfazeres.delete(alvo.id);
        concluir(alvo.id, 'ideia', { situacao: 'trocado' });
      } else {
        console.error('Não consegui tirar o item ao guardar como ideia', (saidas[i] as PromiseRejectedResult).reason);
        ficaram.push(alvo.item);
        concluir(alvo.id, 'ideia', { situacao: 'salvo', aviso: 'Não consegui tirar este item; ele continua guardado.' });
      }
    });
    const nomes = ficaram.map((item) => `“${item.titulo}”`).join(', ');
    const aviso = ficaram.length === 1 ? ` Atenção: não consegui tirar ${nomes}; ele continua guardado.` : ` Atenção: não consegui tirar ${nomes}; eles continuam guardados.`;
    mostrarResultado(mensagem.id, cartao.frase, ficaram.length ? { ...ideia, detalhe: `${ideia.detalhe}${aviso}` } : ideia, audio);
  });
}

// ---- O cartão de resultado (ideia, lista, leitura, gasto) ----

/** Desfaz o que foi gravado (e o áudio que esperava rede). */
export function desfazerResultado(id: string): Promise<void> {
  return naFila(id, async () => {
    const atual = acharResultado(id);
    if (!atual || atual.desfeito) return;
    const idDoAudio = atual.audioId;
    // Marca antes: um envio ainda em andamento vai voltar sabendo que foi desfeito.
    if (idDoAudio) cancelados.add(idDoAudio);
    mudarResultado(id, { ocupado: true, aviso: undefined });
    try {
      await atual.resultado.desfazer();
      if (idDoAudio) {
        await removerAudio(idDoAudio).catch(() => {});
        await limparProblemaDeAudio(idDoAudio).catch(() => {});
        // Se o áudio já tinha ido ao Drive, ele sai de lá também (sem esperar: o Desfazer não trava).
        apagarDoDrive(idDoAudio, id);
      }
      concluirResultado(id, { desfeito: true, avisoDoAudio: null });
    } catch (erro) {
      if (idDoAudio) cancelados.delete(idDoAudio);
      console.error('Não consegui desfazer', erro);
      concluirResultado(id, { aviso: 'Não consegui desfazer agora. Tente de novo.' });
    }
  });
}

/** Troca a lista, leitura ou gasto por uma ideia com a mesma frase, levando o áudio, se houver. */
export function guardarResultadoComoIdeia(id: string): Promise<void> {
  return naFila(id, async () => {
    const atual = acharResultado(id);
    const mensagem = mensagemDoResultado(id);
    if (!atual || !mensagem || atual.desfeito || !atual.resultado.guardarComoIdeia) return;
    mudarResultado(id, { ocupado: true, aviso: undefined });
    try {
      const audio = audiosEsperando.get(mensagem.id);
      const audioId = audio ? crypto.randomUUID() : null;
      const novo = await atual.resultado.guardarComoIdeia(audio && audioId ? { id: audioId, segundos: audio.segundos } : undefined);
      audiosEsperando.delete(mensagem.id);
      concluirResultado(id, { resultado: novo, desfeito: false, avisoDoAudio: null, audioId: novo.audioId ?? null });
      if (audio && novo.audioId) void enviarOAudio(id, novo.audioId, audio);
    } catch (erro) {
      console.error('Não consegui guardar como ideia', erro);
      concluirResultado(id, { aviso: 'Não consegui guardar como ideia. O item continua como estava; tente de novo.' });
    }
  });
}

/** Itens de lista que já estavam na lista: grava os repetidos (o cartão novo desfaz tudo junto). */
export function repetirResultado(id: string): Promise<void> {
  return naFila(id, async () => {
    const atual = acharResultado(id);
    if (!atual || atual.desfeito || !atual.resultado.repetir) return;
    mudarResultado(id, { ocupado: true, aviso: undefined });
    try {
      concluirResultado(id, { resultado: await atual.resultado.repetir(), desfeito: false });
    } catch (erro) {
      console.error('Não consegui repetir o item', erro);
      concluirResultado(id, { aviso: 'Não consegui pôr de novo. Nada foi repetido; tente de novo.' });
    }
  });
}

/** Troca a categoria do gasto gravado. Falha vira aviso no cartão e nada muda. */
export function trocarCategoriaDoResultado(id: string, categoria: string): Promise<void> {
  return naFila(id, async () => {
    const atual = acharResultado(id);
    const troca = atual?.resultado.trocarCategoria;
    if (!atual || atual.desfeito || !troca) return;
    mudarResultado(id, { ocupado: true, aviso: undefined });
    try {
      const feito = await troca.trocar(categoria);
      if (feito.mudou) {
        concluirResultado(id, { resultado: feito.resultado });
      } else {
        concluirResultado(id, { aviso: feito.mensagem });
      }
    } catch (erro) {
      console.error('Não consegui trocar a categoria', erro);
      concluirResultado(id, { aviso: TEXTO_DA_TROCA_QUE_FALHOU.erro });
    }
  });
}
