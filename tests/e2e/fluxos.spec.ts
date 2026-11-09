import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { conectar, scriptFalso } from '../apoio/script-e2e';
import { MARCA_DA_VERSAO, servidorDeVersoes } from '../apoio/servidor-de-versoes';

// Tarefa 22: o app como o dono o usa, de ponta a ponta, com o script do Google falso
// (o código de verdade do script, com Drive, Agenda e Gmail na memória).
// Quinta-feira, 2026-11-05, 12:20 em Lisboa (inverno: UTC+0). Nomes fictícios.
const AGORA = '2026-11-05T12:20:00+00:00';
const VERSAO_LITERTLM = (createRequire(import.meta.url)('@litert-lm/core/package.json') as { version: string }).version;

const TELAS = [
  ['celular, 390 px', { width: 390, height: 844 }],
  ['tablet, 800 px', { width: 800, height: 1024 }],
  ['computador, 1280 px', { width: 1280, height: 900 }],
] as const;

function vigiarErros(page: Page) {
  const erros: string[] = [];
  page.on('pageerror', (erro) => erros.push(`pageerror: ${erro.message}`));
  page.on('console', (mensagem) => {
    // Falha de rede é o esperado quando o teste tira a internet.
    if (mensagem.type() === 'error' && !/Failed to load resource|ERR_INTERNET_DISCONNECTED|ERR_FAILED/.test(mensagem.text())) {
      erros.push(`console: ${mensagem.text()}`);
    }
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
          `${controle.getAttribute('aria-label') ?? controle.textContent?.trim().slice(0, 30) ?? controle.outerHTML.slice(0, 60)} (${Math.round(caixa.width)}x${Math.round(caixa.height)})`,
        );
      }
    }
    return achados;
  });
}

const semRolagemDeLado = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

/** Abre o app (no endereço dado) já conectado ao script falso. */
async function abrirConectado(page: Page, endereco = '/central-app/', hash = '') {
  await page.goto(endereco);
  await conectar(page);
  await page.goto(`${endereco}${hash}`);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

const estadoDaSincronia = (page: Page) => page.locator('.sync[data-estado]').first();

/** O que há no banco do app (o guardado, não o que está na tela). */
function guardados(page: Page, loja: string) {
  return page.evaluate(
    (nome) =>
      new Promise<Record<string, unknown>[]>((resolver, rejeitar) => {
        const abrir = indexedDB.open('central-dados');
        abrir.onerror = () => rejeitar(abrir.error);
        abrir.onsuccess = () => {
          const pedido = abrir.result.transaction(nome).objectStore(nome).getAll();
          pedido.onsuccess = () => resolver(pedido.result.filter((r) => !r.apagado));
          pedido.onerror = () => rejeitar(pedido.error);
        };
      }),
    loja,
  );
}

for (const [nome, janela] of TELAS) {
  test.describe(nome, () => {
    test.use({ viewport: janela });

    test.beforeEach(async ({ page }) => {
      await page.clock.setFixedTime(AGORA);
    });

    test('cria uma tarefa sem internet, e ela vai para o script quando a internet volta', async ({ page, context }) => {
      const erros = vigiarErros(page);
      const script = scriptFalso();
      await script.ligarA(page);
      await abrirConectado(page);
      await expect(estadoDaSincronia(page)).toHaveAttribute('data-estado', 'atualizado');

      // A internet cai: o app avisa, mas continua funcionando.
      script.cair();
      await context.setOffline(true);
      const checklist = page.getByRole('main').getByRole('region', { name: 'Checklist do dia' });
      await checklist.getByLabel('Nova tarefa para hoje').fill('Ligar para a Renata');
      await checklist.getByRole('button', { name: 'Adicionar' }).click();
      await expect(checklist.getByRole('checkbox', { name: 'Ligar para a Renata' })).toBeVisible();
      await expect(estadoDaSincronia(page)).toHaveAttribute('data-estado', /por-enviar|sem-internet/, { timeout: 15_000 });
      expect(script.guardado()).not.toContain('Ligar para a Renata');
      expect(await pequenos(page)).toEqual([]);
      expect(await semRolagemDeLado(page)).toBe(true);

      // A internet volta: a tarefa sai da fila e chega ao Drive.
      script.voltar();
      await context.setOffline(false);
      await expect(estadoDaSincronia(page)).toHaveAttribute('data-estado', 'atualizado', { timeout: 15_000 });
      expect(script.guardado()).toContain('Ligar para a Renata');
      await expect(checklist.getByRole('checkbox', { name: 'Ligar para a Renata' })).toBeVisible();
      expect(erros).toEqual([]);
    });

    test('fluxo da Marina: marcar reunião vira tarefa diária; ao concluir pede dia e hora e cria o compromisso; a página dela mostra tudo', async ({ page }) => {
      const erros = vigiarErros(page);
      const script = scriptFalso();
      await script.ligarA(page);
      await abrirConectado(page, '/central-app/', '#/salas');
      const principal = page.getByRole('main');

      // A Marina é aluna de Orientações (cadastro na tela Salas); o e-mail dela é ensinado ao app.
      await principal.getByLabel('Nome', { exact: true }).fill('Marina');
      await principal.getByLabel('Sala', { exact: true }).selectOption({ label: 'Orientações' });
      await principal.getByLabel('Papel (opcional)').fill('aluna');
      await principal.getByRole('button', { name: 'Cadastrar pessoa' }).click();
      await expect(principal.getByRole('list').getByText('Marina')).toBeVisible();
      await page.evaluate(
        () =>
          new Promise<void>((resolver, rejeitar) => {
            const abrir = indexedDB.open('central-dados');
            abrir.onerror = () => rejeitar(abrir.error);
            abrir.onsuccess = () => {
              const escrita = abrir.result.transaction('pessoas', 'readwrite');
              const loja = escrita.objectStore('pessoas');
              const todas = loja.getAll();
              todas.onsuccess = () => {
                for (const p of todas.result) if (p.nome === 'Marina') loja.put({ ...p, emails: ['marina@exemplo.invalid'], atualizadoEm: Date.now() + 1 });
              };
              escrita.oncomplete = () => resolver();
            };
          }),
      );

      // Chat: "Marcar reunião com a Marina" vira tarefa diária (sem data) na sala dela.
      await page.goto('/central-app/#/chat');
      const campo = principal.getByRole('textbox', { name: 'Escreva ou dite' });
      await campo.fill('Marcar reunião com a Marina');
      await campo.press('Enter');
      await expect(principal.getByRole('article').last().getByRole('button', { name: 'Desfazer' })).toBeVisible();
      const marcar = (await guardados(page, 'tarefas')).find((t) => t.titulo === 'Marcar reunião com a Marina');
      expect(marcar).toMatchObject({ marcar: true, salaId: 'sala-orientacoes' });
      // Sem dia escolhido, fica em hoje e a virada do dia a leva para o dia seguinte até ser concluída.
      expect(marcar?.data).toBe('2026-11-05');

      // Painel: a tarefa está na Checklist; concluir abre a caixa do dia e da hora.
      await page.goto('/central-app/#/');
      const checklist = principal.getByRole('region', { name: 'Checklist do dia' });
      const tarefa = checklist.getByRole('checkbox', { name: 'Marcar reunião com a Marina' });
      await tarefa.click();
      const caixa = page.getByRole('dialog', { name: 'Quando ficou marcado?' });
      await expect(caixa).toBeVisible();
      await expect(caixa.getByLabel('Dia')).toHaveValue('2026-11-05');
      await caixa.getByLabel('Início').fill('15:30');
      await expect(caixa.getByLabel('Fim')).toHaveValue('16:30');
      expect(await pequenos(page)).toEqual([]);
      await caixa.getByRole('button', { name: 'Colocar na agenda' }).click();
      // Com internet o compromisso entra na agenda na hora e a caixa fecha sozinha.
      await expect(caixa).toBeHidden();
      await expect(tarefa).toHaveAttribute('aria-checked', 'true');

      // O compromisso está no Google Agenda (falso) e na agenda de hoje.
      expect(script.pedidos).toContain('criarEvento');
      const criado = [...script.agenda.agendas.values()].flatMap((a) => [...a.eventos.values()]).find((e) => e.summary === 'Reunião com a Marina');
      expect(criado).toBeTruthy();
      const agendaDeHoje = principal.getByRole('region', { name: 'Agenda de hoje' });
      await expect(agendaDeHoje.getByText('Reunião com a Marina').first()).toBeVisible({ timeout: 15_000 });

      // A tarefa concluída foi espelhada no Google Tarefas (lista Central), como feita.
      await expect
        .poll(() => script.tarefasGoogle.vivas().map((t) => [t.title, t.status]), { timeout: 15_000 })
        .toContainEqual(['Marcar reunião com a Marina', 'completed']);

      // Compromisso feito: a caixa marca na Central e o Google Agenda ganha "✓ " no título.
      const reuniao = agendaDeHoje.getByRole('checkbox', { name: 'Reunião com a Marina' });
      await reuniao.click();
      await expect(reuniao).toHaveAttribute('aria-checked', 'true');
      await expect.poll(() => criado?.summary, { timeout: 15_000 }).toBe('✓ Reunião com a Marina');

      // A página da Marina: pendências, e-mails e documentos.
      await page.goto('/central-app/#/salas');
      await principal.getByRole('region', { name: 'Pessoas' }).getByRole('link', { name: /Marina/ }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Marina' })).toBeVisible();
      await principal.getByLabel('Nova tarefa com Marina').fill('Revisar o capítulo 2');
      await principal.getByRole('region', { name: 'Pendências' }).getByRole('button', { name: 'Adicionar' }).click();
      const pendencia = principal.getByRole('region', { name: 'Pendências' }).getByRole('checkbox', { name: 'Revisar o capítulo 2' });
      await expect(pendencia).toBeVisible();
      await pendencia.click();
      await expect(pendencia).toHaveAttribute('aria-checked', 'true');
      await expect
        .poll(() => script.tarefasGoogle.vivas().map((t) => [t.title, t.status]), { timeout: 15_000 })
        .toContainEqual(['Revisar o capítulo 2', 'completed']);
      await expect(principal.getByRole('region', { name: 'E-mails' }).getByText('Capítulo 2 revisado')).toBeVisible({ timeout: 15_000 });
      await expect(principal.getByRole('region', { name: 'Documentos' })).toBeVisible();
      expect(await pequenos(page)).toEqual([]);
      expect(await semRolagemDeLado(page)).toBe(true);
      expect(erros).toEqual([]);
    });

    test('mudança da mesma tarefa em dois aparelhos, um offline: vale a mais recente, nada some e o app avisa', async ({ browser, page }) => {
      const erros = vigiarErros(page);
      const script = scriptFalso();
      // Aparelho A: o `page` do teste.
      const linhaA = await script.ligarA(page);
      await abrirConectado(page);
      const checklistA = page.getByRole('main').getByRole('region', { name: 'Checklist do dia' });
      await checklistA.getByLabel('Nova tarefa para hoje').fill('Ligar para a Renata');
      await checklistA.getByRole('button', { name: 'Adicionar' }).click();
      await expect(estadoDaSincronia(page)).toHaveAttribute('data-estado', 'atualizado', { timeout: 15_000 });
      await expect.poll(script.guardado, { timeout: 15_000 }).toContain('Ligar para a Renata');

      // Aparelho B: outro contexto do navegador, com o relógio meia hora adiante.
      const contextoB = await browser.newContext({ viewport: janela, timezoneId: 'Europe/Lisbon', locale: 'pt-BR', serviceWorkers: 'block' });
      try {
        const b = await contextoB.newPage();
        await b.clock.setFixedTime('2026-11-05T12:50:00+00:00');
        await script.ligarA(b);
        await abrirConectado(b);
        const checklistB = b.getByRole('main').getByRole('region', { name: 'Checklist do dia' });
        await expect(checklistB.getByRole('checkbox', { name: 'Ligar para a Renata' })).toBeVisible({ timeout: 15_000 });

        // A fica sem internet e edita a tarefa (12:25).
        linhaA.cair();
        await page.context().setOffline(true);
        await page.clock.setFixedTime('2026-11-05T12:25:00+00:00');
        await checklistA.getByRole('button', { name: 'Editar: Ligar para a Renata' }).click();
        await checklistA.getByLabel('Título').fill('Ligar para a Renata hoje');
        await checklistA.getByRole('button', { name: 'Salvar' }).click();
        await expect(checklistA.getByRole('checkbox', { name: 'Ligar para a Renata hoje' })).toBeVisible();

        // B (com internet, 12:50) edita a mesma tarefa de outro jeito, e chega ao script.
        await checklistB.getByRole('button', { name: 'Editar: Ligar para a Renata' }).click();
        await checklistB.getByLabel('Título').fill('Ligar para a Renata e confirmar a prova');
        await checklistB.getByRole('button', { name: 'Salvar' }).click();
        await expect.poll(script.guardado, { timeout: 15_000 }).toContain('confirmar a prova');

        // A volta: vale a edição mais recente (a de B), e o aviso mostra a que ficou de fora.
        linhaA.voltar();
        await page.context().setOffline(false);
        await expect(checklistA.getByRole('checkbox', { name: 'Ligar para a Renata e confirmar a prova' })).toBeVisible({ timeout: 20_000 });
        const avisos = page.getByRole('region', { name: 'Avisos de mudanças' });
        await expect(avisos).toContainText('Duas mudanças na mesma tarefa; ficou a mais recente. A outra era: Ligar para a Renata hoje');
        expect(await pequenos(page)).toEqual([]);
        expect(await semRolagemDeLado(page)).toBe(true);

        // Entendi tira o aviso; a tarefa continua.
        await avisos.getByRole('button', { name: /^Entendi/ }).click();
        await expect(avisos).toHaveCount(0);
        await expect(checklistA.getByRole('checkbox', { name: 'Ligar para a Renata e confirmar a prova' })).toBeVisible();
      } finally {
        await contextoB.close();
      }
      expect(erros).toEqual([]);
    });
  });
}

// ---- Offline e instalação (com o service worker ligado) ----

test.describe('offline: o app guardado no aparelho', () => {
  test.use({ serviceWorkers: 'allow' });

  for (const [nome, janela] of TELAS) {
    test(`${nome}: abre sem internet com a última versão, sem prender numa versão velha`, async ({ page, context }) => {
      const erros = vigiarErros(page);
      await page.clock.setFixedTime(AGORA);
      const script = scriptFalso();
      await script.ligarA(page);
      await page.setViewportSize(janela);
      const servidor = await servidorDeVersoes();
      try {
        // Primeira abertura (versão 1): o service worker guarda o app e passa a controlar a página.
        await page.goto(servidor.url);
        await conectar(page);
        await page.reload();
        await expect(page.getByRole('heading', { level: 1, name: 'Painel do dia' })).toBeVisible();
        await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
        await expect(page.locator(`meta[name="${MARCA_DA_VERSAO}"]`)).toHaveCount(0);
        await expect(page.getByText('Versão nova do app.')).toHaveCount(0);

        // O dono começa a escrever uma tarefa.
        const campo = page.getByRole('main').getByRole('region', { name: 'Checklist do dia' }).getByLabel('Nova tarefa para hoje');
        await campo.fill('Rascunho que não pode sumir');

        // O app é publicado de novo (versão 2): o aparelho baixa em segundo plano.
        servidor.publicarVersao2();
        await page.evaluate(async () => {
          const registro = await navigator.serviceWorker.getRegistration();
          await registro?.update();
        });
        // Nada recarrega sozinho: o texto no campo fica, e o app só avisa.
        await expect(page.getByText('Versão nova do app.')).toBeVisible({ timeout: 15_000 });
        await expect(campo).toHaveValue('Rascunho que não pode sumir');
        await expect(page.locator(`meta[name="${MARCA_DA_VERSAO}"]`)).toHaveCount(0);
        const atualizar = page.getByRole('button', { name: 'Atualizar', exact: true });
        expect((await atualizar.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
        expect(await semRolagemDeLado(page)).toBe(true);

        // Sem internet, a abertura traz a versão 2 (a última baixada), na tela inicial e em outra página.
        // O servidor do app também cai (503): o que abrir daqui em diante veio do aparelho, não da rede.
        script.cair();
        servidor.foraDoAr();
        await context.setOffline(true);
        await page.reload();
        await expect(page.getByRole('heading', { level: 1, name: 'Painel do dia' })).toBeVisible();
        await expect(page.locator(`meta[name="${MARCA_DA_VERSAO}"]`)).toHaveAttribute('content', '2');
        await expect(page.getByText('Versão nova do app.')).toHaveCount(0); // já está na nova
        await page.goto(`${servidor.url}#/semana`);
        await page.reload();
        await expect(page.getByRole('heading', { level: 1, name: 'Esta semana' })).toBeVisible();
        await expect(estadoDaSincronia(page)).toHaveAttribute('data-estado', /sem-internet|por-enviar/, { timeout: 15_000 });
        // A tarefa criada sem internet continua funcionando com o app fechado e aberto de novo.
        await page.goto(`${servidor.url}#/`);
        await page.reload();
        const checklist = page.getByRole('main').getByRole('region', { name: 'Checklist do dia' });
        await checklist.getByLabel('Nova tarefa para hoje').fill('Ler o artigo da Aurora');
        await checklist.getByRole('button', { name: 'Adicionar' }).click();
        await expect(checklist.getByRole('checkbox', { name: 'Ler o artigo da Aurora' })).toBeVisible();
        await page.reload();
        await expect(page.getByRole('main').getByRole('region', { name: 'Checklist do dia' }).getByRole('checkbox', { name: 'Ler o artigo da Aurora' })).toBeVisible();
        expect(await semRolagemDeLado(page)).toBe(true);
        expect(erros).toEqual([]);

        // A internet volta: a tarefa feita offline chega ao script.
        script.voltar();
        await context.setOffline(false);
        await expect.poll(script.guardado, { timeout: 20_000 }).toContain('Ler o artigo da Aurora');
      } finally {
        await servidor.parar();
      }
    });
  }

  test('o service worker guarda só o app: nem a IA (litertlm/) nem o script do Google passam por ele', async ({ page, context }) => {
    const script = scriptFalso();
    await script.ligarA(page);
    await page.goto('/central-app/');
    await conectar(page);
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await expect(estadoDaSincronia(page)).toHaveAttribute('data-estado', 'atualizado', { timeout: 15_000 });
    expect(script.pedidos.length).toBeGreaterThan(0); // o script foi chamado pela rede, com o service worker ativo

    const guardado = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const nome of await caches.keys()) for (const pedido of await (await caches.open(nome)).keys()) urls.push(pedido.url);
      return urls;
    });
    expect(guardado.length).toBeGreaterThan(5);
    expect(guardado.some((u) => /\/central-app\/index\.html(\?|$)/.test(u))).toBe(true);
    expect(guardado.some((u) => /\/assets\/index-.*\.js$/.test(u))).toBe(true);
    expect(guardado.filter((u) => /litertlm|script\.google|teste-/.test(u))).toEqual([]);

    // O próprio service worker não tem regra de cache de rede: só a lista de arquivos do app.
    const codigoDoSw = await (await page.request.get('/central-app/sw.js')).text();
    expect(codigoDoSw).not.toMatch(/script\.google|litertlm|runtimeCaching|StaleWhileRevalidate|NetworkFirst|CacheFirst/);

    // O wasm da IA continua indo à rede (sem internet ele não vem do cache do app).
    await context.setOffline(true);
    const resposta = await page.evaluate(async (versao) => {
      try {
        return (await fetch(`/central-app/litertlm/${versao}/litertlm_wasm_internal.js`)).status;
      } catch {
        return 'rede';
      }
    }, VERSAO_LITERTLM);
    expect(resposta).toBe('rede');
  });

  test('instalação pelo navegador: manifesto válido, service worker ativo e critérios de instalável', async ({ page, context }) => {
    await page.goto('/central-app/');
    await expect(page.getByRole('heading', { level: 1, name: 'Painel do dia' })).toBeVisible();
    const registro = await page.evaluate(async () => {
      const r = await navigator.serviceWorker.ready;
      // "Pronto" já tem worker ativo, mas ele ainda pode estar terminando de assumir.
      for (let i = 0; i < 50 && r.active?.state !== 'activated'; i++) await new Promise((ok) => setTimeout(ok, 100));
      return { estado: r.active?.state, escopo: r.scope };
    });
    expect(registro.estado).toBe('activated');
    expect(registro.escopo).toBe('http://localhost:4173/central-app/');

    // O manifesto está ligado à página e é válido.
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/central-app/manifest.webmanifest');
    const manifesto = await (await page.request.get('/central-app/manifest.webmanifest')).json();
    expect(manifesto).toMatchObject({
      name: 'Central de Comando',
      short_name: 'Central',
      lang: 'pt-BR',
      start_url: '/central-app/',
      scope: '/central-app/',
      display: 'standalone',
      background_color: '#e8eae3',
      theme_color: '#e8eae3',
    });
    expect(manifesto.start_url.startsWith(manifesto.scope)).toBe(true);
    const icones = manifesto.icons as { src: string; sizes: string; type: string; purpose: string }[];
    for (const [lado, finalidade] of [['192x192', 'any'], ['512x512', 'any'], ['512x512', 'maskable']] as const) {
      const icone = icones.find((i) => i.sizes === lado && i.purpose === finalidade);
      expect(icone, `${lado} ${finalidade}`).toBeTruthy();
      const resposta = await page.request.get(icone!.src);
      expect(resposta.status()).toBe(200);
      expect(resposta.headers()['content-type']).toBe('image/png');
      const png = await resposta.body();
      expect(png.subarray(1, 4).toString()).toBe('PNG');
      expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`).toBe(lado); // tamanho declarado = tamanho real
    }
    expect((await page.request.get('/central-app/icones/apple-touch-icon.png')).status()).toBe(200);
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#e8eae3');

    // O próprio Chromium diz se o app é instalável (manifesto, ícones, service worker, HTTPS/localhost).
    const cdp = await context.newCDPSession(page);
    const lido = await cdp.send('Page.getAppManifest');
    expect(lido.errors).toEqual([]);
    const instalavel = await cdp.send('Page.getInstallabilityErrors');
    expect(instalavel.installabilityErrors).toEqual([]);
  });
});
