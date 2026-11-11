# Guia da Central de Comando

Este guia é para quem usa o app, sem precisar saber programar. Ele explica três coisas:

1. [Conectar um aparelho novo](#1-conectar-um-aparelho-novo)
2. [Trocar o código de acesso](#2-trocar-o-código-de-acesso)
3. [Restaurar uma cópia dos dados](#3-restaurar-uma-cópia-dos-dados)

Antes, duas ideias simples:

- **Os seus dados moram no seu Google Drive**, num arquivo guardado por um "script" (um pequeno programa seu, no Google). O app, no computador ou no celular, só mostra e edita esses dados. Por isso os dois aparelhos veem sempre a mesma coisa.
- **Para um aparelho falar com o script, ele precisa de duas informações:** o **endereço** do script (um link que termina em `/exec`) e o **código de acesso** (uma sequência longa de letras e números). Quem tem só o link do app vê uma tela vazia: sem o código, nada dos seus dados aparece.

Guarde o endereço e o código num lugar seguro (por exemplo, no seu gerenciador de senhas). Não mande por mensagem a ninguém e não escreva em documentos compartilhados.

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

Uma vez por dia, quando o app envia alterações, o script guarda no seu Drive uma cópia chamada `central-dados-AAAA-MM-DD.json` (com a data) e mantém as dos últimos 30 dias. Para voltar a um dia anterior, procure o arquivo da data desejada no Drive, abra a cópia de dados e peça ajuda a quem cuida do script. Esse caminho mexe no arquivo principal e deve ser feito com cuidado.

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

## Dúvidas comuns

- **Perdi o código.** Gere um novo (parte 2). Os dados continuam no Drive.
- **Perdi o aparelho.** Gere um código novo (parte 2): o aparelho perdido deixa de ter acesso.
- **O app diz "sem internet".** Você pode continuar usando. As alterações ficam guardadas no aparelho e seguem quando a internet voltar.
- **Os dois aparelhos mostram coisas diferentes.** Espere a sincronização terminar (o app mostra o estado no alto). Se mexeu no mesmo item nos dois, vale a alteração mais recente, e o app avisa.
