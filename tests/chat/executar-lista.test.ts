// Voz de lista (V02, Tarefa 14): "põe leite e pão nas compras da semana" anexa uma linha por item na planilha da pasta de
// Lista, com cartão (Desfazer, Guardar como ideia). Quinta-feira, 2026-11-05, 12:20 em Lisboa. A planilha é de mentira
// (tests/apoio/planilhas-falsas.ts); o resto é o código de verdade. Só itens e nomes fictícios.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executarFrase } from '../../src/chat/executar';
import { usarIA } from '../../src/chat/interpretar';
import type { IA } from '../../src/ia/ia';
import { listar, listarPendentes, salvar, semear, semearPalavras } from '../../src/dados/loja';
import type { Pasta } from '../../src/dados/tipos';
import { CABECALHO_COMPRAS, falsoDasPlanilhas, reiniciarPlanilhas } from '../apoio/planilhas-falsas';

vi.mock('../../src/dados/planilhas', async (importar) => (await import('../apoio/planilhas-falsas')).comPlanilhasFalsas(await importar<typeof import('../../src/dados/planilhas')>()));

const SEM_IA: IA = { estado: () => 'ausente', interpretar: async () => null };
const planilhas = falsoDasPlanilhas();
const SEMANAIS = 'planilha-ficticia-semanais';
const DA_CASA = 'planilha-ficticia-casa';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 5, 12, 20));
  reiniciarPlanilhas();
  usarIA(SEM_IA);
  await semear();
  await semearPalavras();
});
afterEach(() => usarIA(SEM_IA));

function pastaDeLista(extra: Partial<Pasta> = {}) {
  return salvar('pastas', {
    id: 'pasta-casa-compras-semanais',
    salaId: 'sala-casa',
    tipo: 'lista',
    nome: 'Lista de Compras Semanais',
    ordem: 1,
    modelo: 'compras',
    planilhaId: SEMANAIS,
    ...extra,
  });
}

const pastaDaCasa = () => pastaDeLista({ id: 'pasta-casa-compras-casa', nome: 'Lista de Compras para Casa', ordem: 2, planilhaId: DA_CASA });

const compra = (item: string, extra: Record<string, string> = {}) => ({
  Item: item,
  Quantidade: '',
  Valor: '',
  Link: '',
  Prioridade: '',
  'Comprado?': '',
  'Quem pôs': 'Marina',
  Data: '2026-11-01',
  Observação: '',
  ...extra,
});
const novaPlanilha = (id: string, linhas: Record<string, string>[] = []) => planilhas.planilha(id, linhas, CABECALHO_COMPRAS);
const anexos = () => planilhas.pedidos.filter((p) => p.acao === 'anexarLinha');
const itens = (id: string) => planilhas.linhas(id).map((l) => l.valores['Item']);

describe('frase de lista (Pode falar)', () => {
  it('"põe leite e pão nas compras da semana" anexa 2 linhas e mostra cartão com Desfazer', async () => {
    await pastaDeLista();
    novaPlanilha(SEMANAIS);

    const resultado = await executarFrase('põe leite e pão nas compras da semana');

    const linhas = planilhas.linhas(SEMANAIS);
    expect(linhas).toHaveLength(2);
    expect(linhas.map((l) => l.valores['Item'])).toEqual(['leite', 'pão']);
    expect(linhas[0]!.valores).toMatchObject({ Data: '2026-11-05', 'Quem pôs': 'Central' });
    expect(resultado.titulo).toBe('2 itens guardados');
    expect(resultado.detalhe).toContain('“leite”');
    expect(resultado.detalhe).toContain('“pão”');
    expect(resultado.detalhe).toContain('Lista de Compras Semanais');
    expect(resultado.ver).toBe('#/sala/sala-casa/pasta/pasta-casa-compras-semanais');
    expect(await listar('ideias')).toEqual([]);
    expect(await listar('tarefas')).toEqual([]);

    // Desfazer nunca apaga linha: marca "desfeito" nas duas.
    await resultado.desfazer();
    expect(planilhas.linhas(SEMANAIS)).toHaveLength(2);
    expect(planilhas.linhas(SEMANAIS).map((l) => l.valores['Observação'])).toEqual(['desfeito', 'desfeito']);
  });

  it('um item só: título no singular', async () => {
    await pastaDeLista();
    novaPlanilha(SEMANAIS);

    const resultado = await executarFrase('põe leite nas compras da semana');

    expect(resultado.titulo).toBe('Item guardado');
    expect(itens(SEMANAIS)).toEqual(['leite']);
  });

  it('"compras para casa" vai para a lista da casa, não para a semanal', async () => {
    await pastaDeLista();
    await pastaDaCasa();
    novaPlanilha(SEMANAIS);
    novaPlanilha(DA_CASA);

    await executarFrase('adicione fita isolante e pilhas na lista da casa');

    expect(itens(DA_CASA)).toEqual(['fita isolante', 'pilhas']);
    expect(planilhas.linhas(SEMANAIS)).toEqual([]);
  });

  it('nomes das pastas padrão: "lista de compras da semana" e "para casa" vão para a lista certa, também de dentro de outra pasta', async () => {
    await pastaDeLista();
    await pastaDaCasa();
    novaPlanilha(SEMANAIS);
    novaPlanilha(DA_CASA);

    await executarFrase('coloca detergente na lista de compras da semana', { pastaAtual: 'pasta-casa-compras-casa' });
    await executarFrase('põe pilhas na lista de compras para casa', { pastaAtual: 'pasta-casa-compras-semanais' });

    expect(itens(SEMANAIS)).toEqual(['detergente']);
    expect(itens(DA_CASA)).toEqual(['pilhas']);
  });

  it('"lista de compras semanal" (singular) vai para a semanal, também de dentro da pasta Casa', async () => {
    await pastaDeLista();
    await pastaDaCasa();
    novaPlanilha(SEMANAIS);
    novaPlanilha(DA_CASA);

    await executarFrase('adiciona azeite na lista de compras semanal', { pastaAtual: 'pasta-casa-compras-casa' });

    expect(itens(SEMANAIS)).toEqual(['azeite']);
    expect(itens(DA_CASA)).toEqual([]);
  });

  it('item duplicado (ainda não comprado) pergunta antes de repetir: não grava e o cartão avisa', async () => {
    await pastaDeLista();
    novaPlanilha(SEMANAIS, [compra('Leite')]);

    const resultado = await executarFrase('põe leite nas compras da semana');

    expect(anexos()).toEqual([]);
    expect(planilhas.linhas(SEMANAIS)).toHaveLength(1);
    expect(resultado.titulo).toBe('Já está na lista');
    expect(resultado.detalhe).toContain('“leite” já está na lista');
    expect(resultado.repetir).toBeTypeOf('function');

    // "Pôr mesmo assim" repete, e o novo cartão desfaz a repetição.
    const repetido = await resultado.repetir!();
    expect(itens(SEMANAIS)).toEqual(['Leite', 'leite']);
    expect(repetido.titulo).toBe('Item guardado');
    expect(repetido.repetir).toBeUndefined();
    await repetido.desfazer();
    expect(planilhas.linhas(SEMANAIS)[1]!.valores['Observação']).toBe('desfeito');
  });

  it('com um item novo e um repetido, grava o novo e avisa do repetido, sem acento ou maiúscula atrapalhando', async () => {
    await pastaDeLista();
    novaPlanilha(SEMANAIS, [compra('PÃO')]);

    const resultado = await executarFrase('põe leite e pao nas compras da semana');

    expect(itens(SEMANAIS)).toEqual(['PÃO', 'leite']);
    expect(resultado.titulo).toBe('Item guardado');
    expect(resultado.detalhe).toContain('Já estava na lista: “pao”');
    expect(resultado.repetir).toBeTypeOf('function');

    await resultado.repetir!();
    expect(itens(SEMANAIS)).toEqual(['PÃO', 'leite', 'pao']);
  });

  it('o repetir mantém o Desfazer do que já tinha sido guardado', async () => {
    await pastaDeLista();
    novaPlanilha(SEMANAIS, [compra('pão')]);

    const resultado = await executarFrase('põe leite e pão nas compras da semana');
    const repetido = await resultado.repetir!();
    await repetido.desfazer();

    expect(planilhas.linhas(SEMANAIS).map((l) => l.valores['Observação'])).toEqual(['', 'desfeito', 'desfeito']);
  });

  it('item já comprado não conta como repetido (compra de novo)', async () => {
    await pastaDeLista();
    novaPlanilha(SEMANAIS, [compra('Leite', { 'Comprado?': 'TRUE' })]);

    const resultado = await executarFrase('põe leite nas compras da semana');

    expect(itens(SEMANAIS)).toEqual(['Leite', 'leite']);
    expect(resultado.titulo).toBe('Item guardado');
  });

  it('linha desfeita não conta como repetida', async () => {
    await pastaDeLista();
    novaPlanilha(SEMANAIS, [compra('Leite', { Observação: 'desfeito' })]);

    await executarFrase('põe leite nas compras da semana');

    expect(itens(SEMANAIS)).toEqual(['Leite', 'leite']);
  });

  it('sem pasta de lista, a frase vira ideia com aviso e nada vai para planilha', async () => {
    const resultado = await executarFrase('põe leite e pão nas compras da semana');

    expect(resultado.titulo).toBe('Guardado em Ideias');
    expect(resultado.detalhe).toMatch(/Não achei a lista/);
    expect(resultado.detalhe).toMatch(/Ficou guardado como ideia/);
    expect(resultado.ver).toBe('#/ideias');
    expect(await listar('ideias')).toHaveLength(1);
    expect(planilhas.pedidos).toEqual([]);
  });

  it('só há a lista da casa e a frase pede a semanal: não adivinha, vira ideia', async () => {
    await pastaDaCasa();
    novaPlanilha(DA_CASA);

    const resultado = await executarFrase('põe leite nas compras da semana');

    expect(resultado.titulo).toBe('Guardado em Ideias');
    expect(planilhas.pedidos).toEqual([]);
  });

  it('pasta de lista sem planilha também não recebe', async () => {
    await pastaDeLista({ planilhaId: undefined });

    const resultado = await executarFrase('põe leite nas compras da semana');

    expect(resultado.titulo).toBe('Guardado em Ideias');
  });

  it('planilha que mudou (falta coluna) não grava: "Os itens não foram para a planilha." e a frase vira ideia', async () => {
    await pastaDeLista();
    planilhas.planilha(SEMANAIS, [], ['Item', 'Quantidade', 'Observação', 'id']); // sem "Quem pôs" nem "Data"

    const resultado = await executarFrase('põe leite e pão nas compras da semana');

    expect(resultado.titulo).toBe('Guardado em Ideias');
    expect(resultado.detalhe).toContain('Os itens não foram para a planilha.');
    expect(resultado.detalhe).toContain('Ficou guardado como ideia.');
    expect(resultado.detalhe).not.toContain('Nada foi gravado');
    expect(planilhas.linhas(SEMANAIS)).toEqual([]);
    expect(await listar('ideias')).toHaveLength(1);
  });

  it('sem rede os itens ficam na fila e o cartão avisa "salva ao voltar a rede"', async () => {
    await pastaDeLista();
    novaPlanilha(SEMANAIS);
    planilhas.cair();

    const resultado = await executarFrase('põe leite e pão nas compras da semana');

    expect(resultado.titulo).toBe('2 itens guardados');
    expect(resultado.detalhe).toMatch(/Sem internet: salva ao voltar a rede/);
    const fila = (await listarPendentes()).filter((p) => p.tipo === 'planilha');
    expect(fila).toHaveLength(2);
    expect(fila[0]).toMatchObject({ acao: 'anexar', planilhaId: SEMANAIS, valores: { Item: 'leite', 'Quem pôs': 'Central', Data: '2026-11-05' } });
    expect(await listar('ideias')).toEqual([]);

    // Desfazer antes de enviar tira da fila: nada chega à planilha.
    await resultado.desfazer();
    expect((await listarPendentes()).filter((p) => p.tipo === 'planilha')).toEqual([]);
  });

  it('Guardar como ideia cria a ideia e desfaz as linhas', async () => {
    await pastaDeLista();
    novaPlanilha(SEMANAIS);

    const resultado = await executarFrase('põe leite e pão nas compras da semana');
    const ideia = await resultado.guardarComoIdeia!();

    expect(ideia.titulo).toBe('Guardado em Ideias');
    expect(await listar('ideias')).toHaveLength(1);
    expect(planilhas.linhas(SEMANAIS).map((l) => l.valores['Observação'])).toEqual(['desfeito', 'desfeito']);
  });

  it('Desfazer que falha lança, e pode ser tentado de novo', async () => {
    await pastaDeLista();
    novaPlanilha(SEMANAIS);
    const resultado = await executarFrase('põe leite nas compras da semana');

    planilhas.falharAProxima();
    await expect(resultado.desfazer()).rejects.toThrow();
    expect(planilhas.linhas(SEMANAIS)[0]!.valores['Observação']).not.toBe('desfeito');

    await resultado.desfazer();
    expect(planilhas.linhas(SEMANAIS)[0]!.valores['Observação']).toBe('desfeito');
  });
});

describe('dentro de uma pasta de lista', () => {
  it('frase curta de itens ("leite e pão") vai direto para a pasta', async () => {
    await pastaDeLista();
    novaPlanilha(SEMANAIS);

    const resultado = await executarFrase('leite e pão', { pastaAtual: 'pasta-casa-compras-semanais' });

    expect(itens(SEMANAIS)).toEqual(['leite', 'pão']);
    expect(resultado.titulo).toBe('2 itens guardados');
  });

  it('o pedido que diz a outra lista vale mais que a pasta onde o dono está', async () => {
    await pastaDeLista();
    await pastaDaCasa();
    novaPlanilha(SEMANAIS);
    novaPlanilha(DA_CASA);

    await executarFrase('põe pilhas na lista da casa', { pastaAtual: 'pasta-casa-compras-semanais' });

    expect(itens(DA_CASA)).toEqual(['pilhas']);
    expect(planilhas.linhas(SEMANAIS)).toEqual([]);
  });

  it.each([
    'comprar tampa para o ralo',
    'preciso de leite amanhã',
    'ligar para a Marina',
    'reunião sexta às 10h',
    'adicione revisar o relatório nas tarefas do doutoramento',
    '15',
    '10h',
    'dia 15',
    'preciso fazer as compras da semana',
  ])('"%s" não vai para a planilha compartilhada', async (frase) => {
    await pastaDeLista();
    novaPlanilha(SEMANAIS);

    await executarFrase(frase, { pastaAtual: 'pasta-casa-compras-semanais' });

    expect(anexos()).toEqual([]);
    expect(planilhas.linhas(SEMANAIS)).toEqual([]);
  });

  it('"comprar tampa para o ralo" continua sendo tarefa (ou ideia), nunca item de lista', async () => {
    await pastaDeLista();
    novaPlanilha(SEMANAIS);

    const resultado = await executarFrase('Preciso comprar tampa para o ralo', { pastaAtual: 'pasta-casa-compras-semanais' });

    expect(planilhas.pedidos).toEqual([]);
    expect(['Tarefa guardada', 'Guardado em Ideias']).toContain(resultado.titulo);
  });

  it('fora de uma pasta de lista, "leite e pão" não é lista', async () => {
    await pastaDeLista();
    novaPlanilha(SEMANAIS);

    await executarFrase('leite e pão');
    await executarFrase('leite e pão', { pastaAtual: 'pasta-que-nao-existe' });

    expect(planilhas.pedidos).toEqual([]);
    expect(await listar('ideias')).toHaveLength(2);
  });

  it('numa pasta de Registro, "leite e pão" também não é lista', async () => {
    await pastaDeLista();
    novaPlanilha(SEMANAIS);
    await salvar('pastas', { id: 'pasta-agua', salaId: 'sala-casa', tipo: 'registro', nome: 'Consumo de Água', ordem: 3, modelo: 'consumo', servico: 'agua', planilhaId: 'planilha-ficticia-agua' });

    await executarFrase('leite e pão', { pastaAtual: 'pasta-agua' });

    expect(anexos()).toEqual([]);
    expect(planilhas.linhas(SEMANAIS)).toEqual([]);
  });
});

describe('correções da revisão da Tarefa 14', () => {
  it('"lista de compras" sem nome vale a pasta de Lista onde o dono está, antes da semanal', async () => {
    await pastaDeLista();
    await pastaDaCasa();
    novaPlanilha(SEMANAIS);
    novaPlanilha(DA_CASA);

    await executarFrase('põe pilhas na lista de compras', { pastaAtual: 'pasta-casa-compras-casa' });
    expect(itens(DA_CASA)).toEqual(['pilhas']);
    expect(planilhas.linhas(SEMANAIS)).toEqual([]);

    // Fora de uma pasta de Lista, a genérica cai na semanal.
    await executarFrase('põe leite na lista de compras');
    expect(itens(SEMANAIS)).toEqual(['leite']);
  });

  it('nome explícito vale mais que a pasta onde o dono está, mesmo com "lista de compras" por perto', async () => {
    await pastaDeLista();
    await pastaDaCasa();
    novaPlanilha(SEMANAIS);
    novaPlanilha(DA_CASA);

    await executarFrase('põe leite nas compras da semana', { pastaAtual: 'pasta-casa-compras-casa' });

    expect(itens(SEMANAIS)).toEqual(['leite']);
  });

  it('o artigo do começo não entra no item gravado, e o repetido o ignora (o leite = Leite, ovo = Ovos)', async () => {
    await pastaDeLista();
    novaPlanilha(SEMANAIS, [compra('Leite'), compra('Ovos')]);

    const repetido = await executarFrase('põe o leite e um ovo nas compras da semana');
    expect(repetido.titulo).toBe('Já está na lista');
    expect(planilhas.linhas(SEMANAIS)).toHaveLength(2);

    const novo = await executarFrase('põe o pão nas compras da semana');
    expect(novo.titulo).toBe('Item guardado');
    expect(itens(SEMANAIS)).toEqual(['Leite', 'Ovos', 'pão']);
  });

  it('o cartão "Já está na lista" não tem Desfazer (nada foi gravado)', async () => {
    await pastaDeLista();
    novaPlanilha(SEMANAIS, [compra('Leite')]);

    const resultado = await executarFrase('põe leite nas compras da semana');

    expect(resultado.semDesfazer).toBe(true);
    const gravado = await executarFrase('põe pão nas compras da semana');
    expect(gravado.semDesfazer).toBeUndefined();
  });

  it('depois de "Pôr mesmo assim", o cartão diz que o Desfazer desfaz tudo', async () => {
    await pastaDeLista();
    novaPlanilha(SEMANAIS, [compra('Leite')]);

    const resultado = await executarFrase('põe leite e pão nas compras da semana');
    const repetido = await resultado.repetir!();

    expect(repetido.detalhe).toMatch(/Desfazer tira todos os itens deste pedido/);
    expect(repetido.semDesfazer).toBeUndefined();
  });

  it('item comprido demais vira ideia com aviso, e nada vai para a planilha', async () => {
    await pastaDeLista();
    novaPlanilha(SEMANAIS);

    const resultado = await executarFrase(`põe leite e ${'x'.repeat(81)} nas compras da semana`);

    expect(planilhas.pedidos).toEqual([]);
    expect(await listar('ideias')).toHaveLength(1);
    expect(resultado.titulo).not.toMatch(/guardado$/);
  });

  it('"põe no calendário a lista de compras da semana" não vai para a planilha', async () => {
    await pastaDeLista();
    novaPlanilha(SEMANAIS);

    await executarFrase('põe no calendário a lista de compras da semana');

    expect(anexos()).toEqual([]);
    expect(planilhas.linhas(SEMANAIS)).toEqual([]);
  });
});
