// Reconhecimento de fala (V02, Tarefa 5), sobre o SpeechRecognition do navegador.
// O navegador encerra a escuta sozinho de vez em quando (pausa longa, limite do
// serviço): aqui ela reinicia no `onend` enquanto ninguém mandou parar, e o
// texto de antes do reinício é guardado, porque a lista de resultados volta ao
// zero a cada início. A escuta só começa depois de um toque do dono (o celular Android
// não reconhece sem ele, Tarefa 1): quem chama é a tela, no toque do botão.
//
// Defesas contra o Chrome do Android:
// - `start()` pode lançar no reinício: tenta de novo em 250 ms, até 3 vezes;
// - sessão que acaba em menos de 1 s repetidas vezes (microfone ocupado, por
//   exemplo) reinicia com espera crescente (500 ms, 1 s, 2 s) e, na 5ª seguida,
//   desiste com `desconhecido`, em vez de girar sem parar;
// - resultados cumulativos ou repetidos no reinício não duplicam o texto;
// - no máximo 180 s de escuta (`aoAviso('limite')`); o texto fica em `parar()`.

export type ErroDeEscuta = 'sem_suporte' | 'permissao_negada' | 'sem_rede' | 'desconhecido';

export type Escuta = {
  /**
   * Encerra e devolve o texto todo (finais mais o parcial que sobrou). Chamadas
   * repetidas devolvem a mesma promessa. Depois do aviso `'limite'` a escuta já
   * parou sozinha: chame `parar()` para pegar o texto.
   */
  parar(): Promise<string>;
  /** Encerra e descarta: depois disso nada mais é avisado. */
  cancelar(): void;
};

export type OpcoesDeEscuta = {
  /** `'limite'`: passaram 180 s e a escuta foi encerrada (o texto continua em `parar()`). */
  aoAviso?: (aviso: 'limite') => void;
};

type Resultado = { isFinal: boolean; 0: { transcript: string } };
type EventoDeResultado = { results: ArrayLike<Resultado> };
type EventoDeErro = { error: string };

/** O que usamos do SpeechRecognition; o dublê dos testes implementa só isto. */
export interface Reconhecedor {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: EventoDeResultado) => void) | null;
  onerror: ((e: EventoDeErro) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
export type ConstrutorDeReconhecedor = new () => Reconhecedor;

/** Quanto esperar o `onend` depois de `stop()` antes de devolver o que já se tem. */
const ESPERA_DO_FIM_MS = 2000;
export const LIMITE_DA_ESCUTA_MS = 180_000;
const SESSAO_RAPIDA_MS = 1000;
const ESPERAS_APOS_FIM_RAPIDO_MS = [500, 1000, 2000];
const FINS_RAPIDOS_PARA_DESISTIR = 5;
const ESPERA_ENTRE_TENTATIVAS_MS = 250;
const TENTATIVAS_DE_REINICIO = 3;
/** Menos palavras repetidas que isto podem ser fala de verdade ("não não"). */
const PALAVRAS_MINIMAS_DA_SOBREPOSICAO = 2;

function construtorDoNavegador(): ConstrutorDeReconhecedor | undefined {
  const g = globalThis as { SpeechRecognition?: ConstrutorDeReconhecedor; webkitSpeechRecognition?: ConstrutorDeReconhecedor };
  return g.SpeechRecognition ?? g.webkitSpeechRecognition;
}

function paraErro(codigo: string): ErroDeEscuta {
  if (codigo === 'not-allowed' || codigo === 'service-not-allowed') return 'permissao_negada';
  if (codigo === 'network') return 'sem_rede';
  return 'desconhecido';
}

const juntar = (...partes: string[]) =>
  partes
    .map((p) => p.trim())
    .filter(Boolean)
    .join(' ');

/** Para comparar: minúsculas, sem pontuação, espaços únicos. */
const normalizar = (texto: string) =>
  texto
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Resultados cumulativos ("marcar", "marcar reunião", ...): o trecho que é
 * começo do seguinte (palavra inteira) sai, fica o mais longo.
 */
function semTrechosCumulativos(trechos: string[]): string[] {
  const normais = trechos.map(normalizar);
  return trechos.filter((_, i) => {
    const proximo = normais[i + 1];
    if (proximo === undefined) return true;
    return !(proximo === normais[i] || proximo.startsWith(`${normais[i]} `));
  });
}

/** Tira do começo de `sessao` as palavras que repetem o fim de `anterior`. */
function semSobreposicao(anterior: string, sessao: string): string {
  const palavrasAntes = normalizar(anterior).split(' ').filter(Boolean);
  const palavras = sessao.split(/\s+/).filter(Boolean);
  const normais = palavras.map(normalizar);
  const maximo = Math.min(palavrasAntes.length, palavras.length);
  for (let k = maximo; k >= PALAVRAS_MINIMAS_DA_SOBREPOSICAO; k--) {
    const fimDeAntes = palavrasAntes.slice(-k).join(' ');
    if (fimDeAntes === normais.slice(0, k).join(' ')) return palavras.slice(k).join(' ');
  }
  return sessao;
}

export function iniciarEscuta(
  aoTexto: (texto: string, parcial: boolean) => void,
  aoErro: (erro: ErroDeEscuta) => void,
  Construtor: ConstrutorDeReconhecedor | undefined = construtorDoNavegador(),
  opcoes: OpcoesDeEscuta = {},
): Escuta {
  if (!Construtor) {
    aoErro('sem_suporte');
    return { parar: async () => '', cancelar: () => {} };
  }

  const rec = new Construtor();
  rec.lang = 'pt-BR';
  rec.continuous = true;
  rec.interimResults = true;

  /** Texto de antes do último reinício. */
  let anterior = '';
  /** Texto da sessão atual do navegador e se o último trecho ainda é parcial. */
  let sessao = '';
  let parcial = false;
  let viva = false; // entre um start() que deu certo e o onend
  let inicioDaSessao = 0;
  let fimsRapidos = 0;
  let encerrada = false; // parar() ou cancelar() chamados
  let fatal = false; // erro que não adianta reiniciar
  let avisarFim: (() => void) | null = null;
  let promessaDeParar: Promise<string> | null = null;
  let esperaDoReinicio: ReturnType<typeof setTimeout> | null = null;
  let limite: ReturnType<typeof setTimeout> | null = null;

  const texto = () => juntar(anterior, semSobreposicao(anterior, sessao));

  const desistir = () => {
    fatal = true;
    aoErro('desconhecido');
  };

  const cancelarEsperas = () => {
    if (esperaDoReinicio) clearTimeout(esperaDoReinicio);
    esperaDoReinicio = null;
    if (limite) clearTimeout(limite);
    limite = null;
  };

  rec.onresult = (e) => {
    if (encerrada && !avisarFim) return; // cancelado
    const trechos = semTrechosCumulativos(Array.from(e.results).map((t) => t[0].transcript));
    const lista = Array.from(e.results);
    sessao = juntar(...trechos);
    parcial = lista.length > 0 && !lista[lista.length - 1]!.isFinal;
    aoTexto(texto(), parcial);
  };

  rec.onerror = (e) => {
    // Silêncio e interrupção são rotina: o `onend` reinicia.
    if (e.error === 'no-speech' || e.error === 'aborted') return;
    fatal = true;
    aoErro(paraErro(e.error));
  };

  /** Tenta começar; `false` se o navegador recusou (InvalidStateError e afins). */
  const comecar = (): boolean => {
    try {
      rec.start();
    } catch {
      return false;
    }
    viva = true;
    inicioDaSessao = Date.now();
    return true;
  };

  const reiniciar = (tentativa: number) => {
    esperaDoReinicio = null;
    if (encerrada || fatal) return;
    if (comecar()) return;
    if (tentativa >= TENTATIVAS_DE_REINICIO) return desistir();
    esperaDoReinicio = setTimeout(() => reiniciar(tentativa + 1), ESPERA_ENTRE_TENTATIVAS_MS);
  };

  rec.onend = () => {
    if (!viva) return; // fim repetido, sem nenhuma sessão rodando
    viva = false;
    if (avisarFim) return avisarFim();
    if (encerrada || fatal) return;
    anterior = texto();
    sessao = '';
    parcial = false;
    if (Date.now() - inicioDaSessao >= SESSAO_RAPIDA_MS) {
      fimsRapidos = 0;
      return reiniciar(0);
    }
    fimsRapidos++;
    if (fimsRapidos >= FINS_RAPIDOS_PARA_DESISTIR) return desistir();
    const espera = ESPERAS_APOS_FIM_RAPIDO_MS[Math.min(fimsRapidos, ESPERAS_APOS_FIM_RAPIDO_MS.length) - 1]!;
    esperaDoReinicio = setTimeout(() => reiniciar(0), espera);
  };

  if (!comecar()) {
    desistir();
  } else {
    limite = setTimeout(() => {
      limite = null;
      void parar().then((final) => aoTexto(final, false));
      opcoes.aoAviso?.('limite');
    }, LIMITE_DA_ESCUTA_MS);
  }

  function parar(): Promise<string> {
    if (promessaDeParar) return promessaDeParar;
    encerrada = true;
    cancelarEsperas();
    if (!viva) {
      promessaDeParar = Promise.resolve(texto()); // já terminou: nada a esperar
      return promessaDeParar;
    }
    promessaDeParar = new Promise<string>((pronto) => {
      const terminar = () => {
        clearTimeout(temporizador);
        avisarFim = null;
        pronto(texto());
      };
      const temporizador = setTimeout(() => {
        try {
          rec.abort();
        } catch {
          // já parado
        }
        terminar();
      }, ESPERA_DO_FIM_MS);
      avisarFim = terminar;
      try {
        rec.stop();
      } catch {
        terminar();
      }
    });
    return promessaDeParar;
  }

  return {
    parar,
    cancelar() {
      encerrada = true;
      avisarFim = null;
      cancelarEsperas();
      try {
        rec.abort();
      } catch {
        // já parado
      }
    },
  };
}
