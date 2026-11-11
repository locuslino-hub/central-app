// Notas de uma sala ou de uma pessoa: um campo de texto que salva sozinho.
//
//   - Grava um instante depois de o dono parar de digitar, ao sair do campo, ao
//     esconder o app e ao sair da página: nada digitado se perde.
//   - Uma atualização vinda de outro aparelho nunca mexe no campo em edição
//     (texto, foco e cursor ficam como estão). Se o dono não digitou nada, a
//     versão nova aparece quando ele sai do campo.
//   - Sala ou pessoa apagada (inclusive em outro aparelho, com a página aberta):
//     nada de "Salvo". O campo avisa que a nota não foi guardada e o texto fica
//     nele (e na página "não encontrada" que aparece no lugar, ver Sala e Pessoa).
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  NOTAS_NO_MAXIMO,
  guardarNotasPorGuardar,
  notasGuardadas,
  notasPorGuardar,
  salvarNotas,
  type DonoDeNotas,
} from '../dados/notas';
import './salas.css';

/** Quanto tempo depois da última tecla a nota é gravada. */
export const ATRASO_DAS_NOTAS_MS = 700;

type Props = {
  colecao: DonoDeNotas;
  id: string;
  /** O que está guardado agora (muda quando outro aparelho grava). */
  notas: string | undefined;
  /** Texto de apoio dentro do campo vazio. */
  dica: string;
};

type Situacao = 'parado' | 'salvando' | 'salvo' | 'erro' | 'apagado';

const TEXTO_DA_SITUACAO: Record<Exclude<Situacao, 'apagado'>, string> = {
  parado: '',
  salvando: 'Salvando…',
  salvo: 'Salvo',
  erro: 'Não consegui salvar.',
};

const APAGADO: Record<DonoDeNotas, string> = {
  salas: 'Esta sala foi apagada; a nota não foi guardada.',
  pessoas: 'Esta pessoa foi apagada; a nota não foi guardada.',
};

export function Notas({ colecao, id, notas, dica }: Props) {
  // Texto que ficou por guardar (a sala sumiu com ele no campo) volta ao campo.
  const [pendente] = useState(() => notasPorGuardar(colecao, id));
  const [texto, setTexto] = useState(pendente ?? notas ?? '');
  const [situacao, setSituacao] = useState<Situacao>('parado');
  const campo = useRef<HTMLTextAreaElement>(null);
  /** O texto mais novo digitado, mesmo antes de o estado se refazer. */
  const atual = useRef(texto);
  /** Digitou e ainda não gravou. */
  const sujo = useRef(pendente !== undefined && pendente !== (notas ?? ''));
  /** Abriu com texto por guardar (o efeito roda depois: o dono pode já ter digitado). */
  const abriuPorGuardar = useRef(sujo.current);
  /** Uma versão nova chegou de fora enquanto o campo estava em uso: aparece ao sair, se nada foi digitado. */
  const chegouDeFora = useRef(false);
  const doRegistro = useRef(notas);
  doRegistro.current = notas;
  const alvo = useRef({ colecao, id });
  alvo.current = { colecao, id };
  const relogio = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** As gravações andam em fila: duas seguidas nunca se cruzam. */
  const fila = useRef<Promise<void>>(Promise.resolve());

  function gravar(): Promise<void> {
    clearTimeout(relogio.current);
    fila.current = fila.current.then(async () => {
      if (!sujo.current) return;
      const texto = atual.current;
      sujo.current = false;
      setSituacao('salvando');
      try {
        const { colecao, id } = alvo.current;
        if (!(await salvarNotas(colecao, id, texto))) {
          // A sala ou a pessoa não existe mais: nada foi guardado, e o texto fica.
          sujo.current = true;
          setSituacao('apagado');
          return;
        }
        notasGuardadas(colecao, id, texto);
        // Se digitou de novo durante a gravação, o "Salvo" espera a próxima.
        if (!sujo.current) setSituacao('salvo');
      } catch (erro) {
        console.error('Não consegui salvar as notas', erro);
        sujo.current = true;
        setSituacao('erro');
      }
    });
    return fila.current;
  }

  // Versão nova de outro aparelho: só entra se o dono não está no meio de uma edição.
  useEffect(() => {
    if (notas === atual.current) return;
    if (sujo.current) return;
    if (document.activeElement === campo.current) {
      chegouDeFora.current = true;
      return;
    }
    atual.current = notas ?? '';
    setTexto(atual.current);
  }, [notas]);

  // Abriu com texto por guardar: tenta já (se a sala ainda não existe, o aviso aparece).
  useEffect(() => {
    if (abriuPorGuardar.current) void gravar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Esconder o app ou sair da página também grava.
  useEffect(() => {
    const aoEsconder = () => {
      if (document.visibilityState === 'hidden' && sujo.current) void gravar();
    };
    const aoSair = () => {
      if (sujo.current) void gravar();
    };
    document.addEventListener('visibilitychange', aoEsconder);
    window.addEventListener('pagehide', aoSair);
    return () => {
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', aoEsconder);
      if (typeof window !== 'undefined') window.removeEventListener('pagehide', aoSair);
      clearTimeout(relogio.current);
      // Trocar de página com o texto ainda por gravar: grava agora.
      if (sujo.current) void gravar();
    };
    // `gravar` só lê refs: uma vez basta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const idDoCampo = `notas-${colecao}-${id}`;
  return (
    <section class="painel notas" aria-labelledby={`titulo-${idDoCampo}`}>
      <h2 id={`titulo-${idDoCampo}`}>Notas</h2>
      <textarea
        id={idDoCampo}
        ref={campo}
        class="campo notas-campo"
        aria-labelledby={`titulo-${idDoCampo}`}
        placeholder={dica}
        maxLength={NOTAS_NO_MAXIMO}
        value={texto}
        spellcheck
        onInput={(e) => {
          const novo = (e.target as HTMLTextAreaElement).value;
          atual.current = novo;
          sujo.current = true;
          guardarNotasPorGuardar(colecao, id, novo);
          chegouDeFora.current = false;
          setTexto(novo);
          setSituacao('parado');
          clearTimeout(relogio.current);
          relogio.current = setTimeout(() => void gravar(), ATRASO_DAS_NOTAS_MS);
        }}
        onBlur={() => {
          void gravar().then(() => {
            // Nada digitado aqui, mas outro aparelho mudou a nota enquanto o campo estava em uso.
            if (!sujo.current && chegouDeFora.current && doRegistro.current !== atual.current) {
              chegouDeFora.current = false;
              atual.current = doRegistro.current ?? '';
              setTexto(atual.current);
            }
          });
        }}
      />
      <div class="notas-rodape">
        <p class="notas-situacao" role="status">
          {situacao === 'apagado' ? APAGADO[colecao] : TEXTO_DA_SITUACAO[situacao]}
        </p>
        {situacao === 'erro' && (
          <button type="button" class="botao-texto" onClick={() => void gravar()}>
            Tentar de novo
          </button>
        )}
      </div>
    </section>
  );
}
