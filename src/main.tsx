import { render } from 'preact';
import { App } from './App';
import { semear } from './dados/loja';
import { iniciarSincronia } from './dados/sincronia';

// As salas iniciais existem desde a primeira abertura, para o menu já listá-las.
semear().catch((erro: unknown) => console.error('Não consegui criar as salas iniciais', erro));
iniciarSincronia();

render(<App />, document.getElementById('app')!);
