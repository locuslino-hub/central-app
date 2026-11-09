// Serviço avançado do Google Agenda (Calendar API v3) na memória, com o que o
// script usa: CalendarList.list e Events.list/get/insert/patch/remove. Segue a
// referência da API: páginas menores que maxResults, orderBy=startTime só com
// singleEvents, timeMin/timeMax em RFC 3339 com fuso, datas devolvidas no fuso
// pedido (ou no da agenda), evento apagado fica `cancelled` e some da lista,
// apagar de novo dá 410. Os horários usam o Intl do Node, independente do
// cálculo de fuso do script. Nomes e ids são fictícios.

export type DataDaApi = { date?: string; dateTime?: string; timeZone?: string };

export interface Participante {
  email?: string;
  self?: boolean;
  organizer?: boolean;
  responseStatus?: string;
}

export interface EventoGuardado {
  id: string;
  summary?: string;
  status: string;
  /** Instante (ms) para horário; data para dia inteiro. */
  inicio: { ms: number } | { data: string };
  fim: { ms: number } | { data: string };
  timeZone?: string;
  transparency?: string;
  attendees?: Participante[];
  extendedProperties?: { private?: Record<string, string>; shared?: Record<string, string> };
  eventType?: string;
  description?: string;
  htmlLink: string;
}

export interface AgendaGuardada {
  entrada: {
    id: string;
    summary: string;
    primary?: boolean;
    selected?: boolean;
    hidden?: boolean;
    accessRole: string;
    timeZone: string;
  };
  eventos: Map<string, EventoGuardado>;
}

export type Chamada = { metodo: string; args: unknown[] };

/**
 * Erro como o do serviço avançado (GoogleJsonResponseException): mensagem com
 * o motivo e `details.code` com o status HTTP, sem dados do dono.
 */
function erroDaApi(metodo: string, texto: string, status: number): Error {
  const erro = new Error(`API call to calendar.${metodo} failed with error: ${texto}`);
  erro.name = 'GoogleJsonResponseException';
  (erro as Error & { details: unknown }).details = { code: status, message: texto };
  return erro;
}

/** Id escolhido pelo cliente: base32hex (a-v, 0-9), 5 a 1024 caracteres (referência de events.insert). */
const ID_DO_CLIENTE = /^[a-v0-9]{5,1024}$/;

const RFC3339_COM_FUSO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const LOCAL_SEM_FUSO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/;

const formatos = new Map<string, Intl.DateTimeFormat>();

function formato(fuso: string): Intl.DateTimeFormat {
  let achado = formatos.get(fuso);
  if (!achado) {
    achado = new Intl.DateTimeFormat('en-US', {
      timeZone: fuso,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatos.set(fuso, achado);
  }
  return achado;
}

/** Diferença do fuso em minutos no instante `ms`, pelo Intl (tzdata do Node). */
function deslocamento(ms: number, fuso: string): number {
  const partes = formato(fuso).formatToParts(new Date(ms));
  const p = (tipo: string) => Number(partes.find((x) => x.type === tipo)!.value);
  const comoUtc = Date.UTC(p('year'), p('month') - 1, p('day'), p('hour'), p('minute'), p('second'));
  return Math.round((comoUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

/** `ms` em RFC 3339 no fuso, como a API devolve: `2026-10-23T11:00:00+01:00`. */
export function noFuso(ms: number, fuso: string): string {
  const minutos = deslocamento(ms, fuso);
  const local = new Date(ms + minutos * 60000).toISOString().slice(0, 19);
  if (minutos === 0 && fuso === 'UTC') return `${local}Z`;
  const sinal = minutos < 0 ? '-' : '+';
  const abs = Math.abs(minutos);
  return `${local}${sinal}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/** Hora local de parede num fuso -> instante, como a API faz com dateTime + timeZone. */
export function deLocal(local: string, fuso: string): number {
  const m = LOCAL_SEM_FUSO.exec(local);
  if (!m) throw new Error('local inválido');
  const comoUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  const primeiro = comoUtc - deslocamento(comoUtc, fuso) * 60000;
  return comoUtc - deslocamento(primeiro, fuso) * 60000;
}

function lerData(valor: DataDaApi | undefined, fusoDaAgenda: string, metodo: string) {
  if (!valor) throw erroDaApi(metodo, 'Missing start or end', 400);
  if (valor.date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(valor.date)) throw erroDaApi(metodo, 'Bad Request', 400);
    return { data: valor.date };
  }
  if (typeof valor.dateTime !== 'string') throw erroDaApi(metodo, 'Bad Request', 400);
  if (RFC3339_COM_FUSO.test(valor.dateTime)) return { ms: Date.parse(valor.dateTime) };
  // Sem deslocamento, a API usa o timeZone do evento (ou o da agenda).
  if (!LOCAL_SEM_FUSO.test(valor.dateTime)) throw erroDaApi(metodo, 'Bad Request', 400);
  return { ms: deLocal(valor.dateTime, valor.timeZone ?? fusoDaAgenda) };
}

function msDe(ponto: { ms: number } | { data: string }, fuso: string): number {
  return 'ms' in ponto ? ponto.ms : deLocal(`${ponto.data}T00:00:00`, fuso);
}

function clonar<T>(valor: T): T {
  return valor === undefined ? valor : (JSON.parse(JSON.stringify(valor)) as T);
}

export interface OpcoesDoFalso {
  /** O servidor devolve no máximo isto por página, mesmo pedindo mais (a API pode). */
  paginaMaxima?: number;
  /**
   * Como o patch trata os mapas de extendedProperties: 'mescla' (cada chave
   * enviada substitui; as outras ficam) ou 'substitui' (o mapa enviado,
   * private ou shared, troca o guardado inteiro; o mapa não enviado fica).
   * O script tem de funcionar com os dois.
   */
  patch?: 'mescla' | 'substitui';
}

export function calendarioFalso(opcoes: OpcoesDoFalso = {}) {
  const agendas = new Map<string, AgendaGuardada>();
  const chamadas: Chamada[] = [];
  /** Convites ou avisos que a API teria mandado por e-mail. */
  const notificacoes: { metodo: string; sendUpdates: unknown }[] = [];
  let proximo = 0;
  const pagina = (pedido: unknown, padrao: number) =>
    Math.min(typeof pedido === 'number' ? pedido : padrao, opcoes.paginaMaxima ?? Infinity);

  function agenda(id: string, metodo: string): AgendaGuardada {
    const real = id === 'primary' ? [...agendas.values()].find((a) => a.entrada.primary)?.entrada.id : id;
    const achada = real === undefined ? undefined : agendas.get(real);
    if (!achada) throw erroDaApi(metodo, 'Not Found', 404);
    return achada;
  }

  function podeEscrever(a: AgendaGuardada, metodo: string) {
    if (a.entrada.accessRole !== 'owner' && a.entrada.accessRole !== 'writer') {
      throw erroDaApi(metodo, 'Forbidden', 403);
    }
  }

  function avisar(metodo: string, evento: EventoGuardado, args: Record<string, unknown> | undefined) {
    const convidados = (evento.attendees ?? []).filter((p) => !p.self);
    // Sem sendUpdates, a API usa 'false' (ninguém); 'all' ou 'externalOnly' mandam e-mail.
    if (convidados.length > 0 && args?.sendUpdates !== 'none' && args?.sendUpdates !== undefined) {
      notificacoes.push({ metodo, sendUpdates: args.sendUpdates });
    }
  }

  /** O recurso como a API devolve, no fuso pedido ou no da agenda. */
  function recurso(a: AgendaGuardada, e: EventoGuardado, fusoPedido?: string) {
    const fuso = fusoPedido ?? e.timeZone ?? a.entrada.timeZone;
    const data = (ponto: EventoGuardado['inicio']): DataDaApi =>
      'ms' in ponto ? { dateTime: noFuso(ponto.ms, fuso), ...(e.timeZone ? { timeZone: e.timeZone } : {}) } : { date: ponto.data };
    return clonar({
      kind: 'calendar#event',
      id: e.id,
      status: e.status,
      htmlLink: e.htmlLink,
      summary: e.summary,
      description: e.description,
      start: data(e.inicio),
      end: data(e.fim),
      transparency: e.transparency,
      attendees: e.attendees,
      extendedProperties: e.extendedProperties,
      eventType: e.eventType ?? 'default',
    });
  }

  const CalendarList = {
    list(args: Record<string, unknown> = {}) {
      chamadas.push({ metodo: 'CalendarList.list', args: [clonar(args)] });
      const todas = [...agendas.values()]
        .map((a) => a.entrada)
        .filter((e) => args.showHidden === true || !e.hidden);
      const tamanho = pagina(args.maxResults, 100);
      const desde = typeof args.pageToken === 'string' ? Number(args.pageToken) : 0;
      const items = todas.slice(desde, desde + tamanho).map((e) => {
        // A API só manda `primary`/`selected` quando são verdadeiros.
        const { primary, selected, ...resto } = e;
        return clonar({ kind: 'calendar#calendarListEntry', ...resto, ...(primary ? { primary } : {}), ...(selected ? { selected } : {}) });
      });
      const seguinte = desde + tamanho < todas.length ? String(desde + tamanho) : undefined;
      return { items, ...(seguinte ? { nextPageToken: seguinte } : {}) };
    },
  };

  const Events = {
    list(agendaId: string, args: Record<string, unknown> = {}) {
      chamadas.push({ metodo: 'Events.list', args: [agendaId, clonar(args)] });
      const a = agenda(agendaId, 'events.list');
      if (args.orderBy === 'startTime' && args.singleEvents !== true) throw erroDaApi('events.list', 'Bad Request', 400);
      for (const campo of ['timeMin', 'timeMax'] as const) {
        const valor = args[campo];
        if (valor !== undefined && (typeof valor !== 'string' || !RFC3339_COM_FUSO.test(valor))) {
          throw erroDaApi('events.list', 'Bad Request', 400);
        }
      }
      if (typeof args.maxResults === 'number' && args.maxResults > 2500) throw erroDaApi('events.list', 'Bad Request', 400);
      const min = typeof args.timeMin === 'string' ? Date.parse(args.timeMin) : -Infinity;
      const max = typeof args.timeMax === 'string' ? Date.parse(args.timeMax) : Infinity;
      const fuso = a.entrada.timeZone;
      const todos = [...a.eventos.values()]
        .filter((e) => args.showDeleted === true || e.status !== 'cancelled')
        // timeMin limita o fim (exclusivo), timeMax limita o início (exclusivo).
        .filter((e) => msDe(e.fim, fuso) > min && msDe(e.inicio, fuso) < max)
        .sort((x, y) => (args.orderBy === 'startTime' ? msDe(x.inicio, fuso) - msDe(y.inicio, fuso) : 0));
      const tamanho = pagina(args.maxResults, 250);
      const desde = typeof args.pageToken === 'string' ? Number(args.pageToken) : 0;
      const fusoPedido = typeof args.timeZone === 'string' ? args.timeZone : undefined;
      const items = todos.slice(desde, desde + tamanho).map((e) => recurso(a, e, fusoPedido));
      const seguinte = desde + tamanho < todos.length ? String(desde + tamanho) : undefined;
      return { kind: 'calendar#events', items, ...(seguinte ? { nextPageToken: seguinte } : {}) };
    },

    get(agendaId: string, eventoId: string, args: Record<string, unknown> = {}) {
      chamadas.push({ metodo: 'Events.get', args: [agendaId, eventoId, clonar(args)] });
      const a = agenda(agendaId, 'events.get');
      const e = a.eventos.get(eventoId);
      // Apagado continua visível no get, com status cancelled.
      if (!e) throw erroDaApi('events.get', 'Not Found', 404);
      return recurso(a, e);
    },

    insert(corpo: Record<string, any>, agendaId: string, args: Record<string, unknown> = {}) {
      chamadas.push({ metodo: 'Events.insert', args: [clonar(corpo), agendaId, clonar(args)] });
      const a = agenda(agendaId, 'events.insert');
      podeEscrever(a, 'events.insert');
      const inicio = lerData(corpo.start, a.entrada.timeZone, 'events.insert');
      const fim = lerData(corpo.end, a.entrada.timeZone, 'events.insert');
      if (msDe(fim, a.entrada.timeZone) < msDe(inicio, a.entrada.timeZone)) {
        throw erroDaApi('events.insert', 'The specified time range is empty.', 400);
      }
      let id: string;
      if (corpo.id !== undefined) {
        if (typeof corpo.id !== 'string' || !ID_DO_CLIENTE.test(corpo.id)) throw erroDaApi('events.insert', 'Invalid resource id value.', 400);
        // Id já usado, mesmo por evento apagado: 409.
        if (a.eventos.has(corpo.id)) throw erroDaApi('events.insert', 'The requested identifier already exists.', 409);
        id = corpo.id;
      } else {
        proximo += 1;
        id = `ev${String(proximo).padStart(6, '0')}criado`;
      }
      const evento: EventoGuardado = {
        id,
        summary: corpo.summary,
        status: 'confirmed',
        inicio,
        fim,
        timeZone: corpo.start.timeZone,
        transparency: corpo.transparency,
        attendees: clonar(corpo.attendees),
        extendedProperties: clonar(corpo.extendedProperties),
        description: corpo.description,
        htmlLink: `https://www.google.com/calendar/event?eid=${id}`,
      };
      a.eventos.set(id, evento);
      avisar('insert', evento, args);
      return recurso(a, evento);
    },

    patch(corpo: Record<string, any>, agendaId: string, eventoId: string, args: Record<string, unknown> = {}) {
      chamadas.push({ metodo: 'Events.patch', args: [clonar(corpo), agendaId, eventoId, clonar(args)] });
      const a = agenda(agendaId, 'events.patch');
      podeEscrever(a, 'events.patch');
      const e = a.eventos.get(eventoId);
      if (!e || e.status === 'cancelled') throw erroDaApi('events.patch', 'Not Found', 404);
      for (const [campo, valor] of Object.entries(clonar(corpo))) {
        if (campo === 'extendedProperties') {
          if (opcoes.patch === 'substitui') {
            // Cada mapa enviado (private/shared) troca o guardado inteiro; o não enviado fica.
            e.extendedProperties = { ...(e.extendedProperties ?? {}), ...(valor ?? {}) };
          } else {
            const atual = e.extendedProperties ?? {};
            for (const [tipo, mapa] of Object.entries(valor ?? {})) {
              (atual as Record<string, Record<string, string>>)[tipo] = {
                ...((atual as Record<string, Record<string, string>>)[tipo] ?? {}),
                ...(mapa as Record<string, string>),
              };
            }
            e.extendedProperties = atual;
          }
        } else if (campo === 'summary' || campo === 'transparency' || campo === 'description') {
          (e as unknown as Record<string, unknown>)[campo] = valor;
        } else if (campo === 'attendees') {
          e.attendees = valor;
        }
      }
      avisar('patch', e, args);
      return recurso(a, e);
    },

    remove(agendaId: string, eventoId: string, args: Record<string, unknown> = {}) {
      chamadas.push({ metodo: 'Events.remove', args: [agendaId, eventoId, clonar(args)] });
      const a = agenda(agendaId, 'events.delete');
      podeEscrever(a, 'events.delete');
      const e = a.eventos.get(eventoId);
      if (!e) throw erroDaApi('events.delete', 'Not Found', 404);
      if (e.status === 'cancelled') throw erroDaApi('events.delete', 'Resource has been deleted', 410);
      e.status = 'cancelled';
      avisar('delete', e, args);
    },
  };

  return {
    agendas,
    chamadas,
    notificacoes,
    servico: { CalendarList, Events },
    /** Agenda na lista do dono. */
    agenda(entrada: Partial<AgendaGuardada['entrada']> & { id: string }) {
      const nova: AgendaGuardada = {
        entrada: { summary: 'Agenda', accessRole: 'owner', timeZone: 'Europe/Lisbon', selected: true, ...entrada },
        eventos: new Map(),
      };
      agendas.set(entrada.id, nova);
      return nova;
    },
    /** Evento criado fora do app (no Google Agenda, por convite etc.). */
    evento(
      agendaId: string,
      e: Omit<Partial<EventoGuardado>, 'inicio' | 'fim'> & {
        id: string;
        inicio: string;
        fim: string;
      },
    ) {
      const a = agenda(agendaId, 'teste');
      const ponto = (valor: string) => (/^\d{4}-\d{2}-\d{2}$/.test(valor) ? { data: valor } : { ms: Date.parse(valor) });
      const { inicio, fim, ...resto } = e;
      const guardado: EventoGuardado = {
        status: 'confirmed',
        htmlLink: `https://www.google.com/calendar/event?eid=${e.id}`,
        ...resto,
        inicio: ponto(inicio),
        fim: ponto(fim),
      };
      a.eventos.set(e.id, guardado);
      return guardado;
    },
    /** Chamadas de um método, na ordem. */
    de: (metodo: string) => chamadas.filter((c) => c.metodo === metodo),
  };
}

export type CalendarioFalso = ReturnType<typeof calendarioFalso>;

/** O dono como de costume: principal, uma agenda de trabalho e uma assinada, só leitura. */
export function agendasDoDono(opcoes?: OpcoesDoFalso) {
  const cal = calendarioFalso(opcoes);
  cal.agenda({ id: 'marina.ficticia@example.com', summary: 'Marina', primary: true, selected: true });
  cal.agenda({ id: 'aulas-ficticias@group.example.com', summary: 'Aulas da Aurora', selected: true, accessRole: 'writer' });
  cal.agenda({ id: 'feriados-ficticios@group.example.com', summary: 'Feriados', selected: true, accessRole: 'reader' });
  return cal;
}
