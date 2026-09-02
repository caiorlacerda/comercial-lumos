# Revisor fixo — relatório

## O que foi feito

Arquivos tocados (4):

- `supabase/migrations/2026093339_revisor_fixo.sql` (novo, NÃO rodado)
- `src/pages/Users.tsx`
- `src/pages/Equipe.tsx`
- `src/hooks/useAuth.tsx` (só o campo opcional `revisor_fixo?: boolean` em `AppUserProfile`)

Nada mais foi tocado. `OrdemDoDiaDetalhe.tsx` e `src/lib/salvarComVersao.ts` não foram abertos para edição.

`npm run build` (tsc + vite) rodou com exit 0 depois da última alteração.

## 1. A marca na ficha

`app_users.revisor_fixo boolean NOT NULL DEFAULT false`, mais um índice parcial minúsculo
(`WHERE revisor_fixo`), já que as duas funções consultam essa lista a cada vídeo.

## 2. O gatilho de vídeo novo

`notify_video_novo` foi reescrita com `CREATE OR REPLACE`, mantendo tudo o que já fazia. Muda:

- antes de avisar, insere em `task_collaborators` todo usuário **ativo** com `revisor_fixo = true`,
  com `ON CONFLICT (task_id, user_id) DO NOTHING` (não duplica, e preserva a linha de quem já
  estava lá), excluindo quem já é o `responsavel_id` da tarefa;
- `NEW.task_id IS NULL`: pula a inserção inteira, só notifica;
- a cláusula de quem recebe o aviso ganhou `OR a.revisor_fixo`. O `SELECT DISTINCT a.id` que já
  existia é o que garante um aviso por pessoa mesmo para quem é responsável, colaborador e revisor
  fixo ao mesmo tempo;
- o corpo inteiro segue sob `EXCEPTION WHEN OTHERS THEN RAISE WARNING ... RETURN NEW`, então falha
  aqui nunca derruba o upload.

## 3. Retroativo, e quais estados usei

Função `public.backfill_revisores_fixos()` (chamada uma vez no fim da migração, e pronta pra ser
chamada de novo depois que as pessoas forem marcadas). Estados de `video_versions` usados:

| status | entra? | por quê |
|---|---|---|
| `EM_REVISAO_INTERNA` | sim | revisão interna |
| `ALTERACOES_INTERNAS` | sim | é a mesma fase interna. O par aparece junto, literalmente, como "fase interna" em `review_decide` (2026093200) e nas funções do link público (2026093314, 2026093315, 2026093318) |
| `EM_REVISAO_CLIENTE` | sim | aguardando o cliente, a bola está com ele |
| `ALTERACOES_CLIENTE` | não | o cliente já decidiu, não se espera mais nada dele; e a próxima versão que subir aciona o gatilho normal |
| `APROVADO` | não | acabou |

Os cinco valores vêm do CHECK de `video_versions` (2026071200) e de `src/lib/reviewStatus.ts`.
Só a versão ATUAL de cada formato conta (mesma subquery de `status_tarefa_pelos_videos`), e só
tarefas com `deleted_at IS NULL`.

Sem notificação retroativa: ver "distinguir automático de manual" abaixo, o mesmo mecanismo cala o
trigger de colaborador.

## 4. A tela

Campo próprio, fora de `PERM_OPTIONS`, com rótulo "Revisor fixo" e a explicação
"Acompanha automaticamente toda revisão interna: entra sozinho como colaborador da tarefa quando o
vídeo chega, recebe o aviso, e sai quando a revisão termina."

- `Users.tsx`: checkbox no modal de edição, no mesmo padrão do "Conta oculta".
- `Equipe.tsx`: checkbox dentro da seção "Acesso & permissões", que já é `isAdmin && !!detail.user`.

Degradação sem a migração: as duas telas carregam `app_users` com `select('*')`, então detectam a
coluna com `'revisor_fixo' in rows[0]`. Enquanto ela não existir, o campo **não aparece** e o
`update()` **não manda a chave**, então salvar ficha continua funcionando igual. O erro do Supabase
segue tratado pelo caminho que já existia (`toast.error` em ambas).

Verificação na tela (dev, login pelo botão do robô de testes): `/equipe` carrega, ficha abre e
fecha, nenhum erro novo no console. Nenhuma ficha foi salva.

## 5. As duas pessoas: NÃO liguei

A coluna está toda falsa. Achei o Caio com certeza, o Vini não:

- **Caio Rizzutti** — CEO, admin — `caio.lacerda@produtoralumos.com.br`
- **Vinicius Ankerkrone** — CFO, admin — `vinicius.ankerkrone@produtoralumos.com.br`
- **Vinicius Gimenez** — Editor, time — `vinicius.gimenez@produtoralumos.com.br`

São dois Vinicius ativos, e nenhum é obviamente "o Vini". Não é acaso: `ProducaoOverview.tsx`
abrevia nome com a inicial do sobrenome justamente pra esses dois não se confundirem. Deixei o
`UPDATE` comentado no fim da migração com os três nomes completos, pro dono do produto escolher.

Comando que falta (passo 8 da migração):

```sql
UPDATE public.app_users
SET revisor_fixo = true
WHERE status = 'ativo'
  AND email IN (
    'caio.lacerda@produtoralumos.com.br',       -- Caio Rizzutti
    'vinicius.ankerkrone@produtoralumos.com.br' -- ou vinicius.gimenez@produtoralumos.com.br
  );

SELECT public.backfill_revisores_fixos();
```

## 6. Sair quando a revisão acaba

Gatilho novo `trg_revisor_fixo_ciclo`, `AFTER UPDATE OF status ON video_versions`.

**Critério de "acabou":** `public.status_tarefa_pelos_videos(task_id) = 'concluido'`. É exatamente a
função de 2026093322 que `sincronizar_status_tarefa` já usa pra decidir a etapa da tarefa pelo
formato mais atrasado: ela só devolve `concluido` quando a versão ATUAL de todos os formatos está
`APROVADO`. Aprovar o 16:9 com o 1:1 ainda em ajuste não tira ninguém. Não inventei critério novo.

**Automático x manual:** `added_by` não serve. Ele já nasce nulo em vários caminhos (a FK é
`ON DELETE SET NULL`, então some quando quem adicionou é excluído) e continuaria nulo no automático,
logo "nulo" não distingue nada. Criei `task_collaborators.auto_revisor boolean NOT NULL DEFAULT false`:
só a automação escreve `true`, e o DELETE só mexe em linhas com `true`. Toda linha que já existe
hoje nasce `false` pelo DEFAULT, então ninguém que foi posto à mão é removido, nunca. E se o revisor
fixo já estava na tarefa à mão, o `ON CONFLICT DO NOTHING` preserva o `false` dele.

Essa mesma coluna resolve a notificação: `handle_task_collab_notification` (2026091800) foi
reescrita com `CREATE OR REPLACE` para sair na hora quando `NEW.auto_revisor` é `true`. Sem isso, o
revisor fixo receberia "Você entrou numa tarefa" além do aviso de vídeo novo, a cada ciclo de
revisão, e o backfill do passo 3 encheria a sineta de uma vez.

## 7. Voltar pro editor que enviou

**Não acontece hoje.** `moverEtapa` (`src/lib/reviewTransition.ts`) só grava `status` no vídeo, chama
`sincronizar_status_tarefa` e cria o link do cliente. `sincronizar_status_tarefa` (2026093322) só
grava `project_tasks.status`. Nenhum trigger em `video_versions` mexe em `responsavel_id`, e o único
lugar do banco que fala em `responsavel_id` é o trigger de notificação de 2026070403. Então
implementei.

Quem subiu: **`video_versions.uploaded_by`, e ele é `text`, não FK.** Vem do Drive
(`supabase/functions/drive-watch/index.ts:231`): usa `properties.app_uploader` quando existe, senão
o nome do Google. O `app_uploader` é gravado por `drive-upload` com o `full_name` de quem estava
logado no app (ou o e-mail, como fallback). Não há coluna uuid de uploader.

Por isso o casamento é por texto e conservador: `lower(btrim(...))` contra `full_name` **ou**
`email` de usuários ativos, e a troca só acontece quando bate em **exatamente uma** pessoa
(`array_agg` + `array_length = 1`). Campo vazio, nome do Google que não existe no app, ou dois
homônimos: não mexe no responsável, nunca deixa vazio. Dispara em `ALTERACOES_INTERNAS` e
`ALTERACOES_CLIENTE`. O `WHERE ... responsavel_id IS DISTINCT FROM` evita escrita à toa e, com ela,
o segundo aviso de "tarefa atribuída". Tudo sob `EXCEPTION WHEN OTHERS`, então falha aqui não
derruba a aprovação.

## 8. Roteiro de teste depois de rodar o SQL

1. Rode `supabase/migrations/2026093339_revisor_fixo.sql` inteiro no SQL editor. O SELECT de
   conferência deve listar `app_users.revisor_fixo` e `task_collaborators.auto_revisor`, as duas
   `boolean` com default `false`.
2. Recarregue o app e abra a ficha de alguém em `/usuarios` (ou `/equipe`, aba "Acesso &
   permissões", com login admin). O campo "Revisor fixo" agora aparece, desligado.
3. Marque "Revisor fixo" numa conta de teste, salve, reabra: tem que continuar marcado.
4. Escolha o Vinicius certo, descomente o `UPDATE` do passo 8 e rode, junto com
   `SELECT public.backfill_revisores_fixos();`. Confira com
   `SELECT full_name, revisor_fixo FROM app_users WHERE revisor_fixo;`.
5. **Vínculo retroativo:** abra uma tarefa que hoje tem vídeo em revisão interna ou aguardando o
   cliente. Os revisores fixos já aparecem como colaboradores. Confira a sineta deles: não pode ter
   chegado nada por causa do backfill.
6. **Vídeo novo:** suba uma versão numa tarefa de projeto de teste. Os revisores fixos entram
   sozinhos como colaboradores e recebem "Vídeo novo na revisão", **uma vez cada**, mesmo quem já
   era colaborador ou responsável. Não pode chegar "Você entrou numa tarefa" junto.
7. **Vídeo sem tarefa:** suba um vídeo sem vincular tarefa. O aviso chega ao revisor fixo, e nada é
   inserido em `task_collaborators`.
8. **Volta pro editor:** com esse vídeo, peça alteração (interna ou pelo link do cliente). O
   responsável da tarefa deve virar quem subiu a versão, e essa pessoa recebe "Nova tarefa
   atribuída". Peça alteração de novo sem trocar de uploader: não pode chegar aviso repetido.
9. **Saída na aprovação, um formato só:** aprove um dos formatos de uma tarefa que tem 16:9, 9:16 e
   1:1. Os revisores fixos **continuam** na tarefa.
10. **Saída na aprovação, tudo aprovado:** aprove os que faltam. Os revisores fixos somem da lista
    de colaboradores. Quem tinha sido adicionado à mão continua lá.
11. **Trava de segurança:** adicione um revisor fixo à mão numa tarefa nova, deixe a revisão correr
    até aprovar tudo. Ele **não** pode ser removido (`auto_revisor = false`).
