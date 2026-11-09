import { expect, test, type Page } from '@playwright/test';

// Quinta-feira, 2026-11-05, 12:20 em Lisboa (inverno: UTC+0).
const AGORA = '2026-11-05T12:20:00+00:00';

function vigiarErros(page: Page) {
  const erros: string[] = [];
  page.on('pageerror', (erro) => erros.push(`pageerror: ${erro.message}`));
  page.on('console', (mensagem) => {
    if (mensagem.type() === 'error') erros.push(`console: ${mensagem.text()}`);
  });
  return erros;
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
          `${controle.textContent?.trim().slice(0, 30) || controle.outerHTML.slice(0, 60)} (${Math.round(caixa.width)}x${Math.round(caixa.height)})`,
        );
      }
    }
    return achados;
  });
}

const semRolagemDeLado = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

/** Lê as tarefas direto do IndexedDB do app (o que está guardado, não o que está na tela). */
function tarefasGuardadas(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{ titulo: string; data?: string; semana?: string; feito: boolean; duracaoMin: number; duracaoConfirmada: boolean }[]>(
        (resolve, reject) => {
          const abrir = indexedDB.open('central-dados');
          abrir.onerror = () => reject(abrir.error);
          abrir.onsuccess = () => {
            const pedido = abrir.result.transaction('tarefas').objectStore('tarefas').getAll();
            pedido.onsuccess = () => resolve(pedido.result.filter((t) => !t.apagado));
            pedido.onerror = () => reject(pedido.error);
          };
        },
      ),
  );
}

async function dizerAoChat(page: Page, frase: string) {
  await page.goto('/central-app/#/chat');
  const principal = page.getByRole('main');
  const campo = principal.getByRole('textbox', { name: 'Escreva ou dite' });
  await campo.fill(frase);
  await campo.press('Enter');
  await expect(principal.getByRole('article').last().getByRole('button', { name: 'Desfazer' })).toBeVisible();
}

async function cadastrarPessoa(page: Page, nome: string, sala: string, papel = '') {
  await page.goto('/central-app/#/salas');
  const principal = page.getByRole('main');
  await principal.getByLabel('Nome', { exact: true }).fill(nome);
  await principal.getByLabel('Sala', { exact: true }).selectOption({ label: sala });
  if (papel) await principal.getByLabel('Papel (opcional)').fill(papel);
  await principal.getByRole('button', { name: 'Cadastrar pessoa' }).click();
  await expect(principal.getByRole('status').filter({ hasText: 'cadastrada em' })).toHaveText(`${nome} cadastrada em ${sala}.`);
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(AGORA);
});

test.describe('celular, 390 px', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('cadastrar pessoa, anotar pelo chat, ver na checklist, concluir e desfazer', async ({ page }) => {
    const erros = vigiarErros(page);
    await cadastrarPessoa(page, 'Marina', 'Orientações', 'aluna');
    expect(await pequenos(page)).toEqual([]);
    expect(await semRolagemDeLado(page)).toBe(true);
    await expect(page.getByRole('group', { name: 'Orientações' }).getByText('Marina')).toBeVisible();

    await dizerAoChat(page, 'Marcar reunião com a Marina');
    await dizerAoChat(page, 'Preciso parafusar o apoio do banheiro');

    await page.goto('/central-app/#/');
    const principal = page.getByRole('main');
    const checklist = principal.getByRole('region', { name: 'Checklist do dia' });
    await expect(checklist.getByText('0 de 1 feita')).toBeVisible();
    await expect(checklist.getByText('Orientações')).toBeVisible();
    await expect(checklist.getByRole('button', { name: 'Duração: cerca de 1 h' })).toBeVisible();
    const semPrazo = principal.getByRole('region', { name: 'Sem prazo' });
    await expect(semPrazo.getByText('Preciso parafusar o apoio do banheiro')).toBeVisible();
    expect(await pequenos(page)).toEqual([]);
    expect(await semRolagemDeLado(page)).toBe(true);

    // Duração: abrir as opções e confirmar 1 h30. Tudo continua com 44 px.
    await checklist.getByRole('button', { name: 'Duração: cerca de 1 h' }).click();
    expect(await pequenos(page)).toEqual([]);
    await checklist.getByRole('button', { name: '1 h 30', exact: true }).click();
    await expect(checklist.getByRole('button', { name: 'Duração: 1 h 30' })).toBeFocused();

    // Escolher dia abre o campo de data com 44 px.
    await semPrazo.getByRole('button', { name: 'Escolher dia' }).click();
    await expect(semPrazo.getByLabel(/^Dia para/)).toBeFocused();
    expect(await pequenos(page)).toEqual([]);
    expect(await semRolagemDeLado(page)).toBe(true);
    await semPrazo.getByRole('button', { name: 'Cancelar' }).click();

    // Concluir tem Desfazer.
    await checklist.getByRole('checkbox', { name: /Marcar reunião com a Marina/ }).click();
    await expect(checklist.getByText('1 de 1 feita')).toBeVisible();
    await checklist.getByRole('button', { name: /^Desfazer/ }).click();
    await expect(checklist.getByText('0 de 1 feita')).toBeVisible();
    await expect(checklist.getByRole('checkbox', { name: /Marcar reunião com a Marina/ })).toBeFocused();

    // Sem prazo: Hoje leva a tarefa para a checklist.
    await semPrazo.getByRole('button', { name: 'Hoje' }).click();
    await expect(checklist.getByText('0 de 2 feitas')).toBeVisible();
    await expect(semPrazo.getByText('Nada sem prazo.')).toBeVisible();

    const guardadas = await tarefasGuardadas(page);
    expect(guardadas.map((t) => [t.data, t.feito])).toEqual([
      ['2026-11-05', false],
      ['2026-11-05', false],
    ]);
    expect(guardadas.find((t) => t.titulo.includes('Marina'))).toMatchObject({ duracaoMin: 90, duracaoConfirmada: true });
    expect(erros).toEqual([]);
  });

  test('Esta semana deixa a tarefa na semana, sem dia', async ({ page }) => {
    await dizerAoChat(page, 'Preciso parafusar o apoio do banheiro');
    await page.goto('/central-app/#/sem-prazo');
    const principal = page.getByRole('main');
    await principal.getByRole('button', { name: 'Esta semana' }).click();
    await expect(principal.getByText('Nada sem prazo.')).toBeVisible();
    const [tarefa] = await tarefasGuardadas(page);
    expect(tarefa.semana).toBe('2026-11-02');
    expect(tarefa.data).toBeUndefined();

    await page.goto('/central-app/#/atividades');
    await expect(principal.getByRole('region', { name: 'Esta semana' }).getByText('Preciso parafusar o apoio do banheiro')).toBeVisible();
    expect(await pequenos(page)).toEqual([]);
    expect(await semRolagemDeLado(page)).toBe(true);
  });
});

test.describe('computador, 1280 px', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('Painel do dia: checklist e Sem prazo lado a lado, Atividades agrupada', async ({ page }) => {
    const erros = vigiarErros(page);
    await cadastrarPessoa(page, 'Prof. Souza', 'Doutoramento');
    await dizerAoChat(page, 'Marcar reunião com o Prof. Souza');
    await dizerAoChat(page, 'Revisar parágrafo do relatório 1 nas tarefas do doutoramento');

    await page.goto('/central-app/#/');
    const principal = page.getByRole('main');
    const checklist = principal.getByRole('region', { name: 'Checklist do dia' });
    const semPrazo = principal.getByRole('region', { name: 'Sem prazo' });
    await expect(checklist.getByRole('checkbox')).toHaveCount(1);
    await expect(semPrazo.getByRole('checkbox')).toHaveCount(1);
    const a = (await checklist.boundingBox())!;
    const b = (await semPrazo.boundingBox())!;
    expect(Math.abs(a.y - b.y)).toBeLessThan(2); // lado a lado
    expect(await pequenos(page)).toEqual([]);
    expect(await semRolagemDeLado(page)).toBe(true);

    await page.goto('/central-app/#/atividades');
    await expect(principal.getByRole('region', { name: 'Hoje' })).toBeVisible();
    await expect(principal.getByRole('region', { name: 'Sem prazo' })).toBeVisible();
    expect(await pequenos(page)).toEqual([]);
    expect(erros).toEqual([]);
  });

  test('a pessoa apagada volta com Desfazer', async ({ page }) => {
    await cadastrarPessoa(page, 'Renata', 'Orientações');
    const principal = page.getByRole('main');
    await principal.getByRole('button', { name: 'Apagar Renata' }).click();
    await expect(principal.getByText('Nenhuma pessoa cadastrada.')).toBeVisible();
    await expect(principal.getByRole('button', { name: 'Desfazer' })).toBeFocused();
    await principal.getByRole('button', { name: 'Desfazer' }).click();
    await expect(principal.getByRole('group', { name: 'Orientações' }).getByText('Renata')).toBeVisible();
  });
});

test.describe('virada do dia no navegador', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('com o app aberto na meia-noite, a tarefa de hoje passa para o dia seguinte sem recarregar', async ({ page }) => {
    // Relógio do navegador de verdade, que anda: 23:59:30 de quinta em Lisboa.
    await page.clock.install({ time: new Date('2026-11-05T23:59:30Z') });
    await cadastrarPessoa(page, 'Marina', 'Orientações');
    await page.goto('/central-app/#/chat');
    const campo = page.getByRole('main').getByRole('textbox', { name: 'Escreva ou dite' });
    await campo.fill('Marcar reunião com a Marina');
    await campo.press('Enter');
    await expect(page.getByRole('main').getByRole('article').last().getByRole('button', { name: 'Desfazer' })).toBeVisible();

    await page.goto('/central-app/#/');
    const checklist = page.getByRole('main').getByRole('region', { name: 'Checklist do dia' });
    await expect(checklist.getByRole('checkbox', { name: /Marcar reunião/ })).toBeVisible();
    expect((await tarefasGuardadas(page))[0].data).toBe('2026-11-05');
    await page.evaluate(() => {
      (window as unknown as { __marca: string }).__marca = 'mesma página';
    });

    await page.clock.runFor(40_000); // 00:00:10 de sexta

    await expect.poll(async () => (await tarefasGuardadas(page))[0].data).toBe('2026-11-06');
    await expect(checklist.getByRole('checkbox', { name: /Marcar reunião/ })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __marca?: string }).__marca)).toBe('mesma página');
  });
});
