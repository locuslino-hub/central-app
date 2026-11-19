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
 * `inicio` (`HH:MM`): tarefa com hora (decisão de 11/11: a frase do chat disse
 * "tarefa" ou "atividade" com dia e hora). Aparece em Atividades e como bloco
 * na Agenda, pela `duracaoMin`. Também as tarefas antigas de quando o chat
 * guardava compromisso assim (R28); a migração que as levava ao Google Agenda
 * foi retirada.
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
  /**
   * Hora (ms) da última mudança do `feito` (ampliação 11/11 do feito
   * espelhado). A loja marca ao concluir ou reabrir; a conclusão vinda do
   * Google Tarefas traz a hora de lá. Entre a Central e o Google vale a
   * mudança mais nova: a conclusão no Google só conta se for depois desta.
   */
  feitoEm?: number;
  fixada: boolean;
  marcar: boolean;
  emailId?: string;
  adiadaAte?: string;
  /**
   * Pasta comum (tema) a que a tarefa pertence (V02, Tarefa 17). Só pontos para
   * a pasta: apagar a pasta não regrava a tarefa, que continua viva na sala; sem
   * pasta viva com este id o campo simplesmente não é usado. Mudar a sala da
   * tarefa o tira (a pasta é de uma sala só).
   */
  pastaId?: string;
};

export type Palavra = Base & { termo: string; salaId: string };

export type Documento = Base & {
  titulo: string;
  url: string;
  salaId?: string;
  pessoaId?: string;
  /** Pasta comum (tema) em que foi guardado (V02, Tarefa 17); ver `Tarefa.pastaId`. */
  pastaId?: string;
  arquivado: boolean;
};

export type Bloco = {
  id: string;
  tipo: 'texto' | 'titulo' | 'lista' | 'painel';
  texto?: string;
  painel?: 'agenda' | 'checklist' | 'semana';
  itemId?: string;
};

/** `pastaId`: a pasta comum (tema) em que a página foi criada (V02, Tarefa 17); ver `Tarefa.pastaId`. */
export type Pagina = Base & { salaId: string; pastaId?: string; titulo: string; blocos: Bloco[] };

export type EstadoEmail = Base & { feito: boolean; adiadaAte?: string };

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
export type EventoFeito = Base & {
  eventoId: string;
  agendaId: string;
  data: string;
  feito: boolean;
  /**
   * Bloco do Google Tarefas: o feito ainda está a caminho do Google (há um
   * `marcarTarefaGoogle` na fila). Enquanto isso, vale o da Central.
   */
  pendenteNoGoogle?: boolean;
  /**
   * Bloco do Google Tarefas cujo feito não foi gravado lá (tarefa repetida,
   * não achada, sem permissão...): vale o da Central, e as leituras do
   * Google não o apagam.
   */
  soNaCentral?: boolean;
};

/**
 * Uma cor do Google ligada a uma sala (spec dos blocos e cores): `chave` como
 * o script a calcula (`label:<id>`, `cor:<colorId>` ou `agenda:<hex>`). O id
 * é fixo por chave (`idDaCor`): os dois aparelhos gravam o mesmo registro.
 * `salaId` null: a cor não tem sala (o compromisso volta à adivinhação pelo título).
 */
export type CorDaSala = Base & { chave: string; salaId: string | null };

/**
 * Um gole. `data` AAAA-MM-DD e `hora` HH:MM de Lisboa; `ml` inteiro de 1 a 5000.
 * Um registro por gole, com id próprio: dois aparelhos registrando no mesmo
 * minuto somam, nada se perde. Desfazer grava a lápide (`apagado`).
 */
export type AguaRegistro = Base & { data: string; hora: string; ml: number };

/**
 * Ideia capturada por voz ou texto (V02). `nova`: ainda sem destino; `atribuida`:
 * o dono escolheu a sala; `tarefa`: já virou tarefa. `audioId` é o arquivo no
 * Drive (só se ele ligou "Gravar áudio"). Coleção própria: a antiga `rascunhos`
 * foi tirada (C-16) e continua ignorada.
 */
export type Ideia = Base & {
  texto: string;
  salaId?: string | null;
  estado: 'nova' | 'atribuida' | 'tarefa';
  /** A tarefa criada a partir desta ideia (id gravado antes de criá-la, para repetir sem duplicar). */
  tarefaId?: string;
  audioId?: string;
  audioSegundos?: number;
};

export type TipoDePasta = 'lista' | 'registro' | 'planilha' | 'comum';

/**
 * Pasta dentro de uma sala (V02). `planilhaId` (só nas que têm planilha) é a
 * planilha Google no Drive do dono; vive aqui e nunca no código.
 */
export type Pasta = Base & {
  salaId: string;
  tipo: TipoDePasta;
  nome: string;
  ordem: number;
  planilhaId?: string;
  modelo?: 'compras' | 'consumo' | 'financeiro';
  servico?: 'agua' | 'luz' | 'gas';
  unidade?: 'm³' | 'kWh';
  /** Dia do mês (1 a 31) em que se envia a leitura ao portal. */
  diaDeEnvio?: number;
  categorias?: string[];
};

export type Colecoes = {
  salas: Sala;
  pessoas: Pessoa;
  tarefas: Tarefa;
  palavras: Palavra;
  documentos: Documento;
  paginas: Pagina;
  estadosEmail: EstadoEmail;
  config: Config;
  eventosFeitos: EventoFeito;
  coresDasSalas: CorDaSala;
  agua: AguaRegistro;
  ideias: Ideia;
  pastas: Pasta;
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
  /**
   * C-05: o script recusou o registro, ou ele passa do lote. A sincronia deixa
   * de enviá-lo; o AvisoDaFila mostra e o dono escolhe Tentar de novo ou
   * Descartar. Gravar o registro de novo cria outra entrada, sem `parada`.
   */
  parada?: { motivo: 'recusada' | 'grande-demais'; em: number };
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
 * script ou o Google a recusou (sem internet não conta; no máximo uma por
 * hora, a partir de `ultimaTentativa`). Passando do limite (`agendaEsgotada`),
 * a sincronia para de tentar, mas a entrada fica e o Painel avisa; nada é
 * apagado sozinho.
 */
export type ControleDaFila = { criadoEm?: number; tentativas?: number; ultimaTentativa?: number };

export type PendenteCriarEvento = ControleDaFila & {
  seq: number;
  tipo: 'agenda';
  acao: 'criarEvento';
  evento: EventoPendente;
  /**
   * Pedido da migração antiga (Tarefa 12): id da tarefa com hora que este evento
   * substituiria. A migração não existe mais (tarefa com hora fica tarefa, 11/11):
   * pedido com isto sai da fila sem ir ao Google (`largarMigracoesDaFila`).
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
/** - `marcarTarefaGoogle`: o feito de um bloco do Google Tarefas (conclui ou reabre a tarefa lá). */
export type PendenteMarcarTarefaGoogle = ControleDaFila & {
  seq: number;
  tipo: 'espelho';
  acao: 'marcarTarefaGoogle';
  taskId: string;
  feito: boolean;
  /** O dia do bloco (AAAA-MM-DD): o script procura a tarefa primeiro nele. */
  dia?: string;
  /** O registro de `eventosFeitos` do bloco, para marcar o resultado do envio. */
  feitoId?: string;
};
export type PendenteEspelho = PendenteEspelharTarefa | PendenteMarcarEventoFeito | PendenteMarcarTarefaGoogle;

/**
 * Planilhas da Casa (V02, Tarefa 10): o que ainda não chegou à planilha do Drive.
 * O id da linha é do cliente: o script não duplica uma linha com o mesmo id,
 * então reenviar nunca repete. Mesmas tentativas e limite das ações de agenda.
 * - `anexar`: uma linha nova no fim da planilha.
 * - `atualizar`: muda células de uma linha já enviada (o "desfeito" de um anexo
 *   enviado fica aqui quando não há rede; nunca se apaga linha).
 */
export type PendentePlanilha = ControleDaFila & {
  seq: number;
  tipo: 'planilha';
  acao: 'anexar' | 'atualizar';
  planilhaId: string;
  idDaLinha: string;
  valores: Record<string, string>;
  /**
   * Só em `atualizar`: o que o app tinha lido nas colunas mudadas, antes da
   * mudança. O script o compara com a planilha e responde conflito se alguém
   * mexeu nesse meio tempo (a entrada fica na fila, com tentativas contadas).
   */
  antes?: Record<string, string>;
  /** A última tentativa deu conflito (a linha mudou em outro lugar). "Tentar de novo" a envia sem `antes`. */
  conflito?: boolean;
};

export type Pendente = PendenteRegistro | PendenteAgenda | PendenteEspelho | PendentePlanilha;

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
