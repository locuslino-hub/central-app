import { render } from 'preact';
import { App } from './App';
import { semear, semearPalavras } from './dados/loja';
import { iniciarSincronia } from './dados/sincronia';

// As salas iniciais existem desde a primeira abertura, para o menu já listá-las.
semear().catch((erro: unknown) => console.error('Não consegui criar as salas iniciais', erro));
// As palavras que a memória do chat já conhece ("banheiro" é Casa...).
semearPalavras().catch((erro: unknown) => console.error('Não consegui criar as palavras iniciais', erro));
iniciarSincronia();

render(<App />, document.getElementById('app')!);
