// "Nova pasta" (V02, Tarefa 12). Quinta-feira, 2026-11-05, 12:20 em Lisboa. Nomes fictícios.
import { configure, fireEvent, render, waitFor, within } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { limparConversa } from '../../src/chat/conversa';
import { listar, semear, semearPalavras } from '../../src/dados/loja';
import { falsoDoScript, reiniciarFalso } from '../apoio/pastas-falsas';

vi.mock('../../src/dados/pastas', async (importar) => (await import('../apoio/pastas-falsas')).comScriptFalso(await importar<typeof import('../../src/dados/pastas')>()));

configure({ asyncUtilTimeout: 5000 });

beforeEach(async () => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-11-05T12:20:00Z'));
  limparConversa();
  reiniciarFalso();
  await semear();
  await semearPalavras();
});

const principal = () => within(document.querySelector('main') as HTMLElement);

/** Abre a sala e o formulário "Nova pasta". */
async function abrirFormulario(sala = 'sala-casa') {
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true, writable: true });
  history.replaceState(null, '', `/#/sala/${sala}`);
  render(<App />);
  const secao = within(await principal().findByRole('region', { name: 'Pastas' }));
  fireEvent.click(await secao.findByRole('button', { name: /Nova pasta/ }));
  const form = await principal().findByRole('form', { name: 'Nova pasta' });
  return { secao, form: within(form), formulario: form };
}

const escrever = (campo: HTMLElement, valor: string) => fireEvent.input(campo, { target: { value: valor } });
const tipo = (form: ReturnType<typeof within>, nome: string) => fireEvent.click(form.getByRole('radio', { name: nome }));
const criar = (form: ReturnType<typeof within>) => fireEvent.click(form.getByRole('button', { name: 'Criar pasta' }));

describe('formulário Nova pasta', () => {
  it('abre com os 4 tipos, o campo de nome e as ações', async () => {
    const { form } = await abrirFormulario();

    expect(form.getAllByRole('radio').map((r) => (r as HTMLInputElement).labels?.[0].textContent)).toEqual(['Lista', 'Registro', 'Planilha ligada', 'Pasta comum']);
    expect(form.getByLabelText('Nome da pasta')).toBeTruthy();
    expect(form.getByRole('button', { name: 'Criar pasta' })).toBeTruthy();
    expect(form.getByRole('button', { name: 'Cancelar' })).toBeTruthy();
    // Cada tipo explica o que é (descrição ligada ao botão de escolha).
    expect(form.getByRole('radio', { name: 'Pasta comum' }).getAttribute('aria-describedby')).toBeTruthy();
  });

  it('tipo Planilha ligada mostra a dica de que a pasta é compartilhada; os outros tipos, não', async () => {
    const { form } = await abrirFormulario();
    const dica = 'Fica na pasta Casa (partilhada): quem tiver acesso à pasta vê os gastos.';
    expect(form.queryByText(dica)).toBeNull();
    tipo(form, 'Planilha ligada');
    expect(form.getByText(dica)).toBeTruthy();
    tipo(form, 'Lista');
    expect(form.queryByText(dica)).toBeNull();
  });

  it('o foco vai para o formulário ao abrir e Cancelar fecha e devolve o foco ao botão', async () => {
    const { secao, form, formulario } = await abrirFormulario();
    expect(formulario.contains(document.activeElement)).toBe(true);

    fireEvent.click(form.getByRole('button', { name: 'Cancelar' }));

    await waitFor(() => expect(principal().queryByRole('form', { name: 'Nova pasta' })).toBeNull());
    expect(document.activeElement).toBe(secao.getByRole('button', { name: /Nova pasta/ }));
    expect(await listar('pastas')).toEqual([]);
  });

  it('Esc fecha o formulário', async () => {
    const { formulario } = await abrirFormulario();
    fireEvent.keyDown(formulario, { key: 'Escape' });
    await waitFor(() => expect(principal().queryByRole('form', { name: 'Nova pasta' })).toBeNull());
  });

  it('lista pede o modelo de compras e cria a planilha', async () => {
    const { form } = await abrirFormulario();
    tipo(form, 'Lista');
    expect(form.getByText(/planilha de compras/)).toBeTruthy();
    escrever(form.getByLabelText('Nome da pasta'), 'Compras da Renata');

    criar(form);

    expect(await principal().findByText('Pasta criada')).toBeTruthy();
    expect(falsoDoScript().pedidos).toEqual([{ acao: 'criarPlanilha', dados: { nome: 'Compras da Renata', modelo: 'compras' } }]);
    const [pasta] = await listar('pastas');
    expect(pasta).toMatchObject({ salaId: 'sala-casa', tipo: 'lista', nome: 'Compras da Renata', modelo: 'compras', planilhaId: 'planilha-ficticia-1' });
    // O formulário fecha e o cartão tem o link para abrir a pasta.
    expect(principal().queryByRole('form', { name: 'Nova pasta' })).toBeNull();
    const abrir = principal().getByRole('link', { name: 'Abrir' });
    expect(abrir.getAttribute('href')).toBe(`#/sala/sala-casa/pasta/${pasta.id}`);
  });

  it('registro de consumo pede serviço, unidade e dia de envio', async () => {
    const { form } = await abrirFormulario();
    tipo(form, 'Registro');

    const servico = form.getByLabelText('Serviço') as HTMLSelectElement;
    expect(Array.from(servico.options).map((o) => o.textContent)).toEqual(['Água', 'Luz', 'Gás']);
    // A unidade vem do serviço e aparece como texto; o seletor só abre em "Trocar".
    expect(form.getByText('Unidade: m³ (vem do serviço)')).toBeTruthy();
    expect(form.queryByLabelText('Unidade')).toBeNull();
    fireEvent.change(servico, { target: { value: 'luz' } });
    expect(form.getByText('Unidade: kWh (vem do serviço)')).toBeTruthy();
    fireEvent.change(servico, { target: { value: 'gas' } });
    expect(form.getByText('Unidade: m³ (vem do serviço)')).toBeTruthy();

    escrever(form.getByLabelText('Nome da pasta'), 'Gás do apartamento');
    escrever(form.getByLabelText('Dia de envio (opcional)'), '12');
    criar(form);

    expect(await principal().findByText('Pasta criada')).toBeTruthy();
    expect(falsoDoScript().pedidos[0]).toEqual({ acao: 'criarPlanilha', dados: { nome: 'Gás do apartamento', modelo: 'consumo' } });
    const [pasta] = await listar('pastas');
    expect(pasta).toMatchObject({ tipo: 'registro', modelo: 'consumo', servico: 'gas', unidade: 'm³', diaDeEnvio: 12 });
  });

  it('"Trocar" abre o seletor só com as duas unidades permitidas, e a dica fala em medidor', async () => {
    const { form } = await abrirFormulario();
    tipo(form, 'Registro');

    fireEvent.click(form.getByRole('button', { name: 'Trocar a unidade' }));

    const unidade = form.getByLabelText('Unidade') as HTMLSelectElement;
    expect(Array.from(unidade.options).map((o) => o.value)).toEqual(['m³', 'kWh']);
    expect(unidade.value).toBe('m³');
    expect(form.getByText('Vem do serviço. Troque só se o seu medidor usar outra.')).toBeTruthy();
  });

  it('trocar o serviço depois de abrir o seletor volta a unidade ao automático', async () => {
    const { form } = await abrirFormulario();
    tipo(form, 'Registro');
    fireEvent.click(form.getByRole('button', { name: 'Trocar a unidade' }));
    fireEvent.change(form.getByLabelText('Unidade'), { target: { value: 'kWh' } });

    fireEvent.change(form.getByLabelText('Serviço'), { target: { value: 'gas' } });

    expect(form.queryByLabelText('Unidade')).toBeNull();
    expect(form.getByText('Unidade: m³ (vem do serviço)')).toBeTruthy();
  });

  it('a unidade pode ser trocada à mão (entre as permitidas) e não volta sozinha', async () => {
    const { form } = await abrirFormulario();
    tipo(form, 'Registro');
    fireEvent.click(form.getByRole('button', { name: 'Trocar a unidade' }));
    const unidade = form.getByLabelText('Unidade') as HTMLSelectElement;
    fireEvent.change(unidade, { target: { value: 'kWh' } });
    escrever(form.getByLabelText('Nome da pasta'), 'Água com contador estranho');

    criar(form);

    expect(await principal().findByText('Pasta criada')).toBeTruthy();
    expect((await listar('pastas'))[0]).toMatchObject({ servico: 'agua', unidade: 'kWh' });
  });

  it('dia de envio é opcional: sem ele, a pasta não leva o campo', async () => {
    const { form } = await abrirFormulario();
    tipo(form, 'Registro');
    escrever(form.getByLabelText('Nome da pasta'), 'Luz');
    criar(form);
    expect(await principal().findByText('Pasta criada')).toBeTruthy();
    expect((await listar('pastas'))[0].diaDeEnvio).toBeUndefined();
  });

  it.each(['0', '32', '2.5', '-1', 'abc'])('dia de envio %s é recusado, com aviso no campo, e nada é criado', async (dia) => {
    const { form } = await abrirFormulario();
    tipo(form, 'Registro');
    escrever(form.getByLabelText('Nome da pasta'), 'Luz');
    const campo = form.getByLabelText('Dia de envio (opcional)') as HTMLInputElement;
    // O campo numérico do navegador já recusa letras; para o resto, o texto chega como foi digitado.
    fireEvent.input(campo, { target: { value: dia } });

    criar(form);

    await waitFor(() => expect(form.getByText('Use um dia de 1 a 31.')).toBeTruthy());
    expect(campo.getAttribute('aria-invalid')).toBe('true');
    expect(falsoDoScript().pedidos).toEqual([]);
    expect(await listar('pastas')).toEqual([]);
  });

  it('planilha ligada usa o modelo financeiro e não pede serviço', async () => {
    const { form } = await abrirFormulario();
    tipo(form, 'Planilha ligada');
    expect(form.queryByLabelText('Serviço')).toBeNull();
    expect(form.getByText(/planilha de lançamentos/)).toBeTruthy();
    escrever(form.getByLabelText('Nome da pasta'), 'Contas da casa');

    criar(form);

    expect(await principal().findByText('Pasta criada')).toBeTruthy();
    expect(falsoDoScript().pedidos[0].dados).toEqual({ nome: 'Contas da casa', modelo: 'financeiro' });
    expect((await listar('pastas'))[0]).toMatchObject({ tipo: 'planilha', modelo: 'financeiro' });
  });

  it('pasta comum não cria planilha nem chama o Google', async () => {
    const { form } = await abrirFormulario('sala-doutoramento');
    expect(form.getByText(/sem planilha/i)).toBeTruthy();
    escrever(form.getByLabelText('Nome da pasta'), 'Metodologia');

    criar(form);

    expect(await principal().findByText('Pasta criada')).toBeTruthy();
    expect(falsoDoScript().pedidos).toEqual([]);
    const [pasta] = await listar('pastas');
    expect(pasta).toMatchObject({ salaId: 'sala-doutoramento', tipo: 'comum', nome: 'Metodologia' });
    expect(pasta.planilhaId).toBeUndefined();
    expect(pasta.modelo).toBeUndefined();
  });

  it('fora da Casa não há escolha de tipo: só o nome, e cria uma pasta comum', async () => {
    const { form, formulario } = await abrirFormulario('sala-aulas');

    expect(form.queryAllByRole('radio')).toEqual([]);
    expect(form.queryByText('Tipo de pasta')).toBeNull();
    // O foco vai para o nome (não há tipo para focar).
    expect(document.activeElement).toBe(form.getByLabelText('Nome da pasta'));
    expect(formulario.querySelector('fieldset')).toBeNull();
    escrever(form.getByLabelText('Nome da pasta'), 'Provas');

    criar(form);

    expect(await principal().findByText('Pasta criada')).toBeTruthy();
    expect(falsoDoScript().pedidos).toEqual([]);
    expect((await listar('pastas'))[0]).toMatchObject({ salaId: 'sala-aulas', tipo: 'comum', nome: 'Provas' });
  });

  it('ao abrir, o formulário é trazido para a vista sem rolar à toa', async () => {
    const rolar = vi.fn();
    Element.prototype.scrollIntoView = rolar;
    await abrirFormulario();
    expect(rolar).toHaveBeenCalledWith({ block: 'nearest' });
  });

  it('na Casa o tipo já marcado é a lista', async () => {
    const { form } = await abrirFormulario('sala-casa');
    expect((form.getByRole('radio', { name: 'Lista' }) as HTMLInputElement).checked).toBe(true);
  });

  it('nome vazio mostra o aviso no campo e não chama o Google', async () => {
    const { form } = await abrirFormulario();
    tipo(form, 'Lista');
    escrever(form.getByLabelText('Nome da pasta'), '   ');

    criar(form);

    expect(await form.findByText('Escreva um nome para a pasta.')).toBeTruthy();
    expect(form.getByLabelText('Nome da pasta').getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(form.getByLabelText('Nome da pasta'));
    expect(falsoDoScript().pedidos).toEqual([]);
  });

  it('o botão fica desligado enquanto cria e o toque duplo não cria duas planilhas', async () => {
    const segurar = falsoDoScript().segurarProximaCriacao();
    const { form } = await abrirFormulario();
    tipo(form, 'Lista');
    escrever(form.getByLabelText('Nome da pasta'), 'Compras');
    const botao = form.getByRole('button', { name: 'Criar pasta' });

    fireEvent.click(botao);
    fireEvent.click(botao);

    const criando = (await form.findByRole('button', { name: /Criando/ })) as HTMLButtonElement;
    expect(criando.disabled).toBe(true);
    expect(form.getByText(/Criando a planilha no seu Drive/)).toBeTruthy();
    segurar.soltar();
    expect(await principal().findByText('Pasta criada')).toBeTruthy();
    expect(falsoDoScript().planilhasCriadas).toBe(1);
    expect(await listar('pastas')).toHaveLength(1);
  });

  it('erro do Google: mostra a mensagem, não cria pasta nenhuma e deixa tentar de novo com o que foi digitado', async () => {
    falsoDoScript().falharNaCriacao(1);
    const { form } = await abrirFormulario();
    tipo(form, 'Lista');
    escrever(form.getByLabelText('Nome da pasta'), 'Compras da semana');

    criar(form);

    const alerta = await form.findByRole('alert');
    expect(alerta.textContent).toMatch(/Nada foi criado/);
    expect(alerta.textContent).not.toMatch(/interno|ErroScript/);
    expect(await listar('pastas')).toEqual([]);
    expect((form.getByLabelText('Nome da pasta') as HTMLInputElement).value).toBe('Compras da semana');
    const botao = form.getByRole('button', { name: 'Criar pasta' }) as HTMLButtonElement;
    expect(botao.disabled).toBe(false);
    expect(alerta.classList.contains('pastas-erro')).toBe(true);

    // O "Tentar de novo" fica dentro do bloco do aviso e envia o mesmo formulário.
    fireEvent.click(within(alerta).getByRole('button', { name: 'Tentar de novo' }));
    expect(await principal().findByText('Pasta criada')).toBeTruthy();
    expect(await listar('pastas')).toHaveLength(1);
  });

  it('Casa ainda solta na raiz do Drive: manda rodar organizarPastaCentral e não cria pasta', async () => {
    falsoDoScript().pedirParaOrganizarPastas();
    const { form } = await abrirFormulario();
    tipo(form, 'Lista');
    escrever(form.getByLabelText('Nome da pasta'), 'Compras');

    criar(form);

    const alerta = await form.findByRole('alert');
    expect(alerta.textContent).toMatch(/Rode organizarPastaCentral no script \(veja o GUIA\) e tente de novo/);
    expect(await listar('pastas')).toEqual([]);
  });

  it('sem conexão: avisa, mantém o botão e funciona quando a internet volta', async () => {
    falsoDoScript().cair();
    const { form } = await abrirFormulario();
    tipo(form, 'Lista');
    escrever(form.getByLabelText('Nome da pasta'), 'Compras');

    criar(form);

    const alerta = await form.findByRole('alert');
    expect(alerta.textContent).toMatch(/conexão/i);
    expect(await listar('pastas')).toEqual([]);
    falsoDoScript().voltar();
    criar(form);
    expect(await principal().findByText('Pasta criada')).toBeTruthy();
  });

  it('trocar de tipo limpa o aviso de erro', async () => {
    falsoDoScript().falharNaCriacao(1);
    const { form } = await abrirFormulario();
    tipo(form, 'Lista');
    escrever(form.getByLabelText('Nome da pasta'), 'Compras');
    criar(form);
    await form.findByRole('alert');

    tipo(form, 'Pasta comum');

    expect(form.queryByRole('alert')).toBeNull();
  });

  it('Desfazer quando a pasta já foi apagada em outro aparelho diz isso, sem inventar nada', async () => {
    const { form } = await abrirFormulario();
    tipo(form, 'Lista');
    escrever(form.getByLabelText('Nome da pasta'), 'Compras');
    criar(form);
    await principal().findByText('Pasta criada');
    falsoDoScript().apagarRetornaVazio();

    fireEvent.click(principal().getByRole('button', { name: 'Desfazer' }));

    expect(await principal().findByText('Esta pasta já não estava aqui.')).toBeTruthy();
    expect(principal().queryByRole('button', { name: 'Desfazer' })).toBeNull();
    expect(principal().queryByText('Desfeito')).toBeNull();
  });

  it('Desfazer tira a pasta e diz que a planilha continua no Drive', async () => {
    const { form } = await abrirFormulario();
    tipo(form, 'Lista');
    escrever(form.getByLabelText('Nome da pasta'), 'Compras');
    criar(form);
    await principal().findByText('Pasta criada');

    fireEvent.click(principal().getByRole('button', { name: 'Desfazer' }));

    expect(await principal().findByText('Desfeito')).toBeTruthy();
    expect(principal().getByText(/A planilha continua no seu Drive/)).toBeTruthy();
    expect(await listar('pastas')).toEqual([]);
    expect(principal().queryByRole('button', { name: 'Desfazer' })).toBeNull();
  });
});

// ---- Acessibilidade (Tarefa 19, correções): foco e região viva ----

describe('acessibilidade do formulário Nova pasta', () => {
  it('"Trocar a unidade" leva o foco ao seletor Unidade (o botão some quando o seletor abre)', async () => {
    const { form } = await abrirFormulario();
    tipo(form, 'Registro');

    const trocar = form.getByRole('button', { name: 'Trocar a unidade' });
    trocar.focus();
    fireEvent.click(trocar);

    const unidade = form.getByLabelText('Unidade') as HTMLSelectElement;
    await waitFor(() => expect(document.activeElement).toBe(unidade));
  });

  it('o andamento ("Criando a planilha…") entra numa região viva que já existia vazia', async () => {
    const { form, formulario } = await abrirFormulario();
    const regiao = formulario.querySelector('.aviso-vivo') as HTMLElement;
    expect(regiao.getAttribute('role')).toBe('status');
    expect(regiao.textContent).toBe('');

    const segurar = falsoDoScript().segurarProximaCriacao();
    escrever(form.getByLabelText('Nome da pasta'), 'Compras do mês');
    criar(form);

    await waitFor(() => expect(regiao.textContent).toMatch(/Criando a planilha no seu Drive/));
    expect(formulario.querySelector('.aviso-vivo')).toBe(regiao); // o mesmo elemento: só o texto mudou
    segurar.soltar();
  });
});
