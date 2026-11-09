// A agenda do Google, falsa, para as telas de calendário: guarda uma conexão e
// responde no lugar do script (`fetch`). O pedido passa pelo cliente de verdade
// (`chamar`), então a conferência do endereço e do formato da resposta também roda.
import { vi } from 'vitest';
import { salvarConexao } from '../../src/conexao/guarda';
import type { Evento } from '../../src/dados/agenda';

const URL_FICTICIA = 'https://script.google.com/macros/s/ID-FICTICIO/exec';
const CODIGO = 'codigo-ficticio-de-teste-0123456789abcdef';

let contador = 0;
export function evento(titulo: string, extra: Partial<Evento> = {}): Evento {
  contador += 1;
  return {
    id: `evento-${contador}`,
    agendaId: 'primary',
    titulo,
    inicio: '2026-11-05T09:00:00+00:00',
    fim: '2026-11-05T10:00:00+00:00',
    diaInteiro: false,
    livre: false,
    recusado: false,
    salaId: null,
    link: null,
    ...extra,
  };
}

export type RespostaDoScript = { ok: true; dados: unknown } | { ok: false; erro: 'codigo-invalido' | 'ocupado' | 'interno' } | 'rede';

/**
 * `eventos`: a resposta à ação `eventos`, escolhida a cada pedido (recebe o período).
 * `ping`: a resposta a `ping`. Qualquer outra ação responde `{}`.
 */
export async function agendaDeTeste(
  inicial: Evento[] = [],
  { conectar = true }: { conectar?: boolean } = {},
) {
  if (conectar) await salvarConexao({ url: URL_FICTICIA, codigo: CODIGO });
  const pedidos: { acao: string; dados: { de?: string; ate?: string } }[] = [];
  const estado: {
    eventos: (periodo: { de: string; ate: string }) => RespostaDoScript;
    ping: () => RespostaDoScript;
  } = {
    eventos: () => ({ ok: true, dados: { eventos: inicial, incompleto: false } }),
    ping: () => ({ ok: true, dados: {} }),
  };

  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: { body: string }) => {
      const { acao, dados } = JSON.parse(init.body);
      pedidos.push({ acao, dados });
      const resposta: RespostaDoScript =
        acao === 'eventos' ? estado.eventos(dados) : acao === 'ping' ? estado.ping() : { ok: true, dados: {} };
      if (resposta === 'rede') throw new TypeError('Failed to fetch');
      return { text: async () => JSON.stringify(resposta) };
    }),
  );

  return {
    pedidos,
    /** Pedidos de eventos (um por período lido). */
    leituras: () => pedidos.filter((p) => p.acao === 'eventos'),
    responder(eventos: Evento[], incompleto = false) {
      estado.eventos = () => ({ ok: true, dados: { eventos, incompleto } });
    },
    /** Só os eventos que cabem no período pedido, como o script faz (por dia de início). */
    responderPeloPeriodo(todos: Evento[]) {
      estado.eventos = ({ de, ate }) => ({
        ok: true,
        dados: {
          eventos: todos.filter((e) => e.inicio.slice(0, 10) <= ate && (e.diaInteiro ? e.fim > de : e.fim.slice(0, 10) >= de)),
          incompleto: false,
        },
      });
    },
    falharEventosCom(resposta: RespostaDoScript) {
      estado.eventos = () => resposta;
    },
    ping(resposta: RespostaDoScript) {
      estado.ping = () => resposta;
    },
  };
}
