# Provas

## Script do Google (5/11/2026)

Tempo de `ping` pela tela Conectar aparelho. Critério: até 10 s.

| Aparelho | Tempo | Resultado |
|---|---|---|
| Notebook | 1,4 s | Passou |
| Celular | 1,4 s | Passou |

Autorização sem repetir (conferir em 7 dias): não registrado.

## IA local e links (8/11/2026)

Teste de IA (`teste-ia.html?m=E4B`) no notebook:

| Rodada | Tempo para abrir | Resultado |
|---|---|---|
| 1ª | 145,4 s | 7 de 10 certas |
| 2ª | 291,4 s | Mais lenta que a 1ª |

Armazenamento persistente: não concedido. A 2ª abertura foi mais lenta,
então o modelo não ficou guardado pelo cache do navegador. A Tarefa 21 deve
salvar o modelo explicitamente e pedir persistência; provar o tempo da 2ª
abertura no app instalado (Tarefas 21 e 22).

Links do OneDrive (link copiado pelo OneDrive, colado em `teste-links.html`):

| Aparelho | Word | PowerPoint |
|---|---|---|
| Notebook | Abriu | Abriu |
| Celular | Não testado | Não testado |

O dono abre arquivos pelo gerenciador de arquivos; a Central depende do link copiado.
Celular fica para a prova da Tarefa 22.

## Sincronização (8/11/2026)

Tarefa criada num aparelho aparece no outro em até 60 s.

| Sentido | Resultado |
|---|---|
| Notebook → celular | Passou |
| Celular → notebook | Passou |

Leitura do arquivo no Drive pela API REST (escopos `drive.file` e
`script.external_request`). A janela de permissão do Google não abriu no
DuckDuckGo; foi aprovada pelo Chrome.

## Estado das provas das Tarefas 3, 21 e 22 (registro da auditoria V02)

Só consta o que está neste arquivo ou nos testes do repositório. O que não
tem medição registrada fica como "não medido".

### Tarefa 3 (provas restantes)

- Provado neste arquivo: tempo do script (notebook e celular, 1,4 s cada); IA
  local no notebook (145,4 s e 7 de 10 certas na 1ª rodada, 291,4 s na 2ª);
  links do OneDrive no notebook (Word e PowerPoint abriram). A página
  `public/teste-links.html` tem teste automatizado (`tests/e2e/teste-links.spec.ts`).
- Não medido: links do OneDrive no celular (Word e PowerPoint); tempo da IA no
  celular; armazenamento persistente concedido (no teste da Tarefa 3 não foi);
  autorização do script depois de 7 dias.

### Tarefa 21 (IA local no chat)

- Provado nos testes automatizados (IA falsa): `tests/ia/` e
  `tests/chat/interpretar-ia.test.ts`; e `tests/e2e/ia.spec.ts` no navegador.
- Não medido: download do modelo pelo app no notebook e no celular; tempo por
  frase no app (critério do plano: até 15 s por frase comum); as 10 frases
  testadas no app; persistência do armazenamento no app instalado; tempo da
  2ª abertura com o modelo guardado.

### Tarefa 22 (offline e instalação)

- Provado nos testes automatizados: `tests/e2e/service-worker.spec.ts`,
  `tests/e2e/fluxos.spec.ts` e `tests/e2e/navegacao.spec.ts`.
- Não medido: instalação do app no celular e no notebook (passo do dono);
  abertura sem internet em aparelho real; links do OneDrive no celular
  (ficaram para esta prova e não foram registrados).
