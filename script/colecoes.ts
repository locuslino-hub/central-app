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

type Tipo = 'texto' | 'texto?' | 'textoOuNulo' | 'textoOuNulo?' | 'url' | 'hora?' | 'booleano' | 'chaveDeCor';

/** Campos de texto conferidos em cada coleção (ver src/dados/tipos.ts). */
export const ESQUEMAS = {
  salas: { nome: 'texto', notas: 'texto?' },
  pessoas: { nome: 'texto', salaId: 'texto', papel: 'texto?', notas: 'texto?' },
  tarefas: {
    titulo: 'texto',
    salaId: 'textoOuNulo',
    pessoaId: 'texto?',
    data: 'texto?',
    semana: 'texto?',
    prazoHora: 'texto?',
    inicio: 'hora?',
    semanaVencida: 'texto?',
    emailId: 'texto?',
    adiadaAte: 'texto?',
  },
  palavras: { termo: 'texto', salaId: 'texto' },
  documentos: { titulo: 'texto', url: 'url', salaId: 'texto?', pessoaId: 'texto?' },
  paginas: { salaId: 'texto', titulo: 'texto' },
  estadosEmail: { adiadaAte: 'texto?' },
  rascunhos: { texto: 'texto', salaId: 'textoOuNulo?' },
  config: { fimDoDia: 'texto' },
  eventosFeitos: { eventoId: 'texto', agendaId: 'texto', data: 'texto', feito: 'booleano' },
  /** Cor do Google -> sala (null: sem sala ligada; vale a adivinhação pelo título). */
  coresDasSalas: { chave: 'chaveDeCor', salaId: 'textoOuNulo' },
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
    case 'hora?':
      return valor === undefined || (typeof valor === 'string' && HORA_VALIDA.test(valor));
    case 'booleano':
      return typeof valor === 'boolean';
    case 'chaveDeCor':
      return typeof valor === 'string' && CHAVE_DE_COR.test(valor);
  }
}

/**
 * O registro tem forma aceitável para a coleção? `agora` é o relógio de quem
 * confere: `atualizadoEm` além de agora + 10 min é recusado.
 */
export function registroValido(colecao: NomeDaColecao, registro: unknown, agora: number): boolean {
  if (!objeto(registro)) return false;
  const { id, aparelho, atualizadoEm, apagado } = registro;
  if (typeof id !== 'string' || !ID_VALIDO.test(id)) return false;
  if (typeof aparelho !== 'string' || !ID_VALIDO.test(aparelho)) return false;
  if (typeof atualizadoEm !== 'number' || !Number.isFinite(atualizadoEm) || atualizadoEm < 0) return false;
  if (atualizadoEm > agora + FOLGA_DO_FUTURO_MS) return false;
  if (apagado !== undefined && typeof apagado !== 'boolean') return false;
  const esquema: Record<string, Tipo> = ESQUEMAS[colecao];
  return Object.keys(esquema).every((campo) => campoValido(esquema[campo], registro[campo]));
}
