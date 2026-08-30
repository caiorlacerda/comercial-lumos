-- O QUE FOI COMBINADO NO MÊS, E QUANTO JÁ SAIU
--
-- Tem contrato que é por volume: tantas diárias por mês, tantos vídeos por mês.
-- Hoje esse número mora na cabeça de quem fechou e na planilha de alguém — e a
-- pergunta "quantas diárias já usamos em agosto?" é respondida contando na mão.
--
-- Aqui o combinado vira dado do projeto, e o realizado é CONTADO do que já
-- existe no app: as diárias marcadas, os vídeos entregues e as tarefas
-- concluídas. Ninguém preenche número de acompanhamento; o número é
-- consequência do trabalho que já foi registrado.
--
-- Um detalhe que decide o resto: QUANDO um vídeo conta como entregue. Escolhi
-- o dia em que ele foi ENVIADO ao cliente, não o dia em que o cliente aprovou.
-- O que a Lumos controla é a entrega; a aprovação depende do cliente, e um
-- vídeo entregue em 30/08 aprovado em 02/09 cairia no mês errado.

-- ───────────────────────────────────────────────────────────────
-- 1) Quando o vídeo foi parar com o cliente
-- ───────────────────────────────────────────────────────────────
ALTER TABLE public.video_versions
  ADD COLUMN IF NOT EXISTS entregue_em timestamptz;

-- Carimba sozinho, venha de onde vier: menu do card, player, pílula da tarefa,
-- gatilho da tarefa. Só a primeira vez — reenviar uma v03 não muda a data em
-- que aquele vídeo foi entregue pela primeira vez.
CREATE OR REPLACE FUNCTION public.marcar_entrega_ao_cliente()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'EM_REVISAO_CLIENTE' AND NEW.entregue_em IS NULL THEN
    NEW.entregue_em := now();
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_marcar_entrega_ao_cliente ON public.video_versions;
CREATE TRIGGER trg_marcar_entrega_ao_cliente
  BEFORE INSERT OR UPDATE OF status ON public.video_versions
  FOR EACH ROW EXECUTE FUNCTION public.marcar_entrega_ao_cliente();

-- Retroativo, com o que dá pra saber: quem já passou pelo cliente ganha a data
-- da decisão dele ou, na falta, a da última mexida. É aproximação de histórico
-- que não foi guardado, e serve pra régua não nascer vazia.
UPDATE public.video_versions
SET entregue_em = COALESCE(client_decided_at, updated_at, created_at)
WHERE entregue_em IS NULL
  AND status IN ('EM_REVISAO_CLIENTE', 'ALTERACOES_CLIENTE', 'APROVADO');

-- ───────────────────────────────────────────────────────────────
-- 2) O combinado
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.project_escopo (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  -- o que se conta: diárias marcadas, vídeos entregues, tarefas concluídas
  chave       text NOT NULL CHECK (chave IN ('diarias', 'videos', 'tarefas')),
  -- como o cliente chama isso ("Diárias de captação", "Reels por mês")
  rotulo      text NOT NULL,
  meta        integer NOT NULL CHECK (meta > 0),
  periodo     text NOT NULL DEFAULT 'mes' CHECK (periodo IN ('mes', 'projeto')),
  ordem       integer NOT NULL DEFAULT 0,
  created_by  uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_escopo_project ON public.project_escopo(project_id, ordem);

DROP TRIGGER IF EXISTS update_project_escopo_updated_at ON public.project_escopo;
CREATE TRIGGER update_project_escopo_updated_at
  BEFORE UPDATE ON public.project_escopo
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.project_escopo ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS select_escopo ON public.project_escopo;
CREATE POLICY select_escopo ON public.project_escopo
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS manage_escopo ON public.project_escopo;
CREATE POLICY manage_escopo ON public.project_escopo
  FOR ALL TO authenticated USING (public.get_user_role() IN ('admin', 'producao'));

GRANT ALL ON public.project_escopo TO authenticated, service_role;

-- ───────────────────────────────────────────────────────────────
-- 3) O combinado x o realizado, no mês pedido
-- ───────────────────────────────────────────────────────────────
-- p_mes: qualquer dia do mês (o app manda o dia 1). Item de período 'projeto'
-- conta desde sempre, e por isso ignora o mês.
CREATE OR REPLACE FUNCTION public.escopo_do_mes(p_project_id uuid, p_mes date)
RETURNS TABLE (
  id uuid, chave text, rotulo text, meta integer, periodo text, realizado bigint
)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT e.id, e.chave, e.rotulo, e.meta, e.periodo,
    CASE e.chave
      WHEN 'diarias' THEN (
        SELECT count(*) FROM project_diarias d
        WHERE d.project_id = e.project_id
          AND d.data IS NOT NULL
          AND (e.periodo = 'projeto' OR date_trunc('month', d.data) = date_trunc('month', p_mes))
      )
      -- Um vídeo conta UMA vez, no mês da primeira entrega. Versão nova não
      -- gera entrega nova: continua sendo a mesma peça combinada.
      WHEN 'videos' THEN (
        SELECT count(*) FROM (
          SELECT COALESCE(v.group_id, v.id) AS g, min(v.entregue_em) AS quando
          FROM video_versions v
          WHERE v.project_id = e.project_id AND v.entregue_em IS NOT NULL
          GROUP BY 1
        ) x
        WHERE e.periodo = 'projeto' OR date_trunc('month', x.quando) = date_trunc('month', p_mes)
      )
      WHEN 'tarefas' THEN (
        SELECT count(*) FROM project_tasks t
        WHERE t.project_id = e.project_id
          AND t.deleted_at IS NULL
          AND t.status IN ('concluido', 'entregue')
          AND (e.periodo = 'projeto' OR date_trunc('month', COALESCE(t.data_fim::timestamptz, t.updated_at)) = date_trunc('month', p_mes))
      )
    END AS realizado
  FROM project_escopo e
  WHERE e.project_id = p_project_id
  ORDER BY e.ordem, e.rotulo;
$$;

GRANT EXECUTE ON FUNCTION public.escopo_do_mes(uuid, date) TO authenticated, anon;

-- Conferência: quantos vídeos já têm data de entrega, por mês.
SELECT to_char(date_trunc('month', entregue_em), 'YYYY-MM') AS mes, count(*)
FROM public.video_versions WHERE entregue_em IS NOT NULL
GROUP BY 1 ORDER BY 1 DESC LIMIT 6;
