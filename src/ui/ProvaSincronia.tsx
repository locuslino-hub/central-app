// Temporária: só para o dono provar a sincronia nos dois aparelhos (Tarefa 5).
// A Tarefa 6 traz o indicador de estado de verdade e a 9 a lista de tarefas.
import { useEffect, useState } from 'preact/hooks';
import { assinar, listar, salvar } from '../dados/loja';
import { assinarEstado, estadoAtual, type EstadoSync } from '../dados/sincronia';
import type { Tarefa } from '../dados/tipos';

const TOQUE_MINIMO = { minHeight: '44px' };

export const TEXTO_DO_ESTADO: Record<EstadoSync, string> = {
  atualizado: 'Atualizado',
  atualizando: 'Atualizando…',
  'sem-internet': 'Sem internet',
  'por-enviar': 'Alterações por enviar',
  'erro-codigo': 'Problema com o código do aparelho ou com o script. Confira em Conectar aparelho.',
};

// String(…): registro sem título (dado antigo ou quebrado) não derruba a lista.
const porTitulo = (a: Tarefa, b: Tarefa) =>
  String(a.titulo ?? '').localeCompare(String(b.titulo ?? ''), 'pt-BR');

export function ProvaSincronia() {
  const [estado, setEstado] = useState<EstadoSync>(estadoAtual());
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
    const pararEstado = assinarEstado(setEstado);
    return () => {
      ativo = false;
      pararLoja();
      pararEstado();
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
    <section>
      <h2>Prova da sincronia</h2>
      <p role="status">{TEXTO_DO_ESTADO[estado]}</p>
      <form onSubmit={criar}>
        <label for="nova-tarefa">Nova tarefa</label>{' '}
        <input
          id="nova-tarefa"
          value={titulo}
          onInput={(e) => setTitulo((e.target as HTMLInputElement).value)}
          style={TOQUE_MINIMO}
        />{' '}
        <button type="submit" style={TOQUE_MINIMO}>
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
