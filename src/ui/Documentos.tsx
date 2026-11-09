// Caixa de documentos de uma sala ou de uma pessoa. A Tarefa 18 traz a caixa de
// verdade (links, título, ícone por tipo); até lá a seção existe, vazia, no
// lugar onde ela vai ficar.
import './salas.css';

type Props = {
  /** Quem é o dono da caixa, em palavras: "desta sala" ou "de Marina". */
  de: string;
  salaId?: string;
  pessoaId?: string;
};

export function Documentos({ de }: Props) {
  return (
    <section class="painel documentos" aria-labelledby="titulo-documentos">
      <h2 id="titulo-documentos">Documentos</h2>
      <p class="lista-vazia-titulo">Nenhum documento ainda.</p>
      <p class="lista-vazia-texto">{`Os links dos arquivos ${de} vão ficar aqui. Esta caixa chega numa próxima versão.`}</p>
    </section>
  );
}
