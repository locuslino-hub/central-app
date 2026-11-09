// O nome que a saudação usa ("Boa tarde, Marina."). Fica só neste aparelho
// (localStorage): não vai para a planilha nem para o outro aparelho. Sem nome,
// a saudação é só "Boa tarde.". Ler ou gravar nunca quebra a tela: sem acesso
// ao armazenamento (janela privada, bloqueio), fica sem nome.

const CHAVE = 'central-nome';
/** Aviso, nesta janela, de que o nome mudou (o evento `storage` só chega às outras). */
export const NOME_MUDOU = 'central-nome-mudou';
const MAXIMO = 40;

const limpar = (nome: string) => nome.normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, MAXIMO).trim();

export function lerNome(): string {
  try {
    return limpar(localStorage.getItem(CHAVE) ?? '');
  } catch {
    return '';
  }
}

/** Guarda o nome (vazio apaga) e devolve o que ficou guardado. */
export function guardarNome(nome: string): string {
  const limpo = limpar(nome);
  try {
    if (limpo) localStorage.setItem(CHAVE, limpo);
    else localStorage.removeItem(CHAVE);
  } catch {
    return '';
  }
  window.dispatchEvent(new Event(NOME_MUDOU));
  return limpo;
}
