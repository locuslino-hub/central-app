import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Quinta-feira, 2026-11-05, 12:20 em Lisboa (inverno: UTC+0).
const AGORA = '2026-11-05T12:20:00+00:00';
const URL_FICTICIA = 'https://script.google.com/macros/s/ID-FICTICIO/exec';

/** Com CAPTURAS_T11 definida, as imagens vão para essa pasta (conferência visual). */
const CAPTURAS = process.env.CAPTURAS_T11;
async function capturar(page: Page, nome: string) {
  if (!CAPTURAS) return;
  mkdirSync(CAPTURAS, { recursive: true });
  // Espera a animação de entrada acabar, para a imagem não sair translúcida.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime as number)) // as infinitas (o ponto que pulsa) não acabam
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  await page.screenshot({ path: join(CAPTURAS, `${nome}.png`), fullPage: true });
}

type EventoDeTeste = {
  id: string;
  agendaId: string;
  titulo: string;
  inicio: string;
  fim: string;
  diaInteiro: boolean;
  livre: boolean;
  recusado: boolean;
  salaId: string | null;
  link: string | null;
};

let contador = 0;
function evento(titulo: string, extra: Partial<EventoDeTeste>): EventoDeTeste {
  contador += 1;
  return {
    id: `evento-${contador}`,
    agendaId: 'primary',
    titulo,
    inicio: '2026-11-05T09:00:00+00:00',
    fim: '2026-11-05T10:00:00+00:00',
    diaInteiro: false,
    livre: false,
    recusado: false,
    salaId: null,
    link: null,
    ...extra,
  };
}

const em = (dia: string, inicio: string, fim: string, titulo: string, extra: Partial<EventoDeTeste> = {}) =>
  evento(titulo, { inicio: `${dia}T${inicio}:00+00:00`, fim: `${dia}T${fim}:00+00:00`, ...extra });

/** Nomes fictícios; salas fixas do app. */
const EVENTOS: EventoDeTeste[] = [
  em('2026-11-02', '09:00', '11:00', 'Aula de Modelagem', { salaId: 'sala-aulas' }),
  em('2026-11-03', '14:00', '15:30', 'Seminário do grupo', { salaId: 'sala-doutoramento' }),
  evento('Congresso de Aurora', { diaInteiro: true, inicio: '2026-11-04', fim: '2026-11-07', salaId: 'sala-investigacao' }),
  em('2026-11-05', '12:00', '13:00', 'Foco na dissertação', { salaId: 'sala-doutoramento' }),
  em('2026-11-05', '14:00', '15:00', 'Bloqueio de foco', { livre: true }),
  em('2026-11-05', '15:00', '16:00', 'Convite recusado', { recusado: true }),
  em('2026-11-05', '16:30', '17:15', 'Reunião de orientação', {
    salaId: 'sala-orientacoes',
    link: 'https://www.google.com/calendar/event?eid=ABC123',
  }),
  em('2026-11-05', '22:00', '23:30', 'Plantão', { fim: '2026-11-06T01:00:00+00:00' }),
  em('2026-11-07', '12:00', '14:00', 'Almoço em família', { salaId: 'sala-casa' }),
  em('2026-11-10', '10:00', '11:00', 'Defesa de Aurora', { salaId: 'sala-orientacoes' }),
  em('2026-12-31', '20:00', '23:00', 'Ceia'),
  em('2027-01-01', '12:00', '14:00', 'Almoço de ano novo'),
];

const cabe = (e: EventoDeTeste, de: string, ate: string) =>
  e.inicio.slice(0, 10) <= ate && (e.diaInteiro ? e.fim > de : e.fim.slice(0, 10) >= de);

type Roteiro = { eventos?: 'normal' | 'codigo-invalido' | 'rede' };

/** O script de mentira: eventos por período, e o resto aceito sem mudar nada. */
async function responderComoOScript(page: Page, roteiro: Roteiro = {}) {
  // Eventos que o app criou por `criarEvento` (Tarefa 12): entram na leitura seguinte, como no Google.
  const criados: EventoDeTeste[] = [];
  await page.route(URL_FICTICIA, async (rota) => {
    const { acao, dados } = rota.request().postDataJSON();
    const cabecalhos = { 'access-control-allow-origin': '*' };
    const json = (corpo: object) => rota.fulfill({ headers: cabecalhos, contentType: 'application/json', body: JSON.stringify(corpo) });
    if (acao === 'eventos') {
      if (roteiro.eventos === 'rede') return rota.abort();
      if (roteiro.eventos === 'codigo-invalido') return json({ ok: false, erro: 'codigo-invalido' });
      return json({ ok: true, dados: { eventos: [...EVENTOS, ...criados].filter((e) => cabe(e, dados.de, dados.ate)), incompleto: false } });
    }
    if (acao === 'criarEvento') {
      const existente = criados.find((e) => e.id === dados.id);
      const criado = existente ?? evento(dados.titulo, { id: dados.id, salaId: dados.salaId, inicio: `${dados.data}T${dados.inicio}:00+00:00`, fim: `${dados.data}T${dados.fim}:00+00:00` });
      if (!existente) criados.push(criado);
      return json({ ok: true, dados: criado });
    }
    if (acao === 'puxar') return json({ ok: true, dados: { registros: [], agora: 0 } });
    if (acao === 'enviar') {
      const aceitas = (dados.mudancas as { colecao: string; registro: { id: string } }[]).map((m) => ({ colecao: m.colecao, id: m.registro.id }));
      return json({ ok: true, dados: { aceitas, conflitos: [], recusadas: [], substituidas: [], agora: 0 } });
    }
    return json({ ok: true, dados: {} });
  });
}

/** Guarda uma conexão fictícia no navegador, como a tela Conectar faria. */
async function guardarConexao(page: Page) {
  await page.evaluate(
    (url) =>
      new Promise<void>((resolver, rejeitar) => {
        const abrir = indexedDB.open('central-conexao');
        abrir.onerror = () => rejeitar(abrir.error);
        abrir.onsuccess = () => {
          const escrita = abrir.result.transaction('conexao', 'readwrite');
          escrita.objectStore('conexao').put({ url, codigo: 'codigo-ficticio-0123456789' }, 'atual');
          escrita.oncomplete = () => resolver();
        };
      }),
    URL_FICTICIA,
  );
}

async function dizerAoChat(page: Page, frase: string) {
  await page.goto('/central-app/#/chat');
  const principal = page.getByRole('main');
  const campo = principal.getByRole('textbox', { name: 'Escreva ou dite' });
  await campo.fill(frase);
  // Conta os "Desfazer" antes: o da mensagem anterior já está na tela e não prova que esta foi gravada.
  const desfazeres = principal.getByRole('article').getByRole('button', { name: 'Desfazer' });
  const antes = await desfazeres.count();
  await campo.press('Enter');
  await expect(desfazeres).toHaveCount(antes + 1);
}

/** Abre o app já conectado ao script de mentira, na página pedida. */
async function abrir(page: Page, hash: string, roteiro: Roteiro = {}) {
  await responderComoOScript(page, roteiro);
  await page.goto('/central-app/');
  await guardarConexao(page);
  await page.goto(`/central-app/${hash}`);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

/** Todo controle visível com menos de 44 px de lado. */
async function pequenos(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const achados: string[] = [];
    for (const controle of document.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, summary')) {
      const caixa = controle.getBoundingClientRect();
      if (caixa.width === 0 && caixa.height === 0) continue;
      if (caixa.height < 43.5 || caixa.width < 43.5) {
        achados.push(
          `${controle.getAttribute('aria-label') ?? controle.textContent?.trim().slice(0, 30) ?? controle.outerHTML.slice(0, 60)} (${Math.round(caixa.width)}x${Math.round(caixa.height)})`,
        );
      }
    }
    return achados;
  });
}

const semRolagemDeLado = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

function vigiarErros(page: Page) {
  const erros: string[] = [];
  page.on('pageerror', (erro) => erros.push(`pageerror: ${erro.message}`));
  page.on('console', (mensagem) => {
    if (mensagem.type() === 'error') erros.push(`console: ${mensagem.text()}`);
  });
  return erros;
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(AGORA);
});

test.describe('computador, 1280 px', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('semana: sete colunas, hoje destacado, tarefas junto, detalhes só para ler', async ({ page }) => {
    const erros = vigiarErros(page);
    await page.goto('/central-app/');
    await dizerAoChat(page, 'Entrega do relatório sexta 17h');
    // Sem conexão ainda: o compromisso fica na fila e sai para o Google Agenda quando o app conecta.
    await dizerAoChat(page, 'Reunião com a Marina hoje às 15h30');
    await abrir(page, '#/semana');

    const principal = page.getByRole('main');
    await expect(principal.getByRole('heading', { level: 1, name: 'Esta semana' })).toBeVisible();
    await expect(principal.getByText('2 a 8 de novembro de 2026')).toBeVisible();

    // Sete colunas lado a lado.
    const dias = principal.locator('.semana-dias .cal-dia');
    await expect(dias).toHaveCount(7);
    const caixas = await dias.evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((c) => ({ x: c.x, y: Math.round(c.y), w: c.width })));
    expect(new Set(caixas.map((c) => c.y)).size).toBe(1);
    for (let i = 1; i < 7; i++) expect(caixas[i].x).toBeGreaterThan(caixas[i - 1].x + 60);

    // Hoje é um só: pílula coral no título, e "hoje" dito para o leitor de tela.
    const hoje = principal.locator('.cal-dia[data-hoje="true"]');
    await expect(hoje).toHaveCount(1);
    await expect(hoje.getByRole('heading', { name: /, hoje$/ })).toHaveAttribute('aria-current', 'date');

    // Grade de horas, como no modelo: régua à esquerda, blocos na hora deles, linha de agora em hoje.
    await expect(principal.locator('.sem-regua')).toContainText('8h');
    const foco = (await hoje.locator('.cal-item', { hasText: 'Foco na dissertação' }).boundingBox())!;
    const reuniao = (await hoje.locator('.cal-item', { hasText: 'Reunião de orientação' }).boundingBox())!;
    expect(reuniao.y).toBeGreaterThan(foco.y + foco.height); // 12:00 em cima, 16:30 embaixo
    const agora = (await hoje.locator('.sem-agora').boundingBox())!;
    expect(agora.y).toBeGreaterThan(foco.y); // 12:20, dentro do bloco das 12:00
    expect(agora.y).toBeLessThan(foco.y + foco.height);

    // O que passou, o que é livre e o que é prazo.
    const aula = principal.locator('.cal-item', { hasText: 'Aula de Modelagem' });
    await expect(aula).toHaveAttribute('data-passado', 'true');
    await expect(aula.getByText('passado')).toBeVisible();
    await expect(hoje.locator('.cal-item', { hasText: 'Foco na dissertação' }).getByText('passado')).toHaveCount(0);
    await expect(hoje.locator('.cal-item', { hasText: 'Bloqueio de foco' }).getByText('livre')).toBeVisible();
    await expect(principal.getByText('Convite recusado')).toHaveCount(0);
    await expect(principal.getByText('1 evento recusado fica escondido.')).toBeVisible();
    const prazo = principal.locator('.cal-item[data-tipo="prazo"]', { hasText: 'Entrega do relatório' });
    await expect(prazo).toBeVisible();
    await expect(prazo.getByText('Prazo às 17:00')).toBeVisible();
    await expect(hoje.locator('.cal-item[data-tipo="evento"]', { hasText: 'Reunião com a Marina' })).toBeVisible();

    expect(await semRolagemDeLado(page)).toBe(true);
    expect(await pequenos(page)).toEqual([]);
    await capturar(page, 'semana-1280');

    // Detalhes: título, quando, "Abrir no Google Agenda"; sem editar, mover ou apagar.
    const botao = hoje.getByRole('button', { name: /Reunião de orientação/ });
    await botao.click();
    const dialogo = page.getByRole('dialog', { name: 'Reunião de orientação' });
    await expect(dialogo.getByText('Hoje, das 16:30 às 17:15')).toBeVisible();
    const abrirNoGoogle = dialogo.getByRole('link', { name: 'Abrir no Google Agenda' });
    await expect(abrirNoGoogle).toHaveAttribute('href', 'https://www.google.com/calendar/event?eid=ABC123');
    await expect(abrirNoGoogle).toHaveAttribute('target', '_blank');
    await expect(abrirNoGoogle).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(dialogo.getByRole('button')).toHaveText(['Fechar']);
    expect(await pequenos(page)).toEqual([]);
    await capturar(page, 'detalhe-1280');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(botao).toBeFocused();
    expect(erros).toEqual([]);
  });

  test('semana: anterior, próxima e hoje; a virada de 2026 para 2027; o foco fica no controle', async ({ page }) => {
    await abrir(page, '#/semana');
    const nav = page.getByRole('navigation', { name: 'Semanas' });
    await nav.getByRole('link', { name: 'Próxima semana' }).click();
    await expect(page).toHaveURL(/#\/semana\?d=2026-11-09$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Próxima semana' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Defesa de Aurora/ })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Próxima semana' })).toBeFocused();
    await nav.getByRole('link', { name: 'Hoje' }).click();
    await expect(page).toHaveURL(/#\/semana$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Esta semana' })).toBeVisible();

    await page.goto('/central-app/#/semana?d=2026-12-31');
    await expect(page.getByText('28 de dezembro de 2026 a 3 de janeiro de 2027')).toBeVisible();
    await expect(page.getByRole('button', { name: /Ceia/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Almoço de ano novo/ })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('heading', { level: 1, name: 'Esta semana' })).toBeVisible();
  });

  test('semana da mudança de hora (19 a 25 de outubro) tem sete dias', async ({ page }) => {
    await abrir(page, '#/semana?d=2026-10-25');
    await expect(page.getByText('19 a 25 de outubro de 2026')).toBeVisible();
    await expect(page.locator('.semana-dias .cal-dia')).toHaveCount(7);
    await expect(page.locator('.cal-dia').last().getByRole('heading')).toHaveAttribute('aria-label', 'Domingo, 25 de outubro');
  });

  test('mês e ano: grade, contagens e o caminho do ano ao mês e ao dia', async ({ page }) => {
    const erros = vigiarErros(page);
    await abrir(page, '#/ano');
    const principal = page.getByRole('main');
    await expect(principal.getByRole('heading', { level: 1, name: '2026' })).toBeVisible();
    await expect(principal.locator('.ano-mes')).toHaveCount(12);
    await expect(principal.locator('.ano-mes', { hasText: 'Novembro' }).getByText('mês atual')).toBeVisible();
    await expect(principal.locator('.ano-mes', { hasText: 'Novembro' }).getByText('7 dias com compromissos')).toBeVisible();
    expect(await semRolagemDeLado(page)).toBe(true);
    expect(await pequenos(page)).toEqual([]);
    await capturar(page, 'ano-1280');

    await principal.getByRole('link', { name: 'Novembro' }).click();
    await expect(page).toHaveURL(/#\/mes\?d=2026-11-01$/);
    await expect(principal.getByRole('heading', { level: 1, name: 'Novembro' })).toBeVisible();
    const grade = principal.getByRole('table', { name: 'Novembro de 2026' });
    await expect(grade.getByRole('link')).toHaveCount(42);
    const hoje = grade.getByRole('link', { name: /hoje/ });
    await expect(hoje).toHaveAttribute('aria-current', 'date');
    await expect(grade.getByRole('link', { name: 'Quinta-feira, 5 de novembro, hoje, 5 eventos' })).toBeVisible();
    await expect(grade.getByText('Foco na dissertação')).toBeVisible(); // títulos cabem na página larga
    expect(await semRolagemDeLado(page)).toBe(true);
    expect(await pequenos(page)).toEqual([]);
    await capturar(page, 'mes-1280');

    await grade.getByRole('link', { name: /^Segunda-feira, 2 de novembro/ }).click();
    await expect(page).toHaveURL(/#\/semana\?d=2026-11-02$/);
    await expect(principal.getByRole('button', { name: /Aula de Modelagem/ })).toBeVisible();
    expect(erros).toEqual([]);
  });

  test('o Painel do dia tem a Agenda de hoje ao lado da Checklist', async ({ page }) => {
    const erros = vigiarErros(page);
    await abrir(page, '#/');
    const principal = page.getByRole('main');
    const agenda = principal.getByRole('region', { name: 'Agenda de hoje' });
    await expect(agenda.getByRole('button', { name: /Reunião de orientação/ })).toBeVisible();
    await expect(agenda.getByRole('button', { name: /Aula de Modelagem/ })).toHaveCount(0); // é de segunda
    await expect(agenda.getByRole('button', { name: /Foco na dissertação/ })).toBeVisible();
    const checklist = principal.getByRole('region', { name: 'Checklist do dia' });
    const a = (await agenda.boundingBox())!;
    const c = (await checklist.boundingBox())!;
    expect(a.x).toBeGreaterThan(c.x + c.width - 5); // lado a lado
    expect(await semRolagemDeLado(page)).toBe(true);
    expect(await pequenos(page)).toEqual([]);
    await capturar(page, 'painel-1280');
    expect(erros).toEqual([]);
  });
});

test.describe('computador, 1440 px: mês e ano ocupam o painel central', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('mês: a grade vai até o fim da janela, semanas da mesma altura, títulos até onde cabe', async ({ page }) => {
    await abrir(page, '#/mes');
    const principal = page.getByRole('main');
    const grade = principal.getByRole('table', { name: 'Novembro de 2026' });
    await expect(grade.getByRole('link')).toHaveCount(42);
    const quadro = (await principal.locator('.mes-quadro').boundingBox())!;
    expect(900 - (quadro.y + quadro.height)).toBeLessThan(48); // só a margem de baixo da página
    const semanas = await grade.locator('tbody tr').evaluateAll((linhas) => linhas.map((l) => l.getBoundingClientRect().height));
    expect(semanas).toHaveLength(6);
    expect(Math.max(...semanas) - Math.min(...semanas)).toBeLessThan(2);

    // Pílulas na cor da sala, como no modelo; o que não cabe vira "e mais N". Janela mais alta: cabem mais.
    const hoje = grade.getByRole('link', { name: /hoje/ });
    await expect(hoje.locator('.mes-mais')).toHaveText(/^e mais \d+$/);
    await expect(hoje.locator('.mes-titulo', { hasText: 'Foco na dissertação' })).toHaveClass(/(^| )sala-dout( |$)/);
    await expect(hoje.locator('.mes-pontos')).toBeHidden(); // os pontos ficam só no celular
    await page.setViewportSize({ width: 1440, height: 1400 });
    await expect(hoje.locator('.mes-titulo')).toHaveCount(5);
    await expect(hoje.locator('.mes-mais')).toHaveCount(0);
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(hoje.locator('.mes-mais')).toHaveCount(1);
    expect(await semRolagemDeLado(page)).toBe(true);
    expect(await pequenos(page)).toEqual([]);
  });

  test('ano: doze meses iguais em 4 colunas por 3 linhas, sem rolar, num cartão só, dias com compromisso na cor da sala', async ({ page }) => {
    await abrir(page, '#/ano');
    const principal = page.getByRole('main');
    const meses = principal.locator('.ano-mes');
    await expect(meses).toHaveCount(12);
    const caixas = await meses.evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((c) => ({ x: Math.round(c.x), y: Math.round(c.y), w: Math.round(c.width), h: Math.round(c.height) })));
    expect(new Set(caixas.map((c) => c.x)).size).toBe(4);
    expect(new Set(caixas.map((c) => c.y)).size).toBe(3);
    // O ano cabe na janela: a página não rola de cima a baixo.
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1)).toBe(true);
    expect(new Set(caixas.map((c) => c.w)).size).toBe(1);
    expect(Math.max(...caixas.map((c) => c.h)) - Math.min(...caixas.map((c) => c.h))).toBeLessThan(2);
    const novembro = principal.locator('.ano-mes', { hasText: 'Novembro' });
    await expect(novembro.locator('.ano-dia[data-hoje="true"]')).toHaveText('5');
    await expect(novembro.locator('.ano-dia', { hasText: /^10$/ })).toHaveClass(/(^| )sala-ori( |$)/); // Defesa de Aurora
    expect(await semRolagemDeLado(page)).toBe(true);
    expect(await pequenos(page)).toEqual([]);
  });
});

test.describe('celular, 390 px', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('semana: um dia de cada vez, com a faixa dos sete dias', async ({ page }) => {
    const erros = vigiarErros(page);
    await abrir(page, '#/semana');
    const principal = page.getByRole('main');
    const faixa = principal.getByRole('group', { name: 'Dias da semana' });
    await expect(faixa.getByRole('button')).toHaveCount(7);
    await expect(faixa.getByRole('button', { name: /^Quinta-feira, 5 de novembro, hoje/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(principal.getByRole('button', { name: /Reunião de orientação/ })).toBeVisible();
    await expect(principal.getByRole('button', { name: /Almoço em família/ })).toHaveCount(0);
    expect(await semRolagemDeLado(page)).toBe(true);
    expect(await pequenos(page)).toEqual([]);
    await capturar(page, 'semana-390');

    await faixa.getByRole('button', { name: /^Sábado, 7 de novembro/ }).click();
    await expect(principal.getByRole('button', { name: /Almoço em família/ })).toBeVisible();
    await expect(principal.getByRole('button', { name: /Reunião de orientação/ })).toHaveCount(0);
    await expect(faixa.getByRole('button', { name: /^Sábado/ })).toHaveAttribute('aria-pressed', 'true');

    // Detalhes: folha de baixo, com 44 px em tudo.
    await principal.getByRole('button', { name: /Almoço em família/ }).click();
    const dialogo = page.getByRole('dialog', { name: 'Almoço em família' });
    await expect(dialogo.getByText('Sábado, 7/11, das 12:00 às 14:00')).toBeVisible();
    await expect(dialogo.getByText('Casa', { exact: true })).toBeVisible();
    expect(await pequenos(page)).toEqual([]);
    await capturar(page, 'detalhe-390');
    await dialogo.getByRole('button', { name: 'Fechar' }).click();
    expect(erros).toEqual([]);
  });

  test('mês e ano cabem na tela e têm toques de 44 px', async ({ page }) => {
    await abrir(page, '#/mes');
    expect(await semRolagemDeLado(page)).toBe(true);
    expect(await pequenos(page)).toEqual([]);
    await capturar(page, 'mes-390');
    await page.goto('/central-app/#/ano');
    await expect(page.locator('.ano-mes')).toHaveCount(12);
    expect(await semRolagemDeLado(page)).toBe(true);
    expect(await pequenos(page)).toEqual([]);
    await capturar(page, 'ano-390');
  });

  test('mês em 360 px: cada dia ainda tem 44 px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await abrir(page, '#/mes');
    expect(await semRolagemDeLado(page)).toBe(true);
    expect(await pequenos(page)).toEqual([]);
    await page.goto('/central-app/#/semana');
    expect(await pequenos(page)).toEqual([]);
  });

  test('o Painel do dia mostra a Agenda de hoje, e a página não rola de lado', async ({ page }) => {
    await abrir(page, '#/');
    const agenda = page.getByRole('region', { name: 'Agenda de hoje' });
    // No celular, depois de 3 itens o resto fica em "Ver tudo (N)" (Tarefa 16, rodada 1).
    await expect(agenda.getByRole('listitem')).toHaveCount(3);
    await agenda.getByRole('button', { name: /^Ver tudo \(\d+\)$/ }).click();
    await expect(agenda.getByRole('button', { name: /Reunião de orientação/ })).toBeVisible();
    expect(await semRolagemDeLado(page)).toBe(true);
    expect(await pequenos(page)).toEqual([]);
    await capturar(page, 'painel-390');
  });
});

test.describe('quando a agenda não carrega', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('código inválido com o script respondendo ao ping: ainda não liberada, sem mandar reconectar', async ({ page }) => {
    await abrir(page, '#/semana', { eventos: 'codigo-invalido' });
    const principal = page.getByRole('main');
    await expect(principal.getByText('Agenda ainda não liberada — falta aprovar a permissão no script')).toBeVisible();
    await expect(principal.getByRole('link', { name: 'Conectar aparelho' })).toHaveCount(0);
    await expect(principal.getByRole('button', { name: 'Tentar de novo' })).toBeVisible();
    expect(await pequenos(page)).toEqual([]);
    await capturar(page, 'erro-390');
  });

  test('sem internet: linha discreta, botão de tentar de novo, e a tela segue com as tarefas', async ({ page }) => {
    await abrir(page, '#/mes', { eventos: 'rede' });
    const principal = page.getByRole('main');
    await expect(principal.getByText('Agenda não carregou')).toBeVisible();
    await expect(principal.getByText('Sem internet.')).toBeVisible();
    await expect(principal.getByRole('table', { name: 'Novembro de 2026' })).toBeVisible();
    expect(await pequenos(page)).toEqual([]);
  });

  test('aparelho sem conexão: leva a Conectar aparelho', async ({ page }) => {
    await page.goto('/central-app/#/semana');
    const principal = page.getByRole('main');
    await expect(principal.getByText('Este aparelho ainda não está conectado.')).toBeVisible();
    await expect(principal.getByRole('link', { name: 'Conectar aparelho' })).toHaveAttribute('href', '#/conectar');
    expect(await pequenos(page)).toEqual([]);
  });
});
