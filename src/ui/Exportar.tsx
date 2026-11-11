// Cópia de segurança (Tarefa 23): baixa todos os dados deste aparelho num arquivo
// e devolve os dados a partir de um desses arquivos. Fica em "Conectar aparelho",
// junto dos outros ajustes do aparelho.
import { useRef, useState } from 'preact/hooks';
import { lerCopia, montarCopia, nomeDoArquivoDaCopia, restaurarCopia, type Copia } from '../dados/exportar';

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

export function Exportar({ baixar = baixarArquivo }: { baixar?: (nome: string, texto: string) => void }) {
  const [situacao, setSituacao] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const botao = useRef<HTMLButtonElement>(null);
  const arquivo = useRef<HTMLInputElement>(null);

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

  async function restaurar(escolhido: File | undefined) {
    if (!escolhido) return;
    setOcupado(true);
    try {
      const copia = lerCopia(await escolhido.text());
      if (!copia) {
        setSituacao('Esse arquivo não é uma cópia da Central. Escolha um arquivo baixado por este botão.');
        return;
      }
      const { restaurados, recusados } = await restaurarCopia(copia);
      setSituacao(
        `Cópia restaurada: ${restaurados === 1 ? '1 item devolvido' : `${restaurados} itens devolvidos`}` +
          (recusados > 0 ? ` e ${recusados} fora do formato, não restaurados.` : '.'),
      );
    } catch {
      setSituacao('Não consegui ler esse arquivo. Tente de novo.');
    } finally {
      setOcupado(false);
      if (arquivo.current) arquivo.current.value = '';
      // O foco fica no botão da ação, não se perde com o arquivo escolhido.
      botao.current?.focus();
    }
  }

  return (
    <section class="painel exportar" aria-labelledby="titulo-exportar">
      <h2 id="titulo-exportar">Cópia de segurança</h2>
      <p class="exportar-nota">
        Baixa tudo o que está neste aparelho (tarefas, salas, pessoas, caderno, água e o resto) num arquivo. A cópia não leva o código do
        aparelho nem os e-mails.
      </p>
      <button type="button" class="botao" ref={botao} disabled={ocupado} onClick={() => void exportar()}>
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
        onChange={(e) => void restaurar(e.currentTarget.files?.[0])}
      />
      <p role="status" aria-live="polite">
        {situacao}
      </p>
    </section>
  );
}
