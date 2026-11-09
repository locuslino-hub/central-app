// Conflitos que a sincronia resolveu (src/dados/loja.ts, `avisos`): a mesma coisa
// mudou em dois aparelhos e valeu a mudança mais recente. A versão que perdeu fica
// guardada; aqui o dono é só avisado, com uma linha por conflito e um Entendi.
import { useEffect, useRef, useState } from 'preact/hooks';
import { dispensarAviso, listarAvisos, assinar } from '../dados/loja';
import { assinarEstado } from '../dados/sincronia';
import type { Aviso } from '../dados/tipos';
import './tarefas.css';

const MOSTRAR_NO_MAXIMO = 3;

/** O nome que o dono conhece o registro: título da tarefa ou do documento, nome da pessoa ou da sala, palavra da memória. */
function rotuloDoRegistro(registro: unknown): string {
  const r = registro as Record<string, unknown> | null;
  for (const campo of ['titulo', 'nome', 'termo']) {
    const valor = r?.[campo];
    if (typeof valor === 'string' && valor.trim()) return valor;
  }
  return 'um item';
}

function useAvisos(): [Aviso[], () => Promise<unknown>] {
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const ativo = useRef(true);
  const ler = () =>
    listarAvisos()
      .then((lista) => ativo.current && setAvisos(lista))
      .catch((erro: unknown) => console.error('Não consegui ler os avisos', erro));
  useEffect(() => {
    ativo.current = true;
    void ler();
    // Chega junto com a escrita que resolveu o conflito (assinar) ou no fim da rodada (estado da sincronia).
    const pararLoja = assinar(() => void ler());
    const pararEstado = assinarEstado(() => void ler());
    return () => {
      ativo.current = false;
      pararLoja();
      pararEstado();
    };
  }, []);
  return [avisos, ler];
}

export function AvisosDeConflito() {
  const [avisos, recarregar] = useAvisos();
  const [falha, setFalha] = useState(false);
  if (avisos.length === 0) return null;
  // Os mais novos primeiro.
  const ordenados = [...avisos].sort((a, b) => b.criadoEm - a.criadoEm || b.id - a.id);
  const mostrados = ordenados.slice(0, MOSTRAR_NO_MAXIMO);
  const faltam = ordenados.length - mostrados.length;

  async function entendi(aviso: Aviso) {
    setFalha(false);
    try {
      await dispensarAviso(aviso.id);
      await recarregar();
    } catch (erro) {
      console.error('Não consegui dispensar o aviso', erro);
      setFalha(true);
    }
  }

  return (
    <section class="avisos-de-conflito" aria-label="Avisos de mudanças">
      <ul class="avisos-lista">
        {mostrados.map((aviso) => {
          const titulo = rotuloDoRegistro(aviso.perdedora);
          return (
            <li key={aviso.id} class="aviso-de-conflito">
              <span>{`Uma mudança feita em outro aparelho substituiu esta: ${titulo}`}</span>
              <button
                type="button"
                class="tarefa-entendi"
                aria-label={`Entendi: ${titulo}`}
                onClick={() => void entendi(aviso)}
              >
                Entendi
              </button>
            </li>
          );
        })}
      </ul>
      {faltam > 0 && <p class="avisos-mais">{`Mais ${faltam} ${faltam === 1 ? 'aviso' : 'avisos'} como este.`}</p>}
      {falha && <p class="tarefa-erro">Não consegui tirar o aviso. Tente de novo.</p>}
    </section>
  );
}
