// Campo para escrever uma tarefa sem passar pelo Chat. Tarefa nova sem dia vai
// para hoje (decisão de 11/11): Checklist, sala e pessoa passam `data`; só o
// campo de Sem prazo cria sem dia. A sala se escolhe depois, em Editar, salvo
// nas páginas de sala e de pessoa, onde ela já nasce no lugar.
import { useRef, useState } from 'preact/hooks';
import { criarTarefa } from '../dados/tarefas';
import './tarefas.css';

type Props = {
  /** O nome do campo, que também o descreve: "Nova tarefa para hoje". */
  rotulo: string;
  /** `AAAA-MM-DD`: o dia da tarefa nova (hoje). Sem isto, Sem prazo (só o campo de Sem prazo). */
  data?: string;
  /** Numa página de sala ou de pessoa: a tarefa nasce já nela. */
  salaId?: string;
  pessoaId?: string;
};

export function NovaTarefa({ rotulo, data, salaId, pessoaId }: Props) {
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  // Para o leitor de tela: a tarefa já aparece na lista, mas quem não a vê precisa saber que foi criada.
  const [aviso, setAviso] = useState('');
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
      await criarTarefa(limpo, { ...(data === undefined ? {} : { data }), ...(salaId === undefined ? {} : { salaId }), ...(pessoaId === undefined ? {} : { pessoaId }) });
      setErro(null);
      setAviso(`Tarefa adicionada: ${limpo}`);
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
      {/* O rótulo fica para o leitor de tela; na tela, o mesmo texto vai dentro do campo. */}
      <label class="nova-tarefa-rotulo so-leitor" for={id}>
        {rotulo}
      </label>
      <div class="nova-tarefa-campos">
        <input
          id={id}
          ref={campo}
          class="campo"
          value={texto}
          autocomplete="off"
          placeholder={rotulo}
          enterkeyhint="done"
          aria-invalid={erro === 'Escreva a tarefa.' ? true : undefined}
          onInput={(e) => {
            setTexto((e.target as HTMLInputElement).value);
            setErro(null);
            setAviso('');
          }}
        />
        {/* Em coluna estreita só o "+" aparece (o campo precisa de espaço para o texto de dentro); o nome é sempre "Adicionar". */}
        <button type="submit" class="botao primario nova-tarefa-botao" aria-label="Adicionar">
          <span class="nova-tarefa-mais" aria-hidden="true">
            +
          </span>
          <span class="nova-tarefa-texto">Adicionar</span>
        </button>
      </div>
      <p class="so-leitor" role="status">
        {aviso}
      </p>
      {erro && (
        <p class="tarefa-erro" role="alert">
          {erro}
        </p>
      )}
    </form>
  );
}
