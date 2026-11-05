// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { publicar } from '../../script/publicar.mjs';

const ID_FICTICIO = 'AKfycb-id_ficticio-123';

function cenario(opcoes: { env?: Record<string, string>; arquivo?: string | null }) {
  const comandos: string[][] = [];
  const deps = {
    env: opcoes.env ?? {},
    lerArquivo: () => {
      if (opcoes.arquivo == null) throw new Error('arquivo não existe');
      return opcoes.arquivo;
    },
    rodar: (argumentos: string[]) => void comandos.push(argumentos),
  };
  return { comandos, executar: () => publicar(deps) };
}

describe('publicar', () => {
  it('envia o código e só depois atualiza a implantação', () => {
    const { comandos, executar } = cenario({ arquivo: `${ID_FICTICIO}\r\n` });
    executar();
    expect(comandos).toEqual([
      ['push', '-f'],
      ['deploy', '-i', ID_FICTICIO],
    ]);
  });

  it('a variável de ambiente tem prioridade sobre o arquivo', () => {
    const { comandos, executar } = cenario({
      env: { CENTRAL_IMPLANTACAO: 'id-do-ambiente' },
      arquivo: ID_FICTICIO,
    });
    executar();
    expect(comandos.at(-1)).toEqual(['deploy', '-i', 'id-do-ambiente']);
  });

  it('sem id não envia nada', () => {
    const { comandos, executar } = cenario({ arquivo: null });
    expect(executar).toThrow(/implantação/);
    expect(comandos).toEqual([]);
  });

  it.each(['', '   \n'])('arquivo em branco conta como sem id', (arquivo) => {
    const { comandos, executar } = cenario({ arquivo });
    expect(executar).toThrow(/implantação/);
    expect(comandos).toEqual([]);
  });

  it('recusa id com caracteres de comando', () => {
    const { comandos, executar } = cenario({ arquivo: 'abc & del tudo' });
    expect(executar).toThrow(/implantação/);
    expect(comandos).toEqual([]);
  });
});
