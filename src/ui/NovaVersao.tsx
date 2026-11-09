// Aviso de versão nova do app (src/pwa.ts). Só aparece depois de uma atualização
// baixada; o dono recarrega quando quiser.
import { useNovaVersao } from '../pwa';

export function NovaVersao() {
  const pronta = useNovaVersao();
  if (!pronta) return null;
  return (
    <div class="sync nova-versao" role="status">
      <span>Versão nova do app.</span>
      <button type="button" onClick={() => window.location.reload()}>
        Atualizar
      </button>
    </div>
  );
}
