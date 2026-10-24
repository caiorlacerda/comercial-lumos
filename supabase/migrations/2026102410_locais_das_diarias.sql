-- LOCAIS DAS DIÁRIAS: cadastro central de locais (do cliente ou geral)
--
-- Hoje o "Local" da diária é só texto livre, então "Escritório Shopee", "shopee escritorio" e
-- "Shopee - escritório" viram três locais. Esta migration cria o cadastro `locais` e liga cada
-- diária a um local por `project_diarias.local_id`.
--
-- O texto `project_diarias.local` CONTINUA sendo a fonte do que aparece na OD, no Google Calendar
-- e no Maps: o cadastro só alimenta o seletor. Nada que já existe quebra.
--
-- Quem pode ler e escrever: qualquer pessoa da equipe (is_team()). Sem acesso de anon: o portal do
-- cliente não enxerga esta tabela (nesta primeira versão o pedido de diária pelo portal segue em texto).
--
-- Idempotente. REVERSÃO: bloco comentado no fim do arquivo.

-- 1) Tabela --------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.locais (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome        text NOT NULL CHECK (length(btrim(nome)) > 0),
  endereco    text,
  observacoes text,                                              -- estacionamento, quem recebe, acesso de equipamento...
  client_id   uuid REFERENCES public.clients(id) ON DELETE SET NULL,  -- NULL = local geral (vale para qualquer cliente)
  created_by  uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Sem nome repetido para o mesmo cliente (ou entre os gerais), ignorando maiúsculas e espaços nas pontas.
CREATE UNIQUE INDEX IF NOT EXISTS locais_nome_cliente_uq
  ON public.locais (lower(btrim(nome)), COALESCE(client_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS locais_client_idx ON public.locais (client_id);

-- 2) Segurança: só equipe ativa -------------------------------------------------------------------
ALTER TABLE public.locais ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS locais_equipe ON public.locais;
CREATE POLICY locais_equipe ON public.locais FOR ALL TO authenticated
  USING ((SELECT public.is_team())) WITH CHECK ((SELECT public.is_team()));

-- Mesma regra restritiva das outras tabelas (ver 2026102300_somente_equipe.sql).
DROP POLICY IF EXISTS somente_equipe ON public.locais;
CREATE POLICY somente_equipe ON public.locais AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.is_team())) WITH CHECK ((SELECT public.is_team()));

-- 3) Diária aponta para o local -------------------------------------------------------------------
ALTER TABLE public.project_diarias
  ADD COLUMN IF NOT EXISTS local_id uuid REFERENCES public.locais(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS project_diarias_local_idx ON public.project_diarias (local_id);

-- 4) Importação única: os locais que já foram digitados nas diárias ---------------------------------
-- Um local por (cliente, texto igual ignorando maiúsculas). O nome é o texto como foi digitado;
-- depois é só abrir o local no app para acertar o nome e acrescentar o endereço.
INSERT INTO public.locais (nome, client_id)
SELECT DISTINCT ON (lower(btrim(d.local)), p.client_id) btrim(d.local), p.client_id
FROM public.project_diarias d
JOIN public.projects p ON p.id = d.project_id
WHERE d.local IS NOT NULL AND btrim(d.local) <> ''
ORDER BY lower(btrim(d.local)), p.client_id, d.data DESC NULLS LAST
ON CONFLICT DO NOTHING;

UPDATE public.project_diarias d
SET local_id = l.id
FROM public.projects p, public.locais l
WHERE p.id = d.project_id
  AND d.local_id IS NULL
  AND d.local IS NOT NULL AND btrim(d.local) <> ''
  AND lower(btrim(l.nome)) = lower(btrim(d.local))
  AND l.client_id IS NOT DISTINCT FROM p.client_id;

-- CONFERÊNCIA (leitura): quantos locais nasceram da importação e quantas diárias ficaram ligadas.
SELECT (SELECT count(*) FROM public.locais)                                        AS locais_cadastrados,
       (SELECT count(*) FROM public.project_diarias WHERE local_id IS NOT NULL)    AS diarias_ligadas,
       (SELECT count(*) FROM public.project_diarias WHERE local IS NOT NULL AND btrim(local) <> '' AND local_id IS NULL) AS diarias_com_texto_sem_ligacao;

-- REVERSÃO (rode só se precisar desfazer; as diárias continuam com o texto do local):
--   ALTER TABLE public.project_diarias DROP COLUMN IF EXISTS local_id;
--   DROP TABLE IF EXISTS public.locais;
