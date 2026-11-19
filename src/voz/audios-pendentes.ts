// Áudios que ainda não chegaram ao Drive (V02, Tarefa 5). Banco próprio, sem
// mexer em `central-dados`: assim não há subida de versão sobre os dados do dono
// e a cópia de segurança (exportar.ts) nunca leva áudio. Guarda os bytes
// (ArrayBuffer) e o tipo, não o Blob: o Blob não passa por todo IndexedDB.
import { openDB } from 'idb';

const BANCO = 'central-audios';
const VERSAO = 2;
const LOJA = 'pendentes';
/** Áudios que não chegaram ao Drive e não vão chegar sozinhos: a ideia mostra o aviso. Local, só deste aparelho. */
const LOJA_DE_PROBLEMAS = 'problemas';

export type AudioPendente = {
  id: string;
  bytes: ArrayBuffer;
  mime: string;
  guardadoEm: number;
  /** Rodadas de reenvio em que o script respondeu com erro (não de rede). */
  tentativas?: number;
  /** Desistiu de reenviar sozinho; o áudio continua guardado, nunca é apagado por aqui. */
  falhou?: boolean;
};

function abrir() {
  return openDB(BANCO, VERSAO, {
    upgrade(banco) {
      if (!banco.objectStoreNames.contains(LOJA)) banco.createObjectStore(LOJA, { keyPath: 'id' });
      if (!banco.objectStoreNames.contains(LOJA_DE_PROBLEMAS)) banco.createObjectStore(LOJA_DE_PROBLEMAS, { keyPath: 'id' });
    },
  });
}

// Abre e fecha a cada operação, como `loja.ts`.
async function comBanco<T>(usar: (banco: Awaited<ReturnType<typeof abrir>>) => Promise<T>): Promise<T> {
  const banco = await abrir();
  try {
    return await usar(banco);
  } finally {
    banco.close();
  }
}

/** Guarda (ou troca, se o id já existe: repetir não duplica). */
export function guardarAudio(audio: AudioPendente): Promise<void> {
  return comBanco(async (banco) => {
    await banco.put(LOJA, audio);
  });
}

/** Do mais antigo ao mais novo. */
export function listarAudios(): Promise<AudioPendente[]> {
  return comBanco(async (banco) => {
    const todos = (await banco.getAll(LOJA)) as AudioPendente[];
    return todos.sort((a, b) => a.guardadoEm - b.guardadoEm || a.id.localeCompare(b.id));
  });
}

export function removerAudio(id: string): Promise<void> {
  return comBanco((banco) => banco.delete(LOJA, id));
}

export function contarAudios(): Promise<number> {
  return comBanco((banco) => banco.count(LOJA));
}

export function existeAudio(id: string): Promise<boolean> {
  return comBanco(async (banco) => (await banco.count(LOJA, id)) > 0);
}

/** Soma dos bytes guardados, para o aviso de espaço. */
export async function tamanhoDosAudios(): Promise<number> {
  return (await listarAudios()).reduce((soma, a) => soma + a.bytes.byteLength, 0);
}

/** O áudio guardado neste aparelho (bytes e tipo), ou `undefined` se não está na fila. */
export function lerAudioPendente(id: string): Promise<AudioPendente | undefined> {
  return comBanco(async (banco) => (await banco.get(LOJA, id)) as AudioPendente | undefined);
}

/**
 * Por que o áudio não foi para o Drive: `recusado` (o Drive não aceitou o arquivo),
 * `sem_espaco` (a fila deste aparelho estava cheia) ou `falhou` (o envio falhou
 * e não houve nova tentativa ou ela se esgotou).
 */
export type MotivoDoProblema = 'recusado' | 'sem_espaco' | 'falhou';

const ouvintesDeProblemas = new Set<() => void>();

/** Avisa quando um problema é anotado ou limpo (a tela Ideias relê). Devolve a função que cancela. */
export function assinarProblemas(ouvinte: () => void): () => void {
  ouvintesDeProblemas.add(ouvinte);
  return () => {
    ouvintesDeProblemas.delete(ouvinte);
  };
}

function avisarProblemas() {
  for (const ouvinte of [...ouvintesDeProblemas]) {
    try {
      ouvinte();
    } catch (erro) {
      console.error('Ouvinte de problemas de áudio falhou', erro);
    }
  }
}

/** Anota que o áudio não foi enviado (a ideia mostra "Áudio não enviado"). Marcar de novo troca o motivo. */
export async function marcarProblemaDeAudio(id: string, motivo: MotivoDoProblema): Promise<void> {
  await comBanco(async (banco) => {
    await banco.put(LOJA_DE_PROBLEMAS, { id, motivo, em: Date.now() });
  });
  avisarProblemas();
}

export async function limparProblemaDeAudio(id: string): Promise<void> {
  await comBanco((banco) => banco.delete(LOJA_DE_PROBLEMAS, id));
  avisarProblemas();
}

/**
 * Os áudios com problema, por id: os anotados e também os da fila que o app
 * desistiu de reenviar (`falhou`). Áudio que chegou ao Drive não aparece.
 */
export function problemasDosAudios(): Promise<Map<string, MotivoDoProblema>> {
  return comBanco(async (banco) => {
    const mapa = new Map<string, MotivoDoProblema>();
    for (const item of (await banco.getAll(LOJA_DE_PROBLEMAS)) as { id: string; motivo: MotivoDoProblema }[]) mapa.set(item.id, item.motivo);
    for (const audio of (await banco.getAll(LOJA)) as AudioPendente[]) if (audio.falhou && !mapa.has(audio.id)) mapa.set(audio.id, 'falhou');
    return mapa;
  });
}
