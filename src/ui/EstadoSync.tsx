// Estado da sincronia sempre em texto (o ponto colorido só reforça).
import { useEffect, useState } from 'preact/hooks';
import { lerConexao } from '../conexao/guarda';
import { assinarEstado, estadoAtual, type EstadoSync } from '../dados/sincronia';

export const TEXTO_DO_ESTADO: Record<EstadoSync, string> = {
  atualizado: 'Atualizado',
  atualizando: 'Atualizando…',
  'sem-internet': 'Sem internet',
  'por-enviar': 'Por enviar',
  'erro-codigo': 'Problema com o código do aparelho',
};

/** Sem conexão guardada neste aparelho, "sem internet" seria enganoso: falta conectar. */
export const TEXTO_NAO_CONECTADO = 'Aparelho não conectado';

type Mostrado = EstadoSync | 'nao-conectado';

const TEXTO: Record<Mostrado, string> = { ...TEXTO_DO_ESTADO, 'nao-conectado': TEXTO_NAO_CONECTADO };

/** Só o que pede atenção vai para o leitor de tela; voltar ao normal fica em silêncio. */
const ANUNCIADOS = new Set<Mostrado>(['sem-internet', 'por-enviar', 'erro-codigo', 'nao-conectado']);

/** Estados que levam a Conectar aparelho. */
const LEVAM_A_CONECTAR = new Set<Mostrado>(['erro-codigo', 'nao-conectado']);

/** `undefined` enquanto não leu. Relê a cada mudança de estado e a cada troca de página. */
function useAparelhoConectado(estado: EstadoSync): boolean | undefined {
  const [conectado, setConectado] = useState<boolean>();
  useEffect(() => {
    let ativo = true;
    const ler = () =>
      lerConexao()
        .then((conexao) => ativo && setConectado(conexao !== null && conexao !== undefined))
        .catch(() => ativo && setConectado(undefined));
    void ler();
    window.addEventListener('hashchange', ler);
    return () => {
      ativo = false;
      if (typeof window !== 'undefined') window.removeEventListener('hashchange', ler);
    };
  }, [estado]);
  return conectado;
}

/** Já em Conectar aparelho? Ali o chip só diz o estado: um link para a própria página não leva a lugar nenhum. */
function useEmConectar(): boolean {
  const ler = () => typeof location !== 'undefined' && /^#\/conectar(?:[/?]|$)/.test(location.hash);
  const [em, setEm] = useState(ler);
  useEffect(() => {
    const atualizar = () => setEm(ler());
    atualizar();
    window.addEventListener('hashchange', atualizar);
    return () => window.removeEventListener('hashchange', atualizar);
  }, []);
  return em;
}

export function EstadoDaSincronia() {
  const [estado, setEstado] = useState<EstadoSync>(estadoAtual);
  useEffect(() => {
    setEstado(estadoAtual());
    return assinarEstado(setEstado);
  }, []);
  const conectado = useAparelhoConectado(estado);
  const emConectar = useEmConectar();

  const mostrado: Mostrado = conectado === false && estado !== 'atualizando' ? 'nao-conectado' : estado;
  const texto = TEXTO[mostrado];
  return (
    <>
      <div class="sync" data-estado={mostrado}>
        <span class="ponto" aria-hidden="true" />
        <span class="so-leitor">Sincronização: </span>
        {LEVAM_A_CONECTAR.has(mostrado) && !emConectar ? <a href="#/conectar">{texto}</a> : <span>{texto}</span>}
      </div>
      {/* Região viva à parte: o leitor recebe só o texto, e só nos estados que pedem atenção. */}
      <p class="so-leitor" role="status">
        {ANUNCIADOS.has(mostrado) ? texto : ''}
      </p>
    </>
  );
}
