# Welcome Doc Lumos: Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar o checklist fixo de "Bem-vindo à Lumos" num motor de página de onboarding orientado a template: seções de conteúdo interpoladas por variáveis, com o checklist de hoje como uma dessas seções, tudo por cliente e sem exigir login por padrão.

**Architecture:** Três tabelas novas (`client_welcome_doc_templates`, `client_welcome_docs`, `client_welcome_doc_itens`) descrevem o que existe pra mostrar/preencher; a tabela `client_boas_vindas_itens` que já existe continua descrevendo o que já foi preenchido, ganhando só uma FK opcional pro item de template. Uma RPC nova (`get_welcome_doc`) lê tudo pronto pro cliente; as duas RPCs e a edge function que já existem passam a validar `item_key` contra o template em vez de uma lista fixa de 4 valores. No frontend, `WelcomeDocPage` busca o doc, interpola variáveis com `interpolate.ts` (a única função pura do projeto, com teste automatizado de verdade) e distribui cada seção pro componente certo — o checklist de hoje (`BoasVindasLumos`) vira uma dessas seções, adaptado pra ler os itens do banco em vez de uma lista fixa no código.

**Tech Stack:** React + TypeScript (frontend), Supabase Postgres (PL/pgSQL, `SECURITY DEFINER`), Supabase Edge Functions (Deno), Node.js nativo (`node:test`) pro único teste automatizado do repositório.

**Spec:** `docs/superpowers/specs/2026-09-06-welcome-doc-lumos-design.md`

## Global Constraints

- **Por cliente (`client_id`), nunca por projeto.** Toda tabela nova referencia `clients(id)`, nunca `projects(id)`.
- **Sem exigir login por padrão.** Nenhuma RPC nova assume `auth.uid()`/`auth.jwt()` presente — replica o bloco `IF v_portal.exige_login THEN ... END IF` que `get_boas_vindas_lumos`/`marcar_item_boas_vindas` já usam (arquivo `supabase/migrations/2026093343_boas_vindas_exige_login.sql`).
- **CSS puro, sem Tailwind.** Todo componente novo usa classes escritas em `src/pages/portalCliente.css.ts` e as variáveis já existentes (`--luz`, `--gesso`, `--fio`, `--mesa`, `--meia-luz`, `--aprovado`, `--ajuste`, `--sala`). Nenhuma dependência nova.
- **SQL nunca roda sozinho.** Todo arquivo de migração é escrito, nunca aplicado por uma tarefa deste plano — o Caio aplica à mão.
- **Deploy de edge function pode ser feito pelo executor**, via `supabase functions deploy <nome> --no-verify-jwt --project-ref byntpekyfhzwfihjhzuo` (CLI já autenticada).
- **Sem framework de teste no projeto** (confirmado: só `dev`/`build`/`preview` no `package.json`, zero `.test.ts` em `src/`) — com uma exceção deliberada nesta entrega: `interpolate.ts` é função pura, sem I/O, e ganha teste de verdade via `node:test` (Node 26, já instalado, roda `.ts` nativamente sem transpilar). Todo o resto se verifica por `tsc --noEmit`, deploy real e curl/navegador, como no resto do projeto.
- **A copy real da Vitru já está disponível** (`welcome-doc-lumos-portal-v2.html`, entregue pelo Caio) e é usada diretamente na Task 8 — nada de lorem ipsum nem seed de teste solto: a primeira publicação já é a de verdade, ligando os itens que a Vitru já preencheu hoje ao template novo.

---

### Task 1: Schema — as três tabelas novas, a coluna nova, a view e a permissão de autoria

**Files:**
- Create: `supabase/migrations/2026093344_welcome_doc_schema.sql`

**Interfaces:**
- Produces: tabelas `client_welcome_doc_templates` (`id`, `vertical`, `version`, `sections` jsonb, `variables` jsonb, `checklist` jsonb, `is_active`, `created_at`), `client_welcome_docs` (`id`, `client_id`, `template_id`, `values` jsonb, `status`, `published_at`, `created_at`, `updated_at`), `client_welcome_doc_itens` (`id`, `welcome_doc_id`, `item_key`, `group_key`, `titulo`, `descricao`, `requer_arquivo`, `sort_order`); coluna nova `client_boas_vindas_itens.welcome_doc_item_id`; view `client_welcome_doc_progresso`; função `public.pode_editar_welcome_doc() RETURNS boolean`. Tasks 2, 3 e 4 dependem desses nomes exatamente como estão aqui.

- [ ] **Step 1: Escrever a migração completa**

```sql
-- Welcome Doc: o checklist fixo vira um motor de template por cliente.
-- Ver spec: docs/superpowers/specs/2026-09-06-welcome-doc-lumos-design.md
--
-- client_boas_vindas_itens (já existe, já em produção) não muda de forma:
-- continua sendo "o que já foi preenchido". As tabelas novas descrevem
-- "o que existe pra preencher" — template versionado, instância por
-- cliente, e a lista de itens que uma instância publicada tem.

CREATE TABLE IF NOT EXISTS public.client_welcome_doc_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vertical   text NOT NULL CHECK (vertical IN ('digital', 'filmes', 'live')),
  version    int NOT NULL,
  sections   jsonb NOT NULL DEFAULT '[]'::jsonb,
  variables  jsonb NOT NULL DEFAULT '[]'::jsonb,
  checklist  jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active  boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vertical, version)
);

CREATE TABLE IF NOT EXISTS public.client_welcome_docs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  template_id  uuid NOT NULL REFERENCES public.client_welcome_doc_templates(id),
  values       jsonb NOT NULL DEFAULT '{}'::jsonb,
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  published_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id)
);

CREATE TABLE IF NOT EXISTS public.client_welcome_doc_itens (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  welcome_doc_id uuid NOT NULL REFERENCES public.client_welcome_docs(id) ON DELETE CASCADE,
  item_key       text NOT NULL,
  group_key      text NOT NULL,
  titulo         text NOT NULL,
  descricao      text,
  requer_arquivo boolean NOT NULL DEFAULT true,
  sort_order     int NOT NULL DEFAULT 0,
  UNIQUE (welcome_doc_id, item_key)
);

CREATE INDEX IF NOT EXISTS client_welcome_doc_itens_doc_idx
  ON public.client_welcome_doc_itens (welcome_doc_id, group_key, sort_order);

-- Liga cada linha de status ao item de template que ela preenche. Linhas
-- antigas (criadas antes desta migração) ficam com isto NULL até a
-- migração de dados que amarra a Vitru (fora deste plano).
ALTER TABLE public.client_boas_vindas_itens
  ADD COLUMN IF NOT EXISTS welcome_doc_item_id uuid
    REFERENCES public.client_welcome_doc_itens(id) ON DELETE SET NULL;

-- O item agora pode vir de qualquer template — a validade do item_key
-- passa a ser garantida por existir (ou não) um client_welcome_doc_itens
-- correspondente, não por uma lista fixa no banco.
ALTER TABLE public.client_boas_vindas_itens DROP CONSTRAINT IF EXISTS client_boas_vindas_itens_item_key_check;

-- Progresso é sempre derivado, nunca uma coluna que pode ficar desatualizada.
CREATE OR REPLACE VIEW public.client_welcome_doc_progresso AS
SELECT d.id AS welcome_doc_id, d.client_id,
       count(s.*) FILTER (WHERE s.id IS NOT NULL) AS feitos,
       count(i.*) AS total
FROM public.client_welcome_docs d
JOIN public.client_welcome_doc_itens i ON i.welcome_doc_id = d.id
LEFT JOIN public.client_boas_vindas_itens s
  ON s.welcome_doc_item_id = i.id AND s.client_id = d.client_id
GROUP BY d.id;

-- ---------------------------------------------------------------------------
-- Autoria: só admin/atendimento ativos criam template, preenchem valores e
-- publicam. Mesmo padrão de pode_configurar_automacoes() (2026093340).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pode_editar_welcome_doc()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM app_users u
    WHERE u.auth_user_id = auth.uid()
      AND u.status = 'ativo'
      AND u.role IN ('admin', 'atendimento')
  );
$$;

GRANT EXECUTE ON FUNCTION public.pode_editar_welcome_doc() TO authenticated;

ALTER TABLE public.client_welcome_doc_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_welcome_docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_welcome_doc_itens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "time le templates" ON public.client_welcome_doc_templates;
CREATE POLICY "time le templates" ON public.client_welcome_doc_templates
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "so admin/atendimento edita templates" ON public.client_welcome_doc_templates;
CREATE POLICY "so admin/atendimento edita templates" ON public.client_welcome_doc_templates
  FOR ALL TO authenticated USING (public.pode_editar_welcome_doc()) WITH CHECK (public.pode_editar_welcome_doc());

DROP POLICY IF EXISTS "time le welcome docs" ON public.client_welcome_docs;
CREATE POLICY "time le welcome docs" ON public.client_welcome_docs
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "so admin/atendimento edita welcome docs" ON public.client_welcome_docs;
CREATE POLICY "so admin/atendimento edita welcome docs" ON public.client_welcome_docs
  FOR ALL TO authenticated USING (public.pode_editar_welcome_doc()) WITH CHECK (public.pode_editar_welcome_doc());

DROP POLICY IF EXISTS "time le itens do welcome doc" ON public.client_welcome_doc_itens;
CREATE POLICY "time le itens do welcome doc" ON public.client_welcome_doc_itens
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "so admin/atendimento edita itens do welcome doc" ON public.client_welcome_doc_itens;
CREATE POLICY "so admin/atendimento edita itens do welcome doc" ON public.client_welcome_doc_itens
  FOR ALL TO authenticated USING (public.pode_editar_welcome_doc()) WITH CHECK (public.pode_editar_welcome_doc());

-- anon nunca lê/grava nenhuma das três direto: só pela RPC get_welcome_doc
-- (SECURITY DEFINER, Task 2) e pela edge function (service_role).
GRANT ALL ON public.client_welcome_doc_templates TO authenticated, service_role;
GRANT ALL ON public.client_welcome_docs TO authenticated, service_role;
GRANT ALL ON public.client_welcome_doc_itens TO authenticated, service_role;
GRANT SELECT ON public.client_welcome_doc_progresso TO authenticated, service_role;

-- Conferência (rodar à mão depois de aplicar):
-- SELECT table_name FROM information_schema.tables
--   WHERE table_name IN ('client_welcome_doc_templates','client_welcome_docs','client_welcome_doc_itens');
-- -- deve devolver as 3 linhas.
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'client_boas_vindas_itens' AND column_name = 'welcome_doc_item_id';
-- -- deve devolver 1 linha.
-- SELECT conname FROM pg_constraint WHERE conname = 'client_boas_vindas_itens_item_key_check';
-- -- deve devolver 0 linhas (constraint removida).
```

- [ ] **Step 2: Reler o arquivo inteiro**

Confirmar visualmente: todo `CREATE`/`ALTER` termina com `;`, os nomes de tabela/coluna batem entre a DDL e as policies/GRANTs, e a `DROP CONSTRAINT IF EXISTS` usa o nome real da constraint (conferir contra `supabase/migrations/2026093342_boas_vindas_lumos.sql` — lá a constraint de `item_key` nasce sem nome explícito, então o Postgres gera `client_boas_vindas_itens_item_key_check` por convenção de `tabela_coluna_check`; se ao aplicar a conferência do Step 1 mostrar que a constraint não foi removida, o nome real está em `SELECT conname FROM pg_constraint WHERE conrelid = 'client_boas_vindas_itens'::regclass` — o Caio roda essa consulta e me passa o nome certo se o nome assumido aqui estiver errado).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/2026093344_welcome_doc_schema.sql
git commit -m "feat(portal): schema do Welcome Doc (SQL, não aplicado)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: RPC `get_welcome_doc` — leitura completa pro cliente

**Files:**
- Create: `supabase/migrations/2026093345_get_welcome_doc.sql`

**Interfaces:**
- Consumes: `client_portals`, `clients`, `client_users` (mesmas colunas que `get_boas_vindas_lumos` já usa), `client_welcome_docs`, `client_welcome_doc_templates`, `client_welcome_doc_itens`, `client_boas_vindas_itens` (Task 1).
- Produces: `get_welcome_doc(p_token text) RETURNS jsonb`, formato `{ cliente: { id, nome }, doc: { sections, variables, values } | null, itens: [{ item_key, group_key, titulo, descricao, requer_arquivo, sort_order, feito, nome_arquivo, concluido_em, concluido_por }] }` em sucesso, ou `{ error: 'invalid' | 'precisa_login' | 'sem_acesso' | 'nao_publicado' }`. Task 7 (frontend) consome exatamente este formato.

- [ ] **Step 1: Escrever a migração**

```sql
-- Leitura completa do Welcome Doc pro cliente: seções (com variáveis, pro
-- front interpolar), lista de itens do checklist já cruzada com o status
-- de quem já preencheu. Mesmo padrão de porta que get_boas_vindas_lumos já
-- usa (2026093343).

CREATE OR REPLACE FUNCTION public.get_welcome_doc(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_portal RECORD;
  v_client RECORD;
  v_doc    RECORD;
  v_tpl    RECORD;
  v_email  text;
  v_pessoa_id uuid := NULL;
  v_itens  jsonb;
BEGIN
  SELECT * INTO v_portal FROM client_portals WHERE token = p_token AND active = true;
  IF v_portal IS NULL THEN
    RETURN jsonb_build_object('error', 'invalid');
  END IF;

  SELECT id, name INTO v_client FROM clients WHERE id = v_portal.client_id;
  IF v_client IS NULL THEN
    RETURN jsonb_build_object('error', 'invalid');
  END IF;

  IF v_portal.exige_login THEN
    v_email := lower(COALESCE(auth.jwt() ->> 'email', ''));
    IF v_email = '' THEN
      RETURN jsonb_build_object('error', 'precisa_login');
    END IF;
    SELECT id INTO v_pessoa_id FROM client_users
    WHERE client_id = v_client.id AND lower(email) = v_email AND ativo;
    IF v_pessoa_id IS NULL THEN
      RETURN jsonb_build_object('error', 'sem_acesso');
    END IF;
  END IF;

  SELECT * INTO v_doc FROM client_welcome_docs
  WHERE client_id = v_client.id AND status = 'published';
  IF v_doc IS NULL THEN
    RETURN jsonb_build_object(
      'cliente', jsonb_build_object('id', v_client.id, 'nome', v_client.name),
      'doc', NULL,
      'itens', '[]'::jsonb
    );
  END IF;

  SELECT * INTO v_tpl FROM client_welcome_doc_templates WHERE id = v_doc.template_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'item_key', i.item_key,
    'group_key', i.group_key,
    'titulo', i.titulo,
    'descricao', i.descricao,
    'requer_arquivo', i.requer_arquivo,
    'sort_order', i.sort_order,
    'feito', s.id IS NOT NULL,
    'nome_arquivo', s.nome_arquivo,
    'concluido_em', s.concluido_em,
    'concluido_por', s.concluido_por
  ) ORDER BY i.sort_order), '[]'::jsonb)
  INTO v_itens
  FROM client_welcome_doc_itens i
  LEFT JOIN client_boas_vindas_itens s
    ON s.welcome_doc_item_id = i.id AND s.client_id = v_client.id
  WHERE i.welcome_doc_id = v_doc.id;

  RETURN jsonb_build_object(
    'cliente', jsonb_build_object('id', v_client.id, 'nome', v_client.name),
    'doc', jsonb_build_object(
      'sections', v_tpl.sections,
      'variables', v_tpl.variables,
      'values', v_doc.values
    ),
    'itens', v_itens
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_welcome_doc(text) TO anon, authenticated;

-- Conferência (rodar à mão depois de aplicar, com um doc de teste publicado):
-- SELECT get_welcome_doc('<token-de-um-portal-com-doc-publicado>');
-- -- deve devolver cliente + doc + itens.
-- SELECT get_welcome_doc('<token-de-um-cliente-sem-doc-publicado>');
-- -- deve devolver cliente + doc: null + itens: [].
```

- [ ] **Step 2: Reler o arquivo** — confirmar que os nomes de campo do JSON batem com o que o spec descreve (`doc.sections`, `doc.variables`, `doc.values`, `itens[].feito`), porque a Task 7 vai consumir esses nomes literalmente.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/2026093345_get_welcome_doc.sql
git commit -m "feat(portal): RPC get_welcome_doc (SQL, não aplicado)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Checklist dinâmico — `marcar_item_boas_vindas` e `get_boas_vindas_lumos` deixam de assumir 4 chaves fixas

**Files:**
- Create: `supabase/migrations/2026093346_checklist_dinamico.sql`

**Interfaces:**
- Consumes: `client_welcome_doc_itens` (Task 1).
- Produces: `marcar_item_boas_vindas(p_token, p_item_key, p_nome_pessoa)` e `get_boas_vindas_lumos(p_token)` continuam com a mesma assinatura e o mesmo formato de retorno de antes — só a validação interna de `item_key` muda. Task 4 (edge function) e o frontend (Task 7) não precisam saber que isso mudou; o contrato externo é idêntico.

Hoje `marcar_item_boas_vindas` só aceita `item_key = 'acessos'` (é o único item manual fixo). Com template dinâmico, "manual" deixa de ser uma chave mágica e passa a ser "`requer_arquivo = false` no `client_welcome_doc_itens` do cliente".

- [ ] **Step 1: Escrever a migração**

```sql
-- O checklist deixa de ter 4 chaves fixas — item_key válido é qualquer um
-- que exista em client_welcome_doc_itens do doc publicado daquele cliente.
-- "Item manual" (sem arquivo) passa a ser requer_arquivo = false, em vez
-- de comparar contra a string 'acessos'.

CREATE OR REPLACE FUNCTION public.marcar_item_boas_vindas(
  p_token text, p_item_key text, p_nome_pessoa text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_portal RECORD;
  v_client_name text;
  v_email text;
  v_pessoa_id    uuid := NULL;
  v_pessoa_nome  text := NULL;
  v_pessoa_email text := NULL;
  v_concluido_por text;
  v_item RECORD;
BEGIN
  SELECT * INTO v_portal FROM client_portals WHERE token = p_token AND active = true;
  IF v_portal IS NULL THEN
    RETURN jsonb_build_object('error', 'invalid');
  END IF;

  SELECT name INTO v_client_name FROM clients WHERE id = v_portal.client_id;

  SELECT i.* INTO v_item
  FROM client_welcome_doc_itens i
  JOIN client_welcome_docs d ON d.id = i.welcome_doc_id
  WHERE d.client_id = v_portal.client_id AND d.status = 'published' AND i.item_key = p_item_key;

  IF v_item IS NULL THEN
    RETURN jsonb_build_object('error', 'item_invalido');
  END IF;
  IF v_item.requer_arquivo THEN
    RETURN jsonb_build_object('error', 'item_precisa_de_arquivo');
  END IF;

  IF v_portal.exige_login THEN
    v_email := lower(COALESCE(auth.jwt() ->> 'email', ''));
    IF v_email = '' THEN
      RETURN jsonb_build_object('error', 'precisa_login',
                                'cliente', jsonb_build_object('nome', v_client_name));
    END IF;
    SELECT id, nome, email INTO v_pessoa_id, v_pessoa_nome, v_pessoa_email
    FROM client_users
    WHERE client_id = v_portal.client_id AND lower(email) = v_email AND ativo;
    IF v_pessoa_id IS NULL THEN
      RETURN jsonb_build_object('error', 'sem_acesso',
                                'cliente', jsonb_build_object('nome', v_client_name));
    END IF;
    v_concluido_por := COALESCE(v_pessoa_nome, split_part(v_pessoa_email, '@', 1));
  ELSE
    v_concluido_por := NULLIF(trim(p_nome_pessoa), '');
  END IF;

  INSERT INTO client_boas_vindas_itens (client_id, item_key, tipo, concluido_por, concluido_em, welcome_doc_item_id)
  VALUES (v_portal.client_id, p_item_key, 'manual', v_concluido_por, now(), v_item.id)
  ON CONFLICT (client_id, item_key)
  DO UPDATE SET concluido_por = EXCLUDED.concluido_por, concluido_em = now(), welcome_doc_item_id = EXCLUDED.welcome_doc_item_id;

  BEGIN
    INSERT INTO notifications (user_id, event_type, category, priority, title, body, link, scope)
    SELECT a.id, 'boas_vindas_item_enviado', 'producao', 'normal',
      'Bem-vindo à Lumos: novo item concluído',
      v_client_name || ' marcou "' || v_item.titulo || '" como concluído.',
      '/clientes/' || v_portal.client_id::text,
      'team'
    FROM app_users a
    WHERE a.status = 'ativo'
      AND (a.role IN ('admin', 'atendimento') OR a.id = ANY(v_portal.contact_user_ids));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'marcar_item_boas_vindas: notificação falhou: %', SQLERRM;
  END;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.marcar_item_boas_vindas(text, text, text) TO anon, authenticated;

-- Conferência (rodar à mão depois de aplicar):
-- SELECT marcar_item_boas_vindas('token-invalido', 'qualquer', 'x');
-- -- deve devolver {"error": "invalid"}.
```

`get_boas_vindas_lumos` **não muda nesta tarefa** — ele já lê de `client_boas_vindas_itens` sem depender de uma lista fixa de chaves (confirmar lendo `supabase/migrations/2026093343_boas_vindas_exige_login.sql`; se por algum motivo ele tiver uma checagem de chave fixa que passou despercebido, adicionar a correção aqui e documentar no relatório da tarefa — mas pela leitura do código atual, ele só agrega o que existir na tabela, então já é compatível).

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/2026093346_checklist_dinamico.sql
git commit -m "feat(portal): checklist deixa de ter 4 chaves fixas (SQL, não aplicado)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Edge function `boas-vindas-upload` — pasta do Drive vira genérica, não mais um mapa fixo

**Files:**
- Modify: `supabase/functions/boas-vindas-upload/index.ts`

**Interfaces:**
- Consumes: `client_welcome_doc_itens`, `client_welcome_docs` (Task 1).
- Produces: mesmo contrato HTTP de sempre (`POST` multipart `token`/`item_key`/`nome_pessoa`/`arquivo`, resposta `{ok, drive_file_id, nome_arquivo}` ou `{error}`). Task 7 não muda nada do lado do frontend por causa desta tarefa.

Hoje a função rejeita qualquer `item_key` fora de `{logo, brand_book, guidelines}` via um mapa fixo `SUBPASTA`. Com template dinâmico, o `item_key` válido é o que existir em `client_welcome_doc_itens` do doc publicado daquele cliente, com `requer_arquivo = true` — e o nome da subpasta no Drive passa a vir do próprio `item_key` (maiúsculo, sem acento), não de um mapa fixo.

- [ ] **Step 1: Ler o arquivo atual completo**

Ler `supabase/functions/boas-vindas-upload/index.ts` (já tem ~347 linhas, com o `SUBPASTA` map perto do topo e a validação `if (!SUBPASTA[itemKey]) return json({ error: 'item_key inválido' }, 400)` dentro do handler).

- [ ] **Step 2: Substituir o mapa fixo por uma consulta ao banco**

Remover a constante:
```ts
const SUBPASTA: Record<string, string> = {
  logo: 'LOGOS',
  brand_book: 'BRAND-BOOK',
  guidelines: 'GUIDELINES',
}
```

Adicionar, perto das outras funções auxiliares (antes do handler `serve(...)`):
```ts
// Nome da subpasta no Drive a partir do item_key: maiúsculo, sem acento,
// espaço vira hífen — mesma normalização que drive-provision usa pra nome
// de pasta de projeto (slugify), só que aqui aplicada ao item_key.
function nomeSubpasta(itemKey: string): string {
  return itemKey
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'ARQUIVOS'
}

// Busca o item no doc publicado do cliente — item_key inválido, item que
// não existe, ou item que não precisa de arquivo (é do tipo "marcar
// manualmente", tratado pela RPC marcar_item_boas_vindas, não por aqui)
// todos voltam null, e o handler responde 400.
async function buscarItemUpload(clientId: string, itemKey: string): Promise<{ id: string; group_key: string; titulo: string } | null> {
  const { data: doc } = await db.from('client_welcome_docs')
    .select('id').eq('client_id', clientId).eq('status', 'published').maybeSingle()
  if (!doc) return null
  const { data: item } = await db.from('client_welcome_doc_itens')
    .select('id, group_key, titulo, requer_arquivo').eq('welcome_doc_id', doc.id).eq('item_key', itemKey).maybeSingle()
  if (!item || !item.requer_arquivo) return null
  return { id: item.id, group_key: item.group_key, titulo: item.titulo }
}
```

No handler `serve(async (req) => { ... })`, substituir o trecho que hoje é:
```ts
  if (!SUBPASTA[itemKey]) return json({ error: 'item_key inválido' }, 400)
```
e, mais abaixo, onde a subpasta é resolvida (algo como `const subfolderId = await ensureFolder(assetsId, SUBPASTA[itemKey])`), pelo fluxo:
```ts
  // (a checagem de tamanho e a leitura do form continuam exatamente como
  // estão — só a resolução do item_key muda)

  const { data: portal } = await db.from('client_portals')
    .select('client_id, exige_login').eq('token', token).eq('active', true).maybeSingle()
  if (!portal) return json({ error: 'token inválido' }, 401)

  const item = await buscarItemUpload(portal.client_id, itemKey)
  if (!item) return json({ error: 'item_key inválido' }, 400)
```
e, na hora de criar/garantir a subpasta:
```ts
  const subfolderId = await ensureFolder(assetsId, nomeSubpasta(itemKey))
```

Manter tudo o mais como está (a checagem de `exige_login`/`db.auth.getUser(jwt)` feita na rodada anterior, o teto de 25MB, o `ensureClientAssetsFolder` com o mirror de template, a notificação isolada em `try/catch`) — esta tarefa troca só a fonte da validação de `item_key` e o nome da subpasta, nada mais. Ao gravar o upsert em `client_boas_vindas_itens`, incluir `welcome_doc_item_id: item.id` no objeto (coluna nova da Task 1).

- [ ] **Step 3: Checar tipos**

Run: `cd /Users/caiorizzuttl/comercial-lumos && npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 4: Deploy**

```bash
eval "$(/opt/homebrew/bin/brew shellenv zsh)"
cd /Users/caiorizzuttl/comercial-lumos
supabase functions deploy boas-vindas-upload --no-verify-jwt --project-ref byntpekyfhzwfihjhzuo
```

- [ ] **Step 5: Verificar com curl (token inválido, comportamento não deve ter mudado)**

```bash
curl -s -X POST "https://byntpekyfhzwfihjhzuo.supabase.co/functions/v1/boas-vindas-upload" \
  -F "token=token-que-nao-existe" -F "item_key=logo" -F "nome_pessoa=Teste" \
  -F "arquivo=@/dev/null;type=image/png"
```

Expected: ainda `{"error":"token inválido"}` em 401 — a migração desta tarefa ainda não foi aplicada em produção (Task 1-3 não aplicadas), então não é possível testar um upload de sucesso agora; isso é coberto na Task 9.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/boas-vindas-upload/index.ts
git commit -m "feat(portal): item_key do upload vira dinâmico, não mais mapa fixo

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: `interpolate.ts` — a única função pura do projeto, com teste de verdade

**Files:**
- Create: `src/pages/welcome-doc/interpolate.ts`
- Test: `src/pages/welcome-doc/interpolate.test.ts`

**Interfaces:**
- Produces: `interface VariavelDef { key: string; label: string; type: string; required: boolean; group: string }`; `function interpolarSecoes<T>(sections: T, valores: Record<string, string>, variaveis: VariavelDef[]): T`. Task 7 (`WelcomeDocPage.tsx`) importa e usa exatamente esta função e este tipo.

- [ ] **Step 1: Escrever o teste primeiro**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpolarSecoes, type VariavelDef } from './interpolate.ts';

const OBRIGATORIA: VariavelDef = { key: 'CLIENTE', label: 'Cliente', type: 'text', required: true, group: 'geral' };
const OPCIONAL: VariavelDef = { key: 'ATENDIMENTO', label: 'Atendimento', type: 'text', required: false, group: 'geral' };

test('substitui variável obrigatória preenchida', () => {
  const out = interpolarSecoes([{ body: 'Olá {{CLIENTE}}' }], { CLIENTE: 'Vitru' }, [OBRIGATORIA]);
  assert.deepEqual(out, [{ body: 'Olá Vitru' }]);
});

test('variável opcional vazia colapsa o campo inteiro, não deixa frase pela metade', () => {
  const out = interpolarSecoes([{ footnote: 'Fale com {{ATENDIMENTO}} direto.' }], {}, [OPCIONAL]);
  assert.deepEqual(out, [{ footnote: '' }]);
});

test('nunca deixa {{VAR}} de opcional vazia visível dentro de outro texto', () => {
  const out = interpolarSecoes([{ body: 'Prazo combinado: {{ATENDIMENTO}}' }], {}, [OPCIONAL]);
  assert.ok(!(out[0] as { body: string }).body.includes('{{'));
});

test('interpola recursivamente dentro de arrays e objetos aninhados', () => {
  const out = interpolarSecoes(
    [{ rows: [{ name: '{{CLIENTE}}', role: 'Cliente' }] }],
    { CLIENTE: 'Vitru' },
    [OBRIGATORIA]
  );
  assert.deepEqual(out, [{ rows: [{ name: 'Vitru', role: 'Cliente' }] }]);
});

test('obrigatória vazia mantém o token visível em vez de esconder (nunca deveria acontecer — publicar bloqueia isso antes)', () => {
  const out = interpolarSecoes([{ body: '{{CLIENTE}}' }], {}, [OBRIGATORIA]);
  assert.deepEqual(out, [{ body: '{{CLIENTE}}' }]);
});

test('valores fora de string (number, boolean, null) atravessam sem alteração', () => {
  const out = interpolarSecoes([{ requer_arquivo: true, sort_order: 3, nota: null }], {}, []);
  assert.deepEqual(out, [{ requer_arquivo: true, sort_order: 3, nota: null }]);
});
```

- [ ] **Step 2: Rodar e confirmar que falha (o arquivo `interpolate.ts` ainda não existe)**

Run: `node --test src/pages/welcome-doc/interpolate.test.ts`
Expected: falha com erro de módulo não encontrado (`Cannot find module './interpolate.ts'` ou equivalente) — confirma que o teste realmente exercita o código que ainda não existe.

- [ ] **Step 3: Escrever a implementação**

```ts
export interface VariavelDef {
  key: string;
  label: string;
  type: string;
  required: boolean;
  group: string;
}

const VAR_RE = /\{\{(\w+)\}\}/g;

/** Interpola {{CHAVE}} em todo campo string de `secoes`, recursivamente
 *  (arrays e objetos aninhados incluídos). Variável obrigatória vazia
 *  mantém o token visível — nunca deveria acontecer de verdade, porque
 *  publicar já bloqueia isso antes, mas não esconde silenciosamente se
 *  acontecer. Variável opcional vazia colapsa o CAMPO inteiro (a string
 *  inteira vira ''), pra nunca sobrar frase pela metade na tela. */
export function interpolarSecoes<T>(secoes: T, valores: Record<string, string>, variaveis: VariavelDef[]): T {
  const obrigatorias = new Set(variaveis.filter(v => v.required).map(v => v.key));
  return interpolarValor(secoes, valores, obrigatorias) as T;
}

function interpolarValor(valor: unknown, valores: Record<string, string>, obrigatorias: Set<string>): unknown {
  if (typeof valor === 'string') return interpolarTexto(valor, valores, obrigatorias);
  if (Array.isArray(valor)) return valor.map(v => interpolarValor(v, valores, obrigatorias));
  if (valor && typeof valor === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor)) out[k] = interpolarValor(v, valores, obrigatorias);
    return out;
  }
  return valor;
}

function interpolarTexto(texto: string, valores: Record<string, string>, obrigatorias: Set<string>): string {
  let temOpcionalVazia = false;
  const resultado = texto.replace(VAR_RE, (match, chave: string) => {
    const valor = valores[chave];
    if (valor) return valor;
    if (obrigatorias.has(chave)) return match;
    temOpcionalVazia = true;
    return '';
  });
  return temOpcionalVazia ? '' : resultado;
}
```

- [ ] **Step 4: Rodar de novo e confirmar que passa**

Run: `node --test src/pages/welcome-doc/interpolate.test.ts`
Expected: `# pass 6`, `# fail 0`. Se o Node desta máquina reclamar de sintaxe TypeScript, rodar com `node --experimental-strip-types --test src/pages/welcome-doc/interpolate.test.ts` em vez disso (Node 26 já tem type-stripping nativo; a flag só é necessária se a versão exata não tiver isso habilitado por padrão).

- [ ] **Step 5: Checar tipos do projeto inteiro**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 6: Commit**

```bash
git add src/pages/welcome-doc/interpolate.ts src/pages/welcome-doc/interpolate.test.ts
git commit -m "feat(portal): interpolate.ts, com teste automatizado de verdade

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Os 8 componentes de seção + barra de progresso

**Files:**
- Create: `src/pages/welcome-doc/tipos.ts`
- Create: `src/pages/welcome-doc/sections/LeadSection.tsx`
- Create: `src/pages/welcome-doc/sections/RowsSection.tsx`
- Create: `src/pages/welcome-doc/sections/TwoPanelsSection.tsx`
- Create: `src/pages/welcome-doc/sections/StepsSection.tsx`
- Create: `src/pages/welcome-doc/sections/NoteSection.tsx`
- Create: `src/pages/welcome-doc/sections/TipsSection.tsx`
- Create: `src/pages/welcome-doc/sections/DateCardsSection.tsx`
- Create: `src/pages/welcome-doc/sections/NextStepsSection.tsx`
- Create: `src/pages/welcome-doc/ProgressBar.tsx`
- Modify: `src/pages/portalCliente.css.ts` (novas classes, ao fim do arquivo)

**Interfaces:**
- Consumes: nada de tarefas anteriores — são componentes presentacionais puros, recebem os dados já interpolados via props.
- Produces: os 9 componentes abaixo, com export default cada. Task 7 importa e monta o dispatch de `type` → componente.

Cada seção já chega **interpolada** (Task 7 interpola antes de passar como prop) — nenhum componente aqui sabe o que é `{{VAR}}`.

- [ ] **Step 1: Escrever os tipos compartilhados**

```ts
// src/pages/welcome-doc/tipos.ts
export type TipoSecao =
  | 'lead' | 'rows' | 'two-panels' | 'steps' | 'checklist'
  | 'note' | 'tips' | 'date-cards' | 'next-steps';

interface SecaoBase { key: string; type: TipoSecao }

export interface LeadSecao extends SecaoBase { type: 'lead'; body: string }

export interface RowsSecao extends SecaoBase {
  type: 'rows'; kicker: string; title: string; titleAccent?: string;
  rows: { name: string; role: string; when: string; pill?: string; pillStyle?: 'accent' | 'ghost' | 'green' }[];
  footnote?: string;
}

// esquerda é sempre o lado "incluído" (marcador cheio); direita é sempre o
// lado "fora do combinado" (marcador ×, texto apagado) — mesma convenção
// visual do mockup, fixada no componente em vez de virar mais uma opção.
export interface TwoPanelsSecao extends SecaoBase {
  type: 'two-panels'; kicker: string; title: string; titleAccent?: string;
  esquerda: { titulo: string; sub: string; itens: string[] };
  direita: { titulo: string; sub: string; itens: string[] };
}

export interface StepsSecao extends SecaoBase {
  type: 'steps'; kicker: string; title: string; titleAccent?: string; lead?: string;
  passos: { numero: string; texto: string; quemFaz: string; quando: string; suaVez?: boolean }[];
}

export interface ChecklistSecao extends SecaoBase { type: 'checklist' }

// `body` pode ter parágrafos separados por linha em branco (\n\n) — cada um
// vira um <p>. Nunca HTML: sem negrito nem link dentro do texto, por
// desenho (o spec proíbe render de HTML vindo do JSON).
export interface NoteSecao extends SecaoBase { type: 'note'; kicker: string; label: string; body: string }

export interface TipsSecao extends SecaoBase {
  type: 'tips'; kicker: string; title: string; titleAccent?: string;
  dicas: { titulo: string; texto: string }[];
}

export interface DateCardsSecao extends SecaoBase {
  type: 'date-cards'; kicker: string; title: string; titleAccent?: string;
  cards: { data: string; titulo: string; nota?: string; destaque?: boolean }[];
}

export interface NextStepsSecao extends SecaoBase {
  type: 'next-steps'; kicker: string; title: string; titleAccent?: string;
  passos: { numero: string; texto: string; nota?: string; quando: string }[];
}

export type Secao =
  | LeadSecao | RowsSecao | TwoPanelsSecao | StepsSecao | ChecklistSecao
  | NoteSecao | TipsSecao | DateCardsSecao | NextStepsSecao;
```

- [ ] **Step 2: Escrever os 8 componentes de seção**

```tsx
// src/pages/welcome-doc/sections/LeadSection.tsx
import type { LeadSecao } from '../tipos';
export default function LeadSection({ body }: LeadSecao) {
  if (!body) return null;
  return <p className="wd-lead">{body}</p>;
}
```

```tsx
// src/pages/welcome-doc/sections/RowsSection.tsx
import type { RowsSecao } from '../tipos';
export default function RowsSection({ kicker, title, titleAccent, rows, footnote }: RowsSecao) {
  return (
    <section className="wd-secao">
      <span className="wd-kicker">{kicker}</span>
      <h2 className="wd-titulo">{title} {titleAccent && <span className="wd-destaque">{titleAccent}</span>}</h2>
      <div className="wd-rows">
        {rows.map((r, i) => (
          <div className="wd-row" key={i}>
            <div className="wd-row-nome">{r.name}</div>
            <div className="wd-row-papel">{r.role}</div>
            <div className="wd-row-quando">{r.when}</div>
            {r.pill && <span className={`wd-pill wd-pill-${r.pillStyle ?? 'ghost'}`}>{r.pill}</span>}
          </div>
        ))}
      </div>
      {footnote && <p className="wd-footnote">{footnote}</p>}
    </section>
  );
}
```

```tsx
// src/pages/welcome-doc/sections/TwoPanelsSection.tsx
import type { TwoPanelsSecao } from '../tipos';
export default function TwoPanelsSection({ kicker, title, titleAccent, esquerda, direita }: TwoPanelsSecao) {
  return (
    <section className="wd-secao">
      <span className="wd-kicker">{kicker}</span>
      <h2 className="wd-titulo">{title} {titleAccent && <span className="wd-destaque">{titleAccent}</span>}</h2>
      <div className="wd-two-panels">
        <div className="wd-panel">
          <h3>{esquerda.titulo}</h3>
          <p className="wd-panel-sub">{esquerda.sub}</p>
          <ul>{esquerda.itens.map((it, i) => <li key={i}>{it}</li>)}</ul>
        </div>
        <div className="wd-panel wd-panel-fora">
          <h3>{direita.titulo}</h3>
          <p className="wd-panel-sub">{direita.sub}</p>
          <ul>{direita.itens.map((it, i) => <li key={i}>{it}</li>)}</ul>
        </div>
      </div>
    </section>
  );
}
```

```tsx
// src/pages/welcome-doc/sections/StepsSection.tsx
import type { StepsSecao } from '../tipos';
export default function StepsSection({ kicker, title, titleAccent, lead, passos }: StepsSecao) {
  return (
    <section className="wd-secao">
      <span className="wd-kicker">{kicker}</span>
      <h2 className="wd-titulo">{title} {titleAccent && <span className="wd-destaque">{titleAccent}</span>}</h2>
      {lead && <p className="wd-secao-lead">{lead}</p>}
      <ol className="wd-steps">
        {passos.map((p, i) => (
          <li className={p.suaVez ? 'wd-step wd-step-sua-vez' : 'wd-step'} key={i}>
            <span className="wd-step-numero">{p.numero}</span>
            <span className="wd-step-texto">{p.texto}</span>
            <span className="wd-step-quem">{p.quemFaz}</span>
            <span className="wd-step-quando">{p.quando}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
```

```tsx
// src/pages/welcome-doc/sections/NoteSection.tsx
import type { NoteSecao } from '../tipos';
export default function NoteSection({ kicker, label, body }: NoteSecao) {
  if (!body) return null;
  const paragrafos = body.split('\n\n').filter(Boolean);
  return (
    <section className="wd-secao">
      <span className="wd-kicker">{kicker}</span>
      <div className="wd-note">
        {label && <span className="wd-note-label">{label}</span>}
        {paragrafos.map((p, i) => <p key={i}>{p}</p>)}
      </div>
    </section>
  );
}
```

```tsx
// src/pages/welcome-doc/sections/TipsSection.tsx
import type { TipsSecao } from '../tipos';
export default function TipsSection({ kicker, title, titleAccent, dicas }: TipsSecao) {
  return (
    <section className="wd-secao">
      <span className="wd-kicker">{kicker}</span>
      <h2 className="wd-titulo">{title} {titleAccent && <span className="wd-destaque">{titleAccent}</span>}</h2>
      <div className="wd-tips">
        {dicas.map((d, i) => d.titulo && (
          <div className="wd-tip" key={i}>
            <div className="wd-tip-numero">{String(i + 1).padStart(2, '0')}</div>
            <h4>{d.titulo}</h4>
            <p>{d.texto}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
```

```tsx
// src/pages/welcome-doc/sections/DateCardsSection.tsx
import type { DateCardsSecao } from '../tipos';
export default function DateCardsSection({ kicker, title, titleAccent, cards }: DateCardsSecao) {
  return (
    <section className="wd-secao">
      <span className="wd-kicker">{kicker}</span>
      <h2 className="wd-titulo">{title} {titleAccent && <span className="wd-destaque">{titleAccent}</span>}</h2>
      <div className="wd-date-cards">
        {cards.map((c, i) => c.titulo && (
          <div className={c.destaque ? 'wd-date-card wd-date-card-destaque' : 'wd-date-card'} key={i}>
            <div className="wd-date-data">{c.data}</div>
            <div className="wd-date-titulo">{c.titulo}</div>
            {c.nota && <div className="wd-date-nota">{c.nota}</div>}
          </div>
        ))}
      </div>
    </section>
  );
}
```

```tsx
// src/pages/welcome-doc/sections/NextStepsSection.tsx
import type { NextStepsSecao } from '../tipos';
export default function NextStepsSection({ kicker, title, titleAccent, passos }: NextStepsSecao) {
  return (
    <section className="wd-secao">
      <span className="wd-kicker">{kicker}</span>
      <h2 className="wd-titulo">{title} {titleAccent && <span className="wd-destaque">{titleAccent}</span>}</h2>
      <div className="wd-next-steps">
        {passos.map((p, i) => p.texto && (
          <div className="wd-next-step" key={i}>
            <span className="wd-next-numero">{p.numero}</span>
            <span className="wd-next-corpo">
              {p.texto}
              {p.nota && <small>{p.nota}</small>}
            </span>
            <span className="wd-next-quando">{p.quando}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Escrever a barra de progresso**

```tsx
// src/pages/welcome-doc/ProgressBar.tsx
export default function ProgressBar({ feitos, total }: { feitos: number; total: number }) {
  if (!total) return null;
  const pct = Math.round((feitos / total) * 100);
  return (
    <div className="wd-progresso" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <span className="wd-progresso-legenda">Seu onboarding</span>
      <div className="wd-progresso-trilha">
        <div className="wd-progresso-luz" style={{ width: `${pct}%` }} />
      </div>
      <span className="wd-progresso-contagem"><b>{feitos}</b> de {total} itens</span>
    </div>
  );
}
```

- [ ] **Step 4: Adicionar as classes CSS**

No fim de `PORTAL_CSS` em `src/pages/portalCliente.css.ts` (antes do fechamento da template string, depois do bloco `.hero-bv`/`.item-bv` já existente):

```css
  /* ── Welcome Doc: seções de conteúdo ao redor do checklist ────── */
  .wd-lead { color: var(--meia-luz); max-width: 60ch; font-size: 15px; }
  .wd-secao { padding: 38px 0; border-top: 1px solid var(--fio); }
  .wd-secao:first-child { border-top: none; padding-top: 0; }
  .wd-kicker {
    display: block; font-family: "DM Mono", monospace; text-transform: uppercase;
    letter-spacing: .16em; font-size: 11px; color: var(--meia-luz); margin-bottom: 10px;
  }
  .wd-titulo {
    font-family: "Anton", Impact, sans-serif; font-weight: 400; text-transform: uppercase;
    font-size: clamp(22px, 3vw, 32px); line-height: 1; margin: 0 0 20px;
  }
  .wd-destaque { color: var(--luz); }
  .wd-footnote { color: var(--meia-luz); font-size: 13px; margin-top: 14px; max-width: 60ch; }

  .wd-rows { display: grid; gap: 12px; }
  .wd-row {
    display: grid; grid-template-columns: 1fr auto auto; gap: 8px 16px; align-items: center;
    padding: 14px 16px; border: 1px solid var(--fio); border-radius: 8px; background: var(--mesa);
  }
  .wd-row-nome { font-weight: 600; }
  .wd-row-papel, .wd-row-quando { color: var(--meia-luz); font-size: 13px; }
  .wd-pill { font-family: "DM Mono", monospace; font-size: 10px; text-transform: uppercase; letter-spacing: .1em; padding: 4px 10px; border-radius: 999px; border: 1px solid var(--fio); white-space: nowrap; }
  .wd-pill-accent { background: rgba(239,199,0,.10); color: var(--luz); border-color: rgba(239,199,0,.3); }
  .wd-pill-ghost { background: transparent; color: var(--meia-luz); border-color: var(--fio); }
  .wd-pill-green { background: rgba(116,201,138,.10); color: var(--aprovado); border-color: rgba(116,201,138,.3); }

  .wd-two-panels { display: grid; gap: 20px; grid-template-columns: 1fr; }
  @media (min-width: 720px) { .wd-two-panels { grid-template-columns: 1fr 1fr; } }
  .wd-panel { padding: 18px 20px; border: 1px solid var(--fio); border-radius: 10px; background: var(--mesa); }
  .wd-panel h3 { margin: 0 0 4px; font-family: "Anton", Impact, sans-serif; font-weight: 400; text-transform: uppercase; font-size: 17px; }
  .wd-panel-sub { margin: 0 0 14px; font-family: "DM Mono", monospace; font-size: 10px; text-transform: uppercase; letter-spacing: .1em; color: var(--meia-luz); }
  .wd-panel ul { margin: 0; padding-left: 18px; color: var(--gesso); font-size: 14px; }
  .wd-panel li { margin-bottom: 6px; }
  .wd-panel-fora ul { color: var(--meia-luz); }
  .wd-panel-fora li::marker { content: "× "; }

  .wd-secao-lead { color: var(--meia-luz); max-width: 60ch; font-size: 14px; margin: -8px 0 20px; }

  .wd-steps { display: grid; gap: 2px; border-top: 1px solid var(--fio); }
  .wd-step { display: flex; align-items: center; gap: 18px; padding: 13px 4px; border-bottom: 1px solid var(--fio); }
  .wd-step-numero { font-family: "DM Mono", monospace; font-size: 12px; color: var(--meia-luz); width: 22px; }
  .wd-step-texto { flex: 1; font-size: 14px; }
  .wd-step-quem { font-family: "DM Mono", monospace; font-size: 11px; text-transform: uppercase; letter-spacing: .1em; color: var(--meia-luz); width: 150px; }
  .wd-step-quando { font-family: "DM Mono", monospace; font-size: 11px; color: var(--meia-luz); width: 110px; text-align: right; }
  .wd-step-sua-vez { background: rgba(239,199,0,.035); }
  .wd-step-sua-vez .wd-step-texto { font-weight: 600; }
  .wd-step-sua-vez .wd-step-numero { color: var(--luz); }
  @media (max-width: 720px) { .wd-step-quem, .wd-step-quando { display: none; } }

  .wd-note { background: var(--mesa); border: 1px solid var(--fio); border-left: 2px solid var(--luz); border-radius: 10px; padding: 20px 22px; }
  .wd-note-label { display: block; font-family: "DM Mono", monospace; font-size: 11px; text-transform: uppercase; letter-spacing: .1em; color: var(--meia-luz); margin-bottom: 10px; }
  .wd-note p { margin: 0 0 12px; color: var(--gesso); font-size: 14px; max-width: 62ch; }
  .wd-note p:last-child { margin-bottom: 0; }

  .wd-tips { display: grid; gap: 16px; grid-template-columns: 1fr; }
  @media (min-width: 720px) { .wd-tips { grid-template-columns: repeat(3, 1fr); } }
  .wd-tip { background: var(--mesa); border: 1px solid var(--fio); border-radius: 10px; padding: 20px 22px; }
  .wd-tip-numero { font-family: "Anton", Impact, sans-serif; font-size: 26px; color: var(--luz); line-height: 1; }
  .wd-tip h4 { margin: 10px 0 6px; font-size: 14px; }
  .wd-tip p { margin: 0; color: var(--meia-luz); font-size: 13px; }

  .wd-date-cards { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
  .wd-date-card { padding: 16px 18px; border: 1px solid var(--fio); border-radius: 8px; background: var(--mesa); }
  .wd-date-card-destaque { border-color: rgba(239,199,0,.4); background: rgba(239,199,0,.05); }
  .wd-date-data { font-family: "DM Mono", monospace; font-size: 11px; color: var(--luz); letter-spacing: .08em; }
  .wd-date-titulo { font-weight: 600; font-size: 14px; margin-top: 5px; }
  .wd-date-nota { font-family: "DM Mono", monospace; font-size: 10px; color: var(--meia-luz); margin-top: 4px; }

  .wd-next-steps { display: grid; gap: 2px; border-top: 1px solid var(--fio); }
  .wd-next-step { display: flex; gap: 18px; align-items: baseline; padding: 15px 4px; border-bottom: 1px solid var(--fio); }
  .wd-next-numero { font-family: "Anton", Impact, sans-serif; font-size: 20px; color: var(--luz); width: 30px; flex-shrink: 0; }
  .wd-next-corpo { flex: 1; font-size: 14px; }
  .wd-next-corpo small { display: block; color: var(--meia-luz); font-size: 12px; margin-top: 2px; }
  .wd-next-quando { font-family: "DM Mono", monospace; font-size: 11px; color: var(--meia-luz); white-space: nowrap; }
  @media (max-width: 720px) { .wd-next-quando { display: none; } }

  .wd-progresso {
    display: flex; align-items: center; gap: 16px; padding: 16px 20px; margin-bottom: 34px;
    background: var(--mesa); border: 1px solid var(--fio); border-radius: 10px;
  }
  .wd-progresso-legenda { font-family: "DM Mono", monospace; font-size: 11px; text-transform: uppercase; letter-spacing: .1em; color: var(--meia-luz); white-space: nowrap; }
  .wd-progresso-trilha { flex: 1; height: 4px; border-radius: 999px; background: var(--fio); overflow: hidden; min-width: 60px; }
  .wd-progresso-luz { height: 100%; background: var(--luz); transition: width .3s ease; }
  .wd-progresso-contagem { font-family: "DM Mono", monospace; font-size: 12px; color: var(--gesso); white-space: nowrap; }
  .wd-progresso-contagem b { color: var(--luz); }
```

- [ ] **Step 5: Checar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 6: Commit**

```bash
git add src/pages/welcome-doc/tipos.ts src/pages/welcome-doc/sections src/pages/welcome-doc/ProgressBar.tsx src/pages/portalCliente.css.ts
git commit -m "feat(portal): os 8 tipos de seção do Welcome Doc + barra de progresso

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: `WelcomeDocPage` — orquestra tudo, e o checklist de hoje vira uma seção

**Files:**
- Create: `src/pages/welcome-doc/WelcomeDocPage.tsx`
- Modify: `src/pages/BoasVindasLumos.tsx`
- Modify: `src/pages/PortalCliente.tsx:5,1667-1674` (import e render block, ver Task 4 do plano anterior — os números de linha podem ter mudado, usar como ponto de partida e confirmar contra o arquivo real)

**Interfaces:**
- Consumes: `get_welcome_doc` (Task 2), `interpolarSecoes`/`VariavelDef` (Task 5), `Secao`/`TipoSecao` e os 8 componentes de seção + `ProgressBar` (Task 6).
- Produces: `WelcomeDocPage`, props `{ token: string; nomePessoa: string }` — mesma assinatura que `BoasVindasLumos` já tinha, então a troca em `PortalCliente.tsx` é só o nome do componente importado.

`BoasVindasLumos.tsx` (o checklist de hoje) para de buscar dados sozinho
(não chama mais `get_boas_vindas_lumos` direto) e passa a **receber os
itens prontos por prop**, já que `WelcomeDocPage` busca tudo de uma vez via
`get_welcome_doc`. O fluxo de upload/marcar continua exatamente como está,
só a origem da lista de itens muda.

- [ ] **Step 1: Adaptar `BoasVindasLumos.tsx` pra receber itens por prop**

Ler o arquivo atual inteiro primeiro. Trocar a assinatura e remover a busca própria:

```tsx
// Antes: export default function BoasVindasLumos({ token, nomePessoa }: { token: string; nomePessoa: string }) {
// Depois:
type ItemDoWelcomeDoc = {
  item_key: string; group_key: string; titulo: string; descricao: string | null;
  requer_arquivo: boolean; feito: boolean; nome_arquivo: string | null;
  concluido_em: string | null; concluido_por: string | null;
};

export default function BoasVindasLumos({
  token, nomePessoa, itens: itensIniciais, aoAtualizar,
}: {
  token: string; nomePessoa: string; itens: ItemDoWelcomeDoc[]; aoAtualizar: () => void;
}) {
```

Remover o `useState<Record<string, ItemStatus>>({})`, o `carregando`, o `useEffect(() => { carregar(); }, [carregar])` e a função `carregar` inteira (a busca agora é responsabilidade de `WelcomeDocPage`). No lugar, usar `itensIniciais` diretamente pra montar o mapa de status:

```tsx
  const itens: Record<string, ItemStatus> = {};
  for (const it of itensIniciais) {
    if (it.feito) {
      itens[it.item_key] = {
        item_key: it.item_key as ItemKey, tipo: it.requer_arquivo ? 'arquivo' : 'manual',
        nome_arquivo: it.nome_arquivo, concluido_em: it.concluido_em, concluido_por: it.concluido_por,
      };
    }
  }
```

Trocar toda chamada a `carregar()` (dentro de `enviarArquivo` e `marcarManual`, nos blocos `try`) por `aoAtualizar()` — quem decide como buscar de novo é `WelcomeDocPage`, não este componente. Remover a constante `ITENS` fixa (`{ key: 'logo', ... }` etc.) e o `import { useEffect, useState, useCallback, useRef }` vira `import { useState, useCallback, useRef }` (sem `useEffect`, sem o array fixo). No JSX, trocar `ITENS.map(def => ...)` por `itensIniciais.map(def => ...)`, ajustando os nomes de campo (`def.nome` → `def.titulo`, `def.desc` → `def.descricao`, `def.tipo === 'arquivo'` → `def.requer_arquivo`) e removendo o hero/intro/parágrafo fixo daqui (isso agora vem das seções `lead`/`rows`/etc. de `WelcomeDocPage`, não deste componente — `BoasVindasLumos` volta a ser só a lista de itens, do jeito que era antes do hero ter sido colado nele há pouco).

- [ ] **Step 2: Escrever `WelcomeDocPage.tsx`**

```tsx
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { interpolarSecoes, type VariavelDef } from './interpolate';
import type { Secao } from './tipos';
import LeadSection from './sections/LeadSection';
import RowsSection from './sections/RowsSection';
import TwoPanelsSection from './sections/TwoPanelsSection';
import StepsSection from './sections/StepsSection';
import NoteSection from './sections/NoteSection';
import TipsSection from './sections/TipsSection';
import DateCardsSection from './sections/DateCardsSection';
import NextStepsSection from './sections/NextStepsSection';
import ProgressBar from './ProgressBar';
import BoasVindasLumos from '../BoasVindasLumos';

type ItemDoc = {
  item_key: string; group_key: string; titulo: string; descricao: string | null;
  requer_arquivo: boolean; sort_order: number; feito: boolean;
  nome_arquivo: string | null; concluido_em: string | null; concluido_por: string | null;
};

type Resposta = {
  error?: 'invalid' | 'precisa_login' | 'sem_acesso';
  cliente?: { id: string; nome: string };
  doc: { sections: Secao[]; variables: VariavelDef[]; values: Record<string, string> } | null;
  itens: ItemDoc[];
};

const MSG_ERRO = 'Não deu pra carregar essa página agora. Recarrega, ou tenta de novo em instantes.';

export default function WelcomeDocPage({ token, nomePessoa }: { token: string; nomePessoa: string }) {
  const [resposta, setResposta] = useState<Resposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_welcome_doc', { p_token: token });
    if (error || data?.error) {
      setErro(MSG_ERRO);
    } else {
      setErro(null);
      setResposta(data as Resposta);
    }
    setCarregando(false);
  }, [token]);

  useEffect(() => { carregar(); }, [carregar]);

  if (carregando) return <div className="boas-vindas"><p className="wd-lead">Carregando…</p></div>;
  if (erro) return <div className="boas-vindas"><p className="wd-lead" style={{ color: 'var(--ajuste)' }}>{erro}</p></div>;
  if (!resposta?.doc) {
    return (
      <div className="boas-vindas">
        <p className="wd-lead">Seu material de boas-vindas está sendo preparado. Já te avisamos por aqui assim que estiver pronto.</p>
      </div>
    );
  }

  const secoes = interpolarSecoes(resposta.doc.sections, resposta.doc.values, resposta.doc.variables);
  const feitos = resposta.itens.filter(i => i.feito).length;

  return (
    <div className="boas-vindas">
      {secoes.map(secao => {
        switch (secao.type) {
          case 'lead': return <LeadSection key={secao.key} {...secao} />;
          case 'rows': return <RowsSection key={secao.key} {...secao} />;
          case 'two-panels': return <TwoPanelsSection key={secao.key} {...secao} />;
          case 'steps': return <StepsSection key={secao.key} {...secao} />;
          case 'note': return <NoteSection key={secao.key} {...secao} />;
          case 'tips': return <TipsSection key={secao.key} {...secao} />;
          case 'date-cards': return <DateCardsSection key={secao.key} {...secao} />;
          case 'next-steps': return <NextStepsSection key={secao.key} {...secao} />;
          case 'checklist':
            return (
              <div className="wd-secao" key={secao.key}>
                <ProgressBar feitos={feitos} total={resposta.itens.length} />
                <BoasVindasLumos token={token} nomePessoa={nomePessoa} itens={resposta.itens} aoAtualizar={carregar} />
              </div>
            );
          default:
            // Tipo de seção desconhecido: ignora, não quebra a página do cliente.
            return null;
        }
      })}
    </div>
  );
}
```

- [ ] **Step 3: Plugar em `PortalCliente.tsx`**

Ler o arquivo atual pra confirmar a linha exata (deve estar perto de onde ficou depois das mudanças de hoje mais cedo — buscar por `import BoasVindasLumos from './BoasVindasLumos'` e por `{aba === 'boas_vindas' &&`). Trocar:
```tsx
import BoasVindasLumos from './BoasVindasLumos';
```
por:
```tsx
import WelcomeDocPage from './welcome-doc/WelcomeDocPage';
```
e trocar:
```tsx
{aba === 'boas_vindas' && (
  <main className="painel"><div className="folha">
    <BoasVindasLumos token={token} nomePessoa={nome || 'cliente'} />
  </div></main>
)}
```
por:
```tsx
{aba === 'boas_vindas' && (
  <main className="painel"><div className="folha">
    <WelcomeDocPage token={token} nomePessoa={nome || 'cliente'} />
  </div></main>
)}
```

- [ ] **Step 4: Checar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros novos. Prestar atenção especial em `BoasVindasLumos.tsx` — é o arquivo mais mexido desta tarefa, e um erro de tipo ali é o mais provável de aparecer (ex.: `ItemKey`/`ItemStatus` não batendo mais com o formato vindo de `ItemDoc`).

- [ ] **Step 5: Rodar localmente e conferir visualmente**

```bash
cd /Users/caiorizzuttl/comercial-lumos && npm run dev
```

Abrir `http://localhost:5173/portal/_kXsb3iRhJAa`, entrar, ir em "Bem-vindo à Lumos". Como a migração das Tasks 1-3 ainda não foi aplicada em produção, `get_welcome_doc` ainda não existe no banco — a chamada vai falhar, e o esperado aqui é ver a mensagem de erro (`MSG_ERRO`) aparecer de forma limpa, sem a página quebrar ou ficar em branco. Isso confirma que o estado de erro funciona; o caminho de sucesso completo só é testável na Task 9, depois que o Caio aplicar as migrações.

- [ ] **Step 6: Commit**

```bash
git add src/pages/welcome-doc/WelcomeDocPage.tsx src/pages/BoasVindasLumos.tsx src/pages/PortalCliente.tsx
git commit -m "feat(portal): WelcomeDocPage orquestra as seções, checklist vira uma delas

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Publicar o Welcome Doc real da Vitru e migrar o que ela já preencheu

O mockup `welcome-doc-lumos-portal-v2.html` chegou com o texto final — as duas
decisões que estavam em aberto no spec já vêm respondidas nele (canal =
"Slack compartilhado"; escopo = 12 peças/mês, 2 rodadas, entrega em 5 dias
úteis). Esta tarefa publica o Digital v1 de verdade, com a copy do mockup,
pro cliente real (Vitru, `client_id = '4298cbde-99fe-4465-ae14-a6ec70d88122'`
— confirmado nesta sessão via `get_boas_vindas_lumos`), e liga os itens que
a Vitru já preencheu hoje (testados nesta mesma sessão) aos itens novos, pra
nada se perder.

**Files:**
- Create: `supabase/migrations/2026093347_welcome_doc_vitru.sql`

**Interfaces:** nenhuma — tarefa terminal, mas usa `client_welcome_doc_templates`/`client_welcome_docs`/`client_welcome_doc_itens` (Task 1) e depende de `get_welcome_doc` (Task 2) pra verificar.

- [ ] **Step 1: Escrever a migração com a copy real**

```sql
-- Welcome Doc Digital v1 — copy real, do mockup welcome-doc-lumos-portal-v2.html.
-- Publica pro cliente real (Vitru) e liga os itens que ela já preencheu
-- antes desta migração (testados nesta sessão: logo, brand_book, acessos)
-- aos itens novos do template, pra nenhum upload/marcação se perder.

INSERT INTO client_welcome_doc_templates (vertical, version, sections, variables, checklist, is_active)
VALUES (
  'digital', 1,
  '[
    {"key":"intro","type":"lead","body":"Que bom te ter por aqui. Esta página é o seu ponto de partida: o que esperar da gente, o que a gente precisa de você e como as coisas funcionam no dia a dia. Leva cinco minutos, e fica sempre aqui, atualizada durante o projeto."},
    {"key":"time","type":"rows","kicker":"01 · Seu time","title":"Quem cuida","titleAccent":"da sua conta",
      "rows":[
        {"name":"{{ATENDIMENTO}}","role":"Atendimento","when":"sempre — qualquer assunto entra por aqui","pill":"seu ponto focal","pillStyle":"accent"},
        {"name":"{{PRODUCAO}}","role":"Produção","when":"acompanha as gravações e a logística no dia","pill":"no set","pillStyle":"ghost"},
        {"name":"Caio Rizzutti","role":"CEO","when":"direção criativa e decisões estratégicas","pill":"estratégia","pillStyle":"ghost"},
        {"name":"Vinicius Ankerkrone","role":"CFO","when":"contrato, escopo e comercial","pill":"comercial","pillStyle":"ghost"}
      ],
      "footnote":"Você não precisa acionar editor ou produtor diretamente. Tudo passa por {{ATENDIMENTO}}, é o que garante que nenhum pedido se perca numa conversa paralela e que o time todo trabalhe com a mesma informação."},
    {"key":"escopo","type":"two-panels","kicker":"02 · Escopo","title":"O que está","titleAccent":"no combinado",
      "esquerda":{"titulo":"Incluído","sub":"Todo mês, sem precisar pedir","itens":[
        "{{QTD_PECAS}} peças por mês — {{FORMATOS}}",
        "Roteiro, direção, captação e edição",
        "Tratamento de cor, trilha e legendas",
        "{{RODADAS}} rodadas de alteração por peça",
        "1 diária de captação por mês",
        "Entrega em {{PRAZO_ENTREGA}} após o roteiro aprovado"
      ]},
      "direita":{"titulo":"Fora do combinado","sub":"Existe, mas a gente orça à parte","itens":[
        "Peças além do volume contratado",
        "Rodadas de alteração acima de {{RODADAS}}",
        "Mídia paga, impulsionamento e anúncios",
        "Postagem e gestão das redes",
        "Cachê de talentos, locação e trilha comercial",
        "Diárias extras e demandas com menos de 48h"
      ]}},
    {"key":"ciclo","type":"steps","kicker":"03 · Como funciona","title":"O ciclo","titleAccent":"do mês",
      "lead":"O mês é sempre o mesmo. As duas etapas destacadas são suas, e cada dia de atraso nelas é um dia de atraso na entrega, porque o time já está alocado no ciclo seguinte.",
      "passos":[
        {"numero":"01","texto":"Reunião de planejamento do mês","quemFaz":"Lumos + você","quando":"Semana 1"},
        {"numero":"02","texto":"Pauta e roteiros","quemFaz":"Lumos","quando":"Semana 1"},
        {"numero":"03","texto":"Aprovação dos roteiros","quemFaz":"Você","quando":"{{PRAZO_FEEDBACK}}","suaVez":true},
        {"numero":"04","texto":"Pré-produção e agendamento","quemFaz":"Lumos","quando":"Semana 2"},
        {"numero":"05","texto":"Captação","quemFaz":"Lumos","quando":"Diária do mês"},
        {"numero":"06","texto":"Edição","quemFaz":"Lumos","quando":"{{PRAZO_ENTREGA}}"},
        {"numero":"07","texto":"Aprovação dos cortes no portal","quemFaz":"Você","quando":"{{PRAZO_FEEDBACK}}","suaVez":true},
        {"numero":"08","texto":"Ajustes e entrega final","quemFaz":"Lumos","quando":"2 dias úteis"}
      ]},
    {"key":"checklist","type":"checklist"},
    {"key":"comunicacao","type":"note","kicker":"05 · Comunicação","label":"Canal oficial · {{CANAL}}",
      "body":"Resposta em até 4 horas úteis, de segunda a sexta, das 9h às 18h. Para contrato e nota fiscal, contato@produtoralumos.com.br.\n\nUm combinado honesto: pedido feito fora do canal oficial, no direct, no WhatsApp pessoal de alguém do time, no corredor de uma gravação, não entra na fila. Não é rigidez, é a única forma de garantir que ele não se perca. Se pintar uma ideia às 22h, manda no canal. A gente lê de manhã e ela entra no fluxo."},
    {"key":"feedback","type":"tips","kicker":"06 · Feedback","title":"Como pedir ajuste","titleAccent":"e ser entendido",
      "dicas":[
        {"titulo":"Consolide","texto":"Junte a opinião de todo mundo do seu lado e mande de uma vez. Feedback pingado gera versões conflitantes e queima uma rodada à toa."},
        {"titulo":"Comente no ponto exato","texto":"No portal você comenta em cima do frame. Em 00:12 o corte ficou seco resolve em cinco minutos; achei o meio estranho custa uma reunião."},
        {"titulo":"Fale do objetivo","texto":"Isso não conversa com o nosso público é acionável. Se for questão de gosto, diz o porquê, quase sempre existe uma solução melhor."}
      ]},
    {"key":"datas","type":"date-cards","kicker":"07 · Calendário","title":"Datas que","titleAccent":"importam",
      "cards":[
        {"data":"{{DATA_KICKOFF}}","titulo":"Kickoff","nota":"10:00 · online","destaque":true},
        {"data":"Semana 1","titulo":"Planejamento","nota":"mensal, fixo"},
        {"data":"{{DIA_GRAVACAO}}","titulo":"Diária 01","nota":"11:00 às 19:00"},
        {"data":"Dia {{DIA_FATURAMENTO}}","titulo":"Faturamento","nota":"conforme contrato"}
      ]},
    {"key":"proximos","type":"next-steps","kicker":"08 · Sua vez","title":"Próximos","titleAccent":"passos",
      "passos":[
        {"numero":"01","texto":"Enviar os itens pendentes acima","nota":"os de marca são os mais urgentes","quando":"até {{DATA_KICKOFF}}"},
        {"numero":"02","texto":"Confirmar quem aprova e o backup","nota":"e adicionar essa pessoa ao canal oficial","quando":"até {{DATA_KICKOFF}}"},
        {"numero":"03","texto":"Confirmar presença no kickoff","nota":"{{ATENDIMENTO}} manda o convite","quando":"{{DATA_KICKOFF}}"},
        {"numero":"04","texto":"Salvar este link","nota":"ele fica atualizado durante todo o projeto","quando":"—"}
      ]}
  ]'::jsonb,
  '[
    {"key":"CLIENTE","label":"Cliente","type":"text","required":true,"group":"geral"},
    {"key":"ATENDIMENTO","label":"Atendimento","type":"text","required":true,"group":"time"},
    {"key":"PRODUCAO","label":"Produção","type":"text","required":true,"group":"time"},
    {"key":"QTD_PECAS","label":"Peças por mês","type":"number","required":true,"group":"escopo"},
    {"key":"FORMATOS","label":"Formatos","type":"text","required":true,"group":"escopo"},
    {"key":"RODADAS","label":"Rodadas de alteração","type":"number","required":true,"group":"escopo"},
    {"key":"PRAZO_ENTREGA","label":"Prazo de entrega","type":"text","required":true,"group":"escopo"},
    {"key":"PRAZO_FEEDBACK","label":"Prazo de feedback","type":"text","required":true,"group":"escopo"},
    {"key":"DATA_KICKOFF","label":"Data do kickoff","type":"text","required":true,"group":"datas"},
    {"key":"DIA_FATURAMENTO","label":"Dia de faturamento","type":"text","required":true,"group":"datas"},
    {"key":"CANAL","label":"Canal oficial","type":"text","required":true,"group":"comunicacao"},
    {"key":"DIA_GRAVACAO","label":"Data da próxima diária","type":"text","required":false,"group":"datas"}
  ]'::jsonb,
  '[
    {"key":"logo","group":"marca","title":"Logo","description":"Em alta resolução, de preferência vetorial (AI, EPS ou SVG), ou um PNG bem grande se não tiver outro.","requires_upload":true,"sort_order":10},
    {"key":"brand_book","group":"marca","title":"Brand book","description":"O documento com as diretrizes visuais da sua marca, se você tiver um.","requires_upload":true,"sort_order":20},
    {"key":"guidelines","group":"marca","title":"Guidelines de conteúdo","description":"Como sua marca fala, o que evitar, referências de tom.","requires_upload":true,"sort_order":30},
    {"key":"acessos","group":"acessos","title":"Acessos","description":"Convide contato@produtoralumos.com.br como editor nas contas que vamos mexer (redes sociais, Drive etc.), e marca aqui quando fizer.","requires_upload":false,"sort_order":40},
    {"key":"quem_aprova","group":"acessos","title":"Quem aprova","description":"Nome, cargo e e-mail de quem dá a palavra final, e quem substitui essa pessoa em férias. Combina pelo canal oficial e marca aqui quando resolver.","requires_upload":false,"sort_order":50},
    {"key":"metricas_perfis","group":"acessos","title":"Métricas dos perfis","description":"Acesso de visualização ao Instagram Insights e ao YouTube Studio, pra gente medir o que funciona. Libera o acesso e marca aqui quando fizer.","requires_upload":false,"sort_order":60},
    {"key":"referencias","group":"contexto","title":"Referências","description":"3 a 5 conteúdos que vocês gostam, podem ser de outras marcas. E o que já foi testado e não funcionou.","requires_upload":true,"sort_order":70},
    {"key":"calendario_semestre","group":"contexto","title":"Calendário do semestre","description":"Datas, campanhas e lançamentos que a gente precisa considerar no planejamento.","requires_upload":true,"sort_order":80}
  ]'::jsonb,
  true
)
ON CONFLICT (vertical, version) DO NOTHING;

-- Publica pra Vitru, com os valores reais do mockup.
INSERT INTO client_welcome_docs (client_id, template_id, values, status, published_at)
SELECT '4298cbde-99fe-4465-ae14-a6ec70d88122'::uuid, t.id, '{
    "CLIENTE": "Vitru",
    "ATENDIMENTO": "Ariella Cordes",
    "PRODUCAO": "Samantha Ike",
    "QTD_PECAS": "12",
    "FORMATOS": "Reels, Shorts e cortes 16:9",
    "RODADAS": "2",
    "PRAZO_ENTREGA": "5 dias úteis",
    "PRAZO_FEEDBACK": "3 dias úteis",
    "DATA_KICKOFF": "12/09",
    "DIA_FATURAMENTO": "05",
    "CANAL": "Slack compartilhado",
    "DIA_GRAVACAO": "11/09"
  }'::jsonb, 'published', now()
FROM client_welcome_doc_templates t WHERE t.vertical = 'digital' AND t.version = 1
ON CONFLICT (client_id) DO NOTHING;

INSERT INTO client_welcome_doc_itens (welcome_doc_id, item_key, group_key, titulo, descricao, requer_arquivo, sort_order)
SELECT d.id, (c->>'key'), (c->>'group'), (c->>'title'), (c->>'description'), (c->>'requires_upload')::boolean, (c->>'sort_order')::int
FROM client_welcome_docs d
JOIN client_welcome_doc_templates t ON t.id = d.template_id
CROSS JOIN LATERAL jsonb_array_elements(t.checklist) AS c
WHERE d.client_id = '4298cbde-99fe-4465-ae14-a6ec70d88122'::uuid
ON CONFLICT (welcome_doc_id, item_key) DO NOTHING;

-- Liga o que a Vitru já preencheu (testado nesta sessão: logo, brand_book,
-- acessos) ao item novo — nada se perde. guidelines, quem_aprova,
-- metricas_perfis, referencias e calendario_semestre continuam pendentes,
-- corretamente, porque ainda não foram preenchidos.
UPDATE client_boas_vindas_itens s
SET welcome_doc_item_id = i.id
FROM client_welcome_doc_itens i
JOIN client_welcome_docs d ON d.id = i.welcome_doc_id
WHERE d.client_id = '4298cbde-99fe-4465-ae14-a6ec70d88122'::uuid
  AND s.client_id = '4298cbde-99fe-4465-ae14-a6ec70d88122'::uuid
  AND s.item_key = i.item_key
  AND s.welcome_doc_item_id IS NULL;

-- Conferência (rodar à mão depois de aplicar):
-- SELECT item_key, welcome_doc_item_id IS NOT NULL AS ligado FROM client_boas_vindas_itens
--   WHERE client_id = '4298cbde-99fe-4465-ae14-a6ec70d88122';
-- -- logo, brand_book e acessos devem estar com ligado = true.
```

**Simplificação deliberada, registrada aqui:** o mockup mostra o item "Quem
aprova" com um estado "marcado sem anexo · confirmar o backup" e uma ação
"Editar" diferente de "Reenviar"/"Concluído" — um terceiro estado que o
checklist de hoje não tem. Esta tarefa não implementa esse terceiro estado:
"Quem aprova" e "Métricas dos perfis" usam a mesma marcação manual simples
que "Acessos" já usa (`requer_arquivo: false`, marca e pronto). Registrar
como possível melhoria futura, fora de escopo aqui — YAGNI: ninguém pediu
esse terceiro estado explicitamente, só apareceu como detalhe visual do
mockup.

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/2026093347_welcome_doc_vitru.sql
git commit -m "feat(portal): Welcome Doc real da Vitru, com a copy do mockup (SQL, não aplicado)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: Verificação de ponta a ponta

**Files:** nenhum arquivo novo.

**Interfaces:** nenhuma — tarefa terminal.

- [ ] **Step 1: Pedir pro Caio aplicar as 6 migrações desta plano, em ordem**

O executor do plano deve parar aqui e pedir a confirmação do Caio:
`2026093344_welcome_doc_schema.sql`, `2026093345_get_welcome_doc.sql`,
`2026093346_checklist_dinamico.sql`, e `2026093347_welcome_doc_vitru.sql`,
todas no SQL Editor do Supabase, nesta ordem exata (cada uma depende da
anterior).

- [ ] **Step 2: Confirmar o deploy da edge function**

Se a Task 4 já rodou nesta execução, a função já está no ar — só confirmar
com `supabase functions list --project-ref byntpekyfhzwfihjhzuo` que
`boas-vindas-upload` aparece. Senão, rodar o deploy da Task 4 agora.

- [ ] **Step 3: Verificar por curl**

```bash
ANON_KEY=$(grep VITE_SUPABASE_ANON_KEY /Users/caiorizzuttl/comercial-lumos/.env | cut -d= -f2)
curl -s "https://byntpekyfhzwfihjhzuo.supabase.co/rest/v1/rpc/get_welcome_doc" \
  -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
  -d '{"p_token": "_kXsb3iRhJAa"}'
```
Expected: `doc.sections` com as 9 seções reais, `doc.values.ATENDIMENTO =
"Ariella Cordes"`, `itens` com os 8 itens (logo/brand_book/acessos já
`feito: true`, ligados ao que a Vitru preencheu antes; os outros 5
pendentes).

- [ ] **Step 4: Abrir no navegador e conferir visualmente**

Abrir `http://localhost:5173/portal/_kXsb3iRhJAa` (ou a porta livre), ir em
"Bem-vindo à Lumos". Confirmar, na ordem: o hero de sempre, o parágrafo de
abertura, a barra de progresso mostrando 3 de 8, a seção "Quem cuida da sua
conta" com **Ariella Cordes** e **Samantha Ike** interpolados (nunca
`{{ATENDIMENTO}}` na tela), a seção de escopo com **12 peças**, **2
rodadas** e **5 dias úteis** interpolados, o ciclo do mês com os 8 passos,
o checklist com 8 itens (3 já concluídos), a nota de comunicação com
**Slack compartilhado**, as 3 dicas de feedback, os 4 cartões de data com
**12/09** no kickoff em destaque, e os 4 próximos passos.

- [ ] **Step 5: Testar um item novo, de ponta a ponta**

Marcar "Métricas dos perfis" como feito. Esperado: barra de progresso sobe
pra 4 de 8, o item aparece concluído, e (se a notificação estiver
funcionando) o time recebe o aviso.

- [ ] **Step 6: Testar isolamento entre clientes**

```bash
curl -s "https://byntpekyfhzwfihjhzuo.supabase.co/rest/v1/rpc/get_welcome_doc" \
  -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
  -d '{"p_token": "token-de-outro-cliente-sem-doc-publicado"}'
```
Expected: `doc: null`, `itens: []` — nunca os dados da Vitru.

- [ ] **Step 7: Confirmar visualmente que nenhum `{{VARIAVEL}}` escapou**

Reler a página inteira (ou usar `get_page_text` se estiver verificando via
navegador automatizado) procurando por `{{` — não deve aparecer em lugar
nenhum, nem no estado de erro, nem em nenhuma seção.
