// O que o app liga ao abrir (chamado por main.tsx). Fica fora de main.tsx para
// poder ser testado: main.tsx só liga isto e desenha a tela.
import { lerConexao } from './conexao/guarda';
import { enfileirarEspelhosQueFaltam, semear, semearPalavras } from './dados/loja';
import { migrarCompromissos } from './dados/migrar';
import { iniciarSincronia, sincronizar } from './dados/sincronia';
import { iniciarVirada } from './dados/virada';

/** Pede ao navegador que não apague os dados do app quando faltar espaço. Sem resposta na tela. */
function pedirArmazenamentoPersistente() {
  try {
    void navigator.storage?.persist?.()?.catch(() => {});
  } catch {
    // Navegador sem a API: o app segue igual.
  }
}

export function iniciarApp() {
  // As salas iniciais existem desde a primeira abertura, para o menu já listá-las.
  semear().catch((erro: unknown) => console.error('Não consegui criar as salas iniciais', erro));
  // As palavras que a memória do chat já conhece ("banheiro" é Casa...).
  semearPalavras().catch((erro: unknown) => console.error('Não consegui criar as palavras iniciais', erro));
  // Compromissos que o chat guardava como tarefa com hora vão para o Google Agenda (uma vez, sem duplicar).
  migrarCompromissos().catch((erro: unknown) => console.error('Não consegui levar os compromissos para a agenda', erro));
  // Tarefas abertas sem espelho no Google Tarefas (de antes do espelho) entram na fila uma vez.
  enfileirarEspelhosQueFaltam().catch((erro: unknown) => console.error('Não consegui pôr as tarefas no espelho', erro));
  iniciarSincronia();
  // Vira o dia ao abrir, na meia-noite e ao voltar ao app. Sincroniza antes de virar:
  // este aparelho pode ter ficado dias fechado, e virar em cima de uma cópia velha
  // desfaria o que o outro aparelho mudou nesse tempo.
  iniciarVirada({
    antes: () => sincronizar(),
    conectado: async () => {
      try {
        return (await lerConexao()) != null;
      } catch {
        return false;
      }
    },
  });
  pedirArmazenamentoPersistente();
}
