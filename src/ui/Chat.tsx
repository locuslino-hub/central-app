// Chat (Tarefa 8), conforme esboco-chat/chat.html. Mora em `#/chat` e no
// painel direito; os dois mostram a mesma conversa (src/chat/conversa.ts).
// Sem botão de microfone: o ditado é o do teclado do aparelho.
import { useEffect, useRef, useState } from 'preact/hooks';
import { assinarConversa, enviar, lerConversa, type Mensagem } from '../chat/conversa';
import { hojeEmLisboa } from '../chat/interpretar';
import { Cartao } from './Cartao';
import { useSalas } from './hooks';
import './chat.css';

function useConversa(): readonly Mensagem[] {
  const [conversa, setConversa] = useState(lerConversa);
  useEffect(() => {
    setConversa(lerConversa());
    return assinarConversa(() => setConversa(lerConversa()));
  }, []);
  return conversa;
}

export function Chat() {
  const conversa = useConversa();
  const salas = useSalas();
  // O campo é só deste chat: a resposta que chega nunca mexe no que se digita.
  const [texto, setTexto] = useState('');
  const log = useRef<HTMLDivElement>(null);
  const formulario = useRef<HTMLFormElement>(null);
  const hoje = hojeEmLisboa();

  // A mensagem nova fica à vista, também quando a resposta chega depois do "Lendo…".
  const ultimaMensagem = conversa[conversa.length - 1];
  useEffect(() => {
    const ultima = log.current?.lastElementChild as HTMLElement | null | undefined;
    ultima?.scrollIntoView?.({ block: 'nearest' });
    // No celular a página rola e a barra de baixo é fixa: o campo (logo abaixo da mensagem nova)
    // também precisa ficar à vista, acima da barra. `scroll-margin` em chat.css reserva o espaço dela.
    if (ultima) formulario.current?.scrollIntoView?.({ block: 'end' });
  }, [ultimaMensagem]);

  const aoEnviar = (evento: Event) => {
    evento.preventDefault();
    if (!texto.trim()) return;
    const frase = texto;
    setTexto('');
    void enviar(frase);
  };

  return (
    <div class="chat">
      {conversa.length === 0 && (
        <p class="chat-dica">
          Escreva o que precisa fazer, como diria a uma pessoa. Por exemplo: "Ligar para a Aurora amanhã às 15h".
        </p>
      )}
      <div class="chat-log" role="log" aria-label="Conversa" ref={log}>
        {conversa.map((mensagem) =>
          mensagem.de === 'dono' ? (
            <p class="chat-dono" key={mensagem.id}>
              <span class="so-leitor">Você: </span>
              {mensagem.texto}
            </p>
          ) : (
            <div class="chat-central" key={mensagem.id}>
              {mensagem.esperando ? (
                <p class="chat-fala chat-esperando">Lendo…</p>
              ) : (
                <p class="chat-fala">{mensagem.texto}</p>
              )}
              {mensagem.cartoes.map((cartao) => (
                <Cartao key={cartao.id} cartao={cartao} salas={salas} hoje={hoje} />
              ))}
            </div>
          ),
        )}
      </div>
      <form class="chat-form" ref={formulario} onSubmit={aoEnviar}>
        <input
          class="campo chat-entrada"
          type="text"
          aria-label="Escreva ou dite"
          placeholder="Escreva ou dite"
          autocomplete="off"
          enterKeyHint="send"
          value={texto}
          onInput={(evento) => setTexto(evento.currentTarget.value)}
        />
        <button type="submit" class="botao primario chat-enviar">
          Enviar
        </button>
      </form>
    </div>
  );
}
