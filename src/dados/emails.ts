// A lista do Por responder (Tarefa 14). Os e-mails ficam só na memória deste
// aparelho: remetente, endereço, assunto e trecho nunca vão para o IndexedDB,
// para o arquivo do Drive nem para a exportação. O script do Google guarda a
// lista por pouco tempo (Tarefa 13); ao fechar o app, lê-se de novo.
//
// Quem mostra (src/ui/useEmails.ts) atualiza ao abrir, ao voltar ao app e a
// cada hora. Falha nunca apaga o que já estava na tela. A Central nunca muda
// nada no Gmail: aqui só se lê.
import type { Email } from '../../script/email';
import { ErroConexao, ErroScript, chamar } from '../conexao/cliente';
import { lerConexao } from '../conexao/guarda';

export type { Email };

/**
 * - `nao-conectado`: este aparelho ainda não tem a conexão com o script.
 * - `sem-internet`: o pedido não chegou.
 * - `codigo`: o script não aceita o código deste aparelho (confirmado pelo ping): reconectar.
 * - `nao-liberada`: o código vale (o ping funciona), mas o script não conhece o Gmail:
 *   falta aprovar a permissão no script (um script antigo responde "código inválido" a ações novas).
 * - `falhou`: o script ou o Gmail recusou.
 */
export type FalhaDeEmails = 'nao-conectado' | 'sem-internet' | 'codigo' | 'nao-liberada' | 'falhou';

export type LeituraDeEmails = {
  emails: Email[];
  falha: FalhaDeEmails | null;
  /** Hora (ms) da última leitura que deu certo. */
  lidoEm: number | null;
  /** Hora (ms) da última tentativa, deu certo ou não. */
  tentadoEm: number | null;
  carregando: boolean;
};

export type DependenciasDeEmails = {
  /** `forcar`: o botão "Atualizar agora" (o script lê o Gmail, no máximo uma vez por minuto). */
  buscar: (forcar: boolean) => Promise<unknown>;
  pingar: () => Promise<unknown>;
  conectado: () => Promise<boolean>;
  agora: () => number;
};

const PADRAO: DependenciasDeEmails = {
  buscar: (forcar) => chamar(forcar ? 'atualizarEmails' : 'emails'),
  pingar: () => chamar('ping'),
  conectado: () =>
    lerConexao().then(
      (conexao) => conexao !== null && conexao !== undefined,
      () => false,
    ),
  agora: () => Date.now(),
};

const VAZIA: LeituraDeEmails = { emails: [], falha: null, lidoEm: null, tentadoEm: null, carregando: false };

let leitura: LeituraDeEmails = VAZIA;
/** Sobe em `esquecerEmails`: uma leitura que terminar depois disso é descartada. */
let geracao = 0;
let emAndamento: Promise<LeituraDeEmails> | null = null;
let andamentoForcado = false;
const ouvintes = new Set<() => void>();

function avisar() {
  for (const ouvinte of [...ouvintes]) ouvinte();
}

/** O que há na memória. Vazia se nunca foi lido. O objeto só muda quando a leitura muda. */
export function lerEmails(): LeituraDeEmails {
  return leitura;
}

/** Chama `ouvinte` a cada mudança na leitura. Devolve a função que desliga. */
export function assinarEmails(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => void ouvintes.delete(ouvinte);
}

/** Esquece tudo (testes). */
export function esquecerEmails() {
  geracao++;
  leitura = VAZIA;
  emAndamento = null;
  andamentoForcado = false;
}

// ---- Conferência do que chega do script ----

/** Ids do Gmail: letras e números. O mesmo padrão vale para o id do registro de estado. */
const ID_VALIDO = /^[A-Za-z0-9_-]{1,64}$/;
const LINK_WEB = /^https?:\/\/\S+$/i;
const DATA_COM_FUSO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;

const texto = (valor: unknown, maximo: number): valor is string => typeof valor === 'string' && valor.length <= maximo;

/** O link serve para abrir em outra aba? Só http e https (nunca `javascript:` nem `data:`). */
export function linkSeguro(link: string): boolean {
  return LINK_WEB.test(link);
}

/** O item tem a forma de `Email`? Fora dela, fica de fora: a tela nunca monta HTML com isto. */
export function emailValido(valor: unknown): valor is Email {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) return false;
  const e = valor as Record<string, unknown>;
  return (
    typeof e.id === 'string' &&
    ID_VALIDO.test(e.id) &&
    texto(e.remetente, 200) &&
    texto(e.enderecoRemetente, 254) &&
    texto(e.assunto, 400) &&
    texto(e.trecho, 400) &&
    typeof e.data === 'string' &&
    DATA_COM_FUSO.test(e.data) &&
    Number.isFinite(Date.parse(e.data)) &&
    typeof e.link === 'string' &&
    linkSeguro(e.link)
  );
}

function conferir(resposta: unknown): Email[] {
  if (!Array.isArray(resposta)) throw new ErroScript('interno');
  const vistos = new Set<string>();
  const lista: Email[] = [];
  for (const item of resposta) {
    if (!emailValido(item) || vistos.has(item.id)) continue;
    vistos.add(item.id);
    // Copia só os campos conhecidos: nada além do `Email` entra na memória.
    lista.push({
      id: item.id,
      remetente: item.remetente,
      enderecoRemetente: item.enderecoRemetente,
      assunto: item.assunto,
      trecho: item.trecho,
      data: item.data,
      link: item.link,
    });
  }
  return lista;
}

async function falhaDe(erro: unknown, dep: DependenciasDeEmails): Promise<FalhaDeEmails> {
  if (erro instanceof ErroConexao) return 'sem-internet';
  if (!(erro instanceof ErroScript) || erro.erro !== 'codigo-invalido') return 'falhou';
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

async function ler(forcar: boolean, dep: DependenciasDeEmails): Promise<LeituraDeEmails> {
  const minha = geracao;
  const antes = leitura;
  leitura = { ...antes, carregando: true };
  avisar();
  const tentadoEm = dep.agora();
  let depois: LeituraDeEmails;
  try {
    if (!(await dep.conectado())) {
      depois = { ...antes, falha: 'nao-conectado', tentadoEm, carregando: false };
    } else {
      const emails = conferir(await dep.buscar(forcar));
      depois = { emails, falha: null, lidoEm: tentadoEm, tentadoEm, carregando: false };
    }
  } catch (erro) {
    depois = { ...antes, falha: await falhaDe(erro, dep), tentadoEm, carregando: false };
  }
  if (minha === geracao) leitura = depois;
  return depois;
}

/**
 * Lê os e-mails e guarda na memória. Nunca rejeita: o resultado diz se falhou.
 * Pedidos juntos viram uma chamada só. `forcar` é o botão "Atualizar agora".
 */
export function atualizarEmails(forcar = false, dep: Partial<DependenciasDeEmails> = {}): Promise<LeituraDeEmails> {
  if (emAndamento) {
    // Uma leitura comum já está a caminho: o botão espera por ela e pede a dele em seguida.
    if (!forcar || andamentoForcado) return emAndamento;
    return emAndamento.then(() => atualizarEmails(true, dep));
  }
  andamentoForcado = forcar;
  const promessa: Promise<LeituraDeEmails> = ler(forcar, { ...PADRAO, ...dep }).finally(() => {
    if (emAndamento === promessa) emAndamento = null;
    avisar();
  });
  emAndamento = promessa;
  return promessa;
}
