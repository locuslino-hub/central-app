// Serviço avançado do Google Tarefas (Tasks API v1) na memória, com o que o
// script usa: Tasklists.list/insert e Tasks.list/insert/patch/remove. Segue a
// referência da API: lista sem as apagadas (showDeleted) nem as escondidas
// (showHidden) por padrão, `due` só com o dia, `completed` some ao reabrir,
// apagar marca `deleted` e o patch numa apagada continua respondendo (com
// `deleted: true`). Ids e textos são fictícios.

export type TarefaGuardada = {
  id: string;
  title?: string;
  notes?: string;
  status: 'needsAction' | 'completed';
  due?: string;
  completed?: string;
  deleted?: boolean;
  hidden?: boolean;
};

export type ListaGuardada = { id: string; title: string; tarefas: Map<string, TarefaGuardada> };

type Chamada = { metodo: string; args: unknown[] };

function erroDaApi(metodo: string, texto: string, status: number): Error {
  const erro = new Error(`API call to tasks.${metodo} failed with error: ${texto}`);
  erro.name = 'GoogleJsonResponseException';
  (erro as Error & { details: unknown }).details = { code: status, message: texto };
  return erro;
}

const clonar = <T>(valor: T): T => (valor === undefined ? valor : (JSON.parse(JSON.stringify(valor)) as T));

/** `due` como a API guarda: só o dia, à meia-noite UTC. */
function dueDaApi(valor: unknown, metodo: string): string | undefined {
  if (valor === null || valor === undefined) return undefined;
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(valor)) throw erroDaApi(metodo, 'Invalid Value', 400);
  return `${valor.slice(0, 10)}T00:00:00.000Z`;
}

export function tarefasGoogleFalso({ paginaMaxima = 100 }: { paginaMaxima?: number } = {}) {
  const listas = new Map<string, ListaGuardada>();
  const chamadas: Chamada[] = [];
  let proximo = 0;

  function lista(id: string, metodo: string): ListaGuardada {
    const achada = listas.get(id);
    if (!achada) throw erroDaApi(metodo, 'Not Found', 404);
    return achada;
  }

  function aplicar(t: TarefaGuardada, corpo: Record<string, unknown>, metodo: string) {
    for (const [campo, valor] of Object.entries(corpo)) {
      if (campo === 'title' || campo === 'notes') {
        if (valor === null) delete t[campo];
        else t[campo] = String(valor);
      } else if (campo === 'due') {
        const due = dueDaApi(valor, metodo);
        if (due === undefined) delete t.due;
        else t.due = due;
      } else if (campo === 'status') {
        if (valor !== 'needsAction' && valor !== 'completed') throw erroDaApi(metodo, 'Invalid Value', 400);
        t.status = valor;
      } else if (campo === 'completed' && valor === null) {
        delete t.completed;
      }
    }
    if (t.status === 'completed') t.completed ??= '2026-11-05T12:00:00.000Z';
    else delete t.completed;
  }

  const Tasklists = {
    list(args: Record<string, unknown> = {}) {
      chamadas.push({ metodo: 'Tasklists.list', args: [clonar(args)] });
      const todas = [...listas.values()].map(({ id, title }) => ({ kind: 'tasks#taskList', id, title }));
      const tamanho = Math.min(typeof args.maxResults === 'number' ? args.maxResults : 20, paginaMaxima);
      const desde = typeof args.pageToken === 'string' ? Number(args.pageToken) : 0;
      const seguinte = desde + tamanho < todas.length ? String(desde + tamanho) : undefined;
      return { items: todas.slice(desde, desde + tamanho), ...(seguinte ? { nextPageToken: seguinte } : {}) };
    },
    insert(corpo: { title?: string }) {
      chamadas.push({ metodo: 'Tasklists.insert', args: [clonar(corpo)] });
      proximo += 1;
      const nova: ListaGuardada = { id: `lista${proximo}`, title: String(corpo.title ?? ''), tarefas: new Map() };
      listas.set(nova.id, nova);
      return { kind: 'tasks#taskList', id: nova.id, title: nova.title };
    },
  };

  const Tasks = {
    list(listaId: string, args: Record<string, unknown> = {}) {
      chamadas.push({ metodo: 'Tasks.list', args: [listaId, clonar(args)] });
      const l = lista(listaId, 'tasks.list');
      const todas = [...l.tarefas.values()]
        .filter((t) => args.showDeleted === true || !t.deleted)
        .filter((t) => args.showHidden === true || !t.hidden)
        .filter((t) => args.showCompleted !== false || t.status !== 'completed');
      const tamanho = Math.min(typeof args.maxResults === 'number' ? args.maxResults : 20, paginaMaxima);
      const desde = typeof args.pageToken === 'string' ? Number(args.pageToken) : 0;
      const seguinte = desde + tamanho < todas.length ? String(desde + tamanho) : undefined;
      return { items: clonar(todas.slice(desde, desde + tamanho)), ...(seguinte ? { nextPageToken: seguinte } : {}) };
    },
    insert(corpo: Record<string, unknown>, listaId: string) {
      chamadas.push({ metodo: 'Tasks.insert', args: [clonar(corpo), listaId] });
      const l = lista(listaId, 'tasks.insert');
      proximo += 1;
      const nova: TarefaGuardada = { id: `tarefaGoogle${proximo}`, status: 'needsAction' };
      aplicar(nova, corpo, 'tasks.insert');
      l.tarefas.set(nova.id, nova);
      return clonar(nova);
    },
    patch(corpo: Record<string, unknown>, listaId: string, id: string) {
      chamadas.push({ metodo: 'Tasks.patch', args: [clonar(corpo), listaId, id] });
      const t = lista(listaId, 'tasks.patch').tarefas.get(id);
      if (!t) throw erroDaApi('tasks.patch', 'Not Found', 404);
      aplicar(t, corpo, 'tasks.patch');
      return clonar(t);
    },
    remove(listaId: string, id: string) {
      chamadas.push({ metodo: 'Tasks.remove', args: [listaId, id] });
      const t = lista(listaId, 'tasks.delete').tarefas.get(id);
      if (!t || t.deleted) throw erroDaApi('tasks.delete', 'Not Found', 404);
      t.deleted = true;
    },
  };

  return {
    listas,
    chamadas,
    servico: { Tasklists, Tasks },
    /** Lista criada pelo dono à mão (ou por uma versão anterior). */
    lista(title: string) {
      proximo += 1;
      const nova: ListaGuardada = { id: `lista${proximo}`, title, tarefas: new Map() };
      listas.set(nova.id, nova);
      return nova;
    },
    /** A lista "Central", se existe. */
    central: () => [...listas.values()].find((l) => l.title === 'Central'),
    /** As tarefas vivas (não apagadas) da lista "Central". */
    vivas: () => [...([...listas.values()].find((l) => l.title === 'Central')?.tarefas.values() ?? [])].filter((t) => !t.deleted),
    de: (metodo: string) => chamadas.filter((c) => c.metodo === metodo),
  };
}

export type TarefasGoogleFalso = ReturnType<typeof tarefasGoogleFalso>;
