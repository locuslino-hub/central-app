import { render } from 'preact';
import { App } from './App';
import { iniciarApp } from './inicio';

iniciarApp();

render(<App />, document.getElementById('app')!);
