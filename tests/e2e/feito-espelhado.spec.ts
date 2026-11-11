import { expect, test, type Page } from '@playwright/test';
import { conectar, scriptFalso } from '../apoio/script-e2e';

// Feito espelhado no Google (spec 2026-11-09), no navegador, com o script de
// verdade e o Google na memória: a caixa de feito do compromisso põe "✓ " no
// Google Agenda; convite de outra pessoa continua aparecendo e fica feito só na
// Central; a tarefa criada e concluída vai para o Google Tarefas.
// Quinta-feira, 2026-11-05, 12:20 em Lisboa (inverno: UTC+0). Nomes fictícios.
const AGORA = '2026-11-05T12:20:00+00:00';
const PRINCIPAL = 'marina.ficticia@example.com';

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

test('compromisso feito ganha "✓ " no Google; convite aparece e fica feito só na Central; tarefa vai ao Google Tarefas', async ({ page }) => {
  const erros: string[] = [];
  page.on('pageerror', (erro) => erros.push(erro.message));
  const script = scriptFalso();
  script.agenda.evento(PRINCIPAL, {
    id: 'meu1',
    summary: 'Orientação com Renata',
    inicio: '2026-11-05T14:00:00+00:00',
    fim: '2026-11-05T15:00:00+00:00',
    organizer: { self: true },
  });
  script.agenda.evento(PRINCIPAL, {
    id: 'convite1',
    summary: 'Banca do Prof. Souza',
    inicio: '2026-11-05T16:00:00+00:00',
    fim: '2026-11-05T17:00:00+00:00',
    organizer: { email: 'souza.ficticio@example.com' },
    attendees: [{ email: PRINCIPAL, self: true, responseStatus: 'accepted' }],
  });
  await script.ligarA(page);
  await abrirConectado(page);

  const agenda = page.getByRole('main').getByRole('region', { name: 'Agenda de hoje' });
  // O convite criado por outra pessoa continua na Central.
  await expect(agenda.getByText('Banca do Prof. Souza')).toBeVisible();
  await expect(agenda.getByText('Orientação com Renata')).toBeVisible();

  const guardado = (id: string) => script.agenda.agendas.get(PRINCIPAL)!.eventos.get(id)!;
  await agenda.getByRole('checkbox', { name: 'Orientação com Renata' }).click();
  await expect(agenda.getByRole('checkbox', { name: 'Orientação com Renata' })).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => guardado('meu1').summary, { timeout: 15_000 }).toBe('✓ Orientação com Renata');
  // Lido de novo do Google, o título aparece sem a marca e continua feito.
  await expect(agenda.getByRole('checkbox', { name: 'Orientação com Renata' })).toHaveAttribute('aria-checked', 'true');

  await agenda.getByRole('checkbox', { name: 'Banca do Prof. Souza' }).click();
  await expect(agenda.getByRole('checkbox', { name: 'Banca do Prof. Souza' })).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => script.guardado(), { timeout: 15_000 }).toContain('convite1');
  expect(guardado('convite1').summary).toBe('Banca do Prof. Souza');
  await expect(page.getByText('2 de 2 feitas')).toBeVisible();

  const checklist = page.getByRole('main').getByRole('region', { name: 'Checklist do dia' });
  await checklist.getByLabel('Nova tarefa para hoje').fill('Ligar para a Aurora');
  await checklist.getByRole('button', { name: 'Adicionar' }).click();
  await expect
    .poll(() => script.tarefasGoogle.vivas().map((t) => [t.title, t.due, t.status]), { timeout: 15_000 })
    .toEqual([['Ligar para a Aurora', '2026-11-05T00:00:00.000Z', 'needsAction']]);

  await checklist.getByRole('checkbox', { name: 'Ligar para a Aurora' }).click();
  await expect.poll(() => script.tarefasGoogle.vivas()[0]?.status, { timeout: 15_000 }).toBe('completed');
  expect(script.tarefasGoogle.vivas()).toHaveLength(1);
  expect(erros).toEqual([]);
});

// Ampliação 11/11: concluir direto no Google Tarefas (lista "Central") conta na
// Central, e a Central não desmarca lá depois.
test('tarefa concluída direto no Google Tarefas fica feita na Central, e continua concluída no Google', async ({ page }) => {
  const erros: string[] = [];
  page.on('pageerror', (erro) => erros.push(erro.message));
  const script = scriptFalso();
  await script.ligarA(page);
  await abrirConectado(page);

  const checklist = page.getByRole('main').getByRole('region', { name: 'Checklist do dia' });
  await checklist.getByLabel('Nova tarefa para hoje').fill('Comprar pilhas');
  await checklist.getByRole('button', { name: 'Adicionar' }).click();
  await expect.poll(() => script.tarefasGoogle.vivas().length, { timeout: 15_000 }).toBe(1);
  await expect(checklist.getByRole('checkbox', { name: 'Comprar pilhas' })).toHaveAttribute('aria-checked', 'false');

  // O dono conclui no Google Tarefas e, minutos depois, abre a Central de novo.
  // (O relógio do script falso está em 13:00; a leitura anterior pede a partir de 12:50.)
  const [espelho] = script.tarefasGoogle.vivas();
  espelho.status = 'completed';
  espelho.completed = '2026-11-05T12:55:00.000Z';
  await page.clock.setFixedTime('2026-11-05T12:30:00+00:00');
  await page.reload();

  const caixa = page.getByRole('main').getByRole('region', { name: 'Checklist do dia' }).getByRole('checkbox', { name: 'Comprar pilhas' });
  await expect(caixa).toHaveAttribute('aria-checked', 'true', { timeout: 15_000 });
  expect(script.pedidos).toContain('lerEspelhos');
  expect(script.tarefasGoogle.vivas()).toMatchObject([{ status: 'completed', completed: '2026-11-05T12:55:00.000Z' }]);
  expect(erros).toEqual([]);
});
