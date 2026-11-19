// A pasta onde o dono está, para o chat mandar a fala direto para ela (`#/sala/:id/pasta/:pastaId`). No computador o chat
// é o painel ao lado da pasta, e o endereço mostra a pasta. No celular e no tablet o chat é a página `#/chat`, que não tem
// pasta: vale a última tela de onde o dono veio (a pasta de onde tocou no microfone ou abriu o chat).

/** O último endereço que não era o do chat. */
let ultimoForaDoChat = '';

const ehOChat = (hash: string) => /^#\/chat(?:[/?]|$)/.test(hash);

/** A casca avisa a cada mudança de tela (e o ouvinte abaixo, na hora em que o endereço muda); o endereço do chat não vale (ele guarda o que veio antes). */
export function lembrarATela(hash: string) {
  if (!ehOChat(hash)) ultimoForaDoChat = hash;
}

// O endereço muda antes de a tela redesenhar: quem lê só depois (na casca) veria o `#/chat` já no lugar do que veio antes.
if (typeof window !== 'undefined') {
  lembrarATela(location.hash);
  window.addEventListener('hashchange', (evento) => {
    try {
      lembrarATela(new URL(evento.newURL).hash);
    } catch {
      lembrarATela(location.hash);
    }
  });
}

function pastaDe(hash: string): string | undefined {
  const achada = /^#\/sala\/[^/?]+\/pasta\/([^/?]+)/.exec(hash);
  if (!achada) return undefined;
  try {
    return decodeURIComponent(achada[1]!);
  } catch {
    return undefined;
  }
}

/** A pasta em que o dono está, ou de onde veio para o chat (`undefined` fora de qualquer pasta). */
export function pastaDaTela(): string | undefined {
  return pastaDe(ehOChat(location.hash) ? ultimoForaDoChat : location.hash);
}

/** Testes: nenhuma tela lembrada. */
export function esquecerATela() {
  ultimoForaDoChat = '';
}
