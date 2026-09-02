# Continuar este trabalho em outra máquina

Escrito em 01/09/2026, no fim de uma sessão longa. O que está no git viaja
sozinho. O que está listado aqui, não.

## 1. O que você precisa carregar na mão (não vai pro git, e nem deve)

**Os dois arquivos de ambiente, na raiz do repositório:**

- `.env` — `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_GOOGLE_CLIENT_ID`,
  `VITE_GOOGLE_DRIVE_FOLDER_ID`. Sem ele o app não sobe.
- `.env.local` — `VITE_TEST_EMAIL` e `VITE_TEST_PASSWORD`, o login do robô de
  testes, que é o que permite a IA testar logada. Sem ele o botão "🤖 Entrar
  como robô de testes" some da tela de login, em dev.

Copie pelo gerenciador de senhas, ou gere de novo pelo painel do Supabase e do
Google. **Não mande por chat, e não commite.** Os dois são gitignorados de
propósito.

## 2. O que se instala na máquina nova

```bash
git clone https://github.com/caiorlacerda/comercial-lumos.git
cd comercial-lumos
npm install
# coloque .env e .env.local aqui
npm run dev
```

Ferramentas: Node, o `supabase` CLI (só se for mexer em edge function),
e acesso ao painel do Supabase (projeto `byntpekyfhzwfihjhzuo`) para rodar SQL.
O `gh` não está instalado nesta máquina; os PRs foram abertos pela API do
GitHub usando o token do `git credential`.

## 3. As skills do superpowers

Estavam em `~/.claude/skills/`, fora do repositório, e são 14: brainstorming,
systematic-debugging, test-driven-development, writing-plans, executing-plans,
requesting-code-review, receiving-code-review, subagent-driven-development,
dispatching-parallel-agents, using-git-worktrees, finishing-a-development-branch,
verification-before-completion, writing-skills e using-superpowers.

Na máquina nova, o caminho oficial é um comando só, num terminal `claude`:

```
/plugin install superpowers@claude-plugins-official
```

Vem com atualização automática, o que a cópia manual não tem.

## 4. A memória da IA

Vive em `~/.claude/projects/<caminho-do-projeto>/memory/`, também fora do
repositório. São 15 arquivos com coisas que não estão em lugar nenhum do
código: que o SQL é sempre rodado à mão pelo Caio, que a copy do app usa
vírgula em vez de travessão, o ref do Supabase, a armadilha do efeito que roda
antes do elemento existir, o combinado de sempre fechar a resposta dizendo o
que ele precisa fazer.

Sem isso a IA continua funcionando, e volta a errar coisas que já aprendeu.
Vale copiar a pasta inteira.

## 5. O que já está no git e você não precisa fazer nada

- Todo o código, na `main`, e a branch `f6` empurrada.
- As 12 migrações desta sessão, `2026093329` a `2026093340`, **todas já
  rodadas em produção**. Na máquina nova não rode nada de novo.
- As specs e o plano, em `docs/superpowers/specs/` e `docs/superpowers/plans/`.
- Os relatórios de cada agente, em `docs/superpowers/relatorios/`, incluindo a
  revisão da Ordem do Dia com os 26 achados, que é a lista de onde saem as
  próximas tarefas.

## 6. Onde a gente parou

Feito e no ar: portal do cliente com abas, pedido de diária com calendário,
dias da semana fechados, permissão de fechar agenda, ordem do dia no portal com
PDF do cliente, PDF interno completo, ordem do dia editável a várias mãos,
revisor fixo entrando e saindo sozinho, e a página de Automações.

Esperando decisão do Caio:

1. **Roteiro com aprovação do cliente** — o maior valor que sobrou da fase 2, e
   a sugestão da vez: aprovar roteiro antes de gravar é o que evita regravar.
2. **Camada 3 do tempo real** — varredura das outras telas, decidindo caso a
   caso quem ganha atualização ao vivo e quem não deve ganhar.
3. **Resto do grupo 2 da Ordem do Dia** — modais feitos na unha sem Esc,
   "puxar equipe" fundindo homônimos, e os 18 achados menores do relatório.

Pendências pequenas anotadas: o "não gravamos aos domingos" sumiu junto com os
outros motivos e pode voltar como exceção; a página de Automações nunca foi
vista funcionando por ninguém além do Caio, porque o robô de testes não é
admin.
