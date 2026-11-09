// A seguir (spec, seções 7 e 8): a fila do dia, na ordem de dados/fila.ts
// (fixadas, atrasadas, hoje, prazos dos próximos 7 dias, Esta semana e os
// e-mails do mais antigo ao mais novo), com a duração de cada item e se ele
// cabe no tempo livre até o próximo compromisso. Fica no Painel, ao lado de
// Por responder, e no Agora, depois do destaque.
import { horaDe } from '../dados/calendario';
import { linkSeguro } from '../dados/emails';
import type { Encaixe, ItemFila } from '../dados/fila';
import type { Sala } from '../dados/tipos';
import { corDaSala } from './Menu';
import { ComNumeros } from './Numeros';
import { nItens } from './plural';
import { quandoChegou } from './PorResponder';
import { formatarDuracao, minuscula, nomeDoDia, quandoDaTarefa } from './quando';
import type { AgoraDoDia } from './useAgoraDoDia';
import { useVerTudo } from './VerTudo';
import './painel.css';

// ---- Textos ----

/** Por que o item está na fila, em palavras: "Para hoje", "Prazo: até sexta, 6/11, às 17:00"... */
export function porQue(item: ItemFila, hoje: string): string {
  const tarefa = item.tarefa;
  if (item.tipo === 'email' || !tarefa) {
    const email = item.email;
    if (!email) return 'E-mail por responder';
    return `E-mail de ${email.remetente || 'remetente desconhecido'}, ${minuscula(quandoChegou(email.data, hoje))}`;
  }
  switch (item.grupo) {
    case 'fixada':
      return 'Fixada no topo';
    case 'atrasada':
      return tarefa.prazoHora
        ? `Atrasada: era ${minuscula(quandoDaTarefa(tarefa, hoje))}`
        : `Ficou de ${minuscula(nomeDoDia(tarefa.data as string, hoje))}`;
    case 'hoje':
      return tarefa.prazoHora ? `Prazo hoje, às ${tarefa.prazoHora}` : 'Para hoje';
    case 'prazo':
      return `Prazo: ${minuscula(quandoDaTarefa(tarefa, hoje))}`;
    case 'semana':
      return 'Para esta semana';
    default:
      return 'Na fila';
  }
}

/** O que a tela escreve como título: o assunto, no e-mail (o "E-mail de" vem nos detalhes); o da tarefa, nela. */
export function tituloDoItem(item: ItemFila): string {
  if (item.tipo === 'email' && item.email) return item.email.assunto.trim() || '(sem assunto)';
  return item.titulo.trim() || '(sem título)';
}

/** "cerca de 1 h" enquanto o dono não confirmou a duração; senão "45 min". */
export const duracaoDoItem = (item: Pick<ItemFila, 'minutos' | 'estimada'>) =>
  item.estimada ? `cerca de ${formatarDuracao(item.minutos)}` : formatarDuracao(item.minutos);

/** O nome da sala da tarefa, se tem. */
export function salaDoItem(item: ItemFila, salas: readonly Sala[]): Sala | undefined {
  const id = item.tarefa?.salaId;
  return id ? salas.find((sala) => sala.id === id) : undefined;
}

const tituloDoEvento = (titulo: string) => titulo.trim() || '(sem título)';

/**
 * O tempo livre em frase. `principal` diz até quando; `detalhe`, quanto. Sem a
 * agenda de hoje, diz que não sabe (nunca promete tempo que pode não existir).
 */
export function textoDoTempoLivre(dia: AgoraDoDia): { principal: string; detalhe?: string; curto: string } {
  const { livre, livreConhecido, eventos, fimDoDia } = dia;
  if (!livreConhecido) {
    if (eventos.falha !== null && !eventos.carregando) {
      return { principal: 'A agenda não carregou: ainda não sei quanto tempo livre há.', curto: 'Tempo livre: sem a agenda' };
    }
    return { principal: 'Lendo a agenda para saber o tempo livre…', curto: 'Lendo a agenda…' };
  }
  const { proximo, minutos, ate } = livre;
  if (minutos === 0 && proximo && Date.parse(proximo.inicio) <= dia.agora.getTime()) {
    const fim = proximo.fim.slice(0, 10) === dia.hoje ? horaDe(proximo.fim) : 'amanhã';
    return {
      principal: `Agora: ${tituloDoEvento(proximo.titulo)}, até ${fim}.`,
      detalhe: 'Sem tempo livre até ele acabar.',
      curto: `Em compromisso até ${fim}`,
    };
  }
  if (minutos === 0) {
    return {
      principal: `O dia de trabalho acabou às ${fimDoDia}.`,
      detalhe: 'O que ficou pode ir para amanhã em Fechar o dia.',
      curto: `Dia de trabalho encerrado às ${fimDoDia}`,
    };
  }
  const quanto = formatarDuracao(minutos);
  return {
    principal: proximo ? `Livre até ${ate}, quando começa ${tituloDoEvento(proximo.titulo)}.` : `Livre até ${ate}, o fim do dia.`,
    detalhe: `Você tem ${quanto}.`,
    curto: `Livre até ${ate} · ${quanto}`,
  };
}

export function TempoLivre({ dia }: { dia: AgoraDoDia }) {
  const texto = textoDoTempoLivre(dia);
  return (
    <div class="tempo-livre" aria-live="polite">
      <p class="tempo-livre-ate">
        <ComNumeros texto={texto.principal} />
      </p>
      {texto.detalhe && <p class="tempo-livre-quanto">{texto.detalhe}</p>}
    </div>
  );
}

// ---- Um item ----

/** Responder abre o e-mail no Gmail. Não aparece se o dono já marcou o e-mail como Feito. */
export function ResponderDoItem({ item, dia, classe = 'botao fila-responder' }: { item: ItemFila; dia: AgoraDoDia; classe?: string }) {
  const email = item.email;
  if (!email || !linkSeguro(email.link) || dia.emailFeito(email.id)) return null;
  const assunto = email.assunto || '(sem assunto)';
  return (
    <a
      class={classe}
      href={email.link}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Responder: ${assunto} (abre o Gmail em outra aba)`}
    >
      Responder
    </a>
  );
}

/**
 * "Cabe agora", em palavras (não só na cor), no que cabe no tempo livre. O que
 * não cabe fica sem selo: a ordem da fila já diz que vem depois. Sem tempo
 * livre conhecido, nada.
 */
export function SeloDoEncaixe({ encaixe }: { encaixe: Encaixe | undefined }) {
  if (!encaixe?.cabe) return null;
  return (
    <span class="fila-cabe" data-cabe="true">
      Cabe agora
    </span>
  );
}

type LinhaProps = { item: ItemFila; dia: AgoraDoDia; salas: readonly Sala[] };

export function LinhaDaFila({ item, dia, salas }: LinhaProps) {
  const sala = salaDoItem(item, salas);
  const encaixe = dia.encaixes.get(item.chave);
  const detalhes = [sala?.nome, porQue(item, dia.hoje), duracaoDoItem(item)].filter(Boolean).join(' · ');
  return (
    <li class="fila-item" data-tipo={item.tipo} data-grupo={item.grupo}>
      <span class={`fila-ponto ${sala ? corDaSala(sala.id) : 'sala-outra'}`} data-tipo={item.tipo} aria-hidden="true" />
      <div class="fila-texto">
        <p class="fila-titulo">{tituloDoItem(item)}</p>
        <p class="fila-detalhes">{detalhes}</p>
      </div>
      <SeloDoEncaixe encaixe={encaixe} />
      <ResponderDoItem item={item} dia={dia} />
    </li>
  );
}

// ---- O cartão ----

type Props = {
  dia: AgoraDoDia;
  salas: readonly Sala[];
  /** Itens que já aparecem antes (o destaque do Agora): ficam de fora da lista, mas contam no tempo. */
  pular?: number;
  /** Quantos mostrar no computador; o resto fica no Agora. Sem limite, todos. No celular, 3 e "Ver tudo". */
  limite?: number;
  /** No Agora o tempo livre já está no alto da página. */
  semTempoLivre?: boolean;
  /** O link para o Agora (no Painel). */
  comLink?: boolean;
};

export function ASeguir({ dia, salas, pular = 0, limite, semTempoLivre = false, comLink = false }: Props) {
  const fila = dia.fila ?? [];
  const resto = fila.slice(pular);
  const limitados = limite === undefined ? resto : resto.slice(0, limite);
  const { mostrar, botao } = useVerTudo(limitados.length);
  const mostrados = limitados.slice(0, mostrar);
  return (
    <section class="painel a-seguir" aria-labelledby="titulo-a-seguir" aria-busy={dia.fila === undefined}>
      <h2 id="titulo-a-seguir">
        A seguir
        {resto.length > 0 && <span class="painel-contagem">{nItens(resto.length)}</span>}
      </h2>
      {!semTempoLivre && <TempoLivre dia={dia} />}
      {dia.fila !== undefined && resto.length === 0 && (
        <div>
          <p class="lista-vazia-titulo">{pular > 0 ? 'Nada depois disto.' : 'Nada na fila.'}</p>
          <p class="lista-vazia-texto">As tarefas de hoje, os prazos da semana e os e-mails por responder entram aqui, em ordem.</p>
        </div>
      )}
      {mostrados.length > 0 && (
        <ul class="fila">
          {mostrados.map((item) => (
            <LinhaDaFila key={item.chave} item={item} dia={dia} salas={salas} />
          ))}
        </ul>
      )}
      {botao}
      {comLink && (
        <p class="fila-rodape">
          <a class="botao-texto" href="#/agora">
            {resto.length > limitados.length ? `Ver os ${resto.length} no Agora` : 'Abrir o Agora'}
          </a>
        </p>
      )}
    </section>
  );
}
