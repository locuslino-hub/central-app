import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Tarefa 17: Salas, página da sala e página da pessoa, no celular e no computador.
// Quinta-feira, 2026-11-05, 12:20 em Lisboa (inverno: UTC+0). Nomes fictícios.
const AGORA = '2026-11-05T12:20:00+00:00';
const URL_FICTICIA = 'https://script.google.com/macros/s/ID-FICTICIO/exec';

/** Com CAPTURAS_T17 definida, as imagens vão para essa pasta (conferência visual). */
const CAPTURAS = process.env.CAPTURAS_T17;
async function capturar(page: Page, nome: string) {
  if (!CAPTURAS) return;
  mkdirSync(CAPTURAS, { recursive: true });
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime as number))
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  // No computador a página rola por dentro de `main`: a janela alta mostra tudo numa imagem.
  const janela = page.viewportSize();
  if (janela && janela.width > 1100) await page.setViewportSize({ width: janela.width, height: 2600 });
  await page.screenshot({ path: join(CAPTURAS, `${nome}.png`), fullPage: true });
  if (janela) await page.setViewportSize(janela);
}

const EMAILS = [
  {
    id: 'g1a2b4',
    remetente: 'Marina',
    enderecoRemetente: 'marina@exemplo.invalid',
    assunto: 'Revisão do capítulo 2',
    trecho: 'Professor, mandei a nova versão do capítulo 2 com as correções que combinamos na última orientação.',
    data: '2026-11-04T18:05:00+00:00',
    link: 'https://mail.google.com/mail/u/0/#all/g1a2b4',
  },
  {
    id: 'g1a2b5',
    remetente: 'Renata',
    enderecoRemetente: 'renata@exemplo.invalid',
    assunto: 'Dúvida sobre o prazo',
    trecho: 'Bom dia! Posso entregar o rascunho na segunda-feira em vez de sexta?',
    data: '2026-11-05T09:15:00+00:00',
    link: 'https://mail.google.com/mail/u/0/#all/g1a2b5',
  },
];

const EVENTOS = [
  ['e1', 'Reunião de orientação com a Marina', '2026-11-06T11:00:00+00:00', '2026-11-06T12:00:00+00:00', 'sala-orientacoes'],
  ['e2', 'Banca de qualificação', '2026-11-12T15:00:00+00:00', '2026-11-12T16:30:00+00:00', 'sala-orientacoes'],
  ['e3', 'Aula de estatística', '2026-11-06T09:00:00+00:00', '2026-11-06T10:00:00+00:00', 'sala-aulas'],
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

/** O script de mentira: e-mails, agenda e o necessário para abrir o app. */
async function responderComoOScript(page: Page) {
  await page.route(URL_FICTICIA, async (rota) => {
    const { acao, dados } = rota.request().postDataJSON();
    const cabecalhos = { 'access-control-allow-origin': '*' };
    const json = (corpo: object) => rota.fulfill({ headers: cabecalhos, contentType: 'application/json', body: JSON.stringify(corpo) });
    if (acao === 'emails' || acao === 'atualizarEmails') return json({ ok: true, dados: EMAILS });
    if (acao === 'eventos') return json({ ok: true, dados: { eventos: EVENTOS, incompleto: false } });
    if (acao === 'puxar') return json({ ok: true, dados: { registros: [], agora: 0 } });
    if (acao === 'enviar') {
      const aceitas = (dados.mudancas as { colecao: string; registro: { id: string } }[]).map((m) => ({ colecao: m.colecao, id: m.registro.id }));
      return json({ ok: true, dados: { aceitas, conflitos: [], recusadas: [], substituidas: [], agora: 0 } });
    }
    return json({ ok: true, dados: {} });
  });
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

type Registro = Record<string, unknown> & { id: string };

/** Grava direto no banco do app (como se tivessem chegado de outro aparelho) e recarrega. */
async function semear(page: Page, loja: string, registros: Registro[]) {
  await page.evaluate(
    ([nome, lista]) =>
      new Promise<void>((resolver, rejeitar) => {
        const abrir = indexedDB.open('central-dados');
        abrir.onerror = () => rejeitar(abrir.error);
        abrir.onsuccess = () => {
          const escrita = abrir.result.transaction(nome as string, 'readwrite');
          const armazem = escrita.objectStore(nome as string);
          for (const registro of lista as Registro[]) armazem.put({ atualizadoEm: Date.now(), aparelho: 'e2e', ...registro });
          escrita.oncomplete = () => resolver();
        };
      }),
    [loja, registros] as const,
  );
}

const tarefa = (id: string, titulo: string, extra: Record<string, unknown> = {}): Registro => ({
  id,
  titulo,
  salaId: null,
  duracaoMin: 60,
  duracaoConfirmada: false,
  feito: false,
  fixada: false,
  marcar: false,
  ...extra,
});

/** Abre o app conectado ao script de mentira, com a Marina, a Renata e o Prof. Souza, e algumas tarefas. */
async function abrirComDados(page: Page, hash: string) {
  await responderComoOScript(page);
  await page.goto('/central-app/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await guardarConexao(page);
  // O app semeia as salas ao abrir; a espera garante que já estão no banco.
  await expect(page.getByRole('navigation', { name: 'Principal' }).first()).toBeVisible();
  await semear(page, 'pessoas', [
    { id: 'p-marina', nome: 'Marina', salaId: 'sala-orientacoes', papel: 'aluna', emails: ['marina@exemplo.invalid'] },
    { id: 'p-renata', nome: 'Renata', salaId: 'sala-orientacoes', papel: 'aluna', emails: ['renata@exemplo.invalid'] },
    { id: 'p-souza', nome: 'Prof. Souza', salaId: 'sala-doutoramento', papel: 'coorientador' },
  ]);
  await semear(page, 'tarefas', [
    tarefa('t1', 'Revisar o capítulo 2 da Marina', { salaId: 'sala-orientacoes', pessoaId: 'p-marina', data: '2026-11-05' }),
    tarefa('t2', 'Marcar reunião com a Marina', { salaId: 'sala-orientacoes', pessoaId: 'p-marina' }),
    tarefa('t3', 'Ler o rascunho da Renata', { salaId: 'sala-orientacoes', pessoaId: 'p-renata', data: '2026-11-09' }),
    tarefa('t4', 'Preparar a pauta das orientações', { salaId: 'sala-orientacoes' }),
    tarefa('t5', 'Enviar a prova de estatística', { salaId: 'sala-aulas', data: '2026-11-05' }),
  ]);
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

for (const [nome, viewport, sufixo] of [
  ['celular, 390 px', { width: 390, height: 844 }, '390'],
  ['computador, 1280 px', { width: 1280, height: 900 }, '1280'],
] as const) {
  test.describe(nome, () => {
    test.use({ viewport });

    test('Salas, sala e pessoa: do cartão da sala ao painel da Marina, com notas que sobrevivem ao recarregar', async ({ page }) => {
      const erros = vigiarErros(page);
      await abrirComDados(page, '#/salas');
      const principal = page.getByRole('main');

      // Salas: sete cartões, o de Orientações diz o que há aberto.
      const cartoes = principal.getByRole('list', { name: 'Salas' }).getByRole('listitem');
      await expect(cartoes).toHaveCount(7);
      await expect(cartoes.filter({ hasText: 'Orientações' })).toContainText('4 tarefas abertas');
      await expect(cartoes.filter({ hasText: 'Orientações' })).toContainText('2 pessoas');
      await capturar(page, `salas-${sufixo}`);
      expect(await pequenos(page)).toEqual([]);
      expect(await semRolagemDeLado(page)).toBe(true);

      // O cartão todo abre a sala, não só o nome.
      await cartoes.filter({ hasText: 'Orientações' }).click({ position: { x: 20, y: 90 } });
      await expect(page.getByRole('heading', { level: 1, name: 'Orientações' })).toBeVisible();
      await expect(principal.getByRole('region', { name: 'Tarefas' }).getByRole('checkbox')).toHaveCount(4);
      await expect(principal.getByText('Reunião de orientação com a Marina')).toBeVisible();
      await expect(principal.getByText('Aula de estatística')).toHaveCount(0); // é de Aulas
      await expect(principal.getByRole('region', { name: 'Por responder' }).getByText('Revisão do capítulo 2')).toBeVisible();
      await expect(principal.getByRole('region', { name: 'Documentos' })).toContainText('Nenhum documento ainda.');
      await capturar(page, `sala-${sufixo}`);
      expect(await pequenos(page)).toEqual([]);
      expect(await semRolagemDeLado(page)).toBe(true);

      // Notas: digitar, esperar o salvamento, recarregar.
      const notas = principal.getByRole('textbox', { name: 'Notas' });
      await notas.fill('Combinar o calendário de entregas com as quatro alunas.');
      await expect(principal.getByText('Salvo')).toBeVisible();
      await page.reload();
      await expect(page.getByRole('main').getByRole('textbox', { name: 'Notas' })).toHaveValue(
        'Combinar o calendário de entregas com as quatro alunas.',
      );

      // O painel clicável da Marina abre a página dela.
      await page.getByRole('main').getByRole('region', { name: 'Pessoas' }).getByRole('link', { name: /Marina/ }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Marina' })).toBeVisible();
      await expect(principal.getByRole('region', { name: 'Pendências' }).getByRole('checkbox')).toHaveCount(2);
      await expect(principal.getByRole('region', { name: 'E-mails' }).getByText('Revisão do capítulo 2')).toBeVisible();
      await expect(principal.getByRole('region', { name: 'E-mails' }).getByText('Dúvida sobre o prazo')).toHaveCount(0);
      await expect(principal.getByRole('region', { name: 'Documentos' })).toBeVisible();
      await capturar(page, `pessoa-${sufixo}`);
      expect(await pequenos(page)).toEqual([]);
      expect(await semRolagemDeLado(page)).toBe(true);

      expect(erros).toEqual([]);
    });
  });
}
