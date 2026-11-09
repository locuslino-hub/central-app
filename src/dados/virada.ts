// Virada do dia (Tarefa 9). Roda ao abrir o app, na meia-noite de Lisboa e ao
// voltar ao app em outro dia:
// - tarefa aberta de um dia que passou vem para hoje ("volta no dia seguinte
//   até ser concluída");
// - tarefa de uma semana que acabou perde a semana, volta para Sem prazo e
//   leva `semanaVencida`, o aviso que a tela mostra.
//
// Tudo passa por `salvar`, então sincroniza. É idempotente e só depende dos
// dados e do dia: dois aparelhos que rodem ao mesmo tempo chegam aos mesmos
// campos e a nenhum registro novo (só a hora da escrita difere; vence a mais
// nova e o resultado é igual).
import { segundaDaSemana } from '../chat/datas';
import { hojeEmLisboa, vigiarODia } from './dia';
import { lerRegistros, listar, salvar } from './loja';
import type { Tarefa } from './tipos';

export type ResultadoDaVirada = {
  /** Tarefas que vieram de dias passados para hoje. */
  movidas: number;
  /** Tarefas cuja semana acabou e voltaram para Sem prazo. */
  semanasVencidas: number;
};

const DIA = /^\d{4}-\d{2}-\d{2}$/;

type Mudanca = { novo: Tarefa; tipo: keyof ResultadoDaVirada };

/**
 * O que a virada faz com esta tarefa, ou nada. Compara `AAAA-MM-DD` como texto,
 * que nessa forma ordena como as datas. Fora da virada ficam:
 * - feitas (e apagadas: `listar` não as traz);
 * - compromissos (`inicio`): já aconteceram, não são coisa a fazer hoje;
 * - tarefas com prazo (`prazoHora`): o dia é o do prazo, e a tela as mostra como atrasadas.
 */
function mudancaDe(tarefa: Tarefa, hoje: string, segundaDeHoje: string): Mudanca | null {
  if (tarefa.feito || tarefa.apagado) return null;
  if (tarefa.data !== undefined) {
    const passou = DIA.test(tarefa.data) && tarefa.data < hoje;
    if (!passou || tarefa.inicio || tarefa.prazoHora) return null;
    return { novo: { ...tarefa, data: hoje }, tipo: 'movidas' };
  }
  if (tarefa.semana !== undefined && DIA.test(tarefa.semana) && tarefa.semana < segundaDeHoje) {
    const { semana, ...resto } = tarefa;
    return { novo: { ...resto, semanaVencida: semana }, tipo: 'semanasVencidas' };
  }
  return null;
}

// Uma virada por vez neste aparelho: o temporizador e o retorno ao app podem coincidir.
let fila: Promise<unknown> = Promise.resolve();

async function virar(hoje: string): Promise<ResultadoDaVirada> {
  const resultado: ResultadoDaVirada = { movidas: 0, semanasVencidas: 0 };
  const segunda = segundaDaSemana(hoje);
  for (const candidata of await listar('tarefas')) {
    if (!mudancaDe(candidata, hoje, segunda)) continue;
    // Lê de novo logo antes de escrever: uma versão que chegou da sincronia
    // nesse meio tempo é a que vale, e a conta é refeita sobre ela.
    const [fresca] = await lerRegistros([{ colecao: 'tarefas', id: candidata.id }]);
    const mudanca = fresca && mudancaDe(fresca as Tarefa, hoje, segunda);
    if (!mudanca) continue;
    await salvar('tarefas', mudanca.novo);
    resultado[mudanca.tipo]++;
  }
  return resultado;
}

/** `hoje`: `AAAA-MM-DD` em Lisboa. Devolve quantas tarefas mudaram. */
export function virarDia(hoje: string): Promise<ResultadoDaVirada> {
  const vez = fila.then(() => virar(hoje));
  fila = vez.catch(() => {});
  return vez;
}

export type OpcoesDaVirada = {
  /**
   * Roda antes de cada virada, que só segue quando termina (ou falha, ou passa
   * de `esperaMaximaMs`). O app passa a sincronização: este aparelho pode ter
   * ficado dias fechado, e virar em cima de uma cópia velha desfaria o que o
   * outro aparelho mudou nesse tempo.
   */
  antes?: () => Promise<unknown>;
  agora?: () => Date;
  esperaMaximaMs?: number;
};

const ESPERA_MAXIMA_PADRAO_MS = 15_000;

/**
 * Vira o dia agora e sempre que o dia de Lisboa mudar (temporizador da
 * meia-noite, reagendado a cada dia, e retorno ao app). Devolve a função que desliga.
 */
export function iniciarVirada({
  antes,
  agora = () => new Date(),
  esperaMaximaMs = ESPERA_MAXIMA_PADRAO_MS,
}: OpcoesDaVirada = {}): () => void {
  let ligada = true;

  const esperarAntes = async () => {
    if (!antes) return;
    let relogio: ReturnType<typeof setTimeout> | undefined;
    const limite = new Promise<void>((pronto) => {
      relogio = setTimeout(pronto, esperaMaximaMs);
    });
    // Se a sincronia falha, o estado dela já diz; a virada segue com o que há.
    await Promise.race([Promise.resolve().then(antes).catch(() => {}), limite]);
    clearTimeout(relogio);
  };

  const rodar = async () => {
    await esperarAntes();
    if (!ligada) return;
    try {
      await virarDia(hojeEmLisboa(agora()));
    } catch (erro) {
      console.error('Não consegui virar o dia', erro);
    }
  };

  void rodar();
  const pararDeVigiar = vigiarODia(rodar, agora);
  return () => {
    ligada = false;
    pararDeVigiar();
  };
}
