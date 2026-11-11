// Cópia de segurança (Tarefa 23): baixa todos os dados deste aparelho num arquivo
// e devolve os dados a partir de um desses arquivos. Fica em "Conectar aparelho",
// junto dos outros ajustes do aparelho.
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  TAMANHO_MAXIMO_DA_COPIA,
  lerCopia,
  montarCopia,
  nomeDoArquivoDaCopia,
  restaurarCopia,
  resumoDaCopia,
  type Copia,
} from '../dados/exportar';

/** Entrega o arquivo ao navegador (baixa). */
export function baixarArquivo(nome: string, texto: string): void {
  const url = URL.createObjectURL(new Blob([texto], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = nome;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const total = (copia: Copia) => Object.values(copia.colecoes).reduce((soma, lista) => soma + lista.length, 0);
const itens = (n: number) => (n === 1 ? '1 item' : `${n} itens`);

/** A cópia lida, esperando o dono confirmar. */
type AConfirmar = { copia: Copia; itens: number; dia: string };

export function Exportar({ baixar = baixarArquivo }: { baixar?: (nome: string, texto: string) => void }) {
  const [situacao, setSituacao] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [aConfirmar, setAConfirmar] = useState<AConfirmar | null>(null);
  const arquivo = useRef<HTMLInputElement>(null);
  const cancelar = useRef<HTMLButtonElement>(null);

  // A pergunta aparece no lugar do que o dono acabou de fazer: o foco vai para o botão seguro dela.
  useEffect(() => {
    if (aConfirmar) cancelar.current?.focus();
  }, [aConfirmar]);

  const devolverFoco = () => arquivo.current?.focus();

  async function exportar() {
    setOcupado(true);
    try {
      const copia = await montarCopia();
      const nome = nomeDoArquivoDaCopia();
      baixar(nome, JSON.stringify(copia, null, 2));
      setSituacao(`Cópia baixada: ${nome}, com ${itens(total(copia))}.`);
    } catch {
      setSituacao('Não consegui montar a cópia. Tente de novo.');
    } finally {
      setOcupado(false);
    }
  }

  /** Lê o arquivo escolhido (sem restaurar nada ainda) e pede a confirmação. */
  async function escolher(escolhido: File | undefined) {
    setAConfirmar(null);
    if (!escolhido) return;
    // O tamanho se confere antes de ler: arquivo enorme nem entra na memória.
    if (escolhido.size > TAMANHO_MAXIMO_DA_COPIA) {
      setSituacao('Esse arquivo é grande demais para ser uma cópia da Central (o limite é 5 MB). Escolha o arquivo baixado por este botão.');
      if (arquivo.current) arquivo.current.value = '';
      return;
    }
    setOcupado(true);
    try {
      const copia = lerCopia(await escolhido.text());
      if (!copia) {
        setSituacao('Esse arquivo não é uma cópia da Central. Escolha um arquivo baixado por este botão.');
        if (arquivo.current) arquivo.current.value = '';
        return;
      }
      const { itens: quantos, dia } = resumoDaCopia(copia);
      setSituacao('');
      setAConfirmar({ copia, itens: quantos, dia });
    } catch {
      setSituacao('Não consegui ler esse arquivo. Tente de novo.');
    } finally {
      setOcupado(false);
    }
  }

  async function restaurar(pedida: AConfirmar) {
    setAConfirmar(null);
    setOcupado(true);
    try {
      const { restaurados, recusados } = await restaurarCopia(pedida.copia);
      setSituacao(
        `Cópia restaurada: ${restaurados === 1 ? '1 item devolvido' : `${restaurados} itens devolvidos`}` +
          (recusados > 0 ? ` e ${recusados} fora do formato, não restaurados.` : '.'),
      );
    } catch {
      setSituacao('Não consegui restaurar a cópia. Tente de novo.');
    } finally {
      setOcupado(false);
      if (arquivo.current) arquivo.current.value = '';
      // Fica no campo do arquivo: o botão em que o dono tocou saiu da tela.
      queueMicrotask(devolverFoco);
    }
  }

  function desistir() {
    setAConfirmar(null);
    setSituacao('Restauração cancelada. Nada foi mudado.');
    if (arquivo.current) arquivo.current.value = '';
    queueMicrotask(devolverFoco);
  }

  return (
    <section class="painel exportar" aria-labelledby="titulo-exportar">
      <h2 id="titulo-exportar">Cópia de segurança</h2>
      <p class="exportar-nota">
        Baixa tudo o que está neste aparelho (tarefas, salas, pessoas, caderno, água e o resto, com os e-mails de contato das pessoas) num
        arquivo. A cópia não leva a conexão, o código de acesso nem as mensagens do Gmail.
      </p>
      <button type="button" class="botao" disabled={ocupado} onClick={() => void exportar()}>
        Baixar cópia dos dados
      </button>
      <p class="exportar-nota exportar-restaurar">
        <label for="exportar-arquivo">Restaurar a partir de uma cópia</label>
      </p>
      <input
        id="exportar-arquivo"
        ref={arquivo}
        class="campo"
        type="file"
        accept=".json,application/json"
        disabled={ocupado}
        onChange={(e) => void escolher(e.currentTarget.files?.[0])}
      />
      {aConfirmar && (
        <div class="exportar-confirma" role="group" aria-labelledby="exportar-pergunta">
          <p id="exportar-pergunta">
            Vai devolver {itens(aConfirmar.itens)} da cópia de {aConfirmar.dia}; o que mudou depois volta como estava. As configurações
            e o que foi feito no Google não mudam.
          </p>
          <div class="exportar-confirma-acoes">
            <button type="button" class="botao primario" onClick={() => void restaurar(aConfirmar)}>
              Restaurar
            </button>
            <button type="button" class="botao" ref={cancelar} onClick={desistir}>
              Cancelar
            </button>
          </div>
        </div>
      )}
      <p role="status" aria-live="polite">
        {situacao}
      </p>
    </section>
  );
}
