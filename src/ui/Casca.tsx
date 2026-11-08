// A casca do app: navegação, página e painel direito, conforme o tamanho da tela.
import { useEffect, useRef } from 'preact/hooks';
import './tema.css';
import './casca.css';
import { EstadoDaSincronia } from './EstadoSync';
import { useHoje, useRota, useTela } from './hooks';
import { Icone } from './icones';
import { Atalhos, MenuLateral } from './Menu';
import { PainelDireito } from './PainelDireito';
import { Vista } from './Vista';

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
          <EstadoDaSincronia />
        </div>
        <Vista rota={rota} />
      </main>
      {tela === 'computador' && <PainelDireito semChat={rota.id === 'chat'} />}
      {tela === 'celular' && <Atalhos rota={rota} hoje={hoje} variante="barra" />}
    </div>
  );
}
