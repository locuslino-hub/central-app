// O contador de água (Tarefa 26): o cartão completo da coluna direita (e do topo
// do Agora no celular e no tablet) e a versão curta, para quando o chat está aberto.
// As contas são de dados/agua.ts (puras); aqui só se juntam os dados vivos e o desenho.
// O selo, o quadro de dica e os botões ¼ ½ ¾ Toda também servem à página expandida (AguaPagina.tsx).
// Regras e textos: docs/superpowers/specs/2026-11-09-agua.md (cartão completo, versão curta).
import { useId, useState } from 'preact/hooks';
import {
  FIM_MIN,
  GARRAFA_ML,
  INICIO_MIN,
  META_ML,
  garrafaDaVez,
  goleDeHoje,
  situacao,
  type Fracao,
  type Situacao,
} from '../dados/agua';
import { hojeEmLisboa, minutoEmLisboa } from '../dados/dia';
import { apagar, listar, salvar } from '../dados/loja';
import type { AguaRegistro } from '../dados/tipos';
import { useAgora, useAgua, useDia } from './hooks';
import { Icone } from './icones';
import './agua.css';

// ---- Pequenas peças ----

/** Número do jeito do Brasil: `2.000`. */
export const n = (ml: number) => ml.toLocaleString('pt-BR');

/** `HH:MM`, de minutos desde 00:00. */
export const hm = (minuto: number) => `${String(Math.floor(minuto / 60)).padStart(2, '0')}:${String(Math.round(minuto % 60)).padStart(2, '0')}`;

const BOTOES: readonly { fracao: Fracao; nome: string }[] = [
  { fracao: 0.25, nome: '¼' },
  { fracao: 0.5, nome: '½' },
  { fracao: 0.75, nome: '¾' },
  { fracao: 1, nome: 'Toda' },
];

/** Uma garrafinha com `fracao` (0 a 1) cheia. Só desenho: o texto ao lado diz tudo. */
export function Garrafinha({ fracao, cor = 'azul' }: { fracao: number; cor?: 'azul' | 'coral' }) {
  const id = useId();
  const cheia = Math.max(0, Math.min(1, fracao));
  const contorno = 'M5 1h4v3q4 2 4 6v12q0 1.5-1.5 1.5h-9Q1 23.5 1 22V10q0-4 4-6z';
  return (
    <svg class={`garrafinha garrafinha-${cor}`} viewBox="0 0 14 24" aria-hidden="true" focusable="false" data-cor={cor} data-fracao={String(cheia)}>
      <defs>
        <clipPath id={`${id}-recorte`}>
          <path d={contorno} />
        </clipPath>
      </defs>
      <path class="garrafinha-vidro" d={contorno} />
      <rect class="garrafinha-liquido" x="0" y={23 - 19 * cheia} width="14" height="24" clip-path={`url(#${id}-recorte)`} />
    </svg>
  );
}

// ---- Registrar e desfazer ----

/** Salva um gole: o dia e a hora são os de Lisboa, de `agora`. */
export async function registrarGole(ml: number, agora: Date = new Date()): Promise<void> {
  await salvar('agua', { data: hojeEmLisboa(agora), hora: hm(minutoEmLisboa(agora)), ml });
}

/** Apaga o último gole do dia `dia` (o de hora mais alta). Sem gole nesse dia, não faz nada. */
export async function desfazerUltimoGole(dia: string): Promise<void> {
  const doDia = goleDeHoje(await listar('agua'), dia);
  const ultimo = doDia[doDia.length - 1];
  if (ultimo) await apagar('agua', ultimo.id);
}

// ---- O que os dois cartões leem ----

export type AguaDoDia = {
  dia: string;
  minuto: number;
  total: number;
  /** Todos os registros guardados (de todos os dias, apagados fora do alcance de `goleDeHoje`). Vazio enquanto lê. */
  registros: readonly AguaRegistro[];
  /**
   * A loja ainda está lendo. Os números valem 0, mas "Atrás", a dica, o botão sugerido e o histórico seriam falsos:
   * quem desenha esconde isso (guardando a altura) até os dados chegarem.
   */
  carregando: boolean;
  /** Os goles de hoje, por hora crescente. */
  doDia: readonly AguaRegistro[];
  /** O último gole de hoje (o que o Desfazer tira). */
  ultimo: AguaRegistro | undefined;
  sit: Situacao;
  /** 0 a 100, arredondado. */
  porcento: number;
  registrar: (ml: number) => void;
  desfazer: () => void;
  /** Aviso se não deu para gravar. */
  erro: string;
};

export function useAguaDoDia(): AguaDoDia {
  const registros = useAgua();
  const dia = useDia();
  const agora = useAgora();
  const [erro, setErro] = useState('');
  // O relógio do minuto pode atrasar um pouco depois da meia-noite; se o dia já virou, vale o instante de agora.
  const instante = hojeEmLisboa(agora) === dia ? agora : new Date();
  const minuto = minutoEmLisboa(instante);
  const lista = registros ?? [];
  const doDia = goleDeHoje(lista, dia);
  const total = doDia.reduce((soma, gole) => soma + gole.ml, 0);

  const agir = (acao: () => Promise<void>, falha: string) => {
    setErro('');
    acao().catch(() => setErro(falha));
  };

  return {
    dia,
    minuto,
    total,
    registros: lista,
    carregando: registros === undefined,
    doDia,
    ultimo: doDia[doDia.length - 1],
    sit: situacao(total, minuto),
    porcento: Math.min(100, Math.round((total / META_ML) * 100)),
    registrar: (ml) => agir(() => registrarGole(ml), 'Não consegui registrar. Tente de novo.'),
    desfazer: () => agir(() => desfazerUltimoGole(dia), 'Não consegui desfazer. Tente de novo.'),
    erro,
  };
}

/** Quanto beber em garrafinhas: inteiras e, se sobrar, a última na fração. */
function fracoesDaSugestao(quartos: number): number[] {
  const inteiras = Math.floor(quartos / 4);
  const resto = quartos % 4;
  return [...Array<number>(inteiras).fill(1), ...(resto ? [resto / 4] : [])];
}

const SELO = {
  meta: { classe: 'meta', texto: () => 'Meta batida ✓' },
  atras: { classe: 'atras', texto: (s: Situacao) => `Atrás ${n('falta' in s ? s.falta : 0)} mL` },
  'em-dia': { classe: 'ok', texto: () => 'No ritmo' },
} as const;

/** O selo do título: "No ritmo", "Atrás N mL" ou "Meta batida ✓". Enquanto a loja lê, só guarda o lugar. */
export function SeloDaAgua({ sit, carregando = false }: { sit: Situacao; carregando?: boolean }) {
  if (carregando) {
    return (
      <span class="agua-selo carregando" aria-hidden="true">
        {'\u00a0'}
      </span>
    );
  }
  const selo = SELO[sit.estado];
  return <span class={`agua-selo ${selo.classe}`}>{selo.texto(sit)}</span>;
}

/** O quadro de dica: o que beber para alcançar (com garrafinhas coral), a folga e o próximo gole, ou a meta batida. */
export function QuadroDaDica({ sit, minuto, carregando = false }: { sit: Situacao; minuto: number; carregando?: boolean }) {
  if (carregando) {
    return (
      <div class="agua-dica ok carregando" aria-hidden="true">
        <span class="agua-dica-texto">{'\u00a0'}</span>
      </div>
    );
  }
  return (
    <div class={`agua-dica ${sit.estado === 'meta' ? 'meta' : sit.estado === 'atras' ? 'atras' : 'ok'}`}>
      <span class="agua-dica-texto">
        <TextoDaDica sit={sit} minuto={minuto} />
      </span>
      {sit.estado === 'atras' && (
        <span class="garrafinhas" aria-hidden="true">
          {fracoesDaSugestao(sit.sugestao.quartos).map((f, i) => (
            <Garrafinha key={i} fracao={f} cor="coral" />
          ))}
        </span>
      )}
    </div>
  );
}

/** Os quatro botões ¼ ½ ¾ Toda; o sugerido sai em azul cheio, com a etiqueta "sugerido". */
export function BotoesDeFracao({ sit, registrar, carregando = false }: { sit: Situacao; registrar: (ml: number) => void; carregando?: boolean }) {
  const sugerida = sit.estado === 'atras' && !carregando ? sit.sugestao.botao : null;
  return (
    <div class="agua-fracoes" role="group" aria-label="Quanto você bebeu">
      {BOTOES.map(({ fracao, nome }) => {
        const ml = GARRAFA_ML * fracao;
        const sug = sugerida === fracao;
        return (
          // A etiqueta "sugerido" é do envoltório, não do botão: assim sobra um pouco para os lados sem o botão "transbordar".
          <div key={fracao} class="agua-fracao" data-sugerido={sug ? 'true' : undefined}>
            <button type="button" class={sug ? 'sugerido' : undefined} aria-label={`${nome}, ${n(ml)} mL${sug ? ', sugerido' : ''}`} onClick={() => registrar(ml)}>
              <b>{nome}</b>
              <span>{n(ml)} mL</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ---- O cartão completo ----

export function CartaoAgua({ aoAbrir }: { aoAbrir: () => void }) {
  const idTitulo = useId();
  const { total, minuto, sit, porcento, ultimo, registrar, desfazer, erro, carregando } = useAguaDoDia();
  const garrafa = garrafaDaVez(total);

  return (
    <section class="cartao-agua" aria-labelledby={idTitulo}>
      <header class="agua-cabeca">
        <h2 id={idTitulo}>
          <Icone nome="gota" />
          Água
        </h2>
        <SeloDaAgua sit={sit} carregando={carregando} />
      </header>

      <button type="button" class="agua-resumo" aria-label={`${n(total)} mL de ${n(META_ML)} mL, ${porcento}%. Abrir a página da água`} onClick={aoAbrir}>
        <span class="agua-anel" style={`--p:${porcento}`} aria-hidden="true">
          <Icone nome="gota" />
        </span>
        <span class="agua-texto">
          <b class="agua-total">
            {n(total)}
            <small> mL</small>
          </b>
          <span class="agua-sub">
            de {n(META_ML)} mL · {porcento}%
          </span>
        </span>
      </button>

      <Trilha total={total} minuto={minuto} sit={sit} carregando={carregando} />

      <QuadroDaDica sit={sit} minuto={minuto} carregando={carregando} />

      <p class="agua-vez">
        <Garrafinha fracao={garrafa.fracao} />
        <span>
          <b>
            Garrafa {garrafa.numero} de {garrafa.de}
          </b>{' '}
          · quanto da garrafa ({n(GARRAFA_ML)} mL) você bebeu?
        </span>
      </p>

      <BotoesDeFracao sit={sit} registrar={registrar} carregando={carregando} />

      <div class="agua-rodape">
        <span role="status">{ultimo ? `Último: ${ultimo.hora} · ${n(ultimo.ml)} mL` : 'Nada registrado ainda'}</span>
        <button type="button" aria-label="Desfazer o último gole" disabled={!ultimo} onClick={desfazer}>
          Desfazer
        </button>
      </div>
      {erro && (
        <p class="agua-erro" role="alert">
          {erro}
        </p>
      )}
    </section>
  );
}

/** A barra: azul é o bebido, o trecho listrado é o que falta até a marca do esperado. */
function Trilha({ total, minuto, sit, carregando }: { total: number; minuto: number; sit: Situacao; carregando: boolean }) {
  const bebido = Math.min(100, (total / META_ML) * 100);
  const esperado = sit.estado === 'meta' ? 0 : Math.min(100, (sit.esperado / META_ML) * 100);
  const comMarca = sit.estado !== 'meta' && minuto >= INICIO_MIN;
  const lado = esperado > 82 ? 'dir' : esperado < 18 ? 'esq' : '';
  const nome =
    sit.estado === 'meta'
      ? `Meta batida: ${n(total)} mL`
      : `Bebido: ${n(total)} mL. Esperado às ${hm(minuto)}: ${n(sit.esperado)} mL`;
  return (
    <div class="agua-trilha" role="img" aria-label={nome}>
      <div class="agua-bebido" style={`width:${bebido}%`} />
      {sit.estado === 'atras' && (
        <div class={`agua-falta${carregando ? ' carregando' : ''}`} style={`left:${bebido}%;width:${Math.max(0, esperado - bebido)}%`} />
      )}
      {comMarca && (
        <div class={`agua-alvo ${lado}`} style={`left:${esperado}%`}>
          <span>
            {hm(minuto)}: {n(sit.esperado)}
          </span>
        </div>
      )}
    </div>
  );
}

/** O quadro de dica: o que falta (atrás), a folga e o próximo gole (em dia) ou a meta batida. */
function TextoDaDica({ sit, minuto }: { sit: Situacao; minuto: number }) {
  if (sit.estado === 'meta') {
    return (
      <>
        <b>Meta do dia batida.</b> Pode beber sem contar.
      </>
    );
  }
  if (sit.estado === 'atras') {
    return (
      <>
        Para alcançar o ritmo, beba <b>{sit.sugestao.texto}</b> ({n(sit.sugestao.ml)} mL).
      </>
    );
  }
  const proximo = sit.proximoMin > minuto && minuto < FIM_MIN;
  return (
    <>
      {sit.folga > 0 ? `Em dia, ${n(sit.folga)} mL à frente.` : 'Em dia.'}
      {proximo && (
        <>
          {' '}
          Próximo ¼ de garrafa por volta das <b>{hm(sit.proximoMin)}</b>.
        </>
      )}
    </>
  );
}

// ---- A versão curta (chat aberto) ----

export function AguaCurta({ aoAbrir }: { aoAbrir: () => void }) {
  const { total, sit, porcento, registrar, erro, carregando } = useAguaDoDia();
  const estado =
    sit.estado === 'meta' ? 'meta batida ✓' : sit.estado === 'atras' ? `atrás ${n(sit.falta)} mL` : 'no ritmo';
  // Atrás: a garrafa sugerida (destacada). Em dia, meta batida ou ainda lendo: ¼, sem destaque.
  const sugerida = sit.estado === 'atras' && !carregando;
  const fracao: Fracao = sugerida ? sit.sugestao.botao : 0.25;
  // O nome falado contém o texto visível (WCAG 2.5.3): uma garrafa inteira é "1 garrafa" nos dois.
  const nome = fracao === 1 ? '1 garrafa' : BOTOES.find((b) => b.fracao === fracao)!.nome;
  const ml = GARRAFA_ML * fracao;

  return (
    <section class="cartao-agua curto" aria-label="Água">
      <div class="agua-linha">
        <button type="button" class="agua-resumo" aria-label={`Água: ${n(total)} mL, ${porcento}%${carregando ? '' : `, ${estado}`}. Abrir a página da água`} onClick={aoAbrir}>
          <span class="agua-anel" style={`--p:${porcento}`} aria-hidden="true">
            <Icone nome="gota" />
          </span>
          <span class="agua-texto">
            <b class="agua-total-curto">Água: {n(total)} mL</b>
            <span class="agua-sub">
              {porcento}% ·{' '}
              {carregando ? (
                <b class="carregando" aria-hidden="true">
                  {'\u00a0'}
                </b>
              ) : (
                <b class={sit.estado === 'atras' ? 'atras' : 'ok'}>{estado}</b>
              )}
            </span>
          </span>
        </button>
        <button
          type="button"
          class={`agua-mais${sugerida ? ' sugerido' : ''}${fracao === 1 ? ' inteira' : ''}`}
          aria-label={`+${nome}, ${n(ml)} mL${sugerida ? ', sugerido' : ''}`}
          onClick={() => registrar(ml)}
        >
          +{nome}
          <small>{n(ml)} mL</small>
        </button>
      </div>
      {erro && (
        <p class="agua-erro" role="alert">
          {erro}
        </p>
      )}
    </section>
  );
}
