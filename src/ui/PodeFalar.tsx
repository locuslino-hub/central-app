// "Pode falar" (V02, Tarefa 6): a tela de captura por voz ou texto. A Central decide
// para onde a frase vai (`executarFrase`), grava na hora e mostra o cartão com
// Desfazer; nunca grava em silêncio. A escuta só começa dentro do toque no
// microfone (medido num celular Android em 17/11: não reconhece sem toque). Sem voz
// (permissão negada, navegador sem suporte, sem rede) o campo de texto continua.
//
// "Gravar áudio" (desligada por padrão) grava junto com o reconhecimento (no
// celular Android os dois funcionam ao mesmo tempo). O texto da ideia é gravado ANTES
// de o áudio ir ao Drive: um áudio que falha nunca leva o texto junto. Só uma
// ideia guarda áudio; se a frase virar tarefa ou compromisso, o cartão avisa e o
// áudio fica à espera: "Guardar como ideia" troca o item por uma ideia com a mesma
// frase e leva o áudio junto. Áudio que não foi para o Drive fica anotado para a
// tela Ideias mostrar "Áudio não enviado".
import { useEffect, useRef, useState } from 'preact/hooks';
import { executarFrase, type ResultadoDaFrase } from '../chat/executar';
import { CATEGORIA_NO_MAXIMO } from '../dados/financeiro';
import { IDEIA_NO_MAXIMO, TEXTO_INVALIDO } from '../dados/ideias';
import { listar } from '../dados/loja';
import { limparProblemaDeAudio, marcarProblemaDeAudio, removerAudio } from '../voz/audios-pendentes';
import { apagarAudioDoDrive } from '../voz/apagar-audio';
import { enviarAudio, iniciarGravacao, type Gravacao } from '../voz/gravador';
import { iniciarEscuta, type Escuta, type ErroDeEscuta } from '../voz/reconhecimento';
import { Icone } from './icones';
import { TEXTO_DA_TROCA_QUE_FALHOU } from './pastas-textos';
import './pode-falar.css';

// ---- Abrir e sair ----

/** Aviso do cartão quando o Drive não confirmou a exclusão do áudio de uma ideia desfeita. */
const TEXTO_AUDIO_NO_DRIVE = 'O áudio continua no Drive.';

let origem = '#/';

/** Relê a ideia dona do áudio: apagada (lápide) ou inexistente. Se a leitura falhar, não presume nada. */
async function ideiaApagadaOuSumida(audioId: string): Promise<boolean> {
  try {
    const dona = (await listar('ideias', { comApagados: true })).find((i) => i.audioId === audioId);
    return !dona || dona.apagado === true;
  } catch {
    return false;
  }
}

/** Vai para a tela, lembrando de onde veio: Cancelar e Fechar voltam para lá. */
export function abrirPodeFalar() {
  if (location.hash !== '#/falar') origem = location.hash || '#/';
  location.hash = '#/falar';
}

/** A pasta onde o dono estava quando abriu o Pode falar (`#/sala/:id/pasta/:pastaId`): a fala vai direto para ela. */
function pastaDeOnde(): string | undefined {
  const achada = /^#\/sala\/[^/?]+\/pasta\/([^/?]+)/.exec(origem);
  if (!achada) return undefined;
  try {
    return decodeURIComponent(achada[1]!);
  } catch {
    return undefined;
  }
}

function sair() {
  location.hash = origem === '#/falar' ? '#/' : origem;
}

// ---- Textos ----

const MENSAGEM_DA_ESCUTA: Record<ErroDeEscuta, string> = {
  permissao_negada: 'O microfone não foi liberado. Escreva o texto abaixo.',
  sem_suporte: 'Este navegador não reconhece fala. Escreva o texto abaixo.',
  sem_rede: 'Sem internet: o reconhecimento de voz precisa dela. Escreva o texto abaixo.',
  desconhecido: 'A escuta parou. Toque no microfone para tentar de novo, ou escreva o texto abaixo.',
};

const juntar = (...partes: string[]) =>
  partes
    .map((p) => p.trim())
    .filter(Boolean)
    .join(' ');

type Audio = { blob: Blob; segundos: number };

export function PodeFalar() {
  const [texto, setTexto] = useState('');
  const [escutando, setEscutando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [avisoDoAudio, setAvisoDoAudio] = useState<string | null>(null);
  const [gravarAudio, setGravarAudio] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [resultado, setResultado] = useState<ResultadoDaFrase | null>(null);
  const [desfeito, setDesfeito] = useState(false);
  /** O painel "Trocar categoria" do cartão do gasto está aberto, e o que se digitou nele. */
  const [trocando, setTrocando] = useState(false);
  const [outraCategoria, setOutraCategoria] = useState('');
  /** Sobe a cada ação no cartão: o foco volta para ele mesmo que o cartão seja o mesmo. */
  const [foco, setFoco] = useState(0);
  /** A frase curta de estado que a região viva diz ("Ouvindo…", "Parei. Texto: …"). Nunca o texto parcial, que muda a cada palavra. */
  const [anuncio, setAnuncio] = useState('');
  /** O erro do campo de texto (vazio ou longo demais): o campo ganha `aria-invalid` e o foco. */
  const [erroDoTexto, setErroDoTexto] = useState<string | null>(null);
  /** O erro do campo "Outra categoria" do cartão do gasto. */
  const [erroDaCategoria, setErroDaCategoria] = useState<string | null>(null);
  /** Sobe quando o foco precisa voltar ao campo de texto (o botão que levou ao cartão sumiu com ele). */
  const [focoNoCampo, setFocoNoCampo] = useState(0);

  const escuta = useRef<Escuta | null>(null);
  /** O texto que já estava no campo quando a escuta começou: o que se fala vem depois dele. */
  const antes = useRef('');
  const gravacao = useRef<Promise<Gravacao | null> | null>(null);
  /** O áudio já fechado (a escuta parou) e ainda sem destino. */
  const audioGravado = useRef<Audio | null>(null);
  /** A frase e o áudio do cartão mostrado: Corrigir os devolve ao campo. */
  const fraseDoCartao = useRef('');
  const audioDoCartao = useRef<string | null>(null);
  /** O áudio gravado cuja frase não virou ideia: espera o "Guardar como ideia" (ou se perde ao sair do cartão). */
  const audioSemIdeia = useRef<Audio | null>(null);
  /** Uma ação do cartão por vez (Desfazer, Trocar categoria, Guardar como ideia, Pôr mesmo assim). */
  const agindoNoCartao = useRef(false);
  const campoOutraCategoria = useRef<HTMLInputElement>(null);
  const campoTexto = useRef<HTMLTextAreaElement>(null);
  const cartao = useRef<HTMLElement>(null);
  /** Pronto (ou Enter) já em andamento: um segundo toque não grava de novo. */
  const concluindo = useRef(false);
  /** A parada da escuta em curso: quem pede de novo (o Pronto) espera a mesma. */
  const parada = useRef<Promise<string> | null>(null);
  /** Ids de áudio cujo Desfazer já foi feito: se o envio voltar tarde, nada fica nem aparece. */
  const cancelados = useRef(new Set<string>());

  // Saiu da tela com a escuta ou a gravação abertas: solta o microfone.
  useEffect(
    () => () => {
      escuta.current?.cancelar();
      void gravacao.current?.then((g) => g?.cancelar());
    },
    [],
  );

  /** Fecha a gravação em andamento e guarda o áudio para o Pronto. */
  async function fecharGravacao() {
    const pendente = gravacao.current;
    gravacao.current = null;
    setGravando(false);
    if (!pendente) return;
    const g = await pendente;
    if (!g) return;
    try {
      audioGravado.current = await g.parar();
    } catch {
      setAvisoDoAudio('Não consegui fechar o áudio. Só o texto será guardado.');
    }
  }

  function descartarGravacao() {
    const pendente = gravacao.current;
    gravacao.current = null;
    setGravando(false);
    audioGravado.current = null;
    void pendente?.then((g) => g?.cancelar());
  }

  /** Para de ouvir e devolve o texto final (o do campo, mais o que foi falado). */
  function pararEscuta(): Promise<string> {
    if (parada.current) return parada.current;
    const atual = escuta.current;
    escuta.current = null;
    setEscutando(false);
    const andamento = (async () => {
      let final = texto;
      if (atual) {
        final = juntar(antes.current, await atual.parar());
        setTexto(final);
        setAnuncio(final.trim() ? `Parei. Texto: ${final}` : 'Parei. Ainda não ouvi nada.');
      }
      await fecharGravacao();
      return final;
    })();
    parada.current = andamento;
    const liberar = () => {
      if (parada.current === andamento) parada.current = null;
    };
    andamento.then(liberar, liberar);
    return andamento;
  }

  /** O toque no microfone: é aqui, e só aqui, que a escuta começa. */
  function tocarNoMicrofone() {
    if (parada.current) return; // a escuta anterior ainda está fechando
    if (escutando) {
      void pararEscuta();
      return;
    }
    setAviso(null);
    setErroDoTexto(null);
    setAvisoDoAudio(null);
    antes.current = texto;
    setEscutando(true);
    setAnuncio(gravarAudio ? 'Ouvindo… Gravando áudio…' : 'Ouvindo…');
    // Sem suporte, o erro chega antes de `iniciarEscuta` voltar.
    let falhouNaHora = false;
    const nova = iniciarEscuta(
      (falado) => setTexto(juntar(antes.current, falado)),
      (erro) => {
        falhouNaHora = true;
        setAnuncio('');
        setAviso(MENSAGEM_DA_ESCUTA[erro]);
        escuta.current = null;
        setEscutando(false);
        // Sem reconhecimento o áudio perde o sentido (a frase viria vazia): solta o microfone.
        descartarGravacao();
      },
      undefined,
      {
        aoAviso: () => {
          setAnuncio('');
          setAviso('Passou de 3 minutos de fala e parei de ouvir. Confira o texto e toque em Pronto.');
          escuta.current = null;
          setEscutando(false);
          void fecharGravacao();
        },
      },
    );
    if (falhouNaHora) return;
    escuta.current = nova;
    // Uma gravação nova troca a anterior: o áudio é sempre o da última escuta.
    if (gravarAudio) {
      audioGravado.current = null;
      gravacao.current = iniciarGravacao((tipo) => {
        if (tipo === 'quase_no_limite') setAvisoDoAudio('O áudio está perto do limite de 3 minutos.');
      }).catch((erro: unknown) => {
        const codigo = (erro as { codigo?: string } | null)?.codigo;
        setAvisoDoAudio(
          codigo === 'permissao_negada'
            ? 'Sem permissão para gravar o áudio. Só o texto será guardado.'
            : 'Não consegui gravar o áudio. Só o texto será guardado.',
        );
        setGravando(false);
        return null;
      });
      setGravando(true);
    }
  }

  /** Pede ao Drive que apague o áudio de uma ideia desfeita; se não der, o cartão avisa. */
  function apagarDoDrive(id: string) {
    void apagarAudioDoDrive(id).then((apagou) => {
      if (!apagou) setAviso(TEXTO_AUDIO_NO_DRIVE);
    });
  }

  async function enviarOAudio(id: string, audio: Audio) {
    // O aviso só vale enquanto este cartão é o da tela e a ideia não foi desfeita.
    const vigente = () => audioDoCartao.current === id && !cancelados.current.has(id);
    setAvisoDoAudio('Enviando o áudio…');
    try {
      const envio = await enviarAudio(id, audio.blob);
      if ('erro' in envio && !cancelados.current.has(id)) await marcarProblemaDeAudio(id, 'sem_espaco').catch(() => {});
      if (cancelados.current.has(id)) {
        // Desfez a ideia enquanto o áudio ia: o que ficou na fila sai; o que já está no Drive fica como pendência.
        if ('fila' in envio) await removerAudio(id).catch(() => {});
        // Já está no Drive: a ideia foi desfeita, então o arquivo vai para a lixeira do Drive (privacidade).
        else if ('driveId' in envio) apagarDoDrive(id);
        return;
      }
      // A ideia pode ter sido apagada (em outra tela ou aparelho) enquanto o áudio ia: o áudio não fica no Drive.
      if ('driveId' in envio && (await ideiaApagadaOuSumida(id))) {
        apagarDoDrive(id);
        return;
      }
      if (!vigente()) return;
      if ('driveId' in envio) setAvisoDoAudio('Áudio guardado no Drive.');
      else if ('fila' in envio) setAvisoDoAudio('O áudio vai para o Drive quando a internet voltar.');
      else setAvisoDoAudio('O áudio não coube neste aparelho; só o texto ficou guardado.');
    } catch (erro) {
      // Recusado de vez pelo Drive ou falha do envio: a ideia mostra o aviso mesmo depois de este cartão sair.
      if (!cancelados.current.has(id)) {
        const recusado = (erro as { name?: string } | null)?.name === 'ErroAudioRecusado';
        await marcarProblemaDeAudio(id, recusado ? 'recusado' : 'falhou').catch(() => {});
      }
      if (vigente()) setAvisoDoAudio('O texto ficou guardado, mas o áudio não pôde ser enviado.');
    }
  }

  async function concluir() {
    if (concluindo.current) return;
    concluindo.current = true;
    setOcupado(true);
    try {
      setAviso(null);
      setErroDoTexto(null);
      const frase = (await pararEscuta()).trim();
      if (!frase) {
        descartarGravacao();
        setErroDoTexto('Ainda não ouvi nada. Fale ou escreva o que quer guardar.');
        return;
      }
      setAnuncio('Entendendo a frase…');
      const audio = audioGravado.current;
      const audioId = audio ? crypto.randomUUID() : null;
      try {
        // 1) O texto (ideia, tarefa ou compromisso) é gravado primeiro, sempre.
        const pastaAtual = pastaDeOnde();
        const feito = await executarFrase(frase, {
          ...(pastaAtual ? { pastaAtual } : {}),
          ...(audio && audioId ? { audio: { id: audioId, segundos: audio.segundos } } : {}),
        });
        fraseDoCartao.current = frase;
        audioDoCartao.current = feito.audioId ?? null;
        audioSemIdeia.current = audio && !feito.audioId ? audio : null;
        audioGravado.current = null;
        setResultado(feito);
        setDesfeito(false);
        setAvisoDoAudio(audio && !feito.audioId ? 'Só ideias guardam áudio. Toque em Guardar como ideia para guardar este áudio.' : null);
        // 2) Só então o áudio vai ao Drive.
        if (audio && feito.audioId) void enviarOAudio(feito.audioId, audio);
      } catch (erro) {
        if (erro instanceof Error && erro.message === TEXTO_INVALIDO) {
          // Texto que não vale: tentar de novo não adianta, o dono precisa mudá-lo.
          if (frase.length > IDEIA_NO_MAXIMO) setErroDoTexto(`Texto longo demais (máximo ${IDEIA_NO_MAXIMO} caracteres). Divida em partes.`);
          else setErroDoTexto('Ainda não ouvi nada. Fale ou escreva o que quer guardar.');
        } else {
          console.error('Não consegui guardar a frase do Pode falar', erro);
          setAviso('Não consegui guardar. O texto continua aqui; toque em Pronto para tentar de novo.');
        }
      }
    } finally {
      setOcupado(false);
      concluindo.current = false;
    }
  }

  /** Desfaz o que foi gravado (e o áudio que esperava rede). Devolve se deu certo. */
  async function desfazer(): Promise<boolean> {
    if (!resultado) return false;
    const idDoAudio = audioDoCartao.current;
    // Marca antes: um envio ainda em andamento vai voltar sabendo que foi desfeito.
    if (idDoAudio) cancelados.current.add(idDoAudio);
    try {
      await resultado.desfazer();
      if (idDoAudio) {
        await removerAudio(idDoAudio).catch(() => {});
        await limparProblemaDeAudio(idDoAudio).catch(() => {});
        // Se o áudio já tinha ido ao Drive, ele sai de lá também (sem esperar: o Desfazer não trava).
        apagarDoDrive(idDoAudio);
      }
      return true;
    } catch (erro) {
      if (idDoAudio) cancelados.current.delete(idDoAudio);
      console.error('Não consegui desfazer', erro);
      setAviso('Não consegui desfazer agora. Tente de novo.');
      return false;
    }
  }

  async function aoDesfazer() {
    if (agindoNoCartao.current) return;
    agindoNoCartao.current = true;
    setOcupado(true);
    try {
      if (!(await desfazer())) return;
      setDesfeito(true);
      setAvisoDoAudio(null);
    } finally {
      setOcupado(false);
      agindoNoCartao.current = false;
    }
  }

  /** Troca a tarefa ou o compromisso por uma ideia com a mesma frase, levando o áudio, se houver. */
  async function aoGuardarComoIdeia() {
    if (!resultado?.guardarComoIdeia || agindoNoCartao.current) return;
    agindoNoCartao.current = true;
    setOcupado(true);
    try {
      setAviso(null);
      const audio = audioSemIdeia.current;
      const audioId = audio ? crypto.randomUUID() : null;
      const novo = await resultado.guardarComoIdeia(audio && audioId ? { id: audioId, segundos: audio.segundos } : undefined);
      audioSemIdeia.current = null;
      audioDoCartao.current = novo.audioId ?? null;
      setResultado(novo);
      setDesfeito(false);
      setAvisoDoAudio(null);
      if (audio && novo.audioId) void enviarOAudio(novo.audioId, audio);
    } catch (erro) {
      console.error('Não consegui guardar como ideia', erro);
      setAviso('Não consegui guardar como ideia. O item continua como estava; tente de novo.');
    } finally {
      setOcupado(false);
      agindoNoCartao.current = false;
    }
  }

  /** Itens de lista que já estavam na lista: grava os repetidos (o cartão novo desfaz tudo junto). */
  async function aoRepetir() {
    if (!resultado?.repetir || agindoNoCartao.current) return;
    agindoNoCartao.current = true;
    setOcupado(true);
    try {
      setAviso(null);
      setResultado(await resultado.repetir());
      setDesfeito(false);
    } catch (erro) {
      console.error('Não consegui repetir o item', erro);
      setAviso('Não consegui pôr de novo. Nada foi repetido; tente de novo.');
    } finally {
      setOcupado(false);
      agindoNoCartao.current = false;
    }
  }

  /** Troca a categoria do gasto gravado. Falha vira texto no cartão e nada muda. */
  async function aoTrocarCategoria(categoria: string) {
    const troca = resultado?.trocarCategoria;
    if (!troca || agindoNoCartao.current) return;
    if (categoria.trim() === '') {
      setErroDaCategoria(TEXTO_DA_TROCA_QUE_FALHOU.vazia); // a mensagem fica junto do campo, que ganha aria-invalid e o foco
      campoOutraCategoria.current?.focus();
      return;
    }
    setErroDaCategoria(null);
    agindoNoCartao.current = true;
    setOcupado(true);
    setAviso(null);
    try {
      const feito = await troca.trocar(categoria);
      if (feito.mudou) {
        setResultado(feito.resultado);
        setTrocando(false);
        setOutraCategoria('');
        setErroDaCategoria(null);
      } else {
        setAviso(feito.mensagem);
      }
    } catch (erro) {
      console.error('Não consegui trocar a categoria', erro);
      setAviso(TEXTO_DA_TROCA_QUE_FALHOU.erro);
    } finally {
      setOcupado(false);
      agindoNoCartao.current = false;
      setFoco((f) => f + 1);
    }
  }

  async function aoCorrigir() {
    if (resultado?.corrigir) resultado.corrigir();
    if (!(await desfazer())) return;
    audioDoCartao.current = null;
    // O cartão prometeu guardar o áudio como ideia: ele volta à espera do próximo Pronto, não se perde.
    audioGravado.current = audioSemIdeia.current;
    audioSemIdeia.current = null;
    setResultado(null);
    setAvisoDoAudio(null);
    setTexto(fraseDoCartao.current);
    setFocoNoCampo((n) => n + 1); // o botão Corrigir some com o cartão: o foco vai ao campo, com a frase de volta
  }

  function falarOutra() {
    audioDoCartao.current = null; // um envio ainda em andamento não escreve no cartão novo
    audioSemIdeia.current = null;
    setResultado(null);
    setDesfeito(false);
    setAvisoDoAudio(null);
    setAviso(null);
    setErroDoTexto(null);
    setAnuncio('');
    setTexto('');
    setFocoNoCampo((n) => n + 1); // o botão Falar outra some com o cartão: o foco vai ao campo
  }

  function cancelar() {
    escuta.current?.cancelar();
    escuta.current = null;
    setEscutando(false);
    descartarGravacao();
    sair();
  }

  const mostrandoCartao = resultado !== null;

  // Cartão novo (ou desfeito): o foco vai para ele, que é onde o leitor de tela e o teclado esperam a resposta.
  useEffect(() => {
    if (resultado) cartao.current?.focus();
  }, [resultado, desfeito, foco]);
  // O painel de trocar a categoria só existe no cartão do gasto: outro cartão (ou nenhum) o fecha.
  useEffect(() => {
    if (!resultado?.trocarCategoria || desfeito) setTrocando(false);
  }, [resultado, desfeito]);
  useEffect(() => {
    if (trocando) campoOutraCategoria.current?.focus();
    else setErroDaCategoria(null);
  }, [trocando]);
  useEffect(() => {
    if (focoNoCampo > 0) campoTexto.current?.focus();
  }, [focoNoCampo]);
  // Erro do campo de texto (vazio ou longo demais): o foco vai para o campo, que o leitor de tela lê com a mensagem.
  useEffect(() => {
    if (erroDoTexto) campoTexto.current?.focus();
  }, [erroDoTexto]);

  return (
    <section class="painel falar" data-escutando={escutando ? 'sim' : 'nao'}>
      <p class="falar-onde">A Central decide para onde vai.</p>

      {/* Região viva só com frases curtas de estado, sempre na tela. O texto parcial do reconhecimento fica de fora: ele muda a cada palavra. */}
      <p class="so-leitor" role="status" aria-atomic="true">
        {anuncio}
      </p>

      {!mostrandoCartao && (
        <>
          <div class="falar-mic">
            <button
              type="button"
              class="falar-botao-mic"
              aria-label="Falar"
              aria-pressed={escutando}
              onClick={tocarNoMicrofone}
            >
              <Icone nome="microfone" />
            </button>
            <p class="falar-legenda" aria-hidden="true">
              {escutando ? 'Ouvindo… toque para parar' : 'Toque para falar'}
            </p>
            <p class="falar-aviso-voz">O reconhecimento de voz do navegador envia o áudio ao Google. Para não enviar, escreva no campo.</p>
          </div>

          {/* O texto ao vivo e o "Entendendo…", só para os olhos (o leitor de tela ouve a região de estado acima). Vazia, só some da vista. */}
          <p class={escutando || ocupado ? 'falar-vivo' : 'falar-vivo so-leitor'} aria-hidden="true">
            {escutando ? texto || 'Estou ouvindo…' : ocupado ? 'Entendendo…' : ''}
          </p>

          <textarea
            ref={campoTexto}
            class="falar-texto"
            aria-label="Texto falado"
            aria-invalid={erroDoTexto ? 'true' : undefined}
            aria-describedby={erroDoTexto ? 'falar-erro-texto' : undefined}
            placeholder="Fale ou escreva…"
            rows={3}
            hidden={escutando}
            value={texto}
            onInput={(e) => {
              setTexto((e.currentTarget as HTMLTextAreaElement).value);
              setErroDoTexto(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void concluir();
              }
            }}
          />

          {erroDoTexto && (
            <p class="falar-aviso" id="falar-erro-texto" role="alert">
              {erroDoTexto}
            </p>
          )}
          {aviso && (
            <p class="falar-aviso" role="alert">
              {aviso}
            </p>
          )}

          <div class="falar-rodape">
            <label class="falar-troca">
              <input
                type="checkbox"
                role="switch"
                checked={gravarAudio}
                disabled={escutando}
                onChange={(e) => setGravarAudio((e.currentTarget as HTMLInputElement).checked)}
              />
              <span>Gravar áudio</span>
            </label>
            {gravando && <span class="falar-gravando">gravando</span>}
            <div class="falar-botoes">
              <button type="button" class="botao" disabled={ocupado} onClick={cancelar}>
                Cancelar
              </button>
              <button type="button" class="botao primario" disabled={ocupado} onClick={() => void concluir()}>
                Pronto
              </button>
            </div>
          </div>
          {avisoDoAudio && (
            <p class="falar-aviso-audio" role="status">
              {avisoDoAudio}
            </p>
          )}
        </>
      )}

      {/* O cartão fica fora de qualquer região viva (ela leria o cartão duas vezes, com os botões): o foco vai para ele, que o leitor de tela lê. */}
      <div class="falar-resultado">
        {mostrandoCartao && (
          <article
            class="falar-cartao"
            ref={cartao}
            tabIndex={-1}
            aria-labelledby="falar-cartao-titulo"
            aria-describedby={desfeito ? undefined : 'falar-cartao-detalhe'}
          >
            {desfeito ? (
              <p class="falar-cartao-titulo" id="falar-cartao-titulo">
                Desfeito. Nada ficou guardado.
              </p>
            ) : (
              <>
                <p class="falar-cartao-titulo" id="falar-cartao-titulo">
                  {resultado.titulo}
                </p>
                <p class="falar-cartao-detalhe" id="falar-cartao-detalhe">
                  {resultado.detalhe}
                </p>
                {/* Sempre aqui, vazio até haver o que dizer: o avanço do envio do áudio é anunciado. */}
                <p class="falar-cartao-detalhe falar-cartao-vivo" role="status">
                  {avisoDoAudio}
                </p>
              </>
            )}
            {aviso && (
              <p class="falar-cartao-detalhe" role="alert">
                {aviso}
              </p>
            )}
            <div class="falar-cartao-acoes">
              {!desfeito && resultado.ver && (
                <a class="botao-link falar-ver" href={resultado.ver}>
                  Ver
                </a>
              )}
              {!desfeito && (
                <>
                  {!resultado.semDesfazer && (
                    <button type="button" class="botao-pilula" disabled={ocupado} onClick={() => void aoDesfazer()}>
                      Desfazer
                    </button>
                  )}
                  <button type="button" class="botao-pilula" disabled={ocupado} onClick={() => void aoCorrigir()}>
                    Corrigir
                  </button>
                  {resultado.repetir && (
                    <button type="button" class="botao-pilula" disabled={ocupado} onClick={() => void aoRepetir()}>
                      Pôr mesmo assim
                    </button>
                  )}
                  {resultado.trocarCategoria && (
                    <button type="button" class="botao-pilula" aria-expanded={trocando} disabled={ocupado} onClick={() => setTrocando((t) => !t)}>
                      Trocar categoria
                    </button>
                  )}
                  {resultado.guardarComoIdeia && (
                    <button type="button" class="botao-pilula" disabled={ocupado} onClick={() => void aoGuardarComoIdeia()}>
                      Guardar como ideia
                    </button>
                  )}
                </>
              )}
              <button type="button" class="botao-pilula" disabled={ocupado} onClick={falarOutra}>
                Falar outra
              </button>
              <button type="button" class="botao-pilula" disabled={ocupado} onClick={sair}>
                Fechar
              </button>
            </div>
            {!desfeito && trocando && resultado.trocarCategoria && (
              <div class="falar-troca-categoria" role="group" aria-label="Trocar categoria">
                <p class="falar-cartao-detalhe">Escolha a categoria ou digite outra.</p>
                <div class="falar-categorias">
                  {resultado.trocarCategoria.opcoes.map((categoria) => (
                    <button
                      key={categoria}
                      type="button"
                      class="botao-pilula"
                      aria-pressed={categoria === resultado.trocarCategoria?.atual}
                      aria-disabled={categoria === resultado.trocarCategoria?.atual ? 'true' : undefined}
                      disabled={ocupado}
                      onClick={() => categoria !== resultado.trocarCategoria?.atual && void aoTrocarCategoria(categoria)}
                    >
                      {categoria === resultado.trocarCategoria?.atual && <span aria-hidden="true">✓ </span>}
                      {categoria}
                    </button>
                  ))}
                </div>
                <form
                  class="falar-outra-categoria"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void aoTrocarCategoria(outraCategoria);
                  }}
                >
                  <label for="falar-outra-categoria">Outra categoria</label>
                  <input
                    ref={campoOutraCategoria}
                    id="falar-outra-categoria"
                    class="campo"
                    type="text"
                    maxLength={CATEGORIA_NO_MAXIMO}
                    autoComplete="off"
                    value={outraCategoria}
                    aria-invalid={erroDaCategoria ? 'true' : undefined}
                    aria-describedby={erroDaCategoria ? 'falar-outra-categoria-erro' : undefined}
                    onInput={(e) => {
                      setOutraCategoria(e.currentTarget.value);
                      setErroDaCategoria(null);
                    }}
                  />
                  <button type="submit" class="botao-pilula" disabled={ocupado}>
                    Trocar
                  </button>
                  {erroDaCategoria && (
                    <p class="falar-erro-campo" id="falar-outra-categoria-erro" role="alert">
                      {erroDaCategoria}
                    </p>
                  )}
                </form>
              </div>
            )}
          </article>
        )}
      </div>
    </section>
  );
}
