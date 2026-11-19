// Textos, pares tipo/modelo e o link da planilha das pastas (V02, Tarefa 12).
// Uma só fonte para a sala, o formulário "Nova pasta" e a página da pasta.
import { ErroConexao, ErroScript } from '../conexao/cliente';
import { dataEmBr, numeroEmBr, type NovaLeitura, type ResultadoDaLeitura } from '../dados/leituras';
import type { Lancamento } from '../dados/financeiro';
import type { ResultadoDosItens } from '../dados/lista';
import type { AvisoDePlanilha, ResultadoDaAtualizacao, ResultadoDoDesfazer } from '../dados/planilhas';
import type { Pasta, TipoDePasta } from '../dados/tipos';
import type { NomeDoIcone } from './icones';

type Modelo = NonNullable<Pasta['modelo']>;
type Servico = NonNullable<Pasta['servico']>;
type Unidade = NonNullable<Pasta['unidade']>;

/** A ordem em que o formulário mostra os tipos. */
export const TIPOS_DE_PASTA: readonly TipoDePasta[] = ['lista', 'registro', 'planilha', 'comum'];

/** O nome de cada tipo, como o formulário o chama. */
export const NOME_DO_TIPO: Record<TipoDePasta, string> = {
  lista: 'Lista',
  registro: 'Registro',
  planilha: 'Planilha ligada',
  comum: 'Pasta comum',
};

/** O selo curto no cartão da pasta. */
export const SELO_DO_TIPO: Record<TipoDePasta, string> = {
  lista: 'Lista',
  registro: 'Registro',
  planilha: 'Planilha',
  comum: 'Comum',
};

/** O que cada tipo faz, numa linha (formulário). */
export const EXPLICACAO_DO_TIPO: Record<TipoDePasta, string> = {
  lista: 'Itens para comprar, numa planilha compartilhada.',
  registro: 'Leituras de água, luz ou gás, com gráfico.',
  planilha: 'Planilha com tela própria, como o Financeiro.',
  comum: 'Tarefas, notas e documentos de um tema.',
};

/** Cada tipo usa um modelo de planilha; a pasta comum não tem planilha. */
const MODELO_DO_TIPO: Record<TipoDePasta, Modelo | undefined> = {
  lista: 'compras',
  registro: 'consumo',
  planilha: 'financeiro',
  comum: undefined,
};
export const modeloDoTipo = (tipo: TipoDePasta): Modelo | undefined => MODELO_DO_TIPO[tipo];

/** Frase do formulário sobre a planilha que será criada. */
export const AVISO_DO_MODELO: Record<Modelo, string> = {
  compras: 'Cria uma planilha de compras na pasta "Casa (partilhada)", dentro de "Central", no seu Drive.',
  consumo: 'Cria uma planilha de leituras na pasta "Casa (partilhada)", dentro de "Central", no seu Drive.',
  financeiro: 'Cria uma planilha de lançamentos na pasta "Casa (partilhada)", dentro de "Central", no seu Drive.',
};

export const SERVICOS: readonly Servico[] = ['agua', 'luz', 'gas'];
export const NOME_DO_SERVICO: Record<Servico, string> = { agua: 'Água', luz: 'Luz', gas: 'Gás' };
export const UNIDADES: readonly Unidade[] = ['m³', 'kWh'];

/** A unidade que cada serviço costuma usar. */
export const unidadeDoServico = (servico: Servico): Unidade => (servico === 'luz' ? 'kWh' : 'm³');

/** O endereço da planilha no Google Planilhas (o id vem da pasta, nunca do código). */
export const linkDaPlanilha = (planilhaId: string): string => `https://docs.google.com/spreadsheets/d/${encodeURIComponent(planilhaId)}`;

/** O ícone da pasta: o do tipo; o registro usa o do serviço (gota, raio, chama). */
export function iconeDaPasta(pasta: Pasta): NomeDoIcone {
  if (pasta.tipo === 'registro' && pasta.servico) return { agua: 'gota', luz: 'raio', gas: 'chama' }[pasta.servico] as NomeDoIcone;
  return { lista: 'lista', registro: 'registro', planilha: 'planilha', comum: 'pasta' }[pasta.tipo] as NomeDoIcone;
}

/** O que a pasta guarda, numa linha curta (o tipo já está no selo). */
export function descricaoDaPasta(pasta: Pasta): string {
  switch (pasta.tipo) {
    case 'lista':
      return 'Itens numa planilha de compras';
    case 'registro': {
      if (!pasta.servico) return 'Leituras numa planilha';
      const partes = [NOME_DO_SERVICO[pasta.servico], pasta.unidade ?? unidadeDoServico(pasta.servico)];
      if (pasta.diaDeEnvio !== undefined) partes.push(`envio no dia ${pasta.diaDeEnvio}`);
      return partes.join(' · ');
    }
    case 'planilha':
      return 'Planilha com tela própria';
    default:
      return 'Tarefas, notas e documentos do tema';
  }
}

/** Desfazer ou apagar uma pasta que já não existe (apagada em outro aparelho). */
export class PastaJaApagada extends Error {
  constructor() {
    super('pasta_ja_apagada');
    this.name = 'PastaJaApagada';
  }
}

const SEM_CONEXAO = 'Sem conexão com o Google agora. Nada foi criado. Confira a internet e tente de novo.';

/** O que o dono lê quando criar, renomear ou apagar uma pasta falha. Sempre diz o que fazer; nunca mostra código nem texto técnico. */
export function mensagemDeErroDePasta(erro: unknown, { criando = true }: { criando?: boolean } = {}): string {
  if (erro instanceof ErroConexao) return SEM_CONEXAO;
  if (erro instanceof ErroScript) {
    switch (erro.erro) {
      case 'ocupado':
        return 'O Google está ocupado com outro pedido. Nada foi criado. Espere um instante e tente de novo.';
      case 'codigo-invalido':
        return 'Este aparelho não está autorizado no Google. Nada foi criado. Abra Conectar aparelho e confira o código.';
      default:
        return 'O Google não conseguiu criar a planilha. Nada foi criado. Tente de novo daqui a pouco.';
    }
  }
  const codigo = erro instanceof Error ? erro.message : '';
  switch (codigo) {
    case 'nome_invalido':
      return 'Escreva um nome de 1 a 100 caracteres para a pasta.';
    case 'modelo_obrigatorio':
      return 'Faltou o modelo da planilha. Escolha o tipo da pasta de novo.';
    case 'planilha_nao_criada':
      return 'O Google não devolveu a planilha. Nada foi criado. Tente de novo.';
    case 'organizar_pastas':
      return 'Rode organizarPastaCentral no script (veja o GUIA) e tente de novo. Nada foi criado.';
    case 'sem_conexao':
      return SEM_CONEXAO;
    case 'sala_invalida':
      return 'Esta sala não aceita pastas. Volte às salas e abra a sala de novo.';
    case 'tipo_so_na_casa':
      return 'Lista, registro e planilha só existem na Casa, onde ficam as planilhas partilhadas. Nas outras salas, crie uma pasta comum.';
    case 'pasta_nao_encontrada':
      return 'Esta pasta já não existe neste aparelho.';
    default:
      return criando ? 'Não consegui criar a pasta. Nada foi criado. Tente de novo.' : 'Não consegui concluir agora. Tente de novo.';
  }
}

/** O que o dono lê quando a planilha não deixa gravar. Sempre diz que nada foi gravado e o que fazer. */
export const TEXTO_DO_AVISO_DE_PLANILHA: Record<AvisoDePlanilha, string> = {
  planilha_mudou: 'A planilha mudou: falta uma coluna que a Central usa. Nada foi gravado. Abra a planilha e confira os títulos das colunas.',
  fora_da_pasta: 'Esta planilha já não está na pasta "Casa (partilhada)", dentro de "Central", no seu Drive. Nada foi gravado.',
  sem_acesso: 'A Central não conseguiu abrir esta planilha agora. Nada foi gravado. Tente de novo daqui a pouco.',
  planilha_cheia: 'A planilha está cheia (5.000 linhas). Nada foi gravado. Abra a planilha e arquive as linhas antigas.',
};

/** A frase do lembrete do envio da leitura ao portal. `servico` é o nome do serviço (Água, Luz, Gás). */
export function textoDoLembreteDeEnvio(servico: string, diasFaltando: number, dia: number): string {
  if (diasFaltando === 0) return `Hoje é o dia de enviar a leitura de ${servico} ao portal.`;
  if (diasFaltando === 1) return `Amanhã é o dia de enviar a leitura de ${servico} ao portal.`;
  return `Faltam ${diasFaltando} dias para enviar a leitura de ${servico} ao portal (dia ${dia}).`;
}

/** O que o dono lê no alto da pasta quando a planilha não pôde ser lida por inteiro (mostra o que o aparelho guardou). */
export const TEXTO_DO_AVISO_DE_LEITURA: Record<AvisoDePlanilha, string> = {
  planilha_mudou: 'A planilha mudou: falta uma coluna que a Central usa. Confira os títulos das colunas na planilha. Enquanto isso, a Central não grava nela.',
  fora_da_pasta: 'Esta planilha já não está na pasta "Casa (partilhada)", dentro de "Central", no seu Drive. Mostrando o que este aparelho guardou.',
  sem_acesso: 'A Central não conseguiu abrir esta planilha agora. Mostrando o que este aparelho guardou.',
  planilha_cheia: 'A planilha está cheia (5.000 linhas). Arquive as linhas antigas na planilha.',
};

/** Os avisos curtos do roteador de frases, como o dono os lê. */
const AVISO_DA_FRASE: Record<string, string> = {
  'data futura': 'A data está no futuro: confira se é essa mesmo.',
  'data inválida': 'Não entendi a data, então usei a de hoje.',
};
export const textoDoAvisoDaFrase = (aviso: string): string => AVISO_DA_FRASE[aviso] ?? aviso;

/**
 * O cartão de uma leitura gravada (tela da pasta e Pode falar): o que foi guardado, o consumo desde a anterior e os
 * avisos (leitura menor que a anterior, sem internet). Para `bloqueada` (nada foi gravado) devolve o aviso da planilha.
 */
export function textosDaLeitura(
  nomeDaPasta: string,
  nova: Pick<NovaLeitura, 'data' | 'valor' | 'unidade'>,
  resultado: ResultadoDaLeitura,
  avisosDaFrase: readonly string[] = [],
): { titulo: string; detalhe: string } {
  const { anexo, consumo, aviso, anterior } = resultado;
  if (anexo.situacao === 'bloqueada') {
    return { titulo: 'Leitura não gravada', detalhe: TEXTO_DO_AVISO_DE_PLANILHA[anexo.aviso ?? 'sem_acesso'] };
  }
  const { unidade } = nova;
  const partes = [`${nomeDaPasta}: ${numeroEmBr(nova.valor)} ${unidade} em ${dataEmBr(nova.data)}.`];
  if (consumo !== null) partes.push(`Consumo desde a anterior: ${numeroEmBr(consumo)} ${unidade}.`);
  else if (aviso === 'leitura_menor' && anterior) {
    partes.push(
      `Atenção: esta leitura é menor que a anterior (${numeroEmBr(anterior.leitura)} ${unidade} em ${dataEmBr(anterior.data)}). Guardei assim mesmo, sem calcular o consumo. Se foi engano, toque em Desfazer.`,
    );
  }
  for (const a of avisosDaFrase) partes.push(textoDoAvisoDaFrase(a));
  if (anexo.situacao === 'na_fila') partes.push('Sem internet: a leitura fica neste aparelho e vai para a planilha quando a rede voltar.');
  return { titulo: 'Leitura guardada', detalhe: partes.join(' ') };
}

/** O aviso da planilha quando é a voz que não conseguiu gravar: a frase ainda vira ideia, então diz isso em vez de "nada foi gravado". */
export const textoDoAvisoDeLeituraNaVoz = (aviso: AvisoDePlanilha = 'sem_acesso'): string =>
  TEXTO_DO_AVISO_DE_PLANILHA[aviso].replace('Nada foi gravado.', 'A leitura não foi para a planilha.');

// ---------- Lista de compras (Tarefa 14) ----------

/** "a", "a e b", "a, b e c". */
const juntar = (partes: readonly string[]): string => (partes.length <= 1 ? (partes[0] ?? '') : `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}`);
const entreAspas = (itens: readonly string[]): string[] => itens.map((i) => `“${i}”`);

export const TEXTO_DE_ITEM_VAZIO = 'Escreva o que comprar.';
export const TEXTO_DE_ITEM_LONGO = (maximo: number): string => `O item pode ter no máximo ${maximo} caracteres.`;
export const TEXTO_SEM_REDE_NA_LISTA = 'Sem internet: salva ao voltar a rede.';

/**
 * O cartão dos itens que acabaram de ser pedidos (tela da pasta e Pode falar): o que foi guardado, o que já estava na
 * lista (e por isso não foi repetido), e o aviso de rede. `bloqueio` sem nenhum item guardado: o aviso da planilha.
 */
export function textosDosItens(
  nomeDaPasta: string,
  resultado: Pick<ResultadoDosItens, 'criados' | 'repetidos' | 'bloqueio' | 'naFila'>,
): { titulo: string; detalhe: string } {
  const { criados, repetidos, bloqueio, naFila } = resultado;
  if (criados.length === 0) {
    if (bloqueio) return { titulo: 'Item não gravado', detalhe: TEXTO_DO_AVISO_DE_PLANILHA[bloqueio] };
    const nomes = entreAspas(repetidos);
    const ja = repetidos.length === 1 ? `${nomes[0]} já está na lista.` : `${juntar(nomes)} já estão na lista.`;
    return { titulo: 'Já está na lista', detalhe: `${ja} Não repeti. Toque em Pôr mesmo assim se quiser repetir.` };
  }
  const partes = [`Em ${nomeDaPasta}: ${juntar(entreAspas(criados.map((c) => c.item)))}.`];
  if (repetidos.length > 0) partes.push(`Já estava na lista: ${juntar(entreAspas(repetidos))}. Não repeti.`);
  if (bloqueio) partes.push('Os outros itens não foram para a planilha.');
  if (naFila) partes.push(TEXTO_SEM_REDE_NA_LISTA);
  return { titulo: criados.length === 1 ? 'Item guardado' : `${criados.length} itens guardados`, detalhe: partes.join(' ') };
}

/** O aviso da planilha quando é a voz que não conseguiu gravar: a frase ainda vira ideia, então diz isso em vez de "nada foi gravado". */
export const textoDoAvisoDeListaNaVoz = (aviso: AvisoDePlanilha = 'sem_acesso'): string =>
  TEXTO_DO_AVISO_DE_PLANILHA[aviso].replace('Nada foi gravado.', 'Os itens não foram para a planilha.');

/** O que o cartão diz depois do Desfazer, conforme o que de fato aconteceu com cada linha. */
export function textoDoDesfazerDeItens(saidas: readonly ResultadoDoDesfazer[], plural: boolean): { titulo: string; detalhe: string } {
  const titulo = plural ? 'Itens desfeitos' : 'Item desfeito';
  if (saidas.every((s) => s === 'tirada_da_fila')) {
    return { titulo, detalhe: plural ? 'Os itens saíram da lista e não serão enviados.' : 'O item saiu da lista e não será enviado.' };
  }
  return { titulo, detalhe: `${plural ? 'Os itens saíram' : 'O item saiu'} da lista. Na planilha, ${plural ? 'as linhas ficam marcadas' : 'a linha fica marcada'} como "desfeito".` };
}

/** O que a tela diz depois de marcar ou desmarcar um item (`ok` e `na_fila` não são erro). */
export function textoDeMarcarItem(resultado: ResultadoDaAtualizacao, item: string, comprado: boolean): { tipo: 'ok' | 'aviso' | 'erro'; texto: string } {
  switch (resultado) {
    case 'ok':
      return { tipo: 'ok', texto: comprado ? `“${item}” marcado como comprado.` : `“${item}” voltou para a lista.` };
    case 'na_fila':
      return { tipo: 'aviso', texto: TEXTO_SEM_REDE_NA_LISTA };
    case 'conflito':
      return { tipo: 'aviso', texto: `Alguém mudou “${item}” ao mesmo tempo. Mostrei como está agora.` };
    case 'sumiu':
      return { tipo: 'aviso', texto: `“${item}” não está mais na planilha. Atualizei a lista.` };
    case 'planilha_mudou':
      return { tipo: 'erro', texto: TEXTO_DO_AVISO_DE_PLANILHA.planilha_mudou };
    default:
      return { tipo: 'erro', texto: TEXTO_DO_AVISO_DE_PLANILHA.sem_acesso };
  }
}

// ---------- Financeiro (Tarefa 16) ----------

/** O valor sempre com a moeda: `€ 5,50`, `€ 1.250,75`. Reembolso (negativo): `−€ 5,50`. */
export const eurosEmBr = (valor: number): string => `${valor < 0 ? '−' : ''}€ ${Math.abs(valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Os avisos do roteador e do `registrarGasto` como o dono os lê (ponto no valor arredondado vira vírgula). */
const textoDoAvisoDoGasto = (aviso: string): string => textoDoAvisoDaFrase(aviso).replace(/(\d)\.(\d)/g, '$1,$2');

export const TEXTO_SEM_REDE_NO_GASTO = 'Sem internet: o gasto fica neste aparelho e vai para a planilha quando a rede voltar.';
export const TEXTO_SEM_REDE_NA_TROCA = 'Sem internet: a troca de categoria fica neste aparelho e vai para a planilha quando a rede voltar.';

/** O cartão de um gasto gravado (tela do Financeiro e Pode falar): € valor · categoria · Tipo, a descrição, a data e os avisos. */
export function textosDoGasto(
  nomeDaPasta: string,
  gasto: Pick<Lancamento, 'valor' | 'categoria' | 'tipo' | 'descricao' | 'data'>,
  situacao: 'enviada' | 'na_fila',
  avisos: readonly string[] = [],
  notaDaTroca?: string,
): { titulo: string; detalhe: string } {
  const partes = [`${eurosEmBr(gasto.valor)} · ${gasto.categoria} · ${gasto.tipo}.`, `“${gasto.descricao}” em ${dataEmBr(gasto.data)}, na pasta ${nomeDaPasta}.`];
  for (const a of avisos) partes.push(`${textoDoAvisoDoGasto(a).replace(/\.$/, '')}.`);
  if (situacao === 'na_fila') partes.push(TEXTO_SEM_REDE_NO_GASTO);
  if (notaDaTroca) partes.push(notaDaTroca);
  return { titulo: 'Gasto guardado', detalhe: partes.join(' ') };
}

/** Por que a voz não gravou o gasto na planilha. O cartão acrescenta "Ficou guardado como ideia." */
export const TEXTO_DO_GASTO_NA_VOZ = {
  sem_pasta: 'Não achei a pasta Financeiro na Casa, com planilha. Crie a pasta em Casa > Nova pasta (Planilha ligada) para guardar gastos.',
  reais: 'Gasto em reais não vai para a planilha (só €).',
  futura: 'A data é no futuro; o gasto não foi para a planilha.',
} as const;

export const TEXTO_DA_RECUSA_DO_GASTO: Record<'valor_invalido' | 'data_invalida' | 'texto_longo' | 'moeda_diferente' | 'descricao_vazia', string> = {
  valor_invalido: 'O valor precisa ser maior que zero; o gasto não foi para a planilha.',
  data_invalida: 'A data não vale (o ano precisa estar entre 2000 e 2100); o gasto não foi para a planilha.',
  texto_longo: 'O texto do gasto é longo demais; o gasto não foi para a planilha.',
  moeda_diferente: TEXTO_DO_GASTO_NA_VOZ.reais,
  descricao_vazia: 'Não entendi o que foi o gasto (faltou a descrição); o gasto não foi para a planilha.',
};

/** O aviso da planilha quando é a voz que não conseguiu gravar: a frase ainda vira ideia, então diz isso em vez de "nada foi gravado". */
export const textoDoAvisoDeGastoNaVoz = (aviso: AvisoDePlanilha = 'sem_acesso'): string =>
  TEXTO_DO_AVISO_DE_PLANILHA[aviso].replace('Nada foi gravado.', 'O gasto não foi para a planilha.');

/** O que o dono lê quando "Trocar categoria" não trocou. */
export const TEXTO_DA_TROCA_QUE_FALHOU = {
  conflito: 'Alguém mudou este gasto ao mesmo tempo. A categoria não foi trocada. Tente de novo.',
  sumiu: 'Este gasto não está mais na planilha. A categoria não foi trocada.',
  planilha_mudou: 'A planilha mudou: falta uma coluna que a Central usa. A categoria não foi trocada. Abra a planilha e confira os títulos das colunas.',
  indisponivel: 'A Central não conseguiu abrir esta planilha agora. A categoria não foi trocada. Tente de novo daqui a pouco.',
  categoria_invalida: (maximo: number): string => `A categoria pode ter no máximo ${maximo} caracteres. Nada foi trocado.`,
  erro: 'Não consegui trocar a categoria agora. Nada mudou. Tente de novo.',
  vazia: 'Escolha uma categoria ou digite o nome dela.',
} as const;
