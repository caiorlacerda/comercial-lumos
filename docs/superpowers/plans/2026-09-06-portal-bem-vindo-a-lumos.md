# Bem-vindo à Lumos: Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar a aba "Bem-vindo à Lumos" ao portal do cliente: um checklist fixo de 4 itens (logo, brand book, guidelines — upload de arquivo; acessos — marcação manual) que o cliente preenche uma vez, no nível do cliente (não do projeto).

**Architecture:** Uma tabela nova (`client_boas_vindas_itens`) guarda só os itens já concluídos. Duas RPCs `SECURITY DEFINER` (`get_boas_vindas_lumos` pra ler, `marcar_item_boas_vindas` pro item manual) seguem o mesmo padrão de validação de token que `get_client_portal_v2` já usa. Uma edge function nova (`boas-vindas-upload`) recebe o arquivo do navegador, garante a pasta do cliente no Drive (reaproveitando a lógica de `ensureClientFolder` que já existe em `drive-provision`, só nunca foi chamada por ninguém) e grava o upload dentro da estrutura `_ASSETS` que essa mesma função já cria. No frontend, um componente novo (`BoasVindasLumos.tsx`) é plugado como uma 5ª aba de topo em `PortalCliente.tsx`, carregado só quando o cliente abre essa aba.

**Tech Stack:** React + TypeScript (frontend), Supabase Postgres (PL/pgSQL, `SECURITY DEFINER`), Supabase Edge Functions (Deno), Google Drive API v3 (Service Account, JWT RS256 — já em uso, nenhum secret novo).

**Spec:** `docs/superpowers/specs/2026-09-06-portal-bem-vindo-a-lumos-design.md`

## Global Constraints

- **SQL nunca roda sozinho.** Este plano escreve arquivos de migração; rodar contra o banco (produção ou qualquer ambiente) é sempre manual, feito pelo Caio no painel do Supabase. Nenhuma tarefa deste plano executa `supabase db push`, `psql`, ou qualquer coisa que aplique SQL de verdade.
- **Deploy de edge function é diferente disso, e pode ser feito pelo executor**, via `supabase functions deploy <nome> --no-verify-jwt` (a CLI já está autenticada nesta máquina). O `--no-verify-jwt` é obrigatório: o portal é acessado sem sessão do Supabase na maioria dos casos, e a autorização é o token do portal, verificado dentro da própria função — não pelo gateway.
- **Nenhum secret novo.** A função nova reusa `GOOGLE_SERVICE_ACCOUNT_JSON`, `DRIVE_SHARED_DRIVE_ID`, `DRIVE_CLIENTES_FOLDER_ID` — os mesmos já configurados pra `drive-provision`.
- **Sem framework de teste automatizado neste repositório** (confirmado: `package.json` só tem `dev`/`build`/`preview`, zero arquivos `.test.ts` em todo o `src/`). A verificação de cada tarefa é: `tsc` sem erro pro código TypeScript, e um passo manual/`curl` concreto — não um `pytest`/`vitest` fictício. Isso segue o padrão real do projeto (specs anteriores verificam "logado como robô", não com suíte de testes).
- **Checklist fixo, sem aprovação, reenvio sempre permitido** — direto do spec, não é decisão de implementação.
- **Copy do app usa vírgula em vez de travessão** — qualquer texto novo (toasts, labels) segue essa convenção.

---

### Task 1: Banco de dados — tabela e as duas RPCs

**Files:**
- Create: `supabase/migrations/2026093342_boas_vindas_lumos.sql`

**Interfaces:**
- Produces: tabela `client_boas_vindas_itens` (colunas: `id`, `client_id`, `item_key`, `tipo`, `drive_file_id`, `nome_arquivo`, `concluido_em`, `concluido_por`); função `get_boas_vindas_lumos(p_token text) RETURNS jsonb`; função `marcar_item_boas_vindas(p_token text, p_item_key text, p_nome_pessoa text) RETURNS jsonb`. Task 3 (edge function) e Task 4 (frontend) dependem desses três nomes exatamente como estão aqui.

- [ ] **Step 1: Escrever o arquivo de migração completo**

```sql
-- Bem-vindo à Lumos: checklist de onboarding do cliente novo (logo, brand
-- book, guidelines, acessos). Uma linha só existe quando o item foi
-- preenchido — sem linha = pendente. Ver spec:
-- docs/superpowers/specs/2026-09-06-portal-bem-vindo-a-lumos-design.md

CREATE TABLE IF NOT EXISTS public.client_boas_vindas_itens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  item_key      text NOT NULL CHECK (item_key IN ('logo', 'brand_book', 'guidelines', 'acessos')),
  tipo          text NOT NULL CHECK (tipo IN ('arquivo', 'manual')),
  drive_file_id text,
  nome_arquivo  text,
  concluido_em  timestamptz NOT NULL DEFAULT now(),
  concluido_por text,
  UNIQUE (client_id, item_key)
);

ALTER TABLE public.client_boas_vindas_itens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated read boas vindas" ON public.client_boas_vindas_itens;
CREATE POLICY "authenticated read boas vindas"
  ON public.client_boas_vindas_itens FOR SELECT TO authenticated
  USING (true);

-- anon nunca lê/grava direto: só pelas duas funções abaixo (SECURITY DEFINER)
-- e pela edge function (service_role, que ignora RLS).
GRANT ALL ON public.client_boas_vindas_itens TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Leitura: status dos 4 itens pro cliente que abriu a aba
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_boas_vindas_lumos(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_portal RECORD;
  v_client RECORD;
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

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'item_key', item_key,
    'tipo', tipo,
    'nome_arquivo', nome_arquivo,
    'concluido_em', concluido_em,
    'concluido_por', concluido_por
  )), '[]'::jsonb)
  INTO v_itens
  FROM client_boas_vindas_itens
  WHERE client_id = v_client.id;

  RETURN jsonb_build_object(
    'cliente', jsonb_build_object('id', v_client.id, 'nome', v_client.name),
    'itens', v_itens
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_boas_vindas_lumos(text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Item manual "Acessos": sem arquivo, só marca concluído
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.marcar_item_boas_vindas(
  p_token text, p_item_key text, p_nome_pessoa text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_portal RECORD;
  v_client_name text;
BEGIN
  IF p_item_key <> 'acessos' THEN
    RETURN jsonb_build_object('error', 'item_precisa_de_arquivo');
  END IF;

  SELECT * INTO v_portal FROM client_portals WHERE token = p_token AND active = true;
  IF v_portal IS NULL THEN
    RETURN jsonb_build_object('error', 'invalid');
  END IF;

  INSERT INTO client_boas_vindas_itens (client_id, item_key, tipo, concluido_por, concluido_em)
  VALUES (v_portal.client_id, p_item_key, 'manual', NULLIF(trim(p_nome_pessoa), ''), now())
  ON CONFLICT (client_id, item_key)
  DO UPDATE SET concluido_por = EXCLUDED.concluido_por, concluido_em = now();

  SELECT name INTO v_client_name FROM clients WHERE id = v_portal.client_id;

  -- Bloco isolado de propósito: se notificar falhar (ex.: coluna nova em
  -- "notifications" que este banco ainda não tem), o item continua marcado.
  -- Mesmo princípio do gatilho de Drive: aviso nunca derruba a ação principal.
  BEGIN
    INSERT INTO notifications (user_id, event_type, category, priority, title, body, scope)
    SELECT a.id, 'boas_vindas_item_enviado', 'producao', 'normal',
      'Bem-vindo à Lumos: novo item concluído',
      v_client_name || ' marcou "Acessos" como concluído.',
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
```

- [ ] **Step 2: Escrever a consulta de conferência (pro Caio rodar depois de aplicar a migração)**

Adicionar como comentário no fim do próprio arquivo de migração (mesmo padrão usado em `2026093325_portal_do_cliente.sql`), sem rodar:

```sql
-- Conferência (rodar à mão depois de aplicar):
-- SELECT proname FROM pg_proc WHERE proname IN ('get_boas_vindas_lumos', 'marcar_item_boas_vindas');
-- -- deve devolver as duas linhas.
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'client_boas_vindas_itens';
-- -- deve devolver as 8 colunas: id, client_id, item_key, tipo, drive_file_id, nome_arquivo, concluido_em, concluido_por.
```

- [ ] **Step 3: Checar sintaxe sem aplicar** (não há banco local rodando nesta tarefa — a checagem é visual: reler o arquivo inteiro e confirmar que cada `CREATE`/`ALTER` tem `;` no fim, que os nomes de tabela/coluna batem entre a DDL e as duas funções, e que os dois `GRANT EXECUTE` apontam pros nomes de função exatamente como definidos)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/2026093342_boas_vindas_lumos.sql
git commit -m "feat(portal): tabela e RPCs de Bem-vindo à Lumos (SQL, não aplicado)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Edge function `boas-vindas-upload`

**Files:**
- Create: `supabase/functions/boas-vindas-upload/index.ts`

**Interfaces:**
- Consumes: `client_portals` (colunas `token`, `active`, `client_id`, `contact_user_ids`), `clients` (`id`, `name`, `drive_folder_id`), `client_boas_vindas_itens` (de Task 1), tabela `notifications` (colunas já usadas em outras partes do app: `user_id`, `event_type`, `category`, `priority`, `title`, `body`, `scope`), `app_users` (`id`, `role`, `status`).
- Produces: endpoint HTTP `POST /functions/v1/boas-vindas-upload`, corpo `multipart/form-data` com campos `token`, `item_key` (`'logo'|'brand_book'|'guidelines'`), `nome_pessoa`, `arquivo` (o arquivo). Resposta de sucesso: `{ ok: true, drive_file_id: string, nome_arquivo: string }`. Task 4 (frontend) consome exatamente este contrato.

- [ ] **Step 1: Adicionar o evento novo ao catálogo de notificações**

Editar `src/lib/notifications/events.ts`, no bloco `// PRODUÇÃO` (mesmo grupo de `DIARIA_SOLICITADA`), acrescentando:

```ts
BOAS_VINDAS_ITEM_ENVIADO: { key: 'boas_vindas_item_enviado', category: 'producao', label: 'Cliente enviou material do Bem-vindo à Lumos', defaultEnabled: true, priority: 'normal' },
```

- [ ] **Step 2: Escrever a edge function completa**

```ts
// Bem-vindo à Lumos: upload dos itens do checklist de onboarding (logo,
// brand book, guidelines). O item "acessos" não passa por aqui — não tem
// arquivo, é marcado pela RPC marcar_item_boas_vindas.
//
// POST /boas-vindas-upload, corpo multipart/form-data:
//   token (texto do portal), item_key ('logo'|'brand_book'|'guidelines'),
//   nome_pessoa (texto, opcional), arquivo (o arquivo).
//
// Autorização: o token do portal, verificado aqui dentro (client_portals) —
// não JWT do Supabase, porque a maioria dos clientes acessa sem login. Por
// isso o deploy é --no-verify-jwt (mesmo motivo do stream-ingest 'auto').
//
// Secrets: GOOGLE_SERVICE_ACCOUNT_JSON, DRIVE_SHARED_DRIVE_ID,
// DRIVE_CLIENTES_FOLDER_ID — os mesmos que a drive-provision já usa.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const DRIVE_ID = Deno.env.get('DRIVE_SHARED_DRIVE_ID') ?? ''
const CLIENTES_FOLDER_ID = Deno.env.get('DRIVE_CLIENTES_FOLDER_ID') ?? ''
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const FOLDER_MIME = 'application/vnd.google-apps.folder'

const SUBPASTA: Record<string, string> = {
  logo: 'LOGOS',
  brand_book: 'BRAND-BOOK',
  guidelines: 'GUIDELINES',
}

// --- Google auth (idêntico ao drive-provision, duplicado de propósito: cada
//     edge function neste projeto é autocontida, sem módulo compartilhado) ---
let cachedToken: { token: string; exp: number } | null = null
function b64url(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  let bin = ''
  bytes.forEach(b => { bin += String.fromCharCode(b) })
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
async function googleAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  if (cachedToken && cachedToken.exp > now + 60) return cachedToken.token
  const sa = JSON.parse(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON') ?? '{}')
  if (!sa.client_email || !sa.private_key) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON ausente ou inválido')
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/drive',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  }))
  const pem = (sa.private_key as string).replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '')
  const raw = Uint8Array.from(atob(pem), c => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('pkcs8', raw.buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claims}`)))
  const jwt = `${header}.${claims}.${b64url(sig)}`
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${jwt}`,
  })
  const data = await res.json()
  if (!data.access_token) throw new Error(`Falha no token Google: ${JSON.stringify(data).slice(0, 200)}`)
  cachedToken = { token: data.access_token, exp: now + 3500 }
  return data.access_token
}

async function driveFetch(path: string, init: RequestInit = {}, attempt = 1): Promise<any> {
  const token = await googleAccessToken()
  const sep = path.includes('?') ? '&' : '?'
  const url = `https://www.googleapis.com/drive/v3/${path}${sep}supportsAllDrives=true`
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  })
  if ((res.status === 429 || res.status >= 500) && attempt <= 3) {
    await new Promise(r => setTimeout(r, attempt * 1200))
    return driveFetch(path, init, attempt + 1)
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Drive ${res.status} em ${path.split('?')[0]}: ${JSON.stringify(body.error?.message || body).slice(0, 250)}`)
  return body
}

async function findChildFolder(parentId: string, name: string): Promise<string | null> {
  const q = encodeURIComponent(`'${parentId}' in parents and trashed=false and mimeType='${FOLDER_MIME}' and name='${name.replace(/'/g, "\\'")}'`)
  const page = await driveFetch(`files?q=${q}&fields=files(id)&includeItemsFromAllDrives=true&corpora=drive&driveId=${DRIVE_ID}`)
  return page.files?.[0]?.id ?? null
}

async function createFolder(parentId: string, name: string): Promise<string> {
  const body = await driveFetch('files?fields=id', {
    method: 'POST',
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  })
  return body.id
}

async function ensureFolder(parentId: string, name: string): Promise<string> {
  return (await findChildFolder(parentId, name)) ?? (await createFolder(parentId, name))
}

async function folderAlive(folderId: string | null): Promise<boolean> {
  if (!folderId) return false
  try {
    const meta = await driveFetch(`files/${folderId}?fields=trashed`)
    return meta?.trashed !== true
  } catch (_) {
    return false
  }
}

// Garante a pasta do cliente e devolve o id da subpasta _ASSETS dentro dela.
// Reusa clients.drive_folder_id se ainda existir (auto-cura se foi apagada,
// igual a drive-provision faz).
async function ensureClientAssetsFolder(client: { id: string; name: string; drive_folder_id: string | null }): Promise<string> {
  let clientFolderId = client.drive_folder_id
  if (!(await folderAlive(clientFolderId))) {
    const folderName = client.name.trim() || 'CLIENTE'
    clientFolderId = await ensureFolder(CLIENTES_FOLDER_ID, folderName)
    await db.from('clients').update({ drive_folder_id: clientFolderId }).eq('id', client.id)
    await db.from('drive_sync_log').insert([{
      entity_type: 'client', entity_id: client.id, action: 'create_folder',
      detail: `Pasta do cliente "${folderName}" criada por boas-vindas-upload (${clientFolderId})`,
    }])
  }
  return ensureFolder(clientFolderId!, '_ASSETS')
}

async function uploadFile(parentId: string, name: string, mimeType: string, bytes: Uint8Array): Promise<string> {
  const boundary = 'boasvindas' + crypto.randomUUID().replace(/-/g, '')
  const metadata = JSON.stringify({ name, parents: [parentId] })
  const parts = [
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
    `--${boundary}\r\nContent-Type: ${mimeType || 'application/octet-stream'}\r\n\r\n`,
  ]
  const tail = `\r\n--${boundary}--`
  const body = new Blob([parts[0], parts[1], bytes, tail])
  const token = await googleAccessToken()
  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  })
  const data = await res.json().catch(() => ({}))
  if (!data.id) throw new Error(`upload falhou: ${JSON.stringify(data).slice(0, 200)}`)
  return data.id
}

async function notificarTime(clientId: string, clientName: string, itemLabel: string) {
  const { data: portal } = await db.from('client_portals')
    .select('contact_user_ids').eq('client_id', clientId).eq('active', true).maybeSingle()
  const { data: admins } = await db.from('app_users')
    .select('id').eq('status', 'ativo').in('role', ['admin', 'atendimento'])
  const ids = new Set<string>([...(admins ?? []).map(a => a.id), ...(portal?.contact_user_ids ?? [])])
  if (!ids.size) return
  await db.from('notifications').insert([...ids].map(user_id => ({
    user_id,
    event_type: 'boas_vindas_item_enviado',
    category: 'producao',
    priority: 'normal',
    title: 'Bem-vindo à Lumos: novo material recebido',
    body: `${clientName} enviou ${itemLabel}.`,
    scope: 'team',
  })))
}

const ITEM_LABEL: Record<string, string> = {
  logo: 'o logo',
  brand_book: 'o brand book',
  guidelines: 'as guidelines de conteúdo',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'use POST' }, 405)

  let form: FormData
  try {
    form = await req.formData()
  } catch (_) {
    return json({ error: 'corpo precisa ser multipart/form-data' }, 400)
  }

  const token = String(form.get('token') || '')
  const itemKey = String(form.get('item_key') || '')
  const nomePessoa = String(form.get('nome_pessoa') || '')
  const arquivo = form.get('arquivo')

  if (!token || !itemKey) return json({ error: 'token e item_key obrigatórios' }, 400)
  if (!SUBPASTA[itemKey]) return json({ error: 'item_key inválido' }, 400)
  if (!(arquivo instanceof File)) return json({ error: 'arquivo obrigatório' }, 400)

  const { data: portal } = await db.from('client_portals')
    .select('client_id').eq('token', token).eq('active', true).maybeSingle()
  if (!portal) return json({ error: 'token inválido' }, 401)

  const { data: client } = await db.from('clients')
    .select('id, name, drive_folder_id').eq('id', portal.client_id).maybeSingle()
  if (!client) return json({ error: 'token inválido' }, 401)

  try {
    const assetsId = await ensureClientAssetsFolder(client)
    const subfolderId = await ensureFolder(assetsId, SUBPASTA[itemKey])
    const bytes = new Uint8Array(await arquivo.arrayBuffer())
    const fileId = await uploadFile(subfolderId, arquivo.name, arquivo.type, bytes)

    await db.from('client_boas_vindas_itens').upsert({
      client_id: client.id,
      item_key: itemKey,
      tipo: 'arquivo',
      drive_file_id: fileId,
      nome_arquivo: arquivo.name,
      concluido_por: nomePessoa || null,
      concluido_em: new Date().toISOString(),
    }, { onConflict: 'client_id,item_key' })

    // Notificação nunca deve transformar um upload que já deu certo em erro
    // pro cliente — mesmo princípio do resto do projeto (pg_net triggers só
    // avisam warning). Isolado do try/catch principal de propósito.
    try {
      await notificarTime(client.id, client.name, ITEM_LABEL[itemKey])
    } catch (notifyErr) {
      console.error('boas-vindas-upload: notificação falhou (upload já concluído):', notifyErr)
    }

    return json({ ok: true, drive_file_id: fileId, nome_arquivo: arquivo.name })
  } catch (err) {
    await db.from('drive_sync_log').insert([{
      entity_type: 'client', entity_id: client.id, action: 'error',
      detail: String((err as Error)?.message || err).slice(0, 900), status: 'error',
    }])
    return json({ error: 'falha ao enviar, tenta de novo' }, 500)
  }
})
```

- [ ] **Step 3: Checar tipos**

Run: `cd /Users/caiorizzuttl/comercial-lumos && npx tsc --noEmit -p supabase/functions/boas-vindas-upload 2>&1 || true`
Como as edge functions são Deno (não fazem parte do `tsconfig.json` do Vite), esse comando pode não achar um `tsconfig` específico — nesse caso, a checagem real é visual: reler o arquivo inteiro contra `drive-provision/index.ts` e `stream-ingest/index.ts` (que já rodam em produção) e confirmar que os mesmos padrões de import, tipos e tratamento de erro foram seguidos.

- [ ] **Step 4: Deploy**

```bash
cd /Users/caiorizzuttl/comercial-lumos
supabase functions deploy boas-vindas-upload --no-verify-jwt
```

- [ ] **Step 5: Verificar com curl (esperando erro de token inválido, já que ainda não existe cliente de teste com esse fluxo rodado)**

```bash
curl -s -X POST "https://byntpekyfhzwfihjhzuo.supabase.co/functions/v1/boas-vindas-upload" \
  -F "token=token-que-nao-existe" -F "item_key=logo" -F "nome_pessoa=Teste" \
  -F "arquivo=@/dev/null;type=image/png"
```

Expected: `{"error":"token inválido"}` com status 401 — confirma que a função valida o token antes de tentar qualquer coisa no Drive.

- [ ] **Step 6: Commit**

```bash
git add src/lib/notifications/events.ts supabase/functions/boas-vindas-upload/index.ts
git commit -m "feat(portal): edge function de upload do Bem-vindo à Lumos

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Componente de frontend `BoasVindasLumos.tsx`

**Files:**
- Create: `src/pages/portal/BoasVindasLumos.tsx`
- Modify: `src/pages/portalCliente.css.ts` (adicionar classes novas ao fim do arquivo, antes do fechamento da template string)

**Interfaces:**
- Consumes: RPC `get_boas_vindas_lumos(p_token)` e `marcar_item_boas_vindas(p_token, p_item_key, p_nome_pessoa)` (Task 1); edge function `POST /functions/v1/boas-vindas-upload` (Task 2), contrato `{ ok, drive_file_id, nome_arquivo }` em sucesso ou `{ error }`.
- Produces: componente `BoasVindasLumos`, props `{ token: string; nomePessoa: string }` (o `nomePessoa` é o mesmo nome que o portal já captura hoje, sem login — ver `PortalCliente.tsx`, estado usado pra "quem pediu" nas Diárias). Task 4 importa e renderiza este componente.

- [ ] **Step 1: Adicionar as classes CSS**

No fim de `PORTAL_CSS` em `src/pages/portalCliente.css.ts` (antes do fechamento `` ` `` da template string), seguindo a mesma convenção de nomes curtos em português já usada no arquivo (`.secao`, `.rotulo`, `.selo`):

```css
  /* ── Bem-vindo à Lumos ──────────────────────────────────────── */
  .boas-vindas .intro { color: var(--meia-luz); max-width: 60ch; margin-bottom: 28px; }
  .boas-vindas .itens { display: grid; gap: 14px; }
  .item-bv {
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
    padding: 18px 20px; border: 1px solid var(--fio); border-radius: 10px; background: var(--mesa);
  }
  .item-bv .nome { font-weight: 600; }
  .item-bv .desc { color: var(--meia-luz); font-size: 13px; margin-top: 4px; }
  .item-bv .status { display: flex; align-items: center; gap: 10px; }
  .item-bv .feito { color: var(--aprovado); font-family: "DM Mono", monospace; font-size: 13px; }
  .item-bv .reenviar { color: var(--meia-luz); font-size: 12px; text-decoration: underline; cursor: pointer; background: none; border: none; padding: 0; }
  .item-bv .botao {
    background: var(--luz); color: var(--sala); border: none; border-radius: 8px;
    padding: 10px 16px; font-weight: 600; cursor: pointer;
  }
  .item-bv .botao:disabled { opacity: .5; cursor: default; }
  .item-bv input[type="file"] { display: none; }
```

- [ ] **Step 2: Escrever o componente**

```tsx
import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';

type ItemKey = 'logo' | 'brand_book' | 'guidelines' | 'acessos';

type ItemStatus = {
  item_key: ItemKey;
  tipo: 'arquivo' | 'manual';
  nome_arquivo: string | null;
  concluido_em: string | null;
  concluido_por: string | null;
};

const ITENS: { key: ItemKey; nome: string; desc: string; tipo: 'arquivo' | 'manual' }[] = [
  { key: 'logo', nome: 'Logo', desc: 'Em alta resolução, de preferência vetorial (AI, EPS ou SVG), ou um PNG bem grande se não tiver outro.', tipo: 'arquivo' },
  { key: 'brand_book', nome: 'Brand book', desc: 'O documento com as diretrizes visuais da sua marca, se você tiver um.', tipo: 'arquivo' },
  { key: 'guidelines', nome: 'Guidelines de conteúdo', desc: 'Como sua marca fala, o que evitar, referências de tom.', tipo: 'arquivo' },
  { key: 'acessos', nome: 'Acessos', desc: 'Convide contato@produtoralumos.com.br como editor nas contas que vamos mexer (redes sociais, Drive etc.), e marca aqui quando fizer.', tipo: 'manual' },
];

const EDGE_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/boas-vindas-upload`;

export default function BoasVindasLumos({ token, nomePessoa }: { token: string; nomePessoa: string }) {
  const [itens, setItens] = useState<Record<string, ItemStatus>>({});
  const [carregando, setCarregando] = useState(true);
  const [enviando, setEnviando] = useState<ItemKey | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await supabase.rpc('get_boas_vindas_lumos', { p_token: token });
    if (!error && data && !data.error) {
      const mapa: Record<string, ItemStatus> = {};
      for (const it of data.itens as ItemStatus[]) mapa[it.item_key] = it;
      setItens(mapa);
    }
    setCarregando(false);
  }, [token]);

  useEffect(() => { carregar(); }, [carregar]);

  const enviarArquivo = useCallback(async (key: ItemKey, arquivo: File) => {
    setEnviando(key);
    setErro(null);
    try {
      const form = new FormData();
      form.append('token', token);
      form.append('item_key', key);
      form.append('nome_pessoa', nomePessoa);
      form.append('arquivo', arquivo);
      const res = await fetch(EDGE_FUNCTION_URL, { method: 'POST', body: form });
      const body = await res.json();
      if (!res.ok || body.error) throw new Error(body.error || 'falha ao enviar');
      await carregar();
    } catch (err) {
      setErro('Não deu pra enviar agora. Tenta de novo, ou manda por WhatsApp/e-mail enquanto isso.');
    } finally {
      setEnviando(null);
    }
  }, [token, nomePessoa, carregar]);

  const marcarManual = useCallback(async (key: ItemKey) => {
    setEnviando(key);
    setErro(null);
    try {
      const { data, error } = await supabase.rpc('marcar_item_boas_vindas', {
        p_token: token, p_item_key: key, p_nome_pessoa: nomePessoa,
      });
      if (error || data?.error) throw new Error(data?.error || 'falha ao marcar');
      await carregar();
    } catch (err) {
      setErro('Não deu pra marcar agora. Tenta de novo em instantes.');
    } finally {
      setEnviando(null);
    }
  }, [token, nomePessoa, carregar]);

  if (carregando) return <div className="boas-vindas"><p className="intro">Carregando…</p></div>;

  return (
    <div className="boas-vindas">
      <p className="intro">
        Que bom te ter por aqui. Antes de começarmos a gravar, precisamos de algumas coisas
        suas, pra já sair com a cara certa desde o primeiro vídeo. Manda o que puder abaixo,
        no seu tempo, a gente avisa o time a cada item recebido.
      </p>
      {erro && <p className="intro" style={{ color: 'var(--ajuste)' }}>{erro}</p>}
      <div className="itens">
        {ITENS.map(def => {
          const status = itens[def.key];
          const concluido = !!status;
          const carregandoEste = enviando === def.key;
          return (
            <div className="item-bv" key={def.key}>
              <div>
                <div className="nome">{def.nome}</div>
                <div className="desc">{def.desc}</div>
                {concluido && (
                  <div className="feito">
                    {status.nome_arquivo || 'Concluído'} · {status.concluido_por || 'cliente'}
                  </div>
                )}
              </div>
              <div className="status">
                {def.tipo === 'arquivo' ? (
                  <>
                    <input
                      ref={el => { inputRefs.current[def.key] = el; }}
                      type="file"
                      onChange={e => {
                        const f = e.target.files?.[0];
                        if (f) enviarArquivo(def.key, f);
                        e.target.value = '';
                      }}
                    />
                    <button
                      type="button"
                      className={concluido ? 'reenviar' : 'botao'}
                      disabled={carregandoEste}
                      onClick={() => inputRefs.current[def.key]?.click()}
                    >
                      {carregandoEste ? 'Enviando…' : concluido ? 'Reenviar' : 'Enviar arquivo'}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className={concluido ? 'reenviar' : 'botao'}
                    disabled={carregandoEste || concluido}
                    onClick={() => marcarManual(def.key)}
                  >
                    {carregandoEste ? 'Marcando…' : concluido ? 'Concluído' : 'Marcar como feito'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Checar tipos**

Run: `cd /Users/caiorizzuttl/comercial-lumos && npx tsc --noEmit`
Expected: nenhum erro novo introduzido por `BoasVindasLumos.tsx` (erros pré-existentes no resto do projeto, se houver, não são desta tarefa).

- [ ] **Step 4: Commit**

```bash
git add src/pages/portal/BoasVindasLumos.tsx src/pages/portalCliente.css.ts
git commit -m "feat(portal): componente do checklist Bem-vindo à Lumos

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Plugar a aba em `PortalCliente.tsx`

**Files:**
- Modify: `src/pages/PortalCliente.tsx:1019-1062` (nav), `:1604` (bloco de renderização, logo após o bloco `atendimento`)

**Interfaces:**
- Consumes: `BoasVindasLumos` (Task 3), export default de `src/pages/portal/BoasVindasLumos.tsx`.
- Produces: nada consumido por outra tarefa — esta é a última peça de código.

- [ ] **Step 1: Importar o componente**

No topo de `src/pages/PortalCliente.tsx`, junto dos outros imports de página/componente:

```tsx
import BoasVindasLumos from './portal/BoasVindasLumos';
```

- [ ] **Step 2: Adicionar o botão de navegação**

Em `PortalCliente.tsx`, dentro do `<nav className="navegacao" ...>` (linha 1019-1062), acrescentar um botão irmão do de "Atendimento", com o mesmo padrão `aria-current`/`onClick`:

```tsx
<button type="button" className="link" aria-current={aba === 'boas_vindas'}
  onClick={() => setAba('boas_vindas')}>
  Bem-vindo à Lumos
</button>
```

- [ ] **Step 3: Adicionar o bloco de renderização**

Logo depois do bloco `{aba === 'atendimento' && (...)}` (linha 1604 em diante), antes do fechamento do container principal:

```tsx
{aba === 'boas_vindas' && (
  <BoasVindasLumos token={token} nomePessoa={nome || 'cliente'} />
)}
```

Usar exatamente as variáveis `token` e `nome` já existentes no escopo do componente `PortalCliente` (são as mesmas usadas hoje pra identificar quem está preenchendo um pedido de diária, sem exigir login).

- [ ] **Step 4: Checar tipos**

Run: `cd /Users/caiorizzuttl/comercial-lumos && npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 5: Rodar localmente e conferir visualmente**

```bash
cd /Users/caiorizzuttl/comercial-lumos && npm run dev
```

Abrir `http://localhost:5173/portal/<token-de-um-cliente-real-com-portal-ativo>`, clicar em "Bem-vindo à Lumos" na navegação, confirmar que os 4 itens aparecem, todos pendentes (se o cliente escolhido nunca preencheu nada).

- [ ] **Step 6: Commit**

```bash
git add src/pages/PortalCliente.tsx
git commit -m "feat(portal): pluga a aba Bem-vindo à Lumos na navegação do portal

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Verificação de ponta a ponta

**Files:** nenhum arquivo novo — esta tarefa só verifica o que as tarefas 1-4 produziram.

**Interfaces:** nenhuma — tarefa terminal.

- [ ] **Step 1: Aplicar a migração manualmente**

Isto é do Caio, não do executor deste plano: abrir o SQL Editor do Supabase (projeto `byntpekyfhzwfihjhzuo`), colar o conteúdo de `supabase/migrations/2026093342_boas_vindas_lumos.sql`, rodar, e rodar as duas consultas de conferência do fim do arquivo (Task 1, Step 2). **O executor do plano deve parar aqui e pedir pro Caio confirmar que rodou**, antes de seguir pro resto desta tarefa.

- [ ] **Step 2: Enviar um arquivo de verdade pelo portal**

Usando um cliente real com portal ativo (ex.: Vitru, já usada em outras verificações deste projeto — conferir com o Caio se ainda serve, ou pedir outro cliente de teste): abrir a aba "Bem-vindo à Lumos", enviar um arquivo pequeno (ex.: uma imagem PNG qualquer) no item "Logo".

Expected: o item passa a mostrar "concluído", com o nome do arquivo.

- [ ] **Step 3: Conferir no Drive**

No painel do Google Drive, abrir `Clientes/<nome do cliente>/_ASSETS/LOGOS` e confirmar que o arquivo chegou lá.

- [ ] **Step 4: Conferir a notificação**

Logado como um usuário `admin` no app interno, checar o sino de notificações e confirmar que chegou uma notificação "Bem-vindo à Lumos: novo material recebido".

- [ ] **Step 5: Marcar o item manual**

No mesmo portal, clicar em "Marcar como feito" no item "Acessos". Expected: vira "concluído" sem pedir arquivo.

- [ ] **Step 6: Conferir isolamento entre clientes**

Pegar o token do portal de OUTRO cliente e rodar:

```bash
curl -s "https://byntpekyfhzwfihjhzuo.supabase.co/rest/v1/rpc/get_boas_vindas_lumos" \
  -H "apikey: <chave anon do projeto>" -H "Content-Type: application/json" \
  -d '{"p_token": "<token-do-outro-cliente>"}'
```

Expected: devolve os itens **daquele** cliente (provavelmente todos pendentes), nunca os do cliente do Step 2 — confirma que a RPC filtra por `client_id` corretamente.

- [ ] **Step 7: Reenvio**

No item "Logo" já concluído (Step 2), clicar em "Reenviar" e mandar outro arquivo. Expected: sobrescreve o registro (mesmo `item_key`, `drive_file_id` novo), sem duplicar linha na tabela (a `UNIQUE (client_id, item_key)` mais o `upsert` garantem isso).
