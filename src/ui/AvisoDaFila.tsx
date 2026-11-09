// Compromissos que a sincronia desistiu de enviar (Tarefa 12): o Google Agenda
// recusou muitas vezes ou o pedido ficou parado mais de uma semana. O pedido
// continua guardado; aqui o dono é avisado e escolhe Tentar de novo ou Descartar.
// Nada é apagado sozinho. O espelho no Google (tarefas no Google Tarefas, "✓ "
// dos compromissos) que parou também aparece aqui; descartar não muda a Central.
import { useEffect, useRef, useState } from 'preact/hooks';
import { agendaEsgotada, listarPendentes, reiniciarAgendaParada, retirarPendente } from '../dados/loja';
import { assinarEstado, sincronizar } from '../dados/sincronia';
import type { PendenteAgenda, PendenteEspelho } from '../dados/tipos';
import './tarefas.css';

type Parada = PendenteAgenda | PendenteEspelho;

async function lerParadas(): Promise<Parada[]> {
  const agora = Date.now();
  return (await listarPendentes()).filter(
    (p): p is Parada => (p.tipo === 'agenda' || p.tipo === 'espelho') && agendaEsgotada(p, agora),
  );
}

const vezes = (n: number, um: string, varios: string) => (n === 1 ? um : varios.replace('#', String(n)));

export function AvisoDaFila() {
  const [paradas, setParadas] = useState<Parada[]>([]);
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
  const naoSairam = paradas.filter((p) => p.acao === 'removerEvento').length;
  // Uma tarefa pode ter várias entradas: conta tarefas.
  const tarefas = new Set(paradas.flatMap((p) => (p.acao === 'espelharTarefa' ? [p.tarefaId] : []))).size;
  const feitos = paradas.filter((p) => p.acao === 'marcarEventoFeito' || p.acao === 'marcarTarefaGoogle').length;

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
    <section class="avisos-de-conflito" aria-label="O que não chegou ao Google">
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
        {tarefas > 0 && (
          <li class="aviso-de-conflito">
            {vezes(tarefas, '1 tarefa não chegou ao Google Tarefas.', '# tarefas não chegaram ao Google Tarefas.')}
          </li>
        )}
        {feitos > 0 && (
          <li class="aviso-de-conflito">
            {vezes(feitos, '1 compromisso feito não foi marcado no Google Agenda.', '# compromissos feitos não foram marcados no Google Agenda.')}
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
