// Agora (spec, seção 7): uma tarefa em destaque, o tempo livre até o próximo
// compromisso, a fila A seguir, a triagem de e-mails e Fechar o dia. Mora no
// painel direito do computador (cartão curto) e na página #/agora (inteiro,
// com abas). O destaque é o primeiro item da fila (dados/fila.ts).
import { useRef, useState } from 'preact/hooks';
import { adiarEmail, concluirEmail, virarTarefa } from '../dados/emails-estado';
import type { ItemFila } from '../dados/fila';
import { origemDoRemetente } from '../dados/remetentes';
import { adiarTarefa, concluirTarefa } from '../dados/tarefas';
import type { Pessoa, Sala, Tarefa } from '../dados/tipos';
import { AvisoDasAcoes, useAcoes, useMarcar, type Acoes } from './Acoes';
import { ASeguir, duracaoDoItem, porQue, ResponderDoItem, salaDoItem, SeloDoEncaixe, TempoLivre, textoDoTempoLivre, tituloDoItem } from './ASeguir';
import { FecharDia } from './FecharDia';
import { abrirPaginaDaAgua, CartaoAgua } from './Agua';
import { usePessoas, useSalas, useTela } from './hooks';
import { corDaSala } from './Menu';
import { minuscula } from './quando';
import { porDecidir, Triagem } from './Triagem';
import { useCaixaDeEmails } from './useEmails';
import { ComNumeros } from './Numeros';
import { useAgoraDoDia, type AgoraDoDia } from './useAgoraDoDia';
import './painel.css';

// ---- O destaque ----

type DestaqueProps = {
  item: ItemFila;
  dia: AgoraDoDia;
  salas: readonly Sala[];
  pessoas: readonly Pessoa[];
  acoes: Acoes;
  /** Tarefa de marcar: concluir pergunta antes quando ficou marcado (a caixa mora fora do destaque). */
  aoMarcar: (tarefa: Tarefa) => void;
  /** No painel direito: menor, com o título como texto forte e não como cabeçalho. */
  curto?: boolean;
};

function Destaque({ item, dia, salas, pessoas, acoes, aoMarcar, curto = false }: DestaqueProps) {
  const sala = salaDoItem(item, salas);
  const titulo = tituloDoItem(item);
  const { hoje } = dia;
  const tarefa = item.tarefa;
  const email = item.email;

  const acoesDaTarefa = tarefa && (
    <>
      <button
        type="button"
        class="botao primario"
        data-concluir={tarefa.id}
        aria-label={`Concluir: ${titulo}`}
        onClick={() => {
          if (tarefa.marcar) return aoMarcar(tarefa);
          void acoes.agir(async () => {
            const entrada = await concluirTarefa(tarefa.id);
            return entrada && { texto: entrada.rotulo, entrada };
          }, 'Não consegui concluir. Tente de novo.');
        }}
      >
        Concluir
      </button>
      <ResponderDoItem item={item} dia={dia} classe="botao" />
      <button
        type="button"
        class="botao"
        aria-label={`Agora não: ${titulo}`}
        onClick={() =>
          void acoes.agir(async () => {
            const entrada = await adiarTarefa(tarefa.id, hoje);
            return entrada && { texto: entrada.rotulo, entrada };
          }, 'Não consegui adiar. Tente de novo.')
        }
      >
        Agora não
      </button>
    </>
  );

  const acoesDoEmail = !tarefa && email && (
    <>
      <ResponderDoItem item={item} dia={dia} classe="botao primario" />
      <button
        type="button"
        class="botao"
        aria-label={`Virar tarefa: ${titulo}`}
        onClick={() =>
          void acoes.agir(async () => {
            const origem = origemDoRemetente(email.enderecoRemetente, pessoas);
            const feita = await virarTarefa(email, { salaId: origem.salaId, pessoaId: origem.pessoa?.id });
            if (!feita) throw new Error('Tarefa não criada');
            return feita.entrada && { texto: `Tarefa criada: ${feita.tarefa.titulo}`, entrada: feita.entrada };
          }, 'Não consegui criar a tarefa. Tente de novo.')
        }
      >
        Virar tarefa
      </button>
      <button
        type="button"
        class="botao"
        aria-label={`Agora não: ${titulo}`}
        onClick={() =>
          void acoes.agir(async () => {
            const entrada = await adiarEmail(email.id, hoje);
            return { texto: `${entrada.rotulo}. Ele volta amanhã.`, entrada };
          }, 'Não consegui adiar. Tente de novo.')
        }
      >
        Agora não
      </button>
      <button
        type="button"
        class="botao"
        aria-label={`Feito: ${titulo}`}
        onClick={() =>
          void acoes.agir(async () => {
            const entrada = await concluirEmail(email.id);
            return { texto: entrada.rotulo, entrada };
          }, 'Não consegui marcar como feito. Tente de novo.')
        }
      >
        Feito
      </button>
    </>
  );

  return (
    <section class={`destaque ${sala ? corDaSala(sala.id) : 'sala-outra'}`} data-curto={String(curto)} aria-label="Em destaque">
      <div class="destaque-topo">
        {sala && <span class={`etiqueta ${corDaSala(sala.id)}`}>{sala.nome}</span>}
        {item.tipo === 'email' && <span class="etiqueta sala-outra">E-mail</span>}
        <span class="destaque-duracao">{duracaoDoItem(item)}</span>
        <SeloDoEncaixe encaixe={dia.encaixes.get(item.chave)} />
      </div>
      {curto ? (
        <p class="destaque-titulo">
          <ComNumeros texto={titulo} />
        </p>
      ) : (
        <h2 class="destaque-titulo">
          <ComNumeros texto={titulo} />
        </h2>
      )}
      {!curto && email?.trecho && item.tipo === 'email' && <p class="destaque-trecho">{email.trecho}</p>}
      <p class="destaque-porque">{`Por que agora: ${minuscula(porQue(item, hoje))}`}</p>
      <div class="destaque-acoes" role="group" aria-label={`Ações: ${titulo}`}>
        {acoesDaTarefa}
        {acoesDoEmail}
      </div>
    </section>
  );
}

function FilaVazia({ fechado }: { fechado: boolean }) {
  return (
    <div class="agora-vazio">
      <p class="lista-vazia-titulo">Nada na fila agora.</p>
      <p class="lista-vazia-texto">
        {fechado ? 'O dia está fechado. Bom descanso.' : 'Quando houver tarefa para hoje, prazo perto ou e-mail por responder, ele aparece aqui.'}
      </p>
    </div>
  );
}

// ---- No painel direito ----

/**
 * O cartão curto do Agora: tempo livre, destaque e o caminho para a página.
 * Os seguintes não se repetem aqui: estão em A seguir, no Painel.
 */
export function AgoraCurto() {
  const dia = useAgoraDoDia();
  const salas = useSalas();
  const pessoas = usePessoas() ?? [];
  const acoes = useAcoes();
  const base = useRef<HTMLDivElement>(null);
  const marcar = useMarcar(dia.hoje, acoes, base);
  const fila = dia.fila ?? [];
  const [primeiro] = fila;
  return (
    <div class="agora-curto" ref={base} aria-busy={dia.fila === undefined}>
      <p class="agora-livre">{textoDoTempoLivre(dia).curto}</p>
      <AvisoDasAcoes acoes={acoes} />
      {primeiro && (
        <Destaque key={primeiro.chave} item={primeiro} dia={dia} salas={salas} pessoas={pessoas} acoes={acoes} aoMarcar={marcar.abrir} curto />
      )}
      {dia.fila !== undefined && !primeiro && (
        <p class="agora-vazio-curto">{dia.fechado ? 'Dia fechado. Nada na fila.' : 'Nada na fila agora.'}</p>
      )}
      <p class="agora-abrir">
        <a class="botao-texto" href="#/agora">
          Abrir o Agora
        </a>
      </p>
      {marcar.caixa}
    </div>
  );
}

// ---- A página ----

type Aba = 'agora' | 'triagem' | 'fechar';
const ABAS: Aba[] = ['agora', 'triagem', 'fechar'];

function ConteudoDoAgora({ dia, salas }: { dia: AgoraDoDia; salas: readonly Sala[] }) {
  const pessoas = usePessoas() ?? [];
  const acoes = useAcoes();
  const base = useRef<HTMLDivElement>(null);
  const marcar = useMarcar(dia.hoje, acoes, base);
  const fila = dia.fila ?? [];
  const primeiro = fila[0];
  return (
    <div class="agora-conteudo" ref={base}>
      <TempoLivre dia={dia} />
      <AvisoDasAcoes acoes={acoes} />
      {primeiro && (
        <Destaque key={primeiro.chave} item={primeiro} dia={dia} salas={salas} pessoas={pessoas} acoes={acoes} aoMarcar={marcar.abrir} />
      )}
      {dia.fila !== undefined && !primeiro && <FilaVazia fechado={dia.fechado} />}
      {primeiro && <ASeguir dia={dia} salas={salas} pular={1} semTempoLivre />}
      {marcar.caixa}
    </div>
  );
}

/** A página #/agora: abas Agora, Triagem e Fechar o dia (padrão de abas, com setas). */
export function AgoraPagina() {
  const dia = useAgoraDoDia();
  // Sem coluna direita (celular e tablet), a água vem no topo da página; no computador já está na coluna.
  const semColuna = useTela() !== 'computador';
  const salas = useSalas();
  const [aba, setAba] = useState<Aba>('agora');
  const botoes = useRef<Partial<Record<Aba, HTMLButtonElement | null>>>({});
  // Uma fonte só para a contagem da aba e para a lista da Triagem.
  const caixa = useCaixaDeEmails();
  const quantos = porDecidir(caixa.itens).length;
  const nome: Record<Aba, string> = {
    agora: 'Agora',
    triagem: quantos > 0 ? `Triagem (${quantos})` : 'Triagem',
    fechar: 'Fechar o dia',
  };

  function aoTeclar(evento: KeyboardEvent) {
    const i = ABAS.indexOf(aba);
    const destino =
      evento.key === 'ArrowRight'
        ? ABAS[(i + 1) % ABAS.length]
        : evento.key === 'ArrowLeft'
          ? ABAS[(i + ABAS.length - 1) % ABAS.length]
          : evento.key === 'Home'
            ? ABAS[0]
            : evento.key === 'End'
              ? ABAS[ABAS.length - 1]
              : null;
    if (!destino) return;
    evento.preventDefault();
    setAba(destino);
    botoes.current[destino]?.focus();
  }

  return (
    <div class="agora-pagina">
      {semColuna && <CartaoAgua aoAbrir={abrirPaginaDaAgua} />}
      <div class="abas" role="tablist" aria-label="Modo do Agora" onKeyDown={aoTeclar}>
        {ABAS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`aba-${id}`}
            class="aba"
            aria-selected={aba === id}
            aria-controls={`painel-aba-${id}`}
            tabIndex={aba === id ? 0 : -1}
            ref={(el) => {
              botoes.current[id] = el;
            }}
            onClick={() => setAba(id)}
          >
            {nome[id]}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`painel-aba-${aba}`} aria-labelledby={`aba-${aba}`} class="aba-painel">
        {aba === 'agora' && <ConteudoDoAgora dia={dia} salas={salas} />}
        {aba === 'triagem' && <Triagem caixa={caixa} />}
        {aba === 'fechar' && <FecharDia dia={dia} salas={salas} />}
      </div>
    </div>
  );
}
