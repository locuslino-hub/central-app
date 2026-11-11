import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { cleanup } from '@testing-library/preact';
import { afterAll, afterEach, beforeEach, vi } from 'vitest';
import { esquecerEmails } from '../src/dados/emails';
import { esquecerEventos } from '../src/dados/eventos';

// Vitest roda com `globals` desligado, então a limpeza automática da
// testing-library não é registrada: registramos aqui.
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  esquecerEventos(); // os eventos ficam na memória do módulo: cada teste começa sem eles
  esquecerEmails(); // e os e-mails também
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// O Preact roda efeitos adiados num temporizador depois da pintura. Espera esses
// efeitos terminarem antes de o ambiente jsdom ser desmontado no fim do arquivo.
afterAll(async () => {
  await new Promise((resolver) => setTimeout(resolver, 150));
});

// O jsdom não tem `showModal`/`close` do <dialog>. Aqui vai uma imitação mínima (só para os testes):
// abre e fecha pelo atributo `open`, dispara `close` e trata o Esc como o navegador (`cancel`, depois `close`).
// O comportamento de verdade (foco preso, camada do topo, ::backdrop) é visto nos testes de ponta a ponta.
if (typeof HTMLDialogElement !== 'undefined' && !('showModal' in HTMLDialogElement.prototype)) {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement;
  proto.show = function () {
    this.setAttribute('open', '');
  };
  proto.showModal = function () {
    this.setAttribute('open', '');
    const primeiro = this.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    primeiro?.focus();
  };
  proto.close = function () {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
  document.addEventListener('keydown', (evento) => {
    if (evento.key !== 'Escape' || evento.defaultPrevented) return;
    const abertos = document.querySelectorAll('dialog[open]');
    const topo = abertos[abertos.length - 1] as HTMLDialogElement | undefined;
    if (!topo) return;
    const cancelar = new Event('cancel', { cancelable: true });
    topo.dispatchEvent(cancelar);
    if (!cancelar.defaultPrevented) topo.close();
  });
}
