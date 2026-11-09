// Compromissos que vêm do Google não têm sala gravada. Na hora de mostrar, a
// tela adivinha a sala pelo título, com as mesmas regras das tarefas do chat
// (nome da sala, palavra guardada, pessoa cadastrada). Nada é gravado: se nada
// bate, o compromisso fica neutro.
import { useMemo } from 'preact/hooks';
import { montarMemoria } from '../chat/memoria';
import { salaDoTitulo } from '../chat/regras';
import { usePalavras, usePessoas } from './hooks';

export type Adivinhar = (titulo: string) => string | null;

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
