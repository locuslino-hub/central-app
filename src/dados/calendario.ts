// O que cada dia do calendário mostra: eventos do Google Agenda e tarefas do app,
// juntos. Funções puras sobre `AAAA-MM-DD` e minutos; nada aqui lê o relógio nem
// o fuso do aparelho.
//
// As horas dos eventos são as de Lisboa, como o script as manda
// (`2026-10-25T01:30:00+01:00`), então a tela lê o texto: o dia são 10 caracteres
// e a hora são 5. Só "passado" compara instantes, porque aí o fuso do texto conta.
// Dentro do dia, a posição é o relógio de parede, em minutos desde 00:00.
import { dataValida, segundaDaSemana, somarDias } from '../chat/datas';
import type { Evento } from './agenda';
import { hojeEmLisboa, minutoEmLisboa } from './dia';
import type { Tarefa } from './tipos';

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const MINUTOS_NO_DIA = 1440;

const dois = (n: number) => String(n).padStart(2, '0');

function diaExiste(texto: string): boolean {
  if (!DIA.test(texto)) return false;
  const [a, m, d] = texto.split('-').map(Number);
  return dataValida(a, m, d);
}

function minutosDe(hora: string): number | undefined {
  const achado = HORA.exec(hora);
  return achado ? Number(achado[1]) * 60 + Number(achado[2]) : undefined;
}

/** `HH:MM` de uma hora do script (`2026-11-05T09:30:00+00:00`). */
export const horaDe = (iso: string): string => iso.slice(11, 16);

const minutosDoIso = (iso: string): number => Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16));

/** `540` vira `09:00`; o fim do dia (1440) vira `00:00`. */
export const formatarMinutos = (min: number): string => `${dois(Math.floor(min / 60) % 24)}:${dois(min % 60)}`;

// ---- Semana, mês, ano ----

export function diasDaSemana(dia: string): string[] {
  const segunda = segundaDaSemana(dia);
  return Array.from({ length: 7 }, (_, i) => somarDias(segunda, i));
}

export function periodoDaSemana(dia: string): { de: string; ate: string } {
  const segunda = segundaDaSemana(dia);
  return { de: segunda, ate: somarDias(segunda, 6) };
}

/** As semanas inteiras (segunda a domingo) que cobrem o mês: o que a grade mostra. */
export function diasDoMes(ano: number, mes: number): string[][] {
  const primeiro = `${ano}-${dois(mes)}-01`;
  const seguinte = mes === 12 ? `${ano + 1}-01-01` : `${ano}-${dois(mes + 1)}-01`;
  const ultimo = somarDias(seguinte, -1);
  const semanas: string[][] = [];
  for (let segunda = segundaDaSemana(primeiro); segunda <= ultimo; segunda = somarDias(segunda, 7)) {
    semanas.push(Array.from({ length: 7 }, (_, i) => somarDias(segunda, i)));
  }
  return semanas;
}

export function periodoDoMes(dia: string): { de: string; ate: string } {
  const semanas = diasDoMes(Number(dia.slice(0, 4)), Number(dia.slice(5, 7)));
  return { de: semanas[0][0], ate: semanas[semanas.length - 1][6] };
}

export function mesesDoAno(ano: number): { mes: number; primeiro: string; semanas: string[][] }[] {
  return Array.from({ length: 12 }, (_, i) => ({
    mes: i + 1,
    primeiro: `${ano}-${dois(i + 1)}-01`,
    semanas: diasDoMes(ano, i + 1),
  }));
}

/** O ano inteiro: no máximo 366 dias, dentro do limite do script (400). */
export function periodoDoAno(dia: string): { de: string; ate: string } {
  const ano = dia.slice(0, 4);
  return { de: `${ano}-01-01`, ate: `${ano}-12-31` };
}

// ---- Itens de cada dia ----

/** Pedaço de um evento dentro de um dia. `ini` e `fim`: minutos de parede, 0 a 1440. */
export type ItemDeEvento = {
  tipo: 'evento';
  chave: string;
  evento: Evento;
  dia: string;
  diaInteiro: boolean;
  ini: number;
  fim: number;
  continuaAntes: boolean;
  continuaDepois: boolean;
  /** O evento todo já acabou (vale para qualquer dia em que ele aparece). */
  passado: boolean;
};

/**
 * `prazo`: marcador na hora do prazo (`ini === fim`, não ocupa tempo).
 * `bloco`: tarefa com hora de início (R28), com a duração dela.
 * `tarefa`: tarefa só com dia, na linha de dia inteiro (`ini` e `fim` valem 0).
 */
export type ItemDeTarefa = {
  tipo: 'prazo' | 'bloco' | 'tarefa';
  chave: string;
  tarefa: Tarefa;
  dia: string;
  ini: number;
  fim: number;
  passado: boolean;
};

export type Item = ItemDeEvento | ItemDeTarefa;

export type DiaDoCalendario = {
  data: string;
  /** Eventos de dia inteiro, depois tarefas só com dia. */
  diaInteiro: Item[];
  /** Eventos com horário, blocos e marcadores, pela hora. */
  horarios: Item[];
  /** Eventos recusados: ficam escondidos, e só contados. */
  recusados: number;
  /** O que aparece no dia: `diaInteiro` mais `horarios`. */
  total: number;
};

export type Calendario = { dia: (data: string) => DiaDoCalendario };

type Entrada = { eventos: Evento[]; tarefas: Tarefa[]; de: string; ate: string; agora: Date };

const RANK = { evento: 0, bloco: 1, prazo: 2, tarefa: 3 } as const;
const titulo = (item: Item): string => (item.tipo === 'evento' ? item.evento.titulo : (item.tarefa.titulo ?? ''));
const porTitulo = (a: Item, b: Item) => titulo(a).localeCompare(titulo(b), 'pt-BR');

/** Na hora repetida da mudança de hora, dois eventos com o mesmo relógio de parede: vale o instante. */
const instanteDoMesmoRelogio = (a: Item, b: Item): number =>
  a.tipo === 'evento' && b.tipo === 'evento' ? Date.parse(a.evento.inicio) - Date.parse(b.evento.inicio) : 0;

function porHorario(a: Item, b: Item): number {
  return (
    a.ini - b.ini ||
    instanteDoMesmoRelogio(a, b) ||
    RANK[a.tipo] - RANK[b.tipo] ||
    a.fim - b.fim ||
    porTitulo(a, b)
  );
}

function porDiaInteiro(a: Item, b: Item): number {
  return RANK[a.tipo] - RANK[b.tipo] || porTitulo(a, b);
}

export function montarCalendario({ eventos, tarefas, de, ate, agora }: Entrada): Calendario {
  const hoje = hojeEmLisboa(agora);
  const minutoAgora = minutoEmLisboa(agora);
  const agoraMs = agora.getTime();
  const dias = new Map<string, DiaDoCalendario>();

  const doDia = (data: string): DiaDoCalendario => {
    let dia = dias.get(data);
    if (!dia) {
      dia = { data, diaInteiro: [], horarios: [], recusados: 0, total: 0 };
      dias.set(data, dia);
    }
    return dia;
  };

  /** Cada dia de `primeiro` a `ultimo` que cai dentro do período. */
  const percorrer = (primeiro: string, ultimo: string, usar: (dia: string) => void) => {
    const fim = ultimo < ate ? ultimo : ate;
    for (let dia = primeiro > de ? primeiro : de; dia <= fim; dia = somarDias(dia, 1)) usar(dia);
  };

  for (const evento of eventos) {
    const inicio = evento.diaInteiro ? evento.inicio : evento.inicio.slice(0, 10);
    if (!diaExiste(inicio)) continue;

    if (evento.diaInteiro) {
      let ultimo = diaExiste(evento.fim) ? somarDias(evento.fim, -1) : inicio;
      if (ultimo < inicio) ultimo = inicio;
      const passado = evento.fim <= hoje;
      percorrer(inicio, ultimo, (dia) => {
        if (evento.recusado) return void doDia(dia).recusados++;
        doDia(dia).diaInteiro.push({
          tipo: 'evento',
          chave: `${evento.id}@${dia}`,
          evento,
          dia,
          diaInteiro: true,
          ini: 0,
          fim: MINUTOS_NO_DIA,
          continuaAntes: dia > inicio,
          continuaDepois: dia < ultimo,
          passado,
        });
      });
      continue;
    }

    const minutoInicio = minutosDoIso(evento.inicio);
    let ultimo = evento.fim.slice(0, 10);
    let minutoFim = minutosDoIso(evento.fim);
    if (ultimo > inicio && minutoFim === 0) {
      // Terminar à meia-noite em ponto não abre o dia seguinte.
      ultimo = somarDias(ultimo, -1);
      minutoFim = MINUTOS_NO_DIA;
    }
    if (ultimo < inicio) {
      ultimo = inicio;
      minutoFim = minutoInicio;
    }
    if (ultimo === inicio && minutoFim < minutoInicio) {
      // O relógio voltou (fim do horário de verão): vale a duração real.
      const reais = Math.round((Date.parse(evento.fim) - Date.parse(evento.inicio)) / 60_000);
      minutoFim = Math.min(MINUTOS_NO_DIA, minutoInicio + Math.max(0, reais));
    }
    const passado = Date.parse(evento.fim) <= agoraMs;
    percorrer(inicio, ultimo, (dia) => {
      if (evento.recusado) return void doDia(dia).recusados++;
      doDia(dia).horarios.push({
        tipo: 'evento',
        chave: `${evento.id}@${dia}`,
        evento,
        dia,
        diaInteiro: false,
        ini: dia === inicio ? minutoInicio : 0,
        fim: dia === ultimo ? minutoFim : MINUTOS_NO_DIA,
        continuaAntes: dia > inicio,
        continuaDepois: dia < ultimo,
        passado,
      });
    });
  }

  for (const tarefa of tarefas) {
    const dia = tarefa.data;
    if (tarefa.apagado || dia === undefined || !diaExiste(dia) || dia < de || dia > ate) continue;
    const prazo = tarefa.prazoHora === undefined ? undefined : minutosDe(tarefa.prazoHora);
    const inicio = tarefa.inicio === undefined ? undefined : minutosDe(tarefa.inicio);
    const passouAte = (minuto: number) => dia < hoje || (dia === hoje && minuto <= minutoAgora);
    if (prazo !== undefined) {
      doDia(dia).horarios.push({ tipo: 'prazo', chave: `${tarefa.id}@${dia}`, tarefa, dia, ini: prazo, fim: prazo, passado: passouAte(prazo) });
    } else if (inicio !== undefined) {
      const fim = Math.min(MINUTOS_NO_DIA, inicio + Math.max(1, tarefa.duracaoMin));
      doDia(dia).horarios.push({ tipo: 'bloco', chave: `${tarefa.id}@${dia}`, tarefa, dia, ini: inicio, fim, passado: passouAte(fim) });
    } else {
      doDia(dia).diaInteiro.push({ tipo: 'tarefa', chave: `${tarefa.id}@${dia}`, tarefa, dia, ini: 0, fim: 0, passado: dia < hoje });
    }
  }

  for (const dia of dias.values()) {
    dia.horarios.sort(porHorario);
    dia.diaInteiro.sort(porDiaInteiro);
    dia.total = dia.horarios.length + dia.diaInteiro.length;
  }

  return {
    dia: (data) => dias.get(data) ?? { data, diaInteiro: [], horarios: [], recusados: 0, total: 0 },
  };
}

/** As tarefas de "Esta semana" da semana de `dia`: da segunda-feira dela e sem dia. Em ordem de título. */
export function tarefasDaSemana(tarefas: Tarefa[], dia: string): Tarefa[] {
  const segunda = segundaDaSemana(dia);
  return tarefas
    .filter((t) => !t.apagado && t.data === undefined && t.semana === segunda)
    .sort((a, b) => String(a.titulo ?? '').localeCompare(String(b.titulo ?? ''), 'pt-BR'));
}

/**
 * Em qual linha cada bloco fica, para o que se sobrepõe não se esconder. Um
 * marcador (sem duração) ocupa `minimo` minutos, que é o tamanho dele na tela.
 */
export function empilhar(blocos: { ini: number; fim: number }[], minimo = 20): number[] {
  const ordem = blocos.map((_, i) => i).sort((a, b) => blocos[a].ini - blocos[b].ini || blocos[a].fim - blocos[b].fim);
  const fimDasLinhas: number[] = [];
  const linhas = new Array<number>(blocos.length).fill(0);
  for (const i of ordem) {
    const { ini, fim } = blocos[i];
    let linha = fimDasLinhas.findIndex((ocupadaAte) => ocupadaAte <= ini);
    if (linha < 0) linha = fimDasLinhas.length;
    fimDasLinhas[linha] = Math.max(fim, ini + minimo);
    linhas[i] = linha;
  }
  return linhas;
}

/** O horário de um evento naquele dia, em palavras. */
export function descreverHorario(item: ItemDeEvento): string {
  if (item.diaInteiro) return 'Dia inteiro';
  const { evento } = item;
  if (item.continuaAntes && item.continuaDepois) return 'Continuação do dia anterior, segue no dia seguinte';
  if (item.continuaAntes) return `Continuação do dia anterior, até ${horaDe(evento.fim)}`;
  if (item.continuaDepois) return `${horaDe(evento.inicio)}, continua no dia seguinte`;
  const a = horaDe(evento.inicio);
  const b = horaDe(evento.fim);
  return a === b ? a : `${a} às ${b}`;
}
