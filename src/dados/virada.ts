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
import { lerDiferencaDeRelogio, lerRegistros, listar, salvar } from './loja';
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
   * outro aparelho mudou nesse tempo. O que ele devolve é o estado da
   * sincronia: só `'atualizado'` conta como dado em dia.
   */
  antes?: () => Promise<unknown>;
  /**
   * O aparelho tem conexão com o script? Se tem e o `antes` não terminou
   * `'atualizado'` (sem internet, erro, espera esgotada), a virada não grava:
   * as listas já mostram o dia certo, e a gravação espera a próxima tentativa.
   * Sem conexão (uso só neste aparelho) vira com o que há.
   */
  conectado?: () => Promise<boolean>;
  agora?: () => Date;
  esperaMaximaMs?: number;
  /** Intervalo da nova tentativa quando a virada ficou pendente. */
  tentarDeNovoEmMs?: number;
};

const ESPERA_MAXIMA_PADRAO_MS = 15_000;
const TENTAR_DE_NOVO_PADRAO_MS = 5 * 60_000;
/** Relógio do aparelho e do servidor podem diferir tanto assim logo depois de sincronizar. */
export const DIFERENCA_MAXIMA_DE_RELOGIO_MS = 5 * 60_000;

type Espera = { terminou: true; resultado: unknown } | { terminou: false };

/**
 * Vira o dia agora e sempre que o dia de Lisboa mudar (temporizador da
 * meia-noite, reagendado a cada dia, e retorno ao app). Devolve a função que desliga.
 *
 * Virada que não pôde gravar (sincronia não terminou, relógio fora do do
 * servidor, erro de gravação) fica pendente: tenta de novo a cada 5 minutos e
 * ao voltar ao app, até gravar.
 */
export function iniciarVirada({
  antes,
  conectado,
  agora = () => new Date(),
  esperaMaximaMs = ESPERA_MAXIMA_PADRAO_MS,
  tentarDeNovoEmMs = TENTAR_DE_NOVO_PADRAO_MS,
}: OpcoesDaVirada = {}): () => void {
  let ligada = true;
  let pendente = false;
  let novaTentativa: ReturnType<typeof setTimeout> | undefined;

  const esperarAntes = async (): Promise<Espera> => {
    if (!antes) return { terminou: true, resultado: undefined };
    let relogio: ReturnType<typeof setTimeout> | undefined;
    const limite = new Promise<Espera>((pronto) => {
      relogio = setTimeout(() => pronto({ terminou: false }), esperaMaximaMs);
    });
    // Se a sincronia falha, o estado dela já diz; aqui só importa que não ficou em dia.
    const sincronia = Promise.resolve()
      .then(antes)
      .then<Espera, Espera>(
        (resultado) => ({ terminou: true, resultado }),
        () => ({ terminou: false }),
      );
    const espera = await Promise.race([sincronia, limite]);
    clearTimeout(relogio);
    return espera;
  };

  /** Dado em dia: sem conexão, qualquer um serve; conectado, só logo depois de uma sincronia que terminou. */
  const emDia = async (espera: Espera): Promise<boolean> => {
    if (!antes || !(await conectado?.())) return true;
    if (!espera.terminou || espera.resultado !== 'atualizado') return false;
    // Recém-sincronizado: o relógio do servidor (medido no puxar) e o daqui têm de concordar.
    // Sem a medida (script antigo), uma sincronia atualizada basta.
    const diferenca = await lerDiferencaDeRelogio();
    return diferenca === null || Math.abs(diferenca) <= DIFERENCA_MAXIMA_DE_RELOGIO_MS;
  };

  const adiar = () => {
    pendente = true;
    clearTimeout(novaTentativa);
    if (ligada) novaTentativa = setTimeout(() => void rodar(), tentarDeNovoEmMs);
  };

  const rodar = async () => {
    clearTimeout(novaTentativa);
    const espera = await esperarAntes();
    if (!ligada) return;
    try {
      if (!(await emDia(espera))) return adiar();
      await virarDia(hojeEmLisboa(agora()));
      pendente = false;
    } catch (erro) {
      console.error('Não consegui virar o dia', erro);
      adiar();
    }
  };

  const aoVoltar = () => {
    if (pendente && document.visibilityState !== 'hidden') void rodar();
  };

  void rodar();
  const pararDeVigiar = vigiarODia(rodar, agora);
  document.addEventListener('visibilitychange', aoVoltar);
  return () => {
    ligada = false;
    clearTimeout(novaTentativa);
    pararDeVigiar();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', aoVoltar);
  };
}
