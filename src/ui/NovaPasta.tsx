// "Nova pasta" (V02, Tarefa 12): o formulário com os 4 tipos. Cada tipo usa um modelo de planilha fixo
// (Lista: compras; Registro: consumo; Planilha ligada: financeiro; Pasta comum: nenhum). Só a Casa tem os
// 4 tipos (as planilhas vão para a pasta "Casa (partilhada)"); as outras salas só criam pasta comum, sem
// escolha de tipo. Criar mostra
// andamento, desliga o botão (toque duplo não cria duas planilhas) e, se falhar, não cria nada e deixa
// tentar de novo com o que já foi digitado.
import { useEffect, useRef, useState } from 'preact/hooks';
import { criarPasta, NOME_DA_PASTA_NO_MAXIMO, SALA_CASA } from '../dados/pastas';
import type { Pasta, Sala, TipoDePasta } from '../dados/tipos';
import { AvisoVivo } from './AvisoVivo';
import {
  AVISO_DO_MODELO,
  EXPLICACAO_DO_TIPO,
  mensagemDeErroDePasta,
  modeloDoTipo,
  NOME_DO_SERVICO,
  NOME_DO_TIPO,
  SERVICOS,
  TIPOS_DE_PASTA,
  UNIDADES,
  unidadeDoServico,
} from './pastas-textos';
import './pastas.css';

type Servico = NonNullable<Pasta['servico']>;
type Unidade = NonNullable<Pasta['unidade']>;

type Props = {
  sala: Sala;
  /** O id do formulário, para o botão que o abre. */
  id: string;
  aoCriar: (pasta: Pasta) => void;
  aoCancelar: () => void;
};

const EXEMPLO_DE_NOME: Record<TipoDePasta, string> = {
  lista: 'Ex.: Compras do mês',
  registro: 'Ex.: Consumo de água',
  planilha: 'Ex.: Contas da casa',
  comum: 'Ex.: Metodologia',
};

/** Dia do mês de 1 a 31, só dígitos; vazio é "sem dia" (`null`); qualquer outra coisa é inválida (`undefined`). */
function lerDia(texto: string): number | null | undefined {
  const limpo = texto.trim();
  if (limpo === '') return null;
  if (!/^\d{1,2}$/.test(limpo)) return undefined;
  const dia = Number(limpo);
  return dia >= 1 && dia <= 31 ? dia : undefined;
}

export function NovaPasta({ sala, id, aoCriar, aoCancelar }: Props) {
  const naCasa = sala.id === SALA_CASA;
  const [tipo, setTipo] = useState<TipoDePasta>(naCasa ? 'lista' : 'comum');
  const [nome, setNome] = useState('');
  const [servico, setServico] = useState<Servico>('agua');
  /** `null`: a unidade acompanha o serviço. Trocada à mão, fica como o dono pôs. */
  const [unidadeEscolhida, setUnidadeEscolhida] = useState<Unidade | null>(null);
  /** O seletor da unidade só aparece depois de "Trocar". */
  const [trocandoUnidade, setTrocandoUnidade] = useState(false);
  const [dia, setDia] = useState('');
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [erroDoNome, setErroDoNome] = useState<string | null>(null);
  const [erroDoDia, setErroDoDia] = useState<string | null>(null);
  const formulario = useRef<HTMLFormElement>(null);
  const campoNome = useRef<HTMLInputElement>(null);
  const campoDia = useRef<HTMLInputElement>(null);
  const campoUnidade = useRef<HTMLSelectElement>(null);
  const emCurso = useRef(false);
  const montado = useRef(true);

  useEffect(() => {
    montado.current = true;
    // Traz o formulário para a vista sem rolar à toa e põe o foco no tipo marcado (ou no nome, fora da Casa).
    formulario.current?.scrollIntoView?.({ block: 'nearest' });
    (formulario.current?.querySelector<HTMLElement>('input[type="radio"]:checked') ?? campoNome.current)?.focus();
    return () => {
      montado.current = false;
    };
  }, []);

  // O botão "Trocar" some quando o seletor abre: o foco vai para o seletor da unidade.
  useEffect(() => {
    if (trocandoUnidade) campoUnidade.current?.focus();
  }, [trocandoUnidade]);

  const unidade = unidadeEscolhida ?? unidadeDoServico(servico);
  const modelo = modeloDoTipo(tipo);

  function escolherTipo(novo: TipoDePasta) {
    setTipo(novo);
    setErro(null);
  }

  async function enviar(evento: Event) {
    evento.preventDefault();
    if (emCurso.current) return;
    setErro(null);
    const nomeLimpo = nome.trim();
    const diaDeEnvio = tipo === 'registro' ? lerDia(dia) : null;
    setErroDoNome(nomeLimpo === '' ? 'Escreva um nome para a pasta.' : null);
    setErroDoDia(diaDeEnvio === undefined ? 'Use um dia de 1 a 31.' : null);
    if (nomeLimpo === '') return void campoNome.current?.focus();
    if (diaDeEnvio === undefined) return void campoDia.current?.focus();

    emCurso.current = true;
    setCriando(true);
    try {
      const pasta = await criarPasta({
        salaId: sala.id,
        tipo,
        nome: nomeLimpo,
        ...(modelo ? { modelo } : {}),
        ...(tipo === 'registro' ? { servico, unidade, ...(diaDeEnvio !== null ? { diaDeEnvio } : {}) } : {}),
      });
      aoCriar(pasta);
    } catch (causa) {
      console.error('Não consegui criar a pasta', causa);
      if (montado.current) setErro(mensagemDeErroDePasta(causa));
    } finally {
      emCurso.current = false;
      if (montado.current) setCriando(false);
    }
  }

  return (
    <form
      ref={formulario}
      id={id}
      class="pastas-form"
      aria-labelledby={`${id}-titulo`}
      noValidate
      onSubmit={(e) => void enviar(e)}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !criando) aoCancelar();
      }}
    >
      <h3 id={`${id}-titulo`} class="pastas-form-titulo">
        Nova pasta
      </h3>

      {naCasa && (
      <fieldset class="pastas-tipos" disabled={criando}>
        <legend>Tipo de pasta</legend>
        {TIPOS_DE_PASTA.map((opcao) => (
          <div class="pastas-tipo" key={opcao}>
            <input
              type="radio"
              id={`${id}-tipo-${opcao}`}
              name={`${id}-tipo`}
              value={opcao}
              checked={tipo === opcao}
              aria-describedby={`${id}-tipo-${opcao}-explica`}
              onChange={() => escolherTipo(opcao)}
            />
            <label for={`${id}-tipo-${opcao}`}>{NOME_DO_TIPO[opcao]}</label>
            <span class="pastas-tipo-explica" id={`${id}-tipo-${opcao}-explica`}>
              {EXPLICACAO_DO_TIPO[opcao]}
            </span>
          </div>
        ))}
      </fieldset>
      )}

      <div class="pastas-campo">
        <label for={`${id}-nome`}>Nome da pasta</label>
        <input
          ref={campoNome}
          id={`${id}-nome`}
          class="campo"
          type="text"
          value={nome}
          maxLength={NOME_DA_PASTA_NO_MAXIMO}
          placeholder={EXEMPLO_DE_NOME[tipo]}
          autoComplete="off"
          disabled={criando}
          aria-invalid={erroDoNome ? 'true' : undefined}
          aria-describedby={erroDoNome ? `${id}-nome-erro` : undefined}
          onInput={(e) => {
            setNome(e.currentTarget.value);
            setErroDoNome(null);
          }}
        />
        {erroDoNome && (
          <p class="pastas-campo-erro" id={`${id}-nome-erro`}>
            {erroDoNome}
          </p>
        )}
      </div>

      {tipo === 'planilha' && (
        <p class="pastas-dica">Fica na pasta Casa (partilhada): quem tiver acesso à pasta vê os gastos.</p>
      )}

      {tipo === 'registro' && (
        <div class="pastas-campos-juntos">
          <div class="pastas-campo">
            <label for={`${id}-servico`}>Serviço</label>
            <select
              id={`${id}-servico`}
              class="campo"
              value={servico}
              disabled={criando}
              onChange={(e) => {
                setServico(e.currentTarget.value as Servico);
                setUnidadeEscolhida(null);
                setTrocandoUnidade(false);
              }}
            >
              {SERVICOS.map((opcao) => (
                <option key={opcao} value={opcao}>
                  {NOME_DO_SERVICO[opcao]}
                </option>
              ))}
            </select>
          </div>
          <div class="pastas-campo pastas-unidade">
            {trocandoUnidade ? (
              <>
                <label for={`${id}-unidade`}>Unidade</label>
                <select
                  ref={campoUnidade}
                  id={`${id}-unidade`}
                  class="campo"
                  value={unidade}
                  disabled={criando}
                  aria-describedby={`${id}-unidade-dica`}
                  onChange={(e) => setUnidadeEscolhida(e.currentTarget.value as Unidade)}
                >
                  {UNIDADES.map((opcao) => (
                    <option key={opcao} value={opcao}>
                      {opcao}
                    </option>
                  ))}
                </select>
                <p class="pastas-campo-dica" id={`${id}-unidade-dica`}>
                  Vem do serviço. Troque só se o seu medidor usar outra.
                </p>
              </>
            ) : (
              <>
                <span class="pastas-rotulo" aria-hidden="true">&nbsp;</span>
                <p class="pastas-unidade-linha">
                  <span>{`Unidade: ${unidade} (vem do serviço)`}</span>
                  <button type="button" class="botao-texto" aria-label="Trocar a unidade" disabled={criando} onClick={() => setTrocandoUnidade(true)}>
                    Trocar
                  </button>
                </p>
              </>
            )}
          </div>
          <div class="pastas-campo">
            <label for={`${id}-dia`}>Dia de envio (opcional)</label>
            <input
              ref={campoDia}
              id={`${id}-dia`}
              class="campo"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={dia}
              maxLength={2}
              disabled={criando}
              aria-invalid={erroDoDia ? 'true' : undefined}
              aria-describedby={`${id}-dia-${erroDoDia ? 'erro' : 'dica'}`}
              onInput={(e) => {
                setDia(e.currentTarget.value);
                setErroDoDia(null);
              }}
            />
            {erroDoDia ? (
              <p class="pastas-campo-erro" id={`${id}-dia-erro`}>
                {erroDoDia}
              </p>
            ) : (
              <p class="pastas-campo-dica" id={`${id}-dia-dica`}>
                O dia do mês em que você envia a leitura ao portal.
              </p>
            )}
          </div>
        </div>
      )}

      <p class="pastas-modelo">
        {!naCasa
          ? 'Pasta comum: tarefas, notas e documentos de um tema. Fica só na Central, sem planilha.'
          : modelo
            ? AVISO_DO_MODELO[modelo]
            : 'Não cria planilha: tudo fica só na Central.'}
      </p>

      <AvisoVivo>{criando && <p class="pastas-progresso">{modelo ? 'Criando a planilha no seu Drive…' : 'Criando a pasta…'}</p>}</AvisoVivo>
      {erro && (
        <div class="pastas-erro" role="alert">
          <p>{erro}</p>
          <button type="submit" class="botao" disabled={criando}>
            Tentar de novo
          </button>
        </div>
      )}

      <div class="pastas-form-acoes">
        <button type="submit" class="botao primario" disabled={criando}>
          {criando ? 'Criando…' : 'Criar pasta'}
        </button>
        <button type="button" class="botao-texto" disabled={criando} onClick={aoCancelar}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
