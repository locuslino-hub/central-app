import { expect, test, type Page } from '@playwright/test';
import { conectar, scriptFalso } from '../apoio/script-e2e';

// Blocos do Google Tarefas e sala pela cor do Google (spec 2026-11-09), no
// navegador, com o script de verdade e o Google na memória.
// Quinta-feira, 2026-11-05, 12:20 em Lisboa (inverno: UTC+0). Nomes fictícios.
const AGORA = '2026-11-05T12:20:00+00:00';
const PRINCIPAL = 'marina.ficticia@example.com';
const AVISO = 'As mudanças feitas no título não serão salvas. Para fazer edições, acesse: https://tasks.google.com/task/';

test.use({ viewport: { width: 1280, height: 900 } });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(AGORA);
});

async function abrirConectado(page: Page) {
  await page.goto('/central-app/');
  await conectar(page);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

test('bloco do Google Tarefas: ocupado, feito no Google aparece na Central e o ✓ da Central conclui a tarefa', async ({ page }) => {
  const erros: string[] = [];
  page.on('pageerror', (erro) => erros.push(erro.message));
  const script = scriptFalso();
  const lista = script.tarefasGoogle.lista('Tese');
  const capitulo = script.tarefasGoogle.tarefa(lista, { id: 'api1', idDaWeb: 'web1', title: 'Revisar capítulo', due: '2026-11-05T00:00:00.000Z' });
  script.tarefasGoogle.tarefa(lista, {
    id: 'api2',
    idDaWeb: 'web2',
    title: 'Ler artigo da Aurora',
    due: '2026-11-05T00:00:00.000Z',
    status: 'completed',
    updated: '2026-11-05T11:00:00.000Z',
  });
  const bloco = (id: string, titulo: string, web: string, inicio: string, fim: string) =>
    script.agenda.evento(PRINCIPAL, {
      id,
      summary: titulo,
      inicio: `2026-11-05T${inicio}:00+00:00`,
      fim: `2026-11-05T${fim}:00+00:00`,
      description: `${AVISO}${web}`,
      eventType: 'focusTime',
      transparency: 'transparent',
    });
  bloco('bloco1', 'Revisar capítulo', 'web1', '14:00', '15:00');
  bloco('bloco2', 'Ler artigo da Aurora', 'web2', '09:00', '10:00');
  await script.ligarA(page);
  await abrirConectado(page);

  const agenda = page.getByRole('main').getByRole('region', { name: 'Agenda de hoje' });
  await expect(agenda.getByText('Revisar capítulo')).toBeVisible();
  // Concluída no Google Tarefas: aparece feita na Central.
  await expect(agenda.getByRole('checkbox', { name: 'Ler artigo da Aurora' })).toHaveAttribute('aria-checked', 'true');
  // Ocupado: nunca "livre".
  await expect(agenda.getByText('livre', { exact: true })).toHaveCount(0);

  await agenda.getByRole('checkbox', { name: 'Revisar capítulo' }).click();
  await expect.poll(() => capitulo.status, { timeout: 15_000 }).toBe('completed');
  expect(capitulo.title).toBe('Revisar capítulo');
  expect(script.agenda.agendas.get(PRINCIPAL)!.eventos.get('bloco1')!.summary).toBe('Revisar capítulo');
  await expect(agenda.getByRole('checkbox', { name: 'Revisar capítulo' })).toHaveAttribute('aria-checked', 'true');
  expect(erros).toEqual([]);
});

test('Cores do Google: ligar a cor a uma sala põe o compromisso na sala, no Quadro e no detalhe', async ({ page }) => {
  const erros: string[] = [];
  page.on('pageerror', (erro) => erros.push(erro.message));
  const script = scriptFalso();
  script.agenda.evento(PRINCIPAL, {
    id: 'azul1',
    summary: 'Escrita do capítulo 3',
    inicio: '2026-11-05T15:00:00+00:00',
    fim: '2026-11-05T16:00:00+00:00',
    colorId: '9',
  });
  await script.ligarA(page);
  await abrirConectado(page);

  await page.goto('/central-app/#/salas');
  await page.getByRole('link', { name: 'Cores do Google' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Cores do Google' })).toBeVisible();
  const azul = page.getByRole('group', { name: /Mirtilo/ });
  await expect(azul.getByText('1 evento')).toBeVisible();
  await expect(azul.getByText(/Escrita do capítulo 3/)).toBeVisible();
  await azul.getByLabel('Sala').selectOption({ label: 'Doutoramento' });
  await expect(azul.getByRole('button', { name: 'Sem sala' })).toBeEnabled();

  await page.goto('/central-app/#/quadro');
  const coluna = page.getByRole('region', { name: 'Doutoramento' });
  await expect(coluna.getByText('Escrita do capítulo 3')).toBeVisible();
  await coluna.getByRole('button', { name: /Escrita do capítulo 3/ }).click();
  const detalhe = page.getByRole('dialog');
  await expect(detalhe.getByText('Doutoramento')).toBeVisible();
  await expect(detalhe.getByText('Sem sala')).toHaveCount(0);
  expect(erros).toEqual([]);
});
