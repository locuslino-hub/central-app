// Coluna da direita no computador: Agora, Água e Chat. O Agora é o cartão curto
// (destaque, tempo livre e os próximos); a página #/agora tem o resto. A Água é
// o cartão completo, e com o chat aberto encolhe para a versão curta.
// O chat começa recolhido numa barra no pé da coluna, e o Agora fica com o
// espaço; abre ao tocar na barra. Aberto ou recolhido fica guardado no aparelho.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Mensagem } from '../chat/conversa';
import { PAINEIS_DIREITOS, type Painel } from '../rotas';
import { AgoraCurto } from './Agora';
import { AguaCurta, CartaoAgua } from './Agua';
import { AguaPagina } from './AguaPagina';
import { Chat, useConversa } from './Chat';
import { Icone } from './icones';

const TITULO: Record<Painel, string> = { agora: 'Agora', agua: 'Água', chat: 'Chat' };

/** Só neste aparelho (localStorage). Sem acesso ao armazenamento, começa recolhido e não guarda. */
export const CHAVE_DO_CHAT = 'central-chat-aberto';

function lerChatAberto(): boolean {
  try {
    return localStorage.getItem(CHAVE_DO_CHAT) === '1';
  } catch {
    return false;
  }
}

function guardarChatAberto(aberto: boolean) {
  try {
    localStorage.setItem(CHAVE_DO_CHAT, aberto ? '1' : '0');
  } catch {
    // Janela privada ou armazenamento bloqueado: vale só até fechar o app.
  }
}

/**
 * `semChat`: a página aberta já é o chat (`#/chat`), e o painel não o repete.
 * `semAgora`: idem para a página do Agora (`#/agora`).
 */
export function PainelDireito({ semChat = false, semAgora = false }: { semChat?: boolean; semAgora?: boolean }) {
  const [chatAberto, setChatAberto] = useState(lerChatAberto);
  // A página da água abre do anel do cartão (completo ou curto) e é um diálogo: não ocupa lugar na coluna.
  const [paginaDaAgua, setPaginaDaAgua] = useState(false);
  const abrirPaginaDaAgua = () => setPaginaDaAgua(true);
  const mudarChat = (aberto: boolean) => {
    setChatAberto(aberto);
    guardarChatAberto(aberto);
  };
  // O chat que a página já é (`semChat`) não está na coluna: com ele fora, a água não precisa encolher.
  const aguaCurta = chatAberto && !semChat;
  // A água aparece sempre (também em #/agora e #/chat, que não a repetem).
  const paineis = PAINEIS_DIREITOS.filter((painel) => !(semChat && painel === 'chat') && !(semAgora && painel === 'agora'));
  return (
    <aside class="painel-direito" aria-label="Agora, água e chat" data-chat={chatAberto ? 'aberto' : 'recolhido'}>
      {paineis.map((painel) =>
        painel === 'agora' ? (
          <section key={painel} class="cartao-agora" aria-labelledby="painel-agora">
            <h2 id="painel-agora">{TITULO.agora}</h2>
            <AgoraCurto />
          </section>
        ) : painel === 'agua' ? (
          aguaCurta ? (
            <AguaCurta key={painel} aoAbrir={abrirPaginaDaAgua} />
          ) : (
            <CartaoAgua key={painel} aoAbrir={abrirPaginaDaAgua} />
          )
        ) : (
          <ChatDoPainel key={painel} aberto={chatAberto} aoMudar={mudarChat} />
        ),
      )}
      <AguaPagina aberta={paginaDaAgua} aoFechar={() => setPaginaDaAgua(false)} />
    </aside>
  );
}

/** A última mensagem, como marca: muda quando chega mensagem nova e quando a resposta termina. */
function marcaDaUltima(ultima: Mensagem | undefined): string {
  if (!ultima) return '';
  return `${ultima.id}:${ultima.de === 'central' && ultima.esperando ? 'esperando' : 'pronta'}`;
}

/**
 * O chat do painel: o botão do título abre e recolhe. Recolhido, é uma barra com o
 * nome e o campo em miniatura; a conversa continua montada (escondida), então o que se
 * digitou não se perde. Resposta que chega com o chat recolhido acende um sinal.
 */
function ChatDoPainel({ aberto, aoMudar }: { aberto: boolean; aoMudar: (aberto: boolean) => void }) {
  const botao = useRef<HTMLButtonElement>(null);
  const corpo = useRef<HTMLDivElement>(null);
  const focarAoAbrir = useRef(false);

  const conversa = useConversa();
  const ultima = conversa[conversa.length - 1];
  const marca = marcaDaUltima(ultima);
  // O que o dono já viu: a conversa de quando o painel apareceu, e tudo o que chegou com o chat aberto.
  const [vista, setVista] = useState(marca);
  useEffect(() => {
    if (aberto) setVista(marca);
  }, [aberto, marca]);
  const novidade = !aberto && ultima?.de === 'central' && !ultima.esperando && marca !== vista;

  // Ao abrir pelo botão: a mensagem mais nova à vista e o foco no campo.
  useEffect(() => {
    if (!aberto || !focarAoAbrir.current) return;
    focarAoAbrir.current = false;
    const base = corpo.current;
    base?.querySelector('.chat-log')?.lastElementChild?.scrollIntoView?.({ block: 'nearest' });
    base?.querySelector<HTMLInputElement>('.chat-entrada')?.focus();
  }, [aberto]);

  const alternar = () => {
    focarAoAbrir.current = !aberto;
    aoMudar(!aberto);
  };

  // Esc recolhe e devolve o foco ao botão (a não ser que algo dentro do chat já tenha usado o Esc).
  const aoTeclar = (evento: KeyboardEvent) => {
    if (!aberto || evento.key !== 'Escape' || evento.defaultPrevented) return;
    evento.preventDefault();
    aoMudar(false);
    botao.current?.focus();
  };

  return (
    <section class="cartao-chat" data-aberto={String(aberto)} aria-labelledby="painel-chat" onKeyDown={aoTeclar}>
      <h2 id="painel-chat" class="chat-cabeca">
        <button
          ref={botao}
          type="button"
          class="chat-alternar"
          aria-expanded={aberto}
          aria-controls="chat-do-painel"
          title={aberto ? 'Recolher o chat' : 'Abrir o chat'}
          onClick={alternar}
        >
          <span class="chat-alternar-icone">
            <Icone nome="chat" />
            {novidade && <span class="chat-sinal" />}
          </span>
          <span class="chat-alternar-nome">{TITULO.chat}</span>
          {novidade && <span class="so-leitor">, resposta nova</span>}
          <span class="chat-alternar-seta" aria-hidden="true">
            <Icone nome="voltar" />
          </span>
        </button>
      </h2>
      {!aberto && (
        <span class="chat-miniatura" aria-hidden="true">
          Escreva ou dite
        </span>
      )}
      <p class="so-leitor" aria-live="polite">
        {novidade ? 'Resposta nova no chat.' : ''}
      </p>
      <div id="chat-do-painel" class="chat-corpo" ref={corpo} hidden={!aberto}>
        <Chat />
      </div>
    </section>
  );
}
