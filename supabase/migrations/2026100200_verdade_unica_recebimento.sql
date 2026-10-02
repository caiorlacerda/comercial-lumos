-- VERDADE ÚNICA DE RECEBIMENTO — Custos de Projeto × Contas a Receber
--
-- Os dois lados guardam o mesmo fato (o título de um projeto: em que etapa
-- está e quando vence/foi pago) em tabelas diferentes, e só se falavam por
-- gatilhos que, em produção, nunca funcionaram direito (um deles quebrava por
-- causa de uma coluna inexistente). Resultado: telas que discordam.
--
-- Esta migration:
--   1) define UM vocabulário de etapas e o mapeamento exato entre as duas tabelas;
--   2) refaz os dois gatilhos (um por sentido) com esse mapeamento, sem loop;
--   3) alinha o "atrasado" da view com o de Contas a Receber;
--   4) cria reconciliar_recebimento(): prévia (só lê) e aplicação (com log) pra
--      acertar os dados que já divergem. NADA é alterado nos dados ao rodar
--      esta migration — o acerto só acontece quando alguém chama a função.
--
-- ETAPAS (mesma ordem nas duas tabelas):
--   etapa  projetos_financeiro.status_titulo   receivables.status
--     1    emitir_nf                           aguardando
--     2    pedido_nf_feito                     emitir_nf
--     3    esperando_pagamento                 nf_emitida   (+ parcial)
--     4    pagamento_recebido                  recebido
--   "Em atraso" (pagamento_atraso / inadimplente) conta como etapa 3: o atraso
--   passa a ser DERIVADO da data (vencimento passou e não recebeu), igual já
--   era em Contas a Receber.

-- ───────────────────────────────────────────────────────────────────────────
-- 1) Vocabulário único
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.etapa_titulo(s status_titulo) RETURNS int
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE s
    WHEN 'emitir_nf' THEN 1
    WHEN 'pedido_nf_feito' THEN 2
    WHEN 'esperando_pagamento' THEN 3
    WHEN 'pagamento_atraso' THEN 3
    WHEN 'pagamento_recebido' THEN 4
  END
$$;

CREATE OR REPLACE FUNCTION public.etapa_recebivel(s receivable_status) RETURNS int
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE s
    WHEN 'aguardando' THEN 1
    WHEN 'emitir_nf' THEN 2
    WHEN 'nf_emitida' THEN 3
    WHEN 'parcial' THEN 3
    WHEN 'inadimplente' THEN 3
    WHEN 'recebido' THEN 4
  END
$$;

CREATE OR REPLACE FUNCTION public.titulo_da_etapa(e int) RETURNS status_titulo
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE e
    WHEN 1 THEN 'emitir_nf'::status_titulo
    WHEN 2 THEN 'pedido_nf_feito'::status_titulo
    WHEN 3 THEN 'esperando_pagamento'::status_titulo
    WHEN 4 THEN 'pagamento_recebido'::status_titulo
  END
$$;

CREATE OR REPLACE FUNCTION public.recebivel_da_etapa(e int) RETURNS receivable_status
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE e
    WHEN 1 THEN 'aguardando'::receivable_status
    WHEN 2 THEN 'emitir_nf'::receivable_status
    WHEN 3 THEN 'nf_emitida'::receivable_status
    WHEN 4 THEN 'recebido'::receivable_status
  END
$$;

-- Data de recebimento plausível: ignora lixo de digitação (ex.: 01/09/96).
CREATE OR REPLACE FUNCTION public.data_recebimento_valida(d date) RETURNS date
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN d >= DATE '2020-01-01' AND d <= current_date + INTERVAL '5 years' THEN d END
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 2) Registro do que a conciliação mudar (pra poder desfazer)
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reconciliacao_recebimento_log (
  id                    bigserial PRIMARY KEY,
  executado_em          timestamptz NOT NULL DEFAULT now(),
  projeto_financeiro_id uuid,
  receivable_id         uuid,
  antes                 jsonb NOT NULL,
  depois                jsonb NOT NULL
);
ALTER TABLE public.reconciliacao_recebimento_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reconciliacao_recebimento_log FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.reconciliacao_recebimento_log_id_seq FROM PUBLIC, anon, authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 3) "Atrasado" igual nas duas telas: não recebeu e o vencimento já passou
-- ───────────────────────────────────────────────────────────────────────────
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
  (p.status_titulo <> 'pagamento_recebido'
     AND p.data_recebimento_negociada < current_date)               AS vencido
FROM projetos_financeiro p;
GRANT SELECT ON vw_rentabilidade TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 4) Contas a Receber -> Custos de Projeto
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_receivable_reflete_projeto()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_budget     uuid;
  v_n          int;
  v_total      numeric;
  v_recebido   numeric;
  v_ultimo     date;
  v_mexeu_status  boolean := false;   -- status ou data de recebimento da parcela mudou agora
  v_mexeu_venc    boolean := false;   -- vencimento da parcela mudou agora
  v_novo_status   receivable_status;
  v_novo_venc     date;
  r            RECORD;
  p            RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN v_budget := OLD.budget_id; ELSE v_budget := NEW.budget_id; END IF;
  IF v_budget IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  -- Um gatilho só propaga uma vez (o outro lado ignora o que veio do primeiro),
  -- e a conciliação em lote fala por si.
  IF pg_trigger_depth() > 1 OR current_setting('lumos.reconciliando', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_mexeu_status := OLD.status IS DISTINCT FROM NEW.status OR OLD.received_at IS DISTINCT FROM NEW.received_at;
    v_mexeu_venc   := OLD.due_date IS DISTINCT FROM NEW.due_date;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_novo_status := NEW.status;
    v_novo_venc   := NEW.due_date;
  END IF;

  SELECT * INTO p FROM projetos_financeiro WHERE proposta_id = v_budget ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  SELECT count(*), COALESCE(sum(total_amount), 0), COALESCE(sum(received_amount), 0),
         max((received_at AT TIME ZONE 'UTC')::date)
    INTO v_n, v_total, v_recebido, v_ultimo
  FROM receivables WHERE budget_id = v_budget AND status <> 'cancelado';
  IF v_n = 0 THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  SELECT * INTO r FROM receivables
  WHERE budget_id = v_budget AND status <> 'cancelado' ORDER BY created_at LIMIT 1;

  IF v_total > 0 AND v_recebido >= v_total THEN
    -- tudo recebido -> projeto recebido (com a data real quando é uma parcela só)
    UPDATE projetos_financeiro
    SET status_titulo = 'pagamento_recebido',
        data_recebido = CASE WHEN v_n = 1 AND v_mexeu_status
                             THEN COALESCE((r.received_at AT TIME ZONE 'UTC')::date, data_recebido, current_date)
                             ELSE COALESCE(data_recebido, v_ultimo, current_date) END,
        updated_at = now()
    WHERE proposta_id = v_budget
      AND (status_titulo IS DISTINCT FROM 'pagamento_recebido'
           OR (v_n = 1 AND v_mexeu_status
               AND data_recebido IS DISTINCT FROM (r.received_at AT TIME ZONE 'UTC')::date));
  ELSIF p.status_titulo = 'pagamento_recebido' THEN
    -- estava recebido e deixou de estar -> reabre
    UPDATE projetos_financeiro
    SET status_titulo = CASE WHEN v_n = 1 THEN COALESCE(titulo_da_etapa(etapa_recebivel(r.status)), 'esperando_pagamento')
                             ELSE 'esperando_pagamento' END,
        data_recebido = NULL,
        updated_at = now()
    WHERE proposta_id = v_budget;
  ELSIF v_n = 1 AND TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    -- uma parcela só: a etapa do projeto acompanha a da parcela
    IF etapa_titulo(p.status_titulo) IS DISTINCT FROM etapa_recebivel(v_novo_status) THEN
      UPDATE projetos_financeiro
      SET status_titulo = titulo_da_etapa(etapa_recebivel(v_novo_status)), updated_at = now()
      WHERE proposta_id = v_budget;
    END IF;
  END IF;

  -- vencimento: uma parcela só, quando o vencimento foi mexido em Contas
  IF v_n = 1 AND v_mexeu_venc AND data_recebimento_valida(v_novo_venc) IS NOT NULL THEN
    UPDATE projetos_financeiro
    SET data_recebimento_negociada = v_novo_venc, updated_at = now()
    WHERE proposta_id = v_budget AND data_recebimento_negociada IS DISTINCT FROM v_novo_venc;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END; $$;

DROP TRIGGER IF EXISTS trg_receivable_reflete_projeto ON public.receivables;
CREATE TRIGGER trg_receivable_reflete_projeto
  AFTER INSERT OR UPDATE OF received_amount, total_amount, status, due_date, received_at OR DELETE
  ON public.receivables
  FOR EACH ROW EXECUTE FUNCTION public.fn_receivable_reflete_projeto();

-- ───────────────────────────────────────────────────────────────────────────
-- 5) Custos de Projeto -> Contas a Receber
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_projeto_financeiro_reflete_receivable()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_n       int;
  v_etapa_p int := etapa_titulo(NEW.status_titulo);
  v_data    date := COALESCE(NEW.data_recebido, current_date);
  r         RECORD;
BEGIN
  IF NEW.proposta_id IS NULL THEN RETURN NEW; END IF;
  IF pg_trigger_depth() > 1 OR current_setting('lumos.reconciliando', true) = 'on' THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_n FROM receivables WHERE budget_id = NEW.proposta_id AND status <> 'cancelado';
  IF v_n = 0 THEN RETURN NEW; END IF;

  IF v_n = 1 THEN
    SELECT * INTO r FROM receivables WHERE budget_id = NEW.proposta_id AND status <> 'cancelado';

    IF OLD.status_titulo IS DISTINCT FROM NEW.status_titulo
       AND etapa_recebivel(r.status) IS DISTINCT FROM v_etapa_p THEN
      IF v_etapa_p = 4 THEN
        UPDATE receivables
        SET status = 'recebido', received_amount = total_amount,
            received_at = (v_data::timestamp AT TIME ZONE 'UTC'), updated_at = now()
        WHERE id = r.id;
      ELSE
        UPDATE receivables
        SET status = recebivel_da_etapa(v_etapa_p), received_amount = 0, received_at = NULL, updated_at = now()
        WHERE id = r.id;
      END IF;
    ELSIF v_etapa_p = 4 AND r.status = 'recebido'
          AND NEW.data_recebido IS NOT NULL
          AND OLD.data_recebido IS DISTINCT FROM NEW.data_recebido THEN
      UPDATE receivables
      SET received_at = (NEW.data_recebido::timestamp AT TIME ZONE 'UTC'), updated_at = now()
      WHERE id = r.id AND (received_at AT TIME ZONE 'UTC')::date IS DISTINCT FROM NEW.data_recebido;
    END IF;

    IF OLD.data_recebimento_negociada IS DISTINCT FROM NEW.data_recebimento_negociada
       AND data_recebimento_valida(NEW.data_recebimento_negociada) IS NOT NULL THEN
      UPDATE receivables SET due_date = NEW.data_recebimento_negociada, updated_at = now()
      WHERE id = r.id AND due_date IS DISTINCT FROM NEW.data_recebimento_negociada;
    END IF;

  ELSIF OLD.status_titulo IS DISTINCT FROM NEW.status_titulo AND v_etapa_p = 4 THEN
    -- várias parcelas: marcar o projeto como recebido quita as que estão em aberto
    UPDATE receivables
    SET status = 'recebido', received_amount = total_amount,
        received_at = COALESCE(received_at, (v_data::timestamp AT TIME ZONE 'UTC')), updated_at = now()
    WHERE budget_id = NEW.proposta_id AND status <> 'cancelado'
      AND (status IS DISTINCT FROM 'recebido' OR received_amount IS DISTINCT FROM total_amount);
  END IF;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_projeto_financeiro_reflete_receivable ON public.projetos_financeiro;
CREATE TRIGGER trg_projeto_financeiro_reflete_receivable
  AFTER UPDATE OF status_titulo, data_recebimento_negociada, data_recebido ON public.projetos_financeiro
  FOR EACH ROW EXECUTE FUNCTION public.fn_projeto_financeiro_reflete_receivable();

-- ───────────────────────────────────────────────────────────────────────────
-- 6) Conciliação do que já está divergente
--
--   SELECT * FROM reconciliar_recebimento(false);   -- prévia: só mostra, não muda nada
--   SELECT * FROM reconciliar_recebimento(true);    -- aplica (e registra no log)
--   SELECT * FROM reconciliar_recebimento(true, ARRAY['2026-219']);  -- aplica, pulando códigos
--
-- Regras:
--   status     -> vale o mais adiantado dos dois lados (um título não "volta"
--                 porque o outro lado esqueceu de atualizar).
--   vencimento -> vale o do projeto (Vini). Se o projeto não tem, vale o da conta.
--                 Datas absurdas (ex.: 1996) são ignoradas e avisadas.
--   recebido em-> data do recebimento do projeto; senão o vencimento do projeto;
--                 senão a data que já estava em Contas; senão hoje.
--   Só mexe em parcelas quando o projeto tem UMA conta a receber. Com várias
--   parcelas só marca "recebido" quando todas já foram pagas.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reconciliar_recebimento(
  p_aplicar boolean DEFAULT false,
  p_ignorar_codigos text[] DEFAULT '{}'
)
RETURNS TABLE (
  codigo text, projeto text, parcelas int, muda boolean,
  status_projeto_antes text, status_projeto_depois text,
  status_conta_antes text, status_conta_depois text,
  vencimento_projeto_antes date, vencimento_projeto_depois date,
  vencimento_conta_antes date, vencimento_conta_depois date,
  recebido_em_antes date, recebido_em_depois date,
  valor_projeto numeric, valor_conta numeric,
  alertas text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  PERFORM set_config('lumos.reconciliando', 'on', true);
  DROP TABLE IF EXISTS _plano_recebimento;

  CREATE TEMP TABLE _plano_recebimento ON COMMIT DROP AS
  WITH r AS (
    SELECT budget_id,
           count(*)                                       AS n,
           sum(total_amount)                              AS total,
           sum(received_amount)                           AS recebido,
           max((received_at AT TIME ZONE 'UTC')::date)    AS ultimo_recebido,
           (array_agg(id))[1]                             AS rid,
           (array_agg(status))[1]                         AS rstatus,
           (array_agg(due_date))[1]                       AS rdue,
           (array_agg((received_at AT TIME ZONE 'UTC')::date))[1] AS rrecv
    FROM receivables
    WHERE status <> 'cancelado' AND budget_id IS NOT NULL
    GROUP BY budget_id
  ), base AS (
    SELECT p.id AS pid, p.status_titulo AS pstatus,
           p.data_recebimento_negociada AS pdue, p.data_recebido AS precv, p.valor_vendido,
           COALESCE(b.code, pr.code) AS codigo, COALESCE(b.project_name, pr.name) AS projeto,
           r.n, r.total, r.recebido, r.ultimo_recebido, r.rid, r.rstatus, r.rdue, r.rrecv
    FROM projetos_financeiro p
    LEFT JOIN budgets b  ON b.id  = p.proposta_id
    LEFT JOIN projects pr ON pr.id = p.project_id
    LEFT JOIN r ON r.budget_id = p.proposta_id
  ), calc AS (
    SELECT base.*,
           etapa_titulo(pstatus) AS ep,
           CASE WHEN n = 1 THEN etapa_recebivel(rstatus) END AS er,
           (n > 0 AND total > 0 AND recebido >= total) AS tudo_recebido,
           data_recebimento_valida(pdue) AS pdue_ok
    FROM base
  ), dec AS (
    SELECT calc.*,
           CASE WHEN n = 1 THEN GREATEST(ep, er)
                WHEN n > 1 AND tudo_recebido THEN 4
                ELSE ep END AS ef
    FROM calc
  ), fin AS (
    SELECT dec.*,
           CASE WHEN ef = 4 THEN
             COALESCE(data_recebimento_valida(precv),
                      CASE WHEN n = 1 THEN pdue_ok END,
                      data_recebimento_valida(CASE WHEN n = 1 THEN rrecv ELSE ultimo_recebido END),
                      current_date)
           END AS recebido_final,
           CASE WHEN ef = 4 THEN
             CASE WHEN data_recebimento_valida(precv) IS NOT NULL THEN 'data do recebimento do projeto'
                  WHEN n = 1 AND pdue_ok IS NOT NULL THEN 'vencimento negociado do projeto'
                  WHEN data_recebimento_valida(CASE WHEN n = 1 THEN rrecv ELSE ultimo_recebido END) IS NOT NULL THEN 'data que já estava em Contas'
                  ELSE 'hoje (não havia nenhuma data)' END
           END AS origem_data,
           CASE WHEN ep < ef THEN titulo_da_etapa(ef) ELSE pstatus END AS novo_pstatus,
           CASE WHEN n = 1 AND er < ef THEN recebivel_da_etapa(ef) ELSE rstatus END AS novo_rstatus,
           CASE WHEN n = 1 THEN COALESCE(pdue_ok, rdue) END AS novo_rdue
    FROM dec
  )
  SELECT fin.*,
         -- vencimento do projeto: preenche se estava vazio e a conta tem um
         CASE WHEN n = 1 AND pdue IS NULL AND data_recebimento_valida(rdue) IS NOT NULL
              THEN rdue ELSE pdue END AS novo_pdue,
         COALESCE((novo_pstatus IS DISTINCT FROM pstatus)
           OR (ef = 4 AND recebido_final IS DISTINCT FROM precv)
           OR (n = 1 AND pdue IS NULL AND data_recebimento_valida(rdue) IS NOT NULL), false) AS muda_p,
         COALESCE((n = 1) AND (
           novo_rstatus IS DISTINCT FROM rstatus
           OR novo_rdue IS DISTINCT FROM rdue
           OR (ef = 4 AND (recebido_final IS DISTINCT FROM rrecv OR recebido < total))
         ), false) AS muda_r
  FROM fin;

  -- códigos que a pessoa pediu pra pular
  UPDATE _plano_recebimento SET muda_p = false, muda_r = false
  WHERE codigo = ANY (p_ignorar_codigos);

  IF p_aplicar THEN
    INSERT INTO reconciliacao_recebimento_log (projeto_financeiro_id, receivable_id, antes, depois)
    SELECT pl.pid, CASE WHEN pl.muda_r THEN pl.rid END,
           jsonb_build_object('status_titulo', pl.pstatus, 'data_recebimento_negociada', pl.pdue,
                              'data_recebido', pl.precv, 'receivable_status', pl.rstatus,
                              'due_date', pl.rdue, 'received_at', pl.rrecv, 'received_amount', pl.recebido),
           jsonb_build_object('status_titulo', pl.novo_pstatus, 'data_recebimento_negociada', pl.novo_pdue,
                              'data_recebido', CASE WHEN pl.ef = 4 THEN pl.recebido_final END,
                              'receivable_status', pl.novo_rstatus, 'due_date', pl.novo_rdue,
                              'received_at', CASE WHEN pl.ef = 4 THEN pl.recebido_final END,
                              'received_amount', CASE WHEN pl.ef = 4 THEN pl.total ELSE pl.recebido END)
    FROM _plano_recebimento pl
    WHERE pl.muda_p OR pl.muda_r;

    UPDATE projetos_financeiro p
    SET status_titulo = pl.novo_pstatus,
        data_recebimento_negociada = pl.novo_pdue,
        data_recebido = CASE WHEN pl.ef = 4 THEN pl.recebido_final ELSE p.data_recebido END,
        updated_at = now()
    FROM _plano_recebimento pl
    WHERE p.id = pl.pid AND pl.muda_p;

    UPDATE receivables rc
    SET status = pl.novo_rstatus,
        due_date = pl.novo_rdue,
        received_amount = CASE WHEN pl.ef = 4 THEN rc.total_amount ELSE rc.received_amount END,
        received_at = CASE WHEN pl.ef = 4 THEN (pl.recebido_final::timestamp AT TIME ZONE 'UTC') ELSE rc.received_at END,
        updated_at = now()
    FROM _plano_recebimento pl
    WHERE rc.id = pl.rid AND pl.muda_r;
  END IF;

  RETURN QUERY
  SELECT pl.codigo::text, pl.projeto::text, COALESCE(pl.n, 0)::int,
         (pl.muda_p OR pl.muda_r),
         CASE pl.pstatus WHEN 'emitir_nf' THEN 'Emitir NF' WHEN 'pedido_nf_feito' THEN 'NF pedida'
              WHEN 'esperando_pagamento' THEN 'NF emitida' WHEN 'pagamento_atraso' THEN 'Em atraso'
              WHEN 'pagamento_recebido' THEN 'Recebido' END,
         CASE pl.novo_pstatus WHEN 'emitir_nf' THEN 'Emitir NF' WHEN 'pedido_nf_feito' THEN 'NF pedida'
              WHEN 'esperando_pagamento' THEN 'NF emitida' WHEN 'pagamento_atraso' THEN 'Em atraso'
              WHEN 'pagamento_recebido' THEN 'Recebido' END,
         CASE WHEN COALESCE(pl.n, 0) = 0 THEN '—' WHEN pl.n > 1 THEN pl.n || ' parcelas'
              ELSE CASE pl.rstatus WHEN 'aguardando' THEN 'Emitir NF' WHEN 'emitir_nf' THEN 'NF pedida'
                   WHEN 'nf_emitida' THEN 'NF emitida' WHEN 'parcial' THEN 'Parcial'
                   WHEN 'inadimplente' THEN 'Em atraso' WHEN 'recebido' THEN 'Recebido' END END,
         CASE WHEN COALESCE(pl.n, 0) = 0 THEN '—' WHEN pl.n > 1 THEN pl.n || ' parcelas'
              ELSE CASE pl.novo_rstatus WHEN 'aguardando' THEN 'Emitir NF' WHEN 'emitir_nf' THEN 'NF pedida'
                   WHEN 'nf_emitida' THEN 'NF emitida' WHEN 'parcial' THEN 'Parcial'
                   WHEN 'inadimplente' THEN 'Em atraso' WHEN 'recebido' THEN 'Recebido' END END,
         pl.pdue, pl.novo_pdue,
         CASE WHEN pl.n = 1 THEN pl.rdue END, CASE WHEN pl.n = 1 THEN pl.novo_rdue END,
         CASE WHEN pl.n = 1 THEN pl.rrecv WHEN pl.n > 1 THEN pl.ultimo_recebido END,
         CASE WHEN pl.ef = 4 THEN pl.recebido_final END,
         pl.valor_vendido, pl.total,
         NULLIF(concat_ws(' · ',
           CASE WHEN COALESCE(pl.n, 0) = 0 THEN 'sem conta a receber vinculada (nada a conciliar)' END,
           CASE WHEN pl.n > 1 THEN 'várias parcelas: só marca recebido quando todas pagas; vencimentos mantidos' END,
           CASE WHEN pl.n > 1 AND pl.ep = 4 AND NOT pl.tudo_recebido THEN 'ATENÇÃO: projeto Recebido mas há parcela em aberto' END,
           CASE WHEN pl.pdue IS NOT NULL AND pl.pdue_ok IS NULL THEN 'ATENÇÃO: vencimento do projeto inválido (' || to_char(pl.pdue, 'DD/MM/YYYY') || '), ignorado' END,
           CASE WHEN pl.n = 1 AND pl.pdue IS NULL AND data_recebimento_valida(pl.rdue) IS NOT NULL THEN 'projeto sem vencimento: copiado da conta' END,
           CASE WHEN pl.ef = 4 AND pl.n >= 1 AND (pl.muda_p OR pl.muda_r) AND pl.recebido_final IS DISTINCT FROM CASE WHEN pl.n = 1 THEN pl.rrecv ELSE pl.ultimo_recebido END
                THEN 'data do recebimento muda (origem: ' || pl.origem_data || ')' END,
           CASE WHEN pl.n > 0 AND abs(COALESCE(pl.valor_vendido, 0) - COALESCE(pl.total, 0)) > 0.5
                THEN 'VALOR difere: projeto ' || COALESCE(pl.valor_vendido, 0) || ' × conta ' || COALESCE(pl.total, 0) END
         ), '')
  FROM _plano_recebimento pl
  ORDER BY pl.codigo;
END; $$;

REVOKE ALL ON FUNCTION public.reconciliar_recebimento(boolean, text[]) FROM PUBLIC, anon, authenticated;

-- Conferência: tudo criado, e a prévia roda sem alterar nada.
SELECT proname FROM pg_proc
WHERE proname IN ('etapa_titulo','etapa_recebivel','titulo_da_etapa','recebivel_da_etapa',
                  'data_recebimento_valida','reconciliar_recebimento',
                  'fn_receivable_reflete_projeto','fn_projeto_financeiro_reflete_receivable')
ORDER BY proname;
SELECT tgname FROM pg_trigger
WHERE tgname IN ('trg_receivable_reflete_projeto','trg_projeto_financeiro_reflete_receivable')
ORDER BY tgname;
