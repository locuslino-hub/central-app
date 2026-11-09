// O passo final de Fechar o dia (Tarefa 16). Fechar só marca o dia como
// fechado: as tarefas que ficaram abertas voltam amanhã sozinhas (virada do
// dia) e os e-mails continuam no Por responder. A marca fica nos ajustes, que
// sincronizam: o dia fechado no notebook aparece fechado no celular.
import { desfazer, type Desfazivel } from './desfazer';
import { lerConfig, salvar } from './loja';
import type { Config } from './tipos';

/** O dia `hoje` (`AAAA-MM-DD`) já foi fechado? No dia seguinte, não: cada dia começa aberto. */
export function diaFechado(config: Pick<Config, 'diaFechado'> | undefined, hoje: string): boolean {
  return config?.diaFechado === hoje;
}

/**
 * Fecha o dia e devolve a entrada do desfazer, que reabre. Desfazer volta só a
 * marca do dia fechado: o fim do dia, mesmo que mude nesse meio tempo, fica.
 */
export async function fecharDia(hoje: string): Promise<Desfazivel> {
  const atual = await lerConfig();
  const anterior = atual.diaFechado;
  await salvar('config', { ...atual, diaFechado: hoje });
  return desfazer.registrar('Dia fechado', async () => {
    const { diaFechado: _fechado, ...resto } = await lerConfig();
    await salvar('config', anterior === undefined ? resto : { ...resto, diaFechado: anterior });
  });
}

/** "Reabrir o dia", quando o fechamento não é mais o último Desfazer (o app foi aberto de novo). */
export async function reabrirDia(): Promise<void> {
  const { diaFechado: _fechado, ...resto } = await lerConfig();
  await salvar('config', resto);
}
