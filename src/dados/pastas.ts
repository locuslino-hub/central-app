// Pastas (V02, Tarefa 9): dentro de uma sala, de 4 tipos (lista, registro,
// planilha ligada, comum). As três primeiras têm uma planilha Google própria,
// criada pelo script no Drive do dono; o id dela fica só no registro da pasta.
import { chamar as chamarScript } from '../conexao/cliente';
import { ID_VALIDO } from '../../script/colecoes';
import { apagar, lerRegistros, listar, salvar } from './loja';
import { esquecerCacheDaPasta } from './planilhas';
import { puxouNaUltimaRodada, sincronizar, type EstadoSync } from './sincronia';
import type { Base, Pasta, ParaSalvar } from './tipos';

/** Mesmo formato de `chamar` (conexao/cliente.ts); os testes entregam um de mentira. */
export type Chamar = <T>(acao: string, dados?: object) => Promise<T>;
export type OpcoesDePasta = {
  chamar?: Chamar;
  /** Só `criarPastasPadraoDaCasa`: puxa o que os outros aparelhos já criaram antes de criar. */
  sincronizar?: () => Promise<EstadoSync>;
  /** Só `criarPastasPadraoDaCasa`: a última rodada puxou do servidor? (os testes trocam; o normal é `puxouNaUltimaRodada`). */
  puxou?: () => boolean;
  /** Só `criarPastasPadraoDaCasa`: qual das 6 (de 1 a `total`) está para ser criada, só das que faltam. */
  aoAndar?: (numero: number, total: number) => void;
};

/** O que se entrega a `criarPasta`: a base e a ordem são postas aqui. */
export type DadosDaPasta = Omit<Pasta, keyof Base | 'ordem'>;

export const NOME_DA_PASTA_NO_MAXIMO = 100;
export const SALA_INVALIDA = 'sala_invalida';
/** Sem conseguir sincronizar não se criam as pastas padrão (criar planilha também pede rede). */
export const SEM_CONEXAO = 'sem_conexao';
export const NOME_INVALIDO = 'nome_invalido';
export const MODELO_OBRIGATORIO = 'modelo_obrigatorio';
export const PLANILHA_NAO_CRIADA = 'planilha_nao_criada';
/** O script pede para o dono rodar `organizarPastaCentral`: a Casa (partilhada) ainda está solta na raiz do Drive. */
export const ORGANIZAR_PASTAS = 'organizar_pastas';
export const PASTA_NAO_ENCONTRADA = 'pasta_nao_encontrada';
/** Lista, registro e planilha ficam todas na pasta "Casa (partilhada)" do Drive (dentro de "Central"): só existem na sala Casa. */
export const TIPO_SO_NA_CASA = 'tipo_so_na_casa';
export const SALA_CASA = 'sala-casa';

const ID_DE_PLANILHA = /^[\w-]{1,200}$/;
const TIPOS_COM_PLANILHA = new Set<Pasta['tipo']>(['lista', 'registro', 'planilha']);

function nomeLimpo(nome: unknown): string {
  const limpo = typeof nome === 'string' ? nome.trim() : '';
  if (limpo.length < 1 || limpo.length > NOME_DA_PASTA_NO_MAXIMO) throw new Error(NOME_INVALIDO);
  return limpo;
}

const comparavel = (nome: string) => nome.trim().toLowerCase();

/** Criações em andamento: a mesma pasta pedida de novo (duplo toque) espera a primeira, não cria outra planilha. */
const emAndamento = new Map<string, Promise<Pasta>>();

/**
 * Cria a pasta. `lista`, `registro` e `planilha` exigem `modelo` e criam a
 * planilha pelo script ANTES de gravar: se o script falha (ou não devolve um id
 * de planilha), nada é gravado e o erro sobe. `comum` não chama o script. Duas
 * chamadas iguais ao mesmo tempo (sala, tipo e nome) dão a mesma pasta e uma
 * planilha só.
 */
export function criarPasta(dados: DadosDaPasta, opcoes: OpcoesDePasta = {}): Promise<Pasta> {
  return criar(dados, opcoes, undefined);
}

function criar(dados: DadosDaPasta, opcoes: OpcoesDePasta, id: string | undefined): Promise<Pasta> {
  const chave = `${dados.salaId}|${dados.tipo}|${comparavel(String(dados.nome))}`;
  const andando = emAndamento.get(chave);
  if (andando) return andando;
  const feita = criarDeVez(dados, opcoes, id).finally(() => {
    emAndamento.delete(chave);
  });
  emAndamento.set(chave, feita);
  return feita;
}

async function criarDeVez(dados: DadosDaPasta, { chamar = chamarScript }: OpcoesDePasta, id: string | undefined): Promise<Pasta> {
  const nome = nomeLimpo(dados.nome);
  if (typeof dados.salaId !== 'string' || !ID_VALIDO.test(dados.salaId)) throw new Error(SALA_INVALIDA);
  if (dados.tipo !== 'comum' && dados.salaId !== SALA_CASA) throw new Error(TIPO_SO_NA_CASA);
  // Id fixo: nunca sobrescreve registro vivo (renomeado, ou vindo de outro aparelho); só refaz lápide ou falta.
  if (id) {
    const [atual] = await lerRegistros([{ colecao: 'pastas', id }]);
    if (atual && !atual.apagado) return atual as Pasta;
  }
  const { salaId, tipo, modelo, servico, unidade, diaDeEnvio, categorias } = dados;
  const comPlanilha = TIPOS_COM_PLANILHA.has(tipo);
  if (comPlanilha && !modelo) throw new Error(MODELO_OBRIGATORIO);

  let planilhaId: string | undefined;
  if (comPlanilha) {
    const resposta = await chamar<{ planilhaId?: unknown; erro?: unknown } | null>('criarPlanilha', { nome, modelo });
    if (resposta?.erro === ORGANIZAR_PASTAS) throw new Error(ORGANIZAR_PASTAS);
    const devolvido = resposta?.planilhaId;
    if (typeof devolvido !== 'string' || !ID_DE_PLANILHA.test(devolvido)) throw new Error(PLANILHA_NAO_CRIADA);
    planilhaId = devolvido;
  }

  // Logo antes de gravar (depois da espera pelo script), para não pegar ordem velha.
  const ordem = (await listarPastas(salaId)).reduce((maior, p) => Math.max(maior, p.ordem), 0) + 1;
  const nova: ParaSalvar<Pasta> = { salaId, tipo, nome, ordem };
  if (id) nova.id = id;
  if (comPlanilha) {
    nova.planilhaId = planilhaId;
    nova.modelo = modelo;
  }
  if (servico) nova.servico = servico;
  if (unidade) nova.unidade = unidade;
  if (diaDeEnvio !== undefined) nova.diaDeEnvio = diaDeEnvio;
  if (categorias) nova.categorias = categorias;
  return salvar('pastas', nova);
}

/** As pastas vivas da sala, por ordem (e nome, no empate). */
export async function listarPastas(salaId: string): Promise<Pasta[]> {
  return (await listar('pastas'))
    .filter((pasta) => pasta.salaId === salaId)
    .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0) || a.nome.localeCompare(b.nome, 'pt-BR'));
}

/** Muda só o nome (a planilha no Drive não é renomeada). Nome inválido: `nome_invalido`; pasta que não existe ou foi apagada: `pasta_nao_encontrada`. */
export async function renomearPasta(id: string, nome: string): Promise<Pasta> {
  const novo = nomeLimpo(nome);
  const [lida] = await lerRegistros([{ colecao: 'pastas', id }]);
  if (!lida || lida.apagado) throw new Error(PASTA_NAO_ENCONTRADA);
  return salvar('pastas', { ...(lida as Pasta), nome: novo });
}

/**
 * Lápide: a pasta some da Central e a exclusão sincroniza. Nunca toca no
 * Drive: a planilha continua lá (e com quem mais tem acesso a ela). Devolve a pasta como era;
 * `undefined` se já não havia.
 */
export async function apagarPasta(id: string): Promise<Pasta | undefined> {
  // Antes da lápide: a tela reage à lápide na hora, e nada deve ficar entre ela e a resposta daqui.
  // O que se leu da planilha (linhas de outras pessoas) não fica neste aparelho; a fila de envio fica: pode ser do dono.
  await esquecerCacheDaPasta(id).catch(() => {});
  try {
    // Guarda os itens limpos da vista: se o dono desfizer, voltam como estavam.
    const ocultos = localStorage.getItem(chaveDosOcultos(id));
    if (ocultos !== null) ocultosDeUmaPastaApagada.set(id, ocultos);
    localStorage.removeItem(chaveDosOcultos(id));
  } catch {
    // Sem armazenamento: nada a limpar.
  }
  return apagar('pastas', id);
}

/** Onde a lista guarda, só neste aparelho, os itens que o dono limpou da vista. */
export const chaveDosOcultos = (pastaId: string) => `central.lista.ocultos.${pastaId}`;

/** Os ocultos das pastas apagadas nesta sessão, para `restaurarPasta` (o Desfazer vem logo depois; recarregar o app esquece). */
const ocultosDeUmaPastaApagada = new Map<string, string>();

/** Desfaz `apagarPasta`: grava de novo a pasta, com o mesmo id e os mesmos campos (a planilha continuava no Drive). Se ela já está viva, devolve a viva sem gravar. */
export async function restaurarPasta(pasta: Pasta): Promise<Pasta> {
  // Já viva (outro aparelho a restaurou, talvez renomeada): fica como está, nada se grava por cima.
  const [atual] = await lerRegistros([{ colecao: 'pastas', id: pasta.id }]);
  if (atual && !atual.apagado) return atual as Pasta;
  const { apagado: _apagado, ...viva } = pasta;
  const restaurada = await salvar('pastas', viva as ParaSalvar<Pasta>);
  const ocultos = ocultosDeUmaPastaApagada.get(pasta.id);
  ocultosDeUmaPastaApagada.delete(pasta.id);
  try {
    // Só devolve se nada foi limpo de novo nesse meio-tempo.
    if (ocultos !== undefined && localStorage.getItem(chaveDosOcultos(pasta.id)) === null) localStorage.setItem(chaveDosOcultos(pasta.id), ocultos);
  } catch {
    // Sem armazenamento: a lista volta sem os itens limpos.
  }
  return restaurada;
}

type Padrao = Pick<Pasta, 'tipo' | 'nome' | 'modelo' | 'servico' | 'unidade'> & { id: string };

/** As 6 pastas da Casa. O id é fixo: dois aparelhos criando as padrão gravam os mesmos registros, sem pasta repetida. */
const PADRAO_DA_CASA: readonly Padrao[] = [
  { id: 'pasta-casa-compras-semanais', tipo: 'lista', nome: 'Lista de Compras Semanais', modelo: 'compras' },
  { id: 'pasta-casa-compras-casa', tipo: 'lista', nome: 'Lista de Compras para Casa', modelo: 'compras' },
  { id: 'pasta-casa-consumo-agua', tipo: 'registro', nome: 'Consumo de Água', modelo: 'consumo', servico: 'agua', unidade: 'm³' },
  { id: 'pasta-casa-consumo-luz', tipo: 'registro', nome: 'Consumo de Luz', modelo: 'consumo', servico: 'luz', unidade: 'kWh' },
  { id: 'pasta-casa-consumo-gas', tipo: 'registro', nome: 'Consumo de Gás', modelo: 'consumo', servico: 'gas', unidade: 'm³' },
  { id: 'pasta-casa-financeiro', tipo: 'planilha', nome: 'Financeiro', modelo: 'financeiro' },
];

/** Acha a pasta padrão entre as da Casa: pelo id fixo (mesmo renomeada) ou por nome e tipo (pasta do dono). */
function achaPadrao(pastas: readonly Pasta[], padrao: Padrao): Pasta | undefined {
  return pastas.find((p) => p.id === padrao.id || (p.tipo === padrao.tipo && comparavel(p.nome) === comparavel(padrao.nome)));
}

/** Falta alguma das 6 padrão entre estas pastas da Casa? (A tela só oferece "Criar pastas padrão" enquanto sim.) */
export function faltamPadraoDaCasa(pastasDaCasa: readonly Pasta[]): boolean {
  return PADRAO_DA_CASA.some((padrao) => !achaPadrao(pastasDaCasa, padrao));
}

let padraoEmAndamento: Promise<Pasta[]> | null = null;

/**
 * Cria as pastas padrão da Casa que ainda faltam (acha pelo nome, sem
 * diferenciar maiúsculas) e devolve as 6, na ordem. Idempotente: repetir não
 * cria planilha nem pasta; chamada durante outra em andamento espera e dá o
 * mesmo resultado. Antes de criar, sincroniza (pasta criada em outro aparelho
 * aparece e não é repetida); sem conseguir, lança `sem_conexao` e não cria
 * nada. Resta uma corrida: dois aparelhos criando no mesmo instante, antes de
 * um ver o outro, ainda podem gerar planilha a mais (a pasta é a mesma, pelo id
 * fixo; a planilha sobra no Drive). Uma por vez: se o script falha no meio, as já criadas ficam
 * e o erro sobe; chamar de novo cria só as que faltam.
 */
export function criarPastasPadraoDaCasa(opcoes: OpcoesDePasta = {}): Promise<Pasta[]> {
  if (padraoEmAndamento) return padraoEmAndamento;
  const feita = criarPadrao(opcoes).finally(() => {
    padraoEmAndamento = null;
  });
  padraoEmAndamento = feita;
  return feita;
}

async function criarPadrao(opcoes: OpcoesDePasta): Promise<Pasta[]> {
  const estado = await (opcoes.sincronizar ?? (() => sincronizar()))().catch(() => null);
  // Entrada parada na fila (agenda recusada, por exemplo) deixa a rodada em `por-enviar`, mas o que veio do servidor
  // já está aqui: serve para saber quais pastas existem.
  const puxado = estado === 'por-enviar' && (opcoes.puxou ?? puxouNaUltimaRodada)();
  if (estado !== 'atualizado' && !puxado) throw new Error(SEM_CONEXAO);
  const resultado: Pasta[] = [];
  for (const [indice, padrao] of PADRAO_DA_CASA.entries()) {
    const { id, ...modelo } = padrao;
    const existente = achaPadrao(await listarPastas(SALA_CASA), padrao);
    if (existente) {
      resultado.push(existente);
      continue;
    }
    opcoes.aoAndar?.(indice + 1, PADRAO_DA_CASA.length);
    resultado.push(await criar({ salaId: SALA_CASA, ...modelo }, opcoes, id));
  }
  return resultado;
}
