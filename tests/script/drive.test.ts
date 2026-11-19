// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { eAusenciaNoDrive, planilhaNaPasta, type DadosDoArquivo } from '../../script/drive';

const PLANILHA = 'application/vnd.google-apps.spreadsheet';
const dono = (extra: Partial<DadosDoArquivo> = {}): DadosDoArquivo => ({ mimeType: PLANILHA, parents: ['pasta-1'], ownedByMe: true, trashed: false, ...extra });
const falha = (mensagem: string) => () => {
  throw new Error(mensagem);
};

describe('eAusenciaNoDrive: mensagens reais do serviço avançado do Drive', () => {
  it.each([
    'GoogleJsonResponseException: API call to drive.files.get failed with error: File not found: 1AbCdEfGh',
    'API call to drive.files.get failed with error: File not found: abc',
    'Request failed for https://www.googleapis.com returned code 404. Truncated server response: not found',
    'API call to drive.files.get failed with error: The user does not have sufficient permissions for this file.',
    'API call to drive.files.get failed with error: The caller does not have permission to access the file',
    'Request failed returned code 403. Truncated server response: {"error":{"code":403,"message":"The user does not have sufficient permissions for this file."}}',
  ])('ausência: %s', (mensagem) => {
    expect(eAusenciaNoDrive(new Error(mensagem))).toBe(true);
  });

  it.each([
    'API call to drive.files.get failed with error: Request had insufficient authentication scopes.',
    'Request failed returned code 403. Truncated server response: {"error":{"code":403,"message":"Request had insufficient authentication scopes."}}',
    'Exception: You do not have permission to call SpreadsheetApp.openById. Required permissions: https://www.googleapis.com/auth/spreadsheets',
    'API call to drive.files.get failed with error: User Rate Limit Exceeded',
    'Exception: Service invoked too many times for one day: drive.',
    'Service Spreadsheets failed while accessing document with id 1AbC',
    'Address unavailable: https://www.googleapis.com/drive/v3/files',
    'API call to drive.files.get failed with error: Backend Error',
  ])('não é ausência (vira interno): %s', (mensagem) => {
    expect(eAusenciaNoDrive(new Error(mensagem))).toBe(false);
  });

  it('valores que não são erro com mensagem não são ausência', () => {
    expect(eAusenciaNoDrive(null)).toBe(false);
    expect(eAusenciaNoDrive('File not found')).toBe(false);
    expect(eAusenciaNoDrive({ message: 7 })).toBe(false);
  });

  it('aceita objeto com message de texto, mesmo sem herdar de Error (como as exceções do Google)', () => {
    expect(eAusenciaNoDrive({ name: 'GoogleJsonResponseException', message: 'File not found: x' })).toBe(true);
  });
});

describe('planilhaNaPasta', () => {
  const registrar = vi.fn();

  it('aceita planilha do dono, fora da lixeira, direto na pasta', () => {
    expect(planilhaNaPasta(() => dono(), 'pasta-1', registrar)).toBe(true);
  });

  it('aceita quando a pasta é uma entre vários parents', () => {
    expect(planilhaNaPasta(() => dono({ parents: ['outra', 'pasta-1'] }), 'pasta-1', registrar)).toBe(true);
  });

  it.each([
    ['ownedByMe falso', dono({ ownedByMe: false })],
    ['ownedByMe ausente', dono({ ownedByMe: undefined })],
    ['na lixeira', dono({ trashed: true })],
    ['não é planilha', dono({ mimeType: 'application/vnd.google-apps.document' })],
    ['pasta', dono({ mimeType: 'application/vnd.google-apps.folder' })],
    ['sem tipo', dono({ mimeType: undefined })],
    ['sem parents', dono({ parents: undefined })],
    ['parents vazio', dono({ parents: [] })],
    ['em outra pasta', dono({ parents: ['outra'] })],
    ['só dentro de uma subpasta', dono({ parents: ['subpasta-de-pasta-1'] })],
  ])('recusa: %s', (_n, dados) => {
    expect(planilhaNaPasta(() => dados, 'pasta-1', registrar)).toBe(false);
  });

  it('arquivo que não existe vira false, sem registrar falha', () => {
    const r = vi.fn();
    expect(planilhaNaPasta(falha('API call to drive.files.get failed with error: File not found: abc'), 'pasta-1', r)).toBe(false);
    expect(r).not.toHaveBeenCalled();
  });

  it('erro de escopo, cota ou rede sobe como erro sem detalhes e registra a causa', () => {
    const r = vi.fn();
    expect(() => planilhaNaPasta(falha('Request had insufficient authentication scopes. id 1AbCdEfGhIjKlMnOpQrStUv'), 'pasta-1', r)).toThrow(/^Leitura do Drive falhou$/);
    expect(r).toHaveBeenCalledTimes(1);
  });
});
