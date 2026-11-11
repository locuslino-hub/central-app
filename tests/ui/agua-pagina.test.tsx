// Tarefa 27: a página expandida da água (diálogo): gráfico do ritmo, garrafas do dia,
// "Outro valor" e histórico. Quinta-feira, 2026-11-05, 12:20 em Lisboa (inverno: UTC+0).
// Nomes fictícios. O jsdom não tem showModal/close: tests/setup.ts os imita (o navegador de verdade é visto no e2e).
import { configure, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { useState } from 'preact/hooks';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { limparConversa } from '../../src/chat/conversa';
import { listar, salvar, semear, semearPalavras } from '../../src/dados/loja';
import type { AguaRegistro, ParaSalvar } from '../../src/dados/tipos';
import { CartaoAgua } from '../../src/ui/Agua';
import { AguaPagina } from '../../src/ui/AguaPagina';

configure({ asyncUtilTimeout: 5000 });

const HOJE = '2026-11-05';

beforeEach(async () => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-11-05T12:20:00Z'));
  limparConversa();
  await semear();
  await semearPalavras();
});

function gole(ml: number, hora: string, data = HOJE): ParaSalvar<AguaRegistro> {
  return { data, hora, ml };
}
const goles = (...itens: [number, string][]) => Promise.all(itens.map(([ml, hora]) => salvar('agua', gole(ml, hora))));
const vivos = async () => (await listar('agua')).filter((r) => !r.apagado);

/** O cartão da coluna e a página, ligados como no app. */
function Conjunto() {
  const [aberta, setAberta] = useState(false);
  return (
    <>
      <CartaoAgua aoAbrir={() => setAberta(true)} />
      <AguaPagina aberta={aberta} aoFechar={() => setAberta(false)} />
    </>
  );
}

const anel = () => document.querySelector('.agua-resumo') as HTMLElement;
const pagina = () => screen.getByRole('dialog', { name: 'Água' });
const naPagina = () => within(pagina());
const totalDoCartao = () => document.querySelector('.cartao-agua .agua-total')!.textContent;

async function abrir() {
  render(<Conjunto />);
  fireEvent.click(anel());
  await waitFor(() => expect(pagina()).toBeTruthy());
}

/** Espera os registros chegarem (a página abre com 0 mL enquanto lê). */
const esperarTotal = (texto: string) => waitFor(() => expect(pagina().querySelector('.agua-grande')!.textContent).toBe(texto));

describe('abrir e fechar', () => {
  it('fechada não existe; ao tocar no anel abre com role="dialog", título "Água" e foco dentro', async () => {
    render(<Conjunto />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(anel());
    const caixa = await screen.findByRole('dialog', { name: 'Água' });
    expect(caixa.tagName).toBe('DIALOG');
    expect(within(caixa).getByRole('heading', { level: 2, name: 'Água' })).toBeTruthy();
    expect(within(caixa).getByRole('button', { name: 'Fechar' })).toBeTruthy();
  });

  it('Esc fecha e o foco volta ao anel', async () => {
    await abrir();
    fireEvent.keyDown(pagina(), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(anel());
  });

  it('o X fecha e o foco volta ao anel', async () => {
    await abrir();
    fireEvent.click(naPagina().getByRole('button', { name: 'Fechar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(anel());
  });

  it('tocar no fundo fecha; tocar dentro não', async () => {
    await abrir();
    fireEvent.click(pagina().querySelector('.agua-pag')!);
    expect(screen.queryByRole('dialog')).toBeTruthy();
    // O fundo (::backdrop) manda o clique para o próprio <dialog>.
    fireEvent.click(pagina());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(anel());
  });

  it('arrastar de dentro para fora (selecionar texto) não fecha', async () => {
    await abrir();
    fireEvent.mouseDown(pagina().querySelector('.agua-pag')!);
    fireEvent.click(pagina());
    expect(screen.queryByRole('dialog')).toBeTruthy();
  });

  it('reabre depois de fechar', async () => {
    await abrir();
    fireEvent.click(naPagina().getByRole('button', { name: 'Fechar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(anel());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeTruthy());
  });
});

describe('o alto da página: total, selo e falta', () => {
  it('mostra o total, a porcentagem, quanto falta para a meta e o selo', async () => {
    await goles([250, '08:30'], [375, '10:50']);
    await abrir();
    await esperarTotal('625 mL');
    const topo = pagina().querySelector('.agua-pag-topo')!;
    expect(topo.textContent).toContain('625 mL');
    expect(topo.textContent).toContain('de 2.000 mL · 31%');
    expect(topo.textContent).toContain('Faltam 1.375 mL para a meta');
    expect(pagina().querySelector('.agua-selo')!.textContent).toBe('No ritmo');
  });

  it('meta batida: "Meta batida" no lugar de "Faltam"', async () => {
    await goles([2000, '08:30']);
    await abrir();
    await esperarTotal('2.000 mL');
    expect(pagina().querySelector('.agua-pag-topo')!.textContent).toContain('Meta batida');
    expect(pagina().querySelector('.agua-pag-topo')!.textContent).not.toContain('Faltam');
  });

  it('o quadro de dica é o mesmo do cartão', async () => {
    await abrir();
    await waitFor(() =>
      expect(pagina().querySelector('.agua-dica')!.textContent).toBe('Para alcançar o ritmo, beba 1 garrafa e ¼ (625 mL).'),
    );
    expect(pagina().querySelectorAll('.agua-dica .garrafinhas svg')).toHaveLength(2);
  });
});

describe('enquanto a loja ainda lê', () => {
  it('a página não mostra "Atrás", dica, botão sugerido, traço do que falta nem histórico (e mostra tudo depois)', async () => {
    render(<Conjunto />);
    fireEvent.click(anel());
    const caixa = pagina(); // sem esperar: a loja ainda não respondeu
    expect(caixa.textContent).not.toMatch(/atrás/i);
    expect(caixa.textContent).not.toContain('Para alcançar o ritmo');
    expect(caixa.textContent).not.toContain('0 dias');
    expect(caixa.textContent).not.toContain('0,0 L');
    expect(caixa.querySelector('.agua-historico')).toBeNull();
    expect(caixa.querySelectorAll('.sugerido')).toHaveLength(0);
    expect(caixa.querySelector('.agua-grafico-falta')).toBeNull();
    expect(caixa.querySelector('.agua-legenda')!.textContent).not.toContain('o que falta');
    expect(caixa.querySelector('.agua-selo')!.classList.contains('carregando')).toBe(true);
    await waitFor(() => expect(pagina().querySelector('.agua-selo')!.textContent).toBe('Atrás 619 mL'));
    expect(pagina().querySelector('.agua-historico')).toBeTruthy();
    expect(pagina().querySelectorAll('button.sugerido')).toHaveLength(1);
    expect(pagina().querySelector('.agua-grafico-falta')).toBeTruthy();
  });
});

describe('gráfico "Ritmo do dia"', () => {
  const grafico = () => pagina().querySelector('svg.agua-grafico') as SVGSVGElement;
  const titulos = () => Array.from(grafico().querySelectorAll('title')).map((t) => t.textContent);
  const horas = () => Array.from(grafico().querySelectorAll('text.agua-grafico-hora')).map((t) => t.textContent);

  it('é um SVG de largura fluida (viewBox 360 × 160), com título, e cada gole é uma bolinha com a hora no <title>', async () => {
    await goles([250, '08:30'], [375, '10:50'], [500, '12:00']);
    await abrir();
    await waitFor(() => expect(titulos()).toHaveLength(3));
    expect(grafico().getAttribute('viewBox')).toBe('0 0 360 160');
    expect(naPagina().getByRole('heading', { name: 'Ritmo do dia' })).toBeTruthy();
    expect(titulos()).toEqual(['08:30 · 250 mL', '10:50 · 375 mL', '12:00 · 500 mL']);
    expect(grafico().querySelectorAll('circle.agua-grafico-gole')).toHaveLength(3);
    expect(horas()).toEqual(['08:30', '10:50', '12:00']);
  });

  it('as horas ficam depois de todas as bolinhas, também as de agora e esperado (por cima delas), e o traço do que falta vem depois das bolinhas dos goles', async () => {
    await goles([250, '08:30'], [125, '08:50'], [125, '12:00']);
    await abrir();
    await waitFor(() => expect(titulos()).toHaveLength(3));
    const ordem = Array.from(
      grafico().querySelectorAll('circle.agua-grafico-gole, circle.agua-grafico-agora, circle.agua-grafico-esperado, text.agua-grafico-hora, line.agua-grafico-falta'),
    ).map((e) => (e.tagName === 'circle' ? (e.classList.contains('agua-grafico-gole') ? 'bolinha' : e.classList.contains('agua-grafico-agora') ? 'agora' : 'esperado') : e.tagName === 'text' ? 'hora' : 'falta'));
    expect(ordem).toEqual(['bolinha', 'bolinha', 'bolinha', 'falta', 'agora', 'esperado', 'hora', 'hora']);
  });

  it('com pouca diferença (550 contra 619 mL) o traço do que falta passa 3 pontos além das duas bolinhas e continua visível', async () => {
    await goles([500, '08:30'], [50, '10:00']);
    await abrir();
    await waitFor(() => expect(grafico().querySelector('.agua-grafico-falta')).toBeTruthy());
    const num = (e: Element | null, nome: string) => Number(e!.getAttribute(nome));
    const traco = grafico().querySelector('.agua-grafico-falta');
    const agora = grafico().querySelector('.agua-grafico-agora');
    const esperado = grafico().querySelector('.agua-grafico-esperado');
    // O "esperado" fica mais alto na tela (y menor) que o "agora"; o traço vai de 3 abaixo de uma até 3 acima da outra.
    expect(num(esperado, 'cy')).toBeLessThan(num(agora, 'cy'));
    expect(num(traco, 'y1')).toBeCloseTo(num(agora, 'cy') + num(agora, 'r') + 3, 5);
    expect(num(traco, 'y2')).toBeCloseTo(num(esperado, 'cy') - num(esperado, 'r') - 3, 5);
    // Mesmo com as bolinhas quase encostadas, sobra traço fora delas dos dois lados.
    expect(num(traco, 'y1') - (num(agora, 'cy') + num(agora, 'r'))).toBeGreaterThanOrEqual(3);
    expect(num(esperado, 'cy') - num(esperado, 'r') - num(traco, 'y2')).toBeGreaterThanOrEqual(3);
  });

  it('o <title> usa o separador de milhar do Brasil', async () => {
    await goles([1500, '09:00']);
    await abrir();
    await waitFor(() => expect(titulos()).toEqual(['09:00 · 1.500 mL']));
  });

  it('goles a menos de 24 px um do outro mostram só a primeira hora (todos mantêm o <title>)', async () => {
    // 08:30 e 08:40 ficam a uns 4 px; 09:00 fica a uns 11 px do 08:30; 12:00 já está longe.
    await goles([125, '08:30'], [125, '08:40'], [125, '09:00'], [250, '12:00']);
    await abrir();
    await waitFor(() => expect(titulos()).toHaveLength(4));
    expect(horas()).toEqual(['08:30', '12:00']);
    expect(titulos()).toEqual(['08:30 · 125 mL', '08:40 · 125 mL', '09:00 · 125 mL', '12:00 · 250 mL']);
  });

  it('desenha o ritmo ideal, a linha do bebido e, atrás, o traço do que falta', async () => {
    await goles([250, '08:30']);
    await abrir();
    await waitFor(() => expect(titulos()).toHaveLength(1));
    expect(grafico().querySelector('.agua-grafico-ritmo')).toBeTruthy();
    expect(grafico().querySelector('.agua-grafico-linha')).toBeTruthy();
    expect(grafico().querySelector('.agua-grafico-falta')).toBeTruthy();
    expect(pagina().querySelector('.agua-legenda')!.textContent).toContain('o que falta');
  });

  it('em dia: sem o traço do que falta nem a legenda dele', async () => {
    await goles([1000, '08:30']);
    await abrir();
    await waitFor(() => expect(titulos()).toHaveLength(1));
    expect(grafico().querySelector('.agua-grafico-falta')).toBeNull();
    expect(pagina().querySelector('.agua-legenda')!.textContent).not.toContain('o que falta');
  });

  it('sem goles hoje: sem bolinhas, e "Desfazer último" desabilitado', async () => {
    await abrir();
    await waitFor(() => expect(grafico()).toBeTruthy());
    expect(titulos()).toEqual([]);
    expect((naPagina().getByRole('button', { name: /^Desfazer último/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('"Desfazer último" apaga só o último gole de hoje', async () => {
    await salvar('agua', gole(500, '20:00', '2026-11-04'));
    await goles([250, '08:30'], [125, '10:00'], [375, '11:45']);
    await abrir();
    await waitFor(() => expect(titulos()).toHaveLength(3));
    fireEvent.click(naPagina().getByRole('button', { name: /^Desfazer último/ }));
    await waitFor(() => expect(titulos()).toEqual(['08:30 · 250 mL', '10:00 · 125 mL']));
    expect((await vivos()).map((g) => [g.data, g.hora, g.ml])).toHaveLength(3); // 2 de hoje + 1 de ontem
    expect(totalDoCartao()).toBe('375 mL');
  });

  it('tem um nome para o leitor de tela com o total, o esperado e os goles', async () => {
    await goles([250, '08:30']);
    await abrir();
    await waitFor(() => expect(titulos()).toHaveLength(1));
    const nome = grafico().getAttribute('aria-label')!;
    expect(grafico().getAttribute('role')).toBe('img');
    expect(nome).toContain('Ritmo do dia');
    expect(nome).toContain('250 mL');
    expect(nome).toContain('619 mL');
    expect(nome).toContain('08:30');
  });
});

describe('garrafas do dia', () => {
  const garrafas = () => Array.from(pagina().querySelectorAll('.agua-garrafa small')).map((s) => s.textContent);

  it('625 mL: a 1ª com ✓, a 2ª "agora", depois "3ª" e "4ª"', async () => {
    await goles([500, '08:30'], [125, '10:00']);
    await abrir();
    await waitFor(() => expect(garrafas()).toEqual(['✓', 'agora', '3ª', '4ª']));
    const desenhos = Array.from(pagina().querySelectorAll('.agua-garrafa svg')).map((s) => s.getAttribute('data-fracao'));
    expect(desenhos).toEqual(['1', '0.25', '0', '0']);
  });

  it('sem goles: a 1ª é "agora"', async () => {
    await abrir();
    await waitFor(() => expect(garrafas()).toEqual(['agora', '2ª', '3ª', '4ª']));
  });

  it('meta batida: as quatro com ✓', async () => {
    await goles([2000, '08:30']);
    await abrir();
    await waitFor(() => expect(garrafas()).toEqual(['✓', '✓', '✓', '✓']));
  });

  it('tem um título e um texto só para o leitor de tela em cada garrafa', async () => {
    await goles([500, '08:30'], [125, '10:00']);
    await abrir();
    await esperarTotal('625 mL');
    expect(naPagina().getByRole('heading', { name: /^Garrafas de hoje/ })).toBeTruthy();
    const itens = Array.from(pagina().querySelectorAll('.agua-garrafa'));
    expect(itens).toHaveLength(4);
    expect(itens[0].textContent).toContain('Garrafa 1');
    expect(itens[0].textContent).toContain('cheia');
    expect(itens[1].textContent).toContain('Garrafa 2');
  });
});

describe('botões ¼ ½ ¾ Toda', () => {
  it('registram 125, 250, 375 e 500 mL; o sugerido leva a etiqueta', async () => {
    await abrir();
    await waitFor(() => expect(naPagina().getByRole('button', { name: 'Toda, 500 mL, sugerido' })).toBeTruthy());
    for (const nome of [/^¼, 125 mL/, /^½, 250 mL/, /^¾, 375 mL/]) expect(naPagina().getByRole('button', { name: nome })).toBeTruthy();
    fireEvent.click(naPagina().getByRole('button', { name: /^½, 250 mL/ }));
    await waitFor(() => expect(naPagina().getByText('250')).toBeTruthy());
    expect((await vivos()).map((g) => [g.data, g.hora, g.ml])).toEqual([[HOJE, '12:20', 250]]);
    expect(pagina().querySelector('.agua-pag-topo')!.textContent).toContain('250 mL');
  });
});

describe('"Outro valor"', () => {
  const campo = () => naPagina().getByRole('textbox', { name: 'Outro valor' }) as HTMLInputElement;
  const digitar = (texto: string) => fireEvent.input(campo(), { target: { value: texto } });
  const somar = () => fireEvent.click(naPagina().getByRole('button', { name: 'Somar' }));

  it('"1,5 L" + Somar registra 1500 e limpa o campo', async () => {
    await abrir();
    digitar('1,5 L');
    somar();
    await waitFor(async () => expect((await vivos()).map((g) => g.ml)).toEqual([1500]));
    await waitFor(() => expect(campo().value).toBe(''));
    expect(naPagina().queryByText('Valor inválido')).toBeNull();
    await waitFor(() => expect(pagina().querySelector('.agua-pag-topo')!.textContent).toContain('1.500 mL'));
  });

  it('Enter no campo também soma ("350" são 350 mL)', async () => {
    await abrir();
    digitar('350');
    fireEvent.submit(campo().closest('form')!);
    await waitFor(async () => expect((await vivos()).map((g) => g.ml)).toEqual([350]));
  });

  it('"abc" mostra "Valor inválido", marca o campo e não registra', async () => {
    await abrir();
    digitar('abc');
    somar();
    expect(naPagina().getByText('Valor inválido')).toBeTruthy();
    expect(naPagina().getByRole('alert').textContent).toContain('Valor inválido');
    expect(campo().getAttribute('aria-invalid')).toBe('true');
    expect(campo().value).toBe('abc');
    expect(await vivos()).toHaveLength(0);
  });

  it('fora de 1 a 5.000 mL ("6 L") também é inválido, e vazio também', async () => {
    await abrir();
    digitar('6 L');
    somar();
    expect(naPagina().getByText('Valor inválido')).toBeTruthy();
    digitar('');
    somar();
    expect(naPagina().getByText('Valor inválido')).toBeTruthy();
    expect(await vivos()).toHaveLength(0);
  });

  it('digitar de novo tira o aviso', async () => {
    await abrir();
    digitar('abc');
    somar();
    expect(naPagina().getByText('Valor inválido')).toBeTruthy();
    digitar('350');
    expect(naPagina().queryByText('Valor inválido')).toBeNull();
    expect(campo().getAttribute('aria-invalid')).toBeNull();
  });

  it('uma atualização vinda de outro aparelho muda os números, mas não limpa o que se digita', async () => {
    await goles([250, '08:30']);
    await abrir();
    await waitFor(() => expect(pagina().querySelector('.agua-pag-topo')!.textContent).toContain('250 mL'));
    digitar('350 m');
    campo().focus();
    // Outro aparelho registrou um gole: a coleção muda e a página se refaz.
    await salvar('agua', gole(500, '11:00'));
    await waitFor(() => expect(pagina().querySelector('.agua-pag-topo')!.textContent).toContain('750 mL'));
    await waitFor(() => expect(totalDoCartao()).toBe('750 mL'));
    expect(campo().value).toBe('350 m');
    expect(document.activeElement).toBe(campo());
    // Também com o aviso de valor inválido à mostra.
    digitar('abc');
    somar();
    await salvar('agua', gole(125, '11:30'));
    await waitFor(() => expect(pagina().querySelector('.agua-pag-topo')!.textContent).toContain('875 mL'));
    expect(campo().value).toBe('abc');
    expect(naPagina().getByText('Valor inválido')).toBeTruthy();
  });
});

describe('histórico', () => {
  // Hoje (quinta) 625 mL. Os sete dias antes somam 13.300 mL (média 1,9 L); ontem e anteontem bateram a meta.
  async function semearDias() {
    const dias: [string, number][] = [
      ['2026-11-04', 2000],
      ['2026-11-03', 2000],
      ['2026-11-02', 1500],
      ['2026-11-01', 1900],
      ['2026-10-31', 1800],
      ['2026-10-30', 2100],
      ['2026-10-29', 2000],
      ['2026-10-25', 2600], // o melhor dia, dentro das 4 semanas
    ];
    await Promise.all(dias.map(([data, ml]) => salvar('agua', gole(ml, '12:00', data))));
    await goles([500, '08:30'], [125, '10:00']);
  }
  const historicoDaPagina = () => within(pagina().querySelector('.agua-historico') as HTMLElement);
  const estatistica = (rotulo: string) =>
    Array.from(pagina().querySelectorAll('.agua-estat')).find((e) => e.textContent!.includes(rotulo)) as HTMLElement;

  it('mostra os dias seguidos na meta, a média de 7 dias e o melhor dia, em litros com uma casa', async () => {
    await semearDias();
    await abrir();
    await waitFor(() => expect(estatistica('seguidos na meta')).toBeTruthy());
    await waitFor(() => expect(estatistica('seguidos na meta').textContent).toBe('2 dias seguidos na meta'));
    expect(estatistica('média 7 dias').textContent).toBe('1,9 L média 7 dias');
    expect(estatistica('melhor dia').textContent).toBe('2,6 L melhor dia');
    expect(historicoDaPagina().getByRole('heading', { name: 'Histórico' })).toBeTruthy();
  });

  it('um dia só: "1 dia seguido na meta"; nenhum: "0 dias seguidos na meta"', async () => {
    await salvar('agua', gole(2000, '12:00', '2026-11-04'));
    await abrir();
    await waitFor(() => expect(estatistica('na meta').textContent).toBe('1 dia seguido na meta'));
  });

  it('sem histórico: 0 dias, 0,0 L', async () => {
    await abrir();
    await waitFor(() => expect(estatistica('na meta').textContent).toBe('0 dias seguidos na meta'));
    expect(estatistica('média 7 dias').textContent).toBe('0,0 L média 7 dias');
  });

  it('tem 7 barras (verde-escuro na meta) e hoje destacado', async () => {
    await semearDias();
    await abrir();
    await esperarTotal('625 mL');
    const barras = Array.from(pagina().querySelectorAll('.agua-barra'));
    // 30/10 a 05/11: 2.100, 1.800, 1.900, 1.500, 2.000, 2.000 e hoje (625).
    expect(barras.map((b) => b.classList.contains('meta'))).toEqual([true, false, false, false, true, true, false]);
    expect(barras[6].classList.contains('hoje')).toBe(true);
    expect(barras.filter((b) => b.classList.contains('hoje'))).toHaveLength(1);
    expect(historicoDaPagina().getByRole('heading', { name: 'Últimos 7 dias' })).toBeTruthy();
  });

  it('a barra de hoje também é "meta" quando hoje já chegou a 2.000 mL (e continua "hoje"); abaixo disso, não', async () => {
    await goles([1000, '08:30'], [1000, '10:00']);
    await abrir();
    await esperarTotal('2.000 mL');
    const hoje = () => pagina().querySelector('.agua-barra.hoje') as HTMLElement;
    expect(hoje().classList.contains('meta')).toBe(true);
  });

  it('hoje abaixo da meta: só "hoje"', async () => {
    await goles([1999, '08:30']);
    await abrir();
    await esperarTotal('1.999 mL');
    const hoje = pagina().querySelector('.agua-barra.hoje') as HTMLElement;
    expect(hoje.classList.contains('meta')).toBe(false);
  });

  it('as barras trazem o dia da semana e os mL para o leitor de tela', async () => {
    await semearDias();
    await abrir();
    await esperarTotal('625 mL');
    const itens = Array.from(pagina().querySelectorAll('.agua-semana li'));
    expect(itens[6].textContent).toContain('quinta-feira');
    expect(itens[6].textContent).toContain('625 mL');
    expect(itens[5].textContent).toContain('quarta-feira');
    expect(itens[5].textContent).toContain('2.000 mL');
  });

  it('o mapa tem 28 dias, o de hoje com a classe "hoje", e começa na coluna do dia da semana certo', async () => {
    await semearDias();
    await abrir();
    await esperarTotal('625 mL');
    const dias = Array.from(pagina().querySelectorAll('.agua-dia'));
    expect(dias.filter((d) => d.classList.contains('hoje'))).toHaveLength(1);
    const hoje = dias[27];
    expect(hoje.classList.contains('hoje')).toBe(true);
    expect(hoje.textContent).toBe('5');
    expect(dias[0].textContent).toBe('9'); // 09/10, uma sexta-feira
    // Segunda a domingo: a sexta é a 5ª coluna, então 4 vazios antes.
    expect(pagina().querySelectorAll('.agua-mapa .agua-dia-vazio')).toHaveLength(4);
    expect(historicoDaPagina().getByRole('heading', { name: 'Últimas 4 semanas' })).toBeTruthy();
  });

  it('o mapa pinta mais escuro o que chegou mais perto da meta', async () => {
    await semearDias();
    await abrir();
    await esperarTotal('625 mL');
    const dias = Array.from(pagina().querySelectorAll('.agua-dia'));
    const nivel = (el: Element) => ['n1', 'n2', 'n3', 'n4'].find((c) => el.classList.contains(c)) ?? '';
    expect(nivel(dias[27])).toBe('n1'); // hoje, 625 mL (31%)
    expect(nivel(dias[26])).toBe('n4'); // 04/11, 2.000
    expect(nivel(dias[25])).toBe('n4'); // 03/11, 2.000
    expect(nivel(dias[24])).toBe('n2'); // 02/11, 1.500 (75%)
    expect(nivel(dias[0])).toBe(''); // sem goles
    expect(dias[26].getAttribute('aria-label')).toBe('4/11: 2.000 mL');
  });
});

describe('na casca', () => {
  function mostrar(hash: string, largura: number) {
    Object.defineProperty(window, 'innerWidth', { value: largura, configurable: true, writable: true });
    history.replaceState(null, '', `/${hash}`);
    render(<App />);
  }

  it('no computador, o anel do cartão da coluna direita abre a página e o foco volta a ele', async () => {
    mostrar('#/', 1280);
    const lado = await screen.findByRole('complementary', { name: 'Agora, água e chat' });
    const aneis = await waitFor(() => {
      const el = lado.querySelector('.agua-resumo') as HTMLElement;
      expect(el).toBeTruthy();
      return el;
    });
    fireEvent.click(aneis);
    const caixa = await screen.findByRole('dialog', { name: 'Água' });
    fireEvent.keyDown(caixa, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(lado.querySelector('.agua-resumo'));
  });

  it('com o chat aberto, o anel da versão curta também abre a página', async () => {
    localStorage.setItem('central-chat-aberto', '1');
    mostrar('#/', 1280);
    const lado = await screen.findByRole('complementary', { name: 'Agora, água e chat' });
    await waitFor(() => expect(lado.querySelector('.cartao-agua.curto')).not.toBeNull());
    fireEvent.click(lado.querySelector('.cartao-agua.curto .agua-resumo')!);
    await screen.findByRole('dialog', { name: 'Água' });
  });

  it('no celular, o cartão no topo de #/agora abre a página', async () => {
    mostrar('#/agora', 390);
    const principal = await waitFor(() => {
      const el = document.querySelector('main .cartao-agua .agua-resumo') as HTMLElement;
      expect(el).toBeTruthy();
      return el;
    });
    fireEvent.click(principal);
    await screen.findByRole('dialog', { name: 'Água' });
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(document.querySelector('main .cartao-agua .agua-resumo'));
  });
});
