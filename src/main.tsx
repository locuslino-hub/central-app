import { render } from 'preact';
import { App } from './App';
import { iniciarSincronia } from './dados/sincronia';

iniciarSincronia();

render(<App />, document.getElementById('app')!);
