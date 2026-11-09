// Documentos (Tarefa 18): links guardados numa caixa por sala ou por pessoa.
// A Central só guarda o link; o arquivo fica no OneDrive e nunca é lido nem
// apagado por aqui. Arquivar tira da caixa e não toca no arquivo.
import { desfazer, type Desfazivel } from './desfazer';
import { lerRegistros, salvar } from './loja';
import type { Documento } from './tipos';

export type TipoDoc = 'word' | 'powerpoint' | 'excel' | 'pdf' | 'site';
export type Aparelho = 'computador' | 'tablet' | 'celular';

const EXTENSOES: Record<string, Exclude<TipoDoc, 'site'>> = {
  doc: 'word', docx: 'word', dot: 'word', dotx: 'word', docm: 'word', odt: 'word', rtf: 'word',
  ppt: 'powerpoint', pptx: 'powerpoint', pps: 'powerpoint', ppsx: 'powerpoint', pptm: 'powerpoint', odp: 'powerpoint',
  xls: 'excel', xlsx: 'excel', xlsm: 'excel', csv: 'excel', ods: 'excel',
  pdf: 'pdf',
};

/** O OneDrive e o SharePoint dizem o tipo no caminho: `/:w:/` ou, nos links curtos, `1drv.ms/w/`. */
const LETRAS: Record<string, Exclude<TipoDoc, 'site'>> = { w: 'word', p: 'powerpoint', x: 'excel', b: 'pdf' };

function doNome(nome: string): Exclude<TipoDoc, 'site'> | null {
  const achou = /\.([A-Za-z0-9]{2,5})\s*$/.exec(nome);
  return achou ? (EXTENSOES[achou[1].toLowerCase()] ?? null) : null;
}

/** Que tipo de arquivo o link parece ser. Na dúvida, `site`. */
export function tipoDoc(url: string, titulo: string): TipoDoc {
  let caminho = '';
  let host = '';
  try {
    const u = new URL(url);
    caminho = decodeURIComponent(u.pathname);
    host = u.hostname.toLowerCase();
  } catch {
    return doNome(titulo) ?? 'site';
  }
  const pelaExtensao = doNome(caminho);
  if (pelaExtensao) return pelaExtensao;
  const pasta = /^\/:([wpxb]):\//i.exec(caminho);
  if (pasta && (host.endsWith('sharepoint.com') || host.endsWith('onedrive.live.com'))) return LETRAS[pasta[1].toLowerCase()];
  const curto = /^\/([wpxb])\//i.exec(caminho);
  if (curto && host === '1drv.ms') return LETRAS[curto[1].toLowerCase()];
  return doNome(titulo) ?? 'site';
}

/** O link limpo se for `https:` de verdade; `null` no resto (http, javascript:, data:, sem endereço, com senha). */
export function validarUrl(texto: string): string | null {
  const limpo = texto.trim();
  if (!/^https:\/\/[^\s/?#]/i.test(limpo) || /\s/.test(limpo)) return null;
  try {
    const u = new URL(limpo);
    if (u.protocol !== 'https:' || !u.hostname || u.username || u.password) return null;
    return limpo;
  } catch {
    return null;
  }
}

/**
 * Abre o documento numa janela nova. Prova (PROVAS.md): o link copiado pelo
 * OneDrive abre no Word e no PowerPoint do notebook. No celular e no tablet
 * ainda não foi provado; o jeito é o mesmo até a prova da Tarefa 22 dizer outra
 * coisa, e `aparelho` já chega aqui para essa troca ficar num lugar só.
 * `false` se o link não vale (nunca abre o que não for https:) ou o navegador bloqueou.
 */
export function abrirDocumento(doc: Pick<Documento, 'url'>, aparelho: Aparelho): boolean {
  void aparelho;
  const url = validarUrl(doc.url);
  if (!url) return false;
  // Sem a feature `noopener` na chamada: com ela o navegador real devolve sempre null e não dá para saber se bloqueou.
  // A página aberta perde o acesso à Central cortando o `opener` logo em seguida.
  const janela = window.open(url, '_blank');
  if (janela) janela.opener = null;
  return janela != null;
}

export type NovoDocumento = { titulo: string; url: string; salaId?: string; pessoaId?: string };
export type ResultadoAdicionar = { ok: true; documento: Documento } | { ok: false; erro: 'titulo' | 'link' | 'dono' };

export const TITULO_DO_DOCUMENTO_NO_MAXIMO = 120;

export async function adicionarDocumento(novo: NovoDocumento): Promise<ResultadoAdicionar> {
  const titulo = novo.titulo.trim().slice(0, TITULO_DO_DOCUMENTO_NO_MAXIMO);
  if (!titulo) return { ok: false, erro: 'titulo' };
  const url = validarUrl(novo.url);
  if (!url) return { ok: false, erro: 'link' };
  if (!novo.salaId && !novo.pessoaId) return { ok: false, erro: 'dono' };
  const documento = await salvar('documentos', {
    titulo,
    url,
    ...(novo.salaId ? { salaId: novo.salaId } : {}),
    ...(novo.pessoaId ? { pessoaId: novo.pessoaId } : {}),
    arquivado: false,
  });
  return { ok: true, documento };
}

async function marcarArquivado(id: string, arquivado: boolean): Promise<Documento | undefined> {
  // Lê de novo: o título e o resto que mudaram em outro aparelho não são regravados por uma cópia velha.
  const [lido] = await lerRegistros([{ colecao: 'documentos', id }]);
  if (!lido || lido.apagado) return undefined;
  const atual = lido as Documento;
  if (atual.arquivado === arquivado) return undefined;
  return salvar('documentos', { ...atual, arquivado });
}

/** Tira da caixa sem apagar nada. Devolve o Desfazer; `undefined` se não havia o que arquivar. */
export async function arquivarDocumento(id: string): Promise<Desfazivel | undefined> {
  const feito = await marcarArquivado(id, true);
  if (!feito) return undefined;
  return desfazer.registrar(`Documento arquivado: ${feito.titulo}`, async () => {
    await marcarArquivado(id, false);
  });
}
