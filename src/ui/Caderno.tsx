// O caderno de uma sala (Tarefa 19, spec seção 7): páginas com linhas de texto,
// títulos, listas e painéis (Agenda, Checklist, Semana). "/" abre o menu de
// blocos. Linha com data vira tarefa ou compromisso, na sala da página.
//
// Regra de ouro, a mesma das Notas: o campo em edição nunca é redesenhado por
// uma atualização vinda de fora (texto, foco e cursor ficam como estão). Cada
// linha tem id fixo, então a tela reaproveita o mesmo campo a cada atualização.
import { useEffect, useRef, useState } from 'preact/hooks';
import { hojeEmLisboa } from '../dados/dia';
import {
  criarGravador,
  criarPagina,
  gravarBlocos,
  itemDaLinha,
  novoBloco,
  novoPainel,
  desfazerDeRemocao,
  renomearPagina,
  SO_COM_ENTER,
  TEXTO_DO_BLOCO_NO_MAXIMO,
  TITULO_DA_PAGINA_NO_MAXIMO,
  type ItemDaLinha,
  type Situacao,
} from '../dados/caderno';
import type { Bloco, Pagina } from '../dados/tipos';
import { AvisoDasAcoes, useAcoes } from './Acoes';
import { AgendaHoje } from './AgendaHoje';
import { BlocoMenu, filtrarOpcoes, OPCOES_DO_MENU, type OpcaoDoMenu } from './BlocoMenu';
import { Checklist } from './Checklist';
import { usePaginas } from './hooks';
import { minuscula, nomeDaSemana, nomeDoDia } from './quando';
import { Semana } from './Semana';
import './salas.css';

/** Quanto tempo depois da última tecla o caderno é gravado. */
export const ATRASO_DO_CADERNO_MS = 300;

const SITUACAO: Record<Situacao, string> = {
  parado: '',
  salvando: 'Salvando…',
  salvo: 'Salvo',
  erro: 'Não consegui salvar.',
  apagado: 'Esta página foi apagada; o texto não foi guardado.',
};

const ROTULO_DO_BLOCO = { texto: 'Texto', titulo: 'Título', lista: 'Item da lista' } as const;
const NOME_DO_PAINEL = { agenda: 'Agenda', checklist: 'Checklist', semana: 'Semana' } as const;

/** Texto curto para dizer de que bloco se fala. */
function resumo(bloco: Bloco): string {
  if (bloco.tipo === 'painel') return NOME_DO_PAINEL[bloco.painel ?? 'agenda'];
  const t = (bloco.texto ?? '').trim();
  return t === '' ? 'linha vazia' : t.length > 30 ? `${t.slice(0, 30)}…` : t;
}

/** O que o dono lê depois que a linha virou item. */
export function avisoDoItem(item: ItemDaLinha, nomeDaSala: string, hoje: string): string {
  if (item.tipo === 'compromisso') {
    return `Virou compromisso no Google Agenda: ${minuscula(nomeDoDia(item.data ?? hoje, hoje))}${item.inicio ? `, às ${item.inicio}` : ''}.`;
  }
  const quando = item.data ? minuscula(nomeDoDia(item.data, hoje)) : item.semana ? minuscula(nomeDaSemana(item.semana, hoje)) : '';
  return `Virou tarefa em ${nomeDaSala}${quando ? `, para ${quando}` : ''}.`;
}

/**
 * Campo de uma linha: guarda o texto digitado ao lado do que veio de fora.
 * Atualização de fora só entra se o campo não está em uso; se chegou durante o
 * uso e nada foi digitado depois, entra quando o dono sai do campo.
 */
function useCampoLocal(externo: string, aoMudar: (valor: string) => void) {
  const [texto, setTexto] = useState(externo);
  const campo = useRef<HTMLInputElement>(null);
  const atual = useRef(externo);
  const chegouDeFora = useRef(false);
  const doRegistro = useRef(externo);
  doRegistro.current = externo;

  useEffect(() => {
    if (externo === atual.current) return;
    if (document.activeElement === campo.current) {
      chegouDeFora.current = true;
      return;
    }
    atual.current = externo;
    setTexto(externo);
  }, [externo]);

  return {
    campo,
    texto,
    digitou(valor: string) {
      atual.current = valor;
      chegouDeFora.current = false;
      setTexto(valor);
      aoMudar(valor);
    },
    saiu() {
      if (chegouDeFora.current && doRegistro.current !== atual.current) {
        atual.current = doRegistro.current;
        setTexto(atual.current);
      }
      chegouDeFora.current = false;
    },
  };
}

type MenuAberto = { blocoId: string | null; filtro: string; ativo: number };

type LinhaProps = {
  bloco: Bloco;
  primeira: boolean;
  menu: MenuAberto | null;
  opcoes: readonly OpcaoDoMenu[];
  aoTexto: (id: string, texto: string) => void;
  aoEnter: (id: string) => void;
  aoSair: (id: string) => void;
  aoTeclaDoMenu: (e: KeyboardEvent, id: string) => void;
  aoEscolher: (opcao: OpcaoDoMenu) => void;
};

function Linha({ bloco, primeira, menu, opcoes, aoTexto, aoEnter, aoSair, aoTeclaDoMenu, aoEscolher }: LinhaProps) {
  const c = useCampoLocal(bloco.texto ?? '', (v) => aoTexto(bloco.id, v));
  const tipo = bloco.tipo as 'texto' | 'titulo' | 'lista';
  const aberto = menu?.blocoId === bloco.id;
  const idDoMenu = `menu-${bloco.id}`;
  return (
    <div class={`caderno-linha caderno-${tipo}`}>
      <input
        ref={c.campo}
        class="campo caderno-campo"
        type="text"
        aria-label={ROTULO_DO_BLOCO[tipo]}
        placeholder={primeira && tipo === 'texto' ? 'Escreva aqui. Digite / para inserir Agenda, Checklist ou Semana.' : undefined}
        maxLength={TEXTO_DO_BLOCO_NO_MAXIMO}
        autoComplete="off"
        enterKeyHint="enter"
        spellcheck
        role={aberto ? 'combobox' : undefined}
        aria-expanded={aberto ? true : undefined}
        aria-haspopup={aberto ? 'listbox' : undefined}
        aria-autocomplete={aberto ? 'list' : undefined}
        aria-controls={aberto ? idDoMenu : undefined}
        aria-activedescendant={aberto && opcoes[menu!.ativo] ? `${idDoMenu}-${opcoes[menu!.ativo].id}` : undefined}
        value={c.texto}
        onInput={(e) => c.digitou((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (aberto) return aoTeclaDoMenu(e, bloco.id);
          if (e.key === 'Enter' && !e.isComposing) {
            e.preventDefault();
            aoEnter(bloco.id);
          }
        }}
        onBlur={() => {
          c.saiu();
          aoSair(bloco.id);
        }}
      />
      {aberto && <BlocoMenu id={idDoMenu} rotulo="Inserir bloco" opcoes={opcoes} ativo={menu!.ativo} aoEscolher={aoEscolher} />}
    </div>
  );
}

function PainelDoBloco({ painel }: { painel: NonNullable<Bloco['painel']> }) {
  return (
    <div class="caderno-painel">
      {painel === 'agenda' && <AgendaHoje />}
      {painel === 'checklist' && <Checklist />}
      {painel === 'semana' && <Semana />}
    </div>
  );
}

function TituloDaPagina({ pagina }: { pagina: Pagina }) {
  const gravador = useRef<ReturnType<typeof criarGravador<string>> | undefined>(undefined);
  gravador.current ??= criarGravador((t: string) => renomearPagina(pagina.id, t), () => undefined, ATRASO_DO_CADERNO_MS);
  const c = useCampoLocal(pagina.titulo, (v) => gravador.current!.agendar(v));
  useEffect(() => () => void gravador.current!.esvaziar(), []);
  return (
    <input
      ref={c.campo}
      class="campo caderno-titulo-pagina"
      type="text"
      aria-label="Título da página"
      maxLength={TITULO_DA_PAGINA_NO_MAXIMO}
      autoComplete="off"
      value={c.texto}
      onInput={(e) => c.digitou((e.target as HTMLInputElement).value)}
      onBlur={() => {
        c.saiu();
        void gravador.current!.esvaziar();
      }}
    />
  );
}

type Aviso = { texto: string; item?: ItemDaLinha };

function PaginaAberta({ pagina, salaId, nomeDaSala }: { pagina: Pagina; salaId: string; nomeDaSala: string }) {
  const [blocos, setBlocos] = useState<Bloco[]>(pagina.blocos);
  const [situacao, setSituacao] = useState<Situacao>('parado');
  const [menu, setMenu] = useState<MenuAberto | null>(null);
  const [avisos, setAvisos] = useState<Record<string, Aviso>>({});
  const acoes = useAcoes();
  const atual = useRef(blocos);
  const gravador = useRef<ReturnType<typeof criarGravador<Bloco[]>> | undefined>(undefined);
  gravador.current ??= criarGravador((b: Bloco[]) => gravarBlocos(pagina.id, b), setSituacao, ATRASO_DO_CADERNO_MS);
  const g = gravador.current;
  // Pedido de cursor: vai junto com a mudança dos blocos, para o efeito só rodar com a linha já desenhada.
  const [pedirFoco, setPedirFoco] = useState<{ id: string } | null>(null);
  const tentadas = useRef(new Map<string, string>());
  const raiz = useRef<HTMLDivElement>(null);

  const mudar = (novos: Bloco[]) => {
    atual.current = novos;
    setBlocos(novos);
    g.agendar(novos);
  };

  // Versão nova de outro aparelho: só entra se nada digitado aqui está por gravar.
  // Cópia mais velha que a já vista (leitura atrasada) nunca entra.
  const versao = useRef(pagina.atualizadoEm);
  useEffect(() => {
    if (g.sujo() || pagina.atualizadoEm < versao.current) return;
    versao.current = pagina.atualizadoEm;
    if (JSON.stringify(pagina.blocos) === JSON.stringify(atual.current)) return;
    atual.current = pagina.blocos;
    setBlocos(pagina.blocos);
  }, [pagina.blocos, pagina.atualizadoEm]); // eslint-disable-line react-hooks/exhaustive-deps

  // Esconder o app, sair da página ou trocar de página também grava.
  useEffect(() => {
    const aoEsconder = () => {
      if (document.visibilityState === 'hidden' && g.sujo()) void g.esvaziar();
    };
    const aoSair = () => {
      if (g.sujo()) void g.esvaziar();
    };
    document.addEventListener('visibilitychange', aoEsconder);
    window.addEventListener('pagehide', aoSair);
    return () => {
      document.removeEventListener('visibilitychange', aoEsconder);
      window.removeEventListener('pagehide', aoSair);
      void g.esvaziar();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Linha nova ou bloco inserido: o cursor vai para ela.
  useEffect(() => {
    if (!pedirFoco) return;
    raiz.current?.querySelector<HTMLInputElement>(`[data-bloco="${pedirFoco.id}"] input`)?.focus();
  }, [pedirFoco]);

  async function confirmarLinha(id: string, compromisso: boolean) {
    const b = atual.current.find((x) => x.id === id);
    if (!b || b.itemId || (b.tipo !== 'texto' && b.tipo !== 'lista')) return;
    const texto = (b.texto ?? '').trim();
    if (!texto || texto.startsWith('/') || tentadas.current.get(id) === texto) return;
    tentadas.current.set(id, texto);
    try {
      const item = await itemDaLinha(texto, salaId, { compromisso });
      if (item === SO_COM_ENTER) {
        // Compromisso é evento de verdade no Google Agenda: espera o Enter.
        tentadas.current.delete(id);
        return;
      }
      if (!item) return;
      if (!atual.current.some((x) => x.id === id)) {
        // A linha foi removida enquanto o item nascia: não deixa item solto.
        await item.desfazer();
        return;
      }
      mudar(atual.current.map((x) => (x.id === id ? { ...x, itemId: item.itemId } : x)));
      void g.esvaziar();
      setAvisos((a) => ({ ...a, [id]: { texto: avisoDoItem(item, nomeDaSala, hojeEmLisboa()), item } }));
    } catch (erro) {
      console.error('Não consegui criar o item da linha', erro);
      tentadas.current.delete(id);
      setAvisos((a) => ({ ...a, [id]: { texto: 'Não consegui criar a tarefa desta linha. Saia da linha e volte para tentar de novo.' } }));
    }
  }

  async function desfazerItem(id: string) {
    const aviso = avisos[id];
    if (!aviso?.item) return;
    try {
      await aviso.item.desfazer();
      mudar(
        atual.current.map((x) => {
          if (x.id !== id) return x;
          const { itemId: _tirado, ...sem } = x;
          return sem;
        }),
      );
      setAvisos((a) => {
        const { [id]: _aviso, ...resto } = a;
        return resto;
      });
    } catch (erro) {
      console.error('Não consegui desfazer o item', erro);
      setAvisos((a) => ({ ...a, [id]: { ...aviso, texto: 'Não consegui desfazer. Tente de novo.' } }));
    }
  }

  function aoTexto(id: string, texto: string) {
    mudar(atual.current.map((b) => (b.id === id ? { ...b, texto } : b)));
    const b = atual.current.find((x) => x.id === id);
    if (texto.startsWith('/') && b && b.tipo !== 'painel') {
      const quantas = filtrarOpcoes(texto.slice(1)).length;
      setMenu((m) => ({ blocoId: id, filtro: texto.slice(1), ativo: m?.blocoId === id ? Math.min(m.ativo, Math.max(0, quantas - 1)) : 0 }));
    } else {
      setMenu((m) => (m?.blocoId === id ? null : m));
    }
  }

  function aoEnter(id: string) {
    void confirmarLinha(id, true);
    const i = atual.current.findIndex((b) => b.id === id);
    if (i === -1) return;
    const nova = novoBloco(atual.current[i].tipo === 'lista' ? 'lista' : 'texto');
    const novos = [...atual.current];
    novos.splice(i + 1, 0, nova);
    setPedirFoco({ id: nova.id });
    mudar(novos);
  }

  function escolher(opcao: OpcaoDoMenu) {
    const alvo = menu?.blocoId ?? null;
    const e = opcao.escolha;
    const bloco = e.tipo === 'painel' ? novoPainel(e.painel) : novoBloco(e.tipo);
    // Depois de um painel vem uma linha em branco, para continuar escrevendo.
    const novos: Bloco[] = e.tipo === 'painel' ? [bloco, novoBloco('texto')] : [bloco];
    setPedirFoco({ id: novos[novos.length - 1].id });
    const lista = [...atual.current];
    const i = alvo === null ? -1 : lista.findIndex((b) => b.id === alvo);
    if (i === -1) lista.push(...novos);
    else lista.splice(i, 1, ...novos);
    setMenu(null);
    mudar(lista);
  }

  function aoTeclaDoMenu(e: KeyboardEvent, id: string) {
    if (!menu || menu.blocoId !== id) return;
    const opcoes = filtrarOpcoes(menu.filtro);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const passo = e.key === 'ArrowDown' ? 1 : -1;
      if (opcoes.length > 0) setMenu({ ...menu, ativo: (menu.ativo + passo + opcoes.length) % opcoes.length });
    } else if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      if (opcoes[menu.ativo]) escolher(opcoes[menu.ativo]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setMenu(null);
    }
  }

  function aoSair(id: string) {
    setMenu((m) => (m?.blocoId === id ? null : m));
    void confirmarLinha(id, false);
    void g.esvaziar();
  }

  function remover(id: string) {
    const lista = atual.current;
    const posicao = lista.findIndex((b) => b.id === id);
    if (posicao === -1) return;
    const bloco = lista[posicao];
    const anteriorId = lista[posicao - 1]?.id ?? null;
    void acoes.agir(async () => {
      // Some da tela já; o gravador leva a remoção (e tudo o que foi digitado) ao banco.
      mudar(lista.filter((b) => b.id !== id));
      await g.esvaziar();
      return { texto: 'Bloco removido.', entrada: desfazerDeRemocao(pagina.id, bloco, anteriorId) };
    }, 'Não consegui remover o bloco. Tente de novo.');
  }

  const opcoes = menu ? filtrarOpcoes(menu.filtro) : [];
  const rodapeAberto = menu?.blocoId === null;

  return (
    <div class="caderno-pagina" ref={raiz}>
      <TituloDaPagina pagina={pagina} />
      {blocos.length === 0 && <p class="lista-vazia-texto">Página vazia. Adicione o primeiro bloco abaixo.</p>}
      <div class="caderno-blocos">
        {blocos.map((bloco, i) => (
          <div class="caderno-bloco" data-bloco={bloco.id} data-tipo={bloco.tipo} key={bloco.id}>
            <div class="caderno-conteudo">
              {bloco.tipo === 'painel' ? (
                <PainelDoBloco painel={bloco.painel ?? 'agenda'} />
              ) : (
                <Linha
                  bloco={bloco}
                  primeira={i === 0 && blocos.length === 1}
                  menu={menu}
                  opcoes={opcoes}
                  aoTexto={aoTexto}
                  aoEnter={aoEnter}
                  aoSair={aoSair}
                  aoTeclaDoMenu={aoTeclaDoMenu}
                  aoEscolher={escolher}
                />
              )}
              {avisos[bloco.id] ? (
                <p class="caderno-aviso" role="status">
                  <span>{avisos[bloco.id].texto}</span>
                  {avisos[bloco.id].item && (
                    <button type="button" class="botao-texto" onClick={() => void desfazerItem(bloco.id)}>
                      Desfazer
                    </button>
                  )}
                </p>
              ) : (
                bloco.itemId && <p class="caderno-vinculo">Já virou item</p>
              )}
            </div>
            <button type="button" class="caderno-remover" aria-label={`Remover bloco: ${resumo(bloco)}`} onClick={() => remover(bloco.id)}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true" focusable="false">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        ))}
      </div>
      <AvisoDasAcoes acoes={acoes} />
      <div class="caderno-rodape">
        {rodapeAberto ? (
          <div class="caderno-adicionar-menu">
            <ul class="bloco-menu bloco-menu-botoes" aria-label="Escolha o bloco">
              {OPCOES_DO_MENU.map((o) => (
                <li key={o.id}>
                  <button type="button" class="bloco-menu-botao" onClick={() => escolher(o)}>
                    <span class="bloco-menu-rotulo">{o.rotulo}</span>
                    <span class="bloco-menu-dica">{o.dica}</span>
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" class="botao-texto" onClick={() => setMenu(null)}>
              Cancelar
            </button>
          </div>
        ) : (
          <button type="button" class="botao caderno-adicionar" onClick={() => setMenu({ blocoId: null, filtro: '', ativo: 0 })}>
            Adicionar bloco
          </button>
        )}
        <p class="notas-situacao" aria-live="polite">
          {SITUACAO[situacao]}
          {situacao === 'erro' && (
            <button type="button" class="botao-texto" onClick={() => void g.esvaziar()}>
              Tentar de novo
            </button>
          )}
        </p>
      </div>
    </div>
  );
}

export function Caderno({ salaId, nomeDaSala }: { salaId: string; nomeDaSala: string }) {
  const todas = usePaginas();
  const [escolhida, setEscolhida] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const criando = useRef(false);

  const daSala = (todas ?? []).filter((p) => p.salaId === salaId && !p.apagado).sort((a, b) => a.titulo.localeCompare(b.titulo, 'pt-BR', { numeric: true }));
  const aberta = daSala.find((p) => p.id === escolhida) ?? daSala[0];

  async function nova() {
    if (criando.current) return;
    criando.current = true;
    setErro(null);
    try {
      const criada = await criarPagina(salaId, `Página ${daSala.length + 1}`);
      setEscolhida(criada.id);
    } catch (falha) {
      console.error('Não consegui criar a página', falha);
      setErro('Não consegui criar a página. Tente de novo.');
    } finally {
      criando.current = false;
    }
  }

  return (
    <section class="painel caderno" aria-labelledby={`titulo-caderno-${salaId}`} aria-busy={todas === undefined}>
      <h2 id={`titulo-caderno-${salaId}`}>Caderno</h2>
      {todas !== undefined && daSala.length === 0 && (
        <div>
          <p class="lista-vazia-titulo">Nenhuma página ainda.</p>
          <p class="lista-vazia-texto">{`Crie uma página para anotar o que for de ${nomeDaSala}. Linha com data vira tarefa.`}</p>
        </div>
      )}
      {daSala.length > 0 && (
        <nav class="caderno-paginas" aria-label="Páginas do caderno">
          {daSala.map((p) => (
            <button key={p.id} type="button" class="caderno-aba" aria-current={p.id === aberta?.id ? 'page' : undefined} onClick={() => setEscolhida(p.id)}>
              {p.titulo}
            </button>
          ))}
        </nav>
      )}
      {erro && (
        <p class="tarefa-erro" role="alert">
          {erro}
        </p>
      )}
      {aberta && <PaginaAberta key={aberta.id} pagina={aberta} salaId={salaId} nomeDaSala={nomeDaSala} />}
      <button type="button" class="botao-texto caderno-nova" onClick={() => void nova()}>
        Nova página
      </button>
    </section>
  );
}
