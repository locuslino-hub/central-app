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

export type Pessoa = Base & { nome: string; salaId: string; papel?: string; emails?: string[]; notas?: string };

/**
 * `data`: `AAAA-MM-DD`. `semana`: a segunda-feira da semana, `AAAA-MM-DD`.
 * Sem `data` e sem `semana` = Sem prazo. `prazoHora` só existe em tarefa com prazo.
 * `inicio` (`HH:MM`, R28): só em tarefas antigas, de quando o chat guardava
 * compromisso como tarefa com hora. Hoje o compromisso vai para o Google Agenda;
 * `migrarCompromissos` leva essas tarefas para lá e o app não cria mais nenhuma.
 */
export type Tarefa = Base & {
  titulo: string;
  salaId: string | null;
  pessoaId?: string;
  data?: string;
  semana?: string;
  prazoHora?: string;
  inicio?: string;
  /**
   * Aviso da virada do dia (Tarefa 9): a segunda-feira da semana que acabou sem
   * a tarefa ser concluída. A tarefa volta para Sem prazo e mostra o aviso até
   * o dono dar ciência ou escolher um dia. Fica na própria tarefa para
   * sincronizar com ela: os dois aparelhos mostram o mesmo aviso.
   */
  semanaVencida?: string;
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

/**
 * Ajustes do dono. `fimDoDia`: `HH:MM`. `diaFechado` (Tarefa 16): o dia
 * (`AAAA-MM-DD`) em que o dono deu o passo final de Fechar o dia. Sincroniza
 * com o resto dos ajustes: o dia fechado no notebook aparece fechado no celular.
 */
export type Config = Base & { fimDoDia: string; diaFechado?: string };

/**
 * "Feito" de um compromisso do Google Agenda, marcado na Central. O id é
 * fixo por agenda e evento (`idDoFeito`): os dois aparelhos gravam o mesmo
 * registro. Vale para todo compromisso; nos que são do dono (agenda principal,
 * organizados por ele) o script também grava o "✓ " no Google. `data`: o dia
 * (`AAAA-MM-DD`) em que foi marcado, para limpar os antigos um dia.
 */
export type EventoFeito = Base & { eventoId: string; agendaId: string; data: string; feito: boolean };

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
  eventosFeitos: EventoFeito;
};

export type Colecao = keyof Colecoes;

/** Qualquer registro de qualquer coleção. */
export type Registro = Colecoes[Colecao];

/** O que se entrega a `salvar`: a base é opcional, a loja carimba `atualizadoEm` e `aparelho`. */
export type ParaSalvar<T extends Base> = Omit<T, keyof Base> & Partial<Base>;

/**
 * Entradas da fila `pendentes`, que a sincronia (Tarefa 5) envia ao script.
 * `tipo` discrimina. `registro`: um registro de coleção a enviar. `agenda`
 * (Tarefa 12, R10): uma ação do Google Agenda que ainda não saiu; o id do
 * evento é do cliente e vai junto, então repetir a ação não duplica nada.
 */
export type PendenteRegistro = {
  /** Ordem de chegada, dada pelo IndexedDB. */
  seq: number;
  tipo: 'registro';
  colecao: Colecao;
  id: string;
};

/** O evento a criar na agenda principal; `id` é o do cliente (`novoIdDeEvento`). */
export type EventoPendente = {
  id: string;
  titulo: string;
  /** `AAAA-MM-DD`. */
  data: string;
  /** `HH:MM`, de Lisboa. */
  inicio: string;
  fim: string;
  salaId: string | null;
};

/**
 * Controle de uma ação de agenda na fila: quando entrou e quantas vezes o
 * script ou o Google a recusou (sem internet não conta). Passando do limite
 * (`agendaEsgotada`), a sincronia para de tentar, mas a entrada fica e o
 * Painel avisa; nada é apagado sozinho.
 */
export type ControleDaFila = { criadoEm?: number; tentativas?: number };

export type PendenteCriarEvento = ControleDaFila & {
  seq: number;
  tipo: 'agenda';
  acao: 'criarEvento';
  evento: EventoPendente;
  /**
   * Migração (Tarefa 12): id da tarefa antiga com hora que este evento substitui.
   * A tarefa fica à vista até o script confirmar; só então vira lápide, na mesma
   * escrita que tira esta entrada da fila.
   */
  migrarTarefaId?: string;
};
export type PendenteRemoverEvento = ControleDaFila & { seq: number; tipo: 'agenda'; acao: 'removerEvento'; id: string };
export type PendenteAgenda = PendenteCriarEvento | PendenteRemoverEvento;

/**
 * Espelho no Google (spec do feito espelhado): o Google só copia o que já está
 * na Central, então estas entradas não contam como "por enviar" (os dados já
 * estão guardados no Drive pela fila de registros). Mesmas tentativas e
 * limite das ações de agenda.
 * - `espelharTarefa`: a tarefa mudou (título, dia, feita, apagada). Ao enviar,
 *   vai a versão atual da tarefa, não a do momento da escrita.
 * - `marcarEventoFeito`: o "✓ " no título do compromisso, na agenda principal.
 */
export type PendenteEspelharTarefa = ControleDaFila & { seq: number; tipo: 'espelho'; acao: 'espelharTarefa'; tarefaId: string };
export type PendenteMarcarEventoFeito = ControleDaFila & {
  seq: number;
  tipo: 'espelho';
  acao: 'marcarEventoFeito';
  id: string;
  feito: boolean;
};
export type PendenteEspelho = PendenteEspelharTarefa | PendenteMarcarEventoFeito;

export type Pendente = PendenteRegistro | PendenteAgenda | PendenteEspelho;

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
