import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { cleanup } from '@testing-library/preact';
import { afterEach, beforeEach, vi } from 'vitest';
import { esquecerEventos } from '../src/dados/eventos';

// Vitest roda com `globals` desligado, então a limpeza automática da
// testing-library não é registrada: registramos aqui.
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  esquecerEventos(); // os eventos ficam na memória do módulo: cada teste começa sem eles
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
