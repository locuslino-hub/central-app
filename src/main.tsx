import { render } from 'preact';
import { App } from './App';
import { ia } from './ia/ia';
import { iniciarApp } from './inicio';
import { registrarServiceWorker } from './pwa';

iniciarApp();

render(<App />, document.getElementById('app')!);

// A IA local abre em segundo plano, se já estiver guardada neste aparelho. O
// chat não espera por ela; nada é baixado sem o dono pedir em IA local.
void ia.iniciar();

// App guardado no aparelho (abre sem internet). Só na versão publicada: no `npm run dev` o
// service worker não existe e atrapalharia a edição.
if (import.meta.env.PROD) registrarServiceWorker();
