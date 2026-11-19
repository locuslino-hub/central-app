import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executarFrase, guardarFraseComoIdeia } from '../../src/chat/executar';
import { usarIA } from '../../src/chat/interpretar';
import type { IA } from '../../src/ia/ia';
import { listar, listarPendentes, semear, semearPalavras } from '../../src/dados/loja';
import { agendaEscrita } from '../apoio/agenda-escrita';

// Quinta-feira, 2026-11-05, 12:20 (Europe/Lisbon). Só a data é falsa.
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 5, 12, 20));
  await semear();
  await semearPalavras();
});

const SEM_IA: IA = { estado: () => 'ausente', interpretar: async () => null };
afterEach(() => usarIA(SEM_IA));

/** IA pronta que sempre dá a sala Casa e anota as chamadas. */
function iaProntaComSala() {
  const chamadas: string[] = [];
  const ia: IA = {
    estado: () => 'pronta',
    interpretar: async (frase) => {
      chamadas.push(frase);
      return { itens: [{ tipo: 'tarefa', titulo: 'Ligar para o dentista', sala: 'Casa', quando: '', inicio: '', fim: '' }], cortada: false };
    },
  };
  return { ia, chamadas };
}

describe('executarFrase (Pode falar)', () => {
  it('frase de tarefa vira tarefa, e Desfazer apaga', async () => {
    const resultado = await executarFrase('Adicione em atividades do dia mandar mensagem para Marina', {});

    const tarefas = await listar('tarefas');
    expect(tarefas).toHaveLength(1);
    expect(tarefas[0]).toMatchObject({ titulo: 'Mandar mensagem para Marina', data: '2026-11-05' });
    expect(resultado.titulo).toBe('Tarefa guardada');
    expect(resultado.detalhe).toContain('Mandar mensagem para Marina');
    expect(resultado.ver).toBe('#/atividades');
    expect(await listar('ideias')).toEqual([]);

    await resultado.desfazer();
    expect(await listar('tarefas')).toEqual([]);
  });

  it('frase de compromisso vira compromisso na agenda, e Desfazer o remove', async () => {
    const agenda = agendaEscrita();
    await agenda.instalar();

    const resultado = await executarFrase(
      'Adicione reunião sobre o projeto na sexta feira com inicio às 11:00 e termino 12:00',
      {},
    );

    expect(agenda.eventos.size).toBe(1);
    expect([...agenda.eventos.values()][0]).toMatchObject({ titulo: 'Reunião sobre o projeto' });
    expect(resultado.titulo).toBe('Compromisso guardado');
    expect(resultado.ver).toBe('#/semana?d=2026-11-06');
    expect(await listar('tarefas')).toEqual([]);
    expect(await listar('ideias')).toEqual([]);

    await resultado.desfazer();
    expect(agenda.eventos.size).toBe(0);
  });

  it('compromisso sem internet fica na fila e o cartão avisa', async () => {
    const agenda = agendaEscrita();
    await agenda.instalar();
    agenda.modo('rede');

    const resultado = await executarFrase(
      'Adicione reunião sobre o projeto na sexta feira com inicio às 11:00 e termino 12:00',
      {},
    );

    expect((await listarPendentes()).filter((p) => p.tipo === 'agenda')).toHaveLength(1);
    expect(resultado.detalhe).toContain('Sem internet');
    await resultado.desfazer();
    expect((await listarPendentes()).filter((p) => p.tipo === 'agenda')).toEqual([]);
  });

  it('texto livre, sem sala, dia nem hora, vira ideia, e Desfazer apaga', async () => {
    const resultado = await executarFrase('Usar o artigo do Prof. Souza no capítulo 2', {});

    const ideias = await listar('ideias');
    expect(ideias).toHaveLength(1);
    expect(ideias[0]).toMatchObject({ texto: 'Usar o artigo do Prof. Souza no capítulo 2', estado: 'nova' });
    expect(await listar('tarefas')).toEqual([]);
    expect(resultado.titulo).toBe('Guardado em Ideias');
    expect(resultado.detalhe).toContain('Usar o artigo do Prof. Souza');

    await resultado.desfazer();
    expect(await listar('ideias')).toEqual([]);
  });

  it('frase com sala clara (Casa) vira tarefa, não ideia', async () => {
    await executarFrase('Preciso parafusar o apoio do banheiro', {});
    const tarefas = await listar('tarefas');
    expect(tarefas).toHaveLength(1);
    expect(tarefas[0]).toMatchObject({ salaId: 'sala-casa' });
    expect(await listar('ideias')).toEqual([]);
  });

  it('gasto sem pasta Financeiro vira ideia, com aviso (Tarefa 16 tem os testes de gravação)', async () => {
    const resultado = await executarFrase('Gastei 5,50 € hoje comprando salgado', {});

    const ideias = await listar('ideias');
    expect(ideias).toHaveLength(1);
    expect(ideias[0]!.texto).toBe('Gastei 5,50 € hoje comprando salgado');
    expect(await listar('tarefas')).toEqual([]);
    expect(resultado.titulo).toBe('Guardado em Ideias');
    expect(resultado.detalhe).toMatch(/gasto/i);
    expect(resultado.detalhe).toMatch(/Não achei a pasta Financeiro/);
  });

  it('item de lista sem pasta de lista vira ideia com aviso; leitura sem pasta de consumo também (Tarefas 13 e 14 têm os testes de gravação)', async () => {
    const leitura = await executarFrase('A leitura da água hoje é 243 m³', {});
    expect(leitura.detalhe).toMatch(/pasta de Consumo de Água/);

    const lista = await executarFrase('Põe leite e ovos nas compras da semana', {});
    expect(lista.detalhe).toMatch(/lista/i);
    expect(lista.detalhe).toMatch(/Não achei a lista/);

    expect(await listar('ideias')).toHaveLength(2);
    expect(await listar('tarefas')).toEqual([]);
  });

  it('o áudio vai junto da ideia (id e duração), e o resultado diz que o áudio ficou', async () => {
    const resultado = await executarFrase('Usar o artigo do Prof. Souza no capítulo 2', {
      audio: { id: 'audio-1', segundos: 12 },
    });
    const [ideia] = await listar('ideias');
    expect(ideia).toMatchObject({ audioId: 'audio-1', audioSegundos: 12 });
    expect(resultado.audioId).toBe('audio-1');
  });

  it('frase que vira tarefa não leva o áudio', async () => {
    const resultado = await executarFrase('Preciso parafusar o apoio do banheiro', { audio: { id: 'audio-2', segundos: 5 } });
    expect(resultado.audioId).toBeUndefined();
    expect(await listar('ideias')).toEqual([]);
  });

  it('texto sem nada falado (só pontuação) é recusado e nada é gravado', async () => {
    await expect(executarFrase('  ...  ', {})).rejects.toThrow();
    expect(await listar('ideias')).toEqual([]);
    expect(await listar('tarefas')).toEqual([]);
  });

  it('com a IA pronta, ideia continua ideia: a IA nem é chamada para decidir', async () => {
    const { ia, chamadas } = iaProntaComSala();
    usarIA(ia);

    await executarFrase('Usar o artigo do Prof. Souza no capítulo 2', {});

    expect(chamadas).toEqual([]);
    expect(await listar('ideias')).toHaveLength(1);
    expect(await listar('tarefas')).toEqual([]);
  });

  it('com a IA pronta, pedido de tarefa sem sala chama a IA, que dá a sala', async () => {
    const { ia, chamadas } = iaProntaComSala();
    usarIA(ia);

    await executarFrase('Adicione uma tarefa para ligar para o dentista', {});

    expect(chamadas).toHaveLength(1);
    const [tarefa] = await listar('tarefas');
    expect(tarefa).toMatchObject({ salaId: 'sala-casa' });
    expect(await listar('ideias')).toEqual([]);
  });

  it('prazo com hora ("até as 17h") é pedido: vira tarefa, não ideia', async () => {
    const resultado = await executarFrase('Entregar o relatório até as 17h', {});
    expect(resultado.titulo).toBe('Tarefa guardada');
    expect(await listar('ideias')).toEqual([]);
    const [tarefa] = await listar('tarefas');
    expect(tarefa).toMatchObject({ prazoHora: '17:00' });
  });

  it.each([
    ['só pontuação', '...'],
    ['mais de 2000 caracteres, mesmo sendo pedido de tarefa', `Adicione uma tarefa ${'a'.repeat(2001)}`],
  ])('%s: recusa antes de rotear e não grava nada', async (_nome, frase) => {
    await expect(executarFrase(frase, {})).rejects.toThrow('texto_invalido');
    expect(await listar('ideias')).toEqual([]);
    expect(await listar('tarefas')).toEqual([]);
  });
});

describe('Pode falar: ver a ideia e Guardar como ideia', () => {
  it('o cartão da ideia leva a #/ideias no Ver', async () => {
    const resultado = await executarFrase('Usar o artigo do Prof. Souza no capítulo 2', {});
    expect(resultado.ver).toBe('#/ideias');
  });

  it('gasto, lista e leitura sem pasta (que viram ideia com aviso) também levam a #/ideias', async () => {
    expect((await executarFrase('Gastei 5,50 € hoje comprando salgado', {})).ver).toBe('#/ideias');
    expect((await executarFrase('A leitura da água hoje é 243 m³', {})).ver).toBe('#/ideias');
  });

  it('ideia não oferece Guardar como ideia (já é uma)', async () => {
    const resultado = await executarFrase('Usar o artigo do Prof. Souza no capítulo 2', {});
    expect(resultado.guardarComoIdeia).toBeUndefined();
  });

  it('tarefa oferece Guardar como ideia: desfaz a tarefa e cria a ideia com a mesma frase', async () => {
    const resultado = await executarFrase('Preciso parafusar o apoio do banheiro', {});
    expect(await listar('tarefas')).toHaveLength(1);

    const ideia = await resultado.guardarComoIdeia!();

    expect(await listar('tarefas')).toEqual([]);
    expect(await listar('ideias')).toEqual([expect.objectContaining({ texto: 'Preciso parafusar o apoio do banheiro', estado: 'nova' })]);
    expect(ideia.titulo).toBe('Guardado em Ideias');
    expect(ideia.ver).toBe('#/ideias');
    expect(ideia.guardarComoIdeia).toBeUndefined();
    await ideia.desfazer();
    expect(await listar('ideias')).toEqual([]);
  });

  it('com áudio, a ideia criada leva o áudio e o resultado o devolve para o envio', async () => {
    const resultado = await executarFrase('Preciso parafusar o apoio do banheiro', {});

    const ideia = await resultado.guardarComoIdeia!({ id: 'audio-9', segundos: 8 });

    expect(await listar('ideias')).toEqual([expect.objectContaining({ audioId: 'audio-9', audioSegundos: 8 })]);
    expect(ideia.audioId).toBe('audio-9');
  });

  it('compromisso oferece Guardar como ideia: remove o evento e cria a ideia', async () => {
    const agenda = agendaEscrita();
    await agenda.instalar();
    const resultado = await executarFrase('Adicione reunião sobre o projeto na sexta feira com inicio às 11:00 e termino 12:00', {});
    expect(agenda.eventos.size).toBe(1);

    await resultado.guardarComoIdeia!();

    expect(agenda.eventos.size).toBe(0);
    expect(await listar('ideias')).toHaveLength(1);
  });

  it('se um item não sair, a ideia fica e o cartão diz qual item continua guardado (nada de aviso falso)', async () => {
    const resultado = await executarFrase('Preciso parafusar o apoio do banheiro', {});
    // Falha de verdade na loja: apagar a tarefa não funciona.
    const loja = await import('../../src/dados/loja');
    const real = loja.apagar;
    const espiao = vi.spyOn(loja, 'apagar').mockImplementation(((colecao: never, id: never) => {
      if ((colecao as string) === 'tarefas') return Promise.reject(new Error('disco cheio'));
      return real(colecao, id);
    }) as typeof loja.apagar);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const ideia = await resultado.guardarComoIdeia!();
    espiao.mockRestore();

    expect(await listar('ideias')).toHaveLength(1);
    expect(await listar('tarefas')).toHaveLength(1);
    expect(ideia.titulo).toBe('Guardado em Ideias');
    expect(ideia.detalhe).toMatch(/não consegui tirar/i);
    const [tarefa] = await listar('tarefas');
    expect(ideia.detalhe).toContain(`Atenção: não consegui tirar “${tarefa!.titulo}”; ele continua guardado.`);
  });

  it('com vários itens, só os que não saíram são citados', async () => {
    usarIA({
      estado: () => 'pronta',
      interpretar: async () => ({
        itens: [
          { tipo: 'tarefa', titulo: 'Ligar para a Marina', sala: 'Casa', quando: '', inicio: '', fim: '' },
          { tipo: 'tarefa', titulo: 'Pagar a conta de luz', sala: 'Casa', quando: '', inicio: '', fim: '' },
        ],
        cortada: false,
      }),
    });
    const resultado = await executarFrase('Adicione uma tarefa para ligar para a Marina e pagar a conta de luz', {});
    const tarefas = await listar('tarefas');
    expect(tarefas).toHaveLength(2);
    const loja = await import('../../src/dados/loja');
    const real = loja.apagar;
    const primeiro = tarefas[0]!.id;
    vi.spyOn(loja, 'apagar').mockImplementation(((colecao: never, id: never) => {
      if ((colecao as string) === 'tarefas' && (id as string) === primeiro) return Promise.reject(new Error('disco cheio'));
      return real(colecao, id);
    }) as typeof loja.apagar);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const ideia = await resultado.guardarComoIdeia!();

    expect(await listar('tarefas')).toHaveLength(1);
    expect(ideia.detalhe).toContain(tarefas[0]!.titulo);
    expect(ideia.detalhe).not.toContain(tarefas[1]!.titulo);
  });

  it('guardarFraseComoIdeia guarda a frase como ideia, com o aviso, e recusa texto vazio', async () => {
    const r = await guardarFraseComoIdeia('Pensar no artigo da Aurora', {});
    expect(r.titulo).toBe('Guardado em Ideias');
    expect(await listar('ideias')).toHaveLength(1);
    await expect(guardarFraseComoIdeia('...', {})).rejects.toThrow('texto_invalido');
  });
});
