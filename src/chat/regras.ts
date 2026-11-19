// Regras do chat (Tarefa 7): a primeira das três camadas. Transforma uma frase
// em item da agenda sem IA. Decide sempre tipo, data e hora; a sala, quando a
// frase cita a sala, a memória conhece a palavra ou a pessoa citada tem sala.
//
// Decisões do dono (11/11):
// - tarefa sem dia na frase é de hoje (e volta todo dia até ser concluída, pela
//   virada); só fica Sem prazo quando a frase diz "sem prazo";
// - dia e hora com "tarefa" ou "atividade" na frase ("nas tarefas de hoje",
//   "atividades do dia") é tarefa com hora; sem essas palavras (reunião,
//   consulta...) é compromisso no Google Agenda;
// - hora sem dia é hoje, com certeza baixa.
// Função pura: o "hoje" chega de fora e a memória é só consultada.

import {
  acharDatas, acharHoras, normalizar, segundaDaSemana, semSobreposicao, somarMinutos,
  type AchadoData, type Trecho,
} from './datas';

/** Pasta comum de uma sala, o "tema" de "nas tarefas do tema X" (V02, Tarefa 17). */
export type Tema = { id: string; nome: string; salaId: string };

/** Memória de pessoas e palavras (Tarefa 8). As regras só consultam. */
export type Memoria = {
  acharPessoa(frase: string): { id: string; nome: string; salaId: string } | null;
  acharSala(frase: string): string | null;
  aprender(termo: string, salaId: string): void | Promise<void>;
  /** As pastas comuns vivas (Tarefa 17). Memória sem esta função não conhece nenhum tema. */
  temas?(): Tema[];
};

export type Item = {
  tipo: 'tarefa' | 'compromisso';
  titulo: string;
  salaId: string | null;
  /** `AAAA-MM-DD`. Tarefa sem `data` e sem `semana` = Sem prazo (só quando a frase diz "sem prazo"). */
  data?: string;
  /** Segunda-feira da semana, `AAAA-MM-DD`. */
  semana?: string;
  /**
   * A frase não disse o dia: `data` é hoje por padrão (decisão de 11/11). O
   * Caderno usa isto para só transformar em item a linha que diz um dia.
   */
  diaAssumido?: true;
  /** `HH:MM`: compromisso, ou tarefa com hora (a frase disse "tarefa" ou "atividade"). */
  inicio?: string;
  /** `HH:MM`: sempre no compromisso; na tarefa com hora, só quando a frase diz o fim. */
  fim?: string;
  /** `HH:MM`, só em tarefa com prazo. */
  prazoHora?: string;
  /** Tarefa de marcar: ao concluir, pergunta dia e hora. */
  marcar: boolean;
  pessoaId?: string;
  /** Por que a sala foi escolhida, para o cartão mostrar. */
  motivoSala?: 'frase' | 'memoria' | 'pessoa' | 'ia' | 'tema';
  /** "nas tarefas do tema X" achou a pasta comum X (Tarefa 17): a tarefa leva o `pastaId` e a sala dela. */
  pastaId?: string;
  /** O nome da pasta, como está no app, para o cartão dizer o tema. */
  temaNome?: string;
  /** "nas tarefas do tema X" não achou nenhuma pasta com esse nome: o nome dito, para o cartão avisar. */
  temaNaoAchado?: string;
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

/** "sem prazo", "nas tarefas sem prazo", "para sem prazo": a tarefa fica Sem prazo, e o trecho sai do título. */
const RE_SEM_PRAZO = new RegExp(`${L}(?:${LISTA}|(?:em|no|na|para|pra)\\s+(?:o\\s+)?)?sem\\s+prazos?${R}`, 'g');
/**
 * "tarefa" ou "atividade" como pedido, não como assunto ("Reunião sobre as
 * atividades do projeto", "atividade física" seguem compromisso). Valem: no
 * comando ("Adicione uma tarefa..."), no começo da frase ("Tarefa ..."; "Atividade"
 * só com ":", "para" ou o dia logo depois) e na forma de lista ("nas tarefas",
 * "em atividades do dia", "atividades do dia" no começo).
 */
const RE_PALAVRA_TAREFA = /(?<![a-z])(?:tarefas?|atividades?)(?![a-z])/;
const RE_PREFIXO_DE_LISTA = /^(?:em|nas?|nos?|para\s+(?:as?|os?)|pra)\s/;
/** "nas tarefas", "em atividades", "nas minhas tarefas": a lista sai do título. */
const RE_LISTA_DE_TAREFAS = new RegExp(`${L}(?:em|nas|nos)\\s+(?:minhas\\s+)?(?:tarefas|atividades)${R}`, 'g');
/** "Tarefa:", "Atividade amanhã...", "Tarefa para hoje..." no começo: a palavra sai do título (quando é pedido). */
const RE_TAREFA_NO_INICIO = /^\s*(?:uma\s+)?(tarefas?|atividades?)(?![a-z])\s*:?/;

/**
 * "nas tarefas do tema ", "em atividades do tema ", "para as tarefas do tema ": só a forma de lista conta, para
 * "reunião sobre o tema X" e "estudar o tema X" seguirem como antes. O nome vem logo depois.
 */
const RE_TEMA = new RegExp(
  `${L}(?:em|nas?|nos?|para\\s+(?:as?|os?)|pra)\\s+(?:minhas\\s+)?(?:tarefas?|atividades?|lista|pendencias)\\s+(?:d[aoe]s?\\s+)?tema\\s+(?=[a-z0-9])`,
);
const escaparRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Das pastas dadas, as de nome mais longo que começa em `inicio` (palavra inteira). Várias só se o nome é o mesmo. */
function temasQueComecamEm(n: string, inicio: number, temas: readonly Tema[]): { achados: Tema[]; fim: number } | null {
  const resto = n.slice(inicio);
  let melhor: { achados: Tema[]; tamanho: number } | null = null;
  for (const tema of temas) {
    const nome = normalizar(tema.nome.normalize('NFC')).trim().replace(/\s+/g, ' ');
    if (!nome) continue;
    const achou = new RegExp(`^${escaparRe(nome).replace(/ /g, '\\s+')}(?![a-z0-9])`).exec(resto);
    if (!achou) continue;
    if (!melhor || achou[0].length > melhor.tamanho) melhor = { achados: [tema], tamanho: achou[0].length };
    else if (achou[0].length === melhor.tamanho) melhor.achados.push(tema);
  }
  return melhor && { achados: melhor.achados, fim: inicio + melhor.tamanho };
}

const RE_PALAVRA_DO_NOME = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;
/** Palavras que encerram um nome de tema que ninguém conhece: o pedido (ou o prazo) recomeça. */
const FIM_DE_NOME_DE_TEMA = new Set(['e', 'com', 'para', 'pra', 'ate', 'as', 'a', 'o', 'sem']);
/** O nome não termina nelas ("Estudos de" -> "Estudos"). */
const NAO_TERMINA_O_NOME = new Set(['de', 'da', 'do', 'dos', 'das']);
const PALAVRAS_DO_NOME_NO_MAXIMO = 3;

/**
 * Onde acaba o nome de um tema que não existe: até 3 palavras, antes de pontuação, de um dia ou hora, de "sem prazo",
 * de um conector ou de um verbo (que começa o pedido: "do tema Metodologia revisar o capítulo"); o nome não termina
 * em "de/da/do". `cortado`: o limite de palavras partiu o nome (havia mais palavras depois): o dono confere.
 * `fim` é `null` se não há nome.
 */
function fimDoNomeDeTema(n: string, inicio: number, trechos: readonly Trecho[]): { fim: number | null; cortado: boolean } {
  const fins: { palavra: string; fim: number }[] = [];
  let cortado = false;
  for (const m of n.slice(inicio).matchAll(RE_PALAVRA_DO_NOME)) {
    const ini = inicio + m.index!;
    if (fins.length > 0) {
      if (/[,;.!?:]/.test(n.slice(fins[fins.length - 1]!.fim, ini))) break;
      if (FIM_DE_NOME_DE_TEMA.has(m[0]) || temVerbo(m[0])) break;
    }
    if (trechos.some((t) => ini >= t.ini && ini < t.fim)) break;
    if (fins.length >= PALAVRAS_DO_NOME_NO_MAXIMO) {
      cortado = true;
      break;
    }
    fins.push({ palavra: m[0], fim: ini + m[0].length });
  }
  while (fins.length > 0 && NAO_TERMINA_O_NOME.has(fins[fins.length - 1]!.palavra)) fins.pop();
  return { fim: fins.length ? fins[fins.length - 1]!.fim : null, cortado };
}

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

/**
 * A sala de um título sem sala (compromisso que veio do Google), pelas mesmas
 * regras das tarefas: 1) nome da sala no título; 2) palavra guardada na
 * memória; 3) sala da pessoa cadastrada citada. `null` se nada bate.
 */
export function salaDoTitulo(titulo: string, memoria: Pick<Memoria, 'acharSala' | 'acharPessoa'>): string | null {
  const o = titulo.normalize('NFC');
  if (!o.trim()) return null;
  return salaNomeada(normalizar(o), []) ?? memoria.acharSala(o) ?? memoria.acharPessoa(o)?.salaId ?? null;
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
  const palavraNoInicio = comando ? null : n.match(RE_TAREFA_NO_INICIO);
  const listasDeTarefas: Trecho[] = [...n.matchAll(RE_LISTA_DE_TAREFAS)].map((m) => ({ ini: m.index!, fim: m.index! + m[0].length }));
  tirar.push(...listasDeTarefas);
  const semPrazos: Trecho[] = [...n.matchAll(RE_SEM_PRAZO)].map((m) => ({ ini: m.index!, fim: m.index! + m[0].length }));
  const dentroDeSemPrazo = (i: number) => semPrazos.some((x) => i >= x.ini && i < x.fim);
  tirar.push(...semPrazos);
  const listasSala = [...n.matchAll(RE_LISTA_SALA)].map((m) => ({
    ini: m.index!, fim: m.index! + m[0].length, sala: idDaSala(m[1]),
  }));
  const listasHoje: AchadoData[] = [...n.matchAll(RE_LISTA_HOJE)].map((m) => ({
    ini: m.index!, fim: m.index! + m[0].length, forca: 'fraca', data: hoje,
  }));
  tirar.push(...listasSala, ...listasHoje);

  // Tema: "nas tarefas do tema Metodologia". Um nome de pasta que o dono tem vale inteiro, mesmo que lembre um
  // dia ("Quarta Etapa"); o que ninguém tem é achado depois das datas e horas, que dizem onde o nome acaba.
  const prefixoDoTema = RE_TEMA.exec(n);
  const inicioDoNome = prefixoDoTema ? prefixoDoTema.index + prefixoDoTema[0].length : -1;
  const conhecido = prefixoDoTema ? temasQueComecamEm(n, inicioDoNome, memoria.temas?.() ?? []) : null;
  let trechoDoTema: Trecho | null = conhecido ? { ini: prefixoDoTema!.index, fim: conhecido.fim } : null;
  const foraDoTema = (x: Trecho) => !trechoDoTema || x.fim <= trechoDoTema.ini || x.ini >= trechoDoTema.fim;

  // Datas, depois horas fora das datas.
  const datas = semSobreposicao([...acharDatas(n, hoje).filter(foraDoTema), ...listasHoje]);
  const { horas, ligacoes, invalidas } = acharHoras(n, [...datas, ...listasSala, ...(trechoDoTema ? [trechoDoTema] : [])]);
  if (invalidas > 0) baixa = true; // "25h", "15:60": o dono quis dizer uma hora
  tirar.push(...datas, ...horas);

  let nomeDoTemaDito: string | null = null;
  if (prefixoDoTema && !conhecido) {
    const { fim, cortado } = fimDoNomeDeTema(n, inicioDoNome, [...datas, ...horas, ...ligacoes]);
    if (cortado) baixa = true;
    if (fim !== null) {
      trechoDoTema = { ini: prefixoDoTema.index, fim };
      nomeDoTemaDito = o.slice(inicioDoNome, fim);
    }
  }
  if (trechoDoTema) tirar.push(trechoDoTema);
  // Nome do tema não é pessoa, palavra de sala nem sala: some do que a memória e as salas leem.
  const semTema = (texto: string) =>
    trechoDoTema ? texto.slice(0, trechoDoTema.ini) + ' '.repeat(trechoDoTema.fim - trechoDoTema.ini) + texto.slice(trechoDoTema.fim) : texto;
  const oSemTema = semTema(o);
  const nSemTema = semTema(n);

  // "tarefa"/"atividade" como pedido (RE_PALAVRA_TAREFA): comando, começo ou lista.
  const depoisDoComando = comando ? comando[0].length : 0;
  const listaPede = (t: Trecho) => {
    const texto = n.slice(t.ini, t.fim);
    return RE_PALAVRA_TAREFA.test(texto) && (RE_PREFIXO_DE_LISTA.test(texto) || n.slice(depoisDoComando, t.ini).trim() === '');
  };
  let inicioPede = false;
  if (palavraNoInicio) {
    const fim = palavraNoInicio[0].length;
    const proximo = fim + (n.slice(fim).match(/^\s*/)?.[0].length ?? 0);
    inicioPede =
      palavraNoInicio[1].startsWith('taref') ||
      palavraNoInicio[0].trimEnd().endsWith(':') ||
      /^(?:para|pra)(?![a-z])/.test(n.slice(proximo)) ||
      [...datas, ...horas].some((x) => x.ini === proximo);
    // "Atividade física": a palavra é o assunto e fica no título.
    if (inicioPede) tirar.push({ ini: 0, fim });
  }
  const pedeTarefa =
    (!!comando && RE_PALAVRA_TAREFA.test(comando[0])) ||
    inicioPede ||
    listasDeTarefas.length > 0 ||
    [...listasSala, ...listasHoje, ...(trechoDoTema ? [trechoDoTema] : [])].some(listaPede);

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
    [...n.matchAll(RE_PRAZO)].some((m) => !dentroDeSemPrazo(m.index!)) ||
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
  const pessoa = memoria.acharPessoa(oSemTema);
  if (pessoa) titulo = garantirNome(titulo, pessoa.nome);
  let salaId = salaNomeada(nSemTema, listasSala);
  let motivoSala: Item['motivoSala'];
  if (salaId) motivoSala = 'frase';
  else if ((salaId = memoria.acharSala(oSemTema))) motivoSala = 'memoria';
  else if (pessoa) { salaId = pessoa.salaId; motivoSala = 'pessoa'; }
  else salaId = null;

  // A pasta achada manda na sala (a pasta é de uma sala só). Duas com o mesmo nome: vale a da sala dita na frase;
  // sem sala dita, fica a primeira e o cartão pede para conferir.
  let tema: Tema | null = null;
  if (conhecido) {
    const daSalaDita = conhecido.achados.filter((t) => t.salaId === salaId && motivoSala === 'frase');
    tema = daSalaDita.length === 1 ? daSalaDita[0]! : conhecido.achados[0]!;
    if (conhecido.achados.length > 1 && daSalaDita.length !== 1) baixa = true;
    // A frase disse outra sala: a pasta manda, mas o dono confere no cartão.
    if (motivoSala === 'frase' && salaId !== tema.salaId) baixa = true;
    salaId = tema.salaId;
    motivoSala = 'tema';
  }

  // Dia que a frase não disse: hoje. Hora sem dia é hoje, com certeza baixa
  // (o cartão mostra o dia entendido). "sem prazo" dito: fica sem dia.
  const hora = inicios[0] ?? fins[0];
  const semPrazo = semPrazos.length > 0;
  if (semPrazo && (data || semana)) baixa = true; // "sem prazo" e um dia na mesma frase: vale o dia
  let diaAssumido = false;
  if (!data && !semana && !semPrazo && hora) {
    data = hoje;
    diaAssumido = true;
    baixa = true;
  }

  // Tipo.
  let item: Item;
  const marcar = RE_MARCAR.test(normalizar(titulo));
  if (!prazo && data && hora) {
    let inicio = hora.hora;
    const fimDito = inicios[0] ? fins.find((f) => f.ini >= inicios[0].fim)?.hora : undefined;
    // "das 5 às 8": a tarde do início deixaria o fim antes dele, então é de manhã.
    if (fimDito && fimDito <= inicio && hora.semTarde && fimDito > hora.semTarde) inicio = hora.semTarde;
    let fim = fimDito ?? somarMinutos(inicio, 60);
    const fimValido = fim > inicio;
    if (!fimValido) { baixa = true; fim = somarMinutos(inicio, 60); }
    if (pedeTarefa) {
      // Tarefa com hora: fica em Atividades e aparece como bloco na Agenda.
      item = { tipo: 'tarefa', titulo, salaId, data, inicio, marcar };
      if (fimDito && fimValido) item.fim = fim;
    } else {
      item = { tipo: 'compromisso', titulo, salaId, data, inicio, fim, marcar: false };
    }
  } else {
    if (!data && !semana && !semPrazo) {
      data = hoje;
      // "Marcar..." sempre foi tarefa de hoje: conta como dia dito.
      if (!marcar) diaAssumido = true;
    }
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
  if (tema && item.tipo === 'tarefa') {
    item.pastaId = tema.id;
    item.temaNome = tema.nome;
  }
  if (nomeDoTemaDito !== null) item.temaNaoAchado = nomeDoTemaDito;
  if (diaAssumido) item.diaAssumido = true;

  const reconhecida =
    !!comando || datas.length > 0 || horas.length > 0 || listasSala.length > 0 || !!pessoa ||
    !!salaId || RE_CHAVE.test(n) || temVerbo(n);
  if (!reconhecida) baixa = true;

  return { itens: [item], certeza: baixa ? 'baixa' : 'alta', vazia: false };
}
