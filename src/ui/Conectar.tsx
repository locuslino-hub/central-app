import { useState } from 'preact/hooks';
import type { ErroDoScript } from '../../script/api';
import { ErroConexao, ErroScript, ping } from '../conexao/cliente';
import { enderecoAceito, lerConexao, salvarConexao } from '../conexao/guarda';

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
  const [aConfirmar, setAConfirmar] = useState(false);

  // O cast é só para os tipos do Preact, que não aceitam um type que alterna.
  const tipoDoCodigo = (mostrarCodigo ? 'text' : 'password') as 'text';

  function mudarUrl(valor: string) {
    setUrl(valor);
    if (aConfirmar) {
      setAConfirmar(false);
      setSituacao('');
    }
  }

  async function testarESalvar(confirmado: boolean) {
    const conexao = { url: url.trim(), codigo: codigo.trim() };
    if (!enderecoAceito(conexao.url)) {
      setSituacao('A URL precisa ser a do app da Web: https://script.google.com/macros/s/…/exec');
      return;
    }
    setAConfirmar(false);
    setTestando(true);
    setSituacao('Testando…');
    try {
      // O ping já envia o código, então a confirmação vem antes dele.
      const salva = await lerConexao().catch(() => null);
      if (salva && salva.url !== conexao.url && !confirmado) {
        setSituacao(
          `Este aparelho já está conectado a ${salva.url}. ` +
            'Substituir envia o código para a nova URL. Confirme só se ela for do seu script.',
        );
        setAConfirmar(true);
        return;
      }
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
    <section class="painel conectar">
      <h1>Conectar aparelho</h1>
      <form
        onSubmit={(evento) => {
          evento.preventDefault();
          void testarESalvar(false);
        }}
      >
        <p>
          <label for="conectar-url">URL</label>
          <br />
          <input
            id="conectar-url"
            class="campo"
            type="url"
            required
            autocomplete="off"
            style={TOQUE_MINIMO}
            value={url}
            onInput={(e) => mudarUrl(e.currentTarget.value)}
          />
        </p>
        <p>
          <label for="conectar-codigo">Código do aparelho</label>
          <br />
          <input
            id="conectar-codigo"
            class="campo"
            type={tipoDoCodigo}
            required
            autocomplete="new-password"
            spellcheck={false}
            autocapitalize="none"
            // Com C maiúsculo o Preact grava o atributo autocorrect="off". Em minúsculas
            // ele usaria a propriedade booleana, onde o texto 'off' valeria true.
            autoCorrect="off"
            style={TOQUE_MINIMO}
            value={codigo}
            onInput={(e) => setCodigo(e.currentTarget.value)}
          />
        </p>
        <p>
          <label style={{ ...TOQUE_MINIMO, display: 'inline-flex', alignItems: 'center' }}>
            <input
              class="caixa"
              type="checkbox"
              checked={mostrarCodigo}
              onChange={(e) => setMostrarCodigo(e.currentTarget.checked)}
            />
            Mostrar código
          </label>
        </p>
        <button type="submit" class="botao primario" disabled={testando} style={TOQUE_MINIMO}>
          Testar e salvar
        </button>
      </form>
      <p role="status" aria-live="polite">
        {situacao}
      </p>
      {aConfirmar && (
        <button type="button" class="botao" style={TOQUE_MINIMO} onClick={() => void testarESalvar(true)}>
          Substituir conexão
        </button>
      )}
    </section>
  );
}
