// Serviço avançado do Gmail (API v1) na memória, só para LER: Users.Messages.list
// e Users.Threads.get. Qualquer outro método (enviar, mudar marcadores, lixeira,
// rascunhos...) fica registrado em `proibidas` e lança: os testes conferem que
// a lista continua vazia. A busca não é interpretada: o falso devolve as
// mensagens marcadas com `casa: true`, as mais novas primeiro, como o Gmail.
// Nomes e endereços são fictícios (@exemplo.invalid).

export interface MensagemFalsa {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  /** ms desde 1970, como texto (formato da API). */
  internalDate: string;
  de?: string;
  assunto?: string;
  /** A mensagem casa com a busca do script (não lida, Principal, 14 dias). */
  casa?: boolean;
}

export interface ChamadaAoGmail {
  metodo: string;
  args: unknown[];
}

export const DIA_MS = 24 * 60 * 60 * 1000;
export const AGORA = Date.parse('2026-11-05T12:20:00Z');

export function gmailFalso(inicial: MensagemFalsa[] = []) {
  const mensagens: MensagemFalsa[] = [...inicial];
  const chamadas: ChamadaAoGmail[] = [];
  const proibidas: string[] = [];
  /** Conversas que somem entre a lista e a leitura (404). */
  const sumidas = new Set<string>();
  const estado = { falharLista: '', falharConversa: '' };

  const cabecalhos = (m: MensagemFalsa) => {
    const lista: { name: string; value: string }[] = [];
    if (m.de !== undefined) lista.push({ name: 'From', value: m.de });
    if (m.assunto !== undefined) lista.push({ name: 'Subject', value: m.assunto });
    // Cabeçalho que o script não pede: só vem se ele pedir tudo.
    lista.push({ name: 'To', value: 'dono.ficticio@exemplo.invalid' });
    return lista;
  };

  const Messages = {
    list(userId: string, args: Record<string, unknown>) {
      chamadas.push({ metodo: 'Messages.list', args: [userId, args] });
      if (estado.falharLista) throw new Error(estado.falharLista);
      const casadas = mensagens
        .filter((m) => m.casa)
        .sort((a, b) => Number(b.internalDate) - Number(a.internalDate));
      const tamanho = typeof args.maxResults === 'number' ? args.maxResults : 100;
      const inicio = typeof args.pageToken === 'string' ? Number(args.pageToken) : 0;
      const pagina = casadas.slice(inicio, inicio + tamanho);
      const fim = inicio + tamanho;
      return {
        messages: pagina.map((m) => ({ id: m.id, threadId: m.threadId })),
        ...(fim < casadas.length ? { nextPageToken: String(fim) } : {}),
        resultSizeEstimate: casadas.length,
      };
    },
  };

  const Threads = {
    get(userId: string, id: string, args: Record<string, unknown>) {
      chamadas.push({ metodo: 'Threads.get', args: [userId, id, args] });
      if (estado.falharConversa) throw new Error(estado.falharConversa);
      const daConversa = mensagens.filter((m) => m.threadId === id);
      if (sumidas.has(id) || daConversa.length === 0) {
        throw new Error('API call to gmail.users.threads.get failed with error: Not Found');
      }
      const formato = args.format;
      return {
        id,
        historyId: '1',
        messages: daConversa
          .sort((a, b) => Number(a.internalDate) - Number(b.internalDate))
          .map((m) => ({
            id: m.id,
            threadId: m.threadId,
            labelIds: [...m.labelIds],
            snippet: m.snippet,
            internalDate: m.internalDate,
            payload: {
              headers: cabecalhos(m).filter(
                (c) => formato !== 'metadata' || (args.metadataHeaders as string[] | undefined)?.indexOf(c.name) !== -1,
              ),
              // Corpo só aparece se o script pedir o formato completo.
              ...(formato === 'full' ? { body: { data: 'Q29ycG8gZG8gZS1tYWls' } } : {}),
            },
          })),
      };
    },
  };

  // Qualquer outra coisa acessada em Users, Messages ou Threads é proibida.
  const vigiar = <T extends object>(nome: string, alvo: T): T =>
    new Proxy(alvo, {
      get(objeto, chave, receptor) {
        if (typeof chave === 'symbol' || chave in objeto) return Reflect.get(objeto, chave, receptor);
        proibidas.push(`${nome}.${chave}`);
        return () => {
          throw new Error(`método proibido: ${nome}.${String(chave)}`);
        };
      },
    });

  const servico = {
    Users: vigiar('Users', {
      Messages: vigiar('Messages', Messages),
      Threads: vigiar('Threads', Threads),
    }),
  };

  return {
    servico,
    mensagens,
    chamadas,
    proibidas,
    sumidas,
    estado,
    de: (metodo: string) => chamadas.filter((c) => c.metodo === metodo),
  };
}

export type GmailFalso = ReturnType<typeof gmailFalso>;

let sequencia = 0;

/** Mensagem não lida na Principal, na caixa de entrada, que casa com a busca. */
export function naoLida(extra: Partial<MensagemFalsa> = {}): MensagemFalsa {
  sequencia += 1;
  const id = `18c${String(sequencia).padStart(13, '0')}`;
  return {
    id,
    threadId: id,
    labelIds: ['UNREAD', 'INBOX', 'CATEGORY_PERSONAL'],
    snippet: 'Oi, segue o capítulo revisado para a reunião de quinta.',
    internalDate: String(AGORA - 2 * 60 * 60 * 1000),
    de: 'Marina <marina@exemplo.invalid>',
    assunto: 'Capítulo 2 revisado',
    casa: true,
    ...extra,
  };
}

/** Resposta do dono na mesma conversa (marcador SENT), já lida. */
export function respostaDoDono(conversa: string, quando: number, extra: Partial<MensagemFalsa> = {}): MensagemFalsa {
  sequencia += 1;
  return {
    id: `19d${String(sequencia).padStart(13, '0')}`,
    threadId: conversa,
    labelIds: ['SENT'],
    snippet: 'Obrigado, leio hoje.',
    internalDate: String(quando),
    de: 'Dono <dono.ficticio@exemplo.invalid>',
    assunto: 'Re: Capítulo 2 revisado',
    ...extra,
  };
}

/** Guarda na memória, como o cache do script. */
export function guardaNaMemoria(inicial: string | null = null) {
  const guarda = {
    texto: inicial,
    gravacoes: [] as string[],
    falharGravacao: false,
    ler: () => guarda.texto,
    gravar(texto: string) {
      if (guarda.falharGravacao) throw new Error('Cache cheio');
      guarda.gravacoes.push(texto);
      guarda.texto = texto;
    },
  };
  return guarda;
}
