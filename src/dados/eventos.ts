// Os eventos do Google Agenda que as telas de calendário mostram. Ficam só na
// memória deste aparelho: não vão para o IndexedDB, nem para o arquivo do Drive,
// nem para a exportação. O Google é a fonte; ao fechar o app, lê-se de novo.
//
// Quem mostra (src/ui/useEventos.ts) atualiza ao abrir, ao voltar ao app e a
// cada 15 minutos. Falha nunca apaga o que já estava na tela.
import { ErroConexao, ErroScript, chamar } from '../conexao/cliente';
import { lerConexao } from '../conexao/guarda';
import { horaEmLisboa } from '../../script/agenda';
import { ErroAgenda, listarEventos, type Evento, type RespostaEventos } from './agenda';
import type { Pendente } from './tipos';

/**
 * - `nao-conectado`: este aparelho ainda não tem a conexão com o script.
 * - `sem-internet`: o pedido não chegou.
 * - `codigo`: o script não aceita o código deste aparelho (confirmado pelo ping): reconectar.
 * - `nao-liberada`: o código vale (o ping funciona), mas o script não conhece a agenda:
 *   falta aprovar a permissão no script (um script antigo responde "código inválido" a ações novas).
 * - `falhou`: o script ou o Google Agenda recusou.
 */
export type FalhaDeEventos = 'nao-conectado' | 'sem-internet' | 'codigo' | 'nao-liberada' | 'falhou';

export type Leitura = {
  eventos: Evento[];
  /** O script pulou alguma agenda ou bateu num teto. */
  incompleto: boolean;
  falha: FalhaDeEventos | null;
  /** Hora (ms) da última leitura que deu certo. */
  lidoEm: number | null;
  /** Hora (ms) da última tentativa, deu certo ou não. */
  tentadoEm: number | null;
  carregando: boolean;
  /**
   * Um evento foi criado ou removido por este aparelho depois desta leitura: ela
   * ainda aparece na tela, mas quem a mostra lê de novo (`useEventos`).
   */
  obsoleta?: boolean;
};

export type Dependencias = {
  listar: (periodo: { de: string; ate: string }) => Promise<RespostaEventos>;
  pingar: () => Promise<unknown>;
  conectado: () => Promise<boolean>;
  agora: () => number;
};

const PADRAO: Dependencias = {
  listar: (periodo) => listarEventos(periodo),
  pingar: () => chamar('ping'),
  conectado: () =>
    lerConexao().then(
      (conexao) => conexao !== null && conexao !== undefined,
      () => false,
    ),
  agora: () => Date.now(),
};

/** Quantos períodos ficam na memória (semanas, meses e anos já vistos). */
const PERIODOS_GUARDADOS = 30;

const VAZIA: Leitura = {
  eventos: [],
  incompleto: false,
  falha: null,
  lidoEm: null,
  tentadoEm: null,
  carregando: false,
};

const leituras = new Map<string, Leitura>();
/** Sobe em `esquecerEventos`: uma leitura que terminar depois disso é descartada. */
let geracao = 0;
const emAndamento = new Map<string, Promise<Leitura>>();
const ouvintes = new Set<() => void>();

const chave = (de: string, ate: string) => `${de}|${ate}`;

function avisar() {
  for (const ouvinte of [...ouvintes]) ouvinte();
}

function guardar(id: string, leitura: Leitura) {
  leituras.delete(id); // reinsere no fim: sai primeiro quem foi visto há mais tempo
  leituras.set(id, leitura);
  while (leituras.size > PERIODOS_GUARDADOS) leituras.delete(leituras.keys().next().value as string);
}

/** O que há na memória para o período. Vazia se nunca foi lido. O objeto só muda quando a leitura muda. */
export function lerEventos(de: string, ate: string): Leitura {
  return leituras.get(chave(de, ate)) ?? VAZIA;
}

/** Chama `ouvinte` a cada mudança em qualquer leitura. Devolve a função que desliga. */
export function assinarEventos(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => void ouvintes.delete(ouvinte);
}

/**
 * A fila de ações da agenda mudou sem mudar o Google (compromisso entrou na
 * fila sem internet, saiu dela por Desfazer, trocou de sala na fila): as telas
 * desenham de novo, sem ler o Google.
 */
export function avisarMudancaNaFila() {
  avisar();
}

/** Compromisso criado neste aparelho que ainda espera na fila para ir ao Google. */
export type EventoAEnviar = Evento & { aEnviar: true };

export function estaAEnviar(evento: Evento): evento is EventoAEnviar {
  return (evento as Partial<EventoAEnviar>).aEnviar === true;
}

/**
 * Os compromissos da fila (`criarEvento`) do período, como eventos da tela,
 * marcados `aEnviar`. Fora ficam: os que a leitura do Google já traz (mesmo
 * id: o id é do cliente), os de outro dia e os da migração (a tarefa antiga
 * ainda aparece no lugar deles).
 */
export function eventosAEnviar(pendentes: readonly Pendente[], de: string, ate: string, lidos: readonly Evento[]): EventoAEnviar[] {
  const jaLidos = new Set(lidos.map((evento) => evento.id));
  const fila: EventoAEnviar[] = [];
  for (const pendente of pendentes) {
    if (pendente.tipo !== 'agenda' || pendente.acao !== 'criarEvento' || pendente.migrarTarefaId) continue;
    const { id, titulo, data, inicio, fim, salaId } = pendente.evento;
    if (jaLidos.has(id) || data < de || data > ate) continue;
    const inicioIso = horaEmLisboa(data, inicio);
    const fimIso = horaEmLisboa(data, fim);
    if (!inicioIso || !fimIso) continue;
    fila.push({
      id,
      agendaId: 'primary',
      titulo,
      inicio: inicioIso,
      fim: fimIso,
      diaInteiro: false,
      livre: false,
      recusado: false,
      salaId,
      link: null,
      aEnviar: true,
    });
  }
  return fila;
}

/** Esquece tudo (testes). */
export function esquecerEventos() {
  geracao++;
  leituras.clear();
  emAndamento.clear();
}

/**
 * A Central criou ou removeu um evento: as leituras guardadas ficam na tela,
 * mas obsoletas, e quem as mostra lê de novo. O que estava sendo lido agora
 * pode ter saído antes da mudança, então é descartado.
 */
export function marcarEventosObsoletos() {
  geracao++;
  emAndamento.clear();
  for (const [id, leitura] of [...leituras]) leituras.set(id, { ...leitura, carregando: false, obsoleta: true });
  avisar();
}

async function falhaDe(erro: unknown, dep: Dependencias): Promise<FalhaDeEventos> {
  if (!(erro instanceof ErroAgenda)) return 'falhou';
  if (erro.falha === 'sem-internet') return 'sem-internet';
  if (erro.falha !== 'codigo-invalido') return 'falhou';
  // Um script que não conhece a ação também responde "código inválido".
  // Só o ping separa os dois casos: com o ping funcionando, o código vale.
  try {
    await dep.pingar();
    return 'nao-liberada';
  } catch (erroDoPing) {
    if (erroDoPing instanceof ErroConexao) return 'sem-internet';
    if (erroDoPing instanceof ErroScript && erroDoPing.erro === 'codigo-invalido') return 'codigo';
    return 'falhou';
  }
}

async function ler(id: string, de: string, ate: string, dep: Dependencias): Promise<Leitura> {
  const minha = geracao;
  const antes = leituras.get(id) ?? VAZIA;
  guardar(id, { ...antes, carregando: true });
  avisar();
  const tentadoEm = dep.agora();
  let depois: Leitura;
  try {
    if (!(await dep.conectado())) {
      depois = { ...antes, falha: 'nao-conectado', tentadoEm, carregando: false, obsoleta: undefined };
    } else {
      const { eventos, incompleto } = await dep.listar({ de, ate });
      depois = { eventos, incompleto, falha: null, lidoEm: tentadoEm, tentadoEm, carregando: false, obsoleta: undefined };
    }
  } catch (erro) {
    depois = { ...antes, falha: await falhaDe(erro, dep), tentadoEm, carregando: false, obsoleta: undefined };
  }
  if (minha === geracao) guardar(id, depois);
  return depois;
}

/**
 * Lê os eventos de `de` a `ate` (dias de Lisboa, `ate` incluído) e guarda na
 * memória. Nunca rejeita: o resultado diz se falhou. Pedidos juntos para o
 * mesmo período viram uma chamada só.
 */
export function atualizarEventos(de: string, ate: string, dep: Partial<Dependencias> = {}): Promise<Leitura> {
  const id = chave(de, ate);
  const andando = emAndamento.get(id);
  if (andando) return andando;
  const promessa: Promise<Leitura> = ler(id, de, ate, { ...PADRAO, ...dep }).finally(() => {
    if (emAndamento.get(id) === promessa) emAndamento.delete(id);
    avisar();
  });
  emAndamento.set(id, promessa);
  return promessa;
}
