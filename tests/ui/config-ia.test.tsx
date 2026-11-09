import { act, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { criarIA } from '../../src/ia/ia';
import { resolverRota } from '../../src/rotas';
import { ConfigIA, textoDoProgresso } from '../../src/ui/ConfigIA';
import { GRUPOS_DO_MAIS } from '../../src/ui/Mais';
import { trabalhadorFalso } from '../apoio/ia';

async function montar(opcoes: Parameters<typeof trabalhadorFalso>[0] = {}) {
  const ambiente = trabalhadorFalso(opcoes);
  const ia = criarIA(ambiente);
  await ia.iniciar();
  render(<ConfigIA ia={ia} />);
  return { ambiente, ia };
}

const botao = (nome: string | RegExp) => screen.getByRole('button', { name: nome });

describe('IA local em Configurações', () => {
  it('sem modelo: explica, avisa o tamanho e não baixa nada sozinha', async () => {
    const { ambiente } = await montar({ guardado: false });
    expect(screen.getByRole('heading', { name: 'IA local' })).toBeTruthy();
    expect(screen.getByText(/as frases não saem dele/)).toBeTruthy();
    expect(screen.getByText(/cerca de 3 GB/)).toBeTruthy();
    expect(ambiente.pedidos.some((p) => p.tipo === 'baixar')).toBe(false);
  });

  it('baixar pede confirmação com o tamanho; cancelar não baixa', async () => {
    const { ambiente } = await montar({ guardado: false });
    fireEvent.click(botao('Baixar a IA'));
    expect(screen.getByText('Baixar cerca de 3 GB agora? Use Wi-Fi.')).toBeTruthy();
    fireEvent.click(botao('Cancelar'));
    expect(ambiente.pedidos.some((p) => p.tipo === 'baixar')).toBe(false);
    expect(botao('Baixar a IA')).toBeTruthy();
  });

  it('confirmado, pede para guardar de vez, mostra o progresso e termina pronta', async () => {
    const { ambiente } = await montar({ guardado: false, segurarDownload: true, passos: [1_500, 3_000] });
    fireEvent.click(botao('Baixar a IA'));
    fireEvent.click(botao('Baixar agora'));
    await waitFor(() => expect(screen.getByText(/Baixando/)).toBeTruthy());
    expect(ambiente.persistiu).toBe(1);
    expect(screen.getByText('Pode usar o app enquanto isso.')).toBeTruthy();
    await act(async () => ambiente.soltarDownload());
    await waitFor(() => expect(screen.getByText('A IA está pronta neste aparelho.')).toBeTruthy());
  });

  it('progresso diz quanto já baixou, em GB e porcentagem', () => {
    expect(textoDoProgresso(undefined)).toBe('Baixando: começando…');
    expect(textoDoProgresso({ baixados: 0, total: 2_969_059_328 })).toBe('Baixando: 0,0 de 3,0 GB (0%)');
    expect(textoDoProgresso({ baixados: 1_484_529_664, total: 2_969_059_328 })).toBe('Baixando: 1,5 de 3,0 GB (50%)');
    expect(textoDoProgresso({ baixados: 2_969_059_328, total: 2_969_059_328 })).toBe('Baixando: 3,0 de 3,0 GB (100%)');
  });

  it('download cancelado volta a oferecer o download', async () => {
    const { ambiente } = await montar({ guardado: false, segurarDownload: true });
    fireEvent.click(botao('Baixar a IA'));
    fireEvent.click(botao('Baixar agora'));
    await waitFor(() => expect(botao('Cancelar download')).toBeTruthy());
    fireEvent.click(botao('Cancelar download'));
    await waitFor(() => expect(botao('Baixar a IA')).toBeTruthy());
    expect(ambiente.pedidos.map((p) => p.tipo)).toContain('cancelar-download');
  });

  it('armazenamento não garantido: avisa que o navegador pode apagar', async () => {
    await montar({ guardado: false, persistente: false });
    fireEvent.click(botao('Baixar a IA'));
    fireEvent.click(botao('Baixar agora'));
    await waitFor(() => expect(screen.getByText(/pode apagar o modelo se faltar espaço/)).toBeTruthy());
  });

  it('pronta: oferece apagar, com confirmação', async () => {
    const { ambiente } = await montar({ guardado: true });
    expect(screen.getByText('A IA está pronta neste aparelho.')).toBeTruthy();
    fireEvent.click(botao('Apagar a IA deste aparelho'));
    expect(ambiente.pedidos.some((p) => p.tipo === 'apagar')).toBe(false);
    fireEvent.click(botao('Apagar'));
    await waitFor(() => expect(botao('Baixar a IA')).toBeTruthy());
    expect(ambiente.pedidos.some((p) => p.tipo === 'apagar')).toBe(true);
  });

  it('aparelho sem suporte: diz que o chat segue sem IA e não oferece download', async () => {
    await montar({ suportado: false });
    expect(screen.getByText(/não consegue rodar a IA local/)).toBeTruthy();
    expect(screen.getByText(/O chat continua com as regras e a memória/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Baixar a IA' })).toBeNull();
  });

  it('falha ao abrir: "Tentar de novo" reabre o modelo guardado sem pedir download', async () => {
    const { ambiente } = await montar({ guardado: true, falhaAoCarregar: true });
    expect(screen.getByText(/A IA não abriu/)).toBeTruthy();
    ambiente.falhaAoCarregar = false;
    fireEvent.click(botao('Tentar de novo'));
    await waitFor(() => expect(screen.getByText('A IA está pronta neste aparelho.')).toBeTruthy());
    expect(ambiente.pedidos.some((p) => p.tipo === 'baixar')).toBe(false);
  });

  it('versão nova do app: pede para atualizar, com o botão Atualizar no lugar de "Tentar de novo"', async () => {
    const ambiente = trabalhadorFalso({ guardado: true, desatualizado: true });
    const ia = criarIA(ambiente);
    await ia.iniciar();
    let recarregou = 0;
    render(<ConfigIA ia={ia} recarregar={() => recarregou++} />);
    expect(screen.getByText('Atualize o app para usar a IA.')).toBeTruthy();
    expect(screen.queryByText(/A IA não abriu/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Tentar de novo' })).toBeNull();
    fireEvent.click(botao('Atualizar'));
    expect(recarregou).toBe(1);
  });

  it('sem espaço: diz o que fazer e deixa tentar de novo', async () => {
    const { ambiente } = await montar({ guardado: false, falhaAoBaixar: 'sem-espaco' });
    fireEvent.click(botao('Baixar a IA'));
    fireEvent.click(botao('Baixar agora'));
    await waitFor(() => expect(screen.getByText(/Falta espaço/)).toBeTruthy());
    fireEvent.click(botao('Tentar de novo'));
    fireEvent.click(botao('Baixar agora'));
    await waitFor(() => expect(ambiente.pedidos.filter((p) => p.tipo === 'baixar')).toHaveLength(2));
  });

  it('abrindo: diz que o chat já funciona', async () => {
    const ambiente = trabalhadorFalso({ guardado: true });
    const ia = criarIA(ambiente);
    render(<ConfigIA ia={ia} />);
    const inicio = ia.iniciar();
    await waitFor(() => expect(screen.getByText(/Abrindo a IA/)).toBeTruthy());
    await act(() => inicio);
  });
});

describe('caminho até a IA local', () => {
  it('a rota #/ia abre "IA local"', () => {
    expect(resolverRota('#/ia')).toMatchObject({ id: 'ia', titulo: 'IA local' });
  });

  it('o Mais leva à IA local, no grupo Aparelho', () => {
    const aparelho = GRUPOS_DO_MAIS.find((g) => g.titulo === 'Aparelho')!;
    expect(aparelho.destinos.map((d) => d.id)).toContain('ia');
  });
});
