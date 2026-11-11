// Rotas por hash (`#/semana`). Cada rota tem um título de vista; as telas que
// ainda não existem usam só esse título (src/ui/Vista.tsx). Semana, mês e ano
// aceitam `?d=AAAA-MM-DD` para abrir outro período (`#/semana?d=2026-11-16`).
import { segundaDaSemana } from './chat/datas';
import { hojeEmLisboa } from './dados/dia';
import { NOMES_DOS_MESES, nomeDaSemana } from './ui/quando';

export type IdDaRota =
  | 'hoje'
  | 'agora'
  | 'semana'
  | 'mes'
  | 'ano'
  | 'salas'
  | 'sala'
  | 'cores'
  | 'pessoa'
  | 'caixa'
  | 'quadro'
  | 'atividades'
  | 'sem-prazo'
  | 'chat'
  | 'conectar'
  | 'ia'
  | 'nao-encontrada';

/** O que o painel direito do computador aceita. */
export type Painel = 'agora' | 'agua' | 'chat';
export const PAINEIS_DIREITOS: readonly Painel[] = ['agora', 'agua', 'chat'];

export type RotaAtual = {
  id: IdDaRota;
  titulo: string;
  /** Parte `:id` de `#/sala/:id` e `#/pessoa/:id`, já decodificada. */
  param?: string;
  /** Semana, mês e ano: o dia pedido em `?d=` (existe de verdade). Sem ele, vale hoje. */
  data?: string;
  /** Para onde o link "Voltar" leva, nas páginas que não estão no menu. */
  voltarPara?: string;
};

type Definicao = {
  /** Caminho sem o `#/`. `:id` marca o parâmetro. */
  caminho: string;
  titulo: (agora: Date, data?: string) => string;
  voltarPara?: string;
  /** Aceita `?d=`. */
  comData?: boolean;
};

const fixo = (texto: string) => () => texto;

const ROTAS: Record<Exclude<IdDaRota, 'nao-encontrada'>, Definicao> = {
  hoje: { caminho: '', titulo: fixo('Painel do dia') },
  agora: { caminho: 'agora', titulo: fixo('Agora') },
  semana: {
    caminho: 'semana',
    comData: true,
    titulo: (agora, data) => {
      const hoje = hojeEmLisboa(agora);
      return nomeDaSemana(segundaDaSemana(data ?? hoje), hoje);
    },
  },
  mes: {
    caminho: 'mes',
    comData: true,
    titulo: (agora, data) => {
      if (data === undefined) return nomeDoMes(agora);
      const [ano, mes] = data.split('-').map(Number);
      const nome = nomeDoMes(new Date(ano, mes - 1, 1));
      return ano === agora.getFullYear() ? nome : `${nome} de ${ano}`;
    },
  },
  ano: {
    caminho: 'ano',
    comData: true,
    titulo: (agora, data) => (data === undefined ? String(agora.getFullYear()) : data.slice(0, 4)),
  },
  salas: { caminho: 'salas', titulo: fixo('Salas') },
  sala: { caminho: 'sala/:id', titulo: fixo('Sala'), voltarPara: '#/salas' },
  cores: { caminho: 'cores', titulo: fixo('Cores do Google'), voltarPara: '#/salas' },
  pessoa: { caminho: 'pessoa/:id', titulo: fixo('Pessoa'), voltarPara: '#/salas' },
  caixa: { caminho: 'caixa', titulo: fixo('Caixa') },
  quadro: { caminho: 'quadro', titulo: fixo('Quadro') },
  atividades: { caminho: 'atividades', titulo: fixo('Atividades') },
  'sem-prazo': { caminho: 'sem-prazo', titulo: fixo('Sem prazo') },
  chat: { caminho: 'chat', titulo: fixo('Chat') },
  conectar: { caminho: 'conectar', titulo: fixo('Conectar aparelho'), voltarPara: '#/' },
  ia: { caminho: 'ia', titulo: fixo('IA local'), voltarPara: '#/' },
};

const NAO_ENCONTRADA: RotaAtual = { id: 'nao-encontrada', titulo: 'Página não encontrada' };


/** Mês por extenso, com maiúscula. Lista fixa: não depende do idioma do aparelho. */
export function nomeDoMes(data: Date): string {
  return NOMES_DOS_MESES[data.getMonth()];
}

/** A data de `?d=`, só se existir no calendário (31/02 não existe). */
function dataDaConsulta(consulta: string): string | undefined {
  for (const par of consulta.split('&')) {
    const [nome, valor] = par.split('=');
    if (nome !== 'd' || !/^\d{4}-\d{2}-\d{2}$/.test(valor ?? '')) continue;
    const [a, m, d] = valor.split('-').map(Number);
    const x = new Date(Date.UTC(2000, m - 1, d));
    x.setUTCFullYear(a);
    return x.getUTCFullYear() === a && x.getUTCMonth() === m - 1 && x.getUTCDate() === d ? valor : undefined;
  }
  return undefined;
}

function decodificar(texto: string): string | undefined {
  try {
    return decodeURIComponent(texto);
  } catch {
    return undefined;
  }
}

/**
 * Entende `location.hash`. Só valem `''`, `#` e `#/…`: `#semana` e `#//semana`
 * não existem. Endereço que não existe vira "não encontrada".
 */
export function resolverRota(hash: string, agora: Date = new Date()): RotaAtual {
  const [semConsulta, ...restoDaConsulta] = hash.split('?');
  const consulta = restoDaConsulta.join('?');
  if (semConsulta !== '' && semConsulta !== '#' && !semConsulta.startsWith('#/')) return NAO_ENCONTRADA;
  const resto = semConsulta.slice(2);
  if (resto.startsWith('/')) return NAO_ENCONTRADA; // `#//semana`
  // Uma barra no fim é aceita (`#/semana/`); duas não.
  const caminho = resto.replace(/\/$/, '');

  for (const [id, definicao] of Object.entries(ROTAS) as [Exclude<IdDaRota, 'nao-encontrada'>, Definicao][]) {
    if (!definicao.caminho.endsWith(':id')) {
      if (definicao.caminho !== caminho) continue;
      const data = definicao.comData ? dataDaConsulta(consulta) : undefined;
      return { id, titulo: definicao.titulo(agora, data), data, voltarPara: definicao.voltarPara };
    }
    const prefixo = definicao.caminho.slice(0, -':id'.length);
    if (!caminho.startsWith(prefixo)) continue;
    const bruto = caminho.slice(prefixo.length);
    if (bruto === '' || bruto.includes('/')) return NAO_ENCONTRADA;
    const param = decodificar(bruto);
    if (param === undefined) return NAO_ENCONTRADA;
    return { id, titulo: definicao.titulo(agora), param, voltarPara: definicao.voltarPara };
  }
  return NAO_ENCONTRADA;
}

/** O hash de uma rota. */
export function hrefDe(id: Exclude<IdDaRota, 'nao-encontrada'>, param?: string): string {
  const { caminho } = ROTAS[id];
  const completo = param === undefined ? caminho : caminho.replace(':id', encodeURIComponent(param));
  return `#/${completo}`;
}

/** O hash de semana, mês ou ano, aberto no período que contém `data` (sem ela, o de hoje). */
export function hrefDoCalendario(id: 'semana' | 'mes' | 'ano', data?: string): string {
  const base = hrefDe(id);
  return data === undefined ? base : `${base}?d=${data}`;
}
