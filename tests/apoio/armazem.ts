// Armazém do script na memória: o mesmo papel do Drive + LockService em Codigo.ts.
import { Ocupado, type Armazem } from '../../script/dados';

export type ArmazemDeTeste = Armazem & {
  conteudo: string | null;
  copias: Map<string, { nome: string; conteudo: string }>;
  marcada: string | null;
  relogio: number;
  dia: string;
  ocupado: boolean;
  dentroDaTrava: boolean;
  gravacoes: { conteudo: string; naTrava: boolean }[];
};

export function armazemNaMemoria(inicial: Partial<ArmazemDeTeste> = {}): ArmazemDeTeste {
  let proximaCopia = 0;
  const armazem: ArmazemDeTeste = {
    conteudo: null,
    copias: new Map(),
    marcada: null,
    relogio: Date.parse('2026-11-05T12:20:00Z'),
    dia: '2026-11-05',
    ocupado: false,
    dentroDaTrava: false,
    gravacoes: [],
    ler() {
      return armazem.conteudo;
    },
    gravar(conteudo) {
      armazem.gravacoes.push({ conteudo, naTrava: armazem.dentroDaTrava });
      armazem.conteudo = conteudo;
    },
    comTrava(fazer) {
      if (armazem.ocupado) throw new Ocupado();
      armazem.dentroDaTrava = true;
      try {
        return fazer();
      } finally {
        armazem.dentroDaTrava = false;
      }
    },
    agora() {
      return armazem.relogio;
    },
    hoje() {
      return armazem.dia;
    },
    ultimaCopia() {
      return armazem.marcada;
    },
    marcarCopia(dia) {
      armazem.marcada = dia;
    },
    copiar(nome, conteudo) {
      proximaCopia += 1;
      armazem.copias.set(`copia-${proximaCopia}`, { nome, conteudo });
    },
    listarCopias() {
      return [...armazem.copias].map(([id, { nome }]) => ({ id, nome }));
    },
    descartar(id) {
      armazem.copias.delete(id);
    },
    ...inicial,
  };
  return armazem;
}
