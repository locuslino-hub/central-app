// Cadastro mínimo de pessoas (Tarefa 9): nome, sala e papel opcional. É o que o
// chat usa para saber a sala de quem a frase cita ("Marcar reunião com a
// Marina" vai para Orientações). A Tarefa 17 traz a página própria de cada
// pessoa e substitui esta tela; os dados são os mesmos (`pessoas`).
import { useEffect, useRef, useState } from 'preact/hooks';
import { normalizar } from '../chat/datas';
import { desfazer, type Desfazivel } from '../dados/desfazer';
import { apagar, listar, salvar } from '../dados/loja';
import type { Pessoa } from '../dados/tipos';
import { usePessoas, useSalas } from './hooks';
import './tarefas.css';

type Erro = { campo: 'nome' | 'sala' | 'geral'; texto: string };

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

  // Apagar tira o botão em que o dono tocou: o foco vai para o Desfazer, que acabou de aparecer.
  useEffect(() => {
    if (volta && focarDesfazer.current) {
      focarDesfazer.current = false;
      botaoDesfazer.current?.focus();
    }
  }, [volta]);

  const nomeDaSala = (id: string) => salas.find((sala) => sala.id === id)?.nome ?? 'sala apagada';

  async function cadastrar(evento: Event) {
    evento.preventDefault();
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
              .map((pessoa) => (
                <li key={pessoa.id} class="pessoa">
                  <span class="pessoa-nome">{pessoa.nome}</span>
                  {pessoa.papel && <span class="pessoa-papel">{pessoa.papel}</span>}
                  <button
                    type="button"
                    class="botao pessoa-apagar"
                    aria-label={`Apagar ${pessoa.nome}`}
                    onClick={() => void apagarPessoa(pessoa)}
                  >
                    Apagar
                  </button>
                </li>
              ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
