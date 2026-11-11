// Contas da água: ritmo do dia, sugestão em quartos de garrafa, "outro valor"
// e histórico. Valores tirados do protótipo aprovado (agua-combinado.html).
import { describe, expect, it } from 'vitest';
import {
  esperadoAgora,
  FIM_MIN,
  FOLGA_ML,
  GARRAFA_ML,
  garrafaDaVez,
  goleDeHoje,
  historico,
  INICIO_MIN,
  lerValor,
  META_ML,
  ML_MAXIMO,
  situacao,
  sugestao,
  totalDoDia,
} from '../../src/dados/agua';
import { somarDias } from '../../src/chat/datas';
import type { AguaRegistro } from '../../src/dados/tipos';

let seq = 0;
function gole(data: string, hora: string, ml: number, extra: Partial<AguaRegistro> = {}): AguaRegistro {
  seq += 1;
  return { id: `g${seq}`, atualizadoEm: seq, aparelho: 'notebook', data, hora, ml, ...extra };
}

describe('constantes', () => {
  it('seguem as regras fixas da especificação', () => {
    expect([META_ML, GARRAFA_ML, INICIO_MIN, FIM_MIN, FOLGA_ML, ML_MAXIMO]).toEqual([2000, 500, 480, 1320, 60, 5000]);
  });
});

describe('goleDeHoje e totalDoDia', () => {
  const registros = [
    gole('2026-11-05', '14:00', 250),
    gole('2026-11-04', '09:00', 500),
    gole('2026-11-05', '08:30', 125),
    gole('2026-11-05', '12:40', 375),
    gole('2026-11-06', '07:00', 500),
  ];

  it('ignora goles de outros dias e ordena por hora', () => {
    expect(goleDeHoje(registros, '2026-11-05').map((g) => g.hora)).toEqual(['08:30', '12:40', '14:00']);
  });

  it('não muda a lista recebida', () => {
    const copia = [...registros];
    goleDeHoje(registros, '2026-11-05');
    expect(registros).toEqual(copia);
  });

  it('ignora lápides, por garantia', () => {
    const comLapide = [...registros, gole('2026-11-05', '15:00', 500, { apagado: true })];
    expect(goleDeHoje(comLapide, '2026-11-05')).toHaveLength(3);
    expect(totalDoDia(comLapide, '2026-11-05')).toBe(750);
  });

  it('soma os mL do dia; dia sem goles dá 0', () => {
    expect(totalDoDia(registros, '2026-11-05')).toBe(750);
    expect(totalDoDia(registros, '2026-11-07')).toBe(0);
    expect(totalDoDia([], '2026-11-05')).toBe(0);
  });
});

describe('esperadoAgora', () => {
  it('espalha 2.000 mL em linha reta de 08:00 a 22:00, arredondado ao mL', () => {
    expect(esperadoAgora(840)).toBe(857);
    expect(esperadoAgora(480)).toBe(0);
    expect(esperadoAgora(1320)).toBe(2000);
  });

  it('é 0 antes das 08:00 e 2.000 depois das 22:00', () => {
    expect(esperadoAgora(420)).toBe(0);
    expect(esperadoAgora(0)).toBe(0);
    expect(esperadoAgora(1350)).toBe(2000);
    expect(esperadoAgora(1439)).toBe(2000);
  });
});

describe('situacao', () => {
  it('atrás às 14:00 com 625 mL: falta 232, sugere ½ da garrafa', () => {
    expect(situacao(625, 840)).toEqual({
      estado: 'atras',
      total: 625,
      esperado: 857,
      falta: 232,
      sugestao: { quartos: 2, ml: 250, botao: 0.5, texto: '½ da garrafa' },
    });
  });

  it('atrás às 19:00 com 500 mL: falta 1.071, sugere 2 garrafas e ¼', () => {
    expect(situacao(500, 1140)).toEqual({
      estado: 'atras',
      total: 500,
      esperado: 1571,
      falta: 1071,
      sugestao: { quartos: 9, ml: 1125, botao: 1, texto: '2 garrafas e ¼' },
    });
  });

  it('em dia às 16:30 com 1.375 mL: 161 à frente, próximo gole às 17:38', () => {
    expect(situacao(1375, 990)).toEqual({ estado: 'em-dia', total: 1375, esperado: 1214, folga: 161, proximoMin: 1058 });
  });

  it('em dia quando falta até 60 mL', () => {
    const s = situacao(800, 840); // falta 57
    expect(s.estado).toBe('em-dia');
    expect(situacao(797, 840).estado).toBe('em-dia'); // falta 60
    expect(situacao(796, 840).estado).toBe('atras'); // falta 61
  });

  it('em dia antes das 08:00, mesmo sem nada', () => {
    expect(situacao(0, 420).estado).toBe('em-dia');
  });

  it('meta batida a partir de 2.000 mL, a qualquer hora', () => {
    expect(situacao(2000, 600)).toEqual({ estado: 'meta', total: 2000 });
    expect(situacao(2600, 1400)).toEqual({ estado: 'meta', total: 2600 });
  });

  it('próximo gole no mínimo 20 min depois de agora', () => {
    const s = situacao(571, 720); // esperado às 12:00 = 571, folga 0
    expect(s).toMatchObject({ estado: 'em-dia', folga: 0, proximoMin: 740 });
  });

  it('próximo gole no máximo às 22:00', () => {
    const s = situacao(1900, 1200); // esperado 1.714, folga 186 → 78 min → 21:18
    expect(s).toMatchObject({ estado: 'em-dia', proximoMin: 1278 });
    expect(situacao(1990, 1300)).toMatchObject({ estado: 'em-dia', proximoMin: 1320 });
  });
});

describe('sugestao', () => {
  it('arredonda a falta para cima em quartos de garrafa', () => {
    expect(sugestao(125)).toEqual({ quartos: 1, ml: 125, botao: 0.25, texto: '¼ da garrafa' });
    expect(sugestao(126)).toEqual({ quartos: 2, ml: 250, botao: 0.5, texto: '½ da garrafa' });
    expect(sugestao(375)).toEqual({ quartos: 3, ml: 375, botao: 0.75, texto: '¾ da garrafa' });
  });

  it('não sobe um quarto por erro de vírgula flutuante', () => {
    expect(sugestao(250.0000001).quartos).toBe(2);
  });

  it('uma garrafa ou mais destaca o botão Toda', () => {
    expect(sugestao(500)).toEqual({ quartos: 4, ml: 500, botao: 1, texto: 'a garrafa toda' });
    expect(sugestao(750)).toEqual({ quartos: 6, ml: 750, botao: 1, texto: '1 garrafa e ½' });
    expect(sugestao(1000)).toEqual({ quartos: 8, ml: 1000, botao: 1, texto: '2 garrafas inteiras' });
    expect(sugestao(626).texto).toBe('1 garrafa e ½');
    expect(sugestao(1625).texto).toBe('3 garrafas e ¼');
    expect(sugestao(1375).texto).toBe('2 garrafas e ¾');
  });
});

describe('garrafaDaVez', () => {
  it('diz qual das 4 garrafas está aberta e quanto dela já foi', () => {
    expect(garrafaDaVez(625)).toEqual({ numero: 2, de: 4, fracao: 0.25 });
    expect(garrafaDaVez(0)).toEqual({ numero: 1, de: 4, fracao: 0 });
    expect(garrafaDaVez(1750)).toEqual({ numero: 4, de: 4, fracao: 0.5 });
  });

  it('com a meta batida mostra a 4ª cheia', () => {
    expect(garrafaDaVez(2000)).toEqual({ numero: 4, de: 4, fracao: 1 });
    expect(garrafaDaVez(2750)).toEqual({ numero: 4, de: 4, fracao: 1 });
  });
});

describe('lerValor', () => {
  it('lê mL com ou sem unidade', () => {
    expect(lerValor('350')).toBe(350);
    expect(lerValor('350 ml')).toBe(350);
    expect(lerValor('350ML')).toBe(350);
    expect(lerValor('  200 mL ')).toBe(200);
  });

  it('lê litros com vírgula ou ponto', () => {
    expect(lerValor('1,5 L')).toBe(1500);
    expect(lerValor('1.5l')).toBe(1500);
    expect(lerValor('2 litros')).toBe(2000);
    expect(lerValor('1 litro')).toBe(1000);
  });

  it('número abaixo de 10 sem unidade vale litros', () => {
    expect(lerValor('0,5')).toBe(500);
    expect(lerValor('2')).toBe(2000);
    expect(lerValor('10')).toBe(10);
  });

  it('com unidade, a unidade manda', () => {
    expect(lerValor('5 ml')).toBe(5);
  });

  it('arredonda ao mL inteiro', () => {
    expect(lerValor('12,7')).toBe(13);
    expect(lerValor('0,3333 l')).toBe(333);
  });

  it('recusa vazio, texto, zero e acima de 5.000 mL', () => {
    for (const t of ['', '   ', 'abc', '0', '6000', '5,5 l', '-200', '1,5,0', '350 kg', '0,0004 l']) {
      expect(lerValor(t), t).toBeNull();
    }
  });

  it('aceita os limites 1 e 5.000 mL', () => {
    expect(lerValor('1 ml')).toBe(1);
    expect(lerValor('5000')).toBe(5000);
    expect(lerValor('5 l')).toBe(5000);
  });
});

describe('historico', () => {
  const HOJE = '2026-11-05';
  /** `ml` por dia, do mais antigo ao de ontem (o último é ontem). */
  function diasAntes(valores: number[]): AguaRegistro[] {
    return valores.flatMap((ml, i) => (ml ? [gole(somarDias(HOJE, i - valores.length), '10:00', ml)] : []));
  }

  it('porDia tem 28 dias, do mais antigo a hoje, com 0 nos dias sem goles', () => {
    const h = historico([gole(HOJE, '09:00', 500), gole('2026-10-30', '09:00', 300)], HOJE);
    expect(h.porDia).toHaveLength(28);
    expect(h.porDia[0].data).toBe('2026-10-09');
    expect(h.porDia[27]).toEqual({ data: HOJE, ml: 500 });
    expect(h.porDia.find((d) => d.data === '2026-10-30')!.ml).toBe(300);
    expect(h.porDia.find((d) => d.data === '2026-10-31')!.ml).toBe(0);
  });

  it('atravessa a mudança de hora e a virada do mês sem pular nem repetir dia', () => {
    const h = historico([], HOJE); // 25/10 é o domingo da mudança de hora em Lisboa
    const datas = h.porDia.map((d) => d.data);
    expect(new Set(datas).size).toBe(28);
    expect(datas).toContain('2026-10-25');
    expect(datas).toContain('2026-10-31');
    expect(datas).toContain('2026-11-01');
  });

  it('27 dias seguidos na meta antes de hoje: seguidos 27 (hoje só conta ao bater a meta)', () => {
    const registros = [...diasAntes(Array(27).fill(2000)), gole(HOJE, '09:00', 500)];
    expect(historico(registros, HOJE).seguidos).toBe(27);
    const comHoje = [...registros, gole(HOJE, '15:00', 1500)];
    expect(historico(comHoje, HOJE).seguidos).toBe(28);
  });

  it('um dia abaixo da meta zera a contagem dali para trás', () => {
    const valores = Array(27).fill(2000);
    valores[20] = 900; // 7 dias antes de hoje
    expect(historico(diasAntes(valores), HOJE).seguidos).toBe(6);
  });

  it('ontem fora da meta: seguidos 0, ou 1 se hoje bateu', () => {
    const valores = [...Array(26).fill(2000), 0];
    expect(historico(diasAntes(valores), HOJE).seguidos).toBe(0);
    expect(historico([...diasAntes(valores), gole(HOJE, '20:00', 2100)], HOJE).seguidos).toBe(1);
  });

  it('soma vários goles do mesmo dia para a meta', () => {
    const ontem = somarDias(HOJE, -1);
    const registros = [gole(ontem, '09:00', 1000), gole(ontem, '15:00', 1000)];
    expect(historico(registros, HOJE).seguidos).toBe(1);
  });

  it('media7 é a média dos 7 dias anteriores a hoje (dias sem goles contam 0)', () => {
    const valores = [...Array(20).fill(5000), 2000, 1000, 0, 1500, 2000, 500, 0];
    const h = historico([...diasAntes(valores), gole(HOJE, '09:00', 3000)], HOJE);
    expect(h.media7).toBe(1000); // 7.000 / 7, sem os 5.000 antigos nem o de hoje
  });

  it('media7 arredonda ao mL', () => {
    const h = historico(diasAntes([1000, 0, 0, 0, 0, 0, 0]), HOJE);
    expect(h.media7).toBe(143); // 1.000 / 7 = 142,86
  });

  it('melhor inclui hoje', () => {
    expect(historico([...diasAntes([1800, 1900]), gole(HOJE, '09:00', 2400)], HOJE).melhor).toBe(2400);
    expect(historico([...diasAntes([1800, 1900]), gole(HOJE, '09:00', 400)], HOJE).melhor).toBe(1900);
  });

  it('sem registros: tudo zero', () => {
    const h = historico([], HOJE);
    expect({ seguidos: h.seguidos, media7: h.media7, melhor: h.melhor }).toEqual({ seguidos: 0, media7: 0, melhor: 0 });
    expect(h.porDia.every((d) => d.ml === 0)).toBe(true);
  });

  it('ignora lápides', () => {
    const h = historico([gole(HOJE, '09:00', 900, { apagado: true }), gole(HOJE, '10:00', 100)], HOJE);
    expect(h.porDia[27].ml).toBe(100);
  });
});
