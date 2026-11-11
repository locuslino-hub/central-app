// Tarefa 26: o cartão Água (completo e curto), na coluna direita e no topo do Agora (celular).
// Quinta-feira, 2026-11-05, 12:20 em Lisboa (inverno: UTC+0). Nomes fictícios.
import { act, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { limparConversa } from '../../src/chat/conversa';
import { listar, salvar, semear, semearPalavras } from '../../src/dados/loja';
import type { AguaRegistro, ParaSalvar } from '../../src/dados/tipos';
import { AguaCurta, CartaoAgua, desfazerUltimoGole, Garrafinha, registrarGole } from '../../src/ui/Agua';
import { CHAVE_DO_CHAT } from '../../src/ui/PainelDireito';

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

const cartao = () => screen.getByRole('region', { name: 'Água' });
const total = (raiz: HTMLElement = cartao()) => raiz.querySelector('.agua-total')!.textContent;
const botao = (nome: string | RegExp, raiz: HTMLElement = cartao()) => within(raiz).getByRole('button', { name: nome });
const dica = () => cartao().querySelector('.agua-dica') as HTMLElement;
const garrafinhasDaDica = () =>
  Array.from(dica().querySelectorAll('.garrafinhas svg')).map((s) => [s.getAttribute('data-cor'), s.getAttribute('data-fracao')]);

describe('Garrafinha', () => {
  it('é um desenho sem texto para o leitor de tela, com a fração e a cor', () => {
    const { container } = render(<Garrafinha fracao={0.25} cor="coral" />);
    const desenho = container.querySelector('svg')!;
    expect(desenho.getAttribute('aria-hidden')).toBe('true');
    expect(desenho.getAttribute('data-cor')).toBe('coral');
    expect(desenho.getAttribute('data-fracao')).toBe('0.25');
  });

  it('a cor padrão é azul', () => {
    const { container } = render(<Garrafinha fracao={1} />);
    expect(container.querySelector('svg')!.getAttribute('data-cor')).toBe('azul');
  });
});

describe('CartaoAgua: estados às 12:20 (esperado 619 mL)', () => {
  it('atrás: selo, dica com o quarto certo, botão ¼ sugerido e uma garrafinha coral', async () => {
    await goles([250, '08:30'], [250, '10:50']);
    render(<CartaoAgua aoAbrir={() => {}} />);
    await waitFor(() => expect(total()).toBe('500 mL'));
    expect(cartao().querySelector('.agua-selo')!.textContent).toBe('Atrás 119 mL');
    expect(dica().textContent).toBe('Para alcançar o ritmo, beba ¼ da garrafa (125 mL).');
    const sugerido = botao('¼, 125 mL, sugerido');
    expect(sugerido.classList.contains('sugerido')).toBe(true);
    expect(cartao().querySelectorAll('button.sugerido')).toHaveLength(1);
    expect(garrafinhasDaDica()).toEqual([['coral', '0.25']]);
    expect(cartao().textContent).toContain('de 2.000 mL · 25%');
  });

  it('sem goles: 1 garrafa e ¼, botão Toda sugerido e duas garrafinhas coral (cheia e ¼)', async () => {
    render(<CartaoAgua aoAbrir={() => {}} />);
    await waitFor(() => expect(cartao().querySelector('.agua-selo')!.textContent).toBe('Atrás 619 mL'));
    expect(total()).toBe('0 mL');
    expect(dica().textContent).toBe('Para alcançar o ritmo, beba 1 garrafa e ¼ (625 mL).');
    expect(botao('Toda, 500 mL, sugerido').classList.contains('sugerido')).toBe(true);
    expect(garrafinhasDaDica()).toEqual([
      ['coral', '1'],
      ['coral', '0.25'],
    ]);
    expect(cartao().textContent).toContain('Nada registrado ainda');
  });

  it('em dia: "Em dia, N mL à frente." e a hora do próximo ¼, sem botão sugerido', async () => {
    await goles([500, '08:30'], [250, '10:50'], [250, '12:00']);
    render(<CartaoAgua aoAbrir={() => {}} />);
    await waitFor(() => expect(total()).toBe('1.000 mL'));
    expect(cartao().querySelector('.agua-selo')!.textContent).toBe('No ritmo');
    // folga 381 mL (1.000 - 619) a 2,381 mL/min: 160 min depois de 12:20 = 15:00.
    expect(dica().textContent).toBe('Em dia, 381 mL à frente. Próximo ¼ de garrafa por volta das 15:00.');
    expect(cartao().querySelectorAll('button.sugerido')).toHaveLength(0);
    expect(cartao().querySelector('.agua-dica .garrafinhas')).toBeNull();
  });

  it('em dia com folga zero ou negativa: só "Em dia.", sem "0 mL à frente" nem número negativo', async () => {
    await goles([500, '08:30'], [100, '12:00']); // 600: falta 19 mL, folga -19
    render(<CartaoAgua aoAbrir={() => {}} />);
    await waitFor(() => expect(total()).toBe('600 mL'));
    expect(dica().textContent).toMatch(/^Em dia\. Próximo ¼ de garrafa por volta das \d\d:\d\d\.$/);
    expect(dica().textContent).not.toMatch(/à frente|-/);
  });

  it('em dia exatamente no esperado: "Em dia." sem "0 mL à frente"', async () => {
    await goles([500, '08:30'], [119, '12:00']); // 619 = esperado
    render(<CartaoAgua aoAbrir={() => {}} />);
    await waitFor(() => expect(total()).toBe('619 mL'));
    expect(dica().textContent).not.toContain('à frente');
    expect(dica().textContent).toContain('Em dia.');
  });

  it('meta batida: selo, dica e nenhum botão sugerido', async () => {
    await goles([500, '08:30'], [500, '10:00'], [500, '11:00'], [500, '12:00']);
    render(<CartaoAgua aoAbrir={() => {}} />);
    await waitFor(() => expect(total()).toBe('2.000 mL'));
    expect(cartao().querySelector('.agua-selo')!.textContent).toBe('Meta batida ✓');
    expect(dica().textContent).toBe('Meta do dia batida. Pode beber sem contar.');
    expect(cartao().querySelectorAll('button.sugerido')).toHaveLength(0);
    expect(cartao().textContent).toContain('Garrafa 4 de 4');
  });

  it('a garrafa da vez e a pergunta', async () => {
    await goles([500, '08:30'], [250, '10:50']);
    render(<CartaoAgua aoAbrir={() => {}} />);
    await waitFor(() => expect(total()).toBe('750 mL'));
    expect(cartao().textContent).toContain('Garrafa 2 de 4 · quanto da garrafa (500 mL) você bebeu?');
  });

  it('antes das 08:00 não há marca do esperado; depois das 22:00 o próximo gole não é prometido', async () => {
    vi.setSystemTime(Date.parse('2026-11-05T07:00:00Z'));
    const { unmount } = render(<CartaoAgua aoAbrir={() => {}} />);
    await waitFor(() => expect(cartao().querySelector('.agua-selo')!.textContent).toBe('No ritmo')); // já leu
    expect(total()).toBe('0 mL');
    expect(cartao().querySelector('.agua-alvo')).toBeNull();
    expect(dica().textContent).toBe('Em dia. Próximo ¼ de garrafa por volta das 07:20.');
    unmount();

    vi.setSystemTime(Date.parse('2026-11-05T22:30:00Z'));
    await goles([2000 - 100, '21:00']); // 1.900: falta 100 para 2.000, atrás
    render(<CartaoAgua aoAbrir={() => {}} />);
    await waitFor(() => expect(total()).toBe('1.900 mL'));
    expect(dica().textContent).toBe('Para alcançar o ritmo, beba ¼ da garrafa (125 mL).');
  });

  it('depois das 22:00, em dia, não fala de próximo gole', async () => {
    vi.setSystemTime(Date.parse('2026-11-05T22:30:00Z'));
    await goles([1950, '21:00']); // falta 50: em dia
    render(<CartaoAgua aoAbrir={() => {}} />);
    await waitFor(() => expect(total()).toBe('1.950 mL'));
    expect(dica().textContent).toBe('Em dia.');
  });
});

describe('CartaoAgua: registrar e desfazer', () => {
  it('tocar em ½ registra 250 mL: total 750 mL e "Último: 12:20 · 250 mL"', async () => {
    await goles([500, '08:30']);
    render(<CartaoAgua aoAbrir={() => {}} />);
    await waitFor(() => expect(total()).toBe('500 mL'));
    fireEvent.click(botao(/^½, 250 mL/));
    await waitFor(() => expect(total()).toBe('750 mL'));
    expect(cartao().textContent).toContain('Último: 12:20 · 250 mL');
    const todos = await vivos();
    expect(todos.map((g) => [g.data, g.hora, g.ml])).toContainEqual([HOJE, '12:20', 250]);
  });

  it('registrarGole guarda dia, hora de Lisboa e mL', async () => {
    await registrarGole(375, new Date('2026-11-05T09:05:00Z'));
    expect((await vivos()).map((g) => [g.data, g.hora, g.ml])).toEqual([[HOJE, '09:05', 375]]);
  });

  it('Desfazer tira só o último gole de hoje e não mexe nos de outros dias', async () => {
    await salvar('agua', gole(500, '20:00', '2026-11-04'));
    await goles([250, '08:30'], [125, '10:00'], [375, '11:45']);
    render(<CartaoAgua aoAbrir={() => {}} />);
    await waitFor(() => expect(total()).toBe('750 mL'));
    fireEvent.click(botao('Desfazer o último gole'));
    await waitFor(() => expect(total()).toBe('375 mL'));
    expect(cartao().textContent).toContain('Último: 10:00 · 125 mL');
    const restantes = (await vivos()).map((g) => [g.data, g.hora, g.ml]);
    expect(restantes).toEqual(
      expect.arrayContaining([
        ['2026-11-04', '20:00', 500],
        [HOJE, '08:30', 250],
        [HOJE, '10:00', 125],
      ]),
    );
    expect(restantes).toHaveLength(3);
  });

  it('Desfazer fica desabilitado sem goles hoje, mesmo com goles de ontem', async () => {
    await salvar('agua', gole(500, '20:00', '2026-11-04'));
    render(<CartaoAgua aoAbrir={() => {}} />);
    await waitFor(() => expect(botao('Desfazer o último gole')).toBeTruthy());
    await waitFor(() => expect((botao('Desfazer o último gole') as HTMLButtonElement).disabled).toBe(true));
    // Mesmo chamado de fora, não apaga o de ontem.
    await desfazerUltimoGole(HOJE);
    expect(await vivos()).toHaveLength(1);
  });

  it('com a loja ainda lendo: sem "Atrás" falso, sem dica, sem botão sugerido nem trecho que falta; depois que lê, aparecem', async () => {
    render(<CartaoAgua aoAbrir={() => {}} />);
    expect(cartao().textContent).not.toMatch(/atrás/i);
    expect(cartao().textContent).not.toContain('Para alcançar o ritmo');
    expect(cartao().querySelectorAll('.sugerido')).toHaveLength(0);
    expect(cartao().querySelector('.agua-selo')!.classList.contains('carregando')).toBe(true);
    expect(cartao().querySelector('.agua-dica')!.classList.contains('carregando')).toBe(true);
    expect(cartao().querySelector('.agua-dica .garrafinhas')).toBeNull();
    expect(cartao().querySelector('.agua-falta')?.classList.contains('carregando') ?? true).toBe(true);
    // O lugar do selo e da dica fica guardado (nada de texto, mas os elementos existem).
    expect(cartao().querySelector('.agua-selo')).toBeTruthy();
    await waitFor(() => expect(cartao().querySelector('.agua-selo')!.textContent).toBe('Atrás 619 mL'));
    expect(cartao().querySelectorAll('button.sugerido')).toHaveLength(1);
    expect(cartao().querySelector('.agua-falta')!.classList.contains('carregando')).toBe(false);
  });

  it('o Desfazer do cartão se chama "Desfazer o último gole" (há outro "Desfazer" no Agora)', async () => {
    render(<CartaoAgua aoAbrir={() => {}} />);
    expect(within(cartao()).queryByRole('button', { name: 'Desfazer' })).toBeNull();
    expect(botao('Desfazer o último gole').textContent).toBe('Desfazer');
  });

  it('com a loja ainda lendo, o Desfazer também está desabilitado', () => {
    render(<CartaoAgua aoAbrir={() => {}} />);
    expect((botao('Desfazer o último gole') as HTMLButtonElement).disabled).toBe(true);
  });

  it('tocar no total abre a página', async () => {
    const aoAbrir = vi.fn();
    render(<CartaoAgua aoAbrir={aoAbrir} />);
    fireEvent.click(botao(/mL de 2\.000 mL/));
    expect(aoAbrir).toHaveBeenCalledTimes(1);
  });

  it('os quatro botões têm 125, 250, 375 e 500 mL', async () => {
    render(<CartaoAgua aoAbrir={() => {}} />);
    for (const nome of [/^¼, 125 mL/, /^½, 250 mL/, /^¾, 375 mL/, /^Toda, 500 mL/]) expect(botao(nome)).toBeTruthy();
  });
});

describe('CartaoAgua: virada do dia', () => {
  it('à meia-noite o total volta a 0 mL sem remontar o componente', async () => {
    await goles([500, '08:30'], [250, '12:00']);
    render(<CartaoAgua aoAbrir={() => {}} />);
    await waitFor(() => expect(total()).toBe('750 mL'));
    const elemento = cartao();
    vi.setSystemTime(Date.parse('2026-11-06T00:01:00Z'));
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(total()).toBe('0 mL'));
    expect(cartao()).toBe(elemento);
    expect(cartao().textContent).toContain('Nada registrado ainda');
    expect(cartao().querySelector('.agua-selo')!.textContent).toBe('No ritmo');
    // Desfazer não pega no gole de ontem.
    expect((botao('Desfazer o último gole') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('AguaCurta', () => {
  const curta = () => screen.getByRole('region', { name: 'Água' });

  it('atrás: linha com total, porcentagem, atraso e o botão da garrafa sugerida (destacado)', async () => {
    await goles([250, '08:30'], [125, '10:50']); // 375: falta 244 → ½ garrafa
    render(<AguaCurta aoAbrir={() => {}} />);
    await waitFor(() => expect(curta().textContent).toContain('Água: 375 mL'));
    expect(curta().textContent).toContain('19% · atrás 244 mL');
    const sugerido = botao('+½, 250 mL, sugerido', curta());
    expect(sugerido.classList.contains('sugerido')).toBe(true);
    expect(sugerido.textContent).toContain('+½');
    expect(sugerido.textContent).toContain('250 mL');
    fireEvent.click(sugerido);
    await waitFor(() => expect(curta().textContent).toContain('Água: 625 mL'));
  });

  it('em dia: "no ritmo" e "+¼" sem destaque', async () => {
    await goles([1000, '08:30']);
    render(<AguaCurta aoAbrir={() => {}} />);
    await waitFor(() => expect(curta().textContent).toContain('Água: 1.000 mL'));
    expect(curta().textContent).toContain('50% · no ritmo');
    const mais = botao('+¼, 125 mL', curta());
    expect(mais.classList.contains('sugerido')).toBe(false);
    expect(mais.textContent).toContain('125 mL');
  });

  it('meta batida: "meta batida ✓"', async () => {
    await goles([2000, '08:30']);
    render(<AguaCurta aoAbrir={() => {}} />);
    await waitFor(() => expect(curta().textContent).toContain('100% · meta batida ✓'));
    expect(curta().querySelectorAll('button.sugerido')).toHaveLength(0);
  });

  it('sugerindo uma garrafa inteira ou mais, o botão diz "+1 garrafa" (e se chama "+Toda" para o leitor de tela)', async () => {
    render(<AguaCurta aoAbrir={() => {}} />); // 0 mL, falta 619
    const botaoToda = await waitFor(() => botao('+Toda, 500 mL, sugerido', curta()));
    expect(botaoToda.textContent).toBe('+1 garrafa500 mL');
    expect(botaoToda.classList.contains('sugerido')).toBe(true);
  });

  it('com a loja ainda lendo: sem "atrás" falso e sem botão sugerido; depois que lê, aparecem', async () => {
    render(<AguaCurta aoAbrir={() => {}} />);
    expect(curta().textContent).not.toMatch(/atrás/i);
    expect(curta().querySelectorAll('.sugerido')).toHaveLength(0);
    expect(curta().querySelector('.agua-sub .carregando')).toBeTruthy();
    expect(botao(/^\+¼, 125 mL$/, curta())).toBeTruthy();
    await waitFor(() => expect(curta().textContent).toContain('atrás 619 mL'));
    expect(curta().querySelectorAll('button.sugerido')).toHaveLength(1);
  });

  it('o anel e o total abrem a página', () => {
    const aoAbrir = vi.fn();
    render(<AguaCurta aoAbrir={aoAbrir} />);
    fireEvent.click(botao(/^Água: 0 mL/, curta()));
    expect(aoAbrir).toHaveBeenCalledTimes(1);
  });
});

describe('na casca', () => {
  function mostrar(hash: string, largura: number) {
    Object.defineProperty(window, 'innerWidth', { value: largura, configurable: true, writable: true });
    history.replaceState(null, '', `/${hash}`);
    render(<App />);
  }
  const lado = () => screen.getByRole('complementary', { name: 'Agora, água e chat' });
  const alternar = () => within(lado()).getByRole('button', { name: /^Chat/ });

  it('com o chat recolhido: Agora, Água e Chat, nessa ordem, e o cartão completo', async () => {
    mostrar('#/', 1280);
    const secoes = Array.from(lado().querySelectorAll(':scope > section')).map((s) => s.getAttribute('class'));
    expect(secoes[0]).toContain('cartao-agora');
    expect(secoes[1]).toContain('cartao-agua');
    expect(secoes[2]).toContain('cartao-chat');
    expect(secoes).toHaveLength(3);
    const titulos = within(lado()).getAllByRole('heading').map((h) => h.textContent);
    expect(titulos).toEqual(['Agora', 'Água', 'Chat']);
    await waitFor(() => expect(within(lado()).getByRole('button', { name: /^¼, 125 mL/ })).toBeTruthy());
    expect(lado().querySelector('.cartao-agua.curto')).toBeNull();
  });

  it('com o chat aberto: a versão curta no lugar do cartão', async () => {
    mostrar('#/', 1280);
    fireEvent.click(alternar());
    await waitFor(() => expect(lado().querySelector('.cartao-agua.curto')).not.toBeNull());
    expect(lado().querySelectorAll('.cartao-agua')).toHaveLength(1);
    expect(within(lado()).queryByRole('button', { name: /^¼, 125 mL$/ })).toBeNull();
    const mais = await within(lado()).findByRole('button', { name: /^\+Toda, 500 mL/ });
    expect(mais.classList.contains('sugerido')).toBe(true);
    // Recolher volta ao cartão completo.
    fireEvent.click(alternar());
    await waitFor(() => expect(lado().querySelector('.cartao-agua.curto')).toBeNull());
  });

  it('o chat aberto lembrado do aparelho também mostra a versão curta', async () => {
    localStorage.setItem(CHAVE_DO_CHAT, '1');
    mostrar('#/', 1280);
    await waitFor(() => expect(lado().querySelector('.cartao-agua.curto')).not.toBeNull());
  });

  it('#/chat (a página já é o chat): a coluna mostra Agora e o cartão completo, sem o chat', async () => {
    localStorage.setItem(CHAVE_DO_CHAT, '1');
    mostrar('#/chat', 1280);
    await waitFor(() => expect(lado().querySelector('.cartao-agua')).not.toBeNull());
    expect(lado().querySelector('.cartao-agua.curto')).toBeNull();
  });

  it('#/agora no computador: a água fica na coluna e a página não a repete', async () => {
    mostrar('#/agora', 1280);
    await waitFor(() => expect(within(lado()).getByRole('region', { name: 'Água' })).toBeTruthy());
    expect(document.querySelectorAll('.cartao-agua')).toHaveLength(1);
    expect(document.querySelector('main .cartao-agua')).toBeNull();
  });

  it('#/agora no celular: o cartão completo no topo da página', async () => {
    mostrar('#/agora', 390);
    const principal = document.querySelector('main') as HTMLElement;
    await waitFor(() => expect(principal.querySelector('.cartao-agua')).not.toBeNull());
    const pagina = principal.querySelector('.agora-pagina')!;
    expect(pagina.firstElementChild!.classList.contains('cartao-agua')).toBe(true);
    expect(within(principal).getByRole('button', { name: /^Toda, 500 mL/ })).toBeTruthy();
  });

  it('#/agora no tablet também mostra o cartão no topo', async () => {
    mostrar('#/agora', 900);
    await waitFor(() => expect(document.querySelector('main .cartao-agua')).not.toBeNull());
  });
});
