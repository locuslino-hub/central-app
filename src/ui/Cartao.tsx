// Cartão do chat (Tarefa 8), conforme esboco-chat/chat.html: tipo, título,
// sala, quando e o motivo da sala, com Trocar sala e Desfazer. Com certeza
// baixa, pede confirmação antes de guardar. Tudo é texto: nada de HTML da frase.
import { useEffect, useRef } from 'preact/hooks';
import {
  abrirTroca,
  confirmar,
  descartar,
  desfazerCartao,
  escolherSala,
  fecharTroca,
  naoEPessoa,
  type Acao,
  type EstadoCartao,
} from '../chat/conversa';
import type { ItemDoChat } from '../chat/interpretar';
import type { Sala } from '../dados/tipos';
import { corDaSala } from './Menu';
import { minuscula, nomeDaSemana, nomeDoDia } from './quando';

const maiuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Quando, em palavras: "Sexta, 6/11, 11:00 às 12:00", "Até hoje, às 18:00", "Sem prazo". */
export function descreverQuando(item: ItemDoChat, hoje: string): string {
  if (item.data) {
    const dia = nomeDoDia(item.data, hoje);
    if (item.tipo === 'compromisso' && item.inicio && item.fim) return `${dia}, ${item.inicio} às ${item.fim}`;
    if (item.prazoHora) return `Até ${minuscula(dia)}, às ${item.prazoHora}`;
    return dia;
  }
  if (item.semana) return nomeDaSemana(item.semana, hoje);
  return 'Sem prazo';
}

function descreverTipo(item: ItemDoChat): string {
  if (item.tipo === 'compromisso') return 'Compromisso';
  return item.prazoHora ? 'Tarefa com prazo' : 'Tarefa';
}

/** Por que a sala é essa, ou o que foi aprendido com a escolha. */
function motivo(cartao: EstadoCartao, sala: string | undefined): string | null {
  const { item, escolha } = cartao;
  const onde = sala ?? 'a sala escolhida';
  if (escolha) {
    switch (escolha.tipo) {
      case 'pessoa-nova':
      case 'pessoa':
        return `Vou lembrar: ${escolha.nome} fica em ${onde}.`;
      case 'palavra':
        return `Vou lembrar: "${escolha.termo}" fica em ${onde}.`;
      case 'sem-aprender':
        return 'Sala escolhida por você.';
    }
  }
  if (item.salaId === null) return item.pessoaNova ? null : 'Nada na frase indica a sala.';
  switch (item.motivoSala) {
    case 'frase':
      return 'A frase diz a sala.';
    case 'memoria':
      return item.termoSala
        ? `"${maiuscula(item.termoSala)}" costuma ser ${onde}.`
        : `Uma palavra da frase costuma ser ${onde}.`;
    case 'pessoa':
      return `${item.pessoaNome ?? 'A pessoa citada'} fica em ${onde}.`;
    default:
      return null;
  }
}

type Alvo = 'salas' | 'trocar' | 'cartao';
type Foco = { alvo: Alvo; depoisDe: Acao } | null;

export function Cartao({ cartao, salas, hoje }: { cartao: EstadoCartao; salas: Sala[]; hoje: string }) {
  const { id, item, situacao } = cartao;
  const raiz = useRef<HTMLElement>(null);
  const grupoDeSalas = useRef<HTMLDivElement>(null);
  const botaoTrocar = useRef<HTMLButtonElement>(null);
  // O botão apertado some depois do clique: quando a ação pedida termina
  // (`passos` cresce e `ultimaAcao` é ela), o foco vai para o que apareceu no
  // lugar, e o pedido acaba. Outra ação que termina antes (o guardar
  // automático) não leva o pedido. Toda ação conclui, então nenhum pedido fica.
  const focarDepois = useRef<Foco>(null);
  const pedirFoco = (alvo: Alvo, depoisDe: Acao) => {
    focarDepois.current = { alvo, depoisDe };
  };

  useEffect(() => {
    const pedido = focarDepois.current;
    if (!pedido || pedido.depoisDe !== cartao.ultimaAcao) return;
    focarDepois.current = null;
    const { alvo } = pedido;
    const elemento =
      alvo === 'salas'
        ? (grupoDeSalas.current?.querySelector('button') ?? raiz.current)
        : alvo === 'trocar'
          ? (botaoTrocar.current ?? raiz.current)
          : raiz.current;
    elemento?.focus();
  }, [cartao.passos]);

  if (situacao === 'desfeito' || situacao === 'descartado') {
    return (
      <article class="chat-cartao" aria-label={item.titulo} ref={raiz} tabIndex={-1}>
        <p class="chat-quando">
          {situacao === 'desfeito' ? 'Desfeito. Nada ficou guardado.' : 'Descartado. Nada ficou guardado.'}
        </p>
      </article>
    );
  }

  const nomeDaSala = item.salaId === null ? undefined : salas.find((sala) => sala.id === item.salaId)?.nome;
  const pergunta = item.pessoaNova && item.salaId === null ? `Em que sala fica ${item.pessoaNova}?` : null;
  const mostrarSalas = cartao.trocando || !!pergunta;
  const aConfirmar = situacao === 'confirmar' || situacao === 'erro';
  const porque = motivo(cartao, nomeDaSala);

  const escolher = (salaId: string) => {
    pedirFoco('trocar', 'escolher');
    void escolherSala(id, salaId);
  };

  return (
    <article class="chat-cartao" aria-label={item.titulo} ref={raiz} tabIndex={-1}>
      <div class="chat-cartao-topo">
        <span class="chat-tipo">{descreverTipo(item)}</span>
        {item.salaId === null ? (
          <span class="chat-tag sala-outra">Sem sala</span>
        ) : (
          nomeDaSala && <span class={`chat-tag ${corDaSala(item.salaId)}`}>{nomeDaSala}</span>
        )}
      </div>
      <p class="chat-titulo">{item.titulo}</p>
      <p class="chat-quando">{descreverQuando(item, hoje)}</p>
      {porque && <p class="chat-motivo">{porque}</p>}
      {situacao === 'confirmar' && <p class="chat-pergunta">Confira antes de guardar.</p>}
      {situacao === 'erro' && <p class="chat-pergunta">Não consegui guardar. Tente de novo.</p>}
      {pergunta && <p class="chat-pergunta">{pergunta}</p>}
      {cartao.aviso && <p class="chat-pergunta">{cartao.aviso}</p>}
      {mostrarSalas && (
        <div class="chat-salas" role="group" aria-label={pergunta ?? 'Escolher sala'} ref={grupoDeSalas}>
          {salas.map((sala) => (
            <button
              type="button"
              key={sala.id}
              class={`chat-sala ${corDaSala(sala.id)}`}
              aria-pressed={sala.id === item.salaId}
              onClick={() => escolher(sala.id)}
            >
              {sala.nome}
            </button>
          ))}
        </div>
      )}
      <div class="chat-acoes">
        {aConfirmar && (
          <button
            type="button"
            class="botao primario"
            onClick={() => {
              pedirFoco('cartao', 'guardar');
              void confirmar(id);
            }}
          >
            Guardar
          </button>
        )}
        {!mostrarSalas && item.salaId !== null && (
          <button
            type="button"
            class="botao"
            ref={botaoTrocar}
            onClick={() => {
              pedirFoco('salas', 'trocar');
              abrirTroca(id);
            }}
          >
            Trocar sala
          </button>
        )}
        {pergunta && (
          <button
            type="button"
            class="botao"
            onClick={() => {
              pedirFoco('salas', 'nao-e-pessoa');
              naoEPessoa(id);
            }}
          >
            Não é pessoa
          </button>
        )}
        {cartao.trocando && item.salaId !== null && (
          <button
            type="button"
            class="botao"
            onClick={() => {
              pedirFoco('trocar', 'manter');
              fecharTroca(id);
            }}
          >
            Manter a sala
          </button>
        )}
        {situacao === 'salvo' && (
          <button
            type="button"
            class="botao"
            onClick={() => {
              pedirFoco('cartao', 'desfazer');
              void desfazerCartao(id);
            }}
          >
            Desfazer
          </button>
        )}
        {aConfirmar && (
          <button
            type="button"
            class="botao"
            onClick={() => {
              pedirFoco('cartao', 'descartar');
              void descartar(id);
            }}
          >
            Descartar
          </button>
        )}
      </div>
    </article>
  );
}
