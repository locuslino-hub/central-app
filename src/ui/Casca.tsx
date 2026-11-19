// A casca do app: navegação, página e painel direito, conforme o tamanho da tela.
import { useEffect, useRef } from 'preact/hooks';
import './tema.css';
import './casca.css';
import { EstadoDaSincronia } from './EstadoSync';
import { useHoje, useRota, useTela } from './hooks';
import { Icone } from './icones';
import { Atalhos, MenuLateral } from './Menu';
import { NovaVersao } from './NovaVersao';
import { PainelDireito } from './PainelDireito';
import { lembrarATela } from './pasta-do-chat';
import { abrirOChat, pedidoRecente } from './pedido-de-voz';
import { Vista } from './Vista';

/**
 * O endereço pede para ouvir? `#/?falar=1` (atalho do ícone instalado) e o antigo `#/falar` (atalho que ficou no
 * aparelho antes da V02.1). Devolve o endereço sem o pedido, ou `null` se não pede.
 */
export function enderecoSemPedidoDeVoz(hash: string): string | null {
  const [caminho = '', ...resto] = hash.split('?');
  const consulta = resto.join('?').split('&').filter(Boolean);
  const antigo = caminho.replace(/\/$/, '') === '#/falar';
  if (!antigo && !consulta.includes('falar=1')) return null;
  const outros = consulta.filter((parte) => parte !== 'falar=1');
  const base = antigo ? '#/' : caminho;
  return outros.length ? `${base}?${outros.join('&')}` : base;
}

/** O foco está onde se digita (campo, área de texto, lista ou texto editável)? */
function ehCampoDeTexto(alvo: EventTarget | null): boolean {
  if (!(alvo instanceof HTMLElement)) return false;
  return alvo.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(alvo.tagName);
}

export function Casca() {
  const hoje = useHoje();
  const rota = useRota(hoje);
  const tela = useTela();
  const principal = useRef<HTMLElement>(null);
  const primeira = useRef(true);

  // O chat do celular e do tablet (`#/chat`) não tem pasta: lembra a tela de onde o dono veio.
  useEffect(() => {
    lembrarATela(location.hash);
  }, [rota.id, rota.param]);

  // Ao trocar de página o foco vai para o título (leitor de tela e teclado
  // sabem onde estão). Ao abrir o app, não: nada foi escolhido ainda.
  useEffect(() => {
    if (primeira.current) {
      primeira.current = false;
      return;
    }
    const base = principal.current;
    if (!base) return;
    base.scrollTop = 0;
    if (pedidoRecente()) return; // pediram para ouvir: o foco é do campo do chat
    const titulo = base.querySelector<HTMLElement>('h1');
    if (titulo) {
      titulo.tabIndex = -1;
      titulo.focus();
    }
  }, [rota.id, rota.param]);

  // Ctrl+Alt+N: o chat ganha o foco e o microfone liga, de qualquer tela. No computador o chat é o painel da
  // direita (abre se estiver recolhido); no tablet e no celular, a página do chat.
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && (e.code === 'KeyN' || e.key.toLowerCase() === 'n')) {
        if (e.repeat) return; // tecla segurada: pede uma vez só
        // Num campo de texto de outra tela o atalho não atropela quem está digitando; no campo do chat, vale.
        if (ehCampoDeTexto(e.target) && !(e.target as HTMLElement).classList.contains('chat-entrada')) return;
        e.preventDefault();
        abrirOChat(tela, rota.id);
      }
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [tela, rota.id]);

  // Abrir o app pelo atalho do ícone (`#/?falar=1`) já pede para ouvir; o endereço volta ao normal.
  useEffect(() => {
    const aoMudarOEndereco = () => {
      const limpo = enderecoSemPedidoDeVoz(location.hash);
      if (limpo === null) return;
      history.replaceState(null, '', `${location.pathname}${location.search}${limpo}`);
      abrirOChat(tela, rota.id);
    };
    aoMudarOEndereco();
    window.addEventListener('hashchange', aoMudarOEndereco);
    return () => window.removeEventListener('hashchange', aoMudarOEndereco);
  }, [tela, rota.id]);

  return (
    <div class="casca" data-tela={tela}>
      <button type="button" class="pular" onClick={() => principal.current?.focus()}>
        Pular para o conteúdo
      </button>
      {tela === 'computador' && <MenuLateral rota={rota} hoje={hoje} />}
      {tela === 'tablet' && <Atalhos rota={rota} hoje={hoje} variante="trilho" />}
      <main class="pagina" ref={principal} tabIndex={-1}>
        <div class="topo">
          {rota.voltarPara && (
            <a class="voltar" href={rota.voltarPara}>
              <Icone nome="voltar" />
              <span>Voltar</span>
            </a>
          )}
          <NovaVersao />
          <EstadoDaSincronia />
        </div>
        <Vista rota={rota} />
      </main>
      {tela === 'computador' && <PainelDireito semChat={rota.id === 'chat'} semAgora={rota.id === 'agora'} />}
      {tela === 'celular' && <Atalhos rota={rota} hoje={hoje} variante="barra" />}
    </div>
  );
}
