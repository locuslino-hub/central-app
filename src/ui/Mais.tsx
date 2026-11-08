// "Mais": o que não cabe na barra (celular) nem no trilho (tablet).
import { useEffect, useRef } from 'preact/hooks';
import { hrefDe, type IdDaRota } from '../rotas';
import { Icone, type NomeDoIcone } from './icones';

type Destino = { id: Exclude<IdDaRota, 'nao-encontrada'>; icone: NomeDoIcone };

/** Os destinos do Mais, por grupo. O nome de Esta semana, mês e ano vem do chamador. */
export const GRUPOS_DO_MAIS: { titulo: string; destinos: Destino[] }[] = [
  {
    titulo: 'Calendário',
    destinos: [
      { id: 'semana', icone: 'semana' },
      { id: 'mes', icone: 'mes' },
      { id: 'ano', icone: 'ano' },
    ],
  },
  {
    titulo: 'Ver',
    destinos: [
      { id: 'quadro', icone: 'quadro' },
      { id: 'atividades', icone: 'atividades' },
      { id: 'sem-prazo', icone: 'sem-prazo' },
    ],
  },
  { titulo: 'Aparelho', destinos: [{ id: 'conectar', icone: 'conectar' }] },
];

export const ROTAS_DO_MAIS = new Set<IdDaRota>(GRUPOS_DO_MAIS.flatMap((g) => g.destinos.map((d) => d.id)));

export const ID_DA_FOLHA = 'folha-mais';

type BotaoProps = { aberto: boolean; dentro: boolean; aoAlternar: () => void; botaoRef: { current: HTMLButtonElement | null } };

export function BotaoMais({ aberto, dentro, aoAlternar, botaoRef }: BotaoProps) {
  return (
    <button
      type="button"
      class="mais"
      ref={botaoRef}
      aria-haspopup="dialog"
      aria-expanded={aberto}
      aria-controls={aberto ? ID_DA_FOLHA : undefined}
      aria-current={dentro ? 'true' : undefined}
      onClick={aoAlternar}
    >
      <Icone nome="mais" />
      <span>Mais</span>
    </button>
  );
}

type FolhaProps = {
  rotulo: (id: Destino['id']) => string;
  rotaAtual: IdDaRota;
  /** `devolverFoco`: true quando fechou sem navegar (Esc, Fechar, fundo). */
  aoFechar: (devolverFoco: boolean) => void;
};

const FOCAVEIS = 'a[href], button:not([disabled])';

export function FolhaMais({ rotulo, rotaAtual, aoFechar }: FolhaProps) {
  const folha = useRef<HTMLDivElement>(null);

  useEffect(() => {
    folha.current?.querySelector<HTMLElement>(FOCAVEIS)?.focus();
  }, []);

  function aoTeclar(evento: KeyboardEvent) {
    if (evento.key === 'Escape') {
      evento.stopPropagation();
      aoFechar(true);
      return;
    }
    if (evento.key !== 'Tab') return;
    const itens = [...(folha.current?.querySelectorAll<HTMLElement>(FOCAVEIS) ?? [])];
    if (itens.length === 0) return;
    const primeiro = itens[0];
    const ultimo = itens[itens.length - 1];
    const ativo = document.activeElement;
    if (evento.shiftKey && ativo === primeiro) {
      evento.preventDefault();
      ultimo.focus();
    } else if (!evento.shiftKey && ativo === ultimo) {
      evento.preventDefault();
      primeiro.focus();
    }
  }

  return (
    <>
      <div class="fundo-da-folha" aria-hidden="true" onClick={() => aoFechar(true)} />
      <div
        class="folha"
        id={ID_DA_FOLHA}
        role="dialog"
        aria-modal="true"
        aria-label="Mais"
        ref={folha}
        onKeyDown={aoTeclar}
      >
        {GRUPOS_DO_MAIS.map((grupo) => (
          <section key={grupo.titulo} aria-labelledby={`mais-${grupo.titulo}`}>
            <h2 id={`mais-${grupo.titulo}`}>{grupo.titulo}</h2>
            <ul>
              {grupo.destinos.map((destino) => (
                <li key={destino.id}>
                  <a
                    class="item"
                    href={hrefDe(destino.id)}
                    aria-current={rotaAtual === destino.id ? 'page' : undefined}
                    onClick={() => aoFechar(false)}
                  >
                    <Icone nome={destino.icone} />
                    <span>{rotulo(destino.id)}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <button type="button" class="fechar" onClick={() => aoFechar(true)}>
          Fechar
        </button>
      </div>
    </>
  );
}
