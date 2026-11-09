// Pontos de entrada do Apps Script. Cada função exportada aqui vira uma função
// global no pacote (ver build.mjs). O resto fica em api.ts e dados.ts, sem serviços do Google.
import { provarAgenda, type ServicoDeAgenda } from './agenda';
import { novoCodigo, resumoDoErro, tratarCorpo, type Ambiente } from './api';
import { NOME_DO_ARQUIVO, Ocupado, type Armazem } from './dados';
import { atualizarEmails as atualizarListaDeEmails, type GuardaDeEmails, type ServicoDeGmail } from './email';
import { provarTarefas, type ServicoDeTarefas } from './tarefas-google';

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

/**
 * A única URL que o script chama (R24). Ler pelo serviço avançado não
 * funciona: Files.get com alt=media lança mesmo com resposta 200 (issue
 * 149104685 do Google). A API REST com o token do próprio script lê; o
 * escopo drive.file basta, porque o arquivo foi criado por este script.
 */
const ENDPOINT_DO_DRIVE = 'https://www.googleapis.com/drive/v3/files/';

/**
 * Conteúdo do arquivo pela API do Drive. Só HTTP 200 vale. Erros dizem só o
 * status: nunca o token, a URL com o id nem o corpo da resposta.
 */
function lerConteudo(id: string): string {
  const url = `${ENDPOINT_DO_DRIVE}${encodeURIComponent(id)}?alt=media`;
  const parametros: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
    method: 'get',
    headers: { Authorization: `Bearer ${ScriptApp.getOAuthToken()}` },
    muteHttpExceptions: true,
    // Redirecionamento não é seguido: o token só vai ao Drive, e 302 vira erro.
    followRedirects: false,
  };
  let resposta: GoogleAppsScript.URL_Fetch.HTTPResponse;
  try {
    resposta = UrlFetchApp.fetch(url, parametros);
  } catch {
    // A mensagem original pode trazer a URL com o id: não segue adiante.
    throw new Error('Leitura do Drive falhou na rede');
  }
  const status = resposta.getResponseCode();
  if (status !== 200) throw new Error(`Leitura do Drive respondeu HTTP ${status}`);
  // Gravado em UTF-8 (Utilities.newBlob): lido em UTF-8.
  return resposta.getContentText('UTF-8');
}

function procurar(consulta: string) {
  const { files } = drive().Files.list({ q: consulta, fields: 'files(id,name)', pageSize: 1000 });
  return (files ?? []).filter((arquivo) => arquivo.id && arquivo.name) as { id: string; name: string }[];
}

/**
 * Id do arquivo principal: guardado nas propriedades, ou achado pelo nome.
 * Lança (vira `interno`, nada é gravado) se o guardado foi para a lixeira ou
 * se há mais de um com o nome: o dono decide qual vale, o script não adivinha.
 * `guardar`: a sincronia guarda o id achado pelo nome; as funções do editor
 * (autorizarDrive, diagnosticarDrive) só olham, sem mudar propriedades.
 */
function idDoArquivo({ guardar = true }: { guardar?: boolean } = {}): string | null {
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
  if (guardar) propriedades().setProperty(CHAVE_DO_ARQUIVO, achado.id);
  return achado.id;
}

const armazem: Armazem = {
  ler() {
    const id = idDoArquivo();
    // Id guardado que não abre lança aqui (vira `interno`): nunca se cria um
    // arquivo vazio no lugar dos dados do dono.
    return id === null ? null : lerConteudo(id);
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

/**
 * Serviço avançado do Google Agenda (Calendar API v3, R9). Os escopos do
 * manifesto limitam o que ele pode: ler a lista de agendas e os eventos, e
 * gravar só em agendas do próprio dono (o app grava só na principal).
 */
function calendario(): ServicoDeAgenda {
  if (typeof Calendar === 'undefined' || !Calendar) throw new Error('Serviço avançado do Google Agenda desligado');
  return Calendar as unknown as ServicoDeAgenda;
}

/**
 * Serviço avançado do Google Tarefas (Tasks API v1), com o escopo tasks: o
 * script só mexe na lista "Central", que ele mesmo cria (tarefas-google.ts).
 */
function tarefasGoogle(): ServicoDeTarefas {
  if (typeof Tasks === 'undefined' || !Tasks) throw new Error('Serviço avançado do Google Tarefas desligado');
  return Tasks as unknown as ServicoDeTarefas;
}

/**
 * Serviço avançado do Gmail (API v1, R11), com o escopo gmail.readonly: o
 * Google recusa qualquer pedido que mude, envie ou apague. email.ts usa só a
 * busca e a leitura de conversas em metadados.
 */
function gmail(): ServicoDeGmail {
  if (typeof Gmail === 'undefined' || !Gmail) throw new Error('Serviço avançado do Gmail desligado');
  return Gmail as unknown as ServicoDeGmail;
}

const CHAVE_DOS_EMAILS = 'EMAILS_POR_RESPONDER';
/** Hora (ms) da última lista gravada: o limite de 60 s do botão "Atualizar agora". */
const CHAVE_DA_HORA_DOS_EMAILS = 'EMAILS_ATUALIZADOS_EM';
/** 6 h, o máximo do cache. O gatilho de 30 min renova muito antes. */
const SEGUNDOS_DOS_EMAILS = 6 * 60 * 60;
/** Nome da função global que o gatilho chama (a exportada abaixo). */
const FUNCAO_DO_GATILHO = 'atualizarEmails';
const MINUTOS_DO_GATILHO = 30;

/**
 * A lista de e-mails fica no cache do script, e não num arquivo do Drive:
 * nenhuma cópia dura dos remetentes, assuntos e trechos fica guardada (some
 * sozinha em 6 h se o gatilho parar), não há arquivo novo no Drive do dono
 * nem leitura de rede a cada pedido, e o valor cabe no limite de 100 KB
 * (email.ts corta em 90 KB). Se o cache perder a lista, a ação `emails` lê
 * o Gmail na hora.
 */
function cacheExigido() {
  const cache = cacheDoScript();
  if (!cache) throw new Error('sem cache');
  return cache;
}

const emailsGuardados: GuardaDeEmails = {
  ler: () => cacheDoScript()?.get(CHAVE_DOS_EMAILS) ?? null,
  gravar(texto) {
    cacheExigido().put(CHAVE_DOS_EMAILS, texto, SEGUNDOS_DOS_EMAILS);
  },
  atualizadoEm() {
    const texto = cacheDoScript()?.get(CHAVE_DA_HORA_DOS_EMAILS);
    return typeof texto === 'string' && /^\d{1,16}$/.test(texto) ? Number(texto) : null;
  },
  marcarAtualizado(ms) {
    cacheExigido().put(CHAVE_DA_HORA_DOS_EMAILS, String(ms), SEGUNDOS_DOS_EMAILS);
  },
  apagar() {
    const cache = cacheExigido();
    cache.remove(CHAVE_DOS_EMAILS);
    cache.remove(CHAVE_DA_HORA_DOS_EMAILS);
  },
};

const ambiente: Ambiente = {
  lerCodigo,
  armazem,
  calendario,
  gmail,
  tarefasGoogle,
  emailsGuardados,
};

export function doPost(evento?: GoogleAppsScript.Events.DoPost) {
  const resposta = tratarCorpo(evento?.postData?.contents, ambiente);
  return ContentService.createTextOutput(JSON.stringify(resposta)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

function provaDoDrive(): string {
  const id = idDoArquivo({ guardar: false });
  if (id === null) {
    return 'Permissão do Drive aprovada. O arquivo central-dados.json será criado na primeira sincronia.';
  }
  let leitura: string;
  try {
    leitura = `leitura pela API do Drive: ok, ${lerConteudo(id).length} caracteres`;
  } catch (erro) {
    leitura = `leitura pela API do Drive falhou (${resumoDoErro(erro)})`;
  }
  return `Permissão do Drive aprovada. O arquivo central-dados.json já existe; ${leitura}.`;
}

/** Lê a lista de agendas e os eventos de hoje da principal. Só contagens: nenhum nome, id ou título. */
function provaDaAgenda(): string {
  try {
    const { agendas } = provarAgenda(calendario(), Date.now());
    return `Permissão do Google Agenda aprovada: ${agendas} ${agendas === 1 ? 'agenda' : 'agendas'} para ler; leitura de eventos: ok.`;
  } catch (erro) {
    return `Google Agenda falhou (${resumoDoErro(erro)}). Rode autorizarDrive de novo e aprove o Google Agenda.`;
  }
}

/** Lê as listas do Google Tarefas. Só contagem: nenhum nome nem id. */
function provaDasTarefas(): string {
  try {
    const { listas, temCentral } = provarTarefas(tarefasGoogle());
    const central = temCentral ? 'a lista Central já existe' : 'a lista Central será criada na primeira tarefa';
    return `Permissão do Google Tarefas aprovada: ${listas} ${listas === 1 ? 'lista' : 'listas'}; ${central}.`;
  } catch (erro) {
    return `Google Tarefas falhou (${resumoDoErro(erro)}). Rode autorizarDrive de novo e aprove o Google Tarefas.`;
  }
}

/**
 * O dono roda pelo editor depois de publicar uma versão com permissão nova: o
 * Google pede todas as permissões do manifesto (arquivos do Drive criados por
 * este script, chamada externa usada só para ler esse arquivo, Google Agenda e
 * Google Tarefas). Usa cada uma: procura e lê o arquivo de dados, lê a lista de
 * agendas e os eventos de hoje, lê as listas de tarefas. Não grava nada (nem
 * evento, nem tarefa), não troca o código do aparelho e registra só tamanhos,
 * contagens e status.
 */
export function autorizarDrive() {
  ScriptApp.getOAuthToken();
  Logger.log([provaDoDrive(), provaDaAgenda(), provaDasTarefas()].join('\n'));
}

function porResponder(quantos: number): string {
  return `${quantos} ${quantos === 1 ? 'e-mail' : 'e-mails'} por responder`;
}

/** Lê o Gmail, troca a lista do cache e mede o tempo. Lança se o Gmail falhar. */
function atualizarMedindo(): { quantos: number; ms: number } {
  const inicio = Date.now();
  const lista = atualizarListaDeEmails(gmail(), emailsGuardados);
  return { quantos: lista.length, ms: Date.now() - inicio };
}

/**
 * Chamada pelo gatilho de 30 min (ver autorizarGmail); o dono também pode
 * rodar pelo editor. Registra o tempo gasto e a contagem, para somar as
 * execuções do dia contra o limite de 90 min dos gatilhos. Nunca registra
 * nome, endereço, assunto ou trecho. Se o Gmail falhar, a lista anterior fica
 * e a execução falha com a mensagem já limpa (aparece em Execuções).
 */
export function atualizarEmails() {
  let medida: { quantos: number; ms: number };
  try {
    medida = atualizarMedindo();
  } catch (erro) {
    const resumo = resumoDoErro(erro);
    console.error(`Central: falha em atualizarEmails: ${resumo}`);
    throw new Error(partesDoResumo(resumo));
  }
  console.log(`Central: e-mails atualizados em ${medida.ms} ms: ${porResponder(medida.quantos)}.`);
}

/** "FalhaDoGmail: Gmail (…): motivo" -> "Gmail (…): motivo". */
function partesDoResumo(resumo: string): string {
  const corte = resumo.indexOf(': ');
  return corte >= 0 ? resumo.slice(corte + 2) : resumo;
}

/** Um só gatilho de tempo para atualizarEmails: cria se faltar, apaga os repetidos. */
function ligarGatilho(): string {
  const nossos = ScriptApp.getProjectTriggers().filter((g) => g.getHandlerFunction() === FUNCAO_DO_GATILHO);
  if (nossos.length === 0) {
    ScriptApp.newTrigger(FUNCAO_DO_GATILHO).timeBased().everyMinutes(MINUTOS_DO_GATILHO).create();
    return `Atualização automática a cada ${MINUTOS_DO_GATILHO} minutos: ligada.`;
  }
  for (const repetido of nossos.slice(1)) ScriptApp.deleteTrigger(repetido);
  return `Atualização automática a cada ${MINUTOS_DO_GATILHO} minutos: já estava ligada.`;
}

/**
 * O dono roda pelo editor depois de publicar a versão com o Gmail: o Google
 * pede as permissões novas (ler o Gmail e criar o gatilho do script). Lê o
 * Gmail uma vez, guarda a lista e liga o gatilho de 30 min. Rodar de novo
 * não duplica o gatilho. Registra só contagem e tempo; não grava no Drive,
 * não troca o código do aparelho e nunca muda nada no Gmail.
 */
export function autorizarGmail() {
  ScriptApp.getOAuthToken();
  let medida: { quantos: number; ms: number };
  try {
    medida = atualizarMedindo();
  } catch (erro) {
    Logger.log(`Gmail falhou (${resumoDoErro(erro)}). Rode autorizarGmail de novo e aprove a leitura do Gmail.`);
    return;
  }
  Logger.log(
    [`Permissão do Gmail aprovada: ${porResponder(medida.quantos)}.`, `Leitura levou ${medida.ms} ms.`, ligarGatilho()].join(
      '\n',
    ),
  );
}

function jsonAbre(texto: string): string {
  try {
    JSON.parse(texto);
    return 'JSON.parse: ok';
  } catch {
    return 'JSON.parse: falhou';
  }
}

/** Tipo e tamanho de um texto, e se o JSON abre. Nunca o texto. */
function medir(texto: string): string {
  return `${texto.length} caracteres, ${jsonAbre(texto)}`;
}

/**
 * O dono roda pelo editor quando a sincronia falha. Mostra no registro se o
 * arquivo de dados existe, seu tamanho e tipo, e o resultado da leitura pela
 * API do Drive: tamanho em caracteres e se o JSON abre, ou o status HTTP.
 * Nunca registra o conteúdo, ids nem o token, e não grava nada.
 */
export function diagnosticarDrive() {
  const linhas = ['Diagnóstico do Drive (sem conteúdo nem ids):'];
  let id: string | null;
  try {
    id = idDoArquivo({ guardar: false });
  } catch (erro) {
    Logger.log(`${linhas[0]}\nNão consegui localizar o arquivo de dados (${resumoDoErro(erro)}).`);
    return;
  }
  if (id === null) {
    Logger.log(`${linhas[0]}\nO arquivo ${NOME_DO_ARQUIVO} ainda não existe.`);
    return;
  }
  try {
    const meta = drive().Files.get(id, { fields: 'size,mimeType' });
    linhas.push(`Arquivo: existe; tamanho no Drive: ${meta.size ?? '?'} bytes; tipo: ${meta.mimeType ?? '?'}`);
  } catch (erro) {
    linhas.push(`Arquivo: metadados falharam (${resumoDoErro(erro)})`);
  }
  try {
    linhas.push(`Leitura pela API do Drive: ok, ${medir(lerConteudo(id))}`);
  } catch (erro) {
    linhas.push(`Leitura pela API do Drive: falhou (${resumoDoErro(erro)})`);
  }
  Logger.log(linhas.join('\n'));
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
