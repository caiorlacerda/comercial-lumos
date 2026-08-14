-- CUSTOS DE PROJETO — colunas por usuário + encerramento do projeto
--
-- 1) Cada pessoa escolhe as colunas que quer ver na lista, e a escolha segue
--    ela em qualquer computador (por isso banco, e não localStorage).
-- 2) Projeto pode ser encerrado e sai da lista principal pra aba "Encerrados",
--    sem apagar nada: é só uma data em projetos_financeiro.

-- ───────────────────────────────────────────────────────────────────────────
-- 1) Preferências de tela, por usuário
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_view_prefs (
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  view_key   text NOT NULL,
  prefs      jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, view_key)
);

ALTER TABLE public.user_view_prefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_view_prefs_own ON public.user_view_prefs;
CREATE POLICY user_view_prefs_own ON public.user_view_prefs
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT ALL ON public.user_view_prefs TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 2) Encerramento do projeto no financeiro
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.projetos_financeiro
  ADD COLUMN IF NOT EXISTS encerrado_em  timestamptz,
  ADD COLUMN IF NOT EXISTS encerrado_por uuid REFERENCES public.app_users(id) ON DELETE SET NULL;

-- A view foi escrita como "select p.*", e o Postgres congela esse * na criação.
-- Sem recriar, as colunas novas não apareceriam pro app. CREATE OR REPLACE não
-- resolve porque as colunas entram no meio da lista, então é DROP e cria de novo
-- com o mesmo corpo.
DROP VIEW IF EXISTS vw_rentabilidade;
CREATE VIEW vw_rentabilidade AS
SELECT
  p.*,
  round(p.valor_vendido * p.nf_percent, 2)                          AS valor_nf,
  round(p.valor_vendido * (1 - p.nf_percent), 2)                    AS receita_liquida,
  round(p.valor_vendido - p.custos_total, 2)                        AS lucro_operacional,
  round(p.valor_vendido * (1 - p.nf_percent) - p.custos_total, 2)   AS lucro_liquido,
  CASE WHEN p.valor_vendido > 0
       THEN round((p.valor_vendido * (1 - p.nf_percent) - p.custos_total)
                  / p.valor_vendido, 4)
       ELSE 0 END                                                   AS margem,
  (p.status_titulo = 'esperando_pagamento'
     AND p.data_recebimento_negociada < current_date)               AS vencido
FROM projetos_financeiro p;

GRANT SELECT ON vw_rentabilidade TO authenticated;

CREATE INDEX IF NOT EXISTS idx_projetos_financeiro_encerrado
  ON public.projetos_financeiro(encerrado_em);
