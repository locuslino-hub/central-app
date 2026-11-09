// IA local (Tarefa 21): onde o dono baixa, acompanha e apaga o modelo deste
// aparelho. Nada é baixado sem ele pedir aqui, e o tamanho aparece antes.
import { useEffect, useRef, useState } from 'preact/hooks';
import { ia as iaDoApp, type DetalhesIA, type IALocal } from '../ia/ia';
import { MODELO } from '../ia/modelo';
import './config-ia.css';

const gb = (bytes: number) => (bytes / 1e9).toFixed(1).replace('.', ',');
const TAMANHO = `cerca de ${Math.round(MODELO.tamanho / 1e9)} GB`;

export function textoDoProgresso(progresso: DetalhesIA['progresso']): string {
  if (!progresso || progresso.total <= 0) return 'Baixando: começando…';
  const porcento = Math.min(100, Math.floor((progresso.baixados / progresso.total) * 100));
  return `Baixando: ${gb(progresso.baixados)} de ${gb(progresso.total)} GB (${porcento}%)`;
}

const MOTIVOS: Record<NonNullable<DetalhesIA['motivo']>, string> = {
  'sem-suporte': 'Este aparelho ou navegador não consegue rodar a IA local. O chat continua com as regras e a memória.',
  'sem-espaco': `Falta espaço neste aparelho. Libere ${TAMANHO} e tente de novo.`,
  'sem-internet': 'O download parou por falta de internet. Tente de novo com Wi-Fi.',
  falhou: 'A IA não abriu neste aparelho. O chat continua com as regras e a memória.',
  desatualizado: 'Atualize o app para usar a IA.',
  cancelado: 'Download cancelado.',
};

type Confirmando = 'baixar' | 'apagar' | null;

export function ConfigIA({
  ia = iaDoApp,
  recarregar = () => window.location.reload(),
}: {
  ia?: IALocal;
  /** Abre a versão nova do app (troca nos testes). */
  recarregar?: () => void;
}) {
  const [detalhes, setDetalhes] = useState<DetalhesIA>(ia.detalhes());
  const [confirmando, setConfirmando] = useState<Confirmando>(null);
  const confirmar = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setDetalhes(ia.detalhes());
    return ia.assinar(() => setDetalhes(ia.detalhes()));
  }, [ia]);

  // A pergunta de confirmação aparece no lugar do botão: o foco vai para ela.
  useEffect(() => {
    if (confirmando) confirmar.current?.focus();
  }, [confirmando]);

  const { estado, motivo, progresso, persistente } = detalhes;

  function baixar() {
    setConfirmando(null);
    void ia.baixar();
  }

  /** Falha ao abrir: o modelo guardado é aberto de novo; só sem ele o app oferece baixar. */
  async function tentarDeNovo() {
    if (motivo === 'falhou' && (await ia.reabrir())) return;
    setConfirmando('baixar');
  }

  function apagar() {
    setConfirmando(null);
    void ia.apagar();
  }

  const perguntaDeBaixar = (
    <div class="acoes-config-ia">
      <p>Baixar {TAMANHO} agora? Use Wi-Fi.</p>
      <button type="button" class="botao primario" ref={confirmar} onClick={baixar}>
        Baixar agora
      </button>
      <button type="button" class="botao-texto" onClick={() => setConfirmando(null)}>
        Cancelar
      </button>
    </div>
  );

  function conteudo() {
    switch (estado) {
      case 'ausente':
        return confirmando === 'baixar' ? (
          perguntaDeBaixar
        ) : (
          <>
            <p>O modelo tem {TAMANHO} e fica guardado neste aparelho. Baixe uma vez, com Wi-Fi.</p>
            <button type="button" class="botao primario" onClick={() => setConfirmando('baixar')}>
              Baixar a IA
            </button>
          </>
        );
      case 'baixando':
        return (
          <>
            <progress
              class="progresso-ia"
              max={progresso?.total ?? 1}
              value={progresso?.baixados ?? 0}
              aria-label="Download da IA"
            />
            {/* Dentro da região viva, mas sem anunciar cada ponto percentual. */}
            <p aria-live="off">{textoDoProgresso(progresso)}</p>
            <p class="aviso">Pode usar o app enquanto isso.</p>
            <button type="button" class="botao" onClick={() => ia.cancelarDownload()}>
              Cancelar download
            </button>
          </>
        );
      case 'carregando':
        return <p>Abrindo a IA. O chat já funciona enquanto isso.</p>;
      case 'pronta':
        return (
          <>
            <p>A IA está pronta neste aparelho.</p>
            {confirmando === 'apagar' ? (
              <div class="acoes-config-ia">
                <p>Apagar a IA deste aparelho? Para usar de novo, será preciso baixar {TAMANHO}.</p>
                <button type="button" class="botao" ref={confirmar} onClick={apagar}>
                  Apagar
                </button>
                <button type="button" class="botao-texto" onClick={() => setConfirmando(null)}>
                  Cancelar
                </button>
              </div>
            ) : (
              <button type="button" class="botao" onClick={() => setConfirmando('apagar')}>
                Apagar a IA deste aparelho
              </button>
            )}
          </>
        );
      case 'indisponivel':
        return (
          <>
            <p>{MOTIVOS[motivo ?? 'falhou']}</p>
            {motivo === 'desatualizado' && (
              <button type="button" class="botao primario" onClick={recarregar}>
                Atualizar
              </button>
            )}
            {motivo !== 'sem-suporte' &&
              motivo !== 'desatualizado' &&
              (confirmando === 'baixar' ? (
                perguntaDeBaixar
              ) : (
                <button type="button" class="botao" onClick={() => void tentarDeNovo()}>
                  Tentar de novo
                </button>
              ))}
          </>
        );
    }
  }

  return (
    <section class="painel conectar config-ia">
      <h1>IA local</h1>
      <p>
        A IA ajuda o chat a entender frases longas e a escolher a sala. Ela roda só neste aparelho: as frases não
        saem dele.
      </p>
      <div aria-live="polite">{conteudo()}</div>
      {persistente === false && (
        <p class="aviso">
          O navegador não garantiu guardar o modelo de vez: ele pode apagar o modelo se faltar espaço no aparelho.
        </p>
      )}
    </section>
  );
}
