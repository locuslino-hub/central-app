// A última pasta comum aberta neste aparelho: o bloco flutuante mostra as notas dela. Fica só aqui (não sincroniza).
export const CHAVE_DA_ULTIMA_PASTA = 'central.notas.ultimaPasta';
/** Disparado no `window` sempre que a última pasta muda (o bloco flutuante segue a pasta aberta). */
export const EVENTO_DA_ULTIMA_PASTA = 'central:ultima-pasta';

export type UltimaPasta = { salaId: string; pastaId: string };

export function lerUltimaPasta(): UltimaPasta | null {
  try {
    const lida: unknown = JSON.parse(localStorage.getItem(CHAVE_DA_ULTIMA_PASTA) ?? 'null');
    if (lida && typeof lida === 'object') {
      const { salaId, pastaId } = lida as Record<string, unknown>;
      if (typeof salaId === 'string' && typeof pastaId === 'string') return { salaId, pastaId };
    }
  } catch {
    // Registro estragado ou sem armazenamento: como se não houvesse.
  }
  return null;
}

export function guardarUltimaPasta(salaId: string, pastaId: string): void {
  try {
    localStorage.setItem(CHAVE_DA_ULTIMA_PASTA, JSON.stringify({ salaId, pastaId }));
  } catch {
    // Sem armazenamento: o aviso abaixo ainda leva a pasta para quem está aberto agora.
  }
  window.dispatchEvent(new CustomEvent<UltimaPasta>(EVENTO_DA_ULTIMA_PASTA, { detail: { salaId, pastaId } }));
}
