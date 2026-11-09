// Campo para escrever uma tarefa sem passar pelo Chat. Na Checklist ela vai para
// hoje; em Sem prazo, fica sem dia. A sala se escolhe depois, em Editar.
import { useRef, useState } from 'preact/hooks';
import { criarTarefa } from '../dados/tarefas';
import './tarefas.css';

type Props = {
  /** O nome do campo, que também o descreve: "Nova tarefa para hoje". */
  rotulo: string;
  /** `AAAA-MM-DD` quando a tarefa nova já nasce com dia (hoje); sem isto, Sem prazo. */
  data?: string;
};

export function NovaTarefa({ rotulo, data }: Props) {
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const campo = useRef<HTMLInputElement>(null);
  const emAndamento = useRef(false);
  const id = `nova-${rotulo.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

  async function adicionar(evento: Event) {
    evento.preventDefault();
    // Dois toques seguidos não criam duas tarefas.
    if (emAndamento.current) return;
    const limpo = texto.trim();
    if (!limpo) {
      setErro('Escreva a tarefa.');
      return campo.current?.focus();
    }
    emAndamento.current = true;
    try {
      await criarTarefa(limpo, data === undefined ? {} : { data });
      setErro(null);
      // Só limpa o que foi gravado: quem já começou a próxima não perde o texto.
      setTexto((atual) => (atual.trim() === limpo ? '' : atual));
      campo.current?.focus();
    } catch (falha) {
      console.error('Não consegui criar a tarefa', falha);
      setErro('Não consegui salvar. Tente de novo.');
    } finally {
      emAndamento.current = false;
    }
  }

  return (
    <form class="nova-tarefa" noValidate onSubmit={adicionar}>
      <label class="nova-tarefa-rotulo" for={id}>
        {rotulo}
      </label>
      <div class="nova-tarefa-campos">
        <input
          id={id}
          ref={campo}
          class="campo"
          value={texto}
          autocomplete="off"
          enterkeyhint="done"
          aria-invalid={erro === 'Escreva a tarefa.' ? true : undefined}
          onInput={(e) => {
            setTexto((e.target as HTMLInputElement).value);
            setErro(null);
          }}
        />
        <button type="submit" class="botao primario">
          Adicionar
        </button>
      </div>
      {erro && (
        <p class="tarefa-erro" role="alert">
          {erro}
        </p>
      )}
    </form>
  );
}
