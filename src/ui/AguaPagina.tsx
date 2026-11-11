// A página expandida da água (Tarefa 27): um <dialog> com o copo, o gráfico "Ritmo do dia",
// a dica, as garrafas do dia, os botões ¼ ½ ¾ Toda, "Outro valor" e, ao lado, o histórico.
// Modelo visual: prototipo-esbocos/agua-combinado.html. Regras e textos: docs/superpowers/specs/2026-11-09-agua.md
// ("Página expandida"). As contas são de dados/agua.ts; aqui só se juntam os dados vivos e o desenho.
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { FIM_MIN, GARRAFA_ML, INICIO_MIN, META_ML, esperadoAgora, historico, lerValor, type Situacao } from '../dados/agua';
import type { AguaRegistro } from '../dados/tipos';
import { BotoesDeFracao, QuadroDaDica, SeloDaAgua, hm, n, useAguaDoDia, Garrafinha } from './Agua';
import { Icone } from './icones';
import './agua-pagina.css';

// ---- Pequenas peças ----

/** Litros com uma casa: `1,9 L`. */
const litros = (ml: number) => `${(ml / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} L`;

/** Minutos desde 00:00 de um `HH:MM`. */
const minutoDe = (hora: string) => {
  const [h, m] = hora.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

const DIAS_DA_SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'] as const;
const INICIAIS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'] as const;

/** 0 (domingo) a 6 (sábado) de um `AAAA-MM-DD`. */
const diaDaSemana = (data: string) => new Date(`${data}T12:00:00Z`).getUTCDay();

/** `4/11` de `2026-11-04`. */
const diaEMes = (data: string) => `${Number(data.slice(8, 10))}/${Number(data.slice(5, 7))}`;

// ---- O diálogo ----

/**
 * A página da água. `aberta` falso: não desenha nada. Aberta, é um <dialog> modal (o navegador cuida do
 * foco preso, do Esc e da camada do topo). Fecha no X, no fundo e no Esc; o foco volta ao anel do cartão.
 */
export function AguaPagina({ aberta, aoFechar }: { aberta: boolean; aoFechar: () => void }) {
  return aberta ? <PaginaAberta aoFechar={aoFechar} /> : null;
}

function PaginaAberta({ aoFechar }: { aoFechar: () => void }) {
  const idTitulo = useId();
  const caixa = useRef<HTMLDialogElement>(null);
  const montada = useRef(true);
  /** O mouse foi apertado dentro da página (arrastar para fora, ao selecionar texto, não é tocar no fundo). */
  const apertouDentro = useRef(false);
  const dados = useAguaDoDia();
  const { dia, minuto, total, doDia, ultimo, sit, porcento, registrar, desfazer, erro, carregando } = dados;

  useEffect(() => {
    const dialogo = caixa.current;
    if (!dialogo) return;
    montada.current = true;
    const quemAbriu = document.activeElement;
    if (!dialogo.open) dialogo.showModal();
    return () => {
      montada.current = false;
      if (dialogo.open) dialogo.close();
      // O foco volta ao anel (o botão que abre a página); sem ele, a quem estava com o foco antes.
      const anel =
        quemAbriu instanceof HTMLElement && quemAbriu.isConnected && quemAbriu.matches('.agua-resumo')
          ? quemAbriu
          : document.querySelector<HTMLElement>('.agua-resumo');
      (anel ?? (quemAbriu instanceof HTMLElement ? quemAbriu : null))?.focus();
    };
  }, []);

  const fechar = () => caixa.current?.close();
  // A folha rola por baixo do cabeçalho fixo: só então ele ganha a borda de baixo.
  const [rolou, setRolou] = useState(false);

  return (
    <dialog
      ref={caixa}
      class="agua-pagina"
      aria-labelledby={idTitulo}
      // Esc e `close()` chegam aqui: só então o pai desmonta a página.
      onClose={() => montada.current && aoFechar()}
      onMouseDown={(e) => {
        apertouDentro.current = e.target !== e.currentTarget;
      }}
      // O fundo (::backdrop) manda o clique para o próprio <dialog>; a folha ocupa todo o resto.
      onClick={(e) => {
        const dentro = apertouDentro.current;
        apertouDentro.current = false;
        if (e.target === e.currentTarget && !dentro) fechar();
      }}
    >
      <div class="agua-pag" onScroll={(e) => setRolou(e.currentTarget.scrollTop > 0)}>
        <header class="agua-pag-cabeca" data-rolou={rolou ? '' : undefined}>
          <h2 id={idTitulo}>
            <Icone nome="gota" />
            Água
          </h2>
          <SeloDaAgua sit={sit} carregando={carregando} />
          <button type="button" class="agua-x" aria-label="Fechar" onClick={fechar}>
            <Icone nome="fechar" />
          </button>
        </header>

        <div class="agua-cols">
          <div class="agua-col1">
            <div class="agua-pag-topo">
              <Copo fracao={total / META_ML} />
              <div>
                <div class="agua-grande">
                  {n(total)}
                  <small> mL</small>
                </div>
                <div class="agua-pag-sub">
                  de {n(META_ML)} mL · {porcento}%
                </div>
                <div class="agua-pag-sub">{total >= META_ML ? 'Meta batida' : `Faltam ${n(META_ML - total)} mL para a meta`}</div>
              </div>
            </div>

            <GraficoDoRitmo goles={doDia} total={total} minuto={minuto} sit={sit} carregando={carregando} podeDesfazer={Boolean(ultimo)} aoDesfazer={desfazer} />

            <QuadroDaDica sit={sit} minuto={minuto} carregando={carregando} />

            <GarrafasDoDia total={total} />

            <BotoesDeFracao sit={sit} registrar={registrar} carregando={carregando} />
            <OutroValor registrar={registrar} />
            {erro && (
              <p class="agua-erro" role="alert">
                {erro}
              </p>
            )}
          </div>

          <div class="agua-col2">
            {carregando ? <div class="agua-historico-vazio" aria-hidden="true" /> : <HistoricoDaAgua registros={dados.registros} hoje={dia} />}
          </div>
        </div>
      </div>
    </dialog>
  );
}

/** O copo enchendo: só desenho; os números ao lado dizem tudo. */
function Copo({ fracao }: { fracao: number }) {
  const id = useId();
  const cheio = Math.max(0, Math.min(1, fracao));
  const contorno = 'M8 4H76L68 98Q67.5 103 62 103H22Q16.5 103 16 98Z';
  return (
    <svg class="agua-copo" viewBox="0 0 84 106" aria-hidden="true" focusable="false" data-fracao={String(cheio)}>
      <defs>
        <clipPath id={`${id}-recorte`}>
          <path d={contorno} />
        </clipPath>
      </defs>
      <path class="agua-copo-vidro" d={contorno} />
      <rect class="agua-copo-liquido" x="0" y={104 - 98 * cheio} width="84" height="110" clip-path={`url(#${id}-recorte)`} />
    </svg>
  );
}

// ---- O gráfico ----

const W = 360,
  H = 160,
  ESQ = 30,
  DIR = 10,
  TOPO = 10,
  BAIXO = 22;
/** O gráfico vai até 10% acima da meta, para o traço da meta não colar no teto. */
const TETO_ML = META_ML * 1.1;
/** Duas bolinhas a menos disto (em unidades do `viewBox`) mostram só a primeira hora. */
const DISTANCIA_DA_HORA = 24;
/** Raio das bolinhas de "agora" (o que você bebeu) e do "esperado", e a sobra do traço laranja além delas. */
const R_AGORA = 4;
const R_ESPERADO = 3.5;
const SOBRA = 3;

const x = (minuto: number) => ESQ + ((Math.max(INICIO_MIN, Math.min(FIM_MIN, minuto)) - INICIO_MIN) / (FIM_MIN - INICIO_MIN)) * (W - ESQ - DIR);
const y = (ml: number) => H - BAIXO - (Math.min(ml, TETO_ML) / TETO_ML) * (H - TOPO - BAIXO);
const ponto = (minuto: number, ml: number) => `${x(minuto).toFixed(1)} ${y(ml).toFixed(1)}`;

/**
 * "Ritmo do dia", de 8h a 22h: a linha azul do que foi bebido, o tracejado verde do ritmo, o traço laranja do que
 * falta agora e uma bolinha por gole, com a hora em cima. "Desfazer último" fica no título.
 */
export function GraficoDoRitmo({
  goles,
  total,
  minuto,
  sit,
  carregando = false,
  podeDesfazer,
  aoDesfazer,
}: {
  goles: readonly AguaRegistro[];
  total: number;
  minuto: number;
  sit: Situacao;
  /** A loja ainda lê: o traço "o que falta" seria falso, então não aparece. */
  carregando?: boolean;
  podeDesfazer: boolean;
  aoDesfazer: () => void;
}) {
  const esperado = esperadoAgora(minuto);
  const agora = Math.max(INICIO_MIN, Math.min(FIM_MIN, minuto));

  // A linha do bebido: sobe de uma vez em cada gole e segue reta até agora.
  const pontos: string[] = [ponto(INICIO_MIN, 0)];
  const bolinhas: { chave: string; cx: number; cy: number; hora: string; ml: number; mostraHora: boolean }[] = [];
  let acumulado = 0;
  let ultimaHora = -Infinity;
  let ultimoMinuto = INICIO_MIN;
  for (const gole of goles) {
    const quando = minutoDe(gole.hora);
    pontos.push(ponto(quando, acumulado));
    acumulado += gole.ml;
    pontos.push(ponto(quando, acumulado));
    const cx = x(quando);
    const mostraHora = cx - ultimaHora > DISTANCIA_DA_HORA;
    if (mostraHora) ultimaHora = cx;
    bolinhas.push({ chave: gole.id, cx, cy: y(acumulado), hora: gole.hora, ml: gole.ml, mostraHora });
    ultimoMinuto = Math.max(ultimoMinuto, quando);
  }
  pontos.push(ponto(Math.max(agora, ultimoMinuto), acumulado));

  const nome =
    `Ritmo do dia: ${n(total)} mL bebidos, esperado às ${hm(minuto)}: ${n(esperado)} mL. ` +
    (goles.length ? `Goles: ${goles.map((g) => `${g.hora} · ${n(g.ml)} mL`).join('; ')}.` : 'Nenhum gole ainda.');

  const faltando = sit.estado === 'atras' && !carregando;
  const horas: number[] = [];
  for (let h = INICIO_MIN / 60; h <= FIM_MIN / 60; h += 2) horas.push(h);

  return (
    <section class="agua-grafico-secao">
      <div class="agua-rot-linha">
        <h3>Ritmo do dia</h3>
        <button type="button" class="agua-desfazer" disabled={!podeDesfazer} onClick={aoDesfazer}>
          <Icone nome="desfazer" />
          Desfazer último
        </button>
      </div>
      <svg class="agua-grafico" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={nome}>
        {horas.map((h) => (
          <g key={h}>
            <line class="agua-grafico-grade" x1={x(h * 60)} x2={x(h * 60)} y1={TOPO} y2={H - BAIXO} />
            <text class="agua-grafico-eixo" x={x(h * 60)} y={H - 7} text-anchor="middle">
              {h}h
            </text>
          </g>
        ))}
        {[0, 1000, 2000].map((ml) => (
          <text key={ml} class="agua-grafico-eixo" x={ESQ - 5} y={y(ml) + 3} text-anchor="end">
            {ml ? `${ml / 1000}L` : '0'}
          </text>
        ))}
        <line class="agua-grafico-ritmo" x1={x(INICIO_MIN)} y1={y(0)} x2={x(FIM_MIN)} y2={y(META_ML)} />
        <path class="agua-grafico-linha" d={`M${pontos.join(' L')}`} />
        {bolinhas.map((b) => (
          <circle key={b.chave} class="agua-grafico-gole" cx={b.cx} cy={b.cy} r="4.5">
            <title>{`${b.hora} · ${n(b.ml)} mL`}</title>
          </circle>
        ))}
        {/* O traço do que falta vem depois das bolinhas dos goles e passa uns 3 pontos além das duas bolinhas de agora:
            com pouca diferença elas se encostam, e sem essa sobra o traço sumiria. */}
        {faltando && (
          <line class="agua-grafico-falta" x1={x(agora)} x2={x(agora)} y1={y(total) + R_AGORA + SOBRA} y2={y(esperado) - R_ESPERADO - SOBRA} />
        )}
        <circle class="agua-grafico-agora" cx={x(agora)} cy={y(total)} r={R_AGORA} />
        <circle class="agua-grafico-esperado" cx={x(agora)} cy={y(esperado)} r={R_ESPERADO} />
        {/* As horas por último: ficam por cima de todas as bolinhas (também as de agora e esperado) e do traço; o contorno claro mantém a leitura. */}
        {bolinhas.map(
          (b) =>
            b.mostraHora && (
              <text
                key={b.chave}
                class="agua-grafico-hora"
                x={b.cx}
                y={b.cy - 9 < 9 ? b.cy + 17 : b.cy - 9}
                text-anchor={b.cx > W - 18 ? 'end' : 'middle'}
              >
                {b.hora}
              </text>
            ),
        )}
      </svg>
      <p class="agua-legenda">
        <span>
          <i class="agua-legenda-voce" />
          você
        </span>
        <span>
          <i class="agua-legenda-ritmo" />
          ritmo ideal
        </span>
        {faltando && (
          <span>
            <i class="agua-legenda-falta" />o que falta
          </span>
        )}
      </p>
    </section>
  );
}

// ---- As quatro garrafas do dia ----

function GarrafasDoDia({ total }: { total: number }) {
  const quantas = META_ML / GARRAFA_ML;
  const meta = total >= META_ML;
  return (
    <section>
      <h3>Garrafas de hoje ({GARRAFA_ML} mL cada)</h3>
      <ol class="agua-garrafas" role="list">
        {Array.from({ length: quantas }, (_, i) => {
          const fracao = Math.max(0, Math.min(1, (total - i * GARRAFA_ML) / GARRAFA_ML));
          const cheia = fracao >= 1;
          const daVez = !meta && Math.floor(total / GARRAFA_ML) === i;
          const rotulo = cheia ? '✓' : daVez ? 'agora' : `${i + 1}ª`;
          const falado = cheia ? 'cheia' : daVez ? `a da vez, ${n(Math.round(fracao * GARRAFA_ML))} mL` : 'ainda vazia';
          return (
            <li key={i} class={`agua-garrafa${daVez ? ' agora' : ''}`}>
              <Garrafinha fracao={fracao} />
              <small aria-hidden="true">{rotulo}</small>
              <span class="so-leitor">
                Garrafa {i + 1}: {falado}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// ---- Outro valor ----

/**
 * O campo "Outro valor" (`350`, `350 ml`, `1,5 L`). O texto digitado é do próprio campo: uma atualização
 * que chega de outro aparelho refaz a página em volta, mas não mexe no que está sendo escrito.
 */
function OutroValor({ registrar }: { registrar: (ml: number) => void }) {
  const idErro = useId();
  const [texto, setTexto] = useState('');
  const [invalido, setInvalido] = useState(false);

  const somar = (evento: Event) => {
    evento.preventDefault();
    const ml = lerValor(texto);
    if (ml === null) {
      setInvalido(true);
      return;
    }
    registrar(ml);
    setTexto('');
    setInvalido(false);
  };

  return (
    <form class="agua-outro" noValidate onSubmit={somar}>
      <div class="agua-outro-linha">
        <input
          class="campo"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder="Outro valor: 350 ou 1,5 L"
          aria-label="Outro valor"
          aria-invalid={invalido ? 'true' : undefined}
          aria-describedby={invalido ? idErro : undefined}
          value={texto}
          onInput={(e) => {
            setTexto((e.target as HTMLInputElement).value);
            setInvalido(false);
          }}
        />
        <button type="submit" class="agua-somar">
          Somar
        </button>
      </div>
      {invalido && (
        <p id={idErro} class="agua-invalido" role="alert">
          <b>Valor inválido</b> Use 350, 350 ml ou 1,5 L (de 1 mL a 5 L).
        </p>
      )}
    </form>
  );
}

// ---- Histórico ----

/** O nível do mapa: 0 sem goles; 1 até metade da meta; 2 até 80%; 3 quase; 4 meta batida. */
const nivelDoMapa = (ml: number) => (ml <= 0 ? 0 : ml < META_ML * 0.5 ? 1 : ml < META_ML * 0.8 ? 2 : ml < META_ML ? 3 : 4);

/** Dias seguidos na meta, média de 7 dias, melhor dia, as barras da semana e o mapa das 4 semanas. */
export function HistoricoDaAgua({ registros, hoje }: { registros: readonly AguaRegistro[]; hoje: string }) {
  const { porDia, seguidos, media7, melhor } = historico(registros, hoje);
  const semana = porDia.slice(-7);
  // Segunda a domingo: quantas casas vazias antes do primeiro dia do mapa.
  const vazios = (diaDaSemana(porDia[0].data) + 6) % 7;

  return (
    <section class="agua-historico">
      <h3 class="agua-primeiro">Histórico</h3>
      <div class="agua-estats">
        <div class="agua-estat">
          <b>{seguidos === 1 ? '1 dia' : `${seguidos} dias`}</b> <span>{seguidos === 1 ? 'seguido na meta' : 'seguidos na meta'}</span>
        </div>
        <div class="agua-estat">
          <b>{litros(media7)}</b> <span>média 7 dias</span>
        </div>
        <div class="agua-estat">
          <b>{litros(melhor)}</b> <span>melhor dia</span>
        </div>
      </div>

      <h3>Últimos 7 dias</h3>
      <ol class="agua-semana" role="list">
        {semana.map((d, i) => {
          const ehHoje = i === semana.length - 1;
          const altura = Math.max(8, Math.min(1, d.ml / META_ML) * 100);
          // Hoje sempre tem o destaque (contorno); a cor é a da meta quando ela já foi batida.
          const classe = `agua-barra${ehHoje ? ' hoje' : ''}${d.ml >= META_ML ? ' meta' : ''}`;
          const diaSem = diaDaSemana(d.data);
          return (
            <li key={d.data} title={`${n(d.ml)} mL`}>
              <span class="agua-barra-trilho" aria-hidden="true">
                <span class={classe} style={`height:${altura}%`} />
              </span>
              <small aria-hidden="true">{INICIAIS[diaSem]}</small>
              <span class="so-leitor">
                {DIAS_DA_SEMANA[diaSem]}: {n(d.ml)} mL
              </span>
            </li>
          );
        })}
      </ol>

      <h3>Últimas 4 semanas</h3>
      <div class="agua-mapa-dias" aria-hidden="true">
        {['S', 'T', 'Q', 'Q', 'S', 'S', 'D'].map((inicial, i) => (
          <span key={i}>{inicial}</span>
        ))}
      </div>
      <div class="agua-mapa">
        {Array.from({ length: vazios }, (_, i) => (
          <div key={`vazio-${i}`} class="agua-dia-vazio" aria-hidden="true" />
        ))}
        {porDia.map((d) => {
          const nivel = nivelDoMapa(d.ml);
          const classe = ['agua-dia', nivel ? `n${nivel}` : '', d.data === hoje ? 'hoje' : ''].filter(Boolean).join(' ');
          return (
            <div key={d.data} class={classe} role="img" aria-label={`${diaEMes(d.data)}: ${n(d.ml)} mL`} title={`${n(d.ml)} mL`}>
              {Number(d.data.slice(8, 10))}
            </div>
          );
        })}
      </div>
      <p class="agua-escala" aria-hidden="true">
        menos <i class="n1" />
        <i class="n2" />
        <i class="n3" />
        <i class="n4" /> meta
      </p>
    </section>
  );
}
