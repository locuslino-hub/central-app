import { render } from 'preact';
import { App } from './App';
import { ia } from './ia/ia';
import { iniciarApp } from './inicio';

iniciarApp();

render(<App />, document.getElementById('app')!);

// A IA local abre em segundo plano, se já estiver guardada neste aparelho. O
// chat não espera por ela; nada é baixado sem o dono pedir em IA local.
void ia.iniciar();
