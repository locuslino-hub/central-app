// Lógica pura do script: nada aqui toca serviços do Google. Tudo o que vem de
// fora chega por `Ambiente`, para rodar igual nos testes e no Apps Script.
import {
  criarEvento,
  listarEventos,
  marcarEventoFeito,
  removerEvento,
  trocarSalaEvento,
  type CampoExtra,
  type ServicoDeAgenda,
} from './agenda';
import { Ocupado, TAMANHO_MAXIMO_DO_CORPO, enviar, puxar, type Armazem } from './dados';
import { listarEmails, pedirAtualizacao, type GuardaDeEmails, type ServicoDeGmail } from './email';
import {
  espelharTarefas,
  estadosDasTarefas,
  marcarTarefaGoogle,
  type GuardaDeTarefas,
  type ServicoDeTarefas,
} from './tarefas-google';

export type ErroDoScript = 'codigo-invalido' | 'ocupado' | 'interno';

export type Resposta = { ok: true; dados: unknown } | { ok: false; erro: ErroDoScript };

export interface Ambiente {
  lerCodigo(): string | null;
  armazem: Armazem;
  /** Serviço avançado do Google Agenda (v3). Sem ele, as ações de agenda dão `interno`. */
  calendario?(): ServicoDeAgenda;
  /** Serviço avançado do Gmail (v1), só leitura. Sem ele, as ações de e-mail dão `interno`. */
  gmail?(): ServicoDeGmail;
  /** Serviço avançado do Google Tarefas (v1), só para o espelho. Sem ele, `espelharTarefas` dá `interno`. */
  tarefasGoogle?(): ServicoDeTarefas;
  /** Onde fica a lista de e-mails entre o gatilho e o app (cache do script). */
  emailsGuardados?: GuardaDeEmails;
  /** Cache do que se achou no Google Tarefas (blocos agendados). Sem ele, só se lê mais. */
  guardaDeTarefas?: GuardaDeTarefas;
  /** Campos novos da agenda que o diagnosticoAgenda viu (label, taskId). */
  extrasDaAgenda?(): CampoExtra[];
  /** A API recusou os campos extras: a leitura deles se desliga até o próximo diagnosticoAgenda. */
  esquecerExtrasDaAgenda?(): void;
}

type Acao = (dados: unknown, ambiente: Ambiente) => unknown;

const TAMANHO_MINIMO_DO_CODIGO = 32;

function calendario(ambiente: Ambiente): ServicoDeAgenda {
  if (!ambiente.calendario) throw new Error('Google Agenda indisponível');
  return ambiente.calendario();
}

function tarefasGoogle(ambiente: Ambiente): ServicoDeTarefas {
  if (!ambiente.tarefasGoogle) throw new Error('Google Tarefas indisponível');
  return ambiente.tarefasGoogle();
}

/** O Google Tarefas, se ligado; null se não (os blocos só ficam sem o estado do Google Tarefas). */
function tarefasOpcional(ambiente: Ambiente): ServicoDeTarefas | null {
  try {
    return ambiente.tarefasGoogle ? ambiente.tarefasGoogle() : null;
  } catch {
    return null;
  }
}

function extras(ambiente: Ambiente): CampoExtra[] {
  try {
    return ambiente.extrasDaAgenda?.() ?? [];
  } catch {
    return [];
  }
}

/** `eventos`: os blocos do Google Tarefas vêm com o feito lido no Google Tarefas. */
function eventos(dados: unknown, ambiente: Ambiente) {
  const servico = calendario(ambiente);
  const tarefas = tarefasOpcional(ambiente);
  const guarda = ambiente.guardaDeTarefas ?? null;
  return listarEventos(dados, servico, {
    extras: extras(ambiente),
    aoRecusarExtras: () => {
      try {
        ambiente.esquecerExtrasDaAgenda?.();
      } catch {
        // na próxima leitura tenta de novo e volta aos de base
      }
    },
    ...(tarefas ? { estadosDasTarefas: (ids, periodo) => estadosDasTarefas(ids, periodo, tarefas, guarda) } : {}),
  });
}

function gmail(ambiente: Ambiente): ServicoDeGmail {
  if (!ambiente.gmail) throw new Error('Gmail indisponível');
  return ambiente.gmail();
}

function emailsGuardados(ambiente: Ambiente): GuardaDeEmails {
  if (!ambiente.emailsGuardados) throw new Error('Guarda de e-mails indisponível');
  return ambiente.emailsGuardados;
}

// Map, e não objeto: `acoes.get('constructor')` não acha nada herdado.
// As ações de agenda conferem o pedido antes de qualquer chamada ao Google (agenda.ts).
const acoes = new Map<unknown, Acao>([
  ['ping', () => ({})],
  ['puxar', (dados, ambiente) => puxar(dados, ambiente.armazem)],
  ['enviar', (dados, ambiente) => enviar(dados, ambiente.armazem)],
  ['eventos', eventos],
  ['criarEvento', (dados, ambiente) => criarEvento(dados, calendario(ambiente))],
  ['removerEvento', (dados, ambiente) => removerEvento(dados, calendario(ambiente))],
  ['trocarSalaEvento', (dados, ambiente) => trocarSalaEvento(dados, calendario(ambiente))],
  ['marcarEventoFeito', (dados, ambiente) => marcarEventoFeito(dados, calendario(ambiente))],
  // Bloco do Google Tarefas: conclui ou reabre a tarefa. Sem o serviço, `gravado: false`.
  ['marcarTarefaGoogle', (dados, ambiente) => marcarTarefaGoogle(dados, tarefasOpcional(ambiente), ambiente.guardaDeTarefas ?? null)],
  // Na trava do script: dois aparelhos ao mesmo tempo não criam duas listas
  // "Central" nem duas espelhos da mesma tarefa.
  ['espelharTarefas', (dados, ambiente) => {
    const servico = tarefasGoogle(ambiente);
    return ambiente.armazem.comTrava(() => espelharTarefas(dados, servico));
  }],
  // E-mail só se lê: não há ação que mude o Gmail. Nenhuma das duas usa `dados`.
  ['emails', (_dados, ambiente) => listarEmails(() => gmail(ambiente), emailsGuardados(ambiente))],
  // Com limite de 60 s (email.ts): toques repetidos devolvem a lista guardada.
  ['atualizarEmails', (_dados, ambiente) =>
    pedirAtualizacao(() => gmail(ambiente), emailsGuardados(ambiente), ambiente.armazem.agora())],
]);

function recusa(erro: ErroDoScript): Resposta {
  return { ok: false, erro };
}

/**
 * Compara sem sair no primeiro caractere diferente. O número de passos depende
 * só do texto enviado, que quem envia já conhece, e nunca do código guardado.
 */
export function iguais(enviado: string, guardado: string): boolean {
  let diferenca = enviado.length ^ guardado.length;
  for (let i = 0; i < enviado.length; i++) {
    // Além do fim do guardado, charCodeAt dá NaN, que o ^ trata como 0.
    diferenca |= enviado.charCodeAt(i) ^ guardado.charCodeAt(i);
  }
  return diferenca === 0;
}

const MARCA_DO_CONTEUDO = 'Message:';
const TAMANHO_MAXIMO_DO_RESUMO = 200;
const NOME_DE_ERRO = /^[A-Za-z]{1,40}$/;

/**
 * Nome e mensagem do erro, para o registro de execuções, sem nada do dono:
 * corta o que vem depois de "Message:" (o Drive põe o conteúdo do arquivo
 * ali), troca e-mails, texto entre aspas e sequências longas (ids, código) por "…" e
 * limita o tamanho. SyntaxError fica só com o nome: o JSON.parse cita o texto lido.
 */
export function resumoDoErro(erro: unknown): string {
  const partes = partesDoErro(erro);
  if (!partes) return erro === null ? 'null' : typeof erro;
  if (partes.nome === 'SyntaxError') return partes.nome;
  // Nome fora do padrão pode ter sido montado com dados: fica o genérico.
  const nome = NOME_DE_ERRO.test(partes.nome) ? partes.nome : 'Error';
  let mensagem = partes.mensagem;
  const corte = mensagem.indexOf(MARCA_DO_CONTEUDO);
  if (corte >= 0) mensagem = `${mensagem.slice(0, corte + MARCA_DO_CONTEUDO.length)} …`;
  // E-mails (ids de agenda do Google são e-mails) saem antes de tudo.
  mensagem = mensagem.replace(/[^\s@]+@[^\s@]+/g, '…');
  // Também codificados em URL (`%40`), como num caminho de API.
  mensagem = mensagem.replace(/[^\s/?&=]+%40[^\s/?&=]+/gi, '…');
  mensagem = mensagem.replace(/"[^"]*"|'[^']*'/g, '…');
  // Aspa que sobrou sem par: o resto pode ser texto do dono, então sai tudo.
  const aspa = mensagem.search(/["']/);
  if (aspa >= 0) mensagem = `${mensagem.slice(0, aspa)}…`;
  mensagem = mensagem.replace(/[A-Za-z0-9_-]{16,}/g, '…').slice(0, TAMANHO_MAXIMO_DO_RESUMO);
  return mensagem ? `${nome}: ${mensagem}` : nome;
}

/**
 * Nome e mensagem de qualquer coisa com cara de erro. Sem `instanceof Error`:
 * exceções dos serviços do Google podem não herdar de Error.
 */
export function partesDoErro(erro: unknown): { nome: string; mensagem: string } | null {
  if (typeof erro !== 'object' || erro === null) return null;
  const { name, message } = erro as { name?: unknown; message?: unknown };
  if (typeof message !== 'string') return null;
  return { nome: typeof name === 'string' && name ? name : 'Error', mensagem: message };
}

function registrarFalha(onde: string, resumo: string) {
  if (typeof console !== 'undefined') console.error(`Central: falha em ${onde}: ${resumo}`);
}

function codigoConfere(enviado: unknown, guardado: string | null): boolean {
  if (typeof enviado !== 'string') return false;
  if (guardado === null || guardado.length < TAMANHO_MINIMO_DO_CODIGO) return false;
  return iguais(enviado, guardado);
}

export function tratar(pedido: unknown, ambiente: Ambiente): Resposta {
  try {
    const { codigo, acao, dados } = (pedido ?? {}) as Record<string, unknown>;
    // O código vem antes da ação: sem ele, ninguém descobre quais ações existem.
    if (!codigoConfere(codigo, ambiente.lerCodigo())) return recusa('codigo-invalido');
    const executar = acoes.get(acao);
    // Ação desconhecida tem a mesma resposta de código errado.
    if (!executar) return recusa('codigo-invalido');
    return { ok: true, dados: executar(dados, ambiente) };
  } catch (erro) {
    registrarFalha('tratar', resumoDoErro(erro));
    return recusa(erro instanceof Ocupado ? 'ocupado' : 'interno');
  }
}

export function tratarCorpo(corpo: string | undefined, ambiente: Ambiente): Resposta {
  if (typeof corpo === 'string' && corpo.length > TAMANHO_MAXIMO_DO_CORPO) {
    registrarFalha('tratarCorpo', `corpo com ${corpo.length} caracteres, acima do limite`);
    return recusa('interno');
  }
  let pedido: unknown;
  try {
    pedido = JSON.parse(corpo as string);
  } catch (erro) {
    registrarFalha('tratarCorpo', corpo === undefined ? 'sem corpo' : resumoDoErro(erro));
    return recusa('interno');
  }
  return tratar(pedido, ambiente);
}

/** Dois UUIDs v4 sem hífens: 64 caracteres, 244 bits aleatórios. */
export function novoCodigo(gerarUuid: () => string): string {
  return (gerarUuid() + gerarUuid()).replace(/-/g, '');
}
