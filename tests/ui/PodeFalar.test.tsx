import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { listar, semear, semearPalavras } from '../../src/dados/loja';
import { guardarAudio, listarAudios, problemasDosAudios } from '../../src/voz/audios-pendentes';
import { apagarAudioDoDrive } from '../../src/voz/apagar-audio';
import { enviarAudio, iniciarGravacao } from '../../src/voz/gravador';
import { apagarIdeia } from '../../src/dados/ideias';
import { iniciarEscuta } from '../../src/voz/reconhecimento';
import { PodeFalar } from '../../src/ui/PodeFalar';

// Dublês de voz: o navegador de verdade (microfone, reconhecimento) não existe no teste.
vi.mock('../../src/voz/reconhecimento', () => ({ iniciarEscuta: vi.fn() }));
vi.mock('../../src/voz/gravador', () => ({
  iniciarGravacao: vi.fn(),
  enviarAudio: vi.fn(),
  reenviarAudiosPendentes: vi.fn(async () => ({ enviados: [], descartados: [], restantes: 0, falhas: [] })),
}));

vi.mock('../../src/voz/apagar-audio', () => ({ apagarAudioDoDrive: vi.fn(async () => true) }));

const escutaMock = vi.mocked(iniciarEscuta);
const apagarMock = vi.mocked(apagarAudioDoDrive);
const gravacaoMock = vi.mocked(iniciarGravacao);
const envioMock = vi.mocked(enviarAudio);

// Quinta-feira, 2026-11-05, 12:20 (Europe/Lisbon). Só a data é falsa.
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 5, 12, 20));
  history.replaceState(null, '', '/#/falar');
  vi.clearAllMocks();
  await semear();
  await semearPalavras();
});

/** Uma escuta falsa: o teste "fala" chamando `dizer`, e pode fazer o navegador falhar. */
function escutaFalsa(textoFinal = '') {
  let aoTexto: (texto: string, parcial: boolean) => void = () => {};
  let aoErro: (erro: string) => void = () => {};
  let aoAviso: (aviso: 'limite') => void = () => {};
  const escuta = { parar: vi.fn(async () => textoFinal), cancelar: vi.fn() };
  escutaMock.mockImplementation(((t: typeof aoTexto, e: typeof aoErro, _c: unknown, opcoes?: { aoAviso?: typeof aoAviso }) => {
    aoTexto = t;
    aoErro = e;
    if (opcoes?.aoAviso) aoAviso = opcoes.aoAviso;
    return escuta;
  }) as unknown as typeof iniciarEscuta);
  return {
    escuta,
    limite: () => act(() => aoAviso('limite')),
    dizer: (texto: string, parcial = true) => act(() => aoTexto(texto, parcial)),
    falhar: (erro: string) => act(() => aoErro(erro)),
  };
}

const microfone = () => screen.getByRole('button', { name: 'Falar' });
const campo = () => screen.getByRole('textbox', { name: 'Texto falado' }) as HTMLTextAreaElement;
const pronto = () => screen.getByRole('button', { name: 'Pronto' });
const escrever = (texto: string) => fireEvent.input(campo(), { target: { value: texto } });

describe('tela Pode falar', () => {
  it('avisa, perto do microfone, que o reconhecimento de voz do navegador envia o áudio ao Google', () => {
    escutaFalsa();
    render(<PodeFalar />);
    expect(screen.getByText('O reconhecimento de voz do navegador envia o áudio ao Google. Para não enviar, escreva no campo.')).toBeTruthy();
  });

  it('abre com um botão grande de microfone e não escuta sozinha: só um toque começa', async () => {
    escutaFalsa();
    render(<PodeFalar />);

    expect(microfone()).toBeTruthy();
    expect(escutaMock).not.toHaveBeenCalled();

    fireEvent.click(microfone());
    expect(escutaMock).toHaveBeenCalledTimes(1);
    expect(microfone().getAttribute('aria-pressed')).toBe('true');
  });

  it('um toque começa a escuta e mostra o texto ao vivo; o texto parcial NÃO é anunciado palavra por palavra', async () => {
    const voz = escutaFalsa();
    render(<PodeFalar />);
    fireEvent.click(microfone());

    voz.dizer('marcar reunião com a Marina');

    const vivo = await screen.findByText('marcar reunião com a Marina');
    expect(vivo.closest('[aria-live]')).toBeNull();
    expect(vivo.closest('[role="status"]')).toBeNull();
    expect(vivo.getAttribute('aria-hidden')).toBe('true');
  });

  it('Pronto sem texto não grava nada e avisa', async () => {
    render(<PodeFalar />);
    fireEvent.click(pronto());

    expect(await screen.findByText(/Ainda não ouvi nada/)).toBeTruthy();
    expect(await listar('ideias')).toEqual([]);
    expect(await listar('tarefas')).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Desfazer' })).toBeNull();
  });

  it('Pronto com texto cria a ideia e mostra o cartão com Desfazer; Desfazer apaga', async () => {
    render(<PodeFalar />);
    escrever('Usar o artigo do Prof. Souza no capítulo 2');
    fireEvent.click(pronto());

    const cartao = within(await screen.findByRole('article'));
    expect(cartao.getByText('Guardado em Ideias')).toBeTruthy();
    expect(cartao.getByText(/Usar o artigo do Prof. Souza/)).toBeTruthy();
    expect(await listar('ideias')).toHaveLength(1);

    fireEvent.click(cartao.getByRole('button', { name: 'Desfazer' }));
    expect(await screen.findByText('Desfeito. Nada ficou guardado.')).toBeTruthy();
    expect(await listar('ideias')).toEqual([]);
  });

  it('frase de tarefa vira tarefa, com o cartão e o botão Ver', async () => {
    render(<PodeFalar />);
    escrever('Preciso parafusar o apoio do banheiro');
    fireEvent.click(pronto());

    const cartao = within(await screen.findByRole('article'));
    expect(cartao.getByText('Tarefa guardada')).toBeTruthy();
    expect(cartao.getByRole('link', { name: 'Ver' }).getAttribute('href')).toBe('#/atividades');
    expect(await listar('tarefas')).toHaveLength(1);
  });

  it('Corrigir desfaz e devolve a frase ao campo para editar', async () => {
    render(<PodeFalar />);
    escrever('Preciso parafusar o apoio do banheiro');
    fireEvent.click(pronto());
    const cartao = within(await screen.findByRole('article'));

    fireEvent.click(cartao.getByRole('button', { name: 'Corrigir' }));

    await waitFor(() => expect(campo().value).toBe('Preciso parafusar o apoio do banheiro'));
    expect(await listar('tarefas')).toEqual([]);
  });

  it('Pronto enquanto escuta para a escuta e usa o texto final', async () => {
    const voz = escutaFalsa('Usar o artigo do Prof. Souza no capítulo 2');
    render(<PodeFalar />);
    fireEvent.click(microfone());
    voz.dizer('usar o artigo');

    fireEvent.click(pronto());

    await screen.findByText('Guardado em Ideias');
    expect(voz.escuta.parar).toHaveBeenCalled();
    expect((await listar('ideias'))[0]!.texto).toBe('Usar o artigo do Prof. Souza no capítulo 2');
  });

  it('o texto falado entra no campo, que se pode editar antes do Pronto', async () => {
    const voz = escutaFalsa('revisar o capitulo dois');
    render(<PodeFalar />);
    fireEvent.click(microfone());
    voz.dizer('revisar o capitulo dois');
    fireEvent.click(microfone());

    await waitFor(() => expect(campo().value).toBe('revisar o capitulo dois'));
    escrever('Revisar o capítulo dois');
    fireEvent.click(pronto());

    await screen.findByText('Guardado em Ideias');
    expect((await listar('ideias'))[0]!.texto).toBe('Revisar o capítulo dois');
  });

  it('Cancelar para a escuta, não grava e leva de volta ao painel', async () => {
    const voz = escutaFalsa();
    render(<PodeFalar />);
    fireEvent.click(microfone());
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(voz.escuta.cancelar).toHaveBeenCalled();
    expect(location.hash).toBe('#/');
    expect(await listar('ideias')).toEqual([]);
  });
});

describe('quando a voz não funciona', () => {
  it.each([
    ['permissao_negada', /microfone não foi liberado/i],
    ['sem_suporte', /não reconhece fala/i],
    ['sem_rede', /sem internet/i],
  ])('%s: mostra a mensagem e o campo de texto continua para digitar', async (erro, mensagem) => {
    const voz = escutaFalsa();
    render(<PodeFalar />);
    fireEvent.click(microfone());
    voz.falhar(erro);

    expect(await screen.findByText(mensagem)).toBeTruthy();
    expect(campo()).toBeTruthy();
    expect(microfone()).toBeTruthy();

    escrever('Revisar o capítulo dois');
    fireEvent.click(pronto());
    await screen.findByText('Guardado em Ideias');
  });
});

describe('Gravar áudio', () => {
  const chave = () => screen.getByRole('switch', { name: 'Gravar áudio' }) as HTMLInputElement;
  const gravacaoFalsa = () => {
    const blob = new Blob(['x'], { type: 'audio/webm' });
    const gravacao = { parar: vi.fn(async () => ({ blob, segundos: 7 })), cancelar: vi.fn() };
    gravacaoMock.mockResolvedValue(gravacao);
    return { gravacao, blob };
  };

  it('a chave vem desligada, e sem ela o toque não grava áudio', async () => {
    escutaFalsa();
    render(<PodeFalar />);
    expect(chave().checked).toBe(false);

    fireEvent.click(microfone());
    expect(gravacaoMock).not.toHaveBeenCalled();
  });

  it('ligada: o mesmo toque começa a escuta e a gravação; o texto da ideia é gravado ANTES de o áudio ir', async () => {
    const voz = escutaFalsa('Usar o artigo do Prof. Souza no capítulo 2');
    const { blob } = gravacaoFalsa();
    let ideiasNoEnvio = -1;
    envioMock.mockImplementation(async () => {
      ideiasNoEnvio = (await listar('ideias')).length;
      return { driveId: 'drive-1' };
    });
    render(<PodeFalar />);
    fireEvent.click(chave());
    fireEvent.click(microfone());
    expect(escutaMock).toHaveBeenCalledTimes(1);
    expect(gravacaoMock).toHaveBeenCalledTimes(1);
    voz.dizer('usar o artigo');

    fireEvent.click(pronto());

    await screen.findByText('Guardado em Ideias');
    await waitFor(() => expect(envioMock).toHaveBeenCalledTimes(1));
    const [ideia] = await listar('ideias');
    expect(ideia).toMatchObject({ audioSegundos: 7 });
    expect(envioMock).toHaveBeenCalledWith(ideia!.audioId, blob);
    expect(ideiasNoEnvio).toBe(1);
  });

  it('o áudio fica na fila (sem internet): o texto está guardado e o cartão diz isso', async () => {
    gravacaoFalsa();
    envioMock.mockResolvedValue({ fila: true });
    escutaFalsa('Usar o artigo do Prof. Souza no capítulo 2');
    render(<PodeFalar />);
    fireEvent.click(chave());
    fireEvent.click(microfone());
    fireEvent.click(pronto());

    expect(await screen.findByText(/áudio vai para o Drive quando a internet voltar/i)).toBeTruthy();
    expect(await listar('ideias')).toHaveLength(1);
  });

  it('áudio recusado ou sem espaço: a ideia com o texto continua guardada e o cartão avisa', async () => {
    gravacaoFalsa();
    envioMock.mockResolvedValue({ erro: 'sem_espaco' });
    escutaFalsa('Usar o artigo do Prof. Souza no capítulo 2');
    render(<PodeFalar />);
    fireEvent.click(chave());
    fireEvent.click(microfone());
    fireEvent.click(pronto());

    expect(await screen.findByText(/áudio não coube/i)).toBeTruthy();
    expect(await listar('ideias')).toHaveLength(1);
  });

  it('sem permissão para gravar: avisa e segue só com o texto', async () => {
    const voz = escutaFalsa('Usar o artigo do Prof. Souza no capítulo 2');
    gravacaoMock.mockRejectedValue(Object.assign(new Error('x'), { codigo: 'permissao_negada' }));
    render(<PodeFalar />);
    fireEvent.click(chave());
    fireEvent.click(microfone());
    voz.dizer('usar o artigo');

    expect(await screen.findByText(/gravar o áudio/i)).toBeTruthy();
    fireEvent.click(pronto());
    await screen.findByText('Guardado em Ideias');
    expect(envioMock).not.toHaveBeenCalled();
  });

  it('Pronto sem texto descarta a gravação e não grava nada', async () => {
    const { gravacao } = gravacaoFalsa();
    escutaFalsa('');
    render(<PodeFalar />);
    fireEvent.click(chave());
    fireEvent.click(microfone());
    fireEvent.click(pronto());

    expect(await screen.findByText(/Ainda não ouvi nada/)).toBeTruthy();
    await waitFor(() => expect(gravacao.parar).toHaveBeenCalled()); // o microfone é solto
    expect(envioMock).not.toHaveBeenCalled();
    expect(await listar('ideias')).toEqual([]);
  });

  it('frase que vira tarefa não leva o áudio: o cartão avisa que só ideias guardam áudio', async () => {
    gravacaoFalsa();
    escutaFalsa('Preciso parafusar o apoio do banheiro');
    render(<PodeFalar />);
    fireEvent.click(chave());
    fireEvent.click(microfone());
    fireEvent.click(pronto());

    expect(await screen.findByText(/só ideias guardam áudio/i)).toBeTruthy();
    expect(envioMock).not.toHaveBeenCalled();
  });

  it('Desfazer a ideia também tira da fila o áudio que esperava rede', async () => {
    gravacaoFalsa();
    escutaFalsa('Usar o artigo do Prof. Souza no capítulo 2');
    envioMock.mockImplementation(async (id: string, blob: Blob) => {
      await guardarAudio({ id, bytes: await blob.arrayBuffer(), mime: 'audio/webm', guardadoEm: 1 });
      return { fila: true };
    });
    render(<PodeFalar />);
    fireEvent.click(chave());
    fireEvent.click(microfone());
    fireEvent.click(pronto());
    await screen.findByText(/quando a internet voltar/i);
    expect(await listarAudios()).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Desfazer' }));

    await screen.findByText('Desfeito. Nada ficou guardado.');
    expect(await listarAudios()).toEqual([]);
  });
});

describe('Guardar como ideia e áudio com problema', () => {
  const chave = () => screen.getByRole('switch', { name: 'Gravar áudio' }) as HTMLInputElement;
  const gravacaoFalsa = () => {
    const blob = new Blob(['x'], { type: 'audio/webm' });
    gravacaoMock.mockResolvedValue({ parar: vi.fn(async () => ({ blob, segundos: 7 })), cancelar: vi.fn() });
    return blob;
  };

  it('o cartão da ideia leva a #/ideias no Ver e não oferece Guardar como ideia', async () => {
    render(<PodeFalar />);
    escrever('Usar o artigo do Prof. Souza no capítulo 2');
    fireEvent.click(pronto());

    const cartao = within(await screen.findByRole('article'));
    expect(cartao.getByRole('link', { name: 'Ver' }).getAttribute('href')).toBe('#/ideias');
    expect(cartao.queryByRole('button', { name: 'Guardar como ideia' })).toBeNull();
  });

  it('o cartão de tarefa oferece Guardar como ideia: a tarefa sai e a mesma frase vira ideia', async () => {
    render(<PodeFalar />);
    escrever('Preciso parafusar o apoio do banheiro');
    fireEvent.click(pronto());
    const cartao = within(await screen.findByRole('article'));
    expect(await listar('tarefas')).toHaveLength(1);

    fireEvent.click(cartao.getByRole('button', { name: 'Guardar como ideia' }));

    expect(await screen.findByText('Guardado em Ideias')).toBeTruthy();
    expect(await listar('tarefas')).toEqual([]);
    expect(await listar('ideias')).toEqual([expect.objectContaining({ texto: 'Preciso parafusar o apoio do banheiro', estado: 'nova' })]);
    const novo = within(screen.getByRole('article'));
    expect(novo.getByRole('link', { name: 'Ver' }).getAttribute('href')).toBe('#/ideias');
    expect(novo.queryByRole('button', { name: 'Guardar como ideia' })).toBeNull();

    // O Desfazer do cartão novo apaga a ideia (e não traz a tarefa de volta).
    fireEvent.click(novo.getByRole('button', { name: 'Desfazer' }));
    await screen.findByText('Desfeito. Nada ficou guardado.');
    expect(await listar('ideias')).toEqual([]);
    expect(await listar('tarefas')).toEqual([]);
  });

  it('com áudio gravado, Guardar como ideia leva o áudio junto e o envia ao Drive', async () => {
    const blob = gravacaoFalsa();
    envioMock.mockResolvedValue({ driveId: 'drive-1' });
    escutaFalsa('Preciso parafusar o apoio do banheiro');
    render(<PodeFalar />);
    fireEvent.click(chave());
    fireEvent.click(microfone());
    fireEvent.click(pronto());
    expect(await screen.findByText(/só ideias guardam áudio/i)).toBeTruthy();
    expect(envioMock).not.toHaveBeenCalled();

    fireEvent.click(within(screen.getByRole('article')).getByRole('button', { name: 'Guardar como ideia' }));

    await screen.findByText('Guardado em Ideias');
    const [ideia] = await listar('ideias');
    expect(ideia).toMatchObject({ audioSegundos: 7 });
    await waitFor(() => expect(envioMock).toHaveBeenCalledWith(ideia!.audioId, blob));
    expect(await screen.findByText('Áudio guardado no Drive.')).toBeTruthy();
    expect(await listar('tarefas')).toEqual([]);
  });

  it('se não conseguir tirar a tarefa, o cartão da ideia diz qual item continua guardado', async () => {
    render(<PodeFalar />);
    escrever('Preciso parafusar o apoio do banheiro');
    fireEvent.click(pronto());
    const cartao = within(await screen.findByRole('article'));
    const loja = await import('../../src/dados/loja');
    const real = loja.apagar;
    vi.spyOn(loja, 'apagar').mockImplementation(((colecao: never, id: never) => {
      if ((colecao as string) === 'tarefas') return Promise.reject(new Error('disco cheio'));
      return real(colecao, id);
    }) as typeof loja.apagar);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    fireEvent.click(cartao.getByRole('button', { name: 'Guardar como ideia' }));

    expect(await screen.findByText(/não consegui tirar/i)).toBeTruthy();
    expect(screen.getByText('Guardado em Ideias')).toBeTruthy();
    expect(await listar('ideias')).toHaveLength(1);
    expect(await listar('tarefas')).toHaveLength(1);
  });

  it('durante Guardar como ideia todos os botões do cartão ficam desligados', async () => {
    render(<PodeFalar />);
    escrever('Preciso parafusar o apoio do banheiro');
    fireEvent.click(pronto());
    await screen.findByRole('article');
    const loja = await import('../../src/dados/loja');
    const real = loja.apagar;
    let liberar: () => void = () => {};
    const segura = new Promise<void>((r) => (liberar = r));
    vi.spyOn(loja, 'apagar').mockImplementation((async (colecao: never, id: never) => {
      if ((colecao as string) === 'tarefas') await segura;
      return real(colecao, id);
    }) as typeof loja.apagar);

    fireEvent.click(screen.getByRole('button', { name: 'Guardar como ideia' }));

    await waitFor(() => expect((screen.getByRole('button', { name: 'Guardar como ideia' }) as HTMLButtonElement).disabled).toBe(true));
    for (const nome of ['Desfazer', 'Corrigir', 'Falar outra', 'Fechar']) {
      expect((screen.getByRole('button', { name: nome }) as HTMLButtonElement).disabled).toBe(true);
    }
    liberar();
    await screen.findByText('Guardado em Ideias');
    expect((screen.getByRole('button', { name: 'Desfazer' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('depois de Guardar como ideia o foco vai para o cartão novo', async () => {
    render(<PodeFalar />);
    escrever('Preciso parafusar o apoio do banheiro');
    fireEvent.click(pronto());
    fireEvent.click(within(await screen.findByRole('article')).getByRole('button', { name: 'Guardar como ideia' }));

    await screen.findByText('Guardado em Ideias');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('article')));
  });

  it('Corrigir num cartão de tarefa com áudio mantém o áudio para a frase corrigida', async () => {
    const blob = gravacaoFalsa();
    envioMock.mockResolvedValue({ driveId: 'drive-1' });
    escutaFalsa('Preciso parafusar o apoio do banheiro');
    render(<PodeFalar />);
    fireEvent.click(chave());
    fireEvent.click(microfone());
    fireEvent.click(pronto());
    await screen.findByText(/só ideias guardam áudio/i);

    fireEvent.click(within(screen.getByRole('article')).getByRole('button', { name: 'Corrigir' }));
    await waitFor(() => expect(campo().value).toBe('Preciso parafusar o apoio do banheiro'));
    escrever('Usar o artigo do Prof. Souza no capítulo 2');
    fireEvent.click(pronto());

    await screen.findByText('Guardado em Ideias');
    const [ideia] = await listar('ideias');
    expect(ideia).toMatchObject({ audioSegundos: 7 });
    await waitFor(() => expect(envioMock).toHaveBeenCalledWith(ideia!.audioId, blob));
  });

  it('áudio sem espaço fica anotado como problema, para a ideia avisar "Áudio não enviado"', async () => {
    gravacaoFalsa();
    envioMock.mockResolvedValue({ erro: 'sem_espaco' });
    escutaFalsa('Usar o artigo do Prof. Souza no capítulo 2');
    render(<PodeFalar />);
    fireEvent.click(chave());
    fireEvent.click(microfone());
    fireEvent.click(pronto());
    await screen.findByText(/áudio não coube/i);

    const [ideia] = await listar('ideias');
    await waitFor(async () => expect((await problemasDosAudios()).get(ideia!.audioId!)).toBe('sem_espaco'));
  });

  it('áudio recusado pelo Drive ou que falhou ao enviar também fica anotado', async () => {
    gravacaoFalsa();
    envioMock.mockRejectedValue(Object.assign(new Error('recusado'), { name: 'ErroAudioRecusado', motivo: 'grande_demais' }));
    escutaFalsa('Usar o artigo do Prof. Souza no capítulo 2');
    render(<PodeFalar />);
    fireEvent.click(chave());
    fireEvent.click(microfone());
    fireEvent.click(pronto());
    await screen.findByText(/o áudio não pôde ser enviado/i);

    const [ideia] = await listar('ideias');
    await waitFor(async () => expect((await problemasDosAudios()).get(ideia!.audioId!)).toBe('recusado'));

    // Outro erro (script fora, por exemplo): marcado como falha de envio.
    cleanup();
    envioMock.mockRejectedValue(new Error('script fora'));
    escutaFalsa('Pensar no artigo da Aurora');
    render(<PodeFalar />);
    fireEvent.click(chave());
    fireEvent.click(microfone());
    fireEvent.click(pronto());
    await screen.findByText(/o áudio não pôde ser enviado/i);
    const outra = (await listar('ideias')).find((i) => i.texto === 'Pensar no artigo da Aurora')!;
    await waitFor(async () => expect((await problemasDosAudios()).get(outra.audioId!)).toBe('falhou'));
  });
});

describe('atalho e botões na casca', () => {
  it('Ctrl+Alt+N abre a tela Pode falar', async () => {
    history.replaceState(null, '', '/#/');
    Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true, writable: true });
    render(<App />);
    expect(screen.queryByRole('heading', { level: 1, name: 'Pode falar' })).toBeNull();

    fireEvent.keyDown(window, { key: 'n', code: 'KeyN', ctrlKey: true, altKey: true });

    await waitFor(() => expect(location.hash).toBe('#/falar'));
    act(() => {
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Pode falar' })).toBeTruthy();
    expect(microfone()).toBeTruthy();
  });

  it('no celular há o botão flutuante que leva a #/falar', async () => {
    history.replaceState(null, '', '/#/');
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true, writable: true });
    render(<App />);

    const botao = await screen.findByRole('link', { name: 'Pode falar' });
    expect(botao.getAttribute('href')).toBe('#/falar');
  });

  it('no computador o botão Pode falar fica no topo', async () => {
    history.replaceState(null, '', '/#/');
    Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true, writable: true });
    render(<App />);

    const botao = await screen.findByRole('link', { name: /Pode falar/ });
    expect(botao.getAttribute('href')).toBe('#/falar');
  });
});

/** Uma promessa que o teste resolve quando quiser. */
function adiada<T>() {
  let resolver!: (valor: T) => void;
  const promessa = new Promise<T>((r) => (resolver = r));
  return { promessa, resolver };
}

describe('textos que não valem', () => {
  it('só pontuação: avisa que não ouviu nada, sem mandar tentar de novo', async () => {
    render(<PodeFalar />);
    escrever('...');
    fireEvent.click(pronto());

    expect(await screen.findByText(/Ainda não ouvi nada/)).toBeTruthy();
    expect(screen.queryByText(/tentar de novo/)).toBeNull();
    expect(await listar('ideias')).toEqual([]);
  });

  it('mais de 2000 caracteres: pede para dividir e mantém o texto no campo', async () => {
    render(<PodeFalar />);
    const longo = `Usar o artigo ${'a'.repeat(2001)}`;
    escrever(longo);
    fireEvent.click(pronto());

    expect(await screen.findByText('Texto longo demais (máximo 2000 caracteres). Divida em partes.')).toBeTruthy();
    expect(screen.queryByText(/tentar de novo/)).toBeNull();
    expect(campo().value).toBe(longo);
    expect(await listar('ideias')).toEqual([]);
  });
});

describe('corridas e bordas', () => {
  it('duplo Pronto (ou Enter) cria uma ideia só', async () => {
    render(<PodeFalar />);
    escrever('Usar o artigo do Prof. Souza no capítulo 2');
    fireEvent.click(pronto());
    fireEvent.click(pronto());
    fireEvent.keyDown(campo(), { key: 'Enter' });

    await screen.findByText('Guardado em Ideias');
    expect(await listar('ideias')).toHaveLength(1);
  });

  it('Cancelar fica desabilitado enquanto guarda, e a tela diz "Entendendo…"', async () => {
    render(<PodeFalar />);
    escrever('Usar o artigo do Prof. Souza no capítulo 2');
    fireEvent.click(pronto());

    expect(screen.getByRole('button', { name: 'Cancelar' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('Entendendo…')).toBeTruthy();
    await screen.findByText('Guardado em Ideias');
  });

  it('o botão do microfone se chama "Falar", com aria-pressed, e a região de estado existe desde o começo', async () => {
    const voz = escutaFalsa();
    const { container } = render(<PodeFalar />);
    const estado = container.querySelector<HTMLElement>('p[role="status"].so-leitor')!;
    expect(estado).toBeTruthy();
    expect(estado.textContent).toBe('');
    expect(microfone().getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(microfone());
    voz.dizer('olá');

    expect(container.querySelector('p[role="status"].so-leitor')).toBe(estado);
    expect(microfone().getAttribute('aria-label')).toBe('Falar');
    expect(microfone().getAttribute('aria-pressed')).toBe('true');
  });

  it('a região de estado diz "Ouvindo…", "Gravando áudio…" e, ao parar, "Parei. Texto: …"', async () => {
    const voz = escutaFalsa('usar o artigo do Prof. Souza');
    gravacaoMock.mockResolvedValue({ parar: vi.fn(async () => ({ blob: new Blob(['x']), segundos: 3 })), cancelar: vi.fn() });
    const { container } = render(<PodeFalar />);
    const estado = container.querySelector<HTMLElement>('p[role="status"].so-leitor')!;

    fireEvent.click(microfone());
    expect(estado.textContent).toBe('Ouvindo…');
    voz.dizer('usar o artigo'); // o texto parcial não muda a região
    expect(estado.textContent).toBe('Ouvindo…');

    fireEvent.click(microfone()); // parar
    await waitFor(() => expect(estado.textContent).toBe('Parei. Texto: usar o artigo do Prof. Souza'));

    fireEvent.click(screen.getByRole('switch', { name: 'Gravar áudio' }));
    fireEvent.click(microfone());
    expect(estado.textContent).toBe('Ouvindo… Gravando áudio…');
  });

  it('o cartão não fica numa região viva (que leria o cartão duas vezes): recebe o foco, com nome e descrição, e nenhuma região viva tem botão', async () => {
    const { container } = render(<PodeFalar />);
    escrever('Usar o artigo do Prof. Souza no capítulo 2');
    fireEvent.click(pronto());

    const cartao = await screen.findByRole('article');
    expect(cartao.closest('[role="status"], [aria-live]')).toBeNull();
    expect(cartao.getAttribute('aria-labelledby')).toBe('falar-cartao-titulo');
    expect(document.getElementById('falar-cartao-titulo')?.textContent).toBe('Guardado em Ideias');
    expect(cartao.getAttribute('aria-describedby')).toBe('falar-cartao-detalhe');
    await waitFor(() => expect(document.activeElement).toBe(cartao));
    for (const regiao of container.querySelectorAll('[role="status"], [aria-live]')) expect(regiao.querySelector('button, a[href]')).toBeNull();
  });

  it('Falar outra e Corrigir levam o foco ao campo de texto (o botão some com o cartão)', async () => {
    render(<PodeFalar />);
    escrever('Usar o artigo do Prof. Souza no capítulo 2');
    fireEvent.click(pronto());
    let cartao = await screen.findByRole('article');
    await waitFor(() => expect(document.activeElement).toBe(cartao));

    fireEvent.click(within(cartao).getByRole('button', { name: 'Falar outra' }));
    await waitFor(() => expect(document.activeElement).toBe(campo()));

    escrever('Rever o capítulo 3');
    fireEvent.click(pronto());
    cartao = await screen.findByRole('article');
    await waitFor(() => expect(document.activeElement).toBe(cartao));
    fireEvent.click(within(cartao).getByRole('button', { name: 'Corrigir' }));
    await waitFor(() => expect(document.activeElement).toBe(campo()));
    expect(campo().value).toBe('Rever o capítulo 3');
  });

  it('Pronto sem texto liga o erro ao campo: aria-invalid, aria-describedby e o foco', async () => {
    render(<PodeFalar />);
    fireEvent.click(pronto());

    const mensagem = await screen.findByText(/Ainda não ouvi nada/);
    expect(mensagem.getAttribute('role')).toBe('alert');
    expect(campo().getAttribute('aria-invalid')).toBe('true');
    expect(campo().getAttribute('aria-describedby')).toBe(mensagem.id);
    await waitFor(() => expect(document.activeElement).toBe(campo()));

    escrever('Algo');
    expect(campo().getAttribute('aria-invalid')).toBeNull();
    expect(campo().getAttribute('aria-describedby')).toBeNull();
  });

  it('sair da tela com escuta e gravação ativas cancela as duas', async () => {
    const voz = escutaFalsa();
    const gravacao = { parar: vi.fn(), cancelar: vi.fn() };
    gravacaoMock.mockResolvedValue(gravacao);
    const { unmount } = render(<PodeFalar />);
    fireEvent.click(screen.getByRole('switch', { name: 'Gravar áudio' }));
    fireEvent.click(microfone());

    unmount();

    await waitFor(() => expect(voz.escuta.cancelar).toHaveBeenCalled());
    await waitFor(() => expect(gravacao.cancelar).toHaveBeenCalled());
  });

  it('passou de 3 minutos: a escuta parou sozinha, o texto fica e o Pronto grava', async () => {
    const voz = escutaFalsa('Usar o artigo do Prof. Souza no capítulo 2');
    render(<PodeFalar />);
    fireEvent.click(microfone());
    voz.dizer('usar o artigo');

    voz.limite();

    expect(await screen.findByText(/Passou de 3 minutos/)).toBeTruthy();
    expect(microfone().getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(pronto());
    await screen.findByText('Guardado em Ideias');
    expect((await listar('ideias'))[0]!.texto).toBe('usar o artigo');
  });

  it('parar no microfone e apertar Pronto logo em seguida espera a parada: as últimas palavras não se perdem', async () => {
    const parada = adiada<string>();
    const voz = escutaFalsa();
    voz.escuta.parar.mockReturnValue(parada.promessa);
    const blob = new Blob(['x'], { type: 'audio/webm' });
    gravacaoMock.mockResolvedValue({ parar: vi.fn(async () => ({ blob, segundos: 4 })), cancelar: vi.fn() });
    envioMock.mockResolvedValue({ driveId: 'drive-1' });
    render(<PodeFalar />);
    fireEvent.click(screen.getByRole('switch', { name: 'Gravar áudio' }));
    fireEvent.click(microfone());
    voz.dizer('usar o artigo');

    fireEvent.click(microfone()); // parar
    fireEvent.click(pronto()); // logo em seguida, antes de a parada terminar
    expect(await listar('ideias')).toEqual([]);

    parada.resolver('usar o artigo do Prof. Souza no capítulo 2');

    await screen.findByText('Guardado em Ideias');
    expect(voz.escuta.parar).toHaveBeenCalledTimes(1);
    const [ideia] = await listar('ideias');
    expect(ideia!.texto).toBe('usar o artigo do Prof. Souza no capítulo 2');
    expect(ideia).toMatchObject({ audioSegundos: 4 });
    await waitFor(() => expect(envioMock).toHaveBeenCalledWith(ideia!.audioId, blob));
  });
});

describe('Desfazer durante o envio do áudio', () => {
  async function ate(envio: (id: string, blob: Blob) => Promise<{ fila: true } | { driveId: string }>) {
    const adiado = adiada<void>();
    const blob = new Blob(['x'], { type: 'audio/webm' });
    gravacaoMock.mockResolvedValue({ parar: vi.fn(async () => ({ blob, segundos: 3 })), cancelar: vi.fn() });
    escutaFalsa('Usar o artigo do Prof. Souza no capítulo 2');
    envioMock.mockImplementation((async (id: string, b: Blob) => {
      await adiado.promessa;
      return envio(id, b);
    }) as typeof enviarAudio);
    render(<PodeFalar />);
    fireEvent.click(screen.getByRole('switch', { name: 'Gravar áudio' }));
    fireEvent.click(microfone());
    fireEvent.click(pronto());
    await screen.findByText('Enviando o áudio…');
    return adiado;
  }

  it('o áudio volta para a fila depois do Desfazer: sai da fila e nenhum aviso tardio aparece', async () => {
    const adiado = await ate(async (id, blob) => {
      await guardarAudio({ id, bytes: await blob.arrayBuffer(), mime: 'audio/webm', guardadoEm: 1 });
      return { fila: true };
    });
    fireEvent.click(screen.getByRole('button', { name: 'Desfazer' }));
    await screen.findByText('Desfeito. Nada ficou guardado.');

    adiado.resolver();

    await waitFor(async () => expect(await listarAudios()).toEqual([]));
    expect(screen.queryByText(/quando a internet voltar/)).toBeNull();
    expect(screen.queryByText('Enviando o áudio…')).toBeNull();
  });

  it('o áudio chegou ao Drive depois do Desfazer: sem aviso tardio na tela', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const adiado = await ate(async () => ({ driveId: 'drive-9' }));
    fireEvent.click(screen.getByRole('button', { name: 'Desfazer' }));
    await screen.findByText('Desfeito. Nada ficou guardado.');

    adiado.resolver();
    await new Promise((r) => setTimeout(r, 50));

    expect(screen.queryByText(/Áudio guardado no Drive/)).toBeNull();
    expect(aviso).not.toHaveBeenCalled();
    // Privacidade: o arquivo que chegou depois do Desfazer vai para a lixeira do Drive.
    await waitFor(() => expect(apagarMock).toHaveBeenCalled());
    expect(apagarMock.mock.calls.every(([id]) => typeof id === 'string' && id.length > 0)).toBe(true);
  });

  it('Desfazer pede ao Drive que apague o áudio da ideia', async () => {
    const adiado = await ate(async () => ({ driveId: 'drive-9' }));
    adiado.resolver();
    await screen.findByText('Áudio guardado no Drive.');
    fireEvent.click(screen.getByRole('button', { name: 'Desfazer' }));
    await screen.findByText('Desfeito. Nada ficou guardado.');
    await waitFor(() => expect(apagarMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('O áudio continua no Drive.')).toBeNull();
  });

  it('se o Drive não confirmar a exclusão, o cartão avisa que o áudio continua lá', async () => {
    apagarMock.mockResolvedValueOnce(false);
    const adiado = await ate(async () => ({ driveId: 'drive-9' }));
    adiado.resolver();
    await screen.findByText('Áudio guardado no Drive.');
    fireEvent.click(screen.getByRole('button', { name: 'Desfazer' }));
    expect(await screen.findByText('O áudio continua no Drive.')).toBeTruthy();
  });

  it('ideia apagada em outra tela enquanto o áudio ia: ao chegar ao Drive, ele é apagado de lá', async () => {
    let id = '';
    const adiado = await ate(async (idDoAudio) => {
      id = idDoAudio;
      const [ideia] = await listar('ideias');
      await apagarIdeia(ideia!.id);
      return { driveId: 'drive-9' };
    });
    adiado.resolver();
    await waitFor(() => expect(apagarMock).toHaveBeenCalledWith(id));
    expect(screen.queryByText('Áudio guardado no Drive.')).toBeNull();
  });
});

describe('atalho Ctrl+Alt+N em campos', () => {
  beforeEach(() => {
    history.replaceState(null, '', '/#/');
    Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true, writable: true });
  });
  const atalho = (alvo: Window | Element, extra: KeyboardEventInit = {}) =>
    fireEvent.keyDown(alvo, { key: 'n', code: 'KeyN', ctrlKey: true, altKey: true, bubbles: true, ...extra });

  it('foco no campo de outra tela: o atalho é ignorado', async () => {
    history.replaceState(null, '', '/#/chat');
    render(<App />);
    const chat = await screen.findByRole('textbox', { name: 'Escreva ou dite' });
    chat.focus();
    atalho(chat);
    expect(location.hash).not.toBe('#/falar');
  });

  it('tecla segurada (repeat) não repete a abertura', async () => {
    render(<App />);
    await screen.findByRole('navigation', { name: 'Principal' });
    atalho(window, { repeat: true });
    expect(location.hash).not.toBe('#/falar');
  });
});
