// Ideias (V02, Tarefa 4): o que o dono captura por voz ou texto antes de saber
// para onde vai. Coleção própria `ideias` (sincroniza como as outras); a
// antiga `rascunhos` foi tirada na C-16 e não volta.
import { montarMemoria } from '../chat/memoria';
import { paraTarefa } from '../chat/interpretar';
import { salaDoTitulo } from '../chat/regras';
import { hojeEmLisboa } from './dia';
import { guardarAudio, lerAudioPendente, limparProblemaDeAudio, removerAudio, type AudioPendente } from '../voz/audios-pendentes';
import { apagar, lerRegistros, listar, salvar } from './loja';
import type { Ideia, ParaSalvar, Palavra, Pessoa, Sala, Tarefa } from './tipos';

/** Teto do texto de uma ideia (o script guarda tudo num arquivo só). */
export const IDEIA_NO_MAXIMO = 2000;
/** A recusa de texto vazio ou grande demais. */
export const TEXTO_INVALIDO = 'texto_invalido';
/** O título da tarefa que nasce da ideia: a agenda e as listas não pedem mais que isso. */
const TITULO_NO_MAXIMO = 200;

/** O áudio ligado à ideia tem id fora do formato ou duração impossível. */
export const AUDIO_INVALIDO = 'audio_invalido';
const ID_DE_AUDIO = /^[\w-]{1,100}$/;
/** Maior duração de áudio que o script aceita (o gravador corta aos 180 s). */
const AUDIO_SEGUNDOS_NO_MAXIMO = 600;

/**
 * Guarda a ideia como `nova`. Texto sem nenhuma letra ou número (vazio, só
 * espaços ou só pontuação, como "..." ou "?!") ou com mais de 2.000
 * caracteres lança `Error('texto_invalido')` e não grava. Áudio com id fora do
 * formato ou segundos negativos/infinitos lança `Error('audio_invalido')`.
 * `desfazer` apaga a ideia; chamar de novo não faz nada.
 */
export async function criarIdeia(
  texto: string,
  opcoes: { audioId?: string; audioSegundos?: number } = {},
): Promise<{ ideia: Ideia; desfazer: () => Promise<void> }> {
  const limpo = typeof texto === 'string' ? texto.trim() : '';
  if (!/[\p{L}\p{N}]/u.test(limpo) || limpo.length > IDEIA_NO_MAXIMO) throw new Error(TEXTO_INVALIDO);
  const { audioId, audioSegundos } = opcoes;
  if (audioId !== undefined && (typeof audioId !== 'string' || !ID_DE_AUDIO.test(audioId))) throw new Error(AUDIO_INVALIDO);
  if (audioSegundos !== undefined && !(Number.isFinite(audioSegundos) && audioSegundos >= 0 && audioSegundos <= AUDIO_SEGUNDOS_NO_MAXIMO)) {
    throw new Error(AUDIO_INVALIDO);
  }
  const novo: ParaSalvar<Ideia> = { texto: limpo, estado: 'nova' };
  if (audioId) novo.audioId = audioId;
  if (audioSegundos !== undefined) novo.audioSegundos = audioSegundos;
  const ideia = await salvar('ideias', novo);
  let apagada = false;
  return {
    ideia,
    desfazer: async () => {
      if (apagada) return;
      await apagar('ideias', ideia.id);
      apagada = true;
      // O aviso "Áudio não enviado" era desta ideia: some com ela.
      if (ideia.audioId) await limparProblemaDeAudio(ideia.audioId).catch(() => {});
    },
  };
}

/**
 * A sala provável de um texto: nome de sala dito, palavra guardada ou a sala
 * da pessoa citada (aluna de Orientações → Orientações). `null` sem pista, ou
 * se a sala achada não está em `salas`.
 */
export function sugerirSala(texto: string, salas: Sala[], pessoas: Pessoa[], palavras: Palavra[]): string | null {
  const achada = salaDoTitulo(texto, montarMemoria(pessoas, palavras, salas));
  return achada && salas.some((sala) => sala.id === achada && !sala.apagado) ? achada : null;
}

/** A ideia como está agora na loja (lida de novo: nada de cópia velha). */
async function lerIdeia(id: string): Promise<Ideia> {
  const [lida] = await lerRegistros([{ colecao: 'ideias', id }]);
  if (!lida || lida.apagado) throw new Error('ideia_nao_encontrada');
  return lida as Ideia;
}

/**
 * Escolhe a sala (`atribuida`); `null` tira a sala e volta a `nova`. Numa ideia
 * que já virou tarefa muda só a sala: o estado `tarefa` fica.
 */
export async function atribuirSala(id: string, salaId: string | null): Promise<void> {
  const { salaId: _antiga, ...resto } = await lerIdeia(id);
  const estado = resto.estado === 'tarefa' ? 'tarefa' : salaId === null ? 'nova' : 'atribuida';
  await salvar('ideias', { ...resto, salaId, estado } as ParaSalvar<Ideia>);
}

/**
 * Cria uma tarefa de hoje com o texto da ideia, na sala atribuída (se ainda
 * existe) ou, sem ela, na sugerida (pelas mesmas regras do chat), e marca a
 * ideia como `tarefa`. Repetir não duplica: o id da tarefa é gravado na ideia
 * antes de criá-la; se a ideia já tem a tarefa, devolve essa. Ideia apagada
 * lança `ideia_nao_encontrada`. Ideia que já virou tarefa cuja tarefa foi
 * apagada vira tarefa de novo: cria outra, com id novo (o antigo ficou apagado).
 *
 * `desfazer` apaga a tarefa criada agora e devolve a ideia ao que era (estado,
 * sala e tarefa de antes); chamar de novo não faz nada. Se a tarefa já existia
 * (chamada repetida), `desfazer` não apaga nada: ela não foi criada agora.
 */
export async function virarTarefaComDesfazer(id: string): Promise<{ tarefa: Tarefa; desfazer: () => Promise<void> }> {
  const ideia = await lerIdeia(id);
  let tarefaId = ideia.tarefaId;
  if (tarefaId) {
    const [lida] = await lerRegistros([{ colecao: 'tarefas', id: tarefaId }]);
    if (lida && !lida.apagado) {
      if (ideia.estado !== 'tarefa') await marcarComoTarefa(id, ideia.salaId ?? (lida as Tarefa).salaId ?? null);
      return { tarefa: lida as Tarefa, desfazer: async () => {} };
    }
    // Já era `tarefa` e a tarefa sumiu: o dono a apagou. Tarefa nova, id novo.
    // (Se ainda não era `tarefa`, foi uma falha no meio: repete com o mesmo id.)
    if (ideia.estado === 'tarefa') {
      tarefaId = crypto.randomUUID();
      await salvar('ideias', { ...ideia, tarefaId });
    }
  } else {
    tarefaId = crypto.randomUUID();
    await salvar('ideias', { ...ideia, tarefaId });
  }

  const [salas, pessoas, palavras] = await Promise.all([listar('salas'), listar('pessoas'), listar('palavras')]);
  let salaId = ideia.salaId && salas.some((sala) => sala.id === ideia.salaId) ? ideia.salaId : null;
  if (salaId === null) salaId = sugerirSala(ideia.texto, salas, pessoas, palavras);
  const citada = montarMemoria(pessoas, palavras, salas).acharPessoa(ideia.texto);
  const tarefa = await salvar('tarefas', {
    ...paraTarefa({
      tipo: 'tarefa',
      titulo: ideia.texto.slice(0, TITULO_NO_MAXIMO).trimEnd(),
      salaId,
      data: hojeEmLisboa(),
      diaAssumido: true,
      marcar: false,
      ...(citada && citada.salaId === salaId ? { pessoaId: citada.id } : {}),
    }),
    id: tarefaId,
  });
  await marcarComoTarefa(id, salaId);

  const criada = tarefaId;
  let desfeita = false;
  return {
    tarefa,
    desfazer: async () => {
      if (desfeita) return;
      await apagar('tarefas', criada);
      // A ideia volta ao que era, a menos que tenha sido apagada ou já ligada a outra tarefa.
      const [atual] = await lerRegistros([{ colecao: 'ideias', id }]);
      if (atual && !atual.apagado && (atual as Ideia).tarefaId === criada) {
        const { salaId: _sala, tarefaId: _tarefa, estado: _estado, ...resto } = atual as Ideia;
        await salvar('ideias', {
          ...resto,
          estado: ideia.estado,
          ...(ideia.salaId !== undefined ? { salaId: ideia.salaId } : {}),
          ...(ideia.tarefaId !== undefined && ideia.estado === 'tarefa' ? { tarefaId: ideia.tarefaId } : {}),
        } as ParaSalvar<Ideia>);
      }
      desfeita = true;
    },
  };
}

/** Como `virarTarefaComDesfazer`, para quem só quer a tarefa. */
export async function virarTarefa(id: string): Promise<Tarefa> {
  return (await virarTarefaComDesfazer(id)).tarefa;
}

/** Grava o estado `tarefa` lendo a ideia de novo (lança se foi apagada no meio). */
async function marcarComoTarefa(id: string, salaId: string | null): Promise<void> {
  const { salaId: _sala, ...resto } = await lerIdeia(id);
  await salvar('ideias', { ...resto, salaId, estado: 'tarefa' } as ParaSalvar<Ideia>);
}

/** Áudios que saíram da fila deste aparelho junto com a ideia apagada: o Desfazer os devolve (só enquanto o app está aberto). */
const audiosRetirados = new Map<string, AudioPendente>();

/**
 * Apaga a ideia (lápide), limpa o aviso de áudio dela e tira da fila deste
 * aparelho o áudio que ainda esperava rede (não deve ir ao Drive depois).
 * Devolve a ideia como era, para o Desfazer (`restaurarIdeia`); `undefined` se já não havia.
 */
export async function apagarIdeia(id: string): Promise<Ideia | undefined> {
  const antes = await apagar('ideias', id);
  if (antes?.audioId) {
    await limparProblemaDeAudio(antes.audioId).catch(() => {});
    try {
      const pendente = await lerAudioPendente(antes.audioId);
      if (pendente) {
        audiosRetirados.set(pendente.id, pendente);
        await removerAudio(pendente.id);
      }
    } catch (erro) {
      // O reenvio também confere a ideia: o áudio não sobe de qualquer jeito.
      console.warn('Não consegui tirar o áudio da fila', erro);
    }
  }
  return antes;
}

/** Desfaz `apagarIdeia`: grava de novo a ideia, com o mesmo id e os mesmos campos (áudio incluído, se ainda esperava rede). */
export async function restaurarIdeia(ideia: Ideia): Promise<Ideia> {
  const { apagado: _apagado, ...viva } = ideia;
  const salva = await salvar('ideias', viva as ParaSalvar<Ideia>);
  const retirado = ideia.audioId ? audiosRetirados.get(ideia.audioId) : undefined;
  if (retirado) {
    audiosRetirados.delete(retirado.id);
    await guardarAudio(retirado).catch(() => {});
  }
  return salva;
}

/** Quantas ideias ainda esperam um destino (as atribuídas e as que viraram tarefa não contam). */
export function contarNovas(ideias: readonly Ideia[]): number {
  return ideias.filter((ideia) => !ideia.apagado && ideia.estado === 'nova').length;
}
