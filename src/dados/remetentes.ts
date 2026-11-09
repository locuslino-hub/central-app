// De que sala é quem escreve (spec, seção 8): vem da memória de pessoas
// (`Pessoa.emails`); sem isso, "Sem sala", e o app pergunta uma vez.
//
// A resposta vale para sempre, de dois jeitos:
//   - o dono diz quem é: o endereço entra em `Pessoa.emails`, que é a memória de
//     pessoas dele e sincroniza com os outros aparelhos;
//   - o dono diz só a sala (ou "sem sala"): fica neste aparelho, numa lista
//     pequena em `localStorage`, guardada por um resumo do endereço, nunca pelo
//     endereço em si.
import { lerRegistros, salvar } from './loja';
import type { Pessoa } from './tipos';

const CHAVE = 'central-remetentes';
const NO_MAXIMO = 300;

const normalizado = (endereco: string) => endereco.trim().toLowerCase();

/** Resumo curto e fixo do endereço (cyrb53): serve de chave, e o endereço não fica guardado. */
export function resumoDoEndereco(endereco: string): string {
  const texto = normalizado(endereco);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Texto vazio quer dizer que o dono respondeu "sem sala". */
type Mapa = Record<string, string>;

function lerMapa(): Mapa {
  try {
    const bruto = localStorage.getItem(CHAVE);
    const valor: unknown = bruto ? JSON.parse(bruto) : {};
    if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) return {};
    return Object.fromEntries(Object.entries(valor).filter(([, sala]) => typeof sala === 'string'));
  } catch {
    return {};
  }
}

function gravarMapa(mapa: Mapa) {
  const cabem = Object.fromEntries(Object.entries(mapa).slice(-NO_MAXIMO));
  try {
    localStorage.setItem(CHAVE, JSON.stringify(cabem));
  } catch {
    // Sem armazenamento (janela privativa): a pergunta volta na próxima vez.
  }
}

export type Origem = {
  /** O app sabe de quem é? Se não, pergunta (uma vez). */
  sabe: boolean;
  salaId: string | null;
  pessoa?: Pessoa;
};

/** A sala de quem enviou, pelas pessoas cadastradas e pelo que o dono já respondeu. */
export function origemDoRemetente(endereco: string, pessoas: readonly Pessoa[]): Origem {
  const chave = normalizado(endereco);
  // Sem endereço válido não há o que lembrar: não adianta perguntar.
  if (!chave) return { sabe: true, salaId: null };
  const pessoa = pessoas.find((p) => !p.apagado && p.emails?.some((email) => normalizado(email) === chave));
  if (pessoa) return { sabe: true, salaId: pessoa.salaId, pessoa };
  const guardada = lerMapa()[resumoDoEndereco(chave)];
  if (guardada !== undefined) return { sabe: true, salaId: guardada === '' ? null : guardada };
  return { sabe: false, salaId: null };
}

/** "É a Marina": o endereço entra nos e-mails dela. `false` se ela não existe mais. */
export async function lembrarComoPessoa(endereco: string, pessoaId: string): Promise<boolean> {
  const chave = normalizado(endereco);
  const [registro] = await lerRegistros([{ colecao: 'pessoas', id: pessoaId }]);
  const pessoa = registro as Pessoa | undefined;
  if (!chave || !pessoa || pessoa.apagado) return false;
  const atuais = pessoa.emails ?? [];
  if (atuais.some((email) => normalizado(email) === chave)) return true;
  await salvar('pessoas', { ...pessoa, emails: [...atuais, chave].slice(-20) });
  return true;
}

/** "É da sala X" (ou, com `null`, "sem sala"): vale só neste aparelho. */
export function lembrarComoSala(endereco: string, salaId: string | null) {
  const chave = normalizado(endereco);
  if (!chave) return;
  const mapa = lerMapa();
  const resumo = resumoDoEndereco(chave);
  delete mapa[resumo]; // reinsere no fim: sai primeiro o que foi respondido há mais tempo
  mapa[resumo] = salaId ?? '';
  gravarMapa(mapa);
}
