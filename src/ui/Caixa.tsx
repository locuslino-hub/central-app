// Caixa (menu "Ver"): todos os e-mails por responder, com filtro por sala. É a
// mesma lista do Painel do dia, sem limite. Só lê: nada aqui muda o Gmail.
import { useState } from 'preact/hooks';
import { AvisoDeEmail, EmailsVazios, EstadoDosEmails, ListaDeEmails, nEmails } from './PorResponder';
import { useSalas } from './hooks';
import { useCaixaDeEmails } from './useEmails';
import './emails.css';

const TODAS = 'todas';
const SEM_SALA = 'sem-sala';

export function Caixa() {
  const caixa = useCaixaDeEmails();
  const salas = useSalas();
  const [filtro, setFiltro] = useState(TODAS);
  const { itens, leitura } = caixa;
  const todos = itens ?? [];

  // Só as salas que têm e-mail agora; "Sem sala" só se houver.
  const idsComEmail = new Set(todos.map((item) => item.origem.salaId));
  const salasDosEmails = salas.filter((sala) => idsComEmail.has(sala.id));
  const temSemSala = todos.some((item) => item.origem.salaId === null || !salas.some((sala) => sala.id === item.origem.salaId));
  const opcoes = [
    { id: TODAS, nome: 'Todas', total: todos.length },
    ...salasDosEmails.map((sala) => ({ id: sala.id, nome: sala.nome, total: todos.filter((i) => i.origem.salaId === sala.id).length })),
    ...(temSemSala
      ? [
          {
            id: SEM_SALA,
            nome: 'Sem sala',
            total: todos.filter((i) => i.origem.salaId === null || !salas.some((s) => s.id === i.origem.salaId)).length,
          },
        ]
      : []),
  ];
  // O filtro some se a sala ficou sem e-mails (Feito, por exemplo): volta para Todas.
  const ativo = opcoes.some((opcao) => opcao.id === filtro) ? filtro : TODAS;
  const visiveis = todos.filter((item) => {
    if (ativo === TODAS) return true;
    if (ativo === SEM_SALA) return item.origem.salaId === null || !salas.some((sala) => sala.id === item.origem.salaId);
    return item.origem.salaId === ativo;
  });

  return (
    <section
      class="painel por-responder caixa-emails"
      aria-labelledby="titulo-caixa-emails"
      aria-busy={itens === undefined || (leitura.lidoEm === null && leitura.falha === null)}
    >
      <h2 id="titulo-caixa-emails">
        Por responder
        {todos.length > 0 && <span class="email-contagem">{nEmails(todos.length)}</span>}
      </h2>
      <EstadoDosEmails caixa={caixa} />
      {opcoes.length > 2 && (
        <div class="email-filtros" role="group" aria-label="Filtrar por sala">
          {opcoes.map((opcao) => (
            <button
              key={opcao.id}
              type="button"
              class="email-filtro"
              aria-pressed={ativo === opcao.id}
              onClick={() => setFiltro(opcao.id)}
            >
              {`${opcao.nome} (${opcao.total})`}
            </button>
          ))}
        </div>
      )}
      <AvisoDeEmail caixa={caixa} />
      {todos.length === 0 && <EmailsVazios caixa={caixa} />}
      {visiveis.length > 0 && <ListaDeEmails itens={visiveis} caixa={caixa} />}
    </section>
  );
}
