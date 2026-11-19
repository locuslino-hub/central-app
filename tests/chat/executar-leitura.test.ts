// Voz de leitura (V02, Tarefa 13): "leitura da água 1234,5" grava na pasta de Consumo de Água, com cartão e Desfazer.
// Quinta-feira, 2026-11-05, 12:20 em Lisboa. A planilha é de mentira (tests/apoio/planilhas-falsas.ts); o resto é o código de verdade.
// Nomes e valores fictícios.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executarFrase, SEGUE_COMO_TAREFA } from '../apoio/executar-frase';
import { usarIA } from '../../src/chat/interpretar';
import type { IA } from '../../src/ia/ia';
import { listar, listarPendentes, salvar, semear, semearPalavras } from '../../src/dados/loja';
import type { Pasta } from '../../src/dados/tipos';
import { CABECALHO_CONSUMO, falsoDasPlanilhas, reiniciarPlanilhas } from '../apoio/planilhas-falsas';

vi.mock('../../src/dados/planilhas', async (importar) => (await import('../apoio/planilhas-falsas')).comPlanilhasFalsas(await importar<typeof import('../../src/dados/planilhas')>()));

const SEM_IA: IA = { estado: () => 'ausente', interpretar: async () => null };
const planilhas = falsoDasPlanilhas();

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 5, 12, 20));
  reiniciarPlanilhas();
  usarIA(SEM_IA);
  await semear();
  await semearPalavras();
});
afterEach(() => usarIA(SEM_IA));

async function pastaDeConsumo(extra: Partial<Pasta> = {}) {
  return salvar('pastas', {
    id: 'pasta-agua',
    salaId: 'sala-casa',
    tipo: 'registro',
    nome: 'Consumo de Água',
    ordem: 1,
    modelo: 'consumo',
    servico: 'agua',
    unidade: 'm³',
    planilhaId: 'planilha-ficticia-agua',
    ...extra,
  });
}

const leituraDaAgua = (data: string, leitura: string) => ({ Data: data, Leitura: leitura, Unidade: 'm³', 'Consumo desde a anterior': '', Observação: '' });

describe('frase de leitura (chat)', () => {
  it('frase de leitura da água grava na pasta de Consumo de Água e mostra cartão com Desfazer', async () => {
    await pastaDeConsumo();
    planilhas.planilha('planilha-ficticia-agua', [leituraDaAgua('01/11/2026', '1200')]);

    const resultado = await executarFrase('leitura da água 1234,5');

    const linhas = planilhas.linhas('planilha-ficticia-agua');
    expect(linhas).toHaveLength(2);
    expect(linhas[1]!.valores).toMatchObject({ Data: '2026-11-05', Leitura: '1234.5', Unidade: 'm³' });
    expect(resultado.titulo).toBe('Leitura guardada');
    expect(resultado.detalhe).toContain('Consumo de Água');
    expect(resultado.detalhe).toContain('1.234,5');
    expect(resultado.detalhe).toContain('34,5');
    expect(resultado.ver).toBe('#/sala/sala-casa/pasta/pasta-agua');
    expect(await listar('ideias')).toEqual([]);

    // Desfazer nunca apaga a linha da planilha: marca "desfeito" em Observação.
    await resultado.desfazer();
    expect(planilhas.linhas('planilha-ficticia-agua')).toHaveLength(2);
    expect(planilhas.linhas('planilha-ficticia-agua')[1]!.valores['Observação']).toBe('desfeito');
  });

  it('a data dita vale ("ontem")', async () => {
    await pastaDeConsumo();
    planilhas.planilha('planilha-ficticia-agua');

    await executarFrase('leitura da água ontem 1210');

    expect(planilhas.linhas('planilha-ficticia-agua')[0]!.valores).toMatchObject({ Data: '2026-11-04', Leitura: '1210' });
  });

  it('serviço sem pasta correspondente segue como tarefa, com aviso', async () => {
    await pastaDeConsumo(); // só há pasta de água
    planilhas.planilha('planilha-ficticia-agua');

    const resultado = await executarFrase('leitura da luz 5000');

    expect(resultado.titulo).toBe(SEGUE_COMO_TAREFA);
    expect(resultado.detalhe).toMatch(/pasta de Consumo de Luz/);
    expect(resultado.ver).toBeNull();
    expect(await listar('ideias')).toEqual([]);
    expect(planilhas.linhas('planilha-ficticia-agua')).toEqual([]);
    expect(planilhas.pedidos).toEqual([]);
  });

  it('pasta apagada ou sem planilha também não recebe a leitura', async () => {
    await pastaDeConsumo({ planilhaId: undefined });

    const resultado = await executarFrase('leitura da água 1234');

    expect(resultado.titulo).toBe(SEGUE_COMO_TAREFA);
    expect(resultado.detalhe).toMatch(/pasta de Consumo de Água/);
  });

  it('sem rede a leitura fica na fila e o cartão avisa', async () => {
    await pastaDeConsumo();
    planilhas.planilha('planilha-ficticia-agua');
    planilhas.cair();

    const resultado = await executarFrase('leitura da água 1234,5');

    expect(resultado.titulo).toBe('Leitura guardada');
    expect(resultado.detalhe).toMatch(/Sem internet/);
    expect(resultado.detalhe).toMatch(/quando a rede voltar/);
    const fila = (await listarPendentes()).filter((p) => p.tipo === 'planilha');
    expect(fila).toHaveLength(1);
    expect(fila[0]).toMatchObject({ acao: 'anexar', planilhaId: 'planilha-ficticia-agua', valores: { Leitura: '1234.5' } });
    expect(await listar('ideias')).toEqual([]);

    // Desfazer antes de enviar tira da fila: nada chega à planilha.
    await resultado.desfazer();
    expect((await listarPendentes()).filter((p) => p.tipo === 'planilha')).toEqual([]);
  });

  it('leitura menor que a anterior avisa no cartão e grava sem consumo', async () => {
    await pastaDeConsumo();
    planilhas.planilha('planilha-ficticia-agua', [leituraDaAgua('01/11/2026', '1200')]);

    const resultado = await executarFrase('leitura da água 1100');

    expect(planilhas.linhas('planilha-ficticia-agua')).toHaveLength(2);
    expect(resultado.titulo).toBe('Leitura guardada');
    expect(resultado.detalhe).toMatch(/menor que a anterior/);
    expect(resultado.detalhe).toContain('1.200');
    expect(resultado.detalhe).not.toMatch(/-\d/);
    expect(resultado.detalhe).not.toMatch(/Consumo desde a anterior: /);
  });

  it('planilha que mudou (falta coluna) não grava e a frase segue como tarefa, com aviso', async () => {
    await pastaDeConsumo();
    planilhas.planilha('planilha-ficticia-agua', [], ['Data', 'Leitura', 'Observação', 'id']); // sem "Unidade"

    const resultado = await executarFrase('leitura da água 1234');

    expect(resultado.titulo).toBe(SEGUE_COMO_TAREFA);
    expect(resultado.detalhe).toMatch(/planilha mudou/i);
    expect(planilhas.linhas('planilha-ficticia-agua')).toEqual([]);
    expect(await listar('ideias')).toEqual([]);
  });

  it('data no futuro pela voz não grava na planilha: segue como tarefa, com aviso (como a tela, que bloqueia)', async () => {
    await pastaDeConsumo();
    planilhas.planilha('planilha-ficticia-agua');

    const resultado = await executarFrase('leitura da água 1234 em 20/11');

    expect(resultado.titulo).toBe(SEGUE_COMO_TAREFA);
    expect(resultado.detalhe).toContain('A data é no futuro; a leitura não foi para a planilha.');
    expect(planilhas.linhas('planilha-ficticia-agua')).toEqual([]);
    expect(await listar('ideias')).toEqual([]);
  });

  it.each(['leitura da água 1234 dia 3', 'leitura da água 1234 em 3 de novembro', 'leitura da água 1234 amanhã'])(
    'data dita mas não entendida ("%s"): grava hoje e avisa no cartão',
    async (frase) => {
      await pastaDeConsumo();
      planilhas.planilha('planilha-ficticia-agua');

      const resultado = await executarFrase(frase);

      expect(resultado.titulo).toBe('Leitura guardada');
      expect(resultado.detalhe).toContain('Não entendi a data, então usei a de hoje.');
      expect(planilhas.linhas('planilha-ficticia-agua')[0]!.valores).toMatchObject({ Data: '2026-11-05', Leitura: '1234' });
    },
  );

  it('o cartão de bloqueio diz que a leitura não foi para a planilha, sem "Nada foi gravado" (a frase segue como tarefa)', async () => {
    await pastaDeConsumo();
    planilhas.planilha('planilha-ficticia-agua', [], ['Data', 'Leitura', 'Observação', 'id']);

    const resultado = await executarFrase('leitura da água 1234');

    expect(resultado.detalhe).toContain('A leitura não foi para a planilha.');
    expect(resultado.detalhe).not.toContain('Nada foi gravado');
  });

  // Achado 1: tarefa e pedido nunca viram leitura, mesmo com a pasta de consumo à mão.
  it.each([
    'Mandar a leitura da água para a empresa até dia 10',
    'enviar leitura da luz dia 15',
    'trocar o contador de água dia 12',
    'a água está com consumo alto, 3 pessoas',
  ])('"%s" não grava na planilha', async (frase) => {
    await pastaDeConsumo();
    await pastaDeConsumo({ id: 'pasta-luz', nome: 'Consumo de Luz', servico: 'luz', unidade: 'kWh', planilhaId: 'planilha-ficticia-luz', ordem: 2 });
    planilhas.planilha('planilha-ficticia-agua');
    planilhas.planilha('planilha-ficticia-luz');

    const resultado = await executarFrase(frase);
    const dentro = await executarFrase(frase, { pastaAtual: 'pasta-agua' });

    expect(resultado.titulo).not.toBe('Leitura guardada');
    expect(dentro.titulo).not.toBe('Leitura guardada');
    expect(planilhas.linhas('planilha-ficticia-agua')).toEqual([]);
    expect(planilhas.linhas('planilha-ficticia-luz')).toEqual([]);
  });

  it('"Guardar como ideia" troca a leitura por uma ideia com a mesma frase', async () => {
    await pastaDeConsumo();
    planilhas.planilha('planilha-ficticia-agua');

    const resultado = await executarFrase('leitura da água 1234,5');
    expect(resultado.guardarComoIdeia).toBeTypeOf('function');
    const ideia = await resultado.guardarComoIdeia!();

    expect(ideia.titulo).toBe('Guardado em Ideias');
    expect((await listar('ideias')).map((i) => i.texto)).toEqual(['leitura da água 1234,5']);
    expect(planilhas.linhas('planilha-ficticia-agua')[0]!.valores['Observação']).toBe('desfeito');
  });
});

describe('dentro de uma pasta de Registro a fala vai direto para ela', () => {
  it('só o número, sem dizer o serviço', async () => {
    await pastaDeConsumo();
    planilhas.planilha('planilha-ficticia-agua');

    const resultado = await executarFrase('1234,5', { pastaAtual: 'pasta-agua' });

    expect(resultado.titulo).toBe('Leitura guardada');
    expect(planilhas.linhas('planilha-ficticia-agua')[0]!.valores).toMatchObject({ Data: '2026-11-05', Leitura: '1234.5', Unidade: 'm³' });
  });

  it('"leitura 1234 ontem" e "1234 m³"', async () => {
    await pastaDeConsumo();
    planilhas.planilha('planilha-ficticia-agua');

    await executarFrase('leitura 1234 ontem', { pastaAtual: 'pasta-agua' });
    await executarFrase('1250 m³', { pastaAtual: 'pasta-agua' });

    const linhas = planilhas.linhas('planilha-ficticia-agua');
    expect(linhas.map((l) => [l.valores.Data, l.valores.Leitura])).toEqual([
      ['2026-11-04', '1234'],
      ['2026-11-05', '1250'],
    ]);
  });

  it('frase que não é leitura segue o caminho normal', async () => {
    await pastaDeConsumo();
    planilhas.planilha('planilha-ficticia-agua');

    const tarefa = await executarFrase('Adicione ligar para a Marina 3 vezes nas tarefas da casa', { pastaAtual: 'pasta-agua' });
    const solta = await executarFrase('comprar tampa para o ralo', { pastaAtual: 'pasta-agua' });

    expect(tarefa.titulo).not.toBe('Leitura guardada');
    expect(solta.titulo).not.toBe('Leitura guardada');
    expect(planilhas.linhas('planilha-ficticia-agua')).toEqual([]);
  });

  // Achado 2: dentro da pasta, só vale número plausível (3 dígitos ou mais), unidade ou a palavra "leitura".
  it.each(['dia 15', '15 de novembro', '2 e 3', '3', '12', 'dia 15 de novembro', 'amanhã'])('"%s" dentro da pasta não é leitura', async (frase) => {
    await pastaDeConsumo();
    planilhas.planilha('planilha-ficticia-agua');

    const resultado = await executarFrase(frase, { pastaAtual: 'pasta-agua' });

    expect(resultado.titulo).not.toBe('Leitura guardada');
    expect(planilhas.linhas('planilha-ficticia-agua')).toEqual([]);
  });

  it('número com 3 dígitos ou mais, com "hoje/ontem", vale; "leitura 12" também (tem a palavra)', async () => {
    await pastaDeConsumo();
    planilhas.planilha('planilha-ficticia-agua');

    await executarFrase('1234 ontem', { pastaAtual: 'pasta-agua' });
    await executarFrase('leitura 12', { pastaAtual: 'pasta-agua' });

    expect(planilhas.linhas('planilha-ficticia-agua').map((l) => [l.valores.Data, l.valores.Leitura])).toEqual([
      ['2026-11-04', '1234'],
      ['2026-11-05', '12'],
    ]);
  });

  it('dizendo outro serviço, vai para a pasta dele (ou segue como tarefa se não houver)', async () => {
    await pastaDeConsumo();
    await pastaDeConsumo({ id: 'pasta-luz', nome: 'Consumo de Luz', servico: 'luz', unidade: 'kWh', planilhaId: 'planilha-ficticia-luz', ordem: 2 });
    planilhas.planilha('planilha-ficticia-agua');
    planilhas.planilha('planilha-ficticia-luz', [], CABECALHO_CONSUMO);

    const resultado = await executarFrase('leitura da luz 5000 kWh', { pastaAtual: 'pasta-agua' });

    expect(resultado.detalhe).toContain('Consumo de Luz');
    expect(planilhas.linhas('planilha-ficticia-agua')).toEqual([]);
    expect(planilhas.linhas('planilha-ficticia-luz')[0]!.valores).toMatchObject({ Leitura: '5000', Unidade: 'kWh' });
  });
});
