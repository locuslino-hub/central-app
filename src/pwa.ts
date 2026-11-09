// App instalável e offline (Tarefa 22). O service worker (gerado no build por
// vite-plugin-pwa, ver vite.config.ts) guarda só o app: HTML, JS, CSS, fontes e
// ícones. Dados e script do Google nunca passam por ele.
//
// Atualização: a versão nova baixa em segundo plano e assume sozinha (skipWaiting
// + clientsClaim). A tela aberta continua na versão velha até recarregar; por isso
// `novaVersaoPronta` avisa o dono, que escolhe o momento (nada de recarregar à força
// com um campo em edição).
import { useEffect, useState } from 'preact/hooks';

/** Confere se há versão nova ao abrir, ao voltar ao app e a cada hora com ele aberto. */
export const CONFERIR_ATUALIZACAO_MS = 60 * 60 * 1000;

let pronta = false;
const ouvintes = new Set<(pronta: boolean) => void>();

export function novaVersaoPronta(): boolean {
  return pronta;
}

export function assinarNovaVersao(ouvinte: (pronta: boolean) => void): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

function marcarPronta() {
  pronta = true;
  for (const ouvinte of [...ouvintes]) ouvinte(true);
}

/** Só para testes. */
export function esquecerNovaVersao() {
  pronta = false;
}

export function useNovaVersao(): boolean {
  const [valor, setValor] = useState(pronta);
  useEffect(() => {
    setValor(pronta);
    return assinarNovaVersao(setValor);
  }, []);
  return valor;
}

type Opcoes = {
  /** Endereço do service worker. Padrão: `sw.js` ao lado do app (respeita a base do Vite). */
  endereco?: string;
  /** Escopo. Padrão: a base do Vite (`/central-app/`). */
  escopo?: string;
  /** Troca de ouvinte para testes. */
  janela?: Window;
};

/**
 * Registra o service worker depois que a página terminou de carregar (para não
 * competir com a abertura do app). Devolve uma função que desfaz os ouvintes.
 * Qualquer falha é silenciosa: sem service worker o app só deixa de abrir offline.
 */
export function registrarServiceWorker({
  endereco = `${import.meta.env.BASE_URL}sw.js`,
  escopo = import.meta.env.BASE_URL,
  janela = window,
}: Opcoes = {}): () => void {
  const contêiner = janela.navigator.serviceWorker;
  if (!contêiner) return () => {};

  // Se já havia um controlador, a troca de controlador é uma atualização; na
  // primeira instalação ela é só o app passando a ficar guardado.
  let controlador = contêiner.controller;
  const aoTrocarControlador = () => {
    if (controlador) marcarPronta();
    controlador = contêiner.controller;
  };
  contêiner.addEventListener('controllerchange', aoTrocarControlador);

  let registro: ServiceWorkerRegistration | undefined;
  const conferir = () => {
    registro?.update().catch(() => {});
  };
  const aoVoltar = () => {
    if (janela.document.visibilityState === 'visible') conferir();
  };
  let temporizador: ReturnType<typeof setInterval> | undefined;

  const registrar = () => {
    contêiner
      .register(endereco, { scope: escopo })
      .then((r) => {
        registro = r;
        temporizador = setInterval(conferir, CONFERIR_ATUALIZACAO_MS);
        janela.document.addEventListener('visibilitychange', aoVoltar);
      })
      .catch(() => {});
  };
  if (janela.document.readyState === 'complete') registrar();
  else janela.addEventListener('load', registrar, { once: true });

  return () => {
    contêiner.removeEventListener('controllerchange', aoTrocarControlador);
    janela.removeEventListener('load', registrar);
    janela.document.removeEventListener('visibilitychange', aoVoltar);
    if (temporizador) clearInterval(temporizador);
  };
}
