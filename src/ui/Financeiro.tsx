// A tela do Financeiro (V02, Tarefa 16): a pasta de tipo Planilha da Casa. Mostra os cartões do mês (total, maior categoria,
// quantos lançamentos), as barras por categoria, a tabela "Gastos do mês" (a data mais recente primeiro) e o formulário
// "Novo gasto". Grava na hora e mostra o cartão com Desfazer; nunca grava em silêncio. Só no computador: no celular
// (aparelho de toque com tela estreita, não janela estreita) diz "Abra no computador"; a voz de gasto funciona nos dois.
// No computador com a janela estreita ou com zoom, a tela continua: a tabela rola dentro do próprio quadro.
//
// - Só anexa linhas; Desfazer marca "desfeito" na planilha e esconde a linha (nunca apaga).
// - Os totais saem das linhas, calculados aqui (`resumoDoMes`); linha com valor ou data ilegível fica fora da conta e a
//   tela avisa quais são.
// - O texto que vem da planilha é dado de terceiros: aparece só como texto, nunca como HTML.
// - Sem rede: mostra o que o aparelho guardou; o gasto novo espera na fila e o cartão avisa. Só em €.
import { useEffect, useRef, useState } from 'preact/hooks';
import { normalizar } from '../chat/datas';
import {
  canonicalizarCategoria,
  categoriasEmUso,
  CATEGORIA_NO_MAXIMO,
  DESCRICAO_NO_MAXIMO,
  lerLancamentos,
  QUEM_NO_MAXIMO,
  quemEmUso,
  registrarGasto,
  resumoDoMes,
  TIPO_NO_MAXIMO,
  TIPO_PADRAO,
  tiposEmUso,
  valorDeTexto,
  type LeituraDeLancamentos,
} from '../dados/financeiro';
import { dataDeTexto, dataEmBr } from '../dados/leituras';
import type { Pasta } from '../dados/tipos';
import { AvisoVivo } from './AvisoVivo';
import { useAparelhoCelular, useDia } from './hooks';
import { Icone } from './icones';
import {
  eurosEmBr,
  linkDaPlanilha,
  TEXTO_DO_AVISO_DE_LEITURA,
  TEXTO_DO_AVISO_DE_PLANILHA,
  TEXTO_DO_GASTO_NA_VOZ,
  textosDoGasto,
} from './pastas-textos';
import './pastas.css';

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const LINHAS_DA_TABELA = 40;

/** `2026-11` → `novembro de 2026`. */
const nomeDoMes = (mes: string): string => `${MESES[Number(mes.slice(5, 7)) - 1] ?? mes.slice(5, 7)} de ${mes.slice(0, 4)}`;

/** O mês `delta` meses depois de `mes` (`AAAA-MM`); `delta` negativo volta. */
function somarMeses(mes: string, delta: number): string {
  const indice = Number(mes.slice(0, 4)) * 12 + (Number(mes.slice(5, 7)) - 1) + delta;
  return `${Math.floor(indice / 12)}-${String((indice % 12) + 1).padStart(2, '0')}`;
}

type Carga = { situacao: 'lendo' } | { situacao: 'erro' } | { situacao: 'pronta'; lida: LeituraDeLancamentos };
/** `chave` muda a cada cartão novo: o foco volta para ele mesmo quando o título é o mesmo. */
type CampoComErro = 'valor' | 'descricao' | 'data' | null;
type Cartao = { chave: number; titulo: string; detalhe: string; desfazer?: () => Promise<void>; desfeito?: boolean };

export function Financeiro({ pasta }: { pasta: Pasta }) {
  const hoje = useDia();
  const celular = useAparelhoCelular();
  const [carga, setCarga] = useState<Carga>({ situacao: 'lendo' });
  const [versao, setVersao] = useState(0);
  const [mesEscolhido, setMesEscolhido] = useState<string | null>(null);
  const [mostrarTodos, setMostrarTodos] = useState(false);
  const [valor, setValor] = useState('');
  const [descricao, setDescricao] = useState('');
  const [categoria, setCategoria] = useState('');
  const [tipoEscolhido, setTipoEscolhido] = useState<string | null>(null);
  const [quem, setQuem] = useState('');
  const [dataDigitada, setDataDigitada] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  /** O campo a que o erro se refere (para marcar `aria-invalid` só nele); erros gerais não marcam nenhum. */
  const [campoComErro, setCampoComErro] = useState<CampoComErro>(null);
  /** Uma leitura em andamento (a primeira ou uma releitura) e se a última releitura falhou com dados já na tela. */
  const [lendo, setLendo] = useState(false);
  const [falhouAtualizar, setFalhouAtualizar] = useState(false);
  const [cartao, setCartao] = useState<Cartao | null>(null);
  const [ocupada, setOcupada] = useState(false);
  const emCurso = useRef(false);
  const proximoCartao = useRef(0);
  const cartaoRef = useRef<HTMLElement>(null);
  const campoValor = useRef<HTMLInputElement>(null);
  const campoDescricao = useRef<HTMLInputElement>(null);
  const campoData = useRef<HTMLInputElement>(null);
  const pastaRef = useRef(pasta);
  pastaRef.current = pasta;
  const temPlanilha = typeof pasta.planilhaId === 'string' && pasta.planilhaId !== '';

  // Lê a planilha ao abrir, ao pedir "Reler" e ao voltar a rede. Durante uma releitura a tabela não some. No celular a
  // tela não existe: nem lê.
  useEffect(() => {
    if (!temPlanilha || celular) return;
    let vivo = true;
    setLendo(true);
    lerLancamentos(pastaRef.current)
      .then((lida) => {
        if (!vivo) return;
        setCarga({ situacao: 'pronta', lida });
        setFalhouAtualizar(false);
        setLendo(false);
      })
      .catch((causa: unknown) => {
        console.error('Não consegui ler a planilha do Financeiro', causa);
        if (!vivo) return;
        // Com dados já na tela, a tabela fica e um aviso diz que não deu para atualizar.
        setCarga((atual) => (atual.situacao === 'pronta' ? atual : { situacao: 'erro' }));
        setFalhouAtualizar(true);
        setLendo(false);
      });
    return () => {
      vivo = false;
    };
  }, [pasta.id, pasta.planilhaId, pasta.modelo, temPlanilha, celular, versao]);
  useEffect(() => {
    if (celular) return;
    const reler = () => setVersao((v) => v + 1);
    window.addEventListener('online', reler);
    return () => window.removeEventListener('online', reler);
  }, [celular]);
  useEffect(() => {
    if (cartao) cartaoRef.current?.focus();
  }, [cartao?.chave]);

  if (celular) {
    return (
      <section class="painel pasta-conteudo financeiro" data-tipo="planilha" aria-labelledby="titulo-pasta-conteudo">
        <h2 id="titulo-pasta-conteudo">Lançamentos</h2>
        <div class="fin-so-pc">
          <p class="lista-vazia-titulo">Abra no computador</p>
          <p class="lista-vazia-texto">
            A tela do Financeiro só funciona no computador. Lançar um gasto falando já funciona aqui: toque no microfone e diga "gastei 5,50 em salgado".
          </p>
        </div>
      </section>
    );
  }

  if (!temPlanilha) {
    return (
      <section class="painel pasta-conteudo financeiro" data-tipo="planilha" aria-labelledby="titulo-pasta-conteudo">
        <h2 id="titulo-pasta-conteudo">Lançamentos</h2>
        <p class="lista-vazia-titulo">Esta pasta ainda não tem planilha.</p>
        <p class="lista-vazia-texto">Apague a pasta e crie de novo em Nova pasta, para a Central criar a planilha de lançamentos.</p>
      </section>
    );
  }

  const lida = carga.situacao === 'pronta' ? carga.lida : null;
  const lancamentos = lida?.lancamentos ?? [];
  const categorias = categoriasEmUso(lancamentos);
  const mesDeHoje = hoje.slice(0, 7);
  const meses = lancamentos.map((l) => l.data.slice(0, 7)).sort();
  const primeiroMes = meses[0] && meses[0] < mesDeHoje ? meses[0] : mesDeHoje;
  const ultimoMes = meses.length > 0 && meses[meses.length - 1]! > mesDeHoje ? meses[meses.length - 1]! : mesDeHoje;
  const mes = mesEscolhido ?? mesDeHoje;
  const resumo = resumoDoMes(lancamentos, mes);
  // A data mais recente primeiro; no mesmo dia, a linha mais nova da planilha primeiro.
  const doMes = lancamentos
    .filter((l) => l.data.startsWith(mes))
    .reverse()
    .sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0));
  const aMostrar = mostrarTodos ? doMes : doMes.slice(0, LINHAS_DA_TABELA);
  const maior = resumo.porCategoria[0];
  const maiorBarra = Math.max(0, ...resumo.porCategoria.map((c) => c.total));
  const data = dataDigitada ?? hoje;
  // Os tipos: os já usados na planilha (com a grafia dela) mais Débito e Crédito, sem repetir.
  const tipos = (() => {
    const vistos = new Map<string, string>();
    for (const t of [...tiposEmUso(lancamentos), TIPO_PADRAO, 'Crédito']) if (!vistos.has(normalizar(t))) vistos.set(normalizar(t), t);
    return [...vistos.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  })();
  const tipo = tipoEscolhido ?? tipos.find((t) => normalizar(t) === normalizar(TIPO_PADRAO)) ?? TIPO_PADRAO;

  const aviso = lida?.aviso ? TEXTO_DO_AVISO_DE_LEITURA[lida.aviso] : lida?.doCache ? 'Sem internet: mostrando o que este aparelho guardou da planilha.' : null;

  async function guardar(evento: Event) {
    evento.preventDefault();
    if (emCurso.current) return;
    const texto = valor.trim();
    const numero = valorDeTexto(texto);
    const iso = dataDeTexto(data);
    const falta = descricao.trim();
    const falhar = (mensagem: string, campo: Exclude<CampoComErro, null>, ref: { current: HTMLElement | null }) => {
      setErro(mensagem);
      setCampoComErro(campo);
      ref.current?.focus();
    };
    if (/r\$|reais|real(?![a-z])/i.test(texto)) return falhar(TEXTO_DO_GASTO_NA_VOZ.reais, 'valor', campoValor);
    if (numero === null) return falhar('Digite o valor em €, só números (por exemplo, 5,50).', 'valor', campoValor);
    if (numero <= 0) return falhar('O valor precisa ser maior que zero.', 'valor', campoValor);
    if (falta === '') return falhar('Escreva a descrição do gasto.', 'descricao', campoDescricao);
    if (!iso) return falhar('Escolha a data do gasto.', 'data', campoData);
    if (iso > hoje) return falhar('A data do gasto não pode estar no futuro.', 'data', campoData);
    emCurso.current = true;
    setOcupada(true);
    setErro(null);
    setCampoComErro(null);
    try {
      const feito = await registrarGasto(
        pastaRef.current,
        { valor: numero, data: iso, descricao: falta, categoria: canonicalizarCategoria(categoria, categorias), tipo, quem, moeda: '€' },
        { hoje },
      );
      if (!feito.gravado) {
        setErro(feito.situacao === 'bloqueada' ? TEXTO_DO_AVISO_DE_PLANILHA[feito.aviso ?? 'sem_acesso'] : feito.mensagem);
        return;
      }
      const { titulo, detalhe } = textosDoGasto(pastaRef.current.nome, feito.lancamento, feito.situacao, feito.avisos);
      setCartao({
        chave: ++proximoCartao.current,
        titulo,
        detalhe,
        desfazer: async () => {
          // O texto vem do que de fato aconteceu: o gasto pode ter saído da fila antes de o dono tocar em Desfazer.
          const saiu = await feito.desfazer();
          setCartao({
            chave: ++proximoCartao.current,
            titulo: 'Gasto desfeito',
            detalhe:
              saiu === 'tirada_da_fila' ? 'O gasto saiu da lista e não será enviado.' : 'O gasto saiu da lista. Na planilha, a linha fica marcada como "desfeito".',
            desfeito: true,
          });
          setVersao((v) => v + 1);
        },
      });
      setValor('');
      setDescricao('');
      setCategoria('');
      setTipoEscolhido(null);
      setQuem('');
      setDataDigitada(null);
      // O gasto novo aparece na tela: se for de outro mês, a tela vai para ele.
      setMesEscolhido(iso.slice(0, 7) === mesDeHoje ? null : iso.slice(0, 7));
      setVersao((v) => v + 1);
    } catch (causa) {
      console.error('Não consegui gravar o gasto', causa);
      setErro('Não consegui gravar o gasto. Nada foi gravado. Tente de novo.');
    } finally {
      emCurso.current = false;
      setOcupada(false);
    }
  }

  async function desfazer() {
    const atual = cartao;
    if (!atual?.desfazer || emCurso.current) return;
    emCurso.current = true;
    setOcupada(true);
    setErro(null);
    try {
      await atual.desfazer();
    } catch (causa) {
      console.error('Não consegui desfazer o gasto', causa);
      setErro('Não consegui desfazer agora. Tente de novo.');
    } finally {
      emCurso.current = false;
      setOcupada(false);
    }
  }

  const invalido = (campo: Exclude<CampoComErro, null>) => (campoComErro === campo ? 'true' : undefined);
  const ligadoAoErro = (campo: Exclude<CampoComErro, null>) => (campoComErro === campo && erro ? 'fin-erro' : undefined);
  const limparErro = () => {
    setErro(null);
    setCampoComErro(null);
  };

  return (
    <section class="painel pasta-conteudo financeiro" data-tipo="planilha" aria-labelledby="titulo-pasta-conteudo">
      <h2 id="titulo-pasta-conteudo">Lançamentos</h2>

      <div class="fin-topo">
        <div class="fin-mes" role="group" aria-label="Mês">
          {/* No limite o botão usa aria-disabled (e não disabled): o foco fica nele e o leitor de tela ainda o encontra. */}
          <button
            type="button"
            class="botao-pilula fin-mes-botao"
            aria-label="Mês anterior"
            aria-disabled={mes <= primeiroMes ? 'true' : undefined}
            onClick={() => mes > primeiroMes && setMesEscolhido(somarMeses(mes, -1))}
          >
            <Icone nome="voltar" />
          </button>
          <p class="fin-mes-nome" aria-live="polite">
            {nomeDoMes(mes)}
          </p>
          <button
            type="button"
            class="botao-pilula fin-mes-botao fin-mes-seguinte"
            aria-label="Mês seguinte"
            aria-disabled={mes >= ultimoMes ? 'true' : undefined}
            onClick={() => mes < ultimoMes && setMesEscolhido(somarMeses(mes, 1))}
          >
            <Icone nome="voltar" />
          </button>
        </div>
        <div class="fin-topo-acoes">
          <button type="button" class="botao-texto" aria-disabled={lendo ? 'true' : undefined} onClick={() => !lendo && setVersao((v) => v + 1)}>
            {lendo ? 'Lendo…' : 'Reler a planilha'}
          </button>
          <a class="botao-link pasta-planilha" href={linkDaPlanilha(pasta.planilhaId!)} target="_blank" rel="noopener noreferrer">
            <Icone nome="externo" />
            <span>Abrir planilha</span>
            <span class="so-leitor"> (abre em outra aba)</span>
          </a>
        </div>
      </div>

      {/* A região viva existe desde o começo, vazia: só o texto dentro dela muda. */}
      <AvisoVivo>
        {aviso && <p class="registro-aviso">{aviso}</p>}
        {falhouAtualizar && lida && <p class="registro-aviso">Não consegui atualizar. Mostrando a última leitura.</p>}
      </AvisoVivo>
      {carga.situacao === 'erro' && (
        <p class="pastas-erro" role="alert">
          <span>Não consegui ler a planilha agora.</span>
          <button type="button" class="botao-pilula" onClick={() => setVersao((v) => v + 1)}>
            Tentar de novo
          </button>
        </p>
      )}
      {carga.situacao === 'lendo' && <p class="registro-nota fin-lendo">Lendo a planilha…</p>}

      <ul class="fin-cartoes" aria-label="Resumo do mês">
        <li class="fin-cartao-resumo">
          <span class="fin-rotulo">Total do mês</span>
          <strong class="fin-valor">{lida ? eurosEmBr(resumo.total) : '—'}</strong>
        </li>
        <li class="fin-cartao-resumo">
          <span class="fin-rotulo">Maior categoria</span>
          <strong class="fin-valor fin-valor-texto">{maior ? maior.categoria : '—'}</strong>
          {maior && <span class="fin-detalhe">{eurosEmBr(maior.total)}</span>}
        </li>
        <li class="fin-cartao-resumo">
          <span class="fin-rotulo">Lançamentos</span>
          <strong class="fin-valor">{lida ? doMes.length : '—'}</strong>
        </li>
      </ul>

      {lida && lida.foraDaConta > 0 && (
        <div class="registro-aviso fin-fora">
          <p>
            {lida.foraDaConta === 1
              ? '1 linha da planilha ficou fora da conta: o valor ou a data não pôde ser lido.'
              : `${lida.foraDaConta} linhas da planilha ficaram fora da conta: o valor ou a data não pôde ser lido.`}
          </p>
          <details>
            <summary>Ver quais</summary>
            <ul class="fin-fora-lista">
              {lida.avisos.map((frase, i) => (
                <li key={i}>{frase}</li>
              ))}
            </ul>
          </details>
        </div>
      )}
      {lida && lida.naoSalvos.length > 0 && (
        <p class="registro-aviso">
          {lida.naoSalvos.length === 1
            ? '1 gasto não chegou à planilha. Veja o aviso no alto da página.'
            : `${lida.naoSalvos.length} gastos não chegaram à planilha. Veja o aviso no alto da página.`}
        </p>
      )}

      <form class="pastas-form fin-form" aria-label="Novo gasto" noValidate onSubmit={(e) => void guardar(e)}>
        <h3 class="registro-titulo">Novo gasto</h3>
        <div class="pastas-campos-juntos fin-campos-1">
          <div class="pastas-campo">
            <label for="fin-valor">Valor (€)</label>
            <input
              ref={campoValor}
              id="fin-valor"
              class="campo"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={valor}
              aria-invalid={invalido('valor')}
              aria-describedby={ligadoAoErro('valor')}
              onInput={(e) => {
                setValor(e.currentTarget.value);
                limparErro();
              }}
            />
          </div>
          <div class="pastas-campo">
            <label for="fin-descricao">Descrição</label>
            <input
              ref={campoDescricao}
              id="fin-descricao"
              class="campo"
              type="text"
              maxLength={DESCRICAO_NO_MAXIMO}
              autoComplete="off"
              value={descricao}
              aria-invalid={invalido('descricao')}
              aria-describedby={ligadoAoErro('descricao')}
              onInput={(e) => {
                setDescricao(e.currentTarget.value);
                limparErro();
              }}
            />
          </div>
          <div class="pastas-campo">
            <label for="fin-data">Data</label>
            <input
              ref={campoData}
              id="fin-data"
              class="campo"
              type="date"
              value={data}
              max={hoje}
              aria-invalid={invalido('data')}
              aria-describedby={ligadoAoErro('data')}
              onInput={(e) => {
                setDataDigitada(e.currentTarget.value);
                limparErro();
              }}
            />
          </div>
        </div>
        <div class="pastas-campos-juntos fin-campos-2">
          <div class="pastas-campo">
            <label for="fin-categoria">Categoria (opcional)</label>
            <input
              id="fin-categoria"
              class="campo"
              type="text"
              list="fin-categorias"
              maxLength={CATEGORIA_NO_MAXIMO}
              autoComplete="off"
              aria-describedby="fin-categoria-dica"
              value={categoria}
              onInput={(e) => setCategoria(e.currentTarget.value)}
            />
            <datalist id="fin-categorias">
              {categorias.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <p class="pastas-campo-dica" id="fin-categoria-dica">
              Escolha uma já usada ou digite outra.
            </p>
          </div>
          <div class="pastas-campo">
            <label for="fin-tipo">Tipo</label>
            <select id="fin-tipo" class="campo" value={tipo} onInput={(e) => setTipoEscolhido(e.currentTarget.value)}>
              {tipos.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div class="pastas-campo">
            <label for="fin-quem">Quem (opcional)</label>
            <input id="fin-quem" class="campo" type="text" list="fin-quems" maxLength={QUEM_NO_MAXIMO} autoComplete="off" placeholder="Central" value={quem} onInput={(e) => setQuem(e.currentTarget.value)} />
            <datalist id="fin-quems">
              {quemEmUso(lancamentos).map((q) => (
                <option key={q} value={q} />
              ))}
            </datalist>
          </div>
        </div>
        {erro && (
          <p class="pastas-campo-erro" id="fin-erro" role="alert">
            {erro}
          </p>
        )}
        <div class="pastas-form-acoes">
          <button type="submit" class="botao-pilula" disabled={ocupada}>
            Guardar gasto
          </button>
        </div>
      </form>

      <div class="pastas-resultado">
        {cartao && (
          <article class="pastas-cartao" ref={cartaoRef} tabIndex={-1} aria-labelledby="fin-cartao-titulo" aria-describedby="fin-cartao-detalhe">
            <p class="pastas-cartao-titulo" id="fin-cartao-titulo">
              {cartao.titulo}
            </p>
            <p class="pastas-cartao-detalhe" id="fin-cartao-detalhe">
              {cartao.detalhe}
            </p>
            <div class="pastas-cartao-acoes">
              {!cartao.desfeito && cartao.desfazer && (
                <button type="button" class="botao-pilula" disabled={ocupada} onClick={() => void desfazer()}>
                  Desfazer
                </button>
              )}
              <button
                type="button"
                class="botao-pilula"
                onClick={() => {
                  setCartao(null);
                  campoValor.current?.focus(); // o botão some com o cartão: o foco vai ao campo que o gerou
                }}
              >
                Fechar
              </button>
            </div>
          </article>
        )}
      </div>

      {resumo.porCategoria.length > 0 && (
        <div class="fin-bloco">
          <h3 class="registro-titulo">Por categoria</h3>
          <ul class="fin-barras" aria-label="Gastos por categoria">
            {resumo.porCategoria.map((c) => (
              <li key={c.categoria}>
                <span class="fin-barra-nome">{c.categoria}</span>
                <span class="fin-barra-trilho" aria-hidden="true">
                  <span class="fin-barra" style={{ width: `${c.total > 0 && maiorBarra > 0 ? Math.max(6, (c.total / maiorBarra) * 100) : 0}%` }} />
                </span>
                <span class="fin-barra-valor">{eurosEmBr(c.total)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {doMes.length > 0 ? (
        <div class="fin-bloco">
          <h3 class="registro-titulo">Gastos do mês</h3>
          {/* Janela estreita ou zoom: a tabela rola para os lados dentro do próprio quadro, nunca a página. */}
          <div class="fin-tabela-rolagem" role="region" aria-label="Tabela de gastos do mês (rola para os lados)" tabIndex={0}>
            <table class="registro-tabela fin-tabela" aria-label="Gastos do mês">
              <thead>
                <tr>
                  <th scope="col">Data</th>
                  <th scope="col">Descrição</th>
                  <th scope="col">Categoria</th>
                  <th scope="col">Tipo</th>
                  <th scope="col" class="fin-direita">
                    Valor
                  </th>
                </tr>
              </thead>
              <tbody>
                {aMostrar.map((l) => (
                  <tr key={l.id}>
                    <td>{dataEmBr(l.data).slice(0, 5)}</td>
                    <td>
                      {l.descricao || '—'}
                      {l.quem && <span class="registro-obs">{l.quem}</span>}
                      {l.pendente === 'fila' && <span class="registro-obs">Esperando a rede</span>}
                    </td>
                    <td>{l.categoria}</td>
                    <td>{l.tipo || '—'}</td>
                    <td class="fin-direita">{eurosEmBr(l.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Um só botão, sempre no mesmo lugar: o texto e o aria-expanded mudam e o foco não se perde. */}
          {doMes.length > LINHAS_DA_TABELA && (
            <button type="button" class="botao-texto" aria-expanded={mostrarTodos} onClick={() => setMostrarTodos((t) => !t)}>
              {mostrarTodos ? 'Mostrar menos' : `Mostrar todos os ${doMes.length} gastos`}
            </button>
          )}
        </div>
      ) : (
        carga.situacao === 'pronta' && (
          <p class="lista-vazia-texto">{`Ainda não há gastos em ${nomeDoMes(mes)}. Digite um acima, ou diga "gastei 5,50 em salgado" no Pode falar.`}</p>
        )
      )}
    </section>
  );
}
