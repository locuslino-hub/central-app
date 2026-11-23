// Bloco flutuante: uma janelinha sempre por cima das outras (Document Picture-in-Picture do Chrome/Edge), que fica
// na tela com o app minimizado. Mostra as notas da última pasta comum aberta (ou da sala escolhida no seletor);
// escrever ali é o mesmo que na pasta (mesmas notas, mesma loja, mesma sincronia). Só abre com um clique dentro do app e fecha junto com o app.
// Navegador sem a API (Firefox, celular): o botão não aparece.
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useAparelhoCelular, usePastas, useSalas } from './hooks';
import { Icone } from './icones';
import { QuadroDeNotas } from './QuadroDeNotas';
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
        // O que ficou por salvar num formulário aberto se perde (só grava com "Salvar nota"); as notas salvas ficam.
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

/** O que está escolhido: segue a última pasta comum aberta no app; escolher no seletor também vale (sala ou pasta). */
function useUltimaPasta(): [UltimaPasta | null, (escolha: UltimaPasta) => void] {
  const [ultima, setUltima] = useState<UltimaPasta | null>(lerUltimaPasta);
  useEffect(() => {
    const aoMudar = (e: Event) => setUltima((e as CustomEvent<UltimaPasta>).detail ?? lerUltimaPasta());
    window.addEventListener(EVENTO_DA_ULTIMA_PASTA, aoMudar);
    return () => window.removeEventListener(EVENTO_DA_ULTIMA_PASTA, aoMudar);
  }, []);
  return [ultima, (escolha) => guardarUltimaPasta(escolha.salaId, escolha.pastaId)];
}

type Opcao = { valor: string; rotulo: string; salaId: string; pastaId?: string; titulo: string };

/** O que aparece dentro da janelinha: seletor (salas e pastas comuns) e o quadro de notas do que foi escolhido. */
export function BlocoFlutuante() {
  const salas = useSalas();
  const pastas = usePastas();
  const [ultima, escolher] = useUltimaPasta();
  const opcoes: Opcao[] = salas.flatMap((sala) => [
    { valor: `sala:${sala.id}`, rotulo: sala.nome, salaId: sala.id, titulo: 'Notas' },
    ...(pastas ?? [])
      .filter((pasta) => pasta.tipo === 'comum' && !pasta.apagado && pasta.salaId === sala.id)
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
      .map((pasta) => ({ valor: `pasta:${pasta.id}`, rotulo: `${sala.nome} · ${pasta.nome}`, salaId: sala.id, pastaId: pasta.id, titulo: `Notas · ${pasta.nome}` })),
  ]);
  const atual = ultima ? opcoes.find((o) => o.salaId === ultima.salaId && o.pastaId === ultima.pastaId) : undefined;

  return (
    <div class="bloco-flutuante">
      <select
        class="bloco-flutuante-pasta"
        aria-label="Pasta"
        value={atual?.valor ?? ''}
        onChange={(e) => {
          const escolhida = opcoes.find((o) => o.valor === (e.currentTarget as HTMLSelectElement).value);
          if (escolhida) escolher({ salaId: escolhida.salaId, pastaId: escolhida.pastaId });
        }}
      >
        {!atual && <option value="">Escolha a subpasta</option>}
        {opcoes.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.rotulo}
          </option>
        ))}
      </select>
      {atual ? (
        <QuadroDeNotas key={atual.valor} salaId={atual.salaId} pastaId={atual.pastaId} titulo={atual.titulo} />
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
