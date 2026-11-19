// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { montarCorpoDeAudio, tratar, tratarCorpo, type Ambiente } from '../../script/api';
import { AUDIO_BASE64_NO_MAXIMO, PedidoInvalido, apagarAudio, lerAudio, salvarAudio, type ServicoDeAudios } from '../../script/audio';
import { armazemNaMemoria } from '../apoio/armazem';

const CODIGO = 'codigo-ficticio-de-teste-0123456789abcdef';
const BASE64 = 'T2dnUwACAAAAAAAAAAA='; // bytes fictícios, só o formato importa

interface Item {
  id: string;
  nome: string;
  pai: string | null;
  pasta: boolean;
  mime?: string;
  base64?: string;
  lixeira?: boolean;
}

/** Drive na memória: pastas e arquivos com pai, como o serviço do script enxerga. */
function driveFalso() {
  const itens: Item[] = [];
  let proximo = 0;
  const servico: ServicoDeAudios = {
    procurar(nome, paiId, tipo) {
      return itens
        .filter((i) => i.nome === nome && i.pai === paiId && i.pasta === (tipo === 'pasta') && !i.lixeira)
        .map((i) => ({ id: i.id }));
    },
    criarPasta(nome, paiId) {
      proximo += 1;
      itens.push({ id: `item-${proximo}`, nome, pai: paiId, pasta: true });
      return `item-${proximo}`;
    },
    criarArquivo(nome, mime, paiId, base64) {
      proximo += 1;
      itens.push({ id: `item-${proximo}`, nome, pai: paiId, pasta: false, mime, base64 });
      return `item-${proximo}`;
    },
    // Como o Drive de verdade: só olha arquivo (não pasta) que está direto dentro de `paiId`; o tamanho vem dos metadados.
    inspecionar(arquivoId, paiId) {
      const item = itens.find((i) => i.id === arquivoId);
      if (!item || item.pasta || item.pai !== paiId || item.lixeira) return null;
      return { mime: item.mime ?? '', bytes: Math.floor(((item.base64 ?? '').length * 3) / 4) };
    },
    baixar(arquivoId) {
      return itens.find((i) => i.id === arquivoId)?.base64 ?? '';
    },
    lixeira(arquivoId) {
      const item = itens.find((i) => i.id === arquivoId);
      if (item) item.lixeira = true;
    },
  };
  return { itens, servico };
}

const pedido = (extra: Record<string, unknown> = {}) => ({ id: 'audio-1', base64: BASE64, mime: 'audio/webm', ...extra });

describe('salvarAudio', () => {
  it('salvarAudio grava em Central/Audios e devolve driveId', () => {
    const drive = driveFalso();
    const resposta = salvarAudio(pedido(), drive.servico);
    const central = drive.itens.find((i) => i.nome === 'Central' && i.pasta)!;
    const audios = drive.itens.find((i) => i.nome === 'Audios' && i.pasta)!;
    expect(central.pai).toBe('root');
    expect(audios.pai).toBe(central.id);
    const arquivo = drive.itens.find((i) => !i.pasta)!;
    expect(arquivo.pai).toBe(audios.id);
    expect(arquivo.mime).toBe('audio/webm');
    expect(arquivo.base64).toBe(BASE64);
    expect(resposta).toEqual({ ok: true, driveId: arquivo.id });
  });

  it('repetir o mesmo id não cria segundo arquivo', () => {
    const drive = driveFalso();
    const a = salvarAudio(pedido(), drive.servico);
    const b = salvarAudio(pedido(), drive.servico);
    expect(b).toEqual(a);
    expect(drive.itens.filter((i) => !i.pasta)).toHaveLength(1);
    expect(drive.itens.filter((i) => i.pasta)).toHaveLength(2);
  });

  it('ids diferentes criam arquivos diferentes na mesma pasta', () => {
    const drive = driveFalso();
    salvarAudio(pedido({ id: 'a1' }), drive.servico);
    salvarAudio(pedido({ id: 'a2' }), drive.servico);
    expect(drive.itens.filter((i) => !i.pasta)).toHaveLength(2);
    expect(drive.itens.filter((i) => i.pasta)).toHaveLength(2);
  });

  it('recusa mime text/html', () => {
    const drive = driveFalso();
    expect(salvarAudio(pedido({ mime: 'text/html' }), drive.servico)).toEqual({ ok: false, erro: 'mime_invalido' });
    expect(drive.itens).toHaveLength(0);
  });

  it.each(['audio/webm', 'audio/ogg', 'audio/mp4'])('aceita %s', (mime) => {
    expect(salvarAudio(pedido({ mime }), driveFalso().servico).ok).toBe(true);
  });

  it('aceita mime com parâmetro de codec e grava o tipo sem ele', () => {
    const drive = driveFalso();
    expect(salvarAudio(pedido({ mime: 'audio/webm;codecs=opus' }), drive.servico).ok).toBe(true);
    expect(drive.itens.find((i) => !i.pasta)!.mime).toBe('audio/webm');
  });

  it('recusa base64 acima de 6 MB com erro grande_demais, sem criar nada', () => {
    const drive = driveFalso();
    const grande = 'A'.repeat(AUDIO_BASE64_NO_MAXIMO + 4);
    expect(salvarAudio(pedido({ base64: grande }), drive.servico)).toEqual({ ok: false, erro: 'grande_demais' });
    expect(drive.itens).toHaveLength(0);
  });

  it('aceita base64 exatamente no limite de 6 MB', () => {
    const noLimite = 'A'.repeat(AUDIO_BASE64_NO_MAXIMO);
    expect(salvarAudio(pedido({ base64: noLimite }), driveFalso().servico).ok).toBe(true);
  });

  it.each([
    ['id com barra', { id: '../x' }],
    ['id com espaço e ponto', { id: 'a b.webm' }],
    ['id vazio', { id: '' }],
    ['id longo demais', { id: 'a'.repeat(65) }],
    ['id que não é texto', { id: 7 }],
    ['id com aspa', { id: "x' or name contains '" }],
    ['base64 vazio', { base64: '' }],
    ['base64 com caracteres fora do alfabeto', { base64: 'abc<script>' }],
    ['base64 que não é texto', { base64: 12 }],
    ['mime que não é texto', { mime: null }],
  ])('pedido inválido (%s) lança PedidoInvalido e não toca o Drive', (_nome, extra) => {
    const drive = driveFalso();
    expect(() => salvarAudio(pedido(extra), drive.servico)).toThrow(PedidoInvalido);
    expect(drive.itens).toHaveLength(0);
  });

  it('arquivo comum chamado Central não vale como pasta: cria a pasta de verdade', () => {
    const drive = driveFalso();
    drive.servico.criarArquivo('Central', 'audio/webm', 'root', BASE64);
    salvarAudio(pedido(), drive.servico);
    expect(drive.itens.filter((i) => i.pasta && i.nome === 'Central')).toHaveLength(1);
  });

  it('duas pastas Central: lança erro e não grava', () => {
    const drive = driveFalso();
    drive.servico.criarPasta('Central', 'root');
    drive.servico.criarPasta('Central', 'root');
    const antes = drive.itens.length;
    expect(() => salvarAudio(pedido(), drive.servico)).toThrow(/mais de um/i);
    expect(drive.itens).toHaveLength(antes);
  });

  it('dois arquivos com o nome do áudio: devolve o primeiro, sem criar outro nem lançar erro', () => {
    const drive = driveFalso();
    const primeiro = salvarAudio(pedido(), drive.servico);
    const audios = drive.itens.find((i) => i.nome === 'Audios')!;
    drive.servico.criarArquivo('audio-audio-1.webm', 'audio/webm', audios.id, BASE64);
    const antes = drive.itens.length;
    expect(salvarAudio(pedido(), drive.servico)).toEqual(primeiro);
    expect(drive.itens).toHaveLength(antes);
  });

  it('base64 com tamanho que não é múltiplo de 4 lança PedidoInvalido', () => {
    expect(() => salvarAudio(pedido({ base64: 'QUJDR' }), driveFalso().servico)).toThrow(PedidoInvalido);
  });

  it('pedido que não é objeto lança PedidoInvalido', () => {
    expect(() => salvarAudio(null, driveFalso().servico)).toThrow(PedidoInvalido);
    expect(() => salvarAudio('texto', driveFalso().servico)).toThrow(PedidoInvalido);
  });

  it('o nome do arquivo no Drive é seguro: só vem do id validado e de extensão fixa', () => {
    const drive = driveFalso();
    salvarAudio(pedido({ id: 'Ab_9-z', mime: 'audio/ogg' }), drive.servico);
    expect(drive.itens.find((i) => !i.pasta)!.nome).toBe('audio-Ab_9-z.ogg');
  });
});

describe('ação salvarAudio na API', () => {
  function montar(): { amb: Ambiente; drive: ReturnType<typeof driveFalso> } {
    const drive = driveFalso();
    return { amb: { lerCodigo: () => CODIGO, armazem: armazemNaMemoria(), audios: () => drive.servico }, drive };
  }

  it('responde ok com o driveId', () => {
    const { amb, drive } = montar();
    const r = tratar({ codigo: CODIGO, acao: 'salvarAudio', dados: pedido() }, amb);
    expect(r).toEqual({ ok: true, dados: { ok: true, driveId: drive.itens.find((i) => !i.pasta)!.id } });
  });

  it('recusa de mime volta como dados ok:false, não como erro do script', () => {
    const { amb } = montar();
    const r = tratar({ codigo: CODIGO, acao: 'salvarAudio', dados: pedido({ mime: 'text/html' }) }, amb);
    expect(r).toEqual({ ok: true, dados: { ok: false, erro: 'mime_invalido' } });
  });

  it('sem código válido, recusa e não grava', () => {
    const { amb, drive } = montar();
    expect(tratar({ codigo: 'errado', acao: 'salvarAudio', dados: pedido() }, amb)).toEqual({ ok: false, erro: 'codigo-invalido' });
    expect(drive.itens).toHaveLength(0);
  });

  it('sem o serviço do Drive, dá interno', () => {
    const amb: Ambiente = { lerCodigo: () => CODIGO, armazem: armazemNaMemoria() };
    expect(tratar({ codigo: CODIGO, acao: 'salvarAudio', dados: pedido() }, amb)).toEqual({ ok: false, erro: 'interno' });
  });

  it('pedido inválido dá interno', () => {
    const { amb } = montar();
    expect(tratar({ codigo: CODIGO, acao: 'salvarAudio', dados: pedido({ id: '../x' }) }, amb)).toEqual({ ok: false, erro: 'interno' });
  });

  const corpoDeAudio = (codigo: string, base64: string) => montarCorpoDeAudio(codigo, pedido({ base64 }));
  const grande = 'A'.repeat(1024 * 1024);

  afterEach(() => vi.restoreAllMocks());

  it('corpo grande de áudio com o código certo passa do limite geral de 256 KB', () => {
    const { amb } = montar();
    expect(tratarCorpo(corpoDeAudio(CODIGO, grande), amb)).toMatchObject({ ok: true });
  });

  it('montarCorpoDeAudio põe codigo e acao no começo, na ordem que o limite maior exige', () => {
    expect(corpoDeAudio(CODIGO, BASE64).startsWith(`{"codigo":"${CODIGO}","acao":"salvarAudio","dados":`)).toBe(true);
  });

  it('corpo grande de áudio com código errado é recusado sem JSON.parse', () => {
    const { amb, drive } = montar();
    const parse = vi.spyOn(JSON, 'parse');
    expect(tratarCorpo(corpoDeAudio('errado-0123456789', grande), amb)).toEqual({ ok: false, erro: 'codigo-invalido' });
    expect(parse).not.toHaveBeenCalled();
    expect(drive.itens).toHaveLength(0);
  });

  it('corpo grande que só cita salvarAudio no meio (outra ação) é recusado sem JSON.parse', () => {
    const { amb } = montar();
    const parse = vi.spyOn(JSON, 'parse');
    const corpo = JSON.stringify({ codigo: CODIGO, acao: 'ping', dados: { lixo: grande, x: '"salvarAudio"' } });
    expect(tratarCorpo(corpo, amb)).toEqual({ ok: false, erro: 'interno' });
    expect(parse).not.toHaveBeenCalled();
  });

  it('corpo grande de outra ação com o código certo continua limitado a 256 KB', () => {
    const { amb } = montar();
    const outra = JSON.stringify({ codigo: CODIGO, acao: 'ping', dados: { lixo: grande } });
    expect(tratarCorpo(outra, amb)).toEqual({ ok: false, erro: 'interno' });
  });

  it('corpo de áudio muito acima de 6 MB é recusado antes de qualquer trabalho', () => {
    const { amb, drive } = montar();
    const enorme = 'A'.repeat(AUDIO_BASE64_NO_MAXIMO + 1024 * 1024);
    expect(tratarCorpo(corpoDeAudio(CODIGO, enorme), amb)).toEqual({ ok: false, erro: 'interno' });
    expect(drive.itens).toHaveLength(0);
  });
});

describe('lerAudio', () => {
  it('lê pelo id do áudio: devolve base64 e mime do arquivo de Central/Audios', () => {
    const drive = driveFalso();
    salvarAudio(pedido({ id: 'ideia-7', mime: 'audio/ogg' }), drive.servico);
    expect(lerAudio({ id: 'ideia-7' }, drive.servico)).toEqual({ ok: true, base64: BASE64, mime: 'audio/ogg' });
  });

  it('sem a pasta Central/Audios devolve nao_encontrado e não cria nada', () => {
    const drive = driveFalso();
    expect(lerAudio({ id: 'a1' }, drive.servico)).toEqual({ ok: false, erro: 'nao_encontrado' });
    expect(drive.itens).toHaveLength(0);
  });

  it('id que não tem arquivo devolve nao_encontrado', () => {
    const drive = driveFalso();
    salvarAudio(pedido({ id: 'a1' }), drive.servico);
    expect(lerAudio({ id: 'outro' }, drive.servico)).toEqual({ ok: false, erro: 'nao_encontrado' });
  });

  it('recusa arquivo do Drive fora da pasta Central/Audios (na raiz ou em outra pasta)', () => {
    const drive = driveFalso();
    salvarAudio(pedido({ id: 'dentro' }), drive.servico);
    drive.servico.criarArquivo('audio-naraiz.webm', 'audio/webm', 'root', BASE64);
    const outraPasta = drive.servico.criarPasta('Outra', 'root');
    drive.servico.criarArquivo('audio-emoutra.webm', 'audio/webm', outraPasta, BASE64);
    for (const id of ['naraiz', 'emoutra']) {
      expect(lerAudio({ id }, drive.servico)).toEqual({ ok: false, erro: 'nao_encontrado' });
    }
  });

  it('não serve arquivo que não é áudio, mesmo dentro de Central/Audios', () => {
    const drive = driveFalso();
    salvarAudio(pedido(), drive.servico);
    const audios = drive.itens.find((i) => i.nome === 'Audios')!;
    drive.servico.criarArquivo('audio-texto.webm', 'text/plain', audios.id, BASE64);
    expect(lerAudio({ id: 'texto' }, drive.servico)).toEqual({ ok: false, erro: 'nao_encontrado' });
  });

  it('arquivo grande demais devolve grande_demais ANTES de baixar', () => {
    const drive = driveFalso();
    salvarAudio(pedido(), drive.servico);
    const audios = drive.itens.find((i) => i.nome === 'Audios')!;
    drive.servico.criarArquivo('audio-g.webm', 'audio/webm', audios.id, 'A'.repeat(AUDIO_BASE64_NO_MAXIMO + 4));
    const baixar = vi.spyOn(drive.servico, 'baixar');
    expect(lerAudio({ id: 'g' }, drive.servico)).toEqual({ ok: false, erro: 'grande_demais' });
    expect(baixar).not.toHaveBeenCalled();
  });

  it('arquivo com mime fora de audio/webm, ogg e mp4 é recusado ANTES de baixar', () => {
    const drive = driveFalso();
    salvarAudio(pedido(), drive.servico);
    const audios = drive.itens.find((i) => i.nome === 'Audios')!;
    const baixar = vi.spyOn(drive.servico, 'baixar');
    for (const [n, mime] of ['text/html', 'application/pdf', 'audio/wav', 'audio/webmx', ''].entries()) {
      drive.servico.criarArquivo(`audio-m${n}.webm`, mime, audios.id, BASE64);
      expect(lerAudio({ id: `m${n}` }, drive.servico)).toEqual({ ok: false, erro: 'nao_encontrado' });
    }
    expect(baixar).not.toHaveBeenCalled();
  });

  it('arquivo no limite de tamanho ainda é lido', () => {
    const drive = driveFalso();
    salvarAudio(pedido(), drive.servico);
    const audios = drive.itens.find((i) => i.nome === 'Audios')!;
    drive.servico.criarArquivo('audio-l.webm', 'audio/webm', audios.id, 'A'.repeat(AUDIO_BASE64_NO_MAXIMO));
    expect(lerAudio({ id: 'l' }, drive.servico)).toMatchObject({ ok: true });
  });

  it.each([
    ['sem id', {}],
    ['só driveId (não existe mais)', { driveId: 'x1' }],
    ['id com barra', { id: '../x' }],
    ['id com aspa', { id: "x' or name contains '" }],
    ['id que não é texto', { id: 7 }],
    ['id longo demais', { id: 'a'.repeat(65) }],
  ])('pedido inválido (%s) lança PedidoInvalido e não toca o Drive', (_nome, dados) => {
    const drive = driveFalso();
    const ler = vi.spyOn(drive.servico, 'inspecionar');
    const procurar = vi.spyOn(drive.servico, 'procurar');
    expect(() => lerAudio(dados, drive.servico)).toThrow(PedidoInvalido);
    expect(ler).not.toHaveBeenCalled();
    expect(procurar).not.toHaveBeenCalled();
  });

  it('pedido que não é objeto lança PedidoInvalido', () => {
    expect(() => lerAudio(null, driveFalso().servico)).toThrow(PedidoInvalido);
    expect(() => lerAudio('texto', driveFalso().servico)).toThrow(PedidoInvalido);
  });
});

describe('ação lerAudio na API', () => {
  function montar(): { amb: Ambiente; drive: ReturnType<typeof driveFalso> } {
    const drive = driveFalso();
    return { amb: { lerCodigo: () => CODIGO, armazem: armazemNaMemoria(), audios: () => drive.servico }, drive };
  }

  it('responde ok com base64 e mime', () => {
    const { amb } = montar();
    tratar({ codigo: CODIGO, acao: 'salvarAudio', dados: pedido({ id: 'a1' }) }, amb);
    expect(tratar({ codigo: CODIGO, acao: 'lerAudio', dados: { id: 'a1' } }, amb)).toEqual({
      ok: true,
      dados: { ok: true, base64: BASE64, mime: 'audio/webm' },
    });
  });

  it('arquivo fora da pasta volta como dados ok:false', () => {
    const { amb, drive } = montar();
    drive.servico.criarArquivo('audio-fora.webm', 'audio/webm', 'root', BASE64);
    expect(tratar({ codigo: CODIGO, acao: 'lerAudio', dados: { id: 'fora' } }, amb)).toEqual({
      ok: true,
      dados: { ok: false, erro: 'nao_encontrado' },
    });
  });

  it('sem código válido, recusa', () => {
    const { amb } = montar();
    expect(tratar({ codigo: 'errado', acao: 'lerAudio', dados: { id: 'a1' } }, amb)).toEqual({ ok: false, erro: 'codigo-invalido' });
  });

  it('sem o serviço do Drive, dá interno; pedido inválido dá interno', () => {
    const sem: Ambiente = { lerCodigo: () => CODIGO, armazem: armazemNaMemoria() };
    expect(tratar({ codigo: CODIGO, acao: 'lerAudio', dados: { id: 'a1' } }, sem)).toEqual({ ok: false, erro: 'interno' });
    expect(tratar({ codigo: CODIGO, acao: 'lerAudio', dados: { id: '../x' } }, montar().amb)).toEqual({ ok: false, erro: 'interno' });
  });
});

describe('apagarAudio', () => {
  it('manda para a lixeira só o audio-<id>.* de Central/Audios e responde quantos', () => {
    const drive = driveFalso();
    salvarAudio(pedido({ id: 'a1' }), drive.servico);
    salvarAudio(pedido({ id: 'a2', mime: 'audio/ogg' }), drive.servico);
    expect(apagarAudio({ id: 'a1' }, drive.servico)).toEqual({ ok: true, apagados: 1 });
    const arquivos = drive.itens.filter((i) => !i.pasta);
    expect(arquivos.find((i) => i.nome === 'audio-a1.webm')!.lixeira).toBe(true);
    expect(arquivos.find((i) => i.nome === 'audio-a2.ogg')!.lixeira).toBeUndefined();
    // Repetir é seguro: já está na lixeira.
    expect(apagarAudio({ id: 'a1' }, drive.servico)).toEqual({ ok: true, apagados: 0 });
  });

  it('não toca arquivo fora de Central/Audios nem com outro nome, nem pasta', () => {
    const drive = driveFalso();
    salvarAudio(pedido({ id: 'a1' }), drive.servico);
    drive.servico.criarArquivo('audio-x.webm', 'audio/webm', 'root', BASE64);
    const outra = drive.servico.criarPasta('Outra', 'root');
    drive.servico.criarArquivo('audio-x.webm', 'audio/webm', outra, BASE64);
    const audios = drive.itens.find((i) => i.nome === 'Audios')!;
    drive.servico.criarArquivo('notas.txt', 'text/plain', audios.id, BASE64);
    expect(apagarAudio({ id: 'x' }, drive.servico)).toEqual({ ok: true, apagados: 0 });
    for (const item of drive.itens) expect(item.lixeira).toBeUndefined();
  });

  it('sem a pasta Central/Audios não cria nada e responde 0', () => {
    const drive = driveFalso();
    expect(apagarAudio({ id: 'a1' }, drive.servico)).toEqual({ ok: true, apagados: 0 });
    expect(drive.itens).toHaveLength(0);
  });

  it('arquivo que o dono não tem (inspecionar nega) não vai para a lixeira', () => {
    const drive = driveFalso();
    salvarAudio(pedido({ id: 'a1' }), drive.servico);
    vi.spyOn(drive.servico, 'inspecionar').mockReturnValue(null);
    const lixeira = vi.spyOn(drive.servico, 'lixeira');
    expect(apagarAudio({ id: 'a1' }, drive.servico)).toEqual({ ok: true, apagados: 0 });
    expect(lixeira).not.toHaveBeenCalled();
  });

  it.each([
    ['sem id', {}],
    ['id com barra', { id: '../x' }],
    ['id com aspa', { id: "x' or name contains '" }],
    ['id que não é texto', { id: 7 }],
    ['driveId no lugar do id', { driveId: 'abc' }],
  ])('pedido inválido (%s) lança PedidoInvalido e não toca o Drive', (_nome, dados) => {
    const drive = driveFalso();
    const procurar = vi.spyOn(drive.servico, 'procurar');
    const lixeira = vi.spyOn(drive.servico, 'lixeira');
    expect(() => apagarAudio(dados, drive.servico)).toThrow(PedidoInvalido);
    expect(procurar).not.toHaveBeenCalled();
    expect(lixeira).not.toHaveBeenCalled();
  });

  it('pedido que não é objeto lança PedidoInvalido', () => {
    expect(() => apagarAudio(null, driveFalso().servico)).toThrow(PedidoInvalido);
  });

  it('ação apagarAudio na API: exige código, usa o serviço do Drive e responde ok', () => {
    const drive = driveFalso();
    const amb: Ambiente = { lerCodigo: () => CODIGO, armazem: armazemNaMemoria(), audios: () => drive.servico };
    salvarAudio(pedido({ id: 'a1' }), drive.servico);
    expect(tratar({ codigo: 'errado', acao: 'apagarAudio', dados: { id: 'a1' } }, amb)).toEqual({ ok: false, erro: 'codigo-invalido' });
    expect(drive.itens.find((i) => !i.pasta)!.lixeira).toBeUndefined();
    expect(tratar({ codigo: CODIGO, acao: 'apagarAudio', dados: { id: 'a1' } }, amb)).toEqual({ ok: true, dados: { ok: true, apagados: 1 } });
    expect(drive.itens.find((i) => !i.pasta)!.lixeira).toBe(true);
  });
});
