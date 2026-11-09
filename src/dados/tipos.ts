// Modelo de dados da Central. Todo registro sincronizado tem a mesma base:
// a mesclagem (Tarefa 5) decide por registro, pelo maior `atualizadoEm`.

export type Base = {
  id: string;
  /** `Date.now()` da última escrita neste aparelho. Semente usa 0: perde para qualquer edição. */
  atualizadoEm: number;
  /** Id do aparelho que fez a última escrita. */
  aparelho: string;
  /** Lápide: o registro fica guardado para a exclusão chegar aos outros aparelhos. */
  apagado?: boolean;
};

export type Sala = Base & { nome: string; ordem: number; notas?: string };

export type Pessoa = Base & { nome: string; salaId: string; papel?: string; emails?: string[] };

/**
 * `data`: `AAAA-MM-DD`. `semana`: a segunda-feira da semana, `AAAA-MM-DD`.
 * Sem `data` e sem `semana` = Sem prazo. `prazoHora` só existe em tarefa com prazo.
 * `inicio` (`HH:MM`, R28): hora de início de compromisso criado pelo chat, até a
 * Tarefa 10 levar compromissos ao Google Agenda.
 */
export type Tarefa = Base & {
  titulo: string;
  salaId: string | null;
  pessoaId?: string;
  data?: string;
  semana?: string;
  prazoHora?: string;
  inicio?: string;
  duracaoMin: number;
  duracaoConfirmada: boolean;
  feito: boolean;
  fixada: boolean;
  marcar: boolean;
  emailId?: string;
  adiadaAte?: string;
};

export type Palavra = Base & { termo: string; salaId: string };

export type Documento = Base & {
  titulo: string;
  url: string;
  salaId?: string;
  pessoaId?: string;
  arquivado: boolean;
};

export type Bloco = {
  id: string;
  tipo: 'texto' | 'titulo' | 'lista' | 'painel';
  texto?: string;
  painel?: 'agenda' | 'checklist' | 'semana';
  itemId?: string;
};

export type Pagina = Base & { salaId: string; titulo: string; blocos: Bloco[] };

export type EstadoEmail = Base & { feito: boolean; adiadaAte?: string };

export type Rascunho = Base & { texto: string; salaId?: string | null };

/** Ajustes do dono. `fimDoDia`: `HH:MM`. */
export type Config = Base & { fimDoDia: string };

export type Colecoes = {
  salas: Sala;
  pessoas: Pessoa;
  tarefas: Tarefa;
  palavras: Palavra;
  documentos: Documento;
  paginas: Pagina;
  estadosEmail: EstadoEmail;
  rascunhos: Rascunho;
  config: Config;
};

export type Colecao = keyof Colecoes;

/** Qualquer registro de qualquer coleção. */
export type Registro = Colecoes[Colecao];

/** O que se entrega a `salvar`: a base é opcional, a loja carimba `atualizadoEm` e `aparelho`. */
export type ParaSalvar<T extends Base> = Omit<T, keyof Base> & Partial<Base>;

/**
 * Entrada da fila `pendentes`, que a sincronia (Tarefa 5) envia ao script.
 * `tipo` discrimina: a fila de ações de agenda (Tarefa 12, R10) acrescenta
 * a sua variante nesta mesma união e no mesmo armazenamento.
 */
export type PendenteRegistro = {
  /** Ordem de chegada, dada pelo IndexedDB. */
  seq: number;
  tipo: 'registro';
  colecao: Colecao;
  id: string;
};

export type Pendente = PendenteRegistro;

/** `remota`: a escrita veio de outro aparelho, pela sincronia. */
export type Mudanca = { colecao: Colecao; id: string; remota?: true };

/**
 * Conflito resolvido pela sincronia: a mesma coisa mudou em dois aparelhos e
 * venceu a alteração mais recente. A versão que perdeu fica guardada aqui
 * inteira, para nada sumir. Só existe neste aparelho; não sincroniza.
 */
export type Aviso = {
  /** Dado pelo IndexedDB. */
  id: number;
  colecao: Colecao;
  registroId: string;
  perdedora: Registro;
  vencedora: Registro;
  /** Quando o conflito foi visto neste aparelho. */
  criadoEm: number;
};

/** Registro vindo do servidor, já validado pela loja. */
export type Remoto = { colecao: Colecao; registro: Registro };
