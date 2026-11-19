import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executarFrase, guardarFraseComoIdeia, textoDaIdeiaDita, validarFrase } from '../../src/chat/executar';
import { usarIA } from '../../src/chat/interpretar';
import type { IA } from '../../src/ia/ia';
import { listar, semear, semearPalavras } from '../../src/dados/loja';

// Quinta-feira, 2026-11-05, 12:20 (Europe/Lisbon). Só a data é falsa.
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 5, 12, 20));
  await semear();
  await semearPalavras();
});

const SEM_IA: IA = { estado: () => 'ausente', interpretar: async () => null };
afterEach(() => usarIA(SEM_IA));

/** O cartão, ou falha o teste se a frase seguiu como tarefa. */
async function cartaoDe(frase: string, ctx = {}) {
  const saida = await executarFrase(frase, ctx);
  if (saida.tipo !== 'resultado') throw new Error(`a frase seguiu como tarefa: ${frase}`);
  return saida.resultado;
}

describe('executarFrase: ideia só quando o dono diz "ideia"', () => {
  it('"ideia: app de receitas" vira ideia (sem o "ideia:" no texto), e Desfazer apaga', async () => {
    const resultado = await cartaoDe('ideia: app de receitas');

    const ideias = await listar('ideias');
    expect(ideias).toHaveLength(1);
    expect(ideias[0]).toMatchObject({ texto: 'app de receitas', estado: 'nova' });
    expect(await listar('tarefas')).toEqual([]);
    expect(resultado.titulo).toBe('Guardado em Ideias');
    expect(resultado.detalhe).toContain('app de receitas');
    expect(resultado.ver).toBe('#/ideias');

    await resultado.desfazer();
    expect(await listar('ideias')).toEqual([]);
  });

  it.each([
    ['Ideia app de receitas', 'app de receitas'],
    ['ideia, app de receitas', 'app de receitas'],
    ['Anota uma ideia: app de receitas', 'app de receitas'],
    ['anote uma ideia app de receitas', 'app de receitas'],
    ['Nova ideia: app de receitas', 'app de receitas'],
    ['Uma ideia: usar o artigo do Prof. Souza no capítulo 2', 'usar o artigo do Prof. Souza no capítulo 2'],
  ])('"%s" é ideia dita', async (frase, texto) => {
    await cartaoDe(frase);
    expect((await listar('ideias')).map((i) => i.texto)).toEqual([texto]);
  });

  it('"ideia" sozinha guarda a própria frase (nada falado se perde)', async () => {
    await cartaoDe('ideia');
    expect((await listar('ideias')).map((i) => i.texto)).toEqual(['ideia']);
  });

  it.each(['ideias para o capítulo 2', 'tenho uma ideia para o relatório', 'Preciso de uma ideia de presente', 'ideal para o relatório'])(
    '"%s" não começa como ideia dita: segue como tarefa',
    (frase) => {
      expect(textoDaIdeiaDita(frase)).toBeNull();
    },
  );

  it('o áudio vai junto da ideia (id e duração), e o resultado o devolve para o envio', async () => {
    const resultado = await cartaoDe('ideia: app de receitas', { audio: { id: 'audio-1', segundos: 12 } });
    const [ideia] = await listar('ideias');
    expect(ideia).toMatchObject({ audioId: 'audio-1', audioSegundos: 12 });
    expect(resultado.audioId).toBe('audio-1');
  });

  it('a ideia dita não oferece Guardar como ideia (já é uma)', async () => {
    const resultado = await cartaoDe('ideia: app de receitas');
    expect(resultado.guardarComoIdeia).toBeUndefined();
  });
});

describe('executarFrase: o que não é específico segue como tarefa (nada é gravado aqui)', () => {
  it.each([
    'Usar o artigo do Prof. Souza no capítulo 2',
    'Preciso parafusar o apoio do banheiro',
    'Adicione em atividades do dia mandar mensagem para Marina',
    'Adicione reunião sobre o projeto na sexta feira com inicio às 11:00 e termino 12:00',
    'Adicione Revisar paragrafo do relatório 1 nas tarefas do doutoramento',
    'Marcar reunião com a Renata',
    'Entregar o relatório até as 17h',
    'comprar leite amanhã',
  ])('"%s"', async (frase) => {
    expect(await executarFrase(frase)).toEqual({ tipo: 'tarefa' });
    expect(await listar('tarefas')).toEqual([]);
    expect(await listar('ideias')).toEqual([]);
  });

  it('a IA nem é chamada aqui: quem decide a sala é o chat, depois', async () => {
    const chamadas: string[] = [];
    usarIA({
      estado: () => 'pronta',
      interpretar: async (frase) => {
        chamadas.push(frase);
        return null;
      },
    });
    await executarFrase('Adicione uma tarefa para ligar para o dentista');
    expect(chamadas).toEqual([]);
  });

  it('"Comprar pão" sem pasta de Lista com planilha: tarefa, sem nota (não falou de lista)', async () => {
    expect(await executarFrase('Comprar pão')).toEqual({ tipo: 'tarefa' });
    expect(await executarFrase('eu preciso comprar pão de forma, comprar café e beterraba')).toEqual({ tipo: 'tarefa' });
    expect(await listar('ideias')).toEqual([]);
  });

  it('pedido de lista sem pasta: tarefa, com a nota do porquê', async () => {
    const saida = await executarFrase('Coloca na lista de compra comprar pão de forma comprar café comprar beterraba');
    expect(saida).toMatchObject({ tipo: 'tarefa' });
    expect(saida.tipo === 'tarefa' && saida.nota).toMatch(/Não achei a lista de compras/);
  });

  it('gasto e leitura sem pasta: tarefa, com a nota do porquê (nada vira ideia)', async () => {
    const gasto = await executarFrase('gastei 5,50 no mercado');
    expect(gasto.tipo === 'tarefa' && gasto.nota).toMatch(/Não achei a pasta Financeiro/);

    const leitura = await executarFrase('leitura da água 1234');
    expect(leitura.tipo === 'tarefa' && leitura.nota).toMatch(/pasta de Consumo de Água/);

    expect(await listar('ideias')).toEqual([]);
  });
});

describe('executarFrase: limites', () => {
  it.each([
    ['só pontuação', '...'],
    ['em branco', '   '],
    ['mais de 2000 caracteres, mesmo sendo pedido de tarefa', `Adicione uma tarefa ${'a'.repeat(2001)}`],
  ])('%s: recusa antes de rotear e não grava nada', async (_nome, frase) => {
    await expect(executarFrase(frase)).rejects.toThrow('texto_invalido');
    expect(await listar('ideias')).toEqual([]);
    expect(await listar('tarefas')).toEqual([]);
  });

  it('validarFrase: vazia, longa ou boa', () => {
    expect(validarFrase('  ...  ')).toBe('vazia');
    expect(validarFrase('')).toBe('vazia');
    expect(validarFrase('a'.repeat(2001))).toBe('longa');
    expect(validarFrase('a'.repeat(2000))).toBeNull();
    expect(validarFrase('Ligar para a Aurora')).toBeNull();
  });
});

describe('guardarFraseComoIdeia', () => {
  it('guarda a frase como ideia e recusa texto vazio', async () => {
    const r = await guardarFraseComoIdeia('Pensar no artigo da Aurora', {});
    expect(r.titulo).toBe('Guardado em Ideias');
    expect(r.ver).toBe('#/ideias');
    expect(await listar('ideias')).toHaveLength(1);
    await expect(guardarFraseComoIdeia('...', {})).rejects.toThrow('texto_invalido');
  });

  it('com áudio, a ideia leva o áudio', async () => {
    const r = await guardarFraseComoIdeia('Pensar no artigo da Aurora', { audio: { id: 'audio-9', segundos: 8 } });
    expect(await listar('ideias')).toEqual([expect.objectContaining({ audioId: 'audio-9', audioSegundos: 8 })]);
    expect(r.audioId).toBe('audio-9');
  });
});
