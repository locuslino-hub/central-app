// Pedido de "abrir o chat e ligar o microfone" (Ctrl+Alt+N, atalho do ícone instalado). Quem pede (a casca) e quem
// atende (o chat que está à vista) não se conhecem: o pedido fica guardado até um chat ativo o pegar, então vale
// também quando o chat ainda nem existe (o app acabou de abrir, ou o painel estava recolhido).
import { useEffect, useState } from 'preact/hooks';

/** O que se pede ao chat: foco no campo, texto já escrito e/ou o microfone ligado. */
export type PedidoDeVoz = {
  /** Liga o microfone (Ctrl+Alt+N, atalho do ícone). Padrão: sim. */
  ouvir?: boolean;
  /** Põe este começo de texto no campo, se ele estiver vazio ("Ideia: "). */
  texto?: string;
};

let pendente: PedidoDeVoz | null = null;
let numero = 0;
let pedidoEm = 0;
const ouvintes = new Set<() => void>();

/** Pede ao chat que ouça: o painel direito abre, o campo ganha o foco e o microfone liga. */
export function pedirVoz(pedido: PedidoDeVoz = {}) {
  pendente = pedido;
  numero++;
  pedidoEm = Date.now();
  for (const ouvinte of [...ouvintes]) ouvinte();
}

/** No computador o chat é o painel da direita; no tablet e no celular é a página `#/chat`: leva para lá, sem empilhar histórico. */
export function abrirOChat(tela: string, rota: string, pedido: PedidoDeVoz = {}) {
  if (tela !== 'computador' && rota !== 'chat') location.replace(`${location.pathname}${location.search}#/chat`);
  pedirVoz(pedido);
}

/** Pediram para ouvir agora há pouco? A casca não leva o foco ao título da página nova: o foco é do campo do chat. */
export function pedidoRecente(): boolean {
  return Date.now() - pedidoEm < 1000;
}

/** O chat que está à vista pega o pedido (só um pega). */
export function pegarPedidoDeVoz(): PedidoDeVoz | null {
  const havia = pendente;
  pendente = null;
  return havia;
}

export function assinarPedidoDeVoz(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

/** O número do último pedido: quem o lê roda de novo a cada pedido. */
export function usePedidoDeVoz(): number {
  const [n, setN] = useState(numero);
  useEffect(() => {
    setN(numero);
    return assinarPedidoDeVoz(() => setN(numero));
  }, []);
  return n;
}

/** Testes: nenhum pedido guardado. */
export function limparPedidoDeVoz() {
  pendente = null;
  pedidoEm = 0;
}
