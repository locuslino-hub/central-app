// O menu do "/" no caderno: lista o que dá para inserir. Quem escreve na linha
// decide qual opção está ativa (setas) e quando fechar; aqui só se desenha e se escolhe.
import type { Painel, TipoDeBloco } from '../dados/caderno';

export type Escolha =
  | { tipo: Exclude<TipoDeBloco, 'painel'> }
  | { tipo: 'painel'; painel: Painel };

export type OpcaoDoMenu = { id: string; rotulo: string; dica: string; escolha: Escolha };

export const OPCOES_DO_MENU: readonly OpcaoDoMenu[] = [
  { id: 'texto', rotulo: 'Texto', dica: 'Uma linha comum', escolha: { tipo: 'texto' } },
  { id: 'titulo', rotulo: 'Título', dica: 'Separa uma parte da outra', escolha: { tipo: 'titulo' } },
  { id: 'lista', rotulo: 'Lista', dica: 'Um item com marcador', escolha: { tipo: 'lista' } },
  { id: 'agenda', rotulo: 'Agenda', dica: 'Os compromissos de hoje', escolha: { tipo: 'painel', painel: 'agenda' } },
  { id: 'checklist', rotulo: 'Checklist', dica: 'As tarefas de hoje', escolha: { tipo: 'painel', painel: 'checklist' } },
  { id: 'semana', rotulo: 'Semana', dica: 'A semana inteira', escolha: { tipo: 'painel', painel: 'semana' } },
];

const simples = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** As opções que combinam com o que foi digitado depois da barra. */
export function filtrarOpcoes(filtro: string): OpcaoDoMenu[] {
  const f = simples(filtro.trim());
  return OPCOES_DO_MENU.filter((o) => simples(o.rotulo).includes(f));
}

type Props = {
  /** Id do elemento; o campo que abriu o menu aponta para ele. */
  id: string;
  rotulo: string;
  opcoes: readonly OpcaoDoMenu[];
  ativo: number;
  aoEscolher: (opcao: OpcaoDoMenu) => void;
};

export function BlocoMenu({ id, rotulo, opcoes, ativo, aoEscolher }: Props) {
  return (
    <ul class="bloco-menu" id={id} role="listbox" aria-label={rotulo}>
      {opcoes.length === 0 && <li class="bloco-menu-vazio">Nada com esse nome.</li>}
      {opcoes.map((opcao, i) => (
        <li
          key={opcao.id}
          id={`${id}-${opcao.id}`}
          role="option"
          aria-selected={i === ativo}
          class={`bloco-menu-opcao${i === ativo ? ' ativa' : ''}`}
          // O campo não perde o foco ao tocar na opção.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => aoEscolher(opcao)}
        >
          <span class="bloco-menu-rotulo">{opcao.rotulo}</span>
          <span class="bloco-menu-dica">{opcao.dica}</span>
        </li>
      ))}
    </ul>
  );
}
