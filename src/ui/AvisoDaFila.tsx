// Compromissos que a sincronia desistiu de enviar (Tarefa 12): o Google Agenda
// recusou muitas vezes ou o pedido ficou parado mais de uma semana. O pedido
// continua guardado; aqui o dono é avisado e escolhe Tentar de novo ou Descartar.
// Nada é apagado sozinho.
import { useEffect, useRef, useState } from 'preact/hooks';
import { agendaEsgotada, listarPendentes, reiniciarAgendaParada, retirarPendente } from '../dados/loja';
import { assinarEstado, sincronizar } from '../dados/sincronia';
import type { PendenteAgenda } from '../dados/tipos';
import './tarefas.css';

async function lerParadas(): Promise<PendenteAgenda[]> {
  const agora = Date.now();
  return (await listarPendentes()).filter((p): p is PendenteAgenda => p.tipo === 'agenda' && agendaEsgotada(p, agora));
}

export function AvisoDaFila() {
  const [paradas, setParadas] = useState<PendenteAgenda[]>([]);
  const [falha, setFalha] = useState(false);
  const ativo = useRef(true);
  const ler = () =>
    lerParadas()
      .then((lista) => ativo.current && setParadas(lista))
      .catch((erro: unknown) => console.error('Não consegui ler a fila da agenda', erro));

  useEffect(() => {
    ativo.current = true;
    void ler();
    // O fim de cada rodada da sincronia é quando uma ação passa do limite.
    const parar = assinarEstado(() => void ler());
    return () => {
      ativo.current = false;
      parar();
    };
  }, []);

  if (paradas.length === 0) return null;
  const naoEntraram = paradas.filter((p) => p.acao === 'criarEvento').length;
  const naoSairam = paradas.length - naoEntraram;

  async function agir(acao: () => Promise<unknown>) {
    setFalha(false);
    try {
      await acao();
      await ler();
    } catch (erro) {
      console.error('Não consegui mexer na fila da agenda', erro);
      setFalha(true);
    }
  }

  return (
    <section class="avisos-de-conflito" aria-label="Compromissos que não entraram na agenda">
      <ul class="avisos-lista">
        {naoEntraram > 0 && (
          <li class="aviso-de-conflito">
            {naoEntraram === 1 ? '1 compromisso não entrou na agenda.' : `${naoEntraram} compromissos não entraram na agenda.`}
          </li>
        )}
        {naoSairam > 0 && (
          <li class="aviso-de-conflito">
            {naoSairam === 1
              ? '1 compromisso desfeito ainda está na agenda.'
              : `${naoSairam} compromissos desfeitos ainda estão na agenda.`}
          </li>
        )}
      </ul>
      <div class="aviso-da-fila-acoes">
        <button
          type="button"
          class="tarefa-entendi"
          onClick={() =>
            void agir(async () => {
              await reiniciarAgendaParada();
              void sincronizar();
            })
          }
        >
          Tentar de novo
        </button>
        <button
          type="button"
          class="tarefa-entendi"
          onClick={() => void agir(() => Promise.all(paradas.map((p) => retirarPendente(p.seq))))}
        >
          Descartar
        </button>
      </div>
      {falha && <p class="tarefa-erro">Não consegui mexer na fila. Tente de novo.</p>}
    </section>
  );
}
