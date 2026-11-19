// Revisão da voz e do chat da V02.1: o áudio que não gruda em outra frase, o limite de 3 minutos, o texto digitado que não
// é pisado, o atalho que só liga, a pasta de onde o dono veio, o "Guardar como ideia" no primeiro item guardado e os
// detalhes de acessibilidade do campo. Quinta-feira, 2026-11-05, 12:20. Só nomes fictícios.
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { audiosEsperandoAgora, desfazerCartao, lerConversa, limparConversa } from '../../src/chat/conversa';
import { usarIA } from '../../src/chat/interpretar';
import * as loja from '../../src/dados/loja';
import { listar, salvar, semear, semearPalavras } from '../../src/dados/loja';
import type { IA } from '../../src/ia/ia';
import { Chat } from '../../src/ui/Chat';
import { esquecerATela } from '../../src/ui/pasta-do-chat';
import { limparPedidoDeVoz, pedirVoz } from '../../src/ui/pedido-de-voz';
import { enviarAudio, iniciarGravacao } from '../../src/voz/gravador';
import { iniciarEscuta } from '../../src/voz/reconhecimento';
import { comoCelular } from '../apoio/aparelho';
import { CABECALHO_COMPRAS, falsoDasPlanilhas, reiniciarPlanilhas } from '../apoio/planilhas-falsas';

vi.mock('../../src/dados/planilhas', async (importar) => (await import('../apoio/planilhas-falsas')).comPlanilhasFalsas(await importar<typeof import('../../src/dados/planilhas')>()));
vi.mock('../../src/voz/reconhecimento', () => ({ iniciarEscuta: vi.fn() }));
vi.mock('../../src/voz/gravador', () => ({
  iniciarGravacao: vi.fn(),
  enviarAudio: vi.fn(),
  reenviarAudiosPendentes: vi.fn(async () => ({ enviados: [], descartados: [], restantes: 0, falhas: [] })),
}));
vi.mock('../../src/voz/apagar-audio', () => ({ apagarAudioDoDrive: vi.fn(async () => true) }));

configure({ asyncUtilTimeout: 5000 });

const escutaMock = vi.mocked(iniciarEscuta);
const gravacaoMock = vi.mocked(iniciarGravacao);
const envioMock = vi.mocked(enviarAudio);
const planilhas = falsoDasPlanilhas();
const COMPRAS = 'planilha-ficticia-compras';

const IDEIA = 'ideia: usar o artigo do Prof. Souza no capítulo 2';
const TEXTO_DA_IDEIA = 'usar o artigo do Prof. Souza no capítulo 2';

beforeEach(async () => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 5, 12, 20));
  history.replaceState(null, '', '/#/chat');
  vi.clearAllMocks();
  limparConversa();
  limparPedidoDeVoz();
  esquecerATela();
  reiniciarPlanilhas();
  await semear();
  await semearPalavras();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  usarIA({ estado: () => 'ausente', interpretar: async () => null });
});

function escutaFalsa(textoFinal = '') {
  let aoTexto: (texto: string, parcial: boolean) => void = () => {};
  let aoAviso: (aviso: 'limite') => void = () => {};
  let pararComo: () => Promise<string> = async () => textoFinal;
  const escuta = { parar: vi.fn(() => pararComo()), cancelar: vi.fn() };
  escutaMock.mockImplementation(((t: typeof aoTexto, _e: unknown, _c: unknown, opcoes?: { aoAviso?: typeof aoAviso }) => {
    aoTexto = t;
    if (opcoes?.aoAviso) aoAviso = opcoes.aoAviso;
    return escuta;
  }) as unknown as typeof iniciarEscuta);
  return {
    escuta,
    pararComo: (f: () => Promise<string>) => {
      pararComo = f;
    },
    limite: () => act(() => aoAviso('limite')),
    dizer: (texto: string) => act(() => aoTexto(texto, true)),
  };
}

function adiada<T>() {
  let resolver!: (valor: T) => void;
  const promessa = new Promise<T>((r) => (resolver = r));
  return { promessa, resolver };
}

const microfone = () => screen.getByRole('button', { name: 'Falar no chat' });
const campo = () => screen.getByRole('textbox', { name: 'Escreva ou dite' }) as HTMLInputElement;
const botaoEnviar = () => screen.getByRole('button', { name: 'Enviar' });
const chave = () => screen.getByRole('switch', { name: 'Gravar áudio' }) as HTMLInputElement;
const escrever = (texto: string) => fireEvent.input(campo(), { target: { value: texto } });
const blob = new Blob(['x'], { type: 'audio/webm' });
const gravacaoQueFecha = () => gravacaoMock.mockResolvedValue({ parar: vi.fn(async () => ({ blob, segundos: 5 })), cancelar: vi.fn() });

/** Liga o microfone com "Gravar áudio", fala, e para: o áudio fica retido, esperando o Enviar. */
async function falarEParar(voz: ReturnType<typeof escutaFalsa>, frase = IDEIA) {
  fireEvent.click(chave());
  fireEvent.click(microfone());
  voz.dizer(frase);
  fireEvent.click(microfone());
  await waitFor(() => expect(campo().value).toBe(frase));
  await waitFor(() => expect(microfone().getAttribute('aria-pressed')).toBe('false'));
}

describe('o microfone', () => {
  it('diz o atalho e, ouvindo, mostra o estado sem depender de animação ou cor (o ícone vira o quadrado de parar)', () => {
    escutaFalsa();
    render(<Chat />);
    expect(microfone().getAttribute('title')).toBe('Ctrl+Alt+N');
    expect(microfone().getAttribute('aria-keyshortcuts')).toBe('Control+Alt+N');
    const parado = microfone().querySelector('path')!.getAttribute('d');

    fireEvent.click(microfone());

    expect(microfone().getAttribute('aria-pressed')).toBe('true');
    expect(microfone().querySelector('path')!.getAttribute('d')).not.toBe(parado);
  });
});

describe('o bloco de baixo tem a mesma estrutura ouvindo ou não', () => {
  it('a chave fica no lugar (desligada ao ouvir) e o aviso de privacidade continua lá, mais curto', () => {
    escutaFalsa();
    render(<Chat />);
    const chaveAntes = chave();
    expect(chaveAntes.disabled).toBe(false);
    expect(screen.getByText(/vai ao Google\. Para não enviar, escreva\./)).toBeTruthy();

    fireEvent.click(microfone());

    expect(chave()).toBe(chaveAntes); // o mesmo elemento, no mesmo lugar
    expect(chave().disabled).toBe(true);
    expect(screen.getByText('O áudio vai ao Google.')).toBeTruthy();
    expect(screen.getByText(/Ouvindo….*toque no microfone para parar/)).toBeTruthy();
  });

  it('a região de aviso do áudio existe desde o começo, vazia', () => {
    const { container } = render(<Chat />);
    const regiao = container.querySelector('p.chat-aviso-audio')!;
    expect(regiao.getAttribute('role')).toBe('status');
    expect(regiao.textContent).toBe('');
  });

  it('o texto ao vivo rola o campo até o fim', async () => {
    const voz = escutaFalsa();
    render(<Chat />);
    Object.defineProperty(campo(), 'scrollWidth', { value: 480, configurable: true });
    fireEvent.click(microfone());

    voz.dizer('uma frase bem comprida que não cabe no campo estreito do painel');

    await waitFor(() => expect(campo().scrollLeft).toBe(480));
  });
});

describe('o áudio retido não gruda em outra frase', () => {
  it('campo editado à mão: o áudio sai e a frase vai só com o texto', async () => {
    gravacaoQueFecha();
    envioMock.mockResolvedValue({ driveId: 'drive-1' });
    const voz = escutaFalsa(IDEIA);
    render(<Chat />);
    await falarEParar(voz);

    escrever('ideia: outra coisa que não foi dita');
    fireEvent.click(botaoEnviar());

    await screen.findByText('Guardado em Ideias');
    expect((await listar('ideias'))[0]).not.toHaveProperty('audioId');
    expect(envioMock).not.toHaveBeenCalled();
  });

  it('campo esvaziado à mão e outra frase escrita: sem o áudio antigo', async () => {
    gravacaoQueFecha();
    const voz = escutaFalsa(IDEIA);
    render(<Chat />);
    await falarEParar(voz);

    escrever('');
    escrever('ideia: escrita agora');
    fireEvent.click(botaoEnviar());

    await screen.findByText('Guardado em Ideias');
    expect(envioMock).not.toHaveBeenCalled();
  });

  it('"Gravar áudio" desligado depois de falar: o áudio sai', async () => {
    gravacaoQueFecha();
    const voz = escutaFalsa(IDEIA);
    render(<Chat />);
    await falarEParar(voz);

    fireEvent.click(chave()); // desliga

    fireEvent.click(botaoEnviar());
    await screen.findByText('Guardado em Ideias');
    expect((await listar('ideias'))[0]).not.toHaveProperty('audioId');
    expect(envioMock).not.toHaveBeenCalled();
  });

  it('nova escuta cuja gravação falha: o áudio da escuta anterior não vai junto', async () => {
    gravacaoMock.mockResolvedValueOnce({ parar: vi.fn(async () => ({ blob, segundos: 5 })), cancelar: vi.fn() });
    gravacaoMock.mockRejectedValueOnce({ codigo: 'permissao_negada' });
    const voz = escutaFalsa(IDEIA);
    render(<Chat />);
    await falarEParar(voz);

    fireEvent.click(microfone()); // nova escuta, que não consegue gravar
    voz.dizer(IDEIA);
    fireEvent.click(botaoEnviar());

    await screen.findByText('Guardado em Ideias');
    expect((await listar('ideias'))[0]).not.toHaveProperty('audioId');
    expect(envioMock).not.toHaveBeenCalled();
  });
});

describe('passou de 3 minutos', () => {
  it('Enviar logo depois espera o áudio terminar de fechar: ele vai junto da ideia', async () => {
    const fecha = adiada<{ blob: Blob; segundos: number }>();
    gravacaoMock.mockResolvedValue({ parar: vi.fn(() => fecha.promessa), cancelar: vi.fn() });
    envioMock.mockResolvedValue({ driveId: 'drive-1' });
    const voz = escutaFalsa(IDEIA);
    render(<Chat />);
    fireEvent.click(chave());
    fireEvent.click(microfone());
    voz.dizer('ideia: usar o artigo');

    await voz.limite();
    fireEvent.click(botaoEnviar()); // o áudio ainda está fechando
    await new Promise((pronto) => setTimeout(pronto, 30));
    expect(await listar('ideias')).toEqual([]); // nada saiu ainda

    fecha.resolver({ blob, segundos: 180 });

    await screen.findByText('Guardado em Ideias');
    const [ideia] = await listar('ideias');
    expect(ideia).toMatchObject({ texto: TEXTO_DA_IDEIA, audioSegundos: 180 });
    await waitFor(() => expect(envioMock).toHaveBeenCalledWith(ideia!.audioId, blob));
  });
});

describe('parar com o texto sendo digitado', () => {
  it('o texto final da escuta não passa por cima do que se digitou enquanto ela fechava', async () => {
    const parada = adiada<string>();
    const voz = escutaFalsa();
    voz.pararComo(() => parada.promessa);
    render(<Chat />);
    fireEvent.click(microfone());
    voz.dizer('ideia: o que foi dito');

    fireEvent.click(microfone()); // parar: a escuta ainda fecha
    escrever('ideia: o que eu digitei');
    parada.resolver('ideia: o que foi dito, com o final');

    await act(async () => {
      await new Promise((pronto) => setTimeout(pronto, 30));
    });
    expect(campo().value).toBe('ideia: o que eu digitei');
  });
});

describe('Ctrl+Alt+N só liga', () => {
  it('o pedido de ouvir com a escuta ligada só mantém: não para nem recomeça', async () => {
    const voz = escutaFalsa();
    render(<Chat />);
    fireEvent.click(microfone());

    act(() => pedirVoz());
    await new Promise((pronto) => setTimeout(pronto, 30));

    expect(voz.escuta.parar).not.toHaveBeenCalled();
    expect(escutaMock).toHaveBeenCalledTimes(1);
    expect(microfone().getAttribute('aria-pressed')).toBe('true');
  });
});

describe('o áudio que espera o "Guardar como ideia"', () => {
  it('desfeitos todos os cartões da mensagem, o áudio não fica guardado na memória', async () => {
    const voz = escutaFalsa('Preciso parafusar o apoio do banheiro');
    gravacaoQueFecha();
    render(<Chat />);
    fireEvent.click(chave());
    fireEvent.click(microfone());
    voz.dizer('Preciso parafusar o apoio do banheiro');
    fireEvent.click(botaoEnviar());
    await screen.findByRole('article');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Desfazer' })).toBeTruthy());
    expect(audiosEsperandoAgora()).toBe(1);

    const mensagem = lerConversa().find((m) => m.de === 'central')!;
    if (mensagem.de !== 'central') throw new Error('sem resposta');
    await act(async () => {
      await desfazerCartao(mensagem.cartoes[0]!.id);
    });

    expect(audiosEsperandoAgora()).toBe(0);
  });

  it('no máximo 20 áudios esperam', async () => {
    const voz = escutaFalsa('Preciso parafusar o apoio do banheiro');
    gravacaoQueFecha();
    render(<Chat />);
    fireEvent.click(chave());
    for (let i = 0; i < 22; i++) {
      fireEvent.click(microfone());
      voz.dizer(`Preciso parafusar o apoio ${i} do banheiro`);
      fireEvent.click(botaoEnviar());
      await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(i + 1));
      await waitFor(() => expect(microfone().getAttribute('aria-pressed')).toBe('false'));
    }
    expect(audiosEsperandoAgora()).toBe(20);
  });
});

describe('"Guardar como ideia" no primeiro item guardado da frase', () => {
  const LONGA =
    'então é, eu tava pensando aqui, preciso revisar o capítulo da Marina até segunda, e aí também tem que ligar pro dentista amanhã, ah e comprar parafuso pro banheiro no sábado';
  const iaDeDois: IA = {
    estado: () => 'pronta',
    interpretar: async () => ({
      itens: [
        { tipo: 'tarefa', titulo: 'Revisar o capítulo da Marina', sala: 'Orientações', quando: 'hoje', inicio: '', fim: '' },
        { tipo: 'tarefa', titulo: 'Ligar pro dentista', sala: 'Pessoal', quando: 'hoje', inicio: '', fim: '' },
      ],
      cortada: false,
    }),
  };

  it('os dois guardados: o botão só no primeiro', async () => {
    usarIA(iaDeDois);
    render(<Chat />);
    escrever(LONGA);
    fireEvent.click(botaoEnviar());
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Desfazer' })).toHaveLength(2));

    const [primeiro, segundo] = screen.getAllByRole('article');
    expect(within(primeiro!).queryByRole('button', { name: 'Guardar como ideia' })).toBeTruthy();
    expect(within(segundo!).queryByRole('button', { name: 'Guardar como ideia' })).toBeNull();
  });

  it('o primeiro não guardou (erro): o botão passa para o primeiro que guardou', async () => {
    usarIA(iaDeDois);
    const real = loja.salvar;
    vi.spyOn(loja, 'salvar').mockImplementation(((colecao: never, registro: never) => {
      if ((colecao as string) === 'tarefas' && String((registro as { titulo?: string }).titulo).includes('Marina')) return Promise.reject(new Error('disco cheio'));
      return real(colecao, registro);
    }) as typeof loja.salvar);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<Chat />);
    escrever(LONGA);
    fireEvent.click(botaoEnviar());
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Desfazer' })).toHaveLength(1));

    const [primeiro, segundo] = screen.getAllByRole('article');
    expect(within(primeiro!).queryByRole('button', { name: 'Guardar como ideia' })).toBeNull();
    expect(within(segundo!).queryByRole('button', { name: 'Guardar como ideia' })).toBeTruthy();
  });
});

describe('o cartão da tarefa trocada por ideia', () => {
  it('leva um link "Ver em Ideias" para #/ideias', async () => {
    render(<Chat />);
    escrever('Preciso parafusar o apoio do banheiro');
    fireEvent.click(botaoEnviar());
    const cartao = within(await screen.findByRole('article'));
    fireEvent.click(await cartao.findByRole('button', { name: 'Guardar como ideia' }));

    const link = await screen.findByRole('link', { name: 'Ver em Ideias' });
    expect(link.getAttribute('href')).toBe('#/ideias');
    expect(screen.getByText('Trocado por uma ideia.')).toBeTruthy();
  });
});

describe('o cartão de resultado', () => {
  it('a região do áudio fica no cartão também depois de desfeito', async () => {
    render(<Chat />);
    escrever('ideia: app de receitas');
    fireEvent.click(botaoEnviar());
    const cartao = await screen.findByRole('article');
    expect(cartao.querySelector('[role="status"]')).toBeTruthy();

    fireEvent.click(within(cartao).getByRole('button', { name: 'Desfazer' }));

    await within(cartao).findByText('Desfeito. Nada ficou guardado.');
    expect(cartao.querySelector('[role="status"]')).toBeTruthy();
  });
});

describe('a pasta de onde o dono veio, no chat do celular', () => {
  async function abrirNaPastaDeCompras() {
    comoCelular();
    await salvar('pastas', { id: 'pasta-compras', salaId: 'sala-casa', tipo: 'lista', nome: 'Compras', ordem: 1, modelo: 'compras', planilhaId: COMPRAS });
    planilhas.planilha(COMPRAS, [], CABECALHO_COMPRAS);
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true, writable: true });
    history.replaceState(null, '', '/#/sala/sala-casa/pasta/pasta-compras');
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: /Compras/ });
  }
  const irPara = (hash: string) =>
    act(() => {
      location.hash = hash;
    });

  it('na pasta Lista, ir ao chat e dizer "Comprar pão" põe o item na lista', async () => {
    await abrirNaPastaDeCompras();

    irPara('#/chat');
    await screen.findByRole('heading', { level: 1, name: 'Chat' });
    escrever('leite e pão');
    fireEvent.click(botaoEnviar());

    expect(await screen.findByText(/2 itens guardados/)).toBeTruthy();
    expect(await listar('tarefas')).toEqual([]);
    expect(planilhas.linhas(COMPRAS).map((l) => l.valores['Item'])).toEqual(['leite', 'pão']);
  });

  it('vindo de uma tela sem pasta, a frase não vai para a lista', async () => {
    await abrirNaPastaDeCompras();
    irPara('#/');
    await screen.findByRole('heading', { level: 1, name: 'Painel do dia' });
    irPara('#/chat');
    await screen.findByRole('heading', { level: 1, name: 'Chat' });

    escrever('leite e pão');
    fireEvent.click(botaoEnviar());

    await waitFor(async () => expect(await listar('tarefas')).toHaveLength(1));
    expect(planilhas.linhas(COMPRAS)).toEqual([]);
  });
});
