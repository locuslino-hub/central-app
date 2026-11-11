import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Quinta-feira, 2026-11-05, 12:20 em Lisboa (inverno: UTC+0).
const AGORA = '2026-11-05T12:20:00+00:00';
const URL_FICTICIA = 'https://script.google.com/macros/s/ID-FICTICIO/exec';

/** Com CAPTURAS_T14 definida, as imagens vão para essa pasta (conferência visual). */
const CAPTURAS = process.env.CAPTURAS_T14;
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
  await page.screenshot({ path: join(CAPTURAS, `${nome}.png`), fullPage: true });
}

type EmailDeTeste = {
  id: string;
  remetente: string;
  enderecoRemetente: string;
  assunto: string;
  trecho: string;
  data: string;
  link: string;
};

const email = (id: string, remetente: string, endereco: string, assunto: string, trecho: string, data: string): EmailDeTeste => ({
  id,
  remetente,
  enderecoRemetente: endereco,
  assunto,
  trecho,
  data,
  link: `https://mail.google.com/mail/u/0/#all/${id}`,
});

/** Nomes fictícios; o script entrega o mais antigo primeiro. */
const EMAILS: EmailDeTeste[] = [
  email('f1a2b3', 'Prof. Souza', 'souza@exemplo.invalid', 'Relatório do semestre', 'Segue o relatório do semestre para a sua leitura antes da reunião de sexta-feira, com as dúvidas marcadas.', '2026-11-03T16:40:00+00:00'),
  email('f1a2b4', 'Marina', 'marina@exemplo.invalid', 'Revisão do capítulo 2', 'Professor, mandei a nova versão do capítulo 2 com as correções que combinamos na última orientação.', '2026-11-04T18:05:00+00:00'),
  email('f1a2b5', 'Renata', 'renata@exemplo.invalid', 'Dúvida sobre a prova', 'Bom dia! Posso entregar o trabalho na segunda-feira em vez de sexta?', '2026-11-05T09:15:00+00:00'),
  email('f1a2b6', 'Aurora', 'aurora@exemplo.invalid', 'Resumo do congresso', 'Enviei o resumo para o congresso e aguardo o seu retorno.', '2026-11-05T10:20:00+00:00'),
  email('f1a2b7', 'Secretaria do curso', 'secretaria@exemplo.invalid', 'Calendário de defesas', 'Informamos as datas das defesas do próximo semestre.', '2026-11-05T11:00:00+00:00'),
];

type Roteiro = { emails?: 'normal' | 'codigo-invalido' | 'rede' };

/** O script de mentira: só a lista de e-mails e o necessário para abrir o app. */
async function responderComoOScript(page: Page, roteiro: Roteiro = {}) {
  const acoes: string[] = [];
  await page.route(URL_FICTICIA, async (rota) => {
    const { acao, dados } = rota.request().postDataJSON();
    acoes.push(acao);
    const cabecalhos = { 'access-control-allow-origin': '*' };
    const json = (corpo: object) => rota.fulfill({ headers: cabecalhos, contentType: 'application/json', body: JSON.stringify(corpo) });
    if (acao === 'emails' || acao === 'atualizarEmails') {
      if (roteiro.emails === 'rede') return rota.abort();
      if (roteiro.emails === 'codigo-invalido') return json({ ok: false, erro: 'codigo-invalido' });
      return json({ ok: true, dados: EMAILS });
    }
    if (acao === 'eventos') return json({ ok: true, dados: { eventos: [], incompleto: false } });
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

/** Abre o app já conectado ao script de mentira, na página pedida. */
async function abrir(page: Page, hash: string, roteiro: Roteiro = {}) {
  const acoes = await responderComoOScript(page, roteiro);
  await page.goto('/central-app/');
  await guardarConexao(page);
  await page.goto(`/central-app/${hash}`);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  return acoes;
}

/** A Marina é aluna de Orientações: o e-mail dela já vem com a sala. */
async function cadastrarMarina(page: Page) {
  await page.goto('/central-app/#/salas');
  const principal = page.getByRole('main');
  await principal.getByLabel('Nome', { exact: true }).fill('Marina');
  await principal.getByLabel('Sala', { exact: true }).selectOption({ label: 'Orientações' });
  await principal.getByRole('button', { name: 'Cadastrar pessoa' }).click();
  await expect(principal.getByRole('list').getByText('Marina')).toBeVisible();
  // Ensina o e-mail dela direto na memória de pessoas (como a pergunta "de quem é?" faz).
  await page.evaluate(
    () =>
      new Promise<void>((resolver, rejeitar) => {
        const abrir = indexedDB.open('central-dados');
        abrir.onerror = () => rejeitar(abrir.error);
        abrir.onsuccess = () => {
          const banco = abrir.result;
          const escrita = banco.transaction('pessoas', 'readwrite');
          const loja = escrita.objectStore('pessoas');
          const todas = loja.getAll();
          todas.onsuccess = () => {
            for (const p of todas.result) if (p.nome === 'Marina') loja.put({ ...p, emails: ['marina@exemplo.invalid'], atualizadoEm: Date.now() + 1 });
          };
          escrita.oncomplete = () => resolver();
        };
      }),
  );
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

    test('Painel: Por responder lista os e-mails, cabe na tela, com toque de 44 px; leva à Caixa', async ({ page }) => {
      const erros = vigiarErros(page);
      await page.goto('/central-app/');
      await cadastrarMarina(page);
      const acoes = await abrir(page, '#/');

      const cartao = page.getByRole('main').getByRole('region', { name: /Por responder/ });
      await expect(cartao.getByRole('heading', { name: /Por responder/ })).toContainText('5 e-mails');
      // O Painel mostra os 4 primeiros (do mais antigo) e leva à Caixa para ver o resto.
      await expect(cartao.getByRole('listitem')).toHaveCount(4);
      await expect(cartao.getByText('Relatório do semestre', { exact: true })).toBeVisible();
      await expect(cartao.getByText('Segue o relatório do semestre', { exact: false })).toBeVisible();
      await expect(cartao.getByText('Orientações', { exact: true })).toBeVisible(); // a Marina, pela memória de pessoas
      await expect(cartao.getByText(/Atualizado às/)).toBeVisible();
      await capturar(page, `painel-${sufixo}`);
      expect(await pequenos(page)).toEqual([]);
      expect(await semRolagemDeLado(page)).toBe(true);

      await cartao.getByRole('link', { name: 'Ver os 5 na Caixa' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Caixa' })).toBeVisible();
      await expect(page.getByRole('main').getByRole('listitem')).toHaveCount(5);
      await capturar(page, `caixa-${sufixo}`);
      expect(await pequenos(page)).toEqual([]);
      expect(await semRolagemDeLado(page)).toBe(true);
      // Só a leitura saiu para o script: nenhuma ação que mexa no Gmail.
      expect(acoes.filter((a) => a === 'emails').length).toBeGreaterThan(0);
      expect(acoes.filter((a) => /enviar|apagar|marcar|arquivar|responder/i.test(a) && a !== 'enviar')).toEqual([]);
      expect(erros).toEqual([]);
    });

    test('Feito, Agora não e Virar tarefa, cada um com Desfazer; Responder abre o Gmail e o foco vai ao próximo', async ({ page }) => {
      const erros = vigiarErros(page);
      await abrir(page, '#/caixa');
      const caixa = page.getByRole('main').getByRole('region', { name: /Por responder/ });
      const item = (assunto: string) => caixa.getByRole('listitem').filter({ hasText: assunto });
      await expect(caixa.getByRole('listitem')).toHaveCount(5);

      // Feito.
      await item('Relatório do semestre').getByRole('button', { name: /^Feito/ }).click();
      await expect(caixa.getByRole('listitem')).toHaveCount(4);
      await expect(caixa.getByText('E-mail marcado como feito')).toBeVisible();
      await expect(caixa.getByRole('button', { name: 'Desfazer' })).toBeFocused();
      await capturar(page, `desfazer-${sufixo}`);
      await caixa.getByRole('button', { name: 'Desfazer' }).click();
      await expect(caixa.getByRole('listitem')).toHaveCount(5);

      // Agora não: some hoje (volta amanhã).
      await item('Dúvida sobre a prova').getByRole('button', { name: /^Agora não/ }).click();
      await expect(caixa.getByRole('listitem')).toHaveCount(4);
      await expect(caixa.getByText(/adiado para amanhã/)).toBeVisible();
      await page.reload();
      await expect(caixa.getByRole('listitem')).toHaveCount(4); // continua escondido depois de recarregar

      // Virar tarefa: o e-mail fica, com a marca; a tarefa está em Sem prazo (Atividades).
      await item('Resumo do congresso').getByRole('button', { name: /^Virar tarefa/ }).click();
      await expect(item('Resumo do congresso').getByText('Virou tarefa')).toBeVisible();
      await page.goto('/central-app/#/atividades');
      await expect(page.getByRole('main').getByRole('region', { name: 'Sem prazo' }).getByText('Responder: Resumo do congresso')).toBeVisible();
      await page.goto('/central-app/#/caixa');

      // Responder: abre o Gmail em outra aba; ao voltar, o foco vai ao Responder do próximo item.
      await page.context().route('https://mail.google.com/**', (rota) => rota.fulfill({ contentType: 'text/html', body: '<p>Gmail de mentira</p>' }));
      const responder = item('Revisão do capítulo 2').getByRole('link', { name: /^Responder/ });
      await expect(responder).toHaveAttribute('target', '_blank');
      await expect(responder).toHaveAttribute('rel', 'noopener noreferrer');
      const [aba] = await Promise.all([page.context().waitForEvent('page'), responder.click()]);
      expect(aba.url()).toBe('https://mail.google.com/mail/u/0/#all/f1a2b4');
      await aba.close();
      await page.evaluate(() => {
        window.dispatchEvent(new Event('blur'));
        window.dispatchEvent(new Event('focus'));
      });
      const proximo = caixa.getByRole('listitem').nth(2).getByRole('link', { name: /^Responder/ }); // depois da Revisão vem o Resumo (a Dúvida ficou para amanhã)
      await expect(proximo).toBeFocused();
      expect(erros).toEqual([]);
    });

    test('Atualizar agora mostra o estado e uma falha não apaga a lista', async ({ page }) => {
      await abrir(page, '#/caixa');
      const caixa = page.getByRole('main').getByRole('region', { name: /Por responder/ });
      await expect(caixa.getByRole('listitem')).toHaveCount(5);
      await caixa.getByRole('button', { name: 'Atualizar agora' }).click();
      await expect(caixa.getByText(/Atualizado às/)).toBeVisible();
      await expect(caixa.getByRole('button', { name: 'Atualizar agora' })).toBeEnabled();
    });

    test('Gmail ainda não liberado no script: o app diz o que falta, sem derrubar nada', async ({ page }) => {
      const erros = vigiarErros(page);
      await abrir(page, '#/', { emails: 'codigo-invalido' });
      const cartao = page.getByRole('main').getByRole('region', { name: /Por responder/ });
      await expect(cartao.getByText('E-mail ainda não liberado — falta aprovar a permissão no script')).toBeVisible();
      await capturar(page, `nao-liberado-${sufixo}`);
      expect(await semRolagemDeLado(page)).toBe(true);
      expect(erros).toEqual([]);
    });
  });
}

// Entre 1101 e 1250 px o cartão fica ao lado de A seguir, estreito: nada pode sair dele.
for (const largura of [1101, 1180, 1250]) {
  test.describe(`computador, ${largura} px`, () => {
    test.use({ viewport: { width: largura, height: 900 } });

    test('Por responder: nada sai do cartão e os botões têm 44 px', async ({ page }) => {
      await page.goto('/central-app/');
      await cadastrarMarina(page);
      await abrir(page, '#/');
      const cartao = page.getByRole('main').getByRole('region', { name: /Por responder/ });
      await expect(cartao.getByRole('listitem')).toHaveCount(4);

      if (process.env.CAPTURAS_T14) await cartao.screenshot({ path: join(process.env.CAPTURAS_T14, `por-responder-${largura}.png`) });
      const medidas = await cartao.evaluate((el) => {
        const caixa = el.getBoundingClientRect();
        const saindo: string[] = [];
        for (const filho of el.querySelectorAll<HTMLElement>('*')) {
          const r = filho.getBoundingClientRect();
          if (r.width === 0) continue;
          if (r.right > caixa.right + 0.5 || r.left < caixa.left - 0.5) saindo.push(`${filho.tagName}.${filho.className} ${Math.round(r.left)}-${Math.round(r.right)} (cartão ${Math.round(caixa.left)}-${Math.round(caixa.right)})`);
        }
        const linhas = [...el.querySelectorAll<HTMLElement>('li')].map((li) => li.scrollWidth - li.clientWidth);
        return { cartao: el.scrollWidth - el.clientWidth, linhas, saindo: saindo.slice(0, 5) };
      });
      expect(medidas.cartao).toBeLessThanOrEqual(0);
      expect(medidas.linhas.every((dif) => dif <= 0)).toBe(true);
      expect(medidas.saindo).toEqual([]);
      const pequenosNoCartao = await cartao.evaluate((el) =>
        [...el.querySelectorAll<HTMLElement>('a[href], button')]
          .map((c) => ({ t: c.textContent?.trim().slice(0, 20), r: c.getBoundingClientRect() }))
          .filter((c) => c.r.width > 0 && (c.r.height < 43.5 || c.r.width < 43.5))
          .map((c) => `${c.t} (${Math.round(c.r.width)}x${Math.round(c.r.height)})`),
      );
      expect(pequenosNoCartao).toEqual([]);
    });
  });
}
