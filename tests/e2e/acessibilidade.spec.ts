import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { conectar, scriptFalso } from '../apoio/script-e2e';

// Acessibilidade (Tarefa 23), no navegador, com o script de verdade e o Google na memória:
// axe sem erro grave nas vistas principais, foco depois de cada ação, aria-pressed, região
// viva, título por vista e toque de 44 px. Quinta-feira, 2026-11-05, 12:20 em Lisboa.
const AGORA = '2026-11-05T12:20:00+00:00';

type Registro = Record<string, unknown> & { id: string };

/** Grava direto no banco do app (como se tivessem chegado de outro aparelho). */
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

/** Abre o app conectado ao script de mentira, com a Marina, a Renata e algumas tarefas. */
async function abrir(page: Page, hash: string) {
  const script = scriptFalso();
  await script.ligarA(page);
  await page.goto('/central-app/');
  await conectar(page);
  await expect(page.getByRole('navigation', { name: 'Principal' }).first()).toBeVisible();
  await semear(page, 'pessoas', [
    { id: 'p-marina', nome: 'Marina', salaId: 'sala-orientacoes', papel: 'aluna', emails: ['marina@exemplo.invalid'] },
    { id: 'p-renata', nome: 'Renata', salaId: 'sala-orientacoes', papel: 'aluna', emails: ['renata@exemplo.invalid'] },
  ]);
  await semear(page, 'tarefas', [
    tarefa('t1', 'Revisar o capítulo 2 da Marina', { salaId: 'sala-orientacoes', pessoaId: 'p-marina', data: '2026-11-05' }),
    tarefa('t2', 'Marcar reunião com a Renata', { salaId: 'sala-orientacoes', pessoaId: 'p-renata' }),
    tarefa('t3', 'Ler o artigo da Aurora', { salaId: 'sala-doutoramento', data: '2026-11-09' }),
    tarefa('t4', 'Preparar a prova de estatística', { salaId: 'sala-aulas', data: '2026-11-05' }),
  ]);
  await page.goto(`/central-app/${hash}`);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

type Vista = { nome: string; hash: string; pronto: (page: Page) => Promise<void> };

const VISTAS: Vista[] = [
  { nome: 'Painel do dia', hash: '#/', pronto: (p) => expect(p.getByText('Revisar o capítulo 2 da Marina').first()).toBeVisible() },
  { nome: 'Atividades', hash: '#/atividades', pronto: (p) => expect(p.getByText('Ler o artigo da Aurora').first()).toBeVisible() },
  { nome: 'Semana', hash: '#/semana', pronto: (p) => expect(p.getByRole('heading', { level: 1 })).toContainText('semana') },
  { nome: 'Mês', hash: '#/mes', pronto: (p) => expect(p.getByRole('heading', { level: 1 })).toHaveText('Novembro') },
  { nome: 'Ano', hash: '#/ano', pronto: (p) => expect(p.getByRole('heading', { level: 1 })).toHaveText('2026') },
  { nome: 'Salas', hash: '#/salas', pronto: (p) => expect(p.getByRole('list', { name: 'Salas' }).getByRole('listitem')).toHaveCount(7) },
  { nome: 'Uma sala', hash: '#/sala/sala-orientacoes', pronto: (p) => expect(p.getByText('Revisar o capítulo 2 da Marina').first()).toBeVisible() },
  { nome: 'Uma pessoa', hash: '#/pessoa/p-marina', pronto: (p) => expect(p.getByRole('heading', { level: 1 })).toHaveText('Marina') },
  { nome: 'E-mail (Quadro)', hash: '#/quadro', pronto: (p) => expect(p.getByRole('group', { name: 'Filtro do quadro' })).toBeVisible() },
  { nome: 'Chat', hash: '#/chat', pronto: (p) => expect(p.getByRole('heading', { level: 1 })).toHaveText('Chat') },
  { nome: 'Agora', hash: '#/agora', pronto: (p) => expect(p.getByRole('heading', { level: 1 })).toHaveText('Agora') },
  { nome: 'Caixa', hash: '#/caixa', pronto: (p) => expect(p.getByRole('heading', { level: 1 })).toHaveText('Caixa') },
  { nome: 'Cores do Google', hash: '#/cores', pronto: (p) => expect(p.getByRole('heading', { level: 1 })).toHaveText('Cores do Google') },
  { nome: 'Conectar aparelho', hash: '#/conectar', pronto: (p) => expect(p.getByRole('heading', { name: 'Cópia de segurança' })).toBeVisible() },
  { nome: 'IA local', hash: '#/ia', pronto: (p) => expect(p.getByRole('heading', { level: 1 })).toHaveText('IA local') },
];

/** Erros graves do axe, num formato que diz onde olhar. */
async function errosGraves(page: Page): Promise<string[]> {
  const resultado = await new AxeBuilder({ page }).analyze();
  return resultado.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}): ${v.help} -> ${v.nodes.slice(0, 4).map((n) => n.target.join(' ')).join(' | ')}`);
}

/** Todo controle visível com menos de 44 px de lado. */
async function pequenos(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const achados: string[] = [];
    for (const controle of document.querySelectorAll<HTMLElement>('a[href], button, input:not([type=hidden]), select, textarea, summary')) {
      if (controle.closest('.so-leitor, .pular')) continue;
      // Caixa de marcar dentro de um rótulo: o toque vale para o rótulo todo.
      const area = controle instanceof HTMLInputElement && controle.type === 'checkbox' ? (controle.closest('label') ?? controle) : controle;
      const caixa = area.getBoundingClientRect();
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

const focado = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return el ? `${el.tagName.toLowerCase()}|${el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 40) ?? ''}` : 'nada';
  });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(AGORA);
});

for (const [nome, viewport] of [
  ['celular, 390 px', { width: 390, height: 844 }],
  ['computador, 1280 px', { width: 1280, height: 900 }],
] as const) {
  test.describe(nome, () => {
    test.use({ viewport });

    for (const vista of VISTAS) {
      test(`axe: ${vista.nome} sem erro grave e com toque de 44 px`, async ({ page }) => {
        await abrir(page, vista.hash);
        await vista.pronto(page);
        expect(await errosGraves(page)).toEqual([]);
        expect(await pequenos(page)).toEqual([]);
      });
    }

    test('axe: a página da Água (dialog) sem erro grave', async ({ page }) => {
      // No celular o cartão da água fica no Agora; no computador, na coluna da direita.
      await abrir(page, viewport.width < 700 ? '#/agora' : '#/');
      await page.getByRole('button', { name: /Abrir a página da água/ }).first().click();
      await expect(page.getByRole('dialog')).toBeVisible();
      expect(await errosGraves(page)).toEqual([]);
      expect(await pequenos(page)).toEqual([]);
    });

    test('cada vista tem o seu título na aba', async ({ page }) => {
      await abrir(page, '#/');
      const titulos = new Map<string, string>();
      for (const vista of VISTAS) {
        // Só o hash muda: o título da vista anterior continua até a nova vista trocá-lo.
        // Vai por uma página neutra (sem o sufixo) para não ler o título velho.
        await page.goto('about:blank');
        await page.goto(`/central-app/${vista.hash}`);
        await vista.pronto(page);
        await expect.poll(() => page.title()).toMatch(/ · Central de Comando$/);
        const titulo = await page.title();
        expect(titulos.get(titulo), `"${titulo}" já era o título de ${titulos.get(titulo)}`).toBeUndefined();
        titulos.set(titulo, vista.nome);
      }
    });
  });
}

test.describe('computador: foco e anúncios depois de cada ação', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('trocar de página leva o foco ao título da nova página', async ({ page }) => {
    await abrir(page, '#/');
    await page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Atividades' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Atividades' })).toBeFocused();
  });

  test('criar: o foco fica no campo, que esvazia, e a criação é anunciada', async ({ page }) => {
    await abrir(page, '#/');
    const campo = page.getByRole('textbox', { name: 'Nova tarefa para hoje' });
    await campo.fill('Mandar mensagem para a Marina');
    await campo.press('Enter');
    await expect(page.getByText('Mandar mensagem para a Marina').first()).toBeVisible();
    await expect(campo).toBeFocused();
    await expect(campo).toHaveValue('');
    await expect(page.getByRole('status').filter({ hasText: 'Tarefa adicionada: Mandar mensagem para a Marina' })).toBeVisible();
  });

  test('concluir: o foco fica na caixa e o Desfazer aparece', async ({ page }) => {
    await abrir(page, '#/atividades');
    const caixa = page.getByRole('checkbox', { name: 'Ler o artigo da Aurora' });
    await caixa.click();
    await expect(caixa).toHaveAttribute('aria-checked', 'true');
    await expect(caixa).toBeFocused();
    await expect(page.getByRole('button', { name: 'Desfazer: Ler o artigo da Aurora' })).toBeVisible();
  });

  test('editar e apagar: Cancelar volta ao Editar; Apagar leva o foco ao Desfazer, numa região viva', async ({ page }) => {
    await abrir(page, '#/atividades');
    const editar = page.getByRole('button', { name: 'Editar: Ler o artigo da Aurora' });
    await editar.click();
    await expect(page.getByRole('textbox', { name: 'Título' })).toBeFocused();
    await page.getByRole('button', { name: 'Cancelar' }).click();
    await expect(editar).toBeFocused();

    await editar.click();
    await page.getByRole('button', { name: 'Apagar' }).click();
    const aviso = page.getByRole('status').filter({ hasText: 'Tarefa apagada: Ler o artigo da Aurora' });
    await expect(aviso).toBeVisible();
    await expect(aviso.getByRole('button', { name: 'Desfazer' })).toBeFocused();
  });

  test('fechar a página da Água devolve o foco ao botão que a abriu', async ({ page }) => {
    await abrir(page, '#/');
    const abrirAgua = page.getByRole('button', { name: /Abrir a página da água/ }).first();
    const rotulo = await abrirAgua.getAttribute('aria-label');
    await abrirAgua.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    expect(await focado(page)).toBe(`button|${rotulo}`);
  });

  test('os botões que ligam e desligam dizem o estado com aria-pressed', async ({ page }) => {
    await abrir(page, '#/quadro');
    const filtros = page.getByRole('group', { name: 'Filtro do quadro' }).getByRole('button');
    expect(await filtros.count()).toBeGreaterThan(1);
    await filtros.nth(1).click();
    await expect(filtros.nth(1)).toHaveAttribute('aria-pressed', 'true');
    await expect(filtros.first()).toHaveAttribute('aria-pressed', 'false');
    expect(await page.locator('.email-filtro:not([aria-pressed])').count()).toBe(0);
  });
});

test.describe('celular: dias da semana', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('o dia escolhido tem aria-pressed e só um fica marcado', async ({ page }) => {
    await abrir(page, '#/semana');
    const dias = page.getByRole('group', { name: 'Dias da semana' }).getByRole('button');
    await expect(dias).toHaveCount(7);
    await expect(page.locator('.cal-faixa-dia[aria-pressed="true"]')).toHaveCount(1);
    await dias.nth(0).click();
    await expect(dias.nth(0)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.cal-faixa-dia[aria-pressed="true"]')).toHaveCount(1);
  });
});
