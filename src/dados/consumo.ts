// Registro de consumo (água, luz, gás): funções puras, sem rede nem relógio.
// Datas são texto `AAAA-MM-DD` (o "hoje" de Lisboa vem de `hojeEmLisboa` em dia.ts, quem
// chama passa pronto). A conta de dias usa UTC puro, então o fuso do aparelho e a mudança
// de hora não entram.
//
// Decisões:
// - Leitura com data que não existe (`2026-02-30`, `01/11/2026`), número não finito ou
//   negativo é IGNORADA (a planilha é editada à mão e a tela não pode quebrar). Quem
//   chama usa `leiturasIgnoradas` (posição na lista recebida + motivo) para avisar; o
//   cálculo em si não avisa nada.
// - Duas leituras no mesmo dia: desempata pela leitura crescente (contador só sobe).
//   Custo aceito: uma correção para baixo no mesmo dia não gera `leitura_menor`; a
//   menor passa a ser a "anterior".
// - Leitura menor que a anterior: consumo `null` + aviso `leitura_menor`, nunca negativo.
//   A leitura seguinte compara com ESTA (contador zerado ou trocado: a conta recomeça).
// - Leitura igual à anterior: consumo 0, sem aviso.
// - Números arredondados a 3 casas (m³/kWh), para 0,1 + 0,2 dar 0,3.
// - Resumo mensal: o consumo vai para o mês da leitura mais nova. Mês sem nenhum consumo
//   calculado (só a primeira leitura, ou só `leitura_menor`) não aparece; mês com consumo
//   0 aparece com 0. Saída em ordem cronológica.
// - `diaDeEnvio` fora de 1-31 (ou não inteiro) e `hoje` inválido dão `RangeError`:
//   quem chama checa se a pasta tem dia de envio antes.

export type Leitura = { data: string; leitura: number };
export type LeituraComConsumo = {
  data: string;
  leitura: number;
  consumo: number | null;
  aviso?: 'leitura_menor';
};

const CASAS = 1000;
const arredondar = (n: number) => Math.round(n * CASAS) / CASAS;

export type MotivoDeRecusa = 'data_invalida' | 'leitura_invalida';

/** Por que uma leitura fica fora da conta (`null` = entra). Único critério, usado pelo filtro e por `leiturasIgnoradas`. */
function motivoDeRecusa(l: Leitura | null | undefined): MotivoDeRecusa | null {
  if (!l || !dataValida(l.data)) return 'data_invalida';
  if (typeof l.leitura !== 'number' || !Number.isFinite(l.leitura) || l.leitura < 0) return 'leitura_invalida';
  return null;
}

/** Confere `AAAA-MM-DD` de verdade (dia 30 de fevereiro não existe). */
function dataValida(texto: unknown): texto is string {
  if (typeof texto !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
  const [a, m, d] = texto.split('-').map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d));
  return dt.getUTCFullYear() === a && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Leituras que `consumoDesdeAnterior` descarta: `indice` é a posição na lista recebida. */
export function leiturasIgnoradas(leituras: Leitura[]): { indice: number; motivo: MotivoDeRecusa }[] {
  if (!Array.isArray(leituras)) return [];
  const fora: { indice: number; motivo: MotivoDeRecusa }[] = [];
  leituras.forEach((l, indice) => {
    const motivo = motivoDeRecusa(l);
    if (motivo) fora.push({ indice, motivo });
  });
  return fora;
}

export function consumoDesdeAnterior(leituras: Leitura[]): LeituraComConsumo[] {
  if (!Array.isArray(leituras)) return [];
  const boas = leituras.filter((l) => motivoDeRecusa(l) === null);
  const ordenadas = [...boas].sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : a.leitura - b.leitura));

  const saida: LeituraComConsumo[] = [];
  let anterior: number | null = null;
  for (const { data, leitura } of ordenadas) {
    if (anterior === null) saida.push({ data, leitura, consumo: null });
    else if (leitura < anterior) saida.push({ data, leitura, consumo: null, aviso: 'leitura_menor' });
    else saida.push({ data, leitura, consumo: arredondar(leitura - anterior) });
    anterior = leitura;
  }
  return saida;
}

/**
 * O consumo é "medido em" o mês da leitura mais nova: leitura em 1/11 depois de uma em
 * 1/10 conta toda em novembro (os dias de outubro vêm junto), não é repartido por dia.
 */
export function consumoPorMes(leituras: Leitura[]): { mes: string; consumo: number }[] {
  const somas = new Map<string, number>();
  for (const l of consumoDesdeAnterior(leituras)) {
    if (l.consumo === null) continue;
    const mes = l.data.slice(0, 7);
    somas.set(mes, (somas.get(mes) ?? 0) + l.consumo);
  }
  return [...somas.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)) // AAAA-MM ordena como texto
    .map(([mes, consumo]) => ({ mes, consumo: arredondar(consumo) }));
}

const diasNoMes = (ano: number, mes: number) => new Date(Date.UTC(ano, mes, 0)).getUTCDate(); // mes 1-12
const dataTexto = (ano: number, mes: number, dia: number) =>
  `${String(ano).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;

/** Próxima data de envio ao portal a partir de `hoje` (hoje conta: 0 dias). Dia 31 em mês curto cai no último dia. */
export function proximoEnvio(diaDeEnvio: number, hoje: string): { data: string; diasFaltando: number } {
  if (typeof diaDeEnvio !== 'number' || !Number.isInteger(diaDeEnvio) || diaDeEnvio < 1 || diaDeEnvio > 31) {
    throw new RangeError(`Dia de envio inválido: ${String(diaDeEnvio)}`);
  }
  if (!dataValida(hoje)) throw new RangeError(`Data inválida: ${String(hoje)}`);

  const [ano, mes, dia] = hoje.split('-').map(Number);
  let a = ano;
  let m = mes;
  let alvo = Math.min(diaDeEnvio, diasNoMes(a, m));
  if (alvo < dia) {
    m += 1;
    if (m > 12) {
      m = 1;
      a += 1;
    }
    alvo = Math.min(diaDeEnvio, diasNoMes(a, m));
  }
  const diasFaltando = Math.round((Date.UTC(a, m - 1, alvo) - Date.UTC(ano, mes - 1, dia)) / 86_400_000);
  return { data: dataTexto(a, m, alvo), diasFaltando };
}
