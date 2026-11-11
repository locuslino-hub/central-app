// Coleções sincronizadas e a forma mínima de cada registro. O script
// (dados.ts) e o app (loja.ts) usam este mesmo módulo: os dois lados aceitam
// e recusam exatamente o mesmo. Nada aqui toca serviços do Google.

/** Ids e aparelhos: UUID, `sala-mba`, `geral`, `semente`... */
export const ID_VALIDO = /^[A-Za-z0-9_-]{1,64}$/;
/** Relógio de aparelho adiantado além disso é recusado: senão venceria todo conflito. */
export const FOLGA_DO_FUTURO_MS = 10 * 60 * 1000;

// Regex, e não `new URL`: o Apps Script não tem URL.
const URL_VALIDA = /^https?:\/\/\S+$/i;
/** `HH:MM`, de 00:00 a 23:59. */
const HORA_VALIDA = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
/**
 * Chave de uma cor do Google (script/agenda.ts): etiqueta, cor do evento
 * (paleta '1' a '11') ou cor da agenda (hex sem `#`).
 */
export const CHAVE_DE_COR = /^(?:label:[A-Za-z0-9_-]{1,64}|cor:(?:[1-9]|1[01])|agenda:[0-9a-f]{6})$/;
/** `AAAA-MM-DD`. */
const DIA_VALIDO = /^\d{4}-\d{2}-\d{2}$/;

type Tipo =
  | 'texto'
  | 'texto?'
  | 'textoOuNulo'
  | 'textoOuNulo?'
  | 'url'
  | 'dia'
  | 'dia?'
  | 'hora'
  | 'hora?'
  | 'ml'
  | 'numero?'
  | 'listaDeTexto?'
  | 'blocos?'
  | 'booleano'
  | 'booleano?'
  | 'chaveDeCor';

/**
 * Campos conferidos em cada coleção: todos os que o app grava (ver
 * src/dados/tipos.ts; tests/script/esquemas.test.ts confere que nenhum fica de
 * fora). Campo que registros antigos podem não ter é opcional (`?`): só a forma
 * é conferida quando ele vem.
 */
export const ESQUEMAS = {
  salas: { nome: 'texto', ordem: 'numero?', notas: 'texto?' },
  pessoas: { nome: 'texto', salaId: 'texto', papel: 'texto?', emails: 'listaDeTexto?', notas: 'texto?' },
  tarefas: {
    titulo: 'texto',
    salaId: 'textoOuNulo',
    pessoaId: 'texto?',
    data: 'texto?',
    semana: 'texto?',
    prazoHora: 'texto?',
    inicio: 'hora?',
    semanaVencida: 'texto?',
    duracaoMin: 'numero?',
    duracaoConfirmada: 'booleano?',
    feito: 'booleano?',
    fixada: 'booleano?',
    marcar: 'booleano?',
    emailId: 'texto?',
    adiadaAte: 'texto?',
  },
  palavras: { termo: 'texto', salaId: 'texto' },
  documentos: { titulo: 'texto', url: 'url', salaId: 'texto?', pessoaId: 'texto?', arquivado: 'booleano?' },
  paginas: { salaId: 'texto', titulo: 'texto', blocos: 'blocos?' },
  estadosEmail: { feito: 'booleano?', adiadaAte: 'texto?' },
  rascunhos: { texto: 'texto', salaId: 'textoOuNulo?' },
  /** `diaFechado`: o dia (AAAA-MM-DD) em que o dono fechou o dia (Tarefa 16). */
  config: { fimDoDia: 'texto', diaFechado: 'dia?' },
  eventosFeitos: {
    eventoId: 'texto',
    agendaId: 'texto',
    data: 'texto',
    feito: 'booleano',
    pendenteNoGoogle: 'booleano?',
    soNaCentral: 'booleano?',
  },
  /** Cor do Google -> sala (null: sem sala ligada; vale a adivinhação pelo título). */
  coresDasSalas: { chave: 'chaveDeCor', salaId: 'textoOuNulo' },
  /** Um gole por registro: dois aparelhos registrando ao mesmo tempo somam. */
  agua: { data: 'dia', hora: 'hora', ml: 'ml' },
} as const satisfies Record<string, Record<string, Tipo>>;

export type NomeDaColecao = keyof typeof ESQUEMAS;

export const NOMES_DAS_COLECOES = Object.keys(ESQUEMAS) as NomeDaColecao[];

/** Só chave própria: `constructor`, `toString`, `__proto__` não são coleções. */
export function colecaoConhecida(valor: unknown): valor is NomeDaColecao {
  return typeof valor === 'string' && Object.prototype.hasOwnProperty.call(ESQUEMAS, valor);
}

function objeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function campoValido(tipo: Tipo, valor: unknown): boolean {
  switch (tipo) {
    case 'texto':
      return typeof valor === 'string';
    case 'texto?':
      return valor === undefined || typeof valor === 'string';
    case 'textoOuNulo':
      return valor === null || typeof valor === 'string';
    case 'textoOuNulo?':
      return valor === undefined || valor === null || typeof valor === 'string';
    case 'url':
      return typeof valor === 'string' && URL_VALIDA.test(valor);
    case 'dia':
      return typeof valor === 'string' && DIA_VALIDO.test(valor);
    case 'dia?':
      return valor === undefined || (typeof valor === 'string' && DIA_VALIDO.test(valor));
    case 'hora':
      return typeof valor === 'string' && HORA_VALIDA.test(valor);
    case 'hora?':
      return valor === undefined || (typeof valor === 'string' && HORA_VALIDA.test(valor));
    case 'ml':
      return typeof valor === 'number' && Number.isInteger(valor) && valor >= 1 && valor <= 5000;
    case 'numero?':
      return valor === undefined || (typeof valor === 'number' && Number.isFinite(valor));
    case 'listaDeTexto?':
      return valor === undefined || (Array.isArray(valor) && valor.every((item) => typeof item === 'string'));
    case 'blocos?':
      // Blocos do caderno: cada um com `id` e `tipo` em texto; o resto é do app.
      return (
        valor === undefined ||
        (Array.isArray(valor) && valor.every((bloco) => objeto(bloco) && typeof bloco.id === 'string' && typeof bloco.tipo === 'string'))
      );
    case 'booleano':
      return typeof valor === 'boolean';
    case 'booleano?':
      return valor === undefined || typeof valor === 'boolean';
    case 'chaveDeCor':
      return typeof valor === 'string' && CHAVE_DE_COR.test(valor);
  }
}

const CAMPOS_DA_BASE = new Set(['id', 'aparelho', 'atualizadoEm', 'apagado']);

function campoConhecido(esquema: Record<string, Tipo>, campo: string): boolean {
  return CAMPOS_DA_BASE.has(campo) || Object.prototype.hasOwnProperty.call(esquema, campo);
}

/** Cópia do registro só com os campos que o esquema conhece (e os da base). */
export function semCamposDesconhecidos<T extends Record<string, unknown>>(colecao: NomeDaColecao, registro: T): T {
  const esquema: Record<string, Tipo> = ESQUEMAS[colecao];
  return Object.fromEntries(Object.entries(registro).filter(([campo]) => campoConhecido(esquema, campo))) as T;
}

/**
 * O registro tem forma aceitável para a coleção? `agora` é o relógio de quem
 * confere: `atualizadoEm` além de agora + 10 min é recusado.
 *
 * `estrito`: campo que não está no esquema recusa o registro. Só quem GRAVA
 * dados novos o usa (o script ao receber, a restauração da cópia). Quem LÊ
 * (o app ao puxar) não pode: um campo de versão futura, ou um campo antigo que
 * saiu do esquema, faria o registro sumir do aparelho para sempre, porque a
 * marca `desde` avança mesmo assim. Ali se usa `semCamposDesconhecidos`.
 */
export function registroValido(
  colecao: NomeDaColecao,
  registro: unknown,
  agora: number,
  { estrito = false }: { estrito?: boolean } = {},
): boolean {
  if (!objeto(registro)) return false;
  const { id, aparelho, atualizadoEm, apagado } = registro;
  if (typeof id !== 'string' || !ID_VALIDO.test(id)) return false;
  if (typeof aparelho !== 'string' || !ID_VALIDO.test(aparelho)) return false;
  if (typeof atualizadoEm !== 'number' || !Number.isFinite(atualizadoEm) || atualizadoEm < 0) return false;
  if (atualizadoEm > agora + FOLGA_DO_FUTURO_MS) return false;
  if (apagado !== undefined && typeof apagado !== 'boolean') return false;
  const esquema: Record<string, Tipo> = ESQUEMAS[colecao];
  if (estrito && !Object.keys(registro).every((campo) => campoConhecido(esquema, campo))) return false;
  return Object.keys(esquema).every((campo) => campoValido(esquema[campo], registro[campo]));
}
