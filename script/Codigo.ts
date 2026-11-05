// Pontos de entrada do Apps Script. Cada função exportada aqui vira uma função
// global no pacote (ver build.mjs). O resto fica em api.ts, sem serviços do Google.
import { novoCodigo, tratarCorpo, type Ambiente } from './api';

const CHAVE_DO_CODIGO = 'CODIGO_DO_APARELHO';

const ambiente: Ambiente = {
  lerCodigo: () => PropertiesService.getScriptProperties().getProperty(CHAVE_DO_CODIGO),
};

export function doPost(evento?: GoogleAppsScript.Events.DoPost) {
  const resposta = tratarCorpo(evento?.postData?.contents, ambiente);
  return ContentService.createTextOutput(JSON.stringify(resposta)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

/** O dono roda uma vez pelo editor. Rodar de novo troca o código. */
export function gerarCodigo() {
  const codigo = novoCodigo(() => Utilities.getUuid());
  PropertiesService.getScriptProperties().setProperty(CHAVE_DO_CODIGO, codigo);
  Logger.log('Código do aparelho (copie e cole na tela Conectar aparelho): ' + codigo);
}
