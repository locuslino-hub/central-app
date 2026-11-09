// O que o Painel do dia e o Agora leem juntos (Tarefa 16): a fila A seguir, o
// tempo livre até o próximo compromisso e o que cabe nele. As contas são as
// de dados/fila.ts (puras); aqui só se juntam os dados vivos.
//
// Os eventos de hoje vêm de `useEventos(hoje, hoje)`: enquanto o Painel ou o
// Agora estão abertos, a agenda de hoje fica sendo lida (ao abrir, ao voltar
// ao app e a cada 15 minutos), e o tempo livre conta com ela.
import { useMemo } from 'preact/hooks';
import type { LeituraDeEmails } from '../dados/emails';
import type { Leitura } from '../dados/eventos';
import { diaFechado } from '../dados/fechar-dia';
import { cabeAgora, calcularFila, calcularTempoLivre, FIM_DO_DIA_PADRAO, type Encaixe, type ItemFila, type TempoLivre } from '../dados/fila';
import type { Config, EstadoEmail, Tarefa } from '../dados/tipos';
import { useAgora, useConfig, useDia, useEstadosDeEmail, useTarefas } from './hooks';
import { useEmails } from './useEmails';
import { useEventos } from './useEventos';

export type AgoraDoDia = {
  hoje: string;
  agora: Date;
  tarefas: Tarefa[] | undefined;
  estados: EstadoEmail[] | undefined;
  emails: LeituraDeEmails;
  eventos: Leitura;
  tentarAgenda: () => void;
  config: Config | undefined;
  /** `HH:MM`. */
  fimDoDia: string;
  /** O dono já deu o passo final de Fechar o dia hoje. */
  fechado: boolean;
  /** `undefined` enquanto as tarefas e os estados dos e-mails são lidos. */
  fila: ItemFila[] | undefined;
  livre: TempoLivre;
  /**
   * A agenda de hoje já chegou alguma vez. Antes disso o app não sabe quanto
   * tempo livre há, e não diz "Cabe agora" (seria prometer o que não sabe).
   */
  livreConhecido: boolean;
  /** Por chave do item: cabe agora ou fica para depois. Vazio enquanto o tempo livre não é conhecido. */
  encaixes: ReadonlyMap<string, Encaixe>;
  /** O dono marcou este e-mail como Feito (então não há mais o que responder). */
  emailFeito: (id: string) => boolean;
};

export function useAgoraDoDia(): AgoraDoDia {
  const hoje = useDia();
  const agora = useAgora();
  const tarefas = useTarefas();
  const estados = useEstadosDeEmail();
  const config = useConfig();
  const { leitura: emails } = useEmails();
  const { leitura: eventos, atualizar: tentarAgenda } = useEventos(hoje, hoje);
  const fimDoDia = config?.fimDoDia ?? FIM_DO_DIA_PADRAO;

  const fila = useMemo(
    () =>
      tarefas === undefined || estados === undefined
        ? undefined
        : calcularFila({ agora, tarefas, emails: emails.emails, estadosEmail: estados }),
    [agora, tarefas, estados, emails.emails],
  );
  const livre = useMemo(() => calcularTempoLivre({ agora, eventos: eventos.eventos, fimDoDia }), [agora, eventos.eventos, fimDoDia]);
  const livreConhecido = eventos.lidoEm !== null;
  const encaixes = useMemo(
    () => new Map(fila && livreConhecido ? cabeAgora(fila, livre.minutos).map((e) => [e.item.chave, e]) : []),
    [fila, livre.minutos, livreConhecido],
  );
  const feitos = useMemo(() => new Set((estados ?? []).filter((e) => e.feito && !e.apagado).map((e) => e.id)), [estados]);

  return {
    hoje,
    agora,
    tarefas,
    estados,
    emails,
    eventos,
    tentarAgenda,
    config,
    fimDoDia,
    fechado: diaFechado(config, hoje),
    fila,
    livre,
    livreConhecido,
    encaixes,
    emailFeito: (id) => feitos.has(id),
  };
}
