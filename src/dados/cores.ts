// Sala pela cor do Google (spec 2026-11-09, blocos e cores). O dono liga, uma
// vez, cada cor ou etiqueta do Google a uma sala (tela Cores do Google); o
// registro sincroniza pela coleção `coresDasSalas`. Na hora de mostrar, a sala
// de um compromisso segue esta ordem:
//   1. a sala gravada pela Central no evento (centralSala);
//   2. a sala ligada à cor do evento;
//   3. a adivinhada pelo título (mesmas regras das tarefas do chat);
//   4. nenhuma (neutro).
import type { Evento } from './agenda';
import { resumo } from './eventos-feitos';
import { salvar } from './loja';
import type { CorDaSala } from './tipos';

/** O id do registro de uma cor: o mesmo em todo aparelho. */
export function idDaCor(chave: string): string {
  return `cor-${resumo(chave)}`;
}

/** Cor -> sala, só das cores que têm sala (as apagadas e as "Sem sala" ficam de fora). */
export function mapaDeCores(registros: readonly CorDaSala[] | undefined): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const r of registros ?? []) if (!r.apagado && r.salaId !== null) mapa.set(r.chave, r.salaId);
  return mapa;
}

/** A sala de um compromisso na ordem acima; null se nada decide. */
export function salaDoEvento(
  evento: Pick<Evento, 'salaId' | 'titulo' | 'cor'>,
  cores: ReadonlyMap<string, string>,
  adivinhar?: (titulo: string) => string | null,
): string | null {
  if (evento.salaId !== null) return evento.salaId;
  const daCor = evento.cor ? cores.get(evento.cor.chave) : undefined;
  if (daCor !== undefined) return daCor;
  return adivinhar?.(evento.titulo) ?? null;
}

/** Liga a cor a uma sala, ou a deixa sem sala (null). Um registro por cor. */
export function ligarCor(chave: string, salaId: string | null): Promise<CorDaSala> {
  return salvar('coresDasSalas', { id: idDaCor(chave), chave, salaId });
}

export type CorVista = { chave: string; hex: string; quantos: number; exemplos: string[] };

/** As cores dos eventos, com quantos têm cada uma e até 2 títulos diferentes; as mais usadas primeiro. */
export function coresVistas(eventos: readonly Evento[]): CorVista[] {
  const porChave = new Map<string, CorVista>();
  for (const evento of eventos) {
    if (!evento.cor) continue;
    const vista = porChave.get(evento.cor.chave) ?? { chave: evento.cor.chave, hex: evento.cor.hex, quantos: 0, exemplos: [] };
    vista.quantos += 1;
    const titulo = evento.titulo.trim() || '(sem título)';
    if (vista.exemplos.length < 2 && !vista.exemplos.includes(titulo)) vista.exemplos.push(titulo);
    porChave.set(vista.chave, vista);
  }
  return [...porChave.values()].sort((a, b) => b.quantos - a.quantos || a.chave.localeCompare(b.chave));
}

/** Os nomes que o Google Agenda dá às cores de evento ('1' a '11'). */
const NOMES_DAS_CORES: Readonly<Record<string, string>> = {
  '1': 'Lavanda',
  '2': 'Sálvia',
  '3': 'Uva',
  '4': 'Flamingo',
  '5': 'Banana',
  '6': 'Tangerina',
  '7': 'Pavão',
  '8': 'Grafite',
  '9': 'Mirtilo',
  '10': 'Manjericão',
  '11': 'Tomate',
};

/** A cor em palavras, para quem não distingue a amostra. */
export function nomeDaCor(chave: string): string {
  if (chave.startsWith('cor:')) return NOMES_DAS_CORES[chave.slice(4)] ?? 'Cor do evento';
  if (chave.startsWith('label:')) return 'Etiqueta do Google';
  return 'Cor da agenda';
}
