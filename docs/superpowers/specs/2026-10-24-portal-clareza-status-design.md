# Portal do cliente: clareza de status (Pacote A) + base técnica (Pacote F)

Data: 24/10/2026 · Autor da decisão: Caio · Origem: levantamento de portais de agências e produtoras (sessão de 23–24/10/2026)

## Objetivo

Hoje o portal mostra a etapa do projeto, as datas e as entregas, mas **não diz ao cliente se está tudo certo, o que vem agora e o que a Lumos espera dele**. Este desenho acrescenta quatro blocos na Visão geral de cada projeto e arruma a base do front para os pacotes seguintes (B entregas, C financeiro, D reuniões, E comunicação).

## Decisões já tomadas

1. **Saúde do projeto é calculada pelo sistema**, mas a **equipe é avisada primeiro** e tem **24 horas** antes de o cliente ver "Atenção" ou "Atrasado". Piora é segurada; melhora aparece na hora.
2. **"O que precisamos de você"** = itens automáticos (vídeos esperando aprovação, itens do Bem-vindo pendentes) **+ itens livres** escritos pela equipe (texto e prazo).
3. **Equipe do projeto** é escolhida **por projeto** e liberada **por cliente** (o interruptor `client_portals.mostrar_equipe`, que já existe para as diárias).
4. **Próximo marco** sai do cronograma que o portal já recebe; não exige tela nova para a equipe.
5. A refatoração do front (F) acontece **antes** dos blocos novos, sem mudar o que o cliente vê.

## 1. O que o cliente vê

No topo da aba **Visão geral** de cada projeto, nesta ordem:

| Bloco | Conteúdo | Fonte |
|---|---|---|
| Saúde | "No prazo", "Atenção" ou "Atrasado" + frase neutra | `project_portal_saude.exibida` |
| Próximo marco | Nome da próxima etapa ainda não feita e a data (`prazo_cliente` ou fim da etapa) | `cronograma` / `stages` que `get_client_portal_v2` já devolve |
| O que precisamos de você | Lista com texto e prazo opcional | vídeos em revisão do cliente + `portal_pendencias` |
| Equipe do projeto | Foto, nome e função | `project_portal_equipe`, só se `mostrar_equipe` |

Na aba **Início**, uma seção "O que precisamos de você" reúne os itens de nível cliente (pendências sem projeto + itens do Bem-vindo sem preencher). Os vídeos esperando aprovação continuam no destaque que já existe.

Cada bloco **some** quando não tem conteúdo (sem indicador, sem pendência, sem equipe liberada). O portal nunca afirma "No prazo" sem base.

Frases (editáveis na revisão deste documento):
- No prazo: "Tudo andando como combinado."
- Atenção: "Estamos acompanhando o prazo de perto."
- Atrasado: "O prazo combinado passou. Fale com seu atendimento para o novo cronograma."

O cliente **nunca** vê o motivo interno do cálculo.

## 2. Regras da saúde

Calculadas pela função `portal_saude_calcular(project_id)`, num lugar só, para poder ajustar sem mexer em mais nada.

- **Sem indicador (NULL):** projeto concluído, ou sem `data_fim` e sem tarefa com prazo.
- **Atrasado:** projeto não concluído e `data_fim < hoje`, **ou** existe tarefa com `data_entrega_cliente < hoje` ainda em etapa nossa.
- **Atenção:** não está atrasado e (`data_fim` nos próximos 3 dias com tarefa ainda em etapa nossa, **ou** tarefa nossa com `data_fim < hoje`).
- **No prazo:** os demais casos com algum dado de data.

"Etapa nossa" = `roteiro`, `captacao`, `em_progresso`, `revisao_interna`, `alteracoes`. Tarefa em `revisao_cliente` **não conta como atraso da Lumos**: aparece em "O que precisamos de você". Tarefas apagadas (`deleted_at`) são ignoradas.

**Risco conhecido:** prazo de tarefa interna desatualizado pode gerar "Atenção" por dado velho. Por isso a rotina automática só é ligada depois de uma consulta de ensaio (seção 7) que mostra ao Caio o que a regra diria hoje para cada projeto.

## 3. Segurar a piora (o aviso à equipe)

Ordem dos estados: `NULL(0) < no_prazo(1) < atencao(2) < atrasado(3)`. **Piora** = o novo estado é `atencao` ou `atrasado` e tem ordem maior que o exibido.

`portal_recalcular_saude(p_project_id uuid DEFAULT NULL)` roda de hora em hora (pg_cron, sem HTTP) e sob demanda quando a equipe abre a seção Portal. Para cada projeto visível no portal:

1. Calcula o estado novo.
2. **Não é piora** (igual, melhora, ou `NULL → no_prazo`): `exibida = nova`, limpa `liberar_em`.
3. **É piora e o estado calculado mudou:** `calculada = nova`, `calculada_desde = now()`, `liberar_em = now() + 24h`, **cria o alerta** para a equipe (se a automação `portal_saude_avisa` estiver ligada). A `exibida` não muda.
4. **É piora e já estava segurada:** se `liberar_em <= now()`, `exibida = nova`. Senão, nada.
5. Se a causa for corrigida antes das 24 horas, o próximo cálculo cai no passo 2 e o aviso deixa de valer sem ninguém tocar em nada.

`portal_saude_liberar(project_id)` (só equipe) faz `exibida = calculada` na hora ("Mostrar agora").

**Alerta:** notificação in-app `portal_saude_piora`, prioridade alta, para admin, atendimento e `contact_user_ids` dos portais do cliente (mesmo público do aviso "cliente abriu o portal"). Texto: "**{Projeto}** vai aparecer como **{Atrasado|Atenção}** para o cliente em 24 horas." Link: `/producao/projetos?projectId={id}`. Criado direto no banco (é gatilho de banco), **sem** chamada `notify()` no cliente, para não duplicar. O tipo entra no catálogo `src/lib/notifications/events.ts`.

Projeto sem portal ativo ou com `portal_visivel = false`: `exibida = nova` sem alerta (ninguém vê).

## 4. Banco de dados

Migrations novas (nome `AAAAMMDDNN_descricao.sql`, rodadas manualmente pelo Caio no Supabase):

**`project_portal_saude`** (1 linha por projeto): `project_id uuid PK → projects ON DELETE CASCADE`, `calculada text NULL`, `exibida text NULL`, `calculada_desde timestamptz`, `liberar_em timestamptz`, `liberada_por uuid → app_users`, `updated_at`. CHECK dos valores. RLS ligada, **leitura só para `is_team()`**, escrita só pelas funções.

**`portal_pendencias`**: `id`, `client_id → clients`, `project_id → projects NULL` (NULL = do cliente inteiro), `texto text CHECK (char_length ≤ 200)`, `prazo date NULL`, `concluida_em timestamptz NULL`, `created_by`, `created_at`. RLS: equipe lê e escreve (`is_team()`); anon nunca lê direto.

**`project_portal_equipe`**: `project_id`, `app_user_id`, `ordem int`, PK `(project_id, app_user_id)`. Mesma RLS.

**Funções:**
- `portal_saude_calcular(uuid) → text` (STABLE, interna).
- `portal_recalcular_saude(uuid DEFAULT NULL) → void` (SECURITY DEFINER; barra quem estiver logado e **não** for equipe; o cron roda sem `auth.uid()` e passa).
- `portal_saude_liberar(uuid) → void` (SECURITY DEFINER, `is_team()`).
- `portal_contexto(text) → record` (interna, **sem execução para anon/PUBLIC**): resolve token ativo, `exige_login`, pessoa, `restrito` e `client_id`, com as mesmas regras de `get_client_portal_v2`.
- **`portal_visao_projetos(p_token text) → jsonb`** (SECURITY DEFINER, aberta a anon como o resto do portal): devolve, por projeto liberado, `{id, saude:{estado, frase}|null, pendencias:[{texto, prazo}], equipe:[{nome, funcao, foto}]}` e, no nível do cliente, `pendencias_cliente` e `boas_vindas_pendentes`. Respeita `restrito`, `portal_visivel` e `mostrar_equipe`. **Não** mexe em `get_client_portal_v2`.

**Automação:** chave `portal_saude_avisa` na tabela `automacoes` (ausente = ligada), com entrada na página Configurações → Automações.

**Agendamento:** `cron.schedule('portal-saude-recalcular', '7 * * * *', 'SELECT public.portal_recalcular_saude()')`, em **arquivo próprio**, rodado só depois do ensaio.

Toda função nova segue o padrão do PR #354: `REVOKE ALL ... FROM PUBLIC, anon`, depois `GRANT` só ao que precisa. Só `portal_visao_projetos` é aberta a anon.

## 5. App interno (equipe)

Na página do projeto (Produção → Projetos), nova seção **Portal**:
- **Saúde:** estado calculado, estado que o cliente vê agora e, se houver piora segurada, "o cliente verá em X h" com o botão **Mostrar agora**. Mostra também o motivo interno do cálculo (só a equipe vê).
- **Pendências do cliente:** lista com adicionar, concluir e apagar (escopo do projeto).
- **Equipe no portal:** escolher quem aparece e a ordem.

No `PortalModal` (nível cliente) entra o campo para pendências do cliente inteiro (sem projeto).

## 6. Front do portal

**F, refatoração sem mudar comportamento.** `src/pages/PortalCliente.tsx` (≈1.700 linhas) vira a pasta `src/pages/portal/`:
- `PortalCliente.tsx`: casca (carregar dados, estado de aba/URL, rotas de erro e login).
- `PortalFrame.tsx`: fundo, `<style>` e tema **uma vez só** (hoje o CSS é montado em cinco lugares).
- `abas/Inicio.tsx`, `abas/Projeto.tsx` (com `projeto/Geral.tsx`, `Entregas.tsx`, `Diarias.tsx`, `Arquivos.tsx`), `abas/Atendimento.tsx`, `abas/BoasVindas.tsx`.
- `Calendario.tsx`, `useJanela.ts`, `armazenamento.ts`, `formatacao.ts`, `tipos.ts`, `motivos.ts`, `PortalErro.tsx`.
- `src/pages/PortalCliente.tsx` continua existindo só como `export { default } from './portal/PortalCliente'`, para o `lazy` do `App.tsx` não mudar.

**A, blocos novos.** Um hook `useVisaoProjetos(token)` chama `portal_visao_projetos` em paralelo ao carregamento principal. Falhou ou a função ainda não existe → os blocos novos não aparecem e o resto do portal funciona. Acessibilidade e mobile-first desde o início (safe areas, sem rolagem horizontal, tokens do portal).

## 7. Testes e implantação

**Banco (local, Docker `supabase_db_proposta-lumos`):** projetos de teste cobrindo cada regra da seção 2 e cada transição da seção 3 (piora segurada, correção dentro das 24 h, liberação manual, liberação pelo prazo, melhora imediata, projeto sem portal); `set role anon` chamando `portal_visao_projetos` com token válido, inválido e de portal com login; conferência de que `portal_contexto`, `portal_recalcular_saude`, `portal_saude_liberar` e `portal_saude_calcular` **não** executam como anon.

**Front:** `tsc` sem erro nos arquivos tocados; roteiro no navegador com respostas simuladas (o mesmo do PR #355) antes e depois da refatoração, comparando o resultado; blocos novos com e sem dados e com a função ausente.

**Ordem dos PRs** (cada um mesclado só após o OK do Caio):
1. **F:** refatoração do front, sem mudança visível.
2. **SQL do pacote A:** tabelas, funções, automação. O Caio roda. Inclui a **consulta de ensaio** (o que a regra diria hoje, projeto por projeto).
3. **App interno:** seção Portal no projeto e campo no `PortalModal`, mais o tipo de notificação no catálogo.
4. **Front do cliente:** os quatro blocos e a seção no Início.
5. **Cron** (arquivo SQL separado), depois de o Caio revisar o ensaio e calibrar as regras.

## 8. Fora de escopo

Pacotes B (versões e prazo de revisão), C (financeiro útil), D (combinados e reuniões) e E (resumo por e-mail); login de cliente; gateway de pagamento; refatorar `get_client_portal_v2`; qualquer mudança no desktop interno fora da seção Portal.

## 9. Riscos

- **Regra de saúde ruidosa** → ensaio antes do cron, regra em uma função só.
- **Função nova exposta a anon** → só `portal_visao_projetos` é aberta; as demais passam pelo mesmo REVOKE do PR #354 e por teste de conferência.
- **Refatoração quebrar o portal público** → PR próprio, sem lógica nova, com roteiro de comparação antes e depois.
- **Notificação duplicada** → só gatilho de banco para este evento, nada de `notify()` no cliente (regra do CLAUDE.md).
