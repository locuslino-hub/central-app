// Cores do Google (spec 2026-11-09, sala pela cor): as cores e etiquetas que
// aparecem nos eventos dos últimos e dos próximos 60 dias, mais as 11 cores de
// evento do Google (para ligar uma cor ainda sem evento a uma sala nova), cada uma com a
// amostra, quantos eventos têm e até 2 títulos de exemplo, e um seletor de
// sala. O dono liga uma vez; depois os compromissos daquela cor ganham a sala
// em todas as telas (a sala gravada pela Central ainda vale antes, e a
// adivinhação pelo título vem depois). "Sem sala" desfaz a ligação.
import { useMemo, useState } from 'preact/hooks';
import { somarDias } from '../chat/datas';
import { coresParaLigar, ligarCor, mapaDeCores, nomeDaCor, type CorVista } from '../dados/cores';
import type { Sala } from '../dados/tipos';
import { AvisoDaAgenda } from './AvisoDaAgenda';
import { useCoresDasSalas, useDia, useSalas } from './hooks';
import { useEventos } from './useEventos';
import './salas.css';

/** Quantos dias para trás e para a frente a tela olha. */
export const DIAS_DAS_CORES = 60;

const nEventos = (n: number) => `${n} ${n === 1 ? 'evento' : 'eventos'}`;

type LinhaProps = { cor: CorVista; salaId: string | null; salas: Sala[]; aoLigar: (salaId: string | null) => void };

function LinhaDaCor({ cor, salaId, salas, aoLigar }: LinhaProps) {
  const base = `cor-${cor.chave.replace(/[^A-Za-z0-9_-]/g, '-')}`;
  const nome = nomeDaCor(cor.chave);
  return (
    <li>
      <div class="cor-linha" role="group" aria-labelledby={`${base}-nome`}>
        <span class="cor-amostra" aria-hidden="true" style={{ background: cor.hex }} />
        <div class="cor-texto">
          <span id={`${base}-nome`} class="cor-nome">
            {nome}
            <span class="so-leitor">{`, ${cor.hex}`}</span>
          </span>
          <span class="cor-conta">{cor.quantos === 0 ? 'Nenhum evento nestes meses' : nEventos(cor.quantos)}</span>
          {cor.exemplos.length > 0 && <span class="cor-exemplos">{`Ex.: ${cor.exemplos.join(' · ')}`}</span>}
        </div>
        <div class="cor-escolha">
          <label class="cor-rotulo" for={`${base}-sala`}>
            Sala
          </label>
          <select id={`${base}-sala`} class="campo" value={salaId ?? ''} onChange={(e) => aoLigar((e.currentTarget.value || null) as string | null)}>
            <option value="">Escolher sala</option>
            {salas.map((sala) => (
              <option key={sala.id} value={sala.id}>
                {sala.nome}
              </option>
            ))}
          </select>
          <button type="button" class="botao" disabled={salaId === null} onClick={() => aoLigar(null)}>
            Sem sala
          </button>
        </div>
      </div>
    </li>
  );
}

export function CoresDoGoogle() {
  const hoje = useDia();
  const salas = useSalas();
  const registros = useCoresDasSalas();
  const de = somarDias(hoje, -DIAS_DAS_CORES);
  const ate = somarDias(hoje, DIAS_DAS_CORES);
  const { leitura, atualizar } = useEventos(de, ate);
  const [falhou, setFalhou] = useState(false);

  const vistas = useMemo(() => coresParaLigar(leitura.eventos, registros), [leitura.eventos, registros]);
  const ligadas = useMemo(() => mapaDeCores(registros), [registros]);
  const lido = leitura.lidoEm !== null;

  const ligar = (chave: string, salaId: string | null) => {
    setFalhou(false);
    ligarCor(chave, salaId).catch((erro: unknown) => {
      console.error('Não consegui guardar a cor', erro);
      setFalhou(true);
    });
  };

  return (
    <section class="painel cores-google" aria-labelledby="titulo-cores" aria-busy={!lido && leitura.falha === null}>
      <h2 id="titulo-cores">Cores da sua agenda</h2>
      <p class="cores-intro">
        Escolha a sala de cada cor uma vez: os compromissos dessa cor passam a aparecer na sala, em todas as telas.
        Um compromisso com sala escolhida na Central continua na dele.
      </p>
      <AvisoDaAgenda leitura={leitura} aoTentar={atualizar} />
      {lido && !vistas.some((v) => v.quantos > 0) && (
        <div>
          <p class="lista-vazia-titulo">Nenhuma cor nos eventos destes meses.</p>
          <p class="lista-vazia-texto">Você já pode ligar as cores do Google a salas; elas valem para os próximos eventos.</p>
        </div>
      )}
      {vistas.length > 0 && (
        <ul class="cores-lista">
          {vistas.map((cor) => (
            <LinhaDaCor key={cor.chave} cor={cor} salaId={ligadas.get(cor.chave) ?? null} salas={salas} aoLigar={(salaId) => ligar(cor.chave, salaId)} />
          ))}
        </ul>
      )}
      {falhou && <p class="tarefa-erro">Não consegui guardar. Tente de novo.</p>}
    </section>
  );
}
