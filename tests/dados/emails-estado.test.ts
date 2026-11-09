import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adiarEmail, aparece, concluirEmail, podarEstados, tituloDaTarefa, virarTarefa } from '../../src/dados/emails-estado';
import { listar, salvar, semear } from '../../src/dados/loja';
import { lembrarComoPessoa, lembrarComoSala, origemDoRemetente, resumoDoEndereco } from '../../src/dados/remetentes';
import type { EstadoEmail, Pessoa } from '../../src/dados/tipos';
import { email, gmailDeTeste } from '../apoio/emails-ui';

const AGORA = Date.parse('2026-11-05T12:20:00Z');
const DIA_MS = 24 * 60 * 60 * 1000;

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AGORA);
});

describe('Feito e Agora não', () => {
  it('Feito esconde o e-mail; Desfazer o traz de volta; só id e a marca ficam guardados', async () => {
    const entrada = await concluirEmail('mensagem1');
    const [estado] = await listar('estadosEmail');
    expect(estado).toMatchObject({ id: 'mensagem1', feito: true });
    expect(Object.keys(estado).sort()).toEqual(['aparelho', 'atualizadoEm', 'feito', 'id']);
    expect(aparece(estado, '2026-11-05')).toBe(false);
    expect(aparece(estado, '2026-12-25')).toBe(false);

    await entrada.reverter();
    expect(await listar('estadosEmail')).toEqual([]);
    expect(aparece(undefined, '2026-11-05')).toBe(true);
  });

  it('Feito e Agora não nunca chamam o script: o Gmail não muda', async () => {
    const gmail = await gmailDeTeste([email('A')]);
    const a = await concluirEmail('mensagem1');
    await adiarEmail('mensagem2', '2026-11-05');
    await a.reverter();
    expect(gmail.pedidos).toHaveLength(0);
  });

  it('Agora não some hoje e volta no dia seguinte (dia de Lisboa)', async () => {
    await adiarEmail('mensagem1', '2026-11-05');
    const [estado] = await listar('estadosEmail');
    expect(estado).toMatchObject({ id: 'mensagem1', feito: false, adiadaAte: '2026-11-06' });
    expect(aparece(estado, '2026-11-05')).toBe(false);
    expect(aparece(estado, '2026-11-06')).toBe(true);
    expect(aparece(estado, '2026-11-20')).toBe(true);
  });

  it('Agora não na virada do mês soma o dia certo', async () => {
    await adiarEmail('mensagem1', '2026-11-30');
    expect((await listar('estadosEmail'))[0].adiadaAte).toBe('2026-12-01');
  });

  it('Desfazer devolve o estado anterior: Feito sobre Agora não, desfeito, volta a Agora não', async () => {
    await adiarEmail('mensagem1', '2026-11-05');
    const feito = await concluirEmail('mensagem1');
    await feito.reverter();
    const [estado] = await listar('estadosEmail');
    expect(estado).toMatchObject({ feito: false, adiadaAte: '2026-11-06' });
  });
});

describe('poda dos estados', () => {
  it('estado com mais de 15 dias é apagado; com menos, fica', async () => {
    await concluirEmail('velho');
    await concluirEmail('novo');
    vi.setSystemTime(AGORA + 16 * DIA_MS);
    await concluirEmail('recente'); // gravado "hoje", 16 dias depois dos outros
    expect(await podarEstados(Date.now())).toBe(2);
    const vivos = (await listar('estadosEmail')).map((e: EstadoEmail) => e.id);
    expect(vivos).toEqual(['recente']);
    // E 14 dias depois ainda vale.
    expect(await podarEstados(Date.now() + 14 * DIA_MS)).toBe(0);
  });
});

describe('Virar tarefa', () => {
  it('cria a tarefa com emailId, a sala e a pessoa, sem prazo; Desfazer a apaga', async () => {
    const resultado = await virarTarefa(email('Revisão do capítulo 2'), { salaId: 'sala-orientacoes', pessoaId: 'pessoa-1' });
    const [tarefa] = await listar('tarefas');
    expect(tarefa).toMatchObject({
      titulo: 'Responder: Revisão do capítulo 2',
      emailId: resultado!.tarefa.emailId,
      salaId: 'sala-orientacoes',
      pessoaId: 'pessoa-1',
      feito: false,
    });
    expect(tarefa.data).toBeUndefined();
    expect(tarefa.emailId).toMatch(/^mensagem\d+$/);

    await resultado!.entrada!.reverter();
    expect(await listar('tarefas')).toEqual([]);
  });

  it('um e-mail só vira uma tarefa: pedir de novo devolve a que existe', async () => {
    const e = email('Prazo');
    const primeira = await virarTarefa(e, { salaId: null });
    const segunda = await virarTarefa(e, { salaId: null });
    expect(segunda!.tarefa.id).toBe(primeira!.tarefa.id);
    expect(segunda!.entrada).toBeUndefined();
    expect(await listar('tarefas')).toHaveLength(1);
  });

  it('a tarefa não guarda trecho nem endereço', async () => {
    await virarTarefa(email('Prazo', { trecho: 'Trecho secreto', enderecoRemetente: 'quem@exemplo.invalid' }), { salaId: null });
    const texto = JSON.stringify(await listar('tarefas'));
    expect(texto).not.toContain('secreto');
    expect(texto).not.toContain('quem@');
  });

  it('título: assunto longo é cortado; sem assunto usa o remetente', () => {
    expect(tituloDaTarefa({ assunto: 'x'.repeat(200), remetente: 'M' })).toHaveLength('Responder: '.length + 80);
    expect(tituloDaTarefa({ assunto: '  ', remetente: 'Prof. Souza' })).toBe('Responder a Prof. Souza');
    expect(tituloDaTarefa({ assunto: '', remetente: '' })).toBe('Responder e-mail');
  });
});

describe('sala de quem enviou', () => {
  const pessoa = (extra: Partial<Pessoa> = {}): Pessoa => ({
    id: 'pessoa-marina',
    atualizadoEm: 1,
    aparelho: 'a',
    nome: 'Marina',
    salaId: 'sala-orientacoes',
    emails: ['Marina@Exemplo.Invalid'],
    ...extra,
  });

  it('vem de Pessoa.emails, sem diferenciar maiúsculas', () => {
    const origem = origemDoRemetente('marina@exemplo.invalid', [pessoa()]);
    expect(origem).toMatchObject({ sabe: true, salaId: 'sala-orientacoes' });
    expect(origem.pessoa?.nome).toBe('Marina');
  });

  it('pessoa apagada não vale; sem pessoa, o app não sabe e pergunta', () => {
    expect(origemDoRemetente('marina@exemplo.invalid', [pessoa({ apagado: true })])).toEqual({ sabe: false, salaId: null });
    expect(origemDoRemetente('outra@exemplo.invalid', [pessoa()])).toEqual({ sabe: false, salaId: null });
  });

  it('sem endereço não há o que perguntar', () => {
    expect(origemDoRemetente('', [])).toEqual({ sabe: true, salaId: null });
  });

  it('"É a Marina": o endereço entra nos e-mails dela e a pergunta não volta', async () => {
    await semear();
    const marina = await salvar('pessoas', { nome: 'Marina', salaId: 'sala-orientacoes' });
    expect(await lembrarComoPessoa('Nova@Exemplo.Invalid', marina.id)).toBe(true);
    expect(await lembrarComoPessoa('nova@exemplo.invalid', marina.id)).toBe(true);
    const [salva] = await listar('pessoas');
    expect(salva.emails).toEqual(['nova@exemplo.invalid']);
    expect(origemDoRemetente('nova@exemplo.invalid', [salva])).toMatchObject({ sabe: true, salaId: 'sala-orientacoes' });
    expect(await lembrarComoPessoa('x@exemplo.invalid', 'nao-existe')).toBe(false);
  });

  it('só a sala (ou sem sala) fica neste aparelho, sem o endereço no armazenamento', () => {
    lembrarComoSala('Aurora@Exemplo.Invalid', 'sala-casa');
    lembrarComoSala('sem@exemplo.invalid', null);
    expect(origemDoRemetente('aurora@exemplo.invalid', [])).toEqual({ sabe: true, salaId: 'sala-casa' });
    expect(origemDoRemetente('sem@exemplo.invalid', [])).toEqual({ sabe: true, salaId: null });
    expect(origemDoRemetente('outro@exemplo.invalid', [])).toEqual({ sabe: false, salaId: null });
    const guardado = JSON.stringify({ ...localStorage });
    expect(guardado).not.toContain('@');
    expect(guardado).not.toContain('aurora');
    expect(resumoDoEndereco('A@x.invalid')).toBe(resumoDoEndereco(' a@X.invalid '));
  });

  it('a lista guarda a ordem de verdade: com 300 respostas, a mais antiga sai e quem respondeu de novo fica', () => {
    // Endereços numerados: resumos que podem ser só dígitos, que um objeto reordenaria.
    const endereco = (n: number) => `pessoa${n}@exemplo.invalid`;
    for (let n = 0; n < 300; n++) lembrarComoSala(endereco(n), 'sala-casa');
    lembrarComoSala(endereco(0), 'sala-mba'); // responde de novo: vai para o fim
    lembrarComoSala(endereco(300), 'sala-aulas'); // o 301º: sai o mais antigo, que agora é o 1
    expect(origemDoRemetente(endereco(1), [])).toEqual({ sabe: false, salaId: null });
    expect(origemDoRemetente(endereco(0), [])).toEqual({ sabe: true, salaId: 'sala-mba' });
    expect(origemDoRemetente(endereco(2), [])).toEqual({ sabe: true, salaId: 'sala-casa' });
    expect(origemDoRemetente(endereco(300), [])).toEqual({ sabe: true, salaId: 'sala-aulas' });
    const guardado = JSON.parse(localStorage.getItem('central-remetentes')!);
    expect(Array.isArray(guardado)).toBe(true);
    expect(guardado).toHaveLength(300);
    expect(guardado[guardado.length - 1]).toEqual([expect.any(String), 'sala-aulas']);
  });

  it('lê o formato antigo (objeto) e passa a gravar em lista', () => {
    localStorage.setItem('central-remetentes', JSON.stringify({ [resumoDoEndereco('velho@exemplo.invalid')]: 'sala-casa' }));
    expect(origemDoRemetente('velho@exemplo.invalid', [])).toEqual({ sabe: true, salaId: 'sala-casa' });
    lembrarComoSala('novo@exemplo.invalid', null);
    const guardado = JSON.parse(localStorage.getItem('central-remetentes')!);
    expect(guardado).toEqual([
      [resumoDoEndereco('velho@exemplo.invalid'), 'sala-casa'],
      [resumoDoEndereco('novo@exemplo.invalid'), ''],
    ]);
  });

  it('armazenamento quebrado não derruba nada', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    expect(() => lembrarComoSala('a@exemplo.invalid', 'sala-casa')).not.toThrow();
    expect(origemDoRemetente('a@exemplo.invalid', [])).toEqual({ sabe: false, salaId: null });
  });
});
