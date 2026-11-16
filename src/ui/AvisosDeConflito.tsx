// Conflitos que a sincronia resolveu (src/dados/loja.ts, `avisos`): a mesma coisa
// mudou em dois aparelhos e valeu a mudança mais recente. A versão que perdeu fica
// guardada; aqui o dono é avisado, com uma linha por conflito. Pode Ver o que
// perdeu, Recuperar (volta como edição nova e sincroniza) ou dar o Entendi.
import { useEffect, useRef, useState } from 'preact/hooks';
import { dispensarAviso, listarAvisos, recuperarAviso, assinar } from '../dados/loja';
import { assinarEstado } from '../dados/sincronia';
import type { Aviso } from '../dados/tipos';
import './tarefas.css';

const MOSTRAR_NO_MAXIMO = 3;

/** O nome que o dono conhece o registro: título da tarefa ou do documento, nome da pessoa ou da sala, palavra da memória. */
function rotuloDoRegistro(registro: unknown): string {
  const r = registro as Record<string, unknown> | null;
  for (const campo of ['titulo', 'nome', 'termo']) {
    const valor = r?.[campo];
    if (typeof valor === 'string' && valor.trim()) return valor;
  }
  return 'um item';
}

/** "na mesma tarefa", "na mesma pessoa"... A frase fala da mudança, não de quem a fez. */
function daMesma(colecao: string): string {
  switch (colecao) {
    case 'tarefas':
      return 'na mesma tarefa';
    case 'pessoas':
      return 'na mesma pessoa';
    case 'salas':
      return 'na mesma sala';
    case 'documentos':
      return 'no mesmo documento';
    default:
      return 'no mesmo item';
  }
}

const ROTULOS: Record<string, string> = {
  titulo: 'Título',
  nome: 'Nome',
  termo: 'Palavra',
  notas: 'Notas',
  texto: 'Texto',
  papel: 'Papel',
  url: 'Endereço',
  blocos: 'Conteúdo',
  data: 'Dia',
  semana: 'Semana',
  inicio: 'Início',
  prazoHora: 'Hora do prazo',
  duracaoMin: 'Duração (min)',
  feito: 'Feito',
  fixada: 'Fixada',
  marcar: 'Marcar',
  salaId: 'Sala',
  pessoaId: 'Pessoa',
  arquivado: 'Arquivado',
  ordem: 'Ordem',
  emails: 'E-mails',
  fimDoDia: 'Fim do dia',
};
/** Campos de controle da sincronia: não dizem nada ao dono. */
const CAMPOS_DE_CONTROLE = new Set(['id', 'atualizadoEm', 'aparelho']);

function legivel(campo: string, valor: unknown): string {
  if (valor === undefined || valor === null || valor === '') return '(vazio)';
  if (typeof valor === 'boolean') return valor ? 'sim' : 'não';
  if (typeof valor === 'string' || typeof valor === 'number') return String(valor);
  if (campo === 'blocos' && Array.isArray(valor)) {
    const textos = valor
      .map((b) => (typeof (b as { texto?: unknown })?.texto === 'string' ? (b as { texto: string }).texto : ''))
      .filter((t) => t.trim());
    if (textos.length > 0) return textos.join(' / ');
  }
  return JSON.stringify(valor);
}

/** Os campos da versão que perdeu que diferem da que ficou, ou o que ela tinha e a outra não. */
function camposDaPerdida(aviso: Aviso): { campo: string; texto: string }[] {
  const perdida = aviso.perdedora as Record<string, unknown>;
  const ficou = aviso.vencedora as Record<string, unknown>;
  const campos = Object.keys(perdida).filter(
    (campo) => !CAMPOS_DE_CONTROLE.has(campo) && JSON.stringify(perdida[campo]) !== JSON.stringify(ficou[campo]),
  );
  return campos.map((campo) => ({ campo, texto: `${ROTULOS[campo] ?? campo}: ${legivel(campo, perdida[campo])}` }));
}

function useAvisos(): [Aviso[], () => Promise<unknown>] {
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const ativo = useRef(true);
  const ler = () =>
    listarAvisos()
      .then((lista) => ativo.current && setAvisos(lista))
      .catch((erro: unknown) => console.error('Não consegui ler os avisos', erro));
  useEffect(() => {
    ativo.current = true;
    void ler();
    // Chega junto com a escrita que resolveu o conflito (assinar) ou no fim da rodada (estado da sincronia).
    const pararLoja = assinar(() => void ler());
    const pararEstado = assinarEstado(() => void ler());
    return () => {
      ativo.current = false;
      pararLoja();
      pararEstado();
    };
  }, []);
  return [avisos, ler];
}

export function AvisosDeConflito() {
  const [avisos, recarregar] = useAvisos();
  const [falha, setFalha] = useState(false);
  const [falhaAoRecuperar, setFalhaAoRecuperar] = useState(false);
  const [abertos, setAbertos] = useState<ReadonlySet<number>>(new Set());
  if (avisos.length === 0) return null;
  // Os mais novos primeiro.
  const ordenados = [...avisos].sort((a, b) => b.criadoEm - a.criadoEm || b.id - a.id);
  const mostrados = ordenados.slice(0, MOSTRAR_NO_MAXIMO);
  const faltam = ordenados.length - mostrados.length;

  function alternar(id: number) {
    setAbertos((antes) => {
      const depois = new Set(antes);
      if (!depois.delete(id)) depois.add(id);
      return depois;
    });
  }

  async function recuperar(aviso: Aviso) {
    setFalhaAoRecuperar(false);
    try {
      await recuperarAviso(aviso.id);
      await recarregar();
    } catch (erro) {
      console.error('Não consegui recuperar o aviso', erro);
      setFalhaAoRecuperar(true);
    }
  }

  async function entendi(aviso: Aviso) {
    setFalha(false);
    try {
      await dispensarAviso(aviso.id);
      await recarregar();
    } catch (erro) {
      console.error('Não consegui dispensar o aviso', erro);
      setFalha(true);
    }
  }

  return (
    <section class="avisos-de-conflito" aria-label="Avisos de mudanças">
      <ul class="avisos-lista">
        {mostrados.map((aviso) => {
          const titulo = rotuloDoRegistro(aviso.perdedora);
          const aberto = abertos.has(aviso.id);
          return (
            <li key={aviso.id} class="aviso-de-conflito">
              <span>{`Duas mudanças ${daMesma(aviso.colecao)}; ficou a mais recente. A outra era: ${titulo}`}</span>
              <button
                type="button"
                class="tarefa-entendi"
                aria-label={`Ver: ${titulo}`}
                aria-expanded={aberto}
                onClick={() => alternar(aviso.id)}
              >
                Ver
              </button>
              <button
                type="button"
                class="tarefa-entendi"
                aria-label={`Recuperar: ${titulo}`}
                onClick={() => void recuperar(aviso)}
              >
                Recuperar
              </button>
              <button
                type="button"
                class="tarefa-entendi"
                aria-label={`Entendi: ${titulo}`}
                onClick={() => void entendi(aviso)}
              >
                Entendi
              </button>
              {aberto && (
                <ul class="aviso-perdida">
                  {camposDaPerdida(aviso).map(({ campo, texto }) => (
                    <li key={campo}>{texto}</li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {faltam > 0 && <p class="avisos-mais">{`Mais ${faltam} ${faltam === 1 ? 'aviso' : 'avisos'} como este.`}</p>}
      {falha && <p class="tarefa-erro">Não consegui tirar o aviso. Tente de novo.</p>}
      {falhaAoRecuperar && <p class="tarefa-erro">Não consegui recuperar. Tente de novo.</p>}
    </section>
  );
}
