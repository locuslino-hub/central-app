// A página de uma pasta (V02, Tarefa 12): moldura com o nome, o selo do tipo, a sala, o link da planilha,
// "Renomear" e "Apagar pasta" (com Desfazer). O conteúdo de cada tipo entra em `ConteudoDaPasta`, nas
// Tarefas 13 (Registro), 14 (Lista), 16 (Planilha ligada: Financeiro) e 17 (Pasta comum, por tema).
//
// Apagar só tira a pasta da Central: a planilha continua no Drive do dono, e a página diz isso.
import { useEffect, useRef, useState } from 'preact/hooks';
import { apagarPasta, NOME_DA_PASTA_NO_MAXIMO, renomearPasta, restaurarPasta } from '../dados/pastas';
import type { Pasta } from '../dados/tipos';
import { hrefDe } from '../rotas';
import { useAparelhoCelular, usePasta, useSala } from './hooks';
import { Icone } from './icones';
import { corDaSala } from './Menu';
import { Financeiro } from './Financeiro';
import { ListaPasta } from './ListaPasta';
import { Pagina } from './Pagina';
import { PastaComum } from './PastaComum';
import { RegistroPasta } from './RegistroPasta';
import { descricaoDaPasta, linkDaPlanilha, mensagemDeErroDePasta, SELO_DO_TIPO } from './pastas-textos';
import './pastas.css';

/** A tela de cada tipo: Registro (T13), Lista (T14), Financeiro (T16) e Pasta comum (T17). */
function ConteudoDaPasta({ pasta }: { pasta: Pasta }) {
  if (pasta.tipo === 'registro') return <RegistroPasta pasta={pasta} />;
  if (pasta.tipo === 'lista') return <ListaPasta pasta={pasta} />;
  if (pasta.tipo === 'planilha') return <Financeiro pasta={pasta} />;
  return <PastaComum pasta={pasta} />;
}

/** `apagada`: o cartão do "Pasta apagada" (sai sozinho se a pasta voltar a existir). */
type Resultado = { titulo: string; detalhe: string; desfazer?: () => Promise<void>; desfeito?: boolean; apagada?: boolean };

type Props = { salaId: string; pastaId: string };

export function PaginaDaPasta({ salaId, pastaId }: Props) {
  const sala = useSala(salaId);
  const pasta = usePasta(salaId, pastaId);
  const celular = useAparelhoCelular();
  const [apagada, setApagada] = useState<Pasta | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [renomeando, setRenomeando] = useState(false);
  const [novoNome, setNovoNome] = useState('');
  const [erroDoNome, setErroDoNome] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupada, setOcupada] = useState(false);
  const emCurso = useRef(false);
  const cartao = useRef<HTMLElement>(null);
  const campoNome = useRef<HTMLInputElement>(null);
  const botaoRenomear = useRef<HTMLButtonElement>(null);
  const linkVoltar = useRef<HTMLAnchorElement>(null);
  /** A última pasta que existiu aqui: enquanto o cartão está na tela, a página segue montada mesmo com a pasta fora da lista. */
  const ultima = useRef<Pasta | null>(null);
  if (pasta) ultima.current = pasta;
  /** "Fechar" pediu o foco para um controle estável da página (o botão que o gerou some com o cartão). */
  const [focoPendente, setFocoPendente] = useState(false);

  useEffect(() => {
    if (resultado) cartao.current?.focus();
  }, [resultado]);
  useEffect(() => {
    if (renomeando) campoNome.current?.focus();
  }, [renomeando]);
  // A pasta voltou a existir (restaurada em outro aparelho): o aviso de "apagada" já não vale. Só vale a volta
  // depois de a pasta ter sumido da lista (logo depois de apagar, a lista ainda mostra a antiga).
  const sumiu = useRef(false);
  useEffect(() => {
    if (apagada === null) return;
    if (pasta === null) sumiu.current = true;
    else if (sumiu.current) {
      sumiu.current = false;
      setResultado(null);
      setApagada(null);
    }
  }, [pasta, apagada]);

  // A página "apagada" serve do clique em Apagar até a pasta voltar (Desfazer) ou sair da tela: a lista ainda pode mostrar a
  // pasta antiga logo depois de apagar, e ainda não mostrar a pasta logo depois de desfazer. A mesma árvore atende a tudo isso.
  const pastaApagada = apagada ?? ultima.current;
  const estaApagada =
    pastaApagada !== null && ((apagada !== null && (pasta === null || !sumiu.current)) || (pasta === null && resultado !== null));
  useEffect(() => {
    if (!focoPendente) return;
    const alvo = (estaApagada ? linkVoltar : botaoRenomear).current;
    if (!alvo) return;
    alvo.focus();
    setFocoPendente(false);
  }, [focoPendente, estaApagada, pasta]); // `pasta`: a página pode ainda estar voltando da lista quando o Fechar é tocado

  /** Uma ação por vez; erro vira aviso na página. */
  async function agir(fazer: () => Promise<void>) {
    if (emCurso.current) return;
    emCurso.current = true;
    setOcupada(true);
    setErro(null);
    try {
      await fazer();
    } catch (causa) {
      console.error('Não consegui mexer na pasta', causa);
      setErro(mensagemDeErroDePasta(causa, { criando: false }));
    } finally {
      emCurso.current = false;
      setOcupada(false);
    }
  }

  if (pasta === undefined || sala === undefined) return <Pagina titulo="Pasta" />;

  // Apagada aqui, com o Desfazer na tela: a mesma árvore da página serve aos dois estados (só as pontas mudam), para o
  // cartão não ser remontado e o foco não se perder entre "Pasta apagada" e "Desfeito".

  if (!estaApagada && (pasta === null || sala === null)) {
    return (
      <Pagina titulo="Pasta não encontrada">
        <p class="aviso">Esta pasta não existe neste aparelho. Ela pode ter sido apagada.</p>
        <p>
          <a class="botao-link" href={sala ? hrefDe('sala', sala.id) : hrefDe('salas')}>
            {sala ? `Voltar para ${sala.nome}` : 'Ver as salas'}
          </a>
        </p>
      </Pagina>
    );
  }

  async function desfazer() {
    const atual = resultado;
    if (!atual?.desfazer) return;
    await agir(async () => {
      await atual.desfazer!();
      setApagada(null);
      setResultado({ titulo: 'Desfeito', detalhe: 'A pasta voltou para a sala.', desfeito: true });
    });
  }

  const viva = pasta as Pasta; // só usada fora do estado "apagada"
  const abrirRenomear = () => {
    setNovoNome(viva.nome);
    setErroDoNome(null);
    setRenomeando(true);
  };
  const fecharRenomear = () => {
    setRenomeando(false);
    botaoRenomear.current?.focus();
  };

  async function salvarNome(evento: Event) {
    evento.preventDefault();
    if (novoNome.trim() === '') {
      setErroDoNome('Escreva um nome para a pasta.');
      campoNome.current?.focus();
      return;
    }
    await agir(async () => {
      await renomearPasta((pasta as Pasta).id, novoNome);
      setRenomeando(false);
      botaoRenomear.current?.focus();
    });
  }

  const apagarEstaPasta = (p: Pasta) =>
    agir(async () => {
      const antes = await apagarPasta(p.id);
      sumiu.current = false;
      setRenomeando(false);
      setApagada(p);
      // Já apagada em outro aparelho: não há o que desfazer (nada é inventado).
      if (!antes) return setResultado({ titulo: 'Nada foi apagado', detalhe: 'Esta pasta já não estava aqui.' });
      setResultado({
        titulo: 'Pasta apagada',
        apagada: true,
        detalhe: antes.planilhaId
          ? 'A pasta saiu da Central. A planilha continua no seu Drive.'
          : 'A pasta saiu da sala. As tarefas, notas e documentos dela continuam na sala.',
        desfazer: async () => {
          await restaurarPasta(antes);
        },
      });
    });

  // O botão Fechar some com o cartão: o foco vai ao próximo controle da página (o link Voltar ou o Renomear), assim que ele existir.
  const aoFechar = () => {
    setResultado(null);
    setFocoPendente(true);
  };

  return (
    <Pagina titulo={estaApagada ? (pastaApagada as Pasta).nome : viva.nome}>
      <div class={`pasta-pagina ${sala ? corDaSala(sala.id) : ''}`}>
        {estaApagada ? null : (
          <p class="pasta-faixa">
            <span class="pasta-selo-pagina">{SELO_DO_TIPO[viva.tipo]}</span>
            <span>
              Na sala <a href={hrefDe('sala', sala!.id)}>{sala!.nome}</a>
            </span>
            <span class="pasta-faixa-detalhe">{descricaoDaPasta(viva)}</span>
          </p>
        )}

        <AreaDoResultado resultado={resultado} cartao={cartao} ocupada={ocupada} aoDesfazer={desfazer} aoFechar={aoFechar} />

        {estaApagada ? (
          <p>
            <a ref={linkVoltar} class="botao-link" href={sala ? hrefDe('sala', sala.id) : hrefDe('salas')}>
              {sala ? `Voltar para ${sala.nome}` : 'Ver as salas'}
            </a>
          </p>
        ) : (
          <div class="pasta-acoes">
            {/* A lista de compras é feita para o celular: lá o link da planilha fica escondido (abrir a planilha é coisa de computador).
                O Financeiro tem o seu próprio "Abrir planilha", junto do mês. */}
            {viva.planilhaId && viva.tipo !== 'planilha' && (viva.tipo !== 'lista' || !celular) && (
              <a class="botao-link pasta-planilha" href={linkDaPlanilha(viva.planilhaId)} target="_blank" rel="noopener noreferrer">
                <Icone nome="externo" />
                <span>Abrir no Google Planilhas</span>
                <span class="so-leitor"> (abre em outra aba)</span>
              </a>
            )}
            <button ref={botaoRenomear} type="button" class="botao-pilula" aria-expanded={renomeando} disabled={ocupada} onClick={() => (renomeando ? fecharRenomear() : abrirRenomear())}>
              Renomear
            </button>
            <button type="button" class="botao-texto" disabled={ocupada} onClick={() => void apagarEstaPasta(viva)}>
              Apagar pasta
            </button>
          </div>
        )}

        {!estaApagada && renomeando && (
          <form
            class="pastas-form pasta-renomear"
            onSubmit={(e) => void salvarNome(e)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') fecharRenomear();
            }}
          >
            <div class="pastas-campo">
              <label for="pasta-novo-nome">Novo nome</label>
              <input
                ref={campoNome}
                id="pasta-novo-nome"
                class="campo"
                type="text"
                value={novoNome}
                maxLength={NOME_DA_PASTA_NO_MAXIMO}
                autoComplete="off"
                aria-invalid={erroDoNome ? 'true' : undefined}
                aria-describedby={erroDoNome ? 'pasta-novo-nome-erro' : undefined}
                onInput={(e) => {
                  setNovoNome(e.currentTarget.value);
                  setErroDoNome(null);
                }}
              />
              {erroDoNome && (
                <p class="pastas-campo-erro" id="pasta-novo-nome-erro">
                  {erroDoNome}
                </p>
              )}
            </div>
            <div class="pastas-form-acoes">
              <button type="submit" class="botao-pilula" disabled={ocupada}>
                Salvar nome
              </button>
              <button type="button" class="botao-texto" onClick={fecharRenomear}>
                Cancelar
              </button>
            </div>
          </form>
        )}

        {erro && (
          <p class="pastas-erro" role="alert">
            {erro}
          </p>
        )}

        {/* key: ao trocar de pasta a tela de dentro recomeça (nada do formulário nem do mês da pasta anterior fica). */}
        {!estaApagada && <ConteudoDaPasta key={viva.id} pasta={viva} />}
      </div>
    </Pagina>
  );
}

type CartaoProps = {
  resultado: Resultado;
  cartao: { current: HTMLElement | null };
  ocupada: boolean;
  aoDesfazer: () => Promise<void>;
  aoFechar: () => void;
};

/**
 * O cartão do resultado. Fica fora de qualquer região viva (que leria o cartão duas vezes junto com o botão): ao entrar, o
 * foco vai para ele (nome = título, descrição = detalhe) e o leitor de tela o lê. O "Fechar" é tratado por quem chama.
 */
function AreaDoResultado({ resultado, cartao, ocupada, aoDesfazer, aoFechar }: Omit<CartaoProps, 'resultado'> & { resultado: Resultado | null }) {
  return (
    <div class="pastas-resultado">
      {resultado && (
        <article class="pastas-cartao" ref={cartao} tabIndex={-1} aria-labelledby="pasta-resultado-titulo" aria-describedby="pasta-resultado-detalhe">
          <p class="pastas-cartao-titulo" id="pasta-resultado-titulo">
            {resultado.titulo}
          </p>
          <p class="pastas-cartao-detalhe" id="pasta-resultado-detalhe">
            {resultado.detalhe}
          </p>
          <div class="pastas-cartao-acoes">
            {!resultado.desfeito && resultado.desfazer && (
              <button type="button" class="botao-pilula" disabled={ocupada} onClick={() => void aoDesfazer()}>
                Desfazer
              </button>
            )}
            <button type="button" class="botao-pilula" onClick={aoFechar}>
              Fechar
            </button>
          </div>
        </article>
      )}
    </div>
  );
}
