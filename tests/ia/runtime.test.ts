import { describe, expect, it, vi } from 'vitest';
import { nomeDaVariante, runtimeGuardado, type Armazem } from '../../src/ia/runtime';

const PASTA = 'https://exemplo.test/central-app/litertlm/0.19.0/';
const VARIANTE = 'litertlm_wasm_internal';

/** Cache Storage na memória. */
function armazemFalso(): Armazem & { caixas: Map<string, Map<string, Response>> } {
  const caixas = new Map<string, Map<string, Response>>();
  return {
    caixas,
    async open(nome) {
      const caixa = caixas.get(nome) ?? new Map<string, Response>();
      caixas.set(nome, caixa);
      return {
        match: async (url: string) => caixa.get(url)?.clone(),
        put: async (url: string, resposta: Response) => {
          caixa.set(url, resposta);
        },
      };
    },
    keys: async () => [...caixas.keys()],
    delete: async (nome) => caixas.delete(nome),
  };
}

function montar({ status = 200 } = {}) {
  const armazem = armazemFalso();
  const baixar = vi.fn(async (url: string) => new Response(`conteúdo de ${url.split('/').at(-1)}`, { status }));
  const urls: Blob[] = [];
  const revogadas: string[] = [];
  const runtime = runtimeGuardado({
    armazem,
    versao: '0.19.0',
    variante: async () => VARIANTE,
    baixar,
    criarUrl: (blob) => {
      urls.push(blob);
      return `blob:local/${urls.length}`;
    },
    revogarUrl: (url) => revogadas.push(url),
  });
  return { armazem, baixar, runtime, urls, revogadas };
}

describe('variante do motor', () => {
  it('escolhe o mesmo arquivo que o pacote escolheria', () => {
    expect(nomeDaVariante(true, true)).toBe('litertlm_wasm_internal');
    expect(nomeDaVariante(true, false)).toBe('litertlm_wasm_asyncify_internal');
    expect(nomeDaVariante(false, true)).toBe('litertlm_wasm_compat_internal');
    expect(nomeDaVariante(false, false)).toBe('litertlm_wasm_compat_asyncify_internal');
  });
});

describe('arquivos do motor guardados no aparelho', () => {
  it('guardar baixa o .js e o .wasm da variante deste navegador para o armazenamento da versão', async () => {
    const { armazem, baixar, runtime } = montar();
    await runtime.guardar(PASTA);
    expect(baixar.mock.calls.map(([url]) => url)).toEqual([`${PASTA}${VARIANTE}.js`, `${PASTA}${VARIANTE}.wasm`]);
    expect([...armazem.caixas.keys()]).toEqual(['litertlm-0.19.0']);
    expect([...armazem.caixas.get('litertlm-0.19.0')!.keys()]).toEqual([`${PASTA}${VARIANTE}.js`, `${PASTA}${VARIANTE}.wasm`]);
  });

  it('já guardados, guardar não usa a rede', async () => {
    const { baixar, runtime } = montar();
    await runtime.guardar(PASTA);
    baixar.mockClear();
    await runtime.guardar(PASTA);
    expect(baixar).not.toHaveBeenCalled();
  });

  it('guardar baixa só o que falta', async () => {
    const { armazem, baixar, runtime } = montar();
    await runtime.guardar(PASTA);
    armazem.caixas.get('litertlm-0.19.0')!.delete(`${PASTA}${VARIANTE}.wasm`);
    baixar.mockClear();
    await runtime.guardar(PASTA);
    expect(baixar.mock.calls.map(([url]) => url)).toEqual([`${PASTA}${VARIANTE}.wasm`]);
  });

  it('resposta de erro do servidor não é guardada e guardar falha', async () => {
    const { armazem, runtime } = montar({ status: 404 });
    await expect(runtime.guardar(PASTA)).rejects.toThrow(/404/);
    expect(armazem.caixas.get('litertlm-0.19.0')?.size ?? 0).toBe(0);
  });

  it('guardar apaga os arquivos de versões velhas do motor, e só eles', async () => {
    const { armazem, runtime } = montar();
    await armazem.open('litertlm-0.18.0');
    await armazem.open('workbox-precache-v2-https://exemplo.test/central-app/');
    await runtime.guardar(PASTA);
    expect([...armazem.caixas.keys()].sort()).toEqual(['litertlm-0.19.0', 'workbox-precache-v2-https://exemplo.test/central-app/']);
  });

  it('abrir devolve endereços locais dos arquivos guardados, sem rede', async () => {
    const { baixar, runtime, urls } = montar();
    await runtime.guardar(PASTA);
    baixar.mockClear();
    const arquivos = await runtime.abrir(PASTA);
    expect(baixar).not.toHaveBeenCalled();
    // O carregador do pacote só aceita endereço que termina em `.js`: o nome vai depois do `#`.
    expect(arquivos.js).toBe(`blob:local/1#${VARIANTE}.js`);
    expect(arquivos.wasm).toBe('blob:local/2');
    expect(urls.map((b) => b.type)).toEqual(['text/javascript', 'application/wasm']);
    expect(await urls[0].text()).toBe(`conteúdo de ${VARIANTE}.js`);
    expect(await urls[1].text()).toBe(`conteúdo de ${VARIANTE}.wasm`);
  });

  it('liberar solta os endereços locais', async () => {
    const { runtime, revogadas } = montar();
    await runtime.guardar(PASTA);
    (await runtime.abrir(PASTA)).liberar();
    expect(revogadas).toEqual(['blob:local/1', 'blob:local/2']);
  });

  it('abrir sem os arquivos guardados falha', async () => {
    const { runtime } = montar();
    await expect(runtime.abrir(PASTA)).rejects.toThrow(/não estão guardados/);
  });

  it('apagar tira os arquivos do motor (de qualquer versão) e mais nada', async () => {
    const { armazem, runtime } = montar();
    await runtime.guardar(PASTA);
    await armazem.open('litertlm-0.18.0');
    await armazem.open('workbox-precache-v2-https://exemplo.test/central-app/');
    await runtime.apagar();
    expect([...armazem.caixas.keys()]).toEqual(['workbox-precache-v2-https://exemplo.test/central-app/']);
  });
});
