// Ajuste deste aparelho: o nome que a saudação do Painel do dia usa.
import { useState } from 'preact/hooks';
import { guardarNome, lerNome } from '../dados/nome';

export function SeuNome() {
  const [nome, setNome] = useState(lerNome);
  const [situacao, setSituacao] = useState('');
  return (
    <section class="painel seu-nome" aria-labelledby="titulo-seu-nome">
      <h2 id="titulo-seu-nome">Seu nome</h2>
      <p class="seu-nome-nota">Aparece na saudação do Painel do dia. Fica só neste aparelho.</p>
      <form
        class="seu-nome-form"
        onSubmit={(evento) => {
          evento.preventDefault();
          const guardado = guardarNome(nome);
          setNome(guardado);
          setSituacao(guardado ? `Guardado. A saudação agora diz "${guardado}".` : 'Sem nome. A saudação fica sem nome.');
        }}
      >
        <label for="seu-nome-campo">Como a saudação te chama</label>
        <div class="seu-nome-linha">
          <input
            id="seu-nome-campo"
            class="campo"
            type="text"
            autocomplete="given-name"
            maxLength={40}
            value={nome}
            onInput={(e) => setNome(e.currentTarget.value)}
          />
          <button type="submit" class="botao">
            Guardar nome
          </button>
        </div>
      </form>
      <p role="status" aria-live="polite">
        {situacao}
      </p>
    </section>
  );
}
