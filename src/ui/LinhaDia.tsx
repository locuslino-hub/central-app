// A linha horizontal do dia (spec, seção 7, item 2): cada compromisso é um bloco
// na hora dele; o prazo é só um marcador; uma risca marca agora. É para ver o
// dia de relance, então os blocos não são botões; a lista escondida, para leitor
// de tela, diz o mesmo em palavras. A Tarefa 16 coloca esta linha no Painel.
import {
  descreverHorario,
  empilhar,
  formatarMinutos,
  MINUTOS_NO_DIA,
  type DiaDoCalendario,
  type Item,
} from '../dados/calendario';
import { hojeEmLisboa, minutoEmLisboa } from '../dados/dia';
import type { Sala } from '../dados/tipos';
import { salaDoItem } from './ItemDeAgenda';
import { corDaSala } from './Menu';
import type { SalaDoEvento } from './useAdivinharSala';
import './calendario.css';

type Props = {
  dia: DiaDoCalendario;
  agora: Date;
  salas: Sala[];
  /** Começo da janela, em minutos (8h). Cresce se algo começa antes. */
  inicioDoDia?: number;
  /** Fim da janela, em minutos (20h, o fim do dia). Cresce se algo termina depois. */
  fimDoDia?: number;
  /** A sala do compromisso (gravada, pela cor do Google ou pelo título). */
  salaDoEvento?: SalaDoEvento;
};

const titulo = (item: Item) => {
  const texto = item.tipo === 'evento' ? item.evento.titulo : item.tarefa.titulo;
  return texto === '' ? '(sem título)' : texto;
};

/** Cada item em palavras, para o leitor de tela. */
function frase(item: Item): string {
  const notas: string[] = [];
  if (item.tipo === 'evento' && item.evento.livre) notas.push('livre');
  if (item.tipo === 'evento' && item.evento.feito) notas.push('feito');
  if (item.tipo === 'bloco') notas.push('tarefa');
  if (item.passado) notas.push('passado');
  const horario =
    item.tipo === 'evento'
      ? descreverHorario(item)
      : item.tipo === 'prazo'
        ? `Prazo às ${formatarMinutos(item.ini)}`
        : `${formatarMinutos(item.ini)} às ${formatarMinutos(item.fim)}`;
  return `${horario}: ${titulo(item)}${notas.map((nota) => `, ${nota}`).join('')}`;
}

export function LinhaDia({ dia, agora, inicioDoDia = 8 * 60, fimDoDia = 20 * 60, salaDoEvento }: Props) {
  const itens = dia.horarios;
  const comeco = Math.min(inicioDoDia, ...itens.map((i) => Math.floor(i.ini / 60) * 60));
  const fim = Math.min(MINUTOS_NO_DIA, Math.max(fimDoDia, ...itens.map((i) => Math.ceil(i.fim / 60) * 60)));
  const total = Math.max(1, fim - comeco);
  const por100 = (minuto: number) => ((minuto - comeco) / total) * 100;

  const linhas = empilhar(itens);
  const numeroDeLinhas = Math.max(1, ...linhas.map((l) => l + 1));

  const horas: number[] = [];
  for (let h = Math.ceil(comeco / 120) * 2; h * 60 <= fim; h += 2) horas.push(h);

  const eHoje = dia.data === hojeEmLisboa(agora);
  const minutoAgora = minutoEmLisboa(agora);
  const mostraAgora = eHoje && minutoAgora >= comeco && minutoAgora <= fim;

  return (
    <div class="linha-dia" role="group" aria-label="Linha do dia">
      {itens.length > 0 ? (
        <ul class="so-leitor">
          {itens.map((item) => (
            <li key={item.chave}>{frase(item)}</li>
          ))}
        </ul>
      ) : (
        <p class="so-leitor">Nada com hora marcada.</p>
      )}
      {eHoje && <p class="so-leitor">{`Agora são ${formatarMinutos(minutoAgora)}.`}</p>}

      <div class="lin-faixa" aria-hidden="true" data-linhas={numeroDeLinhas} style={{ '--linhas': numeroDeLinhas }}>
        {itens.map((item, i) => {
          const salaId = salaDoItem(item, salaDoEvento);
          const cor = salaId === null ? 'sala-outra' : corDaSala(salaId);
          const comum = {
            'data-titulo': titulo(item),
            'data-tipo': item.tipo,
            'data-linha': String(linhas[i]),
            'data-passado': String(item.passado),
          };
          if (item.tipo === 'prazo') {
            return (
              <span
                key={item.chave}
                class={`lin-prazo ${cor}`}
                {...comum}
                style={{ left: `${por100(item.ini)}%`, '--linha': linhas[i] }}
              >
                <span class="lin-rotulo">{titulo(item)}</span>
              </span>
            );
          }
          return (
            <span
              key={item.chave}
              class={`lin-bloco ${cor}`}
              {...comum}
              data-livre={String(item.tipo === 'evento' && item.evento.livre)}
              data-feito={String(item.tipo === 'evento' ? item.evento.feito === true : item.tarefa.feito)}
              style={{
                left: `${por100(item.ini)}%`,
                width: `${((item.fim - item.ini) / total) * 100}%`,
                '--linha': linhas[i],
              }}
            >
              <span class="lin-texto">{titulo(item)}</span>
            </span>
          );
        })}
        {mostraAgora && <span class="lin-agora" style={{ left: `${por100(minutoAgora)}%` }} />}
      </div>

      <div class="lin-horas" aria-hidden="true">
        {horas.map((h) => (
          <span key={h} class="lin-hora" style={{ left: `${por100(h * 60)}%` }}>
            {`${h}h`}
          </span>
        ))}
      </div>
    </div>
  );
}
