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
  type EstadoCartao,
} from '../chat/conversa';
import { diaDaSemana, segundaDaSemana, somarDias } from '../chat/datas';
import type { ItemDoChat } from '../chat/interpretar';
import type { Sala } from '../dados/tipos';
import { corDaSala } from './Menu';

const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

const minuscula = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const maiuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** `6/11`, com o ano só quando não é o de hoje. */
function diaMes(data: string, hoje: string): string {
  const [ano, mes, dia] = data.split('-').map(Number);
  return ano === Number(hoje.slice(0, 4)) ? `${dia}/${mes}` : `${dia}/${mes}/${ano}`;
}

/** "Hoje"; senão o dia da semana e a data, que confirmam qual sexta era. */
function nomeDoDia(data: string, hoje: string): string {
  return data === hoje ? 'Hoje' : `${DIAS[diaDaSemana(data)]}, ${diaMes(data, hoje)}`;
}

/** Quando, em palavras: "Sexta, 6/11, 11:00 às 12:00", "Até hoje, às 18:00", "Sem prazo". */
export function descreverQuando(item: ItemDoChat, hoje: string): string {
  if (item.data) {
    const dia = nomeDoDia(item.data, hoje);
    if (item.tipo === 'compromisso' && item.inicio && item.fim) return `${dia}, ${item.inicio} às ${item.fim}`;
    if (item.prazoHora) return `Até ${minuscula(dia)}, às ${item.prazoHora}`;
    return dia;
  }
  if (item.semana) {
    const esta = segundaDaSemana(hoje);
    if (item.semana === esta) return 'Esta semana';
    if (item.semana === somarDias(esta, 7)) return 'Próxima semana';
    return `Semana de ${diaMes(item.semana, hoje)}`;
  }
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

type Foco = 'salas' | 'trocar' | 'cartao' | null;

export function Cartao({ cartao, salas, hoje }: { cartao: EstadoCartao; salas: Sala[]; hoje: string }) {
  const { id, item, situacao } = cartao;
  const raiz = useRef<HTMLElement>(null);
  const grupoDeSalas = useRef<HTMLDivElement>(null);
  const botaoTrocar = useRef<HTMLButtonElement>(null);
  // O botão apertado some depois do clique: o foco vai para o que aparece no lugar.
  const focarDepois = useRef<Foco>(null);

  useEffect(() => {
    const alvo = focarDepois.current;
    if (!alvo) return;
    const elemento =
      alvo === 'salas'
        ? grupoDeSalas.current?.querySelector('button')
        : alvo === 'trocar'
          ? (botaoTrocar.current ?? raiz.current)
          : raiz.current;
    if (!elemento) return;
    focarDepois.current = null;
    elemento.focus();
  });

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
    focarDepois.current = 'trocar';
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
              focarDepois.current = 'cartao';
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
              focarDepois.current = 'salas';
              abrirTroca(id);
            }}
          >
            Trocar sala
          </button>
        )}
        {cartao.trocando && item.salaId !== null && (
          <button
            type="button"
            class="botao"
            onClick={() => {
              focarDepois.current = 'trocar';
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
              focarDepois.current = 'cartao';
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
              focarDepois.current = 'cartao';
              descartar(id);
            }}
          >
            Descartar
          </button>
        )}
      </div>
    </article>
  );
}
