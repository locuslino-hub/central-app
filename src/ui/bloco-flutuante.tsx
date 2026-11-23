// Bloco flutuante: uma janelinha sempre por cima das outras (Document Picture-in-Picture do Chrome/Edge), que fica
// na tela com o app minimizado. Mostra as Notas da última pasta comum aberta; escrever ali é o mesmo que na pasta
// (mesma página, mesma loja, mesma sincronia). Só abre com um clique dentro do app e fecha junto com o app.
// Navegador sem a API (Firefox, celular): o botão não aparece.
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { Pasta } from '../dados/tipos';
import { Caderno } from './Caderno';
import { useAparelhoCelular, usePastas, useSalas } from './hooks';
import { Icone } from './icones';
import { EVENTO_DA_ULTIMA_PASTA, guardarUltimaPasta, lerUltimaPasta, type UltimaPasta } from './ultima-pasta';
import './bloco-flutuante.css';

type JanelaFlutuante = Pick<Window, 'document' | 'addEventListener' | 'focus' | 'close'>;
type ApiDoPip = { requestWindow: (opcoes?: { width?: number; height?: number }) => Promise<JanelaFlutuante> };

const LARGURA = 340;
const ALTURA = 420;

let aberta: JanelaFlutuante | null = null;
let abrindo: Promise<void> | null = null;

function api(): ApiDoPip | undefined {
  return (window as unknown as { documentPictureInPicture?: ApiDoPip }).documentPictureInPicture;
}

/** O navegador sabe abrir a janelinha? */
export function podeFlutuar(): boolean {
  return typeof window !== 'undefined' && api() !== undefined;
}

/** Leva tema, paleta e estilos do app para a janelinha (ela nasce em branco). */
function copiarAparencia(destino: Document) {
  for (const folha of Array.from(document.styleSheets)) {
    try {
      const estilo = destino.createElement('style');
      estilo.textContent = Array.from(folha.cssRules, (regra) => regra.cssText).join('\n');
      destino.head.append(estilo);
    } catch {
      // Folha de outra origem: não se lê, então vai como link.
      if (folha.href) {
        const link = destino.createElement('link');
        link.rel = 'stylesheet';
        link.href = folha.href;
        destino.head.append(link);
      }
    }
  }
  for (const [origem, alvo] of [
    [document.documentElement, destino.documentElement],
    [document.body, destino.body],
  ] as const) {
    for (const { name, value } of Array.from(origem.attributes)) alvo.setAttribute(name, value);
  }
  destino.title = 'Notas — Central';
  destino.body.classList.add('bloco-flutuante-corpo');
}

/** Abre a janelinha (precisa de um clique). Se já está aberta, só a traz para a frente. */
export function abrirBlocoFlutuante(): Promise<void> {
  if (aberta) {
    aberta.focus();
    return Promise.resolve();
  }
  if (abrindo) return abrindo;
  const pip = api();
  if (!pip) return Promise.resolve();
  abrindo = pip
    .requestWindow({ width: LARGURA, height: ALTURA })
    .then((janela) => {
      aberta = janela;
      copiarAparencia(janela.document);
      const raiz = janela.document.body;
      janela.addEventListener('pagehide', () => {
        // Desmontar grava o que ficou por gravar no caderno.
        render(null, raiz);
        if (aberta === janela) aberta = null;
      });
      render(<BlocoFlutuante />, raiz);
    })
    .catch((falha: unknown) => console.error('Não consegui abrir o bloco flutuante', falha))
    .finally(() => {
      abrindo = null;
    });
  return abrindo;
}

/** Fecha a janelinha, se estiver aberta. */
export function fecharBlocoFlutuante(): void {
  aberta?.close();
  aberta = null;
}

/** A pasta escolhida: segue a última pasta comum aberta no app. */
function useUltimaPasta(): [UltimaPasta | null, (pasta: UltimaPasta) => void] {
  const [ultima, setUltima] = useState<UltimaPasta | null>(lerUltimaPasta);
  useEffect(() => {
    const aoMudar = (e: Event) => setUltima((e as CustomEvent<UltimaPasta>).detail ?? lerUltimaPasta());
    window.addEventListener(EVENTO_DA_ULTIMA_PASTA, aoMudar);
    return () => window.removeEventListener(EVENTO_DA_ULTIMA_PASTA, aoMudar);
  }, []);
  return [ultima, (pasta) => guardarUltimaPasta(pasta.salaId, pasta.pastaId)];
}

/** O que aparece dentro da janelinha: seletor da pasta e as Notas dela. */
export function BlocoFlutuante() {
  const salas = useSalas();
  const pastas = usePastas();
  const [ultima, escolher] = useUltimaPasta();
  const nomeDaSala = (id: string) => salas.find((sala) => sala.id === id)?.nome;
  const comuns: Pasta[] = (pastas ?? [])
    .filter((pasta) => pasta.tipo === 'comum' && !pasta.apagado && nomeDaSala(pasta.salaId) !== undefined)
    .sort((a, b) => (nomeDaSala(a.salaId) ?? '').localeCompare(nomeDaSala(b.salaId) ?? '', 'pt-BR') || a.nome.localeCompare(b.nome, 'pt-BR'));
  const atual = ultima ? comuns.find((pasta) => pasta.id === ultima.pastaId && pasta.salaId === ultima.salaId) : undefined;

  return (
    <div class="bloco-flutuante">
      <select
          class="bloco-flutuante-pasta"
          aria-label="Pasta"
          value={atual?.id ?? ''}
          onChange={(e) => {
            const escolhida = comuns.find((pasta) => pasta.id === (e.currentTarget as HTMLSelectElement).value);
            if (escolhida) escolher({ salaId: escolhida.salaId, pastaId: escolhida.id });
          }}
        >
          {!atual && <option value="">Escolha a subpasta</option>}
          {comuns.map((pasta) => (
            <option key={pasta.id} value={pasta.id}>
              {`${nomeDaSala(pasta.salaId)} · ${pasta.nome}`}
            </option>
          ))}
        </select>
      {atual ? (
        <Caderno key={atual.id} salaId={atual.salaId} nomeDaSala={nomeDaSala(atual.salaId) ?? ''} pastaId={atual.id} criarPrimeira />
      ) : (
        pastas !== undefined && <p class="lista-vazia-texto">Abra uma subpasta ou escolha uma acima.</p>
      )}
    </div>
  );
}

/** "Bloco flutuante": no menu do computador e no topo da pasta comum. Some onde o navegador não sabe abrir. */
export function BotaoBlocoFlutuante({ variante }: { variante: 'menu' | 'pasta' }) {
  const celular = useAparelhoCelular();
  if (celular || !podeFlutuar()) return null;
  return (
    <button type="button" class={variante === 'menu' ? 'item item-botao' : 'botao-texto bloco-flutuante-abrir'} onClick={() => void abrirBlocoFlutuante()}>
      <Icone nome="editar" />
      <span>Bloco flutuante</span>
    </button>
  );
}
