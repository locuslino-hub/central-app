// Triagem de e-mails (spec, seção 7, Agora): um e-mail de cada vez, do mais
// antigo ao mais novo, com as mesmas ações do Por responder (Responder, Virar
// tarefa, Agora não e Feito, todas com Desfazer). Entram só os que ainda não
// têm destino: o e-mail que virou tarefa já foi decidido.
import { nEmails } from './plural';
import { AvisoDeEmail, EstadoDosEmails, ListaDeEmails } from './PorResponder';
import { useCaixaDeEmails } from './useEmails';
import './emails.css';
import './painel.css';

export function Triagem() {
  const caixa = useCaixaDeEmails();
  const porDecidir = (caixa.itens ?? []).filter((item) => !item.tarefa);
  const lidos = caixa.itens !== undefined && caixa.leitura.lidoEm !== null;
  return (
    <section class="painel triagem" aria-labelledby="titulo-triagem" aria-busy={!lidos && caixa.leitura.falha === null}>
      <h2 id="titulo-triagem">Triagem</h2>
      <EstadoDosEmails caixa={caixa} />
      <AvisoDeEmail caixa={caixa} />
      {porDecidir.length > 0 && (
        <>
          <p class="triagem-conta">{`${nEmails(porDecidir.length)} por decidir. Um de cada vez.`}</p>
          <ListaDeEmails itens={porDecidir.slice(0, 1)} caixa={caixa} />
        </>
      )}
      {lidos && porDecidir.length === 0 && (
        <div>
          <p class="lista-vazia-titulo">Nada por decidir. Cada e-mail já tem destino.</p>
          <p class="lista-vazia-texto">Os e-mails novos da aba Principal entram aqui, um de cada vez.</p>
        </div>
      )}
    </section>
  );
}
