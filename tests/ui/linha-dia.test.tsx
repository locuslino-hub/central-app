import { render, screen, within } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { montarCalendario } from '../../src/dados/calendario';
import type { Evento } from '../../src/dados/agenda';
import type { Tarefa } from '../../src/dados/tipos';
import { LinhaDia } from '../../src/ui/LinhaDia';

// Quinta-feira, 2026-11-05, 12:20 (Europe/Lisbon, UTC+0 no inverno).
const AGORA = new Date('2026-11-05T12:20:00Z');
const HOJE = '2026-11-05';

let n = 0;
function evento(titulo: string, inicio: string, fim: string, extra: Partial<Evento> = {}): Evento {
  n += 1;
  return {
    id: `e${n}`,
    agendaId: 'primary',
    titulo,
    inicio: `2026-11-05T${inicio}:00+00:00`,
    fim: `2026-11-05T${fim}:00+00:00`,
    diaInteiro: false,
    livre: false,
    recusado: false,
    salaId: null,
    link: null,
    ...extra,
  };
}

function tarefa(titulo: string, extra: Partial<Tarefa> = {}): Tarefa {
  n += 1;
  return {
    id: `t${n}`,
    atualizadoEm: 1,
    aparelho: 'a',
    titulo,
    salaId: null,
    duracaoMin: 60,
    duracaoConfirmada: false,
    feito: false,
    fixada: false,
    marcar: false,
    data: HOJE,
    ...extra,
  };
}

function mostrar(eventos: Evento[], tarefas: Tarefa[] = [], propriedades: Partial<Parameters<typeof LinhaDia>[0]> = {}, agora = AGORA) {
  const dia = montarCalendario({ eventos, tarefas, de: HOJE, ate: HOJE, agora }).dia(HOJE);
  render(<LinhaDia dia={dia} agora={agora} salas={[]} {...propriedades} />);
  return within(screen.getByRole('group', { name: 'Linha do dia' }));
}

const bloco = (titulo: string) => document.querySelector(`[data-titulo="${titulo}"]`) as HTMLElement;
const esquerda = (el: HTMLElement) => parseFloat(el.style.left);
const largura = (el: HTMLElement) => parseFloat(el.style.width);

describe('LinhaDia: blocos pela hora', () => {
  it('cada compromisso é um bloco: o começo e o tamanho seguem a hora (janela de 8h às 20h)', () => {
    mostrar([evento('Aula', '09:00', '10:30')]);
    const aula = bloco('Aula');
    // 9h é 60 minutos depois das 8h, de 720.
    expect(esquerda(aula)).toBeCloseTo((60 / 720) * 100, 1);
    expect(largura(aula)).toBeCloseTo((90 / 720) * 100, 1);
    expect(aula.getAttribute('data-tipo')).toBe('evento');
  });

  it('mostra as horas de 2 em 2, em texto', () => {
    mostrar([]);
    const horas = [...document.querySelectorAll('.lin-hora')].map((e) => e.textContent);
    expect(horas).toEqual(['8h', '10h', '12h', '14h', '16h', '18h', '20h']);
  });

  it('a janela cresce para caber o que passa de 8h ou de 20h', () => {
    mostrar([evento('Madrugada', '06:30', '07:30'), evento('Noite', '21:15', '22:30')]);
    // Das 6h às 23h: 1020 minutos.
    expect(esquerda(bloco('Madrugada'))).toBeCloseTo((30 / 1020) * 100, 1);
    expect(esquerda(bloco('Noite'))).toBeCloseTo(((21 * 60 + 15 - 360) / 1020) * 100, 1);
    expect([...document.querySelectorAll('.lin-hora')][0].textContent).toBe('6h');
    expect(document.querySelector('.lin-hora:last-child')?.textContent).toBe('22h');
  });

  it('o início e o fim do dia podem ser outros (fim do dia ajustável)', () => {
    mostrar([evento('Aula', '09:00', '10:00')], [], { inicioDoDia: 9 * 60, fimDoDia: 18 * 60 });
    expect(esquerda(bloco('Aula'))).toBeCloseTo(0, 1);
    expect(largura(bloco('Aula'))).toBeCloseTo((60 / 540) * 100, 1);
  });

  it('o que se sobrepõe fica em outra linha, e a faixa cresce', () => {
    mostrar([evento('A', '09:00', '11:00'), evento('B', '10:00', '12:00'), evento('C', '11:00', '12:00')]);
    expect(bloco('A').getAttribute('data-linha')).toBe('0');
    expect(bloco('B').getAttribute('data-linha')).toBe('1');
    expect(bloco('C').getAttribute('data-linha')).toBe('0');
    const faixa = document.querySelector('.lin-faixa') as HTMLElement;
    expect(faixa.getAttribute('data-linhas')).toBe('2');
  });

  it('evento que cruza a meia-noite ocupa só a parte deste dia', () => {
    mostrar([evento('Plantão', '22:00', '23:30', { fim: '2026-11-06T02:00:00+00:00' })]);
    const x = bloco('Plantão');
    // Termina à meia-noite (24h): a janela vai até 24h (cresce além das 20h).
    expect(esquerda(x) + largura(x)).toBeCloseTo(100, 0);
  });

  it('dia inteiro e tarefa só com dia não ocupam a linha', () => {
    mostrar([evento('Feriado de Aurora', '00:00', '00:00', { diaInteiro: true, inicio: HOJE, fim: '2026-11-06' })], [tarefa('Ligar para a Renata')]);
    expect(document.querySelectorAll('.lin-bloco, .lin-prazo')).toHaveLength(0);
  });
});

describe('LinhaDia: tarefas', () => {
  it('o prazo é um marcador na hora do prazo, sem largura: não ocupa tempo', () => {
    mostrar([], [tarefa('Entregar relatório', { prazoHora: '17:00' })]);
    const marca = bloco('Entregar relatório');
    expect(marca.className).toContain('lin-prazo');
    expect(marca.className).not.toContain('lin-bloco');
    expect(marca.getAttribute('data-tipo')).toBe('prazo');
    expect(esquerda(marca)).toBeCloseTo(((17 * 60 - 480) / 720) * 100, 1);
    expect(marca.style.width).toBe('');
  });

  it('a tarefa com hora de início é um bloco com a duração dela', () => {
    mostrar([], [tarefa('Reunião com a Marina', { inicio: '15:30', duracaoMin: 45 })]);
    const x = bloco('Reunião com a Marina');
    expect(x.className).toContain('lin-bloco');
    expect(x.getAttribute('data-tipo')).toBe('bloco');
    expect(largura(x)).toBeCloseTo((45 / 720) * 100, 1);
  });
});

describe('LinhaDia: passado, livre e agora', () => {
  it('o que passou fica atenuado, e a lista para leitor de tela diz "passado"', () => {
    const grupo = mostrar([evento('Aula', '09:00', '10:00'), evento('Reunião', '16:00', '17:00')]);
    expect(bloco('Aula').getAttribute('data-passado')).toBe('true');
    expect(bloco('Reunião').getAttribute('data-passado')).toBe('false');
    const itens = grupo.getAllByRole('listitem');
    expect(itens[0].textContent).toBe('09:00 às 10:00: Aula, passado');
    expect(itens[1].textContent).toBe('16:00 às 17:00: Reunião');
  });

  it('o livre fica mais leve e leva a palavra "livre" na lista', () => {
    const grupo = mostrar([evento('Bloqueio', '14:00', '15:00', { livre: true })]);
    expect(bloco('Bloqueio').getAttribute('data-livre')).toBe('true');
    expect(grupo.getByRole('listitem').textContent).toBe('14:00 às 15:00: Bloqueio, livre');
  });

  it('o recusado não aparece', () => {
    mostrar([evento('Recusado', '14:00', '15:00', { recusado: true })]);
    expect(bloco('Recusado')).toBeNull();
  });

  it('a linha de agora fica na hora de Lisboa, só no dia de hoje', () => {
    const grupo = mostrar([]);
    const agora = document.querySelector('.lin-agora') as HTMLElement;
    expect(esquerda(agora)).toBeCloseTo(((12 * 60 + 20 - 480) / 720) * 100, 1);
    expect(grupo.getByText('Agora são 12:20.')).toBeTruthy();
  });

  it('em outro dia não há linha de agora', () => {
    const outro = new Date('2026-11-06T12:20:00Z');
    const dia = montarCalendario({ eventos: [], tarefas: [], de: HOJE, ate: HOJE, agora: AGORA }).dia(HOJE);
    render(<LinhaDia dia={dia} agora={outro} salas={[]} />);
    expect(document.querySelector('.lin-agora')).toBeNull();
  });

  it('agora fora da janela (de manhã cedo) não desenha a linha', () => {
    mostrar([], [], {}, new Date('2026-11-05T06:00:00Z'));
    expect(document.querySelector('.lin-agora')).toBeNull();
  });

  it('o horário de verão conta: 12:20 UTC é 13:20 em Lisboa em julho', () => {
    const verao = new Date('2026-07-14T12:20:00Z');
    const dia = montarCalendario({ eventos: [], tarefas: [], de: '2026-07-14', ate: '2026-07-14', agora: verao }).dia('2026-07-14');
    render(<LinhaDia dia={dia} agora={verao} salas={[]} />);
    expect(esquerda(document.querySelector('.lin-agora') as HTMLElement)).toBeCloseTo(((13 * 60 + 20 - 480) / 720) * 100, 1);
  });
});

describe('LinhaDia: acessibilidade e texto', () => {
  it('é só para ver: não tem botões nem links; o texto está na lista', () => {
    const grupo = mostrar([evento('Aula', '09:00', '10:00')], [tarefa('Entregar', { prazoHora: '17:00' })]);
    expect(grupo.queryAllByRole('button')).toHaveLength(0);
    expect(grupo.queryAllByRole('link')).toHaveLength(0);
    expect(grupo.getAllByRole('listitem').map((i) => i.textContent)).toEqual(['09:00 às 10:00: Aula, passado', 'Prazo às 17:00: Entregar']);
  });

  it('os blocos e as horas desenhados ficam fora do leitor de tela (a lista já diz tudo)', () => {
    mostrar([evento('Aula', '09:00', '10:00')]);
    expect(document.querySelector('.lin-faixa')?.getAttribute('aria-hidden')).toBe('true');
    expect(document.querySelector('.lin-horas')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('dia sem horários: a lista diz que não há nada com hora', () => {
    const grupo = mostrar([]);
    expect(grupo.getByText('Nada com hora marcada.')).toBeTruthy();
  });

  it('o título é texto, nunca HTML', () => {
    mostrar([evento('<img src=x onerror=alert(1)>', '09:00', '10:00')]);
    expect(document.querySelector('.lin-faixa img')).toBeNull();
    expect(screen.getAllByText('<img src=x onerror=alert(1)>').length).toBeGreaterThan(0);
  });

  it('evento sem título aparece como "(sem título)"', () => {
    const grupo = mostrar([evento('', '09:00', '10:00')]);
    expect(grupo.getByRole('listitem').textContent).toContain('(sem título)');
  });
});
