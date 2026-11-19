// A pasta "Central" no Meu Drive do dono: tudo o que o script guarda no Drive
// fica nela (arquivo de dados, cópias diárias, "Audios" e "Casa (partilhada)").
// Nada aqui toca serviços do Google: o Drive chega por `ServicoDePastas` e
// `ServicoDeOrganizacao` (Codigo.ts), então tudo roda igual nos testes.
//
// Só vale pasta do DONO (quem implementa `procurarPasta` filtra por dono e
// lixeira). Mais de uma "Central": erro, o script não adivinha qual vale.
// Só "Casa (partilhada)" é compartilhada, e só ela: nunca a "Central".
import { eNomeDeCopia } from './dados';

export const NOME_DA_PASTA_CENTRAL = 'Central';
export const NOME_DA_PASTA_DA_CASA = 'Casa (partilhada)';

/** O mínimo do Drive para achar e criar pastas. `paiId` "root" é o Meu Drive. */
export interface ServicoDePastas {
  /** Pastas do dono, não apagadas, com esse nome DIRETO dentro de `paiId`. */
  procurarPasta(nome: string, paiId: string): { id: string }[];
  criarPasta(nome: string, paiId: string): string;
}

/**
 * Códigos fixos dos avisos do registro (o GUIA, parte 9, diz o que fazer em cada
 * um). Nunca levam ids nem nomes de arquivos.
 */
export type CodigoDeAviso =
  | 'central_duplicada'
  | 'dados_na_lixeira'
  | 'dados_duplicados'
  | 'casa_duplicada'
  | 'casa_em_dois_lugares'
  | 'dados_de_outro_dono'
  | 'trava_ocupada'
  | 'erro_no_drive';

/** Um problema que o dono resolve à mão, com o código fixo do aviso. A mensagem é para os testes e o registro de erros. */
export class AvisoDeOrganizacao extends Error {
  constructor(
    readonly codigo: CodigoDeAviso,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = 'AvisoDeOrganizacao';
  }
}

/** Mais de uma com o mesmo nome: o script não adivinha qual vale. */
export function umaSo(achadas: { id: string }[], nome: string): string | null {
  if (achadas.length > 1) {
    const codigo = nome === NOME_DA_PASTA_CENTRAL ? 'central_duplicada' : nome === NOME_DA_PASTA_DA_CASA ? 'casa_duplicada' : 'erro_no_drive';
    throw new AvisoDeOrganizacao(codigo, `Mais de uma pasta ${nome}`);
  }
  return achadas[0]?.id ?? null;
}

/**
 * Id da pasta "Central" do dono na raiz do Meu Drive. Com `criar: true` cria se
 * faltar (quem chama deve estar na trava, para dois pedidos juntos não fazerem
 * duas); com `criar: false` só olha e devolve `null` se não existe.
 */
export function pastaCentral(servico: ServicoDePastas, opcoes: { criar: true }): string;
export function pastaCentral(servico: ServicoDePastas, opcoes: { criar: boolean }): string | null;
export function pastaCentral(servico: ServicoDePastas, { criar }: { criar: boolean }): string | null {
  const achada = umaSo(servico.procurarPasta(NOME_DA_PASTA_CENTRAL, 'root'), NOME_DA_PASTA_CENTRAL);
  if (achada !== null) return achada;
  return criar ? servico.criarPasta(NOME_DA_PASTA_CENTRAL, 'root') : null;
}

// ---------- organização única dos arquivos antigos ----------

/** O que a organização precisa do Drive, além de achar e criar pastas. Tudo só do dono. */
export interface ServicoDeOrganizacao extends ServicoDePastas {
  /**
   * O arquivo de dados principal (o id guardado, ou o achado pelo nome em qualquer
   * lugar), ou `null` se não existe. Só olha: nunca muda propriedades. Lança se o
   * guardado está na lixeira ou se há mais de um com o nome.
   */
  arquivoDeDados(): { id: string; pais: string[]; doDono: boolean } | null;
  /** Arquivos de nome `central-dados-*` do dono, fora da lixeira, em qualquer pasta. */
  copias(): { id: string; nome: string; pais: string[] }[];
  /** Muda o item de pasta (sai de onde estava, entra em `paiNovoId`). Nada é copiado nem apagado. */
  mover(id: string, paiNovoId: string): void;
}

/** O código fixo do aviso para este erro; o que não é problema conhecido vira `erro_no_drive`. */
export function codigoDoAviso(erro: unknown): CodigoDeAviso {
  return erro instanceof AvisoDeOrganizacao ? erro.codigo : 'erro_no_drive';
}

/** Só o nome do erro (nunca a mensagem, que pode trazer ids ou nomes). */
function causa(erro: unknown): string {
  const { name } = (erro ?? {}) as { name?: unknown };
  return typeof name === 'string' && /^[A-Za-z]{1,40}$/.test(name) ? name : 'erro';
}

/**
 * Arruma os arquivos de antes da pasta "Central": cria "Central" se faltar, move
 * para ela o arquivo de dados, as cópias diárias e a pasta "Casa (partilhada)"
 * (que estavam soltos na raiz do Meu Drive). Idempotente: repetir não muda nada.
 * Nada é apagado nem copiado; o compartilhamento da pasta da Casa continua
 * (mover mantém as permissões). Cada passo falha sozinho: o aviso vai para o
 * registro (`registrar`) e os outros passos seguem. Só sem a "Central" os demais
 * não têm para onde ir. O registro diz contagens e códigos fixos de aviso
 * (`AVISO codigo: texto`), nunca ids nem nomes de arquivo.
 */
export function organizarPastaCentral(servico: ServicoDeOrganizacao, registrar: (linha: string) => void): void {
  const log = (linha: string) => registrar(`Central: ${linha}`);
  const aviso = (codigo: CodigoDeAviso, texto: string) => log(`AVISO ${codigo}: ${texto}`);
  const avisoDoErro = (erro: unknown, texto: string) => {
    const codigo = codigoDoAviso(erro);
    aviso(codigo, codigo === 'erro_no_drive' ? `${texto} (${causa(erro)}).` : `${texto}.`);
  };

  let central: string;
  try {
    const existente = pastaCentral(servico, { criar: false });
    central = existente ?? pastaCentral(servico, { criar: true });
    log(existente === null ? `pasta ${NOME_DA_PASTA_CENTRAL} criada.` : `pasta ${NOME_DA_PASTA_CENTRAL} já existia.`);
  } catch (erro) {
    avisoDoErro(erro, `não foi possível preparar a pasta ${NOME_DA_PASTA_CENTRAL}; nada foi movido`);
    return;
  }

  try {
    const dados = servico.arquivoDeDados();
    if (dados === null) log('arquivo de dados: ainda não existe, nada a mover.');
    else if (!dados.doDono) aviso('dados_de_outro_dono', 'o arquivo de dados não é do dono; não foi movido.');
    else if (dados.pais.includes(central)) log('arquivo de dados: já estava na pasta Central.');
    else {
      servico.mover(dados.id, central);
      log('arquivo de dados movido para a pasta Central.');
    }
  } catch (erro) {
    avisoDoErro(erro, 'o arquivo de dados não foi movido');
  }

  try {
    const aMover = servico.copias().filter((c) => eNomeDeCopia(c.nome) && !c.pais.includes(central));
    let movidas = 0;
    let falhas = 0;
    for (const { id } of aMover) {
      try {
        servico.mover(id, central);
        movidas += 1;
      } catch {
        falhas += 1;
      }
    }
    log(`${movidas} ${movidas === 1 ? 'cópia diária movida' : 'cópias diárias movidas'} para a pasta Central.`);
    if (falhas > 0) aviso('erro_no_drive', `${falhas} ${falhas === 1 ? 'cópia não foi movida' : 'cópias não foram movidas'}; rode organizarPastaCentral de novo.`);
  } catch (erro) {
    avisoDoErro(erro, 'as cópias diárias não foram movidas');
  }

  try {
    const daRaiz = servico.procurarPasta(NOME_DA_PASTA_DA_CASA, 'root');
    const dedentro = servico.procurarPasta(NOME_DA_PASTA_DA_CASA, central);
    if (dedentro.length > 1 || daRaiz.length > 1) {
      aviso('casa_duplicada', `há mais de uma ${NOME_DA_PASTA_DA_CASA} (na raiz ou dentro de Central); nada foi movido. Deixe só uma.`);
    } else if (daRaiz.length === 0) log(`pasta ${NOME_DA_PASTA_DA_CASA}: nada a mover na raiz do Drive.`);
    else if (dedentro.length > 0) {
      aviso('casa_em_dois_lugares', `${NOME_DA_PASTA_DA_CASA} existe na raiz e dentro de Central; nada foi movido. Junte as duas à mão.`);
    } else {
      servico.mover(daRaiz[0]!.id, central);
      log(`pasta ${NOME_DA_PASTA_DA_CASA} movida para dentro de Central (o compartilhamento continua).`);
    }
  } catch (erro) {
    avisoDoErro(erro, `a pasta ${NOME_DA_PASTA_DA_CASA} não foi movida`);
  }
}
