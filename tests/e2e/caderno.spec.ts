import { expect, test, type Page } from '@playwright/test';

// Tarefa 19: o caderno de uma sala, no celular e no computador.
// Quinta-feira, 2026-11-05, 12:20 em Lisboa (inverno: UTC+0). Nomes fictícios.
const AGORA = '2026-11-05T12:20:00+00:00';
const URL_FICTICIA = 'https://script.google.com/macros/s/ID-FICTICIO/exec';

async function responderComoOScript(page: Page) {
  await page.route(URL_FICTICIA, async (rota) => {
    const { acao, dados } = rota.request().postDataJSON();
    const cabecalhos = { 'access-control-allow-origin': '*' };
    const json = (corpo: object) => rota.fulfill({ headers: cabecalhos, contentType: 'application/json', body: JSON.stringify(corpo) });
    if (acao === 'emails' || acao === 'atualizarEmails') return json({ ok: true, dados: [] });
    if (acao === 'eventos') return json({ ok: true, dados: { eventos: [], incompleto: false } });
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

async function abrirSala(page: Page, hash: string) {
  await responderComoOScript(page);
  await page.goto('/central-app/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await guardarConexao(page);
  await expect(page.getByRole('navigation', { name: 'Principal' }).first()).toBeVisible();
  await page.goto(`/central-app/${hash}`);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

/** Controles do caderno com menos de 44 px de lado. */
const pequenosNoCaderno = (page: Page) =>
  page.evaluate(() => {
    const achados: string[] = [];
    const caderno = document.querySelector('.caderno');
    for (const c of caderno?.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea') ?? []) {
      const caixa = c.getBoundingClientRect();
      if (caixa.width === 0 && caixa.height === 0) continue;
      if (caixa.height < 43.5 || caixa.width < 43.5) achados.push(`${c.getAttribute('aria-label') ?? c.textContent?.trim().slice(0, 30)} (${Math.round(caixa.width)}x${Math.round(caixa.height)})`);
    }
    return achados;
  });

const semRolagemDeLado = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(AGORA);
});

for (const [nome, viewport] of [
  ['celular, 390 px', { width: 390, height: 844 }],
  ['computador, 1280 px', { width: 1280, height: 900 }],
] as const) {
  test.describe(nome, () => {
    test.use({ viewport });

    test('cria página, insere Checklist com "/", linha com data vira tarefa, tudo sobrevive ao recarregar', async ({ page }) => {
      const erros: string[] = [];
      page.on('pageerror', (e) => erros.push(e.message));
      await abrirSala(page, '#/sala/sala-aulas');

      const caderno = page.getByRole('region', { name: 'Caderno' });
      await caderno.getByRole('button', { name: 'Nova página' }).click();
      const linha = caderno.getByRole('textbox', { name: 'Texto' });
      await expect(linha).toBeVisible();

      await linha.fill('/');
      await expect(caderno.getByRole('listbox', { name: 'Inserir bloco' })).toBeVisible();
      expect(await pequenosNoCaderno(page)).toEqual([]);
      await caderno.getByRole('option', { name: /Checklist/ }).click();
      await expect(caderno.getByRole('region', { name: 'Checklist do dia' })).toBeVisible();

      const nova = caderno.getByRole('textbox', { name: 'Texto' });
      await expect(nova).toBeFocused();
      await nova.pressSequentially('Entregar as notas amanhã');
      await nova.press('Enter');
      await expect(caderno.getByText(/Virou tarefa em Aulas, para sexta/)).toBeVisible();
      await expect(caderno.getByRole('textbox', { name: 'Texto' }).last()).toBeFocused();

      expect(await pequenosNoCaderno(page)).toEqual([]);
      expect(await semRolagemDeLado(page)).toBe(true);

      // Remover tem Desfazer.
      await caderno.getByRole('button', { name: 'Remover bloco: Checklist' }).click();
      await expect(caderno.getByRole('region', { name: 'Checklist do dia' })).toHaveCount(0);
      await caderno.locator('.acao-feita').getByRole('button', { name: 'Desfazer' }).click();
      await expect(caderno.getByRole('region', { name: 'Checklist do dia' })).toBeVisible();

      await page.reload();
      const depois = page.getByRole('region', { name: 'Caderno' });
      await expect(depois.getByRole('region', { name: 'Checklist do dia' })).toBeVisible();
      await expect(depois.getByText('Já virou item')).toBeVisible();
      await expect(depois.getByRole('textbox', { name: 'Texto' }).first()).toHaveValue('Entregar as notas amanhã');
      expect(erros).toEqual([]);
    });
  });
}
