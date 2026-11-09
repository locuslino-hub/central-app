import { describe, expect, it, vi } from 'vitest';
import { criarIA } from '../../src/ia/ia';
import type { ContextoIA } from '../../src/ia/instrucoes';
import { TOTAL_FALSO, trabalhadorFalso } from '../apoio/ia';

const CONTEXTO: ContextoIA = {
  hoje: '2026-11-05',
  salas: [{ id: 'sala-casa', nome: 'Casa' }],
  pessoas: [{ nome: 'Renata', salaId: 'sala-casa' }],
};

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('estado da IA', () => {
  it('aparelho sem suporte fica indisponível e não cria trabalhador', async () => {
    const ambiente = trabalhadorFalso({ suportado: false });
    const criar = vi.spyOn(ambiente, 'criarTrabalhador');
    const ia = criarIA(ambiente);
    await ia.iniciar();
    expect(ia.estado()).toBe('indisponivel');
    expect(ia.detalhes().motivo).toBe('sem-suporte');
    expect(criar).not.toHaveBeenCalled();
    expect(await ia.interpretar('Comprar pão', CONTEXTO)).toBeNull();
    await ia.baixar();
    expect(ambiente.pedidos).toHaveLength(0);
  });

  it('sem modelo guardado fica ausente e não baixa nada sozinha', async () => {
    const ambiente = trabalhadorFalso({ guardado: false });
    const ia = criarIA(ambiente);
    expect(ia.estado()).toBe('ausente');
    await ia.iniciar();
    expect(ia.estado()).toBe('ausente');
    expect(ambiente.pedidos.map((p) => p.tipo)).toEqual(['verificar']);
  });

  it('com modelo guardado, carrega em segundo plano até ficar pronta', async () => {
    const ambiente = trabalhadorFalso({ guardado: true });
    const ia = criarIA(ambiente);
    const vistos: string[] = [];
    ia.assinar(() => vistos.push(ia.estado()));
    await ia.iniciar();
    expect(vistos).toEqual(['carregando', 'pronta']);
    expect(ambiente.pedidos).toContainEqual({ tipo: 'carregar', wasm: ambiente.caminhoWasm });
  });

  it('iniciar duas vezes cria um trabalhador só', async () => {
    const ambiente = trabalhadorFalso({ guardado: true });
    const criar = vi.spyOn(ambiente, 'criarTrabalhador');
    const ia = criarIA(ambiente);
    await Promise.all([ia.iniciar(), ia.iniciar()]);
    await ia.iniciar();
    expect(criar).toHaveBeenCalledTimes(1);
  });

  it('trabalhador que nem abre deixa indisponível, sem lançar erro', async () => {
    const ambiente = trabalhadorFalso({ guardado: true });
    ambiente.criarTrabalhador = () => {
      throw new Error('SecurityError');
    };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const ia = criarIA(ambiente);
    await expect(ia.iniciar()).resolves.toBeUndefined();
    expect(ia.estado()).toBe('indisponivel');
    expect(ia.detalhes().motivo).toBe('falhou');
  });

  it('erro ao carregar deixa indisponível, e o chat segue sem IA', async () => {
    const ia = criarIA(trabalhadorFalso({ guardado: true, falhaAoCarregar: true }));
    await ia.iniciar();
    expect(ia.estado()).toBe('indisponivel');
    expect(ia.detalhes().motivo).toBe('falhou');
    expect(await ia.interpretar('Comprar pão', CONTEXTO)).toBeNull();
  });
});

describe('download', () => {
  it('pede armazenamento persistente, mostra o progresso e termina pronta', async () => {
    const ambiente = trabalhadorFalso({ guardado: false, passos: [1_000, 2_000, TOTAL_FALSO], persistente: false });
    const ia = criarIA(ambiente);
    await ia.iniciar();
    const progresso: number[] = [];
    ia.assinar(() => {
      const p = ia.detalhes().progresso;
      if (ia.estado() === 'baixando' && p) progresso.push(p.baixados);
    });
    await ia.baixar();
    expect(ambiente.persistiu).toBe(1);
    expect(progresso).toEqual([1_000, 2_000, TOTAL_FALSO]);
    expect(ia.estado()).toBe('pronta');
    expect(ia.detalhes().persistente).toBe(false);
  });

  it('enquanto baixa, o estado é "baixando" e a IA não responde', async () => {
    const ambiente = trabalhadorFalso({ guardado: false, segurarDownload: true });
    const ia = criarIA(ambiente);
    await ia.iniciar();
    const download = ia.baixar();
    await tick();
    expect(ia.estado()).toBe('baixando');
    expect(await ia.interpretar('Comprar pão', CONTEXTO)).toBeNull();
    ambiente.soltarDownload();
    await download;
    expect(ia.estado()).toBe('pronta');
  });

  it('reabrir depois de falha ao abrir: modelo íntegro abre sem baixar de novo', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const ambiente = trabalhadorFalso({ guardado: true, falhaAoCarregar: true });
    const ia = criarIA(ambiente);
    await ia.iniciar();
    expect(ia.estado()).toBe('indisponivel');
    ambiente.falhaAoCarregar = false;
    expect(await ia.reabrir()).toBe(true);
    expect(ia.estado()).toBe('pronta');
    expect(ambiente.pedidos.some((p) => p.tipo === 'baixar')).toBe(false);
  });

  it('reabrir sem modelo guardado diz que é preciso baixar', async () => {
    const ia = criarIA(trabalhadorFalso({ guardado: false, falhaAoBaixar: 'falhou' }));
    await ia.iniciar();
    await ia.baixar();
    expect(await ia.reabrir()).toBe(false);
    expect(ia.estado()).toBe('indisponivel');
  });

  it.each(['sem-espaco', 'sem-internet', 'falhou'] as const)('falha "%s" deixa indisponível e permite tentar de novo', async (motivo) => {
    const ambiente = trabalhadorFalso({ guardado: false, falhaAoBaixar: motivo });
    const ia = criarIA(ambiente);
    await ia.iniciar();
    await ia.baixar();
    expect(ia.estado()).toBe('indisponivel');
    expect(ia.detalhes().motivo).toBe(motivo);
    await ia.baixar();
    expect(ambiente.pedidos.filter((p) => p.tipo === 'baixar')).toHaveLength(2);
  });

  it('cancelar o download avisa o trabalhador e volta a ausente', async () => {
    const ambiente = trabalhadorFalso({ guardado: false, segurarDownload: true });
    const ia = criarIA(ambiente);
    await ia.iniciar();
    const download = ia.baixar();
    await tick();
    ia.cancelarDownload();
    await download;
    expect(ambiente.pedidos.map((p) => p.tipo)).toContain('cancelar-download');
    expect(ia.estado()).toBe('ausente');
  });

  it('apagar o modelo volta a ausente', async () => {
    const ambiente = trabalhadorFalso({ guardado: true });
    const ia = criarIA(ambiente);
    await ia.iniciar();
    await ia.apagar();
    expect(ia.estado()).toBe('ausente');
    expect(ambiente.pedidos.map((p) => p.tipo)).toContain('apagar');
  });
});

describe('interpretar', () => {
  it('manda as instruções com a loja e a frase ao trabalhador, e lê o JSON', async () => {
    const ambiente = trabalhadorFalso({
      guardado: true,
      resposta: 'Aqui está: {"itens":[{"tipo":"tarefa","titulo":"Comprar pão","sala":"Casa","quando":"","inicio":"","fim":""}]}',
    });
    const ia = criarIA(ambiente);
    await ia.iniciar();
    const itens = await ia.interpretar('Comprar pão', CONTEXTO);
    expect(itens).toEqual([{ tipo: 'tarefa', titulo: 'Comprar pão', sala: 'Casa', quando: '', inicio: '', fim: '' }]);
    const [pergunta] = ambiente.perguntas;
    expect(pergunta.frase).toBe('Comprar pão');
    expect(pergunta.sistema).toContain('Hoje é quinta-feira, 5 de novembro de 2026.');
    expect(pergunta.sistema).toContain('Renata (sala Casa)');
  });

  it('JSON quebrado volta null', async () => {
    const ia = criarIA(trabalhadorFalso({ guardado: true, resposta: '{"itens":[{"titulo":' }));
    await ia.iniciar();
    expect(await ia.interpretar('Comprar pão', CONTEXTO)).toBeNull();
  });

  it('desistir pelo sinal avisa o trabalhador e volta null', async () => {
    const ambiente = trabalhadorFalso({ guardado: true, mudo: true });
    const ia = criarIA(ambiente);
    await ia.iniciar();
    const controle = new AbortController();
    const pedido = ia.interpretar('Comprar pão', { ...CONTEXTO, sinal: controle.signal });
    await tick();
    controle.abort();
    expect(await pedido).toBeNull();
    expect(ambiente.pedidos).toContainEqual({ tipo: 'cancelar', id: ambiente.perguntas[0].id });
  });

  it('sinal já abortado nem pergunta', async () => {
    const ambiente = trabalhadorFalso({ guardado: true });
    const ia = criarIA(ambiente);
    await ia.iniciar();
    const controle = new AbortController();
    controle.abort();
    expect(await ia.interpretar('Comprar pão', { ...CONTEXTO, sinal: controle.signal })).toBeNull();
    expect(ambiente.perguntas).toHaveLength(0);
  });

  it('trabalhador que quebra deixa indisponível e solta quem esperava', async () => {
    const ambiente = trabalhadorFalso({ guardado: true, mudo: true });
    const ia = criarIA(ambiente);
    await ia.iniciar();
    const pedido = ia.interpretar('Comprar pão', CONTEXTO);
    await tick();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    ambiente.quebrar();
    expect(await pedido).toBeNull();
    expect(ia.estado()).toBe('indisponivel');
    expect(ia.detalhes().motivo).toBe('falhou');
  });
});
