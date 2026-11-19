// A voz dentro do chat (V02.1): o botão de microfone, o texto ao vivo no campo, "Gravar áudio", os avisos e o cartão de
// resultado da ideia. Vem dos testes da tela "Pode falar" da V02, que deixou de existir. Quinta-feira, 2026-11-05, 12:20.
// Só nomes fictícios.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { limparConversa } from '../../src/chat/conversa';
import { apagarIdeia } from '../../src/dados/ideias';
import { listar, semear, semearPalavras } from '../../src/dados/loja';
import { Chat } from '../../src/ui/Chat';
import { limparPedidoDeVoz } from '../../src/ui/pedido-de-voz';
import { apagarAudioDoDrive } from '../../src/voz/apagar-audio';
import { guardarAudio, listarAudios, problemasDosAudios } from '../../src/voz/audios-pendentes';
import { enviarAudio, iniciarGravacao } from '../../src/voz/gravador';
import { iniciarEscuta } from '../../src/voz/reconhecimento';

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

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 5, 12, 20));
  history.replaceState(null, '', '/#/chat');
  vi.clearAllMocks();
  limparConversa();
  limparPedidoDeVoz();
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

const microfone = () => screen.getByRole('button', { name: 'Falar no chat' });
const campo = () => screen.getByRole('textbox', { name: 'Escreva ou dite' }) as HTMLInputElement;
const botaoEnviar = () => screen.getByRole('button', { name: 'Enviar' });
const escrever = (texto: string) => fireEvent.input(campo(), { target: { value: texto } });
const chave = () => screen.getByRole('switch', { name: 'Gravar áudio' }) as HTMLInputElement;
const IDEIA = 'ideia: usar o artigo do Prof. Souza no capítulo 2';
const TEXTO_DA_IDEIA = 'usar o artigo do Prof. Souza no capítulo 2';

/** Uma promessa que o teste resolve quando quiser. */
function adiada<T>() {
  let resolver!: (valor: T) => void;
  const promessa = new Promise<T>((r) => (resolver = r));
  return { promessa, resolver };
}

describe('o microfone do chat', () => {
  it('avisa, perto do microfone, que o reconhecimento de voz do navegador envia o áudio ao Google', () => {
    escutaFalsa();
    render(<Chat />);
    expect(screen.getByText('O reconhecimento de voz do navegador envia o áudio ao Google. Para não enviar, escreva.')).toBeTruthy();
  });

  it('o chat tem o botão de microfone ao lado do campo e não escuta sozinho: só um toque começa', () => {
    escutaFalsa();
    render(<Chat />);

    expect(microfone()).toBeTruthy();
    expect(escutaMock).not.toHaveBeenCalled();

    fireEvent.click(microfone());
    expect(escutaMock).toHaveBeenCalledTimes(1);
    expect(microfone().getAttribute('aria-pressed')).toBe('true');
  });

  it('um toque começa a escuta e o texto aparece ao vivo no campo; o texto parcial NÃO é anunciado palavra por palavra', async () => {
    const voz = escutaFalsa();
    render(<Chat />);
    fireEvent.click(microfone());

    voz.dizer('marcar reunião com a Marina');

    await waitFor(() => expect(campo().value).toBe('marcar reunião com a Marina'));
    expect(campo().readOnly).toBe(true); // ouvindo, o campo só mostra
    expect(campo().closest('[aria-live], [role="status"], [role="log"]')).toBeNull();
    expect(screen.getAllByRole('status').every((regiao) => !regiao.textContent?.includes('marcar reunião'))).toBe(true);
  });

  it('Enviar enquanto escuta para a escuta e manda o texto final', async () => {
    const voz = escutaFalsa(IDEIA);
    render(<Chat />);
    fireEvent.click(microfone());
    voz.dizer('ideia usar o artigo');

    fireEvent.click(botaoEnviar());

    await screen.findByText('Guardado em Ideias');
    expect(voz.escuta.parar).toHaveBeenCalled();
    expect((await listar('ideias'))[0]!.texto).toBe(TEXTO_DA_IDEIA);
    expect(campo().value).toBe('');
    expect(campo().readOnly).toBe(false);
  });

  it('parar no microfone deixa o texto no campo, que se pode editar antes de Enviar', async () => {
    const voz = escutaFalsa('ideia revisar o capitulo dois');
    render(<Chat />);
    fireEvent.click(microfone());
    voz.dizer('ideia revisar o capitulo dois');
    fireEvent.click(microfone());

    await waitFor(() => expect(campo().value).toBe('ideia revisar o capitulo dois'));
    escrever('ideia: Revisar o capítulo dois');
    fireEvent.click(botaoEnviar());

    await screen.findByText('Guardado em Ideias');
    expect((await listar('ideias'))[0]!.texto).toBe('Revisar o capítulo dois');
  });

  it('o que já estava escrito fica, e o que se fala vem depois dele', async () => {
    const voz = escutaFalsa('de receitas');
    render(<Chat />);
    escrever('ideia: app');
    fireEvent.click(microfone());
    voz.dizer('de receitas');
    await waitFor(() => expect(campo().value).toBe('ideia: app de receitas'));
    fireEvent.click(microfone());
    await waitFor(() => expect(microfone().getAttribute('aria-pressed')).toBe('false'));
    expect(campo().value).toBe('ideia: app de receitas');
  });

  it('Esc com o microfone ligado só para de ouvir', async () => {
    const voz = escutaFalsa('ideia: app de receitas');
    render(<Chat />);
    fireEvent.click(microfone());

    fireEvent.keyDown(campo(), { key: 'Escape' });

    await waitFor(() => expect(microfone().getAttribute('aria-pressed')).toBe('false'));
    expect(voz.escuta.parar).toHaveBeenCalled();
    expect(campo().value).toBe('ideia: app de receitas');
  });

  it('o botão se chama "Falar", com aria-pressed, e a região de estado existe desde o começo', () => {
    const voz = escutaFalsa();
    const { container } = render(<Chat />);
    const estado = container.querySelector<HTMLElement>('p[role="status"].so-leitor')!;
    expect(estado).toBeTruthy();
    expect(estado.textContent).toBe('');
    expect(microfone().getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(microfone());
    voz.dizer('olá');

    expect(container.querySelector('p[role="status"].so-leitor')).toBe(estado);
    expect(microfone().getAttribute('aria-label')).toBe('Falar no chat');
    expect(microfone().getAttribute('aria-pressed')).toBe('true');
  });

  it('a região de estado diz "Ouvindo…", "Gravando áudio…" e, ao parar, "Parei. Texto no campo." (sem ler a frase)', async () => {
    const voz = escutaFalsa('usar o artigo do Prof. Souza');
    gravacaoMock.mockResolvedValue({ parar: vi.fn(async () => ({ blob: new Blob(['x']), segundos: 3 })), cancelar: vi.fn() });
    const { container } = render(<Chat />);
    const estado = container.querySelector<HTMLElement>('p[role="status"].so-leitor')!;

    fireEvent.click(microfone());
    expect(estado.textContent).toBe('Ouvindo…');
    voz.dizer('usar o artigo'); // o texto parcial não muda a região
    expect(estado.textContent).toBe('Ouvindo…');

    fireEvent.click(microfone()); // parar
    await waitFor(() => expect(estado.textContent).toBe('Parei. Texto no campo.'));
    expect(campo().value).toBe('usar o artigo do Prof. Souza');

    fireEvent.click(chave());
    fireEvent.click(microfone());
    expect(estado.textContent).toBe('Ouvindo… Gravando áudio…');
  });

  it('sair da tela com escuta e gravação ativas cancela as duas', async () => {
    const voz = escutaFalsa();
    const gravacao = { parar: vi.fn(), cancelar: vi.fn() };
    gravacaoMock.mockResolvedValue(gravacao);
    const { unmount } = render(<Chat />);
    fireEvent.click(chave());
    fireEvent.click(microfone());

    unmount();

    await waitFor(() => expect(voz.escuta.cancelar).toHaveBeenCalled());
    await waitFor(() => expect(gravacao.cancelar).toHaveBeenCalled());
  });

  it('passou de 3 minutos: a escuta parou sozinha, o texto fica e o Enviar manda', async () => {
    const voz = escutaFalsa(IDEIA);
    render(<Chat />);
    fireEvent.click(microfone());
    voz.dizer('ideia: usar o artigo');

    voz.limite();

    expect(await screen.findByText(/Passou de 3 minutos/)).toBeTruthy();
    expect(microfone().getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(botaoEnviar());
    await screen.findByText('Guardado em Ideias');
    // A escuta fechou sozinha: vale o texto final dela, não só o último parcial.
    expect((await listar('ideias'))[0]!.texto).toBe(TEXTO_DA_IDEIA);
  });

  it('parar no microfone e apertar Enviar logo em seguida espera a parada: as últimas palavras não se perdem', async () => {
    const parada = adiada<string>();
    const voz = escutaFalsa();
    voz.escuta.parar.mockReturnValue(parada.promessa);
    const blob = new Blob(['x'], { type: 'audio/webm' });
    gravacaoMock.mockResolvedValue({ parar: vi.fn(async () => ({ blob, segundos: 4 })), cancelar: vi.fn() });
    envioMock.mockResolvedValue({ driveId: 'drive-1' });
    render(<Chat />);
    fireEvent.click(chave());
    fireEvent.click(microfone());
    voz.dizer('ideia: usar o artigo');

    fireEvent.click(microfone()); // parar
    fireEvent.click(botaoEnviar()); // logo em seguida, antes de a parada terminar
    expect(await listar('ideias')).toEqual([]);

    parada.resolver(IDEIA);

    await screen.findByText('Guardado em Ideias');
    expect(voz.escuta.parar).toHaveBeenCalledTimes(1);
    const [ideia] = await listar('ideias');
    expect(ideia!.texto).toBe(TEXTO_DA_IDEIA);
    expect(ideia).toMatchObject({ audioSegundos: 4 });
    await waitFor(() => expect(envioMock).toHaveBeenCalledWith(ideia!.audioId, blob));
  });
});

describe('quando a voz não funciona', () => {
  it.each([
    ['permissao_negada', /microfone não foi liberado/i],
    ['sem_suporte', /não reconhece fala/i],
    ['sem_rede', /sem internet/i],
  ])('%s: mostra a mensagem e o campo de texto continua para escrever', async (erro, mensagem) => {
    const voz = escutaFalsa();
    render(<Chat />);
    fireEvent.click(microfone());
    voz.falhar(erro);

    expect(await screen.findByText(mensagem)).toBeTruthy();
    expect(campo().readOnly).toBe(false);
    expect(microfone().getAttribute('aria-pressed')).toBe('false');

    escrever('ideia: revisar o capítulo dois');
    fireEvent.click(botaoEnviar());
    await screen.findByText('Guardado em Ideias');
  });
});

describe('Gravar áudio', () => {
  const gravacaoFalsa = () => {
    const blob = new Blob(['x'], { type: 'audio/webm' });
    const gravacao = { parar: vi.fn(async () => ({ blob, segundos: 7 })), cancelar: vi.fn() };
    gravacaoMock.mockResolvedValue(gravacao);
    return { gravacao, blob };
  };

  it('a chave vem desligada, e sem ela o toque não grava áudio', () => {
    escutaFalsa();
    render(<Chat />);
    expect(chave().checked).toBe(false);

    fireEvent.click(microfone());
    expect(gravacaoMock).not.toHaveBeenCalled();
  });

  it('ligada: o mesmo toque começa a escuta e a gravação; o texto da ideia é gravado ANTES de o áudio ir', async () => {
    const voz = escutaFalsa(IDEIA);
    const { blob } = gravacaoFalsa();
    let ideiasNoEnvio = -1;
    envioMock.mockImplementation(async () => {
      ideiasNoEnvio = (await listar('ideias')).length;
      return { driveId: 'drive-1' };
    });
    render(<Chat />);
    fireEvent.click(chave());
    fireEvent.click(microfone());
    expect(escutaMock).toHaveBeenCalledTimes(1);
    expect(gravacaoMock).toHaveBeenCalledTimes(1);
    voz.dizer('ideia usar o artigo');

    fireEvent.click(botaoEnviar());

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
    escutaFalsa(IDEIA);
    render(<Chat />);
    fireEvent.click(chave());
    fireEvent.click(microfone());
    fireEvent.click(botaoEnviar());

    expect(await screen.findByText(/áudio vai para o Drive quando a internet voltar/i)).toBeTruthy();
    expect(await listar('ideias')).toHaveLength(1);
  });

  it('áudio recusado ou sem espaço: a ideia com o texto continua guardada e o cartão avisa', async () => {
    gravacaoFalsa();
    envioMock.mockResolvedValue({ erro: 'sem_espaco' });
    escutaFalsa(IDEIA);
    render(<Chat />);
    fireEvent.click(chave());
    fireEvent.click(microfone());
    fireEvent.click(botaoEnviar());

    expect(await screen.findByText(/áudio não coube/i)).toBeTruthy();
    expect(await listar('ideias')).toHaveLength(1);
  });

  it('sem permissão para gravar: avisa e segue só com o texto', async () => {
    const voz = escutaFalsa(IDEIA);
    gravacaoMock.mockRejectedValue(Object.assign(new Error('x'), { codigo: 'permissao_negada' }));
    render(<Chat />);
    fireEvent.click(chave());
    fireEvent.click(microfone());
    voz.dizer('ideia usar o artigo');

    expect(await screen.findByText(/gravar o áudio/i)).toBeTruthy();
    fireEvent.click(botaoEnviar());
    await screen.findByText('Guardado em Ideias');
    expect(envioMock).not.toHaveBeenCalled();
  });

  it('Enviar sem texto descarta a gravação e não grava nada', async () => {
    const { gravacao } = gravacaoFalsa();
    escutaFalsa('');
    render(<Chat />);
    fireEvent.click(chave());
    fireEvent.click(microfone());
    fireEvent.click(botaoEnviar());

    expect(await screen.findByText(/Ainda não ouvi nada/)).toBeTruthy();
    await waitFor(() => expect(gravacao.parar).toHaveBeenCalled()); // o microfone é solto
    expect(envioMock).not.toHaveBeenCalled();
    expect(await listar('ideias')).toEqual([]);
  });

  it('frase que vira tarefa não leva o áudio: o cartão avisa que só ideias guardam áudio', async () => {
    gravacaoFalsa();
    escutaFalsa('Preciso parafusar o apoio do banheiro');
    render(<Chat />);
    fireEvent.click(chave());
    fireEvent.click(microfone());
    fireEvent.click(botaoEnviar());

    expect(await screen.findByText(/só ideias guardam áudio/i)).toBeTruthy();
    expect(envioMock).not.toHaveBeenCalled();
  });

  it('Desfazer a ideia também tira da fila o áudio que esperava rede', async () => {
    gravacaoFalsa();
    escutaFalsa(IDEIA);
    envioMock.mockImplementation(async (id: string, blob: Blob) => {
      await guardarAudio({ id, bytes: await blob.arrayBuffer(), mime: 'audio/webm', guardadoEm: 1 });
      return { fila: true };
    });
    render(<Chat />);
    fireEvent.click(chave());
    fireEvent.click(microfone());
    fireEvent.click(botaoEnviar());
    await screen.findByText(/quando a internet voltar/i);
    expect(await listarAudios()).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Desfazer' }));

    await screen.findByText('Desfeito. Nada ficou guardado.');
    expect(await listarAudios()).toEqual([]);
  });
});

describe('Guardar como ideia (tarefa e áudio com problema)', () => {
  const gravacaoFalsa = () => {
    const blob = new Blob(['x'], { type: 'audio/webm' });
    gravacaoMock.mockResolvedValue({ parar: vi.fn(async () => ({ blob, segundos: 7 })), cancelar: vi.fn() });
    return blob;
  };
  const FRASE = 'Preciso parafusar o apoio do banheiro';

  async function cartaoDaTarefa() {
    const cartao = within(await screen.findByRole('article'));
    await cartao.findByRole('button', { name: 'Guardar como ideia' }); // já guardado
    return cartao;
  }

  it('o cartão da ideia leva a #/ideias no Ver e não oferece Guardar como ideia', async () => {
    render(<Chat />);
    escrever(IDEIA);
    fireEvent.click(botaoEnviar());

    const cartao = within(await screen.findByRole('article'));
    expect(cartao.getByText('Guardado em Ideias')).toBeTruthy();
    expect(cartao.getByRole('link', { name: 'Ver' }).getAttribute('href')).toBe('#/ideias');
    expect(cartao.queryByRole('button', { name: 'Guardar como ideia' })).toBeNull();
  });

  it('o cartão de tarefa oferece Guardar como ideia: a tarefa sai e a mesma frase vira ideia', async () => {
    render(<Chat />);
    escrever(FRASE);
    fireEvent.click(botaoEnviar());
    const cartao = await cartaoDaTarefa();
    expect(await listar('tarefas')).toHaveLength(1);

    fireEvent.click(cartao.getByRole('button', { name: 'Guardar como ideia' }));

    expect(await screen.findByText('Guardado em Ideias')).toBeTruthy();
    expect(await listar('tarefas')).toEqual([]);
    expect(await listar('ideias')).toEqual([expect.objectContaining({ texto: FRASE, estado: 'nova' })]);
    const [tarefa, ideia] = screen.getAllByRole('article');
    expect(within(tarefa!).getByText(/Trocado por uma ideia/)).toBeTruthy();
    const novo = within(ideia!);
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
    escutaFalsa(FRASE);
    render(<Chat />);
    fireEvent.click(chave());
    fireEvent.click(microfone());
    fireEvent.click(botaoEnviar());
    expect(await screen.findByText(/só ideias guardam áudio/i)).toBeTruthy();
    expect(envioMock).not.toHaveBeenCalled();
    const cartao = await cartaoDaTarefa();

    fireEvent.click(cartao.getByRole('button', { name: 'Guardar como ideia' }));

    await screen.findByText('Guardado em Ideias');
    const [ideia] = await listar('ideias');
    expect(ideia).toMatchObject({ audioSegundos: 7 });
    await waitFor(() => expect(envioMock).toHaveBeenCalledWith(ideia!.audioId, blob));
    expect(await screen.findByText('Áudio guardado no Drive.')).toBeTruthy();
    expect(await listar('tarefas')).toEqual([]);
  });

  it('se não conseguir tirar a tarefa, a ideia fica e o cartão diz qual item continua guardado', async () => {
    render(<Chat />);
    escrever(FRASE);
    fireEvent.click(botaoEnviar());
    const cartao = await cartaoDaTarefa();
    const loja = await import('../../src/dados/loja');
    const real = loja.apagar;
    vi.spyOn(loja, 'apagar').mockImplementation(((colecao: never, id: never) => {
      if ((colecao as string) === 'tarefas') return Promise.reject(new Error('disco cheio'));
      return real(colecao, id);
    }) as typeof loja.apagar);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    fireEvent.click(cartao.getByRole('button', { name: 'Guardar como ideia' }));

    // Os dois cartões dizem: o da tarefa ("este item continua guardado") e o da ideia (qual item).
    expect((await screen.findAllByText(/não consegui tirar/i)).length).toBe(2);
    expect(screen.getByText('Guardado em Ideias')).toBeTruthy();
    expect(await listar('ideias')).toHaveLength(1);
    expect(await listar('tarefas')).toHaveLength(1);
    // A tarefa continua guardada e continua com o Desfazer.
    expect(within(screen.getAllByRole('article')[0]!).getByRole('button', { name: 'Desfazer' })).toBeTruthy();
  });

  it('durante Guardar como ideia o cartão da tarefa não oferece mais nenhum botão; ao terminar, o da ideia tem Desfazer', async () => {
    render(<Chat />);
    escrever(FRASE);
    fireEvent.click(botaoEnviar());
    const cartao = await cartaoDaTarefa();
    const loja = await import('../../src/dados/loja');
    const real = loja.apagar;
    const segura = adiada<void>();
    vi.spyOn(loja, 'apagar').mockImplementation((async (colecao: never, id: never) => {
      if ((colecao as string) === 'tarefas') await segura.promessa;
      return real(colecao, id);
    }) as typeof loja.apagar);

    fireEvent.click(cartao.getByRole('button', { name: 'Guardar como ideia' }));

    await waitFor(() => expect(cartao.queryByRole('button', { name: 'Guardar como ideia' })).toBeNull());
    expect(cartao.queryByRole('button', { name: 'Desfazer' })).toBeNull();
    segura.resolver();
    await screen.findByText('Guardado em Ideias');
    expect((within(screen.getAllByRole('article')[1]!).getByRole('button', { name: 'Desfazer' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('depois de Guardar como ideia o foco vai para o cartão da tarefa trocada (o botão apertado sumiu)', async () => {
    render(<Chat />);
    escrever(FRASE);
    fireEvent.click(botaoEnviar());
    const cartao = await cartaoDaTarefa();
    fireEvent.click(cartao.getByRole('button', { name: 'Guardar como ideia' }));

    await screen.findByText('Guardado em Ideias');
    await waitFor(() => expect(screen.getAllByRole('article')).toContain(document.activeElement));
  });

  it('áudio sem espaço fica anotado como problema, para a ideia avisar "Áudio não enviado"', async () => {
    gravacaoFalsa();
    envioMock.mockResolvedValue({ erro: 'sem_espaco' });
    escutaFalsa(IDEIA);
    render(<Chat />);
    fireEvent.click(chave());
    fireEvent.click(microfone());
    fireEvent.click(botaoEnviar());
    await screen.findByText(/áudio não coube/i);

    const [ideia] = await listar('ideias');
    await waitFor(async () => expect((await problemasDosAudios()).get(ideia!.audioId!)).toBe('sem_espaco'));
  });

  it('áudio recusado pelo Drive ou que falhou ao enviar também fica anotado', async () => {
    gravacaoFalsa();
    envioMock.mockRejectedValue(Object.assign(new Error('recusado'), { name: 'ErroAudioRecusado', motivo: 'grande_demais' }));
    escutaFalsa(IDEIA);
    render(<Chat />);
    fireEvent.click(chave());
    fireEvent.click(microfone());
    fireEvent.click(botaoEnviar());
    await screen.findByText(/o áudio não pôde ser enviado/i);

    const [ideia] = await listar('ideias');
    await waitFor(async () => expect((await problemasDosAudios()).get(ideia!.audioId!)).toBe('recusado'));

    // Outro erro (script fora, por exemplo): marcado como falha de envio.
    cleanup();
    limparConversa();
    envioMock.mockRejectedValue(new Error('script fora'));
    escutaFalsa('ideia: pensar no artigo da Aurora');
    render(<Chat />);
    fireEvent.click(chave());
    fireEvent.click(microfone());
    fireEvent.click(botaoEnviar());
    await screen.findByText(/o áudio não pôde ser enviado/i);
    const outra = (await listar('ideias')).find((i) => i.texto === 'pensar no artigo da Aurora')!;
    await waitFor(async () => expect((await problemasDosAudios()).get(outra.audioId!)).toBe('falhou'));
  });
});

describe('textos que não valem', () => {
  it('só pontuação: avisa que não ouviu nada, sem mandar tentar de novo, e nada é gravado', async () => {
    render(<Chat />);
    escrever('...');
    fireEvent.click(botaoEnviar());

    expect(await screen.findByText(/Ainda não ouvi nada/)).toBeTruthy();
    expect(screen.queryByText(/tentar de novo/)).toBeNull();
    expect(await listar('ideias')).toEqual([]);
    expect(await listar('tarefas')).toEqual([]);
    expect(screen.queryByRole('article')).toBeNull();
  });

  it('mais de 2000 caracteres: pede para dividir e mantém o texto no campo', async () => {
    render(<Chat />);
    const longo = `Usar o artigo ${'a'.repeat(2001)}`;
    escrever(longo);
    fireEvent.click(botaoEnviar());

    expect(await screen.findByText('Texto longo demais (máximo 2000 caracteres). Divida em partes.')).toBeTruthy();
    expect(screen.queryByText(/tentar de novo/)).toBeNull();
    expect(campo().value).toBe(longo);
    expect(await listar('ideias')).toEqual([]);
    expect(await listar('tarefas')).toEqual([]);
  });

  it('Enviar com o campo em branco não faz nada (nem reclama): um segundo toque logo depois do primeiro é inofensivo', async () => {
    render(<Chat />);
    fireEvent.click(botaoEnviar());
    await new Promise((pronto) => setTimeout(pronto, 30));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('article')).toBeNull();
  });

  it('o erro liga ao campo: aria-invalid, aria-describedby e o foco; escrever limpa', async () => {
    render(<Chat />);
    escrever('...');
    fireEvent.click(botaoEnviar());

    const mensagem = await screen.findByText(/Ainda não ouvi nada/);
    expect(mensagem.getAttribute('role')).toBe('alert');
    expect(campo().getAttribute('aria-invalid')).toBe('true');
    expect(campo().getAttribute('aria-describedby')).toBe(mensagem.id);
    await waitFor(() => expect(document.activeElement).toBe(campo()));

    escrever('Algo');
    expect(campo().getAttribute('aria-invalid')).toBeNull();
    expect(campo().getAttribute('aria-describedby')).toBeNull();
  });
});

describe('corridas e bordas', () => {
  it('duplo Enviar (ou Enter) cria uma ideia só', async () => {
    render(<Chat />);
    escrever(IDEIA);
    fireEvent.click(botaoEnviar());
    fireEvent.click(botaoEnviar());
    fireEvent.submit(campo().closest('form')!);

    await screen.findByText('Guardado em Ideias');
    expect(await listar('ideias')).toHaveLength(1);
  });

  it('o cartão do resultado recebe nome e descrição, e nenhuma região viva que o contenha tem botão (leria duas vezes)', async () => {
    const { container } = render(<Chat />);
    escrever(IDEIA);
    fireEvent.click(botaoEnviar());

    const cartao = await screen.findByRole('article');
    const titulo = document.getElementById(cartao.getAttribute('aria-labelledby')!);
    expect(titulo?.textContent).toBe('Guardado em Ideias');
    expect(document.getElementById(cartao.getAttribute('aria-describedby')!)?.textContent).toContain(TEXTO_DA_IDEIA);
    // O registro da conversa é a região viva que anuncia a resposta; as regiões de estado ficam sem botões.
    for (const regiao of container.querySelectorAll('p[role="status"]')) expect(regiao.querySelector('button, a[href]')).toBeNull();
  });

  it('Desfazer leva o foco ao cartão (o botão apertado some)', async () => {
    render(<Chat />);
    escrever(IDEIA);
    fireEvent.click(botaoEnviar());
    const cartao = await screen.findByRole('article');

    fireEvent.click(within(cartao).getByRole('button', { name: 'Desfazer' }));

    await screen.findByText('Desfeito. Nada ficou guardado.');
    await waitFor(() => expect(document.activeElement).toBe(cartao));
  });
});

describe('Desfazer durante o envio do áudio', () => {
  async function ate(envio: (id: string, blob: Blob) => Promise<{ fila: true } | { driveId: string }>) {
    const adiado = adiada<void>();
    const blob = new Blob(['x'], { type: 'audio/webm' });
    gravacaoMock.mockResolvedValue({ parar: vi.fn(async () => ({ blob, segundos: 3 })), cancelar: vi.fn() });
    escutaFalsa(IDEIA);
    envioMock.mockImplementation((async (id: string, b: Blob) => {
      await adiado.promessa;
      return envio(id, b);
    }) as typeof enviarAudio);
    render(<Chat />);
    fireEvent.click(chave());
    fireEvent.click(microfone());
    fireEvent.click(botaoEnviar());
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

  it('o áudio chegou ao Drive depois do Desfazer: sem aviso tardio na tela, e o arquivo vai para a lixeira', async () => {
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
