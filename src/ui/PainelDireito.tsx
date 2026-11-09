// Coluna da direita no computador: Agora e Chat. O Agora é o cartão curto
// (destaque, tempo livre e os próximos); a página #/agora tem o resto.
import { PAINEIS_DIREITOS, type Painel } from '../rotas';
import { AgoraCurto } from './Agora';
import { Chat } from './Chat';

const TITULO: Record<Painel, string> = { agora: 'Agora', chat: 'Chat' };

/**
 * `semChat`: a página aberta já é o chat (`#/chat`), e o painel não o repete.
 * `semAgora`: idem para a página do Agora (`#/agora`).
 */
export function PainelDireito({ semChat = false, semAgora = false }: { semChat?: boolean; semAgora?: boolean }) {
  const paineis = PAINEIS_DIREITOS.filter((painel) => !(semChat && painel === 'chat') && !(semAgora && painel === 'agora'));
  return (
    <aside class="painel-direito" aria-label="Agora e chat">
      {paineis.map((painel) => (
        <section key={painel} class={`cartao-${painel}`} aria-labelledby={`painel-${painel}`}>
          <h2 id={`painel-${painel}`}>{TITULO[painel]}</h2>
          {painel === 'agora' ? <AgoraCurto /> : <Chat />}
        </section>
      ))}
    </aside>
  );
}
