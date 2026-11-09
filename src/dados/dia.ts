// O dia do dono é o de Lisboa (`Europe/Lisbon`), não o do relógio do aparelho nem o UTC.
// Funções pequenas e sem dependências: servem à virada do dia, às telas e ao chat.

const HORA_DE_LISBOA = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Lisbon',
  hourCycle: 'h23',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** `AAAA-MM-DD` em Lisboa. */
export function hojeEmLisboa(agora: Date = new Date()): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Lisbon',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(agora);
  const parte = (tipo: string) => partes.find((p) => p.type === tipo)!.value;
  return `${parte('year')}-${parte('month')}-${parte('day')}`;
}

/** O minuto do dia em Lisboa, de 0 (00:00) a 1439 (23:59). */
export function minutoEmLisboa(agora: Date = new Date()): number {
  const partes = HORA_DE_LISBOA.formatToParts(agora);
  const valor = (tipo: string) => Number(partes.find((p) => p.type === tipo)!.value);
  return valor('hour') * 60 + valor('minute');
}

/**
 * Milissegundos até as 00:00 de Lisboa, contando as horas do relógio de parede.
 * Nos dois dias do ano em que a hora muda a conta erra por 1 h: quem usa isto
 * (vigiarODia) acorda no máximo a cada 15 minutos e confere a data.
 */
export function msAteMeiaNoiteEmLisboa(agora: Date = new Date()): number {
  const partes = HORA_DE_LISBOA.formatToParts(agora);
  const valor = (tipo: string) => Number(partes.find((p) => p.type === tipo)!.value);
  const desdeAMeiaNoite = ((valor('hour') * 60 + valor('minute')) * 60 + valor('second')) * 1000 + (agora.getTime() % 1000 + 1000) % 1000;
  return 24 * 3600_000 - desdeAMeiaNoite;
}

const MARGEM_APOS_A_MEIA_NOITE_MS = 500;
const ACORDAR_NO_MAXIMO_MS = 15 * 60_000;

/**
 * Chama `aoMudar(diaNovo)` quando o dia de Lisboa muda: por um temporizador
 * que acorda na meia-noite (e no máximo a cada 15 minutos, para o relógio que
 * pulou ou a mudança de hora não atrasarem a virada) e ao voltar ao app
 * (`visibilitychange`). Só avisa quando o dia é outro que o da última vez.
 * Devolve a função que desliga tudo.
 */
export function vigiarODia(
  aoMudar: (dia: string) => unknown,
  agora: () => Date = () => new Date(),
): () => void {
  let ultimo = hojeEmLisboa(agora());
  let temporizador: ReturnType<typeof setTimeout> | undefined;

  const conferir = () => {
    const dia = hojeEmLisboa(agora());
    if (dia === ultimo) return;
    ultimo = dia;
    try {
      void Promise.resolve(aoMudar(dia)).catch((erro: unknown) => console.error('Falha na virada do dia', erro));
    } catch (erro) {
      console.error('Falha na virada do dia', erro);
    }
  };
  const agendar = () => {
    const espera = Math.min(msAteMeiaNoiteEmLisboa(agora()) + MARGEM_APOS_A_MEIA_NOITE_MS, ACORDAR_NO_MAXIMO_MS);
    temporizador = setTimeout(() => {
      conferir();
      agendar();
    }, espera);
  };
  const aoVoltar = () => {
    if (document.visibilityState !== 'hidden') conferir();
  };

  document.addEventListener('visibilitychange', aoVoltar);
  agendar();
  return () => {
    clearTimeout(temporizador);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', aoVoltar);
  };
}
