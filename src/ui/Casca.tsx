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
import { abrirPodeFalar } from './PodeFalar';
import { Vista } from './Vista';

/** O clique no botão guarda de onde veio (para o Cancelar voltar) e abre a tela. */
function abrirDoBotao(e: MouseEvent) {
  if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return; // abrir em outra aba segue o link
  e.preventDefault();
  abrirPodeFalar();
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
    const titulo = base.querySelector<HTMLElement>('h1');
    if (titulo) {
      titulo.tabIndex = -1;
      titulo.focus();
    }
  }, [rota.id, rota.param]);

  // Ctrl+Alt+N abre o Pode falar de qualquer tela.
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && (e.code === 'KeyN' || e.key.toLowerCase() === 'n')) {
        if (e.repeat) return; // tecla segurada: abre uma vez só
        // Num campo de texto de outra tela o atalho não atropela quem está digitando.
        if (location.hash !== '#/falar' && ehCampoDeTexto(e.target)) return;
        e.preventDefault();
        abrirPodeFalar();
      }
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, []);

  const naTelaDeFalar = rota.id === 'falar';

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
          {!naTelaDeFalar && tela !== 'celular' && (
            <a class="falar-no-topo" href="#/falar" title="Atalho: Ctrl + Alt + N" onClick={abrirDoBotao}>
              <Icone nome="microfone" />
              <span>Pode falar</span>
            </a>
          )}
          <EstadoDaSincronia />
        </div>
        <Vista rota={rota} />
      </main>
      {tela === 'computador' && <PainelDireito semChat={rota.id === 'chat'} semAgora={rota.id === 'agora'} />}
      {tela === 'celular' && !naTelaDeFalar && (
        <a class="falar-flutuante" href="#/falar" aria-label="Pode falar" onClick={abrirDoBotao}>
          <Icone nome="microfone" />
        </a>
      )}
      {tela === 'celular' && <Atalhos rota={rota} hoje={hoje} variante="barra" />}
    </div>
  );
}
