# Ordem do Dia com várias mãos, relatório

Branch `f6`, worktree `determined-tereshkova-0af84d`. Dois commits, empurrados.

- `fa4680d0` camada 1, a trava de conflito
- `5fbd7657` camada 2, tempo real sem atropelar quem digita

`npm run build` (tsc + vite) saiu com exit 0 antes de cada um dos dois commits.

## Arquivos

| Arquivo | O que é |
| --- | --- |
| `supabase/migrations/2026093338_ordem_do_dia_versao.sql` | coluna `versao bigint NOT NULL DEFAULT 0`, função `public.incrementa_versao()`, trigger `trg_ordens_do_dia_versao` BEFORE UPDATE. Idempotente, não toca em nenhuma migração anterior |
| `src/lib/salvarComVersao.ts` | helper genérico, novo |
| `src/pages/OrdemDoDiaDetalhe.tsx` | `load`, `patch`, `editarLista`, `CampoAoVivo`, `useRealtimeRefetch` |

Nenhuma migração antiga foi editada. Nenhum SQL foi executado.

## Camada 1, a trava

O helper `salvarComVersao({ tabela, id, versao, campos })` monta
`update(campos).eq('id', id).eq('versao', versaoQueEuLi).select().maybeSingle()`
e devolve uma união de três estados:

- `{ status: 'salvo', linha, versao }` , a linha nova, já com o contador somado
- `{ status: 'desatualizado' }` , zero linhas afetadas, **nada foi escrito**
- `{ status: 'erro', erro }` , erro de verdade (rede, permissão, coluna)

Escrito para outras telas usarem: nomes e comentários em português, `colunaVersao`
e `colunaId` parametrizáveis, e a função do gatilho é genérica de propósito
(qualquer tabela que ganhar uma coluna `versao` pendura o mesmo trigger).

Sobre contador vs `updated_at`: concordo com a escolha e não vejo razão para
trocar. O contador ainda tem uma vantagem extra que o timestamp não tem: dois
salvamentos dentro do mesmo microssegundo (ou com o relógio do cliente torto,
já que hoje é o cliente que escreve `updated_at`) seriam indistinguíveis por
timestamp, e são sempre distinguíveis por contador.

Na tela: `versaoRef` guarda a versão da linha que está na tela, atualizada a
cada carga e a cada salvamento bem sucedido. `patch` passou a usar o helper, e
`editarLista` continua chamando `patch`, então toda lista (cronograma, equipe,
elenco, objetos, figurino, equipamentos, locações, call times) entra na trava
pelo mesmo caminho.

No conflito a tela: desfaz o otimista, recarrega do servidor e mostra

> Outra pessoa salvou esta ordem do dia enquanto você editava. A tela foi
> atualizada com a versão que está no servidor, e a sua última alteração não
> entrou. Confira e faça de novo, por favor.

Diz quem mexeu (outra pessoa), o que a tela fez (atualizou) e o que aconteceu
com a alteração dela (não entrou), que é a parte que separa "o app me protegeu"
de "o app comeu meu trabalho".

## Camada 2, ver ao vivo

`useRealtimeRefetch(['ordens_do_dia'], ...)`, o mesmo hook das outras telas, com
carga silenciosa.

**O problema do campo em foco, e como foi resolvido.** Os campos do cronograma
são não controlados (`defaultValue` + salvar no `onBlur`), porque o relógio da
página bate de segundo em segundo e um input controlado perderia o que a pessoa
digita a cada tique. O preço é que o React ignora `defaultValue` depois que o
campo já existe: sem ajuda, alteração de outra pessoa entrava no estado e não
aparecia dentro do campo.

Criei `CampoAoVivo`, um input que faz a sincronia na mão e guarda duas
referências: `aplicado` (o último valor do servidor que já está dentro do campo)
e `esperando` (valor do servidor que chegou enquanto o campo estava em uso).

- chegou valor novo e `document.activeElement !== o campo` , entra na hora
- chegou valor novo e o campo está com o foco dentro , fica em `esperando`, o
  campo não muda
- na saída do campo: se `valor digitado !== aplicado`, a pessoa mexeu, vale o
  que ela digitou e o salvamento decide (com a trava) se entra; se ela só passou
  pelo campo, entra o valor que estava esperando

Ou seja, remontar o input (trocar `key`) foi descartado de propósito: remontar
mata o cursor e o texto de quem está digitando. A sincronia é por campo, não por
linha.

**Sem laço.** Três defesas:

1. `carimboRef` guarda o carimbo do que já está na tela (`versao`, ou
   `updated_at` enquanto a migração não roda). A carga silenciosa compara e não
   mexe em nada quando o carimbo é o mesmo, então o eco do próprio salvamento
   não vira recarregamento.
2. `cargaRef` é um contador de cargas. `patch` incrementa antes de escrever, e
   toda resposta de carga que chega atrasada é descartada, em vez de repor dado
   velho por cima do novo.
3. A carga silenciosa não mexe em `loading`, nem em `erroCarga`, nem refaz as
   buscas de nome do projeto e roteiros.

## Verificação

### Build

`npm run build` , exit 0, nos dois commits. Última saída: `✓ built in 1.47s`,
sem erro de tsc.

### Degradação sem a migração

A migração **não rodou**, e isso ficou provado dentro do próprio teste: uma
consulta a `ordens_do_dia` pedindo a coluna devolveu
`column ordens_do_dia.versao does not exist`. Com a coluna ausente, `versaoRef`
fica `null`, o helper não põe o `.eq('versao', ...)` e o salvamento acontece
como antes, sem trava. Todos os salvamentos do teste abaixo passaram pelo helper
e gravaram normalmente, sem nenhum erro na tela.

### Teste de duas sessões (feito)

Ordem do dia de teste criada e apagada no fim: "ROBO TESTE conflito, apagar",
id `fbd4164f-…`, com um momento de cronograma (Gravação, 08:00 às 09:00).
Confirmei por consulta que a linha não existe mais.

Não achei projeto chamado "Produção Teste" na plataforma (os clientes ativos são
Jotacom, PagBrasil, Produtora Lumos, Shopee e Vitru; o projeto de teste do robô,
"🤖 Projeto de Teste (Robô)", não apareceu na árvore nem na busca). Então criei
a ordem do dia **solta, sem projeto nenhum**, pela tela `/ordem-do-dia`, o que
isola ainda mais: não encostou em projeto real. A ordem aprovada de verdade,
"Uniasselvi, Diária 03 | Social Vídeos", não foi aberta, alterada nem
desaprovada em momento nenhum.

Duas abas do mesmo navegador, logadas como Robô de Testes, na mesma ordem do
dia, sem recarregar:

**1. Tempo real chega.** Aba B mudou a descrição do momento de "Gravação" para
"ABA B mandou" e saiu do campo. Três segundos depois, a aba A, parada, mostrava
"ABA B mandou" dentro do input, sem reload. (Antes disso confirmei no cliente
que o canal `rt:ordens_do_dia` fica `joined` e que o evento `UPDATE` da linha
chega mesmo, com um ouvinte cru montado à parte.)

**2. Campo em foco não é atropelado, campo parado é.** Com o cursor dentro da
descrição na aba A e o texto "ABA A esta digitando agora" digitado e não salvo,
a aba B gravou `descricao: 'ABA B escreveu por ultimo'` **e** `inicio: '07:15'`.
Resultado na aba A, três segundos depois:

- campo "Hora de início" (parado): passou de `08:00` para `07:15`, sozinho
- campo "Descrição" (com o foco dentro): continuou "ABA A esta digitando agora",
  intacto

**3. O valor que esperou entra na saída.** Com o cursor dentro da descrição na
aba A e **nada digitado**, a aba B gravou "ABA B mandou enquanto A olhava". O
campo não mudou enquanto o foco estava lá. Ao sair do campo (Tab), o campo
passou a mostrar "ABA B mandou enquanto A olhava", e nada foi escrito no banco,
porque a pessoa não digitou nada.

**4. O comportamento de hoje, sem a trava, reproduzido.** Aba A com texto novo
digitado e não salvo; a aba B gravou `inicio: '06:00'`; imediatamente depois a
aba A saiu do campo e salvou. Estado final no banco: `inicio: '07:15'`. Ou seja,
o `06:00` da aba B **foi apagado em silêncio**, sem aviso nenhum para ninguém.
É exatamente o caso que a trava transforma em recarga + recado, e é a prova de
que o problema é real e continua real enquanto a migração não subir.

Vale registrar que a camada 2 sozinha já encolheu muito a janela do estrago: no
teste 2, o `inicio` da aba B sobreviveu ao salvamento seguinte da aba A, porque
o tempo real já tinha atualizado o estado da aba A antes. O que sobra é a corrida
de menos de um segundo do teste 4, e é ela que só a versão fecha.

### O que fica pendente da migração

`2026093338_ordem_do_dia_versao.sql` precisa rodar no Supabase. Enquanto não
rodar, tudo continua funcionando exatamente como hoje, sem a trava (provado
acima), e o único caminho de código que **não** foi testado ao vivo é o
`status: 'desatualizado'`, porque sem a coluna é impossível fazer o UPDATE
devolver zero linhas.

**O teste que falta rodar depois que a migração subir** (mesmo roteiro do teste
4, e agora com desfecho diferente):

1. Abrir a mesma ordem do dia em duas abas, sem recarregar nenhuma.
2. Na aba A, clicar no campo "Descrição" de um momento do cronograma e digitar
   um texto novo, **sem sair do campo**.
3. Na aba B, mudar a hora de início do mesmo momento e sair do campo, para
   gravar. Isso soma 1 na `versao` da linha.
4. Imediatamente, antes de a aba A receber o evento de tempo real (menos de um
   segundo), sair do campo na aba A para disparar o salvamento dela.
5. **Esperado:** a aba A não grava nada, mostra o recado "Outra pessoa salvou
   esta ordem do dia enquanto você editava…", recarrega, e a hora de início da
   aba B continua no banco. Conferir no banco que `versao` subiu **uma** vez, não
   duas.
6. Conferir também o caminho feliz: com uma aba só, editar vários campos em
   sequência e ver que cada salvamento funciona e que `versao` sobe de um em um.

Sugestão de conferência rápida depois de rodar a migração:

```sql
SELECT id, titulo, versao, updated_at FROM public.ordens_do_dia ORDER BY updated_at DESC LIMIT 5;
```

## Fora de escopo, só anotado

Nada foi mexido além das duas camadas. Um ponto que notei e **não** toquei: a
tela ainda escreve `updated_at` pelo relógio do navegador. Com o gatilho de
versão no lugar, dava para o banco cuidar disso também, mas isso é outra
conversa e mudaria comportamento de outras telas.
