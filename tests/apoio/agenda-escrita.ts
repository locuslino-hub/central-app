// O Google Agenda falso para criar, remover e trocar a sala de eventos (Tarefa 12).
// `chamar` serve para passar a `sincronizar` e às funções de `agenda.ts`; `instalar`
// o põe no lugar do `fetch`, para o que chama o script pelo cliente de verdade.
// Como o script, criar com um id que já existe devolve o evento já criado.
import { vi } from 'vitest';
import { ErroConexao, ErroScript } from '../../src/conexao/cliente';
import { salvarConexao } from '../../src/conexao/guarda';
import type { Evento } from '../../src/dados/agenda';

const URL_FICTICIA = 'https://script.google.com/macros/s/ID-FICTICIO/exec';
const CODIGO = 'codigo-ficticio-de-teste-0123456789abcdef';
const ACOES = ['criarEvento', 'removerEvento', 'trocarSalaEvento'];

type Modo = 'ok' | 'rede' | 'recusar';

export function agendaEscrita() {
  const eventos = new Map<string, Evento>();
  const pedidos: { acao: string; dados: any }[] = [];
  const estado: { modo: Modo; aoCriar?: () => void | Promise<void> } = { modo: 'ok' };

  async function chamar<T>(acao: string, dados: any = {}): Promise<T> {
    if (!ACOES.includes(acao)) return {} as T;
    pedidos.push({ acao, dados: JSON.parse(JSON.stringify(dados)) });
    if (estado.modo === 'rede') throw new ErroConexao();
    if (estado.modo === 'recusar') throw new ErroScript('interno');
    if (acao === 'criarEvento') {
      await estado.aoCriar?.();
      const existente = eventos.get(dados.id);
      if (existente) return existente as T;
      const evento: Evento = {
        id: dados.id,
        agendaId: 'primary',
        titulo: dados.titulo,
        inicio: `${dados.data}T${dados.inicio}:00+00:00`,
        fim: `${dados.data}T${dados.fim}:00+00:00`,
        diaInteiro: false,
        livre: false,
        recusado: false,
        salaId: dados.salaId,
        link: null,
      };
      eventos.set(evento.id, evento);
      return evento as T;
    }
    if (acao === 'removerEvento') return { removido: eventos.delete(dados.id) } as T;
    const evento = eventos.get(dados.id);
    if (!evento) throw new ErroScript('interno');
    const trocado = { ...evento, salaId: dados.salaId };
    eventos.set(evento.id, trocado);
    return trocado as T;
  }

  return {
    eventos,
    pedidos,
    chamar,
    /** Pedidos de uma ação, na ordem. */
    de: (acao: string) => pedidos.filter((p) => p.acao === acao),
    modo(novo: Modo) {
      estado.modo = novo;
    },
    /** Roda algo no meio de uma criação, antes de o evento existir. */
    aoCriar(fazer: (() => void | Promise<void>) | undefined) {
      estado.aoCriar = fazer;
    },
    /** Guarda uma conexão e põe esta agenda no lugar do `fetch`. */
    async instalar({ conectar = true }: { conectar?: boolean } = {}) {
      if (conectar) await salvarConexao({ url: URL_FICTICIA, codigo: CODIGO });
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url: string, init: { body: string }) => {
          const { acao, dados } = JSON.parse(init.body);
          let resposta: unknown;
          try {
            resposta = { ok: true, dados: await chamar(acao, dados) };
          } catch (erro) {
            if (erro instanceof ErroConexao) throw new TypeError('Failed to fetch');
            resposta = { ok: false, erro: erro instanceof ErroScript ? erro.erro : 'interno' };
          }
          return { text: async () => JSON.stringify(resposta) };
        }),
      );
    },
  };
}
