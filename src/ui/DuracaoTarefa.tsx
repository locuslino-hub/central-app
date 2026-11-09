// Duração da tarefa (spec, seção 8): 1 hora por padrão; enquanto o dono não
// confirma, a tela diz "cerca de". Tocar numa duração confirma essa duração,
// inclusive a padrão: não há botão "confirmar" à parte.
import { useEffect, useRef, useState } from 'preact/hooks';
import { confirmarDuracao } from '../dados/tarefas';
import type { Tarefa } from '../dados/tipos';
import { formatarDuracao, rotuloDaDuracao } from './quando';
import './tarefas.css';

const OPCOES_MIN = [15, 30, 45, 60, 90, 120, 180, 240] as const;

export function DuracaoTarefa({ tarefa }: { tarefa: Tarefa }) {
  const [aberto, setAberto] = useState(false);
  const [falha, setFalha] = useState(false);
  const botao = useRef<HTMLButtonElement>(null);
  const grupo = useRef<HTMLDivElement>(null);

  // Ao abrir, o foco vai para a duração marcada (ou a primeira): teclado e leitor de tela chegam nas opções.
  useEffect(() => {
    if (!aberto) return;
    const marcada = grupo.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
    (marcada ?? grupo.current?.querySelector<HTMLButtonElement>('button'))?.focus();
  }, [aberto]);

  const fechar = () => {
    setAberto(false);
    setFalha(false);
    botao.current?.focus();
  };

  async function escolher(minutos: number) {
    try {
      await confirmarDuracao(tarefa.id, minutos);
      fechar();
    } catch (erro) {
      console.error('Não consegui salvar a duração', erro);
      setFalha(true);
    }
  }

  const rotulo = rotuloDaDuracao(tarefa);
  return (
    <div class="duracao">
      <button
        type="button"
        class="duracao-botao"
        ref={botao}
        aria-expanded={aberto}
        aria-label={`Duração: ${rotulo}`}
        onClick={() => (aberto ? fechar() : setAberto(true))}
      >
        {rotulo}
      </button>
      {aberto && (
        <div
          class="duracao-opcoes"
          role="group"
          aria-label="Duração da tarefa"
          ref={grupo}
          onKeyDown={(evento) => {
            if (evento.key === 'Escape') {
              evento.stopPropagation();
              fechar();
            }
          }}
        >
          <p class="duracao-pergunta">Quanto tempo leva?</p>
          <div class="duracao-lista">
            {OPCOES_MIN.map((minutos) => (
              <button
                type="button"
                key={minutos}
                class="duracao-opcao"
                aria-pressed={tarefa.duracaoConfirmada && tarefa.duracaoMin === minutos}
                onClick={() => void escolher(minutos)}
              >
                {formatarDuracao(minutos)}
              </button>
            ))}
          </div>
          {falha && (
            <p class="tarefa-erro" role="alert">
              Não consegui salvar. Tente de novo.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
