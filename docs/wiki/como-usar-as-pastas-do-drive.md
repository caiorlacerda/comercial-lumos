# Como usar as pastas do Drive

> Rascunho para aprovação. Depois de aprovado, vira uma página da Wiki (seed em migration).

## Para que serve
Todo projeto da Lumos tem a mesma estrutura de pastas no Drive. Quem abre um projeto novo sabe onde está cada coisa, e o app (revisão de vídeo, OS, documentos) acha as pastas sozinho. **Por isso não renomeie, mova nem crie pastas dentro de um projeto.**

## A hierarquia
```
Cliente
 └─ [Marca]            só para clientes com marcas (ex.: Vitru)
     └─ AAAA-MM        mês do projeto (ex.: 2026-11)
         └─ NNN_NOME-DO-PROJETO
             ├─ 00_DOCUMENTOS
             ├─ 01_BRUTO
             ├─ 02_ARTES
             │   └─ 01_TRILHAS
             └─ 03_EXPORT
                 ├─ 01_REVISAO
                 └─ 02_FINAL
```
- **Cliente:** o nome do cliente, como está no app. Dentro dele também fica a pasta `_ASSETS`, com o brandbook, fontes, logos e demais materiais fixos da marca. A `_ASSETS` fica **fora dos meses**.
- **Marca:** só existe para clientes que têm sub-marcas. Vitru, por exemplo, tem **Uniasselvi**, **Continuada** e **Vitru**. Cliente sem marcas vai direto do cliente para o mês.
- **Mês (AAAA-MM):** o mês de início do projeto; se o projeto não tem data de início, o mês em que foi criado.
- **Projeto:** `NNN_NOME-DO-PROJETO`: o código com 3 dígitos, um sublinhado e o nome em letras maiúsculas, sem acento, com hífen no lugar do espaço. Exemplo: `227_MINI-MISSAO`.

## O que vai em cada pasta
| Pasta | O que guarda |
|---|---|
| `00_DOCUMENTOS` | Roteiro, briefing, **relatório de gravação**, a **OS** (ordem de serviço) e qualquer outro documento do projeto. |
| `01_BRUTO` | O material bruto da gravação: o **cartão inteiro**, com os arquivos **XML** e o **proxy**. Veja o protocolo de backup abaixo. |
| `02_ARTES` | Artes, gráficos e demais materiais visuais usados no projeto. |
| `02_ARTES/01_TRILHAS` | As trilhas (músicas) do projeto. |
| `03_EXPORT/01_REVISAO` | Os cortes para revisão. O editor sobe o vídeo aqui (pelo app ou direto no Drive) e ele aparece na aba **Entregas** do projeto. |
| `03_EXPORT/02_FINAL` | As versões **aprovadas**. O app copia para cá quando o vídeo é aprovado. |

## Como achar a pasta de um projeto
No app, abra o projeto e clique em **Abrir pasta no Drive**, no topo da página. Se o botão mostrar **Pasta ainda não criada**, aguarde alguns segundos e recarregue. Se mostrar **Escolha a marca**, o cliente tem marcas: escolha a marca do projeto na faixa amarela e a pasta é criada na hora.

## Quem cria as pastas
- **As pastas do projeto nascem sozinhas**, pelo app, quando o projeto é criado. Ninguém precisa criá-las.
- **Pastas feitas à mão** (a pasta de um cliente novo, a de uma marca, ou qualquer ajuste de estrutura) são criadas **pela Ariella** e, no máximo, pela **Carol**.
- Mais ninguém cria, renomeia ou move pastas de projeto. Se precisar de uma pasta diferente, peça a elas.

## Protocolo de backup da gravação
1. Terminou a gravação: o **Douglas ou o Italo** sobe o **cartão inteiro** para `01_BRUTO` do projeto, **sempre**, com os **XML** e o **proxy**. Não é só o que parece útil: é o cartão todo.
2. Os **editores usam esse backup** quando houver qualquer problema com o material (arquivo corrompido, projeto que não abre, proxy faltando).
3. A **Carol registra no relatório de gravação** (em `00_DOCUMENTOS`) que o backup foi feito, por quem e quando.

## Projetos antigos
Os projetos criados antes desta estrutura continuam como estão até serem migrados. Na dúvida, abra a pasta pelo botão **Abrir pasta no Drive** do projeto: ele leva sempre ao lugar certo.
