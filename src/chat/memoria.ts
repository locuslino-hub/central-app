// Memória do chat (Tarefa 8): a segunda das três camadas. Pessoas vêm da
// coleção `pessoas` e palavras de sala vêm de `palavras` (`{termo, salaId}`).
// As regras consultam a memória de forma síncrona, então ela é lida da loja
// antes (`carregarMemoria`) e responde do que leu. Aprender grava pela loja
// (`salvar`), então sincroniza com o outro aparelho.
//
// Comparação sem acento e sem maiúscula, sempre por palavra inteira:
// "lampada" acha "lâmpada", mas "projetor" não acha "projeto" (por isso as
// palavras iniciais trazem o plural à parte). Nome em minúscula ("para
// renata") não é tratado como pessoa desconhecida: só nome com maiúscula.
//
// Quem decide a sala, nesta ordem (regras.ts aplica): 1) sala dita na frase
// ("nas tarefas do doutoramento", "MBA"); 2) palavra guardada na memória
// ("banheiro" é Casa); 3) sala da pessoa cadastrada citada. Por isso Trocar
// sala aprende na palavra quando foi ela que decidiu, e na pessoa quando foi ela.
//
// Gravações da memória passam uma de cada vez (`emOrdem`): duas respostas ao
// mesmo tempo não criam a mesma pessoa ou palavra duas vezes neste aparelho.

import { listar, salvar } from '../dados/loja';
import type { Palavra, Pessoa, Sala } from '../dados/tipos';
import { normalizar } from './datas';
import type { Memoria } from './regras';

/** A memória que o chat usa: a de `regras.ts` (R7) e o que o cartão precisa a mais. */
export type MemoriaDoChat = Memoria & {
  /** O termo guardado (com os acentos dele) que decidiu a sala nesta frase. */
  termoDaSala(frase: string): string | null;
  pessoaPorId(id: string): Pessoa | undefined;
  /** Nome de sala ou palavra guardada: não é nome de pessoa. */
  conhecePalavra(palavra: string): boolean;
};

/** Títulos que não identificam ninguém: "Prof. Souza" é achado por "Souza". */
const TITULOS = new Set(['prof', 'profa', 'professor', 'professora', 'dr', 'dra', 'doutor', 'doutora', 'sr', 'sra']);
/** Partículas de nome: "Ana da Silva" não é achada por "da". */
const PARTICULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);

/** Palavras com maiúscula que não são gente. */
const NAO_SAO_PESSOAS = new Set([
  'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo', 'feira',
  'janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto',
  'setembro', 'outubro', 'novembro', 'dezembro',
  'hoje', 'amanha', 'semana', 'mes', 'ano', 'dia',
  'google', 'agenda', 'gmail', 'drive', 'zoom', 'teams', 'meet', 'central',
]);

const BORDA_ANTES = '(?<![\\p{L}\\p{N}])';
const BORDA_DEPOIS = '(?![\\p{L}\\p{N}])';
const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Sem acento, minúsculo, espaços simples nas pontas e no meio. */
const comparavel = (s: string) => normalizar(s.normalize('NFC')).trim().replace(/\s+/g, ' ');

/** Primeira posição em que `termo` aparece inteiro em `texto` (os dois já comparáveis), ou -1. */
function posicao(texto: string, termo: string): number {
  if (!termo) return -1;
  const achado = new RegExp(`${BORDA_ANTES}${escapar(termo).replace(/ /g, '\\s+')}${BORDA_DEPOIS}`, 'u').exec(texto);
  return achado ? achado.index : -1;
}

/** Partes do nome que identificam a pessoa: sem título nem partícula. */
function partesDoNome(nome: string): string[] {
  return comparavel(nome)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((parte) => parte.length > 1 && !TITULOS.has(parte) && !PARTICULAS.has(parte));
}

function montar(pessoas: Pessoa[], palavras: Palavra[], salas: Sala[]): MemoriaDoChat {
  const vivas = <T extends { apagado?: boolean }>(lista: T[]) => lista.filter((x) => !x.apagado);
  pessoas = vivas(pessoas);
  palavras = vivas(palavras);
  const nomesDeSala = new Set(vivas(salas).map((sala) => comparavel(sala.nome)));

  /** A palavra que aparece primeiro na frase; na mesma posição, a mais longa. */
  function palavraDa(frase: string): Palavra | null {
    const texto = comparavel(frase);
    let melhor: { palavra: Palavra; onde: number; tamanho: number } | null = null;
    for (const palavra of palavras) {
      const termo = comparavel(palavra.termo);
      const onde = posicao(texto, termo);
      if (onde < 0) continue;
      if (!melhor || onde < melhor.onde || (onde === melhor.onde && termo.length > melhor.tamanho)) {
        melhor = { palavra, onde, tamanho: termo.length };
      }
    }
    return melhor?.palavra ?? null;
  }

  const memoria: MemoriaDoChat = {
    acharPessoa(frase) {
      const texto = comparavel(frase);
      // Nome completo vale antes de uma parte dele; depois, quem aparece primeiro.
      let melhor: { pessoa: Pessoa; peso: number; onde: number } | null = null;
      for (const pessoa of pessoas) {
        const partes = partesDoNome(pessoa.nome);
        const inteiro = posicao(texto, partes.join(' '));
        const achados = inteiro >= 0 ? [{ peso: 2, onde: inteiro }] : partes
          .map((parte) => ({ peso: 1, onde: posicao(texto, parte) }))
          .filter((achado) => achado.onde >= 0);
        for (const achado of achados) {
          if (!melhor || achado.peso > melhor.peso || (achado.peso === melhor.peso && achado.onde < melhor.onde)) {
            melhor = { pessoa, ...achado };
          }
        }
      }
      return melhor ? { id: melhor.pessoa.id, nome: melhor.pessoa.nome, salaId: melhor.pessoa.salaId } : null;
    },

    acharSala(frase) {
      return palavraDa(frase)?.salaId ?? null;
    },

    termoDaSala(frase) {
      return palavraDa(frase)?.termo ?? null;
    },

    pessoaPorId(id) {
      return pessoas.find((pessoa) => pessoa.id === id);
    },

    conhecePalavra(palavra) {
      const termo = comparavel(palavra);
      return (
        NAO_SAO_PESSOAS.has(termo) ||
        nomesDeSala.has(termo) ||
        palavras.some((guardada) => comparavel(guardada.termo) === termo)
      );
    },

    async aprender(termo, salaId) {
      const gravado = await aprender(termo, salaId);
      if (!gravado) return;
      if ('termo' in gravado) palavras = [...palavras.filter((p) => p.id !== gravado.id), gravado];
      else pessoas = pessoas.map((p) => (p.id === gravado.id ? gravado : p));
    },
  };
  return memoria;
}

let fila: Promise<unknown> = Promise.resolve();

/** Roda depois da gravação anterior; uma que falha não trava as seguintes. */
function emOrdem<T>(gravar: () => Promise<T>): Promise<T> {
  const vez = fila.then(gravar);
  fila = vez.catch(() => {});
  return vez;
}

/** Lê pessoas, palavras e salas da loja. Ler de novo a cada frase pega o que veio do outro aparelho. */
export async function carregarMemoria(): Promise<MemoriaDoChat> {
  const [pessoas, palavras, salas] = await Promise.all([listar('pessoas'), listar('palavras'), listar('salas')]);
  return montar(pessoas, palavras, salas);
}

/**
 * Liga `termo` à sala, pela loja (sincroniza). Se o termo é o nome de uma
 * pessoa cadastrada, muda a sala da pessoa. Se já existe a palavra (sem ligar
 * para acento e maiúscula), muda a sala no mesmo registro. Senão, cria a palavra.
 * Devolve o que gravou, ou `undefined` se não havia o que gravar.
 */
export function aprender(termo: string, salaId: string): Promise<Palavra | Pessoa | undefined> {
  return emOrdem(() => aprenderAgora(termo, salaId));
}

async function aprenderAgora(termo: string, salaId: string): Promise<Palavra | Pessoa | undefined> {
  const limpo = termo.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (!limpo || !salaId) return undefined;
  const chave = comparavel(limpo);

  const pessoa = (await listar('pessoas')).find((p) => comparavel(p.nome) === chave);
  if (pessoa) return pessoa.salaId === salaId ? pessoa : salvar('pessoas', { ...pessoa, salaId });

  const palavra = (await listar('palavras')).find((p) => comparavel(p.termo) === chave);
  if (palavra) return palavra.salaId === salaId ? palavra : salvar('palavras', { ...palavra, salaId });
  return salvar('palavras', { termo: limpo, salaId });
}

/**
 * Guarda a pessoa que o chat não conhecia, só com nome e sala (o cadastro
 * completo é da Tarefa 9). Mesmo nome já cadastrado: só muda a sala.
 */
export function lembrarPessoa(nome: string, salaId: string): Promise<Pessoa> {
  return emOrdem(() => lembrarPessoaAgora(nome, salaId));
}

async function lembrarPessoaAgora(nome: string, salaId: string): Promise<Pessoa> {
  const limpo = nome.normalize('NFC').trim().replace(/\s+/g, ' ');
  const existente = (await listar('pessoas')).find((p) => comparavel(p.nome) === comparavel(limpo));
  if (existente) return existente.salaId === salaId ? existente : salvar('pessoas', { ...existente, salaId });
  return salvar('pessoas', { nome: limpo, salaId });
}

// Nome com maiúscula logo depois de "para", "com", "da"..., com artigo e título
// opcionais: "para Renata", "com a Renata", "para o Prof. Souza". Maiúscula
// seguida de minúscula: sigla ("FCT") não é gente. Sem repetição aninhada.
const RE_NOME =
  /(?<![\p{L}\p{N}])(?:para|pra|pro|com|de|da|do|das|dos|à|a|ao|o|e)\s+(?:(?:a|o)\s+)?((?:(?:Prof|Profa|Professor|Professora|Dr|Dra|Sr|Sra)\.?\s+)?\p{Lu}\p{Ll}[\p{L}'’-]*(?:\s+\p{Lu}\p{Ll}[\p{L}'’-]*){0,2})/gu;

/**
 * O nome citado na frase que não é de ninguém cadastrado nem palavra
 * conhecida, para o cartão perguntar "Em que sala fica Renata?". `null` se não há.
 */
export function pessoaDesconhecida(frase: string, memoria: MemoriaDoChat): string | null {
  for (const achado of frase.normalize('NFC').matchAll(RE_NOME)) {
    const palavras = achado[1].split(/\s+/);
    const titulo = TITULOS.has(comparavel(palavras[0]).replace(/\.$/, '')) ? palavras.shift()! : null;
    // "Renata Sexta": o nome vai até a primeira palavra conhecida.
    const fim = palavras.findIndex((palavra) => memoria.conhecePalavra(palavra));
    const nome = (fim === -1 ? palavras : palavras.slice(0, fim)).join(' ');
    if (!nome) continue;
    const completo = titulo ? `${titulo} ${nome}` : nome;
    if (memoria.acharPessoa(completo)) continue;
    return completo;
  }
  return null;
}
