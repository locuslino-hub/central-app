import { expect, test, type Page } from '@playwright/test';
import { conectar, scriptFalso, type ScriptFalso } from '../apoio/script-e2e';

// Teste do dono no celular (11/11), no navegador, com o script de verdade e o
// Google na memória: o chat guarda sempre na hora, "tarefa ... às 18h" vira
// tarefa com hora, compromisso criado no chat aparece no Painel sem recarregar
// e, sem internet, o compromisso da fila já aparece. Nomes fictícios.
// Quinta-feira, 2026-11-05, 12:20 em Lisboa (inverno: UTC+0).
const AGORA = '2026-11-05T12:20:00+00:00';

test.use({ viewport: { width: 390, height: 844 } });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(AGORA);
});

async function abrirConectado(page: Page, script: ScriptFalso) {
  await script.ligarA(page);
  await page.goto('/central-app/');
  await conectar(page);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Painel do dia' })).toBeVisible();
}

async function dizer(page: Page, frase: string) {
  await page.goto('/central-app/#/chat');
  const principal = page.getByRole('main');
  const campo = principal.getByRole('textbox', { name: 'Escreva ou dite' });
  await campo.fill(frase);
  await campo.press('Enter');
  const cartao = principal.getByRole('article').last();
  await expect(cartao.getByRole('button', { name: 'Desfazer' })).toBeVisible();
  return cartao;
}

const agendaDeHoje = (page: Page) => page.getByRole('main').getByRole('region', { name: 'Agenda de hoje' });

test('compromisso criado no chat (outra página no celular) aparece no Painel sem recarregar', async ({ page }) => {
  const script = scriptFalso();
  await abrirConectado(page, script);
  await expect(agendaDeHoje(page).getByText('Nada marcado para hoje.')).toBeVisible();

  const cartao = await dizer(page, 'Ligar para o banco hoje às 18h');
  await expect(cartao.getByText('Compromisso')).toBeVisible();
  await page.goto('/central-app/#/');

  await expect(agendaDeHoje(page).getByText('Ligar para o banco')).toBeVisible({ timeout: 5_000 });
});

test('sem internet, o compromisso do chat já aparece na Agenda de hoje, marcado "a enviar"; com a internet de volta, vai ao Google', async ({ page, context }) => {
  const script = scriptFalso();
  await abrirConectado(page, script);
  script.cair();
  await context.setOffline(true);

  await dizer(page, 'Consulta no dentista hoje às 17h');
  await page.goto('/central-app/#/');
  const item = agendaDeHoje(page).getByRole('listitem').filter({ hasText: 'Consulta no dentista' });
  await expect(item).toBeVisible();
  await expect(item.getByText('a enviar')).toBeVisible();

  script.voltar();
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => script.pedidos.includes('criarEvento'), { timeout: 15_000 }).toBe(true);
  await expect(item.getByText('a enviar')).toHaveCount(0, { timeout: 15_000 });
  await expect(item).toBeVisible();
});

test('"tarefa ... às 18h" vira tarefa com hora: fica em Atividades e é bloco na Agenda de hoje, sem ir ao Google Agenda', async ({ page }) => {
  const script = scriptFalso();
  await abrirConectado(page, script);

  const cartao = await dizer(page, 'Adicione tarefa ligar para a Renata hoje às 18:00');
  await expect(cartao.getByText('Tarefa', { exact: true })).toBeVisible();
  await expect(cartao.getByText('Hoje, 18:00')).toBeVisible();

  await page.goto('/central-app/#/atividades');
  await expect(page.getByRole('main').getByText('Ligar para a Renata')).toBeVisible();
  await page.goto('/central-app/#/');
  const bloco = agendaDeHoje(page).getByRole('listitem').filter({ hasText: 'Ligar para a Renata' });
  await expect(bloco.getByText('18:00 às 19:00')).toBeVisible();
  expect(script.pedidos).not.toContain('criarEvento');
});

test('frase incerta é guardada na hora: depois de fechar e abrir o app, a tarefa de hoje continua lá', async ({ page }) => {
  await page.goto('/central-app/');
  await dizer(page, 'Xícaras novas');
  await expect(page.getByText('Anotei. Confira o cartão.')).toBeVisible();

  await page.reload();
  await page.goto('/central-app/#/atividades');
  const hoje = page.getByRole('main').getByRole('region', { name: 'Hoje' });
  await expect(hoje.getByText('Xícaras novas')).toBeVisible();
});

test('"sem prazo" dito vai para Sem prazo, sem as palavras no título', async ({ page }) => {
  await page.goto('/central-app/');
  const cartao = await dizer(page, 'Adicione comprar pilhas sem prazo');
  await expect(cartao.getByText('Comprar pilhas', { exact: true })).toBeVisible();
  await expect(cartao.getByText('Sem prazo')).toBeVisible();

  await page.goto('/central-app/#/');
  await expect(page.getByRole('main').getByRole('region', { name: 'Sem prazo' }).getByText('Comprar pilhas', { exact: true })).toBeVisible();
});
