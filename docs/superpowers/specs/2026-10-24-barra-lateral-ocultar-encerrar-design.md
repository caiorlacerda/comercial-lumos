# Barra lateral de projetos: ocultar e encerrar pelo botão direito

Data: 24/10/2026 · Decisões: Caio · Base: `src/components/layout/SidebarProjectTree.tsx` (já tem "Encerrados" e um menu de botão direito só para admin, com "Editar" e "Excluir")

## Objetivo
1. Tirar da frente, **para o time todo**, projetos de clientes que têm muitos projetos, **sem encerrá-los**.
2. Encerrar (e reabrir) um projeto com o botão direito na barra lateral, **vendo antes o que está em aberto**.

## Decisões já tomadas
1. **Ocultar é para o time todo e só na barra lateral.** O projeto continua ativo e aparece normalmente em "Todos os Projetos", tarefas, financeiro, portal do cliente, vídeos em revisão e seletor do celular. Nada disso é tocado.
2. **Como se guarda:** coluna nova `projects.oculto_na_barra boolean NOT NULL DEFAULT false`. **`projects.status` não muda** (a regra do banco aceita só `ativo` e `concluido`, e todo o sistema filtra por ela). Descartados: status novo `pausado` (mudaria a regra do banco e todos os filtros) e preferência por pessoa (`user_view_prefs`), porque o Caio quer o time todo.
3. **Encerrar pelo botão direito** abre uma **confirmação com o que está em aberto** (tarefas abertas, vídeos aguardando o cliente, quanto falta receber). Confirmando, **só troca `projects.status` para `concluido`**, igual ao botão atual da página Projetos. Não encerra no financeiro, não desativa links de revisão, não fecha tarefas.
4. **Permissão:** "Encerrar", "Reabrir", "Ocultar da barra" e "Mostrar na barra" aparecem para `isAdmin || can('ordem_do_dia')` (a mesma regra do botão "Encerrar" da página Projetos). "Editar" e "Excluir" continuam só para admin.

## O que o time vê

### Árvore
- Clientes e projetos visíveis como hoje. O número ao lado do cliente conta **só os visíveis**. Cliente com todos os projetos ocultos some da árvore principal.
- Novo grupo recolhível **"Ocultos"** (ícone de olho cortado), entre "Sem cliente" e "Encerrados", **só aparece se houver ao menos um oculto**. Lista plana, no formato `Cliente · 2026-229 Nome`, para não perder de qual cliente é.
- "Encerrados" continua como hoje. Um projeto encerrado e oculto aparece só em "Encerrados".
- Se o projeto aberto na tela estiver em "Ocultos", o grupo se expande sozinho (mesma lógica que já expande o cliente).

### Menu de botão direito num projeto
| Situação do projeto | Itens (para quem tem permissão) |
|---|---|
| Ativo e visível | Ocultar da barra · Encerrar projeto… · (admin) Editar projeto… · (admin) Excluir projeto… |
| Ativo e oculto | Mostrar na barra · Encerrar projeto… · (admin) Editar… · (admin) Excluir… |
| Encerrado | Reabrir projeto… · (admin) Editar… · (admin) Excluir… |

Quem não tem permissão de produção não abre menu (como hoje, para quem não é admin). O `title` do botão do projeto deixa de dizer "botão direito para excluir" e passa a dizer "botão direito para as opções".

### Confirmação de "Encerrar projeto…"
Janela com o nome do projeto e:
- **Tarefas abertas:** N (tarefas do projeto, fora da lixeira, com status diferente de `concluido` e `entregue`).
- **Vídeos aguardando o cliente:** N (vídeos cuja versão mais recente do grupo está em `EM_REVISAO_CLIENTE`).
- **A receber:** R$ X (parcelas da proposta do projeto (achada em `projetos_financeiro.proposta_id` pelo `project_id`) ainda não recebidas ou canceladas, como em `EncerrarProjetoModal`). Só aparece se o projeto tem proposta no financeiro.
- Nenhum dos três com valor: "Nada em aberto encontrado."
- Se uma conferência falhar (ex.: sem permissão para ler `receivables`), a linha diz "não foi possível conferir" em vez de sumir ou mostrar zero.
- Texto fixo: "Isso só marca o projeto como encerrado. Não encerra no financeiro, não desativa links de revisão e não fecha tarefas. A equipe recebe um aviso."
- Botões: Cancelar · **Encerrar projeto**.

"Reabrir projeto…" usa a mesma janela, sem contagens: "Reabrir *Nome*? Ele volta para a árvore de projetos ativos." Reabrir **não** avisa a equipe (comportamento atual do gatilho).

## Regras de segurança do dado
- **Atualização com guarda:** o `UPDATE` de status filtra pelo status que a pessoa viu (`.eq('status', atual)`) e pede a linha de volta. Se nenhuma linha mudou (alguém já encerrou/reabriu), mostra "Esse projeto já foi alterado por outra pessoa. Recarregue a barra." e não grava o oposto. (O botão atual da página Projetos grava o oposto do que a tela mostra; isso não é mexido aqui.)
- **Aviso à equipe:** continua vindo do gatilho do banco `trg_project_closed_notification` (status → `concluido`). O cliente **não** chama `notify()` para isso.
- **Barra atualiza na hora:** depois de ocultar, mostrar, encerrar ou reabrir, a árvore atualiza o próprio estado (sem recarregar a página).

## Compatibilidade antes do SQL
O SQL é rodado à mão pelo Caio, normalmente depois do deploy. Enquanto a coluna não existir:
- A busca de projetos tenta `select(..., oculto_na_barra)`. Se der erro, repete a busca sem a coluna e marca `ocultarDisponivel = false`.
- Com `ocultarDisponivel = false`, os itens "Ocultar da barra" e "Mostrar na barra" **não aparecem**; tudo mais (inclusive Encerrar e Reabrir) funciona, e a barra se comporta exatamente como hoje.
- Nenhum erro visível ao usuário.

## Fora do escopo (anotado, não mexer)
- A varredura do Drive (`drive-watch`) ignora projeto encerrado; vídeo enviado depois não é registrado.
- O prazo de 90 dias do portal conta de `projects.updated_at`, não de uma data de encerramento (não existe `encerrado_em` em `projects`).
- Encerrar pela página Projetos não atualiza a barra lateral (e vice-versa: a página só vê a mudança ao recarregar).
- Os "três encerrados" (status do projeto, `projetos_financeiro.encerrado_em` e a etapa "Projeto encerrado" do pipeline) continuam sem conversar entre si.
- O botão atual da página Projetos não pede confirmação.
- Não existe encerramento de projetos em lote (`handleBatchStatus` muda tarefas).
- Realtime da barra: a marca "oculto" aparece para os outros na próxima vez que carregarem a barra.
- Mobile: a barra lateral é só desktop; o seletor do celular (`SeletorDeProjeto`) não muda.
- Estudo completo: `estudo-encerrar-projeto.md` (levantamento de 24/10/2026, só leitura).

## Entrega
Um PR só (app + 1 arquivo SQL): `supabase/migrations/2026102409_projects_oculto_na_barra.sql`, rodado à mão pelo Caio (uma linha, `ADD COLUMN IF NOT EXISTS`, mais uma consulta de conferência). O app funciona antes e depois do SQL (seção acima).

## Testes
- Funções puras (`montarArvore`, `resumoPendencias`) com script Node descartável.
- Navegador, em servidor com banco morto e `fetch` simulado para as chamadas ao Supabase: árvore com/sem coluna, grupo "Ocultos", menus por permissão (admin, produção, sem permissão), confirmação com contagens e com uma falha, guarda de status, tema claro e escuro, desktop. **Nunca** o `.env` de produção.
- Caio testa no preview da Vercel depois de rodar o SQL.
