// Chat (Tarefa 8), conforme esboco-chat/chat.html. Mora em `#/chat` e no
// painel direito; os dois mostram a mesma conversa (src/chat/conversa.ts).
// V02.1: a voz é um botão de microfone neste campo (a tela "Pode falar" deixou de existir). A escuta começa no toque no
// microfone (ou em Ctrl+Alt+N, ou no atalho do ícone instalado); o texto aparece no campo ao vivo; Enviar encerra a
// escuta e manda. O que se fala e o que se escreve seguem o mesmo caminho: lista, leitura, gasto e ideia dita viram
// o cartão de resultado; o resto é tarefa de hoje ou compromisso, com o cartão de sempre.
import { useEffect, useRef, useState } from 'preact/hooks';
import { assinarConversa, enviar, lerConversa, type Mensagem } from '../chat/conversa';
import { validarFrase } from '../chat/executar';
import { hojeEmLisboa } from '../chat/interpretar';
import { IDEIA_NO_MAXIMO } from '../dados/ideias';
import { Cartao } from './Cartao';
import { CartaoDeResultado } from './CartaoDeResultado';
import { useSalas } from './hooks';
import { Icone } from './icones';
import { pegarPedidoDeVoz, usePedidoDeVoz } from './pedido-de-voz';
import { useVoz } from './useVoz';
import './chat.css';

/** A conversa compartilhada (painel e página), sempre a mais nova. */
export function useConversa(): readonly Mensagem[] {
  const [conversa, setConversa] = useState(lerConversa);
  useEffect(() => {
    setConversa(lerConversa());
    return assinarConversa(() => setConversa(lerConversa()));
  }, []);
  return conversa;
}

/** A pasta onde o dono está (`#/sala/:id/pasta/:pastaId`): a fala vai direto para ela. */
function pastaDaTela(): string | undefined {
  const achada = /^#\/sala\/[^/?]+\/pasta\/([^/?]+)/.exec(location.hash);
  if (!achada) return undefined;
  try {
    return decodeURIComponent(achada[1]!);
  } catch {
    return undefined;
  }
}

const TEXTO_VAZIO = 'Ainda não ouvi nada. Fale ou escreva o que quer guardar.';
const textoLongo = () => `Texto longo demais (máximo ${IDEIA_NO_MAXIMO} caracteres). Divida em partes.`;

/**
 * `ativo`: o chat está à vista. O do painel direito recolhido não está, e só o que está à vista atende o pedido de
 * ouvir (Ctrl+Alt+N, atalho do ícone).
 */
export function Chat({ ativo = true }: { ativo?: boolean }) {
  const conversa = useConversa();
  const salas = useSalas();
  // O campo é só deste chat: a resposta que chega nunca mexe no que se digita.
  const [texto, setTexto] = useState('');
  /** O erro do campo (vazio ou longo demais): o campo ganha `aria-invalid` e o foco. */
  const [erroDoTexto, setErroDoTexto] = useState<string | null>(null);
  const voz = useVoz(texto, setTexto);
  const textoAtual = useRef(texto);
  textoAtual.current = texto;
  const log = useRef<HTMLDivElement>(null);
  const formulario = useRef<HTMLFormElement>(null);
  const campo = useRef<HTMLInputElement>(null);
  /** Enviar (ou Enter) já em andamento: um segundo toque não manda de novo. */
  const concluindo = useRef(false);
  const hoje = hojeEmLisboa();

  // A mensagem nova fica à vista, também quando a resposta chega depois do "Lendo…".
  const ultimaMensagem = conversa[conversa.length - 1];
  // Cartão que termina de guardar sozinho ganha o Desfazer e cresce: se for um
  // de cima, empurra a mensagem nova para baixo. Ao terminar, rola de novo.
  const guardando = conversa.reduce((n, m) => n + (m.de === 'central' ? m.cartoes.filter((c) => c.situacao === 'salvando').length : 0), 0);
  useEffect(() => {
    const ultima = log.current?.lastElementChild as HTMLElement | null | undefined;
    // Mensagem mais alta que a conversa visível (coluna baixa, com a água e o Agora em cima): vale o pé
    // dela, onde ficam os botões, e não o topo.
    const maisAltaQueOLog = !!ultima && ultima.offsetHeight > (log.current?.clientHeight ?? Infinity);
    ultima?.scrollIntoView?.({ block: maisAltaQueOLog ? 'end' : 'nearest' });
    // No celular a página rola e a barra de baixo é fixa: o campo (logo abaixo da mensagem nova)
    // também precisa ficar à vista, acima da barra. `scroll-margin` em chat.css reserva o espaço dela.
    if (ultima) formulario.current?.scrollIntoView?.({ block: 'end' });
  }, [ultimaMensagem, guardando]);

  // A coluna do painel muda de altura depois (o Agora cresce ou encolhe quando a tarefa nova entra): quem estava no fim da
  // conversa continua no fim, em vez de ver a mensagem nova cortada.
  const noFim = useRef(true);
  useEffect(() => {
    const area = log.current;
    if (!area || typeof ResizeObserver === 'undefined') return;
    const aoRolar = () => {
      noFim.current = area.scrollHeight - area.scrollTop - area.clientHeight < 48;
    };
    area.addEventListener('scroll', aoRolar, { passive: true });
    const observador = new ResizeObserver(() => {
      if (noFim.current) (area.lastElementChild as HTMLElement | null)?.scrollIntoView?.({ block: 'end' });
    });
    observador.observe(area);
    return () => {
      area.removeEventListener('scroll', aoRolar);
      observador.disconnect();
    };
  }, []);

  // Ctrl+Alt+N e o atalho do ícone pedem para ouvir: o campo ganha o foco e o microfone liga.
  const pedido = usePedidoDeVoz();
  useEffect(() => {
    if (!ativo) return;
    const pedida = pegarPedidoDeVoz();
    if (!pedida) return;
    if (pedida.texto && !textoAtual.current.trim()) setTexto(pedida.texto);
    campo.current?.focus();
    if (pedida.ouvir !== false) voz.tocar('atalho');
  }, [ativo, pedido]);

  // O painel recolheu com o microfone ligado: para de ouvir (o texto fica no campo).
  useEffect(() => {
    if (!ativo && voz.escutando) void voz.parar();
  }, [ativo]);

  // Erro do campo (vazio ou longo demais): o foco vai para o campo, que o leitor de tela lê com a mensagem.
  useEffect(() => {
    if (erroDoTexto) campo.current?.focus();
  }, [erroDoTexto]);

  /** Confere a frase e a manda; o campo esvazia na hora. Frase que não vale fica no campo, com o aviso. */
  function mandar(frase: string) {
    const problema = validarFrase(frase);
    if (problema) {
      voz.soltar();
      setErroDoTexto(problema === 'longa' ? textoLongo() : TEXTO_VAZIO);
      return;
    }
    const audio = voz.pegarAudio();
    const pastaAtual = pastaDaTela();
    setTexto('');
    textoAtual.current = ''; // um segundo toque antes de a tela redesenhar não manda de novo
    void enviar(frase.trim(), { ...(pastaAtual ? { pastaAtual } : {}), ...(audio ? { audio } : {}) });
  }

  async function concluir() {
    setErroDoTexto(null);
    voz.limparAvisos();
    // Sem microfone ligado (o caminho comum) a frase sai na hora, como sempre. Campo em branco: nada a fazer (um
    // segundo toque no Enviar, logo depois do primeiro, cai aqui e não deve reclamar).
    if (!voz.ocupada()) {
      if (textoAtual.current.trim()) mandar(textoAtual.current);
      return;
    }
    // Ouvindo: Enviar para a escuta e manda o que foi falado, junto do que já estava escrito. Um segundo toque
    // enquanto a escuta fecha não manda de novo.
    if (concluindo.current) return;
    concluindo.current = true;
    try {
      mandar(await voz.parar());
    } finally {
      concluindo.current = false;
    }
  }

  const aoEnviar = (evento: Event) => {
    evento.preventDefault();
    void concluir();
  };

  return (
    <div
      class="chat"
      data-escutando={voz.escutando ? 'sim' : 'nao'}
      onKeyDown={(evento) => {
        // Esc com o microfone ligado só para de ouvir (o painel não recolhe junto).
        if (evento.key !== 'Escape' || !voz.escutando) return;
        evento.preventDefault();
        void voz.parar();
      }}
    >
      {conversa.length === 0 && (
        <p class="chat-dica">
          Escreva ou fale o que precisa fazer, como diria a uma pessoa. Por exemplo: "Ligar para a Aurora amanhã às 15h".
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
              {mensagem.cartoes.map((cartao, i) => (
                <Cartao key={cartao.id} cartao={cartao} salas={salas} hoje={hoje} podeIdeia={i === 0} />
              ))}
              {mensagem.resultados.map((resultado) => (
                <CartaoDeResultado key={resultado.id} estado={resultado} />
              ))}
            </div>
          ),
        )}
      </div>
      {/* Região viva só com frases curtas de estado ("Ouvindo…", "Parei. Texto: …"). O texto parcial do reconhecimento fica de fora: ele muda a cada palavra. */}
      <p class="so-leitor" role="status" aria-atomic="true">
        {voz.anuncio}
      </p>
      <form class="chat-form" ref={formulario} onSubmit={aoEnviar}>
        <input
          ref={campo}
          class="campo chat-entrada"
          type="text"
          aria-label="Escreva ou dite"
          aria-invalid={erroDoTexto ? 'true' : undefined}
          aria-describedby={erroDoTexto ? 'chat-erro-texto' : undefined}
          placeholder={voz.escutando ? 'Ouvindo…' : 'Escreva ou dite'}
          autocomplete="off"
          enterKeyHint="send"
          readOnly={voz.escutando}
          value={texto}
          onInput={(evento) => {
            setTexto(evento.currentTarget.value);
            setErroDoTexto(null);
          }}
        />
        <button type="button" class="chat-mic" aria-label="Falar" aria-pressed={voz.escutando} onClick={() => voz.tocar()}>
          <Icone nome="microfone" />
        </button>
        <button type="submit" class="botao primario chat-enviar">
          Enviar
        </button>
      </form>
      {erroDoTexto && (
        <p class="chat-aviso" id="chat-erro-texto" role="alert">
          {erroDoTexto}
        </p>
      )}
      {voz.aviso && (
        <p class="chat-aviso" role="alert">
          {voz.aviso}
        </p>
      )}
      {voz.escutando ? (
        // Ouvindo, a chave e o aviso de privacidade dão lugar a uma linha só: a conversa precisa do espaço.
        <p class="chat-ouvindo" aria-hidden="true">
          Ouvindo…
          {voz.gravando && <span class="chat-gravando">gravando</span>}
          toque para parar
        </p>
      ) : (
        <div class="chat-voz-extra">
          <label class="chat-gravar">
            <input type="checkbox" role="switch" checked={voz.gravarAudio} onChange={(e) => voz.setGravarAudio((e.currentTarget as HTMLInputElement).checked)} />
            <span>Gravar áudio</span>
          </label>
          <p class="chat-aviso-voz">O reconhecimento de voz do navegador envia o áudio ao Google. Para não enviar, escreva.</p>
        </div>
      )}
      {voz.avisoDoAudio && (
        <p class="chat-aviso-audio" role="status">
          {voz.avisoDoAudio}
        </p>
      )}
    </div>
  );
}
