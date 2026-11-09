import { render } from 'preact';
import { App } from './App';
import { semear, semearPalavras } from './dados/loja';
import { iniciarSincronia, sincronizar } from './dados/sincronia';
import { iniciarVirada } from './dados/virada';

// As salas iniciais existem desde a primeira abertura, para o menu já listá-las.
semear().catch((erro: unknown) => console.error('Não consegui criar as salas iniciais', erro));
// As palavras que a memória do chat já conhece ("banheiro" é Casa...).
semearPalavras().catch((erro: unknown) => console.error('Não consegui criar as palavras iniciais', erro));
iniciarSincronia();
// Vira o dia ao abrir, na meia-noite e ao voltar ao app. Sincroniza antes de virar:
// este aparelho pode ter ficado dias fechado, e virar em cima de uma cópia velha
// desfaria o que o outro aparelho mudou nesse tempo.
iniciarVirada({ antes: () => sincronizar() });

render(<App />, document.getElementById('app')!);
