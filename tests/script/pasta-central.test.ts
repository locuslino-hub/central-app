// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  AvisoDeOrganizacao,
  NOME_DA_PASTA_CENTRAL,
  NOME_DA_PASTA_DA_CASA,
  organizarPastaCentral,
  pastaCentral,
  type ServicoDeOrganizacao,
} from '../../script/pasta-central';

interface Item {
  id: string;
  nome: string;
  pais: string[];
  pasta: boolean;
  dono: boolean;
  lixeira: boolean;
}

/** Drive na memória: itens com pais, como o serviço do script enxerga. Só itens do dono e fora da lixeira entram nas buscas. */
function mundo() {
  const itens: Item[] = [];
  const movidos: string[] = [];
  const falhas = { dados: false, copias: false, moverId: '' as string };
  let proximo = 0;
  const novo = (nome: string, pais: string[], extra: Partial<Item> = {}): Item => {
    proximo += 1;
    const item: Item = { id: `item-${proximo}`, nome, pais, pasta: false, dono: true, lixeira: false, ...extra };
    itens.push(item);
    return item;
  };
  const servico: ServicoDeOrganizacao = {
    procurarPasta(nome, paiId) {
      return itens.filter((i) => i.pasta && i.nome === nome && i.pais.includes(paiId) && i.dono && !i.lixeira).map((i) => ({ id: i.id }));
    },
    criarPasta(nome, paiId) {
      return novo(nome, [paiId], { pasta: true }).id;
    },
    arquivoDeDados() {
      if (falhas.dados) throw new Error('Arquivo de dados na lixeira');
      const i = itens.find((x) => !x.pasta && x.nome === 'central-dados.json' && !x.lixeira);
      return i ? { id: i.id, pais: [...i.pais], doDono: i.dono } : null;
    },
    copias() {
      if (falhas.copias) throw new Error('Drive fora do ar');
      return itens
        .filter((i) => !i.pasta && i.nome.startsWith('central-dados-') && i.dono && !i.lixeira)
        .map((i) => ({ id: i.id, nome: i.nome, pais: [...i.pais] }));
    },
    mover(id, paiNovoId) {
      if (falhas.moverId === id) throw new Error('Falha ao mover');
      const i = itens.find((x) => x.id === id)!;
      i.pais = [paiNovoId];
      movidos.push(id);
    },
  };
  const linhas: string[] = [];
  const organizar = () => organizarPastaCentral(servico, (linha) => linhas.push(linha));
  const central = () => itens.find((i) => i.pasta && i.nome === NOME_DA_PASTA_CENTRAL && i.pais.includes('root'));
  return { itens, movidos, falhas, novo, servico, linhas, organizar, central };
}

const DADOS = 'central-dados.json';
const copia = (dia: string) => `central-dados-${dia}.json`;

describe('pastaCentral', () => {
  it('criar: false não cria e devolve null quando não existe', () => {
    const w = mundo();
    expect(pastaCentral(w.servico, { criar: false })).toBeNull();
    expect(w.itens).toHaveLength(0);
  });

  it('criar: true cria "Central" na raiz uma só vez e devolve sempre o mesmo id', () => {
    const w = mundo();
    const a = pastaCentral(w.servico, { criar: true });
    const b = pastaCentral(w.servico, { criar: true });
    expect(b).toBe(a);
    expect(w.itens).toHaveLength(1);
    expect(w.itens[0]).toMatchObject({ nome: 'Central', pais: ['root'], pasta: true });
  });

  it('criar: false acha a que já existe', () => {
    const w = mundo();
    const existente = w.novo('Central', ['root'], { pasta: true });
    expect(pastaCentral(w.servico, { criar: false })).toBe(existente.id);
  });

  it.each([true, false])('duas "Central" do dono: erro, não adivinha (criar: %s)', (criar) => {
    const w = mundo();
    w.novo('Central', ['root'], { pasta: true });
    w.novo('Central', ['root'], { pasta: true });
    expect(() => pastaCentral(w.servico, { criar })).toThrow(/mais de uma pasta Central/i);
    expect(w.itens).toHaveLength(2);
  });

  it('o nome da subpasta da Casa é fixo', () => {
    expect(NOME_DA_PASTA_DA_CASA).toBe('Casa (partilhada)');
  });
});

describe('organizarPastaCentral', () => {
  it('sem nada no Drive: cria Central e mais nada', () => {
    const w = mundo();
    w.organizar();
    expect(w.itens).toHaveLength(1);
    expect(w.central()).toBeDefined();
    expect(w.movidos).toEqual([]);
  });

  it('move o arquivo de dados da raiz para Central', () => {
    const w = mundo();
    const dados = w.novo(DADOS, ['root']);
    w.organizar();
    expect(dados.pais).toEqual([w.central()!.id]);
  });

  it('arquivo de dados que já está em Central não é movido', () => {
    const w = mundo();
    const central = w.novo('Central', ['root'], { pasta: true });
    w.novo(DADOS, [central.id]);
    w.organizar();
    expect(w.movidos).toEqual([]);
  });

  it('arquivo de dados de outro dono não é tocado, e o aviso aparece', () => {
    const w = mundo();
    const dados = w.novo(DADOS, ['root'], { dono: false });
    w.organizar();
    expect(dados.pais).toEqual(['root']);
    expect(w.linhas.join('\n')).toMatch(/dados.*(não é do dono|outro dono)/i);
  });

  it('move as cópias diárias do dono; ignora as que já estão em Central e nomes que não são cópia', () => {
    const w = mundo();
    const central = w.novo('Central', ['root'], { pasta: true });
    const a = w.novo(copia('2026-11-01'), ['root']);
    const b = w.novo(copia('2026-11-02'), ['root']);
    const ja = w.novo(copia('2026-11-03'), [central.id]);
    const alheia = w.novo(copia('2026-11-04'), ['root'], { dono: false });
    const outra = w.novo('central-dados-velho.txt', ['root']);
    w.organizar();
    expect(a.pais).toEqual([central.id]);
    expect(b.pais).toEqual([central.id]);
    expect(ja.pais).toEqual([central.id]);
    expect(alheia.pais).toEqual(['root']);
    expect(outra.pais).toEqual(['root']);
    expect(w.movidos.sort()).toEqual([a.id, b.id].sort());
  });

  it('move "Casa (partilhada)" da raiz para dentro de Central quando só existe a da raiz (a planilha segue dentro dela)', () => {
    const w = mundo();
    const casa = w.novo(NOME_DA_PASTA_DA_CASA, ['root'], { pasta: true });
    const planilha = w.novo('Compras', [casa.id]);
    w.organizar();
    expect(casa.pais).toEqual([w.central()!.id]);
    expect(planilha.pais).toEqual([casa.id]);
  });

  it('Casa existe na raiz e dentro de Central: não mexe e avisa', () => {
    const w = mundo();
    const central = w.novo('Central', ['root'], { pasta: true });
    const daRaiz = w.novo(NOME_DA_PASTA_DA_CASA, ['root'], { pasta: true });
    const de_dentro = w.novo(NOME_DA_PASTA_DA_CASA, [central.id], { pasta: true });
    w.organizar();
    expect(daRaiz.pais).toEqual(['root']);
    expect(de_dentro.pais).toEqual([central.id]);
    expect(w.linhas.join('\n')).toMatch(/aviso/i);
  });

  it('duas Casa na raiz: não mexe e avisa', () => {
    const w = mundo();
    const a = w.novo(NOME_DA_PASTA_DA_CASA, ['root'], { pasta: true });
    const b = w.novo(NOME_DA_PASTA_DA_CASA, ['root'], { pasta: true });
    w.organizar();
    expect(a.pais).toEqual(['root']);
    expect(b.pais).toEqual(['root']);
    expect(w.linhas.join('\n')).toMatch(/aviso/i);
  });

  it('Casa só dentro de Central (já organizado): nada a fazer', () => {
    const w = mundo();
    const central = w.novo('Central', ['root'], { pasta: true });
    w.novo(NOME_DA_PASTA_DA_CASA, [central.id], { pasta: true });
    w.novo(DADOS, [central.id]);
    w.organizar();
    expect(w.movidos).toEqual([]);
    expect(w.itens).toHaveLength(3);
  });

  it('é idempotente: rodar de novo não move nem cria nada', () => {
    const w = mundo();
    w.novo(DADOS, ['root']);
    w.novo(copia('2026-11-01'), ['root']);
    w.novo(NOME_DA_PASTA_DA_CASA, ['root'], { pasta: true });
    w.organizar();
    const fotografia = JSON.stringify(w.itens);
    const movidosAntes = w.movidos.length;
    w.organizar();
    expect(JSON.stringify(w.itens)).toBe(fotografia);
    expect(w.movidos).toHaveLength(movidosAntes);
  });

  it('nada é apagado nem vai para a lixeira', () => {
    const w = mundo();
    w.novo(DADOS, ['root']);
    w.novo(copia('2026-11-01'), ['root']);
    w.novo(NOME_DA_PASTA_DA_CASA, ['root'], { pasta: true });
    w.organizar();
    expect(w.itens).toHaveLength(4);
    expect(w.itens.some((i) => i.lixeira)).toBe(false);
  });

  it('duas "Central": registra o erro, não mexe em nada e não lança', () => {
    const w = mundo();
    w.novo('Central', ['root'], { pasta: true });
    w.novo('Central', ['root'], { pasta: true });
    const dados = w.novo(DADOS, ['root']);
    expect(() => w.organizar()).not.toThrow();
    expect(dados.pais).toEqual(['root']);
    expect(w.movidos).toEqual([]);
    expect(w.linhas.join('\n')).toMatch(/central/i);
  });

  it('falha no arquivo de dados não impede cópias nem a Casa, e não lança', () => {
    const w = mundo();
    w.falhas.dados = true;
    const c = w.novo(copia('2026-11-01'), ['root']);
    const casa = w.novo(NOME_DA_PASTA_DA_CASA, ['root'], { pasta: true });
    expect(() => w.organizar()).not.toThrow();
    expect(c.pais).toEqual([w.central()!.id]);
    expect(casa.pais).toEqual([w.central()!.id]);
  });

  it('falha ao listar as cópias não impede o arquivo de dados nem a Casa', () => {
    const w = mundo();
    w.falhas.copias = true;
    const dados = w.novo(DADOS, ['root']);
    const casa = w.novo(NOME_DA_PASTA_DA_CASA, ['root'], { pasta: true });
    expect(() => w.organizar()).not.toThrow();
    expect(dados.pais).toEqual([w.central()!.id]);
    expect(casa.pais).toEqual([w.central()!.id]);
  });

  it('falha ao mover uma cópia não impede as outras', () => {
    const w = mundo();
    const a = w.novo(copia('2026-11-01'), ['root']);
    const b = w.novo(copia('2026-11-02'), ['root']);
    w.falhas.moverId = a.id;
    expect(() => w.organizar()).not.toThrow();
    expect(a.pais).toEqual(['root']);
    expect(b.pais).toEqual([w.central()!.id]);
  });

  it('o registro conta o que fez, sem ids nem nomes de arquivo', () => {
    const w = mundo();
    w.novo(DADOS, ['root']);
    w.novo(copia('2026-11-01'), ['root']);
    w.novo(copia('2026-11-02'), ['root']);
    w.novo(NOME_DA_PASTA_DA_CASA, ['root'], { pasta: true });
    w.organizar();
    const texto = w.linhas.join('\n');
    expect(texto).toMatch(/2 cópias/);
    expect(texto).not.toMatch(/item-\d/);
    expect(texto).not.toMatch(/2026-11/);
    expect(texto.length).toBeGreaterThan(0);
  });

  describe('códigos fixos nos avisos', () => {
    const avisos = (w: ReturnType<typeof mundo>) => w.linhas.filter((l) => /AVISO/.test(l));

    it('central_duplicada', () => {
      const w = mundo();
      w.novo('Central', ['root'], { pasta: true });
      w.novo('Central', ['root'], { pasta: true });
      w.organizar();
      expect(avisos(w)).toEqual([expect.stringMatching(/AVISO central_duplicada:/)]);
    });

    it.each(['dados_na_lixeira', 'dados_duplicados'] as const)('%s vem do erro do arquivo de dados', (codigo) => {
      const w = mundo();
      w.servico.arquivoDeDados = () => {
        throw new AvisoDeOrganizacao(codigo, 'qualquer texto');
      };
      w.organizar();
      expect(avisos(w)).toEqual([expect.stringMatching(new RegExp(`AVISO ${codigo}:`))]);
    });

    it('dados_de_outro_dono', () => {
      const w = mundo();
      w.novo(DADOS, ['root'], { dono: false });
      w.organizar();
      expect(avisos(w)).toEqual([expect.stringMatching(/AVISO dados_de_outro_dono:/)]);
    });

    it('casa_duplicada: duas na raiz, ou duas dentro de Central', () => {
      const w = mundo();
      w.novo(NOME_DA_PASTA_DA_CASA, ['root'], { pasta: true });
      w.novo(NOME_DA_PASTA_DA_CASA, ['root'], { pasta: true });
      w.organizar();
      expect(avisos(w)).toEqual([expect.stringMatching(/AVISO casa_duplicada:/)]);

      const v = mundo();
      const central = v.novo('Central', ['root'], { pasta: true });
      v.novo(NOME_DA_PASTA_DA_CASA, [central.id], { pasta: true });
      v.novo(NOME_DA_PASTA_DA_CASA, [central.id], { pasta: true });
      v.organizar();
      expect(avisos(v)).toEqual([expect.stringMatching(/AVISO casa_duplicada:/)]);
    });

    it('casa_em_dois_lugares: mesmo com a de dentro vazia, não move o conteúdo', () => {
      const w = mundo();
      const central = w.novo('Central', ['root'], { pasta: true });
      const daRaiz = w.novo(NOME_DA_PASTA_DA_CASA, ['root'], { pasta: true });
      w.novo(NOME_DA_PASTA_DA_CASA, [central.id], { pasta: true });
      const planilha = w.novo('Compras', [daRaiz.id]);
      w.organizar();
      expect(avisos(w)).toEqual([expect.stringMatching(/AVISO casa_em_dois_lugares:/)]);
      expect(planilha.pais).toEqual([daRaiz.id]);
      expect(w.movidos).toEqual([]);
    });

    it('erro qualquer do Drive vira erro_no_drive, só com o nome do erro (sem texto)', () => {
      const w = mundo();
      w.falhas.dados = true;
      w.organizar();
      const [aviso] = avisos(w);
      expect(aviso).toMatch(/AVISO erro_no_drive:/);
      expect(aviso).not.toMatch(/lixeira/);
    });

    it('todo aviso começa com AVISO e um código em minúsculas com sublinhado', () => {
      const w = mundo();
      w.novo('Central', ['root'], { pasta: true });
      w.novo('Central', ['root'], { pasta: true });
      w.organizar();
      for (const l of avisos(w)) expect(l).toMatch(/^Central: AVISO [a-z_]+: /);
    });
  });
});
