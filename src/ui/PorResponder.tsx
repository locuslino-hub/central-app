// Por responder (spec, seção 8): os e-mails não lidos da aba Principal dos
// últimos 14 dias. Cada um tem Responder, Virar tarefa, Agora não e Feito.
//
// Tudo é texto: remetente, assunto e trecho nunca entram como HTML. Responder
// abre o e-mail no Gmail, em outra aba; Feito e Agora não só mudam a Central,
// e o Gmail nunca é alterado.
import { useEffect, useRef, useState } from 'preact/hooks';
import { somarDias } from '../chat/datas';
import { linkSeguro, type LeituraDeEmails } from '../dados/emails';
import type { Sala } from '../dados/tipos';
import { useDia, useSalas, usePessoas } from './hooks';
import { corDaSala } from './Menu';
import { nEmails } from './plural';
import { diaMes } from './quando';
import { useCaixaDeEmails, type Caixa, type ItemDeEmail } from './useEmails';
import './emails.css';
import './tarefas.css';

const HORA_DE_LISBOA = new Intl.DateTimeFormat('pt-PT', {
  timeZone: 'Europe/Lisbon',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export { nEmails } from './plural';

/** "Hoje, 10:20", "Ontem, 18:05" ou "3/11, 09:40". A data do e-mail já vem com a hora de Lisboa. */
export function quandoChegou(data: string, hoje: string): string {
  const dia = data.slice(0, 10);
  const hora = data.slice(11, 16);
  if (dia === hoje) return `Hoje, ${hora}`;
  if (dia === somarDias(hoje, -1)) return `Ontem, ${hora}`;
  return `${diaMes(dia, hoje)}, ${hora}`;
}

/** Quanto tempo o pedido de foco espera a janela sair, depois de tocar em Responder. */
export const PRAZO_DO_FOCO_MS = 10_000;

const idDoResponder = (id: string) => `email-responder-${id}`;

// ---- Estado da leitura ----

const DETALHE = {
  'nao-conectado': 'Este aparelho ainda não está conectado.',
  'sem-internet': 'Sem internet.',
  codigo: 'O código deste aparelho não vale mais.',
  falhou: 'Tente de novo em instantes.',
} as const;

/** Só a falta de conexão e o código inválido (confirmado pelo ping) levam a Conectar aparelho. */
const LEVA_A_CONECTAR = new Set<LeituraDeEmails['falha']>(['nao-conectado', 'codigo']);

/** Hora da última leitura, "12:20", no fuso de Lisboa. */
const horaDe = (ms: number) => HORA_DE_LISBOA.format(new Date(ms));

/** Atualizar agora, a hora da última leitura e, se falhou, o que deu errado, sem alarde. */
export function EstadoDosEmails({ caixa }: { caixa: Caixa }) {
  const { leitura, atualizar } = caixa;
  const { falha, carregando, lidoEm } = leitura;
  const texto = lidoEm !== null ? `Atualizado às ${horaDe(lidoEm)}` : carregando ? 'Carregando e-mails…' : '';
  return (
    <>
      <div class="email-estado">
        <p class="email-estado-texto" role="status">
          {texto}
        </p>
        <button type="button" class="botao" onClick={() => void atualizar()} disabled={carregando} aria-busy={carregando}>
          {carregando ? 'Atualizando…' : 'Atualizar agora'}
        </button>
      </div>
      {falha !== null && (
        <div class="email-aviso" role="status">
          {falha === 'nao-liberada' ? (
            <p>E-mail ainda não liberado — falta aprovar a permissão no script</p>
          ) : (
            <p>
              <strong>E-mails não carregaram</strong> <span>{DETALHE[falha]}</span>
            </p>
          )}
          {LEVA_A_CONECTAR.has(falha) && (
            <a class="botao-link" href="#/conectar">
              Conectar aparelho
            </a>
          )}
        </div>
      )}
    </>
  );
}

// ---- A última ação, com Desfazer ----

export function AvisoDeEmail({ caixa }: { caixa: Caixa }) {
  const botao = useRef<HTMLButtonElement>(null);
  const { aviso, falhou } = caixa;
  // O botão em que o dono tocou já não existe (o e-mail saiu da lista): o foco vem para o Desfazer.
  useEffect(() => {
    if (aviso) botao.current?.focus();
  }, [aviso]);
  return (
    <>
      {aviso && (
        <div class="tarefa-apagada email-acao-feita" role="status">
          <span>{aviso.texto}</span>
          <button type="button" class="tarefa-desfazer" ref={botao} onClick={() => void caixa.desfazer()}>
            Desfazer
          </button>
        </div>
      )}
      {falhou && (
        <p class="email-erro" role="alert">
          {falhou}
        </p>
      )}
    </>
  );
}

// ---- Um e-mail ----

type PerguntaProps = {
  item: ItemDeEmail;
  salas: readonly Sala[];
  caixa: Caixa;
  aoFechar: () => void;
};

/** "De quem é?": uma vez respondida, nunca mais aparece para este remetente. */
function PerguntaDeSala({ item, salas, caixa, aoFechar }: PerguntaProps) {
  const pessoas = usePessoas() ?? [];
  const [escolha, setEscolha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const campo = useRef<HTMLSelectElement>(null);
  const nomeDaSala = (id: string) => salas.find((sala) => sala.id === id)?.nome ?? 'sala removida';
  const id = `email-sala-${item.email.id}`;

  useEffect(() => {
    campo.current?.focus();
  }, []);

  async function guardar(evento: Event) {
    evento.preventDefault();
    if (!escolha) {
      setErro('Escolha uma opção.');
      return campo.current?.focus();
    }
    if (await caixa.responderSala(item.email, escolha)) return aoFechar();
    setErro('Não consegui guardar. Tente de novo.');
  }

  return (
    <form class="email-pergunta" noValidate onSubmit={guardar} onKeyDown={(e) => e.key === 'Escape' && aoFechar()}>
      <label for={id}>{`De quem é este e-mail? (${item.email.remetente})`}</label>
      <div class="email-pergunta-campos">
        <select
          id={id}
          ref={campo}
          class="campo"
          value={escolha}
          aria-invalid={erro ? true : undefined}
          onChange={(e) => {
            setEscolha((e.target as HTMLSelectElement).value);
            setErro(null);
          }}
        >
          <option value="">Escolha…</option>
          {pessoas.map((pessoa) => (
            <option key={pessoa.id} value={`p:${pessoa.id}`}>
              {`${pessoa.nome}, pessoa de ${nomeDaSala(pessoa.salaId)}`}
            </option>
          ))}
          {salas.map((sala) => (
            <option key={sala.id} value={`s:${sala.id}`}>
              {`Só a sala ${sala.nome}`}
            </option>
          ))}
          <option value="n">Sem sala</option>
        </select>
        <button type="submit" class="botao primario">
          Guardar
        </button>
        <button type="button" class="botao" onClick={aoFechar}>
          Cancelar
        </button>
      </div>
      {erro && <p class="email-erro">{erro}</p>}
      <p class="email-pergunta-nota">O app lembra a resposta e não pergunta de novo.</p>
    </form>
  );
}

type CartaoProps = {
  item: ItemDeEmail;
  salas: readonly Sala[];
  hoje: string;
  caixa: Caixa;
  aoResponder: (id: string) => void;
};

export function CartaoDeEmail({ item, salas, hoje, caixa, aoResponder }: CartaoProps) {
  const { email, origem, tarefa } = item;
  const [perguntando, setPerguntando] = useState(false);
  const sala = origem.salaId === null ? undefined : salas.find((s) => s.id === origem.salaId);
  const assunto = email.assunto || '(sem assunto)';
  const remetente = email.remetente || 'Remetente desconhecido';

  return (
    <li class="email" data-email={email.id}>
      <div class="email-topo">
        <strong class="email-remetente">{remetente}</strong>
        <time class="email-quando" dateTime={email.data}>
          {quandoChegou(email.data, hoje)}
        </time>
      </div>
      <p class="email-assunto">{assunto}</p>
      {email.trecho && <p class="email-trecho">{email.trecho}</p>}
      <div class="email-meta">
        {sala ? (
          <span class={`etiqueta ${corDaSala(sala.id)}`}>{sala.nome}</span>
        ) : origem.salaId !== null ? null : origem.sabe ? ( // sala conhecida, mas as salas ainda estão lendo
          <span class="email-sem-sala">Sem sala</span>
        ) : (
          <button
            type="button"
            class="email-escolher"
            aria-expanded={perguntando}
            aria-label={`Sem sala, escolher a sala de ${remetente}`}
            onClick={() => setPerguntando((aberto) => !aberto)}
          >
            <span>Sem sala, escolher</span>
          </button>
        )}
        {tarefa && <span class="etiqueta email-tarefa">{tarefa.feito ? 'Tarefa concluída' : 'Virou tarefa'}</span>}
      </div>
      {perguntando && !origem.sabe && (
        <PerguntaDeSala item={item} salas={salas} caixa={caixa} aoFechar={() => setPerguntando(false)} />
      )}
      <div class="email-acoes" role="group" aria-label={`Ações do e-mail: ${assunto}`}>
        {linkSeguro(email.link) && (
          <a
            id={idDoResponder(email.id)}
            class="botao primario"
            href={email.link}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Responder: ${assunto} (abre o Gmail em outra aba)`}
            onClick={() => aoResponder(email.id)}
          >
            Responder
          </a>
        )}
        {!tarefa && (
          <button type="button" class="botao-pilula" aria-label={`Virar tarefa: ${assunto}`} onClick={() => void caixa.virarTarefa(item)}>
            Virar tarefa
          </button>
        )}
        <button type="button" class="botao-texto" aria-label={`Agora não: ${assunto}`} onClick={() => void caixa.adiar(email)}>
          Agora não
        </button>
        <button type="button" class="botao-texto" aria-label={`Feito: ${assunto}`} onClick={() => void caixa.feito(email)}>
          Feito
        </button>
      </div>
    </li>
  );
}

// ---- A lista ----

/**
 * A lista de e-mails. Quem toca em Responder sai para o Gmail; ao voltar (a
 * janela volta a ficar à vista), o foco vai para o Responder do próximo item.
 */
export function ListaDeEmails({ itens, caixa }: { itens: ItemDeEmail[]; caixa: Caixa }) {
  const hoje = useDia();
  const salas = useSalas();
  const pendente = useRef<{ atual: string; proximo: string | null; saiu: boolean } | null>(null);
  const prazo = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const limpar = () => {
    clearTimeout(prazo.current);
    pendente.current = null;
  };

  useEffect(() => {
    const saiu = () => {
      if (pendente.current) pendente.current.saiu = true;
    };
    const voltou = () => {
      const p = pendente.current;
      if (!p || !p.saiu || document.visibilityState === 'hidden') return;
      limpar();
      // O próximo pode ter saído da lista nesse meio tempo: então fica no mesmo.
      const alvo = (p.proximo && document.getElementById(idDoResponder(p.proximo))) || document.getElementById(idDoResponder(p.atual));
      alvo?.focus();
    };
    const aoMudarAVisibilidade = () => (document.visibilityState === 'hidden' ? saiu() : voltou());
    window.addEventListener('blur', saiu);
    window.addEventListener('focus', voltou);
    document.addEventListener('visibilitychange', aoMudarAVisibilidade);
    return () => {
      if (typeof window !== 'undefined') window.removeEventListener('blur', saiu);
      if (typeof window !== 'undefined') window.removeEventListener('focus', voltou);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', aoMudarAVisibilidade);
      clearTimeout(prazo.current);
    };
  }, []);

  function aoResponder(id: string) {
    const posicao = itens.findIndex((item) => item.email.id === id);
    const vizinho = itens[posicao + 1] ?? itens[posicao - 1];
    clearTimeout(prazo.current);
    const meu = { atual: id, proximo: vizinho ? vizinho.email.id : null, saiu: false };
    pendente.current = meu;
    // Se a janela não saiu (o navegador não abriu a aba), o pedido vence: um Alt+Tab
    // muito depois não pode tirar o foco de onde o dono está.
    prazo.current = setTimeout(() => {
      if (pendente.current === meu && !meu.saiu) pendente.current = null;
    }, PRAZO_DO_FOCO_MS);
  }

  return (
    <ul
      class="emails"
      // Outro controle da lista foi usado: o dono desistiu de ir ao Gmail por agora.
      onClickCapture={(evento) => {
        if (!(evento.target as Element).closest('a[id^="email-responder-"]')) limpar();
      }}
    >
      {itens.map((item) => (
        <CartaoDeEmail key={item.email.id} item={item} salas={salas} hoje={hoje} caixa={caixa} aoResponder={aoResponder} />
      ))}
    </ul>
  );
}

/** Nada por responder (ou ainda lendo): o texto certo para cada caso. */
export function EmailsVazios({ caixa }: { caixa: Caixa }) {
  if (caixa.itens === undefined || caixa.leitura.lidoEm === null) return null;
  return (
    <div>
      <p class="lista-vazia-titulo">Nada por responder.</p>
      <p class="lista-vazia-texto">Os e-mails não lidos da aba Principal, dos últimos 14 dias, aparecem aqui.</p>
    </div>
  );
}

// ---- O cartão do Painel do dia ----

/** No Painel do dia: os primeiros e-mails e o caminho para a Caixa. */
export function PorResponder({ limite = 4 }: { limite?: number }) {
  const caixa = useCaixaDeEmails();
  const { itens, leitura } = caixa;
  const todos = itens ?? [];
  const mostrados = todos.slice(0, limite);
  return (
    <section
      class="painel por-responder"
      aria-labelledby="titulo-por-responder"
      aria-busy={itens === undefined || (leitura.lidoEm === null && leitura.falha === null)}
    >
      <h2 id="titulo-por-responder">
        Por responder
        {todos.length > 0 && <span class="email-contagem">{nEmails(todos.length)}</span>}
      </h2>
      <EstadoDosEmails caixa={caixa} />
      <AvisoDeEmail caixa={caixa} />
      {todos.length === 0 && <EmailsVazios caixa={caixa} />}
      {mostrados.length > 0 && <ListaDeEmails itens={mostrados} caixa={caixa} />}
      {todos.length > mostrados.length && (
        <p class="email-ver-todos">
          <a class="botao-link" href="#/caixa">{`Ver os ${todos.length} na Caixa`}</a>
        </p>
      )}
    </section>
  );
}
