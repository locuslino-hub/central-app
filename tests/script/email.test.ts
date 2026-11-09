// @vitest-environment node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tratar, type Ambiente } from '../../script/api';
import {
  BUSCA,
  BYTES_NO_MAXIMO,
  CONVERSAS_NO_MAXIMO,
  TRECHO_NO_MAXIMO,
  atualizarEmails,
  buscarEmails,
  lerGuardados,
  lerRemetente,
  limparTrecho,
  linkDaConversa,
  listarEmails,
  type Email,
  type ServicoDeGmail,
} from '../../script/email';
import { armazemNaMemoria } from '../apoio/armazem';
import { AGORA, DIA_MS, gmailFalso, guardaNaMemoria, naoLida, respostaDoDono, type GmailFalso } from '../apoio/gmail';

const CODIGO = 'codigo-ficticio-de-teste-0123456789abcdef';
const CAMPOS = ['assunto', 'data', 'enderecoRemetente', 'id', 'link', 'remetente', 'trecho'];
const HORA_MS = 60 * 60 * 1000;

const servico = (g: GmailFalso) => g.servico as unknown as ServicoDeGmail;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('busca no Gmail', () => {
  it('usa exatamente a busca combinada, na conta do dono, pedindo só ids', () => {
    const g = gmailFalso([naoLida()]);
    buscarEmails(servico(g));
    const [{ args }] = g.de('Messages.list');
    expect(args[0]).toBe('me');
    expect(args[1]).toMatchObject({ q: 'is:unread category:primary newer_than:14d' });
    expect(BUSCA).toBe('is:unread category:primary newer_than:14d');
    expect((args[1] as Record<string, unknown>).fields).toBe('messages(id,threadId),nextPageToken');
  });

  it('lê cada conversa só com metadados (De e Assunto): nunca o corpo nem o formato completo', () => {
    const g = gmailFalso([naoLida()]);
    buscarEmails(servico(g));
    const [{ args }] = g.de('Threads.get');
    expect(args[0]).toBe('me');
    const opcoes = args[2] as Record<string, unknown>;
    expect(opcoes.format).toBe('metadata');
    expect(opcoes.metadataHeaders).toEqual(['From', 'Subject']);
    expect(String(opcoes.fields)).not.toMatch(/body|parts|raw/);
  });

  it('só usa os dois métodos de leitura do serviço', () => {
    const g = gmailFalso([naoLida(), naoLida({ de: 'Renata <renata@exemplo.invalid>' })]);
    atualizarEmails(servico(g), guardaNaMemoria());
    expect(g.proibidas).toEqual([]);
    expect(new Set(g.chamadas.map((c) => c.metodo))).toEqual(new Set(['Messages.list', 'Threads.get']));
  });
});

describe('só campos permitidos', () => {
  it('cada e-mail tem exatamente id, remetente, enderecoRemetente, assunto, trecho, data e link', () => {
    const m = naoLida({ de: '"Prof. Souza" <souza@exemplo.invalid>', assunto: 'Banca de qualificação' });
    const [email] = buscarEmails(servico(gmailFalso([m])));
    expect(Object.keys(email).sort()).toEqual(CAMPOS);
    expect(email).toEqual<Email>({
      id: m.id,
      remetente: 'Prof. Souza',
      enderecoRemetente: 'souza@exemplo.invalid',
      assunto: 'Banca de qualificação',
      trecho: 'Oi, segue o capítulo revisado para a reunião de quinta.',
      data: '2026-11-05T10:20:00+00:00',
      link: `https://mail.google.com/mail/u/0/#all/${m.threadId}`,
    });
  });

  it('nada além dos campos chega à guarda: nem marcadores, nem destinatário, nem ids de conversa soltos', () => {
    const g = gmailFalso([naoLida()]);
    const guarda = guardaNaMemoria();
    atualizarEmails(servico(g), guarda);
    const guardado = JSON.parse(guarda.texto!) as Record<string, unknown>[];
    expect(guardado).toHaveLength(1);
    expect(Object.keys(guardado[0]).sort()).toEqual(CAMPOS);
    expect(guarda.texto).not.toMatch(/UNREAD|INBOX|CATEGORY|dono\.ficticio|historyId|internalDate/);
  });

  it('a data vem da hora de chegada no Gmail (internalDate), no fuso de Lisboa, também no horário de verão', () => {
    const verao = Date.parse('2026-10-20T09:30:00Z');
    const [email] = buscarEmails(servico(gmailFalso([naoLida({ internalDate: String(verao) })])));
    expect(email.data).toBe('2026-10-20T10:30:00+01:00');
  });

  it('o link abre a conversa no Gmail da web', () => {
    expect(linkDaConversa('18c0000000000abc')).toBe('https://mail.google.com/mail/u/0/#all/18c0000000000abc');
  });
});

describe('trecho', () => {
  it('trecho longo é cortado em 200 caracteres', () => {
    const longo = 'Aurora '.repeat(100);
    const [email] = buscarEmails(servico(gmailFalso([naoLida({ snippet: longo })])));
    expect(email.trecho.length).toBe(TRECHO_NO_MAXIMO);
    expect(TRECHO_NO_MAXIMO).toBe(200);
    expect(longo.startsWith(email.trecho.slice(0, 190))).toBe(true);
  });

  it('trecho curto fica inteiro', () => {
    expect(limparTrecho('Até amanhã, Renata.')).toBe('Até amanhã, Renata.');
  });

  it('desfaz as entidades HTML que o Gmail põe no trecho', () => {
    expect(limparTrecho('Marina &amp; Renata: &quot;ok&quot; &#39;sim&#39; &lt;3 &#x2014; fim')).toBe(
      'Marina & Renata: "ok" \'sim\' <3 — fim',
    );
  });

  it('tira caracteres invisíveis e de controle e junta espaços', () => {
    expect(limparTrecho('Oi\u200c\u200c Marina\u034f\n\n\tsegue\u0000 o\u00a0arquivo ')).toBe('Oi Marina segue o arquivo');
  });

  it('não corta um emoji pela metade', () => {
    const trecho = limparTrecho('a'.repeat(199) + '😀' + 'b');
    expect(trecho.length).toBeLessThanOrEqual(200);
    expect(/[\ud800-\udbff]$/.test(trecho)).toBe(false);
  });
});

describe('remetente e assunto', () => {
  it.each([
    ['Marina <marina@exemplo.invalid>', 'Marina', 'marina@exemplo.invalid'],
    ['"Prof. Souza" <Souza@Exemplo.invalid>', 'Prof. Souza', 'souza@exemplo.invalid'],
    ['"Souza, Prof." <souza@exemplo.invalid>', 'Souza, Prof.', 'souza@exemplo.invalid'],
    ['renata@exemplo.invalid', 'renata@exemplo.invalid', 'renata@exemplo.invalid'],
    ['<aurora@exemplo.invalid>', 'aurora@exemplo.invalid', 'aurora@exemplo.invalid'],
    ['Aurora', 'Aurora', ''],
    ['', '', ''],
  ])('%s', (de, remetente, endereco) => {
    expect(lerRemetente(de)).toEqual({ remetente, enderecoRemetente: endereco });
  });

  it('nome longo e com controles é limpo e limitado a 100', () => {
    const { remetente } = lerRemetente(`${'Marina\u0007 '.repeat(40)}<marina@exemplo.invalid>`);
    expect(remetente.length).toBeLessThanOrEqual(100);
    expect(remetente).not.toMatch(/[\u0000-\u001f]/);
  });

  it('endereço quebrado não vira endereço', () => {
    expect(lerRemetente('Marina <marina@>').enderecoRemetente).toBe('');
    expect(lerRemetente('Marina <a b@exemplo.invalid>').enderecoRemetente).toBe('');
  });

  it('cabeçalho De enorme não trava a leitura e não vira endereço inventado', () => {
    const inicio = Date.now();
    const { remetente, enderecoRemetente } = lerRemetente(`${'<'.repeat(50_000)}Marina`);
    expect(Date.now() - inicio).toBeLessThan(500);
    expect(remetente.length).toBeLessThanOrEqual(100);
    expect(enderecoRemetente).toBe('');
  });

  it('data de chegada fora do alcance do calendário pula só aquela conversa', () => {
    const fica = naoLida({ de: 'Renata <renata@exemplo.invalid>' });
    const g = gmailFalso([naoLida({ internalDate: '9999999999999999' }), fica]);
    expect(buscarEmails(servico(g)).map((e) => e.id)).toEqual([fica.id]);
  });

  it('assunto longo é limitado a 200 e sem controles; sem assunto fica vazio', () => {
    const g = gmailFalso([
      naoLida({ assunto: `Relatório\r\n${'x'.repeat(400)}` }),
      naoLida({ assunto: undefined, internalDate: String(AGORA - HORA_MS) }),
    ]);
    const [primeiro, segundo] = buscarEmails(servico(g));
    expect(primeiro.assunto.length).toBeLessThanOrEqual(200);
    expect(primeiro.assunto).toMatch(/^Relatório x+/);
    expect(segundo.assunto).toBe('');
  });
});

describe('quem entra e quem sai da lista', () => {
  it('um item por conversa: a mensagem não lida mais nova', () => {
    const antiga = naoLida({ internalDate: String(AGORA - 5 * HORA_MS), snippet: 'Primeira' });
    const nova = naoLida({ threadId: antiga.threadId, internalDate: String(AGORA - HORA_MS), snippet: 'Segunda' });
    const lista = buscarEmails(servico(gmailFalso([antiga, nova])));
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ id: nova.id, trecho: 'Segunda' });
    expect(lista[0].link).toBe(`https://mail.google.com/mail/u/0/#all/${antiga.threadId}`);
  });

  it('do mais antigo ao mais novo', () => {
    const a = naoLida({ internalDate: String(AGORA - 3 * DIA_MS), de: 'Renata <renata@exemplo.invalid>' });
    const b = naoLida({ internalDate: String(AGORA - HORA_MS) });
    const c = naoLida({ internalDate: String(AGORA - DIA_MS), de: 'Aurora <aurora@exemplo.invalid>' });
    expect(buscarEmails(servico(gmailFalso([a, b, c]))).map((e) => e.id)).toEqual([a.id, c.id, b.id]);
  });

  it('some quando há resposta do dono na conversa depois da mensagem', () => {
    const m = naoLida();
    const g = gmailFalso([m, respostaDoDono(m.threadId, Number(m.internalDate) + 10 * 60_000)]);
    expect(buscarEmails(servico(g))).toEqual([]);
  });

  it('resposta do dono ANTES da mensagem não tira a mensagem nova da lista', () => {
    const m = naoLida();
    const g = gmailFalso([respostaDoDono(m.threadId, Number(m.internalDate) - HORA_MS), m]);
    expect(buscarEmails(servico(g)).map((e) => e.id)).toEqual([m.id]);
  });

  it('rascunho do dono na conversa não conta como resposta', () => {
    const m = naoLida();
    const rascunho = respostaDoDono(m.threadId, Number(m.internalDate) + 60_000, { labelIds: ['DRAFT'] });
    expect(buscarEmails(servico(gmailFalso([m, rascunho])))).toHaveLength(1);
  });

  it('arquivada (fora da caixa de entrada) sai, mesmo ainda não lida', () => {
    const arquivada = naoLida({ labelIds: ['UNREAD', 'CATEGORY_PERSONAL'] });
    expect(buscarEmails(servico(gmailFalso([arquivada])))).toEqual([]);
  });

  it('mensagem que o próprio dono enviou não fica por responder', () => {
    const paraSi = naoLida({ labelIds: ['UNREAD', 'INBOX', 'CATEGORY_PERSONAL', 'SENT'] });
    expect(buscarEmails(servico(gmailFalso([paraSi])))).toEqual([]);
  });

  it('a mensagem da conversa que não casou com a busca (já lida) não é usada', () => {
    const naoLidaAntiga = naoLida({ internalDate: String(AGORA - 5 * HORA_MS), snippet: 'Não lida' });
    const lidaNova = naoLida({
      threadId: naoLidaAntiga.threadId,
      internalDate: String(AGORA - HORA_MS),
      labelIds: ['INBOX', 'CATEGORY_PERSONAL'],
      casa: false,
      snippet: 'Já lida',
    });
    const [email] = buscarEmails(servico(gmailFalso([naoLidaAntiga, lidaNova])));
    expect(email).toMatchObject({ id: naoLidaAntiga.id, trecho: 'Não lida' });
  });

  it('item some na atualização seguinte quando deixa de casar (lida, respondida ou arquivada no Gmail)', () => {
    const marina = naoLida();
    const renata = naoLida({ de: 'Renata <renata@exemplo.invalid>' });
    const g = gmailFalso([marina, renata]);
    const guarda = guardaNaMemoria();
    expect(atualizarEmails(servico(g), guarda)).toHaveLength(2);

    g.mensagens.find((m) => m.id === marina.id)!.casa = false;
    expect(atualizarEmails(servico(g), guarda).map((e) => e.id)).toEqual([renata.id]);
    expect(lerGuardados(guarda.texto)!.map((e) => e.id)).toEqual([renata.id]);
  });

  it('conversa apagada entre a busca e a leitura (404) é pulada; as outras ficam', () => {
    const sumiu = naoLida();
    const fica = naoLida({ de: 'Renata <renata@exemplo.invalid>' });
    const g = gmailFalso([sumiu, fica]);
    g.sumidas.add(sumiu.threadId);
    expect(buscarEmails(servico(g)).map((e) => e.id)).toEqual([fica.id]);
  });

  it('id ou conversa com caracteres fora do padrão do Gmail não entra (o link não pode ser montado com eles)', () => {
    const g = gmailFalso([
      naoLida({ id: 'abc/../x', threadId: 'abc' }),
      naoLida({ threadId: '18c#x?y' }),
      naoLida({ threadId: 'javascript:alert(1)' }),
    ]);
    expect(buscarEmails(servico(g))).toEqual([]);
  });

  it(`no máximo ${CONVERSAS_NO_MAXIMO} conversas, as mais novas`, () => {
    const muitas = Array.from({ length: CONVERSAS_NO_MAXIMO + 15 }, (_, i) =>
      naoLida({ internalDate: String(AGORA - (i + 1) * 60_000) }),
    );
    const g = gmailFalso(muitas);
    const lista = buscarEmails(servico(g));
    expect(lista).toHaveLength(CONVERSAS_NO_MAXIMO);
    expect(g.de('Threads.get')).toHaveLength(CONVERSAS_NO_MAXIMO);
    expect(lista.map((e) => e.id)).toEqual(
      muitas.slice(0, CONVERSAS_NO_MAXIMO).map((m) => m.id).reverse(),
    );
  });

  it('segue as páginas da busca', () => {
    const muitas = Array.from({ length: 30 }, (_, i) => naoLida({ internalDate: String(AGORA - (i + 1) * 60_000) }));
    const g = gmailFalso(muitas);
    const original = g.servico.Users.Messages.list;
    g.servico.Users.Messages.list = (userId: string, args: Record<string, unknown>) =>
      original(userId, { ...args, maxResults: 10 });
    expect(buscarEmails(servico(g))).toHaveLength(30);
    expect(g.de('Messages.list').length).toBe(3);
  });

  it('sem nada por responder, lista vazia', () => {
    expect(buscarEmails(servico(gmailFalso()))).toEqual([]);
  });
});

describe('guarda e ação emails', () => {
  it('atualizarEmails grava a lista e devolve a mesma', () => {
    const g = gmailFalso([naoLida()]);
    const guarda = guardaNaMemoria();
    const lista = atualizarEmails(servico(g), guarda);
    expect(lerGuardados(guarda.texto)).toEqual(lista);
  });

  it('listarEmails devolve o guardado sem chamar o Gmail', () => {
    const g = gmailFalso([naoLida()]);
    const guarda = guardaNaMemoria();
    const lista = atualizarEmails(servico(g), guarda);
    g.chamadas.length = 0;
    const pedir = vi.fn(() => servico(g));
    expect(listarEmails(pedir, guarda)).toEqual(lista);
    expect(pedir).not.toHaveBeenCalled();
    expect(g.chamadas).toEqual([]);
  });

  it('sem nada guardado (cache expirou), listarEmails busca agora e guarda', () => {
    const g = gmailFalso([naoLida()]);
    const guarda = guardaNaMemoria();
    expect(listarEmails(() => servico(g), guarda)).toHaveLength(1);
    expect(guarda.gravacoes).toHaveLength(1);
  });

  it('lista vazia guardada vale como resposta (não busca de novo)', () => {
    const g = gmailFalso();
    const guarda = guardaNaMemoria('[]');
    expect(listarEmails(() => servico(g), guarda)).toEqual([]);
    expect(g.chamadas).toEqual([]);
  });

  it.each([
    ['JSON quebrado', '{quebrado'],
    ['não é lista', '{"id":"x"}'],
    ['campo a mais', JSON.stringify([{ ...exemplo(), corpo: 'texto inteiro' }])],
    ['campo a menos', JSON.stringify([{ ...exemplo(), link: undefined }])],
    ['link de outro site', JSON.stringify([{ ...exemplo(), link: 'https://exemplo.invalid/#all/18c' }])],
    ['trecho grande demais', JSON.stringify([{ ...exemplo(), trecho: 'x'.repeat(201) }])],
  ])('guardado inválido (%s) é ignorado e a busca é refeita', (_nome, texto) => {
    expect(lerGuardados(texto)).toBeNull();
    const g = gmailFalso([naoLida()]);
    expect(listarEmails(() => servico(g), guardaNaMemoria(texto))).toHaveLength(1);
    expect(g.de('Messages.list')).toHaveLength(1);
  });

  it('falha do Gmail na atualização não apaga a lista guardada', () => {
    const g = gmailFalso([naoLida()]);
    const guarda = guardaNaMemoria();
    atualizarEmails(servico(g), guarda);
    const antes = guarda.texto;
    g.estado.falharLista = 'API call to gmail.users.messages.list failed with error: Backend Error';
    expect(() => atualizarEmails(servico(g), guarda)).toThrow();
    expect(guarda.texto).toBe(antes);
    expect(guarda.gravacoes).toHaveLength(1);
  });

  it('conversa que falha por outro motivo (não 404) faz a atualização inteira falhar, sem gravar lista parcial', () => {
    const g = gmailFalso([naoLida()]);
    const guarda = guardaNaMemoria('[]');
    g.estado.falharConversa = 'API call to gmail.users.threads.get failed with error: Rate Limit Exceeded';
    expect(() => atualizarEmails(servico(g), guarda)).toThrow();
    expect(guarda.texto).toBe('[]');
  });

  it('se a guarda recusar a gravação, a lista nova ainda volta para o app', () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const g = gmailFalso([naoLida()]);
    const guarda = guardaNaMemoria();
    guarda.falharGravacao = true;
    expect(atualizarEmails(servico(g), guarda)).toHaveLength(1);
    expect(erro).toHaveBeenCalled();
  });

  it(`o texto guardado nunca passa de ${BYTES_NO_MAXIMO} bytes: os mais novos saem primeiro`, () => {
    const pesadas = Array.from({ length: CONVERSAS_NO_MAXIMO }, (_, i) =>
      naoLida({
        internalDate: String(AGORA - (i + 1) * 60_000),
        // 3 bytes por caractere no nome, assunto e trecho; endereço quase no máximo.
        de: `"${'€'.repeat(150)}" <${'m'.repeat(230)}@exemplo.invalid>`,
        assunto: '€'.repeat(300),
        snippet: '€'.repeat(300),
      }),
    );
    const guarda = guardaNaMemoria();
    const lista = atualizarEmails(servico(gmailFalso(pesadas)), guarda);
    expect(new TextEncoder().encode(guarda.texto!).length).toBeLessThanOrEqual(BYTES_NO_MAXIMO);
    expect(lista.length).toBeLessThan(CONVERSAS_NO_MAXIMO);
    // O mais antigo fica.
    expect(lista[0].id).toBe(pesadas.at(-1)!.id);
    expect(lerGuardados(guarda.texto)).toEqual(lista);
  });
});

describe('registros sem dados do e-mail', () => {
  it('nenhuma falha leva endereço, assunto ou trecho ao registro', () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const m = naoLida({ de: 'Marina <marina@exemplo.invalid>', assunto: 'Assunto secreto', snippet: 'Trecho secreto' });
    const g = gmailFalso([m]);
    const guarda = guardaNaMemoria();
    guarda.falharGravacao = true;
    atualizarEmails(servico(g), guarda);
    g.estado.falharConversa =
      'API call to gmail.users.threads.get failed with error: Not Allowed marina@exemplo.invalid "Assunto secreto"';
    const ambiente: Ambiente = { lerCodigo: () => CODIGO, armazem: armazemNaMemoria(), gmail: () => servico(g), emailsGuardados: guarda };
    expect(tratar({ codigo: CODIGO, acao: 'atualizarEmails' }, ambiente)).toEqual({ ok: false, erro: 'interno' });
    const tudo = [...erro.mock.calls, ...log.mock.calls].flat().map(String).join('\n');
    for (const proibido of ['marina', 'Marina', 'secreto', m.id, m.threadId]) expect(tudo).not.toContain(proibido);
  });
});

describe('ações pelo tratar', () => {
  function ambienteCom(g: GmailFalso | null, guarda = guardaNaMemoria()): Ambiente {
    return {
      lerCodigo: () => CODIGO,
      armazem: armazemNaMemoria(),
      ...(g ? { gmail: () => servico(g) } : {}),
      emailsGuardados: guarda,
    };
  }

  it('emails devolve a lista', () => {
    const m = naoLida();
    const resposta = tratar({ codigo: CODIGO, acao: 'emails' }, ambienteCom(gmailFalso([m])));
    expect(resposta).toMatchObject({ ok: true, dados: [{ id: m.id }] });
  });

  it('atualizarEmails busca de novo mesmo com lista guardada', () => {
    const m = naoLida();
    const g = gmailFalso([m]);
    const resposta = tratar({ codigo: CODIGO, acao: 'atualizarEmails' }, ambienteCom(g, guardaNaMemoria('[]')));
    expect(resposta).toMatchObject({ ok: true, dados: [{ id: m.id }] });
  });

  it('sem código certo, nenhuma das duas chama o Gmail', () => {
    const g = gmailFalso([naoLida()]);
    for (const acao of ['emails', 'atualizarEmails']) {
      expect(tratar({ codigo: 'errado', acao }, ambienteCom(g))).toEqual({ ok: false, erro: 'codigo-invalido' });
    }
    expect(g.chamadas).toEqual([]);
  });

  it('sem o serviço do Gmail: interno', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(tratar({ codigo: CODIGO, acao: 'emails' }, ambienteCom(null))).toEqual({ ok: false, erro: 'interno' });
  });

  it('o app não tem ação para mexer no Gmail', () => {
    const g = gmailFalso([naoLida()]);
    for (const acao of ['marcarLido', 'arquivar', 'enviarEmail', 'responder', 'apagarEmail']) {
      expect(tratar({ codigo: CODIGO, acao, dados: { id: 'x' } }, ambienteCom(g))).toEqual({
        ok: false,
        erro: 'codigo-invalido',
      });
    }
    expect(g.chamadas).toEqual([]);
  });
});

describe('nenhuma chamada de envio ou alteração existe em script/', () => {
  function arquivos(pasta: string): string[] {
    return readdirSync(pasta).flatMap((nome) => {
      const caminho = join(pasta, nome);
      return statSync(caminho).isDirectory() ? arquivos(caminho) : [caminho];
    });
  }
  const todos = arquivos('script').filter((c) => /\.(ts|js|mjs|json)$/.test(c));
  const texto = todos.map((c) => readFileSync(c, 'utf8')).join('\n');

  it('há código do Gmail para conferir', () => {
    expect(todos.some((c) => c.endsWith('email.ts'))).toBe(true);
    expect(texto).toContain('Threads');
  });

  it.each([
    'sendEmail',
    'markRead',
    'moveToArchive',
    'markUnread',
    'moveToTrash',
    'GmailApp',
    'MailApp',
    'createDraft',
    'Drafts',
    'drafts',
    'batchModify',
    'batchDelete',
    'untrash',
    'gmail.modify',
    'gmail.send',
    'gmail.compose',
    'gmail.insert',
    'gmail.labels',
    'gmail.settings',
  ])('não contém %s', (proibido) => {
    expect(texto).not.toContain(proibido);
  });

  it.each([
    ['messages.send', /messages\s*\.\s*send/i],
    ['.send(', /\.send\s*\(/],
    ['modify', /\bmodify\b/i],
    ['.trash(', /\.trash\s*\(/i],
    ['Messages.insert/import', /messages\s*\.\s*(insert|import)\b/i],
    ['Messages.delete/remove', /messages\s*\.\s*(delete|remove)\b/i],
    ['Threads.* (só get)', /threads\s*\.\s*(?!get\b)[a-z]+\s*\(/i],
    ['Labels', /\bLabels\s*\./],
    ['escopo total do Gmail', /["']https:\/\/mail\.google\.com\/["']/],
  ])('não contém %s', (_nome, padrao) => {
    expect(texto).not.toMatch(padrao);
  });
});

function exemplo(): Email {
  return {
    id: '18c0000000000001',
    remetente: 'Marina',
    enderecoRemetente: 'marina@exemplo.invalid',
    assunto: 'Capítulo 2',
    trecho: 'Segue o capítulo.',
    data: '2026-11-05T10:20:00+00:00',
    link: 'https://mail.google.com/mail/u/0/#all/18c0000000000001',
  };
}
