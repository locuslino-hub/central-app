// Regras do chat (Tarefa 7): a primeira das três camadas. Transforma uma frase
// em item da agenda sem IA. Decide sempre tipo, data e hora; a sala, quando a
// frase cita a sala, a memória conhece a palavra ou a pessoa citada tem sala.
// Função pura: o "hoje" chega de fora e a memória é só consultada.

import {
  acharDatas, acharHoras, normalizar, segundaDaSemana, semSobreposicao, somarMinutos,
  type AchadoData, type Trecho,
} from './datas';

/** Memória de pessoas e palavras (Tarefa 8). As regras só consultam. */
export type Memoria = {
  acharPessoa(frase: string): { id: string; nome: string; salaId: string } | null;
  acharSala(frase: string): string | null;
  aprender(termo: string, salaId: string): void | Promise<void>;
};

export type Item = {
  tipo: 'tarefa' | 'compromisso';
  titulo: string;
  salaId: string | null;
  /** `AAAA-MM-DD`. Tarefa sem `data` e sem `semana` = Sem prazo. */
  data?: string;
  /** Segunda-feira da semana, `AAAA-MM-DD`. */
  semana?: string;
  /** `HH:MM`, só em compromisso. */
  inicio?: string;
  fim?: string;
  /** `HH:MM`, só em tarefa com prazo. */
  prazoHora?: string;
  /** Tarefa de marcar: ao concluir, pergunta dia e hora. */
  marcar: boolean;
  pessoaId?: string;
  /** Por que a sala foi escolhida, para o cartão mostrar. */
  motivoSala?: 'frase' | 'memoria' | 'pessoa';
};

export type Resultado = { itens: Item[]; certeza: 'alta' | 'baixa'; vazia: boolean };

const L = '(?<![a-z0-9])';
const R = '(?![a-z0-9])';

/** Nomes das salas na frase. Os específicos valem antes das palavras comuns ("Aula do MBA" é MBA). */
const SALAS_FORTES: [string, string][] = [
  ['doutoramento|doutorado', 'sala-doutoramento'],
  ['investigacao|investigacoes', 'sala-investigacao'],
  ['orientacao|orientacoes', 'sala-orientacoes'],
  ['mba', 'sala-mba'],
];
const SALAS_COMUNS: [string, string][] = [
  ['aulas?', 'sala-aulas'],
  ['pessoal', 'sala-pessoal'],
  ['casa', 'sala-casa'],
];
const TODAS = [...SALAS_FORTES, ...SALAS_COMUNS];
const RE_SALA_FORTE = SALAS_FORTES.map(([t, id]) => [new RegExp(`${L}(?:${t})${R}`), id] as const);
const RE_SALA_COMUM = SALAS_COMUNS.map(([t, id]) => [new RegExp(`${L}(?:${t})${R}`), id] as const);

/** Comando para o app no começo da frase: sai do título. */
const RE_COMANDO =
  /^\s*(?:adicione|adiciona|acrescente|acrescenta|inclua|anote|anota)(?![a-z])(?:\s*[:,])?(?:\s+(?:uma\s+|a\s+|as\s+)?(?:tarefas?|atividades?)(?![a-z])\s*:?)?/;
const LISTA = '(?:(?:em|nas?|nos?|para\\s+(?:as?|os?)|pra)\\s+)?(?:minhas?\\s+)?(?:tarefas?|atividades?|lista|pendencias)\\s+';
/** "nas tarefas do doutoramento", "na sala de aulas": decide a sala e sai do título. */
const RE_LISTA_SALA = new RegExp(
  `${L}(?:${LISTA}(?:d[aoe]s?\\s+)?(?:sala\\s+(?:d[aoe]s?\\s+)?)?|(?:(?:em|na|para\\s+a|pra)\\s+)?sala\\s+(?:d[aoe]s?\\s+)?)(${TODAS.map(([t]) => t).join('|')})${R}`,
  'g');
/** "em atividades do dia", "nas tarefas de hoje": é hoje e sai do título. */
const RE_LISTA_HOJE = new RegExp(`${L}${LISTA}(?:d[aoe]s?\\s+)?(?:dia|hoje)${R}(?!\\s*\\d)`, 'g');

const RE_PRAZO = /(?<![a-z])(?:entregar?|entregas|entregue|prazos?)(?![a-z])/g;
/** "até" só é prazo quando começa um dia ou uma hora ("até sexta", "até 17h"), não em "até tarde". */
const RE_ATE = /(?<![a-z])ate(?![a-z])/g;
const RE_MARCAR = /^marcar(?![a-z])/;
/** Palavras que, sozinhas, já mostram um pedido. */
const RE_CHAVE =
  /(?<![a-z])(?:reuniao|reunioes|entrega|prazo|consulta|aula|encontro|ligacao|evento|apresentacao|defesa|seminario|tarefa|atividade|preciso|precisa|tenho|lembrete|vou)(?![a-z])/;
const CONECTORES = /\s+(?:e|com|na|no|nas|nos|em|de|do|da|para|pra|ate|as|a|o|ou)$/;
const TITULOS_DE_NOME = new Set(['prof', 'profa', 'professor', 'professora', 'dr', 'dra', 'sr', 'sra']);

/** Infinitivo com vogal antes da terminação: "mandar", "revisar"; "qwer" não é. */
function temVerbo(n: string): boolean {
  for (const [w] of n.matchAll(/[a-z]+/g)) {
    if (w.length >= 4 && /(?:ar|er|ir|or)$/.test(w) && /[aeiou]/.test(w.slice(0, -2))) return true;
  }
  return false;
}

function salaNomeada(n: string, listas: { sala: string; ini: number }[]): string | null {
  if (listas.length) return listas[0].sala;
  for (const grupo of [RE_SALA_FORTE, RE_SALA_COMUM]) {
    let melhor: { i: number; id: string } | null = null;
    for (const [re, id] of grupo) {
      const m = n.match(re);
      if (m && (!melhor || m.index! < melhor.i)) melhor = { i: m.index!, id };
    }
    if (melhor) return melhor.id;
  }
  return null;
}

function idDaSala(termo: string): string {
  return TODAS.find(([t]) => new RegExp(`^(?:${t})$`).test(termo))![1];
}

/** Frase sem os trechos tirados; conectores soltos nas pontas também saem. */
function montarTitulo(o: string, tirar: Trecho[]): string {
  // União dos trechos: um trecho que cruza outro também sai inteiro.
  const trechos = [...tirar].sort((a, b) => a.ini - b.ini);
  let t = '';
  let p = 0;
  for (const x of trechos) {
    if (x.ini > p) t += o.slice(p, x.ini) + ' ';
    p = Math.max(p, x.fim);
  }
  t += o.slice(p);
  const tirouNoFim = trechos.length > 0 && o.slice(p).trim() === '';
  t = t.replace(/\s+/g, ' ').trim().replace(/\s+([,;:.!?)])/g, '$1');
  t = t.replace(/^[\s,;:.\-–]+/, '').replace(/[\s,;:\-–]+$/, '');
  if (tirouNoFim) {
    for (let i = 0; i < 5 && CONECTORES.test(normalizar(t)); i++) {
      t = t.replace(/\s+\S+$/, '').replace(/[\s,;:\-–]+$/, '');
    }
  }
  return capitalizar(t);
}

function capitalizar(t: string): string {
  return t ? t.charAt(0).toLocaleUpperCase('pt-BR') + t.slice(1) : '';
}

/** O nome da pessoa conhecida tem de aparecer no título (falha vista no teste da IA). */
export function garantirNome(titulo: string, nome: string): string {
  const nt = normalizar(titulo);
  const partes = normalizar(nome).split(/[^a-z0-9]+/).filter((x) => x.length >= 2 && !TITULOS_DE_NOME.has(x));
  const tem = partes.length
    ? partes.some((x) => new RegExp(`${L}${x}${R}`).test(nt))
    : nt.includes(normalizar(nome));
  return tem ? titulo : `${titulo} (${nome})`;
}

export function interpretarRegras(frase: string, hoje: string, memoria: Memoria): Resultado {
  const o = frase.normalize('NFC');
  if (!o.trim()) return { itens: [], certeza: 'baixa', vazia: true };
  const n = normalizar(o);
  let baixa = false;

  // Comando e listas: saem do título.
  const tirar: Trecho[] = [];
  const comando = n.match(RE_COMANDO);
  if (comando) tirar.push({ ini: 0, fim: comando[0].length });
  const listasSala = [...n.matchAll(RE_LISTA_SALA)].map((m) => ({
    ini: m.index!, fim: m.index! + m[0].length, sala: idDaSala(m[1]),
  }));
  const listasHoje: AchadoData[] = [...n.matchAll(RE_LISTA_HOJE)].map((m) => ({
    ini: m.index!, fim: m.index! + m[0].length, forca: 'fraca', data: hoje,
  }));
  tirar.push(...listasSala, ...listasHoje);

  // Datas, depois horas fora das datas.
  const datas = semSobreposicao([...acharDatas(n, hoje), ...listasHoje]);
  const { horas, ligacoes, invalidas } = acharHoras(n, [...datas, ...listasSala]);
  if (invalidas > 0) baixa = true; // "25h", "15:60": o dono quis dizer uma hora
  tirar.push(...datas, ...horas);

  const fortes = datas.filter((d) => d.forca === 'forte' && (d.data || d.invalida));
  if (fortes.some((d) => d.invalida)) baixa = true;
  const dias = [...new Set(fortes.filter((d) => d.data).map((d) => d.data!))];
  if (dias.length > 1) baixa = true;
  let data: string | undefined = dias.length
    ? fortes.find((d) => d.data)!.data
    : fortes.length ? undefined : datas.find((d) => d.forca === 'fraca')?.data;
  const semanas = datas.filter((d) => d.semana).map((d) => d.semana!);
  const semana = data ? undefined : semanas[0];
  if (data && semanas.length && segundaDaSemana(data) !== semanas[0]) baixa = true;

  const fora = (i: number) => !ligacoes.some((x) => i >= x.ini && i < x.fim);
  const comeca = (i: number) => [...datas, ...horas].some((x) => i >= x.ini && i < x.fim);
  const prazo =
    [...n.matchAll(RE_PRAZO)].length > 0 ||
    [...n.matchAll(RE_ATE)].some((m) => fora(m.index!) && comeca(m.index!));
  const inicios = horas.filter((h) => h.papel === 'inicio');
  const fins = horas.filter((h) => h.papel === 'fim');
  if (inicios.length > 1 || fins.length > 1) baixa = true;

  // Título.
  let titulo = montarTitulo(o, tirar);
  if (!titulo) {
    baixa = true;
    titulo = montarTitulo(o, comando ? [{ ini: 0, fim: comando[0].length }] : []) || capitalizar(o.trim());
  }

  // Pessoa e sala.
  const pessoa = memoria.acharPessoa(o);
  if (pessoa) titulo = garantirNome(titulo, pessoa.nome);
  let salaId = salaNomeada(n, listasSala);
  let motivoSala: Item['motivoSala'];
  if (salaId) motivoSala = 'frase';
  else if ((salaId = memoria.acharSala(o))) motivoSala = 'memoria';
  else if (pessoa) { salaId = pessoa.salaId; motivoSala = 'pessoa'; }
  else salaId = null;

  // Tipo.
  let item: Item;
  const hora = inicios[0] ?? fins[0];
  if (!prazo && data && hora) {
    let inicio = hora.hora;
    const fimDito = inicios[0] ? fins.find((f) => f.ini >= inicios[0].fim)?.hora : undefined;
    // "das 5 às 8": a tarde do início deixaria o fim antes dele, então é de manhã.
    if (fimDito && fimDito <= inicio && hora.semTarde && fimDito > hora.semTarde) inicio = hora.semTarde;
    let fim = fimDito ?? somarMinutos(inicio, 60);
    if (fim <= inicio) { baixa = true; fim = somarMinutos(inicio, 60); }
    item = { tipo: 'compromisso', titulo, salaId, data, inicio, fim, marcar: false };
  } else {
    const marcar = RE_MARCAR.test(normalizar(titulo));
    if (marcar && !data && !semana) data = hoje;
    // `data` vai sempre presente na tarefa, mesmo `undefined` (Sem prazo):
    // quem lê o item vê o campo explícito.
    item = { tipo: 'tarefa', titulo, salaId, data, marcar };
    if (!data && semana) item.semana = semana;
    const horaPrazo = fins[0] ?? inicios[0];
    if (prazo && data && horaPrazo) item.prazoHora = horaPrazo.hora;
    else if (hora) baixa = true; // hora sem dia: o cartão precisa perguntar
  }
  if (pessoa) item.pessoaId = pessoa.id;
  if (motivoSala) item.motivoSala = motivoSala;

  const reconhecida =
    !!comando || datas.length > 0 || horas.length > 0 || listasSala.length > 0 || !!pessoa ||
    !!salaId || RE_CHAVE.test(n) || temVerbo(n);
  if (!reconhecida) baixa = true;

  return { itens: [item], certeza: baixa ? 'baixa' : 'alta', vazia: false };
}
