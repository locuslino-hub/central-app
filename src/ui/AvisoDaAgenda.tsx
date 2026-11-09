// A linha discreta que diz o que deu errado ao ler a agenda, sem alarde.
import type { FalhaDeEventos, Leitura } from '../dados/eventos';

const DETALHE: Record<Exclude<FalhaDeEventos, 'nao-liberada'>, string> = {
  'nao-conectado': 'Este aparelho ainda não está conectado.',
  'sem-internet': 'Sem internet.',
  codigo: 'O código deste aparelho não vale mais.',
  falhou: 'Tente de novo em instantes.',
};

/** Só a falta de conexão e o código inválido (confirmado pelo ping) levam a Conectar aparelho. */
const LEVA_A_CONECTAR = new Set<FalhaDeEventos>(['nao-conectado', 'codigo']);

type Props = {
  leitura: Leitura;
  aoTentar: () => void;
  /** Quantos eventos recusados ficaram escondidos nesta tela. */
  recusados?: number;
};

export function AvisoDaAgenda({ leitura, aoTentar, recusados = 0 }: Props) {
  const { falha, incompleto, carregando, lidoEm } = leitura;
  const vazio = !(carregando && lidoEm === null && falha === null) && falha === null && !incompleto && recusados === 0;
  if (vazio) return null;
  return (
    <div class="cal-avisos">
      {carregando && lidoEm === null && falha === null && <p class="cal-aviso">Carregando a agenda…</p>}
      {falha !== null && (
        <div class="cal-aviso cal-aviso-falha">
          {falha === 'nao-liberada' ? (
            <p>Agenda ainda não liberada — falta aprovar a permissão no script</p>
          ) : (
            <p>
              <strong>Agenda não carregou</strong> <span>{DETALHE[falha]}</span>
            </p>
          )}
          {LEVA_A_CONECTAR.has(falha) ? (
            <a class="botao-link" href="#/conectar">
              Conectar aparelho
            </a>
          ) : (
            <button type="button" class="botao" onClick={aoTentar} disabled={carregando}>
              Tentar de novo
            </button>
          )}
        </div>
      )}
      {falha === null && incompleto && <p class="cal-aviso">Algumas agendas não carregaram</p>}
      {recusados > 0 && (
        <p class="cal-aviso">
          {recusados === 1 ? '1 evento recusado fica escondido.' : `${recusados} eventos recusados ficam escondidos.`}
        </p>
      )}
    </div>
  );
}
