// Anterior, hoje e próximo: os três links no alto de semana, mês e ano. São
// links de verdade (o endereço muda), então voltar do navegador volta ao período visto.
import { Icone } from './icones';

type Destino = { href: string; nome: string };

type Props = {
  /** Nome da região, para o leitor de tela: "Semanas", "Meses", "Anos". */
  rotulo: string;
  anterior: Destino;
  proximo: Destino;
  /** Para onde "Hoje" leva. */
  hoje: string;
};

export function NavegacaoDoCalendario({ rotulo, anterior, proximo, hoje }: Props) {
  return (
    <nav class="cal-nav" aria-label={rotulo}>
      <a class="cal-seta" href={anterior.href} aria-label={anterior.nome}>
        <Icone nome="voltar" />
      </a>
      <a class="botao-link cal-hoje-link" href={hoje}>
        Hoje
      </a>
      <a class="cal-seta cal-seta-proxima" href={proximo.href} aria-label={proximo.nome}>
        <Icone nome="voltar" />
      </a>
    </nav>
  );
}
