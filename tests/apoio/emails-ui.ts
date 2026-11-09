// O Gmail do script, falso, para as telas de e-mail: guarda uma conexão e
// responde no lugar do script (`fetch`). O pedido passa pelo cliente de verdade
// (`chamar`). Nomes e endereços são fictícios (@exemplo.invalid).
import { vi } from 'vitest';
import { salvarConexao } from '../../src/conexao/guarda';
import type { Email } from '../../src/dados/emails';

const URL_FICTICIA = 'https://script.google.com/macros/s/ID-FICTICIO/exec';
const CODIGO = 'codigo-ficticio-de-teste-0123456789abcdef';

let contador = 0;
export function email(assunto: string, extra: Partial<Email> = {}): Email {
  contador += 1;
  const id = `mensagem${contador}`;
  return {
    id,
    remetente: 'Marina',
    enderecoRemetente: 'marina@exemplo.invalid',
    assunto,
    trecho: `Trecho de ${assunto}`,
    data: '2026-11-05T10:20:00+00:00',
    link: `https://mail.google.com/mail/u/0/#all/${id}`,
    ...extra,
  };
}

export type RespostaDoScript =
  | { ok: true; dados: unknown }
  | { ok: false; erro: 'codigo-invalido' | 'ocupado' | 'interno' }
  | 'rede';

export async function gmailDeTeste(inicial: unknown[] = [], { conectar = true }: { conectar?: boolean } = {}) {
  if (conectar) await salvarConexao({ url: URL_FICTICIA, codigo: CODIGO });
  const pedidos: { acao: string; dados: unknown }[] = [];
  const estado: Record<'emails' | 'atualizarEmails' | 'ping', () => RespostaDoScript> = {
    emails: () => ({ ok: true, dados: inicial }),
    atualizarEmails: () => ({ ok: true, dados: inicial }),
    ping: () => ({ ok: true, dados: {} }),
  };

  /** Enquanto houver um portão, as respostas esperam: dá para ver a tela "atualizando". */
  let portao: Promise<void> | null = null;

  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: { body: string }) => {
      const { acao, dados } = JSON.parse(init.body);
      pedidos.push({ acao, dados });
      if (portao) await portao;
      const responder = (estado as Record<string, () => RespostaDoScript>)[acao];
      const resposta: RespostaDoScript = responder ? responder() : { ok: true, dados: {} };
      if (resposta === 'rede') throw new TypeError('Failed to fetch');
      return { text: async () => JSON.stringify(resposta) };
    }),
  );

  return {
    pedidos,
    de: (acao: string) => pedidos.filter((p) => p.acao === acao),
    /** Troca a lista que as duas ações (`emails` e `atualizarEmails`) devolvem. */
    responder(lista: unknown) {
      estado.emails = () => ({ ok: true, dados: lista });
      estado.atualizarEmails = () => ({ ok: true, dados: lista });
    },
    falharCom(resposta: RespostaDoScript, acao: 'emails' | 'atualizarEmails' | 'ambas' = 'ambas') {
      if (acao !== 'atualizarEmails') estado.emails = () => resposta;
      if (acao !== 'emails') estado.atualizarEmails = () => resposta;
    },
    /** Segura as respostas até chamar a função devolvida. */
    segurar(): () => void {
      let soltar = () => {};
      portao = new Promise<void>((pronto) => (soltar = pronto));
      return () => {
        portao = null;
        soltar();
      };
    },
    ping(resposta: RespostaDoScript) {
      estado.ping = () => resposta;
    },
  };
}
