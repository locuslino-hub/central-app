import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { conectar, scriptFalso } from '../apoio/script-e2e';

// Vitrine: fotografa as páginas do computador com dados fictícios, para conferir
// o enquadramento (tudo cabe sem rolar?). Só roda com VITRINE=<pasta>:
//   VITRINE=../docs/capturas/x npx playwright test vitrine
// Quarta-feira, 2026-11-11, 07:30 em Lisboa (inverno: UTC+0). Nomes fictícios.
const AGORA = '2026-11-11T07:30:00+00:00';
const PRINCIPAL = 'marina.ficticia@example.com';
const PASTA = process.env.VITRINE;
const LARGURA = Number(process.env.VITRINE_LARGURA ?? 1600);
const ALTURA = Number(process.env.VITRINE_ALTURA ?? 864);

test.skip(!PASTA, 'Só com VITRINE=<pasta>.');
test.use({ viewport: { width: LARGURA, height: ALTURA } });

const TITULOS = [
  'Orientação Marina',
  'Aula de Estatística',
  'Reunião do projeto',
  'Seminário de investigação',
  'Almoço',
  'Leitura do capítulo',
  'Banca da Aurora',
  'Aula do MBA',
];

function semear(script: ReturnType<typeof scriptFalso>) {
  let n = 0;
  const evento = (dia: string, inicio: string, fim: string, titulo: string) =>
    script.agenda.evento(PRINCIPAL, {
      id: `v${n++}`,
      summary: titulo,
      inicio: `${dia}T${inicio}:00+00:00`,
      fim: `${dia}T${fim}:00+00:00`,
    });
  // Semana de 9 a 15/11, cheia de manhã à tarde.
  for (const [i, dia] of ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'].entries()) {
    evento(dia, '08:30', '10:00', TITULOS[i % TITULOS.length]);
    evento(dia, '10:30', '12:00', TITULOS[(i + 2) % TITULOS.length]);
    evento(dia, '12:00', '13:00', 'Almoço');
    evento(dia, '14:00', '15:30', TITULOS[(i + 4) % TITULOS.length]);
    evento(dia, '16:00', '17:30', TITULOS[(i + 6) % TITULOS.length]);
    evento(dia, '19:00', '20:00', 'Aula do MBA');
  }
  // O resto do ano: alguns dias por mês.
  for (let mes = 1; mes <= 12; mes++) {
    for (const d of [3, 8, 14, 19, 22, 27]) {
      const dia = `2026-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      evento(dia, '10:00', '11:00', TITULOS[(mes + d) % TITULOS.length]);
    }
  }
}

async function capturar(page: Page, nome: string) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime as number))
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  await page.waitForTimeout(300);
  mkdirSync(PASTA!, { recursive: true });
  await page.screenshot({ path: join(PASTA!, `${nome}.png`) });
  // Quanto falta para caber: altura rolável da página principal além da janela.
  const sobra = await page.evaluate(() => {
    const main = document.querySelector('main.pagina') as HTMLElement;
    return main.scrollHeight - main.clientHeight;
  });
  console.log(`${nome}: sobra ${sobra}px`);
}

test('vitrine do computador', async ({ page }) => {
  test.setTimeout(180_000);
  await page.clock.setFixedTime(AGORA);
  const script = scriptFalso();
  semear(script);
  await script.ligarA(page);
  await page.goto('/central-app/');
  await conectar(page);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  // Algumas tarefas, para as salas e o Quadro terem o que mostrar.
  const novas: [string, string][] = [
    ['sala-orientacoes', 'Enviar a correção da tese para a Marina'],
    ['sala-orientacoes', 'Ler o capítulo 2 da Aurora'],
    ['sala-casa', 'Parafusar o apoio do banheiro'],
    ['sala-casa', 'Trocar a lâmpada da cozinha'],
    ['sala-doutoramento', 'Revisar parágrafo do relatório 1'],
    ['sala-mba', 'Entregar o trabalho de Finanças'],
  ];
  for (const [sala, titulo] of novas) {
    await page.goto(`/central-app/#/sala/${sala}`);
    const campo = page.getByRole('textbox', { name: /^Nova tarefa em/ });
    await campo.fill(titulo);
    await campo.press('Enter');
    await expect(page.getByText(titulo).first()).toBeVisible();
  }

  const paginas: [string, string][] = [
    ['painel', '#/'],
    ['semana', '#/semana'],
    ['mes', '#/mes'],
    ['ano', '#/ano'],
    ['salas', '#/salas'],
    ['sala-orientacoes', '#/sala/sala-orientacoes'],
    ['sala-casa', '#/sala/sala-casa'],
    ['caixa', '#/caixa'],
    ['quadro', '#/quadro'],
    ['atividades', '#/atividades'],
  ];
  for (const [nome, hash] of paginas) {
    await page.goto(`/central-app/${hash}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.waitForTimeout(800);
    await capturar(page, nome);
  }
});
