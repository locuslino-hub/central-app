import { configure, render, screen, waitFor, within } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { montarCalendario, type ItemDeEvento } from '../../src/dados/calendario';
import type { Evento } from '../../src/dados/agenda';
import { salvar, semear, semearPalavras } from '../../src/dados/loja';
import { AgendaHoje } from '../../src/ui/AgendaHoje';
import { ItemDeAgenda } from '../../src/ui/ItemDeAgenda';
import { LinhaDia } from '../../src/ui/LinhaDia';
import { agendaDeTeste, evento } from '../apoio/agenda-ui';

// Compromissos do Google chegam sem sala: a tela adivinha pelo título (as mesmas
// regras das tarefas) e pinta na cor dela. Nada bate: fica neutro.
// Quinta-feira, 2026-11-05, 12:20 (Europe/Lisbon). Só a data é falsa.
const AGORA = new Date('2026-11-05T12:20:00Z');
const HOJE = '2026-11-05';

configure({ asyncUtilTimeout: 5000 });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AGORA);
});

const ev = (titulo: string, inicio: string, fim: string, extra: Partial<Evento> = {}) =>
  evento(titulo, { inicio: `${HOJE}T${inicio}:00+00:00`, fim: `${HOJE}T${fim}:00+00:00`, ...extra });

const diaCom = (eventos: Evento[]) => montarCalendario({ eventos, tarefas: [], de: HOJE, ate: HOJE, agora: AGORA }).dia(HOJE);

/** Adivinhação de mentira: só "aula" e "projeto". */
const adivinhar = (titulo: string) => (/aula/i.test(titulo) ? 'sala-aulas' : /projeto/i.test(titulo) ? 'sala-investigacao' : null);

describe('ItemDeAgenda: compromisso sem sala', () => {
  const mostrar = (e: Evento, props: { adivinhar?: (titulo: string) => string | null } = {}) => {
    const item = diaCom([e]).horarios[0] as ItemDeEvento;
    render(
      <ul>
        <ItemDeAgenda item={item} salas={[]} aoAbrir={() => {}} {...props} />
      </ul>,
    );
    return screen.getByRole('listitem');
  };

  it('ganha a cor da sala adivinhada pelo título', () => {
    expect(mostrar(ev('Aula de métodos', '09:00', '10:30'), { adivinhar }).className).toContain('sala-aulas');
  });

  it('nada bate: fica neutro', () => {
    expect(mostrar(ev('Dentista', '18:00', '18:45'), { adivinhar }).className).toContain('sala-outra');
  });

  it('a sala gravada vale antes da adivinhada', () => {
    expect(mostrar(ev('Aula de métodos', '09:00', '10:30', { salaId: 'sala-mba' }), { adivinhar }).className).toContain('sala-mba');
  });

  it('sem adivinhação, continua neutro', () => {
    expect(mostrar(ev('Aula de métodos', '09:00', '10:30')).className).toContain('sala-outra');
  });
});

describe('LinhaDia: compromisso sem sala', () => {
  it('o bloco ganha a cor da sala adivinhada; o que não bate fica neutro', () => {
    const dia = diaCom([ev('Reunião do projeto Aurora', '16:30', '17:15'), ev('Dentista', '18:00', '18:45')]);
    render(<LinhaDia dia={dia} agora={AGORA} salas={[]} adivinhar={adivinhar} />);
    const bloco = (titulo: string) => document.querySelector(`[data-titulo="${titulo}"]`) as HTMLElement;
    expect(bloco('Reunião do projeto Aurora').className).toContain('sala-inv');
    expect(bloco('Dentista').className).toContain('sala-outra');
  });
});

describe('Agenda de hoje: adivinha com a memória guardada', () => {
  it('palavras iniciais ("projeto") e pessoas cadastradas pintam o compromisso; o resto fica neutro', async () => {
    await semear();
    await semearPalavras();
    await salvar('pessoas', { nome: 'Renata', salaId: 'sala-orientacoes' });
    const agenda = await agendaDeTeste();
    agenda.responder([
      ev('Reunião do projeto Aurora', '16:30', '17:15'),
      ev('Café com a Renata', '17:30', '18:00'),
      ev('Dentista', '18:00', '18:45'),
    ]);
    render(<AgendaHoje />);
    const cartao = within(screen.getByRole('region', { name: 'Agenda de hoje' }));
    const item = async (titulo: string) => (await cartao.findByText(titulo)).closest('li') as HTMLElement;
    await waitFor(async () => expect((await item('Reunião do projeto Aurora')).className).toContain('sala-inv'));
    await waitFor(async () => expect((await item('Café com a Renata')).className).toContain('sala-ori'));
    expect((await item('Dentista')).className).toContain('sala-outra');
    // A etiqueta diz a sala em palavras: a cor não é o único sinal.
    expect(within(await item('Reunião do projeto Aurora')).getByText('Investigação')).toBeTruthy();
  });
});
