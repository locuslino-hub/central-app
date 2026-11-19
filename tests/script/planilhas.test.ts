// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { tratar, type Ambiente } from '../../script/api';
import {
  CABECALHOS,
  NOME_DA_PASTA_DA_CASA,
  PedidoDePlanilhaInvalido,
  SemAcesso,
  TAMANHO_MAXIMO_DO_VALOR,
  anexarLinha,
  atualizarLinha,
  criarPlanilha,
  lerLinhas,
  formatoDe,
  iguais,
  numeroDe,
  type CelulaNova,
  type Formato,
  type ServicoDePlanilhas,
} from '../../script/planilhas';
import { armazemNaMemoria } from '../apoio/armazem';

const CODIGO = 'codigo-ficticio-de-teste-0123456789abcdef';

type Celula = CelulaNova & { linha: number };

interface Pasta {
  id: string;
  nome: string;
  pai: string;
  dono: boolean;
}
interface Arquivo {
  id: string;
  pai: string;
  dono: boolean;
  lixeira: boolean;
  planilha: boolean;
  linhas: string[][];
}

/** Drive + Planilhas na memória, como o serviço do script enxerga. `linhas[0]` é o cabeçalho. */
function mundo() {
  const pastas: Pasta[] = [];
  const arquivos: Arquivo[] = [];
  const chamadas: string[] = [];
  const escritas: { dentroDaTrava: boolean; celulas: Celula[] }[] = [];
  const leituras: { dentroDaTrava: boolean }[] = [];
  const estado = {
    dentroDaTrava: false,
    aoLer: null as null | ((n: number) => void),
    lidas: 0,
    falhaDeLeitura: null as null | Error,
    aoLerCelula: null as null | (() => void),
    inspecoes: 0,
    /** A n-ésima chamada de `inspecionar` responde false (arquivo foi para a lixeira no meio). */
    recusarInspecaoNa: 0,
    /** Como a planilha mostra o que foi gravado (reformata número e data, como o Sheets). */
    reformatar: ((valor: string, _formato: Formato) => valor) as (valor: string, formato: Formato) => string,
  };
  let proximo = 0;
  const criadas: { colunasDeData: number[] }[] = [];

  const servico: ServicoDePlanilhas = {
    procurarPasta(nome, paiId) {
      chamadas.push('procurarPasta');
      return pastas.filter((p) => p.nome === nome && p.pai === paiId && p.dono).map((p) => ({ id: p.id }));
    },
    criarPasta(nome, paiId) {
      chamadas.push('criarPasta');
      proximo += 1;
      pastas.push({ id: `pasta-${proximo}`, nome, pai: paiId, dono: true });
      return `pasta-${proximo}`;
    },
    criarPlanilha(nome, paiId, cabecalho, colunaOculta, colunasDeData) {
      chamadas.push('criarPlanilha');
      criadas.push({ colunasDeData: [...colunasDeData] });
      proximo += 1;
      arquivos.push({ id: `plan-${proximo}`, pai: paiId, dono: true, lixeira: false, planilha: true, linhas: [[...cabecalho]] });
      void nome;
      void colunaOculta;
      return `plan-${proximo}`;
    },
    inspecionar(planilhaId, paiId) {
      chamadas.push('inspecionar');
      estado.inspecoes += 1;
      if (estado.inspecoes === estado.recusarInspecaoNa) return false;
      const a = arquivos.find((x) => x.id === planilhaId);
      return !!a && a.dono && !a.lixeira && a.planilha && a.pai === paiId;
    },
    lerValores(planilhaId) {
      chamadas.push('lerValores');
      leituras.push({ dentroDaTrava: estado.dentroDaTrava });
      if (estado.falhaDeLeitura) throw estado.falhaDeLeitura;
      const a = arquivos.find((x) => x.id === planilhaId)!;
      const copia = a.linhas.map((l) => [...l]);
      estado.lidas += 1;
      estado.aoLer?.(estado.lidas);
      return copia;
    },
    lerCelula(planilhaId, linha, coluna) {
      chamadas.push('lerCelula');
      estado.aoLerCelula?.();
      const a = arquivos.find((x) => x.id === planilhaId)!;
      return a.linhas[linha - 1]?.[coluna - 1] ?? '';
    },
    escreverLinhaNova(planilhaId, linha, celulas) {
      chamadas.push('escreverLinhaNova');
      const a = arquivos.find((x) => x.id === planilhaId)!;
      const existente = a.linhas[linha - 1];
      if (existente && existente.some((v) => v.trim() !== '')) throw new Error('Linha já tem conteúdo');
      escritas.push({ dentroDaTrava: estado.dentroDaTrava, celulas: celulas.map((c) => ({ ...c, linha })) });
      while (a.linhas.length < linha - 1) a.linhas.push([]);
      const mostrado = celulas.map((c) => estado.reformatar(c.valor, c.formato));
      a.linhas[linha - 1] = mostrado;
      return [...mostrado];
    },
    escreverCelulas(planilhaId, linha, celulas) {
      chamadas.push('escreverCelulas');
      escritas.push({ dentroDaTrava: estado.dentroDaTrava, celulas: celulas.map((c) => ({ ...c, linha })) });
      const a = arquivos.find((x) => x.id === planilhaId)!;
      const l = a.linhas[linha - 1]!;
      return celulas.map((c) => {
        while (l.length < c.coluna) l.push('');
        l[c.coluna - 1] = estado.reformatar(c.valor, c.formato);
        return l[c.coluna - 1]!;
      });
    },
    escreverIds(planilhaId, coluna, ids) {
      chamadas.push('escreverIds');
      escritas.push({ dentroDaTrava: estado.dentroDaTrava, celulas: ids.map(({ linha, id }) => ({ linha, coluna, valor: id, formato: 'texto' as const })) });
      const a = arquivos.find((x) => x.id === planilhaId)!;
      for (const { linha, id } of ids) {
        const l = a.linhas[linha - 1]!;
        while (l.length < coluna) l.push('');
        l[coluna - 1] = id;
      }
    },
  };
  const comTrava = <T>(fazer: () => T): T => {
    estado.dentroDaTrava = true;
    try {
      return fazer();
    } finally {
      estado.dentroDaTrava = false;
    }
  };
  let ids = 0;
  const gerarId = () => `id-novo-${(ids += 1)}`;
  const contexto = { servico, comTrava, gerarId };

  /** Pasta que já existe (do dono) ou criada agora, com esse pai. */
  const pastaOuCria = (nome: string, pai: string) => {
    const p = pastas.find((x) => x.nome === nome && x.pai === pai);
    if (p) return p.id;
    proximo += 1;
    pastas.push({ id: `pasta-${proximo}`, nome, pai, dono: true });
    return `pasta-${proximo}`;
  };
  const central = () => pastaOuCria('Central', 'root');
  /** "Casa (partilhada)" DENTRO de "Central". */
  const casa = () => pastaOuCria(NOME_DA_PASTA_DA_CASA, central());
  /** Planilha pronta DENTRO da pasta Casa. */
  const planilha = (linhas: string[][], extra: Partial<Arquivo> = {}) => {
    proximo += 1;
    const a: Arquivo = { id: `plan-${proximo}`, pai: casa(), dono: true, lixeira: false, planilha: true, linhas, ...extra };
    arquivos.push(a);
    return a;
  };
  return { pastas, arquivos, chamadas, escritas, leituras, estado, servico, contexto, planilha, casa, central, pastaOuCria, criadas };
}

const COMPRAS = [...CABECALHOS.compras];
/** Linhas de compras: Item, Quantidade, Valor, Link, Prioridade, Comprado?, Quem pôs, Data, Observação, id. */
const linhaDeCompras = (item: string, id: string, extra: Partial<Record<string, string>> = {}) => {
  const base: Record<string, string> = { Item: item, Quantidade: '1', Valor: '', Link: '', Prioridade: '', 'Comprado?': '', 'Quem pôs': 'Marina', Data: '', id, ...extra };
  return COMPRAS.map((c) => base[c] ?? '');
};

describe('criarPlanilha', () => {
  it('criarPlanilha cria na pasta Casa (partilhada) com cabeçalhos do modelo', () => {
    const w = mundo();
    const r = criarPlanilha({ nome: 'Lista de Compras Semanais', modelo: 'compras' }, w.contexto);
    const central = w.pastas.find((p) => p.nome === 'Central')!;
    const pasta = w.pastas.find((p) => p.nome === 'Casa (partilhada)')!;
    expect(central.pai).toBe('root');
    expect(pasta.pai).toBe(central.id);
    const arquivo = w.arquivos[0]!;
    expect(r).toEqual({ planilhaId: arquivo.id });
    expect(arquivo.pai).toBe(pasta.id);
    expect(arquivo.linhas[0]).toEqual(['Item', 'Quantidade', 'Valor', 'Link', 'Prioridade', 'Comprado?', 'Quem pôs', 'Data', 'Observação', 'id']);
  });

  it.each([
    ['consumo', ['Data', 'Leitura', 'Unidade', 'Consumo desde a anterior', 'Observação', 'id']],
    ['financeiro', ['Data', 'Descrição', 'Categoria', 'Tipo', 'Valor', 'Quem', 'Observação', 'id']],
  ] as const)('modelo %s tem os cabeçalhos do plano e a coluna id por último', (modelo, cabecalho) => {
    const w = mundo();
    criarPlanilha({ nome: 'Consumo de Água', modelo }, w.contexto);
    expect(w.arquivos[0]!.linhas[0]).toEqual(cabecalho);
  });

  // Revisão da Tarefa 13 (achado 4): a coluna Data nasce no formato aaaa-mm-dd, para a leitura não depender do idioma da planilha.
  it.each([
    ['compras', [8]],
    ['consumo', [1]],
    ['financeiro', [1]],
  ] as const)('modelo %s: a coluna Data é criada em formato aaaa-mm-dd (posição %j)', (modelo, colunas) => {
    const w = mundo();
    criarPlanilha({ nome: 'Planilha', modelo }, w.contexto);
    expect(w.criadas).toEqual([{ colunasDeData: colunas }]);
  });

  it('usa a pasta Casa que já existe, sem criar outra', () => {
    const w = mundo();
    const casa = w.casa();
    criarPlanilha({ nome: 'Financeiro', modelo: 'financeiro' }, w.contexto);
    expect(w.pastas).toHaveLength(2); // Central e Casa (partilhada): nenhuma pasta nova
    expect(w.arquivos[0]!.pai).toBe(casa);
    expect(w.chamadas).not.toContain('criarPasta');
  });

  it('Central existe sem a subpasta: cria só a Casa (partilhada), dentro dela', () => {
    const w = mundo();
    const central = w.central();
    criarPlanilha({ nome: 'Financeiro', modelo: 'financeiro' }, w.contexto);
    expect(w.pastas.filter((p) => p.nome === 'Central')).toHaveLength(1);
    const casa = w.pastas.find((p) => p.nome === NOME_DA_PASTA_DA_CASA)!;
    expect(casa.pai).toBe(central);
    expect(w.arquivos[0]!.pai).toBe(casa.id);
  });

  it('Casa (partilhada) só na raiz (antes da organização), sem Central: erro organizar_pastas; não cria Central, Casa nem planilha', () => {
    const w = mundo();
    const velha = w.pastaOuCria(NOME_DA_PASTA_DA_CASA, 'root');
    expect(criarPlanilha({ nome: 'Financeiro', modelo: 'financeiro' }, w.contexto)).toEqual({ erro: 'organizar_pastas' });
    expect(w.pastas).toEqual([{ id: velha, nome: NOME_DA_PASTA_DA_CASA, pai: 'root', dono: true }]);
    expect(w.arquivos).toHaveLength(0);
    expect(w.chamadas).not.toContain('criarPasta');
    expect(w.chamadas).not.toContain('criarPlanilha');
  });

  it('Casa na raiz e Central já existente (sem Casa dentro): também organizar_pastas, sem criar uma segunda Casa', () => {
    const w = mundo();
    w.central();
    w.pastaOuCria(NOME_DA_PASTA_DA_CASA, 'root');
    expect(criarPlanilha({ nome: 'Financeiro', modelo: 'financeiro' }, w.contexto)).toEqual({ erro: 'organizar_pastas' });
    expect(w.pastas.filter((p) => p.nome === NOME_DA_PASTA_DA_CASA)).toHaveLength(1);
    expect(w.arquivos).toHaveLength(0);
  });

  it('Casa dentro de Central e outra na raiz: usa a de dentro (a da raiz é problema da organização, que avisa)', () => {
    const w = mundo();
    w.pastaOuCria(NOME_DA_PASTA_DA_CASA, 'root');
    const dentro = w.casa();
    expect(criarPlanilha({ nome: 'Financeiro', modelo: 'financeiro' }, w.contexto)).toEqual({ planilhaId: expect.any(String) });
    expect(w.arquivos[0]!.pai).toBe(dentro);
  });

  it('organizar_pastas chega ao app como dados (não como erro do script)', () => {
    const w = mundo();
    w.pastaOuCria(NOME_DA_PASTA_DA_CASA, 'root');
    const amb: Ambiente = {
      lerCodigo: () => CODIGO,
      armazem: armazemNaMemoria(),
      planilhas: () => w.servico,
      novoId: w.contexto.gerarId,
    };
    expect(tratar({ codigo: CODIGO, acao: 'criarPlanilha', dados: { nome: 'Financeiro', modelo: 'financeiro' } }, amb)).toEqual({
      ok: true,
      dados: { erro: 'organizar_pastas' },
    });
  });

  it('duas pastas Casa (partilhada) dentro de Central: lança erro e não cria nada', () => {
    const w = mundo();
    const central = w.central();
    w.servico.criarPasta(NOME_DA_PASTA_DA_CASA, central);
    w.servico.criarPasta(NOME_DA_PASTA_DA_CASA, central);
    expect(() => criarPlanilha({ nome: 'Financeiro', modelo: 'financeiro' }, w.contexto)).toThrow(/mais de uma/i);
    expect(w.arquivos).toHaveLength(0);
  });

  it('duas pastas Central: lança erro e não cria nada', () => {
    const w = mundo();
    w.servico.criarPasta('Central', 'root');
    w.servico.criarPasta('Central', 'root');
    expect(() => criarPlanilha({ nome: 'Financeiro', modelo: 'financeiro' }, w.contexto)).toThrow(/mais de uma pasta Central/i);
    expect(w.arquivos).toHaveLength(0);
    expect(w.pastas).toHaveLength(2);
  });

  it('cria dentro da trava: dois pedidos juntos não fazem duas pastas', () => {
    const w = mundo();
    let dentro = false;
    const original = w.servico.criarPasta;
    w.servico.criarPasta = (n, p) => {
      dentro = w.estado.dentroDaTrava;
      return original(n, p);
    };
    criarPlanilha({ nome: 'Financeiro', modelo: 'financeiro' }, w.contexto);
    expect(dentro).toBe(true);
  });

  it.each([
    ['nome vazio', { nome: '', modelo: 'compras' }],
    ['nome só com espaços', { nome: '   ', modelo: 'compras' }],
    ['nome com aspa simples', { nome: "x' or name contains '", modelo: 'compras' }],
    ['nome com barra invertida', { nome: 'a\\b', modelo: 'compras' }],
    ['nome com quebra de linha', { nome: 'a\nb', modelo: 'compras' }],
    ['nome longo demais', { nome: 'a'.repeat(101), modelo: 'compras' }],
    ['nome que não é texto', { nome: 7, modelo: 'compras' }],
    ['modelo desconhecido', { nome: 'Lista', modelo: 'outro' }],
    ['modelo herdado do objeto', { nome: 'Lista', modelo: 'constructor' }],
    ['sem modelo', { nome: 'Lista' }],
  ])('pedido inválido (%s) lança PedidoDePlanilhaInvalido e não toca o Drive', (_n, dados) => {
    const w = mundo();
    expect(() => criarPlanilha(dados, w.contexto)).toThrow(PedidoDePlanilhaInvalido);
    expect(w.chamadas).toHaveLength(0);
  });

  it('pedido que não é objeto lança PedidoDePlanilhaInvalido', () => {
    expect(() => criarPlanilha(null, mundo().contexto)).toThrow(PedidoDePlanilhaInvalido);
  });

  it('aceita nome com acento e parênteses', () => {
    const w = mundo();
    expect(() => criarPlanilha({ nome: 'Consumo de Água (casa)', modelo: 'consumo' }, w.contexto)).not.toThrow();
  });
});

describe('lerLinhas', () => {
  it('lerLinhas devolve valores por nome mesmo com colunas trocadas de lugar', () => {
    const w = mundo();
    // Colunas em outra ordem, com uma extra do usuário no meio.
    const p = w.planilha([
      ['id', 'Quem pôs', 'Notas da Renata', 'Item', 'Quantidade'],
      ['a1', 'Marina', 'trazer sacola', 'Leite', '2'],
    ]);
    expect(lerLinhas({ planilhaId: p.id }, w.contexto)).toEqual({
      cabecalho: ['id', 'Quem pôs', 'Notas da Renata', 'Item', 'Quantidade'],
      linhas: [{ id: 'a1', valores: { 'Quem pôs': 'Marina', 'Notas da Renata': 'trazer sacola', Item: 'Leite', Quantidade: '2' } }],
    });
  });

  it('lerLinhas dá id a linha sem id e grava só a célula do id, como texto', () => {
    const w = mundo();
    const p = w.planilha([COMPRAS, linhaDeCompras('Pão', ''), linhaDeCompras('Café', 'c9')]);
    const r = lerLinhas({ planilhaId: p.id }, w.contexto);
    expect(r).toMatchObject({ linhas: [{ id: 'id-novo-1', valores: { Item: 'Pão' } }, { id: 'c9', valores: { Item: 'Café' } }] });
    expect(p.linhas[1]![9]).toBe('id-novo-1');
    expect(w.escritas).toHaveLength(1);
    expect(w.escritas[0]!.celulas).toEqual([{ linha: 2, coluna: 10, valor: 'id-novo-1', formato: 'texto' }]);
    // Segunda leitura: o id ficou, nada novo é gravado.
    expect(lerLinhas({ planilhaId: p.id }, w.contexto)).toMatchObject({ linhas: [{ id: 'id-novo-1' }, { id: 'c9' }] });
    expect(w.escritas).toHaveLength(1);
  });

  it('o id novo é dado dentro da trava, relendo a planilha antes de gravar', () => {
    const w = mundo();
    const p = w.planilha([COMPRAS, linhaDeCompras('Pão', '')]);
    // Entre a primeira leitura e a trava, outro aparelho já deu um id à linha.
    w.estado.aoLer = (n) => {
      if (n === 1) p.linhas[1]![9] = 'de-outro';
    };
    const r = lerLinhas({ planilhaId: p.id }, w.contexto);
    expect(r).toMatchObject({ linhas: [{ id: 'de-outro' }] });
    expect(p.linhas[1]![9]).toBe('de-outro');
    expect(w.escritas).toHaveLength(0);
  });

  it('ignora linhas totalmente vazias (mesmo com id sozinho) e não dá id a elas', () => {
    const w = mundo();
    const p = w.planilha([COMPRAS, linhaDeCompras('', '', { 'Quem pôs': '', Quantidade: '' }), ['', '', '', '', '', '', '', '', ''], linhaDeCompras('', 'so-id', { 'Quem pôs': '', Quantidade: '' }), linhaDeCompras('Ovos', 'e1')]);
    const r = lerLinhas({ planilhaId: p.id }, w.contexto) as { linhas: { id: string }[] };
    expect(r.linhas.map((l) => l.id)).toEqual(['e1']);
    expect(w.escritas).toHaveLength(0);
  });

  it('id repetido (linha copiada à mão): a cópia recebe id novo', () => {
    const w = mundo();
    const p = w.planilha([COMPRAS, linhaDeCompras('Leite', 'x1'), linhaDeCompras('Leite', 'x1')]);
    const r = lerLinhas({ planilhaId: p.id }, w.contexto) as { linhas: { id: string }[] };
    expect(r.linhas.map((l) => l.id)).toEqual(['x1', 'id-novo-1']);
  });

  it('linha curta (menos células que o cabeçalho) é lida com vazio nas que faltam', () => {
    const w = mundo();
    const p = w.planilha([COMPRAS, ['Leite', '2']]);
    const r = lerLinhas({ planilhaId: p.id }, w.contexto) as { linhas: { id: string; valores: Record<string, string> }[] };
    expect(r.linhas[0]!.valores.Valor).toBe('');
    expect(r.linhas[0]!.valores.Item).toBe('Leite');
    expect(p.linhas[1]![9]).toBe('id-novo-1');
  });

  it('sem coluna id no cabeçalho: coluna_faltando e nada é gravado', () => {
    const w = mundo();
    const p = w.planilha([['Item', 'Quantidade'], ['Leite', '2']]);
    expect(lerLinhas({ planilhaId: p.id }, w.contexto)).toEqual({ erro: 'coluna_faltando', colunas: ['id'] });
    expect(w.escritas).toHaveLength(0);
  });

  it('planilha vazia (sem cabeçalho): coluna_faltando', () => {
    const w = mundo();
    const p = w.planilha([]);
    expect(lerLinhas({ planilhaId: p.id }, w.contexto)).toEqual({ erro: 'coluna_faltando', colunas: ['id'] });
  });

  it('cabeçalho __proto__ não contamina o resultado', () => {
    const w = mundo();
    const p = w.planilha([['__proto__', 'Item', 'id'], ['x', 'Leite', 'a1']]);
    const r = lerLinhas({ planilhaId: p.id }, w.contexto) as { linhas: { valores: Record<string, string> }[] };
    expect(Object.getPrototypeOf(r.linhas[0]!.valores)).toBe(Object.prototype);
    expect(r.linhas[0]!.valores.Item).toBe('Leite');
  });

  it('planilha acima do teto de linhas lança erro, não devolve pela metade', () => {
    const w = mundo();
    const muitas = Array.from({ length: 5001 }, (_, i) => linhaDeCompras(`Item ${i}`, `i${i}`));
    const p = w.planilha([COMPRAS, ...muitas]);
    expect(() => lerLinhas({ planilhaId: p.id }, w.contexto)).toThrow(/grande demais/i);
    expect(w.escritas).toHaveLength(0);
  });

  it('exatamente no teto de linhas ainda lê', () => {
    const w = mundo();
    const p = w.planilha([COMPRAS, ...Array.from({ length: 5000 }, (_, i) => linhaDeCompras(`Item ${i}`, `i${i}`))]);
    expect((lerLinhas({ planilhaId: p.id }, w.contexto) as { linhas: unknown[] }).linhas).toHaveLength(5000);
  });

  it('planilha com colunas demais lança erro', () => {
    const w = mundo();
    const p = w.planilha([Array.from({ length: 31 }, (_, i) => `C${i}`)]);
    expect(() => lerLinhas({ planilhaId: p.id }, w.contexto)).toThrow(/grande demais/i);
  });

  it('SemAcesso do serviço vira { erro: sem_acesso }', () => {
    const w = mundo();
    const p = w.planilha([COMPRAS]);
    w.estado.falhaDeLeitura = new SemAcesso();
    expect(lerLinhas({ planilhaId: p.id }, w.contexto)).toEqual({ erro: 'sem_acesso' });
  });

  it('erro transitório do Google sobe como erro (vira interno na API)', () => {
    const w = mundo();
    const p = w.planilha([COMPRAS]);
    w.estado.falhaDeLeitura = new Error('Service Spreadsheets failed');
    expect(() => lerLinhas({ planilhaId: p.id }, w.contexto)).toThrow();
  });
});

describe('anexarLinha', () => {
  const novo = { Item: 'Leite', Quantidade: '2', 'Quem pôs': 'Marina' };

  it('anexa no fim com o id, só nas colunas pedidas, e preserva coluna extra do usuário (vazia)', () => {
    const w = mundo();
    const p = w.planilha([['Item', 'Notas da Renata', 'Quantidade', 'Quem pôs', 'id'], ['Pão', 'integral', '1', 'Renata', 'p1']]);
    expect(anexarLinha({ planilhaId: p.id, idDaLinha: 'n1', valores: novo }, w.contexto)).toEqual({ ok: true });
    expect(p.linhas).toHaveLength(3);
    expect(p.linhas[1]).toEqual(['Pão', 'integral', '1', 'Renata', 'p1']);
    expect(p.linhas[2]).toEqual(['Leite', '', '2', 'Marina', 'n1']);
  });

  it('anexarLinha é idempotente: o mesmo idDaLinha não duplica', () => {
    const w = mundo();
    const p = w.planilha([COMPRAS]);
    expect(anexarLinha({ planilhaId: p.id, idDaLinha: 'n1', valores: novo }, w.contexto)).toEqual({ ok: true });
    expect(anexarLinha({ planilhaId: p.id, idDaLinha: 'n1', valores: novo }, w.contexto)).toEqual({ ok: true });
    expect(p.linhas).toHaveLength(2);
    expect(w.escritas).toHaveLength(1);
  });

  it('anexa depois da última linha mesmo se outra pessoa acabou de anexar (relê dentro da trava)', () => {
    const w = mundo();
    const p = w.planilha([COMPRAS]);
    // Quem anexar primeiro, a leitura do anexo seguinte já vê a linha dele.
    anexarLinha({ planilhaId: p.id, idDaLinha: 'a', valores: { Item: 'Pão' } }, w.contexto);
    anexarLinha({ planilhaId: p.id, idDaLinha: 'b', valores: { Item: 'Café' } }, w.contexto);
    expect(p.linhas.map((l) => l[0])).toEqual(['Item', 'Pão', 'Café']);
    expect(w.leituras.every((l) => l.dentroDaTrava)).toBe(true);
    expect(w.escritas.every((e) => e.dentroDaTrava)).toBe(true);
  });

  it('anexarLinha com coluna obrigatória faltando devolve coluna_faltando e não grava', () => {
    const w = mundo();
    const p = w.planilha([['Item', 'Quantidade', 'id'], ['Pão', '1', 'p1']]);
    const r = anexarLinha({ planilhaId: p.id, idDaLinha: 'n1', valores: { Item: 'Leite', 'Quem pôs': 'Marina', Link: 'x' } }, w.contexto);
    expect(r).toEqual({ erro: 'coluna_faltando', colunas: ['Quem pôs', 'Link'] });
    expect(w.escritas).toHaveLength(0);
    expect(p.linhas).toHaveLength(2);
  });

  it('sem a coluna id: coluna_faltando [id] e não grava', () => {
    const w = mundo();
    const p = w.planilha([['Item'], ['Pão']]);
    expect(anexarLinha({ planilhaId: p.id, idDaLinha: 'n1', valores: { Item: 'Leite' } }, w.contexto)).toEqual({ erro: 'coluna_faltando', colunas: ['id'] });
    expect(w.escritas).toHaveLength(0);
  });

  it('nunca apaga nada: só acrescenta células', () => {
    const w = mundo();
    const p = w.planilha([COMPRAS, linhaDeCompras('Pão', 'p1')]);
    const antes = JSON.stringify(p.linhas);
    anexarLinha({ planilhaId: p.id, idDaLinha: 'n1', valores: novo }, w.contexto);
    expect(JSON.stringify(p.linhas.slice(0, 2))).toBe(antes);
    expect(w.escritas[0]!.celulas.every((c) => c.linha === 3)).toBe(true);
  });

  it('valor com = é gravado como texto; número puro com + ou - vira número', () => {
    const w = mundo();
    const p = w.planilha([COMPRAS]);
    anexarLinha({ planilhaId: p.id, idDaLinha: 'n1', valores: { Item: '=HYPERLINK("http://x","a")', Quantidade: '+1', Valor: '-5', Link: '@SUM(A1)', Prioridade: 'alta' } }, w.contexto);
    const celulas = w.escritas[0]!.celulas;
    const porColuna = (nome: string) => celulas.find((c) => c.coluna === COMPRAS.indexOf(nome) + 1)!;
    expect(porColuna('Item').formato).toBe('texto');
    expect(porColuna('Quantidade')).toMatchObject({ formato: 'texto', valor: '+1' }); // coluna de texto: nunca vira número
    expect(porColuna('Valor')).toMatchObject({ formato: 'numero', valor: '-5' });
    expect(porColuna('Link').formato).toBe('texto');
    expect(porColuna('Prioridade').formato).toBe('texto');
    expect(porColuna('id').formato).toBe('texto');
    // O texto chega inteiro, sem apóstrofo nem outra mudança.
    expect(p.linhas[1]![0]).toBe('=HYPERLINK("http://x","a")');
  });

  it('valor com tabulação ou retorno de carro na frente também vira texto', () => {
    const w = mundo();
    const p = w.planilha([COMPRAS]);
    anexarLinha({ planilhaId: p.id, idDaLinha: 'n1', valores: { Item: '\t=1+1', Link: '\r=1+1' } }, w.contexto);
    expect(w.escritas[0]!.celulas.filter((c) => c.coluna <= 4 && c.valor).every((c) => c.formato === 'texto')).toBe(true);
  });

  it.each([
    ['valores que não é objeto', { valores: 'x' }],
    ['valores lista', { valores: ['a'] }],
    ['valores vazio', { valores: {} }],
    ['valor que não é texto', { valores: { Item: 3 } }],
    ['valor longo demais', { valores: { Item: 'a'.repeat(TAMANHO_MAXIMO_DO_VALOR + 1) } }],
    ['coluna id nos valores', { valores: { Item: 'a', id: 'x' } }],
    ['nome de coluna vazio', { valores: { '': 'a' } }],
    ['colunas demais', { valores: Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`C${i}`, 'a'])) }],
    ['idDaLinha com espaço', { idDaLinha: 'a b' }],
    ['idDaLinha vazio', { idDaLinha: '' }],
    ['idDaLinha que não é texto', { idDaLinha: 4 }],
    ['planilhaId que não é texto', { planilhaId: 4 }],
  ])('pedido inválido (%s) lança PedidoDePlanilhaInvalido e não toca o Drive', (_n, extra) => {
    const w = mundo();
    const dados = { planilhaId: 'plan-1', idDaLinha: 'n1', valores: { Item: 'a' }, ...extra };
    expect(() => anexarLinha(dados, w.contexto)).toThrow(PedidoDePlanilhaInvalido);
    expect(w.chamadas).toHaveLength(0);
  });

  it('aceita valor exatamente no limite de tamanho', () => {
    const w = mundo();
    const p = w.planilha([COMPRAS]);
    expect(anexarLinha({ planilhaId: p.id, idDaLinha: 'n1', valores: { Item: 'a'.repeat(TAMANHO_MAXIMO_DO_VALOR) } }, w.contexto)).toEqual({ ok: true });
  });
});

describe('atualizarLinha', () => {
  it('atualizarLinha acha a linha por id mesmo depois de linhas inseridas acima', () => {
    const w = mundo();
    const p = w.planilha([COMPRAS, linhaDeCompras('Leite', 'l1'), linhaDeCompras('Pão', 'p1')]);
    // Alguém insere duas linhas no topo (o id da linha de Pão passa da linha 3 para a 5).
    p.linhas.splice(1, 0, linhaDeCompras('Café', 'c1'), linhaDeCompras('Chá', 't1'));
    const r = atualizarLinha({ planilhaId: p.id, idDaLinha: 'p1', valores: { 'Comprado?': 'Sim' } }, w.contexto);
    expect(r).toMatchObject({ ok: true });
    expect(p.linhas[4]![5]).toBe('Sim');
    expect(p.linhas[4]![0]).toBe('Pão');
    // As outras linhas ficaram como estavam.
    expect(p.linhas[1]![5]).toBe('');
    expect(p.linhas[3]![5]).toBe('');
    expect(w.escritas[0]!.celulas).toEqual([{ linha: 5, coluna: 6, valor: 'Sim', formato: 'livre' }]);
  });

  it('atualizarLinha devolve linha_nao_achada se apagaram', () => {
    const w = mundo();
    const p = w.planilha([COMPRAS, linhaDeCompras('Leite', 'l1')]);
    p.linhas.splice(1, 1);
    expect(atualizarLinha({ planilhaId: p.id, idDaLinha: 'l1', valores: { 'Comprado?': 'Sim' } }, w.contexto)).toEqual({ erro: 'linha_nao_achada' });
    expect(w.escritas).toHaveLength(0);
  });

  it('atualizarLinha devolve conflito quando o valor mudou desde a leitura, sem gravar nada', () => {
    const w = mundo();
    const p = w.planilha([COMPRAS, linhaDeCompras('Leite', 'l1', { Quantidade: '2' })]);
    // O app leu Quantidade "2"; a Renata mudou para "3" na planilha.
    p.linhas[1]![1] = '3';
    const r = atualizarLinha(
      { planilhaId: p.id, idDaLinha: 'l1', valores: { Quantidade: '4', 'Comprado?': 'Sim' }, antes: { Quantidade: '2', 'Comprado?': '' } },
      w.contexto,
    );
    expect(r).toEqual({ conflito: true });
    expect(w.escritas).toHaveLength(0);
    expect(p.linhas[1]![1]).toBe('3');
    expect(p.linhas[1]![5]).toBe('');
  });

  it('sem conflito quando o valor atual ainda é o que o app leu', () => {
    const w = mundo();
    const p = w.planilha([COMPRAS, linhaDeCompras('Leite', 'l1', { Quantidade: '2' })]);
    const r = atualizarLinha({ planilhaId: p.id, idDaLinha: 'l1', valores: { Quantidade: '4' }, antes: { Quantidade: '2' } }, w.contexto);
    expect(r).toEqual({ ok: true, valores: { Quantidade: '4' } });
    expect(p.linhas[1]![1]).toBe('4');
  });

  it('coluna alterada que já está com o valor novo não é conflito (repetir depois de resposta perdida)', () => {
    const w = mundo();
    const p = w.planilha([COMPRAS, linhaDeCompras('Leite', 'l1', { 'Comprado?': 'Sim' })]);
    const dados = { planilhaId: p.id, idDaLinha: 'l1', valores: { 'Comprado?': 'Sim' }, antes: { 'Comprado?': '' } };
    expect(atualizarLinha(dados, w.contexto)).toEqual({ ok: true, valores: { 'Comprado?': 'Sim' } });
    expect(w.escritas).toHaveLength(0);
  });

  it('coluna que o app não alterou não entra na conferência', () => {
    const w = mundo();
    const p = w.planilha([COMPRAS, linhaDeCompras('Leite', 'l1', { Quantidade: '2' })]);
    p.linhas[1]![1] = '3'; // mudou, mas o app só altera Comprado?
    const r = atualizarLinha({ planilhaId: p.id, idDaLinha: 'l1', valores: { 'Comprado?': 'Sim' }, antes: { Quantidade: '2', 'Comprado?': '' } }, w.contexto);
    expect(r).toMatchObject({ ok: true });
    expect(p.linhas[1]![1]).toBe('3');
  });

  it('sem `antes` grava direto (a última escrita vale)', () => {
    const w = mundo();
    const p = w.planilha([COMPRAS, linhaDeCompras('Leite', 'l1', { Quantidade: '2' })]);
    p.linhas[1]![1] = '3';
    expect(atualizarLinha({ planilhaId: p.id, idDaLinha: 'l1', valores: { Quantidade: '4' } }, w.contexto)).toMatchObject({ ok: true });
    expect(p.linhas[1]![1]).toBe('4');
  });

  it('relê dentro da trava antes de gravar', () => {
    const w = mundo();
    const p = w.planilha([COMPRAS, linhaDeCompras('Leite', 'l1')]);
    atualizarLinha({ planilhaId: p.id, idDaLinha: 'l1', valores: { 'Comprado?': 'Sim' } }, w.contexto);
    expect(w.leituras.length).toBeGreaterThan(0);
    expect(w.leituras.every((l) => l.dentroDaTrava)).toBe(true);
    expect(w.escritas.every((e) => e.dentroDaTrava)).toBe(true);
  });

  it('coluna que não existe mais: coluna_faltando e não grava', () => {
    const w = mundo();
    const p = w.planilha([['Item', 'id'], ['Leite', 'l1']]);
    expect(atualizarLinha({ planilhaId: p.id, idDaLinha: 'l1', valores: { 'Comprado?': 'Sim' } }, w.contexto)).toEqual({ erro: 'coluna_faltando', colunas: ['Comprado?'] });
    expect(w.escritas).toHaveLength(0);
  });

  it('valor com = é gravado como texto', () => {
    const w = mundo();
    const p = w.planilha([COMPRAS, linhaDeCompras('Leite', 'l1')]);
    atualizarLinha({ planilhaId: p.id, idDaLinha: 'l1', valores: { Link: '=IMPORTXML("x")' } }, w.contexto);
    expect(w.escritas[0]!.celulas[0]).toMatchObject({ valor: '=IMPORTXML("x")', formato: 'texto' });
  });

  it.each([
    ['antes que não é objeto', { antes: 'x' }],
    ['antes com valor que não é texto', { antes: { Item: 1 } }],
    ['antes com valor longo demais', { antes: { Item: 'a'.repeat(TAMANHO_MAXIMO_DO_VALOR + 1) } }],
    ['valores vazio', { valores: {} }],
    ['coluna id nos valores', { valores: { id: 'x' } }],
  ])('pedido inválido (%s) lança PedidoDePlanilhaInvalido e não toca o Drive', (_n, extra) => {
    const w = mundo();
    const dados = { planilhaId: 'plan-1', idDaLinha: 'l1', valores: { Item: 'a' }, ...extra };
    expect(() => atualizarLinha(dados, w.contexto)).toThrow(PedidoDePlanilhaInvalido);
    expect(w.chamadas).toHaveLength(0);
  });
});

describe('planilha fora da pasta é recusada', () => {
  const foraDaPasta = { erro: 'fora_da_pasta' };

  function cenarios() {
    const w = mundo();
    const dentro = w.planilha([COMPRAS, linhaDeCompras('Leite', 'l1')]);
    const deOutroDono = w.planilha([COMPRAS, linhaDeCompras('Leite', 'l1')], { dono: false });
    const naLixeira = w.planilha([COMPRAS, linhaDeCompras('Leite', 'l1')], { lixeira: true });
    const outraPasta = w.planilha([COMPRAS, linhaDeCompras('Leite', 'l1')], { pai: 'pasta-de-outra-coisa' });
    const naoPlanilha = w.planilha([COMPRAS, linhaDeCompras('Leite', 'l1')], { planilha: false });
    const noRaiz = w.planilha([COMPRAS, linhaDeCompras('Leite', 'l1')], { pai: 'root' });
    // Direto em "Central", sem estar dentro de "Casa (partilhada)": também fora.
    const naCentral = w.planilha([COMPRAS, linhaDeCompras('Leite', 'l1')], { pai: w.central() });
    return { w, dentro, recusadas: { deOutroDono, naLixeira, outraPasta, naoPlanilha, noRaiz, naCentral } };
  }

  it.each(['deOutroDono', 'naLixeira', 'outraPasta', 'naoPlanilha', 'noRaiz', 'naCentral'] as const)('lerLinhas recusa: %s', (chave) => {
    const { w, recusadas } = cenarios();
    expect(lerLinhas({ planilhaId: recusadas[chave].id }, w.contexto)).toEqual(foraDaPasta);
    expect(w.chamadas).not.toContain('lerValores');
  });

  it.each(['deOutroDono', 'naLixeira', 'outraPasta', 'naoPlanilha', 'noRaiz', 'naCentral'] as const)('anexarLinha recusa: %s', (chave) => {
    const { w, recusadas } = cenarios();
    expect(anexarLinha({ planilhaId: recusadas[chave].id, idDaLinha: 'n1', valores: { Item: 'a' } }, w.contexto)).toEqual(foraDaPasta);
    expect(w.escritas).toHaveLength(0);
  });

  it.each(['deOutroDono', 'naLixeira', 'outraPasta', 'naoPlanilha', 'noRaiz', 'naCentral'] as const)('atualizarLinha recusa: %s', (chave) => {
    const { w, recusadas } = cenarios();
    expect(atualizarLinha({ planilhaId: recusadas[chave].id, idDaLinha: 'l1', valores: { Item: 'a' } }, w.contexto)).toEqual(foraDaPasta);
    expect(w.escritas).toHaveLength(0);
  });

  it.each(['../x', 'a b', "x' or 1=1", '', 'a'.repeat(101), 'plan/1'])('id malformado (%j) é recusado sem tocar o Drive', (id) => {
    const w = mundo();
    expect(lerLinhas({ planilhaId: id }, w.contexto)).toEqual(foraDaPasta);
    expect(anexarLinha({ planilhaId: id, idDaLinha: 'n1', valores: { Item: 'a' } }, w.contexto)).toEqual(foraDaPasta);
    expect(atualizarLinha({ planilhaId: id, idDaLinha: 'l1', valores: { Item: 'a' } }, w.contexto)).toEqual(foraDaPasta);
    expect(w.chamadas).toHaveLength(0);
  });

  it('id inexistente e planilha de outro dono dão a mesma resposta (não vaza se existe)', () => {
    const { w, recusadas } = cenarios();
    const a = lerLinhas({ planilhaId: recusadas.deOutroDono.id }, w.contexto);
    const b = lerLinhas({ planilhaId: 'nao-existe-1' }, w.contexto);
    expect(a).toEqual(b);
  });

  it('sem a pasta Casa no Drive: fora_da_pasta, e ler não cria a pasta', () => {
    const w = mundo();
    expect(lerLinhas({ planilhaId: 'plan-1' }, w.contexto)).toEqual(foraDaPasta);
    expect(w.pastas).toHaveLength(0);
  });

  it('duas pastas Casa dentro de Central: lança erro (o script não adivinha qual vale)', () => {
    const w = mundo();
    const central = w.central();
    w.servico.criarPasta(NOME_DA_PASTA_DA_CASA, central);
    w.servico.criarPasta(NOME_DA_PASTA_DA_CASA, central);
    expect(() => lerLinhas({ planilhaId: 'plan-1' }, w.contexto)).toThrow(/mais de uma/i);
  });

  it('duas pastas Central: lança erro, também ao ler', () => {
    const w = mundo();
    w.servico.criarPasta('Central', 'root');
    w.servico.criarPasta('Central', 'root');
    expect(() => lerLinhas({ planilhaId: 'plan-1' }, w.contexto)).toThrow(/mais de uma pasta Central/i);
  });

  it('a Casa solta na raiz (antes da organização) ainda não vale: fora_da_pasta, sem mexer no Drive', () => {
    const w = mundo();
    const velha = w.pastaOuCria(NOME_DA_PASTA_DA_CASA, 'root');
    const a = { id: 'plan-velha', pai: velha, dono: true, lixeira: false, planilha: true, linhas: [COMPRAS, linhaDeCompras('Leite', 'l1')] };
    w.arquivos.push(a);
    expect(lerLinhas({ planilhaId: a.id }, w.contexto)).toEqual({ erro: 'fora_da_pasta' });
    expect(w.pastas).toHaveLength(1);
  });

  it('a planilha dentro da pasta passa', () => {
    const { w, dentro } = cenarios();
    expect(lerLinhas({ planilhaId: dentro.id }, w.contexto)).toMatchObject({ linhas: [{ id: 'l1' }] });
  });
});

describe('ações de planilha na API', () => {
  function montar() {
    const w = mundo();
    const amb: Ambiente = {
      lerCodigo: () => CODIGO,
      armazem: armazemNaMemoria(),
      planilhas: () => w.servico,
      novoId: w.contexto.gerarId,
    };
    return { w, amb };
  }

  it('ação sem código de acesso não toca no Drive', () => {
    const { w, amb } = montar();
    const p = w.planilha([COMPRAS, linhaDeCompras('Leite', 'l1')]);
    for (const [acao, dados] of [
      ['criarPlanilha', { nome: 'Financeiro', modelo: 'financeiro' }],
      ['lerLinhas', { planilhaId: p.id }],
      ['anexarLinha', { planilhaId: p.id, idDaLinha: 'n1', valores: { Item: 'a' } }],
      ['atualizarLinha', { planilhaId: p.id, idDaLinha: 'l1', valores: { Item: 'a' } }],
    ] as const) {
      expect(tratar({ codigo: 'errado', acao, dados }, amb)).toEqual({ ok: false, erro: 'codigo-invalido' });
      expect(tratar({ acao, dados }, amb)).toEqual({ ok: false, erro: 'codigo-invalido' });
    }
    expect(w.chamadas).toHaveLength(0);
  });

  it('criarPlanilha e lerLinhas respondem pela API', () => {
    const { w, amb } = montar();
    const criada = tratar({ codigo: CODIGO, acao: 'criarPlanilha', dados: { nome: 'Financeiro', modelo: 'financeiro' } }, amb);
    expect(criada).toEqual({ ok: true, dados: { planilhaId: w.arquivos[0]!.id } });
    const lida = tratar({ codigo: CODIGO, acao: 'lerLinhas', dados: { planilhaId: w.arquivos[0]!.id } }, amb);
    expect(lida).toEqual({ ok: true, dados: { cabecalho: [...CABECALHOS.financeiro], linhas: [] } });
  });

  it('anexarLinha e atualizarLinha pela API; coluna faltando e conflito voltam como dados, não como erro do script', () => {
    const { w, amb } = montar();
    const p = w.planilha([COMPRAS, linhaDeCompras('Leite', 'l1', { Quantidade: '2' })]);
    expect(tratar({ codigo: CODIGO, acao: 'anexarLinha', dados: { planilhaId: p.id, idDaLinha: 'n1', valores: { Item: 'Pão' } } }, amb)).toEqual({ ok: true, dados: { ok: true } });
    expect(tratar({ codigo: CODIGO, acao: 'anexarLinha', dados: { planilhaId: p.id, idDaLinha: 'n2', valores: { Nada: 'x' } } }, amb)).toEqual({
      ok: true,
      dados: { erro: 'coluna_faltando', colunas: ['Nada'] },
    });
    p.linhas[1]![1] = '9';
    expect(tratar({ codigo: CODIGO, acao: 'atualizarLinha', dados: { planilhaId: p.id, idDaLinha: 'l1', valores: { Quantidade: '4' }, antes: { Quantidade: '2' } } }, amb)).toEqual({
      ok: true,
      dados: { conflito: true },
    });
  });

  it('pedido inválido e erro do Google viram interno', () => {
    const { w, amb } = montar();
    expect(tratar({ codigo: CODIGO, acao: 'criarPlanilha', dados: { nome: '', modelo: 'compras' } }, amb)).toEqual({ ok: false, erro: 'interno' });
    const p = w.planilha([COMPRAS]);
    w.estado.falhaDeLeitura = new Error('Service Spreadsheets failed while accessing document with id 1AbC');
    expect(tratar({ codigo: CODIGO, acao: 'lerLinhas', dados: { planilhaId: p.id } }, amb)).toEqual({ ok: false, erro: 'interno' });
  });

  it('sem o serviço de planilhas, dá interno', () => {
    const amb: Ambiente = { lerCodigo: () => CODIGO, armazem: armazemNaMemoria() };
    expect(tratar({ codigo: CODIGO, acao: 'lerLinhas', dados: { planilhaId: 'x' } }, amb)).toEqual({ ok: false, erro: 'interno' });
  });

  it('trava ocupada vira ocupado', () => {
    const { w, amb } = montar();
    const p = w.planilha([COMPRAS]);
    amb.armazem = armazemNaMemoria({ ocupado: true });
    expect(tratar({ codigo: CODIGO, acao: 'anexarLinha', dados: { planilhaId: p.id, idDaLinha: 'n1', valores: { Item: 'a' } } }, amb)).toEqual({ ok: false, erro: 'ocupado' });
  });
});

describe('números, fórmulas e formato de gravação', () => {
  it.each([
    ['5', 'numero', '5'],
    ['-5', 'numero', '-5'],
    ['+5', 'numero', '5'],
    ['-12.50', 'numero', '-12.5'],
    ['-12,50', 'numero', '-12.5'],
    ['0,5', 'numero', '0.5'],
    ['1.250,75', 'numero', '1250.75'],
    ['1,250.75', 'numero', '1250.75'],
    ['-1.250,75', 'numero', '-1250.75'],
    ['-5+3', 'texto', '-5+3'],
    ['=SOMA(A1)', 'texto', '=SOMA(A1)'],
    ['+SOMA(A1)', 'texto', '+SOMA(A1)'],
    ['@SUM(A1)', 'texto', '@SUM(A1)'],
    ['-', 'texto', '-'],
    ['--5', 'texto', '--5'],
    ['\t5', 'texto', '\t5'],
    ['007', 'texto', '007'],
    ['1234567890123456', 'livre', '1234567890123456'],
    ['Leite integral', 'livre', 'Leite integral'],
    ['2026-11-17', 'livre', '2026-11-17'],
    ['', 'livre', ''],
  ] as const)('formatoDe(%j) -> %s', (entrada, formato, valor) => {
    expect(formatoDe(entrada)).toEqual({ formato, valor });
  });

  it('numeroDe não confunde texto com número', () => {
    expect(numeroDe('1e5')).toBeNull();
    expect(numeroDe('5 reais')).toBeNull();
    expect(numeroDe('1.2.3')).toBeNull();
    expect(numeroDe('Infinity')).toBeNull();
  });

  it('anexarLinha grava -5 e -12.50 como número e -5+3 como texto', () => {
    const w = mundo();
    const p = w.planilha([COMPRAS]);
    anexarLinha({ planilhaId: p.id, idDaLinha: 'n1', valores: { Item: '=SOMA(A1)', Quantidade: '-5', Valor: '-12.50', Link: '-5+3', Prioridade: '+SOMA' } }, w.contexto);
    const celulas = w.escritas[0]!.celulas;
    const de = (nome: string) => celulas.find((c) => c.coluna === COMPRAS.indexOf(nome) + 1)!;
    expect(de('Quantidade')).toMatchObject({ formato: 'texto', valor: '-5' });
    expect(de('Valor')).toMatchObject({ formato: 'numero', valor: '-12.5' });
    expect(de('Link')).toMatchObject({ formato: 'texto', valor: '-5+3' });
    expect(de('Item').formato).toBe('texto');
    expect(de('Prioridade').formato).toBe('texto');
    expect(de('id').formato).toBe('texto');
  });

  it('colunas de texto (Quantidade, Item...) gravam "1/2", "2-3" e "1,250" como texto; Data e Valor seguem livres/numéricas', () => {
    const w = mundo();
    const p = w.planilha([COMPRAS]);
    anexarLinha({ planilhaId: p.id, idDaLinha: 'n1', valores: { Item: '1,250', Quantidade: '1/2', Link: '2-3', Data: '2026-11-17', Valor: '5,50' } }, w.contexto);
    const de = (nome: string) => w.escritas[0]!.celulas.find((c) => c.coluna === COMPRAS.indexOf(nome) + 1)!;
    expect(de('Item')).toMatchObject({ formato: 'texto', valor: '1,250' });
    expect(de('Quantidade')).toMatchObject({ formato: 'texto', valor: '1/2' });
    expect(de('Link')).toMatchObject({ formato: 'texto', valor: '2-3' });
    expect(de('Data').formato).toBe('livre');
    expect(de('Valor')).toMatchObject({ formato: 'numero', valor: '5.5' });
    expect(formatoDe('2-3', 'Quantidade')).toEqual({ formato: 'texto', valor: '2-3' });
    expect(formatoDe('5,5', 'Valor')).toEqual({ formato: 'numero', valor: '5.5' });
    expect(formatoDe('1,250', 'Leitura')).toMatchObject({ formato: 'numero' });
  });

  it('atualizarLinha usa o mesmo critério: número vira número, fórmula vira texto', () => {
    const w = mundo();
    const p = w.planilha([COMPRAS, linhaDeCompras('Leite', 'l1')]);
    atualizarLinha({ planilhaId: p.id, idDaLinha: 'l1', valores: { Valor: '-12.50', Link: '=IMPORTXML("x")', Prioridade: '-5+3' } }, w.contexto);
    const por = (nome: string) => w.escritas[0]!.celulas.find((c) => c.coluna === COMPRAS.indexOf(nome) + 1)!;
    expect(por('Valor')).toMatchObject({ formato: 'numero', valor: '-12.5' });
    expect(por('Link').formato).toBe('texto');
    expect(por('Prioridade').formato).toBe('texto');
  });
});

describe('iguais (comparação do que a planilha mostra)', () => {
  it.each([
    ['5.50', '5,5'],
    ['5,50', '5.5'],
    ['1.250,75', '1250.75'],
    ['1,250.75', '1250.75'],
    ['1.250', '1250'],
    ['1.250.000', '1250000'],
    ['€1,50', '1.5'],
    ['1,50 €', '1.5'],
    ['R$ 12,00', '12'],
    ['2026-11-17', '17/11/2026'],
    ['2026-11-07', '7/11/2026'],
    ['17.11.2026', '2026-11-17'],
    ['TRUE', 'true'],
    ['  Sim ', 'sim'],
    ['TRUE', 'VERDADEIRO'],
    ['true', 'SIM'],
    ['VERDADEIRO', 'sim'],
    ['FALSE', 'FALSO'],
    ['false', 'NÃO'],
    ['FALSO', 'nao'],
    ['Lista  de   compras', 'lista de compras'],
  ])('%j = %j', (a, b) => {
    expect(iguais(a, b)).toBe(true);
    expect(iguais(b, a)).toBe(true);
  });

  it.each([
    ['5.50', '5.51'],
    ['1.250,75', '1250.76'],
    ['2026-11-17', '18/11/2026'],
    ['2026-11-07', '11/07/2026'],
    ['TRUE', 'FALSE'],
    ['VERDADEIRO', 'FALSO'],
    ['SIM', 'NÃO'],
    ['TRUE', 'NÃO'],
    ['', 'x'],
    ['abc', 'abd'],
  ])('%j ≠ %j', (a, b) => {
    expect(iguais(a, b)).toBe(false);
  });
});

describe('atualizarLinha com valores que a planilha reformata', () => {
  const financeiro = [...CABECALHOS.financeiro];
  const linhaFin = (id: string, extra: Record<string, string>) => {
    const base: Record<string, string> = { Data: '17/11/2026', Descrição: 'Mercado', Categoria: 'Casa', Tipo: 'Saída', Valor: '', Quem: 'Marina', id, ...extra };
    return financeiro.map((c) => base[c] ?? '');
  };

  it('valor numérico que a planilha mostra de outro jeito não dá conflito e o ok traz o que ficou na tela', () => {
    const w = mundo();
    const p = w.planilha([financeiro, linhaFin('f1', { Valor: '1250,75' })]);
    w.estado.reformatar = (v, f) => (f === 'numero' ? v.replace('.', ',') : v);
    // O app leu "1250.75" (outro formato); a planilha mostra "1250,75".
    const r = atualizarLinha({ planilhaId: p.id, idDaLinha: 'f1', valores: { Valor: '99.5', Quem: 'Renata' }, antes: { Valor: '1250.75', Quem: 'Marina' } }, w.contexto);
    expect(r).toEqual({ ok: true, valores: { Valor: '99,5', Quem: 'Renata' } });
    expect(p.linhas[1]![4]).toBe('99,5');
  });

  it('repetir o mesmo pedido (número reformatado) é idempotente: não grava de novo', () => {
    const w = mundo();
    const p = w.planilha([financeiro, linhaFin('f1', { Valor: '5,5' })]);
    const r = atualizarLinha({ planilhaId: p.id, idDaLinha: 'f1', valores: { Valor: '5.50' }, antes: { Valor: '2' } }, w.contexto);
    expect(r).toEqual({ ok: true, valores: { Valor: '5,5' } });
    expect(w.escritas).toHaveLength(0);
  });

  it('número mudado de verdade por outra pessoa continua sendo conflito', () => {
    const w = mundo();
    const p = w.planilha([financeiro, linhaFin('f1', { Valor: '7,25' })]);
    expect(atualizarLinha({ planilhaId: p.id, idDaLinha: 'f1', valores: { Valor: '9' }, antes: { Valor: '5.5' } }, w.contexto)).toEqual({ conflito: true });
    expect(w.escritas).toHaveLength(0);
  });

  it('data em outro formato: sem conflito; ok traz a data como a planilha mostra', () => {
    const w = mundo();
    const p = w.planilha([financeiro, linhaFin('f1', {})]);
    w.estado.reformatar = (v) => v.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3/$2/$1');
    const r = atualizarLinha({ planilhaId: p.id, idDaLinha: 'f1', valores: { Data: '2026-11-18' }, antes: { Data: '2026-11-17' } }, w.contexto);
    expect(r).toEqual({ ok: true, valores: { Data: '18/11/2026' } });
  });

  it('data mudada por outra pessoa é conflito', () => {
    const w = mundo();
    const p = w.planilha([financeiro, linhaFin('f1', { Data: '20/11/2026' })]);
    expect(atualizarLinha({ planilhaId: p.id, idDaLinha: 'f1', valores: { Data: '2026-11-18' }, antes: { Data: '2026-11-17' } }, w.contexto)).toEqual({ conflito: true });
  });

  it('TRUE e true, e espaços nas pontas, não dão conflito nem gravação', () => {
    const w = mundo();
    const p = w.planilha([COMPRAS, linhaDeCompras('Leite', 'l1', { 'Comprado?': 'TRUE' })]);
    const r = atualizarLinha({ planilhaId: p.id, idDaLinha: 'l1', valores: { Prioridade: 'alta' }, antes: { Prioridade: '' } }, w.contexto);
    expect(r).toMatchObject({ ok: true });
    const r2 = atualizarLinha({ planilhaId: p.id, idDaLinha: 'l1', valores: { 'Comprado?': 'true ' } }, w.contexto);
    expect(r2).toMatchObject({ ok: true });
    expect(w.escritas).toHaveLength(1); // só a Prioridade foi gravada
  });

  it('valor de 2500 caracteres na planilha: o `antes` cortado em 2000 não dá conflito falso', () => {
    const w = mundo();
    const p = w.planilha([COMPRAS, linhaDeCompras('Leite', 'l1', { Link: 'x'.repeat(2500) })]);
    const lido = (lerLinhas({ planilhaId: p.id }, w.contexto) as { linhas: { valores: Record<string, string> }[] }).linhas[0]!.valores.Link!;
    expect(lido).toHaveLength(2000);
    expect(atualizarLinha({ planilhaId: p.id, idDaLinha: 'l1', valores: { Prioridade: 'alta', Link: 'novo' }, antes: { Link: lido } }, w.contexto)).toMatchObject({ ok: true });
  });
});

describe('teto, lote e releituras antes de gravar', () => {
  it('lerLinhas corta cada célula em 2000 caracteres', () => {
    const w = mundo();
    const p = w.planilha([COMPRAS, linhaDeCompras('Leite', 'l1', { Link: 'y'.repeat(2500) })]);
    const r = lerLinhas({ planilhaId: p.id }, w.contexto) as { linhas: { valores: Record<string, string> }[] };
    expect(r.linhas[0]!.valores.Link).toHaveLength(2000);
  });

  const cheia = (n: number) => [COMPRAS, ...Array.from({ length: n }, (_, i) => linhaDeCompras(`Item ${i}`, `i${i}`))];

  it('anexarLinha com 5000 linhas devolve planilha_cheia e não grava', () => {
    const w = mundo();
    const p = w.planilha(cheia(5000));
    expect(anexarLinha({ planilhaId: p.id, idDaLinha: 'novo', valores: { Item: 'a' } }, w.contexto)).toEqual({ erro: 'planilha_cheia' });
    expect(w.escritas).toHaveLength(0);
  });

  it('com 4999 linhas ainda anexa; repetir um id que já está na planilha cheia continua ok', () => {
    const w = mundo();
    const p = w.planilha(cheia(4999));
    expect(anexarLinha({ planilhaId: p.id, idDaLinha: 'novo', valores: { Item: 'a' } }, w.contexto)).toEqual({ ok: true });
    expect(anexarLinha({ planilhaId: p.id, idDaLinha: 'novo', valores: { Item: 'a' } }, w.contexto)).toEqual({ ok: true });
    expect(anexarLinha({ planilhaId: p.id, idDaLinha: 'outro', valores: { Item: 'b' } }, w.contexto)).toEqual({ erro: 'planilha_cheia' });
  });

  it('anexarLinha grava a linha inteira (id incluído) numa só escrita contígua', () => {
    const w = mundo();
    const p = w.planilha([['Item', 'Notas', 'Quantidade', 'id']]);
    anexarLinha({ planilhaId: p.id, idDaLinha: 'n1', valores: { Item: 'Leite', Quantidade: '2' } }, w.contexto);
    expect(w.chamadas.filter((c) => c.startsWith('escrever'))).toEqual(['escreverLinhaNova']);
    expect(w.escritas[0]!.celulas.map((c) => c.coluna)).toEqual([1, 2, 3, 4]);
    expect(p.linhas[1]).toEqual(['Leite', '', '2', 'n1']);
  });

  it('anexarLinha recusa gravar se alguém anexou na mesma linha depois da leitura', () => {
    const w = mundo();
    const p = w.planilha([COMPRAS]);
    w.estado.aoLer = () => {
      p.linhas.push(linhaDeCompras('Da Renata', 'r1'));
    };
    expect(() => anexarLinha({ planilhaId: p.id, idDaLinha: 'n1', valores: { Item: 'a' } }, w.contexto)).toThrow(/já tem conteúdo/);
    expect(p.linhas[1]![0]).toBe('Da Renata');
  });

  it('lerLinhas dá vários ids numa só escrita', () => {
    const w = mundo();
    const p = w.planilha([COMPRAS, linhaDeCompras('A', ''), linhaDeCompras('B', 'b1'), linhaDeCompras('C', '')]);
    lerLinhas({ planilhaId: p.id }, w.contexto);
    expect(w.chamadas.filter((c) => c.startsWith('escrever'))).toEqual(['escreverIds']);
    expect(w.escritas[0]!.celulas).toEqual([
      { linha: 2, coluna: 10, valor: 'id-novo-1', formato: 'texto' },
      { linha: 4, coluna: 10, valor: 'id-novo-2', formato: 'texto' },
    ]);
  });

  it('atualizarLinha relê o id da linha-alvo antes de gravar: se a linha andou, linha_nao_achada', () => {
    const w = mundo();
    const p = w.planilha([COMPRAS, linhaDeCompras('Leite', 'l1'), linhaDeCompras('Pão', 'p1')]);
    // Depois da leitura, alguém insere uma linha no topo: a linha 3 agora é a do Leite.
    w.estado.aoLerCelula = () => {
      p.linhas.splice(1, 0, linhaDeCompras('Café', 'c1'));
    };
    expect(atualizarLinha({ planilhaId: p.id, idDaLinha: 'p1', valores: { 'Comprado?': 'Sim' } }, w.contexto)).toEqual({ erro: 'linha_nao_achada' });
    expect(w.escritas).toHaveLength(0);
    expect(p.linhas.slice(1).every((l) => l[5] === '')).toBe(true);
  });

  it('repete a conferência da pasta dentro da trava nas ações que gravam', () => {
    // 1ª inspeção (fora da trava) passa; a 2ª (dentro da trava) já não: foi para a lixeira.
    const casos: ((w: ReturnType<typeof mundo>, id: string) => unknown)[] = [
      (w, id) => anexarLinha({ planilhaId: id, idDaLinha: 'n1', valores: { Item: 'a' } }, w.contexto),
      (w, id) => atualizarLinha({ planilhaId: id, idDaLinha: 'l1', valores: { Item: 'a' } }, w.contexto),
      (w, id) => lerLinhas({ planilhaId: id }, w.contexto),
    ];
    for (const agir of casos) {
      const w = mundo();
      const p = w.planilha([COMPRAS, linhaDeCompras('Leite', 'l1'), linhaDeCompras('Sem id', '')]);
      w.estado.recusarInspecaoNa = 2;
      expect(agir(w, p.id)).toEqual({ erro: 'fora_da_pasta' });
      expect(w.escritas).toHaveLength(0);
      expect(w.estado.inspecoes).toBe(2);
    }
  });

  it('SemAcesso vira sem_acesso também em anexarLinha e atualizarLinha', () => {
    const w = mundo();
    const p = w.planilha([COMPRAS, linhaDeCompras('Leite', 'l1')]);
    w.estado.falhaDeLeitura = new SemAcesso();
    expect(anexarLinha({ planilhaId: p.id, idDaLinha: 'n1', valores: { Item: 'a' } }, w.contexto)).toEqual({ erro: 'sem_acesso' });
    expect(atualizarLinha({ planilhaId: p.id, idDaLinha: 'l1', valores: { Item: 'a' } }, w.contexto)).toEqual({ erro: 'sem_acesso' });
    // A trava foi solta mesmo assim.
    expect(w.estado.dentroDaTrava).toBe(false);
  });
});

describe('linhas que não são dados (Total)', () => {
  const financeiro = [...CABECALHOS.financeiro];

  it('linha de Total sem a coluna-chave do modelo é ignorada e não ganha id', () => {
    const w = mundo();
    const p = w.planilha([
      financeiro,
      ['17/11/2026', 'Mercado', 'Casa', 'Saída', '20', 'Marina', '', ''],
      ['', 'Total', '', '', '20', '', '', ''],
    ]);
    const r = lerLinhas({ planilhaId: p.id }, w.contexto) as { linhas: { id: string; valores: Record<string, string> }[] };
    expect(r.linhas).toHaveLength(1);
    expect(r.linhas[0]!.valores.Descrição).toBe('Mercado');
    expect(w.escritas[0]!.celulas).toEqual([{ linha: 2, coluna: 8, valor: 'id-novo-1', formato: 'texto' }]);
    expect(p.linhas[2]![7]).toBe('');
  });

  it('compras: linha sem Item é ignorada; sem modelo reconhecido só vale a regra da linha vazia', () => {
    const w = mundo();
    const p = w.planilha([COMPRAS, linhaDeCompras('', '', { Quantidade: '3' })]);
    expect((lerLinhas({ planilhaId: p.id }, w.contexto) as { linhas: unknown[] }).linhas).toHaveLength(0);
    expect(w.escritas).toHaveLength(0);
    const w2 = mundo();
    const q = w2.planilha([['Notas', 'id'], ['algo', '']]);
    expect((lerLinhas({ planilhaId: q.id }, w2.contexto) as { linhas: unknown[] }).linhas).toHaveLength(1);
  });
});

describe('coluna Observação em todos os modelos (para o "desfeito")', () => {
  const comprasAntiga = CABECALHOS.compras.filter((c) => c !== 'Observação');
  const linhaAntiga = (item: string, id: string) => [item, '1', '', '', '', '', 'Marina', '', id];

  it('compras e financeiro têm Observação antes de id', () => {
    for (const modelo of ['compras', 'financeiro'] as const) {
      const c = CABECALHOS[modelo];
      expect(c[c.length - 2]).toBe('Observação');
      expect(c[c.length - 1]).toBe('id');
    }
  });

  it('atualizarLinha grava "desfeito" na Observação de uma linha de compras', () => {
    const w = mundo();
    const p = w.planilha([COMPRAS, linhaDeCompras('Leite', 'l1')]);
    expect(atualizarLinha({ planilhaId: p.id, idDaLinha: 'l1', valores: { Observação: 'desfeito' } }, w.contexto)).toEqual({ ok: true, valores: { Observação: 'desfeito' } });
  });

  it('planilha antiga de compras (sem Observação): "desfeito" dá coluna_faltando e nada é gravado', () => {
    const w = mundo();
    const p = w.planilha([comprasAntiga, linhaAntiga('Leite', 'l1')]);
    const antes = JSON.stringify(p.linhas);
    expect(atualizarLinha({ planilhaId: p.id, idDaLinha: 'l1', valores: { Observação: 'desfeito' } }, w.contexto)).toEqual({ erro: 'coluna_faltando', colunas: ['Observação'] });
    expect(JSON.stringify(p.linhas)).toBe(antes);
    expect(w.escritas).toHaveLength(0);
  });

  it('planilha antiga de compras ainda ignora a linha com Item vazio', () => {
    const w = mundo();
    const p = w.planilha([comprasAntiga, linhaAntiga('Leite', 'l1'), linhaAntiga('', '')]);
    const r = lerLinhas({ planilhaId: p.id }, w.contexto) as { linhas: unknown[] };
    expect(r.linhas).toHaveLength(1);
    expect(w.escritas).toHaveLength(0);
  });

  it('planilha antiga de financeiro ainda ignora a linha de Total', () => {
    const w = mundo();
    const antigo = CABECALHOS.financeiro.filter((c) => c !== 'Observação');
    const p = w.planilha([antigo, ['17/11/2026', 'Mercado', 'Casa', 'Saída', '20', 'Marina', ''], ['', 'Total', '', '', '20', '', '']]);
    expect((lerLinhas({ planilhaId: p.id }, w.contexto) as { linhas: unknown[] }).linhas).toHaveLength(1);
  });

  it('consumo continua exigindo Observação para ser reconhecido: sem ela, linha sem Data não é ignorada', () => {
    const w = mundo();
    const semObs = CABECALHOS.consumo.filter((c) => c !== 'Observação');
    const p = w.planilha([semObs, ['', '10', 'm³', '', '']]);
    expect((lerLinhas({ planilhaId: p.id }, w.contexto) as { linhas: unknown[] }).linhas).toHaveLength(1);
  });

  it('planilha de compras editada à mão com Data e colunas de consumo continua sendo compras', () => {
    const w = mundo();
    const mista = [...CABECALHOS.compras, 'Leitura', 'Unidade', 'Consumo desde a anterior'];
    const linha = (item: string, id: string) => mista.map((c) => (c === 'Item' ? item : c === 'id' ? id : ''));
    const p = w.planilha([mista, linha('Leite', 'l1'), linha('', 'l2')]);
    // Se fosse tomada por consumo, a chave seria Data (vazia) e as duas linhas seriam ignoradas.
    const r = lerLinhas({ planilhaId: p.id }, w.contexto) as { linhas: { id: string }[] };
    expect(r.linhas.map((l) => l.id)).toEqual(['l1']);
  });

  it('os três modelos continuam distintos', () => {
    const w = mundo();
    const p = w.planilha([[...CABECALHOS.consumo], ['', '10', 'm³', '', '', '']]);
    expect((lerLinhas({ planilhaId: p.id }, w.contexto) as { linhas: unknown[] }).linhas).toHaveLength(0);
  });
});
