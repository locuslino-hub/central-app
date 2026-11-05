import { describe, expect, it } from 'vitest';
import { enderecoAceito, lerConexao, salvarConexao } from '../../src/conexao/guarda';

const URL_FICTICIA = 'https://script.google.com/macros/s/ID-FICTICIO/exec';
const CONEXAO = { url: URL_FICTICIA, codigo: 'codigo-ficticio-de-teste-0123456789abcdef' };

describe('enderecoAceito', () => {
  it.each([
    [URL_FICTICIA],
    ['https://script.google.com/a/macros/exemplo.org/s/ID-FICTICIO/exec'],
    ['HTTPS://SCRIPT.GOOGLE.COM/macros/s/ID-FICTICIO/exec'],
  ])('aceita %s', (url) => {
    expect(enderecoAceito(url)).toBe(true);
  });

  it.each([
    ['vazio', ''],
    ['não é endereço', 'script.google.com/macros'],
    ['sem criptografia', 'http://script.google.com/macros/s/ID-FICTICIO/exec'],
    ['outro site', 'https://exemplo.invalid/macros/s/ID-FICTICIO/exec'],
    ['domínio parecido', 'https://script.google.com.exemplo.invalid/macros/s/ID-FICTICIO/exec'],
    ['subdomínio parecido', 'https://xscript.google.com/macros/s/ID-FICTICIO/exec'],
    ['usuário no endereço', 'https://script.google.com@exemplo.invalid/macros/s/ID-FICTICIO/exec'],
    ['usuário antes do domínio certo', 'https://nome@script.google.com/macros/s/ID-FICTICIO/exec'],
    ['senha antes do domínio certo', 'https://:senha@script.google.com/macros/s/ID-FICTICIO/exec'],
    ['porta diferente', 'https://script.google.com:8443/macros/s/ID-FICTICIO/exec'],
    ['raiz do site', 'https://script.google.com/'],
    ['painel do Apps Script', 'https://script.google.com/home'],
    ['sem /exec', 'https://script.google.com/macros/s/ID-FICTICIO'],
    ['versão de teste /dev', 'https://script.google.com/macros/s/ID-FICTICIO/dev'],
    ['barra no fim', 'https://script.google.com/macros/s/ID-FICTICIO/exec/'],
    ['caminho a mais', 'https://script.google.com/macros/s/ID-FICTICIO/exec/mais'],
    ['prefixo no caminho', 'https://script.google.com/outra/macros/s/ID-FICTICIO/exec'],
    ['id com ponto', 'https://script.google.com/macros/s/ID.FICTICIO/exec'],
    ['id com barra codificada', 'https://script.google.com/macros/s/ID%2Foutro/exec'],
    ['subindo pastas', 'https://script.google.com/macros/s/../../outra/exec'],
    ['domínio faltando em /a/macros', 'https://script.google.com/a/macros/s/ID-FICTICIO/exec'],
  ])('recusa %s', (_nome, url) => {
    expect(enderecoAceito(url)).toBe(false);
  });
});

describe('guarda da conexão', () => {
  it('sem nada salvo, lê null', async () => {
    expect(await lerConexao()).toBeNull();
  });

  it('devolve o que foi salvo', async () => {
    await salvarConexao(CONEXAO);
    expect(await lerConexao()).toEqual(CONEXAO);
  });

  it('salvar de novo substitui a conexão', async () => {
    await salvarConexao(CONEXAO);
    await salvarConexao({ ...CONEXAO, codigo: 'outro-codigo-ficticio-0123456789abcdef' });
    expect((await lerConexao())?.codigo).toBe('outro-codigo-ficticio-0123456789abcdef');
  });

  it('recusa endereço fora do Google e não guarda nada', async () => {
    await expect(
      salvarConexao({ ...CONEXAO, url: 'https://exemplo.invalid/exec' }),
    ).rejects.toThrow();
    expect(await lerConexao()).toBeNull();
  });

  it('fica num banco só seu, separado dos dados', async () => {
    await salvarConexao(CONEXAO);
    const bancos = await indexedDB.databases();
    expect(bancos.map((banco) => banco.name)).toEqual(['central-conexao']);
  });
});
