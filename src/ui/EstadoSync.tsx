// Estado da sincronia sempre em texto (o ponto colorido só reforça).
import { useEffect, useState } from 'preact/hooks';
import { assinarEstado, estadoAtual, type EstadoSync } from '../dados/sincronia';

export const TEXTO_DO_ESTADO: Record<EstadoSync, string> = {
  atualizado: 'Atualizado',
  atualizando: 'Atualizando…',
  'sem-internet': 'Sem internet',
  'por-enviar': 'Por enviar',
  'erro-codigo': 'Problema com o código do aparelho',
};

export function EstadoDaSincronia() {
  const [estado, setEstado] = useState<EstadoSync>(estadoAtual);
  useEffect(() => {
    setEstado(estadoAtual());
    return assinarEstado(setEstado);
  }, []);

  const texto = TEXTO_DO_ESTADO[estado];
  return (
    <p class="sync" role="status" data-estado={estado}>
      <span class="ponto" aria-hidden="true" />
      <span class="so-leitor">Sincronização: </span>
      {estado === 'erro-codigo' ? <a href="#/conectar">{texto}</a> : <span>{texto}</span>}
    </p>
  );
}
