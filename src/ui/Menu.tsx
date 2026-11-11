// Navegação: menu completo (computador) e atalhos (barra no celular, trilho no tablet).
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { hrefDe, nomeDoMes, type IdDaRota, type RotaAtual } from '../rotas';
import { Icone, type NomeDoIcone } from './icones';
import { useSalas } from './hooks';
import { BotaoMais, FolhaMais, ROTAS_DO_MAIS } from './Mais';

type IdComHref = Exclude<IdDaRota, 'nao-encontrada'>;

type Props = { rota: RotaAtual; hoje: Date };

/** Cor de cada sala (classes em tema.css). Sala criada depois fica neutra. */
const COR_DA_SALA: Record<string, string> = {
  'sala-doutoramento': 'sala-dout',
  'sala-investigacao': 'sala-inv',
  'sala-aulas': 'sala-aulas',
  'sala-orientacoes': 'sala-ori',
  'sala-mba': 'sala-mba',
  'sala-pessoal': 'sala-pes',
  'sala-casa': 'sala-casa',
};
export const corDaSala = (id: string) => COR_DA_SALA[id] ?? 'sala-outra';


/** Os nomes dos destinos que mudam com a data: mês e ano atuais. */
function rotuloDe(id: IdComHref, hoje: Date): string {
  switch (id) {
    case 'semana':
      return 'Esta semana';
    case 'mes':
      return nomeDoMes(hoje);
    case 'ano':
      return String(hoje.getFullYear());
    case 'agora':
      return 'Agora';
    case 'salas':
      return 'Salas';
    case 'caixa':
      return 'Caixa';
    case 'quadro':
      return 'Quadro';
    case 'atividades':
      return 'Atividades';
    case 'cores':
      return 'Cores do Google';
    case 'conectar':
      return 'Conectar aparelho';
    case 'ia':
      return 'IA local';
    default:
      return id;
  }
}

type ItemProps = { rota: RotaAtual; id: IdComHref; param?: string; icone?: NomeDoIcone; rotulo: string; cor?: string };

function Item({ rota, id, param, icone, rotulo, cor }: ItemProps) {
  const ativo = rota.id === id && rota.param === param;
  return (
    <a class={cor ? `item ${cor}` : 'item'} href={hrefDe(id, param)} aria-current={ativo ? 'page' : undefined}>
      {icone ? <Icone nome={icone} /> : <span class="ponto-da-sala" aria-hidden="true" />}
      <span>{rotulo}</span>
    </a>
  );
}

function Grupo({ titulo, children }: { titulo: string; children: ComponentChildren }) {
  const id = `menu-${titulo.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <section aria-labelledby={id}>
      <h2 id={id}>{titulo}</h2>
      <ul>{children}</ul>
    </section>
  );
}

export function MenuLateral({ rota, hoje }: Props) {
  const salas = useSalas();
  const item = (id: IdComHref, icone: NomeDoIcone) => (
    <li key={id}>
      <Item rota={rota} id={id} icone={icone} rotulo={rotuloDe(id, hoje)} />
    </li>
  );
  return (
    <nav class="menu" aria-label="Principal">
      <p class="marca">Central</p>
      {/* O meio rola; a marca e o rodapé ficam sempre à vista. */}
      <div class="menu-rolagem">
        <Item rota={rota} id="hoje" icone="painel" rotulo="Painel do dia" />
        <Grupo titulo="Calendário">
          {item('semana', 'semana')}
          {item('mes', 'mes')}
          {item('ano', 'ano')}
        </Grupo>
        <Grupo titulo="Ver">
          {item('salas', 'salas')}
          {item('caixa', 'caixa')}
          {item('quadro', 'quadro')}
          {item('atividades', 'atividades')}
        </Grupo>
        <Grupo titulo="Minhas salas">
          {salas.map((sala) => (
            <li key={sala.id}>
              <Item rota={rota} id="sala" param={sala.id} rotulo={sala.nome} cor={corDaSala(sala.id)} />
            </li>
          ))}
        </Grupo>
      </div>
      <div class="rodape-do-menu">
        <Item rota={rota} id="conectar" icone="conectar" rotulo="Conectar aparelho" />
        <Item rota={rota} id="ia" icone="chat" rotulo="IA local" />
      </div>
    </nav>
  );
}

const ATALHOS: { id: IdComHref; icone: NomeDoIcone; rotulo: string; contem?: IdDaRota[] }[] = [
  { id: 'hoje', icone: 'painel', rotulo: 'Painel' },
  { id: 'atividades', icone: 'atividades', rotulo: 'Atividades' },
  { id: 'agora', icone: 'agora', rotulo: 'Agora' },
  { id: 'salas', icone: 'salas', rotulo: 'Salas', contem: ['sala', 'pessoa'] },
  { id: 'chat', icone: 'chat', rotulo: 'Chat' },
];

/** `barra`: embaixo no celular. `trilho`: ao lado no tablet. Mesmos atalhos. */
export function Atalhos({ rota, hoje, variante }: Props & { variante: 'barra' | 'trilho' }) {
  const [aberto, setAberto] = useState(false);
  const botao = useRef<HTMLButtonElement | null>(null);

  // A página mudou (link, voltar do navegador): a folha não fica aberta sobre ela.
  useEffect(() => {
    setAberto(false);
  }, [rota.id, rota.param]);

  function fechar(devolverFoco: boolean) {
    setAberto(false);
    if (devolverFoco) botao.current?.focus();
  }

  return (
    <>
      <nav class="atalhos" data-variante={variante} aria-label="Principal">
        <ul>
          {ATALHOS.map((atalho) => {
            const exato = rota.id === atalho.id;
            // Dentro de uma sala, Salas fica marcada sem dizer que é a página atual.
            const dentro = !exato && atalho.contem?.includes(rota.id);
            return (
              <li key={atalho.id}>
                <a
                  href={hrefDe(atalho.id)}
                  aria-current={exato ? 'page' : dentro ? 'true' : undefined}
                  onClick={() => setAberto(false)}
                >
                  <Icone nome={atalho.icone} />
                  <span>{atalho.rotulo}</span>
                </a>
              </li>
            );
          })}
          <li>
            <BotaoMais
              aberto={aberto}
              // O que tem atalho próprio na barra (Atividades, Agora) é página atual lá, não "dentro do Mais".
              dentro={ROTAS_DO_MAIS.has(rota.id) && !ATALHOS.some((atalho) => atalho.id === rota.id)}
              aoAlternar={() => setAberto((valor) => !valor)}
              botaoRef={botao}
            />
          </li>
        </ul>
      </nav>
      {aberto && <FolhaMais rotulo={(id) => rotuloDe(id, hoje)} rotaAtual={rota.id} aoFechar={fechar} />}
    </>
  );
}
