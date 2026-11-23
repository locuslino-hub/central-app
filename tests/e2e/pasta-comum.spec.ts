import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { conectar, scriptFalso } from '../apoio/script-e2e';

// Pasta comum por tema (V02, Tarefa 17), no navegador. Dados e nomes fictícios.
// Quinta-feira, 2026-11-05, 12:20 em Lisboa.
const AGORA = '2026-11-05T12:20:00+00:00';

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(AGORA);
});

async function abrir(page: Page, hash: string) {
  await scriptFalso().ligarA(page);
  await page.goto('/central-app/');
  await conectar(page);
  await page.goto(`/central-app/${hash}`);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

const semRolagemDeLado = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

async function semAchadosDoAxe(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(violations.filter((v) => v.impact === 'critical' || v.impact === 'serious').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
}

/** Cria a pasta comum "Metodologia" em Doutoramento e abre a página dela. */
async function criarMetodologia(page: Page) {
  await abrir(page, '#/sala/sala-doutoramento');
  const pastas = page.getByRole('region', { name: 'Pastas' });
  await pastas.getByRole('button', { name: /Nova pasta/ }).click();
  await page.getByRole('form', { name: 'Nova pasta' }).getByLabel('Nome da pasta').fill('Metodologia');
  await page.getByRole('form', { name: 'Nova pasta' }).getByRole('button', { name: 'Criar pasta' }).click();
  await pastas.getByRole('link', { name: 'Abrir' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Metodologia' })).toBeVisible();
}

async function usarPasta(page: Page) {
  const erros: string[] = [];
  page.on('pageerror', (erro) => erros.push(erro.message));
  await criarMetodologia(page);
  const principal = page.getByRole('main');

  // Tarefa pela própria pasta.
  const tarefas = principal.getByRole('region', { name: 'Tarefas' });
  await tarefas.getByRole('textbox', { name: 'Nova tarefa em Metodologia' }).fill('Escrever a justificativa');
  await tarefas.getByRole('button', { name: 'Adicionar' }).click();
  await expect(tarefas.getByText('Escrever a justificativa', { exact: true })).toBeVisible();

  // Documento pela própria pasta: sem perguntar onde guardar.
  const documentos = principal.getByRole('region', { name: 'Documentos' });
  await documentos.getByRole('button', { name: 'Adicionar documento' }).click();
  const form = page.getByRole('form', { name: 'Novo documento' });
  await expect(form.getByLabel('Guardar em')).toHaveCount(0);
  await form.getByLabel('Link').fill('https://exemplo.invalid/plano.pptx');
  await form.getByLabel('Título').fill('Plano de métodos');
  await form.getByRole('button', { name: 'Guardar' }).click();
  await expect(documentos.getByRole('link', { name: 'Plano de métodos' })).toBeVisible();

  // Nota pela própria pasta.
  const notas = principal.getByRole('region', { name: 'Notas · Metodologia' });
  await notas.getByRole('button', { name: /Nova nota/ }).click();
  await notas.getByRole('button', { name: 'Texto' }).click();
  await notas.getByRole('textbox', { name: 'Texto da nota' }).fill('Definir o tamanho da amostra');
  await notas.getByRole('button', { name: 'Salvar nota' }).click();
  await expect(notas.getByText('Definir o tamanho da amostra', { exact: true })).toBeVisible();

  expect(await semRolagemDeLado(page)).toBe(true);
  await semAchadosDoAxe(page);

  // A frase do Chat leva a tarefa para o tema.
  await page.goto('/central-app/#/chat');
  const campo = page.getByRole('main').getByRole('textbox', { name: 'Escreva ou dite' });
  await campo.fill('adicione revisar capítulo nas tarefas do tema Metodologia');
  await campo.press('Enter');
  await expect(page.getByRole('main').getByRole('article').getByText('Tema: Metodologia.')).toBeVisible();
  await page.goto('/central-app/#/sala/sala-doutoramento');
  await page.getByRole('region', { name: 'Pastas' }).getByRole('link', { name: /Metodologia/ }).click();
  await expect(principal.getByRole('region', { name: 'Tarefas' }).getByText('Revisar capítulo', { exact: true })).toBeVisible();
  expect(await semRolagemDeLado(page)).toBe(true);
  expect(erros).toEqual([]);
}

test.describe('computador, 1280 px', () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  test('cria o tema, põe tarefa, documento e nota nele, e o Chat leva a tarefa para o tema', async ({ page }) => {
    await usarPasta(page);
  });
});

test.describe('celular, 375 px', () => {
  test.use({ viewport: { width: 375, height: 812 } });
  test('o mesmo caminho, em coluna única e sem rolagem de lado', async ({ page }) => {
    await usarPasta(page);
  });
});
