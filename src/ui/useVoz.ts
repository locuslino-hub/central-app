// A voz do chat (V02.1): o botão de microfone, o texto ao vivo e a gravação opcional de áudio. Vem da tela "Pode falar"
// da V02, que deixou de existir: a voz é só um botão dentro do chat.
//
// A escuta só começa dentro de um gesto do dono (toque no microfone, ou a tecla do atalho): o celular Android não
// reconhece sem toque (medido em 17/11). Sem voz (permissão negada, navegador sem suporte, sem rede) o campo de texto
// continua. "Gravar áudio" (desligada por padrão) grava junto com o reconhecimento; o texto é gravado ANTES de o áudio ir
// ao Drive (quem chama `enviar` cuida disso).
import { useEffect, useRef, useState } from 'preact/hooks';
import type { AudioGravado } from '../chat/conversa';
import { iniciarGravacao, type Gravacao } from '../voz/gravador';
import { iniciarEscuta, type ErroDeEscuta, type Escuta } from '../voz/reconhecimento';

const MENSAGEM_DA_ESCUTA: Record<ErroDeEscuta, string> = {
  permissao_negada: 'O microfone não foi liberado. Escreva o texto no campo.',
  sem_suporte: 'Este navegador não reconhece fala. Escreva o texto no campo.',
  sem_rede: 'Sem internet: o reconhecimento de voz precisa dela. Escreva o texto no campo.',
  desconhecido: 'A escuta parou. Toque no microfone para tentar de novo, ou escreva o texto no campo.',
};
/** O app abriu já pedindo para ouvir (atalho do ícone), sem toque: o navegador pode recusar; o toque no microfone resolve. */
const MENSAGEM_DO_ATALHO = 'O microfone não começou sozinho. Toque no microfone para falar, ou escreva o texto no campo.';

const juntar = (...partes: string[]) =>
  partes
    .map((p) => p.trim())
    .filter(Boolean)
    .join(' ');

export type Voz = {
  escutando: boolean;
  gravando: boolean;
  gravarAudio: boolean;
  setGravarAudio: (ligado: boolean) => void;
  /** A frase curta de estado que a região viva diz ("Ouvindo…", "Parei. Texto no campo."). Nunca o texto parcial. */
  anuncio: string;
  aviso: string | null;
  avisoDoAudio: string | null;
  /** Limpa os avisos (ao enviar de novo). */
  limparAvisos: () => void;
  /**
   * O toque no microfone: é aqui, e só aqui (ou na tecla do atalho), que a escuta começa. O toque alterna (liga e desliga);
   * o atalho (`'atalho'`) só liga: com a escuta já ligada, não faz nada.
   */
  tocar: (origem?: 'toque' | 'atalho') => void;
  /** Está ouvindo, ou ainda fechando a escuta? Então Enviar precisa esperar o texto final (`parar`). */
  ocupada: () => boolean;
  /** Para de ouvir e devolve o texto final (o do campo, mais o que foi falado). */
  parar: () => Promise<string>;
  /** O áudio já fechado (a escuta parou) e ainda sem destino; entrega e esquece. */
  pegarAudio: () => AudioGravado | null;
  /** Solta o microfone e esquece o áudio. */
  soltar: () => void;
  /** O campo foi editado à mão (ou esvaziado): o áudio retido já não diz o que o campo diz, e sai. */
  aoEditarOCampo: () => void;
};

/**
 * `texto` e `mudarTexto` são o campo do chat: o que se fala vem depois do que já estava escrito quando a escuta começou.
 */
export function useVoz(texto: string, mudarTexto: (texto: string) => void): Voz {
  const [escutando, setEscutando] = useState(false);
  const [gravarAudio, setGravarAudio] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [anuncio, setAnuncio] = useState('');
  const [aviso, setAviso] = useState<string | null>(null);
  const [avisoDoAudio, setAvisoDoAudio] = useState<string | null>(null);

  const escuta = useRef<Escuta | null>(null);
  /** O texto que já estava no campo quando a escuta começou. */
  const antes = useRef('');
  const gravacao = useRef<Promise<Gravacao | null> | null>(null);
  /** O áudio já fechado (a escuta parou) e ainda sem destino. */
  const audioGravado = useRef<AudioGravado | null>(null);
  /** A parada da escuta em curso: quem pede de novo espera a mesma. */
  const parada = useRef<Promise<string> | null>(null);
  /** O campo foi editado à mão depois de a escuta começar a parar: o texto final não passa por cima do que se digitou. */
  const digitou = useRef(false);
  /** Muda quando o áudio retido perde o sentido: o fechamento de uma gravação mais antiga não o guarda. */
  const epoca = useRef(0);
  /** O campo, sempre o mais novo (a parada é assíncrona). */
  const textoAtual = useRef(texto);
  textoAtual.current = texto;
  const mudar = useRef(mudarTexto);
  mudar.current = mudarTexto;

  // Saiu da tela com a escuta ou a gravação abertas: solta o microfone.
  useEffect(
    () => () => {
      escuta.current?.cancelar();
      void gravacao.current?.then((g) => g?.cancelar());
    },
    [],
  );

  /** Fecha a gravação em andamento e guarda o áudio. */
  async function fecharGravacao() {
    const pendente = gravacao.current;
    gravacao.current = null;
    setGravando(false);
    if (!pendente) return;
    const minha = epoca.current;
    const g = await pendente;
    if (!g) return;
    try {
      const audio = await g.parar();
      // O campo foi editado, o áudio desligado ou outra escuta começou enquanto o áudio fechava: este já não vale.
      if (minha === epoca.current) audioGravado.current = audio;
    } catch {
      setAvisoDoAudio('Não consegui fechar o áudio. Só o texto será guardado.');
    }
  }

  function soltar() {
    const pendente = gravacao.current;
    gravacao.current = null;
    setGravando(false);
    epoca.current++;
    audioGravado.current = null;
    void pendente?.then((g) => g?.cancelar());
  }

  /** Descarta o áudio retido (e o que ainda está fechando), sem mexer na gravação em andamento. */
  function descartarAudio() {
    epoca.current++;
    audioGravado.current = null;
  }

  /**
   * A parada em curso (uma só, quem pede de novo espera a mesma): o texto final, depois o fechamento do áudio. `anunciar`
   * é falso quando a escuta parou sozinha (o aviso do limite já diz o que houve).
   */
  function encerrar(atual: Escuta | null, anunciar: boolean): Promise<string> {
    digitou.current = false;
    const andamento = (async () => {
      let final = textoAtual.current;
      if (atual) {
        const falado = juntar(antes.current, await atual.parar());
        // O campo ganhou texto digitado enquanto a escuta fechava: o que se digitou vale mais que o ditado.
        if (digitou.current) final = textoAtual.current;
        else {
          final = falado;
          mudar.current(final);
        }
        if (anunciar) setAnuncio(final.trim() ? 'Parei. Texto no campo.' : 'Parei. Ainda não ouvi nada.');
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

  function parar(): Promise<string> {
    if (parada.current) return parada.current;
    const atual = escuta.current;
    escuta.current = null;
    setEscutando(false);
    return encerrar(atual, true);
  }

  function tocar(origem: 'toque' | 'atalho' = 'toque') {
    if (parada.current) return; // a escuta anterior ainda está fechando
    if (escuta.current) {
      if (origem === 'toque') void parar(); // o atalho só liga: com a escuta ligada, só mantém
      return;
    }
    setAviso(null);
    setAvisoDoAudio(null);
    // O áudio retido de uma escuta anterior (que não foi enviado) nunca gruda na frase desta.
    descartarAudio();
    antes.current = textoAtual.current;
    setEscutando(true);
    setAnuncio(gravarAudio ? 'Ouvindo… Gravando áudio…' : 'Ouvindo…');
    // Sem suporte, o erro chega antes de `iniciarEscuta` voltar.
    let falhouNaHora = false;
    const nova = iniciarEscuta(
      (falado) => mudar.current(juntar(antes.current, falado)),
      (erro) => {
        falhouNaHora = true;
        setAnuncio('');
        setAviso(origem === 'atalho' && erro === 'permissao_negada' ? MENSAGEM_DO_ATALHO : MENSAGEM_DA_ESCUTA[erro]);
        escuta.current = null;
        setEscutando(false);
        // Sem reconhecimento o áudio perde o sentido (a frase viria vazia): solta o microfone.
        soltar();
      },
      undefined,
      {
        aoAviso: () => {
          setAnuncio('');
          setAviso('Passou de 3 minutos de fala e parei de ouvir. Confira o texto e toque em Enviar.');
          // Enviar logo em seguida espera o texto final e o áudio fechar (`ocupada` fica verdadeira até lá).
          const atual = escuta.current;
          escuta.current = null;
          setEscutando(false);
          void encerrar(atual, false);
        },
      },
    );
    if (falhouNaHora) return;
    escuta.current = nova;
    // Uma gravação nova troca a anterior: o áudio é sempre o da última escuta.
    if (gravarAudio) {
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

  function ocupada(): boolean {
    return escuta.current !== null || parada.current !== null;
  }

  function pegarAudio(): AudioGravado | null {
    const audio = audioGravado.current;
    audioGravado.current = null;
    return audio;
  }

  /** O campo foi editado à mão: o texto digitado vale mais que o ditado, e o áudio retido sai. */
  function aoEditarOCampo() {
    digitou.current = true;
    descartarAudio();
  }

  function limparAvisos() {
    setAviso(null);
    setAvisoDoAudio(null);
  }

  /** "Gravar áudio" desligado: o áudio que ficou retido sai (ligado, só vale para a próxima escuta). */
  function mudarGravarAudio(ligado: boolean) {
    if (!ligado) descartarAudio();
    setGravarAudio(ligado);
  }

  return {
    escutando,
    gravando,
    gravarAudio,
    setGravarAudio: mudarGravarAudio,
    anuncio,
    aviso,
    avisoDoAudio,
    limparAvisos,
    tocar,
    ocupada,
    parar,
    pegarAudio,
    soltar,
    aoEditarOCampo,
  };
}
