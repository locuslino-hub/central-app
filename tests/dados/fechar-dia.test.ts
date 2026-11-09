// Tarefa 16: o que o Agora e o Fechar o dia fazem com tarefas e com o dia.
// Cada ação devolve a entrada do desfazer, que volta só o que ela mudou.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { desfazer } from '../../src/dados/desfazer';
import { diaFechado, fecharDia } from '../../src/dados/fechar-dia';
import { lerConfig, listar, salvar } from '../../src/dados/loja';
import * as loja from '../../src/dados/loja';
import { EmParte } from '../../src/dados/desfazer';
import { adiarEmails } from '../../src/dados/emails-estado';
import { adiarTarefa, moverTarefa, moverTarefas, mudarPrazo } from '../../src/dados/tarefas';
import { criar } from '../apoio/tarefas';

// Quinta-feira, 2026-11-05, 12:20 em Lisboa.
const HOJE = '2026-11-05';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-11-05T12:20:00Z'));
});

const lerTarefa = async (id: string) => (await listar('tarefas')).find((t) => t.id === id)!;

describe('adiarTarefa ("Agora não" do Agora)', () => {
  it('a tarefa sai da fila até amanhã; Desfazer devolve como era', async () => {
    const { id } = await criar('Rever capítulo 3', { data: HOJE });
    const entrada = await adiarTarefa(id, HOJE);
    expect(entrada?.rotulo).toBe('Volta amanhã: Rever capítulo 3');
    expect((await lerTarefa(id)).adiadaAte).toBe('2026-11-06');
    // O resto da tarefa não muda: continua de hoje, na checklist.
    expect((await lerTarefa(id)).data).toBe(HOJE);
    await entrada!.reverter();
    expect('adiadaAte' in (await lerTarefa(id))).toBe(false);
  });

  it('um adiamento anterior volta exatamente como era', async () => {
    const { id } = await criar('Ler artigo', { data: HOJE, adiadaAte: '2026-11-01' });
    const entrada = await adiarTarefa(id, HOJE);
    await entrada!.reverter();
    expect((await lerTarefa(id)).adiadaAte).toBe('2026-11-01');
  });

  it('na virada do mês soma o dia certo; tarefa que sumiu não grava nada', async () => {
    const { id } = await criar('Fechar notas', { data: '2026-11-30' });
    await adiarTarefa(id, '2026-11-30');
    expect((await lerTarefa(id)).adiadaAte).toBe('2026-12-01');
    expect(await adiarTarefa('nao-existe', HOJE)).toBeUndefined();
  });

  it('entra na pilha do app (o mesmo Desfazer do chat)', async () => {
    const { id } = await criar('Rever capítulo 3', { data: HOJE });
    const entrada = await adiarTarefa(id, HOJE);
    expect(desfazer.ultimo()).toBe(entrada);
  });
});

describe('moverTarefa (Fechar o dia)', () => {
  it('Amanhã: a data muda; Desfazer devolve a data e só ela', async () => {
    const { id } = await criar('Rever capítulo 3', { data: HOJE, salaId: 'sala-orientacoes' });
    const entrada = await moverTarefa(id, { tipo: 'amanha', hoje: HOJE });
    expect(entrada?.rotulo).toBe('Para amanhã: Rever capítulo 3');
    expect((await lerTarefa(id)).data).toBe('2026-11-06');
    // Enquanto isso, o outro aparelho mudou a sala: o Desfazer não apaga essa mudança.
    await salvar('tarefas', { ...(await lerTarefa(id)), salaId: 'sala-casa' });
    await entrada!.reverter();
    expect(await lerTarefa(id)).toMatchObject({ data: HOJE, salaId: 'sala-casa' });
  });

  it('Sem prazo: sai a data (e a semana); Desfazer devolve as duas', async () => {
    const { id } = await criar('Ler artigo', { data: HOJE, semana: '2026-11-02', semanaVencida: '2026-10-26' });
    const entrada = await moverTarefa(id, { tipo: 'sem-prazo' });
    expect(entrada?.rotulo).toBe('Em Sem prazo: Ler artigo');
    const movida = await lerTarefa(id);
    expect(movida.data).toBeUndefined();
    expect(movida.semana).toBeUndefined();
    expect(movida.semanaVencida).toBeUndefined();
    await entrada!.reverter();
    expect(await lerTarefa(id)).toMatchObject({ data: HOJE, semana: '2026-11-02', semanaVencida: '2026-10-26' });
  });

  it('prazo fica com o seu dia: nem Amanhã nem Sem prazo (nada é gravado)', async () => {
    const prazo = await criar('Entrega', { data: '2026-11-04', prazoHora: '17:00' });
    expect(await moverTarefa(prazo.id, { tipo: 'sem-prazo' })).toBeUndefined();
    expect(await moverTarefa(prazo.id, { tipo: 'amanha', hoje: HOJE })).toBeUndefined();
    expect(await lerTarefa(prazo.id)).toMatchObject({ data: '2026-11-04', prazoHora: '17:00' });
  });

  it('compromisso antigo (com hora de início) vai para amanhã, mas não para Sem prazo', async () => {
    const compromisso = await criar('Reunião antiga', { data: HOJE, inicio: '10:00' });
    expect(await moverTarefa(compromisso.id, { tipo: 'sem-prazo' })).toBeUndefined();
    await moverTarefa(compromisso.id, { tipo: 'amanha', hoje: HOJE });
    expect((await lerTarefa(compromisso.id)).data).toBe('2026-11-06');
  });

  it('dia que não existe não grava; na virada do mês, amanhã é dia 1', async () => {
    const { id } = await criar('Ler artigo', { data: HOJE });
    expect(await moverTarefa(id, { tipo: 'amanha', hoje: '2026-02-31' })).toBeUndefined();
    expect((await lerTarefa(id)).data).toBe(HOJE);
    await moverTarefa(id, { tipo: 'amanha', hoje: '2026-11-30' });
    expect((await lerTarefa(id)).data).toBe('2026-12-01');
  });

  it('moverTarefas: todas de uma vez, um Desfazer só que volta todas', async () => {
    const a = await criar('Rever capítulo 3', { data: HOJE });
    const b = await criar('Ler artigo', { data: '2026-11-04' });
    const entrada = await moverTarefas([a.id, b.id], { tipo: 'amanha', hoje: HOJE });
    expect(entrada?.rotulo).toBe('2 tarefas para amanhã');
    expect((await lerTarefa(a.id)).data).toBe('2026-11-06');
    expect((await lerTarefa(b.id)).data).toBe('2026-11-06');
    await entrada!.reverter();
    expect((await lerTarefa(a.id)).data).toBe(HOJE);
    expect((await lerTarefa(b.id)).data).toBe('2026-11-04');
  });

  it('moverTarefas deixa as de prazo onde estão', async () => {
    const a = await criar('Rever capítulo 3', { data: HOJE });
    const p = await criar('Entrega', { data: HOJE, prazoHora: '17:00' });
    const entrada = await moverTarefas([a.id, p.id], { tipo: 'amanha', hoje: HOJE });
    expect(entrada?.rotulo).toBe('1 tarefa para amanhã');
    expect((await lerTarefa(p.id)).data).toBe(HOJE);
  });

  it('se uma escrita falha no meio, o que já andou tem Desfazer mesmo assim', async () => {
    const a = await criar('Rever capítulo 3', { data: HOJE });
    const b = await criar('Ler artigo', { data: HOJE });
    const salvarDeVerdade = loja.salvar;
    let vezes = 0;
    const espiao = vi.spyOn(loja, 'salvar').mockImplementation(async (...args: Parameters<typeof loja.salvar>) => {
      vezes += 1;
      if (vezes === 2) throw new Error('disco cheio');
      return salvarDeVerdade(...args);
    });
    const erro = await moverTarefas([a.id, b.id], { tipo: 'amanha', hoje: HOJE }).catch((e: unknown) => e);
    espiao.mockRestore();
    expect(erro).toBeInstanceOf(EmParte);
    const parcial = erro as EmParte;
    expect(parcial.entrada.rotulo).toBe('1 tarefa para amanhã');
    expect(desfazer.ultimo()).toBe(parcial.entrada);
    expect((await lerTarefa(a.id)).data).toBe('2026-11-06');
    await parcial.entrada.reverter();
    expect((await lerTarefa(a.id)).data).toBe(HOJE);
    expect((await lerTarefa(b.id)).data).toBe(HOJE);
  });

  it('moverTarefas com uma só diz "1 tarefa"; sem nenhuma, nada', async () => {
    const a = await criar('Rever capítulo 3', { data: HOJE });
    expect((await moverTarefas([a.id], { tipo: 'amanha', hoje: HOJE }))?.rotulo).toBe('1 tarefa para amanhã');
    expect(await moverTarefas([], { tipo: 'amanha', hoje: HOJE })).toBeUndefined();
  });
});

describe('adiarEmails (Fechar o dia: "Adiar os N e-mails")', () => {
  it('todos voltam amanhã, com um Desfazer só que devolve cada estado como era', async () => {
    await salvar('estadosEmail', { id: 'msg-b', feito: false, adiadaAte: '2026-11-01' });
    const entrada = await adiarEmails(['msg-a', 'msg-b'], HOJE);
    expect(entrada?.rotulo).toBe('2 e-mails adiados para amanhã');
    const estados = await listar('estadosEmail');
    expect(estados.map((e) => [e.id, e.adiadaAte]).sort()).toEqual([
      ['msg-a', '2026-11-06'],
      ['msg-b', '2026-11-06'],
    ]);
    await entrada!.reverter();
    expect((await listar('estadosEmail')).map((e) => [e.id, e.adiadaAte])).toEqual([['msg-b', '2026-11-01']]);
  });

  it('um só no singular; nenhum, nada', async () => {
    expect((await adiarEmails(['msg-a'], HOJE))?.rotulo).toBe('1 e-mail adiado para amanhã');
    expect(await adiarEmails([], HOJE)).toBeUndefined();
  });
});

describe('mudarPrazo (Fechar o dia: "Mudar prazo")', () => {
  it('muda dia e hora do prazo; Desfazer devolve os dois', async () => {
    const { id } = await criar('Entrega do relatório', { data: '2026-11-04', prazoHora: '17:00' });
    const entrada = await mudarPrazo(id, '2026-11-09', '12:00');
    expect(entrada?.rotulo).toBe('Prazo mudado: Entrega do relatório');
    expect(await lerTarefa(id)).toMatchObject({ data: '2026-11-09', prazoHora: '12:00' });
    await entrada!.reverter();
    expect(await lerTarefa(id)).toMatchObject({ data: '2026-11-04', prazoHora: '17:00' });
  });

  it('só vale para tarefa com prazo, dia que existe e hora certa', async () => {
    const comum = await criar('Ler artigo', { data: HOJE });
    const prazo = await criar('Entrega', { data: HOJE, prazoHora: '17:00' });
    expect(await mudarPrazo(comum.id, '2026-11-09', '12:00')).toBeUndefined();
    expect(await mudarPrazo(prazo.id, '2026-02-30', '12:00')).toBeUndefined();
    expect(await mudarPrazo(prazo.id, '2026-11-09', '25:00')).toBeUndefined();
    expect(await lerTarefa(prazo.id)).toMatchObject({ data: HOJE, prazoHora: '17:00' });
  });
});

describe('fecharDia', () => {
  it('guarda o dia fechado nos ajustes (sincroniza); Desfazer reabre', async () => {
    expect(diaFechado(await lerConfig(), HOJE)).toBe(false);
    const entrada = await fecharDia(HOJE);
    expect(entrada.rotulo).toBe('Dia fechado');
    const config = await lerConfig();
    expect(config.diaFechado).toBe(HOJE);
    expect(config.fimDoDia).toBe('20:00');
    expect(diaFechado(config, HOJE)).toBe(true);
    // No dia seguinte, o dia novo começa aberto.
    expect(diaFechado(config, '2026-11-06')).toBe(false);
    await entrada.reverter();
    expect('diaFechado' in (await lerConfig())).toBe(false);
  });

  it('não mexe no fim do dia que o dono ajustou', async () => {
    await salvar('config', { fimDoDia: '18:30' });
    const entrada = await fecharDia(HOJE);
    expect((await lerConfig()).fimDoDia).toBe('18:30');
    await salvar('config', { ...(await lerConfig()), fimDoDia: '19:00' });
    await entrada.reverter();
    expect((await lerConfig()).fimDoDia).toBe('19:00');
  });
});
