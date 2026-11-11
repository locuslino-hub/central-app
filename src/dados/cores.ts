// Sala pela cor do Google (spec 2026-11-09, blocos e cores). O dono liga, uma
// vez, cada cor ou etiqueta do Google a uma sala (tela Cores do Google); o
// registro sincroniza pela coleção `coresDasSalas`. Na hora de mostrar, a sala
// de um compromisso segue esta ordem:
//   1. a sala gravada pela Central no evento (centralSala);
//   2. a sala ligada à cor própria do evento (etiqueta `label:` ou `cor:`);
//   3. a adivinhada pelo título (mesmas regras das tarefas do chat);
//   4. a sala ligada à cor da agenda (`agenda:`), que é a de quase todos os
//      eventos dela e por isso vale só depois do título;
//   5. nenhuma (neutro).
import { CORES_DOS_EVENTOS } from '../../script/agenda';
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
  // A cor da agenda é de quase todos os eventos dela: vale depois do título.
  const daAgenda = evento.cor?.chave.startsWith('agenda:') === true;
  if (daCor !== undefined && !daAgenda) return daCor;
  return adivinhar?.(evento.titulo) ?? daCor ?? null;
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

/** O hex de uma chave sem evento à vista: da paleta, da própria chave ou um cinza (etiqueta). */
function hexDaChave(chave: string): string {
  if (chave.startsWith('cor:')) return CORES_DOS_EVENTOS[chave.slice(4)] ?? '#9e9e9e';
  if (chave.startsWith('agenda:')) return `#${chave.slice(7)}`;
  return '#9e9e9e';
}

/**
 * As cores para a tela Cores do Google: as vistas nos eventos e, no fim, as
 * que não têm evento no período: as 11 cores de evento do Google (para o dono
 * poder ligar uma cor ainda não usada a uma sala nova) e as que têm sala
 * ligada (para dar para desligar).
 */
export function coresParaLigar(eventos: readonly Evento[], registros: readonly CorDaSala[] | undefined): CorVista[] {
  const vistas = coresVistas(eventos);
  const jaVistas = new Set(vistas.map((v) => v.chave));
  const daPaleta = Object.keys(CORES_DOS_EVENTOS).map((id) => `cor:${id}`);
  const semEventos = [...new Set([...daPaleta, ...mapaDeCores(registros).keys()])]
    .filter((chave) => !jaVistas.has(chave))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    .map((chave) => ({ chave, hex: hexDaChave(chave), quantos: 0, exemplos: [] }));
  return [...vistas, ...semEventos];
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
