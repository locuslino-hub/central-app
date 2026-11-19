// Itens de uma pasta de Lista de compras (V02, Tarefa 14): lê as linhas da planilha como itens, grava itens novos e marca
// "comprado". Serve à tela da pasta e à voz (executar.ts).
//
// - A planilha é dado de terceiros (outras pessoas com acesso à pasta editam): `Comprado?` aceita TRUE, sim, x, ✓ e parecidos; o que não for
//   isso conta como "ainda não comprado". Linha sem `Item` fica de fora (o script também a ignora).
// - Item repetido (mesmo nome, sem acento nem maiúscula, ainda não comprado) NÃO é gravado em silêncio: devolve em
//   `repetidos` e quem chama pergunta. Item já comprado pode ser comprado de novo.
// - Só se anexa linha e se atualiza `Comprado?`. Nada apaga linha: o desfazer é o de `anexar` (marca "desfeito").
import { normalizar } from '../chat/datas';
import { hojeEmLisboa } from './dia';
import { anexar, atualizar, lerPlanilha, type LinhaDaPlanilha, type OpcoesDePlanilha, type ResultadoDaAtualizacao, type ResultadoDoAnexo, type ResultadoDoDesfazer, type AvisoDePlanilha } from './planilhas';
import type { Pasta } from './tipos';

export const COLUNA_COMPRADO = 'Comprado?';
/** O que a Central escreve em "Quem pôs": o nome da pessoa não vive no código. A planilha mostra de onde veio. */
export const QUEM_POS_DA_CENTRAL = 'Central';
export const ITEM_NO_MAXIMO = 80;
export const QUANTIDADE_NO_MAXIMO = 30;

const COMPRADO = new Set(['true', 'verdadeiro', 'sim', 's', 'x', 'ok', '1', 'yes', 'comprado', 'comprada', '✓', '✔', '☑', '✅']);
/** Tira o seletor de emoji (U+FE0F) que acompanha ✔️ e ☑️ ao serem copiados de outros lugares. */
export const estaComprado = (valor: string | undefined): boolean => COMPRADO.has((valor ?? '').replace(/️/g, '').trim().toLowerCase());

/** Para achar item repetido: sem acento, sem maiúscula, espaços juntos. */
const ARTIGO_NO_COMECO = /^(?:o|a|os|as|um|uma|uns|umas)\s+/;

/** O item sem o artigo do começo ("o leite" → "leite"). Item que é só o artigo, ou sem artigo, fica como está. */
export function itemSemArtigo(item: string): string {
  const sem = item.replace(/^(?:o|a|os|as|um|uma|uns|umas)\s+/i, '').trim();
  return sem === '' ? item : sem;
}

/**
 * Para achar item repetido: sem acento, maiúscula, artigo do começo nem pontuação das pontas, com o "s" do plural das
 * palavras de 4 letras ou mais tirado ("o Leite." = "leite", "um ovo" = "Ovos").
 */
export const nomeComparavel = (item: string): string =>
  normalizar(item)
    .replace(/^[\s.,;:!?-]+|[\s.,;:!?-]+$/g, '')
    .replace(ARTIGO_NO_COMECO, '')
    .split(/\s+/)
    .map((palavra) => (palavra.length >= 4 && palavra.endsWith('s') ? palavra.slice(0, -1) : palavra))
    .join(' ')
    .trim();

/** O texto de um item novo, pronto para gravar: espaços juntos, sem quebra de linha. `null` se vazio ou longo demais. */
export function itemDeTexto(texto: string): string | null {
  const item = texto.replace(/[\p{Cc}\s]+/gu, ' ').trim();
  return item !== '' && item.length <= ITEM_NO_MAXIMO ? item : null;
}

// ---------- ler ----------

export type ItemDaLista = {
  /** Id da linha na planilha. */
  id: string;
  item: string;
  quantidade: string;
  quemPos: string;
  /** `AAAA-MM-DD` (ou o texto da planilha, se for outro formato). */
  data: string;
  comprado: boolean;
  /** `fila`: sem rede, sai ao voltar. */
  pendente?: 'fila';
};

export type ResumoDaLista = {
  /** Na ordem da planilha. */
  itens: ItemDaLista[];
  /** Anexos que a sincronia desistiu de enviar: não estão salvos. */
  naoSalvos: { id: string; item: string }[];
};

/** Os itens de uma planilha de compras. Não falha com linha estranha. */
export function resumirLista(linhas: readonly LinhaDaPlanilha[]): ResumoDaLista {
  const itens: ItemDaLista[] = [];
  const naoSalvos: { id: string; item: string }[] = [];
  for (const linha of linhas) {
    const item = (linha.valores['Item'] ?? '').trim();
    if (item === '') continue;
    if (linha.pendente === 'parada') {
      naoSalvos.push({ id: linha.id, item });
      continue;
    }
    itens.push({
      id: linha.id,
      item,
      quantidade: (linha.valores['Quantidade'] ?? '').trim(),
      quemPos: (linha.valores['Quem pôs'] ?? '').trim(),
      data: (linha.valores['Data'] ?? '').trim(),
      comprado: estaComprado(linha.valores[COLUNA_COMPRADO]),
      ...(linha.pendente === 'fila' ? { pendente: 'fila' as const } : {}),
    });
  }
  return { itens, naoSalvos };
}

// ---------- gravar itens ----------

export type OpcoesDosItens = OpcoesDePlanilha & {
  /** `AAAA-MM-DD`; padrão: hoje em Lisboa. */
  hoje?: string;
  /** Grava também os que já estão na lista ("Pôr mesmo assim"). */
  repetir?: boolean;
  /** Quantidade de cada item, na ordem de `textos` (só a tela usa). */
  quantidades?: readonly string[];
};

export type ResultadoDosItens = {
  /** O que foi anexado, na ordem. */
  criados: { item: string; anexo: ResultadoDoAnexo }[];
  /** Os que já estavam na lista e NÃO foram gravados (só sem `repetir`). */
  repetidos: string[];
  /** A planilha não deixou gravar: nada foi gravado a partir daí (veja `criados` para o que já tinha entrado). */
  bloqueio?: AvisoDePlanilha;
  /** `true` se algum item ficou na fila (sem rede). */
  naFila: boolean;
  /**
   * Desfaz todos os `criados` (nunca apaga linha: marca "desfeito"). Lança se algum falhar; chamar de novo repete só o
   * que falta.
   */
  desfazer: () => Promise<ResultadoDoDesfazer[]>;
};

/**
 * Anexa um item por linha, com `Quem pôs` e `Data`. Lê a lista antes (se não der, usa o cache ou nada) para achar
 * repetidos. Se um anexo falhar no meio, o que já entrou sai e o erro sobe: nada fica pela metade.
 */
export async function adicionarItens(pasta: Pasta, textos: readonly string[], opcoes: OpcoesDosItens = {}): Promise<ResultadoDosItens> {
  const { hoje = hojeEmLisboa(), repetir = false, quantidades = [], ...daPlanilha } = opcoes;
  let existentes: ItemDaLista[] = [];
  try {
    existentes = resumirLista((await lerPlanilha(pasta, daPlanilha)).linhas).itens;
  } catch {
    // Sem leitura da planilha: grava assim mesmo (o anexo diz o que aconteceu) e não afirma nada sobre repetidos.
  }
  const naLista = new Set(existentes.filter((i) => !i.comprado).map((i) => nomeComparavel(i.item)));

  const criados: ResultadoDosItens['criados'] = [];
  const repetidos: string[] = [];
  let bloqueio: AvisoDePlanilha | undefined;
  const vistos = new Set<string>();
  try {
    for (const [i, texto] of textos.entries()) {
      const chave = nomeComparavel(texto);
      if (!repetir && (naLista.has(chave) || vistos.has(chave))) {
        repetidos.push(texto);
        continue;
      }
      vistos.add(chave);
      const item = itemSemArtigo(texto);
      const valores: Record<string, string> = { Item: item, 'Quem pôs': QUEM_POS_DA_CENTRAL, Data: hoje };
      const quantidade = quantidades[i]?.trim();
      if (quantidade) valores['Quantidade'] = quantidade;
      const anexo = await anexar(pasta, valores, daPlanilha);
      if (anexo.situacao === 'bloqueada') {
        bloqueio = anexo.aviso ?? 'sem_acesso';
        break;
      }
      criados.push({ item, anexo });
    }
  } catch (erro) {
    await Promise.allSettled(criados.map((c) => c.anexo.desfazer()));
    throw erro;
  }

  const desfazer = async () => {
    const saidas = await Promise.allSettled(criados.map((c) => c.anexo.desfazer()));
    const falha = saidas.find((s): s is PromiseRejectedResult => s.status === 'rejected');
    if (falha) throw falha.reason;
    return saidas.map((s) => (s as PromiseFulfilledResult<ResultadoDoDesfazer>).value);
  };
  return {
    criados,
    repetidos,
    ...(bloqueio ? { bloqueio } : {}),
    naFila: criados.some((c) => c.anexo.situacao === 'na_fila'),
    desfazer,
  };
}

// ---------- marcar ----------

/** Marca ou desmarca "comprado" na linha pelo id. O resultado diz o que aconteceu (veja `atualizar`). */
export function marcarComprado(pasta: Pasta, idDaLinha: string, comprado: boolean, opcoes: OpcoesDePlanilha = {}): Promise<ResultadoDaAtualizacao> {
  return atualizar(pasta, idDaLinha, { [COLUNA_COMPRADO]: comprado ? 'TRUE' : 'FALSE' }, opcoes);
}
