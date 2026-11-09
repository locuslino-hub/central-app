import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { aprender, carregarMemoria, lembrarPessoa, pessoaDesconhecida } from '../../src/chat/memoria';
import { criarItem, hojeEmLisboa, interpretar } from '../../src/chat/interpretar';
import type { Item } from '../../src/chat/regras';
import { desfazer } from '../../src/dados/desfazer';
import {
  PALAVRAS_INICIAIS,
  apagar,
  assinar,
  gravarDoServidor,
  listar,
  listarPendentes,
  salvar,
  semear,
  semearPalavras,
} from '../../src/dados/loja';
import type { Mudanca } from '../../src/dados/tipos';

// Quinta-feira, 2026-11-05, 12:20 (Europe/Lisbon). Só a data é falsa.
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 5, 12, 20));
  await semear();
  await semearPalavras();
});

const salaDe = async (termo: string) => (await listar('palavras')).find((p) => p.termo === termo)?.salaId;

async function cadastrar(nome: string, salaId: string) {
  return salvar('pessoas', { nome, salaId });
}

describe('palavras iniciais', () => {
  it('lista inicial de palavras tem banheiro, cozinha, lâmpada em Casa, e projeto em Investigação', async () => {
    expect(await salaDe('banheiro')).toBe('sala-casa');
    expect(await salaDe('cozinha')).toBe('sala-casa');
    expect(await salaDe('lâmpada')).toBe('sala-casa');
    expect(await salaDe('projeto')).toBe('sala-investigacao');
  });

  it('traz os plurais: lâmpadas, banheiros, projetos, aulas…', async () => {
    expect(await salaDe('lâmpadas')).toBe('sala-casa');
    expect(await salaDe('banheiros')).toBe('sala-casa');
    expect(await salaDe('cozinhas')).toBe('sala-casa');
    expect(await salaDe('projetos')).toBe('sala-investigacao');
    expect(await salaDe('teses')).toBe('sala-doutoramento');
    expect(await salaDe('alunas')).toBe('sala-orientacoes');
    expect((await carregarMemoria()).acharSala('Trocar as lampadas da sala')).toBe('sala-casa');
  });

  it('traz também as óbvias: aula e aulas, orientação e aluna, MBA', async () => {
    expect(await salaDe('aula')).toBe('sala-aulas');
    expect(await salaDe('aulas')).toBe('sala-aulas');
    expect(await salaDe('orientação')).toBe('sala-orientacoes');
    expect(await salaDe('aluna')).toBe('sala-orientacoes');
    expect(await salaDe('MBA')).toBe('sala-mba');
  });

  it('toda palavra inicial aponta para uma sala semeada', async () => {
    const salas = new Set((await listar('salas')).map((s) => s.id));
    for (const [, , salaId] of PALAVRAS_INICIAIS) expect(salas.has(salaId)).toBe(true);
  });

  it('rodar duas vezes não duplica', async () => {
    await semearPalavras();
    expect(await listar('palavras')).toHaveLength(PALAVRAS_INICIAIS.length);
  });

  it('têm ids fixos, atualizadoEm 0, aparelho semente e não geram pendentes', async () => {
    const palavras = await listar('palavras');
    expect(palavras.find((p) => p.termo === 'lâmpada')?.id).toBe('palavra-lampada');
    expect(palavras.every((p) => p.atualizadoEm === 0 && p.aparelho === 'semente')).toBe(true);
    expect(await listarPendentes()).toEqual([]);
  });

  it('dois aparelhos semeiam os mesmos ids', async () => {
    const ids = (await listar('palavras')).map((p) => p.id).sort();
    globalThis.indexedDB = new IDBFactory();
    await semearPalavras();
    expect((await listar('palavras')).map((p) => p.id).sort()).toEqual(ids);
  });

  it('não ressuscita palavra apagada nem desfaz o que foi aprendido', async () => {
    await apagar('palavras', 'palavra-cozinha');
    await aprender('projeto', 'sala-doutoramento');

    await semearPalavras();

    expect(await salaDe('cozinha')).toBeUndefined();
    expect(await salaDe('projeto')).toBe('sala-doutoramento');
  });

  it('avisa os ouvintes só das palavras que criou', async () => {
    globalThis.indexedDB = new IDBFactory();
    const mudancas: Mudanca[] = [];
    onTestFinished(assinar((m) => mudancas.push(m)));

    await semearPalavras();
    expect(mudancas).toHaveLength(PALAVRAS_INICIAIS.length);
    expect(mudancas.every((m) => m.colecao === 'palavras')).toBe(true);
    mudancas.length = 0;
    await semearPalavras();
    expect(mudancas).toEqual([]);
  });
});

describe('memória: acharSala', () => {
  it.each([
    ['Preciso parafusar o apoio do banheiro', 'sala-casa'],
    ['Preciso parafusar o apoio do BANHEIRO', 'sala-casa'],
    ['Trocar a lampada da garagem', 'sala-casa'],
    ['Trocar a LÂMPADA', 'sala-casa'],
    ['Reunião sobre o Projeto', 'sala-investigacao'],
    ['Preparar slides para o mba', 'sala-mba'],
    ['Responder a aluna', 'sala-orientacoes'],
  ])('%j dá %s, sem ligar para acento nem maiúscula', async (frase, sala) => {
    expect((await carregarMemoria()).acharSala(frase)).toBe(sala);
  });

  it.each(['Ligar o projetor', 'Reprojeto de vida', 'Um banheirão', 'Nada a ver'])(
    'só palavra inteira conta: %j não acha sala',
    async (frase) => {
      expect((await carregarMemoria()).acharSala(frase)).toBeNull();
    },
  );

  it('com duas palavras na frase, vale a que vem primeiro', async () => {
    const memoria = await carregarMemoria();
    expect(memoria.acharSala('Ver o projeto da cozinha')).toBe('sala-investigacao');
    expect(memoria.termoDaSala('Ver o projeto da cozinha')).toBe('projeto');
  });

  it('termoDaSala devolve o termo como foi guardado, com acento', async () => {
    expect((await carregarMemoria()).termoDaSala('trocar a lampada')).toBe('lâmpada');
  });

  it('palavra apagada não conta', async () => {
    await apagar('palavras', 'palavra-banheiro');
    expect((await carregarMemoria()).acharSala('apoio do banheiro')).toBeNull();
  });

  it('termo com caractere especial de expressão regular não quebra a busca', async () => {
    await aprender('c++ (curso)', 'sala-pessoal');
    const memoria = await carregarMemoria();
    expect(memoria.acharSala('estudar c++ (curso) hoje')).toBe('sala-pessoal');
    expect(memoria.acharSala('estudar c hoje')).toBeNull();
  });
});

describe('memória: acharPessoa', () => {
  it('acha a pessoa cadastrada pelo nome, palavra inteira, sem acento nem maiúscula', async () => {
    const marina = await cadastrar('Marina', 'sala-orientacoes');
    const memoria = await carregarMemoria();
    expect(memoria.acharPessoa('Marcar reunião com a MARINA')).toEqual({
      id: marina.id,
      nome: 'Marina',
      salaId: 'sala-orientacoes',
    });
    expect(memoria.acharPessoa('Fazer marinada')).toBeNull();
  });

  it('acha "Prof. Souza" só pelo sobrenome, ignorando o título', async () => {
    await cadastrar('Prof. Souza', 'sala-doutoramento');
    const memoria = await carregarMemoria();
    expect(memoria.acharPessoa('Mandar o capítulo para o Souza')?.nome).toBe('Prof. Souza');
    expect(memoria.acharPessoa('Falar com o professor')).toBeNull();
  });

  it('acento escrito a mais na frase não atrapalha', async () => {
    await cadastrar('Aurora', 'sala-mba');
    expect((await carregarMemoria()).acharPessoa('ligar para a ÁURORA')?.nome).toBe('Aurora');
  });

  it('pessoa apagada não conta', async () => {
    const renata = await cadastrar('Renata', 'sala-aulas');
    await apagar('pessoas', renata.id);
    expect((await carregarMemoria()).acharPessoa('Ligar para Renata')).toBeNull();
  });

  it('pessoaPorId devolve a pessoa viva', async () => {
    const aurora = await cadastrar('Aurora', 'sala-mba');
    const memoria = await carregarMemoria();
    expect(memoria.pessoaPorId(aurora.id)?.nome).toBe('Aurora');
    expect(memoria.pessoaPorId('nao-existe')).toBeUndefined();
  });
});

describe('aprender', () => {
  it('grava uma Palavra pela loja, então sincroniza, e a próxima frase usa', async () => {
    await aprender('garagem', 'sala-casa');

    const palavra = (await listar('palavras')).find((p) => p.termo === 'garagem')!;
    expect(palavra.salaId).toBe('sala-casa');
    expect(palavra.atualizadoEm).toBeGreaterThan(0);
    expect(await listarPendentes()).toContainEqual(expect.objectContaining({ colecao: 'palavras', id: palavra.id }));
    expect((await carregarMemoria()).acharSala('Arrumar a garagem')).toBe('sala-casa');
  });

  it('palavra que já existe muda de sala no mesmo registro, sem duplicar (acento e maiúscula não importam)', async () => {
    await aprender('LAMPADA', 'sala-pessoal');

    const lampadas = (await listar('palavras')).filter((p) => p.termo.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase() === 'lampada');
    expect(lampadas).toHaveLength(1);
    expect(lampadas[0]).toMatchObject({ id: 'palavra-lampada', termo: 'lâmpada', salaId: 'sala-pessoal' });
  });

  it('o nome de uma pessoa cadastrada muda a sala da pessoa, não vira palavra', async () => {
    const marina = await cadastrar('Marina', 'sala-orientacoes');
    const antes = (await listar('palavras')).length;

    await aprender('marina', 'sala-aulas');

    expect((await listar('pessoas')).find((p) => p.id === marina.id)?.salaId).toBe('sala-aulas');
    expect(await listar('palavras')).toHaveLength(antes);
  });

  it('termo em branco ou sala vazia não grava nada', async () => {
    await aprender('   ', 'sala-casa');
    await aprender('garagem', '');
    expect(await listarPendentes()).toEqual([]);
  });

  it('memoria.aprender já vale para a mesma memória, sem recarregar', async () => {
    const memoria = await carregarMemoria();
    await memoria.aprender('garagem', 'sala-casa');
    expect(memoria.acharSala('Arrumar a garagem')).toBe('sala-casa');
    await memoria.aprender('lâmpada', 'sala-pessoal');
    expect(memoria.acharSala('Trocar a lâmpada')).toBe('sala-pessoal');
  });
});

describe('gravações ao mesmo tempo', () => {
  it('duas lembrarPessoa simultâneas do mesmo nome criam uma pessoa só', async () => {
    const [a, b] = await Promise.all([
      lembrarPessoa('Renata', 'sala-orientacoes'),
      lembrarPessoa('renata', 'sala-aulas'),
    ]);
    expect(await listar('pessoas')).toHaveLength(1);
    expect(a.id).toBe(b.id);
    expect((await listar('pessoas'))[0].salaId).toBe('sala-aulas');
  });

  it('dois aprender simultâneos do mesmo termo novo criam uma palavra só', async () => {
    const antes = (await listar('palavras')).length;
    await Promise.all([aprender('garagem', 'sala-casa'), aprender('Garagem', 'sala-pessoal')]);
    const garagens = (await listar('palavras')).filter((p) => p.termo.toLowerCase() === 'garagem');
    expect(garagens).toHaveLength(1);
    expect(await listar('palavras')).toHaveLength(antes + 1);
  });

  it('uma gravação que falha não trava as seguintes', async () => {
    const real = globalThis.indexedDB;
    globalThis.indexedDB = { open() { throw new Error('disco cheio'); } } as unknown as IDBFactory;
    await expect(lembrarPessoa('Renata', 'sala-aulas')).rejects.toThrow();
    globalThis.indexedDB = real;
    await lembrarPessoa('Renata', 'sala-aulas');
    expect(await listar('pessoas')).toHaveLength(1);
  });
});

describe('lembrarPessoa', () => {
  it('cria uma Pessoa mínima com nome e sala, que sincroniza', async () => {
    const renata = await lembrarPessoa('Renata', 'sala-orientacoes');

    expect(renata).toMatchObject({ nome: 'Renata', salaId: 'sala-orientacoes' });
    expect(await listar('pessoas')).toEqual([renata]);
    expect(await listarPendentes()).toContainEqual(expect.objectContaining({ colecao: 'pessoas', id: renata.id }));
  });

  it('pessoa com o mesmo nome não é duplicada: só muda a sala', async () => {
    const antes = await lembrarPessoa('Renata', 'sala-orientacoes');
    const depois = await lembrarPessoa('renata', 'sala-aulas');

    expect(depois.id).toBe(antes.id);
    expect(await listar('pessoas')).toHaveLength(1);
    expect(depois.salaId).toBe('sala-aulas');
  });
});

describe('pessoaDesconhecida', () => {
  const desconhecida = async (frase: string) => pessoaDesconhecida(frase, await carregarMemoria());

  it.each([
    ['Adicione em atividades do dia mandar mensagem para Renata', 'Renata'],
    ['Reunião com a Renata', 'Renata'],
    ['Ligar pra Renata Sexta', 'Renata'],
    ['Revisar a tese da Renata', 'Renata'],
    ['Ligar para o Prof. Souza', 'Prof. Souza'],
    ['Almoço com a Marina e a Aurora', 'Aurora'],
  ])('%j pergunta por %j', async (frase, nome) => {
    await cadastrar('Marina', 'sala-orientacoes');
    expect(await desconhecida(frase)).toBe(nome);
  });

  it.each([
    'Marcar reunião com a Marina',
    'Aula do MBA',
    'Revisar o texto de Novembro',
    'Entregar na Sexta',
    'Enviar relatório para a FCT',
    'Adicione Revisar paragrafo do relatório 1 nas tarefas do doutoramento',
    'Preciso parafusar o apoio do Banheiro',
    'Reunião sobre o Projeto',
    'Falar com o Doutoramento',
    'mandar mensagem para renata',
    '',
  ])('%j não pergunta', async (frase) => {
    await cadastrar('Marina', 'sala-orientacoes');
    expect(await desconhecida(frase)).toBeNull();
  });

  it('depois de lembrar a pessoa, não pergunta mais', async () => {
    await lembrarPessoa('Renata', 'sala-orientacoes');
    expect(await desconhecida('Ligar para Renata')).toBeNull();
  });
});

describe('hojeEmLisboa', () => {
  it.each([
    ['2026-11-05T12:20:00Z', '2026-11-05'],
    ['2026-11-05T23:59:00Z', '2026-11-05'],
    ['2026-07-01T23:30:00Z', '2026-07-02'], // verão: Lisboa é UTC+1
    ['2026-12-31T23:59:59Z', '2026-12-31'],
  ])('%s em Lisboa é %s', (instante, dia) => {
    expect(hojeEmLisboa(new Date(instante))).toBe(dia);
  });
});

describe('interpretar', () => {
  it('Marina cadastrada em Orientações dá sala certa e o nome fica no título', async () => {
    const marina = await cadastrar('Marina', 'sala-orientacoes');

    const [item, ...resto] = await interpretar('Marcar reunião com a Marina');

    expect(resto).toEqual([]);
    expect(item).toMatchObject({
      tipo: 'tarefa',
      data: '2026-11-05',
      marcar: true,
      salaId: 'sala-orientacoes',
      motivoSala: 'pessoa',
      pessoaId: marina.id,
      pessoaNome: 'Marina',
      certeza: 'alta',
    });
    expect(item.titulo).toContain('Marina');
    expect(item.pessoaNova).toBeUndefined();
  });

  it('usa as palavras da memória: banheiro é Casa, e o termo vai junto para o cartão', async () => {
    const [item] = await interpretar('Preciso parafusar o apoio do banheiro');
    expect(item).toMatchObject({ salaId: 'sala-casa', motivoSala: 'memoria', termoSala: 'banheiro', data: undefined });
  });

  it('pessoa desconhecida sem sala vem com pessoaNova; depois de lembrar, não vem mais', async () => {
    const [primeiro] = await interpretar('Adicione em atividades do dia mandar mensagem para Renata');
    expect(primeiro).toMatchObject({ titulo: 'Mandar mensagem para Renata', salaId: null, pessoaNova: 'Renata' });

    await lembrarPessoa('Renata', 'sala-orientacoes');

    const [segundo] = await interpretar('Ligar para Renata amanhã');
    expect(segundo).toMatchObject({ salaId: 'sala-orientacoes', motivoSala: 'pessoa', data: '2026-11-06' });
    expect(segundo.pessoaNova).toBeUndefined();
  });

  it('pessoa desconhecida em frase que já tem sala não pergunta', async () => {
    const [item] = await interpretar('Mandar o projeto para Renata');
    expect(item.salaId).toBe('sala-investigacao');
    expect(item.pessoaNova).toBeUndefined();
  });

  it('o dia vem do relógio, em Lisboa', async () => {
    vi.setSystemTime(new Date('2026-07-01T23:30:00Z'));
    const [item] = await interpretar('Ligar para a Aurora hoje');
    expect(item.data).toBe('2026-07-02');
  });

  it('frase em branco não dá item', async () => {
    expect(await interpretar('   ')).toEqual([]);
  });

  it('frase sem sentido vem com certeza baixa', async () => {
    const [item] = await interpretar('asdf qwer');
    expect(item.certeza).toBe('baixa');
  });

  it('compromisso guarda dia e horas como as regras deram', async () => {
    const [item] = await interpretar('Adicione reunião sobre o projeto na sexta feira com inicio às 11:00 e termino 12:00');
    expect(item).toMatchObject({
      tipo: 'compromisso',
      data: '2026-11-06',
      inicio: '11:00',
      fim: '12:00',
      salaId: 'sala-investigacao',
      termoSala: 'projeto',
      certeza: 'alta',
    });
  });
});

describe('criarItem', () => {
  const tarefa = (extra: Partial<Item> = {}): Item => ({
    tipo: 'tarefa',
    titulo: 'Parafusar o apoio do banheiro',
    salaId: 'sala-casa',
    marcar: false,
    ...extra,
  });

  it('salva uma Tarefa com a duração padrão de 60 min, pela loja (sincroniza)', async () => {
    const { tarefa: salva } = await criarItem(tarefa({ data: '2026-11-05' }));

    expect(await listar('tarefas')).toEqual([salva]);
    expect(salva).toMatchObject({
      titulo: 'Parafusar o apoio do banheiro',
      salaId: 'sala-casa',
      data: '2026-11-05',
      duracaoMin: 60,
      duracaoConfirmada: false,
      feito: false,
      fixada: false,
      marcar: false,
    });
    expect(await listarPendentes()).toContainEqual(expect.objectContaining({ colecao: 'tarefas', id: salva.id }));
  });

  it('tarefa sem prazo não leva data nem semana, nem campos vazios', async () => {
    const { tarefa: salva } = await criarItem(tarefa({ data: undefined }));
    expect('data' in salva).toBe(false);
    expect('semana' in salva).toBe(false);
    expect('prazoHora' in salva).toBe(false);
    expect('pessoaId' in salva).toBe(false);
  });

  it('o que é só do cartão não vai para a Tarefa', async () => {
    const { tarefa: salva } = await criarItem({
      ...tarefa(),
      motivoSala: 'memoria',
      certeza: 'alta',
      termoSala: 'banheiro',
      pessoaNova: 'Renata',
      pessoaNome: 'Marina',
    } as Item);
    for (const campo of ['motivoSala', 'certeza', 'termoSala', 'pessoaNova', 'pessoaNome', 'tipo', 'inicio', 'fim']) {
      expect(campo in salva).toBe(false);
    }
  });

  it('tarefa com prazo guarda prazoHora; semana e pessoa também vão', async () => {
    const { tarefa: comPrazo } = await criarItem(tarefa({ data: '2026-11-06', prazoHora: '17:00' }));
    expect(comPrazo).toMatchObject({ data: '2026-11-06', prazoHora: '17:00', duracaoMin: 60 });

    const { tarefa: daSemana } = await criarItem(tarefa({ semana: '2026-11-09', pessoaId: 'p1', marcar: true }));
    expect(daSemana).toMatchObject({ semana: '2026-11-09', pessoaId: 'p1', marcar: true });
  });

  it('compromisso vira Tarefa com data e duração tirada de início e fim, sem prazoHora', async () => {
    const { tarefa: uma } = await criarItem({
      tipo: 'compromisso', titulo: 'Reunião sobre o projeto', salaId: 'sala-investigacao',
      data: '2026-11-06', inicio: '11:00', fim: '12:00', marcar: false,
    });
    expect(uma).toMatchObject({ data: '2026-11-06', inicio: '11:00', duracaoMin: 60, duracaoConfirmada: true });
    expect('prazoHora' in uma).toBe(false);

    const { tarefa: outra } = await criarItem({
      tipo: 'compromisso', titulo: 'Banca', salaId: null, data: '2026-11-06', inicio: '14:00', fim: '15:30', marcar: false,
    });
    expect(outra.duracaoMin).toBe(90);
  });

  it('tarefa não leva inicio, mesmo que o item traga', async () => {
    const { tarefa: salva } = await criarItem(tarefa({ data: '2026-11-06', inicio: '10:00' }));
    expect('inicio' in salva).toBe(false);
  });

  it('a hora de início do compromisso vai e volta pela sincronia; hora malformada é recusada', async () => {
    const { tarefa: salva } = await criarItem({
      tipo: 'compromisso', titulo: 'Banca', salaId: null, data: '2026-11-06', inicio: '14:00', fim: '15:30', marcar: false,
    });
    const doServidor = { ...salva, id: 'vinda', aparelho: 'celular', atualizadoEm: Date.now() };

    await gravarDoServidor([
      { colecao: 'tarefas', registro: doServidor },
      { colecao: 'tarefas', registro: { ...doServidor, id: 'torta', inicio: '25:00' } },
      { colecao: 'tarefas', registro: { ...doServidor, id: 'numero', inicio: 14 } },
    ]);

    const guardadas = await listar('tarefas');
    expect(guardadas.find((t) => t.id === 'vinda')).toMatchObject({ inicio: '14:00', duracaoMin: 90 });
    expect(guardadas.map((t) => t.id).sort()).toEqual([salva.id, 'vinda'].sort());
  });

  it('prazoHora só vai em tarefa com dia: nunca em compromisso nem em tarefa sem prazo', async () => {
    const { tarefa: compromisso } = await criarItem({
      tipo: 'compromisso', titulo: 'Banca', salaId: null, data: '2026-11-06', inicio: '14:00', fim: '15:00',
      prazoHora: '17:00', marcar: false,
    });
    expect('prazoHora' in compromisso).toBe(false);

    const { tarefa: semDia } = await criarItem(tarefa({ prazoHora: '17:00' }));
    expect('prazoHora' in semDia).toBe(false);
  });

  it('compromisso sem horas válidas fica com 60 min', async () => {
    const { tarefa: salva } = await criarItem({
      tipo: 'compromisso', titulo: 'Banca', salaId: null, data: '2026-11-06', inicio: '15:00', fim: '14:00', marcar: false,
    });
    expect(salva.duracaoMin).toBe(60);
  });

  it('Desfazer remove: o desfazer devolvido apaga a tarefa, uma vez só', async () => {
    const { tarefa: salva, desfazer: desfazerEste } = await criarItem(tarefa());

    await desfazerEste();
    expect(await listar('tarefas')).toEqual([]);
    const lapide = (await listar('tarefas', { comApagados: true }))[0];
    expect(lapide).toMatchObject({ id: salva.id, apagado: true });

    const pendentes = (await listarPendentes()).length;
    await desfazerEste();
    expect((await listarPendentes()).length).toBe(pendentes);
  });

  it('o desfazer fica registrado na pilha do app', async () => {
    await criarItem(tarefa({ titulo: 'Comprar pão' }));
    const ultimo = desfazer.ultimo()!;
    expect(ultimo.rotulo).toBe('Item do chat: Comprar pão');

    await ultimo.reverter();
    expect(await listar('tarefas')).toEqual([]);
  });

  it('desfazer pelo cartão tira a entrada da pilha, para não desfazer duas vezes', async () => {
    const primeiro = await criarItem(tarefa({ titulo: 'Primeiro' }));
    const segundo = await criarItem(tarefa({ titulo: 'Segundo' }));

    await segundo.desfazer();
    expect(await listar('tarefas')).toEqual([primeiro.tarefa]);
    expect(desfazer.ultimo()?.rotulo).toBe('Item do chat: Primeiro');
    await desfazer.ultimo()!.reverter();
    expect(await listar('tarefas')).toEqual([]);
  });

  it('desfazer que falhou pode ser tentado de novo', async () => {
    const { desfazer: desfazerEste } = await criarItem(tarefa({ titulo: 'Comprar pão' }));
    const real = globalThis.indexedDB;
    globalThis.indexedDB = { open() { throw new Error('disco cheio'); } } as unknown as IDBFactory;
    await expect(desfazerEste()).rejects.toThrow();
    globalThis.indexedDB = real;
    expect(await listar('tarefas')).toHaveLength(1);

    await desfazerEste();
    expect(await listar('tarefas')).toEqual([]);
  });
});
