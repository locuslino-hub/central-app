import { beforeEach, describe, expect, it, vi } from 'vitest';
import { desfazerCartao, enviar, lerConversa, limparConversa } from '../../src/chat/conversa';
import { listar, semear, semearPalavras } from '../../src/dados/loja';

// Quinta-feira, 2026-11-05, 12:20 (Europe/Lisbon). Só a data é falsa.
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 5, 12, 20));
  limparConversa();
  await semear();
  await semearPalavras();
});

describe('o chat grava sempre', () => {
  it('regra 11/11: frase sem sentido é gravada como tarefa de hoje, com cartão, certeza baixa e Desfazer; frase vazia não cria nada', async () => {
    await enviar('   ');
    expect(lerConversa()).toEqual([]);
    expect(await listar('tarefas')).toEqual([]);

    await enviar('asdf qwer');

    const resposta = lerConversa().find((m) => m.de === 'central');
    if (resposta?.de !== 'central') throw new Error('o chat devia ter respondido');
    expect(resposta.cartoes).toHaveLength(1);
    expect(resposta.cartoes[0].item.certeza).toBe('baixa');
    expect(resposta.cartoes[0].situacao).toBe('salvo');
    expect(resposta.texto).not.toContain('Não entendi');

    const tarefas = await listar('tarefas');
    expect(tarefas).toHaveLength(1);
    expect(tarefas[0]).toMatchObject({ titulo: 'Asdf qwer', data: '2026-11-05' });

    // Desfazer: o cartão guardado desfaz a tarefa.
    expect(resposta.cartoes[0].tarefaId).toBe(tarefas[0].id);
    await desfazerCartao(resposta.cartoes[0].id);
    expect(await listar('tarefas')).toEqual([]);
  });
});
