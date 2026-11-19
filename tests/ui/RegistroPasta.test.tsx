// A tela do Registro de consumo (V02, Tarefa 13): tabela de leituras, gráfico mensal, nova leitura e o lembrete do envio.
// Quinta-feira, 2026-11-05, 12:20 em Lisboa. A planilha é de mentira (tests/apoio/planilhas-falsas.ts); o resto é o código de verdade.
// Nomes, ids e valores fictícios.
import { act, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { limparConversa } from '../../src/chat/conversa';
import { salvar, semear, semearPalavras } from '../../src/dados/loja';
import type { Pasta } from '../../src/dados/tipos';
import { abrirPodeFalar } from '../../src/ui/PodeFalar';
import { enviarFilaDePlanilhas } from '../../src/dados/planilhas';
import { chamarFalso, falsoDasPlanilhas, reiniciarPlanilhas } from '../apoio/planilhas-falsas';

vi.mock('../../src/dados/planilhas', async (importar) => (await import('../apoio/planilhas-falsas')).comPlanilhasFalsas(await importar<typeof import('../../src/dados/planilhas')>()));

configure({ asyncUtilTimeout: 5000 });

const planilhas = falsoDasPlanilhas();
const PLANILHA = 'planilha-ficticia-agua';

beforeEach(async () => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-11-05T12:20:00Z'));
  limparConversa();
  reiniciarPlanilhas();
  await semear();
  await semearPalavras();
});

function mostrar(hash: string, largura = 1280) {
  Object.defineProperty(window, 'innerWidth', { value: largura, configurable: true, writable: true });
  history.replaceState(null, '', `/${hash}`);
  return render(<App />);
}

const principal = () => within(document.querySelector('main') as HTMLElement);
const leitura = (data: string, valor: string, extra: Record<string, string> = {}) => ({ Data: data, Leitura: valor, Unidade: 'm³', 'Consumo desde a anterior': '', Observação: '', ...extra });

function pastaDaAgua(extra: Partial<Pasta> = {}) {
  return salvar('pastas', {
    id: 'pasta-agua',
    salaId: 'sala-casa',
    tipo: 'registro',
    nome: 'Consumo de Água',
    ordem: 1,
    modelo: 'consumo',
    servico: 'agua',
    unidade: 'm³',
    planilhaId: PLANILHA,
    ...extra,
  });
}

const aguaComHistorico = () =>
  planilhas.planilha(PLANILHA, [
    leitura('15/09/2026', '980'),
    leitura('01/10/2026', '1000'),
    leitura('01/11/2026', '1012'),
    leitura('02/11/2026', '1015,5'),
  ]);

const tabela = async () => within(await principal().findByRole('table', { name: 'Leituras registradas' }));
const linhasDaTabela = async () => (await tabela()).getAllByRole('row').slice(1); // sem o cabeçalho

async function lancar(valor: string, { data, observacao }: { data?: string; observacao?: string } = {}) {
  const formulario = within(await principal().findByRole('form', { name: 'Nova leitura' }));
  if (data) fireEvent.input(formulario.getByLabelText('Data'), { target: { value: data } });
  fireEvent.input(formulario.getByLabelText(/^Leitura/), { target: { value: valor } });
  if (observacao) fireEvent.input(formulario.getByLabelText(/^Observação/), { target: { value: observacao } });
  fireEvent.click(formulario.getByRole('button', { name: 'Guardar leitura' }));
}

describe('a tela do Registro', () => {
  it('tela mostra tabela de leituras e gráfico mensal', async () => {
    await pastaDaAgua();
    aguaComHistorico();
    mostrar('#/sala/sala-casa/pasta/pasta-agua');

    // Tabela: a leitura mais nova primeiro; a primeira de todas não tem consumo ("—").
    const linhas = await linhasDaTabela();
    expect(linhas).toHaveLength(4);
    expect(linhas[0]!.textContent).toContain('02/11/2026');
    expect(linhas[0]!.textContent).toMatch(/1\.015,5/);
    expect(linhas[0]!.textContent).toMatch(/3,5 m³/);
    expect(linhas[1]!.textContent).toMatch(/12 m³/);
    expect(linhas[3]!.textContent).toContain('15/09/2026');
    expect(linhas[3]!.textContent).toContain('—');

    // Gráfico mensal: outubro 20 m³, novembro 15,5 m³ ("medido em" cada mês).
    const grafico = within(principal().getByRole('list', { name: 'Consumo por mês' }));
    const meses = grafico.getAllByRole('listitem');
    expect(meses).toHaveLength(2);
    expect(meses[0]!.textContent).toContain('out/26');
    expect(meses[0]!.textContent).toMatch(/20 m³/);
    expect(meses[1]!.textContent).toContain('nov/26');
    expect(meses[1]!.textContent).toMatch(/15,5 m³/);
    // O leitor de tela lê "mês: valor" (o mês primeiro); o quadro do gráfico rola e se alcança com o Tab.
    expect(meses[1]!.textContent).toBe('nov/26:15,5 m³');
    const quadro = principal().getByRole('region', { name: /Gráfico do consumo por mês/ });
    expect(quadro.getAttribute('tabindex')).toBe('0');
    expect(principal().getByText(/medido em cada mês/i)).toBeTruthy();
  });

  it('pasta sem leitura nenhuma mostra o vazio e o formulário', async () => {
    await pastaDaAgua();
    planilhas.planilha(PLANILHA, []);
    mostrar('#/sala/sala-casa/pasta/pasta-agua');

    expect(await principal().findByText(/Ainda não há leituras/)).toBeTruthy();
    expect(principal().queryByRole('table')).toBeNull();
    expect(principal().getByRole('form', { name: 'Nova leitura' })).toBeTruthy();
  });

  it('adicionar leitura manual anexa linha', async () => {
    await pastaDaAgua();
    aguaComHistorico();
    mostrar('#/sala/sala-casa/pasta/pasta-agua');
    await linhasDaTabela();

    await lancar('1020', { data: '2026-11-05', observacao: 'Fim do mês' });

    const cartao = await principal().findByText('Leitura guardada');
    expect(cartao).toBeTruthy();
    const linhas = planilhas.linhas(PLANILHA);
    expect(linhas).toHaveLength(5);
    expect(linhas[4]!.valores).toMatchObject({ Data: '2026-11-05', Leitura: '1020', Unidade: 'm³', Observação: 'Fim do mês' });
    // A tela já mostra a nova (4,5 m³ desde a anterior) e o formulário volta limpo.
    await waitFor(async () => expect(await linhasDaTabela()).toHaveLength(5));
    expect((await linhasDaTabela())[0]!.textContent).toMatch(/4,5 m³/);
    expect((within(principal().getByRole('form', { name: 'Nova leitura' })).getByLabelText(/^Leitura/) as HTMLInputElement).value).toBe('');

    // Desfazer: a linha continua na planilha, marcada "desfeito", e some da tela.
    fireEvent.click(principal().getByRole('button', { name: 'Desfazer' }));
    await waitFor(async () => expect(await linhasDaTabela()).toHaveLength(4));
    expect(planilhas.linhas(PLANILHA)).toHaveLength(5);
    expect(planilhas.linhas(PLANILHA)[4]!.valores['Observação']).toBe('desfeito');
  });

  it('observação "desfeito" não some calada: grava "(desfeito)" e a linha continua na tela', async () => {
    await pastaDaAgua();
    aguaComHistorico();
    mostrar('#/sala/sala-casa/pasta/pasta-agua');
    await linhasDaTabela();

    await lancar('1020', { data: '2026-11-05', observacao: 'desfeito' });

    expect(await principal().findByText('Leitura guardada')).toBeTruthy();
    expect(planilhas.linhas(PLANILHA)[4]!.valores['Observação']).toBe('(desfeito)');
    await waitFor(async () => expect(await linhasDaTabela()).toHaveLength(5));
    expect((await linhasDaTabela())[0]!.textContent).toContain('(desfeito)');
  });

  it('o foco vai para o cartão a cada leitura guardada, mesmo com o mesmo título', async () => {
    await pastaDaAgua();
    aguaComHistorico();
    mostrar('#/sala/sala-casa/pasta/pasta-agua');
    await linhasDaTabela();

    await lancar('1020', { data: '2026-11-05' });
    await waitFor(() => expect(document.activeElement?.classList.contains('pastas-cartao')).toBe(true));
    (document.activeElement as HTMLElement).blur();
    await lancar('1025', { data: '2026-11-05' });

    await waitFor(() => expect(planilhas.linhas(PLANILHA)).toHaveLength(6));
    await waitFor(() => expect(document.activeElement?.classList.contains('pastas-cartao')).toBe(true));
  });

  it('Desfazer de leitura que já tinha sido enviada da fila diz a verdade: a linha fica marcada, não "não será enviada"', async () => {
    await pastaDaAgua();
    aguaComHistorico();
    mostrar('#/sala/sala-casa/pasta/pasta-agua');
    await linhasDaTabela();
    planilhas.cair();
    await lancar('1030', { data: '2026-11-05' });
    expect(await principal().findByText(/Sem internet: a leitura fica neste aparelho/)).toBeTruthy();

    planilhas.voltar();
    await enviarFilaDePlanilhas(chamarFalso); // a rede voltou e a fila foi enviada, antes de o dono tocar em Desfazer
    expect(planilhas.linhas(PLANILHA)).toHaveLength(5);
    fireEvent.click(principal().getByRole('button', { name: 'Desfazer' }));

    expect(await principal().findByText('Leitura desfeita')).toBeTruthy();
    expect(principal().getByText(/marcada como "desfeito"/)).toBeTruthy();
    expect(principal().queryByText(/não será enviada/)).toBeNull();
    expect(planilhas.linhas(PLANILHA)[4]!.valores['Observação']).toBe('desfeito');
  });

  it('Desfazer que falha mostra o erro, não diz "desfeita" e pode ser tentado de novo', async () => {
    await pastaDaAgua();
    aguaComHistorico();
    mostrar('#/sala/sala-casa/pasta/pasta-agua');
    await linhasDaTabela();
    await lancar('1020', { data: '2026-11-05' });
    await principal().findByText('Leitura guardada');
    await waitFor(async () => expect(await linhasDaTabela()).toHaveLength(5)); // a releitura já terminou

    planilhas.falharAProxima();
    fireEvent.click(principal().getByRole('button', { name: 'Desfazer' }));
    expect(await principal().findByText(/Não consegui desfazer agora/)).toBeTruthy();
    expect(principal().queryByText('Leitura desfeita')).toBeNull();

    fireEvent.click(principal().getByRole('button', { name: 'Desfazer' }));
    expect(await principal().findByText('Leitura desfeita')).toBeTruthy();
    expect(planilhas.linhas(PLANILHA)[4]!.valores['Observação']).toBe('desfeito');
  });

  it('leitura vazia ou que não é número não grava e explica', async () => {
    await pastaDaAgua();
    aguaComHistorico();
    mostrar('#/sala/sala-casa/pasta/pasta-agua');
    await linhasDaTabela();

    await lancar('abc');

    expect(await principal().findByText(/Digite a leitura do contador/)).toBeTruthy();
    expect(planilhas.linhas(PLANILHA)).toHaveLength(4);
    expect(planilhas.pedidos.filter((p) => p.acao === 'anexarLinha')).toEqual([]);
  });

  it('leitura menor mostra aviso e não entra como consumo negativo', async () => {
    await pastaDaAgua();
    aguaComHistorico();
    mostrar('#/sala/sala-casa/pasta/pasta-agua');
    await linhasDaTabela();

    await lancar('900', { data: '2026-11-05' });

    expect(await principal().findByText('Leitura guardada')).toBeTruthy();
    expect(principal().getByText(/menor que a anterior/)).toBeTruthy();
    await waitFor(async () => expect(await linhasDaTabela()).toHaveLength(5));
    const nova = (await linhasDaTabela())[0]!;
    expect(nova.textContent).toContain('05/11/2026');
    expect(nova.textContent).toContain('—');
    expect(nova.textContent).toMatch(/menor que a anterior/i);
    // Nenhum número negativo em lugar nenhum da tabela nem do gráfico, e novembro continua em 15,5.
    expect((await principal().findByRole('table', { name: 'Leituras registradas' })).textContent).not.toMatch(/-\s?\d/);
    const meses = within(principal().getByRole('list', { name: 'Consumo por mês' })).getAllByRole('listitem');
    expect(meses[1]!.textContent).toMatch(/15,5 m³/);
    expect(meses.map((m) => m.textContent).join(' ')).not.toMatch(/-\s?\d/);
  });

  it('leitura menor que já estava na planilha também mostra aviso e consumo "—"', async () => {
    await pastaDaAgua();
    planilhas.planilha(PLANILHA, [leitura('01/10/2026', '1000'), leitura('01/11/2026', '980'), leitura('03/11/2026', '990')]);
    mostrar('#/sala/sala-casa/pasta/pasta-agua');

    const linhas = await linhasDaTabela();
    expect(linhas[1]!.textContent).toMatch(/menor que a anterior/i);
    expect(linhas[1]!.textContent).toContain('—');
    expect(linhas[0]!.textContent).toMatch(/10 m³/); // a seguinte compara com a menor
    expect(principal().queryByText(/-\d/)).toBeNull();
  });

  it('linha com data ou leitura ilegível fica fora da conta, com aviso', async () => {
    await pastaDaAgua();
    planilhas.planilha(PLANILHA, [leitura('01/10/2026', '1000'), leitura('semana passada', '1005'), leitura('01/11/2026', 'xyz'), leitura('02/11/2026', '1012')]);
    mostrar('#/sala/sala-casa/pasta/pasta-agua');

    expect(await linhasDaTabela()).toHaveLength(2);
    expect(principal().getByText(/2 linhas da planilha ficaram de fora/)).toBeTruthy();
  });

  it('sem rede mostra a última leitura guardada no aparelho e avisa', async () => {
    await pastaDaAgua();
    aguaComHistorico();
    const { unmount } = mostrar('#/sala/sala-casa/pasta/pasta-agua');
    await linhasDaTabela(); // lê e guarda no cache
    unmount();

    planilhas.cair();
    mostrar('#/sala/sala-casa/pasta/pasta-agua');

    expect(await linhasDaTabela()).toHaveLength(4);
    expect(principal().getByText(/Sem internet: mostrando o que este aparelho guardou/)).toBeTruthy();
  });

  it('sem rede a leitura nova fica na fila e o cartão avisa', async () => {
    await pastaDaAgua();
    aguaComHistorico();
    mostrar('#/sala/sala-casa/pasta/pasta-agua');
    await linhasDaTabela();
    planilhas.cair();

    await lancar('1030', { data: '2026-11-05' });

    expect(await principal().findByText(/Sem internet: a leitura fica neste aparelho/)).toBeTruthy();
    await waitFor(async () => expect(await linhasDaTabela()).toHaveLength(5));
    expect((await linhasDaTabela())[0]!.textContent).toMatch(/Esperando a rede/);
    expect(planilhas.linhas(PLANILHA)).toHaveLength(4);
  });

  it('planilha que mudou (falta coluna) avisa e não grava', async () => {
    await pastaDaAgua();
    planilhas.planilha(PLANILHA, [leitura('01/10/2026', '1000')], ['Data', 'Leitura', 'Observação', 'id']); // sem "Unidade"
    mostrar('#/sala/sala-casa/pasta/pasta-agua');

    expect(await principal().findByText(/A planilha mudou/)).toBeTruthy();
    await lancar('1020', { data: '2026-11-05' });

    expect(await principal().findByText(/Nada foi gravado/)).toBeTruthy();
    expect(planilhas.linhas(PLANILHA)).toHaveLength(1);
  });

  it('nunca usa HTML de dentro da planilha: o texto da planilha aparece como texto', async () => {
    await pastaDaAgua();
    planilhas.planilha(PLANILHA, [leitura('01/10/2026', '1000', { Observação: '<img src=x onerror=alert(1)>' })]);
    mostrar('#/sala/sala-casa/pasta/pasta-agua');

    const linhas = await linhasDaTabela();
    expect(linhas[0]!.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(document.querySelector('main img')).toBeNull();
  });

  it('pasta sem planilha explica e não tenta ler', async () => {
    await pastaDaAgua({ planilhaId: undefined });
    mostrar('#/sala/sala-casa/pasta/pasta-agua');

    expect(await principal().findByText(/ainda não tem planilha/)).toBeTruthy();
    expect(principal().queryByRole('form', { name: 'Nova leitura' })).toBeNull();
    expect(planilhas.pedidos).toEqual([]);
  });
});

describe('Pode falar dentro da pasta', () => {
  it('o número dito (ou escrito) vai direto para a pasta onde o dono estava', async () => {
    await pastaDaAgua();
    planilhas.planilha(PLANILHA, [leitura('01/11/2026', '1000')]);
    mostrar('#/sala/sala-casa/pasta/pasta-agua');
    await linhasDaTabela();

    act(() => abrirPodeFalar());
    fireEvent.input(await screen.findByRole('textbox', { name: 'Texto falado' }), { target: { value: '1012,5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pronto' }));

    expect(await screen.findByText('Leitura guardada')).toBeTruthy();
    expect(screen.getByText(/Consumo desde a anterior: 12,5 m³/)).toBeTruthy();
    expect(planilhas.linhas(PLANILHA)[1]!.valores).toMatchObject({ Data: '2026-11-05', Leitura: '1012.5', Unidade: 'm³' });
  });
});

describe('lembrete do envio', () => {
  it('faixa de lembrete aparece a N dias do envio', async () => {
    await pastaDaAgua({ diaDeEnvio: 8 }); // hoje é dia 5: faltam 3 dias
    aguaComHistorico();
    mostrar('#/sala/sala-casa/pasta/pasta-agua');

    expect(await principal().findByText(/Faltam 3 dias para enviar a leitura de Água ao portal \(dia 8\)/)).toBeTruthy();
  });

  it('no dia do envio e na véspera, o texto muda', async () => {
    await pastaDaAgua({ diaDeEnvio: 5 });
    aguaComHistorico();
    const { unmount } = mostrar('#/sala/sala-casa/pasta/pasta-agua');
    expect(await principal().findByText(/Hoje é o dia de enviar a leitura de Água ao portal/)).toBeTruthy();
    unmount();

    await salvar('pastas', { id: 'pasta-agua', salaId: 'sala-casa', tipo: 'registro', nome: 'Consumo de Água', ordem: 1, modelo: 'consumo', servico: 'agua', unidade: 'm³', planilhaId: PLANILHA, diaDeEnvio: 6 });
    mostrar('#/sala/sala-casa/pasta/pasta-agua');
    expect(await principal().findByText(/Amanhã é o dia de enviar a leitura de Água ao portal/)).toBeTruthy();
  });

  it('longe do envio (4 dias ou mais) ou sem dia de envio não mostra faixa', async () => {
    await pastaDaAgua({ diaDeEnvio: 9 });
    aguaComHistorico();
    const { unmount } = mostrar('#/sala/sala-casa/pasta/pasta-agua');
    await linhasDaTabela();
    expect(principal().queryByText(/enviar a leitura/)).toBeNull();
    unmount();

    await salvar('pastas', { id: 'pasta-agua', salaId: 'sala-casa', tipo: 'registro', nome: 'Consumo de Água', ordem: 1, modelo: 'consumo', servico: 'agua', unidade: 'm³', planilhaId: PLANILHA });
    mostrar('#/sala/sala-casa/pasta/pasta-agua');
    await linhasDaTabela();
    expect(principal().queryByText(/enviar a leitura/)).toBeNull();
  });

  it('o Hoje também lembra, com link para a pasta (no padrão do cartão da água)', async () => {
    await pastaDaAgua({ diaDeEnvio: 7 });
    await salvar('pastas', { id: 'pasta-luz', salaId: 'sala-casa', tipo: 'registro', nome: 'Consumo de Luz', ordem: 2, modelo: 'consumo', servico: 'luz', unidade: 'kWh', planilhaId: 'planilha-ficticia-luz', diaDeEnvio: 25 });
    mostrar('#/');

    const lembrete = await principal().findByText(/Faltam 2 dias para enviar a leitura de Água ao portal/);
    expect(lembrete).toBeTruthy();
    const link = lembrete.closest('a') ?? lembrete.parentElement!.querySelector('a');
    expect(link?.getAttribute('href')).toBe('#/sala/sala-casa/pasta/pasta-agua');
    expect(document.body.textContent).not.toMatch(/leitura de Luz/);
  });
});

// ---- Acessibilidade (Tarefa 19, correções): foco, região viva e erro ligado ao campo ----

/** Toda região viva da tela, sem nenhum botão ou link dentro (o leitor de tela lê o botão junto com a frase). */
const noFormulario = () => within(principal().getByRole('form', { name: 'Nova leitura' }));
const regioesVivas = () => [...document.querySelectorAll<HTMLElement>('main [role="status"], main [aria-live]')];

describe('acessibilidade do Registro', () => {
  const lerComVariasLeituras = () =>
    planilhas.planilha(
      PLANILHA,
      Array.from({ length: 14 }, (_, i) => leitura(`${String(i + 1).padStart(2, '0')}/10/2026`, String(1000 + i * 2))),
    );

  it('Fechar o cartão leva o foco ao campo Leitura (nunca ao body)', async () => {
    await pastaDaAgua();
    aguaComHistorico();
    mostrar('#/sala/sala-casa/pasta/pasta-agua');
    await linhasDaTabela();
    await lancar('1020', { data: '2026-11-05' });
    const cartao = await principal().findByRole('article');
    await waitFor(() => expect(document.activeElement).toBe(cartao)); // o foco chega ao cartão antes de o dono tocar em Fechar
    fireEvent.click(within(cartao).getByRole('button', { name: 'Fechar' }));

    expect(principal().queryByRole('article')).toBeNull();
    expect(document.activeElement).toBe(noFormulario().getByLabelText(/^Leitura/));
  });

  it('o cartão não fica dentro de uma região viva e a região viva não tem botões', async () => {
    await pastaDaAgua();
    aguaComHistorico();
    mostrar('#/sala/sala-casa/pasta/pasta-agua');
    await linhasDaTabela();
    await lancar('1020', { data: '2026-11-05' });
    const cartao = await principal().findByRole('article');

    expect(cartao.closest('[role="status"], [aria-live]')).toBeNull();
    expect(cartao.getAttribute('aria-labelledby')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(cartao));
    for (const regiao of regioesVivas()) expect(regiao.querySelector('button, a[href]')).toBeNull();
  });

  it('"Mostrar todas as N leituras" vira "Mostrar menos" no mesmo botão e o foco fica nele', async () => {
    await pastaDaAgua();
    lerComVariasLeituras();
    mostrar('#/sala/sala-casa/pasta/pasta-agua');
    await linhasDaTabela();

    const botao = principal().getByRole('button', { name: 'Mostrar todas as 14 leituras' });
    expect(botao.getAttribute('aria-expanded')).toBe('false');
    botao.focus();
    fireEvent.click(botao);

    await waitFor(() => expect(botao.textContent).toBe('Mostrar menos'));
    expect(botao.isConnected).toBe(true);
    expect(botao.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(botao);
    expect(await linhasDaTabela()).toHaveLength(14);

    fireEvent.click(botao);
    await waitFor(() => expect(botao.textContent).toBe('Mostrar todas as 14 leituras'));
    expect(await linhasDaTabela()).toHaveLength(12);
    expect(document.activeElement).toBe(botao);
  });

  it('o erro da leitura fica ligado ao campo Leitura: aria-invalid e aria-describedby só nele', async () => {
    await pastaDaAgua();
    aguaComHistorico();
    mostrar('#/sala/sala-casa/pasta/pasta-agua');
    await linhasDaTabela();
    await lancar('abc');

    const campo = noFormulario().getByLabelText(/^Leitura/);
    const mensagem = await principal().findByText(/Digite a leitura do contador/);
    expect(campo.getAttribute('aria-invalid')).toBe('true');
    expect(campo.getAttribute('aria-describedby')).toBe(mensagem.id);
    expect(mensagem.id).not.toBe('');
    expect(noFormulario().getByLabelText('Data').getAttribute('aria-invalid')).toBeNull();
    expect(document.activeElement).toBe(campo);

    fireEvent.input(campo, { target: { value: '1' } });
    expect(campo.getAttribute('aria-invalid')).toBeNull();
    expect(campo.getAttribute('aria-describedby')).toBeNull();
  });

  it('data no futuro mostra a mensagem da Central (o formulário não deixa o navegador bloquear) e marca só o campo Data', async () => {
    await pastaDaAgua();
    aguaComHistorico();
    mostrar('#/sala/sala-casa/pasta/pasta-agua');
    await linhasDaTabela();
    const form = principal().getByRole('form', { name: 'Nova leitura' });
    expect(form.hasAttribute('novalidate')).toBe(true);
    await lancar('1030', { data: '2026-12-01' });

    const mensagem = await principal().findByText('A data da leitura não pode estar no futuro.');
    const data = noFormulario().getByLabelText('Data');
    expect(data.getAttribute('aria-invalid')).toBe('true');
    expect(data.getAttribute('aria-describedby')).toBe(mensagem.id);
    expect(noFormulario().getByLabelText(/^Leitura/).getAttribute('aria-invalid')).toBeNull();
    expect(document.activeElement).toBe(data);
  });

  it('os avisos de rede moram numa região viva que já existe antes de ter texto', async () => {
    await pastaDaAgua();
    aguaComHistorico();
    const { unmount } = mostrar('#/sala/sala-casa/pasta/pasta-agua');
    await linhasDaTabela();
    unmount();

    planilhas.cair();
    // Quando a região nasce, não tem texto: o texto entra depois, dentro dela.
    let nasceuCom: string | null = null;
    const olho = new MutationObserver((mudancas) => {
      for (const m of mudancas)
        for (const no of m.addedNodes) {
          const achada = no instanceof HTMLElement ? (no.matches('.aviso-vivo') ? no : no.querySelector('.aviso-vivo')) : null;
          if (achada && nasceuCom === null) nasceuCom = achada.textContent ?? '';
        }
    });
    olho.observe(document.body, { childList: true, subtree: true });
    mostrar('#/sala/sala-casa/pasta/pasta-agua');
    await linhasDaTabela();
    olho.disconnect();

    const regiao = document.querySelector<HTMLElement>('main .aviso-vivo');
    expect(regiao?.getAttribute('role')).toBe('status');
    expect(nasceuCom).toBe('');
    expect(regiao?.textContent).toMatch(/Sem internet: mostrando o que este aparelho guardou/);
  });
});
