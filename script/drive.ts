// Conferências do Drive que não dependem do serviço do Google: roda igual nos
// testes (mensagens de erro reais) e no Apps Script.

export const TIPO_PLANILHA = 'application/vnd.google-apps.spreadsheet';

/** Metadados que a conferência de pasta lê (campos do Drive v3). */
export interface DadosDoArquivo {
  mimeType?: string;
  parents?: string[];
  ownedByMe?: boolean;
  trashed?: boolean;
}

const FALTA_DE_ESCOPO = /scope/i;
/**
 * Só "não existe" (404) e "sem permissão neste arquivo" (403) valem como "não
 * está lá". Falta de escopo, cota, rede e serviço NÃO casam: viram erro.
 */
const AUSENCIA = [
  /file not found/i,
  /\b404\b/,
  /does not have (?:sufficient )?permissions? (?:for this file|to access)/i,
  /\b403\b/,
];

/** O erro do Drive diz "não existe" ou "sem acesso a este arquivo"? Casa pela mensagem, como o Google a escreve. */
export function eAusenciaNoDrive(erro: unknown): boolean {
  if (typeof erro !== 'object' || erro === null) return false;
  const { message } = erro as { message?: unknown };
  if (typeof message !== 'string' || FALTA_DE_ESCOPO.test(message)) return false;
  return AUSENCIA.some((padrao) => padrao.test(message));
}

/**
 * `true` só se o arquivo é do dono, não está na lixeira, é planilha Google e
 * tem `paiId` entre os pais (está DIRETO na pasta). Não existe ou sem acesso
 * ao arquivo: `false`. Qualquer outra falha é registrada (`registrar`, que deve
 * guardar só um resumo sem ids) e relançada sem detalhes.
 */
export function planilhaNaPasta(obter: () => DadosDoArquivo, paiId: string, registrar: (erro: unknown) => void): boolean {
  let dados: DadosDoArquivo;
  try {
    dados = obter();
  } catch (erro) {
    if (eAusenciaNoDrive(erro)) return false;
    registrar(erro);
    throw new Error('Leitura do Drive falhou');
  }
  return !!dados.ownedByMe && !dados.trashed && dados.mimeType === TIPO_PLANILHA && !!dados.parents && dados.parents.indexOf(paiId) >= 0;
}
