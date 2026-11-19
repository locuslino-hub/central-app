// Pontos de entrada do Apps Script. Cada função exportada aqui vira uma função
// global no pacote (ver build.mjs). O resto fica em api.ts e dados.ts, sem serviços do Google.
import { CAMPOS_EXTRAS, diagnosticarEventos, hojeEmLisboa, provarAgenda, type CampoExtra, type ServicoDeAgenda } from './agenda';
import { novoCodigo, resumoDoErro, tratarCorpo, type Ambiente } from './api';
import type { ServicoDeAudios } from './audio';
import { SemAcesso, type CelulaNova, type ServicoDePlanilhas } from './planilhas';
import { NOME_DO_ARQUIVO, Ocupado, type Armazem } from './dados';
import { AvisoDeOrganizacao, codigoDoAviso, organizarPastaCentral as organizarArquivosAntigos, pastaCentral, type ServicoDeOrganizacao, type ServicoDePastas } from './pasta-central';
import { TIPO_PLANILHA, eAusenciaNoDrive, planilhaNaPasta } from './drive';
import { atualizarEmails as atualizarListaDeEmails, type GuardaDeEmails, type ServicoDeGmail } from './email';
import { diagnosticarTarefas, provarTarefas, type GuardaDeTarefas, type ServicoDeTarefas } from './tarefas-google';

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

// Serviço avançado do Drive (v3). Até a V1 o escopo era só drive.file; a V02
// passou a `drive` (pasta Central, que o dono pode mexer à mão). Tudo o que o
// script guarda no Drive fica na pasta "Central" do Meu Drive: o arquivo de
// dados e as cópias diárias dentro dela, "Audios" e "Casa (partilhada)" como
// subpastas. O arquivo de dados é achado pelo id guardado ou pelo nome, em
// qualquer lugar (o de antes da pasta Central, na raiz, continua valendo).
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
  // Gravado em UTF-8 (Utilities.newBlob): lido em UTF-8.
  return baixarDoDrive(id).getContentText('UTF-8');
}

/** O arquivo inteiro, pela mesma API REST de `lerConteudo` (HTTP 200 ou erro sem detalhes). */
function baixarDoDrive(id: string): GoogleAppsScript.URL_Fetch.HTTPResponse {
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
  return resposta;
}

function procurar(consulta: string, campos = 'files(id,name)') {
  const { files } = drive().Files.list({ q: consulta, fields: campos, pageSize: 1000 });
  return (files ?? []).filter((arquivo) => arquivo.id && arquivo.name) as { id: string; name: string; parents?: string[] }[];
}

/** Nome de pasta na consulta: sem aspas, barra invertida nem controle (os nomes de pasta são fixos). */
const NOME_DE_PASTA_SEGURO = /^[^'"\\\u0000-\u001f\u007f]{1,100}$/;

/**
 * Pastas do dono (só do dono: nada compartilhado por outra pessoa com o mesmo
 * nome). Usado por `pastaCentral` (pasta-central.ts) em áudios, planilhas e dados.
 */
const pastasDoDrive: ServicoDePastas = {
  procurarPasta(nome, paiId) {
    if (!NOME_DE_PASTA_SEGURO.test(nome) || !(paiId === 'root' || ID_DO_DRIVE.test(paiId))) throw new Error('Nome de busca inválido');
    const consulta = `name = '${nome}' and '${paiId}' in parents and mimeType = '${TIPO_PASTA}' and 'me' in owners and trashed = false`;
    return procurar(consulta).map(({ id }) => ({ id }));
  },
  criarPasta(nome, paiId) {
    return drive().Files.create({ name: nome, mimeType: TIPO_PASTA, parents: [paiId] }).id as string;
  },
};

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
      throw new AvisoDeOrganizacao('dados_na_lixeira', 'Arquivo de dados na lixeira');
    }
    return guardado;
  }
  // Só do dono: um arquivo de mesmo nome compartilhado por outra pessoa não conta.
  const achados = procurar(`name = '${NOME_DO_ARQUIVO}' and 'me' in owners and trashed = false`);
  if (achados.length > 1) throw new AvisoDeOrganizacao('dados_duplicados', 'Mais de um arquivo de dados');
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
    // Arquivo novo nasce em "Central" (criada se faltar; duas "Central" = erro, nada é gravado).
    const pai = pastaCentral(pastasDoDrive, { criar: true });
    const criado = drive().Files.create({ name: NOME_DO_ARQUIVO, mimeType: TIPO_JSON, parents: [pai] }, blobJson(conteudo));
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
    drive().Files.create({ name: nome, mimeType: TIPO_JSON, parents: [pastaCentral(pastasDoDrive, { criar: true })] }, blobJson(conteudo));
  },
  registrarFalhaDaCopia(erro) {
    // A cópia é secundária: só a causa resumida (sem ids) vai para o registro e a gravação segue.
    registrarCausa('cópia diária', erro);
  },
  listarCopias: () =>
    procurar("name contains 'central-dados-' and 'me' in owners and trashed = false").map(({ id, name }) => ({ id, nome: name })),
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

/** O que o script já achou no Google Tarefas (lugar e estado das tarefas dos blocos). Sem cache, só lê mais. */
const guardaDeTarefas: GuardaDeTarefas = {
  get: (chave) => cacheDoScript()?.get(chave) ?? null,
  put(chave, valor, segundos) {
    cacheDoScript()?.put(chave, valor, segundos);
  },
  putAll(valores, segundos) {
    cacheDoScript()?.putAll(valores, segundos);
  },
  remove(chave) {
    cacheDoScript()?.remove(chave);
  },
};

/**
 * Campos novos da agenda (label, taskId) que o diagnosticoAgenda viu nesta
 * conta. Gravados por ele; ausentes, a leitura usa só os campos de base.
 */
const CHAVE_DOS_EXTRAS = 'CAMPOS_EXTRAS_DA_AGENDA';

function extrasDaAgenda(): CampoExtra[] {
  const texto = propriedades().getProperty(CHAVE_DOS_EXTRAS) ?? '';
  return CAMPOS_EXTRAS.filter((campo) => texto.split(',').indexOf(campo) >= 0);
}

/**
 * Drive de áudios (V02): pastas e arquivos de "Central/Audios" no Drive do
 * dono, com o escopo drive. Nomes e id chegam já validados (audio.ts) e só
 * entram na consulta entre aspas simples, sem nada que as feche.
 */
const TIPO_PASTA = 'application/vnd.google-apps.folder';
const NOME_SEGURO = /^[\w.\- ]{1,100}$/;
const ID_DO_DRIVE = /^[A-Za-z0-9_-]{1,100}$/;
function audios(): ServicoDeAudios {
  return {
    procurar(nome, paiId, tipo) {
      // Defesa em profundidade: o nome entra numa consulta entre aspas simples.
      if (!NOME_SEGURO.test(nome) || !(paiId === 'root' || ID_DO_DRIVE.test(paiId))) throw new Error('Nome de busca inválido');
      // Só itens do dono: nada compartilhado por outra pessoa com o mesmo nome.
      const filtroDeTipo = tipo === 'pasta' ? `mimeType = '${TIPO_PASTA}'` : `mimeType != '${TIPO_PASTA}'`;
      const consulta = `name = '${nome}' and '${paiId}' in parents and ${filtroDeTipo} and 'me' in owners and trashed = false`;
      return procurar(consulta).map(({ id }) => ({ id }));
    },
    criarPasta(nome, paiId) {
      return drive().Files.create({ name: nome, mimeType: TIPO_PASTA, parents: [paiId] }).id as string;
    },
    criarArquivo(nome, mime, paiId, base64) {
      const blob = Utilities.newBlob(Utilities.base64Decode(base64), mime, nome);
      return drive().Files.create({ name: nome, mimeType: mime, parents: [paiId] }, blob).id as string;
    },
    inspecionar(arquivoId, paiId) {
      if (!ID_DO_DRIVE.test(arquivoId) || !(paiId === 'root' || ID_DO_DRIVE.test(paiId))) throw new Error('Id de leitura inválido');
      let dados;
      try {
        dados = drive().Files.get(arquivoId, { fields: 'id,mimeType,parents,ownedByMe,trashed,size' });
      } catch (erro) {
        // Só "não existe" e "sem acesso" valem como "não está lá". Qualquer outra falha (cota, rede, serviço)
        // sobe e vira `interno`, sem detalhes: não finge que o arquivo não existe.
        if (eAusenciaNoDrive(erro)) return null;
        registrarCausa('inspecionar áudio', erro);
        throw new Error('Leitura do Drive falhou');
      }
      // Só arquivo do dono, fora da lixeira, que não é pasta e está DIRETO nesta pasta.
      if (!dados.ownedByMe || dados.trashed || dados.mimeType === TIPO_PASTA) return null;
      if (!dados.parents || dados.parents.indexOf(paiId) < 0) return null;
      // Sem tamanho informado não se baixa: vira "grande demais".
      return { mime: dados.mimeType ?? '', bytes: dados.size === undefined ? Infinity : Number(dados.size) };
    },
    baixar(arquivoId) {
      if (!ID_DO_DRIVE.test(arquivoId)) throw new Error('Id de leitura inválido');
      return Utilities.base64Encode(baixarDoDrive(arquivoId).getContent());
    },
    lixeira(arquivoId) {
      if (!ID_DO_DRIVE.test(arquivoId)) throw new Error('Id de arquivo inválido');
      drive().Files.update({ trashed: true }, arquivoId);
    },
  };
}

/**
 * Drive e Planilhas da Casa (V02, Tarefa 8), com os escopos drive e
 * spreadsheets. As planilhas ficam em "Central/Casa (partilhada)". planilhas.ts
 * valida id, nomes e limites antes de chamar; a defesa em profundidade se
 * repete aqui. Primeira aba, cabeçalho na linha 1. A planilha é aberta uma vez
 * por ação (`aberta`).
 */
const FORMATO_TEXTO = '@';

/** Só a causa resumida (sem ids, e-mails nem textos entre aspas) vai para o registro. */
function registrarCausa(onde: string, erro: unknown) {
  console.error(`Central: falha em ${onde}: ${resumoDoErro(erro)}`);
}

function planilhas(): ServicoDePlanilhas {
  let aberta: { id: string; aba: GoogleAppsScript.Spreadsheet.Sheet } | null = null;
  function primeiraAba(planilhaId: string) {
    if (aberta && aberta.id === planilhaId) return aberta.aba;
    if (!ID_DO_DRIVE.test(planilhaId)) throw new Error('Id de planilha inválido');
    let planilha: GoogleAppsScript.Spreadsheet.Spreadsheet;
    try {
      planilha = SpreadsheetApp.openById(planilhaId);
    } catch (erro) {
      // Sem detalhes: a mensagem do Google cita o id. Só "sem acesso a este arquivo" tem nome próprio.
      if (eAusenciaNoDrive(erro)) throw new SemAcesso();
      registrarCausa('abrir planilha', erro);
      throw new Error('Abertura da planilha falhou');
    }
    const aba = planilha.getSheets()[0];
    if (!aba) throw new Error('Planilha sem abas');
    aberta = { id: planilhaId, aba };
    return aba;
  }

  /** Garante que a linha existe na grade (a grade do Sheets não cresce sozinha ao gravar fora dela). */
  function garantirLinha(aba: GoogleAppsScript.Spreadsheet.Sheet, linha: number) {
    const total = aba.getMaxRows();
    if (linha > total) aba.insertRowsAfter(total, linha - total);
  }

  /** O valor que vai para a célula: número de verdade só no formato `numero`. */
  const paraCelula = (c: CelulaNova): string | number => (c.formato === 'numero' ? Number(c.valor) : c.valor);

  return {
    ...pastasDoDrive,
    criarPlanilha(nome, paiId, cabecalho, colunaOculta, colunasDeData) {
      const id = drive().Files.create({ name: nome, mimeType: TIPO_PLANILHA, parents: [paiId] }).id as string;
      try {
        const aba = primeiraAba(id);
        aba.getRange(1, 1, 1, cabecalho.length).setValues([[...cabecalho]]).setFontWeight('bold');
        // A coluna do id é texto (um id como "1e5" não vira número) e fica oculta.
        aba.getRange(1, colunaOculta, aba.getMaxRows(), 1).setNumberFormat(FORMATO_TEXTO);
        // Datas em aaaa-mm-dd, igual em qualquer idioma de planilha (o app lê esse texto).
        for (const coluna of colunasDeData) aba.getRange(2, coluna, Math.max(1, aba.getMaxRows() - 1), 1).setNumberFormat('yyyy-mm-dd');
        aba.setFrozenRows(1);
        aba.hideColumns(colunaOculta);
        SpreadsheetApp.flush();
      } catch (erro) {
        registrarCausa('criarPlanilha', erro);
        // Não deixa planilha pela metade: vai para a lixeira (o dono ainda recupera).
        try {
          drive().Files.update({ trashed: true }, id);
        } catch (erroDaLixeira) {
          registrarCausa('criarPlanilha (mandar a planilha incompleta para a lixeira; apague-a à mão na pasta Casa)', erroDaLixeira);
        }
        throw new Error('Criação da planilha falhou');
      }
      return id;
    },
    inspecionar(planilhaId, paiId) {
      if (!ID_DO_DRIVE.test(planilhaId) || !ID_DO_DRIVE.test(paiId)) throw new Error('Id de planilha inválido');
      return planilhaNaPasta(
        () => drive().Files.get(planilhaId, { fields: 'id,mimeType,parents,ownedByMe,trashed' }),
        paiId,
        (erro) => registrarCausa('inspecionar planilha', erro),
      );
    },
    lerValores(planilhaId, limites) {
      const aba = primeiraAba(planilhaId);
      // Lê um pouco além do teto só para a lógica notar que passou dele.
      const linhas = Math.min(aba.getLastRow(), limites.linhas + 2);
      const colunas = Math.min(aba.getLastColumn(), limites.colunas + 1);
      if (linhas < 1 || colunas < 1) return [];
      return aba.getRange(1, 1, linhas, colunas).getDisplayValues();
    },
    lerCelula(planilhaId, linha, coluna) {
      return primeiraAba(planilhaId).getRange(linha, coluna).getDisplayValue();
    },
    escreverLinhaNova(planilhaId, linha, celulas) {
      const aba = primeiraAba(planilhaId);
      // Nunca sobrescreve: se alguém anexou desde a leitura, a ação falha e a fila repete (o id evita duplicar).
      if (aba.getLastRow() >= linha) throw new Error('A linha já tem conteúdo');
      garantirLinha(aba, linha);
      const faixa = aba.getRange(linha, 1, 1, celulas.length);
      let formatos = faixa.getNumberFormats()[0]!;
      // Célula que estava em texto e agora recebe número ou valor livre: volta ao formato geral.
      let limpou = false;
      celulas.forEach((c, i) => {
        if (c.formato !== 'texto' && formatos[i] === FORMATO_TEXTO) {
          aba.getRange(linha, i + 1).clearFormat();
          limpou = true;
        }
      });
      if (limpou) formatos = faixa.getNumberFormats()[0]!;
      // Um setNumberFormats e um setValues para a linha inteira: ou ela entra toda, ou o erro aparece.
      faixa.setNumberFormats([celulas.map((c, i) => (c.formato === 'texto' ? FORMATO_TEXTO : formatos[i]!))]);
      faixa.setValues([celulas.map(paraCelula)]);
      SpreadsheetApp.flush();
      return faixa.getDisplayValues()[0]!;
    },
    escreverCelulas(planilhaId, linha, celulas) {
      const aba = primeiraAba(planilhaId);
      const faixas = celulas.map((c) => aba.getRange(linha, c.coluna));
      celulas.forEach((c, i) => {
        const faixa = faixas[i]!;
        const formato = faixa.getNumberFormat();
        if (c.formato === 'texto') {
          if (formato !== FORMATO_TEXTO) faixa.setNumberFormat(FORMATO_TEXTO);
        } else if (formato === FORMATO_TEXTO) {
          faixa.clearFormat();
        }
        faixa.setValue(paraCelula(c));
      });
      SpreadsheetApp.flush();
      return faixas.map((faixa) => faixa.getDisplayValue());
    },
    escreverIds(planilhaId, coluna, ids) {
      const aba = primeiraAba(planilhaId);
      const primeira = Math.min(...ids.map((i) => i.linha));
      const ultima = Math.max(...ids.map((i) => i.linha));
      const faixa = aba.getRange(primeira, coluna, ultima - primeira + 1, 1);
      // Uma só escrita: as linhas do meio do trecho voltam como estavam (fórmula, se era fórmula).
      const valores = faixa.getValues();
      const formulas = faixa.getFormulas();
      const formatos = faixa.getNumberFormats();
      const novos: unknown[][] = valores.map((v, i) => [formulas[i]![0] ? formulas[i]![0] : v[0]]);
      for (const { linha, id } of ids) {
        novos[linha - primeira] = [id];
        formatos[linha - primeira] = [FORMATO_TEXTO];
      }
      faixa.setNumberFormats(formatos);
      faixa.setValues(novos);
      SpreadsheetApp.flush();
    },
  };
}

const ambiente: Ambiente = {
  lerCodigo,
  audios,
  planilhas,
  novoId: () => Utilities.getUuid(),
  armazem,
  calendario,
  gmail,
  tarefasGoogle,
  emailsGuardados,
  guardaDeTarefas,
  extrasDaAgenda,
  esquecerExtrasDaAgenda: () => propriedades().setProperty(CHAVE_DOS_EXTRAS, ''),
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

/**
 * O que a organização única dos arquivos antigos precisa do Drive (só do dono).
 * Nada é apagado: só se move de pasta, e mover mantém o compartilhamento.
 */
function organizacao(): ServicoDeOrganizacao {
  return {
    ...pastasDoDrive,
    arquivoDeDados() {
      // Só olha: o id guardado, ou o achado pelo nome, sem mudar propriedades.
      const id = idDoArquivo({ guardar: false });
      if (id === null) return null;
      if (!ID_DO_DRIVE.test(id)) throw new Error('Id do arquivo de dados inválido');
      const dados = drive().Files.get(id, { fields: 'id,parents,ownedByMe,trashed' });
      if (dados.trashed) throw new AvisoDeOrganizacao('dados_na_lixeira', 'Arquivo de dados na lixeira');
      return { id, pais: dados.parents ?? [], doDono: dados.ownedByMe === true };
    },
    copias() {
      const consulta = "name contains 'central-dados-' and 'me' in owners and trashed = false";
      return procurar(consulta, 'files(id,name,parents)').map(({ id, name, parents }) => ({ id, nome: name, pais: parents ?? [] }));
    },
    mover(id, paiNovoId) {
      if (!ID_DO_DRIVE.test(id) || !ID_DO_DRIVE.test(paiNovoId)) throw new Error('Id de arquivo inválido');
      const atual = drive().Files.get(id, { fields: 'id,parents,ownedByMe,trashed' });
      // Só o que é do dono e não está na lixeira.
      if (atual.ownedByMe !== true || atual.trashed) throw new Error('Item não é do dono ou está na lixeira');
      const pais = atual.parents ?? [];
      if (pais.indexOf(paiNovoId) >= 0) return;
      const opcoes: { addParents: string; removeParents?: string } = { addParents: paiNovoId };
      if (pais.length > 0) opcoes.removeParents = pais.join(',');
      drive().Files.update({}, id, null as unknown as GoogleAppsScript.Base.Blob, opcoes);
    },
  };
}

/**
 * Passo único para quem já tinha arquivos antes da pasta Central: cria
 * "Central" se faltar e move para ela o arquivo de dados, as cópias diárias e a
 * pasta "Casa (partilhada)" que estavam na raiz do Meu Drive (ver
 * pasta-central.ts). Na trava, para não competir com a sincronia. Falha aqui
 * nunca lança: vai para o registro (só contagens e causas, sem ids nem nomes).
 */
function organizarArquivos(): void {
  try {
    armazem.comTrava(() => organizarArquivosAntigos(organizacao(), (linha) => console.log(linha)));
  } catch (erro) {
    const codigo = erro instanceof Ocupado ? 'trava_ocupada' : codigoDoAviso(erro);
    console.log(`Central: AVISO ${codigo}: a organização da pasta Central não rodou (${resumoDoErro(erro)}). Rode organizarPastaCentral de novo.`);
  }
}

/**
 * O dono roda pelo editor para arrumar os arquivos antigos na pasta "Central"
 * (a mesma arrumação que autorizarV02 faz). Pode rodar de novo: não repete nem
 * apaga nada. Se houver "Casa (partilhada)" na raiz e dentro de Central, não
 * mexe em nenhuma e avisa no registro.
 */
export function organizarPastaCentral() {
  organizarArquivos();
}

/**
 * O dono roda uma vez pelo editor depois de publicar a V02: o Google pede as
 * permissões novas do manifesto (Drive completo, para a pasta Central, e
 * Planilhas). Lista um item do Drive e pergunta pela planilha ativa (o script
 * não tem nenhuma). Depois arruma os arquivos antigos na pasta "Central" (ver
 * organizarPastaCentral): é a única coisa que cria pasta ou move arquivo, sem
 * apagar nada, e uma falha ali não impede a autorização de concluir.
 */
export function autorizarV02() {
  ScriptApp.getOAuthToken();
  drive().Files.list({ q: "trashed = false and 'root' in parents", fields: 'files(id)', pageSize: 1 });
  SpreadsheetApp.getActiveSpreadsheet();
  organizarArquivos();
  Logger.log('Permissão V02 aprovada');
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

function diaMais(data: string, dias: number): string {
  const [ano, mes, dia] = data.split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia) + dias * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

type Contagem = ReturnType<typeof diagnosticarEventos>;

function linhaDosEventos(nome: string, c: Contagem): string {
  return (
    `${nome}: eventos: ${c.eventos}; com description de tarefa: ${c.comDescricaoDeTarefa}; com taskId: ${c.comTaskId}; ` +
    `com colorId: ${c.comColorId}; com label: ${c.comLabel}; marcados como disponíveis: ${c.transparentes}; ` +
    `reconhecidos como bloco: ${c.blocos}; blocos em série: ${c.emSerie}; ids de tarefa repetidos: ${c.idsRepetidos}.`
  );
}

/**
 * O dono roda pelo editor para saber o que a API da Agenda devolve nesta
 * conta (blocos do Google Tarefas e cores). Lê os eventos de hoje e dos
 * próximos 7 dias da agenda principal com a resposta inteira da API e busca
 * as tarefas dos blocos no Google Tarefas. Registra só contagens e nomes de
 * campos: nunca títulos, ids, e-mails nem descrições. Se a API devolve
 * `label` ou `taskId`, liga a leitura deles (guardado nas propriedades do
 * script); não grava mais nada.
 */
export function diagnosticoAgenda() {
  const linhas = ['Diagnóstico da Agenda (só contagens, sem títulos, ids nem descrições):'];
  const hoje = hojeEmLisboa(Date.now());
  const ate = diaMais(hoje, 7);
  let ids: string[] = [];
  const vistos = new Set<CampoExtra>(extrasDaAgenda());
  try {
    const doDia = diagnosticarEventos(calendario(), hoje, hoje);
    const daSemana = diagnosticarEventos(calendario(), hoje, ate);
    ids = daSemana.idsDasTarefas;
    linhas.push(linhaDosEventos('Hoje', doDia));
    linhas.push(linhaDosEventos('Hoje e próximos 7 dias', daSemana));
    const tipos = Object.keys(daSemana.tipos)
      .sort()
      .map((tipo) => `${tipo} ${daSemana.tipos[tipo]}`);
    linhas.push(`Tipos de evento: ${tipos.join(', ') || 'nenhum'}.`);
    linhas.push(`Campos vistos: ${daSemana.campos.join(', ') || 'nenhum'}.`);
    if (daSemana.comLabel > 0) linhas.push(`Campos da etiqueta (label): ${daSemana.camposDaEtiqueta.join(', ') || 'nenhum'}.`);
    if (daSemana.comLabel > 0) vistos.add('label');
    if (daSemana.comTaskId > 0) vistos.add('taskId');
  } catch (erro) {
    linhas.push(`Google Agenda falhou (${resumoDoErro(erro)}).`);
  }
  try {
    const t = diagnosticarTarefas(ids, { de: hoje, ate }, tarefasGoogle());
    linhas.push(
      `Google Tarefas: listas: ${t.listas}; blocos de tarefa: ${t.blocos}; achados na leitura do período: ${t.noPeriodo}; ` +
        `achados na busca completa: ${t.naBusca} (pelo link: ${t.peloLink}; pelo id: ${t.peloId}); ` +
        `espelhos da lista Central (saem da agenda): ${t.daCentral}.`,
    );
  } catch (erro) {
    linhas.push(`Google Tarefas falhou (${resumoDoErro(erro)}).`);
  }
  const extras = CAMPOS_EXTRAS.filter((campo) => vistos.has(campo));
  try {
    propriedades().setProperty(CHAVE_DOS_EXTRAS, extras.join(','));
  } catch (erro) {
    linhas.push(`Não consegui guardar os campos novos (${resumoDoErro(erro)}).`);
  }
  linhas.push(`Leitura da etiqueta (label): ${extras.indexOf('label') >= 0 ? 'ligada' : 'desligada'}; leitura do taskId: ${extras.indexOf('taskId') >= 0 ? 'ligada' : 'desligada'}.`);
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
