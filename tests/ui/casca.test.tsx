import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErroConexao, ErroScript } from '../../src/conexao/cliente';
import { salvarConexao } from '../../src/conexao/guarda';
import { apagar, salvar, semear } from '../../src/dados/loja';
import { sincronizar, type EstadoSync } from '../../src/dados/sincronia';
import { App } from '../../src/App';
import { PAINEIS_DIREITOS } from '../../src/rotas';
import { TEXTO_DO_ESTADO, TEXTO_NAO_CONECTADO } from '../../src/ui/EstadoSync';

// Quinta-feira, 2026-11-05, 12:20 (Europe/Lisbon). Só a data é falsa: o resto
// do relógio (timers do IndexedDB) segue real.
const AGORA = new Date(2026, 10, 5, 12, 20);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AGORA);
  irPara('#/', 1280);
});

function irPara(hash: string, largura?: number) {
  if (largura !== undefined) {
    Object.defineProperty(window, 'innerWidth', { value: largura, configurable: true, writable: true });
  }
  history.replaceState(null, '', `/${hash}`);
}

function navegar(hash: string) {
  act(() => {
    location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}

function mudarLargura(largura: number) {
  act(() => {
    Object.defineProperty(window, 'innerWidth', { value: largura, configurable: true, writable: true });
    window.dispatchEvent(new Event('resize'));
  });
}

const principal = () => screen.getByRole('navigation', { name: 'Principal' });
const link = (nome: string, dentro: HTMLElement = document.body) => within(dentro).getByRole('link', { name: nome });
const href = (nome: string, dentro?: HTMLElement) => link(nome, dentro).getAttribute('href');

async function mostrar(hash: string, largura: number) {
  irPara(hash, largura);
  render(<App />);
}

describe('computador (1280 px): menu à esquerda, página, painel direito', () => {
  it('o menu tem os grupos da especificação, com o mês e o ano atuais', async () => {
    await mostrar('#/', 1280);
    const menu = principal();

    expect(href('Painel do dia', menu)).toBe('#/');

    const grupo = (nome: string) => {
      const titulo = within(menu).getByRole('heading', { name: nome });
      return within(titulo.closest('section')!);
    };
    const nomesDe = (g: ReturnType<typeof within>) =>
      g.getAllByRole('link').map((a: HTMLElement) => a.textContent);

    expect(nomesDe(grupo('Calendário'))).toEqual(['Esta semana', 'Novembro', '2026']);
    expect(nomesDe(grupo('Ver'))).toEqual(['Salas', 'Caixa', 'Quadro', 'Atividades', 'Sem prazo']);
    expect(href('Esta semana', menu)).toBe('#/semana');
    expect(href('Novembro', menu)).toBe('#/mes');
    expect(href('2026', menu)).toBe('#/ano');
    expect(href('Salas', menu)).toBe('#/salas');
    expect(href('Caixa', menu)).toBe('#/caixa');
    expect(href('Quadro', menu)).toBe('#/quadro');
    expect(href('Atividades', menu)).toBe('#/atividades');
    expect(href('Sem prazo', menu)).toBe('#/sem-prazo');
  });

  it('lista as salas guardadas, na ordem delas, cada uma com o seu endereço', async () => {
    await semear();
    await mostrar('#/', 1280);
    const grupo = within((await screen.findByRole('heading', { name: 'Minhas salas' })).closest('section')!);
    await waitFor(() => expect(grupo.getAllByRole('link')).toHaveLength(7));
    expect(grupo.getAllByRole('link').map((a) => a.textContent)).toEqual([
      'Doutoramento',
      'Investigação',
      'Aulas',
      'Orientações',
      'MBA',
      'Pessoal',
      'Casa',
    ]);
    expect(grupo.getByRole('link', { name: 'MBA' }).getAttribute('href')).toBe('#/sala/sala-mba');
  });

  it('sala criada depois aparece no menu sem recarregar, e sala apagada sai', async () => {
    await mostrar('#/', 1280);
    const grupo = within((await screen.findByRole('heading', { name: 'Minhas salas' })).closest('section')!);
    expect(grupo.queryAllByRole('link')).toHaveLength(0);
    await salvar('salas', { id: 'sala-nova', nome: 'Aurora', ordem: 9 });
    await waitFor(() => expect(grupo.getByRole('link', { name: 'Aurora' })).toBeTruthy());

    await salvar('salas', { id: 'sala-nova', nome: 'Aurora 2', ordem: 9 });
    await waitFor(() => expect(grupo.getByRole('link', { name: 'Aurora 2' })).toBeTruthy());
    expect(grupo.queryByRole('link', { name: 'Aurora' })).toBeNull();

    await apagar('salas', 'sala-nova');
    await waitFor(() => expect(grupo.queryAllByRole('link')).toHaveLength(0));
  });

  it('a página da sala já aberta acompanha o novo nome da sala', async () => {
    await salvar('salas', { id: 'sala-x', nome: 'Antes', ordem: 1 });
    await mostrar('#/sala/sala-x', 1280);
    await screen.findByRole('heading', { level: 1, name: 'Antes' });
    await salvar('salas', { id: 'sala-x', nome: 'Depois', ordem: 1 });
    await screen.findByRole('heading', { level: 1, name: 'Depois' });
  });

  it('só a rota ativa tem aria-current="page", e ele acompanha a navegação', async () => {
    await mostrar('#/semana', 1280);
    const menu = principal();
    expect(menu.querySelectorAll('[aria-current]')).toHaveLength(1);
    expect(link('Esta semana', menu).getAttribute('aria-current')).toBe('page');

    navegar('#/quadro');
    expect(link('Esta semana', menu).hasAttribute('aria-current')).toBe(false);
    expect(link('Quadro', menu).getAttribute('aria-current')).toBe('page');
    expect(menu.querySelectorAll('[aria-current]')).toHaveLength(1);

    navegar('#/');
    expect(link('Painel do dia', menu).getAttribute('aria-current')).toBe('page');
  });

  it('a sala aberta fica marcada no menu', async () => {
    await semear();
    await mostrar('#/sala/sala-aulas', 1280);
    const menu = principal();
    await waitFor(() => expect(link('Aulas', menu).getAttribute('aria-current')).toBe('page'));
    expect(link('Salas', menu).hasAttribute('aria-current')).toBe(false);
    // Só aquela sala: as outras não ficam marcadas.
    expect(link('Doutoramento', menu).hasAttribute('aria-current')).toBe(false);
    expect(menu.querySelectorAll('[aria-current]')).toHaveLength(1);
  });

  it('o painel direito tem Agora e Chat', async () => {
    await mostrar('#/', 1280);
    const painel = screen.getByRole('complementary', { name: 'Agora e chat' });
    const titulos = within(painel).getAllByRole('heading').map((h: HTMLElement) => h.textContent);
    // Um cartão para cada painel que a rota diz aceitar, na mesma ordem.
    expect(titulos).toEqual(PAINEIS_DIREITOS.map((p) => (p === 'agora' ? 'Agora' : 'Chat')));
  });

  it('não mostra a barra inferior nem o botão Mais', async () => {
    await mostrar('#/', 1280);
    expect(screen.queryByRole('button', { name: 'Mais' })).toBeNull();
    expect(screen.getAllByRole('navigation')).toHaveLength(1);
  });
});

describe('celular (390 px): barra inferior com Mais', () => {
  it('a barra tem os atalhos e o Mais, sem menu lateral nem painel direito', async () => {
    await mostrar('#/', 390);
    const barra = screen.getByRole('navigation', { name: 'Principal' });
    expect(barra.getAttribute('data-variante')).toBe('barra');
    expect(within(barra).getAllByRole('link').map((a) => a.textContent)).toEqual([
      'Painel',
      'Atividades',
      'Sem prazo',
      'Salas',
      'Chat',
    ]);
    expect(within(barra).getByRole('button', { name: 'Mais' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Calendário' })).toBeNull();
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it('o Mais leva a Esta semana, mês, ano, Agora, Quadro, Atividades, Sem prazo e Cores do Google, e Conectar e IA local', async () => {
    await mostrar('#/', 390);
    const botao = screen.getByRole('button', { name: 'Mais' });
    expect(botao.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(botao);
    expect(botao.getAttribute('aria-expanded')).toBe('true');
    const folha = screen.getByRole('dialog', { name: 'Mais' });
    expect(within(folha).getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Esta semana', '#/semana'],
      ['Novembro', '#/mes'],
      ['2026', '#/ano'],
      ['Agora', '#/agora'],
      ['Quadro', '#/quadro'],
      ['Atividades', '#/atividades'],
      ['Sem prazo', '#/sem-prazo'],
      ['Cores do Google', '#/cores'],
      ['Conectar aparelho', '#/conectar'],
      ['IA local', '#/ia'],
    ]);
  });

  it('o foco vai para a folha ao abrir e volta ao Mais ao fechar com Esc', async () => {
    await mostrar('#/', 390);
    const botao = screen.getByRole('button', { name: 'Mais' });
    botao.focus();
    fireEvent.click(botao);
    const folha = screen.getByRole('dialog', { name: 'Mais' });
    await waitFor(() => expect(folha.contains(document.activeElement)).toBe(true));

    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(botao);
  });

  it('escolher um destino fecha a folha e abre a página', async () => {
    await mostrar('#/', 390);
    fireEvent.click(screen.getByRole('button', { name: 'Mais' }));
    const alvo = within(screen.getByRole('dialog')).getByRole('link', { name: 'Quadro' });
    act(() => {
      // O navegador troca o hash ao seguir o link; o jsdom não segue, então simulamos.
      location.hash = alvo.getAttribute('href')!;
      fireEvent.click(alvo);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Quadro' })).toBeTruthy();
  });

  it('o botão Fechar e o fundo também fecham', async () => {
    await mostrar('#/', 390);
    fireEvent.click(screen.getByRole('button', { name: 'Mais' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Mais' }));
    fireEvent.click(document.querySelector('.fundo-da-folha')!);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Tab na última opção volta à primeira, sem sair da folha', async () => {
    await mostrar('#/', 390);
    fireEvent.click(screen.getByRole('button', { name: 'Mais' }));
    const folha = screen.getByRole('dialog');
    const focaveis = within(folha).getAllByRole('link').concat(within(folha).getAllByRole('button'));
    const ultimo = focaveis[focaveis.length - 1];
    ultimo.focus();
    fireEvent.keyDown(ultimo, { key: 'Tab' });
    expect(document.activeElement).toBe(focaveis[0]);
    focaveis[0].focus();
    fireEvent.keyDown(focaveis[0], { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(ultimo);
  });

  it('o Mais marca que a página aberta está dentro dele', async () => {
    await mostrar('#/quadro', 390);
    expect(screen.getByRole('button', { name: 'Mais' }).getAttribute('aria-current')).toBe('true');
    navegar('#/atividades');
    // Atividades tem atalho próprio na barra: lá é a página atual, e o Mais não a reivindica.
    expect(screen.getByRole('button', { name: 'Mais' }).hasAttribute('aria-current')).toBe(false);
    expect(link('Atividades').getAttribute('aria-current')).toBe('page');
  });

  it('Salas fica marcada dentro de uma sala (aria-current="true"), não "page"', async () => {
    await mostrar('#/sala/sala-mba', 390);
    expect(link('Salas').getAttribute('aria-current')).toBe('true');
  });

  it('girar o aparelho troca a barra pelo trilho sem perder a página', async () => {
    await mostrar('#/quadro', 390);
    mudarLargura(800);
    expect(screen.getByRole('navigation', { name: 'Principal' }).getAttribute('data-variante')).toBe('trilho');
    expect(screen.getByRole('heading', { level: 1, name: 'Quadro' })).toBeTruthy();
    mudarLargura(1280);
    expect(screen.getByRole('heading', { name: 'Calendário' })).toBeTruthy();
  });
});

describe('tablet (800 px): trilho', () => {
  it('mostra o trilho com os mesmos atalhos e o Mais, sem menu completo nem painel direito', async () => {
    await mostrar('#/', 800);
    const trilho = screen.getByRole('navigation', { name: 'Principal' });
    expect(trilho.getAttribute('data-variante')).toBe('trilho');
    expect(within(trilho).getAllByRole('link').map((a) => a.textContent)).toEqual([
      'Painel',
      'Atividades',
      'Sem prazo',
      'Salas',
      'Chat',
    ]);
    expect(within(trilho).getByRole('button', { name: 'Mais' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Calendário' })).toBeNull();
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it('os limites: 699 é celular, 700 e 1100 são trilho, 1101 é computador', async () => {
    await mostrar('#/', 699);
    const variante = () => screen.getByRole('navigation', { name: 'Principal' }).getAttribute('data-variante');
    expect(variante()).toBe('barra');
    mudarLargura(700);
    expect(variante()).toBe('trilho');
    mudarLargura(1100);
    expect(variante()).toBe('trilho');
    mudarLargura(1101);
    expect(screen.queryByRole('complementary')).not.toBeNull();
  });
});

describe('páginas', () => {
  it('cada rota tem um título de vista (h1) e o título da aba', async () => {
    await mostrar('#/', 1280);
    expect(screen.getByRole('heading', { level: 1, name: 'Painel do dia' })).toBeTruthy();
    expect(document.title).toBe('Painel do dia · Central de Comando');

    for (const [hash, titulo] of [
      ['#/agora', 'Agora'],
      ['#/semana', 'Esta semana'],
      ['#/mes', 'Novembro'],
      ['#/ano', '2026'],
      ['#/salas', 'Salas'],
      ['#/caixa', 'Caixa'],
      ['#/quadro', 'Quadro'],
      ['#/atividades', 'Atividades'],
      ['#/sem-prazo', 'Sem prazo'],
      ['#/chat', 'Chat'],
    ]) {
      navegar(hash);
      expect(screen.getByRole('heading', { level: 1, name: titulo })).toBeTruthy();
      expect(document.title).toBe(`${titulo} · Central de Comando`);
    }
  });

  it('as telas que existem não dizem "Em breve"', async () => {
    for (const hash of ['#/', '#/agora', '#/semana', '#/mes', '#/ano', '#/atividades', '#/sem-prazo', '#/salas', '#/chat', '#/caixa', '#/quadro']) {
      const { unmount } = render(<App />);
      navegar(hash);
      expect(within(document.querySelector('main') as HTMLElement).queryByText('Esta tela chega numa próxima versão.')).toBeNull();
      unmount();
    }
  });

  it('endereço desconhecido mostra "Página não encontrada" com o caminho de volta', async () => {
    await mostrar('#/nada-aqui', 1280);
    expect(screen.getByRole('heading', { level: 1, name: 'Página não encontrada' })).toBeTruthy();
    const dentro = within(document.querySelector('main')!);
    expect(dentro.getByRole('link', { name: 'Ir para o Painel do dia' }).getAttribute('href')).toBe('#/');
  });

  it('a página da sala mostra o nome da sala; sala que não existe, aviso', async () => {
    await semear();
    await mostrar('#/sala/sala-orientacoes', 1280);
    expect(await screen.findByRole('heading', { level: 1, name: 'Orientações' })).toBeTruthy();
    navegar('#/sala/nao-existe');
    expect(await screen.findByRole('heading', { level: 1, name: 'Sala não encontrada' })).toBeTruthy();
  });

  it('a página da pessoa mostra o nome; pessoa que não existe, aviso', async () => {
    await salvar('pessoas', { id: 'p-marina', nome: 'Marina', salaId: 'sala-orientacoes' });
    await mostrar('#/pessoa/p-marina', 1280);
    expect(await screen.findByRole('heading', { level: 1, name: 'Marina' })).toBeTruthy();
    navegar('#/pessoa/outra');
    expect(await screen.findByRole('heading', { level: 1, name: 'Pessoa não encontrada' })).toBeTruthy();
  });

  it('o foco vai para o título ao trocar de página, mas não ao abrir o app', async () => {
    await mostrar('#/', 1280);
    expect(document.activeElement).toBe(document.body);
    navegar('#/quadro');
    const titulo = screen.getByRole('heading', { level: 1, name: 'Quadro' });
    await waitFor(() => expect(document.activeElement).toBe(titulo));
  });

  it('há um só <main>, e o primeiro Tab leva a "Pular para o conteúdo"', async () => {
    await mostrar('#/quadro', 1280);
    expect(document.querySelectorAll('main')).toHaveLength(1);
    const pular = screen.getByRole('button', { name: 'Pular para o conteúdo' });
    fireEvent.click(pular);
    expect(document.activeElement).toBe(document.querySelector('main'));
  });

  it('o painel do dia mostra a checklist e Sem prazo, e já não mostra a prova da sincronia', async () => {
    await mostrar('#/', 1280);
    expect(screen.getByRole('heading', { level: 2, name: 'Checklist do dia' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Sem prazo' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Prova da sincronia' })).toBeNull();
  });
});

describe('Conectar dentro da casca', () => {
  it('abre em #/conectar com o menu à volta e um caminho visível de volta', async () => {
    await mostrar('#/conectar', 1280);
    expect(screen.getByRole('heading', { level: 1, name: 'Conectar aparelho' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Testar e salvar' })).toBeTruthy();
    expect(principal()).toBeTruthy();
    const voltar = link('Voltar', document.querySelector('main')!);
    expect(voltar.getAttribute('href')).toBe('#/');
  });

  it('o menu completo tem o caminho para Conectar aparelho', async () => {
    await mostrar('#/', 1280);
    expect(href('Conectar aparelho', principal())).toBe('#/conectar');
  });

  it('só Conectar tem o link Voltar', async () => {
    await mostrar('#/quadro', 1280);
    expect(screen.queryByRole('link', { name: 'Voltar' })).toBeNull();
  });
});

describe('Mais: foco e fechamento', () => {
  it('escolher a página em que já está devolve o foco ao botão Mais', async () => {
    await mostrar('#/quadro', 390);
    const botao = screen.getByRole('button', { name: 'Mais' });
    fireEvent.click(botao);
    const atual = within(screen.getByRole('dialog')).getByRole('link', { name: 'Quadro' });
    expect(atual.getAttribute('aria-current')).toBe('page');
    fireEvent.click(atual); // o hash não muda: nenhuma página nova para receber o foco
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(botao);
  });

  it('a folha fecha quando a página muda por outro caminho (voltar do navegador)', async () => {
    await mostrar('#/', 390);
    fireEvent.click(screen.getByRole('button', { name: 'Mais' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    navegar('#/caixa');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Mais' }).getAttribute('aria-expanded')).toBe('false');
    const titulo = screen.getByRole('heading', { level: 1, name: 'Caixa' });
    await waitFor(() => expect(document.activeElement).toBe(titulo));
  });
});

describe('estado da sincronia, sempre em texto', () => {
  const esperarSemRede = async () => {};
  const conectarAparelho = () =>
    salvarConexao({ url: 'https://script.google.com/macros/s/ID-FICTICIO/exec', codigo: 'codigo-ficticio-0123456789' });
  const chip = () => document.querySelector<HTMLElement>('.sync')!;
  /** O que o leitor de tela recebe: só o texto, sem prefixo. */
  // O da sincronia fica no topo; a agenda do Painel tem o seu (avisos quietos).
  const anuncio = () => within(document.querySelector('.topo') as HTMLElement).getByRole('status');
  const semRede = () => sincronizar({ chamar: () => Promise.reject(new ErroConexao()), esperar: esperarSemRede });
  const tudoCerto = () =>
    sincronizar({
      chamar: ((acao: string) =>
        Promise.resolve(acao === 'puxar' ? { registros: [], agora: 0 } : { aceitas: [], conflitos: [] })) as never,
      esperar: esperarSemRede,
    });

  it('todo estado tem um texto curto em português', () => {
    expect(TEXTO_DO_ESTADO).toEqual({
      atualizado: 'Atualizado',
      atualizando: 'Atualizando…',
      'sem-internet': 'Sem internet',
      'por-enviar': 'Por enviar',
      'erro-codigo': 'Problema com o código do aparelho',
    });
    expect(TEXTO_NAO_CONECTADO).toBe('Aparelho não conectado');
  });

  it('mostra o estado atual ao abrir e acompanha cada mudança', async () => {
    await conectarAparelho();
    await mostrar('#/', 1280);
    await act(async () => {
      await semRede();
    });
    expect(chip().textContent).toContain('Sem internet');

    // atualizando (a chamada fica aberta até a gente soltar)
    let soltar!: (valor: unknown) => void;
    let rodada!: Promise<EstadoSync>;
    act(() => {
      rodada = sincronizar({
        chamar: (acao: string) =>
          new Promise((resolver) => {
            if (acao === 'puxar') soltar = resolver;
            else resolver({ aceitas: [], conflitos: [] });
          }) as never,
        esperar: esperarSemRede,
      });
    });
    await waitFor(() => expect(chip().textContent).toContain('Atualizando…'));
    await waitFor(() => expect(soltar).toBeTypeOf('function'));

    await act(async () => {
      soltar({ registros: [], agora: 0 });
      await rodada;
    });
    expect(chip().textContent).toContain('Atualizado');

    await act(async () => {
      await sincronizar({ chamar: () => Promise.reject(new ErroScript('codigo-invalido')), esperar: esperarSemRede });
    });
    expect(chip().textContent).toContain('Problema com o código do aparelho');
  });

  it('por-enviar: sem rede e com alteração guardada', async () => {
    await conectarAparelho();
    await salvar('tarefas', {
      titulo: 'Ligar para Renata',
      salaId: null,
      duracaoMin: 60,
      duracaoConfirmada: false,
      feito: false,
      fixada: false,
      marcar: false,
    });
    await mostrar('#/', 1280);
    await act(async () => {
      await semRede();
    });
    expect(chip().textContent).toContain('Por enviar');
  });

  it('sem conexão guardada, a falha de rede não vira "Sem internet": diz que o aparelho não está conectado', async () => {
    await mostrar('#/', 1280);
    await act(async () => {
      await semRede();
    });
    await waitFor(() => expect(chip().textContent).toContain('Aparelho não conectado'));
    expect(chip().textContent).not.toContain('Sem internet');
    expect(within(chip()).getByRole('link', { name: 'Aparelho não conectado' }).getAttribute('href')).toBe('#/conectar');
    expect(anuncio().textContent).toBe('Aparelho não conectado');
  });

  it('o mesmo vale com alterações na fila: sem conexão não é "Por enviar"', async () => {
    await salvar('tarefas', { titulo: 'Ligar para Renata', salaId: null } as never);
    await mostrar('#/', 1280);
    await act(async () => {
      await semRede();
    });
    await waitFor(() => expect(chip().textContent).toContain('Aparelho não conectado'));
  });

  it('enquanto atualiza, mesmo sem conexão, mostra "Atualizando…"', async () => {
    await mostrar('#/', 1280);
    let soltar!: () => void;
    let rodada!: Promise<EstadoSync>;
    act(() => {
      rodada = sincronizar({
        chamar: () => new Promise<never>((_, rejeitar) => (soltar = () => rejeitar(new ErroConexao()))),
        esperar: esperarSemRede,
      });
    });
    await waitFor(() => expect(chip().textContent).toContain('Atualizando…'));
    await waitFor(() => expect(soltar).toBeTypeOf('function'));
    await act(async () => {
      soltar();
      await rodada;
    });
  });

  it('ao conectar o aparelho e voltar, o texto deixa de dizer "não conectado"', async () => {
    await mostrar('#/conectar', 1280);
    await act(async () => {
      await semRede();
    });
    await waitFor(() => expect(chip().textContent).toContain('Aparelho não conectado'));
    await conectarAparelho();
    navegar('#/');
    await waitFor(() => expect(chip().textContent).toContain('Sem internet'));
  });

  it('o problema com o código leva a Conectar aparelho; os outros estados não são link', async () => {
    await conectarAparelho();
    await mostrar('#/', 1280);
    await act(async () => {
      await sincronizar({ chamar: () => Promise.reject(new ErroScript('interno')), esperar: esperarSemRede });
    });
    const alvo = within(chip()).getByRole('link', { name: /Problema com o código do aparelho/ });
    expect(alvo.getAttribute('href')).toBe('#/conectar');

    await act(async () => {
      await tudoCerto();
    });
    expect(within(chip()).queryByRole('link')).toBeNull();
  });

  it('o leitor de tela só recebe o texto, e só quando o estado pede atenção', async () => {
    await conectarAparelho();
    await mostrar('#/', 1280);
    const regiao = anuncio();

    await act(async () => {
      await semRede();
    });
    expect(regiao.textContent).toBe('Sem internet');

    await act(async () => {
      await tudoCerto();
    });
    expect(chip().textContent).toContain('Atualizado');
    expect(regiao.textContent).toBe(''); // voltar ao normal não é anunciado

    await act(async () => {
      await sincronizar({ chamar: () => Promise.reject(new ErroScript('codigo-invalido')), esperar: esperarSemRede });
    });
    expect(regiao.textContent).toBe('Problema com o código do aparelho');
  });

  it('o chip em si não é região viva (só a região de aviso é)', async () => {
    await mostrar('#/', 1280);
    expect(chip().getAttribute('role')).toBeNull();
    expect(chip().querySelector('[aria-live]')).toBeNull();
  });

  it('aparece em todos os tamanhos, uma vez só', async () => {
    for (const largura of [390, 800, 1280]) {
      irPara('#/', largura);
      const { unmount } = render(<App />);
      expect(within(document.querySelector('.topo') as HTMLElement).getAllByRole('status')).toHaveLength(1);
      expect(document.querySelectorAll('.sync')).toHaveLength(1);
      unmount();
    }
  });

  it('o texto não depende só de cor: o ponto é decorativo (aria-hidden)', async () => {
    await mostrar('#/', 1280);
    expect(chip().querySelector('.ponto')?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('"Em breve": o que ainda não existe diz isso', () => {
  const emBreve = (li: Element | null) => li?.querySelector('.em-breve')?.textContent ?? null;
  const itemDe = (nome: string, dentro: HTMLElement) => within(dentro).getByRole('link', { name: nome }).closest('li');

  it('no menu do computador: nenhuma tela tem a marca, o Quadro já existe (Tarefa 20)', async () => {
    await mostrar('#/', 1280);
    const menu = principal();
    for (const nome of ['Quadro', 'Esta semana', 'Novembro', '2026', 'Salas', 'Caixa', 'Atividades', 'Sem prazo']) {
      expect(emBreve(itemDe(nome, menu))).toBeNull();
    }
  });

  it('a marca não muda o nome do link (o leitor de tela lê o link e depois "Em breve")', async () => {
    await mostrar('#/', 1280);
    expect(within(principal()).getByRole('link', { name: 'Caixa' })).toBeTruthy();
  });

  it('as páginas das salas existem (Tarefa 17): o grupo Minhas salas não avisa mais "próxima versão"', async () => {
    await mostrar('#/', 1280);
    const menu = principal();
    expect(within(menu).queryByText(/próxima versão/)).toBeNull();
  });

  it('o cartão Agora do painel direito já é o de verdade (Tarefa 16): sem "Em breve", com o caminho para o Agora', async () => {
    await mostrar('#/', 1280);
    const agora = within(screen.getByRole('complementary', { name: 'Agora e chat' }).querySelector('.cartao-agora') as HTMLElement);
    expect(agora.queryByText('Em breve')).toBeNull();
    expect(agora.getByRole('link', { name: 'Abrir o Agora' }).getAttribute('href')).toBe('#/agora');
  });

  it('na folha Mais do celular: nenhuma tela tem a marca, o Quadro já existe (Tarefa 20)', async () => {
    await mostrar('#/', 390);
    fireEvent.click(screen.getByRole('button', { name: 'Mais' }));
    const folha = screen.getByRole('dialog', { name: 'Mais' });
    for (const nome of ['Quadro', 'Esta semana', 'Novembro', '2026', 'Atividades', 'Sem prazo', 'Conectar aparelho']) {
      expect(emBreve(itemDe(nome, folha))).toBeNull();
    }
  });

  it('a barra do celular só leva a telas que existem: Painel, Atividades, Sem prazo, Salas e Chat', async () => {
    await mostrar('#/', 390);
    const barra = screen.getByRole('navigation', { name: 'Principal' });
    expect(barra.querySelector('.em-breve')).toBeNull();
    expect(within(barra).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
      '#/',
      '#/atividades',
      '#/sem-prazo',
      '#/salas',
      '#/chat',
    ]);
  });
});
