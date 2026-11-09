// O que o dono já fez com cada e-mail do Por responder, guardado por id da
// mensagem (coleção `estadosEmail`, que sincroniza entre os aparelhos):
//   - "Feito": o e-mail some da lista (`feito: true`);
//   - "Agora não": volta no dia seguinte (`adiadaAte`, dia de Lisboa).
// Só id e data ficam guardados: nunca remetente, assunto nem trecho. Estados
// com mais de 15 dias são apagados: a busca do Gmail só olha os últimos 14.
//
// Nada aqui chama o script: Feito e Agora não só mudam a Central. O Gmail
// nunca é alterado.
import { somarDias } from '../chat/datas';
import { desfazer, type Desfazivel } from './desfazer';
import { apagar, lerRegistros, listar, salvar } from './loja';
import { criarTarefa } from './tarefas';
import type { Email } from './emails';
import type { EstadoEmail, Tarefa } from './tipos';

export const DIAS_DE_ESTADO = 15;
const DIA_MS = 24 * 60 * 60 * 1000;

/** O e-mail aparece hoje? Fora quem está Feito e quem foi adiado para depois de hoje. */
export function aparece(estado: EstadoEmail | undefined, hoje: string): boolean {
  if (!estado || estado.apagado) return true;
  if (estado.feito) return false;
  return estado.adiadaAte === undefined || estado.adiadaAte <= hoje;
}

async function estadoDe(id: string): Promise<EstadoEmail | undefined> {
  const [registro] = await lerRegistros([{ colecao: 'estadosEmail', id }]);
  return registro as EstadoEmail | undefined;
}

/** Volta o estado ao que era (inclusive "sem estado"). */
function devolver(id: string, antes: EstadoEmail | undefined) {
  return async () => {
    if (antes) await salvar('estadosEmail', antes);
    else await apagar('estadosEmail', id);
  };
}

async function gravar(id: string, novo: { feito: boolean; adiadaAte?: string }, rotulo: string): Promise<Desfazivel> {
  const antes = await estadoDe(id);
  await salvar('estadosEmail', { id, feito: novo.feito, ...(novo.adiadaAte !== undefined ? { adiadaAte: novo.adiadaAte } : {}) });
  return desfazer.registrar(rotulo, devolver(id, antes));
}

/** Feito: o e-mail sai da lista. Só a Central muda; o Gmail continua como está. */
export function concluirEmail(id: string): Promise<Desfazivel> {
  return gravar(id, { feito: true }, 'E-mail marcado como feito');
}

/** Agora não: o e-mail volta amanhã (`hoje` é o dia de Lisboa, `AAAA-MM-DD`). */
export function adiarEmail(id: string, hoje: string): Promise<Desfazivel> {
  return gravar(id, { feito: false, adiadaAte: somarDias(hoje, 1) }, 'E-mail adiado para amanhã');
}

/** Apaga os estados com mais de 15 dias. Devolve quantos. */
export async function podarEstados(agora = Date.now()): Promise<number> {
  const velhos = (await listar('estadosEmail')).filter((estado) => agora - estado.atualizadoEm > DIAS_DE_ESTADO * DIA_MS);
  await Promise.all(velhos.map((estado) => apagar('estadosEmail', estado.id)));
  return velhos.length;
}

// ---- Virar tarefa ----

/** "Responder: assunto", curto; sem assunto, "Responder a quem enviou". */
export function tituloDaTarefa(email: Pick<Email, 'assunto' | 'remetente'>): string {
  const assunto = email.assunto.trim().replace(/\s+/g, ' ');
  if (assunto) return `Responder: ${assunto.length > 80 ? `${assunto.slice(0, 79).trimEnd()}…` : assunto}`;
  const remetente = email.remetente.trim();
  return remetente ? `Responder a ${remetente}` : 'Responder e-mail';
}

export type TarefaDoEmail = { tarefa: Tarefa; entrada: Desfazivel | undefined };

/**
 * Cria a tarefa do e-mail, com `emailId` (o vínculo), a sala e a pessoa de quem
 * enviou. Sem prazo: o dono escolhe quando em Sem prazo. Se o e-mail já tem uma
 * tarefa viva, devolve essa, sem `entrada` (não criou nada). O Gmail não muda.
 */
export async function virarTarefa(
  email: Pick<Email, 'id' | 'assunto' | 'remetente'>,
  contexto: { salaId: string | null; pessoaId?: string },
): Promise<TarefaDoEmail | undefined> {
  const existente = (await listar('tarefas')).find((tarefa) => tarefa.emailId === email.id);
  if (existente) return { tarefa: existente, entrada: undefined };
  const tarefa = await criarTarefa(tituloDaTarefa(email), {
    salaId: contexto.salaId,
    ...(contexto.pessoaId !== undefined ? { pessoaId: contexto.pessoaId } : {}),
    emailId: email.id,
  });
  if (!tarefa) return undefined;
  const entrada = desfazer.registrar('Tarefa criada do e-mail', async () => {
    await apagar('tarefas', tarefa.id);
  });
  return { tarefa, entrada };
}
