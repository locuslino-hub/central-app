// O cartão de resultado do chat (V02.1): o que foi gravado numa ideia, lista, leitura ou gasto, com Ver, Desfazer, Guardar
// como ideia, Pôr mesmo assim e Trocar categoria. O estado mora na conversa (src/chat/conversa.ts), para o cartão
// sobreviver a trocar de tela; aqui só mora o painel aberto de "Trocar categoria". Nunca grava em silêncio: o cartão
// sempre aparece. Depois de cada ação o foco volta para o cartão (o botão apertado sumiu ou mudou).
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  desfazerResultado,
  guardarResultadoComoIdeia,
  repetirResultado,
  trocarCategoriaDoResultado,
  type EstadoResultado,
} from '../chat/conversa';
import type { ResultadoDaFrase } from '../chat/executar';
import { CATEGORIA_NO_MAXIMO } from '../dados/financeiro';
import { TEXTO_DA_TROCA_QUE_FALHOU } from './pastas-textos';

export function CartaoDeResultado({ estado }: { estado: EstadoResultado }) {
  const { id, resultado, desfeito, ocupado, aviso, avisoDoAudio, foco } = estado;
  const raiz = useRef<HTMLElement>(null);
  const campoOutra = useRef<HTMLInputElement>(null);
  /**
   * O painel "Trocar categoria" está aberto para este cartão, e o que se digitou nele. Aberto "para" um cartão: quando o
   * cartão muda (a categoria trocada, outro cartão, o desfeito) o painel fecha na mesma hora. Troca que falhou só põe um
   * aviso (o cartão é o mesmo): o painel continua aberto, para escolher de novo.
   */
  const [abertoPara, setAbertoPara] = useState<ResultadoDaFrase | null>(null);
  const trocando = abertoPara === resultado && !desfeito;
  const [outra, setOutra] = useState('');
  const [erroDaCategoria, setErroDaCategoria] = useState<string | null>(null);

  // Cada ação concluída leva o foco ao cartão, que é onde o leitor de tela e o teclado esperam a resposta.
  useEffect(() => {
    if (foco > 0) raiz.current?.focus();
  }, [foco]);
  useEffect(() => {
    if (!trocando) setOutra('');
  }, [trocando]);
  useEffect(() => {
    if (trocando) campoOutra.current?.focus();
    else setErroDaCategoria(null);
  }, [trocando]);

  async function trocar(categoria: string) {
    if (categoria.trim() === '') {
      setErroDaCategoria(TEXTO_DA_TROCA_QUE_FALHOU.vazia); // a mensagem fica junto do campo, que ganha aria-invalid e o foco
      campoOutra.current?.focus();
      return;
    }
    setErroDaCategoria(null);
    await trocarCategoriaDoResultado(id, categoria);
  }

  const troca = resultado.trocarCategoria;
  const idDoTitulo = `chat-resultado-${id}-titulo`;
  const idDoDetalhe = `chat-resultado-${id}-detalhe`;

  return (
    <article class="chat-cartao chat-resultado" ref={raiz} tabIndex={-1} aria-labelledby={idDoTitulo} aria-describedby={desfeito ? undefined : idDoDetalhe}>
      {desfeito ? (
        <p class="chat-titulo" id={idDoTitulo}>
          Desfeito. Nada ficou guardado.
        </p>
      ) : (
        <>
          <p class="chat-titulo" id={idDoTitulo}>
            {resultado.titulo}
          </p>
          <p class="chat-quando chat-resultado-detalhe" id={idDoDetalhe}>
            {resultado.detalhe}
          </p>
          {/* Sempre aqui, vazio até haver o que dizer: o avanço do envio do áudio é anunciado. */}
          <p class="chat-motivo chat-resultado-vivo" role="status">
            {avisoDoAudio}
          </p>
        </>
      )}
      {aviso && (
        <p class="chat-pergunta" role="alert">
          {aviso}
        </p>
      )}
      <div class="chat-acoes">
        {!desfeito && resultado.ver && (
          <a class="botao-link chat-resultado-ver" href={resultado.ver}>
            Ver
          </a>
        )}
        {!desfeito && !resultado.semDesfazer && (
          <button type="button" class="botao" disabled={ocupado} onClick={() => void desfazerResultado(id)}>
            Desfazer
          </button>
        )}
        {!desfeito && resultado.repetir && (
          <button type="button" class="botao" disabled={ocupado} onClick={() => void repetirResultado(id)}>
            Pôr mesmo assim
          </button>
        )}
        {!desfeito && troca && (
          <button type="button" class="botao" aria-expanded={trocando} disabled={ocupado} onClick={() => setAbertoPara(trocando ? null : resultado)}>
            Trocar categoria
          </button>
        )}
        {!desfeito && resultado.guardarComoIdeia && (
          <button type="button" class="botao" disabled={ocupado} onClick={() => void guardarResultadoComoIdeia(id)}>
            Guardar como ideia
          </button>
        )}
      </div>
      {!desfeito && trocando && troca && (
        <div class="chat-troca-categoria" role="group" aria-label="Trocar categoria">
          <p class="chat-motivo">Escolha a categoria ou digite outra.</p>
          <div class="chat-categorias">
            {troca.opcoes.map((categoria) => (
              <button
                key={categoria}
                type="button"
                class="botao-pilula"
                aria-pressed={categoria === troca.atual}
                aria-disabled={categoria === troca.atual ? 'true' : undefined}
                disabled={ocupado}
                onClick={() => categoria !== troca.atual && void trocar(categoria)}
              >
                {categoria === troca.atual && <span aria-hidden="true">✓ </span>}
                {categoria}
              </button>
            ))}
          </div>
          <form
            class="chat-outra-categoria"
            onSubmit={(e) => {
              e.preventDefault();
              void trocar(outra);
            }}
          >
            <label for={`chat-outra-categoria-${id}`}>Outra categoria</label>
            <input
              ref={campoOutra}
              id={`chat-outra-categoria-${id}`}
              class="campo"
              type="text"
              maxLength={CATEGORIA_NO_MAXIMO}
              autoComplete="off"
              value={outra}
              aria-invalid={erroDaCategoria ? 'true' : undefined}
              aria-describedby={erroDaCategoria ? `chat-outra-categoria-${id}-erro` : undefined}
              onInput={(e) => {
                setOutra(e.currentTarget.value);
                setErroDaCategoria(null);
              }}
            />
            <button type="submit" class="botao-pilula" disabled={ocupado}>
              Trocar
            </button>
            {erroDaCategoria && (
              <p class="chat-erro-campo" id={`chat-outra-categoria-${id}-erro`} role="alert">
                {erroDaCategoria}
              </p>
            )}
          </form>
        </div>
      )}
    </article>
  );
}
