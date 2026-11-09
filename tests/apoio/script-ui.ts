// O script do Google, falso, para as telas que leem agenda e e-mail juntas
// (Painel do dia e Agora): guarda uma conexão e responde no lugar do script
// (`fetch`). O pedido passa pelo cliente de verdade (`chamar`). Nomes fictícios.
import { vi } from 'vitest';
import { salvarConexao } from '../../src/conexao/guarda';
import type { Evento } from '../../src/dados/agenda';
import type { Email } from '../../src/dados/emails';

const URL_FICTICIA = 'https://script.google.com/macros/s/ID-FICTICIO/exec';
const CODIGO = 'codigo-ficticio-de-teste-0123456789abcdef';

type Opcoes = { eventos?: Evento[]; emails?: Email[]; conectar?: boolean; agendaFalha?: boolean };

export async function scriptDeTeste({ eventos = [], emails = [], conectar = true, agendaFalha = false }: Opcoes = {}) {
  if (conectar) await salvarConexao({ url: URL_FICTICIA, codigo: CODIGO });
  const pedidos: { acao: string; dados: { de?: string; ate?: string } }[] = [];
  const estado = { eventos, emails, agendaFalha };

  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: { body: string }) => {
      const { acao, dados } = JSON.parse(init.body);
      pedidos.push({ acao, dados });
      let resposta: unknown = { ok: true, dados: {} };
      if (acao === 'eventos') {
        resposta = estado.agendaFalha ? { ok: false, erro: 'interno' } : { ok: true, dados: { eventos: estado.eventos, incompleto: false } };
      }
      if (acao === 'emails' || acao === 'atualizarEmails') resposta = { ok: true, dados: estado.emails };
      return { text: async () => JSON.stringify(resposta) };
    }),
  );

  return {
    pedidos,
    acoes: () => pedidos.map((p) => p.acao),
    leiturasDaAgenda: () => pedidos.filter((p) => p.acao === 'eventos').map((p) => p.dados),
    responderEventos(lista: Evento[]) {
      estado.eventos = lista;
    },
  };
}
