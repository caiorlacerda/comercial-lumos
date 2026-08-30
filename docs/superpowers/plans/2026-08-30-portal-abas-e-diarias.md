# Portal com abas e pedido de diária — plano de implementação

> **Para quem executa:** use `subagent-driven-development` (recomendado) ou
> `executing-plans` para tocar tarefa a tarefa. Os passos usam `- [ ]`.

**Objetivo:** dar abas à página de projeto do portal do cliente e fechar o ciclo
do pedido de diária: o cliente vê o pacote, vê os dias livres, pede; a Lumos
aceita ou recusa, e aceitar cria a diária de verdade.

**Arquitetura:** o portal continua falando só com RPCs `SECURITY DEFINER`
autenticadas pelo token do portal — nunca com tabelas. O que já existe segue
vindo de `get_client_portal_v2` numa tacada; a aba Diárias tem RPC própria,
buscada quando a aba abre, para não pesar a abertura do portal. Do lado de
dentro, o time é `authenticated` e fala com as tabelas direto, exceto aceitar um
pedido, que é uma função para as duas escritas não ficarem pela metade.

**Stack:** Vite 8 + React 19 + TS 6 + Tailwind 4, Supabase (Postgres/RLS/RPC),
deploy Vercel a partir da `main`.

**Spec:** `docs/superpowers/specs/2026-08-30-portal-abas-e-diarias-design.md`

## Restrições globais

- **A IA nunca roda SQL.** Toda migração é entregue como bloco pronto pra colar,
  e o Caio roda no Supabase. A tarefa só avança depois que ele confirmar.
- **Nunca expor a `service_role`.** O portal usa a anon key, como hoje.
- **Não existe framework de teste no repo.** O lugar do teste é um script de
  verificação por RPC (anônimo, igual ao cliente) mais conferência no navegador.
- **Teste só no projeto `Produção Teste`.** Nada de escrever em projeto de
  cliente real.
- **`npm run build` tem que sair com `exit=0`** antes de qualquer commit.
- **Copy da interface sem travessão nem hífen de aparte:** usar vírgula.
- **Desktop (`lg:`) não regride.** Mudança de UX é mobile-first.
- **Migrações** em `supabase/migrations/`, nome `AAAAMMDDNN_descricao.sql`,
  seguindo a numeração: a última é `2026093328_login_do_cliente.sql`.
- Scripts de verificação ficam no scratchpad da sessão, não no repo.

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/2026093329_pedido_de_diaria.sql` (criar) | tabelas, coluna nova, RLS, trigger de notificação |
| `supabase/migrations/2026093330_portal_agenda.sql` (criar) | RPCs do portal: agenda, pedir, cancelar |
| `supabase/migrations/2026093331_aceitar_pedido.sql` (criar) | `aceitar_pedido_diaria`, do lado de dentro |
| `src/lib/notifications/events.ts` (editar) | evento `diaria_solicitada` no catálogo |
| `src/pages/PortalCliente.tsx` (editar) | abas do projeto e a aba Diárias |
| `src/pages/portalCliente.css.ts` (editar) | estilo das abas, do calendário e do formulário |
| `src/components/producao/PedidosDeDiaria.tsx` (criar) | fila de pedidos, aceitar/recusar, dentro da aba Diárias |
| `src/components/producao/ProjectDiarias.tsx` (editar) | monta a fila no topo |
| `src/components/producao/BloqueiosDeAgenda.tsx` (criar) | datas que a Lumos fecha na mão |

---

### Tarefa 1: Banco — pedidos, bloqueios e a notificação

**Arquivos:**
- Criar: `supabase/migrations/2026093329_pedido_de_diaria.sql`
- Editar: `src/lib/notifications/events.ts`

**Interfaces:**
- Produz: tabela `diaria_pedidos` (colunas abaixo), tabela `agenda_bloqueios`,
  coluna `client_portals.antecedencia_dias int NOT NULL DEFAULT 7`, evento de
  notificação `diaria_solicitada`.

- [ ] **Passo 1: escrever a migração**

```sql
-- 2026093329_pedido_de_diaria.sql
-- O cliente pede uma data de gravação pelo portal; a Lumos aceita ou recusa.

CREATE TABLE IF NOT EXISTS public.diaria_pedidos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  client_id      uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  client_user_id uuid REFERENCES public.client_users(id) ON DELETE SET NULL,
  nome           text NOT NULL,
  email          text NOT NULL,
  data_desejada  date NOT NULL,
  duracao_horas  numeric(4,1) NOT NULL DEFAULT 10,
  local          text,
  descricao      text NOT NULL,
  fora_do_pacote boolean NOT NULL DEFAULT false,
  estado         text NOT NULL DEFAULT 'pendente'
                 CHECK (estado IN ('pendente','aceito','recusado','cancelado')),
  motivo_recusa  text,
  diaria_id      uuid REFERENCES public.project_diarias(id) ON DELETE SET NULL,
  respondido_por uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  respondido_em  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_diaria_pedidos_projeto ON public.diaria_pedidos(project_id);
CREATE INDEX IF NOT EXISTS idx_diaria_pedidos_estado  ON public.diaria_pedidos(estado);
-- Um pedido pendente por dia POR CLIENTE. Clientes diferentes podem disputar a
-- mesma data: quem a Lumos aceitar primeiro ocupa o dia.
CREATE UNIQUE INDEX IF NOT EXISTS idx_diaria_pedidos_um_por_dia
  ON public.diaria_pedidos(client_id, data_desejada)
  WHERE estado = 'pendente';

CREATE TABLE IF NOT EXISTS public.agenda_bloqueios (
  data       date PRIMARY KEY,
  motivo     text,
  criado_por uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.client_portals
  ADD COLUMN IF NOT EXISTS antecedencia_dias int NOT NULL DEFAULT 7;

-- RLS: o portal NÃO fala com estas tabelas, fala com as RPCs. Aqui só o time.
ALTER TABLE public.diaria_pedidos   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agenda_bloqueios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "time le e escreve pedidos" ON public.diaria_pedidos;
CREATE POLICY "time le e escreve pedidos" ON public.diaria_pedidos
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "time le e escreve bloqueios" ON public.agenda_bloqueios;
CREATE POLICY "time le e escreve bloqueios" ON public.agenda_bloqueios
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Notificação por TRIGGER, não pelo cliente: o portal roda como anon e uma
-- chamada de notify() de lá esbarra na RLS. Mesmo motivo das outras rotas
-- públicas do app.
CREATE OR REPLACE FUNCTION public.notificar_pedido_de_diaria()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  u        RECORD;
  v_proj   text;
  v_quando text;
BEGIN
  SELECT name INTO v_proj FROM projects WHERE id = NEW.project_id;
  v_quando := to_char(NEW.data_desejada, 'DD/MM');
  FOR u IN
    SELECT id FROM app_users
    WHERE status = 'ativo' AND (role IN ('admin','producao') OR role = 'atendimento')
  LOOP
    INSERT INTO notifications (user_id, event_type, category, priority, title, body, link, data)
    VALUES (
      u.id, 'diaria_solicitada', 'producao', 'high',
      'Cliente pediu uma diária 📅',
      NEW.nome || ' pediu ' || v_quando || ' em ' || COALESCE(v_proj, 'um projeto') || '.',
      '/producao/projetos?projectId=' || NEW.project_id::text || '&aba=diarias',
      jsonb_build_object('pedido_id', NEW.id, 'project_id', NEW.project_id)
    );
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notificar_pedido_de_diaria falhou para %: %', NEW.id, SQLERRM;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_notificar_pedido_de_diaria ON public.diaria_pedidos;
CREATE TRIGGER trg_notificar_pedido_de_diaria
  AFTER INSERT ON public.diaria_pedidos
  FOR EACH ROW EXECUTE FUNCTION public.notificar_pedido_de_diaria();
```

- [ ] **Passo 2: entregar o SQL pro Caio rodar e esperar a confirmação**

Não seguir sem o "rodei". Se der erro, ler a mensagem inteira antes de propor
correção.

- [ ] **Passo 3: conferir que as tabelas existem, com a anon key**

```bash
KEY=$(grep -m1 '^VITE_SUPABASE_ANON_KEY=' .env | cut -d= -f2-)
URL=$(grep -m1 '^VITE_SUPABASE_URL=' .env | cut -d= -f2-)
# anon não enxerga nada (RLS só libera authenticated): 200 com lista vazia
curl -s -o /dev/null -w 'pedidos=%{http_code}\n' \
  "$URL/rest/v1/diaria_pedidos?select=id" -H "apikey: $KEY"
```

Esperado: `pedidos=200` com corpo `[]`. Qualquer 404 significa que a migração
não rodou.

- [ ] **Passo 4: registrar o evento no catálogo de notificações**

Em `src/lib/notifications/events.ts`, dentro do bloco `// PRODUÇÃO`, depois de
`CLIENTE_ABRIU_LINK`:

```ts
  DIARIA_SOLICITADA: { key: 'diaria_solicitada', category: 'producao', label: 'Cliente pediu uma diária pelo portal', defaultEnabled: true, priority: 'high' },
```

- [ ] **Passo 5: build e commit**

```bash
npm run build && git add -A && git commit -m "feat(diárias): o cliente pode pedir uma data, e o pedido tem dono"
```

---

### Tarefa 2: RPC `portal_agenda`

**Arquivos:**
- Criar: `supabase/migrations/2026093330_portal_agenda.sql`

**Interfaces:**
- Consome: `diaria_pedidos`, `agenda_bloqueios`, `client_portals.antecedencia_dias` (Tarefa 1).
- Produz: `portal_agenda(p_token text, p_project_id uuid) → jsonb` com as chaves
  `dias` (`[{data, estado}]`, estado em `livre|ocupado|bloqueado|cedo`),
  `agendadas` (`[{data, hora_inicio, hora_fim, local, nome}]`),
  `pacote` (`{meta, realizado}` ou `null`) e
  `pedidos` (`[{id, data_desejada, estado, motivo_recusa, fora_do_pacote}]`).

- [ ] **Passo 1: escrever a migração**

```sql
-- 2026093330_portal_agenda.sql
-- O calendário que o cliente enxerga. Devolve o ESTADO do dia, nunca o dono
-- dele: quantos clientes temos e quando estamos parados não é assunto do
-- cliente.
CREATE OR REPLACE FUNCTION public.portal_agenda(p_token text, p_project_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_portal RECORD;
  v_email  text;
  v_pessoa uuid := NULL;
  v_ok     boolean;
  v_ini    date := current_date;
  v_fim    date := current_date + 90;
  v_cedo   date;
BEGIN
  SELECT * INTO v_portal FROM client_portals WHERE token = p_token AND active = true;
  IF v_portal IS NULL THEN RETURN jsonb_build_object('error','invalid'); END IF;

  IF v_portal.exige_login THEN
    v_email := lower(COALESCE(auth.jwt() ->> 'email', ''));
    SELECT id INTO v_pessoa FROM client_users
    WHERE client_id = v_portal.client_id AND lower(email) = v_email AND ativo;
    IF v_pessoa IS NULL THEN RETURN jsonb_build_object('error','sem_acesso'); END IF;
  END IF;

  -- O projeto precisa ser do cliente, estar visível, e estar liberado pra esta
  -- pessoa quando ela tem projetos marcados.
  SELECT EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = p_project_id AND p.client_id = v_portal.client_id AND p.portal_visivel
      AND (v_pessoa IS NULL
           OR NOT EXISTS (SELECT 1 FROM client_user_projects WHERE client_user_id = v_pessoa)
           OR p.id IN (SELECT project_id FROM client_user_projects WHERE client_user_id = v_pessoa))
  ) INTO v_ok;
  IF NOT v_ok THEN RETURN jsonb_build_object('error','sem_acesso'); END IF;

  v_cedo := current_date + v_portal.antecedencia_dias;

  RETURN jsonb_build_object(
    'antecedencia_dias', v_portal.antecedencia_dias,
    'dias', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('data', d.dia, 'estado',
        CASE
          WHEN EXISTS (SELECT 1 FROM agenda_bloqueios b WHERE b.data = d.dia) THEN 'bloqueado'
          WHEN EXISTS (SELECT 1 FROM project_diarias pd WHERE pd.data = d.dia)  THEN 'ocupado'
          WHEN d.dia < v_cedo THEN 'cedo'
          ELSE 'livre'
        END) ORDER BY d.dia)
      FROM generate_series(v_ini, v_fim, interval '1 day') AS d(dia)
    ), '[]'::jsonb),
    'agendadas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'nome', pd.nome, 'data', pd.data, 'hora_inicio', pd.hora_inicio,
        'hora_fim', pd.hora_fim, 'local', pd.local) ORDER BY pd.data)
      FROM project_diarias pd
      WHERE pd.project_id = p_project_id AND pd.data IS NOT NULL
        AND pd.data >= current_date - 30
    ), '[]'::jsonb),
    'pacote', (
      SELECT jsonb_build_object('meta', x.meta, 'realizado', x.realizado)
      FROM escopo_do_mes(p_project_id, date_trunc('month', current_date)::date) x
      WHERE x.chave = 'diarias' AND x.periodo = 'mes' LIMIT 1
    ),
    'pedidos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', q.id, 'data_desejada', q.data_desejada, 'estado', q.estado,
        'motivo_recusa', q.motivo_recusa, 'fora_do_pacote', q.fora_do_pacote,
        'descricao', q.descricao) ORDER BY q.data_desejada)
      FROM diaria_pedidos q
      WHERE q.project_id = p_project_id
        AND (q.estado = 'pendente' OR q.respondido_em > now() - interval '30 days')
    ), '[]'::jsonb)
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.portal_agenda(text, uuid) TO anon, authenticated;
```

- [ ] **Passo 2: entregar o SQL e esperar o "rodei"**

- [ ] **Passo 3: escrever o script de verificação que ainda falha**

No scratchpad, `verifica-agenda.sh`. Usa o token do portal de teste e o id do
projeto `Produção Teste`:

```bash
KEY=$(grep -m1 '^VITE_SUPABASE_ANON_KEY=' .env | cut -d= -f2-)
URL=$(grep -m1 '^VITE_SUPABASE_URL=' .env | cut -d= -f2-)
curl -s -X POST "$URL/rest/v1/rpc/portal_agenda" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d "{\"p_token\":\"$TOKEN_TESTE\",\"p_project_id\":\"$PROJ_TESTE\"}" | python3 -m json.tool | head -40
```

- [ ] **Passo 4: rodar e conferir**

Esperado: 91 entradas em `dias`; os primeiros 7 com estado `cedo`; nenhum campo
que revele nome de outro cliente. Conferir também que trocar o `p_project_id`
por um projeto de OUTRO cliente devolve `{"error":"sem_acesso"}` — é o teste que
importa, porque é o vazamento que essa função poderia causar.

- [ ] **Passo 5: commit**

```bash
git add supabase/migrations/2026093330_portal_agenda.sql
git commit -m "feat(portal): o cliente enxerga os dias livres, sem saber de quem são os ocupados"
```

---

### Tarefa 3: RPCs de pedir e cancelar

**Arquivos:**
- Editar: `supabase/migrations/2026093330_portal_agenda.sql` (mesma migração, se
  o Caio ainda não rodou; senão criar `2026093330b_pedir_diaria.sql`)

**Interfaces:**
- Consome: `portal_agenda` (Tarefa 2).
- Produz: `portal_pedir_diaria(p_token, p_project_id, p_data, p_duracao, p_local, p_descricao, p_nome, p_email) → jsonb`
  (`{ok:true, id, fora_do_pacote}` ou `{error:'dia_ocupado'|'dia_bloqueado'|'cedo'|'repetido'|'sem_acesso'|'invalid'}`)
  e `portal_cancelar_pedido(p_token, p_pedido_id) → jsonb`.

- [ ] **Passo 1: escrever as funções**

```sql
CREATE OR REPLACE FUNCTION public.portal_pedir_diaria(
  p_token text, p_project_id uuid, p_data date, p_duracao numeric,
  p_local text, p_descricao text, p_nome text, p_email text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_portal RECORD;
  v_pessoa uuid := NULL;
  v_email  text;
  v_nome   text;
  v_ok     boolean;
  v_fora   boolean := false;
  v_meta   int;
  v_feito  bigint;
  v_id     uuid;
BEGIN
  SELECT * INTO v_portal FROM client_portals WHERE token = p_token AND active = true;
  IF v_portal IS NULL THEN RETURN jsonb_build_object('error','invalid'); END IF;

  IF v_portal.exige_login THEN
    v_email := lower(COALESCE(auth.jwt() ->> 'email',''));
    SELECT id, nome, email INTO v_pessoa, v_nome, v_email FROM client_users
    WHERE client_id = v_portal.client_id AND lower(email) = v_email AND ativo;
    IF v_pessoa IS NULL THEN RETURN jsonb_build_object('error','sem_acesso'); END IF;
  ELSE
    v_nome  := NULLIF(btrim(p_nome), '');
    v_email := lower(NULLIF(btrim(p_email), ''));
    IF v_nome IS NULL OR v_email IS NULL THEN RETURN jsonb_build_object('error','sem_nome'); END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = p_project_id AND p.client_id = v_portal.client_id AND p.portal_visivel
      AND (v_pessoa IS NULL
           OR NOT EXISTS (SELECT 1 FROM client_user_projects WHERE client_user_id = v_pessoa)
           OR p.id IN (SELECT project_id FROM client_user_projects WHERE client_user_id = v_pessoa))
  ) INTO v_ok;
  IF NOT v_ok THEN RETURN jsonb_build_object('error','sem_acesso'); END IF;

  IF p_data < current_date + v_portal.antecedencia_dias THEN
    RETURN jsonb_build_object('error','cedo');
  END IF;
  IF EXISTS (SELECT 1 FROM agenda_bloqueios WHERE data = p_data) THEN
    RETURN jsonb_build_object('error','dia_bloqueado');
  END IF;
  IF EXISTS (SELECT 1 FROM project_diarias WHERE data = p_data) THEN
    RETURN jsonb_build_object('error','dia_ocupado');
  END IF;
  IF EXISTS (SELECT 1 FROM diaria_pedidos
             WHERE client_id = v_portal.client_id AND data_desejada = p_data AND estado = 'pendente') THEN
    RETURN jsonb_build_object('error','repetido');
  END IF;
  IF btrim(COALESCE(p_descricao,'')) = '' THEN
    RETURN jsonb_build_object('error','sem_descricao');
  END IF;

  -- Congela a leitura do pacote NO MOMENTO DO PEDIDO: se o mês virar antes da
  -- resposta, o que o cliente viu na tela continua valendo.
  SELECT x.meta, x.realizado INTO v_meta, v_feito
  FROM escopo_do_mes(p_project_id, date_trunc('month', p_data)::date) x
  WHERE x.chave = 'diarias' AND x.periodo = 'mes' LIMIT 1;
  IF v_meta IS NOT NULL AND v_feito >= v_meta THEN v_fora := true; END IF;

  INSERT INTO diaria_pedidos (project_id, client_id, client_user_id, nome, email,
    data_desejada, duracao_horas, local, descricao, fora_do_pacote)
  VALUES (p_project_id, v_portal.client_id, v_pessoa, v_nome, v_email,
    p_data, COALESCE(p_duracao, 10), NULLIF(btrim(p_local),''), btrim(p_descricao), v_fora)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'fora_do_pacote', v_fora);
END; $$;

CREATE OR REPLACE FUNCTION public.portal_cancelar_pedido(p_token text, p_pedido_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_portal RECORD; v_n int;
BEGIN
  SELECT * INTO v_portal FROM client_portals WHERE token = p_token AND active = true;
  IF v_portal IS NULL THEN RETURN jsonb_build_object('error','invalid'); END IF;
  UPDATE diaria_pedidos SET estado = 'cancelado'
  WHERE id = p_pedido_id AND client_id = v_portal.client_id AND estado = 'pendente';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN RETURN jsonb_build_object('error','nao_encontrado'); END IF;
  RETURN jsonb_build_object('ok', true);
END; $$;

GRANT EXECUTE ON FUNCTION public.portal_pedir_diaria(text, uuid, date, numeric, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_cancelar_pedido(text, uuid) TO anon, authenticated;
```

- [ ] **Passo 2: entregar o SQL e esperar o "rodei"**

- [ ] **Passo 3: verificar cada recusa, uma a uma**

Contra o portal e o projeto de teste, esperar exatamente:

| chamada | esperado |
|---|---|
| data de amanhã | `{"error":"cedo"}` |
| data com diária marcada | `{"error":"dia_ocupado"}` |
| data em `agenda_bloqueios` | `{"error":"dia_bloqueado"}` |
| descrição vazia | `{"error":"sem_descricao"}` |
| data livre, daqui a 30 dias | `{"ok":true,...}` |
| a MESMA data de novo | `{"error":"repetido"}` |
| projeto de outro cliente | `{"error":"sem_acesso"}` |

Depois, cancelar o pedido criado e conferir que uma segunda chamada de cancelar
devolve `nao_encontrado`. **Cancelar limpa o teste**: não deixar pedido pendente
no banco.

- [ ] **Passo 4: conferir a notificação**

Depois do pedido que deu certo, a notificação `diaria_solicitada` tem que
existir para admin. Conferir na sineta do app.

- [ ] **Passo 5: commit**

```bash
git commit -am "feat(portal): pedido de diária com as recusas que importam"
```

---

### Tarefa 4: As abas na página do projeto (portal)

**Arquivos:**
- Editar: `src/pages/PortalCliente.tsx` (bloco `{projetoAberto && (...)}`)
- Editar: `src/pages/portalCliente.css.ts`

**Interfaces:**
- Produz: estado `abaProj` (`'geral' | 'entregas' | 'diarias' | 'arquivos'`) e a
  fita de abas dentro da folha do projeto. As seções que já existem passam a ser
  filhas de uma aba, sem mudar de conteúdo.

- [ ] **Passo 1: estado e reset ao trocar de projeto**

Em `PortalCliente.tsx`, junto dos outros estados:

```tsx
  /** Aba de dentro do projeto. Volta pra "geral" ao trocar de projeto: manter
   *  "diarias" ao pular pra outro projeto mostraria o calendário de um projeto
   *  que a pessoa nem olhou ainda. */
  const [abaProj, setAbaProj] = useState<'geral' | 'entregas' | 'diarias' | 'arquivos'>('geral');
  useEffect(() => { setAbaProj('geral'); }, [aba]);
```

- [ ] **Passo 2: a fita, logo abaixo de `.cabeca-proj`**

```tsx
            <nav className="fita fita-proj" aria-label="Seções do projeto">
              {([
                ['geral', 'Visão geral'],
                ['entregas', 'Entregas'],
                ['diarias', 'Diárias'],
                ['arquivos', 'Arquivos'],
              ] as const).map(([chave, rotulo]) => (
                (chave !== 'arquivos' || projetoAberto.arquivos.length > 0) && (
                  <button key={chave} type="button" className="link"
                    aria-current={abaProj === chave}
                    onClick={() => setAbaProj(chave)}>
                    {rotulo}
                    {chave === 'entregas' && projetoAberto.entregas.length > 0 && (
                      <span className="n">{projetoAberto.entregas.length}</span>
                    )}
                  </button>
                )
              ))}
            </nav>
```

- [ ] **Passo 3: envolver as seções que já existem**

- `Seu pacote neste mês` e `Onde o projeto está` → `{abaProj === 'geral' && (...)}`
- `Entregas` → `{abaProj === 'entregas' && (...)}`
- `Arquivos liberados` → `{abaProj === 'arquivos' && (...)}`

Não mudar o conteúdo de nenhuma delas nesta tarefa. Só o envelope.

- [ ] **Passo 4: estilo da fita interna**

Em `portalCliente.css.ts`, depois da regra `.fita`:

```css
  .fita-proj { padding: 0; margin: 22px 0 4px; border-bottom: 1px solid var(--fio); }
  .fita-proj .link { font-size: 12px; padding: 9px 13px; }
  .secao:first-of-type { padding-top: 26px; border-top: 0; }
```

- [ ] **Passo 5: conferir no navegador**

`npm run dev`, abrir o portal de teste, e conferir: as quatro abas aparecem, o
conteúdo de cada uma é o que era antes, trocar de projeto volta pra "Visão
geral", e no celular (375px) a fita rola na horizontal sem estourar a página.

- [ ] **Passo 6: build e commit**

```bash
npm run build && git commit -am "feat(portal): o projeto ganha abas, uma pra cada coisa que o cliente faz"
```

---

### Tarefa 5: A aba Diárias do cliente

**Arquivos:**
- Editar: `src/pages/PortalCliente.tsx`
- Editar: `src/pages/portalCliente.css.ts`

**Interfaces:**
- Consome: `portal_agenda`, `portal_pedir_diaria`, `portal_cancelar_pedido`.
- Produz: nada que outra tarefa use.

- [ ] **Passo 1: buscar a agenda só quando a aba abre**

```tsx
  type Agenda = {
    antecedencia_dias: number;
    dias: { data: string; estado: 'livre' | 'ocupado' | 'bloqueado' | 'cedo' }[];
    agendadas: { nome: string; data: string; hora_inicio: string | null; hora_fim: string | null; local: string | null }[];
    pacote: { meta: number; realizado: number } | null;
    pedidos: { id: string; data_desejada: string; estado: string; motivo_recusa: string | null; fora_do_pacote: boolean; descricao: string }[];
  };
  const [agenda, setAgenda] = useState<Agenda | null>(null);
  const [carregandoAgenda, setCarregandoAgenda] = useState(false);

  // Só quando a aba abre: a maioria das visitas não vai ao calendário, e ele
  // custa 90 dias de consulta.
  useEffect(() => {
    if (abaProj !== 'diarias' || !projetoAberto) return;
    let vivo = true;
    setCarregandoAgenda(true);
    supabase.rpc('portal_agenda', { p_token: token, p_project_id: projetoAberto.id })
      .then(({ data }) => { if (vivo) { setAgenda(data as Agenda); setCarregandoAgenda(false); } });
    return () => { vivo = false; };
  }, [abaProj, projetoAberto?.id, token]);
```

- [ ] **Passo 2: os três blocos**

Bloco do pacote (some quando `pacote` é nulo), bloco das agendadas, e o
calendário. Sobre o calendário: agrupar `dias` por mês e desenhar em grade de 7
colunas, com o primeiro dia deslocado por `new Date(d+'T12:00:00').getDay()`.
Classe por estado: `livre`, `ocupado`, `bloqueado`, `cedo`. Só `livre` é
clicável.

```tsx
{abaProj === 'diarias' && (
  <>
    {agenda?.pacote && (
      <section className="secao">
        <span className="rotulo">Suas diárias neste mês</span>
        <div className="proj" style={{ cursor: 'default' }}>
          <span><span className="nome">Diárias do pacote</span></span>
          <span className="barra">
            <i className={agenda.pacote.realizado >= agenda.pacote.meta ? 'b-ok' : 'b-voce'}
              style={{ width: `${Math.min(100, (agenda.pacote.realizado / agenda.pacote.meta) * 100)}%` }} />
          </span>
          <span className="contagem">{agenda.pacote.realizado} de {agenda.pacote.meta}</span>
        </div>
      </section>
    )}

    <section className="secao">
      <span className="rotulo">Gravações marcadas</span>
      {!agenda?.agendadas.length ? (
        <p className="nota">Nenhuma gravação marcada por enquanto.</p>
      ) : agenda.agendadas.map((g, i) => (
        <div key={i} className="arquivo">
          <span className="nm">{g.nome}<span>{dia(g.data)}{g.hora_inicio ? `, ${g.hora_inicio.slice(0,5)}` : ''}{g.local ? `, ${g.local}` : ''}</span></span>
        </div>
      ))}
    </section>

    <section className="secao">
      <span className="rotulo">Pedir uma data</span>
      {carregandoAgenda ? <span className="farol" /> : <Calendario agenda={agenda} onEscolher={setDataEscolhida} />}
    </section>
  </>
)}
```

`Calendario` fica no mesmo arquivo, como componente pequeno logo antes de
`PortalCliente`, porque só ele usa.

- [ ] **Passo 3: o formulário do pedido**

Abre embaixo do calendário quando há data escolhida. Campos: o que precisa
gravar (obrigatório), onde, duração (6h/10h/12h). Sem login, mais nome e
e-mail, com o valor guardado em `localStorage` (mesma ideia do `rev_nome` da
revisão pública).

O aviso de pacote estourado aparece **antes** de enviar:

```tsx
{agenda?.pacote && agenda.pacote.realizado >= agenda.pacote.meta && (
  <p className="nota alerta">
    Esta seria a {agenda.pacote.realizado + 1}ª diária de {agenda.pacote.meta} no mês.
    Ela entra como extra, e a Lumos vai orçar antes de confirmar.
  </p>
)}
```

- [ ] **Passo 4: enviar, e o que fazer com cada recusa**

```tsx
const MOTIVOS: Record<string, string> = {
  cedo: 'Esta data é cedo demais. Escolha um dia com mais folga.',
  dia_ocupado: 'Este dia acabou de ser ocupado. Escolha outro.',
  dia_bloqueado: 'Este dia não está disponível.',
  repetido: 'Você já tem um pedido em aberto para este dia.',
  sem_descricao: 'Conte o que precisa gravar.',
  sem_nome: 'Diga seu nome e seu e-mail.',
  sem_acesso: 'Este projeto não está disponível para você.',
};
```

Deu certo: limpar o formulário, recarregar `portal_agenda`, e mostrar o pedido
na lista com estado "esperando a Lumos".

- [ ] **Passo 5: meus pedidos**

Lista abaixo do calendário: data, o que foi pedido, e o estado. Pendente tem
"cancelar". Recusado mostra o motivo que a Lumos escreveu.

- [ ] **Passo 6: estilo do calendário**

```css
  .calend { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; margin-top: 10px; }
  .calend .dia { aspect-ratio: 1; display: grid; place-items: center; border-radius: 8px;
    font-family: "DM Mono", monospace; font-size: 12px; border: 1px solid transparent; }
  .calend .dia.livre { background: rgba(255,247,230,.05); color: var(--gesso); cursor: pointer; }
  .calend .dia.livre:hover { border-color: var(--luz); color: var(--luz); }
  .calend .dia.escolhido { background: var(--luz); color: #14110b; font-weight: 700; }
  .calend .dia.ocupado, .calend .dia.bloqueado { color: var(--meia-luz); opacity: .38; }
  .calend .dia.cedo { color: var(--meia-luz); opacity: .22; }
  .calend .cab { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: var(--meia-luz); }
```

- [ ] **Passo 7: conferir no navegador, no projeto de teste**

Pedir uma data livre, ver o pedido aparecer, cancelar, e conferir que o dia
volta a ficar pedível. Conferir em 375px que o calendário cabe sem rolagem
lateral.

- [ ] **Passo 8: build e commit**

```bash
npm run build && git commit -am "feat(portal): o cliente vê os dias livres e pede a diária por ali"
```

---

### Tarefa 6: A fila do lado de dentro

**Arquivos:**
- Criar: `src/components/producao/PedidosDeDiaria.tsx`
- Editar: `src/components/producao/ProjectDiarias.tsx` (montar a fila no topo)
- Criar: `supabase/migrations/2026093331_aceitar_pedido.sql`

**Interfaces:**
- Consome: `diaria_pedidos` (Tarefa 1).
- Produz: `aceitar_pedido_diaria(p_pedido_id uuid, p_confirmar boolean) → jsonb`
  (`{ok:true, diaria_id}` ou `{error:'dia_ocupado', ocupado_por:'...'}` quando a
  data ficou ocupada e `p_confirmar` é falso), e o componente
  `<PedidosDeDiaria projectId canManage onMudou />`.

- [ ] **Passo 1: a função que aceita**

```sql
-- 2026093331_aceitar_pedido.sql
-- Aceitar cria a diária E fecha o pedido. Duas escritas que não podem ficar
-- pela metade: pedido aceito sem diária vira gravação que ninguém marcou.
CREATE OR REPLACE FUNCTION public.aceitar_pedido_diaria(p_pedido_id uuid, p_confirmar boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_p      RECORD;
  v_eu     uuid;
  v_dono   text;
  v_diaria uuid;
BEGIN
  SELECT id INTO v_eu FROM app_users WHERE auth_user_id = auth.uid() AND status = 'ativo';
  IF v_eu IS NULL THEN RETURN jsonb_build_object('error','sem_permissao'); END IF;

  SELECT * INTO v_p FROM diaria_pedidos WHERE id = p_pedido_id AND estado = 'pendente';
  IF v_p IS NULL THEN RETURN jsonb_build_object('error','nao_encontrado'); END IF;

  -- Dia que ficou ocupado entre o pedido e a resposta: avisa em vez de recusar
  -- sozinha. Duas equipes no mesmo dia acontece, e quem decide é gente.
  SELECT string_agg(DISTINCT pr.name, ', ') INTO v_dono
  FROM project_diarias pd JOIN projects pr ON pr.id = pd.project_id
  WHERE pd.data = v_p.data_desejada;
  IF v_dono IS NOT NULL AND NOT p_confirmar THEN
    RETURN jsonb_build_object('error','dia_ocupado','ocupado_por', v_dono);
  END IF;

  INSERT INTO project_diarias (project_id, nome, data, duracao_horas, local, descricao, created_by)
  VALUES (v_p.project_id,
          'Gravação pedida pelo cliente',
          v_p.data_desejada, v_p.duracao_horas, v_p.local, v_p.descricao, v_eu)
  RETURNING id INTO v_diaria;

  UPDATE diaria_pedidos
  SET estado = 'aceito', diaria_id = v_diaria, respondido_por = v_eu, respondido_em = now()
  WHERE id = p_pedido_id;

  RETURN jsonb_build_object('ok', true, 'diaria_id', v_diaria);
END; $$;

GRANT EXECUTE ON FUNCTION public.aceitar_pedido_diaria(uuid, boolean) TO authenticated;
```

- [ ] **Passo 2: entregar o SQL e esperar o "rodei"**

- [ ] **Passo 3: o componente da fila**

`PedidosDeDiaria.tsx`: busca `diaria_pedidos` do projeto com `estado='pendente'`,
e some inteiro quando não há nenhum (fila vazia não ocupa tela). Cada pedido
mostra quem pediu, a data por extenso, a duração, o local, o que precisa gravar,
e o selo "fora do pacote" quando for o caso.

Aceitar chama a RPC. Se voltar `dia_ocupado`, abrir `useConfirm`:

```tsx
if (r?.error === 'dia_ocupado') {
  const seguir = await confirm({
    title: 'Esse dia já tem gravação',
    message: `Já existe diária em ${r.ocupado_por} nesse dia. Quer marcar assim mesmo?`,
    confirmLabel: 'Marcar assim mesmo',
  });
  if (seguir) await supabase.rpc('aceitar_pedido_diaria', { p_pedido_id: p.id, p_confirmar: true });
}
```

Recusar abre um campo de motivo (obrigatório, curto) e faz `update` direto na
tabela: `{ estado:'recusado', motivo_recusa, respondido_por, respondido_em }`.

- [ ] **Passo 4: montar no topo da aba Diárias**

Em `ProjectDiarias.tsx`, logo no começo do `return`, antes do cabeçalho:

```tsx
      <PedidosDeDiaria projectId={projectId} canManage={canManage} onMudou={load} />
```

`onMudou={load}` porque aceitar cria diária, e a lista de baixo precisa mostrar
ela na hora.

- [ ] **Passo 5: conferir o ciclo inteiro**

No projeto de teste: pedir pelo portal → ver a fila aparecer na aba Diárias →
aceitar → conferir que a diária existe com data, local, duração e descrição
certos, e que o pedido saiu da fila. Depois, um segundo pedido para recusar,
com motivo, e conferir que o motivo aparece no portal.

- [ ] **Passo 6: build e commit**

```bash
npm run build && git commit -am "feat(diárias): a fila de pedidos vive junto das diárias, e aceitar já marca"
```

---

### Tarefa 7: Datas que a Lumos fecha

**Arquivos:**
- Criar: `src/components/producao/BloqueiosDeAgenda.tsx`
- Editar: `src/components/producao/ProjectDiarias.tsx` (botão que abre)

**Interfaces:**
- Consome: `agenda_bloqueios` (Tarefa 1).
- Produz: nada que outra tarefa use.

Sem isto o estado `bloqueado` existe no banco e ninguém consegue criar um, o que
deixaria metade da Tarefa 2 sem uso.

- [ ] **Passo 1: o componente**

Lista as datas bloqueadas futuras, com motivo, e um formulário de uma linha
(data + motivo) para adicionar. Excluir remove. Só `canManage`.

- [ ] **Passo 2: abrir de dentro da aba Diárias**

Botão discreto "Datas bloqueadas" no cabeçalho da aba, que abre em `Modal`.

- [ ] **Passo 3: conferir**

Bloquear uma data, recarregar o portal, e conferir que o dia aparece
indisponível e não aceita pedido. Desbloquear e conferir que volta.

- [ ] **Passo 4: build e commit**

```bash
npm run build && git commit -am "feat(agenda): a Lumos fecha as datas que não estão de pé"
```

---

### Tarefa 8: Fechar

- [ ] **Passo 1: limpar o que o teste deixou**

Apagar as diárias e os pedidos criados no `Produção Teste`. Nenhum resto em
projeto de cliente.

- [ ] **Passo 2: `npm run build` limpo**

- [ ] **Passo 3: PR, merge e deploy**

Abrir PR da `f6` pra `main` pela API do GitHub (o `gh` não está instalado),
mergear, e esperar `version.json` mudar em `app.produtoralumos.com.br`.

- [ ] **Passo 4: conferir em produção**

Abrir o portal real, entrar na aba Diárias de um projeto, e conferir que o
calendário desenha e que os dias ocupados batem com as diárias marcadas. **Não
enviar pedido em projeto de cliente.**

- [ ] **Passo 5: contar o que ficou de fora**

Fase 2 (roteiro pro cliente, ordem do dia, e-mail de resposta) e fase 3 (pedidos
que não são diária, histórico do pacote, relatório em PDF) seguem na spec.
