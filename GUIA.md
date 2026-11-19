# Guia da Central de Comando

Este guia é para quem usa o app, sem precisar saber programar. Ele explica:

1. [Conectar um aparelho novo](#1-conectar-um-aparelho-novo)
2. [Trocar o código de acesso](#2-trocar-o-código-de-acesso)
3. [Restaurar uma cópia dos dados](#3-restaurar-uma-cópia-dos-dados)
4. [Pode falar](#4-pode-falar)
5. [Ideias](#5-ideias)
6. [Pastas nas salas](#6-pastas-nas-salas)
7. [Compartilhar a pasta "Casa (partilhada)" com outra pessoa](#7-compartilhar-a-pasta-casa-partilhada-com-outra-pessoa)
8. [Registro de consumo, listas de compras e Financeiro](#8-registro-de-consumo-listas-de-compras-e-financeiro)
9. [Autorizar o script novo (só na publicação da V02)](#9-autorizar-o-script-novo-só-na-publicação-da-v02)

Antes, duas ideias simples:

- **Os seus dados moram no seu Google Drive**, num arquivo guardado por um "script" (um pequeno programa seu, no Google). O app, no computador ou no celular, só mostra e edita esses dados. Por isso os dois aparelhos veem sempre a mesma coisa.
- **Tudo fica numa pasta só, a "Central", no Meu Drive:** o arquivo de dados, as cópias diárias, a subpasta `Audios` (gravações) e a subpasta **Casa (partilhada)** (planilhas da Casa). Você pode abrir a pasta à vontade, mas não troque o nome dela nem das subpastas.
- **Para um aparelho falar com o script, ele precisa de duas informações:** o **endereço** do script (um link que termina em `/exec`) e o **código de acesso** (uma sequência longa de letras e números). Quem tem só o link do app vê uma tela vazia: sem o código, nada dos seus dados aparece.

Guarde o endereço e o código num lugar seguro (por exemplo, no seu gerenciador de senhas). Não mande por mensagem a ninguém e não escreva em documentos compartilhados.

**Regra de publicação:** não publique nenhum outro site no GitHub Pages desta conta. O armazenamento do navegador (onde ficam o endereço do script e o código do aparelho) é partilhado por todos os sites de `<conta>.github.io`, e qualquer outro site da mesma conta poderia lê-lo. Outra instalação da Central vai para outra conta do GitHub.

---

## 1. Conectar um aparelho novo

Faça isto no celular novo, no computador novo, ou depois de limpar os dados do navegador.

1. Abra o app no navegador do aparelho novo.
2. No menu, toque em **Conectar aparelho**. (No celular, a opção está em **Mais**.)
3. No campo **URL**, cole o endereço do script. Ele começa com `https://script.google.com/macros/s/` e termina com `/exec`.
4. No campo **Código do aparelho**, cole o código de acesso. Se quiser conferir o que colou, marque **Mostrar código**.
5. Toque em **Testar e salvar**.
6. Espere a mensagem **Conectado em …**. Se aparecer, está pronto: os seus dados chegam ao aparelho em instantes.

Se aparecer um aviso em vez disso:

| O aviso diz | O que fazer |
|---|---|
| Código incorreto | Confira o código. Copie de novo, sem espaços antes ou depois. Se você trocou o código há pouco, use o novo (veja a parte 2). |
| Sem conexão com o script | Confira a internet e se a URL está completa, até o `/exec`. |
| O script está ocupado | Espere um minuto e tente de novo. |
| Este aparelho já está conectado a outro endereço | O app pede confirmação antes de trocar. Confirme só se o endereço novo for do seu script. |

**Onde achar o endereço do script:** no Google Apps Script, abra o projeto da Central, toque em **Implantar** e depois em **Gerenciar implantações**. O endereço do "App da Web" é o que você cola no campo **URL**.

**Instalar como aplicativo:** no celular, abra o menu do navegador e escolha **Instalar app** (ou **Adicionar à tela inicial**). Depois de instalado, o app abre mesmo sem internet, com a última versão guardada, e envia o que você anotou quando a internet volta.

---

## 2. Trocar o código de acesso

Troque o código se desconfiar que alguém o viu, se perdeu um aparelho ou se colou o código num lugar errado. **Ao trocar, todos os aparelhos deixam de ter acesso até receberem o código novo.** Os dados não se perdem: eles continuam no seu Drive.

1. Abra o projeto da Central no Google Apps Script (o mesmo da parte 1).
2. No editor, escolha a função **gerarCodigo** na lista de funções e toque em **Executar**.
3. Quando terminar, abra o **Registro de execução** (embaixo). Ele mostra uma linha começando com "Código do aparelho", seguida do código novo. Copie só o código.
4. Guarde o código novo no seu gerenciador de senhas e apague o antigo de lá.
5. Em **cada aparelho**, abra **Conectar aparelho**, cole o código novo no campo **Código do aparelho** e toque em **Testar e salvar**. Pode deixar a URL como está.

O código antigo para de valer na hora. Se o app mostrar "Código incorreto", é sinal de que aquele aparelho ainda não recebeu o código novo.

**Trocar o endereço (URL)** é diferente de trocar o código: só acontece se você criar uma nova implantação do script. Nesse caso, copie o endereço novo e repita a parte 1 em cada aparelho.

---

## 3. Restaurar uma cópia dos dados

A Central tem duas formas de cópia. A segunda é a mais fácil, e vale fazer de vez em quando.

### Cópia automática do script (no seu Drive)

Uma vez por dia, quando o app envia alterações, o script guarda no seu Drive, na pasta **Central**, uma cópia chamada `central-dados-AAAA-MM-DD.json` (com a data) e mantém as dos últimos 30 dias. Para voltar a um dia anterior, procure o arquivo da data desejada na pasta **Central** do Drive, abra a cópia de dados e peça ajuda a quem cuida do script. Esse caminho mexe no arquivo principal e deve ser feito com cuidado.

### Cópia que você baixa pelo app (a mais simples)

**Para guardar uma cópia agora:**

1. Abra **Conectar aparelho** (no celular, **Mais** e depois **Conectar aparelho**).
2. Na parte **Cópia de segurança**, toque em **Baixar cópia dos dados**.
3. O navegador baixa um arquivo chamado `central-copia-AAAA-MM-DD.json`, com a data de hoje. Guarde-o num lugar seguro, como uma pasta do seu Drive ou do seu computador.

Esse arquivo leva tarefas, salas, pessoas (com os e-mails de contato delas), caderno, água, documentos e o resto. **Ele não leva a conexão, o código de acesso nem as mensagens do Gmail.** Como tem os contatos, guarde-o com cuidado. Num aparelho novo, conecte o aparelho primeiro (parte 1) e só depois restaure.

**Para restaurar a partir de uma cópia:**

1. Conecte o aparelho (parte 1), se ainda não estiver conectado.
2. Em **Conectar aparelho**, na parte **Cópia de segurança**, use **Restaurar a partir de uma cópia** e escolha o arquivo `central-copia-….json`. Arquivos com mais de 5 MB são recusados.
3. O app **pergunta antes**: "Vai devolver N itens da cópia de DD/MM; o que mudou depois volta como estava." Toque em **Restaurar** para confirmar ou em **Cancelar** para desistir sem mudar nada.
4. Depois de restaurar, o app mostra quantos itens foram devolvidos. Se algum estiver fora do formato, ele diz quantos não foram restaurados.

Como a restauração funciona:

- Ela **devolve** o que está na cópia e **não apaga** nada que já existe no app. As **configurações** (como o fim do dia) não são restauradas.
- Ela **não mexe no Google**: tarefas e marcas de "feito" que voltam não são enviadas de novo ao Google Tarefas nem ao Google Agenda.
- O que volta conta como uma edição nova: vale mais do que a versão que estava no app e segue para os outros aparelhos, como qualquer alteração.
- Se você apagou algo de propósito depois de baixar a cópia, esse item volta. Apague de novo se não o quiser.
- Arquivos que não vieram do botão **Baixar cópia dos dados** são recusados, e o app avisa.

---

## 4. Pode falar

É o jeito mais rápido de anotar: você fala (ou escreve) e a Central decide para onde vai.

- **Como abrir:** no celular, o botão redondo **Pode falar**, acima da barra de baixo. No computador, o botão **Pode falar** no alto da página, ou o atalho **Ctrl + Alt + N**. Com o app instalado no celular, segurar o ícone também mostra **Pode falar**. Em alguns celulares dá para abrir o app com duplo toque na tecla lateral (nas configurações do aparelho: tecla lateral, duplo toque, abrir app).
- **Falar:** toque no microfone, fale e toque em **Pronto**. O texto aparece enquanto você fala. A escuta só começa depois do seu toque; para parar, toque de novo.
- **Privacidade da voz:** o reconhecimento de voz do navegador envia o áudio ao Google. Para não enviar, escreva no campo de texto (a tela avisa isso perto do microfone).
- **Escrever:** o campo de texto está sempre ali. Se o microfone estiver negado, sem internet ou sem suporte, é só digitar. Enter também grava.
- **Gravar áudio (opcional):** ligue **Gravar áudio** antes de falar se quiser guardar também a gravação (até 3 minutos). O áudio vai para a pasta `Central/Audios` do seu Drive e toca na tela Ideias, no botão ▶. Vem desligado.
- **Para onde vai:** tarefa ou compromisso, como no Chat; leitura de água, luz ou gás, compras e gasto vão para a pasta certa da Casa (veja a parte 8); **qualquer outra frase vira uma ideia** (parte 5). A Central nunca grava em silêncio: depois de **Pronto** aparece um cartão dizendo o que fez.
- **No cartão:** **Desfazer** (tira o que foi gravado), **Corrigir** (devolve o texto ao campo), **Guardar como ideia** (se foi para o lugar errado), **Falar outra** e **Fechar**.
- Frase vazia ou muito longa (mais de 2.000 letras) não é gravada, e o app avisa.

---

## 5. Ideias

**Ideias** (no menu; no celular, em **Mais**) é a caixa de entrada de tudo o que você falou e ainda não tem lugar. O número ao lado do nome mostra quantas esperam.

Em cada ideia:

- **O botão com ✓ e o nome de uma sala** é a sugestão da Central: um toque leva a ideia para aquela sala.
- **Outra sala** (ou **Escolher sala**) mostra todas as salas para você escolher.
- **Virar tarefa** cria uma tarefa de hoje com o texto da ideia.
- **Apagar** tira a ideia. Se ela tinha áudio, o áudio vai para a **lixeira do Drive** (você ainda o recupera por lá); se o app não conseguir pedir isso agora (sem internet), o cartão avisa "O áudio continua no Drive" e você pode apagá-lo à mão em `Central/Audios`. **Desfazer** devolve a ideia, mas não tira o áudio da lixeira.
- Todas as ações mostram um cartão com **Desfazer**. A ideia que já foi arrumada fica em **Já arrumadas**, de onde você pode devolvê-la às novas ou virar tarefa (se ela foi levada para uma sala).

---

## 6. Pastas nas salas

Cada sala tem a área **Pastas**. Toque em **Nova pasta**, escolha um nome e crie.

- **Pasta comum** (em todas as salas): reúne **tarefas, documentos e notas de um tema** (por exemplo, "Metodologia" em Doutoramento). O que você cria dentro dela já fica ligado ao tema. No Chat e no Pode falar, "adicione revisar capítulo nas tarefas do tema Metodologia" põe a tarefa lá.
- **Lista, Registro e Planilha** só existem na sala **Casa**, porque as planilhas ficam todas na mesma pasta do Drive, a "Casa (partilhada)", dentro da "Central" (parte 7):
  - **Lista**: itens a comprar.
  - **Registro**: leituras de consumo (água, luz, gás), com tabela e gráfico por mês.
  - **Planilha**: o Financeiro, com gastos do mês.
- **Criar as pastas padrão da Casa:** na sala Casa, ainda sem pastas, toque em **Criar pastas padrão da Casa** (precisa de internet). Nascem seis pastas, cada uma com a sua planilha no Drive: Lista de Compras Semanais, Lista de Compras para Casa, Consumo de Água, Consumo de Luz, Consumo de Gás e Financeiro.
- **Renomear** muda o nome na Central, não o da planilha no Drive. **Apagar** a pasta (com **Desfazer**) não apaga a planilha do Drive.

---

## 7. Compartilhar a pasta "Casa (partilhada)" com outra pessoa

A primeira pasta com planilha cria, dentro da pasta **Central** do seu Google Drive (`Central/Casa (partilhada)`), a pasta **Casa (partilhada)**. Quem tiver acesso de edição a ela abre e edita as planilhas direto no Google Planilhas (por exemplo, para pôr um item na lista de compras), sem usar a Central.

**Compartilhe só a subpasta "Casa (partilhada)", nunca a pasta "Central":** a Central guarda os seus dados, as cópias e os áudios, que ninguém mais deve ver.

**Atenção:** tudo o que está nessa pasta, **inclusive a planilha do Financeiro**, fica visível e editável por quem recebe o compartilhamento. Se quiser compartilhar só as listas e o consumo, compartilhe **arquivo por arquivo** (cada planilha) em vez da pasta.

1. No Google Drive (no computador), abra **Meu Drive**, entre na pasta **Central** e ache a subpasta **Casa (partilhada)**.
2. Clique com o botão direito nela e escolha **Compartilhar**.
3. Em **Adicionar pessoas**, digite o e-mail da pessoa.
4. Troque o papel para **Editor** e toque em **Enviar**.

Cuidados:

- **Não troque o nome da pasta, não a duplique, não a tire de dentro da Central e não tire as planilhas dela.** A Central só mexe em planilhas que estejam diretamente nessa pasta; se uma sair, a pasta avisa e deixa de gravar nela.
- Nas planilhas, **não mude os títulos das colunas** (primeira linha) nem apague a coluna `id`. Pode acrescentar linhas e corrigir valores. Se faltar uma coluna, a Central avisa e não grava.
- Para ordenar a planilha, use **Dados > Ordenar página** (não ordene só algumas colunas: isso embaralha as linhas).
- Para ver uma edição feita fora da Central, toque em **Reler a planilha** na pasta.
- A pessoa não precisa do app, do endereço do script nem do código de acesso.

---

## 8. Registro de consumo, listas de compras e Financeiro

**Registro de consumo** (Consumo de Água, Luz, Gás):

- Digite a leitura no formulário, ou diga: "leitura da água 1020". Dentro da pasta basta "leitura 1020".
- A tabela mostra as últimas leituras, o consumo desde a anterior e o consumo por mês. Se a leitura for **menor que a anterior**, o app avisa e não calcula consumo negativo.
- **Lembrete:** ao criar a pasta, você pode indicar o **dia de envio** da leitura ao portal. Quando faltarem 3 dias ou menos, uma faixa avisa na pasta e no Painel do dia.
- **Desfazer** não apaga a linha da planilha: ela fica marcada como "desfeito" e some da tela.

**Listas de compras:**

- Marque a caixa para dar o item como **comprado**; ele passa para **Comprados**. **Limpar comprados** só esconde da tela, não apaga nada.
- Para acrescentar: o formulário **Novo item**, ou diga "põe leite e pão nas compras da semana". Item que já está na lista é avisado, e você escolhe **Pôr mesmo assim**.

**Financeiro (só no computador):**

- A tela mostra o mês escolhido: o total, os gastos por categoria e a tabela. Use **Mês anterior** e **Mês seguinte**.
- Para lançar, use o formulário **Novo gasto**, ou diga "gastei 5,50 hoje comprando salgado". **Falar um gasto funciona no celular também**; só a tela do Financeiro pede o computador ("Abra no computador").
- A moeda é o **€** (euro). Gasto em outra moeda (R$, US$) não é gravado: vira uma ideia.
- No cartão do gasto falado, **Trocar categoria** corrige a categoria na planilha.
- Gasto desfeito continua na planilha, marcado como desfeito em **Observação**; a Central não soma, mas fórmulas da planilha somam.

---

## 9. Autorizar o script novo (só na publicação da V02)

A V02 usa o Drive inteiro (para a pasta Central, o áudio e a pasta da Casa) e o Google Planilhas. Por isso o script precisa de uma **autorização nova**, feita uma vez. A ordem importa:

1. **Enviar** o código novo ao Google, **sem** implantar: `npm run script:enviar` (só envia; a URL do app continua no script antigo).
2. Abra o projeto da Central no Google Apps Script (o mesmo da parte 1).
3. Na lista de funções, escolha **autorizarV02** e toque em **Executar**.
4. O Google abre uma janela de permissão. Escolha a sua conta e permita. Se aparecer "O Google não verificou este app", toque em **Avançado** e depois em continuar: o script é seu.
5. Abra o **Registro de execução** e confira a linha **Permissão V02 aprovada**. Antes dela, o registro mostra o que o script arrumou (ver abaixo).
6. **Implantar**: `npm run script:implantar` (a URL do app passa a rodar o código novo).
7. Por último, atualize o app (publicar a versão nova do app).

**O que a autorização arruma sozinha.** Ao rodar **autorizarV02**, o script cria a pasta **Central** (se faltar) e move para ela o que já existia solto na raiz do Meu Drive: o arquivo de dados, as cópias diárias e a pasta **Casa (partilhada)** (o compartilhamento dela continua valendo). Nada é apagado, e repetir não faz mal. Se um passo não puder ser feito, o registro mostra uma linha `Central: AVISO <código>: ...` e os outros passos seguem. Depois de resolver, rode **organizarPastaCentral** (na lista de funções, no mesmo lugar) e confira o registro de novo.

**Avisos do registro e o que fazer em cada um:**

| Código | O que significa | O que fazer |
|---|---|---|
| `central_duplicada` | Há mais de uma pasta **Central** no Meu Drive. | Junte as duas à mão numa só (mova o conteúdo da que sobra para a outra) e mande a que sobrou vazia para a lixeira. Rode **organizarPastaCentral**. |
| `dados_na_lixeira` | O arquivo `central-dados.json` que o script usa está na lixeira. | Abra a lixeira do Drive, restaure o arquivo (não crie outro) e rode **organizarPastaCentral**. |
| `dados_duplicados` | Há mais de um `central-dados.json` seu. | Descubra o certo (o mais recente, com os seus dados), mande os outros para a lixeira e rode **organizarPastaCentral**. |
| `dados_de_outro_dono` | O arquivo de dados que o script usa não é seu (foi compartilhado por outra conta). | Não mova. Confira a conta do script e o arquivo guardado; peça ajuda antes de mexer. |
| `casa_duplicada` | Há mais de uma **Casa (partilhada)** (na raiz do Drive ou dentro da Central). | Deixe só uma: junte as planilhas numa pasta e mande a outra para a lixeira. Rode **organizarPastaCentral**. |
| `casa_em_dois_lugares` | Existe **Casa (partilhada)** na raiz e outra dentro da Central. O script não escolhe por você, mesmo que uma esteja vazia. | Mova as planilhas da pasta da raiz para a que está dentro da Central (ou, se a de dentro estiver vazia, apague-a e deixe só a da raiz) e rode **organizarPastaCentral**: ela move a da raiz para dentro. Se a pasta da raiz já está compartilhada, mantenha essa e apague a vazia. |
| `trava_ocupada` | O script estava ocupado com uma sincronização. | Espere um minuto e rode **organizarPastaCentral** de novo. |
| `erro_no_drive` | O Google recusou um passo (cota, rede, permissão). O texto diz só o tipo do erro. | Rode **organizarPastaCentral** de novo daqui a pouco. Se repetir, mova à mão o item que faltar para a **Central**. |

Enquanto a pasta **Casa (partilhada)** não estiver dentro da Central, o app avisa que a planilha "não está na pasta" e não grava nela; **Criar pastas** na sala Casa mostra "Rode organizarPastaCentral no script (veja o GUIA) e tente de novo" e não cria nada.

**Conferir depois de rodar autorizarV02:**

1. No Google Drive, abra **Meu Drive** e confira que existe uma só pasta **Central**.
2. Dentro dela devem estar: o arquivo `central-dados.json`, as cópias `central-dados-AAAA-MM-DD.json` (se já havia), a subpasta `Audios` (se você gravou áudios) e a subpasta **Casa (partilhada)** (se você usa as planilhas da Casa).
3. Na raiz do Meu Drive não devem sobrar esses itens.
4. Abra o app e confira que ele **continua sincronizando** (o estado no alto fica "atualizado" e uma tarefa nova aparece no outro aparelho).

Não use `npm run script:publicar` nesta publicação: ele envia e implanta de uma vez, e o app novo passaria a chamar o script sem a autorização feita. Sem a autorização, **qualquer chamada ao script pode falhar** (não só as novidades de áudio e pastas da Casa). Em publicações futuras, sem permissão nova, `script:publicar` continua valendo.

---

## Dúvidas comuns

- **Perdi o código.** Gere um novo (parte 2). Os dados continuam no Drive.
- **Perdi o aparelho.** Gere um código novo (parte 2): o aparelho perdido deixa de ter acesso.
- **O app diz "sem internet".** Você pode continuar usando. As alterações ficam guardadas no aparelho e seguem quando a internet voltar.
- **Os dois aparelhos mostram coisas diferentes.** Espere a sincronização terminar (o app mostra o estado no alto). Se mexeu no mesmo item nos dois, vale a alteração mais recente, e o app avisa.
