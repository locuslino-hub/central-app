// Rotas por hash (`#/semana`). Cada rota tem um título de vista; as telas que
// ainda não existem usam só esse título (src/ui/Vista.tsx).

export type IdDaRota =
  | 'hoje'
  | 'agora'
  | 'semana'
  | 'mes'
  | 'ano'
  | 'salas'
  | 'sala'
  | 'pessoa'
  | 'caixa'
  | 'quadro'
  | 'atividades'
  | 'sem-prazo'
  | 'chat'
  | 'conectar'
  | 'nao-encontrada';

/** O que o painel direito do computador aceita. */
export type Painel = 'agora' | 'chat';
export const PAINEIS_DIREITOS: readonly Painel[] = ['agora', 'chat'];

export type RotaAtual = {
  id: IdDaRota;
  titulo: string;
  /** Parte `:id` de `#/sala/:id` e `#/pessoa/:id`, já decodificada. */
  param?: string;
  /** Para onde o link "Voltar" leva, nas páginas que não estão no menu. */
  voltarPara?: string;
};

type Definicao = {
  /** Caminho sem o `#/`. `:id` marca o parâmetro. */
  caminho: string;
  titulo: (agora: Date) => string;
  voltarPara?: string;
};

const fixo = (texto: string) => () => texto;

const ROTAS: Record<Exclude<IdDaRota, 'nao-encontrada'>, Definicao> = {
  hoje: { caminho: '', titulo: fixo('Painel do dia') },
  agora: { caminho: 'agora', titulo: fixo('Agora') },
  semana: { caminho: 'semana', titulo: fixo('Esta semana') },
  mes: { caminho: 'mes', titulo: (agora) => nomeDoMes(agora) },
  ano: { caminho: 'ano', titulo: (agora) => String(agora.getFullYear()) },
  salas: { caminho: 'salas', titulo: fixo('Salas') },
  sala: { caminho: 'sala/:id', titulo: fixo('Sala') },
  pessoa: { caminho: 'pessoa/:id', titulo: fixo('Pessoa') },
  caixa: { caminho: 'caixa', titulo: fixo('Caixa') },
  quadro: { caminho: 'quadro', titulo: fixo('Quadro') },
  atividades: { caminho: 'atividades', titulo: fixo('Atividades') },
  'sem-prazo': { caminho: 'sem-prazo', titulo: fixo('Sem prazo') },
  chat: { caminho: 'chat', titulo: fixo('Chat') },
  conectar: { caminho: 'conectar', titulo: fixo('Conectar aparelho'), voltarPara: '#/' },
};

const NAO_ENCONTRADA: RotaAtual = { id: 'nao-encontrada', titulo: 'Página não encontrada' };

const MESES = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

/** Mês por extenso, com maiúscula. Lista fixa: não depende do idioma do aparelho. */
export function nomeDoMes(data: Date): string {
  return MESES[data.getMonth()];
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
  const semConsulta = hash.split('?')[0];
  if (semConsulta !== '' && semConsulta !== '#' && !semConsulta.startsWith('#/')) return NAO_ENCONTRADA;
  const resto = semConsulta.slice(2);
  if (resto.startsWith('/')) return NAO_ENCONTRADA; // `#//semana`
  // Uma barra no fim é aceita (`#/semana/`); duas não.
  const caminho = resto.replace(/\/$/, '');

  for (const [id, definicao] of Object.entries(ROTAS) as [Exclude<IdDaRota, 'nao-encontrada'>, Definicao][]) {
    if (!definicao.caminho.endsWith(':id')) {
      if (definicao.caminho !== caminho) continue;
      return { id, titulo: definicao.titulo(agora), voltarPara: definicao.voltarPara };
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
