import { useState } from 'preact/hooks';
import type { ErroDoScript } from '../../script/api';
import { ErroConexao, ErroScript, ping } from '../conexao/cliente';
import { enderecoAceito, salvarConexao } from '../conexao/guarda';

const TOQUE_MINIMO = { minHeight: '44px' };

const MENSAGEM_DO_SCRIPT: Record<ErroDoScript, string> = {
  'codigo-invalido': 'Código incorreto. Confira o código e tente de novo.',
  ocupado: 'O script está ocupado. Tente de novo em instantes.',
  interno: 'O script teve um problema. Tente de novo em instantes.',
};

export function formatarTempo(ms: number): string {
  const segundos = (ms / 1000).toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return `${segundos} s`;
}

function mensagemDe(erro: unknown): string {
  if (erro instanceof ErroScript) return MENSAGEM_DO_SCRIPT[erro.erro];
  if (erro instanceof ErroConexao) {
    return 'Sem conexão com o script. Confira a internet e a URL e tente de novo.';
  }
  return 'O script respondeu, mas não consegui salvar neste aparelho.';
}

export function Conectar() {
  const [url, setUrl] = useState('');
  const [codigo, setCodigo] = useState('');
  const [mostrarCodigo, setMostrarCodigo] = useState(false);
  const [testando, setTestando] = useState(false);
  const [situacao, setSituacao] = useState('');

  // O cast é só para os tipos do Preact, que não aceitam um type que alterna.
  const tipoDoCodigo = (mostrarCodigo ? 'text' : 'password') as 'text';

  async function testarESalvar(evento: Event) {
    evento.preventDefault();
    const conexao = { url: url.trim(), codigo: codigo.trim() };
    if (!enderecoAceito(conexao.url)) {
      setSituacao('A URL precisa começar com https://script.google.com/');
      return;
    }
    setTestando(true);
    setSituacao('Testando…');
    try {
      const tempo = await ping(conexao);
      await salvarConexao(conexao);
      setSituacao(`Conectado em ${formatarTempo(tempo)}`);
    } catch (erro) {
      setSituacao(mensagemDe(erro));
    } finally {
      setTestando(false);
    }
  }

  return (
    <main>
      <h1>Conectar aparelho</h1>
      <form onSubmit={testarESalvar}>
        <p>
          <label for="conectar-url">URL</label>
          <br />
          <input
            id="conectar-url"
            type="url"
            required
            autocomplete="off"
            style={TOQUE_MINIMO}
            value={url}
            onInput={(e) => setUrl(e.currentTarget.value)}
          />
        </p>
        <p>
          <label for="conectar-codigo">Código do aparelho</label>
          <br />
          <input
            id="conectar-codigo"
            type={tipoDoCodigo}
            required
            autocomplete="off"
            style={TOQUE_MINIMO}
            value={codigo}
            onInput={(e) => setCodigo(e.currentTarget.value)}
          />
        </p>
        <p>
          <label style={{ ...TOQUE_MINIMO, display: 'inline-flex', alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={mostrarCodigo}
              onChange={(e) => setMostrarCodigo(e.currentTarget.checked)}
            />
            Mostrar código
          </label>
        </p>
        <button type="submit" disabled={testando} style={TOQUE_MINIMO}>
          Testar e salvar
        </button>
      </form>
      <p role="status" aria-live="polite">
        {situacao}
      </p>
    </main>
  );
}
