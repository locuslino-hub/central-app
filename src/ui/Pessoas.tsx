// Cadastro de pessoas (Tarefa 9): nome, sala e papel opcional. É o que o chat
// usa para saber a sala de quem a frase cita ("Marcar reunião com a Marina" vai
// para Orientações). Desde a Tarefa 17 o nome de cada pessoa leva à página dela
// (src/ui/Pessoa.tsx), que reaproveita o formulário de edição daqui.
import { useEffect, useRef, useState } from 'preact/hooks';
import { normalizar } from '../chat/datas';
import { desfazer, type Desfazivel } from '../dados/desfazer';
import { apagar, listar, salvar } from '../dados/loja';
import type { Pessoa, Sala } from '../dados/tipos';
import { hrefDe } from '../rotas';
import { usePessoas, useSalas } from './hooks';
import './tarefas.css';

type Erro = { campo: 'nome' | 'sala' | 'geral'; texto: string };

type EdicaoProps = {
  pessoa: Pessoa;
  salas: readonly Sala[];
  nomeDaSala: (id: string) => string;
  /** `salvou`: o nome gravado, ou `undefined` se fechou sem salvar. */
  aoFechar: (salvou?: string) => void;
};

/** Nome, sala e papel de uma pessoa já cadastrada. Mesmo id: o que o chat aprendeu dela continua valendo. */
export function EdicaoDePessoa({ pessoa, salas, nomeDaSala, aoFechar }: EdicaoProps) {
  const [nome, setNome] = useState(pessoa.nome);
  const [salaId, setSalaId] = useState(pessoa.salaId);
  const [papel, setPapel] = useState(pessoa.papel ?? '');
  const [erro, setErro] = useState<string | null>(null);
  const campoNome = useRef<HTMLInputElement>(null);
  const emAndamento = useRef(false);

  useEffect(() => {
    campoNome.current?.focus();
  }, []);

  async function salvarEdicao(evento: Event) {
    evento.preventDefault();
    if (emAndamento.current) return;
    const limpo = nome.trim();
    if (!limpo) {
      setErro('Escreva o nome.');
      return campoNome.current?.focus();
    }
    emAndamento.current = true;
    try {
      const outra = (await listar('pessoas')).find((p) => p.id !== pessoa.id && normalizar(p.nome) === normalizar(limpo));
      if (outra) {
        setErro(`${outra.nome} já está cadastrada em ${nomeDaSala(outra.salaId)}.`);
        return campoNome.current?.focus();
      }
      const { papel: _antigo, ...resto } = pessoa;
      const funcao = papel.trim();
      await salvar('pessoas', { ...resto, nome: limpo, salaId, ...(funcao ? { papel: funcao } : {}) });
      aoFechar(limpo);
    } catch (falha) {
      console.error('Não consegui salvar a pessoa', falha);
      setErro('Não consegui salvar. Tente de novo.');
    } finally {
      emAndamento.current = false;
    }
  }

  return (
    <form
      class="tarefa-edicao"
      noValidate
      onSubmit={salvarEdicao}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          aoFechar();
        }
      }}
    >
      <div class="formulario-campo">
        <label for={`editar-nome-${pessoa.id}`}>Nome da pessoa</label>
        <input
          id={`editar-nome-${pessoa.id}`}
          ref={campoNome}
          class="campo"
          value={nome}
          autocomplete="off"
          aria-invalid={erro ? true : undefined}
          onInput={(e) => {
            setNome((e.target as HTMLInputElement).value);
            setErro(null);
          }}
        />
      </div>
      <div class="formulario-campo">
        <label for={`editar-sala-${pessoa.id}`}>Sala da pessoa</label>
        <select
          id={`editar-sala-${pessoa.id}`}
          class="campo"
          value={salaId}
          onChange={(e) => setSalaId((e.target as HTMLSelectElement).value)}
        >
          {!salas.some((s) => s.id === salaId) && <option value={salaId}>Sem sala</option>}
          {salas.map((sala) => (
            <option key={sala.id} value={sala.id}>
              {sala.nome}
            </option>
          ))}
        </select>
      </div>
      <div class="formulario-campo">
        <label for={`editar-papel-${pessoa.id}`}>Papel da pessoa</label>
        <input
          id={`editar-papel-${pessoa.id}`}
          class="campo"
          value={papel}
          autocomplete="off"
          onInput={(e) => setPapel((e.target as HTMLInputElement).value)}
        />
      </div>
      {erro && (
        <p class="tarefa-erro" role="alert">
          {erro}
        </p>
      )}
      <div class="tarefa-edicao-acoes">
        <button type="submit" class="botao primario">
          Salvar
        </button>
        <button type="button" class="botao" onClick={() => aoFechar()}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

export function Pessoas() {
  const salas = useSalas();
  const pessoas = usePessoas();
  const [nome, setNome] = useState('');
  const [salaId, setSalaId] = useState('');
  const [papel, setPapel] = useState('');
  const [erro, setErro] = useState<Erro | null>(null);
  const [aviso, setAviso] = useState('');
  const [volta, setVolta] = useState<Desfazivel | null>(null);
  const campoNome = useRef<HTMLInputElement>(null);
  const campoSala = useRef<HTMLSelectElement>(null);
  const botaoDesfazer = useRef<HTMLButtonElement>(null);
  const focarDesfazer = useRef(false);
  const emAndamento = useRef(false);
  const [editando, setEditando] = useState<string | null>(null);
  /** A pessoa cuja edição acabou: o foco volta ao Editar dela, onde quer que a linha esteja agora. */
  const focoNoEditar = useRef<{ id: string; esperaLista: readonly Pessoa[] | null | undefined } | null>(null);

  // Apagar tira o botão em que o dono tocou: o foco vai para o Desfazer, que acabou de aparecer.
  useEffect(() => {
    if (volta && focarDesfazer.current) {
      focarDesfazer.current = false;
      botaoDesfazer.current?.focus();
    }
  }, [volta]);

  useEffect(() => {
    const pedido = focoNoEditar.current;
    if (!pedido || editando !== null) return;
    // Depois de salvar, a pessoa pode mudar de grupo: espera a lista nova chegar para achar o botão onde ele ficou.
    if (pedido.esperaLista !== null && pessoas === pedido.esperaLista) return;
    const { id } = pedido;
    const botao = Array.from(document.querySelectorAll<HTMLElement>('[data-editar]')).find((b) => b.dataset.editar === id);
    if (botao) {
      focoNoEditar.current = null;
      botao.focus();
    }
  });

  const nomeDaSala = (id: string) => salas.find((sala) => sala.id === id)?.nome ?? 'sala apagada';

  async function cadastrar(evento: Event) {
    evento.preventDefault();
    // Dois toques seguidos não cadastram duas vezes (a conferência de nome repetido é assíncrona).
    if (emAndamento.current) return;
    emAndamento.current = true;
    try {
      await cadastrarUma();
    } finally {
      emAndamento.current = false;
    }
  }

  async function cadastrarUma() {
    const limpo = nome.trim();
    if (!limpo) {
      setErro({ campo: 'nome', texto: 'Escreva o nome.' });
      return campoNome.current?.focus();
    }
    if (!salaId) {
      setErro({ campo: 'sala', texto: 'Escolha a sala.' });
      return campoSala.current?.focus();
    }
    const repetida = (await listar('pessoas')).find((p) => normalizar(p.nome) === normalizar(limpo));
    if (repetida) {
      setErro({ campo: 'nome', texto: `${repetida.nome} já está cadastrada em ${nomeDaSala(repetida.salaId)}.` });
      return campoNome.current?.focus();
    }
    try {
      const funcao = papel.trim();
      await salvar('pessoas', { nome: limpo, salaId, ...(funcao ? { papel: funcao } : {}) });
    } catch (falha) {
      console.error('Não consegui salvar a pessoa', falha);
      return setErro({ campo: 'geral', texto: 'Não consegui salvar. Tente de novo.' });
    }
    setErro(null);
    setVolta(null);
    setAviso(`${limpo} cadastrada em ${nomeDaSala(salaId)}.`);
    // Mantém a sala: quem cadastra as quatro alunas de Orientações não a escolhe quatro vezes.
    // Só limpa o que ainda é o que foi gravado: quem já começou a digitar a próxima pessoa não perde o texto.
    setNome((atual) => (atual.trim() === limpo ? '' : atual));
    setPapel((atual) => (atual.trim() === papel.trim() ? '' : atual));
    campoNome.current?.focus();
  }

  async function apagarPessoa(pessoa: Pessoa) {
    try {
      const antes = await apagar('pessoas', pessoa.id);
      if (!antes) return; // já tinha sumido em outro aparelho
      setErro(null);
      setAviso(`${antes.nome} apagada.`);
      focarDesfazer.current = true;
      setVolta(
        desfazer.registrar(`Pessoa apagada: ${antes.nome}`, async () => {
          await salvar('pessoas', antes);
        }),
      );
    } catch (falha) {
      console.error('Não consegui apagar a pessoa', falha);
      setErro({ campo: 'geral', texto: 'Não consegui apagar. Tente de novo.' });
    }
  }

  async function desfazerApagar() {
    const entrada = volta;
    if (!entrada) return;
    setVolta(null);
    try {
      await entrada.reverter();
      setAviso('Pessoa de volta à lista.');
      campoNome.current?.focus();
    } catch (falha) {
      console.error('Não consegui desfazer', falha);
      setErro({ campo: 'geral', texto: 'Não consegui desfazer. Tente de novo.' });
    }
  }

  const porSala = new Map<string, Pessoa[]>();
  for (const pessoa of pessoas ?? []) {
    const doGrupo = porSala.get(pessoa.salaId) ?? [];
    doGrupo.push(pessoa);
    porSala.set(pessoa.salaId, doGrupo);
  }
  const grupos = [
    ...salas.filter((sala) => porSala.has(sala.id)).map((sala) => ({ id: sala.id, nome: sala.nome })),
    ...[...porSala.keys()].filter((id) => !salas.some((sala) => sala.id === id)).map((id) => ({ id, nome: 'Sem sala' })),
  ];

  return (
    <section class="painel pessoas" aria-labelledby="titulo-pessoas">
      <h2 id="titulo-pessoas">Pessoas</h2>
      <p class="pessoas-dica">Cadastre quem aparece nas suas tarefas. O Chat passa a saber a sala delas.</p>
      <form class="formulario" onSubmit={cadastrar} noValidate>
        <div class="formulario-campo">
          <label for="pessoa-nome">Nome</label>
          <input
            id="pessoa-nome"
            ref={campoNome}
            class="campo"
            value={nome}
            autocomplete="off"
            aria-invalid={erro?.campo === 'nome' ? true : undefined}
            aria-describedby={erro?.campo === 'nome' ? 'pessoa-erro' : undefined}
            onInput={(e) => {
              setNome((e.target as HTMLInputElement).value);
              setErro(null);
            }}
          />
        </div>
        <div class="formulario-campo">
          <label for="pessoa-sala">Sala</label>
          <select
            id="pessoa-sala"
            ref={campoSala}
            class="campo"
            value={salaId}
            aria-invalid={erro?.campo === 'sala' ? true : undefined}
            aria-describedby={erro?.campo === 'sala' ? 'pessoa-erro' : undefined}
            onChange={(e) => {
              setSalaId((e.target as HTMLSelectElement).value);
              setErro(null);
            }}
          >
            <option value="">Escolha a sala</option>
            {salas.map((sala) => (
              <option key={sala.id} value={sala.id}>
                {sala.nome}
              </option>
            ))}
          </select>
        </div>
        <div class="formulario-campo">
          <label for="pessoa-papel">Papel (opcional)</label>
          <input
            id="pessoa-papel"
            class="campo"
            value={papel}
            placeholder="Ex.: aluna, orientador"
            autocomplete="off"
            onInput={(e) => setPapel((e.target as HTMLInputElement).value)}
          />
        </div>
        {erro && (
          <p class="tarefa-erro" id="pessoa-erro" role="alert">
            {erro.texto}
          </p>
        )}
        <button type="submit" class="botao primario">
          Cadastrar pessoa
        </button>
      </form>

      <div class="pessoas-aviso">
        <p class="pessoas-aviso-texto" role="status">{aviso}</p>
        {volta && (
          <button type="button" class="botao" ref={botaoDesfazer} onClick={() => void desfazerApagar()}>
            Desfazer
          </button>
        )}
      </div>

      {pessoas !== undefined && pessoas.length === 0 && (
        <div class="lista-vazia">
          <p class="lista-vazia-titulo">Nenhuma pessoa cadastrada.</p>
          <p class="lista-vazia-texto">Quando você cita alguém no Chat, ele usa a sala daqui.</p>
        </div>
      )}
      {grupos.map((grupo) => (
        <div class="pessoas-sala" role="group" aria-label={grupo.nome} key={grupo.id}>
          <h3 class="pessoas-sala-titulo">{grupo.nome}</h3>
          <ul class="pessoas-lista">
            {(porSala.get(grupo.id) ?? [])
              .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
              .map((pessoa) =>
                editando === pessoa.id ? (
                  <li key={pessoa.id} class="pessoa pessoa-editando">
                    <EdicaoDePessoa
                      pessoa={pessoa}
                      salas={salas}
                      nomeDaSala={nomeDaSala}
                      aoFechar={(salvou) => {
                        focoNoEditar.current = { id: pessoa.id, esperaLista: salvou ? pessoas : null };
                        if (salvou) setAviso(`${salvou} atualizada.`);
                        setEditando(null);
                      }}
                    />
                  </li>
                ) : (
                  <li key={pessoa.id} class="pessoa">
                    <a class="pessoa-nome" href={hrefDe('pessoa', pessoa.id)}>
                      {pessoa.nome}
                    </a>
                    {pessoa.papel && <span class="pessoa-papel">{pessoa.papel}</span>}
                    <button
                      type="button"
                      class="botao pessoa-editar"
                      data-editar={pessoa.id}
                      aria-label={`Editar ${pessoa.nome}`}
                      onClick={() => setEditando(pessoa.id)}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      class="botao pessoa-apagar"
                      aria-label={`Apagar ${pessoa.nome}`}
                      onClick={() => void apagarPessoa(pessoa)}
                    >
                      Apagar
                    </button>
                  </li>
                ),
              )}
          </ul>
        </div>
      ))}
    </section>
  );
}
