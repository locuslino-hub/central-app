// Coluna da direita no computador: Agora e Chat. As telas de verdade chegam nas
// próximas tarefas; por ora cada painel mostra o que vai morar nele.
import { PAINEIS_DIREITOS, type Painel } from '../rotas';

const PAINEL: Record<Painel, { titulo: string; texto: string }> = {
  agora: { titulo: 'Agora', texto: 'A tarefa em foco aparece aqui.' },
  chat: { titulo: 'Chat', texto: 'Aqui você escreve para a Central, como falaria com uma pessoa.' },
};

export function PainelDireito() {
  return (
    <aside class="painel-direito" aria-label="Agora e chat">
      {PAINEIS_DIREITOS.map((painel) => (
        <section key={painel} class={`cartao-${painel}`} aria-labelledby={`painel-${painel}`}>
          <h2 id={`painel-${painel}`}>{PAINEL[painel].titulo}</h2>
          <p class="foco-vazio">{PAINEL[painel].texto}</p>
        </section>
      ))}
    </aside>
  );
}
