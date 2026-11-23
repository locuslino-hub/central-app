// A pasta comum (V02, Tarefa 17): o que é de um tema numa sala, só nos dados da Central (sem planilha).
// Três partes: Tarefas (as do tema, `pastaId`), Notas (as notas independentes do tema, de texto ou de lista) e Documentos (links do tema).
// Cada parte é a mesma da sala, filtrada pelo tema; o que se cria aqui já nasce ligado a ele.
//
// O tema só aponta para a pasta: tarefa, nota e documento seguem sendo da sala (Painel, Checklist, caixa e caderno
// da sala os mostram como sempre). Apagar a pasta não regrava nada: o `pastaId` fica sem uso e nada some.
import { useEffect } from 'preact/hooks';
import type { Pasta } from '../dados/tipos';
import { guardarUltimaPasta } from './ultima-pasta';
import { BotaoBlocoFlutuante } from './bloco-flutuante';
import { Documentos } from './Documentos';
import { useDia, useSalas, useTarefas } from './hooks';
import { AvisoDeApagada, useConclusoes } from './LinhaDeTarefa';
import { ListaDeTarefas } from './ListaDeTarefas';
import { NovaTarefa } from './NovaTarefa';
import { QuadroDeNotas } from './QuadroDeNotas';
import './pastas.css';
import './salas.css';

export function PastaComum({ pasta }: { pasta: Pasta }) {
  const hoje = useDia();
  const salas = useSalas();
  const tarefas = useTarefas();
  const conclusoes = useConclusoes();
  const nomeDaSala = salas.find((sala) => sala.id === pasta.salaId)?.nome ?? 'esta sala';
  const doTema = (tarefas ?? []).filter((tarefa) => tarefa.pastaId === pasta.id && tarefa.salaId === pasta.salaId && !tarefa.apagado);
  const abertas = doTema.filter((tarefa) => !tarefa.feito);
  useEffect(() => guardarUltimaPasta(pasta.salaId, pasta.id), [pasta.salaId, pasta.id]);

  return (
    <div class="pasta-comum" role="group" aria-label="Notas, tarefas e documentos" data-tipo="comum">
      <BotaoBlocoFlutuante variante="pasta" />
      <QuadroDeNotas salaId={pasta.salaId} pastaId={pasta.id} titulo={`Notas · ${pasta.nome}`} />
      <div class="sala-grade">
        <div class="sala-coluna">
          <section class="painel sala-tarefas" aria-labelledby="titulo-pasta-tarefas" aria-busy={tarefas === undefined}>
            <h2 id="titulo-pasta-tarefas">Tarefas</h2>
            <NovaTarefa rotulo={`Nova tarefa em ${pasta.nome}`} salaId={pasta.salaId} data={hoje} pastaId={pasta.id} />
            <AvisoDeApagada conclusoes={conclusoes} />
            {tarefas !== undefined && abertas.length === 0 && (
              <div>
                <p class="lista-vazia-titulo">Nada em aberto neste tema.</p>
                <p class="lista-vazia-texto">{`Escreva uma tarefa acima ou diga no Chat: "nas tarefas do tema ${pasta.nome}". Ela fica em ${nomeDaSala}.`}</p>
              </div>
            )}
            <ListaDeTarefas tarefas={doTema} salas={salas} hoje={hoje} conclusoes={conclusoes} prefixo="pasta-tarefas" />
          </section>
        </div>
        <div class="sala-coluna">
          <Documentos de="deste tema" salaId={pasta.salaId} pastaId={pasta.id} nomeDaPasta={pasta.nome} />
        </div>
      </div>
    </div>
  );
}
