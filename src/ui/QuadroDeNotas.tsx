// Quadro de notas independentes de uma sala ou de uma subpasta comum: cada nota é de texto ou de lista, tem a sua data
// e o seu "Salvar nota". Nada grava sozinho: o que se escreve só vira nota ao salvar.
//
//   - "Nova nota" abre o menu Texto/Lista; o formulário aparece no topo. "Salvar nota" (ou Ctrl+Enter) grava e fecha.
//   - Editar abre o mesmo formulário com o conteúdo, no lugar do cartão; Cancelar volta como estava.
//   - A caixinha de cada item de uma lista marca e desmarca na hora, sem abrir o Editar.
//   - Apagar é de um clique, com Desfazer.
//   - Um formulário aberto guarda o que mostra: uma versão nova da mesma nota que chegue de outro aparelho não o
//     redesenha (nem apaga o que se digitou), e o Salvar grava o que o formulário mostra.
//   - Ao abrir, roda a migração do que existia antes (texto único da sala, página "Notas" da subpasta).
import { useEffect, useRef, useState } from 'preact/hooks';
import { desfazer } from '../dados/desfazer';
import {
  ITENS_NO_MAXIMO,
  ITEM_NO_MAXIMO,
  NOTA_NAO_ENCONTRADA,
  NOTA_NO_MAXIMO,
  NOTA_VAZIA,
  apagarNota,
  criarNota,
  editarNota,
  marcarItem,
  migrarNotasAntigas,
  migrarPaginaDaPasta,
  restaurarNota,
} from '../dados/notas-independentes';
import type { ItemDeNota, Nota } from '../dados/tipos';
import { AvisoDasAcoes, useAcoes } from './Acoes';
import { useNotas, usePastas } from './hooks';
import './quadro-de-notas.css';

const NO_FUSO = (opcoes: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'Europe/Lisbon', hourCycle: 'h23', ...opcoes });
const DIA_E_HORA = NO_FUSO({ day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const ANO = NO_FUSO({ year: 'numeric' });

/** `23/11 15:40`, hora de Lisboa como no resto do app; com o ano (`23/11/2025 15:40`) só quando não é o de agora. */
export function dataDaNota(criadaEm: number, agora: number = Date.now()): string {
  const partes = DIA_E_HORA.formatToParts(criadaEm);
  const parte = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? '';
  const ano = ANO.format(criadaEm);
  const dia = ano === ANO.format(agora) ? `${parte('day')}/${parte('month')}` : `${parte('day')}/${parte('month')}/${ano}`;
  return `${dia} ${parte('hour')}:${parte('minute')}`;
}

type Rascunho = { texto: string; itens: ItemDeNota[] };

const itemVazio = (): ItemDeNota => ({ id: crypto.randomUUID(), texto: '' });

function FormularioDeNota({
  tipo,
  inicial,
  aoSalvar,
  aoCancelar,
}: {
  tipo: 'texto' | 'lista';
  inicial?: Nota;
  /** Grava e devolve o texto de erro (ou `null` se gravou). */
  aoSalvar: (rascunho: Rascunho) => Promise<string | null>;
  aoCancelar: () => void;
}) {
  const [texto, setTexto] = useState(inicial?.texto ?? '');
  const [itens, setItens] = useState<ItemDeNota[]>(() => (inicial?.itens?.length ? inicial.itens.map((i) => ({ ...i })) : [itemVazio()]));
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const raiz = useRef<HTMLFormElement>(null);
  const [focoNoItem, setFocoNoItem] = useState<string | null>(null);

  // Ao abrir, o cursor já está no campo; ao criar um item novo, nele.
  useEffect(() => {
    raiz.current?.querySelector<HTMLElement>(tipo === 'texto' ? 'textarea' : 'input[type="text"]')?.focus();
  }, [tipo]);
  useEffect(() => {
    if (focoNoItem) raiz.current?.querySelector<HTMLElement>(`[data-item="${focoNoItem}"]`)?.focus();
  }, [focoNoItem]);

  async function salvar(e?: Event) {
    e?.preventDefault();
    if (salvando) return;
    setSalvando(true);
    setErro(null);
    try {
      const falha = await aoSalvar({ texto, itens });
      if (falha) {
        setErro(falha);
        raiz.current?.querySelector<HTMLElement>('textarea, input[type="text"]')?.focus();
      }
    } finally {
      setSalvando(false);
    }
  }

  const aoTeclar = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void salvar();
    }
  };

  function mudarItem(id: string, novo: string) {
    setItens((atuais) => atuais.map((i) => (i.id === id ? { ...i, texto: novo } : i)));
  }

  function itemDepoisDe(id: string) {
    const novo = itemVazio();
    setItens((atuais) => {
      if (atuais.length >= ITENS_NO_MAXIMO) return atuais;
      const posicao = atuais.findIndex((i) => i.id === id);
      const copia = [...atuais];
      copia.splice(posicao === -1 ? copia.length : posicao + 1, 0, novo);
      return copia;
    });
    setFocoNoItem(novo.id);
  }

  function tirarItem(id: string) {
    setItens((atuais) => {
      const resto = atuais.filter((i) => i.id !== id);
      return resto.length > 0 ? resto : [itemVazio()];
    });
  }

  return (
    <form
      ref={raiz}
      class="nota-form"
      aria-label={inicial ? 'Editar nota' : tipo === 'texto' ? 'Nova nota de texto' : 'Nova nota de lista'}
      onSubmit={(e) => void salvar(e)}
      noValidate
    >
      {tipo === 'texto' ? (
        <textarea
          class="campo notas-campo nota-campo"
          aria-label="Texto da nota"
          placeholder="Escreva aqui…"
          maxLength={NOTA_NO_MAXIMO}
          value={texto}
          spellcheck
          aria-invalid={erro ? 'true' : undefined}
          onInput={(e) => setTexto((e.target as HTMLTextAreaElement).value)}
          onKeyDown={aoTeclar}
        />
      ) : (
        <ul class="nota-itens" aria-label="Itens da lista">
          {itens.map((item, i) => (
            <li key={item.id} class="nota-item-linha">
              <input
                type="text"
                class="campo nota-item-campo"
                data-item={item.id}
                aria-label={`Item ${i + 1}`}
                placeholder="Item"
                autoComplete="off"
                maxLength={ITEM_NO_MAXIMO}
                value={item.texto}
                aria-invalid={erro ? 'true' : undefined}
                onInput={(e) => mudarItem(item.id, (e.target as HTMLInputElement).value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !(e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    itemDepoisDe(item.id);
                  } else aoTeclar(e);
                }}
              />
              <button type="button" class="botao-texto nota-item-tirar" aria-label={`Remover item ${i + 1}`} onClick={() => tirarItem(item.id)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {tipo === 'lista' && (
        <button type="button" class="botao-texto nota-item-novo" disabled={itens.length >= ITENS_NO_MAXIMO} onClick={() => itemDepoisDe(itens[itens.length - 1]?.id ?? '')}>
          + item
        </button>
      )}
      {erro && (
        <p class="tarefa-erro" role="alert">
          {erro}
        </p>
      )}
      <div class="nota-form-botoes">
        <button type="button" class="botao-texto" onClick={aoCancelar}>
          Cancelar
        </button>
        <button type="submit" class="botao primario" disabled={salvando}>
          Salvar nota
        </button>
      </div>
    </form>
  );
}

function CartaoDeNota({
  nota,
  aoEditar,
  aoApagar,
  aoFalhar,
}: {
  nota: Nota;
  aoEditar: () => void;
  aoApagar: () => void;
  aoFalhar: (mensagem: string) => void;
}) {
  const data = dataDaNota(nota.criadaEm);
  async function marcar(e: Event, item: ItemDeNota) {
    const caixa = e.currentTarget as HTMLInputElement;
    const feito = caixa.checked;
    try {
      await marcarItem(nota.id, item.id, feito);
    } catch (falha) {
      console.error('Não consegui marcar o item', falha);
      caixa.checked = !!item.feito;
      aoFalhar(falha instanceof Error && falha.message === NOTA_NAO_ENCONTRADA ? 'Esta nota não existe mais.' : 'Não consegui marcar o item. Tente de novo.');
    }
  }
  return (
    <li class="nota-cartao" data-tipo={nota.tipo} aria-label={`Nota de ${data}`}>
      <div class="nota-cabeca">
        <span class="nota-data">
          {data}
          {nota.tipo === 'lista' ? ' · Lista' : ''}
        </span>
        <span class="nota-acoes">
          <button type="button" class="botao-texto" aria-label={`Editar a nota de ${data}`} onClick={aoEditar}>
            Editar
          </button>
          <button type="button" class="botao-texto" aria-label={`Apagar a nota de ${data}`} onClick={aoApagar}>
            Apagar
          </button>
        </span>
      </div>
      {nota.tipo === 'texto' ? (
        <p class="nota-texto">{nota.texto}</p>
      ) : (
        <ul class="nota-itens-lista" aria-label={`Itens da nota de ${data}`}>
          {(nota.itens ?? []).map((item) => (
            <li key={item.id}>
              <label class={`nota-item${item.feito ? ' feito' : ''}`}>
                <input type="checkbox" class="caixa" checked={!!item.feito} onChange={(e) => void marcar(e, item)} />
                <span>{item.texto}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function QuadroDeNotas({ salaId, pastaId, titulo }: { salaId: string; pastaId?: string; titulo: string }) {
  const todas = useNotas();
  const pastas = usePastas();
  const acoes = useAcoes();
  const [menuAberto, setMenuAberto] = useState(false);
  const [nova, setNova] = useState<'texto' | 'lista' | null>(null);
  /** A nota em edição, como estava ao abrir: se ela some da lista (apagada em outro aparelho), o formulário e o texto ficam. */
  const [editando, setEditando] = useState<Nota | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const botaoNova = useRef<HTMLButtonElement>(null);
  const idDoTitulo = `titulo-notas-${pastaId ?? salaId}`;

  // Traz para cá o que existia antes, uma vez por sala ou subpasta (a migração é idempotente).
  useEffect(() => {
    const migrar = pastaId ? migrarPaginaDaPasta(salaId, pastaId) : migrarNotasAntigas(salaId);
    migrar.catch((falha) => console.error('Não consegui trazer as notas antigas', falha));
  }, [salaId, pastaId]);

  // Trocar de sala ou subpasta (o bloco flutuante) fecha o que estava aberto. Na primeira vez não há o que fechar.
  const lugar = `${salaId}|${pastaId ?? ''}`;
  const lugarAnterior = useRef(lugar);
  useEffect(() => {
    if (lugarAnterior.current === lugar) return;
    lugarAnterior.current = lugar;
    setNova(null);
    setEditando(null);
    setMenuAberto(false);
    setAviso(null);
  }, [lugar]);

  // A sala mostra as notas dela e as de uma subpasta que já não existe (apagar a pasta não esconde nada, como as tarefas).
  const daSubpastaApagada = (n: Nota) => !!n.pastaId && pastas !== undefined && !pastas.some((p) => p.id === n.pastaId && p.salaId === salaId);
  const doQuadro = (todas ?? []).filter((n) => n.salaId === salaId && (pastaId ? n.pastaId === pastaId : !n.pastaId || daSubpastaApagada(n)));
  // A nota em edição que sumiu da lista continua no mesmo lugar (só o formulário, sem remontar), para o texto não se perder.
  const exibidas = (editando && !doQuadro.some((n) => n.id === editando.id) ? [...doQuadro, editando] : doQuadro).sort(
    (a, b) => b.criadaEm - a.criadaEm || a.id.localeCompare(b.id),
  );

  const voltarAoBotao = () => queueMicrotask(() => botaoNova.current?.focus());

  /** Grava a nota nova ou a editada; devolve o texto de erro, ou `null` se gravou. */
  async function gravar(nota: Nota | undefined, tipo: 'texto' | 'lista', { texto, itens }: Rascunho): Promise<string | null> {
    try {
      if (nota) await editarNota(nota.id, tipo === 'texto' ? { texto } : { itens });
      else await criarNota({ salaId, pastaId, tipo, ...(tipo === 'texto' ? { texto } : { itens }) });
    } catch (falha) {
      if (falha instanceof Error && falha.message === NOTA_VAZIA) return 'Escreva algo antes de salvar.';
      if (falha instanceof Error && falha.message === NOTA_NAO_ENCONTRADA) return 'Esta nota foi apagada em outro aparelho. Copie o texto se quiser guardá-lo.';
      console.error('Não consegui salvar a nota', falha);
      return 'Não consegui salvar. Tente de novo.';
    }
    setAviso(null);
    if (nota) {
      setEditando(null);
    } else {
      setNova(null);
      voltarAoBotao();
    }
    return null;
  }

  function apagar(nota: Nota) {
    void acoes.agir(async () => {
      const antes = await apagarNota(nota.id);
      if (!antes) return null;
      if (editando?.id === nota.id) setEditando(null);
      return { texto: 'Nota apagada.', entrada: desfazer.registrar('Nota apagada', async () => void (await restaurarNota(antes))) };
    }, 'Não consegui apagar a nota. Tente de novo.');
  }

  return (
    <section class="painel notas notas-quadro" aria-labelledby={idDoTitulo} aria-busy={todas === undefined}>
      <div class="quadro-cabeca">
        <h2 id={idDoTitulo}>{titulo}</h2>
        {nova === null && (
          <div class="quadro-nova">
            <button
              type="button"
              class="botao-pilula"
              ref={botaoNova}
              aria-expanded={menuAberto}
              aria-controls="menu-nova-nota"
              onClick={() => setMenuAberto((aberto) => !aberto)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setMenuAberto(false);
              }}
            >
              + Nova nota ▾
            </button>
            {menuAberto && (
              <div id="menu-nova-nota" class="quadro-menu" role="group" aria-label="Tipo da nota">
                {(['texto', 'lista'] as const).map((tipo) => (
                  <button
                    key={tipo}
                    type="button"
                    class="botao-texto"
                    onClick={() => {
                      acoes.limpar();
                      setAviso(null);
                      setMenuAberto(false);
                      setNova(tipo);
                    }}
                  >
                    {tipo === 'texto' ? 'Texto' : 'Lista'}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      {nova !== null && (
        <FormularioDeNota
          key={`nova-${nova}`}
          tipo={nova}
          aoSalvar={(rascunho) => gravar(undefined, nova, rascunho)}
          aoCancelar={() => {
            setNova(null);
            voltarAoBotao();
          }}
        />
      )}
      {todas !== undefined && exibidas.length === 0 && nova === null && (
        <p class="lista-vazia-texto">Nenhuma nota ainda. Use “Nova nota” para escrever.</p>
      )}
      {exibidas.length > 0 && (
        <ul class="notas-lista" aria-label={titulo}>
          {exibidas.map((nota) =>
            editando?.id === nota.id ? (
              <li key={nota.id} class="nota-cartao nota-cartao-editando">
                <FormularioDeNota
                  key={nota.id}
                  tipo={nota.tipo}
                  inicial={editando}
                  aoSalvar={(rascunho) => gravar(editando, nota.tipo, rascunho)}
                  aoCancelar={() => setEditando(null)}
                />
              </li>
            ) : (
              <CartaoDeNota
                key={nota.id}
                nota={nota}
                aoEditar={() => {
                  acoes.limpar();
                  setAviso(null);
                  setEditando(nota);
                }}
                aoApagar={() => apagar(nota)}
                aoFalhar={setAviso}
              />
            ),
          )}
        </ul>
      )}
      <AvisoDasAcoes acoes={acoes} />
      {aviso && (
        <p class="tarefa-erro" role="alert">
          {aviso}
        </p>
      )}
    </section>
  );
}
