# Permissão `fechar_agenda`, tela e banco

Branch `f6`, worktree `determined-tereshkova-0af84d`. Build `npm run build` com exit 0.

## O que entrou

- `supabase/migrations/2026093335_permissao_fechar_agenda.sql` (novo, não rodado): função
  `public.pode_fechar_agenda()` (`SECURITY DEFINER`, `STABLE`, `SET search_path = public`,
  `GRANT EXECUTE ... TO authenticated`), no mesmo formato de `pode_ver_financeiro()`. Em
  `agenda_bloqueios` e `agenda_semana_fechada` a policy `FOR ALL ... USING (true)` sai e entram
  quatro policies por tabela: `FOR SELECT ... USING (true)` para `authenticated`, e
  `INSERT` / `UPDATE` / `DELETE` exigindo `pode_fechar_agenda()`. As policies antigas
  (`"time le e escreve bloqueios"`, `"time le e escreve semana fechada"`) são derrubadas pelo nome.
  Nenhuma migração de `2026093329` a `2026093334` foi tocada.
- `src/hooks/useAuth.tsx`: `fechar_agenda` na lista de `producao`. Fora de `time`, `atendimento`,
  `editor`, `social_media` e `basico`.
- `src/lib/notifications/notify.ts`: mesma linha de `producao` atualizada, para as duas cópias
  andarem juntas.
- `src/pages/Users.tsx` e `src/pages/Equipe.tsx`: `PERM_OPTIONS` ganha
  `{ key: 'fechar_agenda', label: 'Fechar datas na agenda (vale para todos os clientes)' }`.
- `src/components/producao/BloqueiosDeAgenda.tsx`: a prop `canManage` sai, o componente usa
  `can('fechar_agenda')` do `useAuth`. Quem não tem continua vendo a lista de datas bloqueadas e a
  coluna de dias da semana em modo leitura ("fechado"/"aberto"), e perde o formulário de bloquear
  data, os toggles de dia da semana e a lixeira de reabrir.
- `src/components/producao/ProjectDiarias.tsx`: o botão "Agenda bloqueada" abre com
  `canManage || can('fechar_agenda')`, e não passa mais `canManage` para o modal.

## Regra do banco, em SQL

```sql
u.auth_user_id = auth.uid()
AND u.status = 'ativo'
AND CASE
      WHEN jsonb_exists(COALESCE(u.custom_permissions, '{}'::jsonb), 'fechar_agenda')
        THEN u.custom_permissions ->> 'fechar_agenda' = 'true'
      ELSE u.role IN ('admin', 'producao')
    END
```

A ordem é a mesma de `can()` em `useAuth.tsx`: chave presente em `custom_permissions` decide,
para liberar e para bloquear, e só na ausência dela o papel decide. `jsonb_exists(...)` em vez do
operador `?` para não esbarrar em placeholder de driver.

## Tela contra banco, caso a caso

| Caso | Tela, `can('fechar_agenda')` | Banco, `pode_fechar_agenda()` | Bate |
|---|---|---|---|
| `custom_permissions.fechar_agenda = true`, papel `time`, ativo | true, chave presente vence o papel | true, `->> = 'true'` | sim |
| `custom_permissions.fechar_agenda = false`, papel `producao`, ativo | false, chave presente vence o padrão do papel | false, `'false' <> 'true'` | sim |
| `custom_permissions.fechar_agenda = false`, papel `admin`, ativo | false, `can()` lê `custom_permissions` antes do `*` | false, mesmo motivo | sim |
| Sem a chave, papel `admin`, ativo | true, `ROLE_DEFAULTS.admin = ['*']` | true, `role IN ('admin','producao')` | sim |
| Sem a chave, papel `producao`, ativo | true, `fechar_agenda` entrou na lista | true | sim |
| Sem a chave, papel `time` (e `atendimento`, `editor`, `social_media`, `basico`), ativo | false, não está nas listas | false, papel fora do `IN` | sim |
| `custom_permissions` nulo ou `{}` | cai no padrão do papel | `COALESCE` para `'{}'`, cai no padrão do papel | sim |
| Usuário `inativo` | `AuthWrapper` barra a sessão antes de qualquer tela | false, exige `status = 'ativo'` | sim, banco é o mais restrito |
| Sem sessão (`anon`, portal do cliente) | não se aplica | false, `auth.uid()` nulo, e as policies são só para `authenticated`; o portal continua lendo pelas RPCs `SECURITY DEFINER` | sim |

Nota de divergência conhecida, fora do escopo: `getUserIdsWithPermission` em `notify.ts` devolve
true para `admin` antes de olhar `custom_permissions`, então um admin bloqueado na mão contaria
como tendo a permissão ali. Isso só escolhe destinatário de notificação, não autoriza escrita, e
`fechar_agenda` não dispara notificação. Não mexi.

## Verificação

- `npm run build`: exit 0, sem erro de tipo. Só o aviso de tamanho de chunk que já existia.
- A metade de banco foi conferida por leitura, comparando com `can()` caso a caso, como na tabela
  acima. Nenhum SQL foi executado.
- Não abri o navegador: a mudança de tela é troca de guarda booleana, e o modal já tinha os ramos
  de leitura prontos (`podeFechar ? toggle : texto "fechado"/"aberto"`), então build mais leitura
  cobrem o que havia para conferir. Nada foi escrito no banco e o bloqueio de 21/09/2026 não foi
  tocado.

## Aberto

- A migração ainda precisa ser rodada por Caio no Supabase, com o app fechado (a própria migração
  avisa do lock).
- Enquanto ela não rodar, o banco continua aceitando escrita de qualquer usuário logado, e a tela
  já esconde os controles: quem tinha `ordem_do_dia` e não tem `fechar_agenda` perde o botão de
  fechar agora.
- Chamada de julgamento: o botão "Agenda bloqueada" ficou em `canManage || can('fechar_agenda')`,
  e não só em `can('fechar_agenda')`, para cumprir "quem não tem continua vendo o que está
  fechado". Gatear o botão só pela permissão nova fecharia a tela de leitura para o resto do time
  e deixaria os ramos read-only do modal como código morto.
