// Voz de lista (V02, Tarefa 14): "põe leite e pão nas compras da semana" anexa uma linha por item na planilha da pasta de
// Lista, com cartão (Desfazer, Guardar como ideia). Quinta-feira, 2026-11-05, 12:20 em Lisboa. A planilha é de mentira
// (tests/apoio/planilhas-falsas.ts); o resto é o código de verdade. Só itens e nomes fictícios.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executarFrase, SEGUE_COMO_TAREFA } from '../apoio/executar-frase';
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

describe('frase de lista (chat)', () => {
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

  it('"comprar leite amanhã" é tarefa (tem dia): não vai para a lista, mesmo com a pasta à mão', async () => {
    await pastaDeLista();
    novaPlanilha(SEMANAIS);

    const resultado = await executarFrase('comprar leite amanhã');

    expect(resultado.titulo).toBe(SEGUE_COMO_TAREFA);
    expect(planilhas.pedidos).toEqual([]);
  });

  it('"Comprar pão" sem pasta de lista segue como tarefa, sem nota de lista (não falou de lista)', async () => {
    const resultado = await executarFrase('Comprar pão');

    expect(resultado.titulo).toBe(SEGUE_COMO_TAREFA);
    expect(resultado.detalhe).toBe('');
    expect(planilhas.pedidos).toEqual([]);
  });

  it('sem pasta de lista, a frase segue como tarefa, com aviso, e nada vai para planilha', async () => {
    const resultado = await executarFrase('põe leite e pão nas compras da semana');

    expect(resultado.titulo).toBe(SEGUE_COMO_TAREFA);
    expect(resultado.detalhe).toMatch(/Não achei a lista/);
    expect(resultado.ver).toBeNull();
    expect(await listar('ideias')).toEqual([]);
    expect(planilhas.pedidos).toEqual([]);
  });

  it('só há a lista da casa e a frase pede a semanal: não adivinha, segue como tarefa', async () => {
    await pastaDaCasa();
    novaPlanilha(DA_CASA);

    const resultado = await executarFrase('põe leite nas compras da semana');

    expect(resultado.titulo).toBe(SEGUE_COMO_TAREFA);
    expect(planilhas.pedidos).toEqual([]);
  });

  it('pasta de lista sem planilha também não recebe', async () => {
    await pastaDeLista({ planilhaId: undefined });

    const resultado = await executarFrase('põe leite nas compras da semana');

    expect(resultado.titulo).toBe(SEGUE_COMO_TAREFA);
  });

  it('planilha que mudou (falta coluna) não grava: "Os itens não foram para a planilha." e a frase segue como tarefa', async () => {
    await pastaDeLista();
    planilhas.planilha(SEMANAIS, [], ['Item', 'Quantidade', 'Observação', 'id']); // sem "Quem pôs" nem "Data"

    const resultado = await executarFrase('põe leite e pão nas compras da semana');

    expect(resultado.titulo).toBe(SEGUE_COMO_TAREFA);
    expect(resultado.detalhe).toContain('Os itens não foram para a planilha.');
    expect(resultado.detalhe).not.toContain('Nada foi gravado');
    expect(planilhas.linhas(SEMANAIS)).toEqual([]);
    expect(await listar('ideias')).toEqual([]);
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

  it('Desfazer do "Pôr mesmo assim" que falha pela metade: tentar de novo não repete o que já foi desfeito', async () => {
    await pastaDeLista();
    novaPlanilha(SEMANAIS, [compra('pão')]);
    const resultado = await executarFrase('põe leite e pão nas compras da semana');
    const repetido = await resultado.repetir!();
    const marcacoes = () => planilhas.pedidos.filter((p) => p.acao === 'atualizarLinha').length;

    planilhas.falharAProxima();
    await expect(repetido.desfazer()).rejects.toThrow();
    await repetido.desfazer();

    expect(planilhas.linhas(SEMANAIS).map((l) => l.valores['Observação'])).toEqual(['', 'desfeito', 'desfeito']);
    // Duas linhas a desfazer (leite e o pão repetido): uma marcação cada, nenhuma repetida no segundo tiro.
    // (A camada da planilha já ignora repetição; este teste guarda o comportamento visível, a memória fica em executar.ts.)
    expect(marcacoes()).toBe(2);
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
    'comprar tampa para o ralo amanhã',
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

  it('"Preciso comprar tampa para o ralo" (sem dia nem hora) é item de compra: vai para a lista', async () => {
    await pastaDeLista();
    novaPlanilha(SEMANAIS);

    const resultado = await executarFrase('Preciso comprar tampa para o ralo', { pastaAtual: 'pasta-casa-compras-semanais' });

    expect(itens(SEMANAIS)).toEqual(['tampa para o ralo']);
    expect(resultado.titulo).toBe('Item guardado');
  });

  it('fora de uma pasta de lista, "leite e pão" não é lista', async () => {
    await pastaDeLista();
    novaPlanilha(SEMANAIS);

    await executarFrase('leite e pão');
    await executarFrase('leite e pão', { pastaAtual: 'pasta-que-nao-existe' });

    expect(planilhas.pedidos).toEqual([]);
    expect(await listar('ideias')).toEqual([]);
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

  it('item comprido demais não é lista: segue como tarefa, e nada vai para a planilha', async () => {
    await pastaDeLista();
    novaPlanilha(SEMANAIS);

    const resultado = await executarFrase(`põe leite e ${'x'.repeat(81)} nas compras da semana`);

    expect(planilhas.pedidos).toEqual([]);
    expect(await listar('ideias')).toEqual([]);
    expect(resultado.titulo).toBe(SEGUE_COMO_TAREFA);
  });

  it('"põe no calendário a lista de compras da semana" não vai para a planilha', async () => {
    await pastaDeLista();
    novaPlanilha(SEMANAIS);

    await executarFrase('põe no calendário a lista de compras da semana');

    expect(anexos()).toEqual([]);
    expect(planilhas.linhas(SEMANAIS)).toEqual([]);
  });
});

// V02.1: lista com nome próprio (o dono criou a dele). Ordem: pasta atual (se for Lista) → semanal padrão → única lista com
// planilha → a de nome "compra" de menor ordem → nada (tarefa).
describe('lista genérica com pasta de nome próprio', () => {
  const MINHA = 'planilha-ficticia-minha';
  const OUTRA = 'planilha-ficticia-outra';
  const propria = (extra: Partial<Pasta> = {}) => pastaDeLista({ id: 'pasta-propria', nome: 'Minhas Compras', ordem: 5, planilhaId: MINHA, ...extra });

  it('só existe uma pasta de Lista com planilha (nome próprio): ela recebe, mesmo fora dela e sem a semanal', async () => {
    await propria();
    novaPlanilha(MINHA);

    const resultado = await executarFrase('Coloca na lista de compra comprar pão de forma comprar café comprar beterraba');

    expect(itens(MINHA)).toEqual(['pão de forma', 'café', 'beterraba']);
    expect(resultado.titulo).toBe('3 itens guardados');
    expect(await listar('ideias')).toEqual([]);
  });

  it('a frase "preciso comprar ..." também vai para a única lista própria', async () => {
    await propria();
    novaPlanilha(MINHA);

    await executarFrase('eu preciso comprar pão de forma, comprar café e beterraba');

    expect(itens(MINHA)).toEqual(['pão de forma', 'café', 'beterraba']);
  });

  it('a pasta de Lista onde o dono está vale mais que tudo', async () => {
    await pastaDeLista();
    await propria();
    novaPlanilha(SEMANAIS);
    novaPlanilha(MINHA);

    await executarFrase('põe leite na lista de compra', { pastaAtual: 'pasta-propria' });

    expect(itens(MINHA)).toEqual(['leite']);
    expect(itens(SEMANAIS)).toEqual([]);
  });

  it('com duas listas, a semanal padrão vale quando existe', async () => {
    await pastaDeLista();
    await propria();
    novaPlanilha(SEMANAIS);
    novaPlanilha(MINHA);

    await executarFrase('põe leite na lista de compra');

    expect(itens(SEMANAIS)).toEqual(['leite']);
    expect(itens(MINHA)).toEqual([]);
  });

  it('com duas listas e sem a semanal, vale a de nome "compra" de menor ordem', async () => {
    await propria({ nome: 'Coisas da Cozinha', id: 'pasta-cozinha', ordem: 1, planilhaId: OUTRA });
    await salvar('pastas', { id: 'pasta-c2', salaId: 'sala-casa', tipo: 'lista', nome: 'Compras do Sítio', ordem: 9, modelo: 'compras', planilhaId: DA_CASA });
    await salvar('pastas', { id: 'pasta-c1', salaId: 'sala-casa', tipo: 'lista', nome: 'Compra Grande', ordem: 3, modelo: 'compras', planilhaId: MINHA });
    novaPlanilha(OUTRA);
    novaPlanilha(DA_CASA);
    novaPlanilha(MINHA);

    await executarFrase('põe leite na lista de compra');

    expect(itens(MINHA)).toEqual(['leite']);
    expect(itens(OUTRA)).toEqual([]);
    expect(itens(DA_CASA)).toEqual([]);
  });

  it('com duas listas, sem semanal e nenhuma de nome "compra": não adivinha, segue como tarefa', async () => {
    await propria({ nome: 'Despensa', id: 'pasta-despensa' });
    await propria({ nome: 'Cozinha', id: 'pasta-cozinha', ordem: 6, planilhaId: OUTRA });
    novaPlanilha(MINHA);
    novaPlanilha(OUTRA);

    const resultado = await executarFrase('põe leite na lista de compra');

    expect(resultado.titulo).toBe(SEGUE_COMO_TAREFA);
    expect(planilhas.pedidos).toEqual([]);
  });

  it('lista sem planilha não conta como a única', async () => {
    await propria({ planilhaId: undefined });

    const resultado = await executarFrase('põe leite na lista de compra');

    expect(resultado.titulo).toBe(SEGUE_COMO_TAREFA);
  });

  it('sem nenhuma pasta de lista, a frase segue como tarefa', async () => {
    const resultado = await executarFrase('põe leite na lista de compra');

    expect(resultado.titulo).toBe(SEGUE_COMO_TAREFA);
    expect(planilhas.pedidos).toEqual([]);
  });

  it('o pedido que diz "da casa" ou "da semana" continua exigindo a pasta certa (não cai na própria)', async () => {
    await propria();
    novaPlanilha(MINHA);

    const resultado = await executarFrase('põe leite nas compras da semana');

    expect(resultado.titulo).toBe(SEGUE_COMO_TAREFA);
    expect(planilhas.pedidos).toEqual([]);
  });
});
