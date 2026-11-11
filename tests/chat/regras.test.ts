import { describe, expect, it } from 'vitest';
import { interpretarRegras, type Memoria } from '../../src/chat/regras';

// Quinta-feira, como o relógio fixo dos testes (restrições globais).
const HOJE = '2026-11-05';

const semAcento = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Memória falsa, em memória: só o que as regras precisam consultar. */
function memoriaFalsa(): Memoria & { aprendidos: [string, string][] } {
  const pessoas = [
    { id: 'p-marina', nome: 'Marina', salaId: 'sala-orientacoes', apelidos: ['marina', 'mari'] },
    { id: 'p-souza', nome: 'Prof. Souza', salaId: 'sala-doutoramento', apelidos: ['souza'] },
    { id: 'p-aurora', nome: 'Aurora', salaId: 'sala-mba', apelidos: ['aurora'] },
  ];
  const palavras: [string, string][] = [['banheiro', 'sala-casa']];
  const aprendidos: [string, string][] = [];
  const temPalavra = (frase: string, termo: string) =>
    new RegExp(`(?<![a-z])${termo}(?![a-z])`).test(semAcento(frase));
  return {
    aprendidos,
    acharPessoa(frase) {
      const p = pessoas.find((x) => x.apelidos.some((a) => temPalavra(frase, a)));
      return p ? { id: p.id, nome: p.nome, salaId: p.salaId } : null;
    },
    acharSala(frase) {
      const achada = [...palavras, ...aprendidos].find(([termo]) => temPalavra(frase, termo));
      return achada ? achada[1] : null;
    },
    aprender(termo, salaId) {
      aprendidos.push([termo, salaId]);
    },
  };
}

const interpretar = (frase: string, hoje = HOJE) => interpretarRegras(frase, hoje, memoriaFalsa());

function um(frase: string, hoje = HOJE) {
  const r = interpretar(frase, hoje);
  expect(r.vazia).toBe(false);
  expect(r.itens).toHaveLength(1);
  return r.itens[0];
}

describe('interpretarRegras: casos do plano', () => {
  it('compromisso', () => expect(um('Adicione reunião sobre o projeto na sexta feira com inicio às 11:00 e termino 12:00'))
    .toMatchObject({tipo:'compromisso', data:'2026-11-06', inicio:'11:00', fim:'12:00'}));
  it('prazo', () => expect(um('entrega sexta 17h')).toMatchObject({tipo:'tarefa', data:'2026-11-06', prazoHora:'17:00'}));
  it('hoje', () => expect(um('Adicione em atividades do dia mandar mensagem para Renata'))
    .toMatchObject({tipo:'tarefa', titulo:'Mandar mensagem para Renata', data:'2026-11-05'}));
  it('sem dia: hoje', () => expect(um('Adicione Revisar paragrafo do relatório 1 nas tarefas do doutoramento'))
    .toMatchObject({titulo:'Revisar paragrafo do relatório 1', data:'2026-11-05'}));
  it('marcar', () => expect(um('Marcar reunião com a Marina')).toMatchObject({tipo:'tarefa', marcar:true, data:'2026-11-05'}));

  it.each(['', '   ', '\n\t '])('frase em branco %j dá vazia', (frase) => {
    const r = interpretar(frase);
    expect(r.vazia).toBe(true);
    expect(r.itens).toEqual([]);
  });

  it('asdf qwer dá certeza baixa', () => {
    const r = interpretar('asdf qwer');
    expect(r.vazia).toBe(false);
    expect(r.certeza).toBe('baixa');
  });

  it.each([
    ['letras', 'a'.repeat(2000)],
    ['números', '1'.repeat(2000)],
    ['dias', 'dia '.repeat(500)],
    ['horas soltas', 'as 1 '.repeat(400)],
    ['marcas sem hora', 'as '.repeat(667).slice(0, 2000)],
    ['faixas', 'das 1 as 2 '.repeat(182).slice(0, 2000)],
    ['início sem hora', 'com inicio as '.repeat(143).slice(0, 2000)],
    ['espaços', `reunião${' '.repeat(1985)}sexta 15h`],
    ['mistura', 'reunião sexta às 15h das 14 às 16 dia 12/11 até '.repeat(42).slice(0, 2000)],
    ['espaços e acentos', 'à  é  ç  '.repeat(222).slice(0, 2000)],
  ])('frase de 2.000 caracteres (%s) não trava', (_nome, frase) => {
    expect(frase.length).toBeGreaterThanOrEqual(1998);
    const t0 = performance.now();
    interpretar(frase);
    expect(performance.now() - t0).toBeLessThan(250);
  });
});

describe('frases do dono (spec, com nomes fictícios)', () => {
  it('pessoa desconhecida: tarefa de hoje, sem sala', () => {
    const r = interpretar('Adicione em atividades do dia mandar mensagem para Renata');
    expect(r.certeza).toBe('alta');
    expect(r.itens[0]).toMatchObject({ tipo: 'tarefa', salaId: null, marcar: false });
    expect(r.itens[0].pessoaId).toBeUndefined();
  });

  it('reunião na sexta das 11 às 12 sai como compromisso com título limpo', () => {
    const r = interpretar('Adicione reunião sobre o projeto na sexta feira com inicio às 11:00 e termino 12:00');
    expect(r.certeza).toBe('alta');
    expect(r.itens[0]).toEqual({
      tipo: 'compromisso', titulo: 'Reunião sobre o projeto', salaId: null,
      data: '2026-11-06', inicio: '11:00', fim: '12:00', marcar: false,
    });
  });

  it('nas tarefas do doutoramento: sala Doutoramento, hoje', () => {
    expect(um('Adicione Revisar paragrafo do relatório 1 nas tarefas do doutoramento')).toMatchObject({
      tipo: 'tarefa', salaId: 'sala-doutoramento', motivoSala: 'frase', marcar: false, data: '2026-11-05',
    });
  });

  it('palavra conhecida da memória decide a sala (banheiro → Casa)', () => {
    expect(um('Preciso parafusar o apoio do banheiro')).toEqual({
      tipo: 'tarefa', titulo: 'Preciso parafusar o apoio do banheiro', salaId: 'sala-casa',
      data: '2026-11-05', diaAssumido: true, marcar: false, motivoSala: 'memoria',
    });
  });

  it('marcar com pessoa conhecida: hoje, sala da pessoa, nome no título', () => {
    expect(um('Marcar reunião com a Marina')).toEqual({
      tipo: 'tarefa', titulo: 'Marcar reunião com a Marina', salaId: 'sala-orientacoes',
      data: '2026-11-05', marcar: true, pessoaId: 'p-marina', motivoSala: 'pessoa',
    });
  });
});

describe('dias', () => {
  it.each([
    ['ligar para a Renata hoje', '2026-11-05'],
    ['ligar para a Renata amanhã', '2026-11-06'],
    ['ligar para a Renata amanha', '2026-11-06'],
    ['ligar para a Renata depois de amanhã', '2026-11-07'],
    ['ligar para a Renata na sexta', '2026-11-06'],
    ['ligar para a Renata sexta-feira', '2026-11-06'],
    ['ligar para a Renata na sexta feira', '2026-11-06'],
    ['ligar para a Renata no sábado', '2026-11-07'],
    ['ligar para a Renata domingo', '2026-11-08'],
    ['ligar para a Renata na segunda', '2026-11-09'],
    ['ligar para a Renata terça-feira', '2026-11-10'],
    ['ligar para a Renata na terca', '2026-11-10'],
    ['ligar para a Renata quarta-feira', '2026-11-11'],
    ['ligar para a Renata na quinta', '2026-11-12'], // mesmo dia de hoje = semana que vem
    ['ligar para a Renata quinta-feira', '2026-11-12'],
    ['ligar para a Renata na sexta da próxima semana', '2026-11-13'],
    ['ligar para a Renata dia 12', '2026-11-12'],
    ['ligar para a Renata no dia 5', '2026-11-05'],
    ['ligar para a Renata dia 3', '2026-12-03'],
    ['ligar para a Renata dia 31', '2026-12-31'],
    ['ligar para a Renata 12/11', '2026-11-12'],
    ['ligar para a Renata em 01/02', '2027-02-01'],
    ['ligar para a Renata 12/11/2026', '2026-11-12'],
    ['ligar para a Renata 12/11/26', '2026-11-12'],
    ['ligar para a Renata 12-11-2026', '2026-11-12'],
    ['ligar para a Renata 2026-11-20', '2026-11-20'],
    ['ligar para a Renata dia 12 de novembro', '2026-11-12'],
    ['ligar para a Renata 3 de março', '2027-03-03'],
    ['ligar para a Renata 1º de dezembro', '2026-12-01'],
    ['ligar para a Renata daqui a 3 dias', '2026-11-08'],
  ])('%s → %s', (frase, data) => {
    const item = um(frase);
    expect(item).toMatchObject({ tipo: 'tarefa', data, titulo: 'Ligar para a Renata' });
    expect(interpretar(frase).certeza).toBe('alta');
  });

  it('11/12 é 11 de dezembro (dia/mês)', () => {
    expect(um('pagar conta 11/12').data).toBe('2026-12-11');
  });

  it('"dia 30" a partir de 31 de janeiro pula fevereiro', () => {
    expect(um('pagar conta dia 30', '2026-01-31').data).toBe('2026-03-30');
  });

  it('"dia 29" em fevereiro de ano não bissexto vai para março', () => {
    expect(um('pagar conta dia 29', '2026-02-10').data).toBe('2026-03-29');
  });

  it('domingo dito num domingo é o domingo seguinte', () => {
    expect(um('pagar conta domingo', '2026-11-08').data).toBe('2026-11-15');
    expect(um('pagar conta segunda', '2026-11-08').data).toBe('2026-11-09');
  });

  it('29/02 sem ano vai para o próximo ano bissexto', () => {
    expect(um('pagar conta 29/02').data).toBe('2028-02-29');
  });

  it('virada de ano: sexta a partir de uma quinta, 31 de dezembro', () => {
    expect(um('pagar conta sexta', '2026-12-31').data).toBe('2027-01-01');
    expect(um('pagar conta dia 2', '2026-12-31').data).toBe('2027-01-02');
  });

  it.each(['31/11', '30/02/2027', 'dia 32', '12/13'])('data que não existe (%s): fica hoje, com certeza baixa', (d) => {
    const r = interpretar(`pagar conta ${d}`);
    expect(r.itens[0].data).toBe(HOJE);
    expect(r.certeza).toBe('baixa');
  });

  it('data com ano já passado fica, mas com certeza baixa', () => {
    const r = interpretar('pagar conta 12/11/2025');
    expect(r.itens[0].data).toBe('2025-11-12');
    expect(r.certeza).toBe('baixa');
  });

  it('esta semana e semana que vem viram semana (segunda-feira)', () => {
    expect(um('revisar o capítulo esta semana')).toMatchObject({ semana: '2026-11-02', data: undefined, titulo: 'Revisar o capítulo' });
    expect(um('revisar o capítulo na próxima semana')).toMatchObject({ semana: '2026-11-09', titulo: 'Revisar o capítulo' });
    expect(um('revisar o capítulo semana que vem')).toMatchObject({ semana: '2026-11-09' });
  });

  it('ordinais não viram dia da semana', () => {
    // Sem dia dito, a tarefa é de hoje (quinta), não da segunda, quinta ou sexta que vêm.
    expect(um('Revisar a segunda versão do artigo')).toMatchObject({ data: HOJE, titulo: 'Revisar a segunda versão do artigo' });
    expect(um('Ler a quinta parte do livro').data).toBe(HOJE);
    expect(um('Ler da sexta página em diante').data).toBe(HOJE);
  });

  it('dois dias diferentes: fica o primeiro, certeza baixa', () => {
    const r = interpretar('reunião sexta às 10h e segunda às 15h');
    expect(r.itens[0]).toMatchObject({ data: '2026-11-06', inicio: '10:00' });
    expect(r.certeza).toBe('baixa');
  });

  it('do dia seguido de número não é hoje', () => {
    expect(um('reunião do dia 12 às 15h')).toMatchObject({ tipo: 'compromisso', data: '2026-11-12', inicio: '15:00' });
  });
});

describe('horas', () => {
  it.each([
    ['reunião sexta às 15h', '15:00', '16:00'],
    ['reunião sexta as 15h', '15:00', '16:00'],
    ['reunião sexta 15:30', '15:30', '16:30'],
    ['reunião sexta 15h30', '15:30', '16:30'],
    ['reunião sexta às 15h30min', '15:30', '16:30'],
    ['reunião sexta às 15 horas', '15:00', '16:00'],
    ['reunião sexta às 15', '15:00', '16:00'],
    ['reunião sexta das 14 às 16', '14:00', '16:00'],
    ['reunião sexta das 14h às 16h', '14:00', '16:00'],
    ['reunião sexta das 14 até as 16', '14:00', '16:00'],
    ['reunião sexta de 14h a 16h', '14:00', '16:00'],
    ['reunião sexta 14h-16h', '14:00', '16:00'],
    ['reunião sexta 14:00 - 15:30', '14:00', '15:30'],
    ['reunião sexta início às 11:00 e término 12:00', '11:00', '12:00'],
    ['reunião sexta inicio as 11h termino as 12h30', '11:00', '12:30'],
    ['reunião sexta pelas 15h', '15:00', '16:00'],
    ['reunião sexta às 3', '15:00', '16:00'],
    ['reunião sexta às 7', '19:00', '20:00'],
    ['reunião sexta às 1', '13:00', '14:00'],
    ['reunião sexta às 8', '08:00', '09:00'],
    ['reunião sexta às 3 da tarde', '15:00', '16:00'],
    ['reunião sexta às 9 da manhã', '09:00', '10:00'],
    ['reunião sexta às 8 da noite', '20:00', '21:00'],
    ['reunião sexta ao meio-dia', '12:00', '13:00'],
    ['reunião sexta às 0h', '00:00', '01:00'],
    ['reunião sexta às 23:30', '23:30', '23:59'],
    ['reunião sexta das 2 às 4', '14:00', '16:00'],
  ])('%s → %s–%s', (frase, inicio, fim) => {
    expect(um(frase)).toMatchObject({ tipo: 'compromisso', data: '2026-11-06', inicio, fim, titulo: 'Reunião' });
    expect(interpretar(frase).certeza).toBe('alta');
  });

  it('PT-PT: "sexta-feira, às 15h00"', () => {
    expect(um('Reunião de orientação sexta-feira, às 15h00')).toMatchObject({
      tipo: 'compromisso', data: '2026-11-06', inicio: '15:00', salaId: 'sala-orientacoes', titulo: 'Reunião de orientação',
    });
  });

  it('hora antes do dia também vale', () => {
    expect(um('Às 10h amanhã reunião com Prof. Souza')).toMatchObject({
      tipo: 'compromisso', data: '2026-11-06', inicio: '10:00', titulo: 'Reunião com Prof. Souza',
      pessoaId: 'p-souza', salaId: 'sala-doutoramento',
    });
  });

  it('números que não são hora', () => {
    expect(um('Revisar as 3 seções do capítulo sexta')).toMatchObject({ tipo: 'tarefa', data: '2026-11-06', titulo: 'Revisar as 3 seções do capítulo' });
    expect(um('Ler capítulo 7 amanhã')).toMatchObject({ tipo: 'tarefa', data: '2026-11-06', titulo: 'Ler capítulo 7' });
    expect(um('Ler de 3 a 5 artigos amanhã')).toMatchObject({ tipo: 'tarefa', titulo: 'Ler de 3 a 5 artigos' });
  });

  it('duas horas ligadas por "e" não são faixa: fica a primeira, certeza baixa', () => {
    const r = interpretar('Reunião sexta 10h e 15h');
    expect(r.itens[0]).toMatchObject({ inicio: '10:00', fim: '11:00' });
    expect(r.certeza).toBe('baixa');
  });

  it('fração com unidade não é data', () => {
    expect(um('Comprar 1/2 kg de café')).toMatchObject({ data: HOJE, titulo: 'Comprar 1/2 kg de café' });
  });

  it.each(['Pagar R$ 12/11 ao banco', 'Pagar R$12/11 ao banco', 'Pagar $ 10/12 ao banco'])(
    'valor em dinheiro não é data (%s)', (frase) => {
      expect(um(frase).data).toBe(HOJE);
    });

  it.each(['às 25h', 'às 24h', '24h', 'às 25:00', '15:60', 'às 15:60'])(
    'hora inválida (%s): não vira compromisso e certeza baixa', (h) => {
      const r = interpretar(`reunião sexta ${h}`);
      expect(r.itens[0].tipo).toBe('tarefa');
      expect(r.certeza).toBe('baixa');
    });

  it('número solto que não é hora não baixa a certeza', () => {
    expect(interpretar('Ler capítulo 25 sexta').certeza).toBe('alta');
  });

  it.each([
    ['reunião sexta à 15h', '15:00'],
    ['reunião sexta à 3', '15:00'],
    ['reunião sexta à 15:30', '15:30'],
  ])('crase por engano antes da hora (%s)', (frase, inicio) => {
    expect(um(frase)).toMatchObject({ tipo: 'compromisso', data: '2026-11-06', inicio, titulo: 'Reunião' });
    expect(interpretar(frase).certeza).toBe('alta');
  });

  it.each([
    ['reunião sexta das 7 às 9', '07:00', '09:00'],
    ['reunião sexta das 5 às 8', '05:00', '08:00'],
    ['reunião sexta início às 7 e término 9', '07:00', '09:00'],
    ['reunião sexta das 5 às 7', '17:00', '19:00'],
    ['reunião sexta das 11 às 1', '11:00', '13:00'],
  ])('faixa: a tarde só vale se o fim continuar depois do início (%s)', (frase, inicio, fim) => {
    expect(um(frase)).toMatchObject({ tipo: 'compromisso', inicio, fim });
    expect(interpretar(frase).certeza).toBe('alta');
  });

  it('fim antes do início: 1 hora e certeza baixa', () => {
    const r = interpretar('reunião sexta das 16h às 14h');
    expect(r.itens[0]).toMatchObject({ inicio: '16:00', fim: '17:00' });
    expect(r.certeza).toBe('baixa');
  });
});

describe('tarefa com prazo', () => {
  it.each([
    ['Entregar relatório até sexta', { data: '2026-11-06', titulo: 'Entregar relatório' }],
    ['Entregar relatório até sexta às 18h', { data: '2026-11-06', prazoHora: '18:00', titulo: 'Entregar relatório' }],
    ['prazo do artigo dia 12 às 18h', { data: '2026-11-12', prazoHora: '18:00', titulo: 'Prazo do artigo' }],
    ['Mandar e-mail para Prof. Souza até amanhã 10h', { data: '2026-11-06', prazoHora: '10:00', titulo: 'Mandar e-mail para Prof. Souza' }],
    ['enviar resumo até as 17h de hoje', { data: '2026-11-05', prazoHora: '17:00', titulo: 'Enviar resumo' }],
  ])('%s', (frase, esperado) => {
    const item = um(frase);
    expect(item).toMatchObject({ tipo: 'tarefa', ...esperado });
    expect(item.inicio).toBeUndefined();
  });

  it('"até" entre duas horas não é prazo', () => {
    expect(um('aula sexta das 9h até 11h').tipo).toBe('compromisso');
  });

  it('"até" sem dia nem hora logo depois não é prazo', () => {
    expect(um('Reunião sexta 10h, vou ficar até tarde')).toMatchObject({
      tipo: 'compromisso', data: '2026-11-06', inicio: '10:00', fim: '11:00',
    });
  });
});

describe('marcar', () => {
  it('marcar com dia e hora vira compromisso, sem marcar', () => {
    expect(um('Marcar dentista sexta 10h')).toMatchObject({ tipo: 'compromisso', marcar: false, inicio: '10:00' });
  });
  it('marcar com dia sem hora: tarefa de marcar naquele dia', () => {
    expect(um('Marcar reunião com a Aurora na segunda')).toMatchObject({ tipo: 'tarefa', marcar: true, data: '2026-11-09' });
  });
  it('marcar depois do comando também conta', () => {
    expect(um('Adicione marcar consulta')).toMatchObject({ titulo: 'Marcar consulta', marcar: true, data: '2026-11-05' });
  });
  it('"marcador" não é marcar', () => {
    expect(um('Comprar marcador de texto')).toMatchObject({ marcar: false, data: HOJE });
  });
});

describe('salas', () => {
  it.each([
    ['Preparar aula de quinta-feira', 'sala-aulas'],
    ['Aula do MBA sexta às 19h', 'sala-mba'],
    ['Ler artigo para a investigação', 'sala-investigacao'],
    ['Ler artigo para a investigacao', 'sala-investigacao'],
    ['Reunião de orientações', 'sala-orientacoes'],
    ['Tarefa pessoal: renovar passaporte', 'sala-pessoal'],
    ['Limpar a casa', 'sala-casa'],
    ['Revisar capítulo do DOUTORAMENTO', 'sala-doutoramento'],
    ['Comprar presente de casamento', null],
  ])('%s → %s', (frase, sala) => {
    expect(um(frase).salaId).toBe(sala);
  });

  it('a sala citada na frase vence a memória e a pessoa', () => {
    expect(um('Falar com a Marina sobre o banheiro nas tarefas de casa')).toMatchObject({
      salaId: 'sala-casa', motivoSala: 'frase', pessoaId: 'p-marina', titulo: 'Falar com a Marina sobre o banheiro',
    });
    expect(um('Ligar para a Marina, assunto do doutoramento')).toMatchObject({ salaId: 'sala-doutoramento', motivoSala: 'frase' });
  });

  it('a memória vence a pessoa', () => {
    expect(um('Ver o banheiro com a Marina')).toMatchObject({ salaId: 'sala-casa', motivoSala: 'memoria', pessoaId: 'p-marina' });
  });

  it('na sala de aulas sai do título', () => {
    expect(um('Adicione corrigir provas na sala de aulas')).toMatchObject({ titulo: 'Corrigir provas', salaId: 'sala-aulas' });
  });
});

describe('título', () => {
  it('apelido da pessoa: o nome cadastrado entra no título', () => {
    expect(um('Ligar para a Mari amanhã')).toMatchObject({ titulo: 'Ligar para a Mari (Marina)', pessoaId: 'p-marina' });
  });

  it('nome já no título não se repete; "Prof." conta como parte do nome', () => {
    expect(um('Mandar e-mail ao Souza').titulo).toBe('Mandar e-mail ao Souza');
  });

  it('sem espaço antes da pontuação quando um trecho sai', () => {
    expect(um('Reunião sexta às 15h, na sala 2').titulo).toBe('Reunião, na sala 2');
    expect(um('Ligar para a Renata amanhã; levar o livro').titulo).toBe('Ligar para a Renata; levar o livro');
  });

  it('título de reserva também começa com maiúscula', () => {
    const r = interpretar('adicione');
    expect(r.itens[0].titulo).toBe('Adicione');
    expect(r.certeza).toBe('baixa');
  });

  it.each(['Adicione atividades: revisar slides', 'Adicione tarefas: revisar slides', 'adicione uma tarefa revisar slides'])(
    'comando com "tarefa(s)"/"atividade(s)" sai do título (%s)', (frase) => {
      expect(um(frase).titulo).toBe('Revisar slides');
    });

  it('trechos que se cruzam saem inteiros ("atividades" do comando e "atividades do dia")', () => {
    expect(um('Adicione atividades do dia mandar mensagem para Renata')).toMatchObject({
      titulo: 'Mandar mensagem para Renata', data: '2026-11-05',
    });
  });

  it('maiúscula só na primeira letra; o resto fica como escrito', () => {
    expect(um('adicione ler o artigo do Prof. Souza sobre PWA').titulo).toBe('Ler o artigo do Prof. Souza sobre PWA');
  });

  it('sem acento e em maiúsculas funciona igual', () => {
    expect(um('REUNIAO SEXTA AS 15H')).toMatchObject({ tipo: 'compromisso', data: '2026-11-06', inicio: '15:00', titulo: 'REUNIAO' });
  });

  it('frase só com dia e hora: título é a frase, certeza baixa', () => {
    const r = interpretar('amanhã 15h');
    expect(r.itens[0]).toMatchObject({ tipo: 'compromisso', titulo: 'Amanhã 15h' });
    expect(r.certeza).toBe('baixa');
  });

  it('acentos decompostos (NFD) são entendidos e o título sai em NFC', () => {
    // Escapes explícitos: "reunia" + til combinante + "o sexta a" + grave combinante + "s 15h".
    const nfd = 'reunia\u0303o sexta a\u0300s 15h';
    expect(nfd).not.toBe(nfd.normalize('NFC'));
    expect(um(nfd)).toMatchObject({ tipo: 'compromisso', inicio: '15:00', titulo: 'Reuni\u00e3o' });
  });

  it('emoji e caracteres especiais não quebram', () => {
    expect(um("🎓 Defesa sexta às 14h; sala 3 'OR 1=1 --")).toMatchObject({ tipo: 'compromisso', inicio: '14:00' });
  });
});

describe('certeza', () => {
  it.each(['Revisar o texto', 'reunião', 'Comprar pão', 'Preciso de ajuda'])('%s → alta', (f) => {
    expect(interpretar(f).certeza).toBe('alta');
  });
  it.each(['asdf qwer', 'xyz', '???', '123'])('%s → baixa', (f) => {
    const r = interpretar(f);
    expect(r.certeza).toBe('baixa');
    expect(r.itens).toHaveLength(1);
  });
  it('as regras nunca ensinam a memória', () => {
    const m = memoriaFalsa();
    interpretarRegras('Preciso parafusar o apoio do banheiro', HOJE, m);
    expect(m.aprendidos).toEqual([]);
  });
});

describe('decisões do dono (11/11): dia padrão, "sem prazo" e tarefa com hora', () => {
  it('tarefa sem dia na frase vai para hoje (volta todo dia até ser concluída)', () => {
    expect(um('Comprar pilhas')).toMatchObject({ tipo: 'tarefa', titulo: 'Comprar pilhas', data: HOJE });
    expect(um('Preciso parafusar o apoio do banheiro')).toMatchObject({ data: HOJE, salaId: 'sala-casa' });
    expect(um('Adicione Revisar paragrafo do relatório 1 nas tarefas do doutoramento'))
      .toMatchObject({ titulo: 'Revisar paragrafo do relatório 1', salaId: 'sala-doutoramento', data: HOJE });
  });

  it('semana dita continua semana, sem dia', () => {
    const item = um('revisar o capítulo esta semana');
    expect(item).toMatchObject({ semana: '2026-11-02' });
    expect(item.data).toBeUndefined();
  });

  it.each([
    ['Adicione comprar pilhas sem prazo', 'Comprar pilhas'],
    ['Sem prazo: comprar pilhas', 'Comprar pilhas'],
    ['comprar pilhas, sem prazo', 'Comprar pilhas'],
    ['Adicione nas tarefas sem prazo comprar pilhas', 'Comprar pilhas'],
    ['Comprar pilhas para sem prazo', 'Comprar pilhas'],
  ])('"sem prazo" na frase (%s): Sem prazo, e sai do título', (frase, titulo) => {
    const r = interpretar(frase);
    expect(r.itens[0]).toMatchObject({ tipo: 'tarefa', titulo });
    expect(r.itens[0].data).toBeUndefined();
    expect(r.itens[0].semana).toBeUndefined();
    expect(r.itens[0].prazoHora).toBeUndefined();
    expect(r.certeza).toBe('alta');
  });

  it.each([
    ['Adicione tarefa ligar para a Renata hoje às 18:00', 'Ligar para a Renata', HOJE, '18:00'],
    ['Adicione nas tarefas de hoje revisar o relatório às 18h', 'Revisar o relatório', HOJE, '18:00'],
    ['Adicione em atividades do dia mandar mensagem para Renata às 15h', 'Mandar mensagem para Renata', HOJE, '15:00'],
    ['Tarefa para hoje às 18h: enviar o relatório', 'Enviar o relatório', HOJE, '18:00'],
    ['Atividade amanhã às 9h: ler o artigo', 'Ler o artigo', '2026-11-06', '09:00'],
    ['Adicione revisar o capítulo nas tarefas do doutoramento sexta às 10h', 'Revisar o capítulo', '2026-11-06', '10:00'],
  ])('"tarefa/atividade" com dia e hora vira tarefa com hora (%s)', (frase, titulo, data, inicio) => {
    const r = interpretar(frase);
    expect(r.itens[0]).toMatchObject({ tipo: 'tarefa', titulo, data, inicio });
    expect(r.itens[0].prazoHora).toBeUndefined();
    expect(r.certeza).toBe('alta');
  });

  it.each([
    ['Adicione uma atividade amanhã às 9h: ler o artigo', 'Ler o artigo', '2026-11-06', '09:00'],
    ['Tarefas: ler o artigo amanhã às 9h', 'Ler o artigo', '2026-11-06', '09:00'],
    ['Atividade: ler o artigo amanhã às 9h', 'Ler o artigo', '2026-11-06', '09:00'],
    ['Adicione nas minhas tarefas ler o artigo amanhã às 9h', 'Ler o artigo', '2026-11-06', '09:00'],
  ])('forma de lista ou de comando também pede tarefa (%s)', (frase, titulo, data, inicio) => {
    expect(um(frase)).toMatchObject({ tipo: 'tarefa', titulo, data, inicio });
  });

  it.each([
    ['Reunião sobre as atividades do projeto sexta às 10h', '2026-11-06', '10:00'],
    ['atividade física amanhã às 8h', '2026-11-06', '08:00'],
    ['Revisar a tarefa 3 com a Renata sexta às 10h', '2026-11-06', '10:00'],
    ['Aula sobre tarefas de casa amanhã às 9h', '2026-11-06', '09:00'],
  ])('"tarefa/atividade" no meio do assunto não pede tarefa: segue compromisso (%s)', (frase, data, inicio) => {
    expect(um(frase)).toMatchObject({ tipo: 'compromisso', data, inicio });
  });

  it('tarefa com faixa de horas guarda o fim (a duração)', () => {
    expect(um('Tarefa sexta das 14h às 16h: revisar capítulo')).toMatchObject({
      tipo: 'tarefa', titulo: 'Revisar capítulo', data: '2026-11-06', inicio: '14:00', fim: '16:00',
    });
  });

  it('sem "tarefa/atividade", dia e hora seguem compromisso (frase real do dono)', () => {
    expect(um('Adicione reunião sobre o projeto na sexta feira com inicio às 11:00 e termino 12:00')).toMatchObject({
      tipo: 'compromisso', data: '2026-11-06', inicio: '11:00', fim: '12:00',
    });
    expect(um('Consulta no dentista amanhã às 9h')).toMatchObject({ tipo: 'compromisso', data: '2026-11-06', inicio: '09:00' });
    expect(um('Ligar para o banco hoje às 18h')).toMatchObject({ tipo: 'compromisso', data: HOJE, inicio: '18:00' });
  });

  it('hora sem dia: é hoje, com certeza baixa (o cartão mostra o dia que entendeu)', () => {
    const r = interpretar('Reunião às 15h');
    expect(r.itens[0]).toMatchObject({ tipo: 'compromisso', data: HOJE, inicio: '15:00', fim: '16:00', titulo: 'Reunião' });
    expect(r.certeza).toBe('baixa');
    const t = interpretar('Tarefa às 15h: revisar o resumo');
    expect(t.itens[0]).toMatchObject({ tipo: 'tarefa', data: HOJE, inicio: '15:00', titulo: 'Revisar o resumo' });
  });

  it('prazo continua prazo, mesmo com "tarefa" na frase', () => {
    expect(um('Tarefa: entregar relatório até sexta às 18h')).toMatchObject({
      tipo: 'tarefa', data: '2026-11-06', prazoHora: '18:00',
    });
  });
});
