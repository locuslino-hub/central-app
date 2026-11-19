// Ideias (V02, Tarefa 7): a caixa de entrada de tudo o que o dono falou ou escreveu
// e ainda não tem lugar. A Central sugere a sala (nome de sala, palavra guardada,
// aluna citada); um toque a confirma, "Outra sala" escolhe outra, "Virar tarefa"
// cria a tarefa de hoje (com Desfazer) e "Apagar" tira a ideia.
//
// Ideia com áudio mostra ▶ e a duração. O áudio se baixa do Drive só quando se toca
// (`buscarAudio`); o que ainda espera rede neste aparelho toca do blob local. Áudio
// que não foi enviado aparece como aviso na própria ideia.
import { useEffect, useRef, useState } from 'preact/hooks';
import { somarDias } from '../chat/datas';
import { apagarIdeia, atribuirSala, restaurarIdeia, sugerirSala, virarTarefaComDesfazer } from '../dados/ideias';
import { hojeEmLisboa } from '../dados/dia';
import { assinar } from '../dados/loja';
import type { Ideia, Sala, Tarefa } from '../dados/tipos';
import { ErroScript } from '../conexao/cliente';
import { assinarProblemas, lerAudioPendente, marcarProblemaDeAudio, problemasDosAudios, type MotivoDoProblema } from '../voz/audios-pendentes';
import { apagarAudioDoDrive } from '../voz/apagar-audio';
import { AudioIndisponivel, buscarAudio } from '../voz/ler-audio';
import { hrefDe } from '../rotas';
import { useIdeias, usePalavras, usePessoas, useSalas, useTarefas, useTela } from './hooks';
import { Icone } from './icones';
import { corDaSala } from './Menu';
import { abrirOChat } from './pedido-de-voz';
import './ideias.css';

// ---- Textos ----

const MOTIVO_DO_AUDIO: Record<MotivoDoProblema, string> = {
  recusado: 'O Drive recusou o arquivo.',
  sem_espaco: 'Não havia espaço neste aparelho para guardá-lo.',
  falhou: 'O envio falhou e o áudio segue guardado neste aparelho.',
};

/** `0:12`, `2:05`. */
export function duracaoDoAudio(segundos: number): string {
  const total = Math.max(0, Math.round(segundos));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

const HORA = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Lisbon' });

/** "hoje · 09:12", "ontem · 18:40", "03/11 · 07:55": de quando é a ideia (hora de Lisboa). */
export function quandoDaIdeia(ms: number, hoje: string = hojeEmLisboa()): string {
  const dia = hojeEmLisboa(new Date(ms));
  const hora = HORA.format(new Date(ms));
  if (dia === hoje) return `hoje · ${hora}`;
  if (dia === somarDias(hoje, -1)) return `ontem · ${hora}`;
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)} · ${hora}`;
}

/** Um pedaço da ideia para dar contexto ao nome dos botões repetidos ("Apagar a ideia: Rever o capítulo 2"). */
export function trechoDaIdeia(texto: string): string {
  const limpo = texto.replace(/\s+/g, ' ').trim();
  return limpo.length > 40 ? `${limpo.slice(0, 40).trimEnd()}…` : limpo;
}

// ---- Áudio ----

/** Só um áudio toca por vez: o que começa para o outro. */
let pararOutro: (() => void) | null = null;

type EstadoDoPlayer = 'parado' | 'baixando' | 'tocando';

function BotaoDeAudio({ audioId, segundos, ideia }: { audioId: string; segundos?: number; ideia: string }) {
  const [estado, setEstado] = useState<EstadoDoPlayer>('parado');
  const [erro, setErro] = useState<string | null>(null);
  const blob = useRef<Blob | null>(null);
  const url = useRef<string | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  const montado = useRef(true);
  /** Cada toque tem o seu número: uma resposta que volta depois de outro toque (ou de sair da tela) é ignorada. */
  const toque = useRef(0);

  /** Só refs e o `setEstado` (estável): é a MESMA função em toda renderização, então `pararOutro === parar` vale na saída. */
  const parar = useRef(() => {
    toque.current += 1;
    player.current?.pause();
    setEstado('parado');
  }).current;

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
      toque.current += 1;
      if (pararOutro === parar) pararOutro = null;
      player.current?.pause();
      player.current = null;
      if (url.current) URL.revokeObjectURL(url.current);
      url.current = null;
    };
  }, []);

  async function alternar() {
    if (estado === 'tocando' || estado === 'baixando') {
      parar();
      return;
    }
    setErro(null);
    const meu = ++toque.current;
    try {
      if (!blob.current) {
        setEstado('baixando');
        blob.current = await buscarAudio(audioId);
        if (!montado.current || toque.current !== meu) return;
      }
      if (!url.current) url.current = URL.createObjectURL(blob.current);
      if (!player.current) {
        const novo = new Audio(url.current);
        novo.addEventListener('ended', () => montado.current && setEstado('parado'));
        player.current = novo;
      }
      pararOutro?.();
      pararOutro = parar;
      player.current.currentTime = 0;
      await player.current.play();
      if (!montado.current || toque.current !== meu) return;
      setEstado('tocando');
    } catch (falha) {
      if (!montado.current || toque.current !== meu) return;
      setEstado('parado');
      setErro(
        falha instanceof AudioIndisponivel
          ? 'Não achei este áudio no Drive. Se foi gravado em outro aparelho, talvez ainda não tenha sido enviado.'
          : falha instanceof ErroScript && falha.erro === 'interno'
            ? 'Não consegui buscar o áudio agora. Tente de novo.'
            : 'Não consegui tocar o áudio. Confira a internet e tente de novo.',
      );
    }
  }

  const rotulo = estado === 'tocando' ? 'Parar o áudio' : estado === 'baixando' ? 'Baixando o áudio' : 'Tocar áudio';
  // O nome começa pelo que se vê (▶ e a duração) e diz de qual ideia é o áudio: há um botão destes em cada ideia.
  const nome = `${segundos === undefined ? rotulo : `${rotulo}, ${duracaoDoAudio(segundos)}`}, da ideia: ${trechoDaIdeia(ideia)}`;
  return (
    <span class="ideia-audio-bloco">
      <button type="button" class="ideia-audio" aria-label={nome} onClick={() => void alternar()}>
        <span class="ideia-audio-icone" aria-hidden="true">
          {estado === 'tocando' ? '❚❚' : estado === 'baixando' ? '…' : '▶'}
        </span>
        {segundos !== undefined && <span aria-hidden="true">{duracaoDoAudio(segundos)}</span>}
      </button>
      {erro && (
        <span class="ideia-aviso-audio" role="status">
          {erro}
        </span>
      )}
    </span>
  );
}

/**
 * Os áudios com problema (não enviados). `undefined` enquanto lê: a tela não mostra o ▶ antes de saber
 * se há aviso (nada de ▶ que some). Relê quando um problema é anotado ou limpo, quando muda alguma
 * ideia e quando a internet volta.
 */
function useProblemasDeAudio(): Map<string, MotivoDoProblema> | undefined {
  const [problemas, setProblemas] = useState<Map<string, MotivoDoProblema>>();
  useEffect(() => {
    let ativo = true;
    const ler = () =>
      problemasDosAudios()
        .then((mapa) => ativo && setProblemas(mapa))
        .catch((erro: unknown) => {
          console.error('Não consegui ler os avisos de áudio', erro);
          if (ativo) setProblemas((antes) => antes ?? new Map());
        });
    void ler();
    const paraIdeias = assinar((mudanca) => {
      if (mudanca.colecao === 'ideias') void ler();
    });
    const paraProblemas = assinarProblemas(() => void ler());
    window.addEventListener('online', ler);
    return () => {
      ativo = false;
      paraIdeias();
      paraProblemas();
      window.removeEventListener('online', ler);
    };
  }, []);
  return problemas;
}

// ---- A tela ----

type Resultado = {
  id: string;
  titulo: string;
  detalhe: string;
  ver?: string;
  desfazer?: () => Promise<void>;
  /** O que o cartão diz depois do Desfazer. */
  detalheDesfeito?: string;
  desfeito?: boolean;
};

export function Ideias() {
  const ideias = useIdeias();
  const tela = useTela();
  const salas = useSalas();
  const tarefas = useTarefas();
  const pessoas = usePessoas();
  const palavras = usePalavras();
  const problemas = useProblemasDeAudio();
  const [escolhendo, setEscolhendo] = useState<string | null>(null);
  const [ocupadas, setOcupadas] = useState<ReadonlySet<string>>(new Set());
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const emCurso = useRef(new Set<string>());
  const cartao = useRef<HTMLElement>(null);
  const titulo = useRef<HTMLHeadingElement>(null);

  // Cada resposta (levada, tarefa, apagada, desfeito) leva o foco ao cartão: o botão apertado some da lista.
  useEffect(() => {
    if (resultado) cartao.current?.focus();
  }, [resultado]);

  const novas = (ideias ?? []).filter((i) => i.estado === 'nova').sort((a, b) => b.atualizadoEm - a.atualizadoEm);
  const arrumadas = (ideias ?? []).filter((i) => i.estado !== 'nova').sort((a, b) => b.atualizadoEm - a.atualizadoEm);
  const tarefasVivas = new Set((tarefas ?? []).map((t) => t.id));
  const MOSTRAR_ARRUMADAS = 30;
  const salaDe = (id: string | null | undefined): Sala | undefined => (id ? salas.find((s) => s.id === id) : undefined);

  /** Uma ação por ideia de cada vez; erro vira aviso, nada some em silêncio. */
  async function agir(id: string, fazer: () => Promise<void>, falha: string) {
    if (emCurso.current.has(id)) return;
    emCurso.current.add(id);
    setOcupadas(new Set(emCurso.current));
    setErro(null);
    try {
      await fazer();
    } catch (causa) {
      console.error(falha, causa);
      setErro(falha);
    } finally {
      emCurso.current.delete(id);
      setOcupadas(new Set(emCurso.current));
    }
  }

  const levarParaSala = (ideia: Ideia, sala: Sala) =>
    agir(
      ideia.id,
      async () => {
        await atribuirSala(ideia.id, sala.id);
        setEscolhendo(null);
        setResultado({
          id: ideia.id,
          titulo: `Levada para ${sala.nome}`,
          detalhe: ideia.texto,
          desfazer: () => atribuirSala(ideia.id, null),
          detalheDesfeito: 'A ideia voltou para as novas.',
        });
      },
      'Não consegui mudar a sala. Tente de novo.',
    );

  const virarTarefa = (ideia: Ideia) =>
    agir(
      ideia.id,
      async () => {
        const { tarefa, desfazer } = await virarTarefaComDesfazer(ideia.id);
        setEscolhendo(null);
        setResultado({
          id: ideia.id,
          titulo: 'Virou tarefa de hoje',
          detalhe: detalheDaTarefa(tarefa, salaDe(tarefa.salaId)),
          ver: hrefDe('atividades'),
          desfazer,
          detalheDesfeito: 'A tarefa saiu e a ideia voltou ao que era.',
        });
      },
      'Não consegui criar a tarefa. Tente de novo.',
    );

  const apagar = (ideia: Ideia) =>
    agir(
      ideia.id,
      async () => {
        const problema = ideia.audioId ? problemas?.get(ideia.audioId) : undefined;
        // Áudio que nunca saiu deste aparelho (fila ou envio recusado) não está no Drive: não se avisa se o pedido falhar.
        const sohNesteAparelho = !!ideia.audioId && (!!problema || !!(await lerAudioPendente(ideia.audioId).catch(() => undefined)));
        const antes = await apagarIdeia(ideia.id);
        setEscolhendo(null);
        setResultado({
          id: ideia.id,
          titulo: 'Ideia apagada',
          detalhe: ideia.texto,
          desfazer: async () => {
            await restaurarIdeia(antes ?? ideia);
            // O aviso de áudio não enviado volta com a ideia.
            if (ideia.audioId && problema) await marcarProblemaDeAudio(ideia.audioId, problema).catch(() => {});
          },
          detalheDesfeito: 'A ideia voltou.',
        });
        // O áudio já enviado vai para a lixeira do Drive. Uma tentativa; se não der, o cartão avisa.
        if (ideia.audioId) {
          void apagarAudioDoDrive(ideia.audioId).then((ok) => {
            setResultado((atual) => {
              if (!atual || atual.id !== ideia.id || atual.desfeito) return atual;
              if (!ok) return sohNesteAparelho ? atual : { ...atual, detalhe: `${atual.detalhe} O áudio continua no Drive.` };
              return sohNesteAparelho ? atual : { ...atual, detalheDesfeito: 'A ideia voltou. O áudio dela já tinha ido para a lixeira do Drive e não volta.' };
            });
          });
        }
      },
      'Não consegui apagar a ideia. Tente de novo.',
    );

  const voltarParaNovas = (ideia: Ideia) =>
    agir(ideia.id, async () => atribuirSala(ideia.id, null), 'Não consegui devolver a ideia às novas. Tente de novo.');

  async function aoDesfazer() {
    const atual = resultado;
    if (!atual?.desfazer) return;
    await agir(
      atual.id,
      async () => {
        await atual.desfazer!();
        setResultado({ id: atual.id, titulo: 'Desfeito', detalhe: atual.detalheDesfeito ?? 'Voltou ao que era.', desfeito: true });
      },
      'Não consegui desfazer agora. Tente de novo.',
    );
  }

  function linhaDeAudio(ideia: Ideia) {
    if (!ideia.audioId) return null;
    // Sem saber ainda se há aviso, nada: o ▶ não aparece para sumir logo depois.
    if (problemas === undefined) return null;
    const motivo = problemas.get(ideia.audioId);
    const aviso = motivo ? (
      <p class="ideia-aviso-audio" role="status">
        Áudio não enviado. {MOTIVO_DO_AUDIO[motivo]}
      </p>
    ) : null;
    // `falhou`: o áudio segue guardado neste aparelho e ainda toca. Os outros motivos não deixam áudio para tocar.
    if (motivo && motivo !== 'falhou') return aviso;
    return (
      <>
        {aviso}
        <BotaoDeAudio audioId={ideia.audioId} segundos={ideia.audioSegundos} ideia={ideia.texto} />
      </>
    );
  }

  return (
    <section class="painel ideias" aria-labelledby="ideias-titulo">
      <header class="ideias-cabeca">
        <div>
          <h2 id="ideias-titulo" ref={titulo} tabIndex={-1}>
            Caixa de entrada
          </h2>
          <p class="ideias-sub">Tudo o que você falou e ainda não tem lugar. A Central sugere a sala; um toque confirma.</p>
        </div>
        <button type="button" class="botao-pilula ideias-nova" onClick={() => abrirOChat(tela, 'ideias', { texto: 'Ideia: ', ouvir: false })}>
          <Icone nome="microfone" />
          <span>Nova ideia</span>
        </button>
      </header>

      <div class="ideias-resultado">
        {resultado && (
          <article class="ideias-cartao" ref={cartao} tabIndex={-1} aria-labelledby="ideias-cartao-titulo" aria-describedby="ideias-cartao-detalhe">
            <p class="ideias-cartao-titulo" id="ideias-cartao-titulo">
              {resultado.titulo}
            </p>
            <p class="ideias-cartao-detalhe" id="ideias-cartao-detalhe">
              {resultado.detalhe}
            </p>
            <div class="ideias-cartao-acoes">
              {!resultado.desfeito && resultado.ver && (
                <a class="botao-link" href={resultado.ver}>
                  Ver
                </a>
              )}
              {!resultado.desfeito && resultado.desfazer && (
                <button type="button" class="botao-pilula" disabled={ocupadas.has(resultado.id)} onClick={() => void aoDesfazer()}>
                  Desfazer
                </button>
              )}
              <button
                type="button"
                class="botao-pilula"
                onClick={() => {
                  setResultado(null);
                  titulo.current?.focus(); // o botão some com o cartão: o foco vai ao título da seção
                }}
              >
                Fechar
              </button>
            </div>
          </article>
        )}
      </div>

      {erro && (
        <p class="ideias-erro" role="alert">
          {erro}
        </p>
      )}

      {ideias === undefined ? null : novas.length === 0 ? (
        <p class="ideias-vazio">Nada por arrumar. Boa!</p>
      ) : (
        <ul class="ideias-lista">
          {novas.map((ideia) => (
            <NovaIdeia
              key={ideia.id}
              ideia={ideia}
              sugerida={sugerirSala(ideia.texto, salas, pessoas ?? [], palavras ?? [])}
              salas={salas}
              escolhendo={escolhendo === ideia.id}
              ocupada={ocupadas.has(ideia.id)}
              audio={linhaDeAudio(ideia)}
              aoEscolher={() => setEscolhendo(escolhendo === ideia.id ? null : ideia.id)}
              aoLevar={(sala) => void levarParaSala(ideia, sala)}
              aoVirarTarefa={() => void virarTarefa(ideia)}
              aoApagar={() => void apagar(ideia)}
            />
          ))}
        </ul>
      )}

      {arrumadas.length > 0 && (
        <details class="ideias-arrumadas">
          <summary>{`Já arrumadas (${arrumadas.length})`}</summary>
          <ul class="ideias-lista">
            {arrumadas.slice(0, MOSTRAR_ARRUMADAS).map((ideia) => {
              const sala = salaDe(ideia.salaId);
              // Só se sabe que a tarefa sumiu depois de ler as tarefas: antes disso não se afirma nada.
              const tarefaSumiu = tarefas !== undefined && ideia.estado === 'tarefa' && (!ideia.tarefaId || !tarefasVivas.has(ideia.tarefaId));
              const ocupada = ocupadas.has(ideia.id);
              return (
                <li key={ideia.id} class="ideia ideia-arrumada">
                  <p class="ideia-meta">{quandoDaIdeia(ideia.atualizadoEm)}</p>
                  <p class="ideia-texto">{ideia.texto}</p>
                  {linhaDeAudio(ideia)}
                  <p class="ideia-estado">
                    {ideia.estado === 'tarefa' ? (tarefaSumiu ? 'Virou tarefa, mas a tarefa foi apagada.' : 'Virou tarefa.') : `Na sala ${sala?.nome ?? 'que saiu da lista'}.`}
                  </p>
                  <div class="ideia-acoes">
                    {(ideia.estado === 'atribuida' || tarefaSumiu) && (
                      <button
                        type="button"
                        class="botao-pilula"
                        aria-label={`${tarefaSumiu ? 'Virar tarefa de novo' : 'Virar tarefa'}: ${trechoDaIdeia(ideia.texto)}`}
                        disabled={ocupada}
                        onClick={() => void virarTarefa(ideia)}
                      >
                        {tarefaSumiu ? 'Virar tarefa de novo' : 'Virar tarefa'}
                      </button>
                    )}
                    {ideia.estado === 'atribuida' && (
                      <button type="button" class="botao-pilula" aria-label={`Voltar às novas: ${trechoDaIdeia(ideia.texto)}`} disabled={ocupada} onClick={() => void voltarParaNovas(ideia)}>
                        Voltar às novas
                      </button>
                    )}
                    <button type="button" class="botao-texto" aria-label={`Apagar a ideia: ${trechoDaIdeia(ideia.texto)}`} disabled={ocupada} onClick={() => void apagar(ideia)}>
                      Apagar
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          {arrumadas.length > MOSTRAR_ARRUMADAS && (
            <p class="ideias-nota">{`Mostrando ${MOSTRAR_ARRUMADAS} de ${arrumadas.length}: as mais recentes.`}</p>
          )}
        </details>
      )}
    </section>
  );
}

function detalheDaTarefa(tarefa: Tarefa, sala: Sala | undefined): string {
  return [tarefa.titulo, sala?.nome ?? 'Sem sala'].join(' · ');
}

type NovaProps = {
  ideia: Ideia;
  sugerida: string | null;
  salas: readonly Sala[];
  escolhendo: boolean;
  ocupada: boolean;
  audio: preact.ComponentChildren;
  aoEscolher: () => void;
  aoLevar: (sala: Sala) => void;
  aoVirarTarefa: () => void;
  aoApagar: () => void;
};

function NovaIdeia({ ideia, sugerida, salas, escolhendo, ocupada, audio, aoEscolher, aoLevar, aoVirarTarefa, aoApagar }: NovaProps) {
  const sala = sugerida ? salas.find((s) => s.id === sugerida) : undefined;
  const trecho = trechoDaIdeia(ideia.texto);
  const rotuloDaEscolha = sala ? 'Outra sala' : 'Escolher sala';
  return (
    <li class="ideia">
      <p class="ideia-meta">
        <Icone nome={ideia.audioId ? 'microfone' : 'editar'} />
        <span>
          {quandoDaIdeia(ideia.atualizadoEm)}
          {ideia.audioId ? ' · com áudio' : ''}
        </span>
      </p>
      <p class="ideia-texto">{ideia.texto}</p>
      <div class="ideia-acoes">
        {audio}
        {sala ? (
          <button
            type="button"
            class={`ideia-sala ${corDaSala(sala.id)}`}
            aria-label={`Levar para ${sala.nome}: ${trecho}`}
            disabled={ocupada}
            onClick={() => aoLevar(sala)}
          >
            <span aria-hidden="true">✓</span>
            {sala.nome}
          </button>
        ) : (
          <span class="ideia-sem-sala">Sem sugestão de sala</span>
        )}
        <button type="button" class="botao-pilula" aria-label={`${rotuloDaEscolha}: ${trecho}`} aria-expanded={escolhendo} disabled={ocupada} onClick={aoEscolher}>
          {rotuloDaEscolha}
        </button>
        <button type="button" class="botao-pilula" aria-label={`Virar tarefa: ${trecho}`} disabled={ocupada} onClick={aoVirarTarefa}>
          Virar tarefa
        </button>
        <button type="button" class="botao-texto" aria-label={`Apagar a ideia: ${trecho}`} disabled={ocupada} onClick={aoApagar}>
          Apagar
        </button>
      </div>
      {escolhendo && (
        <div class="ideia-escolha" role="group" aria-label={`Sala para: ${trecho}`}>
          {salas.map((outra) => (
            <button key={outra.id} type="button" class={`ideia-sala ${corDaSala(outra.id)}`} disabled={ocupada} onClick={() => aoLevar(outra)}>
              {outra.nome}
            </button>
          ))}
        </div>
      )}
    </li>
  );
}
