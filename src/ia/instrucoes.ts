// Instruções da IA local (Tarefa 21) e leitura da resposta dela.
//
// O texto é o `SISTEMA` aprovado em `tests/manual/teste-ia.html`, com três trocas:
// o dia de hoje vem do relógio, e as salas e as pessoas vêm da loja (o que o
// dono cadastrou), nunca do código. A IA só sugere título, sala e divisão de
// frases longas; data, hora e tipo continuam com as regras (src/chat/regras.ts).

/** O que a IA precisa saber do aparelho para entender a frase. */
export type ContextoIA = {
  /** `AAAA-MM-DD`, em Lisboa. */
  hoje: string;
  salas: { id: string; nome: string; notas?: string }[];
  pessoas: { nome: string; salaId: string; papel?: string }[];
  /** Desiste da resposta (tempo limite do chat). */
  sinal?: AbortSignal;
};

/** Um item como a IA devolve. Só `titulo`, `sala` e a divisão são usados. */
export type ItemIA = {
  tipo: 'tarefa' | 'compromisso';
  titulo: string;
  /** Nome da sala como a IA escreveu, ou `''` / "Não sei". */
  sala: string;
  quando: string;
  inicio: string;
  fim: string;
};

/** Itens demais numa resposta: o resto é descartado. */
export const MAX_ITENS = 8;
const MAX_TITULO = 120;

const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/**
 * O que cada sala inicial costuma ter, como no teste aprovado. Só ajuda a IA a
 * escolher: a sala só entra no texto se existir na loja, e `notas` da sala,
 * quando o dono escreveu, vale antes disto.
 */
const DESCRICOES: Record<string, string> = {
  'sala-doutoramento': 'tese, relatórios e trabalho do próprio doutorado',
  'sala-investigacao': 'projetos de pesquisa, dados, artigos',
  'sala-aulas': 'disciplinas que ele ensina, turmas, avaliações, secretaria',
  'sala-orientacoes': 'alunas que ele orienta',
  'sala-mba': 'trabalhos, entregas e colegas do MBA que ele cursa',
  'sala-pessoal': 'saúde, família, amigos, assuntos pessoais',
  'sala-casa': 'consertos, compras e cuidados da casa',
};

/** Limites do que vem da loja: o texto do dono não domina as instruções. */
const MAX_NOME = 60;
const MAX_DETALHE = 100;
export const MAX_PESSOAS = 30;
/** Sala cujas pessoas vêm primeiro na lista (depois das citadas na frase). */
const SALA_PRIORITARIA = 'sala-orientacoes';
const TITULOS = new Set(['prof', 'profa', 'professor', 'professora', 'dr', 'dra', 'sr', 'sra']);

function hojePorExtenso(hoje: string): string {
  const [ano, mes, dia] = hoje.split('-').map(Number);
  const semana = new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay();
  return `${DIAS[semana]}, ${dia} de ${MESES[mes - 1]} de ${ano}`;
}

/** Uma linha só, sem quebras: o que vem da loja não muda a forma do texto. */
const umaLinha = (texto: string) => texto.replace(/\s+/g, ' ').trim();

/**
 * Texto da loja pronto para o prompt: uma linha, sem os sinais que mudariam a
 * forma do texto ou imitariam JSON (`( ) { } " \` < > ;`), e cortado.
 */
const daLoja = (texto: string, maximo: number) =>
  umaLinha(texto.replace(/[(){}"`<>;]/g, ' ')).slice(0, maximo).trim();

const semAcento = (texto: string) => texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

function linhaDaSala(sala: ContextoIA['salas'][number]): string {
  const notas = sala.notas ? daLoja(sala.notas, MAX_DETALHE) : '';
  const descricao = notas || DESCRICOES[sala.id];
  const nome = daLoja(sala.nome, MAX_NOME);
  return descricao ? `- ${nome}: ${descricao}` : `- ${nome}`;
}

/** A frase cita a pessoa por alguma parte do nome (sem títulos). */
function citada(nome: string, frase: string): boolean {
  const palavras = new Set(semAcento(frase).match(/[a-z0-9]+/g) ?? []);
  return (semAcento(nome).match(/[a-z0-9]+/g) ?? []).some((parte) => parte.length >= 3 && !TITULOS.has(parte) && palavras.has(parte));
}

/** Até `MAX_PESSOAS`: primeiro as citadas na frase, depois as de orientação, depois o resto, na ordem da loja. */
function escolherPessoas(pessoas: ContextoIA['pessoas'], frase: string): ContextoIA['pessoas'] {
  const peso = (pessoa: ContextoIA['pessoas'][number]) =>
    citada(pessoa.nome, frase) ? 0 : pessoa.salaId === SALA_PRIORITARIA ? 1 : 2;
  return pessoas
    .map((pessoa, ordem) => ({ pessoa, ordem, peso: peso(pessoa) }))
    .sort((a, b) => a.peso - b.peso || a.ordem - b.ordem)
    .slice(0, MAX_PESSOAS)
    .map(({ pessoa }) => pessoa);
}

function linhaDasPessoas(contexto: ContextoIA, frase: string): string {
  const nomeDaSala = new Map(contexto.salas.map((sala) => [sala.id, daLoja(sala.nome, MAX_NOME)]));
  const pessoas = escolherPessoas(contexto.pessoas, frase)
    .map((pessoa) => {
      const papel = pessoa.papel ? daLoja(pessoa.papel, MAX_DETALHE) : '';
      const detalhes = [papel || null, nomeDaSala.has(pessoa.salaId) ? `sala ${nomeDaSala.get(pessoa.salaId)}` : null].filter(
        Boolean,
      );
      const nome = daLoja(pessoa.nome, MAX_NOME);
      if (!nome) return '';
      return detalhes.length ? `${nome} (${detalhes.join(', ')})` : nome;
    })
    .filter(Boolean);
  if (pessoas.length === 0) return 'Pessoas conhecidas: nenhuma.';
  return `Pessoas conhecidas: ${pessoas.join(', ')}.`;
}

/**
 * As instruções de sistema da conversa com a IA. `frase` só escolhe quais
 * pessoas entram na lista quando há muitas; ela vai à IA à parte.
 */
export function montarInstrucoes(contexto: ContextoIA, frase = ''): string {
  const casa = contexto.salas.find((sala) => sala.id === 'sala-casa');
  const salaDoExemplo = casa ? daLoja(casa.nome, MAX_NOME) : '';
  return `Você organiza a agenda de um doutorando. Hoje é ${hojePorExtenso(contexto.hoje)}.
Transforme a frase em itens. Responda SOMENTE com JSON, sem explicação, neste formato:
{"itens":[{"tipo":"tarefa","titulo":"","sala":"","quando":"","inicio":"","fim":""}]}

tipo: "compromisso" somente se a frase já diz o dia e a hora em que aquilo acontece. Todo o resto é "tarefa".
"Marcar reunião" sem dia e hora é uma tarefa.
titulo: curto, começa com verbo quando houver, sem "adicione" e sem a data.
quando: as palavras de data da frase, como "hoje", "amanhã", "sexta". "do dia" significa "hoje". Sem data, use "".
inicio e fim: horas no formato 11:00. Sem hora, use "".
sala, escolha uma:
${contexto.salas.map(linhaDaSala).join('\n')}
- Não sei: quando a frase fala de pessoa desconhecida e nada indica a sala

${linhaDasPessoas(contexto, frase)}
Se a frase tiver vários pedidos, crie um item para cada um e ignore hesitações.

Exemplo: "Tenho que trocar a torneira da cozinha amanhã"
{"itens":[{"tipo":"tarefa","titulo":"Trocar a torneira da cozinha","sala":"${salaDoExemplo}","quando":"amanhã","inicio":"","fim":""}]}`;
}

const texto = (valor: unknown) => (typeof valor === 'string' ? umaLinha(valor) : '');

function limparTitulo(valor: unknown): string {
  const limpo = texto(valor).replace(/^["'“”]+|["'“”]+$/g, '').trim().slice(0, MAX_TITULO).trim();
  return limpo ? limpo.charAt(0).toLocaleUpperCase('pt-BR') + limpo.slice(1) : '';
}

/**
 * Onde termina o objeto ou a lista que começa em `inicio` (o índice do
 * fechamento), respeitando textos entre aspas. `-1`: a resposta foi cortada.
 */
function fimBalanceado(texto: string, inicio: number): number {
  let profundidade = 0;
  let emTexto = false;
  for (let i = inicio; i < texto.length; i++) {
    const c = texto[i];
    if (emTexto) {
      if (c === '\\') i++;
      else if (c === '"') emTexto = false;
    } else if (c === '"') emTexto = true;
    else if (c === '{' || c === '[') profundidade++;
    else if (c === '}' || c === ']') {
      profundidade--;
      if (profundidade === 0) return i;
    }
  }
  return -1;
}

function lerJson(texto: string): unknown {
  try {
    return JSON.parse(texto);
  } catch {
    return undefined;
  }
}

/** Os objetos completos de uma lista que começa em `inicio` (`[`), mesmo cortada no fim. */
function objetosCompletos(texto: string, inicio: number): unknown[] {
  const achados: unknown[] = [];
  let i = inicio + 1;
  while (i < texto.length) {
    const abre = texto.indexOf('{', i);
    if (abre < 0) break;
    const fecha = fimBalanceado(texto, abre);
    if (fecha < 0) break;
    const objeto = lerJson(texto.slice(abre, fecha + 1));
    if (objeto !== undefined) achados.push(objeto);
    i = fecha + 1;
  }
  return achados;
}

/**
 * O primeiro JSON do texto (objeto ou lista), sem o que vem depois. Se a
 * resposta foi cortada no meio, guarda os itens que chegaram inteiros.
 */
function acharJson(resposta: string): unknown {
  const inicio = resposta.search(/[{[]/);
  if (inicio < 0) return undefined;
  const fim = fimBalanceado(resposta, inicio);
  if (fim >= 0) {
    const inteiro = lerJson(resposta.slice(inicio, fim + 1));
    if (inteiro !== undefined) return inteiro;
  }
  // Cortada (ou quebrada): a lista de itens, do jeito que der.
  const lista = resposta[inicio] === '[' ? inicio : resposta.slice(inicio).search(/"itens"\s*:\s*\[/);
  if (lista < 0) return undefined;
  const abre = resposta[inicio] === '[' ? inicio : resposta.indexOf('[', inicio + lista);
  return objetosCompletos(resposta, abre);
}

/** A lista de itens em qualquer das formas aceitas: lista no topo, `itens` lista ou `itens` objeto único. */
function listaDeItens(json: unknown): unknown[] | null {
  if (Array.isArray(json)) return json;
  if (!json || typeof json !== 'object') return null;
  const itens = (json as { itens?: unknown }).itens;
  if (Array.isArray(itens)) return itens;
  if (itens && typeof itens === 'object') return [itens];
  return null;
}

/** Mesmo título (sem acento, maiúscula ou espaço a mais) e mesmo `quando`: é o mesmo item. */
const chaveDoItem = (item: ItemIA) => `${semAcento(umaLinha(item.titulo))}|${semAcento(item.quando)}`;

/**
 * Os itens da resposta da IA, ou `null` se ela veio quebrada (sem JSON, JSON
 * inválido, sem lista de itens, nenhum item com título). Campos estranhos
 * viram vazios: quem usa decide o que fazer com eles. Item repetido sai uma vez.
 */
export function lerResposta(resposta: string): ItemIA[] | null {
  const lista = listaDeItens(acharJson(resposta));
  if (!lista) return null;
  const itens: ItemIA[] = [];
  const vistos = new Set<string>();
  for (const bruto of lista) {
    if (!bruto || typeof bruto !== 'object') continue;
    const campo = bruto as Record<string, unknown>;
    const titulo = limparTitulo(campo.titulo);
    if (!titulo) continue;
    const item: ItemIA = {
      tipo: campo.tipo === 'compromisso' ? 'compromisso' : 'tarefa',
      titulo,
      sala: texto(campo.sala),
      quando: texto(campo.quando),
      inicio: texto(campo.inicio),
      fim: texto(campo.fim),
    };
    const chave = chaveDoItem(item);
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    itens.push(item);
    if (itens.length === MAX_ITENS) break;
  }
  return itens.length ? itens : null;
}
