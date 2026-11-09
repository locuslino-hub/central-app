import { useEffect, useState } from 'preact/hooks';
import { assinar, lerConfig, listar } from '../dados/loja';
import { hojeEmLisboa, vigiarODia } from '../dados/dia';
import type { Colecoes, Config, Documento, EstadoEmail, Pagina, Palavra, Pessoa, Sala, Tarefa } from '../dados/tipos';
import { resolverRota, type RotaAtual } from '../rotas';

// ---- Tamanho da tela ----

export type Tela = 'celular' | 'tablet' | 'computador';

/** Barra inferior até 699 px, trilho de 700 a 1100 px, colunas acima. */
export const ULTIMO_PX_DO_CELULAR = 699;
export const ULTIMO_PX_DO_TABLET = 1100;

export function telaPara(largura: number): Tela {
  if (largura <= ULTIMO_PX_DO_CELULAR) return 'celular';
  if (largura <= ULTIMO_PX_DO_TABLET) return 'tablet';
  return 'computador';
}

/** A tela atual, acompanhando o tamanho da janela. Uma só fonte para o layout inteiro. */
export function useTela(): Tela {
  const [tela, setTela] = useState(() => telaPara(window.innerWidth));
  useEffect(() => {
    const medir = () => setTela(telaPara(window.innerWidth));
    medir();
    window.addEventListener('resize', medir);
    return () => { if (typeof window !== 'undefined') window.removeEventListener('resize', medir); };
  }, []);
  return tela;
}

// ---- Rota e data ----

/** Hoje, renovado ao voltar ao app e a cada minuto: o mês do menu acompanha a virada. */
export function useHoje(): Date {
  const [hoje, setHoje] = useState(() => new Date());
  useEffect(() => {
    const renovar = () =>
      setHoje((antes) => {
        const agora = new Date();
        return agora.toDateString() === antes.toDateString() ? antes : agora;
      });
    document.addEventListener('visibilitychange', renovar);
    const relogio = setInterval(renovar, 60_000);
    return () => {
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', renovar);
      clearInterval(relogio);
    };
  }, []);
  return hoje;
}

/**
 * O dia de hoje em Lisboa, `AAAA-MM-DD`. Muda sozinho na meia-noite (sem
 * recarregar) e ao voltar ao app em outro dia: as listas do dia se refazem.
 */
export function useDia(): string {
  const [dia, setDia] = useState(() => hojeEmLisboa());
  useEffect(() => {
    setDia(hojeEmLisboa());
    return vigiarODia(setDia);
  }, []);
  return dia;
}

/** O instante de agora, renovado a cada minuto e ao voltar ao app: marca o que já passou. */
export function useAgora(): Date {
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    const renovar = () => setAgora(new Date());
    document.addEventListener('visibilitychange', renovar);
    const relogio = setInterval(renovar, 60_000);
    renovar();
    return () => {
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', renovar);
      clearInterval(relogio);
    };
  }, []);
  return agora;
}

export function useRota(hoje: Date): RotaAtual {
  const [hash, setHash] = useState(() => location.hash);
  useEffect(() => {
    const atualizar = () => setHash(location.hash);
    window.addEventListener('hashchange', atualizar);
    atualizar();
    return () => { if (typeof window !== 'undefined') window.removeEventListener('hashchange', atualizar); };
  }, []);
  return resolverRota(hash, hoje);
}

/** Título da aba: `Quadro · Central de Comando`. */
export function useTituloDaAba(titulo: string) {
  useEffect(() => {
    document.title = `${titulo} · Central de Comando`;
  }, [titulo]);
}

// ---- Dados que o menu e as páginas leem ----

/** Recarrega a lista sempre que a coleção muda (neste aparelho ou vinda de outro). */
function useLista<C extends 'salas' | 'pessoas' | 'palavras' | 'tarefas' | 'estadosEmail' | 'documentos' | 'paginas'>(colecao: C): Colecoes[C][] | undefined {
  const [lista, setLista] = useState<Colecoes[C][]>();
  useEffect(() => {
    let ativo = true;
    const ler = () =>
      listar(colecao)
        .then((itens) => ativo && setLista(itens))
        .catch((erro: unknown) => console.error('Não consegui ler os dados guardados', erro));
    void ler();
    const parar = assinar((mudanca) => {
      if (mudanca.colecao === colecao) void ler();
    });
    return () => {
      ativo = false;
      parar();
    };
  }, [colecao]);
  return lista;
}

/** As salas, na ordem do dono. Vazia enquanto lê. */
export function useSalas(): Sala[] {
  const lista = useLista('salas');
  return lista ? [...lista].sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, 'pt-BR')) : [];
}

/** `undefined` enquanto lê; `null` se não existe (ou foi apagado). */
export function useSala(id: string | undefined): Sala | null | undefined {
  const lista = useLista('salas');
  return lista && (lista.find((sala) => sala.id === id) ?? null);
}

/** As tarefas vivas (nenhuma apagada). `undefined` enquanto lê. */
export function useTarefas(): Tarefa[] | undefined {
  return useLista('tarefas');
}

/** O que o dono já fez com cada e-mail (Feito, Agora não). `undefined` enquanto lê. */
export function useEstadosDeEmail(): EstadoEmail[] | undefined {
  return useLista('estadosEmail');
}

/** Os documentos vivos (arquivados também; quem mostra filtra). undefined enquanto lê. */
export function useDocumentos(): Documento[] | undefined {
  return useLista('documentos');
}

/** As páginas do caderno (de todas as salas). undefined enquanto lê. */
export function usePaginas(): Pagina[] | undefined {
  return useLista('paginas');
}

export function usePessoas(): Pessoa[] | undefined {
  return useLista('pessoas');
}

/** As palavras que a memória do chat liga a uma sala ("banheiro" é Casa). `undefined` enquanto lê. */
export function usePalavras(): Palavra[] | undefined {
  return useLista('palavras');
}

export function usePessoa(id: string | undefined): Pessoa | null | undefined {
  const lista = useLista('pessoas');
  return lista && (lista.find((pessoa) => pessoa.id === id) ?? null);
}

/** Os ajustes (fim do dia, dia fechado), relidos quando mudam aqui ou no outro aparelho. `undefined` enquanto lê. */
export function useConfig(): Config | undefined {
  const [config, setConfig] = useState<Config>();
  useEffect(() => {
    let ativo = true;
    const ler = () =>
      lerConfig()
        .then((lido) => ativo && setConfig(lido))
        .catch((erro: unknown) => console.error('Não consegui ler os ajustes', erro));
    void ler();
    const parar = assinar((mudanca) => {
      if (mudanca.colecao === 'config') void ler();
    });
    return () => {
      ativo = false;
      parar();
    };
  }, []);
  return config;
}
