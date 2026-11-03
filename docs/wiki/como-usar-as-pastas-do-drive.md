# Como usar as pastas do Drive

> Rascunho para aprovação (versão 2, com a hierarquia nova). Depois de aprovado, vira uma página da Wiki.

## Para que serve
Todo cliente e todo projeto da Lumos tem a mesma estrutura de pastas no Drive. Quem abre um projeto novo sabe onde está cada coisa, e o app (revisão de vídeo, OS, documentos) acha as pastas sozinho. **Por isso não renomeie, mova nem crie pastas dentro de um cliente ou de um projeto.**

## A hierarquia
```
Cliente
 ├─ MARCA                  materiais fixos do cliente
 └─ PROJETOS
     └─ [Sub-marca]        só para cliente com sub-marcas (ex.: Vitru › Uniasselvi)
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
Cliente sem sub-marcas vai direto de `PROJETOS` para o mês: `Cliente › PROJETOS › 2026-11 › 227_NOME`.

### Nível do cliente
- **`MARCA`** guarda os materiais fixos do cliente: brandbook, logos, fontes, guidelines e afins. Ela **substitui a antiga `_ASSETS`** e fica **fora dos meses**. Os clientes que já existem continuam com a `_ASSETS` até serem renomeados; o app entende as duas.
- **`PROJETOS`** guarda todos os projetos novos do cliente.

> **Atenção ao nome:** a pasta `MARCA` (materiais fixos) **não é** a "marca" do projeto. A "marca" que se escolhe no app é a **sub-marca**, e só existe para clientes que têm várias (Vitru, por exemplo, tem **Uniasselvi**, **Continuada** e **Vitru**). A pasta da sub-marca fica **dentro de `PROJETOS`**.

### Mês e projeto
- **Mês (AAAA-MM):** o mês de início do projeto; se o projeto não tem data de início, o mês em que foi criado.
- **Projeto:** `NNN_NOME-DO-PROJETO`: o código com 3 dígitos, um sublinhado e o nome do projeto aprovado no orçamento, em letras maiúsculas, sem acento, com hífen no lugar do espaço. Exemplo: `227_MINI-MISSAO`.

## O que vai em cada pasta do projeto
| Pasta | O que guarda |
|---|---|
| `00_DOCUMENTOS` | Roteiro, briefing, **relatório de gravação**, a **OS** (ordem de serviço) e qualquer outro documento do projeto. |
| `01_BRUTO` | O material bruto da gravação: o **cartão inteiro**, com os arquivos **XML** e o **proxy**. Veja o protocolo de backup abaixo. |
| `02_ARTES` | Artes, gráficos e demais materiais visuais usados no projeto. |
| `02_ARTES/01_TRILHAS` | As **trilhas musicais** do projeto. |
| `03_EXPORT/01_REVISAO` | Os cortes para revisão. O editor sobe o vídeo aqui (pelo app ou direto no Drive) e ele aparece na aba **Entregas** do projeto. |
| `03_EXPORT/02_FINAL` | As versões **aprovadas**. O app copia para cá quando o vídeo é aprovado. |

## Como achar a pasta de um projeto
No app, abra o projeto e clique em **Abrir pasta no Drive**, no topo da página.
- **Pasta ainda não criada:** aguarde alguns segundos e recarregue.
- **Escolha a marca:** o cliente tem sub-marcas e o projeto ainda não escolheu uma. Escolha na faixa amarela no topo do projeto e a pasta é criada na hora. **Faça isso antes da gravação**, senão o projeto fica sem pasta (e sem a OS salva no Drive).

## Quem cria as pastas
- **As pastas do projeto nascem sozinhas**, pelo app, quando o projeto é criado. Ninguém precisa criá-las.
- **Pastas feitas à mão** (a pasta de um cliente novo, a `MARCA`, ou qualquer ajuste de estrutura) são criadas **pela Ariella** e, no máximo, pela **Carol**.
- Mais ninguém cria, renomeia ou move pastas. Se precisar de uma pasta diferente, peça a elas.

## Protocolo de backup da gravação
1. Terminou a gravação: o **Douglas ou o Italo** sobe o **cartão inteiro** para `01_BRUTO` do projeto, **sempre**, com os **XML** e o **proxy**. Não é só o que parece útil: é o cartão todo.
2. Os **editores usam esse backup** quando houver qualquer problema com o material (arquivo corrompido, projeto que não abre, proxy faltando).
3. A **Carol registra no relatório de gravação** (em `00_DOCUMENTOS`) que o backup foi feito, por quem e quando.

## Projetos antigos
Os projetos criados antes desta estrutura continuam como estão até serem migrados (com `06_ENTREGA`, `OS` e as pastas numeradas de antes). Na dúvida, abra a pasta pelo botão **Abrir pasta no Drive** do projeto: ele leva sempre ao lugar certo. Lives continuam com a estrutura própria de live.
