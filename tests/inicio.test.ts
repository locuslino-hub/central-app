import { beforeEach, describe, expect, it, vi } from 'vitest';

const iniciarSincronia = vi.fn(() => () => {});
const sincronizar = vi.fn(async () => 'atualizado');
const iniciarVirada = vi.fn((_opcoes?: unknown) => () => {});

vi.mock('../src/dados/sincronia', () => ({ iniciarSincronia, sincronizar }));
vi.mock('../src/dados/virada', () => ({ iniciarVirada }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('iniciarApp (o que o main.tsx liga ao abrir)', () => {
  it('liga a sincronia e a virada do dia', async () => {
    const { iniciarApp } = await import('../src/inicio');
    iniciarApp();
    expect(iniciarSincronia).toHaveBeenCalledTimes(1);
    expect(iniciarVirada).toHaveBeenCalledTimes(1);
  });

  it('a virada espera a sincronia: o "antes" é a sincronização de verdade', async () => {
    const { iniciarApp } = await import('../src/inicio');
    iniciarApp();
    const { antes } = iniciarVirada.mock.calls[0][0] as { antes: () => Promise<unknown> };
    await expect(antes()).resolves.toBe('atualizado');
    expect(sincronizar).toHaveBeenCalledTimes(1);
  });

  it('a virada sabe se o aparelho tem conexão guardada', async () => {
    const { salvarConexao } = await import('../src/conexao/guarda');
    const { iniciarApp } = await import('../src/inicio');
    iniciarApp();
    const { conectado } = iniciarVirada.mock.calls[0][0] as { conectado: () => Promise<boolean> };
    await expect(conectado()).resolves.toBe(false);
    await salvarConexao({ url: 'https://script.google.com/macros/s/AKfycb-ficticio/exec', codigo: 'codigo-ficticio-de-teste-0123456789abcdef' });
    await expect(conectado()).resolves.toBe(true);
  });

  it('semeia as salas e as palavras iniciais', async () => {
    const { listar } = await import('../src/dados/loja');
    const { iniciarApp } = await import('../src/inicio');
    iniciarApp();
    await vi.waitFor(async () => {
      expect(await listar('salas')).toHaveLength(7);
      expect((await listar('palavras')).length).toBeGreaterThan(0);
    });
  });

  it('põe na fila do Google Agenda as tarefas antigas com hora de início, uma vez só', async () => {
    const { listar, listarPendentes, salvar } = await import('../src/dados/loja');
    await salvar('tarefas', {
      titulo: 'Reunião com a Marina', salaId: null, data: '2026-11-06', inicio: '15:30', duracaoMin: 60,
      duracaoConfirmada: true, feito: false, fixada: false, marcar: false,
    });
    const { iniciarApp } = await import('../src/inicio');

    iniciarApp();
    await vi.waitFor(async () => expect((await listarPendentes()).filter((p) => p.tipo === 'agenda')).toHaveLength(1));
    expect(await listar('tarefas')).toHaveLength(1); // a tarefa só some depois de o script confirmar

    iniciarApp();
    await new Promise((pronto) => setTimeout(pronto, 100));
    expect((await listarPendentes()).filter((p) => p.tipo === 'agenda')).toHaveLength(1);
  });

  it('pede armazenamento persistente uma vez, sem mostrar nada e sem quebrar se não houver', async () => {
    const persist = vi.fn(() => Promise.resolve(false));
    vi.stubGlobal('navigator', { storage: { persist } });
    const { iniciarApp } = await import('../src/inicio');
    iniciarApp();
    expect(persist).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toBe('');
  });

  it('navegador sem a API de armazenamento, ou que recusa, não derruba o início', async () => {
    const { iniciarApp } = await import('../src/inicio');
    vi.stubGlobal('navigator', {});
    expect(() => iniciarApp()).not.toThrow();
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('navigator', { storage: { persist: () => Promise.reject(new Error('negado')) } });
    expect(() => iniciarApp()).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));
    expect(erro).not.toHaveBeenCalled();
  });
});
