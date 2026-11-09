import { act, configure, render, screen, waitFor } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { lerEventos, marcarEventosObsoletos } from '../../src/dados/eventos';
import { useEventos } from '../../src/ui/useEventos';
import { agendaDeTeste, evento } from '../apoio/agenda-ui';

// Quinta-feira, 2026-11-05, 12:20 (Europe/Lisbon). Só a data é falsa.
const AGORA = Date.parse('2026-11-05T12:20:00Z');
configure({ asyncUtilTimeout: 5000 });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AGORA);
});

/** Anota, a cada desenho, os títulos da leitura que o hook entregou. */
function Sonda({ de, ate, vistos }: { de: string; ate: string; vistos: string[][] }) {
  const { leitura } = useEventos(de, ate);
  vistos.push(leitura.eventos.map((e) => e.titulo));
  return <p>{leitura.eventos.map((e) => e.titulo).join(',')}</p>;
}

describe('useEventos', () => {
  it('ao trocar de período, nenhum desenho mostra a leitura do período antigo', async () => {
    const agenda = await agendaDeTeste();
    agenda.responderPeloPeriodo([
      evento('Da semana 1', { inicio: '2026-11-03T09:00:00+00:00', fim: '2026-11-03T10:00:00+00:00' }),
      evento('Da semana 2', { inicio: '2026-11-10T09:00:00+00:00', fim: '2026-11-10T10:00:00+00:00' }),
    ]);
    const vistos: string[][] = [];
    const { rerender } = render(<Sonda de="2026-11-02" ate="2026-11-08" vistos={vistos} />);
    await screen.findByText('Da semana 1');
    vistos.length = 0;
    rerender(<Sonda de="2026-11-09" ate="2026-11-15" vistos={vistos} />);
    await screen.findByText('Da semana 2');
    expect(vistos.some((v) => v.includes('Da semana 1'))).toBe(false);
  });

  it('o relógio de 15 minutos não lê com o app escondido', async () => {
    const intervalos = vi.spyOn(globalThis, 'setInterval');
    const agenda = await agendaDeTeste();
    agenda.responder([]);
    render(<Sonda de="2026-11-05" ate="2026-11-05" vistos={[]} />);
    await waitFor(() => expect(agenda.leituras().length).toBeGreaterThan(0));
    await waitFor(() => expect(lerEventos('2026-11-05', '2026-11-05').carregando).toBe(false)); // senão o relógio ignora por já estar lendo
    const antes = agenda.leituras().length;
    const quinze = intervalos.mock.calls.find(([, ms]) => ms === 15 * 60_000)![0] as () => void;
    const visibilidade = vi.spyOn(document, 'visibilityState', 'get');

    visibilidade.mockReturnValue('hidden');
    await act(async () => quinze());
    await new Promise((pronto) => setTimeout(pronto, 200)); // a leitura começa depois de uma consulta ao IndexedDB
    expect(agenda.leituras()).toHaveLength(antes);

    visibilidade.mockReturnValue('visible');
    await act(async () => quinze());
    await waitFor(() => expect(agenda.leituras()).toHaveLength(antes + 1));
  });

  it('um evento criado ou removido por este aparelho faz a tela ler de novo, sem esperar o intervalo', async () => {
    const agenda = await agendaDeTeste();
    agenda.responder([evento('Aula')]);
    render(<Sonda de="2026-11-05" ate="2026-11-05" vistos={[]} />);
    await screen.findByText('Aula');
    await waitFor(() => expect(lerEventos('2026-11-05', '2026-11-05').carregando).toBe(false));
    const antes = agenda.leituras().length;

    agenda.responder([evento('Aula'), evento('Reunião nova')]);
    await act(async () => marcarEventosObsoletos());

    await screen.findByText('Aula,Reunião nova');
    expect(agenda.leituras()).toHaveLength(antes + 1);
    expect(lerEventos('2026-11-05', '2026-11-05').obsoleta).toBeUndefined();
  });
});
