import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { CODIGO_DO_APARELHO, conectar, scriptFalso } from '../apoio/script-e2e';

// Cópia de segurança (Tarefa 23): baixar todos os dados num arquivo e restaurar a partir dele.
// Quinta-feira, 2026-11-05, 12:20 em Lisboa (inverno: UTC+0).
const AGORA = '2026-11-05T12:20:00+00:00';

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(AGORA);
});

type Registro = Record<string, unknown> & { id: string };

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

async function abrirConectar(page: Page) {
  const script = scriptFalso();
  await script.ligarA(page);
  await page.goto('/central-app/');
  await conectar(page);
  await expect(page.getByRole('navigation', { name: 'Principal' }).first()).toBeVisible();
  await semear(page, 'pessoas', [{ id: 'p-marina', nome: 'Marina', salaId: 'sala-orientacoes', papel: 'aluna' }]);
  await semear(page, 'tarefas', [
    {
      id: 't1',
      titulo: 'Revisar o capítulo 2 da Marina',
      salaId: 'sala-orientacoes',
      pessoaId: 'p-marina',
      data: '2026-11-05',
      duracaoMin: 60,
      duracaoConfirmada: false,
      feito: false,
      fixada: false,
      marcar: false,
    },
  ]);
  await semear(page, 'agua', [{ id: 'a1', data: '2026-11-05', hora: '12:10', ml: 250 }]);
  await page.goto('/central-app/#/conectar');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Cópia de segurança' })).toBeVisible();
}

for (const [nome, viewport] of [
  ['celular, 390 px', { width: 390, height: 844 }],
  ['computador, 1280 px', { width: 1280, height: 900 }],
] as const) {
  test.describe(nome, () => {
    test.use({ viewport });

    test('baixa um arquivo com todas as coleções, sem o código do aparelho', async ({ page }) => {
      await abrirConectar(page);
      const [arquivo] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: 'Baixar cópia dos dados' }).click(),
      ]);
      expect(arquivo.suggestedFilename()).toBe('central-copia-2026-11-05.json');
      const texto = readFileSync((await arquivo.path())!, 'utf8');
      const copia = JSON.parse(texto);

      expect(copia.formato).toBe('central-de-comando-copia-1');
      expect(Object.keys(copia.colecoes).sort()).toEqual(
        [
          'agua',
          'config',
          'coresDasSalas',
          'documentos',
          'estadosEmail',
          'eventosFeitos',
          'paginas',
          'palavras',
          'pessoas',
          'rascunhos',
          'salas',
          'tarefas',
        ].sort(),
      );
      expect(copia.colecoes.salas).toHaveLength(7);
      expect(copia.colecoes.tarefas.map((t: { titulo: string }) => t.titulo)).toEqual(['Revisar o capítulo 2 da Marina']);
      expect(copia.colecoes.pessoas.map((p: { nome: string }) => p.nome)).toEqual(['Marina']);
      expect(copia.colecoes.agua).toHaveLength(1);
      expect(texto).not.toContain(CODIGO_DO_APARELHO);
      expect(texto).not.toContain('script.google.com');

      await expect(page.getByRole('status').filter({ hasText: 'Cópia baixada: central-copia-2026-11-05.json' })).toBeVisible();
    });

    test('restaura a partir da cópia baixada: a tarefa apagada volta', async ({ page }, info) => {
      await abrirConectar(page);
      const [arquivo] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: 'Baixar cópia dos dados' }).click(),
      ]);
      const caminho = info.outputPath('copia.json');
      await arquivo.saveAs(caminho);

      // Apaga a tarefa no app, como o dono faria.
      await page.goto('/central-app/#/atividades');
      await page.getByRole('button', { name: 'Editar: Revisar o capítulo 2 da Marina' }).click();
      await page.getByRole('button', { name: 'Apagar' }).click();
      await expect(page.getByRole('checkbox', { name: 'Revisar o capítulo 2 da Marina' })).toHaveCount(0);

      await page.goto('/central-app/#/conectar');
      await page.getByLabel('Restaurar a partir de uma cópia').setInputFiles(caminho);
      await expect(page.getByRole('status').filter({ hasText: 'Cópia restaurada' })).toContainText('itens devolvidos');

      await page.goto('/central-app/#/atividades');
      await expect(page.getByRole('checkbox', { name: 'Revisar o capítulo 2 da Marina' })).toBeVisible();
    });
  });
}
