// Tarefa 18: documentos (links). Nomes fictícios (Marina, Aurora).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  abrirDocumento,
  adicionarDocumento,
  arquivarDocumento,
  tipoDoc,
  validarUrl,
} from '../../src/dados/documentos';
import { lerRegistros, listar, semear } from '../../src/dados/loja';
import type { Documento } from '../../src/dados/tipos';

/** Imita o navegador real: com a feature noopener devolve sempre null; sem ela, a janela. */
const navegadorReal = (_url?: string | URL, _alvo?: string, features?: string) =>
  features?.includes('noopener') ? null : ({ opener: {} } as unknown as Window);

beforeEach(async () => {
  vi.restoreAllMocks();
  await semear();
});

describe('tipoDoc', () => {
  it('reconhece pela extensão no caminho', () => {
    expect(tipoDoc('https://exemplo.invalid/a/relatorio.docx', 'x')).toBe('word');
    expect(tipoDoc('https://exemplo.invalid/a/aula.PPTX?download=1', 'x')).toBe('powerpoint');
    expect(tipoDoc('https://exemplo.invalid/a/notas.xlsx', 'x')).toBe('excel');
    expect(tipoDoc('https://exemplo.invalid/a/artigo.pdf', 'x')).toBe('pdf');
  });

  it('reconhece links copiados pelo OneDrive e SharePoint', () => {
    expect(tipoDoc('https://1drv.ms/w/s!Aurora123', 'x')).toBe('word');
    expect(tipoDoc('https://1drv.ms/p/s!Aurora123', 'x')).toBe('powerpoint');
    expect(tipoDoc('https://1drv.ms/x/s!Aurora123', 'x')).toBe('excel');
    expect(tipoDoc('https://1drv.ms/b/s!Aurora123', 'x')).toBe('pdf');
    expect(tipoDoc('https://exemplo-my.sharepoint.com/:w:/g/personal/marina/Abc', 'x')).toBe('word');
    expect(tipoDoc('https://exemplo-my.sharepoint.com/:p:/g/personal/marina/Abc', 'x')).toBe('powerpoint');
    expect(tipoDoc('https://exemplo-my.sharepoint.com/:x:/g/personal/marina/Abc', 'x')).toBe('excel');
  });

  it('usa o título quando o link não diz nada', () => {
    expect(tipoDoc('https://exemplo.invalid/s/abc', 'Capítulo 2.docx')).toBe('word');
    expect(tipoDoc('https://exemplo.invalid/s/abc', 'Aula 3.pptx')).toBe('powerpoint');
  });

  it('o resto é site', () => {
    expect(tipoDoc('https://exemplo.org/curso', 'Plataforma')).toBe('site');
    expect(tipoDoc('https://exemplo.invalid/docx-guia', 'Guia')).toBe('site');
    expect(tipoDoc('isto não é link', 'x')).toBe('site');
  });
});

describe('validarUrl', () => {
  it('aceita https e tira espaços em volta', () => {
    expect(validarUrl('  https://exemplo.invalid/a?b=1  ')).toBe('https://exemplo.invalid/a?b=1');
  });

  it('recusa o que não for https:', () => {
    for (const texto of [
      'http://exemplo.invalid/a',
      'javascript:alert(1)',
      'data:text/html,oi',
      'file:///C:/a.docx',
      'ftp://exemplo.invalid/a',
      'exemplo.invalid/a',
      '',
      'https://',
      'https://usuario:senha@exemplo.invalid/a',
      'https://exemplo.invalid/a b',
    ]) {
      expect(validarUrl(texto), texto).toBeNull();
    }
  });
});

describe('abrirDocumento', () => {
  const doc = (url: string): Documento => ({
    id: 'd1',
    titulo: 'Capítulo 2',
    url,
    arquivado: false,
    atualizadoEm: 1,
    aparelho: 'a',
  });

  it('abre o link numa janela nova, sem dar acesso à Central, em qualquer aparelho', () => {
    const abrir = vi.spyOn(window, 'open').mockImplementation(navegadorReal);
    for (const aparelho of ['computador', 'tablet', 'celular'] as const) {
      expect(abrirDocumento(doc('https://1drv.ms/w/s!Aurora123'), aparelho)).toBe(true);
    }
    expect(abrir).toHaveBeenCalledTimes(3);
    expect(abrir).toHaveBeenCalledWith('https://1drv.ms/w/s!Aurora123', '_blank');
  });

  it('não abre link que não seja https (veio de outro aparelho)', () => {
    const abrir = vi.spyOn(window, 'open').mockImplementation(navegadorReal);
    expect(abrirDocumento(doc('http://exemplo.invalid/a'), 'computador')).toBe(false);
    expect(abrirDocumento(doc('javascript:alert(1)'), 'computador')).toBe(false);
    expect(abrir).not.toHaveBeenCalled();
  });

  it('diz false quando o navegador bloqueou a janela', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    expect(abrirDocumento(doc('https://exemplo.invalid/a'), 'celular')).toBe(false);
  });
});

describe('adicionarDocumento e arquivarDocumento', () => {
  it('guarda com título limpo, na sala', async () => {
    const r = await adicionarDocumento({
      titulo: '  Capítulo 2  ',
      url: ' https://1drv.ms/w/s!Aurora123 ',
      salaId: 'sala-doutoramento',
    });
    expect(r.ok).toBe(true);
    const [doc] = await listar('documentos');
    expect(doc).toMatchObject({
      titulo: 'Capítulo 2',
      url: 'https://1drv.ms/w/s!Aurora123',
      salaId: 'sala-doutoramento',
      arquivado: false,
    });
    expect(doc.pessoaId).toBeUndefined();
  });

  it('recusa título vazio, link inválido e dono ausente, sem gravar', async () => {
    expect(await adicionarDocumento({ titulo: ' ', url: 'https://exemplo.invalid/a', salaId: 'sala-mba' })).toEqual({
      ok: false,
      erro: 'titulo',
    });
    expect(await adicionarDocumento({ titulo: 'A', url: 'http://exemplo.invalid/a', salaId: 'sala-mba' })).toEqual({
      ok: false,
      erro: 'link',
    });
    expect(await adicionarDocumento({ titulo: 'A', url: 'https://exemplo.invalid/a' })).toEqual({
      ok: false,
      erro: 'dono',
    });
    expect(await listar('documentos')).toHaveLength(0);
  });

  it('arquivar mantém o registro e o Desfazer devolve à caixa', async () => {
    await adicionarDocumento({
      titulo: 'Aula 3',
      url: 'https://exemplo.invalid/a.pptx',
      pessoaId: 'p-marina',
      salaId: 'sala-orientacoes',
    });
    const [doc] = await listar('documentos');
    const entrada = await arquivarDocumento(doc.id);
    expect(entrada?.rotulo).toBe('Documento arquivado: Aula 3');
    expect(((await lerRegistros([{ colecao: 'documentos', id: doc.id }]))[0] as Documento).arquivado).toBe(true);
    await entrada!.reverter();
    const volta = (await lerRegistros([{ colecao: 'documentos', id: doc.id }]))[0] as Documento;
    expect(volta).toMatchObject({ arquivado: false, titulo: 'Aula 3', pessoaId: 'p-marina' });
  });

  it('arquivar o que não existe não faz nada', async () => {
    expect(await arquivarDocumento('nao-existe')).toBeUndefined();
  });
});
