import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErroConexao, ErroScript } from '../../src/conexao/cliente';
import { atualizarEmails, emailValido, esquecerEmails, lerEmails, linkSeguro } from '../../src/dados/emails';
import { listar } from '../../src/dados/loja';
import { email, gmailDeTeste } from '../apoio/emails-ui';

const AGORA = Date.parse('2026-11-05T12:20:00Z');

beforeEach(() => {
  esquecerEmails();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AGORA);
});

describe('leitura dos e-mails', () => {
  it('lê a lista guardada pelo script ao abrir e o botão pede a atualização', async () => {
    const gmail = await gmailDeTeste([email('Relatório')]);
    const aberta = await atualizarEmails();
    expect(aberta.emails.map((e) => e.assunto)).toEqual(['Relatório']);
    expect(aberta.falha).toBeNull();
    expect(aberta.lidoEm).toBe(AGORA);
    expect(gmail.de('emails')).toHaveLength(1);
    expect(gmail.de('atualizarEmails')).toHaveLength(0);

    await atualizarEmails(true);
    expect(gmail.de('atualizarEmails')).toHaveLength(1);
  });

  it('pedidos juntos viram uma chamada só; o botão durante uma leitura comum espera e pede a dele', async () => {
    const gmail = await gmailDeTeste([email('A')]);
    const [um, dois] = await Promise.all([atualizarEmails(), atualizarEmails()]);
    expect(um).toBe(dois);
    expect(gmail.pedidos.filter((p) => p.acao === 'emails')).toHaveLength(1);

    const comum = atualizarEmails();
    const botao = atualizarEmails(true);
    await Promise.all([comum, botao]);
    expect(gmail.de('atualizarEmails')).toHaveLength(1);
  });

  it('deixa de fora o que não tem a forma de e-mail, repetidos e link que não é de página web', async () => {
    const bom = email('Bom');
    await gmailDeTeste([
      bom,
      bom,
      email('Link perigoso', { link: 'javascript:alert(1)' }),
      email('Link de dados', { link: 'data:text/html,<b>oi</b>' }),
      email('Link de outro site', { link: 'https://exemplo.invalid/mail/u/0/#all/abc' }),
      email('Link sem https', { link: 'http://mail.google.com/mail/u/0/#all/abc' }),
      email('Id estranho', { id: 'a/b' }),
      { ...email('Sem remetente'), remetente: 7 },
      'texto solto',
      null,
    ]);
    const lida = await atualizarEmails();
    expect(lida.emails.map((e) => e.assunto)).toEqual(['Bom']);
  });

  it('resposta que não é lista é falha, e a lista que estava na tela fica', async () => {
    const gmail = await gmailDeTeste([email('A')]);
    await atualizarEmails();
    gmail.responder({ nao: 'lista' });
    const falhou = await atualizarEmails(true);
    expect(falhou.falha).toBe('falhou');
    expect(falhou.emails.map((e) => e.assunto)).toEqual(['A']);
  });

  it('só copia os campos do e-mail: nada a mais entra na memória', async () => {
    await gmailDeTeste([{ ...email('A'), corpo: 'segredo', destinatario: 'dono@exemplo.invalid' }]);
    const [lido] = (await atualizarEmails()).emails;
    expect(Object.keys(lido).sort()).toEqual(['assunto', 'data', 'enderecoRemetente', 'id', 'link', 'remetente', 'trecho']);
  });

  it('não conectado: diz isso, sem chamar o script', async () => {
    const gmail = await gmailDeTeste([email('A')], { conectar: false });
    const lida = await atualizarEmails();
    expect(lida.falha).toBe('nao-conectado');
    expect(gmail.pedidos).toHaveLength(0);
  });

  it('sem internet', async () => {
    const gmail = await gmailDeTeste();
    gmail.falharCom('rede');
    expect((await atualizarEmails()).falha).toBe('sem-internet');
  });

  it('código inválido com o ping funcionando: o Gmail ainda não foi liberado no script', async () => {
    const gmail = await gmailDeTeste();
    gmail.falharCom({ ok: false, erro: 'codigo-invalido' });
    expect((await atualizarEmails()).falha).toBe('nao-liberada');
    expect(gmail.de('ping')).toHaveLength(1);
  });

  it('código inválido também no ping: o código deste aparelho não vale mais', async () => {
    const gmail = await gmailDeTeste();
    gmail.falharCom({ ok: false, erro: 'codigo-invalido' });
    gmail.ping({ ok: false, erro: 'codigo-invalido' });
    expect((await atualizarEmails()).falha).toBe('codigo');
  });

  it('erro do script (ocupado, interno) é falha simples; sem ping', async () => {
    const gmail = await gmailDeTeste();
    gmail.falharCom({ ok: false, erro: 'ocupado' });
    expect((await atualizarEmails()).falha).toBe('falhou');
    expect(gmail.de('ping')).toHaveLength(0);
  });

  it('usa as dependências passadas (sem rede)', async () => {
    const lida = await atualizarEmails(false, {
      conectado: async () => true,
      buscar: async () => [email('Injetado')],
      agora: () => 42,
    });
    expect(lida.lidoEm).toBe(42);
    expect(lerEmails().emails).toHaveLength(1);
    const erro = await atualizarEmails(false, {
      conectado: async () => true,
      buscar: async () => {
        throw new ErroConexao();
      },
    });
    expect(erro.falha).toBe('sem-internet');
    const script = await atualizarEmails(false, {
      conectado: async () => true,
      buscar: async () => {
        throw new ErroScript('interno');
      },
    });
    expect(script.falha).toBe('falhou');
  });

  it('o assunto, o trecho e o endereço ficam só na memória: nada no IndexedDB nem no localStorage', async () => {
    await gmailDeTeste([email('Assunto secreto', { trecho: 'Trecho secreto', enderecoRemetente: 'quem@exemplo.invalid' })]);
    await atualizarEmails();
    const colecoes = ['salas', 'pessoas', 'tarefas', 'palavras', 'documentos', 'paginas', 'estadosEmail', 'rascunhos', 'config'] as const;
    const tudo = JSON.stringify(await Promise.all(colecoes.map((c) => listar(c, { comApagados: true }))));
    expect(tudo).not.toContain('secreto');
    expect(tudo).not.toContain('quem@');
    expect(JSON.stringify({ ...localStorage })).not.toContain('secreto');
  });
});

describe('conferências', () => {
  it('linkSeguro aceita só https://mail.google.com/', () => {
    expect(linkSeguro('https://mail.google.com/mail/u/0/#all/abc')).toBe(true);
    for (const ruim of [
      'http://mail.google.com/mail/u/0/#all/abc',
      'https://exemplo.invalid/',
      'https://mail.google.com.exemplo.invalid/mail',
      'https://mail.google.com@exemplo.invalid/',
      'https://exemplo.invalid/https://mail.google.com/',
      'https://mail.google.com',
      'javascript:alert(1)',
      'data:text/html,x',
      'file:///etc/passwd',
      '//mail.google.com/',
      'https://mail.google.com/a b',
      '',
    ]) {
      expect(linkSeguro(ruim)).toBe(false);
    }
  });

  it('emailValido pede a data com fuso e o id sem barras', () => {
    expect(emailValido(email('A'))).toBe(true);
    expect(emailValido({ ...email('A'), data: 'ontem' })).toBe(false);
    expect(emailValido({ ...email('A'), id: '' })).toBe(false);
  });
});
