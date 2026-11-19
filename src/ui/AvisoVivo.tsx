// Uma região viva (`role="status"`) que mora na tela desde o início, vazia: o leitor de tela só anuncia de forma
// confiável o que muda dentro de uma região que já existia. Quem usa troca só o que vai dentro (aviso de leitura, de
// rede, progresso); vazia, ela sai da vista sem sair da árvore. Nunca ponha botão nem link aqui dentro.
import type { ComponentChildren } from 'preact';

export function AvisoVivo({ children }: { children?: ComponentChildren }) {
  return (
    <div class="aviso-vivo" role="status">
      {children}
    </div>
  );
}
