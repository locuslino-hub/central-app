import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Tarefa 16: Painel do dia inteiro, Agora e Fechar o dia, no navegador de verdade.
// Quinta-feira, 2026-11-05, 12:20 em Lisboa (inverno: UTC+0). Nomes fictícios.
const AGORA = '2026-11-05T12:20:00+00:00';
const URL_FICTICIA = 'https://script.google.com/macros/s/ID-FICTICIO/exec';

/** Com CAPTURAS_T16 definida, as imagens vão para essa pasta (conferência visual). */
const CAPTURAS = process.env.CAPTURAS_T16;
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
  // No computador só a página rola (a casca tem a altura da janela): para a imagem
  // mostrar tudo, a janela cresce até a altura da página e depois volta.
  const tamanho = page.viewportSize()!;
  const altura = await page.evaluate(() => {
    const pagina = document.querySelector('main');
    return Math.max(document.documentElement.scrollHeight, pagina ? pagina.scrollHeight + 40 : 0);
  });
  if (tamanho.width > 1100 && altura > tamanho.height) await page.setViewportSize({ width: tamanho.width, height: Math.min(altura, 6000) });
  await page.screenshot({ path: join(CAPTURAS, `${nome}.png`), fullPage: true });
  await page.setViewportSize(tamanho);
}

const evento = (id: string, titulo: string, inicio: string, fim: string, salaId: string | null) => ({
  id,
  agendaId: 'primary',
  titulo,
  inicio: `2026-11-05T${inicio}:00+00:00`,
  fim: `2026-11-05T${fim}:00+00:00`,
  diaInteiro: false,
  livre: false,
  recusado: false,
  salaId,
  link: null,
});
const EVENTOS = [
  evento('ev-aula', 'Aula de métodos', '09:00', '10:30', 'sala-aulas'),
  evento('ev-reuniao', 'Reunião de orientação', '14:00', '15:00', 'sala-orientacoes'),
  evento('ev-banca', 'Banca da Aurora', '16:30', '18:00', 'sala-doutoramento'),
];

const email = (id: string, remetente: string, assunto: string, trecho: string, data: string) => ({
  id,
  remetente,
  enderecoRemetente: `${remetente.toLowerCase().replace(/[^a-z]/g, '')}@exemplo.invalid`,
  assunto,
  trecho,
  data,
  link: `https://mail.google.com/mail/u/0/#all/${id}`,
});
const EMAILS = [
  email('e1a2b3', 'Prof. Souza', 'Relatório do semestre', 'Segue o relatório do semestre para a sua leitura antes de sexta.', '2026-11-04T16:40:00+00:00'),
  email('e1a2b4', 'Renata', 'Dúvida sobre a prova', 'Posso entregar o trabalho na segunda-feira em vez de sexta?', '2026-11-05T09:15:00+00:00'),
];

type TarefaDeTeste = Record<string, unknown> & { id: string; titulo: string };
const tarefa = (id: string, titulo: string, extra: Record<string, unknown> = {}): TarefaDeTeste => ({
  id,
  titulo,
  salaId: null,
  duracaoMin: 60,
  duracaoConfirmada: false,
  feito: false,
  fixada: false,
  marcar: false,
  atualizadoEm: Date.parse(AGORA) - 60_000,
  aparelho: 'teste-e2e',
  ...extra,
});
const TAREFAS = [
  tarefa('t-artigo', 'Ler artigo da Renata', { data: '2026-11-05', salaId: 'sala-investigacao', duracaoMin: 45, duracaoConfirmada: true }),
  tarefa('t-capitulo', 'Rever capítulo 3 da Marina', { data: '2026-11-05', salaId: 'sala-orientacoes' }),
  tarefa('t-slides', 'Preparar slides da aula', { data: '2026-11-05', salaId: 'sala-aulas', duracaoMin: 90, duracaoConfirmada: true }),
  tarefa('t-entrega', 'Entrega do relatório', { data: '2026-11-06', prazoHora: '17:00', salaId: 'sala-doutoramento' }),
  tarefa('t-lampadas', 'Comprar lâmpadas', { salaId: 'sala-casa' }),
  tarefa('t-notas', 'Lançar notas do MBA', { data: '2026-11-05', salaId: 'sala-mba', feito: true }),
];

/** O script de mentira: agenda, e-mails e a sincronia vazia. Guarda as ações pedidas. */
async function responderComoOScript(page: Page) {
  const acoes: string[] = [];
  await page.route(URL_FICTICIA, async (rota) => {
    const { acao, dados } = rota.request().postDataJSON();
    acoes.push(acao);
    const json = (corpo: object) =>
      rota.fulfill({ headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: JSON.stringify(corpo) });
    if (acao === 'eventos') return json({ ok: true, dados: { eventos: EVENTOS, incompleto: false } });
    if (acao === 'emails' || acao === 'atualizarEmails') return json({ ok: true, dados: EMAILS });
    if (acao === 'puxar') return json({ ok: true, dados: { registros: [], agora: 0 } });
    if (acao === 'enviar') {
      const aceitas = (dados.mudancas as { colecao: string; registro: { id: string } }[]).map((m) => ({ colecao: m.colecao, id: m.registro.id }));
      return json({ ok: true, dados: { aceitas, conflitos: [], recusadas: [], substituidas: [], agora: 0 } });
    }
    return json({ ok: true, dados: {} });
  });
  return acoes;
}

/** Conexão guardada e tarefas no banco do app, antes de abrir a página pedida. */
async function abrir(page: Page, hash: string) {
  const acoes = await responderComoOScript(page);
  await page.goto('/central-app/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.evaluate(
    ({ url, tarefas }) =>
      Promise.all([
        new Promise<void>((resolver, rejeitar) => {
          const abrir = indexedDB.open('central-conexao');
          abrir.onerror = () => rejeitar(abrir.error);
          abrir.onsuccess = () => {
            const escrita = abrir.result.transaction('conexao', 'readwrite');
            escrita.objectStore('conexao').put({ url, codigo: 'codigo-ficticio-0123456789' }, 'atual');
            escrita.oncomplete = () => resolver();
          };
        }),
        new Promise<void>((resolver, rejeitar) => {
          const abrir = indexedDB.open('central-dados');
          abrir.onerror = () => rejeitar(abrir.error);
          abrir.onsuccess = () => {
            const escrita = abrir.result.transaction('tarefas', 'readwrite');
            for (const t of tarefas) escrita.objectStore('tarefas').put(t);
            escrita.oncomplete = () => resolver();
          };
        }),
      ]),
    { url: URL_FICTICIA, tarefas: TAREFAS },
  );
  await page.goto(`/central-app/${hash}`);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  return acoes;
}

/** Todo controle visível com menos de 44 px de lado. */
async function pequenos(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const achados: string[] = [];
    for (const controle of document.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, summary')) {
      const caixa = controle.getBoundingClientRect();
      if (caixa.width === 0 && caixa.height === 0) continue;
      if (caixa.height < 43.5 || caixa.width < 43.5) {
        achados.push(`${controle.getAttribute('aria-label') ?? controle.textContent?.trim().slice(0, 30)} (${Math.round(caixa.width)}x${Math.round(caixa.height)})`);
      }
    }
    return achados;
  });
}

const semRolagemDeLado = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

function vigiarErros(page: Page) {
  const erros: string[] = [];
  page.on('pageerror', (erro) => erros.push(`pageerror: ${erro.message}`));
  page.on('console', (mensagem) => {
    if (mensagem.type() === 'error') erros.push(`console: ${mensagem.text()}`);
  });
  return erros;
}

const caixa = async (local: Locator) => (await local.boundingBox())!;

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(AGORA);
});

for (const [nome, viewport, sufixo] of [
  ['celular, 390 px', { width: 390, height: 844 }, '390'],
  ['computador, 1280 px', { width: 1280, height: 900 }, '1280'],
] as const) {
  test.describe(nome, () => {
    test.use({ viewport });

    test('Painel do dia: a ordem da especificação, toque de 44 px e nada rolando de lado', async ({ page }) => {
      const erros = vigiarErros(page);
      const acoes = await abrir(page, '#/');
      const principal = page.getByRole('main');
      const regiao = (nome: string | RegExp) => principal.getByRole('region', { name: nome });

      await expect(regiao('Mensagem do dia')).toContainText('Boa tarde');
      await expect(regiao('Mensagem do dia')).toContainText(
        'Hoje: 3 tarefas em aberto, 2 e-mails por responder e o próximo compromisso às 14:00, Reunião de orientação.',
      );
      await expect(regiao('Linha do dia')).toContainText('Livre até 14:00 · 1 h 40');
      await expect(regiao('Pendências das salas').getByRole('link', { name: 'Orientações: 1 tarefa' })).toBeVisible();
      await expect(regiao('Pendências das salas').getByRole('link', { name: 'Casa: 1 tarefa' })).toBeVisible();
      const seguir = regiao(/^A seguir/);
      // O primeiro da fila (Ler artigo) é o destaque do Agora: no painel direito ou, no celular, no alto.
      const agoraNoLado =
        sufixo === '1280' ? page.getByRole('complementary', { name: 'Agora, água e chat' }) : principal.getByRole('region', { name: 'Agora' });
      await expect(agoraNoLado.getByText('Ler artigo da Renata')).toBeVisible();
      await expect(agoraNoLado.getByText('Cabe agora')).toBeVisible();
      await expect(seguir.getByText('Ler artigo da Renata')).toHaveCount(0);
      // 45 + 90 passa dos 100 livres: daí em diante, sem selo.
      await expect(seguir.getByRole('listitem').first()).toContainText('Preparar slides da aula');
      await expect(seguir.getByText('Cabe agora')).toHaveCount(0);
      await expect(seguir.getByText('Depois')).toHaveCount(0);
      await expect(seguir.getByRole('listitem').nth(1)).toContainText('cerca de 1 h');
      if (sufixo === '390') {
        // No celular, 3 e o resto em "Ver tudo".
        await expect(seguir.getByRole('listitem')).toHaveCount(3);
        await seguir.getByRole('button', { name: 'Ver tudo (5)' }).click();
      }
      await expect(seguir.getByRole('listitem')).toHaveCount(5);
      // A Agenda de hoje tem só o que tem hora: os 3 compromissos (as tarefas estão na Checklist).
      await expect(regiao('Agenda de hoje').getByRole('listitem')).toHaveCount(3);
      // E-mail em A seguir é curto: etiqueta e assunto, sem Responder (ele está no Por responder).
      await expect(seguir.getByRole('link', { name: /^Responder/ })).toHaveCount(0);

      // Por responder: na coluna estreita (celular e Painel a 1280 px), Responder sozinho e as três
      // ações (Virar tarefa em pílula, como no modelo) juntas na linha de baixo.
      const topos = (local: Locator) => local.locator('a, button').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
      const acoesDoEmail = await topos(regiao(/^Por responder/).getByRole('group', { name: 'Ações do e-mail: Relatório do semestre' }));
      expect(acoesDoEmail).toHaveLength(4);
      expect(acoesDoEmail[1]).toBeGreaterThan(acoesDoEmail[0]);
      expect(new Set(acoesDoEmail.slice(1)).size).toBe(1);
      // E cabem no cartão: nada passa da borda.
      const cartao = await caixa(regiao(/^Por responder/));
      const direita = await regiao(/^Por responder/).locator('.email-acoes, .email-topo').evaluateAll((els) => Math.max(...els.map((el) => el.getBoundingClientRect().right)));
      expect(direita).toBeLessThanOrEqual(cartao.x + cartao.width - 23); // dentro do recuo de 24 px do cartão
      // Sem prazo: Hoje, Esta semana e Escolher dia numa linha só.
      const quando = await topos(regiao('Sem prazo').getByRole('group', { name: 'Quando fazer: Comprar lâmpadas' }));
      expect(new Set(quando).size).toBe(1);
      await expect(regiao('Fechar o dia')).toContainText('Hoje: 1 tarefa feita, 3 em aberto e 2 e-mails sem resposta.');

      const ordem = [
        regiao('Mensagem do dia'),
        regiao('Linha do dia'),
        regiao('Pendências das salas'),
        regiao('Checklist do dia'),
        regiao('Agenda de hoje'),
        regiao(/^Por responder/),
        seguir,
        regiao('Sem prazo'),
        regiao('Fechar o dia'),
      ];
      const caixas = await Promise.all(ordem.map(caixa));
      const [mensagem, linha, salas, checklist, agenda, porResponder, aSeguir, semPrazo, fechar] = caixas;
      expect(linha.y).toBeGreaterThan(mensagem.y);
      expect(salas.y).toBeGreaterThan(linha.y);
      expect(checklist.y).toBeGreaterThan(salas.y);
      if (sufixo === '1280') {
        // Lado a lado no computador.
        expect(Math.abs(checklist.y - agenda.y)).toBeLessThan(2);
        expect(agenda.x).toBeGreaterThan(checklist.x);
        expect(Math.abs(porResponder.y - aSeguir.y)).toBeLessThan(2);
        expect(aSeguir.x).toBeGreaterThan(porResponder.x);
      } else {
        // Uma coluna no celular, na mesma ordem.
        expect(agenda.y).toBeGreaterThan(checklist.y);
        expect(aSeguir.y).toBeGreaterThan(porResponder.y);
      }
      expect(porResponder.y).toBeGreaterThan(Math.max(checklist.y + checklist.height, agenda.y + agenda.height) - 1);
      expect(semPrazo.y).toBeGreaterThan(Math.max(porResponder.y + porResponder.height, aSeguir.y + aSeguir.height) - 1);
      expect(fechar.y).toBeGreaterThan(semPrazo.y + semPrazo.height - 1);

      expect(await pequenos(page)).toEqual([]);
      expect(await semRolagemDeLado(page)).toBe(true);
      if (sufixo === '390') {
        // No fim da página, o último botão fica acima da barra de baixo, nunca atrás dela.
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        const ultimo = await caixa(regiao('Fechar o dia').getByRole('button', { name: 'Fechar o dia' }));
        const barra = await caixa(page.getByRole('navigation', { name: 'Principal' }));
        expect(ultimo.y + ultimo.height).toBeLessThanOrEqual(barra.y - 8);
      }
      await capturar(page, `painel-${sufixo}`);
      // Nada aqui escreve no Gmail: só leitura de e-mail sai do aparelho.
      expect(acoes.filter((a) => /mail/i.test(a) && a !== 'emails' && a !== 'atualizarEmails')).toEqual([]);
      expect(erros).toEqual([]);
    });

    test('Agora: destaque, tempo livre, fila; Concluir com Desfazer; Triagem um de cada vez', async ({ page }) => {
      const erros = vigiarErros(page);
      await abrir(page, '#/agora');
      const principal = page.getByRole('main');
      await expect(principal.getByText('Livre até 14:00, quando começa Reunião de orientação.')).toBeVisible();
      const destaque = principal.getByRole('region', { name: 'Em destaque' });
      await expect(destaque.getByRole('heading', { name: 'Ler artigo da Renata' })).toBeVisible();
      await expect(destaque).toContainText('Cabe agora');
      await expect(principal.getByRole('region', { name: /^A seguir/ }).getByRole('listitem')).toHaveCount(sufixo === '390' ? 3 : 5);
      expect(await pequenos(page)).toEqual([]);
      expect(await semRolagemDeLado(page)).toBe(true);
      await capturar(page, `agora-${sufixo}`);

      await destaque.getByRole('button', { name: 'Concluir: Ler artigo da Renata' }).click();
      await expect(destaque.getByRole('heading', { name: 'Preparar slides da aula' })).toBeVisible();
      // Só o do aviso da tarefa: o cartão Água, no topo da página, tem o seu próprio Desfazer.
      const desfazer = principal.getByRole('tabpanel').getByRole('button', { name: 'Desfazer' });
      await expect(desfazer).toBeFocused();
      await desfazer.click();
      await expect(destaque.getByRole('heading', { name: 'Ler artigo da Renata' })).toBeVisible();

      // As abas também andam pelo teclado.
      const abas = principal.getByRole('tablist', { name: 'Modo do Agora' });
      await abas.getByRole('tab', { name: 'Agora' }).focus();
      await page.keyboard.press('ArrowRight');
      const triagem = abas.getByRole('tab', { name: 'Triagem (2)' });
      await expect(triagem).toBeFocused();
      await expect(triagem).toHaveAttribute('aria-selected', 'true');
      const painel = principal.getByRole('tabpanel');
      await expect(painel.getByText('2 e-mails por decidir. Um de cada vez.')).toBeVisible();
      await expect(painel.getByRole('listitem')).toHaveCount(1);
      await painel.getByRole('button', { name: 'Feito: Relatório do semestre' }).click();
      await expect(painel.getByText('Dúvida sobre a prova')).toBeVisible();
      expect(await pequenos(page)).toEqual([]);
      expect(await semRolagemDeLado(page)).toBe(true);
      await capturar(page, `triagem-${sufixo}`);
      expect(erros).toEqual([]);
    });

    test('Fechar o dia: ação para tarefas e e-mails, passo final e Desfazer; continua fechado depois de recarregar', async ({ page }) => {
      const erros = vigiarErros(page);
      await abrir(page, '#/');
      const fechar = page.getByRole('main').getByRole('region', { name: 'Fechar o dia' });
      const tarefas = fechar.getByRole('list', { name: 'Tarefas que ficaram' });
      await expect(tarefas.getByRole('listitem')).toHaveCount(3);
      await fechar.scrollIntoViewIfNeeded();

      await tarefas.getByRole('group', { name: 'O que fazer com: Preparar slides da aula' }).getByRole('button', { name: 'Amanhã' }).click();
      await expect(fechar.getByText('Para amanhã: Preparar slides da aula')).toBeVisible();
      await expect(tarefas.getByRole('listitem')).toHaveCount(2);
      await expect(fechar.getByRole('button', { name: 'Desfazer' })).toBeFocused();
      await fechar.getByRole('button', { name: 'Desfazer' }).click();
      await expect(tarefas.getByRole('listitem')).toHaveCount(3);

      // Uma ação em lote por coluna; o passo final é a única ação principal.
      await expect(fechar.getByRole('button', { name: 'Passar as 3 para amanhã' })).toBeVisible();
      await expect(fechar.getByRole('button', { name: 'Adiar os 2 e-mails' })).toBeVisible();
      await expect(fechar.locator('.botao.primario')).toHaveCount(1);
      const emails = fechar.getByRole('list', { name: 'E-mails sem resposta' });
      await emails.getByRole('group', { name: 'O que fazer com: Dúvida sobre a prova' }).getByRole('button', { name: 'Agora não' }).click();
      await expect(emails.getByRole('listitem')).toHaveCount(1);
      // Uma linha por tarefa (no celular, o título e as ações em duas) e a prévia do que vai para amanhã.
      const alturas = await tarefas.getByRole('listitem').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)));
      const largura = page.viewportSize()!.width;
      for (const altura of alturas) expect(altura).toBeLessThanOrEqual(largura >= 700 ? 72 : 124);
      const amanha = fechar.getByRole('list', { name: 'Amanhã' });
      await expect(amanha.getByRole('listitem')).toHaveText([
        'Entrega do relatório até 17:00',
        'Ler artigo da Renata',
        'Preparar slides da aula',
        'Rever capítulo 3 da Marina',
      ]);
      expect(await pequenos(page)).toEqual([]);
      expect(await semRolagemDeLado(page)).toBe(true);
      await capturar(page, `fechar-${sufixo}`);

      await fechar.getByRole('button', { name: 'Fechar o dia' }).click();
      await expect(fechar.getByText('Dia fechado.')).toBeVisible();
      await expect(fechar.getByText('Você concluiu 1 tarefa hoje. 3 tarefas voltam amanhã.')).toBeVisible();
      await expect(fechar.getByRole('button', { name: 'Desfazer' })).toBeFocused();
      await expect(page.getByRole('main').getByRole('region', { name: 'Mensagem do dia' })).toContainText('Dia fechado.');
      await capturar(page, `fechado-${sufixo}`);

      await page.reload();
      await expect(fechar.getByText('Dia fechado.')).toBeVisible();
      await fechar.getByRole('button', { name: 'Reabrir o dia' }).click();
      await expect(fechar.getByRole('button', { name: 'Fechar o dia' })).toBeVisible();
      await expect(fechar.getByRole('button', { name: 'Fechar o dia' })).toBeFocused();
      expect(erros).toEqual([]);
    });
  });
}

test.describe('computador, 1280 px: o Agora no painel direito', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('cartão Agora com destaque e ação; Abrir o Agora leva à página e o painel não o repete', async ({ page }) => {
    await abrir(page, '#/');
    const lado = page.getByRole('complementary', { name: 'Agora, água e chat' });
    await expect(lado.getByText('Livre até 14:00 · 1 h 40')).toBeVisible();
    await expect(lado.getByRole('button', { name: 'Concluir: Ler artigo da Renata' })).toBeVisible();
    await expect(lado.getByText('Em breve')).toHaveCount(0);
    await lado.getByRole('link', { name: 'Abrir o Agora' }).click();
    await expect(page).toHaveURL(/#\/agora$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Agora' })).toBeFocused();
    await expect(lado.getByRole('heading', { name: 'Agora' })).toHaveCount(0);
    await expect(lado.getByRole('heading', { name: 'Chat' })).toBeVisible();
  });
});
