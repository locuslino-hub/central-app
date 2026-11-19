// Executa uma frase dita ou escrita em "Pode falar" (V02, Tarefa 6): decide para
// onde ela vai, grava na hora e devolve o que o cartão de resultado mostra, com
// o Desfazer. Nunca grava em silêncio: quem chama sempre mostra o cartão.
//
// Ordem (spec 5.2): 1) o roteador da V02 (gasto, leitura, item de lista); 2) as
// regras do chat da V01, que fazem tarefa e compromisso; 3) sem pista clara,
// Ideias. Leitura de água, luz ou gás grava na pasta de Registro do serviço (Tarefa 13);
// dentro de uma pasta de Registro, a fala vai direto para ela. Item de lista de compras grava na pasta de Lista
// (Tarefa 14); dentro de uma pasta de Lista, a frase curta de itens ("leite e pão") vai para ela, só se for claramente
// lista. Gasto grava na pasta Financeiro (Tarefa 16), com "Trocar categoria" no cartão; em reais, sem pasta, sem
// descrição, com data no futuro ou com a planilha impedindo, o gasto NÃO vai para a planilha: vira ideia, com o motivo.
import { avisoDaAgenda } from '../dados/compromisso';
import { hojeEmLisboa } from '../dados/dia';
import { canonicalizarCategoria, categoriasEmUso, CATEGORIA_NO_MAXIMO, lerLancamentos, registrarGasto, trocarCategoria, type Lancamento, type ResultadoDoGasto } from '../dados/financeiro';
import { criarIdeia, IDEIA_NO_MAXIMO, TEXTO_INVALIDO } from '../dados/ideias';
import { registrarLeitura } from '../dados/leituras';
import { adicionarItens, type ResultadoDosItens } from '../dados/lista';
import { listar } from '../dados/loja';
import type { Pasta } from '../dados/tipos';
import { avisoDoTema, descreverQuando } from '../ui/Cartao';
import {
  NOME_DO_SERVICO,
  TEXTO_DA_RECUSA_DO_GASTO,
  TEXTO_DA_TROCA_QUE_FALHOU,
  TEXTO_DO_GASTO_NA_VOZ,
  TEXTO_SEM_REDE_NA_TROCA,
  textoDoAvisoDeGastoNaVoz,
  textoDoAvisoDeLeituraNaVoz,
  textoDoAvisoDeListaNaVoz,
  textosDaLeitura,
  textosDoGasto,
  textosDosItens,
  unidadeDoServico,
} from '../ui/pastas-textos';
import { hrefDe, hrefDoCalendario } from '../rotas';
import { normalizar } from './datas';
import { criarItem, interpretar, type ItemDoChat } from './interpretar';
import { extrairItensDeListaCurta, extrairLeitura, RE_PEDIDO_DE_TAREFA, rotear, type Destino, type Gasto, type Leitura, type NomeDeLista } from './roteador';

/**
 * "Trocar categoria" do cartão do gasto (spec 5.2). `trocar` nunca lança: devolve o cartão novo (com a categoria nova como
 * atual) ou o texto de por que não trocou, e nada muda.
 */
export type TrocaDeCategoria = {
  atual: string;
  /** As categorias já usadas na planilha (mais a deste gasto), em ordem alfabética. */
  opcoes: readonly string[];
  trocar: (categoria: string) => Promise<{ mudou: true; resultado: ResultadoDaFrase } | { mudou: false; mensagem: string }>;
};

export type ResultadoDaFrase = {
  titulo: string;
  detalhe: string;
  /** Para onde o botão "Ver" leva; `null` se nenhuma tela mostra o resultado. */
  ver: string | null;
  desfazer: () => Promise<void>;
  corrigir?: () => void;
  /** O áudio ficou ligado a uma ideia: quem chama deve enviá-lo ao Drive, depois do texto. */
  audioId?: string;
  /**
   * Só quando a frase virou tarefa ou compromisso (spec 5.2): troca o item por uma
   * ideia com a mesma frase (e o áudio, se houver) e devolve o cartão da ideia.
   * A ideia é criada antes de o item sair. Item que não puder sair continua
   * guardado e o cartão da ideia avisa qual é: a frase nunca se perde e nada fica
   * em dobro sem aviso.
   */
  guardarComoIdeia?: (audio?: { id: string; segundos: number }) => Promise<ResultadoDaFrase>;
  /**
   * Só quando itens de lista já estavam na lista e não foram repetidos ("Pôr mesmo assim"): grava os repetidos e devolve
   * o cartão novo, cujo Desfazer cobre também o que já tinha sido guardado.
   */
  repetir?: () => Promise<ResultadoDaFrase>;
  /** Nada foi gravado: não há o que desfazer, então o cartão não mostra Desfazer. */
  semDesfazer?: boolean;
  /** Só no cartão do gasto gravado no Financeiro. */
  trocarCategoria?: TrocaDeCategoria;
};

export type ContextoDaFrase = {
  /** Dentro de uma pasta, a fala vai direto para ela (chega com as pastas, Tarefa 9). */
  pastaAtual?: string;
  /** O áudio gravado junto: só uma ideia o guarda. */
  audio?: { id: string; segundos: number };
};


/**
 * Tarefa que as regras montaram sem nenhuma pista do dono: sem sala, sem pessoa,
 * sem dia nem hora ditos e sem pedido de tarefa. Isso é uma ideia solta.
 */
function semPista(item: ItemDoChat, frase: string): boolean {
  return (
    item.tipo === 'tarefa' &&
    item.salaId === null &&
    item.diaAssumido === true &&
    !item.inicio &&
    !item.prazoHora &&
    !item.marcar &&
    !item.pessoaId &&
    !item.temaNaoAchado &&
    !RE_PEDIDO_DE_TAREFA.test(normalizar(frase))
  );
}

/** Guarda a frase como ideia e devolve o cartão (Ver leva a `#/ideias`). Texto inválido lança `texto_invalido`. */
export async function guardarFraseComoIdeia(frase: string, ctx: ContextoDaFrase = {}, aviso?: string): Promise<ResultadoDaFrase> {
  const { ideia, desfazer } = await criarIdeia(frase, ctx.audio ? { audioId: ctx.audio.id, audioSegundos: ctx.audio.segundos } : {});
  const comAudio = !!ideia.audioId;
  const partes = [`“${ideia.texto}”`];
  if (aviso) partes.push(`${aviso} Ficou guardado como ideia.`);
  return {
    titulo: 'Guardado em Ideias',
    detalhe: partes.join(' '),
    ver: hrefDe('ideias'),
    desfazer,
    ...(comAudio ? { audioId: ideia.audioId } : {}),
  };
}

async function guardarItens(itens: ItemDoChat[], frase: string): Promise<ResultadoDaFrase> {
  const hoje = hojeEmLisboa();
  const salas = await listar('salas');
  const criados: { item: ItemDoChat; aviso: string | null; desfazer: () => Promise<void> }[] = [];
  try {
    for (const item of itens) {
      const criado = await criarItem(item);
      const aviso = criado.agenda ? avisoDaAgenda(criado.agenda) : null;
      criados.push({ item, aviso, desfazer: criado.desfazer });
    }
  } catch (erro) {
    // Um item falhou no meio: o que já entrou sai, para não ficar guardado pela metade.
    await Promise.allSettled(criados.map((c) => c.desfazer()));
    throw erro;
  }
  const descrever = ({ item, aviso }: (typeof criados)[number]) => {
    const sala = item.salaId === null ? 'Sem sala' : (salas.find((s) => s.id === item.salaId)?.nome ?? 'Sem sala');
    const tema = avisoDoTema(item);
    const nomeDoTema = tema?.tipo === 'achado' ? `Tema ${item.temaNome}` : null;
    return [item.titulo, sala, nomeDoTema, descreverQuando(item, hoje), tema?.tipo === 'nao-achado' ? tema.texto : null, aviso]
      .filter(Boolean)
      .join(' · ');
  };
  const [primeiro] = itens;
  // Tarefa do tema (uma só): o cartão leva à pasta dela.
  const ver =
    primeiro!.tipo === 'compromisso' && primeiro!.data
      ? hrefDoCalendario('semana', primeiro!.data)
      : itens.length === 1 && primeiro!.pastaId && primeiro!.salaId
        ? hrefDe('pasta', primeiro!.salaId, primeiro!.pastaId)
        : hrefDe('atividades');
  const titulo =
    criados.length > 1
      ? `${criados.length} itens guardados`
      : primeiro!.tipo === 'compromisso'
        ? 'Compromisso guardado'
        : 'Tarefa guardada';
  const desfazerTudo = async () => {
    await Promise.all(criados.map((c) => c.desfazer()));
  };
  return {
    titulo,
    detalhe: criados.map(descrever).join(' | '),
    ver,
    desfazer: desfazerTudo,
    guardarComoIdeia: async (audio) => {
      // A ideia nasce primeiro: a frase nunca se perde. Os itens saem um a um; o que não sair continua
      // guardado e o cartão diz qual é (nada some em silêncio nem fica em dobro sem aviso).
      const ideia = await guardarFraseComoIdeia(frase, audio ? { audio } : {});
      const saidas = await Promise.allSettled(criados.map((c) => c.desfazer()));
      const ficaram = criados.filter((_, i) => saidas[i]!.status === 'rejected');
      if (ficaram.length === 0) return ideia;
      console.error('Não consegui tirar o item ao guardar como ideia', saidas.filter((s) => s.status === 'rejected'));
      const nomes = ficaram.map((c) => `“${c.item.titulo}”`).join(', ');
      const aviso = ficaram.length === 1 ? `Atenção: não consegui tirar ${nomes}; ele continua guardado.` : `Atenção: não consegui tirar ${nomes}; eles continuam guardados.`;
      return { ...ideia, detalhe: `${ideia.detalhe} ${aviso}` };
    },
  };
}

// ---- Leitura de consumo ----

type Servico = NonNullable<Pasta['servico']>;

/** A pasta de Registro do serviço: a pasta onde o dono está, se for dele; senão a primeira da Casa com planilha. */
function pastaDeConsumo(pastas: Pasta[], servico: Servico, pastaAtual?: string): Pasta | null {
  const viva = pastas.filter((p) => p.tipo === 'registro' && p.servico === servico && !!p.planilhaId);
  return viva.find((p) => p.id === pastaAtual) ?? viva.sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))[0] ?? null;
}

const RE_PALAVRA_DE_LEITURA = /(?<![a-z])(?:leitura|consumo|contador|medidor|relogio)(?![a-z])/;
const RE_UNIDADE_DITA = /(?<![a-z\d])(?:kwh|m3|m³|metros?\s+cubicos?)(?![a-z])/;
/** O único complemento que não muda o sentido de um número solto: o dia da leitura. */
const RE_SO_DIA_RELATIVO = /^(?:hoje|ontem|anteontem)$/;

/**
 * Dentro da pasta de Registro: "leitura 1234", "1234 m³", "1234 ontem". Precisa da palavra "leitura", de uma unidade
 * ou de um número plausível (3 dígitos ou mais) sem outras palavras; "3", "dia 15", "2 e 3" e tarefa não valem.
 * Na dúvida, caminho normal.
 */
function parecePedidoDeLeitura(frase: string): boolean {
  const n = normalizar(frase);
  if (RE_PEDIDO_DE_TAREFA.test(n)) return false;
  if (RE_PALAVRA_DE_LEITURA.test(n) || RE_UNIDADE_DITA.test(n)) return true;
  const palavras = n.split(/[^a-z]+/).filter(Boolean);
  return /\d{3,}/.test(n) && palavras.every((p) => RE_SO_DIA_RELATIVO.test(p));
}

const PALAVRA_DO_SERVICO: Record<Servico, string> = { agua: 'água', luz: 'luz', gas: 'gás' };

/** O serviço da leitura e a pasta que a recebe. `null`: a frase não é leitura para este contexto. */
function destinoDeLeitura(texto: string, hoje: string, destino: Destino, pastaAtual: Pasta | undefined): Leitura | null {
  if (destino.tipo === 'leitura') return destino.leitura;
  // Só dentro de uma pasta de Registro: a frase não diz o serviço, a pasta diz.
  if (destino.tipo !== 'outro' || !pastaAtual || pastaAtual.tipo !== 'registro' || !pastaAtual.servico) return null;
  if (!parecePedidoDeLeitura(texto)) return null;
  return extrairLeitura(`leitura da ${PALAVRA_DO_SERVICO[pastaAtual.servico]} ${texto}`, hoje);
}

/**
 * Grava a leitura na pasta de Registro do serviço e devolve o cartão (Desfazer, Guardar como ideia). Sem pasta do
 * serviço, ou com a planilha impedindo a gravação, a frase vira ideia e o cartão diz por quê: nada se perde.
 */
async function guardarLeitura(texto: string, leitura: Leitura, pastas: Pasta[], ctx: ContextoDaFrase): Promise<ResultadoDaFrase> {
  const pasta = pastaDeConsumo(pastas, leitura.servico, ctx.pastaAtual);
  if (!pasta) {
    return guardarFraseComoIdeia(
      texto,
      ctx,
      `Não achei uma pasta de Consumo de ${NOME_DO_SERVICO[leitura.servico]} na Casa, com planilha. Crie a pasta em Casa > Nova pasta para guardar leituras.`,
    );
  }
  // Pela tela uma data futura é bloqueada; pela voz também: a leitura não vai para a planilha.
  if (leitura.avisos.includes('data futura')) {
    return guardarFraseComoIdeia(texto, ctx, 'A data é no futuro; a leitura não foi para a planilha.');
  }
  const unidade = pasta.unidade ?? unidadeDoServico(leitura.servico);
  const nova = { data: leitura.data, valor: leitura.valor, unidade };
  const resultado = await registrarLeitura(pasta, nova);
  const { titulo, detalhe } = textosDaLeitura(pasta.nome, nova, resultado, leitura.avisos);
  if (resultado.anexo.situacao === 'bloqueada') return guardarFraseComoIdeia(texto, ctx, textoDoAvisoDeLeituraNaVoz(resultado.anexo.aviso));
  const ver = hrefDe('pasta', pasta.salaId, pasta.id);
  return {
    titulo,
    detalhe,
    ver,
    desfazer: async () => {
      await resultado.anexo.desfazer();
    },
    guardarComoIdeia: async (audio) => {
      // A ideia nasce primeiro; só então a linha é desfeita (na planilha fica marcada "desfeito", nunca apagada).
      const ideia = await guardarFraseComoIdeia(texto, audio ? { audio } : {});
      try {
        await resultado.anexo.desfazer();
      } catch (erro) {
        console.error('Não consegui desfazer a leitura ao guardar como ideia', erro);
        return { ...ideia, detalhe: `${ideia.detalhe} Atenção: não consegui tirar a leitura da planilha; ela continua lá.` };
      }
      return ideia;
    },
  };
}

// ---- Itens de lista de compras ----

const ID_DA_LISTA_SEMANAL = 'pasta-casa-compras-semanais';
const ID_DA_LISTA_DA_CASA = 'pasta-casa-compras-casa';
const NOME_DA_LISTA: Record<'semanal' | 'casa', RegExp> = { semanal: /semana/, casa: /(?<![a-z])casa(?![a-z])/ };
const TEXTO_DA_LISTA: Record<NomeDeLista, string> = { semanal: 'de compras da semana', casa: 'de compras para casa', generica: 'de compras' };

/**
 * A pasta de Lista de uma frase. "Compras da semana" / "lista da casa" acham a pasta padrão (pelo id ou pelo nome); sem
 * isso (`null`: frase curta dentro da pasta), vale a pasta onde o dono está. Não adivinha: sem achar, `null`.
 */
function pastaDeLista(pastas: Pasta[], qual: NomeDeLista | null, pastaAtual?: string): Pasta | null {
  const listas = pastas.filter((p) => p.tipo === 'lista' && !!p.planilhaId);
  const daTela = listas.find((p) => p.id === pastaAtual) ?? null;
  if (qual === null) return daTela;
  // "Lista de compras" sem nome: a pasta de Lista onde o dono está; senão a semanal padrão; senão a única lista com planilha
  // (o dono pode ter criado a dele, com nome próprio); senão a de nome "compra" de menor ordem; senão `null`.
  if (qual === 'generica') {
    if (daTela) return daTela;
    const semanal = pastaDeLista(pastas, 'semanal');
    if (semanal) return semanal;
    if (listas.length === 1) return listas[0]!;
    return [...listas].sort((a, b) => a.ordem - b.ordem).find((p) => /compra/.test(normalizar(p.nome))) ?? null;
  }
  const idPadrao = qual === 'semanal' ? ID_DA_LISTA_SEMANAL : ID_DA_LISTA_DA_CASA;
  return listas.find((p) => p.id === idPadrao) ?? listas.sort((a, b) => a.ordem - b.ordem).find((p) => NOME_DA_LISTA[qual].test(normalizar(p.nome))) ?? null;
}

/** O cartão dos itens da lista, com Desfazer, Guardar como ideia e, se houver repetidos, "Pôr mesmo assim". */
function resultadoDosItens(texto: string, pasta: Pasta, r: ResultadoDosItens, antes?: () => Promise<unknown>): ResultadoDaFrase {
  const { titulo, detalhe: detalheBase } = textosDosItens(pasta.nome, r);
  // Depois de "Pôr mesmo assim", o Desfazer cobre também o que já tinha sido guardado: o cartão diz isso.
  const detalhe = antes ? `${detalheBase} Desfazer tira todos os itens deste pedido.` : detalheBase;
  const desfazerTudo = async () => {
    const feitos = await Promise.allSettled([antes?.(), r.desfazer()]);
    const falha = feitos.find((f): f is PromiseRejectedResult => f.status === 'rejected');
    if (falha) throw falha.reason;
  };
  return {
    titulo,
    detalhe,
    ver: hrefDe('pasta', pasta.salaId, pasta.id),
    desfazer: desfazerTudo,
    ...(r.criados.length === 0 && !antes ? { semDesfazer: true } : {}),
    guardarComoIdeia: async (audio) => {
      // A ideia nasce primeiro; só então as linhas são desfeitas (na planilha ficam marcadas "desfeito", nunca apagadas).
      const ideia = await guardarFraseComoIdeia(texto, audio ? { audio } : {});
      try {
        await desfazerTudo();
      } catch (erro) {
        console.error('Não consegui desfazer os itens ao guardar como ideia', erro);
        return { ...ideia, detalhe: `${ideia.detalhe} Atenção: não consegui tirar os itens da planilha; eles continuam lá.` };
      }
      return ideia;
    },
    ...(r.repetidos.length > 0
      ? { repetir: async () => resultadoDosItens(texto, pasta, await adicionarItens(pasta, r.repetidos, { repetir: true }), desfazerTudo) }
      : {}),
  };
}

/**
 * Grava os itens na pasta de Lista e devolve o cartão (Desfazer, Guardar como ideia). Sem pasta de lista com planilha, ou
 * com a planilha impedindo a gravação, a frase vira ideia e o cartão diz por quê: nada se perde. Item que já estava na
 * lista não é repetido sem perguntar.
 */
async function guardarItensDeLista(texto: string, itens: string[], pastas: Pasta[], ctx: ContextoDaFrase, qual: NomeDeLista | null): Promise<ResultadoDaFrase> {
  const pasta = pastaDeLista(pastas, qual, ctx.pastaAtual);
  if (!pasta) {
    return guardarFraseComoIdeia(
      texto,
      ctx,
      `Não achei a lista ${qual ? TEXTO_DA_LISTA[qual] : 'de compras'} na Casa, com planilha. Crie a pasta em Casa > Nova pasta para guardar itens.`,
    );
  }
  const r = await adicionarItens(pasta, itens);
  if (r.criados.length === 0 && r.bloqueio) return guardarFraseComoIdeia(texto, ctx, textoDoAvisoDeListaNaVoz(r.bloqueio));
  return resultadoDosItens(texto, pasta, r);
}

// ---- Gasto ----

/**
 * A pasta Financeiro (tipo Planilha, com planilha ligada): a pasta onde o dono está, se for uma delas; senão a de menor
 * ordem. Planilha ligada só existe na Casa.
 */
function pastaDeFinanceiro(pastas: Pasta[], pastaAtual?: string): Pasta | null {
  const vivas = pastas.filter((p) => p.tipo === 'planilha' && !!p.planilhaId);
  return vivas.find((p) => p.id === pastaAtual) ?? vivas.sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))[0] ?? null;
}

type GastoGravado = Extract<ResultadoDoGasto, { gravado: true }>;

/** O cartão do gasto gravado, com Desfazer, Trocar categoria e Guardar como ideia. Trocar devolve o mesmo cartão com a categoria nova. */
function cartaoDoGasto(texto: string, pasta: Pasta, gravado: GastoGravado, lancamento: Lancamento, categorias: readonly string[], notaDaTroca?: string): ResultadoDaFrase {
  const { titulo, detalhe } = textosDoGasto(pasta.nome, lancamento, gravado.situacao, gravado.avisos, notaDaTroca);
  return {
    titulo,
    detalhe,
    ver: hrefDe('pasta', pasta.salaId, pasta.id),
    desfazer: async () => {
      await gravado.desfazer();
    },
    guardarComoIdeia: async (audio) => {
      // A ideia nasce primeiro; só então a linha é desfeita (na planilha fica marcada "desfeito", nunca apagada).
      const ideia = await guardarFraseComoIdeia(texto, audio ? { audio } : {});
      try {
        await gravado.desfazer();
      } catch (erro) {
        console.error('Não consegui desfazer o gasto ao guardar como ideia', erro);
        return { ...ideia, detalhe: `${ideia.detalhe} Atenção: não consegui tirar o gasto da planilha; ele continua lá.` };
      }
      return ideia;
    },
    trocarCategoria: {
      atual: lancamento.categoria,
      opcoes: categorias,
      trocar: async (nova) => {
        const categoria = canonicalizarCategoria(nova, categorias);
        let feito: Awaited<ReturnType<typeof trocarCategoria>>;
        try {
          feito = await trocarCategoria(pasta, gravado.idDaLinha, categoria);
        } catch (erro) {
          console.error('Não consegui trocar a categoria do gasto', erro);
          return { mudou: false, mensagem: TEXTO_DA_TROCA_QUE_FALHOU.erro };
        }
        if (feito === 'categoria_invalida') return { mudou: false, mensagem: TEXTO_DA_TROCA_QUE_FALHOU.categoria_invalida(CATEGORIA_NO_MAXIMO) };
        if (feito !== 'ok' && feito !== 'na_fila') return { mudou: false, mensagem: TEXTO_DA_TROCA_QUE_FALHOU[feito] };
        const opcoes = categorias.includes(categoria) ? categorias : [...categorias, categoria].sort((a, b) => a.localeCompare(b, 'pt-BR'));
        return { mudou: true, resultado: cartaoDoGasto(texto, pasta, gravado, { ...lancamento, categoria }, opcoes, feito === 'na_fila' ? TEXTO_SEM_REDE_NA_TROCA : undefined) };
      },
    },
  };
}

/**
 * Grava o gasto na pasta Financeiro e devolve o cartão. Gasto em reais, sem pasta Financeiro, com data no futuro, sem
 * descrição ou com a planilha impedindo NÃO vai para a planilha: vira ideia e o cartão diz por quê.
 */
async function guardarGasto(texto: string, gasto: Gasto, pastas: Pasta[], ctx: ContextoDaFrase): Promise<ResultadoDaFrase> {
  if (gasto.moeda !== '€') return guardarFraseComoIdeia(texto, ctx, TEXTO_DO_GASTO_NA_VOZ.reais);
  const pasta = pastaDeFinanceiro(pastas, ctx.pastaAtual);
  if (!pasta) return guardarFraseComoIdeia(texto, ctx, TEXTO_DO_GASTO_NA_VOZ.sem_pasta);
  // Pela tela uma data futura é bloqueada; pela voz também: o gasto não vai para a planilha.
  if (gasto.avisos.includes('data futura')) return guardarFraseComoIdeia(texto, ctx, TEXTO_DO_GASTO_NA_VOZ.futura);

  // As categorias que a planilha já usa: a do gasto usa a mesma grafia. Sem conseguir ler, grava assim mesmo.
  let existentes: Lancamento[] = [];
  try {
    existentes = (await lerLancamentos(pasta)).lancamentos;
  } catch (erro) {
    console.warn('Não consegui ler a planilha do Financeiro antes de gravar o gasto', erro);
  }
  const categoria = canonicalizarCategoria(gasto.categoria ?? '', categoriasEmUso(existentes));
  const feito = await registrarGasto(pasta, { valor: gasto.valor, moeda: gasto.moeda, data: gasto.data, descricao: gasto.descricao, categoria, avisos: gasto.avisos });
  if (!feito.gravado) {
    return guardarFraseComoIdeia(texto, ctx, feito.situacao === 'bloqueada' ? textoDoAvisoDeGastoNaVoz(feito.aviso) : TEXTO_DA_RECUSA_DO_GASTO[feito.motivo ?? 'valor_invalido']);
  }
  return cartaoDoGasto(texto, pasta, feito, feito.lancamento, categoriasEmUso([...existentes, feito.lancamento]));
}

/**
 * Grava a frase onde ela mora e devolve o cartão. Frase sem nenhuma letra ou
 * número, ou com mais de 2.000 caracteres, lança `texto_invalido` antes de
 * qualquer coisa e não grava nada. Se uma gravação falhar, o erro sobe: quem
 * chama mantém o texto na tela.
 *
 * "Ideia ou não" se decide só pelas regras, antes da IA: a IA, quando pronta,
 * pode dar sala ou dividir a frase, e uma ideia solta viraria tarefa. A IA só é
 * chamada depois, para a frase que já se mostrou um pedido.
 */
export async function executarFrase(frase: string, ctx: ContextoDaFrase = {}): Promise<ResultadoDaFrase> {
  const texto = typeof frase === 'string' ? frase.trim() : '';
  if (!/[\p{L}\p{N}]/u.test(texto) || texto.length > IDEIA_NO_MAXIMO) throw new Error(TEXTO_INVALIDO);

  const hoje = hojeEmLisboa();
  const destino = rotear(texto, hoje);
  const pastas = destino.tipo === 'leitura' || destino.tipo === 'lista' || destino.tipo === 'gasto' || ctx.pastaAtual ? await listar('pastas') : [];
  const pastaDaTela = pastas.find((p) => p.id === ctx.pastaAtual);
  const leitura = destinoDeLeitura(texto, hoje, destino, pastaDaTela);
  if (leitura) return guardarLeitura(texto, leitura, pastas, ctx);
  if (destino.tipo === 'lista') return guardarItensDeLista(texto, destino.itens, pastas, ctx, destino.lista);
  if (destino.tipo === 'gasto') return guardarGasto(texto, destino.gasto, pastas, ctx);
  // Dentro de uma pasta de Lista, a frase curta que é claramente uma lista de itens vai para ela.
  const daLista = destino.tipo === 'outro' && pastaDaTela?.tipo === 'lista' && !!pastaDaTela.planilhaId ? extrairItensDeListaCurta(texto) : null;
  if (daLista) return guardarItensDeLista(texto, daLista, pastas, ctx, null);

  const pelasRegras = await interpretar(texto, { semIA: true });
  if (pelasRegras.length === 0 || (pelasRegras.length === 1 && semPista(pelasRegras[0]!, texto))) {
    return guardarFraseComoIdeia(texto, ctx);
  }
  const itens = await interpretar(texto);
  return guardarItens(itens.length ? itens : pelasRegras, texto);
}
