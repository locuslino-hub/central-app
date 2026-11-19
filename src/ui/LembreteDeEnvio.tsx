// O lembrete do envio da leitura ao portal (V02, Tarefa 13): quando falta pouco para o dia de envio de uma pasta de
// Registro (água, luz, gás), uma faixa avisa. Na pasta (`FaixaDeEnvio`) e no Hoje, sob os avisos do app, no padrão
// do cartão da água (`LembretesDeEnvio`, com link para a pasta). Só mostra quando faltam até 3 dias; sem dia de envio, nada.
import { lembreteDeEnvio } from '../dados/leituras';
import { SALA_CASA } from '../dados/pastas';
import type { Pasta } from '../dados/tipos';
import { hrefDe } from '../rotas';
import { useDia, usePastasDaSala } from './hooks';
import { NOME_DO_SERVICO, textoDoLembreteDeEnvio } from './pastas-textos';

const nomeDoServico = (pasta: Pasta) => (pasta.servico ? NOME_DO_SERVICO[pasta.servico] : pasta.nome);

/** A faixa dentro da pasta de Registro. */
export function FaixaDeEnvio({ pasta }: { pasta: Pasta }) {
  const hoje = useDia();
  const lembrete = lembreteDeEnvio(pasta, hoje);
  if (!lembrete) return null;
  return (
    <p class="registro-lembrete" role="note">
      {textoDoLembreteDeEnvio(nomeDoServico(pasta), lembrete.diasFaltando, lembrete.dia)}
    </p>
  );
}

/** No Hoje: uma linha por pasta da Casa que está perto do envio, com link para a pasta. */
export function LembretesDeEnvio() {
  const hoje = useDia();
  const pastas = usePastasDaSala(SALA_CASA) ?? [];
  const lembretes = pastas.flatMap((pasta) => {
    const lembrete = lembreteDeEnvio(pasta, hoje);
    return lembrete ? [{ pasta, ...lembrete }] : [];
  });
  if (lembretes.length === 0) return null;
  return (
    <ul class="registro-lembretes" aria-label="Envio de leituras">
      {lembretes.map(({ pasta, diasFaltando, dia }) => (
        <li key={pasta.id}>
          <a class="registro-lembrete" href={hrefDe('pasta', SALA_CASA, pasta.id)}>
            {textoDoLembreteDeEnvio(nomeDoServico(pasta), diasFaltando, dia)}
          </a>
        </li>
      ))}
    </ul>
  );
}
