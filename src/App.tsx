import { useEffect, useState } from 'preact/hooks';
import { Conectar } from './ui/Conectar';

export function App() {
  const [hash, setHash] = useState(location.hash);

  useEffect(() => {
    const atualizar = () => setHash(location.hash);
    addEventListener('hashchange', atualizar);
    return () => removeEventListener('hashchange', atualizar);
  }, []);

  if (hash === '#/conectar') return <Conectar />;

  return (
    <>
      <h1>Central de Comando</h1>
      <a href="#/conectar">Conectar aparelho</a>
    </>
  );
}
