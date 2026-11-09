import { act, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONFERIR_ATUALIZACAO_MS, esquecerNovaVersao, novaVersaoPronta, registrarServiceWorker } from '../src/pwa';
import { NovaVersao } from '../src/ui/NovaVersao';

/** Um navegador de mentira: só o que o registro usa. */
function navegadorFalso({ controlador = false, falha = false, ativo = false } = {}) {
  const ouvintes = new Map<string, Set<() => void>>();
  const atualizar = vi.fn(async () => {});
  const registrar = vi.fn(async (_endereco: string, _opcoes: { scope: string }) => {
    if (falha) throw new Error('bloqueado');
    return { update: atualizar, active: ativo ? {} : null };
  });
  const sw = {
    controller: controlador ? {} : null,
    register: registrar,
    addEventListener: (tipo: string, f: () => void) => (ouvintes.get(tipo) ?? ouvintes.set(tipo, new Set()).get(tipo)!).add(f),
    removeEventListener: (tipo: string, f: () => void) => ouvintes.get(tipo)?.delete(f),
  };
  const janela = new EventTarget() as unknown as Window;
  Object.assign(janela, { navigator: { serviceWorker: sw }, document: Object.assign(new EventTarget(), { readyState: 'complete', visibilityState: 'visible' }) });
  return {
    janela,
    sw,
    registrar,
    atualizar,
    trocarControlador() {
      sw.controller = {};
      ouvintes.get('controllerchange')?.forEach((f) => f());
    },
  };
}

afterEach(() => {
  esquecerNovaVersao();
  vi.useRealTimers();
});

describe('registrarServiceWorker', () => {
  it('registra o service worker no escopo do app, depois do carregamento', async () => {
    const n = navegadorFalso();
    (n.janela.document as unknown as { readyState: string }).readyState = 'loading';
    const parar = registrarServiceWorker({ endereco: '/central-app/sw.js', escopo: '/central-app/', janela: n.janela });
    expect(n.registrar).not.toHaveBeenCalled();
    n.janela.dispatchEvent(new Event('load'));
    expect(n.registrar).toHaveBeenCalledWith('/central-app/sw.js', { scope: '/central-app/' });
    parar();
  });

  it('sem service worker no navegador, não faz nada e não quebra', () => {
    const janela = { navigator: {} } as unknown as Window;
    expect(() => registrarServiceWorker({ janela })()).not.toThrow();
  });

  it('registro recusado (modo privado, bloqueio) não lança erro', async () => {
    const n = navegadorFalso({ falha: true });
    const parar = registrarServiceWorker({ janela: n.janela });
    await Promise.resolve();
    await Promise.resolve();
    expect(n.registrar).toHaveBeenCalled();
    parar();
  });

  it('primeira instalação: o app passa a ficar guardado, sem avisar de versão nova', () => {
    const n = navegadorFalso({ controlador: false });
    const parar = registrarServiceWorker({ janela: n.janela });
    n.trocarControlador();
    expect(novaVersaoPronta()).toBe(false);
    parar();
  });

  it('atualização: troca de controlador avisa que há versão nova', () => {
    const n = navegadorFalso({ controlador: true });
    const parar = registrarServiceWorker({ janela: n.janela });
    n.trocarControlador();
    expect(novaVersaoPronta()).toBe(true);
    parar();
  });

  it('depois de recarga forçada (página sem controlador, mas com service worker ativo), avisa a versão nova', async () => {
    const n = navegadorFalso({ controlador: false, ativo: true });
    const parar = registrarServiceWorker({ janela: n.janela });
    await Promise.resolve();
    await Promise.resolve();
    n.trocarControlador();
    expect(novaVersaoPronta()).toBe(true);
    parar();
  });

  it('desfeito antes do registro terminar, não deixa conferência nem ouvinte para trás', async () => {
    vi.useFakeTimers();
    const n = navegadorFalso({ controlador: true });
    const parar = registrarServiceWorker({ janela: n.janela });
    parar();
    await vi.advanceTimersByTimeAsync(0);
    expect(n.registrar).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(CONFERIR_ATUALIZACAO_MS * 2);
    n.janela.document.dispatchEvent(new Event('visibilitychange'));
    expect(n.atualizar).not.toHaveBeenCalled();
  });

  it('procura versão nova a cada hora e ao voltar ao app', async () => {
    vi.useFakeTimers();
    const n = navegadorFalso({ controlador: true });
    const parar = registrarServiceWorker({ janela: n.janela });
    await vi.advanceTimersByTimeAsync(0);
    expect(n.atualizar).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(CONFERIR_ATUALIZACAO_MS);
    expect(n.atualizar).toHaveBeenCalledTimes(1);
    n.janela.document.dispatchEvent(new Event('visibilitychange'));
    expect(n.atualizar).toHaveBeenCalledTimes(2);
    parar();
    await vi.advanceTimersByTimeAsync(CONFERIR_ATUALIZACAO_MS);
    expect(n.atualizar).toHaveBeenCalledTimes(2);
  });
});

describe('NovaVersao', () => {
  it('fica invisível sem versão nova e mostra o botão Atualizar quando ela chega', async () => {
    const n = navegadorFalso({ controlador: true });
    const parar = registrarServiceWorker({ janela: n.janela });
    render(<NovaVersao />);
    expect(screen.queryByRole('button', { name: 'Atualizar' })).toBeNull();
    act(() => n.trocarControlador());
    expect(await screen.findByRole('button', { name: 'Atualizar' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Versão nova do app.');
    parar();
  });
});
