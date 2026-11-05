import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { cleanup } from '@testing-library/preact';
import { afterEach, beforeEach, vi } from 'vitest';

// Vitest roda com `globals` desligado, então a limpeza automática da
// testing-library não é registrada: registramos aqui.
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
