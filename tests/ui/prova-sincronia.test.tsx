import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { gravarDoServidor, listar, listarPendentes } from '../../src/dados/loja';
import { sincronizar } from '../../src/dados/sincronia';
import { ProvaSincronia, TEXTO_DO_ESTADO } from '../../src/ui/ProvaSincronia';
import { ErroConexao } from '../../src/conexao/cliente';

function criar(titulo: string) {
  fireEvent.input(screen.getByLabelText('Nova tarefa'), { target: { value: titulo } });
  fireEvent.click(screen.getByRole('button', { name: 'Criar' }));
}

describe('ProvaSincronia (temporária, até a Tarefa 9)', () => {
  it('cria a tarefa na loja, mostra na lista e limpa o campo', async () => {
    render(<ProvaSincronia />);
    criar('Comprar café para Aurora');

    await screen.findByText('Comprar café para Aurora');
    expect((await listar('tarefas')).map((t) => t.titulo)).toEqual(['Comprar café para Aurora']);
    expect(await listarPendentes()).toHaveLength(1);
    expect((screen.getByLabelText('Nova tarefa') as HTMLInputElement).value).toBe('');
  });

  it('título vazio não cria nada', async () => {
    render(<ProvaSincronia />);
    criar('   ');
    await new Promise((pronto) => setTimeout(pronto, 20));
    expect(await listar('tarefas')).toEqual([]);
  });

  it('tarefa que chega de outro aparelho aparece sem recarregar', async () => {
    render(<ProvaSincronia />);
    await gravarDoServidor([
      {
        colecao: 'tarefas',
        registro: {
          id: 't1',
          titulo: 'Vinda do celular',
          salaId: null,
          duracaoMin: 60,
          duracaoConfirmada: false,
          feito: false,
          fixada: false,
          marcar: false,
          atualizadoEm: 1,
          aparelho: 'celular',
        },
      },
    ]);
    await screen.findByText('Vinda do celular');
  });

  it('mostra o estado da sincronia em português', async () => {
    render(<ProvaSincronia />);
    await sincronizar({ chamar: () => Promise.reject(new ErroConexao()), esperar: async () => {} });
    await waitFor(() => expect(screen.getByText(TEXTO_DO_ESTADO['sem-internet'])).toBeTruthy());
  });

  it('todo estado tem texto', () => {
    expect(Object.keys(TEXTO_DO_ESTADO).sort()).toEqual(
      ['atualizado', 'atualizando', 'erro-codigo', 'por-enviar', 'sem-internet'].sort(),
    );
  });

  it('botão e campo têm pelo menos 44 px de altura', () => {
    render(<ProvaSincronia />);
    expect(screen.getByRole('button', { name: 'Criar' }).style.minHeight).toBe('44px');
    expect((screen.getByLabelText('Nova tarefa') as HTMLElement).style.minHeight).toBe('44px');
  });
});

describe('página inicial', () => {
  it('mostra a prova da sincronia', async () => {
    const { App } = await import('../../src/App');
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Prova da sincronia' })).toBeTruthy();
  });
});
