// Caixa de documentos de uma sala ou de uma pessoa (Tarefa 18). Guarda links do
// OneDrive (Word, PowerPoint, Excel, PDF) e de sites; clicar abre o link. A
// Central nunca lê nem apaga o arquivo: Arquivar só tira o link da caixa, e tem Desfazer.
//
// O formulário tem estado próprio e fica fora da lista: uma atualização vinda
// de outro aparelho refaz a lista e nunca o campo em que o dono está digitando.
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  abrirDocumento,
  adicionarDocumento,
  arquivarDocumento,
  TITULO_DO_DOCUMENTO_NO_MAXIMO,
  tipoDoc,
  validarUrl,
  type TipoDoc,
} from '../dados/documentos';
import type { Documento } from '../dados/tipos';
import { AvisoDasAcoes, useAcoes, type Acoes } from './Acoes';
import { useDocumentos, usePessoas, useSalas, useTela } from './hooks';
import './salas.css';

type Props = {
  /** Quem é o dono da caixa, em palavras: "desta sala" ou "de Marina". */
  de: string;
  salaId?: string;
  pessoaId?: string;
};

const NOME_DO_TIPO: Record<TipoDoc, string> = {
  word: 'Word',
  powerpoint: 'PowerPoint',
  excel: 'Excel',
  pdf: 'PDF',
  site: 'Site',
};

// Um traço por tipo, no mesmo estilo dos ícones do app. O nome em texto fica ao lado.
const TRACO_DO_TIPO: Record<TipoDoc, string> = {
  word: 'M6 3.5h8l4 4V20.5H6zM14 3.5v4h4M9 12l1 5 2-4.5L14 17l1-5',
  powerpoint: 'M6 3.5h8l4 4V20.5H6zM14 3.5v4h4M10 11.5h2.2a1.8 1.8 0 0 1 0 3.6H10zM10 11.5V18',
  excel: 'M6 3.5h8l4 4V20.5H6zM14 3.5v4h4M9.5 12l5 6M14.5 12l-5 6',
  pdf: 'M6 3.5h8l4 4V20.5H6zM14 3.5v4h4M9 17.5c2-1.5 3.5-4 3-6-.4 2.2 1.8 4 4 4.2',
  site: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16M4 12h16M12 4c2.5 2.2 2.5 13.8 0 16M12 4c-2.5 2.2-2.5 13.8 0 16',
};

function IconeDoTipo({ tipo }: { tipo: TipoDoc }) {
  return (
    <svg class="icone" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
      <path d={TRACO_DO_TIPO[tipo]} />
    </svg>
  );
}

function LinhaDoDocumento({ doc, acoes }: { doc: Documento; acoes: Acoes }) {
  const tela = useTela();
  const [bloqueado, setBloqueado] = useState(false);
  const tipo = tipoDoc(doc.url, doc.titulo);
  const link = validarUrl(doc.url);
  return (
    <li class="documento" data-tipo={tipo}>
      <span class="documento-icone">
        <IconeDoTipo tipo={tipo} />
      </span>
      <div class="documento-texto">
        {link ? (
          <a
            class="documento-link"
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              e.preventDefault();
              setBloqueado(!abrirDocumento(doc, tela));
            }}
          >
            {doc.titulo}
          </a>
        ) : (
          <span class="documento-link">{doc.titulo}</span>
        )}
        <span class="documento-tipo">{NOME_DO_TIPO[tipo]}</span>
        {!link && <span class="documento-aviso">O link não é seguro (não começa com https://), por isso não abre.</span>}
        {bloqueado && (
          <span class="tarefa-erro" role="alert">
            O navegador bloqueou a janela. Permita janelas desta página e toque de novo.
          </span>
        )}
      </div>
      <button
        type="button"
        class="botao-texto documento-arquivar"
        aria-label={`Arquivar ${doc.titulo}`}
        onClick={() =>
          void acoes.agir(async () => {
            const entrada = await arquivarDocumento(doc.id);
            return entrada && { texto: entrada.rotulo, entrada };
          }, 'Não consegui arquivar. Tente de novo.')
        }
      >
        Arquivar
      </button>
    </li>
  );
}

type Erro = { campo: 'link' | 'titulo'; texto: string };

function FormularioNovo({
  inicial,
  aoGuardar,
  aoCancelar,
}: {
  /** Destino de partida: `sala:ID` ou `pessoa:ID`. */
  inicial: string;
  aoGuardar: (destino: string) => void;
  aoCancelar: () => void;
}) {
  const salas = useSalas();
  const pessoas = usePessoas() ?? [];
  const [link, setLink] = useState('');
  const [titulo, setTitulo] = useState('');
  const [destino, setDestino] = useState(inicial);
  const [erro, setErro] = useState<Erro | null>(null);
  const [guardando, setGuardando] = useState(false);
  const campoLink = useRef<HTMLInputElement>(null);
  const campoTitulo = useRef<HTMLInputElement>(null);
  const campoDestino = useRef<HTMLSelectElement>(null);
  // As opções chegam depois da leitura; o select só aceita o valor quando a opção existe.
  useEffect(() => {
    if (campoDestino.current) campoDestino.current.value = destino;
  }, [salas.length, pessoas.length]); // eslint-disable-line react-hooks/exhaustive-deps

  async function guardar(e: Event) {
    e.preventDefault();
    if (guardando) return;
    const [tipoDoDono, id] = [destino.slice(0, destino.indexOf(':')), destino.slice(destino.indexOf(':') + 1)];
    const pessoa = tipoDoDono === 'pessoa' ? pessoas.find((p) => p.id === id) : undefined;
    // Pessoa guarda a sala dela também: o documento acompanha a pessoa se ela mudar de sala só na tela dela.
    const dono = tipoDoDono === 'pessoa' ? { pessoaId: id, salaId: pessoa?.salaId } : { salaId: id };
    setGuardando(true);
    try {
      const r = await adicionarDocumento({ titulo, url: link, ...dono });
      if (r.ok) {
        aoGuardar(destino);
        return;
      }
      if (r.erro === 'link') {
        setErro({ campo: 'link', texto: 'Cole um link que comece com https://.' });
        campoLink.current?.focus();
      } else if (r.erro === 'titulo') {
        setErro({ campo: 'titulo', texto: 'Dê um título ao documento.' });
        campoTitulo.current?.focus();
      } else {
        setErro({ campo: 'titulo', texto: 'Escolha onde guardar o documento.' });
      }
    } catch (falha) {
      console.error('Não consegui guardar o documento', falha);
      setErro({ campo: 'titulo', texto: 'Não consegui guardar. Tente de novo.' });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form class="documento-form" aria-label="Novo documento" onSubmit={(e) => void guardar(e)} noValidate>
      <div class="documento-campo">
        <label for="documento-link">Link</label>
        <input
          id="documento-link"
          ref={campoLink}
          class="campo"
          type="url"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="none"
          spellcheck={false}
          placeholder="https://"
          value={link}
          aria-invalid={erro?.campo === 'link' ? 'true' : undefined}
          aria-describedby={erro?.campo === 'link' ? 'documento-erro' : undefined}
          onInput={(e) => setLink((e.target as HTMLInputElement).value)}
        />
      </div>
      <div class="documento-campo">
        <label for="documento-titulo">Título</label>
        <input
          id="documento-titulo"
          ref={campoTitulo}
          class="campo"
          type="text"
          autoComplete="off"
          maxLength={TITULO_DO_DOCUMENTO_NO_MAXIMO}
          placeholder="Como você quer chamar este documento"
          value={titulo}
          aria-invalid={erro?.campo === 'titulo' ? 'true' : undefined}
          aria-describedby={erro?.campo === 'titulo' ? 'documento-erro' : undefined}
          onInput={(e) => setTitulo((e.target as HTMLInputElement).value)}
        />
      </div>
      <div class="documento-campo">
        <label for="documento-destino">Guardar em</label>
        <select id="documento-destino" ref={campoDestino} class="campo" value={destino} onChange={(e) => setDestino((e.target as HTMLSelectElement).value)}>
          <optgroup label="Salas">
            {salas.map((s) => (
              <option key={s.id} value={`sala:${s.id}`}>
                {s.nome}
              </option>
            ))}
          </optgroup>
          {pessoas.length > 0 && (
            <optgroup label="Pessoas">
              {pessoas.map((p) => (
                <option key={p.id} value={`pessoa:${p.id}`}>
                  {p.nome}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>
      {erro && (
        <p id="documento-erro" class="tarefa-erro" role="alert">
          {erro.texto}
        </p>
      )}
      <div class="documento-botoes">
        <button type="submit" class="botao primario" disabled={guardando}>
          Guardar
        </button>
        <button type="button" class="botao-texto" onClick={aoCancelar}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

export function Documentos({ de, salaId, pessoaId }: Props) {
  const todos = useDocumentos();
  const salas = useSalas();
  const pessoas = usePessoas();
  const acoes = useAcoes();
  const [aberto, setAberto] = useState(false);
  const [guardadoEm, setGuardadoEm] = useState<string | null>(null);
  const botaoAdicionar = useRef<HTMLButtonElement>(null);

  // Pessoa: só os dela. Sala: os da sala que não são de uma pessoa (essas ficam na página da pessoa).
  const daCaixa = (todos ?? [])
    .filter((d) => !d.arquivado && (pessoaId ? d.pessoaId === pessoaId : d.salaId === salaId && !d.pessoaId))
    .sort((a, b) => a.titulo.localeCompare(b.titulo, 'pt-BR'));

  const inicial = pessoaId ? `pessoa:${pessoaId}` : `sala:${salaId ?? ''}`;

  function nomeDoDestino(destino: string): string {
    const id = destino.slice(destino.indexOf(':') + 1);
    return (destino.startsWith('pessoa:') ? pessoas?.find((p) => p.id === id)?.nome : salas.find((s) => s.id === id)?.nome) ?? 'o destino escolhido';
  }

  return (
    <section class="painel documentos" aria-labelledby="titulo-documentos" aria-busy={todos === undefined}>
      <h2 id="titulo-documentos">Documentos</h2>
      {todos !== undefined && daCaixa.length === 0 && (
        <div>
          <p class="lista-vazia-titulo">Nenhum documento ainda.</p>
          <p class="lista-vazia-texto">{`Cole o link de um arquivo do OneDrive ou de um site e ele fica guardado aqui, ${de}.`}</p>
        </div>
      )}
      {daCaixa.length > 0 && (
        <ul class="documentos-lista" aria-label={`Documentos ${de}`}>
          {daCaixa.map((doc) => (
            <LinhaDoDocumento key={doc.id} doc={doc} acoes={acoes} />
          ))}
        </ul>
      )}
      <AvisoDasAcoes acoes={acoes} />
      {guardadoEm && !aberto && (
        <p class="documentos-guardado" role="status">
          {`Guardado em ${guardadoEm}.`}
        </p>
      )}
      {aberto ? (
        <FormularioNovo
          inicial={inicial}
          aoCancelar={() => {
            setAberto(false);
            queueMicrotask(() => botaoAdicionar.current?.focus());
          }}
          aoGuardar={(destino) => {
            setGuardadoEm(nomeDoDestino(destino));
            setAberto(false);
            queueMicrotask(() => botaoAdicionar.current?.focus());
          }}
        />
      ) : (
        <button
          type="button"
          class="botao documentos-adicionar"
          ref={botaoAdicionar}
          aria-expanded="false"
          onClick={() => {
            setGuardadoEm(null);
            acoes.limpar();
            setAberto(true);
          }}
        >
          Adicionar documento
        </button>
      )}
    </section>
  );
}
