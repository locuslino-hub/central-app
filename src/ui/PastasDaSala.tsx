// As pastas de uma sala (V02, Tarefa 12): um cartão por pasta, com o selo do tipo, e "Nova pasta" no fim.
// Sala sem pastas: só uma linha fina (Pastas, e "Nova pasta" à direita). Na Casa, enquanto faltar alguma das
// 6 pastas padrão, oferece criá-las. Criar uma pasta mostra um cartão (Abrir, Desfazer). Desfazer só tira a
// pasta da Central: a planilha continua no Drive do dono (nada é apagado lá).
import { useEffect, useRef, useState } from 'preact/hooks';
import { apagarPasta, criarPastasPadraoDaCasa, faltamPadraoDaCasa, listarPastas, SALA_CASA } from '../dados/pastas';
import type { Pasta, Sala } from '../dados/tipos';
import { hrefDe } from '../rotas';
import { AvisoVivo } from './AvisoVivo';
import { usePastasDaSala } from './hooks';
import { Icone } from './icones';
import { NovaPasta } from './NovaPasta';
import { descricaoDaPasta, iconeDaPasta, mensagemDeErroDePasta, PastaJaApagada, SELO_DO_TIPO } from './pastas-textos';
import './pastas.css';

type Resultado = {
  titulo: string;
  detalhe: string;
  ver?: string;
  desfazer?: () => Promise<void>;
  detalheDesfeito?: string;
  desfeito?: boolean;
};

/** O aviso de erro: o bloco pêssego do app, com o "Tentar de novo" dentro dele. */
type Erro = { texto: string; tentar: () => void };

function CartaoDaPasta({ pasta }: { pasta: Pasta }) {
  return (
    <li>
      <a class="pasta-cartao" href={hrefDe('pasta', pasta.salaId, pasta.id)}>
        <Icone nome={iconeDaPasta(pasta)} />
        <span class="pasta-nome">{pasta.nome}</span>
        {/* O selo vem depois do nome no HTML (o leitor de tela diz primeiro o nome da pasta); na tela ele fica no canto. */}
        <span class="pasta-selo">{SELO_DO_TIPO[pasta.tipo]}</span>
        <span class="pasta-detalhe">{descricaoDaPasta(pasta)}</span>
      </a>
    </li>
  );
}

export function PastasDaSala({ sala }: { sala: Sala }) {
  const pastas = usePastasDaSala(sala.id);
  const [criandoPadrao, setCriandoPadrao] = useState(false);
  const [andamento, setAndamento] = useState<{ numero: number; total: number } | null>(null);
  const [erro, setErro] = useState<Erro | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [desfazendo, setDesfazendo] = useState(false);
  const [novaAberta, setNovaAberta] = useState(false);
  const emCurso = useRef(false);
  const cartao = useRef<HTMLElement>(null);
  const botaoNova = useRef<HTMLButtonElement>(null);
  const tituloDasPastas = useRef<HTMLHeadingElement>(null);
  const idDoFormulario = `nova-pasta-${sala.id}`;

  // Cada resposta leva o foco ao cartão: o botão apertado pode ter sumido da lista.
  useEffect(() => {
    if (resultado) cartao.current?.focus();
  }, [resultado]);

  async function criarPadrao() {
    if (emCurso.current) return;
    emCurso.current = true;
    setCriandoPadrao(true);
    setAndamento(null);
    setErro(null);
    const antes = pastas?.length ?? 0;
    try {
      const criadas = await criarPastasPadraoDaCasa({ aoAndar: (numero, total) => setAndamento({ numero, total }) });
      setResultado({ titulo: 'Pastas da Casa criadas', detalhe: `${criadas.length} pastas, com as planilhas no seu Drive.` });
    } catch (causa) {
      console.error('Não consegui criar as pastas padrão da Casa', causa);
      const criouAlguma = (await listarPastas(SALA_CASA).catch(() => [])).length > antes;
      const resto = criouAlguma ? ' As já criadas ficam; ao tentar de novo, só faltam as outras.' : '';
      setErro({ texto: `${mensagemDeErroDePasta(causa)}${resto}`, tentar: () => void criarPadrao() });
    } finally {
      emCurso.current = false;
      setCriandoPadrao(false);
      setAndamento(null);
    }
  }

  function pastaCriada(pasta: Pasta) {
    setNovaAberta(false);
    setErro(null);
    const comPlanilha = pasta.planilhaId !== undefined;
    setResultado({
      titulo: 'Pasta criada',
      detalhe: comPlanilha ? `${pasta.nome}. A planilha está no seu Drive, na pasta "Casa (partilhada)" (dentro de "Central").` : pasta.nome,
      ver: hrefDe('pasta', pasta.salaId, pasta.id),
      desfazer: async () => {
        // Já apagada em outro aparelho: não há o que desfazer (nada é inventado).
        if (!(await apagarPasta(pasta.id))) throw new PastaJaApagada();
      },
      detalheDesfeito: comPlanilha ? 'A pasta saiu da sala. A planilha continua no seu Drive.' : 'A pasta saiu da sala.',
    });
  }

  function cancelarNova() {
    setNovaAberta(false);
    botaoNova.current?.focus();
  }

  async function desfazer() {
    if (!resultado?.desfazer || desfazendo) return;
    setDesfazendo(true);
    try {
      await resultado.desfazer();
      setResultado({ titulo: 'Desfeito', detalhe: resultado.detalheDesfeito ?? 'Voltou ao que era.', desfeito: true });
    } catch (causa) {
      if (causa instanceof PastaJaApagada) {
        setResultado({ titulo: 'Nada a desfazer', detalhe: 'Esta pasta já não estava aqui.', desfeito: true });
      } else {
        console.error('Não consegui desfazer', causa);
        setErro({ texto: 'Não consegui desfazer agora. Tente de novo.', tentar: () => void desfazer() });
      }
    } finally {
      setDesfazendo(false);
    }
  }

  const vazia = pastas !== undefined && pastas.length === 0;
  const naCasa = sala.id === SALA_CASA;
  const oferecePadrao = naCasa && pastas !== undefined && faltamPadraoDaCasa(pastas);
  const alternarNova = () => (novaAberta ? cancelarNova() : setNovaAberta(true));

  return (
    <section class="painel pastas-da-sala" aria-labelledby="titulo-sala-pastas" aria-busy={pastas === undefined}>
      <div class="pastas-cabeca">
        <h2 id="titulo-sala-pastas" ref={tituloDasPastas} tabIndex={-1}>
          Pastas
        </h2>
        {/* Sem pastas: uma linha fina, sem o cartão grande. */}
        {vazia && (
          <button
            ref={botaoNova}
            type="button"
            class="botao-pilula pastas-nova-linha"
            aria-expanded={novaAberta}
            aria-controls={idDoFormulario}
            onClick={alternarNova}
          >
            <Icone nome="pasta-nova" />
            <span>Nova pasta</span>
          </button>
        )}
      </div>

      <div class="pastas-resultado">
        {resultado && (
          <article class="pastas-cartao" ref={cartao} tabIndex={-1} aria-labelledby={`${idDoFormulario}-resultado-titulo`} aria-describedby={`${idDoFormulario}-resultado-detalhe`}>
            <p class="pastas-cartao-titulo" id={`${idDoFormulario}-resultado-titulo`}>
              {resultado.titulo}
            </p>
            <p class="pastas-cartao-detalhe" id={`${idDoFormulario}-resultado-detalhe`}>
              {resultado.detalhe}
            </p>
            <div class="pastas-cartao-acoes">
              {!resultado.desfeito && resultado.ver && (
                <a class="botao-link" href={resultado.ver}>
                  Abrir
                </a>
              )}
              {!resultado.desfeito && resultado.desfazer && (
                <button type="button" class="botao-pilula" disabled={desfazendo} onClick={() => void desfazer()}>
                  Desfazer
                </button>
              )}
              <button
                type="button"
                class="botao-pilula"
                onClick={() => {
                  setResultado(null);
                  tituloDasPastas.current?.focus(); // o botão some com o cartão: o foco vai ao título da seção
                }}
              >
                Fechar
              </button>
            </div>
          </article>
        )}
      </div>

      {oferecePadrao && (
        <div class="pastas-vazio">
          {vazia ? (
            <>
              <p class="lista-vazia-titulo">A Casa ainda não tem pastas.</p>
              <p class="lista-vazia-texto">
                Crie as 6 pastas padrão: duas listas de compras, consumo de água, luz e gás, e o Financeiro. Cada uma ganha uma planilha no seu Drive.
              </p>
            </>
          ) : (
            <p class="lista-vazia-texto">Faltam pastas padrão da Casa. Só as que faltam serão criadas.</p>
          )}
          <button type="button" class="botao primario pastas-padrao" disabled={criandoPadrao} onClick={() => void criarPadrao()}>
            {criandoPadrao ? 'Criando as pastas…' : 'Criar pastas padrão da Casa'}
          </button>
        </div>
      )}
      {/* O andamento entra numa região viva que já está na tela, vazia: o leitor de tela anuncia cada "Criando N de 6…". */}
      <AvisoVivo>{criandoPadrao && andamento && <p class="pastas-progresso">{`Criando ${andamento.numero} de ${andamento.total}…`}</p>}</AvisoVivo>
      {erro && (
        <div class="pastas-erro" role="alert">
          <p>{erro.texto}</p>
          <button type="button" class="botao" onClick={erro.tentar}>
            Tentar de novo
          </button>
        </div>
      )}

      {pastas !== undefined && !vazia && (
        <ul class="pastas-lista">
          {pastas.map((pasta) => (
            <CartaoDaPasta key={pasta.id} pasta={pasta} />
          ))}
          <li class="pastas-nova-item">
            <button
              ref={botaoNova}
              type="button"
              class="pasta-nova"
              aria-expanded={novaAberta}
              aria-controls={idDoFormulario}
              onClick={alternarNova}
            >
              <Icone nome="pasta-nova" />
              <span class="pasta-nome">Nova pasta</span>
              <span class="pasta-detalhe">{naCasa ? 'lista, registro, planilha ou comum' : 'pasta comum, por tema'}</span>
            </button>
          </li>
        </ul>
      )}

      {novaAberta && <NovaPasta sala={sala} id={idDoFormulario} aoCriar={pastaCriada} aoCancelar={cancelarNova} />}
    </section>
  );
}
