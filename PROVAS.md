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

## V02 (fechamento, 19/11/2026)

Voz, Ideias, pastas da Casa, planilhas, Registro de consumo, listas, Financeiro e
pasta comum. Só consta o que foi medido ou tem teste no repositório.

### Provado no celular Android de teste (spike de voz, 17/11)

| Pergunta | Resultado |
|---|---|
| Reconhecer a fala sem um toque antes | Não: a escuta só começa dentro do toque no microfone |
| Texto ao vivo e escuta que sobrevive a uma pausa de 5 s | Sim |
| Reconhecer a fala e gravar o áudio ao mesmo tempo | Sim |
| App instalado aparece em tecla lateral, duplo toque, abrir app | Sim |
| Aviso com a permissão do microfone negada | Não testado |

O microfone do chat (que na V02 era a tela "Pode falar") foi feito a partir desse resultado.

Privacidade da voz: o reconhecimento de fala usa o serviço do navegador, que
envia o áudio ao Google (no Chrome do Android). O chat avisa isso ao
lado do microfone; quem não quer enviar escreve no campo de texto. O áudio
gravado pela chave "Gravar áudio" é outra coisa: vai só para o Drive do dono.

### Provado nos testes automatizados (Google de mentira)

- `npx vitest run --maxWorkers=1`: 140 arquivos, 4248 testes passam. Cobrem o
  roteador de frases (gasto, leitura, compras, tema), o cliente de planilhas
  (cache, fila, conflito, linha apagada, coluna faltando), o consumo, o
  financeiro (números em formato brasileiro e europeu, R$ recusado), as pastas
  e as telas.
- `npm run e2e` (Playwright): a jornada completa em `tests/e2e/jornada-v02.spec.ts`
  (dizer uma ideia no chat, levar para outra sala, virar tarefa, criar as pastas padrão
  da Casa, falar leitura de água, compras e gasto, criar tarefa no tema de uma
  pasta comum). Rodada completa de 19/11: 279 passam, 1 saltado (uma falha instável conhecida
  passou ao repetir).
- Acessibilidade das telas novas (Ideias, chat com o microfone e os cartões abertos, Lista,
  Registro, Financeiro, Pasta comum, Nova pasta), em 1280 e 375 px
  (`tests/e2e/acessibilidade-v02.spec.ts`): axe sem erro grave (todas as regras);
  sinal visível de foco em cada parada do Tab; fluxos principais só com o
  teclado (Tab, Enter, Espaço, setas, Esc). Nada precisou ser corrigido.
- Privacidade: a varredura de e-mails, endereços de planilha e do script no
  código, nos testes e nos textos só achou dados fictícios (`exemplo.invalid`,
  `ID-FICTICIO`).

### Não medido (fica para o dono)

- **Google real:** nenhuma ação nova do script rodou no Google de verdade
  (criar planilha, ler e gravar linhas, áudio, pasta "Central" e "Casa (partilhada)" dentro dela). A
  lista do que conferir ao publicar está em `docs/progresso.md` (repositório
  privado): buscas `'me' in owners` e `mimeType`, `Files.create` com `parents`,
  formato de data e número em planilha de outro idioma, mensagens de erro 403 e
  404, download de áudio, caixa de seleção em `Comprado?`.
- **Autorização nova (`autorizarV02`) e a organização da pasta Central (`organizarPastaCentral`: mover para `Central` o arquivo de dados, as cópias e a `Casa (partilhada)` com `addParents`/`removeParents`):** não rodadas no Google real. Depois de rodar `autorizarV02`, conferir no Drive que `Central` tem o arquivo de dados, as cópias e `Casa (partilhada)`, que a raiz não tem mais esses itens e que o app continua sincronizando (GUIA, parte 9).
- **Celular real:** frase contínua de 20 s sem texto repetido; atalho do ícone
  instalado (agora "Falar no chat": abre o app já ouvindo; o navegador pode recusar a escuta sem toque, e o aviso manda tocar no microfone); mensagem com a permissão do microfone negada; gravação de áudio
  com a tela apagada; tempo de resposta das telas novas.
- **TalkBack** (leitor de tela do Android) no chat com o microfone, nas Ideias e na Lista:
  não testado. Teste do dono: abrir cada tela com o TalkBack ligado, percorrer
  deslizando, conferir que cada botão e campo é lido com nome claro, que o
  cartão de resultado é anunciado e que o Desfazer é alcançável. Registrar aqui
  o resultado.
- **Duas pessoas ao mesmo tempo** numa planilha compartilhada (pelo Google
  real) e a edição feita à mão na planilha: só provado com planilhas de mentira.
