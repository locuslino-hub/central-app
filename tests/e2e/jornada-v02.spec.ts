import { expect, test, type Page } from '@playwright/test';
import { planilhasNaMemoria } from '../apoio/planilhas-e2e';
import { conectar, scriptFalso } from '../apoio/script-e2e';

// Jornada completa da V02, de ponta a ponta no computador, com o Google de mentira (`planilhas-e2e.ts` e o script falso):
// uma ideia falada vira tarefa; as pastas padrão da Casa nascem; leitura de água, compras e gasto entram pela voz
// (digitada: o reconhecimento de fala de verdade não roda no teste); uma tarefa nasce no tema de uma pasta comum.
// Quinta-feira, 2026-11-05, 12:20 em Lisboa. Só nomes e valores fictícios.
const AGORA = '2026-11-05T12:20:00+00:00';
const HISTORICO = [
  { Data: '01/10/2026', Leitura: '1000', Unidade: 'm³', Observação: '' },
  { Data: '01/11/2026', Leitura: '1012', Unidade: 'm³', Observação: '' },
];

test.use({ viewport: { width: 1280, height: 900 } });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(AGORA);
});

/** Escreve a frase em Pode falar (a tela do atalho) e toca Pronto. */
async function falar(page: Page, frase: string) {
  // Sai e volta: ir de #/falar para #/falar não reabre a tela, e o cartão da frase anterior ficaria na frente.
  await page.goto('/central-app/#/');
  await page.goto('/central-app/#/falar');
  await page.getByRole('textbox', { name: 'Texto falado' }).fill(frase);
  await page.getByRole('button', { name: 'Pronto' }).click();
}

test('jornada da V02: ideia, pastas da Casa, leitura de água, compras, gasto e pasta comum', async ({ page }) => {
  const erros: string[] = [];
  page.on('pageerror', (erro) => erros.push(`pageerror: ${erro.message}`));
  const script = scriptFalso();
  await script.ligarA(page);
  const planilhas = await planilhasNaMemoria(page, { historico: HISTORICO });
  await page.goto('/central-app/');
  await conectar(page);

  // 1. Falar uma ideia -> Ideias -> levar para outra sala -> virar tarefa.
  await falar(page, 'Usar o artigo do Prof. Souza no capítulo 2');
  const cartao = page.getByRole('article');
  await expect(cartao.getByText('Guardado em Ideias')).toBeVisible();
  await cartao.getByRole('link', { name: 'Ver' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Ideias' })).toBeVisible();
  await expect(page.getByText('Usar o artigo do Prof. Souza no capítulo 2')).toBeVisible();

  await page.getByRole('main').getByRole('button', { name: /^(Outra sala|Escolher sala):/ }).click();
  await page.getByRole('group', { name: /Sala para/ }).getByRole('button', { name: 'Doutoramento' }).click();
  await expect(page.getByText('Levada para Doutoramento')).toBeVisible();
  await expect(page.getByText('Nada por arrumar. Boa!')).toBeVisible();

  await page.getByText('Já arrumadas (1)').click();
  await page.getByRole('main').getByRole('button', { name: /^Virar tarefa:/ }).click();
  await expect(page.getByText('Virou tarefa de hoje')).toBeVisible();
  await page.getByRole('link', { name: 'Ver' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Atividades' })).toBeVisible();
  await expect(page.getByText('Usar o artigo do Prof. Souza no capítulo 2').first()).toBeVisible();

  // 2. Criar as pastas padrão da Casa.
  await page.goto('/central-app/#/sala/sala-casa');
  const pastas = page.getByRole('region', { name: 'Pastas' });
  await pastas.getByRole('button', { name: 'Criar pastas padrão da Casa' }).click();
  await expect(pastas.getByRole('link')).toHaveCount(6);
  expect(planilhas.criadas.map((c) => c.modelo)).toEqual(['compras', 'compras', 'consumo', 'consumo', 'consumo', 'financeiro']);

  // 3. Falar a leitura de água.
  await falar(page, 'leitura da água 1020');
  await expect(page.getByRole('article').getByText('Leitura guardada')).toBeVisible();
  expect(planilhas.linhas(3).at(-1)?.valores).toMatchObject({ Data: '2026-11-05', Leitura: '1020' });

  // 4. Falar compras.
  await falar(page, 'põe leite e pão nas compras da semana');
  await expect(page.getByRole('article').getByText('2 itens guardados')).toBeVisible();
  expect(planilhas.linhas(1).slice(-2).map((l) => l.valores['Item'])).toEqual(['leite', 'pão']);

  // 5. Falar um gasto (desktop).
  await falar(page, 'gastei 5,50 hoje comprando salgado');
  await expect(page.getByRole('article')).toContainText('Gasto guardado');
  await expect(page.getByRole('article')).toContainText('€ 5,50');
  expect(planilhas.linhas(6).at(-1)?.valores).toMatchObject({ Data: '2026-11-05', Descrição: 'salgado', Valor: '5.5' });

  // 6. Criar uma tarefa no tema de uma pasta comum.
  await page.goto('/central-app/#/sala/sala-doutoramento');
  const pastasDoutoramento = page.getByRole('region', { name: 'Pastas' });
  await pastasDoutoramento.getByRole('button', { name: /Nova pasta/ }).click();
  const form = page.getByRole('form', { name: 'Nova pasta' });
  await form.getByLabel('Nome da pasta').fill('Metodologia');
  await form.getByRole('button', { name: 'Criar pasta' }).click();
  await pastasDoutoramento.getByRole('link', { name: 'Abrir' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Metodologia' })).toBeVisible();
  const tarefas = page.getByRole('main').getByRole('region', { name: 'Tarefas' });
  await tarefas.getByRole('textbox', { name: 'Nova tarefa em Metodologia' }).fill('Escrever a justificativa');
  await tarefas.getByRole('button', { name: 'Adicionar' }).click();
  await expect(tarefas.getByText('Escrever a justificativa', { exact: true })).toBeVisible();

  expect(erros).toEqual([]);
});
