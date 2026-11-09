import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Quinta-feira, 2026-11-05, 12:20 em Lisboa (inverno: UTC+0). Nomes fictícios.
const AGORA = '2026-11-05T12:20:00+00:00';
const URL_FICTICIA = 'https://script.google.com/macros/s/ID-FICTICIO/exec';

/** Com CAPTURAS_T20 definida, as imagens vão para essa pasta (conferência visual). */
const CAPTURAS = process.env.CAPTURAS_T20;
async function capturar(page: Page, nome: string) {
  if (!CAPTURAS) return;
  mkdirSync(CAPTURAS, { recursive: true });
  await page.screenshot({ path: join(CAPTURAS, `${nome}.png`), fullPage: true });
}

const EMAILS = [
  {
    id: 'q1',
    remetente: 'Marina',
    enderecoRemetente: 'marina@exemplo.invalid',
    assunto: 'Revisão do capítulo 2',
    trecho: 'Professor, mandei a nova versão do capítulo 2.',
    data: '2026-11-05T10:20:00+00:00',
    link: 'https://mail.google.com/mail/u/0/#all/q1',
  },
  {
    id: 'q2',
    remetente: 'Aurora',
    enderecoRemetente: 'aurora@exemplo.invalid',
    assunto: 'Resumo do congresso',
    trecho: 'Enviei o resumo e aguardo o seu retorno.',
    data: '2026-10-30T09:00:00+00:00',
    link: 'https://mail.google.com/mail/u/0/#all/q2',
  },
];

const EVENTOS = [
  ['ev1', 'Reunião de orientação', '2026-11-06T11:00:00+00:00', '2026-11-06T12:00:00+00:00', 'sala-orientacoes'],
  ['ev2', 'Aula de Modelagem', '2026-11-12T09:00:00+00:00', '2026-11-12T10:00:00+00:00', 'sala-aulas'],
].map(([id, titulo, inicio, fim, salaId]) => ({
  id,
  agendaId: 'primary',
  titulo,
  inicio,
  fim,
  diaInteiro: false,
  livre: false,
  recusado: false,
  salaId,
  link: null,
}));

async function responderComoOScript(page: Page) {
  const acoes: string[] = [];
  await page.route(URL_FICTICIA, async (rota) => {
    const { acao, dados } = rota.request().postDataJSON();
    acoes.push(acao);
    const cabecalhos = { 'access-control-allow-origin': '*' };
    const json = (corpo: object) => rota.fulfill({ headers: cabecalhos, contentType: 'application/json', body: JSON.stringify(corpo) });
    if (acao === 'emails' || acao === 'atualizarEmails') return json({ ok: true, dados: EMAILS });
    if (acao === 'eventos') {
      const dentro = EVENTOS.filter((e) => e.inicio.slice(0, 10) >= dados.de && e.inicio.slice(0, 10) <= dados.ate);
      return json({ ok: true, dados: { eventos: dentro, incompleto: false } });
    }
    if (acao === 'puxar') return json({ ok: true, dados: { registros: [], agora: 0 } });
    if (acao === 'enviar') {
      const aceitas = (dados.mudancas as { colecao: string; registro: { id: string } }[]).map((m) => ({ colecao: m.colecao, id: m.registro.id }));
      return json({ ok: true, dados: { aceitas, conflitos: [], recusadas: [], substituidas: [], agora: 0 } });
    }
    return json({ ok: true, dados: {} });
  });
  return acoes;
}

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

/** Marina é aluna de Orientações e uma tarefa nasce na sala; o e-mail dela já vem com a sala. */
async function prepararDados(page: Page) {
  await page.goto('/central-app/#/salas');
  const principal = page.getByRole('main');
  await principal.getByLabel('Nome', { exact: true }).fill('Marina');
  await principal.getByLabel('Sala', { exact: true }).selectOption({ label: 'Orientações' });
  await principal.getByRole('button', { name: 'Cadastrar pessoa' }).click();
  await expect(principal.getByRole('list').getByText('Marina')).toBeVisible();
  await page.evaluate(
    () =>
      new Promise<void>((resolver, rejeitar) => {
        const abrir = indexedDB.open('central-dados');
        abrir.onerror = () => rejeitar(abrir.error);
        abrir.onsuccess = () => {
          const escrita = abrir.result.transaction('pessoas', 'readwrite');
          const loja = escrita.objectStore('pessoas');
          const todas = loja.getAll();
          todas.onsuccess = () => {
            for (const p of todas.result) if (p.nome === 'Marina') loja.put({ ...p, emails: ['marina@exemplo.invalid'], atualizadoEm: Date.now() + 1 });
          };
          escrita.oncomplete = () => resolver();
        };
      }),
  );
  await page.goto('/central-app/#/sala/sala-orientacoes');
  await page.getByLabel('Nova tarefa em Orientações').fill('Revisar parágrafo do relatório');
  await page.getByRole('button', { name: 'Adicionar' }).first().click();
  await expect(page.getByRole('checkbox', { name: 'Revisar parágrafo do relatório' })).toBeVisible();
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

async function abrirQuadro(page: Page) {
  const acoes = await responderComoOScript(page);
  await page.goto('/central-app/');
  await guardarConexao(page);
  await prepararDados(page);
  await page.goto('/central-app/#/quadro');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Quadro' })).toBeVisible();
  return acoes;
}

test.describe('computador, 1280 px', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('colunas por sala, filtros, toque de 44 px e página sem rolar de lado', async ({ page }) => {
    const erros = vigiarErros(page);
    const acoes = await abrirQuadro(page);
    const principal = page.getByRole('main');
    const area = principal.getByRole('region', { name: 'Colunas das salas' });
    const ori = area.getByRole('region', { name: 'Orientações' });

    await expect(ori.getByText('Revisão do capítulo 2')).toBeVisible();
    await expect(ori.getByText('Reunião de orientação')).toBeVisible();
    await expect(ori.getByText('Revisar parágrafo do relatório')).toBeVisible();
    await expect(area.getByRole('region', { name: 'Aulas' }).getByText('Aula de Modelagem')).toBeVisible();
    await expect(area.getByRole('heading', { level: 2 })).toHaveCount(8); // 7 salas + Sem sala (e-mail da Aurora)
    expect(await semRolagemDeLado(page)).toBe(true);
    await capturar(page, 'quadro-1280');

    await principal.getByRole('button', { name: 'Esta semana' }).click();
    await expect(ori.getByText('Reunião de orientação')).toBeVisible();
    await expect(area.getByRole('region', { name: 'Aulas' }).getByText('Aula de Modelagem')).toHaveCount(0);
    await capturar(page, 'quadro-1280-semana');

    await principal.getByRole('button', { name: 'Só e-mails' }).click();
    await expect(ori.getByText('Revisão do capítulo 2')).toBeVisible();
    await expect(ori.getByText('Reunião de orientação')).toHaveCount(0);
    await expect(ori.getByText('Revisar parágrafo do relatório')).toHaveCount(0);
    expect(await pequenos(page)).toEqual([]);
    expect(await semRolagemDeLado(page)).toBe(true);
    // O espelho das tarefas no Google Tarefas é da sincronia (feito espelhado), não do Quadro.
    expect(acoes.filter((a) => !['emails', 'atualizarEmails', 'eventos', 'puxar', 'enviar', 'ping', 'espelharTarefas'].includes(a))).toEqual([]);
    expect(erros).toEqual([]);
  });
});

test.describe('celular, 390 px', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('colunas empilhadas abrem e fecham, tudo com 44 px e sem rolar de lado', async ({ page }) => {
    const erros = vigiarErros(page);
    await abrirQuadro(page);
    const principal = page.getByRole('main');
    const ori = principal.getByRole('button', { name: /^Orientações/ });
    const dout = principal.getByRole('button', { name: /^Doutoramento/ });

    // A primeira sala com algo vem aberta (Aulas, por causa do compromisso do dia 12); as outras, fechadas.
    const aulas = principal.getByRole('button', { name: /^Aulas/ });
    await expect(aulas).toHaveAttribute('aria-expanded', 'true');
    await expect(dout).toHaveAttribute('aria-expanded', 'false');
    await expect(ori).toHaveAttribute('aria-expanded', 'false');
    await ori.click();
    await expect(ori).toHaveAttribute('aria-expanded', 'true');
    const regiao = principal.getByRole('region', { name: 'Orientações' });
    await expect(regiao.getByText('Revisão do capítulo 2')).toBeVisible();
    expect(await semRolagemDeLado(page)).toBe(true);
    expect(await pequenos(page)).toEqual([]);
    await capturar(page, 'quadro-390');

    await ori.click();
    await expect(ori).toHaveAttribute('aria-expanded', 'false');
    await expect(regiao.getByText('Revisão do capítulo 2')).toHaveCount(0);
    await dout.click();
    await expect(dout).toHaveAttribute('aria-expanded', 'true');
    await expect(principal.getByRole('region', { name: 'Doutoramento' }).getByText('Nada nesta sala.')).toBeVisible();
    expect(await semRolagemDeLado(page)).toBe(true);
    expect(await pequenos(page)).toEqual([]);
    expect(erros).toEqual([]);
  });
});
