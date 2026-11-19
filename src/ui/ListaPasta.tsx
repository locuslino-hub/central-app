// A tela de uma pasta de Lista de compras (V02, Tarefa 14): itens da planilha da Casa com caixa de marcar, "Limpar
// comprados" e o formulário "Novo item". Grava na hora e mostra o cartão com Desfazer; nunca grava em silêncio.
//
// - Só anexa linhas e muda "Comprado?" por id de linha; Desfazer marca "desfeito" na planilha (nunca apaga).
// - "Limpar comprados" só esconde da vista (neste aparelho): nenhuma linha é apagada nem mudada.
// - Item repetido (ainda não comprado) não entra em silêncio: o cartão avisa e oferece "Pôr mesmo assim".
// - O texto que vem da planilha é dado de terceiros: aparece só como texto, nunca como HTML.
// - Sem rede: mostra o que o aparelho guardou; o item novo e as marcas esperam na fila e a tela avisa.
import { useEffect, useRef, useState } from 'preact/hooks';
import { dataEmBr } from '../dados/leituras';
import { adicionarItens, ITEM_NO_MAXIMO, itemDeTexto, marcarComprado, QUANTIDADE_NO_MAXIMO, resumirLista, type ItemDaLista, type ResultadoDosItens } from '../dados/lista';
import { chaveDosOcultos } from '../dados/pastas';
import { lerPlanilha, type LeituraDePlanilha } from '../dados/planilhas';
import type { Pasta } from '../dados/tipos';
import { AvisoVivo } from './AvisoVivo';
import { useDia } from './hooks';
import {
  TEXTO_DE_ITEM_LONGO,
  TEXTO_DE_ITEM_VAZIO,
  TEXTO_DO_AVISO_DE_LEITURA,
  TEXTO_DO_AVISO_DE_PLANILHA,
  textoDeMarcarItem,
  textoDoDesfazerDeItens,
  textosDosItens,
} from './pastas-textos';
import './pastas.css';

type Carga = { situacao: 'lendo' } | { situacao: 'erro' } | { situacao: 'pronta'; lida: LeituraDePlanilha };
/** `chave` muda a cada cartão novo: o foco volta para ele mesmo quando o título é o mesmo. */
type Cartao = {
  chave: number;
  titulo: string;
  detalhe: string;
  desfazer?: () => Promise<unknown[]>;
  desfeito?: boolean;
  /** "Pôr mesmo assim": o item já estava na lista. */
  repetir?: () => void;
};
type Nota = { tipo: 'ok' | 'aviso' | 'erro'; texto: string };

// ---------- o que está limpo da vista (só neste aparelho) ----------


function lerOcultos(pastaId: string): string[] {
  try {
    const bruto = JSON.parse(localStorage.getItem(chaveDosOcultos(pastaId)) ?? '[]') as unknown;
    return Array.isArray(bruto) ? bruto.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function guardarOcultos(pastaId: string, ids: readonly string[]): void {
  try {
    if (ids.length === 0) localStorage.removeItem(chaveDosOcultos(pastaId));
    else localStorage.setItem(chaveDosOcultos(pastaId), JSON.stringify(ids));
  } catch {
    // Sem armazenamento (janela privada, cheio): a vista limpa só vale até fechar a tela.
  }
}

/** "2 · Marina · 01/11/2026". Quantidade, quem pôs e data, só o que existir. */
function detalheDoItem(item: ItemDaLista): string {
  const partes: string[] = [];
  if (item.quantidade) partes.push(item.quantidade);
  if (item.quemPos) partes.push(item.quemPos);
  if (item.data) partes.push(/^\d{4}-\d{2}-\d{2}$/.test(item.data) ? dataEmBr(item.data) : item.data);
  return partes.join(' · ');
}

export function ListaPasta({ pasta }: { pasta: Pasta }) {
  const hoje = useDia();
  const [carga, setCarga] = useState<Carga>({ situacao: 'lendo' });
  const [versao, setVersao] = useState(0);
  const [item, setItem] = useState('');
  const [quantidade, setQuantidade] = useState('');
  const [erroDoCampo, setErroDoCampo] = useState<string | null>(null);
  const [nota, setNota] = useState<Nota | null>(null);
  const [cartao, setCartao] = useState<Cartao | null>(null);
  const [ocupada, setOcupada] = useState(false);
  /** A caixa marcada que ainda espera a planilha: vale na tela até a próxima leitura. */
  const [otimista, setOtimista] = useState<Record<string, boolean>>({});
  const [ocupados, setOcupados] = useState<readonly string[]>([]);
  const [ocultos, setOcultos] = useState<string[]>(() => lerOcultos(pasta.id));
  const [mostrarOcultos, setMostrarOcultos] = useState(false);
  const emCurso = useRef(false);
  const emCursoPorItem = useRef(new Set<string>());
  const proximoCartao = useRef(0);
  const cartaoRef = useRef<HTMLElement>(null);
  const secaoRef = useRef<HTMLElement>(null);
  const [focoNoItem, setFocoNoItem] = useState<{ id: string; n: number } | null>(null);
  const pedidosDeFoco = useRef(0);
  const campoItem = useRef<HTMLInputElement>(null);
  const botaoAlternar = useRef<HTMLButtonElement>(null);
  /** Sobe quando o foco precisa ir ao botão Mostrar/Ocultar comprados (o "Limpar comprados" sumiu com a vista). */
  const [focoNoAlternar, setFocoNoAlternar] = useState(0);
  const pastaRef = useRef(pasta);
  pastaRef.current = pasta;
  const temPlanilha = typeof pasta.planilhaId === 'string' && pasta.planilhaId !== '';

  // Lê a planilha ao abrir, ao pedir "Reler" e ao voltar a rede. Durante uma releitura a lista não some.
  useEffect(() => {
    if (!temPlanilha) return;
    let vivo = true;
    lerPlanilha(pastaRef.current)
      .then((lida) => {
        if (!vivo) return;
        setCarga({ situacao: 'pronta', lida });
        // A leitura já mostra o que foi marcado; só segue valendo a marca de quem ainda espera resposta.
        setOtimista((o) => Object.fromEntries(Object.entries(o).filter(([id]) => emCursoPorItem.current.has(id))));
        if (!lida.doCache) {
          // O que voltou a "a comprar" (ou sumiu da planilha) deixa de estar oculto: se for comprado de novo, reaparece.
          const comprados = new Set(resumirLista(lida.linhas).itens.filter((i) => i.comprado).map((i) => i.id));
          setOcultos((atuais) => {
            const ficam = atuais.filter((id) => comprados.has(id));
            if (ficam.length === atuais.length) return atuais;
            guardarOcultos(pastaRef.current.id, ficam);
            return ficam;
          });
        }
      })
      .catch((causa: unknown) => {
        console.error('Não consegui ler a planilha de compras', causa);
        if (vivo) setCarga((atual) => (atual.situacao === 'pronta' ? atual : { situacao: 'erro' }));
      });
    return () => {
      vivo = false;
    };
  }, [pasta.id, pasta.planilhaId, pasta.modelo, temPlanilha, versao]);
  useEffect(() => {
    const reler = () => setVersao((v) => v + 1);
    window.addEventListener('online', reler);
    return () => window.removeEventListener('online', reler);
  }, []);
  useEffect(() => {
    if (cartao) cartaoRef.current?.focus();
  }, [cartao?.chave]);
  useEffect(() => {
    if (focoNoAlternar > 0) botaoAlternar.current?.focus();
  }, [focoNoAlternar]);
  // Marcar leva o item para a outra lista (o elemento é outro): o foco acompanha o item, por id.
  useEffect(() => {
    if (!focoNoItem) return;
    const caixas = secaoRef.current?.querySelectorAll<HTMLInputElement>('input[data-item-id]') ?? [];
    for (const caixa of caixas) {
      if (caixa.dataset.itemId === focoNoItem.id) {
        caixa.focus();
        break;
      }
    }
  }, [focoNoItem]);

  if (!temPlanilha) {
    return (
      <section class="painel pasta-conteudo lista" data-tipo="lista" aria-labelledby="titulo-pasta-conteudo">
        <h2 id="titulo-pasta-conteudo">Itens</h2>
        <p class="lista-vazia-titulo">Esta pasta ainda não tem planilha.</p>
        <p class="lista-vazia-texto">Apague a pasta e crie de novo em Nova pasta, para a Central criar a planilha de compras.</p>
      </section>
    );
  }

  const lida = carga.situacao === 'pronta' ? carga.lida : null;
  const resumo = lida ? resumirLista(lida.linhas) : null;
  const todos = (resumo?.itens ?? []).map((i) => ({ ...i, comprado: otimista[i.id] ?? i.comprado }));
  const aComprar = todos.filter((i) => !i.comprado);
  const compradosTodos = todos.filter((i) => i.comprado);
  const escondidos = new Set(ocultos);
  const compradosVisiveis = mostrarOcultos ? compradosTodos : compradosTodos.filter((i) => !escondidos.has(i.id));
  const quantosOcultos = compradosTodos.filter((i) => escondidos.has(i.id)).length;
  const temParaLimpar = compradosTodos.some((i) => !escondidos.has(i.id));

  function limparComprados() {
    const ids = [...new Set([...ocultos, ...compradosTodos.map((i) => i.id)])];
    setOcultos(ids);
    guardarOcultos(pastaRef.current.id, ids);
    setMostrarOcultos(false);
    setFocoNoAlternar((n) => n + 1);
  }

  async function marcar(linha: ItemDaLista & { comprado: boolean }, comprado: boolean, tinhaFoco: boolean) {
    if (emCursoPorItem.current.has(linha.id)) return;
    emCursoPorItem.current.add(linha.id);
    setOcupados([...emCursoPorItem.current]);
    setOtimista((o) => ({ ...o, [linha.id]: comprado }));
    const levarOFoco = () => tinhaFoco && setFocoNoItem({ id: linha.id, n: ++pedidosDeFoco.current });
    levarOFoco();
    setNota(null);
    const desfazerMarca = () => setOtimista(({ [linha.id]: _tirada, ...resto }) => resto);
    try {
      const resultado = await marcarComprado(pastaRef.current, linha.id, comprado);
      const dito = textoDeMarcarItem(resultado, linha.item, comprado);
      setNota(dito);
      if (resultado === 'conflito' || resultado === 'sumiu') {
        desfazerMarca();
        setVersao((v) => v + 1);
      } else if (dito.tipo === 'erro') desfazerMarca();
    } catch (causa) {
      console.error('Não consegui marcar o item', causa);
      desfazerMarca();
      setNota({ tipo: 'erro', texto: 'Não consegui marcar agora. Nada mudou. Tente de novo.' });
    } finally {
      emCursoPorItem.current.delete(linha.id);
      setOcupados([...emCursoPorItem.current]);
      levarOFoco(); // o item pode ter mudado de lugar de novo (marca desfeita, releitura)
    }
  }

  /** Grava os itens. `repetir`: grava mesmo os que já estão na lista. */
  async function adicionar(textos: string[], quantidades: string[], repetir: boolean) {
    if (emCurso.current) return;
    emCurso.current = true;
    setOcupada(true);
    setNota(null);
    try {
      const resultado = await adicionarItens(pastaRef.current, textos, { hoje, repetir, quantidades });
      if (resultado.criados.length === 0 && resultado.bloqueio) {
        setNota({ tipo: 'erro', texto: TEXTO_DO_AVISO_DE_PLANILHA[resultado.bloqueio] });
        return;
      }
      const chave = ++proximoCartao.current;
      const falta = resultado.repetidos.map((t) => ({ texto: t, quantidade: quantidades[textos.indexOf(t)] ?? '' }));
      setCartao(
        cartaoDosItens(pasta.nome, resultado, chave, {
          reler: () => setVersao((v) => v + 1),
          mudarCartao: (c) => setCartao({ ...c, chave: ++proximoCartao.current }),
          repetir: falta.length > 0 ? () => void adicionar(falta.map((f) => f.texto), falta.map((f) => f.quantidade), true) : undefined,
        }),
      );
      if (resultado.criados.length > 0) {
        setItem('');
        setQuantidade('');
        setVersao((v) => v + 1);
      }
    } catch (causa) {
      console.error('Não consegui gravar o item', causa);
      setNota({ tipo: 'erro', texto: 'Não consegui gravar o item. Nada foi gravado. Tente de novo.' });
    } finally {
      emCurso.current = false;
      setOcupada(false);
    }
  }

  function guardar(evento: Event) {
    evento.preventDefault();
    if (emCurso.current) return;
    const texto = itemDeTexto(item);
    if (texto === null) {
      setErroDoCampo(item.trim() === '' ? TEXTO_DE_ITEM_VAZIO : TEXTO_DE_ITEM_LONGO(ITEM_NO_MAXIMO));
      campoItem.current?.focus();
      return;
    }
    setErroDoCampo(null);
    void adicionar([texto], [quantidade.trim()], false);
  }

  async function desfazer() {
    const atual = cartao;
    if (!atual?.desfazer || emCurso.current) return;
    emCurso.current = true;
    setOcupada(true);
    setNota(null);
    try {
      await atual.desfazer();
    } catch (causa) {
      console.error('Não consegui desfazer o item', causa);
      setNota({ tipo: 'erro', texto: 'Não consegui desfazer agora. Tente de novo.' });
    } finally {
      emCurso.current = false;
      setOcupada(false);
    }
  }

  const aviso = lida?.aviso ? TEXTO_DO_AVISO_DE_LEITURA[lida.aviso] : lida?.doCache ? 'Sem internet: mostrando o que este aparelho guardou da planilha.' : null;

  const linhaDoItem = (linha: ItemDaLista & { comprado: boolean }, indice: number, grupo: string) => {
    const detalhe = detalheDoItem(linha);
    const idDoDetalhe = `lista-${grupo}-${indice}`;
    return (
      <li key={linha.id} class={linha.comprado ? 'lista-item lista-item-comprado' : 'lista-item'}>
        <label class="lista-caixa">
          <input
            type="checkbox"
            checked={linha.comprado}
            data-item-id={linha.id}
            aria-disabled={ocupados.includes(linha.id) ? 'true' : undefined}
            aria-describedby={detalhe || linha.pendente ? idDoDetalhe : undefined}
            onChange={(e) => {
              const caixa = e.currentTarget;
              // Gravando: aria-disabled não impede o toque, então a caixa volta ao que era e nada é pedido de novo.
              if (ocupados.includes(linha.id)) {
                caixa.checked = linha.comprado;
                return;
              }
              void marcar(linha, caixa.checked, document.activeElement === caixa);
            }}
          />
          <span class="lista-item-nome">{linha.item}</span>
        </label>
        {(detalhe || linha.pendente) && (
          <span class="lista-item-detalhe" id={idDoDetalhe}>
            {detalhe}
            {linha.pendente === 'fila' && <span class="registro-obs">Salva ao voltar a rede</span>}
          </span>
        )}
      </li>
    );
  };

  return (
    <section ref={secaoRef} class="painel pasta-conteudo lista" data-tipo="lista" aria-labelledby="titulo-pasta-conteudo">
      <h2 id="titulo-pasta-conteudo">Itens</h2>

      {/* A região viva existe desde o começo, vazia: só o texto dentro dela muda. */}
      <AvisoVivo>
        {aviso && <p class="registro-aviso">{aviso}</p>}
        {nota?.tipo === 'aviso' && <p class="registro-aviso">{nota.texto}</p>}
        {nota?.tipo === 'ok' && <p class="so-leitor">{nota.texto}</p>}
      </AvisoVivo>
      {carga.situacao === 'erro' && (
        <p class="pastas-erro" role="alert">
          <span>Não consegui ler a planilha agora.</span>
          <button type="button" class="botao-pilula" onClick={() => setVersao((v) => v + 1)}>
            Tentar de novo
          </button>
        </p>
      )}

      <div class="pastas-resultado">
        {cartao && (
          <article class="pastas-cartao" ref={cartaoRef} tabIndex={-1} aria-labelledby="lista-cartao-titulo" aria-describedby="lista-cartao-detalhe">
            <p class="pastas-cartao-titulo" id="lista-cartao-titulo">
              {cartao.titulo}
            </p>
            <p class="pastas-cartao-detalhe" id="lista-cartao-detalhe">
              {cartao.detalhe}
            </p>
            <div class="pastas-cartao-acoes">
              {!cartao.desfeito && cartao.desfazer && (
                <button type="button" class="botao-pilula" disabled={ocupada} onClick={() => void desfazer()}>
                  Desfazer
                </button>
              )}
              {!cartao.desfeito && cartao.repetir && (
                <button type="button" class="botao-pilula" disabled={ocupada} onClick={cartao.repetir}>
                  Pôr mesmo assim
                </button>
              )}
              <button
                type="button"
                class="botao-pilula"
                onClick={() => {
                  setCartao(null);
                  campoItem.current?.focus(); // o botão some com o cartão: o foco vai ao campo que o gerou
                }}
              >
                Fechar
              </button>
            </div>
          </article>
        )}
      </div>

      {nota?.tipo === 'erro' && (
        <p class="pastas-erro" role="alert">
          {nota.texto}
        </p>
      )}
      <form class="pastas-form lista-form" aria-label="Novo item" onSubmit={guardar}>
        <h3 class="registro-titulo">Novo item</h3>
        <div class="lista-campos">
          <div class="pastas-campo lista-campo-item">
            <label for="lista-item">Item</label>
            <input
              ref={campoItem}
              id="lista-item"
              class="campo"
              type="text"
              autoComplete="off"
              value={item}
              aria-invalid={erroDoCampo ? 'true' : undefined}
              aria-describedby={erroDoCampo ? 'lista-item-erro' : undefined}
              onInput={(e) => {
                setItem(e.currentTarget.value);
                setErroDoCampo(null);
              }}
            />
          </div>
          <div class="pastas-campo lista-campo-quantidade">
            <label for="lista-quantidade">Quantidade (opcional)</label>
            <input id="lista-quantidade" class="campo" type="text" maxLength={QUANTIDADE_NO_MAXIMO} autoComplete="off" value={quantidade} onInput={(e) => setQuantidade(e.currentTarget.value)} />
          </div>
          <button type="submit" class="botao-pilula lista-botao" disabled={ocupada}>
            Pôr na lista
          </button>
        </div>
        {erroDoCampo && (
          <p class="pastas-campo-erro" id="lista-item-erro" role="alert">
            {erroDoCampo}
          </p>
        )}
      </form>

      {carga.situacao === 'lendo' && <p class="registro-nota">Lendo a planilha…</p>}

      {resumo && resumo.naoSalvos.length > 0 && (
        <p class="registro-aviso">
          {resumo.naoSalvos.length === 1
            ? '1 item não chegou à planilha. Veja o aviso no alto da página.'
            : `${resumo.naoSalvos.length} itens não chegaram à planilha. Veja o aviso no alto da página.`}
        </p>
      )}

      {resumo && todos.length === 0 && <p class="lista-vazia-texto">A lista está vazia. Escreva o primeiro item acima, ou diga "põe leite e pão nas compras da semana" no Pode falar.</p>}

      {aComprar.length > 0 && (
        <div class="lista-grupo">
          <h3 class="registro-titulo">{`A comprar (${aComprar.length})`}</h3>
          <ul class="lista-itens" aria-label="Itens a comprar">
            {aComprar.map((linha, i) => linhaDoItem(linha, i, 'a'))}
          </ul>
        </div>
      )}

      {compradosTodos.length > 0 && (
        <div class="lista-grupo">
          <div class="lista-grupo-cabeca">
            <h3 class="registro-titulo">{`Comprados (${compradosTodos.length})`}</h3>
            <span class="lista-grupo-acoes">
              {temParaLimpar && (
                <button type="button" class="botao-texto" onClick={limparComprados}>
                  Limpar comprados
                </button>
              )}
              {/* Um só botão para mostrar e ocultar, sempre no mesmo lugar: o foco não se perde. */}
              {quantosOcultos > 0 && (
                <button ref={botaoAlternar} type="button" class="botao-texto" aria-expanded={mostrarOcultos} onClick={() => setMostrarOcultos((m) => !m)}>
                  {mostrarOcultos ? 'Ocultar comprados' : `Mostrar comprados (${quantosOcultos})`}
                </button>
              )}
            </span>
          </div>
          {compradosVisiveis.length > 0 && (
            <ul class="lista-itens" aria-label="Itens comprados">
              {compradosVisiveis.map((linha, i) => linhaDoItem(linha, i, 'c'))}
            </ul>
          )}
          {compradosVisiveis.length === 0 && <p class="registro-nota">Os comprados estão ocultos. A planilha continua com todos.</p>}
        </div>
      )}

      <p>
        <button type="button" class="botao-texto" onClick={() => setVersao((v) => v + 1)}>
          Reler a planilha
        </button>
      </p>
    </section>
  );
}

/** O cartão dos itens guardados, com o Desfazer (que troca o cartão por "Item desfeito") e, se couber, "Pôr mesmo assim". */
function cartaoDosItens(
  nomeDaPasta: string,
  resultado: ResultadoDosItens,
  chave: number,
  { reler, mudarCartao, repetir }: { reler: () => void; mudarCartao: (c: Omit<Cartao, 'chave'>) => void; repetir?: () => void },
): Cartao {
  const { titulo, detalhe } = textosDosItens(nomeDaPasta, resultado);
  const guardou = resultado.criados.length > 0;
  return {
    chave,
    titulo,
    detalhe,
    ...(repetir ? { repetir } : {}),
    ...(guardou
      ? {
          desfazer: async () => {
            // O texto vem do que de fato aconteceu: o item pode ter saído da fila antes de o dono tocar em Desfazer.
            const saidas = await resultado.desfazer();
            mudarCartao({ ...textoDoDesfazerDeItens(saidas, saidas.length > 1), desfeito: true });
            reler();
            return saidas;
          },
        }
      : {}),
  };
}
