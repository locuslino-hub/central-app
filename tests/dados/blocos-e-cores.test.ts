// Blocos do Google Tarefas e sala pela cor do Google (spec 2026-11-09), do
// lado do app: o ✓ de um bloco vai ao Google Tarefas pela fila, o feito do
// Google vale quando é mais recente, e a sala sai da ordem gravada -> cor ->
// título -> neutro.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ID_VALIDO } from '../../script/colecoes';
import { eventoValido, listarEventos, type Evento } from '../../src/dados/agenda';
import { coresVistas, idDaCor, ligarCor, mapaDeCores, nomeDaCor, salaDoEvento } from '../../src/dados/cores';
import { aplicarFeitos, idDoFeito, marcarCompromissoFeito } from '../../src/dados/eventos-feitos';
import { listar, listarPendentes } from '../../src/dados/loja';
import { sincronizar } from '../../src/dados/sincronia';
import type { CorDaSala, EventoFeito, PendenteEspelho } from '../../src/dados/tipos';
import { agendasDoDono } from '../apoio/calendario';
import { servidorDeTeste } from '../apoio/servidor';

const AGORA = Date.parse('2026-11-09T12:20:00Z');
const PRINCIPAL = 'marina.ficticia@example.com';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AGORA);
});

function evento(extra: Partial<Evento> = {}): Evento {
  return {
    id: 'bloco1',
    agendaId: 'primary',
    titulo: 'Revisar capítulo da Aurora',
    inicio: '2026-11-09T14:00:00+00:00',
    fim: '2026-11-09T15:00:00+00:00',
    diaInteiro: false,
    livre: false,
    recusado: false,
    salaId: null,
    link: null,
    ...extra,
  };
}

const espelhos = async () => (await listarPendentes()).filter((p): p is PendenteEspelho => p.tipo === 'espelho');
const semEspera = (_ms: number) => Promise.resolve();

describe('o evento que chega do script', () => {
  it('aceita bloco de tarefa, hora do Google Tarefas e cor', () => {
    expect(eventoValido(evento({ tarefaGoogleId: 'web_1-a', tarefaAtualizadaEm: AGORA, cor: { chave: 'label:etq1', hex: '#3f51b5' } }))).toBe(true);
    expect(eventoValido(evento({ cor: { chave: 'cor:9', hex: '#3f51b5' } }))).toBe(true);
  });

  it('recusa essas partes fora da forma', () => {
    expect(eventoValido(evento({ tarefaGoogleId: 'a/b' }))).toBe(false);
    expect(eventoValido(evento({ tarefaAtualizadaEm: -1 }))).toBe(false);
    expect(eventoValido(evento({ cor: { chave: 'cor:99', hex: '#3f51b5' } }))).toBe(false);
    expect(eventoValido(evento({ cor: { chave: 'cor:9', hex: 'azul' } }))).toBe(false);
  });

  it('bloco de tarefa nunca chega como livre, mesmo de um script que mandasse', async () => {
    const chamar = (async () => ({ eventos: [evento({ tarefaGoogleId: 'web1', livre: true }), evento({ id: 'b', livre: true })], incompleto: false })) as never;
    const { eventos } = await listarEventos({ de: '2026-11-09', ate: '2026-11-09' }, { chamar });
    expect(eventos.map((e) => e.livre)).toEqual([false, true]);
  });
});

describe('✓ num bloco do Google Tarefas', () => {
  function comBloco() {
    const agenda = agendasDoDono();
    const servidor = servidorDeTeste({ comTarefasGoogle: true, agenda });
    const lista = servidor.tarefasGoogle.lista('Tese');
    const tarefa = servidor.tarefasGoogle.tarefa(lista, { id: 'api1', idDaWeb: 'web1', title: 'Revisar capítulo da Aurora' });
    agenda.evento(PRINCIPAL, {
      id: 'bloco1',
      summary: 'Revisar capítulo da Aurora',
      inicio: '2026-11-09T14:00:00+00:00',
      fim: '2026-11-09T15:00:00+00:00',
      description: 'https://tasks.google.com/task/web1',
      eventType: 'focusTime',
    });
    return { agenda, servidor, tarefa, sincronizar: () => sincronizar({ chamar: servidor.chamar, esperar: semEspera }) };
  }

  it('entra na fila como marcarTarefaGoogle (nunca marcarEventoFeito) e conclui a tarefa; o título não muda', async () => {
    const { agenda, servidor, tarefa, sincronizar } = comBloco();
    await marcarCompromissoFeito(evento({ tarefaGoogleId: 'web1', somenteLeitura: true }), true, '2026-11-09');
    expect(await espelhos()).toMatchObject([{ acao: 'marcarTarefaGoogle', taskId: 'web1', feito: true }]);
    expect(await listar('eventosFeitos')).toMatchObject([{ eventoId: 'bloco1', feito: true }]);

    expect(await sincronizar()).toBe('atualizado');
    expect(tarefa.status).toBe('completed');
    expect(servidor.de('marcarEventoFeito')).toEqual([]);
    expect(agenda.agendas.get(PRINCIPAL)!.eventos.get('bloco1')!.summary).toBe('Revisar capítulo da Aurora');
    expect(await listarPendentes()).toEqual([]);
  });

  it('marcar e desmarcar antes de sincronizar: vale o último toque, num pedido só', async () => {
    const { servidor, tarefa, sincronizar } = comBloco();
    const bloco = evento({ tarefaGoogleId: 'web1', somenteLeitura: true });
    await marcarCompromissoFeito(bloco, true, '2026-11-09');
    await marcarCompromissoFeito(bloco, false, '2026-11-09');
    expect(await espelhos()).toMatchObject([{ acao: 'marcarTarefaGoogle', feito: false }]);
    await sincronizar();
    expect(servidor.de('marcarTarefaGoogle')).toHaveLength(1);
    expect(tarefa.status).toBe('needsAction');
  });

  it('script sem o Google Tarefas: sai da fila sem erro e o feito fica na Central', async () => {
    const agenda = agendasDoDono();
    const servidor = servidorDeTeste({ agenda });
    await marcarCompromissoFeito(evento({ tarefaGoogleId: 'web1', somenteLeitura: true }), true, '2026-11-09');
    expect(await sincronizar({ chamar: servidor.chamar, esperar: semEspera })).toBe('atualizado');
    expect(await listarPendentes()).toEqual([]);
    expect(await listar('eventosFeitos')).toMatchObject([{ feito: true }]);
  });
});

describe('qual feito vale num bloco: a regra de conflito', () => {
  const registro = (feito: boolean, atualizadoEm: number): EventoFeito => ({
    id: idDoFeito('primary', 'bloco1'),
    eventoId: 'bloco1',
    agendaId: 'primary',
    data: '2026-11-09',
    feito,
    atualizadoEm,
    aparelho: 'notebook',
  });

  it('feito no Google depois do toque na Central: vale o do Google', () => {
    const doGoogle = [evento({ tarefaGoogleId: 'web1', feito: true, tarefaAtualizadaEm: AGORA })];
    expect(aplicarFeitos(doGoogle, [registro(false, AGORA - 60_000)])[0].feito).toBe(true);
    // Reaberto no Google depois: também vale o do Google.
    const reaberto = [evento({ tarefaGoogleId: 'web1', tarefaAtualizadaEm: AGORA })];
    expect(aplicarFeitos(reaberto, [registro(true, AGORA - 60_000)])[0].feito).toBeUndefined();
  });

  it('toque na Central mais recente que a última mudança no Google: vale o da Central', () => {
    const doGoogle = [evento({ tarefaGoogleId: 'web1', tarefaAtualizadaEm: AGORA - 60_000 })];
    expect(aplicarFeitos(doGoogle, [registro(true, AGORA)])[0].feito).toBe(true);
  });

  it('mesma hora: vale a Central; bloco sem estado lido do Google: vale a Central', () => {
    expect(aplicarFeitos([evento({ tarefaGoogleId: 'web1', tarefaAtualizadaEm: AGORA })], [registro(true, AGORA)])[0].feito).toBe(true);
    expect(aplicarFeitos([evento({ tarefaGoogleId: 'web1', feito: true })], [registro(false, AGORA - 1e9)])[0].feito).toBeUndefined();
  });

  it('compromisso comum continua como antes: a Central vale sobre o "✓ " do Google', () => {
    expect(aplicarFeitos([evento({ feito: true, tarefaAtualizadaEm: undefined })], [registro(false, 1)])[0].feito).toBeUndefined();
  });
});

describe('sala pela cor do Google', () => {
  const cor = (chave: string, salaId: string | null, apagado = false): CorDaSala => ({
    id: idDaCor(chave),
    chave,
    salaId,
    atualizadoEm: 1,
    aparelho: 'notebook',
    ...(apagado ? { apagado } : {}),
  });

  it('o id do registro é fixo por chave e vale como id de coleção', () => {
    expect(idDaCor('label:etq1')).toBe(idDaCor('label:etq1'));
    expect(idDaCor('cor:1')).not.toBe(idDaCor('cor:11'));
    expect(idDaCor('agenda:9fc6e7')).toMatch(ID_VALIDO);
  });

  it('ordem: sala gravada pela Central -> cor ligada -> adivinhação pelo título -> neutro', () => {
    const cores = mapaDeCores([cor('cor:9', 'sala-doutoramento'), cor('cor:2', null), cor('cor:3', 'sala-mba', true)]);
    const adivinhar = (titulo: string) => (/aula/i.test(titulo) ? 'sala-aulas' : null);
    const azul = { chave: 'cor:9', hex: '#3f51b5' };
    expect(salaDoEvento(evento({ salaId: 'sala-casa', cor: azul, titulo: 'Aula' }), cores, adivinhar)).toBe('sala-casa');
    expect(salaDoEvento(evento({ cor: azul, titulo: 'Aula' }), cores, adivinhar)).toBe('sala-doutoramento');
    // Cor sem sala ("Sem sala") e cor apagada não contam: segue para o título.
    expect(salaDoEvento(evento({ cor: { chave: 'cor:2', hex: '#33b679' }, titulo: 'Aula' }), cores, adivinhar)).toBe('sala-aulas');
    expect(salaDoEvento(evento({ cor: { chave: 'cor:3', hex: '#8e24aa' }, titulo: 'Aula' }), cores, adivinhar)).toBe('sala-aulas');
    expect(salaDoEvento(evento({ titulo: 'Dentista' }), cores, adivinhar)).toBeNull();
    expect(salaDoEvento(evento({ titulo: 'Aula' }), cores)).toBeNull();
  });

  it('ligar uma cor grava um registro sincronizado; "Sem sala" grava null no mesmo registro', async () => {
    await ligarCor('label:etq1', 'sala-aulas');
    await ligarCor('label:etq1', null);
    const registros = await listar('coresDasSalas');
    expect(registros).toHaveLength(1);
    expect(registros[0]).toMatchObject({ id: idDaCor('label:etq1'), chave: 'label:etq1', salaId: null });
    expect((await listarPendentes()).some((p) => p.tipo === 'registro' && p.colecao === 'coresDasSalas')).toBe(true);
  });

  it('as cores vistas: contagem, até 2 títulos de exemplo diferentes, as mais usadas primeiro', () => {
    const azul = { chave: 'cor:9', hex: '#3f51b5' };
    const etiqueta = { chave: 'label:etq1', hex: '#0b8043' };
    const vistas = coresVistas([
      evento({ id: '1', cor: etiqueta, titulo: 'Aula' }),
      evento({ id: '2', cor: azul, titulo: 'Tese' }),
      evento({ id: '3', cor: azul, titulo: 'Tese' }),
      evento({ id: '4', cor: azul, titulo: 'Capítulo' }),
      evento({ id: '5', cor: azul, titulo: 'Artigo' }),
      evento({ id: '6' }),
    ]);
    expect(vistas).toEqual([
      { chave: 'cor:9', hex: '#3f51b5', quantos: 4, exemplos: ['Tese', 'Capítulo'] },
      { chave: 'label:etq1', hex: '#0b8043', quantos: 1, exemplos: ['Aula'] },
    ]);
  });

  it('nome da cor em palavras', () => {
    expect(nomeDaCor('cor:9')).toBe('Mirtilo');
    expect(nomeDaCor('cor:10')).toBe('Manjericão');
    expect(nomeDaCor('label:etq1')).toBe('Etiqueta do Google');
    expect(nomeDaCor('agenda:9fc6e7')).toBe('Cor da agenda');
  });
});
