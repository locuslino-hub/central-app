// Tela Ideias (V02, Tarefa 7). Quinta-feira, 2026-11-05, 12:20 em Lisboa. Nomes fictícios.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { atribuirSala, criarIdeia, virarTarefa } from '../../src/dados/ideias';
import { apagar, listar, salvar, semear, semearPalavras } from '../../src/dados/loja';
import { ErroScript } from '../../src/conexao/cliente';
import * as audios from '../../src/voz/audios-pendentes';
import { guardarAudio, marcarProblemaDeAudio } from '../../src/voz/audios-pendentes';
import { AudioIndisponivel, buscarAudio } from '../../src/voz/ler-audio';
import { apagarAudioDoDrive } from '../../src/voz/apagar-audio';
import { Ideias } from '../../src/ui/Ideias';

vi.mock('../../src/voz/ler-audio', async (importar) => ({
  ...(await importar<typeof import('../../src/voz/ler-audio')>()),
  buscarAudio: vi.fn(),
}));
const buscarMock = vi.mocked(buscarAudio);
vi.mock('../../src/voz/apagar-audio', () => ({ apagarAudioDoDrive: vi.fn(async () => true) }));
const apagarNoDriveMock = vi.mocked(apagarAudioDoDrive);

/** O <audio> do navegador não toca no jsdom: um dublê que só registra. */
const tocadas: { url: string; play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn> }[] = [];
class AudioFalso {
  currentTime = 0;
  play = vi.fn(async () => {});
  pause = vi.fn();
  addEventListener = vi.fn();
  constructor(public url: string) {
    tocadas.push(this);
  }
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-11-05T12:20:00Z'));
  history.replaceState(null, '', '/#/ideias');
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true, writable: true });
  vi.clearAllMocks();
  tocadas.length = 0;
  vi.stubGlobal('Audio', AudioFalso);
  URL.createObjectURL = vi.fn(() => 'blob:ficticio');
  URL.revokeObjectURL = vi.fn();
  await semear();
  await semearPalavras();
});

const ideiasVivas = async () => (await listar('ideias')).filter((i) => !i.apagado);
const novas = () => screen.getAllByRole('listitem').filter((li) => !li.closest('details'));

describe('tela Ideias', () => {
  it('lista as ideias novas com a sala sugerida em destaque', async () => {
    await salvar('pessoas', { nome: 'Marina', salaId: 'sala-orientacoes' });
    await criarIdeia('Enviar o roteiro para a Marina');
    await criarIdeia('Usar o artigo do Prof. Souza no capítulo 2');
    render(<Ideias />);

    expect(await screen.findByText('Enviar o roteiro para a Marina')).toBeTruthy();
    expect(screen.getByText('Usar o artigo do Prof. Souza no capítulo 2')).toBeTruthy();
    const sugerida = await screen.findByRole('button', { name: /^Levar para Orientações:/ });
    expect(sugerida.textContent).toContain('Orientações');
    expect(sugerida.closest('li')!.textContent).toContain('Enviar o roteiro para a Marina');
    // A ideia sem pista não inventa sala: oferece escolher.
    expect(screen.getByText('Sem sugestão de sala')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Escolher sala:/ })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Outra sala:/ })).toHaveLength(1);
  });

  it('um toque na sala sugerida a confirma: a ideia sai das novas', async () => {
    await salvar('pessoas', { nome: 'Marina', salaId: 'sala-orientacoes' });
    const { ideia } = await criarIdeia('Enviar o roteiro para a Marina');
    render(<Ideias />);

    fireEvent.click(await screen.findByRole('button', { name: /^Levar para Orientações:/ }));

    await waitFor(() => expect(screen.getByText('Nada por arrumar. Boa!')).toBeTruthy());
    expect((await ideiasVivas())[0]).toMatchObject({ id: ideia.id, estado: 'atribuida', salaId: 'sala-orientacoes' });
    expect(screen.getByText('Levada para Orientações')).toBeTruthy();
  });

  it('Outra sala troca a sala e a ideia some da lista de novas', async () => {
    await salvar('pessoas', { nome: 'Marina', salaId: 'sala-orientacoes' });
    const { ideia } = await criarIdeia('Enviar o roteiro para a Marina');
    render(<Ideias />);

    fireEvent.click(await screen.findByRole('button', { name: /^Outra sala:/ }));
    const escolha = screen.getByRole('group', { name: /Sala para/ });
    fireEvent.click(within(escolha).getByRole('button', { name: 'Casa' }));

    await waitFor(() => expect(screen.getByText('Nada por arrumar. Boa!')).toBeTruthy());
    expect((await ideiasVivas())[0]).toMatchObject({ id: ideia.id, estado: 'atribuida', salaId: 'sala-casa' });
    // Ela continua à mão em "Já arrumadas", com a sala nova.
    expect(screen.getByText('Já arrumadas (1)')).toBeTruthy();
    expect(screen.getByText('Na sala Casa.')).toBeTruthy();
  });

  it('Virar tarefa cria a tarefa e marca a ideia; Desfazer reverte', async () => {
    const { ideia } = await criarIdeia('Rever o capítulo 2');
    render(<Ideias />);

    fireEvent.click(await screen.findByRole('button', { name: /^Virar tarefa:/ }));

    const cartao = within(await screen.findByRole('article'));
    expect(cartao.getByText('Virou tarefa de hoje')).toBeTruthy();
    expect(cartao.getByText(/Rever o capítulo 2/)).toBeTruthy();
    expect(cartao.getByRole('link', { name: 'Ver' }).getAttribute('href')).toBe('#/atividades');
    const [tarefa] = await listar('tarefas');
    expect(tarefa).toMatchObject({ titulo: 'Rever o capítulo 2', data: '2026-11-05' });
    expect((await ideiasVivas())[0]).toMatchObject({ id: ideia.id, estado: 'tarefa', tarefaId: tarefa!.id });
    expect(screen.getByText('Nada por arrumar. Boa!')).toBeTruthy();

    fireEvent.click(cartao.getByRole('button', { name: 'Desfazer' }));

    await waitFor(async () => expect((await ideiasVivas())[0]).toMatchObject({ id: ideia.id, estado: 'nova' }));
    expect(await listar('tarefas')).toEqual([]);
    expect(await screen.findByText('Rever o capítulo 2', { selector: '.ideia-texto' })).toBeTruthy();
    expect(screen.getByText('Desfeito')).toBeTruthy();
  });

  it('Apagar tira a ideia', async () => {
    await criarIdeia('Rever o capítulo 2');
    render(<Ideias />);
    fireEvent.click(await screen.findByRole('button', { name: /^Apagar a ideia:/ }));
    await waitFor(() => expect(screen.getByText('Nada por arrumar. Boa!')).toBeTruthy());
    expect(await ideiasVivas()).toEqual([]);
  });

  it('lista vazia mostra a mensagem', async () => {
    render(<Ideias />);
    expect(await screen.findByText('Nada por arrumar. Boa!')).toBeTruthy();
    expect(screen.queryByText(/Já arrumadas/)).toBeNull();
  });

  it('ideia cuja tarefa foi apagada pode virar tarefa de novo, pela tela', async () => {
    const { ideia } = await criarIdeia('Rever o capítulo 2');
    const antiga = await virarTarefa(ideia.id);
    await apagar('tarefas', antiga.id);
    render(<Ideias />);

    expect(await screen.findByText('Virou tarefa, mas a tarefa foi apagada.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Virar tarefa de novo:/ }));

    await waitFor(async () => expect(await listar('tarefas')).toHaveLength(1));
    const [nova] = await listar('tarefas');
    expect(nova!.id).not.toBe(antiga.id);
    expect((await ideiasVivas())[0]).toMatchObject({ estado: 'tarefa', tarefaId: nova!.id });
    await waitFor(() => expect(screen.getByText('Virou tarefa.')).toBeTruthy());
  });

  it('em Já arrumadas, uma ideia atribuída pode voltar às novas', async () => {
    const { ideia } = await criarIdeia('Rever o capítulo 2');
    await atribuirSala(ideia.id, 'sala-casa');
    render(<Ideias />);

    fireEvent.click(await screen.findByRole('button', { name: /^Voltar às novas:/ }));

    await waitFor(() => expect(novas()).toHaveLength(1));
    expect((await ideiasVivas())[0]).toMatchObject({ estado: 'nova', salaId: null });
  });

  it('falha ao gravar mostra o aviso e nada some', async () => {
    await criarIdeia('Rever o capítulo 2');
    render(<Ideias />);
    const loja = await import('../../src/dados/loja');
    const real = loja.salvar;
    vi.spyOn(loja, 'salvar').mockImplementation(((colecao: never, registro: never, opcoes?: never) => {
      if ((colecao as string) === 'tarefas') return Promise.reject(new Error('disco cheio'));
      return real(colecao, registro, opcoes);
    }) as typeof loja.salvar);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    fireEvent.click(await screen.findByRole('button', { name: /^Virar tarefa:/ }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/Não consegui criar a tarefa/);
    expect(await listar('tarefas')).toEqual([]);
    expect(screen.getByText('Rever o capítulo 2')).toBeTruthy();
  });
});

describe('áudio na ideia', () => {
  it('ideia com áudio mostra ▶ e a duração', async () => {
    await criarIdeia('Perguntar à Marina da amostra', { audioId: 'a-1', audioSegundos: 72 });
    render(<Ideias />);

    const tocar = await screen.findByRole('button', { name: /^Tocar áudio, 1:12/ });
    expect(tocar.textContent).toContain('▶');
    expect(tocar.textContent).toContain('1:12');
    expect(screen.getByText(/com áudio/)).toBeTruthy();
  });

  it('ideia sem áudio não mostra ▶', async () => {
    await criarIdeia('Rever o capítulo 2');
    render(<Ideias />);
    await screen.findByText('Rever o capítulo 2');
    expect(screen.queryByRole('button', { name: /Tocar áudio/ })).toBeNull();
  });

  it('▶ baixa o áudio só quando se toca, e toca', async () => {
    buscarMock.mockResolvedValue(new Blob(['x'], { type: 'audio/webm' }));
    await criarIdeia('Perguntar à Marina da amostra', { audioId: 'a-1', audioSegundos: 12 });
    render(<Ideias />);
    const tocar = await screen.findByRole('button', { name: /^Tocar áudio, 0:12/ });
    expect(buscarMock).not.toHaveBeenCalled();

    fireEvent.click(tocar);

    await waitFor(() => expect(tocadas).toHaveLength(1));
    expect(buscarMock).toHaveBeenCalledWith('a-1');
    expect(tocadas[0]!.play).toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: /^Parar o áudio, 0:12/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^Parar o áudio, 0:12/ }));
    expect(tocadas[0]!.pause).toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: /^Tocar áudio, 0:12/ })).toBeTruthy();
  });

  it('áudio que o Drive não tem ou sem internet mostra o aviso e deixa tentar de novo', async () => {
    buscarMock.mockRejectedValueOnce(new AudioIndisponivel());
    await criarIdeia('Perguntar à Marina da amostra', { audioId: 'a-1', audioSegundos: 12 });
    render(<Ideias />);

    fireEvent.click(await screen.findByRole('button', { name: /^Tocar áudio, 0:12/ }));
    expect(await screen.findByText(/Não achei este áudio no Drive\. Se foi gravado em outro aparelho, talvez ainda não tenha sido enviado\./)).toBeTruthy();

    buscarMock.mockRejectedValueOnce(new Error('sem rede'));
    fireEvent.click(screen.getByRole('button', { name: /^Tocar áudio, 0:12/ }));
    expect(await screen.findByText(/Confira a internet/)).toBeTruthy();
  });

  it('áudio que não foi enviado aparece como aviso na ideia, no lugar do ▶', async () => {
    await criarIdeia('Perguntar à Marina da amostra', { audioId: 'a-1', audioSegundos: 12 });
    await marcarProblemaDeAudio('a-1', 'recusado');
    render(<Ideias />);

    expect(await screen.findByText(/Áudio não enviado/)).toBeTruthy();
    expect(screen.getByText(/O Drive recusou o arquivo/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Tocar áudio/ })).toBeNull();
  });

  it('o texto da ideia não se perde com o áudio com problema', async () => {
    await criarIdeia('Perguntar à Marina da amostra', { audioId: 'a-1' });
    await marcarProblemaDeAudio('a-1', 'sem_espaco');
    render(<Ideias />);
    expect(await screen.findByText('Perguntar à Marina da amostra')).toBeTruthy();
    expect(await screen.findByText(/Não havia espaço neste aparelho/)).toBeTruthy();
  });
});

describe('Ideias no menu e na rota', () => {
  it('o menu do computador mostra o contador de ideias novas', async () => {
    await criarIdeia('Rever o capítulo 2');
    await criarIdeia('Pensar no artigo da Aurora');
    const arrumada = await criarIdeia('Já arrumada');
    await atribuirSala(arrumada.ideia.id, 'sala-casa');
    render(<App />);

    const menu = screen.getByRole('navigation', { name: 'Principal' });
    const link = await within(menu).findByRole('link', { name: /Ideias/ });
    expect(link.getAttribute('href')).toBe('#/ideias');
    await waitFor(() => expect(within(link).getByText('2')).toBeTruthy());
    expect(link.textContent).toContain('2 ideias novas');
  });

  it('sem ideias novas o menu não mostra número', async () => {
    render(<App />);
    const link = await within(screen.getByRole('navigation', { name: 'Principal' })).findByRole('link', { name: 'Ideias' });
    expect(link.querySelector('.contagem')).toBeNull();
  });

  it('o contador acompanha: ideia nova entra, ideia arrumada sai', async () => {
    render(<App />);
    const menu = screen.getByRole('navigation', { name: 'Principal' });
    await within(menu).findByRole('link', { name: 'Ideias' });

    const { ideia } = await criarIdeia('Rever o capítulo 2');
    await waitFor(() => expect(within(menu).getByRole('link', { name: /Ideias/ }).querySelector('.contagem')!.textContent).toBe('1'));

    await atribuirSala(ideia.id, 'sala-casa');
    await waitFor(() => expect(within(menu).getByRole('link', { name: 'Ideias' }).querySelector('.contagem')).toBeNull());
  });

  it('#/ideias abre a tela com o título Ideias', async () => {
    await criarIdeia('Rever o capítulo 2');
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Ideias' })).toBeTruthy();
    expect(await screen.findByText('Rever o capítulo 2')).toBeTruthy();
  });

  it('no celular, Mais leva a Ideias e mostra o contador', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true, writable: true });
    history.replaceState(null, '', '/#/');
    await criarIdeia('Rever o capítulo 2');
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /^Mais/ }));
    const folha = await screen.findByRole('dialog', { name: 'Mais' });
    const link = within(folha).getByRole('link', { name: /Ideias/ });
    expect(link.getAttribute('href')).toBe('#/ideias');
    await waitFor(() => expect(link.querySelector('.contagem')!.textContent).toBe('1'));
  });
});

describe('Ideias: correções das revisões', () => {
  const quando = () => screen.getByRole('article');

  it('Desfazer de Virar tarefa não diz "voltou para a caixa": diz o estado de verdade (ideia atribuída volta a Já arrumadas)', async () => {
    const { ideia } = await criarIdeia('Rever o capítulo 2');
    await atribuirSala(ideia.id, 'sala-casa');
    render(<Ideias />);

    fireEvent.click(await screen.findByRole('button', { name: /^Virar tarefa:/ }));
    fireEvent.click(within(await screen.findByRole('article')).getByRole('button', { name: 'Desfazer' }));

    expect(await screen.findByText('A tarefa saiu e a ideia voltou ao que era.')).toBeTruthy();
    expect(screen.queryByText(/voltou para a caixa/)).toBeNull();
    await waitFor(async () => expect((await ideiasVivas())[0]).toMatchObject({ estado: 'atribuida', salaId: 'sala-casa' }));
    expect(screen.getByText('Já arrumadas (1)')).toBeTruthy();
  });

  it('o foco vai para o cartão depois de Levar para sala, Virar tarefa, Apagar e Desfazer', async () => {
    await salvar('pessoas', { nome: 'Marina', salaId: 'sala-orientacoes' });
    await criarIdeia('Enviar o roteiro para a Marina');
    await criarIdeia('Pensar no artigo da Aurora');
    await criarIdeia('Rever o capítulo 2');
    render(<Ideias />);

    fireEvent.click(await screen.findByRole('button', { name: /^Levar para Orientações:/ }));
    await waitFor(() => expect(document.activeElement).toBe(quando()));
    expect(quando().textContent).toContain('Levada para Orientações');

    fireEvent.click(screen.getAllByRole('button', { name: /^Virar tarefa:/ })[0]!);
    await waitFor(() => expect(quando().textContent).toContain('Virou tarefa de hoje'));
    await waitFor(() => expect(document.activeElement).toBe(quando()));

    fireEvent.click(screen.getAllByRole('button', { name: /^Apagar a ideia:/ })[0]!);
    await waitFor(() => expect(quando().textContent).toContain('Ideia apagada'));
    await waitFor(() => expect(document.activeElement).toBe(quando()));

    fireEvent.click(within(quando()).getByRole('button', { name: 'Desfazer' }));
    await waitFor(() => expect(quando().textContent).toContain('Desfeito'));
    await waitFor(() => expect(document.activeElement).toBe(quando()));
  });

  it('Apagar tem Desfazer: a ideia volta com o mesmo texto, sala e áudio', async () => {
    const { ideia } = await criarIdeia('Perguntar à Marina da amostra', { audioId: 'a-1', audioSegundos: 12 });
    render(<Ideias />);
    fireEvent.click(await screen.findByRole('button', { name: /^Apagar a ideia:/ }));
    const cartao = within(await screen.findByRole('article'));
    expect(cartao.getByText('Ideia apagada')).toBeTruthy();
    await waitFor(async () => expect(await ideiasVivas()).toEqual([]));

    fireEvent.click(cartao.getByRole('button', { name: 'Desfazer' }));

    expect(await screen.findByText(/A ideia voltou\./)).toBeTruthy();
    await waitFor(async () => expect((await ideiasVivas())[0]).toMatchObject({ id: ideia.id, texto: 'Perguntar à Marina da amostra', audioId: 'a-1', audioSegundos: 12, estado: 'nova' }));
    expect(await screen.findByRole('button', { name: /^Tocar áudio, 0:12/ })).toBeTruthy();
  });

  it('Apagar ideia com áudio já enviado pede ao Drive para apagar o áudio; falhando, o cartão avisa', async () => {
    await criarIdeia('Perguntar à Marina da amostra', { audioId: 'a-1', audioSegundos: 12 });
    apagarNoDriveMock.mockResolvedValueOnce(false);
    render(<Ideias />);
    fireEvent.click(await screen.findByRole('button', { name: /^Apagar a ideia:/ }));
    expect(await screen.findByText(/O áudio continua no Drive\./)).toBeTruthy();
    expect(apagarNoDriveMock).toHaveBeenCalledWith('a-1');
  });

  it('Apagar ideia com áudio já enviado e o Drive confirmando: sem aviso', async () => {
    await criarIdeia('Perguntar à Marina da amostra', { audioId: 'a-1', audioSegundos: 12 });
    render(<Ideias />);
    fireEvent.click(await screen.findByRole('button', { name: /^Apagar a ideia:/ }));
    await waitFor(() => expect(apagarNoDriveMock).toHaveBeenCalledWith('a-1'));
    expect(screen.queryByText(/continua no Drive/)).toBeNull();
  });

  it('Apagar ideia cujo áudio ainda espera rede neste aparelho: não avisa se o pedido ao Drive falhar', async () => {
    await criarIdeia('Perguntar à Marina da amostra', { audioId: 'a-1', audioSegundos: 12 });
    await guardarAudio({ id: 'a-1', bytes: new Uint8Array([1]).buffer, mime: 'audio/webm', guardadoEm: 1 });
    apagarNoDriveMock.mockResolvedValueOnce(false);
    render(<Ideias />);
    fireEvent.click(await screen.findByRole('button', { name: /^Apagar a ideia:/ }));
    await waitFor(() => expect(apagarNoDriveMock).toHaveBeenCalled());
    expect(screen.queryByText(/continua no Drive/)).toBeNull();
    expect(await audios.listarAudios()).toEqual([]); // saiu da fila
  });

  it('Desfazer de Apagar devolve também o aviso de áudio não enviado', async () => {
    await criarIdeia('Perguntar à Marina da amostra', { audioId: 'a-1', audioSegundos: 12 });
    await marcarProblemaDeAudio('a-1', 'recusado');
    render(<Ideias />);
    await screen.findByText(/Áudio não enviado/);

    fireEvent.click(screen.getByRole('button', { name: /^Apagar a ideia:/ }));
    await waitFor(async () => expect((await audios.problemasDosAudios()).size).toBe(0)); // some com a ideia
    fireEvent.click(within(await screen.findByRole('article')).getByRole('button', { name: 'Desfazer' }));

    expect(await screen.findByText(/Áudio não enviado/)).toBeTruthy();
    expect((await audios.problemasDosAudios()).get('a-1')).toBe('recusado');
  });

  it('Levar para sala tem Desfazer: a ideia volta para as novas', async () => {
    await salvar('pessoas', { nome: 'Marina', salaId: 'sala-orientacoes' });
    const { ideia } = await criarIdeia('Enviar o roteiro para a Marina');
    render(<Ideias />);
    fireEvent.click(await screen.findByRole('button', { name: /^Levar para Orientações:/ }));

    fireEvent.click(within(await screen.findByRole('article')).getByRole('button', { name: 'Desfazer' }));

    expect(await screen.findByText('A ideia voltou para as novas.')).toBeTruthy();
    await waitFor(async () => expect((await ideiasVivas())[0]).toMatchObject({ id: ideia.id, estado: 'nova' }));
    expect(await screen.findByText('Enviar o roteiro para a Marina', { selector: '.ideia-texto' })).toBeTruthy();
  });

  it('mais de 30 arrumadas: avisa "Mostrando 30 de N"', async () => {
    for (let i = 0; i < 31; i++) {
      const { ideia } = await criarIdeia(`Ideia número ${i + 1}`);
      await atribuirSala(ideia.id, 'sala-casa');
    }
    render(<Ideias />);
    expect(await screen.findByText('Já arrumadas (31)')).toBeTruthy();
    expect(screen.getByText('Mostrando 30 de 31: as mais recentes.')).toBeTruthy();
    expect(document.querySelectorAll('.ideia-arrumada')).toHaveLength(30);
  });

  it('30 ou menos arrumadas não mostram o aviso', async () => {
    const { ideia } = await criarIdeia('Ideia única');
    await atribuirSala(ideia.id, 'sala-casa');
    render(<Ideias />);
    await screen.findByText('Já arrumadas (1)');
    expect(screen.queryByText(/Mostrando/)).toBeNull();
  });

  it('ideia que virou tarefa não é dita "tarefa apagada" antes de as tarefas carregarem', async () => {
    const { ideia } = await criarIdeia('Rever o capítulo 2');
    await virarTarefa(ideia.id);
    render(<Ideias />);
    await screen.findByText('Já arrumadas (1)');
    // Nunca, nem no primeiro desenho, a mensagem falsa.
    expect(screen.queryByText(/tarefa foi apagada/)).toBeNull();
    await waitFor(() => expect(screen.getByText('Virou tarefa.')).toBeTruthy());
  });

  it('erro interno do script ao buscar o áudio mostra a mensagem de tentar de novo', async () => {
    buscarMock.mockRejectedValueOnce(new ErroScript('interno'));
    await criarIdeia('Perguntar à Marina da amostra', { audioId: 'a-1', audioSegundos: 12 });
    render(<Ideias />);
    fireEvent.click(await screen.findByRole('button', { name: /^Tocar áudio, 0:12/ }));
    expect(await screen.findByText('Não consegui buscar o áudio agora. Tente de novo.')).toBeTruthy();
  });

  it('motivo "falhou": mostra o aviso E o ▶ (o áudio segue guardado neste aparelho)', async () => {
    await criarIdeia('Perguntar à Marina da amostra', { audioId: 'a-1', audioSegundos: 12 });
    await guardarAudio({ id: 'a-1', bytes: new Uint8Array([1]).buffer, mime: 'audio/webm', guardadoEm: 1, falhou: true });
    render(<Ideias />);

    expect(await screen.findByText(/Áudio não enviado/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Tocar áudio, 0:12/ })).toBeTruthy();
  });

  it('o ▶ não aparece enquanto os avisos de áudio carregam (nada de ▶ que some)', async () => {
    let liberar: (m: Map<string, 'recusado'>) => void = () => {};
    vi.spyOn(audios, 'problemasDosAudios').mockImplementation(() => new Promise((r) => (liberar = r as never)));
    await criarIdeia('Perguntar à Marina da amostra', { audioId: 'a-1', audioSegundos: 12 });
    render(<Ideias />);
    await screen.findByText('Perguntar à Marina da amostra');
    expect(screen.queryByRole('button', { name: /Tocar áudio/ })).toBeNull();

    liberar(new Map([['a-1', 'recusado']]));

    expect(await screen.findByText(/Áudio não enviado/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Tocar áudio/ })).toBeNull();
  });

  it('um problema anotado com a tela aberta troca o ▶ pelo aviso, sem recarregar', async () => {
    await criarIdeia('Perguntar à Marina da amostra', { audioId: 'a-1', audioSegundos: 12 });
    render(<Ideias />);
    await screen.findByRole('button', { name: /^Tocar áudio, 0:12/ });

    await marcarProblemaDeAudio('a-1', 'recusado');

    expect(await screen.findByText(/Áudio não enviado/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Tocar áudio/ })).toBeNull();
  });

  it('só um áudio toca por vez: tocar o segundo para o primeiro', async () => {
    buscarMock.mockResolvedValue(new Blob(['x'], { type: 'audio/webm' }));
    await criarIdeia('Primeira ideia falada', { audioId: 'a-1', audioSegundos: 10 });
    await criarIdeia('Segunda ideia falada', { audioId: 'a-2', audioSegundos: 20 });
    render(<Ideias />);
    const botoes = await screen.findAllByRole('button', { name: /Tocar áudio/ });
    expect(botoes).toHaveLength(2);

    fireEvent.click(botoes[0]!);
    await waitFor(() => expect(tocadas).toHaveLength(1));
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Parar o áudio/ })).toHaveLength(1));

    fireEvent.click(screen.getAllByRole('button', { name: /Tocar áudio/ })[0]!);
    await waitFor(() => expect(tocadas).toHaveLength(2));

    expect(tocadas[0]!.pause).toHaveBeenCalled();
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Parar o áudio/ })).toHaveLength(1));
    expect(tocadas[1]!.pause).not.toHaveBeenCalled();
  });

  it('ao sair da tela o áudio é parado e a URL do blob é liberada (revokeObjectURL)', async () => {
    buscarMock.mockResolvedValue(new Blob(['x'], { type: 'audio/webm' }));
    await criarIdeia('Perguntar à Marina da amostra', { audioId: 'a-1', audioSegundos: 12 });
    const { unmount } = render(<Ideias />);
    fireEvent.click(await screen.findByRole('button', { name: /^Tocar áudio, 0:12/ }));
    await waitFor(() => expect(tocadas).toHaveLength(1));
    vi.mocked(URL.revokeObjectURL).mockClear(); // a limpeza assíncrona de um teste anterior pode chegar aqui

    unmount();

    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:ficticio'));
    expect(tocadas[0]!.pause).toHaveBeenCalled();
  });

  it('no celular, o botão Mais fechado mostra o número de ideias novas', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true, writable: true });
    history.replaceState(null, '', '/#/');
    await criarIdeia('Rever o capítulo 2');
    await criarIdeia('Pensar no artigo da Aurora');
    render(<App />);

    const botao = await screen.findByRole('button', { name: /^Mais/ });
    await waitFor(() => expect(botao.querySelector('.contagem-mais')!.textContent).toBe('2'));
    expect(botao.textContent).toContain('2 ideias novas');
  });

  it('no celular, sem ideias novas o botão Mais não mostra número', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true, writable: true });
    history.replaceState(null, '', '/#/');
    render(<App />);
    const botao = await screen.findByRole('button', { name: 'Mais' });
    expect(botao.querySelector('.contagem-mais')).toBeNull();
  });
});

// ---- Acessibilidade (Tarefa 19, correções): nomes com contexto, foco e região viva ----

describe('acessibilidade da tela Ideias', () => {
  it('os botões repetidos dizem de qual ideia são (o texto visível vem primeiro no nome)', async () => {
    await criarIdeia('Rever o capítulo 2');
    await criarIdeia('Falar com o Prof. Souza sobre o prazo de entrega do relatório final');
    render(<Ideias />);
    await screen.findByText('Rever o capítulo 2');

    for (const [visivel, quantos] of [['Escolher sala', 2], ['Virar tarefa', 2], ['Apagar', 2]] as const) {
      const botoes = screen.getAllByRole('button', { name: new RegExp(`^${visivel}`) });
      expect(botoes).toHaveLength(quantos);
      for (const b of botoes) expect(b.getAttribute('aria-label')!.startsWith(b.textContent!.trim())).toBe(true);
    }
    expect(screen.getByRole('button', { name: 'Apagar a ideia: Rever o capítulo 2' })).toBeTruthy();
    // O trecho é curto: ideia longa vem cortada.
    expect(screen.getByRole('button', { name: 'Virar tarefa: Falar com o Prof. Souza sobre o prazo de…' })).toBeTruthy();
  });

  it('o botão de áudio diz de qual ideia é, depois da duração', async () => {
    await criarIdeia('Rever o capítulo 2', { audioId: 'a-1', audioSegundos: 12 });
    render(<Ideias />);

    const tocar = await screen.findByRole('button', { name: /^Tocar áudio, 0:12/ });
    expect(tocar.getAttribute('aria-label')).toBe('Tocar áudio, 0:12, da ideia: Rever o capítulo 2');
  });

  it('o cartão não fica numa região viva, recebe o foco e Fechar leva o foco ao título da seção', async () => {
    await criarIdeia('Rever o capítulo 2');
    render(<Ideias />);
    fireEvent.click(await screen.findByRole('button', { name: /^Virar tarefa:/ }));

    const cartao = await screen.findByRole('article');
    expect(cartao.closest('[role="status"], [aria-live]')).toBeNull();
    expect(cartao.getAttribute('aria-labelledby')).toBeTruthy();
    expect(cartao.getAttribute('aria-describedby')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(cartao));
    for (const regiao of document.querySelectorAll('[role="status"], [aria-live]')) expect(regiao.querySelector('button, a[href]')).toBeNull();

    fireEvent.click(within(cartao).getByRole('button', { name: 'Fechar' }));
    expect(screen.queryByRole('article')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Caixa de entrada' }));
  });
});
