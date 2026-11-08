// Temporária: só para o dono provar a sincronia nos dois aparelhos (Tarefa 5).
// O estado da sincronia agora é da casca (EstadoSync.tsx); a Tarefa 9 traz a lista de tarefas.
import { useEffect, useState } from 'preact/hooks';
import { assinar, listar, salvar } from '../dados/loja';
import type { Tarefa } from '../dados/tipos';

const TOQUE_MINIMO = { minHeight: '44px' };

// String(…): registro sem título (dado antigo ou quebrado) não derruba a lista.
const porTitulo = (a: Tarefa, b: Tarefa) =>
  String(a.titulo ?? '').localeCompare(String(b.titulo ?? ''), 'pt-BR');

export function ProvaSincronia() {
  const [tarefas, setTarefas] = useState<Tarefa[]>([]);
  const [titulo, setTitulo] = useState('');

  useEffect(() => {
    let ativo = true;
    const recarregar = () =>
      listar('tarefas')
        .then((lista) => ativo && setTarefas(lista.sort(porTitulo)))
        .catch((erro: unknown) => console.error('Não consegui ler as tarefas', erro));
    void recarregar();
    const pararLoja = assinar((mudanca) => {
      if (mudanca.colecao === 'tarefas') void recarregar();
    });
    return () => {
      ativo = false;
      pararLoja();
    };
  }, []);

  async function criar(evento: Event) {
    evento.preventDefault();
    const limpo = titulo.trim();
    if (!limpo) return;
    try {
      await salvar('tarefas', {
        titulo: limpo,
        salaId: null,
        duracaoMin: 60,
        duracaoConfirmada: false,
        feito: false,
        fixada: false,
        marcar: false,
      });
      // Só limpa depois de gravado (se falhar, o texto fica), e só se o campo
      // ainda tem o que foi gravado: digitação nova não é apagada.
      setTitulo((atual) => (atual.trim() === limpo ? '' : atual));
    } catch (erro) {
      console.error('Não consegui salvar a tarefa', erro);
    }
  }

  return (
    <section class="painel prova">
      <h2>Prova da sincronia</h2>
      <form onSubmit={criar}>
        <label for="nova-tarefa">Nova tarefa</label>{' '}
        <input
          id="nova-tarefa"
          class="campo"
          value={titulo}
          onInput={(e) => setTitulo((e.target as HTMLInputElement).value)}
          style={TOQUE_MINIMO}
        />{' '}
        <button type="submit" class="botao primario" style={TOQUE_MINIMO}>
          Criar
        </button>
      </form>
      <ul>
        {tarefas.map((tarefa) => (
          <li key={tarefa.id}>{String(tarefa.titulo ?? '')}</li>
        ))}
      </ul>
    </section>
  );
}
