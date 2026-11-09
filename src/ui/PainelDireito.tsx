// Coluna da direita no computador: Agora e Chat. O Agora chega numa próxima
// tarefa; por ora mostra o que vai morar nele. O chat já é o de verdade.
import { PAINEIS_DIREITOS, type Painel } from '../rotas';
import { Chat } from './Chat';
import { EmBreve } from './EmBreve';

const TITULO: Record<Painel, string> = { agora: 'Agora', chat: 'Chat' };

/** `semChat`: a página aberta já é o chat (`#/chat`), e o painel não o repete. */
export function PainelDireito({ semChat = false }: { semChat?: boolean }) {
  const paineis = PAINEIS_DIREITOS.filter((painel) => !(semChat && painel === 'chat'));
  return (
    <aside class="painel-direito" aria-label="Agora e chat">
      {paineis.map((painel) => (
        <section key={painel} class={`cartao-${painel}`} aria-labelledby={`painel-${painel}`}>
          <h2 id={`painel-${painel}`}>{TITULO[painel]}</h2>
          {painel === 'agora' && <EmBreve />}
          {painel === 'agora' ? <p class="foco-vazio">A tarefa em foco aparece aqui.</p> : <Chat />}
        </section>
      ))}
    </aside>
  );
}
