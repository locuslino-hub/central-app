// O script do Google, falso, para os testes de ponta a ponta no navegador: o
// código de verdade (`tratar`, em script/api.ts) roda aqui, no Node, com Drive,
// Agenda, Gmail e Google Tarefas na memória. Dois aparelhos (dois contextos do navegador) podem
// falar com o mesmo script, como na vida real. Nomes e e-mails fictícios.
import type { BrowserContext, Page, Route } from '@playwright/test';
import { tratar } from '../../script/api';
import type { ServicoDeAgenda } from '../../script/agenda';
import type { ServicoDeGmail } from '../../script/email';
import type { ServicoDeTarefas } from '../../script/tarefas-google';
import { armazemNaMemoria } from './armazem';
import { agendasDoDono } from './calendario';
import { gmailFalso, guardaNaMemoria, naoLida, type MensagemFalsa } from './gmail';
import { tarefasGoogleFalso } from './tarefas-google';

export const URL_DO_SCRIPT = 'https://script.google.com/macros/s/ID-FICTICIO/exec';
export const CODIGO_DO_APARELHO = 'codigo-ficticio-de-teste-0123456789abcdef';

export function scriptFalso({ emails = [naoLida()] }: { emails?: MensagemFalsa[] } = {}) {
  const armazem = armazemNaMemoria();
  // O relógio do servidor fica depois de qualquer hora usada pelos aparelhos do teste.
  armazem.relogio = Date.parse('2026-11-05T13:00:00Z');
  const agenda = agendasDoDono();
  const gmail = gmailFalso(emails);
  const tarefasGoogle = tarefasGoogleFalso();
  const guarda = guardaNaMemoria();
  /** Uma ligação por página (aparelho): cada aparelho pode ficar sem internet sozinho. */
  const ligacoes = new Set<{ offline: boolean }>();
  /** As ações recebidas, na ordem, e quantas chegaram com o service worker no caminho. */
  const pedidos: string[] = [];

  async function atender(ligacao: { offline: boolean }, rota: Route) {
    // Sem internet o pedido nem sai do aparelho.
    if (ligacao.offline) return rota.abort('internetdisconnected');
    const { acao, dados } = rota.request().postDataJSON() as { acao: string; dados: unknown };
    pedidos.push(acao);
    const resposta = tratar(
      { codigo: CODIGO_DO_APARELHO, acao, dados },
      {
        lerCodigo: () => CODIGO_DO_APARELHO,
        armazem,
        calendario: () => agenda.servico as unknown as ServicoDeAgenda,
        gmail: () => gmail.servico as unknown as ServicoDeGmail,
        tarefasGoogle: () => tarefasGoogle.servico as unknown as ServicoDeTarefas,
        emailsGuardados: guarda,
      },
    );
    return rota.fulfill({
      headers: { 'access-control-allow-origin': '*' },
      contentType: 'application/json',
      body: JSON.stringify(resposta),
    });
  }

  return {
    armazem,
    agenda,
    gmail,
    tarefasGoogle,
    pedidos,
    /**
     * Faz o script responder a esta página (aparelho). Devolve a ligação dela: `cair()` e `voltar()`
     * tiram e devolvem a internet só desse aparelho.
     */
    async ligarA(alvo: Page | BrowserContext) {
      const ligacao = { offline: false };
      ligacoes.add(ligacao);
      await alvo.route(URL_DO_SCRIPT, (rota) => atender(ligacao, rota));
      return {
        cair: () => void (ligacao.offline = true),
        voltar: () => void (ligacao.offline = false),
      };
    },
    /** Sem internet para o script em todos os aparelhos (o navegador também pode ficar offline: `context.setOffline`). */
    cair() {
      for (const ligacao of ligacoes) ligacao.offline = true;
    },
    voltar() {
      for (const ligacao of ligacoes) ligacao.offline = false;
    },
    /** O que o script guardou no Drive (texto), para conferir que algo chegou lá. */
    guardado: () => armazem.conteudo ?? '',
  };
}

export type ScriptFalso = ReturnType<typeof scriptFalso>;

/** Guarda a conexão fictícia no navegador, como a tela Conectar faria. */
export async function conectar(page: Page) {
  await page.evaluate(
    ([url, codigo]) =>
      new Promise<void>((resolver, rejeitar) => {
        const abrir = indexedDB.open('central-conexao');
        abrir.onerror = () => rejeitar(abrir.error);
        abrir.onsuccess = () => {
          const escrita = abrir.result.transaction('conexao', 'readwrite');
          escrita.objectStore('conexao').put({ url, codigo }, 'atual');
          escrita.oncomplete = () => resolver();
        };
      }),
    [URL_DO_SCRIPT, CODIGO_DO_APARELHO] as const,
  );
}
