import { describe, expect, it } from 'vitest';
import {
  CATEGORIAS_PADRAO,
  extrairGasto,
  extrairItensDeLista,
  extrairItensDeListaCurta,
  extrairLeitura,
  rotear,
} from '../../src/chat/roteador';

const HOJE = '2026-11-16';

describe('extrairGasto', () => {
  it('gasto: "gastei 5,50 hoje comprando salgado" → valor 5.5, €, hoje, descrição salgado', () => {
    const g = extrairGasto('gastei 5,50 hoje comprando salgado', HOJE)!;
    expect(g.valor).toBe(5.5);
    expect(g.moeda).toBe('€');
    expect(g.data).toBe(HOJE);
    expect(g.descricao).toBe('salgado');
    expect(g.avisos).toEqual([]);
  });

  it('gasto: formato brasileiro "1.250,75" e formato "1250.75" dão 1250.75', () => {
    expect(extrairGasto('paguei 1.250,75 de aluguel', HOJE)!.valor).toBe(1250.75);
    expect(extrairGasto('paguei 1250.75 de aluguel', HOJE)!.valor).toBe(1250.75);
    expect(extrairGasto('paguei 1,250.75 de aluguel', HOJE)!.valor).toBe(1250.75);
    expect(extrairGasto('paguei 1.250 de aluguel', HOJE)!.valor).toBe(1250);
    expect(extrairGasto('paguei 1250 de aluguel', HOJE)!.descricao).toBe('aluguel');
  });

  it('gasto: "gastei R$ 12 no mercado" → moeda R$ e aviso de moeda diferente de €', () => {
    const g = extrairGasto('gastei R$ 12 no mercado', HOJE)!;
    expect(g.moeda).toBe('R$');
    expect(g.valor).toBe(12);
    expect(g.avisos).toContain('moeda diferente de €');
    expect(g.descricao).toBe('mercado');
  });

  it('gasto: reconhece euros, reais e o símbolo colado', () => {
    expect(extrairGasto('gastei 5,5€ no café', HOJE)!.valor).toBe(5.5);
    expect(extrairGasto('gastei 8 reais no pão', HOJE)!.moeda).toBe('R$');
    expect(extrairGasto('gastei 8 euros no pão', HOJE)!.moeda).toBe('€');
  });

  it('gasto: sem número → null', () => {
    expect(extrairGasto('gastei muito no mercado', HOJE)).toBeNull();
    expect(extrairGasto('', HOJE)).toBeNull();
  });

  it('gasto: número sem verbo de dinheiro nem moeda → null (reunião às 11)', () => {
    expect(extrairGasto('reunião na sexta às 11', HOJE)).toBeNull();
    expect(extrairGasto('comprei 3 maçãs', HOJE)).toBeNull();
  });

  it('gasto: valor zero → null', () => {
    expect(extrairGasto('gastei 0 no mercado', HOJE)).toBeNull();
  });

  it('gasto: data futura → avisos contém "data futura"', () => {
    const g = extrairGasto('gastei 20 no dia 30/11 com gasolina', HOJE)!;
    expect(g.data).toBe('2026-11-30');
    expect(g.avisos).toContain('data futura');
  });

  it('gasto: "ontem" e dd/mm sem ano usam o ano de hoje; dd/mm/aaaa vale', () => {
    expect(extrairGasto('gastei 5 ontem no café', HOJE)!.data).toBe('2026-11-15');
    expect(extrairGasto('gastei 5 dia 10/11 no café', HOJE)!.data).toBe('2026-11-10');
    expect(extrairGasto('gastei 5 em 01/03/2025 no café', HOJE)!.data).toBe('2025-03-01');
    expect(extrairGasto('gastei 5 em 01/03/25 no café', HOJE)!.data).toBe('2025-03-01');
  });

  it('gasto: a data escrita não vira valor ("gastei 12/11 ...")', () => {
    const g = extrairGasto('gastei 7,30 em 12/11 no café', HOJE)!;
    expect(g.valor).toBe(7.3);
    expect(g.data).toBe('2026-11-12');
  });

  it('gasto: data inexistente cai em hoje com aviso', () => {
    const g = extrairGasto('gastei 5 em 31/11 no café', HOJE)!;
    expect(g.data).toBe(HOJE);
    expect(g.avisos).toContain('data inválida');
  });

  it('gasto: hora escrita não vira valor', () => {
    expect(extrairGasto('paguei 15 às 10h no estacionamento', HOJE)!.valor).toBe(15);
  });

  it('gasto: categoria por palavra-chave; sem pista, null', () => {
    expect(extrairGasto('gastei 5 no salgado', HOJE)!.categoria).toBe('Alimentação');
    expect(extrairGasto('gastei 40 de gasolina', HOJE)!.categoria).toBe('Transporte');
    expect(extrairGasto('gastei 40 numa coisa', HOJE)!.categoria).toBeNull();
  });

  it('CATEGORIAS_PADRAO é genérica (sem nomes de pessoas)', () => {
    expect(Object.keys(CATEGORIAS_PADRAO).length).toBeGreaterThan(3);
    expect(JSON.stringify(CATEGORIAS_PADRAO)).not.toMatch(/marina|renata|souza|aurora/i);
  });

  it('gasto: frase vazia, só pontuação ou com mais de 2000 caracteres → null', () => {
    expect(extrairGasto('...', HOJE)).toBeNull();
    expect(extrairGasto('gastei 5 ' + 'a'.repeat(2000), HOJE)).toBeNull();
  });
});

describe('extrairLeitura', () => {
  it('leitura: consumo de água até 16/11 é 40 metros cúbicos', () => {
    expect(extrairLeitura('o consumo de água até o dia 16/11 é 40 metros cúbicos', HOJE)).toEqual({
      servico: 'agua', valor: 40, unidade: 'm³', data: '2026-11-16', avisos: [],
    });
  });

  it('leitura: "luz 12345 kWh" → luz/kWh; "gás 120 m³" → gas', () => {
    const l = extrairLeitura('luz 12345 kWh', HOJE)!;
    expect(l.servico).toBe('luz');
    expect(l.unidade).toBe('kWh');
    expect(l.valor).toBe(12345);
    expect(l.data).toBe(HOJE);
    const g = extrairLeitura('gás 120 m³', HOJE)!;
    expect(g.servico).toBe('gas');
    expect(g.unidade).toBe('m³');
    expect(extrairLeitura('gás 120 m3', HOJE)!.valor).toBe(120);
  });

  it('leitura: números em formato brasileiro', () => {
    expect(extrairLeitura('luz 12.345,5 kWh', HOJE)!.valor).toBe(12345.5);
    expect(extrairLeitura('água 40,25 m³', HOJE)!.valor).toBe(40.25);
  });

  it('leitura: palavra "leitura" dispensa a unidade', () => {
    expect(extrairLeitura('leitura de água 40', HOJE)!.valor).toBe(40);
  });

  it('leitura: sem unidade nem palavra de leitura → null', () => {
    expect(extrairLeitura('água 40', HOJE)).toBeNull();
    expect(extrairLeitura('acender a luz às 5', HOJE)).toBeNull();
  });

  it('leitura: sem serviço ou sem número → null', () => {
    expect(extrairLeitura('leitura 40 kWh', HOJE)).toBeNull();
    expect(extrairLeitura('leitura da luz', HOJE)).toBeNull();
  });

  it('leitura: valor negativo é recusado (nunca grava número negativo)', () => {
    expect(extrairLeitura('leitura da luz -5 kWh', HOJE)).toBeNull();
  });

  it('leitura: "ontem" e data futura', () => {
    expect(extrairLeitura('luz 100 kWh ontem', HOJE)!.data).toBe('2026-11-15');
    expect(extrairLeitura('luz 100 kWh dia 20/11', HOJE)!.avisos).toContain('data futura');
  });

  it('leitura: frase de pagamento não é leitura', () => {
    expect(extrairLeitura('paguei 40 de luz', HOJE)).toBeNull();
  });

  // Revisão da Tarefa 13 (achado 1): pedido, prazo e contagem de gente nunca viram leitura (na dúvida, caminho normal).
  it.each([
    'Mandar a leitura da água para a empresa até dia 10',
    'enviar leitura da luz dia 15',
    'trocar o contador de água dia 12',
    'a água está com consumo alto, 3 pessoas',
    'ligar para a empresa da água, leitura 3 vezes ao mês',
    'chamar o técnico para ver o contador de gás dia 8',
    'Adicione tarefa leitura da água 1234',
    'enviar leitura da luz 5000 kWh',
  ])('leitura: "%s" não é leitura', (frase) => {
    expect(extrairLeitura(frase, HOJE)).toBeNull();
    expect(rotear(frase, HOJE).tipo).not.toBe('leitura');
  });

  it('leitura: o número precisa estar junto da palavra de leitura ou da unidade', () => {
    expect(extrairLeitura('contador de água 1234', HOJE)!.valor).toBe(1234);
    expect(extrairLeitura('leitura da água hoje 1234', HOJE)!.valor).toBe(1234);
    expect(extrairLeitura('a leitura do contador de gás marca 120', HOJE)!.valor).toBe(120);
    // A palavra de leitura está longe do número: dúvida.
    expect(extrairLeitura('a leitura da água foi mencionada na reunião do prédio e depois falamos de muitas outras coisas até o número 7', HOJE)).toBeNull();
  });

  it('leitura: data dita mas não entendida avisa em vez de gravar hoje em silêncio', () => {
    for (const frase of ['leitura da água 1234 dia 3', 'leitura da água 1234 em 3 de novembro', 'leitura da água 1234 amanhã', 'leitura da água em 3 de novembro 1234']) {
      const l = extrairLeitura(frase, HOJE)!;
      expect(l.valor, frase).toBe(1234);
      expect(l.data, frase).toBe(HOJE);
      expect(l.avisos, frase).toContain('data inválida');
    }
    expect(extrairLeitura('leitura da água 1234', HOJE)!.avisos).toEqual([]);
    expect(extrairLeitura('leitura da água 1234 ontem', HOJE)!.avisos).toEqual([]);
  });

  it('leitura: vazia ou longa demais → null', () => {
    expect(extrairLeitura('', HOJE)).toBeNull();
    expect(extrairLeitura('luz 5 kWh ' + 'a'.repeat(2000), HOJE)).toBeNull();
  });
});

describe('extrairItensDeLista', () => {
  it('lista: "põe leite, pão e ovos nas compras da semana" → semanal', () => {
    expect(extrairItensDeLista('põe leite, pão e ovos nas compras da semana')).toEqual({
      lista: 'semanal', itens: ['leite', 'pão', 'ovos'],
    });
  });

  it('lista: "compras para casa: lâmpada" → casa', () => {
    expect(extrairItensDeLista('compras para casa: lâmpada')).toEqual({ lista: 'casa', itens: ['lâmpada'] });
  });

  it('lista: verbos variados e "lista da casa"', () => {
    expect(extrairItensDeLista('adicione fita isolante e pilhas na lista da casa')).toEqual({
      lista: 'casa', itens: ['fita isolante', 'pilhas'],
    });
    expect(extrairItensDeLista('lista de compras: arroz; feijão')).toEqual({
      lista: 'generica', itens: ['arroz', 'feijão'],
    });
  });

  it('lista: sem itens ou sem palavra de lista → null', () => {
    expect(extrairItensDeLista('compras da semana')).toBeNull();
    expect(extrairItensDeLista('reunião na sexta às 11')).toBeNull();
    expect(extrairItensDeLista('')).toBeNull();
  });

  it('lista: nomes das pastas padrão ("lista de compras para casa", "da semana", "semanais")', () => {
    expect(extrairItensDeLista('põe pilhas na lista de compras para casa')).toEqual({ lista: 'casa', itens: ['pilhas'] });
    expect(extrairItensDeLista('inclui sabão na lista de compras para casa')).toEqual({ lista: 'casa', itens: ['sabão'] });
    expect(extrairItensDeLista('coloca na lista de compras da semana: leite')).toEqual({ lista: 'semanal', itens: ['leite'] });
    expect(extrairItensDeLista('coloca detergente na lista de compras da semana')).toEqual({ lista: 'semanal', itens: ['detergente'] });
    expect(extrairItensDeLista('põe arroz na lista de compras semanais')).toEqual({ lista: 'semanal', itens: ['arroz'] });
    expect(extrairItensDeLista('adiciona azeite na lista de compras semanal')).toEqual({ lista: 'semanal', itens: ['azeite'] });
    expect(extrairItensDeLista('põe fita na lista de compras pra casa')).toEqual({ lista: 'casa', itens: ['fita'] });
  });

  it('lista: item que começa com preposição ou contém "lista" é recusado', () => {
    expect(extrairItensDeLista('põe na lista de compras da semana')).toBeNull();
    expect(extrairItensDeLista('da lista de compras para casa: de pilhas')).toBeNull();
  });

  it('lista: não repete itens e ignora vazios', () => {
    expect(extrairItensDeLista('põe leite, leite, , pão nas compras da semana')!.itens).toEqual(['leite', 'pão']);
  });
});

describe('rotear', () => {
  it('rotear: "reunião na sexta às 11" → outro', () => {
    expect(rotear('reunião na sexta às 11', HOJE)).toEqual({ tipo: 'outro' });
  });

  it('rotear: frase vazia ou só "..." → outro', () => {
    expect(rotear('', HOJE)).toEqual({ tipo: 'outro' });
    expect(rotear('   ', HOJE)).toEqual({ tipo: 'outro' });
    expect(rotear('...', HOJE)).toEqual({ tipo: 'outro' });
  });

  it('rotear: frase com 2001 caracteres → outro', () => {
    expect(rotear('gastei 5 no café ' + 'x'.repeat(2001 - 17), HOJE)).toEqual({ tipo: 'outro' });
    expect(rotear('x'.repeat(2001), HOJE)).toEqual({ tipo: 'outro' });
  });

  it('rotear: gasto, leitura e lista', () => {
    expect(rotear('gastei 5,50 hoje comprando salgado', HOJE).tipo).toBe('gasto');
    expect(rotear('luz 12345 kWh', HOJE).tipo).toBe('leitura');
    expect(rotear('põe leite e pão nas compras da semana', HOJE)).toEqual({
      tipo: 'lista', lista: 'semanal', itens: ['leite', 'pão'],
    });
  });

  it('rotear: "paguei 40 de luz" é gasto, não leitura', () => {
    expect(rotear('paguei 40 de luz', HOJE).tipo).toBe('gasto');
  });

  it('rotear: frases de tarefa e compromisso seguem como outro', () => {
    expect(rotear('Adicione Revisar parágrafo do relatório 1 nas tarefas do doutoramento', HOJE).tipo).toBe('outro');
    expect(rotear('Preciso parafusar o apoio do banheiro', HOJE).tipo).toBe('outro');
    expect(rotear('Marcar reunião com a Marina', HOJE).tipo).toBe('outro');
  });
});

describe('intenções não viram gasto (são tarefas ou compromissos)', () => {
  const INTENCOES = [
    'tenho que pagar o aluguel 500 euros',
    'preciso pagar 50 euros de internet',
    'vou pagar 30 euros ao dentista amanhã',
    'pagamento de 200 euros da mensalidade amanhã',
    'a consulta custa 50 euros, marcar',
    'reunião com a Renata 3 de dezembro, pago 20',
    'devo pagar 80 euros na sexta',
    'lembrar de pagar 12 euros da água',
  ];
  for (const f of INTENCOES) {
    it(`gasto: "${f}" → null e rotear → outro`, () => {
      expect(extrairGasto(f, HOJE)).toBeNull();
      expect(rotear(f, HOJE)).toEqual({ tipo: 'outro' });
    });
  }

  it('gasto: "pago" e "gasto" sozinhos são ambíguos; só com moeda', () => {
    expect(extrairGasto('pago 20 na reunião', HOJE)).toBeNull();
    expect(extrairGasto('gasto 20 com isso', HOJE)).toBeNull();
    expect(extrairGasto('gasto de 20 euros com isso', HOJE)!.valor).toBe(20);
  });

  it('gasto: data futura só vale com verbo no passado', () => {
    const g = extrairGasto('paguei 20 em 3/12 no estacionamento', HOJE)!;
    expect(g.data).toBe('2026-12-03');
    expect(g.avisos).toContain('data futura');
    expect(extrairGasto('20 euros do estacionamento em 3/12', HOJE)).toBeNull();
  });

  it('rotear: frases reais de tarefa e compromisso → outro', () => {
    for (const f of [
      'Adicione em atividades do dia mandar mensagem para Marina',
      'Adicione reunião sobre o projeto na sexta feira com inicio às 11:00 e termino 12:00',
      'Preciso parafusar o apoio do banheiro',
      'Marcar reunião com a Renata',
      'Adicione Revisar parágrafo do relatório 1 nas tarefas do doutoramento',
    ]) expect(rotear(f, HOJE)).toEqual({ tipo: 'outro' });
  });
});

describe('números ditados e moedas misturadas', () => {
  it('gasto: "5 e 50" → 5.5; por extenso "cinco e cinquenta" → 5.5', () => {
    expect(extrairGasto('gastei 5 e 50 no mercado', HOJE)!.valor).toBe(5.5);
    expect(extrairGasto('gastei cinco e cinquenta no mercado', HOJE)!.valor).toBe(5.5);
    expect(extrairGasto('gastei cinco e cinquenta no mercado', HOJE)!.descricao).toBe('mercado');
  });

  it('gasto: por extenso com dezenas e moeda', () => {
    expect(extrairGasto('gastei vinte euros', HOJE)!.valor).toBe(20);
    expect(extrairGasto('gastei vinte e cinco euros', HOJE)!.valor).toBe(25);
    expect(extrairGasto('gastei vinte e cinco e cinquenta no mercado', HOJE)!.valor).toBe(25.5);
    expect(extrairGasto('gastei dois euros no café', HOJE)!.valor).toBe(2);
  });

  it('gasto: dúvida (centenas, mil, cêntimos, "euros e N") → null, nunca valor parcial', () => {
    expect(extrairGasto('gastei cento e vinte euros', HOJE)).toBeNull();
    expect(extrairGasto('gastei dois mil euros', HOJE)).toBeNull();
    expect(extrairGasto('paguei 5 e 50 cêntimos', HOJE)).toBeNull();
    expect(extrairGasto('gastei 5 euros e 50 no mercado', HOJE)).toBeNull();
    expect(extrairGasto('gastei vinte e cinco e cinquenta e dez', HOJE)).toBeNull();
  });

  it('gasto: "um café" não é o número 1', () => {
    expect(extrairGasto('gastei 3 num café', HOJE)!.valor).toBe(3);
  });

  it('gasto: moedas misturadas → null', () => {
    expect(extrairGasto('gastei 30 reais e 20 euros', HOJE)).toBeNull();
  });
});

describe('vírgula e ponto, descrição limpa, lista sem roubar tarefa', () => {
  it('"1,250" é 1.25 e "1.250" é 1250 (vírgula sempre decimal; ponto com 3 dígitos é milhar)', () => {
    expect(extrairGasto('paguei 1,250 de aluguel', HOJE)!.valor).toBe(1.25);
    expect(extrairGasto('paguei 1.250 de aluguel', HOJE)!.valor).toBe(1250);
  });

  it('descrição sem preposições soltas nem pontuação sobrando', () => {
    const d = extrairGasto('gastei 12 euros, de, da padaria, ontem', HOJE)!.descricao;
    expect(d).toBe('padaria');
    expect(extrairGasto('gastei 12 euros no mercado com a Marina', HOJE)!.descricao).toBe('mercado com a Marina');
    expect(extrairGasto('gastei 12 euros de de padaria', HOJE)!.descricao).toBe('padaria');
  });

  it('lista: item que é tarefa ("ligar para o dentista") → null', () => {
    expect(extrairItensDeLista('anota ligar para o dentista na lista da casa')).toBeNull();
    expect(extrairItensDeLista('lista da casa: pagar internet')).toBeNull();
    expect(rotear('anota ligar para o dentista na lista da casa', HOJE)).toEqual({ tipo: 'outro' });
  });

  it('lista: "comprar" como item continua valendo', () => {
    expect(extrairItensDeLista('põe comprar pilhas na lista da casa')).toEqual({
      lista: 'casa', itens: ['comprar pilhas'],
    });
  });
});

describe('lista: frases comuns não são roubadas (Tarefa 14)', () => {
  it('"compras da semana" no meio de uma tarefa ou sem verbo de lista não vai para a planilha', () => {
    expect(extrairItensDeLista('preciso fazer as compras da semana')).toBeNull();
    expect(extrairItensDeLista('fiz as compras da semana')).toBeNull();
    expect(extrairItensDeLista('amanhã fazer as compras da semana')).toBeNull();
    expect(extrairItensDeLista('tarefa: fazer as compras da semana')).toBeNull();
    expect(extrairItensDeLista('lembrar de leite nas compras da semana')).toBeNull();
    expect(rotear('preciso fazer as compras da semana', HOJE)).toEqual({ tipo: 'outro' });
  });

  it('item que é compromisso, hora ou dia não é item de compra', () => {
    expect(extrairItensDeLista('põe a reunião com a Marina na lista da casa')).toBeNull();
    expect(extrairItensDeLista('põe leite amanhã na lista da casa')).toBeNull();
    expect(extrairItensDeLista('põe consulta às 10h na lista da casa')).toBeNull();
    expect(extrairItensDeLista('põe tarefa de leite na lista da casa')).toBeNull();
  });

  it('o pedido claro de lista continua valendo', () => {
    expect(extrairItensDeLista('põe leite e pão nas compras da semana')).toEqual({ lista: 'semanal', itens: ['leite', 'pão'] });
    expect(extrairItensDeLista('lista da casa: lâmpada')).toEqual({ lista: 'casa', itens: ['lâmpada'] });
  });
});

describe('extrairItensDeListaCurta (dentro de uma pasta de lista)', () => {
  it('"leite e pão" e itens com quantidade valem', () => {
    expect(extrairItensDeListaCurta('leite e pão')).toEqual(['leite', 'pão']);
    expect(extrairItensDeListaCurta('pão')).toEqual(['pão']);
    expect(extrairItensDeListaCurta('2 litros de leite, ovos')).toEqual(['2 litros de leite', 'ovos']);
    expect(extrairItensDeListaCurta('Leite, leite e pão.')).toEqual(['Leite', 'pão']);
  });

  it('o verbo de pedido de lista é tirado ("põe leite")', () => {
    expect(extrairItensDeListaCurta('põe leite')).toEqual(['leite']);
    expect(extrairItensDeListaCurta('adicione pão e ovos na lista')).toEqual(['pão', 'ovos']);
  });

  it.each([
    'comprar tampa para o ralo',
    'ligar para a Marina',
    'liguei para a Marina',
    'preciso de leite amanhã',
    'leite amanhã',
    'reunião sexta às 10h',
    '15',
    '10h',
    '5,50',
    '12/11',
    'dia 15',
    'gastei 5 euros no mercado',
    'adicione revisar o relatório nas tarefas',
    'lembrete de pagar a luz',
    'quando vence a conta?',
    'o que preciso fazer',
    'não esquecer o leite',
    'a Marina pediu para eu avisar a Renata sobre o leite',
    '   ',
    '...',
    'leite pão ovos manteiga queijo presunto tomate cebola alho arroz feijão',
  ])('"%s" não é lista: segue o caminho normal', (frase) => {
    expect(extrairItensDeListaCurta(frase)).toBeNull();
  });

  it('frase muito longa ou com item longo demais não é lista', () => {
    expect(extrairItensDeListaCurta('x'.repeat(200))).toBeNull();
    expect(extrairItensDeListaCurta('um texto bem comprido que ninguém diria como item de compra')).toBeNull();
  });
});

describe('lista: correções da revisão da Tarefa 14', () => {
  it.each([
    'põe no calendário a lista de compras da semana',
    'adiciona na agenda a lista de compras',
    'adicione na lista da casa limpar filtro',
    'lista da casa: limpar a janela',
    'lista de compras: ver preço',
    'adicione o relatório 1 na lista de compras',
    'põe roupa para lavar na lista da casa',
    'põe tinta pra pintar na lista da casa',
  ])('"%s" não é pedido de item de compra', (frase) => {
    expect(extrairItensDeLista(frase)).toBeNull();
    expect(rotear(frase, HOJE).tipo).toBe('outro');
  });

  it('item comprido demais ou lista com mais de 20 itens não é lista (nada some em silêncio)', () => {
    expect(extrairItensDeLista(`põe leite e ${'x'.repeat(81)} nas compras da semana`)).toBeNull();
    const vinte = Array.from({ length: 20 }, (_, i) => `item${String.fromCharCode(97 + i)}`);
    expect(extrairItensDeLista(`põe ${vinte.join(', ')} nas compras da semana`)!.itens).toHaveLength(20);
    expect(extrairItensDeLista(`põe ${[...vinte, 'itemu'].join(', ')} nas compras da semana`)).toBeNull();
  });

  it('"lista de compras" sem nome é genérica; "da semana" e "da casa" continuam com nome', () => {
    expect(extrairItensDeLista('põe leite na lista de compras')).toEqual({ lista: 'generica', itens: ['leite'] });
    expect(extrairItensDeLista('põe leite na lista da semana')!.lista).toBe('semanal');
    expect(extrairItensDeLista('põe leite nas compras da semana')!.lista).toBe('semanal');
    expect(extrairItensDeLista('põe leite na lista da casa')!.lista).toBe('casa');
  });

  it('o pedido de lista com item de compra e artigo continua valendo', () => {
    expect(extrairItensDeLista('põe o leite nas compras da semana')).toEqual({ lista: 'semanal', itens: ['o leite'] });
    expect(extrairItensDeLista('põe comprar pilhas na lista da casa')).toEqual({ lista: 'casa', itens: ['comprar pilhas'] });
  });

  it.each(['põe a roupa para lavar', 'ver filme', 'ver preço', 'ir ao mercado', 'ler o contrato', 'dar comida ao gato', 'tinta para pintar'])(
    '"%s" dentro da pasta de lista não vira item',
    (frase) => {
      expect(extrairItensDeListaCurta(frase)).toBeNull();
    },
  );

  it('substantivo que termina em -dor ou parecido não é infinitivo', () => {
    expect(extrairItensDeListaCurta('liquidificador')).toEqual(['liquidificador']);
    expect(extrairItensDeListaCurta('amaciador e condicionador')).toEqual(['amaciador', 'condicionador']);
    expect(extrairItensDeListaCurta('desentupidor, açúcar')).toEqual(['desentupidor', 'açúcar']);
    expect(extrairItensDeListaCurta('ração para cachorro')).toEqual(['ração para cachorro']);
  });
});

// Revisão da Tarefa 16: frase que não é gasto não pode virar gasto (sem moeda escrita, número de tempo ou de contagem).
describe('frases que não são gasto (sem moeda escrita)', () => {
  const NAO_SAO_GASTO = [
    'gastei 2 horas',
    'gastei 3 horas revisando o capítulo 2',
    'gastei 8 horas trabalhando',
    'gastei 90 minutos',
    'gastei 5 minutos',
    'gastei 1 hora',
    'gastei 2 dias',
    'gastei 3h no relatório',
    'gastei 2 semanas nisso',
    'gastei 2 vezes',
    'paguei 3 alunos',
    'paguei 2 aulas',
    'gastei 4 aulas',
    'paguei 15 de manhã',
    'gastei 3 de manhã',
    'gastei 40% do orçamento',
    'paguei 3 a Marina',
    'paguei 3 ao Prof. Souza',
    'paguei 3 pessoas',
  ];
  it.each(NAO_SAO_GASTO)('"%s" → null e rotear → outro', (f) => {
    expect(extrairGasto(f, HOJE)).toBeNull();
    expect(rotear(f, HOJE).tipo).toBe('outro');
  });

  it.each(['será que gastei 20 euros?', 'paguei 30 euros ao Prof. Souza?', 'tarefa: paguei 20 euros', 'lembrete paguei 20 euros', 'adicione gastei 20 euros'])(
    'pergunta ou pedido: "%s" → null',
    (f) => {
      expect(extrairGasto(f, HOJE)).toBeNull();
      expect(rotear(f, HOJE).tipo).toBe('outro');
    },
  );

  it('com moeda escrita junto do número a unidade de tempo perto não atrapalha', () => {
    expect(extrairGasto('gastei 3 horas e 20 euros no estacionamento', HOJE)!.valor).toBe(20);
    expect(extrairGasto('paguei 30 euros ao Prof. Souza', HOJE)!.valor).toBe(30);
  });

  it('os gastos de verdade seguem valendo', () => {
    expect(extrairGasto('gastei 5,50 hoje comprando salgado', HOJE)!.valor).toBe(5.5);
    expect(extrairGasto('paguei 30 euros de luz', HOJE)!.valor).toBe(30);
    expect(extrairGasto('gastei 12 no mercado', HOJE)!.valor).toBe(12);
    expect(extrairGasto('paguei 20 à padaria', HOJE)!.valor).toBe(20);
    expect(extrairGasto('paguei 15 às 10h no estacionamento', HOJE)!.valor).toBe(15);
    expect(extrairGasto('paguei 15 de aluguel', HOJE)!.valor).toBe(15);
    expect(extrairGasto('gastei 3 num café', HOJE)!.valor).toBe(3);
  });
});

// Sem moeda junto do número, só vale se a palavra seguinte for das permitidas (lista branca), ou se a frase acabar.
describe('gasto sem moeda: lista branca da palavra depois do número', () => {
  it.each(['paguei 2 contas', 'gastei 3 cafés', 'paguei 4 livros', 'comprei 2 pães', 'comprei 3 maçãs', 'gastei 2 bolos de chocolate', 'gastei 8 e pouco no almoço', 'gastei 40 por cento'])(
    '"%s" → null',
    (f) => {
      expect(extrairGasto(f, HOJE)).toBeNull();
      expect(rotear(f, HOJE).tipo).toBe('outro');
    },
  );

  it.each([
    ['paguei 2 euros de café', 2],
    ['gastei 3 € em cafés', 3],
    ['comprei pão por 2,50', 2.5],
    ['gastei 12 no mercado', 12],
    ['gastei 5,50 hoje comprando salgado', 5.5],
    ['paguei 30 euros de luz', 30],
    ['gastei 20 na farmácia ontem', 20],
    ['paguei 20 à padaria', 20],
    ['gastei 15 em gasolina', 15],
    ['gastei 12', 12],
    ['gastei 12.', 12],
    ['gastei 12, no mercado', 12],
    ['paguei 18 pelo estacionamento', 18],
    ['gastei 6 almoçando', 6],
  ])('"%s" segue valendo (%d)', (f, valor) => {
    expect(extrairGasto(f, HOJE)!.valor).toBe(valor);
    expect(rotear(f, HOJE).tipo).toBe('gasto');
  });

  it('"comprei pão por 2,50" tem a descrição "pão"', () => {
    expect(extrairGasto('comprei pão por 2,50', HOJE)!.descricao).toBe('pão');
  });
});
