# SDD ledger — plan: docs/superpowers/plans/2026-08-30-portal-abas-e-diarias.md

Spec: docs/superpowers/specs/2026-08-30-portal-abas-e-diarias-design.md
Branch: f6 (worktree determined-tereshkova-0af84d)

## Varredura de conflitos (pré-voo)

| par | produz → consome | achado |
|---|---|---|
| T1 → T2 | `diaria_pedidos`, `agenda_bloqueios`, `antecedencia_dias` → `portal_agenda` lê as três | ok |
| T1 → T3 | mesmas tabelas → `portal_pedir_diaria` grava | ok |
| T1 → T6 | `diaria_pedidos` → fila e `aceitar_pedido_diaria` | ok |
| T2 → T5 | `portal_agenda` devolve `dias/agendadas/pacote/pedidos` → aba consome as 4 chaves | ok, nomes batem |
| T3 → T5 | erros `cedo/dia_ocupado/dia_bloqueado/repetido/sem_descricao/sem_nome/sem_acesso` → mapa MOTIVOS | ok, os 7 estão no mapa |
| T4 → T5 | estado `abaProj` com valor `diarias` → efeito da aba dispara com `abaProj !== 'diarias'` | ok |
| T6 → T7 | fila em ProjectDiarias → botão de bloqueios no mesmo cabeçalho | ambos editam ProjectDiarias.tsx, em pontos diferentes; T7 depois de T6 |
| T1 → T7 | `agenda_bloqueios` → BloqueiosDeAgenda | ok |
| T1 → T7 | `client_portals.antecedencia_dias` → controle no PortalModal | ok |

| tarefa | texto consigo mesmo | achado |
|---|---|---|
| T1 | DDL, RLS, trigger, evento TS | ok |
| T2 | função + verificação anônima | ok |
| T3 | função + tabela de recusas | ok |
| T4 | só move seções, sem mudar conteúdo | ok |
| T5 | componente Calendario escrito por inteiro; estado dataEscolhida declarado | ok |
| T6 | SQL + componente + montagem | ok |
| T7 | bloqueios + antecedência | ok |
| T8 | limpeza, PR, conferência | ok |

Achado da varredura: **T4 e T5 editam o mesmo trecho de PortalCliente.tsx** (o
bloco `{projetoAberto && ...}`). Não é conflito, é ordem: T5 depende de T4 já ter
criado `abaProj`. Ruling: manter sequencial, nunca em paralelo — vale para T6/T7
também, que dividem ProjectDiarias.tsx.

Ruling: as migrações são rodadas pelo Caio, não pelos agentes. O implementador
escreve o arquivo e PARA; eu entrego o SQL e só sigo com o "rodei". Custo se
errado: nenhum, é a regra do projeto (CLAUDE.md).

## Progresso

Task 1: complete (commits e8a5060..5c8a00b, review clean)
Task 1: minor (deferred): trigger usa role 'atendimento', que não está na lista de papéis do CLAUDE.md; padrão já existente em migrações anteriores, não é dívida nova
Task 1: aberto para o humano: o SQL ainda não foi rodado (Passos 2 e 3 do brief)
Ruling: juntar num só despacho as migrações das Tarefas 2, 3 e o Passo 1 da Tarefa 6 — são três arquivos SQL da mesma forma, sem verificação possível até o Caio rodar. Assim ele roda as quatro de uma vez, em vez de ser interrompido três vezes. Custo se errado: a revisão cobre três arquivos em vez de um, e um erro em um deles obriga a reler os três.
Tarefas 2/3/6-SQL: revisão 1 — spec ✅, qualidade ❌ (4 Importantes, 3 Menores)
Ruling: os quatro Importantes entram no laço de correção. Os três primeiros são defeitos meus, escritos no plano: generate_series devolvendo timestamp (quebra o calendário da Tarefa 5), client_users.nome nulo violando NOT NULL, e corrida no aceite criando diária órfã. Custo se errado: nenhum, são bugs demonstrados.
Ruling: o achado 4 (portal_cancelar_pedido ignora exige_login) conflita com o texto do plano, que mandou escrever assim. A spec manda que o portal com login só responda a quem está na lista, e cancelar é escrita. A spec é a autoridade: corrigir a função, e o plano estava errado. Custo se errado: uma checagem a mais numa função que quase ninguém chama.
Ruling: as migrações ainda NÃO foram rodadas pelo Caio, então corrigir os arquivos no lugar, em vez de criar migração nova. Editar migração já aplicada é que seria proibido. Custo se errado: se ele tiver rodado sem avisar, o banco fica com a versão antiga das funções, e um CREATE OR REPLACE resolve.
Tarefas 2/3/6-SQL: minor (deferred): falta guarda de e-mail vazio antes de casar client_users (padrão da 2026093328)
Tarefas 2/3/6-SQL: minor (deferred): aceitar_pedido_diaria aceita qualquer app_users ativo, papel 'basico' incluído
Tarefas 2/3/6-SQL: minor (aceito no laço): índice em project_diarias(data) — 182 EXISTS por chamada do calendário, é barato e entra junto
Tarefas 2/3/6-SQL: rodada de correção 1/5 (5 resolvidos, 0 abertos; commits 3a3d682..8f3df1b)
Tarefas 2/3/6-SQL: complete (commits 5c8a00b..8f3df1b, revisão limpa)
Tarefas 2/3/6-SQL: para carregar na Tarefa 5: portal_cancelar_pedido agora pode devolver 'sem_acesso', e o mapa MOTIVOS da UI precisa tratar
Tarefas 2/3/6-SQL: observação: com exige_login ligado depois, pedido antigo com client_user_id NULL fica incancelável pelo cliente (a Lumos ainda cancela por dentro)
Aberto para o humano: rodar as migrações 2026093329, 30, 31 e 32, nesta ordem
Verificação pós-SQL (feita pelo coordenador, migrações rodadas pelo Caio):
  portal_agenda: 91 dias, data no formato AAAA-MM-DD (a correção pegou), antecedencia 7, estados {cedo 4, ocupado 6, livre 81}, pacote null no projeto sem contrato por volume, sem_acesso em projeto que não é do cliente ✔
  portal_pedir_diaria: cedo ✔, dia_ocupado ✔ (testado em dia ocupado FORA da janela de antecedência, senão 'cedo' vence primeiro), sem_descricao ✔, criação ✔, repetido ✔
  portal_cancelar_pedido: ok ✔, e nao_encontrado na segunda chamada ✔
  NÃO verificado: dia_bloqueado, porque não existe linha em agenda_bloqueios e criar uma exige a UI da Tarefa 7. Fica pendente até lá.
  Limpeza: o pedido de teste foi cancelado; 0 pendentes no Produção Teste.
Task 4: implementada (commit dbdafbaf), em revisão
Task 4: revisão 1 — spec ✅, qualidade ❌ (2 Importantes, 2 Menores, 1 não verificável)
Ruling: achado 1 (.secao:first-of-type vazando para a aba Início e para Atendimento) entra no laço. A regra estava literal no meu brief, então o plano é que estava errado: CSS global numa página que tem outras abas. Corrigir escopando a regra. Custo se errado: nenhum, é regressão visual demonstrada.
Ruling: achado 2 (voltar do player perde a aba interna) entra no laço. Não é escopo novo: o portal JÁ restaura em qual projeto a pessoa estava, e as abas quebraram metade dessa promessa. Custo se errado: um parâmetro a mais na URL de volta.
Task 4: minor (deferred): o selo amarelo da fita conta todas as entregas, enquanto o mesmo selo no menu de projetos conta só as que esperam o cliente; mesmo símbolo, dois sentidos
Task 4: minor (deferred): as capas continuam sendo buscadas mesmo com a aba Entregas fechada
Task 4: não verificável pelo diff: fita com as quatro abas ao mesmo tempo e Visão geral com escopo/cronograma cheios; nenhum projeto de teste tem esses dados
Task 4: rodada de correção 1/5 (2 resolvidos, 0 abertos; commits dbdafba..8077539)
Task 4: complete (commits 8f3df1b..8077539, revisão limpa)
Task 4: minor (deferred): se carregar() rodar de novo com a mesma aba (reautenticação), a ref subRestaurada fica pendurada e aplica a aba antiga na próxima troca de projeto; janela estreita, mas real
Task 5: revisão 1 — spec ✅, qualidade ❌ (1 Crítico, 4 Importantes, 5 Menores)
Ruling: o Crítico (portal_agenda devolvendo {error} derruba a página com tela branca) e os 4 Importantes entram no laço. O Crítico dispara justamente no caso mais provável em portal com login: token expirado.
Ruling: puxo para o laço um Menor que a revisão classificou como cosmético, o fundo padrão de botão nos dias indisponíveis. O calendário é o centro da tela e um dia cinza de botão nativo lê como quebrado. Custo se errado: uma linha de CSS a mais.
Task 5: minor (deferred): meta 0 gera largura NaN e "1ª diária de 0"
Task 5: minor (deferred): dia bloqueado dentro da antecedência mostra 'bloqueado' e o servidor recusaria como 'cedo'
Task 5: minor (deferred): pedDescricao não é limpo ao trocar de projeto
Task 5: minor (deferred): estado 'cancelado' é inalcançável na lista porque o SQL não grava respondido_em ao cancelar
Task 5: minor (deferred): calendário sem aria-label com a data completa e sem navegação por setas
Task 5: rodada de correção 1/5 (6 resolvidos, 0 abertos; commits 8444de0..d596f4f)
Task 5: complete (commits 8077539..d596f4f, revisão limpa)
Task 5: minor (deferred): 'sem_acesso' com login também sai quando o projeto não está liberado pra pessoa, e aí a frase "Sua sessão expirou" engana
Task 5: minor (deferred): erro de transporte em portal com login mostra o mesmo botão "Entrar de novo", então um tropeço de rede pode derrubar a sessão se a pessoa clicar
Task 5: minor (deferred): o .then da agenda não tem .catch; um throw inesperado trava carregandoAgenda em true
Task 6: revisão 1 — spec ✅, qualidade ❌ (1 Importante, 4 Menores)
Ruling: o Importante (recusar sem filtrar por estado='pendente') entra no laço: cria pedido recusado no portal com a diária já marcada na agenda, e a guarda equivalente existe do lado do aceitar.
Ruling: puxo junto o Menor da resposta nula sem erro, que hoje não mostra nada, porque é uma linha na mesma função que já vai ser tocada. Custo se errado: um else a mais.
Task 6: minor (deferred): QuickForm fecha mesmo quando o update de recusar falha; sobra só o toast
Task 6: minor (deferred): a fila só aparece depois das diárias carregarem (return de loading acima)
Task 6: minor (deferred): o aviso de dia ocupado cita o próprio projeto quando já há outra diária dele no mesmo dia
Task 6: rodada de correção 1/5 (2 resolvidos, 0 abertos; commits 1601d35..ced39f4)
Task 6: complete (commits d596f4f..ced39f4, revisão limpa)
Ruling: a partir da Tarefa 7, todo despacho passa o robô de testes (botão em /login no dev), porque três agentes seguidos relataram "sem login" e conferiram só por leitura. Custo se errado: o robô escreve no banco de produção, então cada agente tem que limpar o que criar.
Task 7: revisão 1 — spec ✅, qualidade ❌ (3 Importantes, 5 Menores)
Ruling: os 3 Importantes entram no laço. O da antecedência sem validação é o mais sério: campo apagado grava 0 e 999 grava 999, e aí o calendário do cliente vira 90 dias de 'cedo', sem ninguém entender por quê.
Task 7: minor (deferred): input de antecedência não controlado, segue mostrando o número recusado se o update falhar
Task 7: minor (deferred): hoje() em UTC, depois das 21h em Brasília já devolve amanhã
Task 7: minor (deferred): data duplicada detectada pelo texto da mensagem, e não pelo código 23505
Task 7: minor (deferred): amber-500 e red-400 crus, com precedente no mesmo arquivo
Task 7: observação: a RLS de agenda_bloqueios libera qualquer authenticated; canManage é só barreira de tela
Task 7: rodada de correção 1/5 (3 resolvidos, 0 abertos; commits a14e10a..8c62c2e)
Task 7: complete (commits ced39f4..8c62c2e, revisão limpa)
Estado bloqueado: VERIFICADO em tela pelo robô (bloqueou 15/10, viu indisponível no portal, desbloqueou, voltou a livre). Some da lista de pendências.
Revisão final do ramo: NÃO MERGEAR ainda. 2 Importantes bloqueiam (aviso de extra olhando o mês errado; RPCs novas não aceitam token antigo de projeto), mais 2 Importantes recomendados na mesma leva (link da notificação usa 'aba' e Projetos.tsx lê 'tab'; excluir a diária deixa o pedido 'aceito' com diaria_id nulo). Todos os 19 menores adiados foram triados como "podem esperar", exceto meta 0 gerando NaN, que sobe junto por morar na mesma linha do item 1.
Revisão final: concordou com os 8 rulings, inclusive o de corrigir portal_cancelar_pedido contra o texto do plano. Sugestão pra fase 2: botão de cancelar pedido na fila interna, senão pedido órfão só morre no banco.
Ruling: a leva de correção final espera o e2e terminar, para entrar tudo num despacho só, e para não editar arquivo embaixo de um agente que está testando no navegador. Custo se errado: alguns minutos de espera.
E2E como robô: PASSOU COM RESSALVAS. Passos 1 a 5 passaram, incluindo diária nascendo com os dados idênticos ao pedido e o motivo da recusa chegando ao portal. Passo 6 (fila em 375px) só parcial, a fila já estava vazia.
E2E ressalva 1: erro 409 no console ao enviar o PRIMEIRO pedido; o pedido foi criado assim mesmo e o segundo não repetiu. Cheira a envio duplicado batendo no índice único. Entra na leva de correção como investigação.
E2E ressalva 2: os dois pedidos de teste ficaram no histórico e o cliente Vitru OS VÊ no portal por 30 dias (portal_agenda devolve respondido_em > now()-30d). Não há tela para apagar pedido já decidido. Precisa de DELETE do Caio.
Ruling: o pedido cujo diária foi apagada volta para a fila como 'pendente', em vez de ficar 'aceito' apontando para nada. Gravação desfeita é pedido em aberto de novo, e o cliente lendo "Aceito" sem gravação marcada é o estado mentiroso que a spec queria evitar. Se o índice único barrar (já existe outro pendente do mesmo cliente no mesmo dia), vira 'cancelado'. Custo se errado: um pedido reaparece na fila e alguém recusa de novo.
Ruling: a leva final junta os 4 achados da revisão final, o meta 0 (NaN na cara do cliente), e a investigação do 409. Uma leva só, uma re-revisão só, como manda o processo.
Leva final: re-revisão limpa, 6 de 6 resolvidos, nada bloqueia o merge (commits 8c62c2e..1821b4b).
Leva final: minor (deferred): sem backfill dos 5 links '&aba=diarias' já gravados em notifications, todos de teste
Leva final: minor (deferred): pedido devolvido a 'pendente' com data no passado reaparece pra sempre na lista do cliente e trava a data no índice único. É consequência do MEU ruling do item 4, não da implementação. Surge pro Caio.
Leva final: minor (deferred): o EXCEPTION unique_violation de portal_pedir_diaria engoliria também colisão do INSERT do fallback, reportando 'repetido'; janela ínfima
Aberto para o humano: rodar 2026093333_ajustes_pedido_diaria.sql ANTES do merge, e o DELETE dos pedidos de teste
