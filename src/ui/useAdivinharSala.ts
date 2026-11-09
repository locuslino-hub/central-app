// Compromissos que vêm do Google quase nunca têm sala gravada. Na hora de
// mostrar, a sala sai desta ordem (src/dados/cores.ts): a gravada pela
// Central, a ligada à cor do Google (tela Cores do Google), a adivinhada pelo
// título com as mesmas regras das tarefas do chat (nome da sala, palavra
// guardada, pessoa cadastrada) e, se nada bate, nenhuma (neutro). Nada é
// gravado no evento.
import { useMemo } from 'preact/hooks';
import { montarMemoria } from '../chat/memoria';
import { salaDoTitulo } from '../chat/regras';
import type { Evento } from '../dados/agenda';
import { mapaDeCores, salaDoEvento } from '../dados/cores';
import { useCoresDasSalas, usePalavras, usePessoas } from './hooks';

export type Adivinhar = (titulo: string) => string | null;

/** A sala de um compromisso, já resolvida. */
export type SalaDoEvento = (evento: Pick<Evento, 'salaId' | 'titulo' | 'cor'>) => string | null;

export function useAdivinharSala(): Adivinhar {
  const pessoas = usePessoas();
  const palavras = usePalavras();
  return useMemo(() => {
    const memoria = montarMemoria(pessoas ?? [], palavras ?? [], []);
    const lembradas = new Map<string, string | null>();
    return (titulo: string) => {
      if (!lembradas.has(titulo)) lembradas.set(titulo, salaDoTitulo(titulo, memoria));
      return lembradas.get(titulo)!;
    };
  }, [pessoas, palavras]);
}

/** A sala de cada compromisso, na mesma ordem em todas as telas. */
export function useSalaDoEvento(): SalaDoEvento {
  const adivinhar = useAdivinharSala();
  const registros = useCoresDasSalas();
  return useMemo(() => {
    const cores = mapaDeCores(registros);
    return (evento) => salaDoEvento(evento, cores, adivinhar);
  }, [adivinhar, registros]);
}
