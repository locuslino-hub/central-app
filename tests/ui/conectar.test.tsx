import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { lerConexao, salvarConexao } from '../../src/conexao/guarda';
import { Conectar, formatarTempo } from '../../src/ui/Conectar';

const URL_FICTICIA = 'https://script.google.com/macros/s/ID-FICTICIO/exec';
const CODIGO = 'codigo-ficticio-de-teste-0123456789abcdef';

function respondeCom(corpo: string) {
  const falso = vi.fn(async () => new Response(corpo));
  vi.stubGlobal('fetch', falso);
  return falso;
}

function preencherEEnviar(url = URL_FICTICIA, codigo = CODIGO) {
  fireEvent.input(screen.getByLabelText('URL'), { target: { value: url } });
  fireEvent.input(screen.getByLabelText('Código do aparelho'), { target: { value: codigo } });
  fireEvent.click(screen.getByRole('button', { name: 'Testar e salvar' }));
}

describe('Conectar', () => {
  it('sucesso mostra o tempo e salva', async () => {
    respondeCom('{"ok":true,"dados":{}}');
    render(<Conectar />);
    preencherEEnviar();
    await screen.findByText(/^Conectado em \d+,\d s$/);
    expect(await lerConexao()).toEqual({ url: URL_FICTICIA, codigo: CODIGO });
  });

  it('tira os espaços que vêm junto ao colar', async () => {
    respondeCom('{"ok":true,"dados":{}}');
    render(<Conectar />);
    preencherEEnviar(URL_FICTICIA, `  ${CODIGO}\n`);
    await screen.findByText(/^Conectado em/);
    expect((await lerConexao())?.codigo).toBe(CODIGO);
  });

  it('código errado mostra a mensagem e não salva nada', async () => {
    respondeCom('{"ok":false,"erro":"codigo-invalido"}');
    render(<Conectar />);
    preencherEEnviar();
    await screen.findByText(/código.*incorreto/i);
    expect(await lerConexao()).toBeNull();
  });

  it('código errado não apaga a conexão que já funcionava', async () => {
    const anterior = { url: URL_FICTICIA, codigo: 'codigo-anterior-ficticio-0123456789abcdef' };
    await salvarConexao(anterior);
    respondeCom('{"ok":false,"erro":"codigo-invalido"}');
    render(<Conectar />);
    preencherEEnviar();
    await screen.findByText(/código.*incorreto/i);
    expect(await lerConexao()).toEqual(anterior);
  });

  it('sem rede mostra a mensagem e não salva nada', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    render(<Conectar />);
    preencherEEnviar();
    await screen.findByText(/sem conexão/i);
    expect(await lerConexao()).toBeNull();
  });

  it('script ocupado pede para tentar de novo', async () => {
    respondeCom('{"ok":false,"erro":"ocupado"}');
    render(<Conectar />);
    preencherEEnviar();
    await screen.findByText(/ocupado/i);
    expect(await lerConexao()).toBeNull();
  });

  it('erro interno do script tem mensagem própria', async () => {
    respondeCom('{"ok":false,"erro":"interno"}');
    render(<Conectar />);
    preencherEEnviar();
    await screen.findByText(/problema/i);
    expect(await lerConexao()).toBeNull();
  });

  it('endereço fora do Google não chega à rede', async () => {
    const falso = respondeCom('{"ok":true,"dados":{}}');
    render(<Conectar />);
    preencherEEnviar('https://exemplo.invalid/exec');
    await screen.findByText(/https:\/\/script\.google\.com\//);
    expect(falso).not.toHaveBeenCalled();
    expect(await lerConexao()).toBeNull();
  });

  it('conectou mas não conseguiu salvar: avisa em vez de dizer conectado', async () => {
    respondeCom('{"ok":true,"dados":{}}');
    vi.stubGlobal('indexedDB', undefined);
    render(<Conectar />);
    preencherEEnviar();
    await screen.findByText(/não .*salvar/i);
    expect(screen.queryByText(/^Conectado em/)).toBeNull();
  });

  it('anuncia o resultado em região aria-live', async () => {
    respondeCom('{"ok":true,"dados":{}}');
    render(<Conectar />);
    const regiao = screen.getByRole('status');
    expect(regiao.getAttribute('aria-live')).toBe('polite');
    preencherEEnviar();
    await waitFor(() => expect(regiao.textContent).toMatch(/^Conectado em/));
  });

  it('não dispara dois testes ao mesmo tempo', async () => {
    let liberar!: (resposta: Response) => void;
    const falso = vi.fn(() => new Promise<Response>((resolver) => (liberar = resolver)));
    vi.stubGlobal('fetch', falso);
    render(<Conectar />);
    preencherEEnviar();
    const botao = screen.getByRole<HTMLButtonElement>('button');
    await waitFor(() => expect(falso).toHaveBeenCalledTimes(1));
    expect(botao.disabled).toBe(true);
    fireEvent.click(botao);
    expect(falso).toHaveBeenCalledTimes(1);
    liberar(new Response('{"ok":true,"dados":{}}'));
    await screen.findByText(/^Conectado em/);
    expect(botao.disabled).toBe(false);
  });

  it('o código fica oculto até pedir para mostrar', () => {
    render(<Conectar />);
    const campo = screen.getByLabelText<HTMLInputElement>('Código do aparelho');
    expect(campo.type).toBe('password');
    fireEvent.click(screen.getByLabelText('Mostrar código'));
    expect(campo.type).toBe('text');
  });

  it('o teclado e o navegador não mexem no código nem o guardam', () => {
    render(<Conectar />);
    const campo = screen.getByLabelText<HTMLInputElement>('Código do aparelho');
    expect(campo.getAttribute('autocomplete')).toBe('new-password');
    expect(campo.getAttribute('autocapitalize')).toBe('none');
    expect(campo.getAttribute('autocorrect')).toBe('off');
  });
});

describe('Conectar com outra URL já salva', () => {
  const OUTRA_URL = 'https://script.google.com/macros/s/OUTRO-ID-FICTICIO/exec';
  const SALVA = { url: URL_FICTICIA, codigo: 'codigo-anterior-ficticio-0123456789abcdef' };
  const substituir = () => screen.findByRole('button', { name: 'Substituir conexão' });

  it('para antes da rede: o código não sai sem confirmação', async () => {
    await salvarConexao(SALVA);
    const falso = respondeCom('{"ok":true,"dados":{}}');
    render(<Conectar />);
    preencherEEnviar(OUTRA_URL);
    await substituir();
    expect(falso).not.toHaveBeenCalled();
    expect(await lerConexao()).toEqual(SALVA);
  });

  it('o aviso mostra a URL atual, para o dono comparar', async () => {
    await salvarConexao(SALVA);
    respondeCom('{"ok":true,"dados":{}}');
    render(<Conectar />);
    preencherEEnviar(OUTRA_URL);
    await substituir();
    expect(screen.getByRole('status').textContent).toContain(URL_FICTICIA);
  });

  it('confirmar testa a nova URL e substitui', async () => {
    await salvarConexao(SALVA);
    const falso = respondeCom('{"ok":true,"dados":{}}');
    render(<Conectar />);
    preencherEEnviar(OUTRA_URL);
    fireEvent.click(await substituir());
    await screen.findByText(/^Conectado em/);
    expect(falso).toHaveBeenCalledTimes(1);
    expect(await lerConexao()).toEqual({ url: OUTRA_URL, codigo: CODIGO });
    expect(screen.queryByRole('button', { name: 'Substituir conexão' })).toBeNull();
  });

  it('confirmar com código errado mantém a conexão anterior', async () => {
    await salvarConexao(SALVA);
    respondeCom('{"ok":false,"erro":"codigo-invalido"}');
    render(<Conectar />);
    preencherEEnviar(OUTRA_URL);
    fireEvent.click(await substituir());
    await screen.findByText(/código.*incorreto/i);
    expect(await lerConexao()).toEqual(SALVA);
  });

  it('mudar a URL depois do aviso cancela a confirmação', async () => {
    await salvarConexao(SALVA);
    const falso = respondeCom('{"ok":true,"dados":{}}');
    render(<Conectar />);
    preencherEEnviar(OUTRA_URL);
    await substituir();
    fireEvent.input(screen.getByLabelText('URL'), {
      target: { value: 'https://script.google.com/macros/s/TERCEIRO-ID-FICTICIO/exec' },
    });
    expect(screen.queryByRole('button', { name: 'Substituir conexão' })).toBeNull();
    expect(falso).not.toHaveBeenCalled();
  });

  it('a mesma URL com código novo não pede confirmação', async () => {
    await salvarConexao(SALVA);
    respondeCom('{"ok":true,"dados":{}}');
    render(<Conectar />);
    preencherEEnviar();
    await screen.findByText(/^Conectado em/);
    expect(await lerConexao()).toEqual({ url: URL_FICTICIA, codigo: CODIGO });
  });
});

describe('formatarTempo', () => {
  it.each([
    [0, '0,0 s'],
    [1_234, '1,2 s'],
    [9_999, '10,0 s'],
    [12_345, '12,3 s'],
  ])('%d ms vira %s', (ms, esperado) => {
    expect(formatarTempo(ms)).toBe(esperado);
  });
});

describe('rota da tela', () => {
  afterEach(() => {
    location.hash = '';
  });

  it('o endereço #/conectar abre a tela', () => {
    location.hash = '#/conectar';
    render(<App />);
    expect(screen.getByRole('button', { name: 'Testar e salvar' })).toBeTruthy();
  });

  it('sem esse endereço, a tela fica fechada e há um link para ela', () => {
    render(<App />);
    expect(screen.queryByRole('button', { name: 'Testar e salvar' })).toBeNull();
    const link = screen.getByRole<HTMLAnchorElement>('link', { name: 'Conectar aparelho' });
    expect(link.getAttribute('href')).toBe('#/conectar');
  });

  it('mudar o endereço troca a tela sem recarregar', async () => {
    render(<App />);
    location.hash = '#/conectar';
    await screen.findByRole('button', { name: 'Testar e salvar' });
  });
});
