// Pontos de entrada do Apps Script. Cada função exportada aqui vira uma função
// global no pacote (ver build.mjs). O resto fica em api.ts e dados.ts, sem serviços do Google.
import { novoCodigo, tratarCorpo, type Ambiente } from './api';
import { NOME_DO_ARQUIVO, Ocupado, type Armazem } from './dados';

const CHAVE_DO_CODIGO = 'CODIGO_DO_APARELHO';
const CHAVE_DO_ARQUIVO = 'ID_DO_ARQUIVO_DE_DADOS';
const CHAVE_DA_COPIA = 'ULTIMA_COPIA';
const FUSO = 'Europe/Lisbon';
const TIPO_JSON = 'application/json';
const ESPERA_DA_TRAVA_MS = 10_000;
/** 10 min: código trocado fora de gerarCodigo (editado à mão) deixa de valer logo. */
const SEGUNDOS_NO_CACHE = 10 * 60;

const propriedades = () => PropertiesService.getScriptProperties();

// O código é lido a cada pedido: o cache poupa a cota das propriedades. Se o
// cache falhar, as propriedades continuam valendo.
function cacheDoScript() {
  try {
    return CacheService.getScriptCache();
  } catch {
    return null;
  }
}

function lerCodigo(): string | null {
  const cache = cacheDoScript();
  try {
    const emCache = cache?.get(CHAVE_DO_CODIGO);
    if (emCache) return emCache;
  } catch {
    // segue para as propriedades
  }
  const codigo = propriedades().getProperty(CHAVE_DO_CODIGO);
  if (codigo) {
    try {
      cache?.put(CHAVE_DO_CODIGO, codigo, SEGUNDOS_NO_CACHE);
    } catch {
      // sem cache, só fica mais lento
    }
  }
  return codigo;
}

// Serviço avançado do Drive (v3), com o escopo drive.file: o script só enxerga
// os arquivos que ele mesmo criou, nunca o resto do Drive do dono.
function drive() {
  if (!Drive) throw new Error('Serviço avançado do Drive desligado');
  return Drive;
}

function blobJson(conteudo: string) {
  return Utilities.newBlob(conteudo, TIPO_JSON);
}

function comoTexto(conteudo: unknown): string {
  if (typeof conteudo === 'string') return conteudo;
  const blob = conteudo as { getDataAsString?: () => string } | null;
  if (blob && typeof blob.getDataAsString === 'function') return blob.getDataAsString();
  throw new Error('Conteúdo do Drive em formato inesperado');
}

function procurar(consulta: string) {
  const { files } = drive().Files.list({ q: consulta, fields: 'files(id,name)', pageSize: 1000 });
  return (files ?? []).filter((arquivo) => arquivo.id && arquivo.name) as { id: string; name: string }[];
}

/**
 * Id do arquivo principal: guardado nas propriedades, ou achado pelo nome.
 * Lança (vira `interno`, nada é gravado) se o guardado foi para a lixeira ou
 * se há mais de um com o nome: o dono decide qual vale, o script não adivinha.
 */
function idDoArquivo(): string | null {
  const guardado = propriedades().getProperty(CHAVE_DO_ARQUIVO);
  if (guardado) {
    if (drive().Files.get(guardado, { fields: 'id,trashed' }).trashed) {
      throw new Error('Arquivo de dados na lixeira');
    }
    return guardado;
  }
  const achados = procurar(`name = '${NOME_DO_ARQUIVO}' and trashed = false`);
  if (achados.length > 1) throw new Error('Mais de um arquivo de dados');
  const [achado] = achados;
  if (!achado) return null;
  propriedades().setProperty(CHAVE_DO_ARQUIVO, achado.id);
  return achado.id;
}

const armazem: Armazem = {
  ler() {
    const id = idDoArquivo();
    // Id guardado que não abre lança aqui (vira `interno`): nunca se cria um
    // arquivo vazio no lugar dos dados do dono.
    return id === null ? null : comoTexto(drive().Files.get(id, { alt: 'media' }));
  },
  gravar(conteudo) {
    const id = idDoArquivo();
    if (id !== null) {
      drive().Files.update({}, id, blobJson(conteudo));
      return;
    }
    const criado = drive().Files.create({ name: NOME_DO_ARQUIVO, mimeType: TIPO_JSON }, blobJson(conteudo));
    propriedades().setProperty(CHAVE_DO_ARQUIVO, criado.id as string);
  },
  comTrava(fazer) {
    const trava = LockService.getScriptLock();
    if (!trava.tryLock(ESPERA_DA_TRAVA_MS)) throw new Ocupado();
    try {
      return fazer();
    } finally {
      trava.releaseLock();
    }
  },
  agora: () => Date.now(),
  hoje: () => Utilities.formatDate(new Date(), FUSO, 'yyyy-MM-dd'),
  ultimaCopia: () => propriedades().getProperty(CHAVE_DA_COPIA),
  marcarCopia(dia) {
    propriedades().setProperty(CHAVE_DA_COPIA, dia);
  },
  copiar(nome, conteudo) {
    drive().Files.create({ name: nome, mimeType: TIPO_JSON }, blobJson(conteudo));
  },
  listarCopias: () =>
    procurar("name contains 'central-dados-' and trashed = false").map(({ id, name }) => ({ id, nome: name })),
  descartar(id) {
    // Lixeira, não exclusão: o dono ainda pode recuperar por mais 30 dias.
    drive().Files.update({ trashed: true }, id);
  },
};

const ambiente: Ambiente = {
  lerCodigo,
  armazem,
};

export function doPost(evento?: GoogleAppsScript.Events.DoPost) {
  const resposta = tratarCorpo(evento?.postData?.contents, ambiente);
  return ContentService.createTextOutput(JSON.stringify(resposta)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

/**
 * O dono roda uma vez pelo editor depois de publicar: o Google pede a
 * permissão do Drive (só arquivos criados por este script). Não grava nada e
 * não troca o código do aparelho.
 */
export function autorizarDrive() {
  const existe = idDoArquivo() !== null;
  Logger.log(
    existe
      ? 'Permissão do Drive aprovada. O arquivo central-dados.json já existe.'
      : 'Permissão do Drive aprovada. O arquivo central-dados.json será criado na primeira sincronia.',
  );
}

/** O dono roda uma vez pelo editor. Rodar de novo troca o código. */
export function gerarCodigo() {
  const codigo = novoCodigo(() => Utilities.getUuid());
  propriedades().setProperty(CHAVE_DO_CODIGO, codigo);
  // O cache passa a ter o código novo: o antigo para de valer na hora. Se o
  // cache não aceitar, falha alto: o antigo valeria por até 10 min sem o dono saber.
  try {
    const cache = cacheDoScript();
    if (!cache) throw new Error('sem cache');
    cache.put(CHAVE_DO_CODIGO, codigo, SEGUNDOS_NO_CACHE);
  } catch {
    throw new Error('O cache do script não respondeu. Espere um minuto e rode gerarCodigo de novo.');
  }
  Logger.log('Código do aparelho (copie e cole na tela Conectar aparelho): ' + codigo);
}
