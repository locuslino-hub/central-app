import { act, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { desfazer } from '../../src/dados/desfazer';
import { esquecerEmails, lerEmails } from '../../src/dados/emails';
import { listar, salvar, semear } from '../../src/dados/loja';
import { Caixa } from '../../src/ui/Caixa';
import { PorResponder } from '../../src/ui/PorResponder';
import { ATUALIZAR_A_CADA_MS } from '../../src/ui/useEmails';
import { email, gmailDeTeste } from '../apoio/emails-ui';

// Quinta-feira, 2026-11-05, 12:20 (Europe/Lisbon). Só a data é falsa.
const AGORA = Date.parse('2026-11-05T12:20:00Z');
configure({ asyncUtilTimeout: 5000 });

beforeEach(async () => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AGORA);
  await semear();
});

const cartao = () => within(screen.getByRole('region', { name: /Por responder/ }));
const itemDe = async (assunto: string) => {
  const texto = await cartao().findByText(assunto);
  return within(texto.closest('li') as HTMLElement);
};
/** Deixa os efeitos da tela rodarem (o Preact os adia): só então os ouvintes de foco existem. */
const assentar = () => act(async () => new Promise((pronto) => setTimeout(pronto, 150)));
const botao = (item: ReturnType<typeof within>, nome: string) => item.getByRole('button', { name: new RegExp(`^${nome}`) });
/** A etiqueta de sala do item (a lista de opções da pergunta também tem os nomes das salas). */
const etiqueta = (item: ReturnType<typeof within>, nome: string) => item.getByText(nome, { selector: '.etiqueta' });
/** O campo da pergunta "de quem é?", já com as opções (as salas e as pessoas chegam depois de abrir). */
const campoDaPergunta = async (pessoas = 0) => {
  const campo = (await screen.findByLabelText(/De quem é este e-mail\?/)) as HTMLSelectElement;
  await waitFor(() => expect(campo.options.length).toBe(1 + pessoas + 7 + 1)); // Escolha…, pessoas, as 7 salas, Sem sala
  return campo;
};
const naLista = () => Array.from(document.querySelectorAll<HTMLElement>('li.email .email-assunto')).map((p) => p.textContent);

describe('Por responder', () => {
  it('lista o remetente, a hora, o assunto e o trecho, como texto, do mais antigo ao mais novo', async () => {
    const gmail = await gmailDeTeste([
      email('Relatório do semestre', { remetente: 'Prof. Souza', trecho: 'Segue o relatório', data: '2026-11-04T18:05:00+00:00' }),
      email('Revisão do capítulo', { remetente: 'Marina', data: '2026-11-05T10:20:00+00:00' }),
      email('Mais antigo', { data: '2026-11-02T09:40:00+00:00' }),
    ]);
    render(<PorResponder />);

    const primeiro = await itemDe('Relatório do semestre');
    expect(primeiro.getByText('Prof. Souza')).toBeTruthy();
    expect(primeiro.getByText('Segue o relatório')).toBeTruthy();
    expect(primeiro.getByText('Ontem, 18:05')).toBeTruthy();
    expect((await itemDe('Revisão do capítulo')).getByText('Hoje, 10:20')).toBeTruthy();
    expect((await itemDe('Mais antigo')).getByText('2/11, 09:40')).toBeTruthy();
    // A ordem é a que o script entrega (o mais antigo primeiro); a tela não reordena.
    expect(naLista()).toEqual(['Relatório do semestre', 'Revisão do capítulo', 'Mais antigo']);
    expect(cartao().getByRole('heading', { name: /Por responder/ }).textContent).toContain('3 e-mails');
    expect(gmail.de('emails')).toHaveLength(1);
  });

  it('assunto e trecho com HTML aparecem como texto: nenhum elemento é criado', async () => {
    await gmailDeTeste([email('<img src=x onerror=alert(1)>', { trecho: '<script>alert(2)</script><b>negrito</b>', remetente: '<i>Marina</i>' })]);
    render(<PorResponder />);
    await cartao().findByText('<img src=x onerror=alert(1)>');
    expect(document.querySelector('li.email img, li.email script, li.email b, li.email i')).toBeNull();
    expect(cartao().getByText('<script>alert(2)</script><b>negrito</b>')).toBeTruthy();
    expect(cartao().getByText('<i>Marina</i>')).toBeTruthy();
  });

  it('um e-mail só: "1 e-mail"; nenhum: diz que não há nada por responder', async () => {
    const gmail = await gmailDeTeste([email('Único')]);
    const { unmount } = render(<PorResponder />);
    await itemDe('Único');
    expect(cartao().getByRole('heading', { name: /Por responder/ }).textContent).toContain('1 e-mail');
    expect(cartao().getByRole('heading', { name: /Por responder/ }).textContent).not.toContain('1 e-mails');
    unmount();
    esquecerEmails(); // o app foi fechado e aberto de novo
    gmail.responder([]);
    render(<PorResponder />);
    expect(await cartao().findByText('Nada por responder.')).toBeTruthy();
  });

  describe('Responder', () => {
    it('é um link para o Gmail em outra aba, sem referência, só com http(s); abrir não chama o script', async () => {
      const gmail = await gmailDeTeste([email('Primeiro'), email('Segundo')]);
      render(<PorResponder />);
      const item = await itemDe('Primeiro');
      const link = item.getByRole('link', { name: /^Responder/ });
      expect(link.getAttribute('href')).toMatch(/^https:\/\/mail\.google\.com\/mail\/u\/0\/#all\/mensagem\d+$/);
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
      const abrir = vi.spyOn(window, 'open');
      const antes = gmail.pedidos.length;
      fireEvent.click(link);
      expect(abrir).not.toHaveBeenCalled();
      expect(gmail.pedidos).toHaveLength(antes);
    });

    it('ao voltar do Gmail, o foco vai para o Responder do próximo item', async () => {
      await gmailDeTeste([email('Primeiro'), email('Segundo'), email('Terceiro')]);
      render(<PorResponder />);
      const primeiro = await itemDe('Primeiro');
      await assentar();
      fireEvent.click(primeiro.getByRole('link', { name: /^Responder/ }));
      // O dono vai para a aba do Gmail e volta.
      fireEvent.blur(window);
      fireEvent.focus(window);
      const segundo = await itemDe('Segundo');
      expect(document.activeElement).toBe(segundo.getByRole('link', { name: /^Responder/ }));
    });

    it('também volta pelo visibilitychange; no último item o foco vai para o anterior; sem sair, nada muda de lugar', async () => {
      await gmailDeTeste([email('Primeiro'), email('Último')]);
      render(<PorResponder />);
      const ultimo = await itemDe('Último');
      await assentar();
      const visibilidade = vi.spyOn(document, 'visibilityState', 'get');
      fireEvent.click(ultimo.getByRole('link', { name: /^Responder/ }));

      // Voltar o foco à janela sem ter saído não mexe no foco.
      fireEvent.focus(window);
      expect(document.activeElement).toBe(document.body);

      visibilidade.mockReturnValue('hidden');
      fireEvent(document, new Event('visibilitychange'));
      visibilidade.mockReturnValue('visible');
      fireEvent(document, new Event('visibilitychange'));
      const primeiro = await itemDe('Primeiro');
      expect(document.activeElement).toBe(primeiro.getByRole('link', { name: /^Responder/ }));
    });

    it('com um item só, o foco volta para o próprio Responder', async () => {
      await gmailDeTeste([email('Sozinho')]);
      render(<PorResponder />);
      const item = await itemDe('Sozinho');
      await assentar();
      fireEvent.click(item.getByRole('link', { name: /^Responder/ }));
      fireEvent.blur(window);
      fireEvent.focus(window);
      expect(document.activeElement).toBe(item.getByRole('link', { name: /^Responder/ }));
    });
  });

  describe('Virar tarefa', () => {
    it('cria a tarefa com o vínculo (emailId), a sala e a pessoa; o e-mail mostra "Virou tarefa"; Desfazer a apaga', async () => {
      await gmailDeTeste([email('Revisão do capítulo 2', { remetente: 'Marina', enderecoRemetente: 'marina@exemplo.invalid' })]);
      const marina = await salvar('pessoas', { nome: 'Marina', salaId: 'sala-orientacoes', emails: ['marina@exemplo.invalid'] });
      render(<PorResponder />);
      const item = await itemDe('Revisão do capítulo 2');
      expect(await item.findByText('Orientações', { selector: '.etiqueta' })).toBeTruthy();
      fireEvent.click(botao(item, 'Virar tarefa'));

      await waitFor(async () => expect(await listar('tarefas')).toHaveLength(1));
      const [tarefa] = await listar('tarefas');
      expect(tarefa).toMatchObject({
        titulo: 'Responder: Revisão do capítulo 2',
        salaId: 'sala-orientacoes',
        pessoaId: marina.id,
        emailId: lerEmails().emails[0].id,
        feito: false,
      });
      expect((await itemDe('Revisão do capítulo 2')).getByText('Virou tarefa')).toBeTruthy();
      expect((await itemDe('Revisão do capítulo 2')).queryByRole('button', { name: /^Virar tarefa/ })).toBeNull();
      // O e-mail continua na lista: ele ainda não foi respondido.
      expect(cartao().getByText('Tarefa criada: Responder: Revisão do capítulo 2')).toBeTruthy();

      const desfazerBotao = cartao().getByRole('button', { name: 'Desfazer' });
      await waitFor(() => expect(document.activeElement).toBe(desfazerBotao));
      fireEvent.click(desfazerBotao);
      await waitFor(async () => expect(await listar('tarefas')).toHaveLength(0));
      expect(await (await itemDe('Revisão do capítulo 2')).findByRole('button', { name: /^Virar tarefa/ })).toBeTruthy();
    });

    it('toque duplo cria uma tarefa só', async () => {
      await gmailDeTeste([email('Prazo')]);
      render(<PorResponder />);
      const item = await itemDe('Prazo');
      const virar = botao(item, 'Virar tarefa');
      fireEvent.click(virar);
      fireEvent.click(virar);
      await waitFor(async () => expect(await listar('tarefas')).toHaveLength(1));
      await new Promise((pronto) => setTimeout(pronto, 50));
      expect(await listar('tarefas')).toHaveLength(1);
    });
  });

  describe('Agora não', () => {
    it('some hoje, tem Desfazer, e volta no dia seguinte', async () => {
      await gmailDeTeste([email('Depois'), email('Outro')]);
      const { unmount } = render(<PorResponder />);
      fireEvent.click(botao(await itemDe('Depois'), 'Agora não'));

      await waitFor(() => expect(naLista()).toEqual(['Outro']));
      expect(cartao().getByText(/adiado para amanhã/)).toBeTruthy();
      const [estado] = await listar('estadosEmail');
      expect(estado).toMatchObject({ feito: false, adiadaAte: '2026-11-06' });
      unmount();

      // No dia seguinte (Lisboa), o e-mail volta.
      vi.setSystemTime(Date.parse('2026-11-06T09:00:00Z'));
      render(<PorResponder />);
      await cartao().findByText('Depois');
      expect(naLista()).toEqual(['Depois', 'Outro']);
    });

    it('Desfazer traz o e-mail de volta ao lugar', async () => {
      await gmailDeTeste([email('Depois')]);
      render(<PorResponder />);
      fireEvent.click(botao(await itemDe('Depois'), 'Agora não'));
      await waitFor(() => expect(naLista()).toEqual([]));
      fireEvent.click(cartao().getByRole('button', { name: 'Desfazer' }));
      await waitFor(() => expect(naLista()).toEqual(['Depois']));
    });
  });

  describe('Feito', () => {
    it('some da lista, tem Desfazer e não chama o script para mexer no Gmail', async () => {
      const gmail = await gmailDeTeste([email('Já resolvi'), email('Falta')]);
      render(<PorResponder />);
      const item = await itemDe('Já resolvi');
      fireEvent.click(botao(item, 'Feito'));

      await waitFor(() => expect(naLista()).toEqual(['Falta']));
      expect(cartao().getByText('E-mail marcado como feito')).toBeTruthy();
      const [estado] = await listar('estadosEmail');
      expect(estado).toMatchObject({ feito: true });
      // Só a leitura inicial: nenhuma ação de escrita saiu para o script.
      expect(gmail.pedidos.map((p) => p.acao)).toEqual(['emails']);

      fireEvent.click(cartao().getByRole('button', { name: 'Desfazer' }));
      await waitFor(() => expect(naLista()).toEqual(['Já resolvi', 'Falta']));
      expect(gmail.pedidos.map((p) => p.acao)).toEqual(['emails']);
    });

    it('continua feito mesmo depois de atualizar: o Gmail ainda o devolve, a Central o esconde', async () => {
      const gmail = await gmailDeTeste([email('Já resolvi'), email('Falta')]);
      render(<PorResponder />);
      fireEvent.click(botao(await itemDe('Já resolvi'), 'Feito'));
      await waitFor(() => expect(naLista()).toEqual(['Falta']));
      fireEvent.click(cartao().getByRole('button', { name: 'Atualizar agora' }));
      await waitFor(() => expect(gmail.de('atualizarEmails')).toHaveLength(1));
      await waitFor(() => expect(cartao().getByRole('button', { name: 'Atualizar agora' })).toBeTruthy());
      expect(naLista()).toEqual(['Falta']);
    });

    it('Desfazer que falha mostra o erro e deixa tentar de novo', async () => {
      await gmailDeTeste([email('A')]);
      render(<PorResponder />);
      fireEvent.click(botao(await itemDe('A'), 'Feito'));
      await waitFor(() => expect(naLista()).toEqual([]));
      const topo = desfazer.ultimo()!;
      const original = topo.reverter;
      vi.spyOn(console, 'error').mockImplementation(() => {});
      // A entrada é a do próprio app: falha uma vez e depois funciona.
      let falhou = false;
      topo.reverter = async () => {
        if (!falhou) {
          falhou = true;
          throw new Error('banco ocupado');
        }
        return original();
      };
      fireEvent.click(cartao().getByRole('button', { name: 'Desfazer' }));
      expect(await cartao().findByText('Não consegui desfazer. Tente de novo.')).toBeTruthy();
      fireEvent.click(cartao().getByRole('button', { name: 'Desfazer' }));
      await waitFor(() => expect(naLista()).toEqual(['A']));
    });
  });

  describe('sala de quem enviou', () => {
    it('vem de Pessoa.emails; sem isso, "Sem sala" e a pergunta; depois de respondida, não volta', async () => {
      await gmailDeTeste([
        email('Da Marina', { enderecoRemetente: 'marina@exemplo.invalid' }),
        email('De alguém', { remetente: 'Renata', enderecoRemetente: 'renata@exemplo.invalid' }),
      ]);
      await salvar('pessoas', { nome: 'Marina', salaId: 'sala-orientacoes', emails: ['Marina@Exemplo.Invalid'] });
      const aurora = await salvar('pessoas', { nome: 'Aurora', salaId: 'sala-doutoramento' });
      const { unmount } = render(<PorResponder />);

      expect(await (await itemDe('Da Marina')).findByText('Orientações', { selector: '.etiqueta' })).toBeTruthy();
      const outro = await itemDe('De alguém');
      expect(outro.queryByText('Orientações', { selector: '.etiqueta' })).toBeNull();
      fireEvent.click(outro.getByRole('button', { name: /^Sem sala/ }));

      // Responde: é a Aurora. O endereço entra nos e-mails dela, e a sala vem dela.
      const escolha = await campoDaPergunta(2);
      expect(document.activeElement).toBe(escolha);
      fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
      expect(await screen.findByText('Escolha uma opção.')).toBeTruthy();
      fireEvent.change(escolha, { target: { value: `p:${aurora.id}` } });
      fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

      await waitFor(async () => expect(etiqueta(await itemDe('De alguém'), 'Doutoramento')).toBeTruthy());
      expect((await itemDe('De alguém')).queryByRole('button', { name: /^Sem sala/ })).toBeNull();
      expect((await listar('pessoas')).find((p) => p.id === aurora.id)?.emails).toEqual(['renata@exemplo.invalid']);

      // Reabrir o app: a pergunta não volta.
      unmount();
      render(<PorResponder />);
      expect(await (await itemDe('De alguém')).findByText('Doutoramento', { selector: '.etiqueta' })).toBeTruthy();
      expect(screen.queryByLabelText(/De quem é este e-mail\?/)).toBeNull();
    });

    it('responder só a sala, ou "Sem sala", vale para sempre neste aparelho, sem guardar o endereço', async () => {
      await gmailDeTeste([
        email('Do condomínio', { remetente: 'Condomínio', enderecoRemetente: 'condominio@exemplo.invalid' }),
        email('Da loja', { remetente: 'Loja', enderecoRemetente: 'loja@exemplo.invalid' }),
      ]);
      const { unmount } = render(<PorResponder />);

      fireEvent.click((await itemDe('Do condomínio')).getByRole('button', { name: /^Sem sala/ }));
      fireEvent.change(await campoDaPergunta(), { target: { value: 's:sala-casa' } });
      fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
      await waitFor(async () => expect(etiqueta(await itemDe('Do condomínio'), 'Casa')).toBeTruthy());

      fireEvent.click((await itemDe('Da loja')).getByRole('button', { name: /^Sem sala/ }));
      fireEvent.change(await campoDaPergunta(), { target: { value: 'n' } });
      fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
      await waitFor(async () => expect((await itemDe('Da loja')).queryByRole('button', { name: /^Sem sala/ })).toBeNull());
      expect((await itemDe('Da loja')).getByText('Sem sala')).toBeTruthy();

      unmount();
      render(<PorResponder />);
      expect(await (await itemDe('Do condomínio')).findByText('Casa', { selector: '.etiqueta' })).toBeTruthy();
      expect((await itemDe('Da loja')).queryByRole('button', { name: /^Sem sala/ })).toBeNull();
      expect(JSON.stringify({ ...localStorage })).not.toContain('@');
    });

    it('Esc fecha a pergunta sem responder', async () => {
      await gmailDeTeste([email('Dúvida')]);
      render(<PorResponder />);
      fireEvent.click((await itemDe('Dúvida')).getByRole('button', { name: /^Sem sala/ }));
      const escolha = await screen.findByLabelText(/De quem é este e-mail\?/);
      fireEvent.keyDown(escolha, { key: 'Escape' });
      expect(screen.queryByLabelText(/De quem é este e-mail\?/)).toBeNull();
      expect((await itemDe('Dúvida')).getByRole('button', { name: /^Sem sala/ })).toBeTruthy();
    });
  });

  describe('Atualizar agora', () => {
    it('mostra o estado: atualizando (botão desligado), depois a hora da atualização', async () => {
      const gmail = await gmailDeTeste([email('A')]);
      render(<PorResponder />);
      await itemDe('A');
      expect(await cartao().findByText('Atualizado às 12:20')).toBeTruthy();

      const soltar = gmail.segurar();
      vi.setSystemTime(AGORA + 5 * 60_000);
      fireEvent.click(cartao().getByRole('button', { name: 'Atualizar agora' }));
      const ocupado = await cartao().findByRole('button', { name: 'Atualizando…' });
      expect((ocupado as HTMLButtonElement).disabled).toBe(true);

      gmail.responder([email('A'), email('Nova')]);
      await act(async () => soltar());
      await cartao().findByText('Nova');
      expect(cartao().getByRole('button', { name: 'Atualizar agora' })).toBeTruthy();
      expect(cartao().getByText('Atualizado às 12:25')).toBeTruthy();
      expect(gmail.de('atualizarEmails')).toHaveLength(1);
    });

    it('falhou: avisa sem apagar a lista; o botão tenta de novo', async () => {
      const gmail = await gmailDeTeste([email('Fica na tela')]);
      render(<PorResponder />);
      await itemDe('Fica na tela');
      gmail.falharCom('rede');
      fireEvent.click(cartao().getByRole('button', { name: 'Atualizar agora' }));
      expect(await cartao().findByText('E-mails não carregaram')).toBeTruthy();
      expect(cartao().getByText('Sem internet.')).toBeTruthy();
      expect(naLista()).toEqual(['Fica na tela']);

      gmail.falharCom({ ok: true, dados: [email('Fica na tela')] });
      fireEvent.click(cartao().getByRole('button', { name: 'Atualizar agora' }));
      await waitFor(() => expect(cartao().queryByText('E-mails não carregaram')).toBeNull());
    });

    it('permissão do Gmail ainda não aprovada: diz o que falta', async () => {
      const gmail = await gmailDeTeste();
      gmail.falharCom({ ok: false, erro: 'codigo-invalido' });
      render(<PorResponder />);
      expect(await cartao().findByText('E-mail ainda não liberado — falta aprovar a permissão no script')).toBeTruthy();
    });

    it('aparelho não conectado leva a Conectar aparelho', async () => {
      await gmailDeTeste([], { conectar: false });
      render(<PorResponder />);
      expect(await cartao().findByText('Este aparelho ainda não está conectado.')).toBeTruthy();
      expect(cartao().getByRole('link', { name: 'Conectar aparelho' }).getAttribute('href')).toBe('#/conectar');
    });
  });

  describe('atualização sozinha', () => {
    it('lê de hora em hora, e não com o app escondido', async () => {
      const intervalos = vi.spyOn(globalThis, 'setInterval');
      const gmail = await gmailDeTeste([email('A')]);
      render(<PorResponder />);
      await itemDe('A');
      await waitFor(() => expect(lerEmails().carregando).toBe(false));
      const antes = gmail.de('emails').length;
      const hora = intervalos.mock.calls.find(([, ms]) => ms === ATUALIZAR_A_CADA_MS)![0] as () => void;
      expect(ATUALIZAR_A_CADA_MS).toBe(60 * 60_000);
      const visibilidade = vi.spyOn(document, 'visibilityState', 'get');

      visibilidade.mockReturnValue('hidden');
      await act(async () => hora());
      await new Promise((pronto) => setTimeout(pronto, 100));
      expect(gmail.de('emails')).toHaveLength(antes);

      visibilidade.mockReturnValue('visible');
      await act(async () => hora());
      await waitFor(() => expect(gmail.de('emails')).toHaveLength(antes + 1));
    });
  });

  it('mostra só os primeiros e leva à Caixa para ver todos', async () => {
    await gmailDeTeste(['Um', 'Dois', 'Três', 'Quatro', 'Cinco'].map((a) => email(a)));
    render(<PorResponder />);
    await itemDe('Um');
    expect(naLista()).toEqual(['Um', 'Dois', 'Três', 'Quatro']);
    expect(cartao().getByRole('link', { name: 'Ver os 5 na Caixa' }).getAttribute('href')).toBe('#/caixa');
  });
});

describe('Caixa', () => {
  it('mostra todos os e-mails e filtra por sala', async () => {
    await gmailDeTeste([
      email('Da Marina', { enderecoRemetente: 'marina@exemplo.invalid' }),
      email('Da Renata', { remetente: 'Renata', enderecoRemetente: 'renata@exemplo.invalid' }),
      email('Do banco', { remetente: 'Banco', enderecoRemetente: 'banco@exemplo.invalid' }),
      email('Outro da Marina', { enderecoRemetente: 'marina@exemplo.invalid' }),
      email('Mais um', { enderecoRemetente: 'marina@exemplo.invalid' }),
    ]);
    await salvar('pessoas', { nome: 'Marina', salaId: 'sala-orientacoes', emails: ['marina@exemplo.invalid'] });
    await salvar('pessoas', { nome: 'Renata', salaId: 'sala-aulas', emails: ['renata@exemplo.invalid'] });
    render(<Caixa />);

    await cartao().findByText('Do banco');
    expect(naLista()).toHaveLength(5);
    const filtros = within(screen.getByRole('group', { name: 'Filtrar por sala' }));
    expect(filtros.getAllByRole('button').map((b) => b.textContent)).toEqual(['Todas (5)', 'Aulas (1)', 'Orientações (3)', 'Sem sala (1)']);
    expect(filtros.getByRole('button', { name: 'Todas (5)' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(filtros.getByRole('button', { name: 'Orientações (3)' }));
    expect(naLista()).toEqual(['Da Marina', 'Outro da Marina', 'Mais um']);
    expect(filtros.getByRole('button', { name: 'Orientações (3)' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(filtros.getByRole('button', { name: 'Sem sala (1)' }));
    expect(naLista()).toEqual(['Do banco']);

    // Feito no último da sala: o filtro some e a lista volta a Todas.
    fireEvent.click(botao(await itemDe('Do banco'), 'Feito'));
    await waitFor(() => expect(naLista()).toHaveLength(4));
    expect(filtros.queryByRole('button', { name: /Sem sala/ })).toBeNull();
  });

  it('com poucas salas não mostra filtro; o estado e o botão Atualizar agora estão lá', async () => {
    await gmailDeTeste([email('A')]);
    render(<Caixa />);
    await cartao().findByText('A');
    expect(screen.queryByRole('group', { name: 'Filtrar por sala' })).toBeNull();
    expect(cartao().getByRole('button', { name: 'Atualizar agora' })).toBeTruthy();
  });
});
