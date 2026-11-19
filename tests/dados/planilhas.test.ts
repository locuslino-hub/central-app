// Cliente de planilhas (V02, Tarefa 10): cache por pasta, fila sem rede e envio
// sem duplicar. A planilha é de mentira, mas segue o contrato do script
// (script/planilhas.ts): `lerLinhas`, `anexarLinha` (idempotente pelo id) e
// `atualizarLinha` (com `antes` para conflito), respostas como dados.
import { describe, expect, it, vi } from 'vitest';
import { ErroConexao, ErroScript } from '../../src/conexao/cliente';
import { descartarPendentes, enfileirarPlanilha, listarPendentes, reiniciarAgendaParada, retirarPendente } from '../../src/dados/loja';
import { anexar, atualizar, descartarEntradasDePlanilha, enviarFilaDePlanilhas, lerPlanilha, type Chamar } from '../../src/dados/planilhas';
import { sincronizar } from '../../src/dados/sincronia';
import type { Pasta } from '../../src/dados/tipos';

const CABECALHO = ['Item', 'Quantidade', 'Valor', 'Link', 'Prioridade', 'Comprado?', 'Quem pôs', 'Data', 'Observação', 'id'];
/** Planilha criada antes da coluna Observação existir em compras. */
const CABECALHO_ANTIGO = CABECALHO.filter((c) => c !== 'Observação');
const CABECALHO_CONSUMO = ['Data', 'Leitura', 'Unidade', 'Consumo desde a anterior', 'Observação', 'id'];

const compras: Pasta = {
  id: 'pasta-teste-1',
  salaId: 'sala-casa',
  tipo: 'lista',
  nome: 'Compras da Renata',
  ordem: 1,
  planilhaId: 'planilha-teste-1',
  modelo: 'compras',
  atualizadoEm: 1,
  aparelho: 'aparelho-teste',
};
const consumo: Pasta = { ...compras, id: 'pasta-teste-2', tipo: 'registro', nome: 'Água', planilhaId: 'planilha-teste-2', modelo: 'consumo' };

type Linha = Record<string, string>;

/** Planilha e rede de mentira. `rede = false` faz toda chamada falhar como sem internet. */
function mundo(cabecalho: string[] = CABECALHO) {
  const estado = {
    rede: true,
    cabecalho,
    linhas: [] as { id: string; valores: Linha }[],
    chamadas: [] as { acao: string; dados: Record<string, unknown> }[],
    /** Antes de responder à próxima chamada, o que mudar aqui (simula outra pessoa mexendo). */
    antesDeResponder: undefined as undefined | (() => void),
    /** Responde assim, sem olhar a planilha (uma vez). */
    forcar: undefined as undefined | unknown,
  };
  const chamar = (async (acao: string, dados: object = {}) => {
    const d = dados as Record<string, any>;
    estado.chamadas.push({ acao, dados: d });
    if (!estado.rede) throw new ErroConexao();
    estado.antesDeResponder?.();
    estado.antesDeResponder = undefined;
    if (estado.forcar !== undefined) {
      const f = estado.forcar;
      estado.forcar = undefined;
      return f;
    }
    if (acao === 'lerLinhas') {
      if (!estado.cabecalho.includes('id')) return { erro: 'coluna_faltando', colunas: ['id'] };
      return { cabecalho: [...estado.cabecalho], linhas: estado.linhas.map((l) => ({ id: l.id, valores: { ...l.valores } })) };
    }
    const faltam = Object.keys(d.valores).filter((c) => !estado.cabecalho.includes(c));
    if (faltam.length > 0) return { erro: 'coluna_faltando', colunas: faltam };
    if (acao === 'anexarLinha') {
      if (!estado.linhas.some((l) => l.id === d.idDaLinha)) estado.linhas.push({ id: d.idDaLinha, valores: { ...d.valores } });
      return { ok: true };
    }
    if (acao === 'atualizarLinha') {
      const linha = estado.linhas.find((l) => l.id === d.idDaLinha);
      if (!linha) return { erro: 'linha_nao_achada' };
      for (const [coluna, antes] of Object.entries((d.antes ?? {}) as Linha)) {
        if (linha.valores[coluna] !== antes && linha.valores[coluna] !== d.valores[coluna]) return { conflito: true };
      }
      Object.assign(linha.valores, d.valores);
      return { ok: true, valores: Object.fromEntries(Object.keys(d.valores).map((c) => [c, linha.valores[c]])) };
    }
    throw new ErroScript('interno');
  }) as unknown as Chamar;
  return { estado, chamar, opcoes: { chamar } };
}

const itens = (estado: { linhas: { valores: Linha }[] }) => estado.linhas.map((l) => l.valores.Item);

describe('lerPlanilha', () => {
  it('sem rede devolve o cache', async () => {
    const m = mundo();
    m.estado.linhas.push({ id: 'linha-1', valores: { Item: 'Leite', Quantidade: '2' } });
    const online = await lerPlanilha(compras, m.opcoes);
    expect(online).toMatchObject({ doCache: false, linhas: [{ id: 'linha-1', valores: { Item: 'Leite' } }] });

    m.estado.rede = false;
    const offline = await lerPlanilha(compras, m.opcoes);
    expect(offline.doCache).toBe(true);
    expect(offline.linhas).toEqual(online.linhas);
    expect(offline.aviso).toBeUndefined();
  });

  it('sem rede e sem cache devolve lista vazia do cache', async () => {
    const m = mundo();
    m.estado.rede = false;
    expect(await lerPlanilha(compras, m.opcoes)).toEqual({ linhas: [], doCache: true });
  });

  it('o cache de cada pasta é separado', async () => {
    const a = mundo();
    const b = mundo(CABECALHO_CONSUMO);
    a.estado.linhas.push({ id: 'linha-a', valores: { Item: 'Pão' } });
    b.estado.linhas.push({ id: 'linha-b', valores: { Data: '2026-11-01', Leitura: '10' } });
    await lerPlanilha(compras, a.opcoes);
    await lerPlanilha(consumo, b.opcoes);
    a.estado.rede = false;
    expect((await lerPlanilha(compras, a.opcoes)).linhas.map((l) => l.id)).toEqual(['linha-a']);
    expect((await lerPlanilha(consumo, { chamar: a.chamar })).linhas.map((l) => l.id)).toEqual(['linha-b']);
  });

  it('linha apagada à mão some do cache ao reler', async () => {
    const m = mundo();
    m.estado.linhas.push({ id: 'linha-1', valores: { Item: 'Leite' } }, { id: 'linha-2', valores: { Item: 'Pão' } });
    await lerPlanilha(compras, m.opcoes);
    m.estado.linhas = m.estado.linhas.filter((l) => l.id !== 'linha-1');

    expect((await lerPlanilha(compras, m.opcoes)).linhas.map((l) => l.id)).toEqual(['linha-2']);
    m.estado.rede = false;
    expect((await lerPlanilha(compras, m.opcoes)).linhas.map((l) => l.id)).toEqual(['linha-2']);
  });

  it('coluna faltando vira aviso planilha_mudou e nada é gravado', async () => {
    const m = mundo(CABECALHO.filter((c) => c !== 'Quem pôs'));
    m.estado.linhas.push({ id: 'linha-1', valores: { Item: 'Leite' } });
    const leitura = await lerPlanilha(compras, m.opcoes);
    expect(leitura.aviso).toBe('planilha_mudou');
    expect(leitura.linhas).toHaveLength(1);

    // O script recusa o anexo por coluna faltando: nada é gravado nem fica na fila.
    const anexo = await anexar(compras, { Item: 'Ovos', 'Quem pôs': 'Marina' }, m.opcoes);
    expect(anexo).toMatchObject({ situacao: 'bloqueada', aviso: 'planilha_mudou' });
    expect(itens(m.estado)).toEqual(['Leite']);
    expect(await listarPendentes()).toEqual([]);
    await anexo.desfazer();
    expect(m.estado.chamadas.filter((c) => c.acao !== 'lerLinhas' && c.acao !== 'anexarLinha')).toEqual([]);

    expect(await atualizar(compras, 'linha-1', { 'Quem pôs': 'Marina' }, m.opcoes)).toBe('planilha_mudou');
    expect(m.estado.linhas[0]!.valores).toEqual({ Item: 'Leite' });
  });

  it('planilha sem a coluna id vira planilha_mudou e mantém o cache', async () => {
    const m = mundo();
    m.estado.linhas.push({ id: 'linha-1', valores: { Item: 'Leite' } });
    await lerPlanilha(compras, m.opcoes);
    m.estado.cabecalho = CABECALHO.filter((c) => c !== 'id');
    const leitura = await lerPlanilha(compras, m.opcoes);
    expect(leitura).toMatchObject({ aviso: 'planilha_mudou', doCache: true });
    expect(leitura.linhas.map((l) => l.id)).toEqual(['linha-1']);
  });

  it('fora da pasta avisa e mostra o cache sem apagar nada', async () => {
    const m = mundo();
    m.estado.linhas.push({ id: 'linha-1', valores: { Item: 'Leite' } });
    await lerPlanilha(compras, m.opcoes);
    m.estado.forcar = { erro: 'fora_da_pasta' };
    const leitura = await lerPlanilha(compras, m.opcoes);
    expect(leitura).toMatchObject({ aviso: 'fora_da_pasta', doCache: true });
    expect(leitura.linhas).toHaveLength(1);
  });

  it('pasta sem planilha lança pasta_sem_planilha', async () => {
    const { planilhaId: _fora, ...semPlanilha } = compras;
    await expect(lerPlanilha(semPlanilha as Pasta, mundo().opcoes)).rejects.toThrow('pasta_sem_planilha');
  });

  it('erro do script que não é rede sobe', async () => {
    const chamar = vi.fn(async () => {
      throw new ErroScript('codigo-invalido');
    }) as unknown as Chamar;
    await expect(lerPlanilha(compras, { chamar })).rejects.toBeInstanceOf(ErroScript);
  });

  it('texto da planilha é devolvido como veio, sem interpretar', async () => {
    const m = mundo();
    const estranho = '<img src=x onerror=alert(1)> =CMD() __proto__';
    m.estado.linhas.push({ id: 'linha-1', valores: { Item: estranho } });
    expect((await lerPlanilha(compras, m.opcoes)).linhas[0]!.valores.Item).toBe(estranho);
  });
});

describe('anexar', () => {
  it('com rede grava na planilha, aparece na leitura sem rede e manda o id gerado', async () => {
    const m = mundo();
    const r = await anexar(compras, { Item: 'Leite', 'Quem pôs': 'Marina' }, m.opcoes);
    expect(r.situacao).toBe('enviada');
    expect(r.idDaLinha).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(m.estado.linhas).toEqual([{ id: r.idDaLinha, valores: { Item: 'Leite', 'Quem pôs': 'Marina' } }]);
    m.estado.rede = false;
    expect((await lerPlanilha(compras, m.opcoes)).linhas.map((l) => l.id)).toEqual([r.idDaLinha]);
    expect(await listarPendentes()).toEqual([]);
  });

  it('anexar sem rede entra na fila e envia ao voltar a rede, uma vez só', async () => {
    const m = mundo();
    m.estado.rede = false;
    const a = await anexar(compras, { Item: 'Leite' }, m.opcoes);
    const b = await anexar(compras, { Item: 'Pão' }, m.opcoes);
    expect([a.situacao, b.situacao]).toEqual(['na_fila', 'na_fila']);
    expect((await lerPlanilha(compras, m.opcoes)).linhas.map((l) => l.valores.Item)).toEqual(['Leite', 'Pão']);
    expect(await listarPendentes()).toHaveLength(2);

    m.estado.rede = true;
    m.estado.chamadas.length = 0;
    const estado = await sincronizar({ chamar: ((acao: string, dados?: object) => (acao === 'puxar' ? Promise.resolve({ registros: [], agora: Date.now() }) : acao === 'enviar' ? Promise.resolve({ aceitas: [], conflitos: [] , agora: Date.now() }) : m.chamar(acao, dados))) as Chamar });
    expect(estado).toBe('atualizado');
    expect(itens(m.estado)).toEqual(['Leite', 'Pão']);
    expect(m.estado.chamadas.filter((c) => c.acao === 'anexarLinha').map((c) => (c.dados.valores as Linha).Item)).toEqual(['Leite', 'Pão']);
    expect(await listarPendentes()).toEqual([]);

    await enviarFilaDePlanilhas(m.chamar);
    expect(itens(m.estado)).toEqual(['Leite', 'Pão']);
    expect(m.estado.chamadas.filter((c) => c.acao === 'anexarLinha')).toHaveLength(2);
  });

  it('script ocupado também espera na fila', async () => {
    const chamar = vi.fn(async () => {
      throw new ErroScript('ocupado');
    }) as unknown as Chamar;
    const r = await anexar(compras, { Item: 'Leite' }, { chamar });
    expect(r.situacao).toBe('na_fila');
    expect(await listarPendentes()).toHaveLength(1);
  });

  it('repetir envio da fila não duplica (idDaLinha)', async () => {
    const m = mundo();
    m.estado.rede = false;
    const r = await anexar(compras, { Item: 'Leite' }, m.opcoes);
    m.estado.rede = true;
    // A primeira resposta se perde: a linha chegou, mas a fila não soube.
    const normal = m.chamar;
    let perdeu = true;
    const chamar = (async (acao: string, dados?: object) => {
      const resposta = await normal(acao, dados);
      if (perdeu && acao === 'anexarLinha') {
        perdeu = false;
        throw new ErroConexao();
      }
      return resposta;
    }) as unknown as Chamar;
    await expect(enviarFilaDePlanilhas(chamar)).rejects.toBeInstanceOf(ErroConexao);
    expect(await listarPendentes()).toHaveLength(1);
    await enviarFilaDePlanilhas(chamar);
    expect(m.estado.linhas.map((l) => l.id)).toEqual([r.idDaLinha]);
    expect(await listarPendentes()).toEqual([]);
  });

  it('a fila segue a ordem de entrada mesmo se uma ação for recusada', async () => {
    const m = mundo();
    m.estado.rede = false;
    await anexar(compras, { Item: 'Um' }, m.opcoes);
    await anexar(compras, { Item: 'Dois' }, m.opcoes);
    await anexar(compras, { Item: 'Três' }, m.opcoes);
    m.estado.rede = true;
    m.estado.forcar = { erro: 'sem_acesso' }; // recusa só a primeira
    await enviarFilaDePlanilhas(m.chamar);
    expect(itens(m.estado)).toEqual(['Dois', 'Três']);
    const sobrou = await listarPendentes();
    expect(sobrou).toHaveLength(1);
    expect(sobrou[0]).toMatchObject({ valores: { Item: 'Um' }, tentativas: 1 });
    await enviarFilaDePlanilhas(m.chamar);
    expect(itens(m.estado)).toEqual(['Dois', 'Três', 'Um']);
  });

  it('coluna faltando ao enviar a fila não grava e a ação fica guardada', async () => {
    const m = mundo();
    m.estado.rede = false;
    await anexar(compras, { Item: 'Leite', 'Quem pôs': 'Marina' }, m.opcoes);
    m.estado.rede = true;
    m.estado.cabecalho = CABECALHO.filter((c) => c !== 'Quem pôs');
    await enviarFilaDePlanilhas(m.chamar);
    expect(m.estado.linhas).toEqual([]);
    expect(await listarPendentes()).toHaveLength(1);
  });
});

describe('desfazer de anexar', () => {
  it('ainda na fila: sai da fila, some da vista e nada é enviado', async () => {
    const m = mundo();
    m.estado.rede = false;
    const r = await anexar(compras, { Item: 'Leite' }, m.opcoes);
    await r.desfazer();
    expect(await listarPendentes()).toEqual([]);
    expect((await lerPlanilha(compras, m.opcoes)).linhas).toEqual([]);

    m.estado.rede = true;
    m.estado.chamadas.length = 0;
    await enviarFilaDePlanilhas(m.chamar);
    expect(m.estado.chamadas).toEqual([]);
    expect(m.estado.linhas).toEqual([]);
  });

  it('já enviado: marca Observação "desfeito", esconde no cache e nunca apaga a linha', async () => {
    const m = mundo(CABECALHO_CONSUMO);
    const r = await anexar(consumo, { Data: '2026-11-01', Leitura: '12' }, m.opcoes);
    await r.desfazer();
    await r.desfazer(); // repetir não faz nada a mais
    expect(m.estado.linhas).toEqual([{ id: r.idDaLinha, valores: { Data: '2026-11-01', Leitura: '12', Observação: 'desfeito' } }]);
    expect(m.estado.chamadas.filter((c) => c.acao === 'atualizarLinha')).toHaveLength(1);
    expect((await lerPlanilha(consumo, m.opcoes)).linhas).toEqual([]);
    m.estado.rede = false;
    expect((await lerPlanilha(consumo, m.opcoes)).linhas).toEqual([]);
  });

  it('linha "desfeito" feita em outro aparelho também fica fora da vista', async () => {
    const m = mundo(CABECALHO_CONSUMO);
    m.estado.linhas.push({ id: 'linha-1', valores: { Data: '2026-11-01', Observação: 'Desfeito' } }, { id: 'linha-2', valores: { Data: '2026-11-02' } });
    expect((await lerPlanilha(consumo, m.opcoes)).linhas.map((l) => l.id)).toEqual(['linha-2']);
  });

  it('já enviado e sem rede: a marca espera na fila e a linha fica escondida', async () => {
    const m = mundo(CABECALHO_CONSUMO);
    const r = await anexar(consumo, { Data: '2026-11-01', Leitura: '12' }, m.opcoes);
    m.estado.rede = false;
    await r.desfazer();
    expect((await lerPlanilha(consumo, m.opcoes)).linhas).toEqual([]);
    expect(await listarPendentes()).toEqual([expect.objectContaining({ acao: 'atualizar', idDaLinha: r.idDaLinha, valores: { Observação: 'desfeito' } })]);

    m.estado.rede = true;
    await enviarFilaDePlanilhas(m.chamar);
    expect(m.estado.linhas[0]!.valores.Observação).toBe('desfeito');
    expect(await listarPendentes()).toEqual([]);
    expect((await lerPlanilha(consumo, m.opcoes)).linhas).toEqual([]);
  });

  it('compras com Observação: marca "desfeito" na planilha como o consumo', async () => {
    const m = mundo();
    const r = await anexar(compras, { Item: 'Leite' }, m.opcoes);
    await r.desfazer();
    expect(m.estado.linhas).toEqual([{ id: r.idDaLinha, valores: { Item: 'Leite', Observação: 'desfeito' } }]);
    expect((await lerPlanilha(compras, m.opcoes)).linhas).toEqual([]);
  });

  it('planilha antiga de compras (sem Observação) não dá planilha_mudou na leitura', async () => {
    const m = mundo(CABECALHO_ANTIGO);
    m.estado.linhas.push({ id: 'linha-1', valores: { Item: 'Leite' } });
    expect((await lerPlanilha(compras, m.opcoes)).aviso).toBeUndefined();
  });

  it('planilha antiga (sem Observação): só esconde aqui, sem apagar nada', async () => {
    const m = mundo(CABECALHO_ANTIGO);
    const r = await anexar(compras, { Item: 'Leite' }, m.opcoes);
    await r.desfazer();
    expect(m.estado.linhas).toHaveLength(1);
    expect(await listarPendentes()).toEqual([]);
    expect((await lerPlanilha(compras, m.opcoes)).linhas).toEqual([]);
  });

  it('desfeito durante o envio da fila: a linha chega e logo recebe a marca', async () => {
    const m = mundo(CABECALHO_CONSUMO);
    m.estado.rede = false;
    const r = await anexar(consumo, { Data: '2026-11-01', Leitura: '12' }, m.opcoes);
    m.estado.rede = true;
    // Entre o envio e a confirmação, o dono desfaz (a entrada sai da fila antes de o envio terminar).
    const normal = m.chamar;
    let uma = true;
    const chamar = (async (acao: string, dados?: object) => {
      const resposta = await normal(acao, dados);
      if (uma && acao === 'anexarLinha') {
        uma = false;
        const [entrada] = await listarPendentes();
        const { retirarPendente } = await import('../../src/dados/loja');
        await retirarPendente(entrada!.seq);
      }
      return resposta;
    }) as unknown as Chamar;
    await enviarFilaDePlanilhas(chamar);
    expect(m.estado.linhas).toHaveLength(1);
    expect(m.estado.linhas[0]!.valores.Observação).toBe('desfeito');
    expect(await listarPendentes()).toEqual([]);
  });
});

describe('atualizar', () => {
  it('muda a linha pelo id e atualiza o cache', async () => {
    const m = mundo();
    m.estado.linhas.push({ id: 'linha-1', valores: { Item: 'Leite', 'Comprado?': 'FALSE' } });
    await lerPlanilha(compras, m.opcoes);
    expect(await atualizar(compras, 'linha-1', { 'Comprado?': 'TRUE' }, m.opcoes)).toBe('ok');
    expect(m.estado.linhas[0]!.valores['Comprado?']).toBe('TRUE');
    m.estado.rede = false;
    expect((await lerPlanilha(compras, m.opcoes)).linhas[0]!.valores['Comprado?']).toBe('TRUE');
    const envio = m.estado.chamadas.find((c) => c.acao === 'atualizarLinha')!;
    expect(envio.dados.antes).toEqual({ 'Comprado?': 'FALSE' });
  });

  it('atualizar em conflito relê e tenta de novo', async () => {
    const m = mundo();
    m.estado.linhas.push({ id: 'linha-1', valores: { Item: 'Leite', Quantidade: '2' } });
    await lerPlanilha(compras, m.opcoes);
    // Outra pessoa muda a quantidade depois da nossa leitura.
    m.estado.antesDeResponder = () => {
      m.estado.linhas[0]!.valores.Quantidade = '5';
    };
    expect(await atualizar(compras, 'linha-1', { Quantidade: '3' }, m.opcoes)).toBe('ok');
    expect(m.estado.linhas[0]!.valores.Quantidade).toBe('3');
    expect(m.estado.chamadas.map((c) => c.acao)).toEqual(['lerLinhas', 'atualizarLinha', 'lerLinhas', 'atualizarLinha']);
    expect((m.estado.chamadas[3]!.dados.antes as Linha).Quantidade).toBe('5');
  });

  it('conflito que persiste depois de reler dá conflito, sem laço', async () => {
    const m = mundo();
    m.estado.linhas.push({ id: 'linha-1', valores: { Item: 'Leite', Quantidade: '2' } });
    await lerPlanilha(compras, m.opcoes);
    const normal = m.chamar;
    let n = 0;
    const chamar = (async (acao: string, dados?: object) => {
      if (acao === 'atualizarLinha') {
        n += 1;
        return { conflito: true };
      }
      return normal(acao, dados);
    }) as unknown as Chamar;
    expect(await atualizar(compras, 'linha-1', { Quantidade: '3' }, { chamar })).toBe('conflito');
    expect(n).toBe(2);
  });

  it('linha apagada à mão dá sumiu e sai do cache', async () => {
    const m = mundo();
    m.estado.linhas.push({ id: 'linha-1', valores: { Item: 'Leite' } });
    await lerPlanilha(compras, m.opcoes);
    m.estado.linhas = [];
    expect(await atualizar(compras, 'linha-1', { Item: 'Pão' }, m.opcoes)).toBe('sumiu');
    m.estado.rede = false;
    expect((await lerPlanilha(compras, m.opcoes)).linhas).toEqual([]);
  });

  it('linha apagada entre o conflito e a releitura também dá sumiu', async () => {
    const m = mundo();
    m.estado.linhas.push({ id: 'linha-1', valores: { Item: 'Leite', Quantidade: '2' } });
    await lerPlanilha(compras, m.opcoes);
    const normal = m.chamar;
    const chamar = (async (acao: string, dados?: object) => {
      if (acao === 'atualizarLinha') {
        m.estado.linhas = [];
        return { conflito: true };
      }
      return normal(acao, dados);
    }) as unknown as Chamar;
    expect(await atualizar(compras, 'linha-1', { Quantidade: '3' }, { chamar })).toBe('sumiu');
  });

  it('sem rede: vale no cache, entra na fila e sai ao voltar a rede', async () => {
    const m = mundo();
    m.estado.linhas.push({ id: 'linha-1', valores: { Item: 'Leite', 'Comprado?': 'FALSE' } });
    await lerPlanilha(compras, m.opcoes);
    m.estado.rede = false;
    expect(await atualizar(compras, 'linha-1', { 'Comprado?': 'TRUE' }, m.opcoes)).toBe('na_fila');
    expect((await lerPlanilha(compras, m.opcoes)).linhas[0]!.valores['Comprado?']).toBe('TRUE');
    m.estado.rede = true;
    await enviarFilaDePlanilhas(m.chamar);
    expect(m.estado.linhas[0]!.valores['Comprado?']).toBe('TRUE');
    expect(await listarPendentes()).toEqual([]);
  });

  it('atualização guardada de linha que já sumiu sai da fila sem erro', async () => {
    const m = mundo();
    m.estado.linhas.push({ id: 'linha-1', valores: { Item: 'Leite' } });
    await lerPlanilha(compras, m.opcoes);
    m.estado.rede = false;
    await atualizar(compras, 'linha-1', { Item: 'Pão' }, m.opcoes);
    m.estado.rede = true;
    m.estado.linhas = [];
    await enviarFilaDePlanilhas(m.chamar);
    expect(await listarPendentes()).toEqual([]);
  });

  it('fora_da_pasta dá indisponivel e não apaga nada', async () => {
    const m = mundo();
    m.estado.linhas.push({ id: 'linha-1', valores: { Item: 'Leite' } });
    await lerPlanilha(compras, m.opcoes);
    m.estado.forcar = { erro: 'fora_da_pasta' };
    expect(await atualizar(compras, 'linha-1', { Item: 'Pão' }, m.opcoes)).toBe('indisponivel');
    expect((await lerPlanilha(compras, { chamar: (async () => { throw new ErroConexao(); }) as unknown as Chamar })).linhas).toHaveLength(1);
  });
});


// ---------- correções da revisão ----------

const ANEXO = (idDaLinha: string, valores: Linha = { Item: 'Leite' }) =>
  ({ tipo: 'planilha', acao: 'anexar', planilhaId: 'planilha-teste-1', idDaLinha, valores }) as const;
const MUDANCA = (idDaLinha: string, valores: Linha, antes?: Linha) =>
  ({ tipo: 'planilha', acao: 'atualizar', planilhaId: 'planilha-teste-1', idDaLinha, valores, ...(antes ? { antes } : {}) }) as const;

/** Faz a entrada passar do limite de tempo na fila (7 dias): fica inerte. */
function envelhecer() {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.now() + 8 * 24 * 60 * 60 * 1000);
}

describe('fila: atualizar de linha cujo anexo ainda está na fila (1)', () => {
  it('é pulada sem contar tentativa enquanto o anexo não chegou; nada é gravado', async () => {
    const m = mundo();
    await enfileirarPlanilha(ANEXO('linha-1'));
    await enfileirarPlanilha(MUDANCA('linha-1', { Quantidade: '3' }));
    m.estado.cabecalho = CABECALHO.filter((c) => c !== 'Item'); // o script responde coluna_faltando ao anexo
    await enviarFilaDePlanilhas(m.chamar);
    expect(m.estado.chamadas.map((c) => c.acao)).toEqual(['anexarLinha']);
    const fila = await listarPendentes();
    expect(fila).toHaveLength(2);
    expect(fila.find((p) => p.tipo === 'planilha' && p.acao === 'atualizar')).toMatchObject({ tentativas: 0 });
  });

  it('com o anexo enviado na mesma rodada, a atualização vai logo depois', async () => {
    const m = mundo();
    await enfileirarPlanilha(ANEXO('linha-1'));
    await enfileirarPlanilha(MUDANCA('linha-1', { Quantidade: '3' }));
    await enviarFilaDePlanilhas(m.chamar);
    expect(m.estado.linhas).toEqual([{ id: 'linha-1', valores: { Item: 'Leite', Quantidade: '3' } }]);
    expect(await listarPendentes()).toEqual([]);
  });
});

describe('fila: entradas inertes (2)', () => {
  it('são puladas pela sincronia e aparecem na vista como parada, não como salvas', async () => {
    const m = mundo();
    m.estado.rede = false;
    const r = await anexar(compras, { Item: 'Leite' }, m.opcoes);
    expect((await lerPlanilha(compras, m.opcoes)).linhas).toEqual([expect.objectContaining({ id: r.idDaLinha, pendente: 'fila' })]);
    envelhecer();
    m.estado.rede = true;
    m.estado.chamadas.length = 0;
    await enviarFilaDePlanilhas(m.chamar);
    expect(m.estado.chamadas).toEqual([]);
    expect(m.estado.linhas).toEqual([]);
    const leitura = await lerPlanilha(compras, m.opcoes);
    expect(leitura.linhas).toEqual([expect.objectContaining({ id: r.idDaLinha, pendente: 'parada' })]);
  });

  it('descartar o anexo inerte tira a linha da vista', async () => {
    const m = mundo();
    m.estado.rede = false;
    const r = await anexar(compras, { Item: 'Leite' }, m.opcoes);
    envelhecer();
    const [entrada] = await listarPendentes();
    await descartarPendentes([entrada!.seq]);
    expect((await lerPlanilha(compras, m.opcoes)).linhas.map((l) => l.id)).not.toContain(r.idDaLinha);
  });
});

describe('atualizar sem rede guarda o "antes" (3)', () => {
  it('o antes vem do cache, antes da mudança local, só das colunas mudadas', async () => {
    const m = mundo();
    m.estado.linhas.push({ id: 'linha-1', valores: { Item: 'Leite', Quantidade: '2', 'Comprado?': 'FALSE' } });
    await lerPlanilha(compras, m.opcoes);
    m.estado.rede = false;
    await atualizar(compras, 'linha-1', { Quantidade: '3' }, m.opcoes);
    expect(await listarPendentes()).toEqual([expect.objectContaining({ valores: { Quantidade: '3' }, antes: { Quantidade: '2' } })]);
  });

  it('duas mudanças offline na mesma linha viram uma entrada e mantêm o primeiro antes', async () => {
    const m = mundo();
    m.estado.linhas.push({ id: 'linha-1', valores: { Item: 'Leite', Quantidade: '2', Valor: '1' } });
    await lerPlanilha(compras, m.opcoes);
    m.estado.rede = false;
    await atualizar(compras, 'linha-1', { Quantidade: '3' }, m.opcoes);
    await atualizar(compras, 'linha-1', { Quantidade: '4', Valor: '2' }, m.opcoes);
    const fila = await listarPendentes();
    expect(fila).toHaveLength(1);
    expect(fila[0]).toMatchObject({ valores: { Quantidade: '4', Valor: '2' }, antes: { Quantidade: '2', Valor: '1' } });
  });

  it('a fila envia o antes; conflito deixa a entrada guardada e conta tentativa, sem repetir sempre', async () => {
    const m = mundo();
    m.estado.linhas.push({ id: 'linha-1', valores: { Item: 'Leite', Quantidade: '2' } });
    await lerPlanilha(compras, m.opcoes);
    m.estado.rede = false;
    await atualizar(compras, 'linha-1', { Quantidade: '3' }, m.opcoes);
    m.estado.rede = true;
    m.estado.linhas[0]!.valores.Quantidade = '9'; // outra pessoa mexeu enquanto estávamos sem rede
    m.estado.chamadas.length = 0;
    await enviarFilaDePlanilhas(m.chamar);
    expect(m.estado.chamadas[0]!.dados.antes).toEqual({ Quantidade: '2' });
    expect(m.estado.linhas[0]!.valores.Quantidade).toBe('9');
    expect(await listarPendentes()).toEqual([expect.objectContaining({ tentativas: 1 })]);
    await enviarFilaDePlanilhas(m.chamar); // na mesma hora, não conta de novo
    expect(await listarPendentes()).toEqual([expect.objectContaining({ tentativas: 1 })]);
    // Passado o limite, fica inerte (o aviso da fila mostra) em vez de tentar para sempre.
    envelhecer();
    m.estado.chamadas.length = 0;
    await enviarFilaDePlanilhas(m.chamar);
    expect(m.estado.chamadas).toEqual([]);
    expect(await listarPendentes()).toHaveLength(1);
  });
});

describe('atualizar linha que só está na fila (4)', () => {
  it.each([true, false])('junta os valores no anexo da fila, sem chamar o script (rede %s)', async (rede) => {
    const m = mundo();
    m.estado.rede = false;
    const r = await anexar(compras, { Item: 'Leite', Quantidade: '1' }, m.opcoes);
    m.estado.rede = rede;
    m.estado.chamadas.length = 0;
    expect(await atualizar(compras, r.idDaLinha, { Quantidade: '3' }, m.opcoes)).toBe('na_fila');
    expect(m.estado.chamadas).toEqual([]);
    expect(await listarPendentes()).toEqual([expect.objectContaining({ acao: 'anexar', valores: { Item: 'Leite', Quantidade: '3' } })]);
    m.estado.rede = true;
    await enviarFilaDePlanilhas(m.chamar);
    expect(m.estado.linhas).toEqual([{ id: r.idDaLinha, valores: { Item: 'Leite', Quantidade: '3' } }]);
  });
});

describe('a vista mostra as mudanças que esperam na fila (5)', () => {
  it('edição offline sobrevive a uma releitura antes de a fila sair', async () => {
    const m = mundo();
    m.estado.linhas.push({ id: 'linha-1', valores: { Item: 'Leite', 'Comprado?': 'FALSE' } });
    await lerPlanilha(compras, m.opcoes);
    m.estado.rede = false;
    await atualizar(compras, 'linha-1', { 'Comprado?': 'TRUE' }, m.opcoes);
    m.estado.rede = true;
    const leitura = await lerPlanilha(compras, m.opcoes); // o servidor ainda diz FALSE
    expect(leitura.doCache).toBe(false);
    expect(leitura.linhas[0]!.valores['Comprado?']).toBe('TRUE');
  });

  it('um "desfeito" na fila esconde a linha mesmo depois de reler', async () => {
    const m = mundo();
    const r = await anexar(compras, { Item: 'Leite' }, m.opcoes);
    m.estado.rede = false;
    await r.desfazer();
    m.estado.rede = true;
    expect((await lerPlanilha(compras, m.opcoes)).linhas).toEqual([]);
  });
});

describe('resposta fora do combinado (6)', () => {
  it.each([['texto'], [42], [{ nada: 1 }], [{ linhas: 'x', cabecalho: [] }], [{ ok: false }], [[]]])('resposta %j vira ErroScript interno em ler, anexar e atualizar', async (resposta) => {
    const chamar = (async () => resposta) as unknown as Chamar;
    await expect(lerPlanilha(compras, { chamar })).rejects.toMatchObject({ erro: 'interno' });
    await expect(anexar(compras, { Item: 'Leite' }, { chamar })).rejects.toMatchObject({ erro: 'interno' });
    await expect(atualizar(compras, 'linha-1', { Item: 'Pão' }, { chamar })).rejects.toMatchObject({ erro: 'interno' });
  });

  it('a fila não dá TypeError com resposta que não é objeto: conta tentativa e segue', async () => {
    await enfileirarPlanilha(ANEXO('linha-1'));
    await enfileirarPlanilha(MUDANCA('linha-2', { Item: 'x' }));
    for (const resposta of [null, undefined, 'texto', 7]) {
      const chamar = (async () => resposta) as unknown as Chamar;
      await expect(enviarFilaDePlanilhas(chamar)).resolves.toBeUndefined();
    }
    expect(await listarPendentes()).toHaveLength(2);
  });
});

describe('desfazer quando o script não deixa gravar (7, 8)', () => {
  it.each(['sem_acesso', 'fora_da_pasta'])('%s: a marca "desfeito" vai para a fila, não se perde', async (erro) => {
    const m = mundo();
    const r = await anexar(compras, { Item: 'Leite' }, m.opcoes);
    m.estado.forcar = { erro };
    await r.desfazer();
    expect(await listarPendentes()).toEqual([expect.objectContaining({ acao: 'atualizar', idDaLinha: r.idDaLinha, valores: { Observação: 'desfeito' } })]);
    expect((await lerPlanilha(compras, m.opcoes)).linhas).toEqual([]);
  });

  it('desfeito durante o envio e o script recusa a marca: a marca vai para a fila', async () => {
    const m = mundo();
    m.estado.rede = false;
    const r = await anexar(compras, { Item: 'Leite' }, m.opcoes);
    m.estado.rede = true;
    const normal = m.chamar;
    const chamar = (async (acao: string, dados?: object) => {
      if (acao === 'atualizarLinha') throw new ErroScript('interno');
      const resposta = await normal(acao, dados);
      const [entrada] = await listarPendentes();
      await retirarPendente(entrada!.seq); // o dono desfaz enquanto o envio termina
      return resposta;
    }) as unknown as Chamar;
    await enviarFilaDePlanilhas(chamar);
    expect(m.estado.linhas.map((l) => l.id)).toEqual([r.idDaLinha]);
    expect(await listarPendentes()).toEqual([expect.objectContaining({ acao: 'atualizar', valores: { Observação: 'desfeito' } })]);
  });
});

describe('desfazer chamado duas vezes (10)', () => {
  it('no anexo da fila e no já enviado, a segunda chamada não faz nada', async () => {
    const m = mundo();
    m.estado.rede = false;
    const a = await anexar(compras, { Item: 'Leite' }, m.opcoes);
    await a.desfazer();
    await a.desfazer();
    expect(await listarPendentes()).toEqual([]);
    m.estado.rede = true;
    const b = await anexar(compras, { Item: 'Pão' }, m.opcoes);
    await b.desfazer();
    await b.desfazer();
    expect(m.estado.chamadas.filter((c) => c.acao === 'atualizarLinha')).toHaveLength(1);
  });
});

// Revisão da Tarefa 13 (achados 5 e 8): desfazer que falha pode ser tentado de novo, e diz o que fez de verdade.
describe('desfazer que falha e resultado real', () => {
  it('se der erro, relança e a segunda tentativa faz o trabalho (não fica "desfeito" de mentira)', async () => {
    const m = mundo();
    const r = await anexar(compras, { Item: 'Leite' }, m.opcoes);
    m.estado.antesDeResponder = () => {
      m.estado.antesDeResponder = undefined; // só esta chamada falha
      throw new Error('falha de teste');
    };
    await expect(r.desfazer()).rejects.toThrow('falha de teste');

    expect(await r.desfazer()).toBe('marcada');
    expect(m.estado.linhas[0]!.valores['Observação']).toBe('desfeito');
    expect((await lerPlanilha(compras, m.opcoes)).linhas).toEqual([]);
  });

  it('devolve "tirada_da_fila" quando ainda estava na fila e "marcada" quando já estava na planilha', async () => {
    const m = mundo();
    m.estado.rede = false;
    const naFila = await anexar(compras, { Item: 'Leite' }, m.opcoes);
    expect(await naFila.desfazer()).toBe('tirada_da_fila');
    m.estado.rede = true;
    const enviada = await anexar(compras, { Item: 'Pão' }, m.opcoes);
    expect(await enviada.desfazer()).toBe('marcada');
    expect(await enviada.desfazer()).toBe('marcada'); // repetir devolve o mesmo
  });

  it('anexo que esperava na fila e foi enviado antes do Desfazer: é "marcada", não "tirada_da_fila"', async () => {
    const m = mundo();
    m.estado.rede = false;
    const r = await anexar(compras, { Item: 'Leite' }, m.opcoes);
    m.estado.rede = true;
    await enviarFilaDePlanilhas(m.chamar);
    expect(await r.desfazer()).toBe('marcada');
  });
});

// ---------- segunda rodada da revisão ----------

describe('mudança durante o envio do anexo (H1)', () => {
  it('a edição feita enquanto o anexo é enviado chega à planilha', async () => {
    const m = mundo();
    m.estado.rede = false;
    const r = await anexar(compras, { Item: 'Leite', Quantidade: '1' }, m.opcoes);
    m.estado.rede = true;
    const normal = m.chamar;
    let uma = true;
    const chamar = (async (acao: string, dados?: object) => {
      const resposta = await normal(acao, dados);
      if (uma && acao === 'anexarLinha') {
        uma = false;
        // O dono muda a quantidade enquanto a resposta do envio ainda não voltou.
        expect(await atualizar(compras, r.idDaLinha, { Quantidade: '7' }, { chamar: normal })).toBe('na_fila');
      }
      return resposta;
    }) as unknown as Chamar;
    await enviarFilaDePlanilhas(chamar);
    await enviarFilaDePlanilhas(chamar);
    expect(m.estado.linhas).toEqual([{ id: r.idDaLinha, valores: { Item: 'Leite', Quantidade: '7' } }]);
    expect(await listarPendentes()).toEqual([]);
  });
});

describe('mudança não se junta a entrada inerte (M2)', () => {
  it('cria entrada nova em vez de juntar à que a sincronia abandonou', async () => {
    const m = mundo();
    m.estado.linhas.push({ id: 'linha-1', valores: { Item: 'Leite', Quantidade: '2', Valor: '1' } });
    await lerPlanilha(compras, m.opcoes);
    m.estado.rede = false;
    await atualizar(compras, 'linha-1', { Quantidade: '3' }, m.opcoes);
    envelhecer();
    await atualizar(compras, 'linha-1', { Valor: '2' }, m.opcoes);
    const fila = await listarPendentes();
    expect(fila).toHaveLength(2);
    expect(fila[0]).toMatchObject({ valores: { Quantidade: '3' } });
    expect(fila[1]).toMatchObject({ valores: { Valor: '2' }, antes: { Valor: '1' } });
    m.estado.rede = true;
    m.estado.chamadas.length = 0;
    await enviarFilaDePlanilhas(m.chamar);
    expect(m.estado.linhas[0]!.valores).toMatchObject({ Quantidade: '2', Valor: '2' }); // só a nova saiu
  });
});

describe('conflito na fila e "Tentar de novo" (M3)', () => {
  async function comConflito() {
    const m = mundo();
    m.estado.linhas.push({ id: 'linha-1', valores: { Item: 'Leite', Quantidade: '2' } });
    await lerPlanilha(compras, m.opcoes);
    m.estado.rede = false;
    await atualizar(compras, 'linha-1', { Quantidade: '3' }, m.opcoes);
    m.estado.rede = true;
    m.estado.linhas[0]!.valores.Quantidade = '9';
    await enviarFilaDePlanilhas(m.chamar);
    return m;
  }

  it('a entrada que acabou em conflito é marcada como tal', async () => {
    await comConflito();
    expect(await listarPendentes()).toEqual([expect.objectContaining({ conflito: true, tentativas: 1 })]);
  });

  it('Tentar de novo envia sem o antes: a edição do dono vale por cima', async () => {
    const m = await comConflito();
    envelhecer();
    await reiniciarAgendaParada();
    const [entrada] = await listarPendentes();
    expect(entrada).toMatchObject({ tentativas: 0 });
    expect((entrada as { antes?: unknown }).antes).toBeUndefined();
    await enviarFilaDePlanilhas(m.chamar);
    expect(m.estado.linhas[0]!.valores.Quantidade).toBe('3');
    expect(await listarPendentes()).toEqual([]);
  });

  it('Tentar de novo não tira o antes de entrada parada por outro motivo', async () => {
    const m = mundo();
    m.estado.linhas.push({ id: 'linha-1', valores: { Item: 'Leite', Quantidade: '2' } });
    await lerPlanilha(compras, m.opcoes);
    m.estado.rede = false;
    await atualizar(compras, 'linha-1', { Quantidade: '3' }, m.opcoes);
    envelhecer();
    await reiniciarAgendaParada();
    expect(await listarPendentes()).toEqual([expect.objectContaining({ antes: { Quantidade: '2' } })]);
  });
});

describe('descartar mudança inerte restaura o cache (L4)', () => {
  it('os valores de antes voltam ao cache; mudança mais nova não é pisada', async () => {
    const m = mundo();
    m.estado.linhas.push({ id: 'linha-1', valores: { Item: 'Leite', Quantidade: '2', Valor: '1' } });
    await lerPlanilha(compras, m.opcoes);
    m.estado.rede = false;
    await atualizar(compras, 'linha-1', { Quantidade: '3', Valor: '5' }, m.opcoes);
    envelhecer();
    const [entrada] = await listarPendentes();
    await descartarEntradasDePlanilha([entrada!.seq]);
    expect(await listarPendentes()).toEqual([]);
    const lida = (await lerPlanilha(compras, m.opcoes)).linhas[0]!;
    expect(lida.valores).toMatchObject({ Quantidade: '2', Valor: '1' });
  });

  it('entrada de outro tipo também é descartada, sem mexer no cache', async () => {
    const m = mundo();
    m.estado.rede = false;
    await anexar(compras, { Item: 'Leite' }, m.opcoes);
    const [entrada] = await listarPendentes();
    await descartarEntradasDePlanilha([entrada!.seq, 9999]);
    expect(await listarPendentes()).toEqual([]);
  });
});
