// A IA local no chat (Tarefa 21), sempre com uma IA falsa. Data, hora e tipo
// vêm das regras; a IA dá título, sala e a divisão de frases longas.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { interpretar, LIMITE_IA_MS, usarIA, type ItemDoChat } from '../../src/chat/interpretar';
import * as loja from '../../src/dados/loja';
import { salvar, semear, semearPalavras } from '../../src/dados/loja';
import { criarIA, type IA } from '../../src/ia/ia';
import type { ContextoIA, ItemIA } from '../../src/ia/instrucoes';
import { trabalhadorFalso } from '../apoio/ia';

const SEM_IA: IA = { estado: () => 'ausente', interpretar: async () => null };

/** IA pronta que devolve sempre os mesmos itens e anota cada chamada. */
function iaFalsa(itens: Partial<ItemIA>[] | null) {
  const chamadas: { frase: string; contexto: ContextoIA }[] = [];
  const ia: IA = {
    estado: () => 'pronta',
    interpretar: async (frase, contexto) => {
      chamadas.push({ frase, contexto });
      return itens?.map((item) => ({ tipo: 'tarefa', titulo: '', sala: '', quando: '', inicio: '', fim: '', ...item })) ?? null;
    },
  };
  return { ia, chamadas };
}

/** O que as regras e a memória dão sozinhas, para comparar. */
async function soRegras(frase: string): Promise<ItemDoChat[]> {
  usarIA(SEM_IA);
  return interpretar(frase);
}

const LONGA =
  'então é, eu tava pensando aqui, preciso revisar o capítulo da Marina até segunda, e aí também tem que ligar pro dentista amanhã, ah e comprar parafuso pro banheiro no sábado';

// Quinta-feira, 2026-11-05, 12:20 (Europe/Lisbon). Só a data é falsa.
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 5, 12, 20));
  await semear();
  await semearPalavras();
  await salvar('pessoas', { id: 'p-marina', nome: 'Marina', salaId: 'sala-orientacoes', papel: 'aluna de orientação' });
});

afterEach(() => {
  usarIA(SEM_IA);
});

describe('quando chamar a IA', () => {
  it('sem IA, o chat responde com as regras', async () => {
    usarIA(SEM_IA);
    const [item] = await interpretar('Preciso organizar os papéis do escritório');
    expect(item).toMatchObject({ tipo: 'tarefa', titulo: 'Preciso organizar os papéis do escritório', salaId: null });
  });

  it('IA ainda carregando não é chamada', async () => {
    const { ia, chamadas } = iaFalsa([{ titulo: 'Organizar papéis', sala: 'Casa' }]);
    usarIA({ ...ia, estado: () => 'carregando' });
    const [item] = await interpretar('Preciso organizar os papéis do escritório');
    expect(chamadas).toHaveLength(0);
    expect(item.salaId).toBeNull();
  });

  it('frase curta, certa e com sala não chama a IA', async () => {
    const { ia, chamadas } = iaFalsa([{ titulo: 'Outra coisa', sala: 'Casa' }]);
    usarIA(ia);
    const [item] = await interpretar('Adicione Revisar paragrafo do relatório 1 nas tarefas do doutoramento');
    expect(chamadas).toHaveLength(0);
    expect(item).toMatchObject({ titulo: 'Revisar paragrafo do relatório 1', salaId: 'sala-doutoramento' });
  });

  it('sala indefinida chama a IA, com salas e pessoas da loja', async () => {
    await salvar('salas', { id: 'sala-coral', nome: 'Coral', ordem: 9 });
    const { ia, chamadas } = iaFalsa([{ titulo: 'Organizar os papéis', sala: 'Casa' }]);
    usarIA(ia);
    await interpretar('Preciso organizar os papéis do escritório');
    expect(chamadas).toHaveLength(1);
    const { contexto } = chamadas[0];
    expect(contexto.hoje).toBe('2026-11-05');
    expect(contexto.salas.map((s) => s.nome)).toContain('Coral');
    expect(contexto.pessoas).toEqual([{ nome: 'Marina', salaId: 'sala-orientacoes', papel: 'aluna de orientação' }]);
  });

  it('certeza baixa chama a IA', async () => {
    const { ia, chamadas } = iaFalsa(null);
    usarIA(ia);
    await interpretar('qwer asdf');
    expect(chamadas).toHaveLength(1);
  });

  it('frase com mais de 20 palavras chama a IA mesmo com sala e certeza', async () => {
    const { ia, chamadas } = iaFalsa(null);
    usarIA(ia);
    const frase =
      'Adicione nas tarefas do doutoramento revisar com bastante calma o parágrafo inicial do relatório 1 antes de mandar para o orientador ler';
    expect(frase.split(/\s+/).length).toBeGreaterThan(20);
    await interpretar(frase);
    expect(chamadas).toHaveLength(1);
  });
});

describe('mesclagem', () => {
  it('IA com JSON quebrado volta para as regras', async () => {
    const frase = 'Preciso organizar os papéis do escritório';
    const esperado = await soRegras(frase);
    const ia = criarIA(trabalhadorFalso({ guardado: true, resposta: '{"itens":[{"titulo":"Organizar' }));
    await ia.iniciar();
    expect(ia.estado()).toBe('pronta');
    usarIA(ia);
    expect(await interpretar(frase)).toEqual(esperado);
  });

  it('loja que falha ao montar a pergunta à IA volta para as regras', async () => {
    const frase = 'Preciso organizar os papéis do escritório';
    const esperado = await soRegras(frase);
    const { ia, chamadas } = iaFalsa([{ titulo: 'Organizar', sala: 'Casa' }]);
    usarIA(ia);
    const listar = loja.listar;
    let salas = 0;
    vi.spyOn(loja, 'listar').mockImplementation(((colecao: Parameters<typeof listar>[0], opcoes?: Parameters<typeof listar>[1]) => {
      // A 1ª leitura de salas é a da memória; a 2ª, a da IA, falha.
      if ((colecao === 'salas' && ++salas > 1) || colecao === 'pessoas' && salas > 1) {
        return Promise.reject(new Error('banco fechado'));
      }
      return listar(colecao, opcoes);
    }) as typeof listar);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await interpretar(frase)).toEqual(esperado);
    expect(chamadas).toHaveLength(0);
  });

  it('IA que falha volta para as regras', async () => {
    const frase = 'Preciso organizar os papéis do escritório';
    const esperado = await soRegras(frase);
    usarIA({ estado: () => 'pronta', interpretar: () => Promise.reject(new Error('sem memória')) });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await interpretar(frase)).toEqual(esperado);
  });

  it('IA diz "hoje" numa frase sem data: o item fica sem prazo', async () => {
    const { ia } = iaFalsa([
      { tipo: 'compromisso', titulo: 'Organizar os papéis do escritório', sala: 'Casa', quando: 'hoje', inicio: '11:00', fim: '12:00' },
    ]);
    usarIA(ia);
    const [item] = await interpretar('Preciso organizar os papéis do escritório');
    expect(item.tipo).toBe('tarefa');
    expect(item.data).toBeUndefined();
    expect(item.semana).toBeUndefined();
    expect(item.inicio).toBeUndefined();
    expect(item.titulo).toBe('Organizar os papéis do escritório');
    expect(item.salaId).toBe('sala-casa');
    // Sala escolhida pela IA: guarda na hora, como a das regras; o cartão diz quem escolheu e oferece Trocar sala.
    expect(item.certeza).toBe('alta');
    expect(item.motivoSala).toBe('ia');
  });

  it('título da IA sem "Marina" recebe o nome dela', async () => {
    const frase =
      'Então eu estava pensando que preciso muito revisar com calma aquele capítulo enorme que a Marina mandou pelo e-mail com as figuras novas';
    expect(frase.split(/\s+/).length).toBeGreaterThan(20);
    const { ia } = iaFalsa([{ titulo: 'Revisar o capítulo', sala: 'Orientações' }]);
    usarIA(ia);
    const [item] = await interpretar(frase);
    expect(item.titulo).toBe('Revisar o capítulo (Marina)');
    expect(item).toMatchObject({ salaId: 'sala-orientacoes', motivoSala: 'pessoa', pessoaId: 'p-marina', pessoaNome: 'Marina' });
  });

  it('frase longa vira 3 itens, cada um com a data das regras do seu trecho', async () => {
    const { ia } = iaFalsa([
      { titulo: 'Revisar o capítulo da Marina', sala: 'Orientações', quando: 'hoje' },
      { titulo: 'Ligar pro dentista', sala: 'Pessoal', quando: 'hoje' },
      { titulo: 'Comprar parafuso pro banheiro', sala: 'Casa', quando: 'hoje' },
    ]);
    usarIA(ia);
    const itens = await interpretar(LONGA);
    expect(itens).toHaveLength(3);
    expect(itens[0]).toMatchObject({
      tipo: 'tarefa', titulo: 'Revisar o capítulo da Marina', data: '2026-11-09', salaId: 'sala-orientacoes', pessoaId: 'p-marina',
    });
    expect(itens[1]).toMatchObject({ tipo: 'tarefa', titulo: 'Ligar pro dentista', data: '2026-11-06', salaId: 'sala-pessoal' });
    expect(itens[2]).toMatchObject({ tipo: 'tarefa', titulo: 'Comprar parafuso pro banheiro', data: '2026-11-07', salaId: 'sala-casa' });
    expect(itens.every((item) => item.certeza === 'baixa')).toBe(true);
  });

  it('item da IA que não aparece na frase fica sem prazo e pede confirmação', async () => {
    const { ia } = iaFalsa([
      { titulo: 'Ligar pro dentista', sala: 'Pessoal' },
      { titulo: 'Pagar a conta de luz', sala: 'Casa', quando: 'amanhã' },
    ]);
    usarIA(ia);
    const itens = await interpretar(
      'então é, eu tava pensando aqui que amanhã sem falta eu preciso mesmo ligar pro dentista para ver aquilo do dente',
    );
    expect(itens).toHaveLength(2);
    expect(itens[0]).toMatchObject({ titulo: 'Ligar pro dentista', data: '2026-11-06' });
    expect(itens[1].titulo).toBe('Pagar a conta de luz');
    expect(itens[1].data).toBeUndefined();
    expect(itens[1].certeza).toBe('baixa');
  });

  it('sala das regras vale antes da sala da IA', async () => {
    const { ia } = iaFalsa([{ titulo: 'Trocar o chuveiro', sala: 'Pessoal' }]);
    usarIA(ia);
    const [item] = await interpretar('Trocar o chuveiro às 25h');
    expect(item).toMatchObject({ salaId: 'sala-casa', motivoSala: 'memoria' });
  });

  it('pessoa desconhecida: a sala da IA é ignorada e o cartão pergunta', async () => {
    const { ia } = iaFalsa([{ titulo: 'Mandar mensagem para Renata', sala: 'Orientações' }]);
    usarIA(ia);
    const [item] = await interpretar('Mandar mensagem para Renata');
    expect(item).toMatchObject({ titulo: 'Mandar mensagem para Renata', salaId: null, pessoaNova: 'Renata' });
  });

  it('"Não sei" e sala que não existe deixam sem sala', async () => {
    for (const sala of ['Não sei', 'Jardinagem', '']) {
      const { ia } = iaFalsa([{ titulo: 'Organizar os papéis', sala }]);
      usarIA(ia);
      const [item] = await interpretar('Preciso organizar os papéis do escritório');
      expect(item.salaId).toBeNull();
    }
  });

  it('sala da IA sem acento e em minúscula ainda é achada', async () => {
    const { ia } = iaFalsa([{ titulo: 'Ler os artigos', sala: 'investigacao' }]);
    usarIA(ia);
    const [item] = await interpretar('Preciso ler os artigos novos');
    expect(item.salaId).toBe('sala-investigacao');
  });

  it('frase vazia não chama a IA', async () => {
    const { ia, chamadas } = iaFalsa([{ titulo: 'Algo' }]);
    usarIA(ia);
    expect(await interpretar('   ')).toEqual([]);
    expect(chamadas).toHaveLength(0);
  });
});

describe('tempo e privacidade', () => {
  it(`tempo limite de ${LIMITE_IA_MS / 1000} s volta para as regras e desiste da IA`, async () => {
    expect(LIMITE_IA_MS).toBe(30_000);
    const frase = 'Preciso organizar os papéis do escritório';
    const esperado = await soRegras(frase);
    let sinal: AbortSignal | undefined;
    usarIA({
      estado: () => 'pronta',
      interpretar: (_frase, contexto) => {
        sinal = contexto.sinal;
        return new Promise(() => {}); // nunca responde
      },
    });
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date(2026, 10, 5, 12, 20));
    let resultado: ItemDoChat[] | undefined;
    const pedido = interpretar(frase).then((r) => (resultado = r));
    // A loja (IndexedDB) responde fora dos temporizadores falsos: espera a IA ser chamada.
    await vi.waitFor(() => expect(sinal).toBeDefined());
    // (vi.waitFor adianta os temporizadores falsos em até 50 ms por volta.)
    await vi.advanceTimersByTimeAsync(LIMITE_IA_MS - 100);
    expect(resultado).toBeUndefined();
    expect(sinal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    await pedido;
    expect(resultado).toEqual(esperado);
    expect(sinal?.aborted).toBe(true);
  });

  it('a frase não vai para nenhuma chamada de rede', async () => {
    const rede = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', rede);
    const beacon = vi.fn(() => true);
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true });
    const xhr = vi.spyOn(XMLHttpRequest.prototype, 'open');
    const socket = vi.fn();
    vi.stubGlobal('WebSocket', socket);

    // IA de verdade (com o trabalhador falso): a frase só vai por postMessage ao trabalhador.
    const trabalhador = trabalhadorFalso({
      guardado: true,
      resposta: '{"itens":[{"titulo":"Revisar o capítulo da Marina","sala":"Orientações"},{"titulo":"Ligar pro dentista","sala":"Pessoal"}]}',
    });
    const ia = criarIA(trabalhador);
    await ia.iniciar();
    usarIA(ia);
    const itens = await interpretar(LONGA);

    expect(itens).toHaveLength(2);
    expect(trabalhador.perguntas.map((p) => p.frase)).toEqual([LONGA]);
    expect(rede).not.toHaveBeenCalled();
    expect(beacon).not.toHaveBeenCalled();
    expect(xhr).not.toHaveBeenCalled();
    expect(socket).not.toHaveBeenCalled();
  });
});
