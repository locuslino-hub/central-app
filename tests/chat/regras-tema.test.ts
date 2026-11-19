// "nas tarefas do tema X" (V02, Tarefa 17): a tarefa vai para a sala da pasta comum de nome X e leva o `pastaId` dela.
// Só a forma de lista ("nas tarefas do tema ...") conta; "sobre o tema" e afins seguem como antes. Nomes fictícios.
import { describe, expect, it } from 'vitest';
import { interpretarRegras, type Memoria, type Tema } from '../../src/chat/regras';

// Quinta-feira, como o relógio fixo dos testes.
const HOJE = '2026-11-05';

const semAcento = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const METODOLOGIA: Tema = { id: 'pasta-metodologia', nome: 'Metodologia', salaId: 'sala-doutoramento' };
const REVISAO: Tema = { id: 'pasta-revisao', nome: 'Revisão de Literatura', salaId: 'sala-doutoramento' };
const QUARTA: Tema = { id: 'pasta-quarta', nome: 'Quarta Etapa', salaId: 'sala-investigacao' };

function memoria(temas?: Tema[]): Memoria {
  const pessoas = [
    { id: 'p-marina', nome: 'Marina', salaId: 'sala-orientacoes', apelido: 'marina' },
    { id: 'p-souza', nome: 'Prof. Souza', salaId: 'sala-doutoramento', apelido: 'souza' },
  ];
  const palavras: [string, string][] = [['banheiro', 'sala-casa']];
  const tem = (frase: string, termo: string) => new RegExp(`(?<![a-z])${termo}(?![a-z])`).test(semAcento(frase));
  return {
    acharPessoa(frase) {
      const p = pessoas.find((x) => tem(frase, x.apelido));
      return p ? { id: p.id, nome: p.nome, salaId: p.salaId } : null;
    },
    acharSala(frase) {
      return palavras.find(([termo]) => tem(frase, termo))?.[1] ?? null;
    },
    aprender() {},
    ...(temas ? { temas: () => temas } : {}),
  };
}

const um = (frase: string, temas?: Tema[]) => {
  const r = interpretarRegras(frase, HOJE, memoria(temas));
  expect(r.itens).toHaveLength(1);
  return { item: r.itens[0]!, certeza: r.certeza };
};

describe('"nas tarefas do tema X"', () => {
  it('cria a tarefa na sala da pasta, com o pastaId, e tira o tema do título', () => {
    const { item, certeza } = um('adicione revisar capítulo nas tarefas do tema Metodologia', [METODOLOGIA]);
    expect(item).toMatchObject({
      tipo: 'tarefa',
      titulo: 'Revisar capítulo',
      salaId: 'sala-doutoramento',
      pastaId: 'pasta-metodologia',
      temaNome: 'Metodologia',
      motivoSala: 'tema',
      data: HOJE,
    });
    expect(item.temaNaoAchado).toBeUndefined();
    expect(certeza).toBe('alta');
  });

  it('o nome casa sem ligar para maiúscula e acento, nas duas direções', () => {
    expect(um('adicione revisar capítulo nas tarefas do tema metodologia', [METODOLOGIA]).item.pastaId).toBe('pasta-metodologia');
    expect(um('adicione ler artigos nas tarefas do tema REVISAO DE LITERATURA', [REVISAO]).item.pastaId).toBe('pasta-revisao');
    const comAcento = { ...METODOLOGIA, nome: 'Metodológia' };
    expect(um('adicione revisar capítulo nas tarefas do tema metodologia', [comAcento]).item.pastaId).toBe('pasta-metodologia');
  });

  it('nome de várias palavras, e o dia dito depois do nome continua valendo', () => {
    const { item } = um('adicione ler artigos nas tarefas do tema Revisão de Literatura amanhã', [REVISAO]);
    expect(item).toMatchObject({ titulo: 'Ler artigos', pastaId: 'pasta-revisao', data: '2026-11-06' });
  });

  it('o nome da pasta não é lido como dia ("Quarta Etapa" não é quarta-feira)', () => {
    const { item } = um('adicione ler capítulo nas tarefas do tema Quarta Etapa', [QUARTA]);
    expect(item).toMatchObject({ titulo: 'Ler capítulo', pastaId: 'pasta-quarta', salaId: 'sala-investigacao', data: HOJE });
  });

  it('o pedido continua depois do nome: o nome da pasta é só o que bate, o resto fica no título', () => {
    const { item } = um('adicione nas tarefas do tema Metodologia revisar o capítulo dois', [METODOLOGIA]);
    expect(item).toMatchObject({ titulo: 'Revisar o capítulo dois', pastaId: 'pasta-metodologia' });
  });

  it('o nome inteiro vale: "Metodologia" não casa com "Metodologias"', () => {
    const { item } = um('adicione revisar nas tarefas do tema Metodologias', [METODOLOGIA]);
    expect(item.pastaId).toBeUndefined();
    expect(item.temaNaoAchado).toBe('Metodologias');
  });

  it('dia e hora com "tarefas" continuam fazendo tarefa com hora, já com o tema', () => {
    const { item } = um('adicione revisar capítulo nas tarefas do tema Metodologia amanhã às 10h', [METODOLOGIA]);
    expect(item).toMatchObject({ tipo: 'tarefa', titulo: 'Revisar capítulo', data: '2026-11-06', inicio: '10:00', pastaId: 'pasta-metodologia' });
  });

  it('"para as tarefas do tema" também vale', () => {
    const { item } = um('adicione ler resumo para as tarefas do tema Metodologia', [METODOLOGIA]);
    expect(item).toMatchObject({ titulo: 'Ler resumo', pastaId: 'pasta-metodologia' });
  });

  it('duas pastas com o mesmo nome em salas diferentes: vale a sala dita na frase', () => {
    const outra: Tema = { id: 'pasta-metodologia-2', nome: 'Metodologia', salaId: 'sala-investigacao' };
    const { item, certeza } = um('adicione revisar capítulo da investigação nas tarefas do tema Metodologia', [METODOLOGIA, outra]);
    expect(item).toMatchObject({ pastaId: 'pasta-metodologia-2', salaId: 'sala-investigacao' });
    expect(certeza).toBe('alta');
  });

  it('duas pastas com o mesmo nome e nenhuma sala dita: fica com a primeira e pede para conferir o cartão', () => {
    const outra: Tema = { id: 'pasta-metodologia-2', nome: 'Metodologia', salaId: 'sala-investigacao' };
    const { item, certeza } = um('adicione revisar capítulo nas tarefas do tema Metodologia', [METODOLOGIA, outra]);
    expect(item.pastaId).toBe('pasta-metodologia');
    expect(certeza).toBe('baixa');
  });
});

describe('sala dita diferente da sala do tema', () => {
  it('a pasta manda na sala, mas o cartão pede para conferir', () => {
    const aurora: Tema = { id: 'pasta-aurora', nome: 'Aurora', salaId: 'sala-investigacao' };
    const { item, certeza } = um('adicione revisar texto do doutoramento nas tarefas do tema Aurora', [aurora]);
    expect(item).toMatchObject({ pastaId: 'pasta-aurora', salaId: 'sala-investigacao', motivoSala: 'tema' });
    expect(certeza).toBe('baixa');
  });

  it('sala dita igual à da pasta: certeza alta', () => {
    const { certeza } = um('adicione revisar texto do doutoramento nas tarefas do tema Metodologia', [METODOLOGIA]);
    expect(certeza).toBe('alta');
  });
});

describe('fim do nome de um tema que não existe', () => {
  it('não termina em de/da/do/dos/das, e o corte pelo limite de palavras pede conferência', () => {
    const { item, certeza } = um('adicione ler texto nas tarefas do tema Teste Final de Etapa Longa', []);
    expect(item.temaNaoAchado).toBe('Teste Final');
    expect(certeza).toBe('baixa');
  });

  it('nome que acaba antes de "de" no fim da frase não leva o conector', () => {
    expect(um('adicione ler texto nas tarefas do tema Estudos de', []).item.temaNaoAchado).toBe('Estudos');
  });

  it('"sem prazo" depois do nome não entra nele e continua valendo como Sem prazo', () => {
    const a = um('adicione ler texto nas tarefas do tema Inexistente sem prazo', []);
    expect(a.item).toMatchObject({ titulo: 'Ler texto', temaNaoAchado: 'Inexistente', data: undefined });
    expect(a.certeza).toBe('alta');
    const b = um('adicione ler texto nas tarefas do tema Qualquer coisa sem prazo', []);
    expect(b.item).toMatchObject({ titulo: 'Ler texto', temaNaoAchado: 'Qualquer coisa', data: undefined });
  });

  it('"até" depois do nome começa o prazo, não o nome', () => {
    const { item } = um('adicione ler texto nas tarefas do tema Inexistente até sexta', []);
    expect(item.temaNaoAchado).toBe('Inexistente');
    expect(item.data).toBe('2026-11-06');
  });

  it('nome curto no fim da frase não pede conferência', () => {
    expect(um('adicione ler texto nas tarefas do tema Revisão de Literatura', []).certeza).toBe('alta');
  });
});

describe('tema que não existe', () => {
  it('a tarefa fica sem pasta, com o nome do tema para o cartão avisar', () => {
    const { item } = um('adicione revisar capítulo nas tarefas do tema Metodologia', []);
    expect(item).toMatchObject({ tipo: 'tarefa', titulo: 'Revisar capítulo', salaId: null, temaNaoAchado: 'Metodologia', data: HOJE });
    expect(item.pastaId).toBeUndefined();
  });

  it('memória sem a lista de temas faz o mesmo', () => {
    expect(um('adicione revisar capítulo nas tarefas do tema Metodologia').item.temaNaoAchado).toBe('Metodologia');
  });

  it('o resto da frase decide a sala, como sempre', () => {
    const { item } = um('adicione revisar capítulo do doutoramento nas tarefas do tema Inexistente', []);
    expect(item).toMatchObject({ salaId: 'sala-doutoramento', motivoSala: 'frase', temaNaoAchado: 'Inexistente' });
  });

  it('nome de várias palavras no fim da frase e dia depois dele', () => {
    expect(um('adicione ler texto nas tarefas do tema Revisão de Literatura', []).item.temaNaoAchado).toBe('Revisão de Literatura');
    const { item } = um('adicione ler texto nas tarefas do tema Estudos Piloto amanhã', []);
    expect(item).toMatchObject({ titulo: 'Ler texto', temaNaoAchado: 'Estudos Piloto', data: '2026-11-06' });
  });

  it('um verbo depois do nome começa o pedido: não entra no nome do tema', () => {
    const { item } = um('adicione nas tarefas do tema Inexistente revisar o capítulo dois', []);
    expect(item).toMatchObject({ titulo: 'Revisar o capítulo dois', temaNaoAchado: 'Inexistente' });
  });
});

describe('não sequestra outras frases', () => {
  const FRASES = [
    'Adicione em atividades do dia mandar mensagem para Renata',
    'Adicione reunião sobre o projeto na sexta feira com inicio às 11:00 e termino 12:00',
    'Adicione Revisar paragrafo do relatório 1 nas tarefas do doutoramento',
    'Preciso parafusar o apoio do banheiro',
    'Marcar reunião com a Marina',
    'Reunião sobre o tema Metodologia amanhã às 10h',
    'Adicione estudar o tema Metodologia',
    'Adicione discutir o tema da tese com o Prof. Souza',
    'Adicione revisar capítulo nas tarefas do doutoramento',
  ];

  it.each(FRASES)('"%s" fica igual com e sem pastas de tema', (frase) => {
    const com = interpretarRegras(frase, HOJE, memoria([METODOLOGIA, REVISAO, QUARTA, { id: 'pasta-dout', nome: 'Doutoramento', salaId: 'sala-doutoramento' }]));
    const sem = interpretarRegras(frase, HOJE, memoria());
    expect(com).toEqual(sem);
    for (const item of com.itens) {
      expect(item.pastaId).toBeUndefined();
      expect(item.temaNaoAchado).toBeUndefined();
    }
  });
});
