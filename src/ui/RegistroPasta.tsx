// A tela de uma pasta de Registro (V02, Tarefa 13): leituras de água, luz ou gás, lidas da planilha da Casa.
// Mostra a faixa do envio, o gráfico do consumo por mês, a tabela de leituras (a mais nova primeiro) e o formulário
// "Nova leitura". Grava na hora e mostra o cartão com Desfazer; nunca grava em silêncio.
//
// - Só anexa linhas; Desfazer marca "desfeito" na planilha e esconde a linha (nunca apaga).
// - Leitura menor que a anterior vale, mas sem consumo (sem número negativo) e com aviso.
// - O texto que vem da planilha é dado de terceiros: aparece só como texto, nunca como HTML.
// - Sem rede: mostra o que o aparelho guardou; a leitura nova espera na fila e o cartão avisa.
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  dataDeTexto,
  dataEmBr,
  leituraDeTexto,
  numeroEmBr,
  registrarLeitura,
  resumirLeituras,
  type LeituraLida,
  type ResultadoDaLeitura,
} from '../dados/leituras';
import { lerPlanilha, type LeituraDePlanilha } from '../dados/planilhas';
import type { Pasta } from '../dados/tipos';
import { AvisoVivo } from './AvisoVivo';
import { useDia } from './hooks';
import { FaixaDeEnvio } from './LembreteDeEnvio';
import { textosDaLeitura, TEXTO_DO_AVISO_DE_LEITURA, TEXTO_DO_AVISO_DE_PLANILHA, unidadeDoServico } from './pastas-textos';
import './pastas.css';

const LINHAS_DA_TABELA = 12;
const MESES_DO_GRAFICO = 12;
const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** `2026-11` → `nov/26`. */
const nomeDoMes = (mes: string) => `${MES[Number(mes.slice(5, 7)) - 1] ?? mes.slice(5, 7)}/${mes.slice(2, 4)}`;

type Carga = { situacao: 'lendo' } | { situacao: 'erro' } | { situacao: 'pronta'; lida: LeituraDePlanilha };
/** `chave` muda a cada cartão novo: o foco volta para ele mesmo quando o título é o mesmo. */
type CampoComErro = 'valor' | 'data' | null;
type Cartao = { chave: number; titulo: string; detalhe: string; desfazer?: () => Promise<void>; desfeito?: boolean };

export function RegistroPasta({ pasta }: { pasta: Pasta }) {
  const hoje = useDia();
  const unidade = pasta.unidade ?? (pasta.servico ? unidadeDoServico(pasta.servico) : 'm³');
  const [carga, setCarga] = useState<Carga>({ situacao: 'lendo' });
  const [versao, setVersao] = useState(0);
  const [mostrarTodas, setMostrarTodas] = useState(false);
  const [data, setData] = useState(hoje);
  const [valor, setValor] = useState('');
  const [observacao, setObservacao] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  /** O campo a que o erro se refere (só ele ganha `aria-invalid`); erro geral não marca nenhum. */
  const [campoComErro, setCampoComErro] = useState<CampoComErro>(null);
  const [cartao, setCartao] = useState<Cartao | null>(null);
  const [ocupada, setOcupada] = useState(false);
  const emCurso = useRef(false);
  const proximoCartao = useRef(0);
  const cartaoRef = useRef<HTMLElement>(null);
  const campoValor = useRef<HTMLInputElement>(null);
  const campoData = useRef<HTMLInputElement>(null);
  const pastaRef = useRef(pasta);
  pastaRef.current = pasta;
  const temPlanilha = typeof pasta.planilhaId === 'string' && pasta.planilhaId !== '';

  // Lê a planilha ao abrir, ao pedir "Reler" e ao voltar a rede. Durante uma releitura a tabela não some.
  useEffect(() => {
    if (!temPlanilha) return;
    let vivo = true;
    lerPlanilha(pastaRef.current)
      .then((lida) => vivo && setCarga({ situacao: 'pronta', lida }))
      .catch((causa: unknown) => {
        console.error('Não consegui ler a planilha de leituras', causa);
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

  if (!temPlanilha) {
    return (
      <section class="painel pasta-conteudo registro" data-tipo="registro" aria-labelledby="titulo-pasta-conteudo">
        <h2 id="titulo-pasta-conteudo">Leituras</h2>
        <p class="lista-vazia-titulo">Esta pasta ainda não tem planilha.</p>
        <p class="lista-vazia-texto">Apague a pasta e crie de novo em Nova pasta, para a Central criar a planilha de leituras.</p>
      </section>
    );
  }

  const lida = carga.situacao === 'pronta' ? carga.lida : null;
  const resumo = lida ? resumirLeituras(lida.linhas) : null;
  const decrescentes: LeituraLida[] = resumo ? [...resumo.leituras].reverse() : [];
  const aMostrar = mostrarTodas ? decrescentes : decrescentes.slice(0, LINHAS_DA_TABELA);
  const meses = resumo ? resumo.porMes.slice(-MESES_DO_GRAFICO) : [];
  const maior = Math.max(0, ...meses.map((m) => m.consumo));

  async function guardar(evento: Event) {
    evento.preventDefault();
    if (emCurso.current) return;
    const numero = leituraDeTexto(valor);
    const iso = dataDeTexto(data);
    const falhar = (mensagem: string, campo: Exclude<CampoComErro, null>, ref: { current: HTMLElement | null }) => {
      setErro(mensagem);
      setCampoComErro(campo);
      ref.current?.focus();
    };
    if (numero === null) return falhar('Digite a leitura do contador, só números (por exemplo, 1234,5).', 'valor', campoValor);
    if (!iso) return falhar('Escolha a data da leitura.', 'data', campoData);
    if (iso > hoje) return falhar('A data da leitura não pode estar no futuro.', 'data', campoData);
    emCurso.current = true;
    setOcupada(true);
    setErro(null);
    setCampoComErro(null);
    try {
      const nova = { data: iso, valor: numero, unidade, observacao };
      const resultado = await registrarLeitura(pastaRef.current, nova);
      if (resultado.anexo.situacao === 'bloqueada') {
        setErro(TEXTO_DO_AVISO_DE_PLANILHA[resultado.anexo.aviso ?? 'sem_acesso']);
        return;
      }
      setCartao(cartaoDaLeitura(pasta, nova, resultado, ++proximoCartao.current, () => setVersao((v) => v + 1), (c) => setCartao({ ...c, chave: ++proximoCartao.current })));
      setValor('');
      setObservacao('');
      setData(hoje);
      setVersao((v) => v + 1);
    } catch (causa) {
      console.error('Não consegui gravar a leitura', causa);
      setErro('Não consegui gravar a leitura. Nada foi gravado. Tente de novo.');
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
    try {
      await atual.desfazer();
    } catch (causa) {
      console.error('Não consegui desfazer a leitura', causa);
      setErro('Não consegui desfazer agora. Tente de novo.');
    } finally {
      emCurso.current = false;
      setOcupada(false);
    }
  }

  const limparErro = () => {
    setErro(null);
    setCampoComErro(null);
  };

  const aviso = lida?.aviso ? TEXTO_DO_AVISO_DE_LEITURA[lida.aviso] : lida?.doCache ? 'Sem internet: mostrando o que este aparelho guardou da planilha.' : null;

  return (
    <section class="painel pasta-conteudo registro" data-tipo="registro" aria-labelledby="titulo-pasta-conteudo">
      <h2 id="titulo-pasta-conteudo">Leituras</h2>

      <FaixaDeEnvio pasta={pasta} />

      <AvisoVivo>{aviso && <p class="registro-aviso">{aviso}</p>}</AvisoVivo>
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
          <article class="pastas-cartao" ref={cartaoRef} tabIndex={-1} aria-labelledby="registro-cartao-titulo" aria-describedby="registro-cartao-detalhe">
            <p class="pastas-cartao-titulo" id="registro-cartao-titulo">
              {cartao.titulo}
            </p>
            <p class="pastas-cartao-detalhe" id="registro-cartao-detalhe">
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

      <form class="pastas-form registro-form" aria-label="Nova leitura" noValidate onSubmit={(e) => void guardar(e)}>
        <h3 class="registro-titulo">Nova leitura</h3>
        <div class="pastas-campos-juntos">
          <div class="pastas-campo">
            <label for="registro-data">Data</label>
            <input
              ref={campoData}
              id="registro-data"
              class="campo"
              type="date"
              value={data}
              max={hoje}
              aria-invalid={campoComErro === 'data' ? 'true' : undefined}
              aria-describedby={campoComErro === 'data' ? 'registro-erro' : undefined}
              onInput={(e) => {
                setData(e.currentTarget.value);
                limparErro();
              }}
            />
          </div>
          <div class="pastas-campo">
            <label for="registro-leitura">{`Leitura (${unidade})`}</label>
            <input
              ref={campoValor}
              id="registro-leitura"
              class="campo"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={valor}
              aria-invalid={campoComErro === 'valor' ? 'true' : undefined}
              aria-describedby={campoComErro === 'valor' ? 'registro-erro' : undefined}
              onInput={(e) => {
                setValor(e.currentTarget.value);
                limparErro();
              }}
            />
          </div>
          <div class="pastas-campo">
            <label for="registro-observacao">Observação (opcional)</label>
            <input id="registro-observacao" class="campo" type="text" maxLength={200} autoComplete="off" value={observacao} onInput={(e) => setObservacao(e.currentTarget.value)} />
          </div>
        </div>
        {erro && (
          <p class="pastas-campo-erro" id="registro-erro" role="alert">
            {erro}
          </p>
        )}
        <div class="pastas-form-acoes">
          <button type="submit" class="botao-pilula" disabled={ocupada}>
            Guardar leitura
          </button>
        </div>
      </form>

      {carga.situacao === 'lendo' && <p class="registro-nota">Lendo a planilha…</p>}

      {resumo && resumo.ignoradas > 0 && (
        <p class="registro-aviso">
          {resumo.ignoradas === 1
            ? '1 linha da planilha ficou de fora da conta: a data ou a leitura não pôde ser lida.'
            : `${resumo.ignoradas} linhas da planilha ficaram de fora da conta: a data ou a leitura não pôde ser lida.`}
        </p>
      )}
      {resumo && resumo.naoSalvas.length > 0 && (
        <p class="registro-aviso">
          {resumo.naoSalvas.length === 1
            ? '1 leitura não chegou à planilha. Veja o aviso no alto da página.'
            : `${resumo.naoSalvas.length} leituras não chegaram à planilha. Veja o aviso no alto da página.`}
        </p>
      )}

      {resumo && resumo.leituras.length === 0 && carga.situacao === 'pronta' && (
        <p class="lista-vazia-texto">Ainda não há leituras. Digite a primeira acima, ou diga "leitura da água 1234" no Pode falar.</p>
      )}

      {meses.length > 0 && (
        <figure class="registro-figura">
          <h3 class="registro-titulo">Consumo por mês</h3>
          <p class="registro-nota">Medido em cada mês: o consumo vai para o mês da leitura mais nova.</p>
          {/* Muitos meses não cabem num celular: o gráfico rola para os lados dentro do próprio quadro, nunca a página. */}
          <div class="registro-grafico-rolagem" role="region" aria-label="Gráfico do consumo por mês (rola para os lados)" tabIndex={0}>
            <ul class="registro-grafico" aria-label="Consumo por mês">
              {meses.map((m) => (
                <li key={m.mes}>
                  <span class="registro-barra-mes">
                    {nomeDoMes(m.mes)}
                    <span class="so-leitor">:</span>
                  </span>
                  <span class="registro-barra-trilho" aria-hidden="true">
                    <span class="registro-barra" style={{ height: `${maior > 0 ? Math.max(3, (m.consumo / maior) * 100) : 3}%` }} />
                  </span>
                  <span class="registro-barra-valor">{`${numeroEmBr(m.consumo)} ${unidade}`}</span>
                </li>
              ))}
            </ul>
          </div>
        </figure>
      )}

      {aMostrar.length > 0 && (
        <div class="registro-tabela-area">
          <h3 class="registro-titulo">Leituras registradas</h3>
          <table class="registro-tabela" aria-label="Leituras registradas">
            <thead>
              <tr>
                <th scope="col">Data</th>
                <th scope="col">Leitura</th>
                <th scope="col">Consumo desde a anterior</th>
              </tr>
            </thead>
            <tbody>
              {aMostrar.map((l) => (
                <tr key={l.id}>
                  <td>
                    {dataEmBr(l.data)}
                    {l.observacao && <span class="registro-obs">{l.observacao}</span>}
                  </td>
                  <td>{`${numeroEmBr(l.leitura)} ${unidade}`}</td>
                  <td>
                    {l.consumo === null ? '—' : `${numeroEmBr(l.consumo)} ${unidade}`}
                    {l.aviso === 'leitura_menor' && <span class="registro-obs registro-obs-aviso">Menor que a anterior</span>}
                    {l.pendente === 'fila' && <span class="registro-obs">Esperando a rede</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* Um só botão, sempre no mesmo lugar: o texto e o aria-expanded mudam e o foco não se perde. */}
          {decrescentes.length > LINHAS_DA_TABELA && (
            <button type="button" class="botao-texto" aria-expanded={mostrarTodas} onClick={() => setMostrarTodas((t) => !t)}>
              {mostrarTodas ? 'Mostrar menos' : `Mostrar todas as ${decrescentes.length} leituras`}
            </button>
          )}
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

/** O cartão de uma leitura guardada, com o Desfazer (que troca o cartão por "Leitura desfeita"). */
function cartaoDaLeitura(
  pasta: Pasta,
  nova: { data: string; valor: number; unidade: string },
  resultado: ResultadoDaLeitura,
  chave: number,
  reler: () => void,
  mudarCartao: (c: Omit<Cartao, 'chave'>) => void,
): Cartao {
  const { titulo, detalhe } = textosDaLeitura(pasta.nome, nova, resultado);
  return {
    chave,
    titulo,
    detalhe,
    desfazer: async () => {
      // O texto vem do que de fato aconteceu: a leitura pode ter saído da fila antes de o dono tocar em Desfazer.
      const feito = await resultado.anexo.desfazer();
      mudarCartao({
        titulo: 'Leitura desfeita',
        detalhe:
          feito === 'tirada_da_fila'
            ? 'A leitura saiu da lista e não será enviada.'
            : 'A leitura saiu da lista. Na planilha, a linha fica marcada como "desfeito".',
        desfeito: true,
      });
      reler();
    },
  };
}
