-- FASE 3 — Pipeline por time + limpeza dos status fantasmas + avisos do ciclo
--
-- Etapas finais (9), cada uma com um time dono no app:
--   na_fila (—) · roteiro (criação) · captacao (produção) · em_progresso [Edição]
--   (edição) · revisao_interna (produção) · revisao_cliente (atendimento) ·
--   alteracoes [Ajustes] (edição) · concluido [Aprovado] · pausado (—)
--
-- 'em_progresso', 'alteracoes' e 'concluido' seguem com o MESMO valor no banco
-- (só mudam de nome na tela: Edição, Ajustes e Aprovado) — assim nenhuma tarefa
-- precisa ser migrada e nada quebra.

-- ───────────────────────────────────────────────────────────────────────────
-- 1) Abre o CHECK para as etapas novas (roteiro, captacao)
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.project_tasks DROP CONSTRAINT IF EXISTS project_tasks_status_check;
ALTER TABLE public.project_tasks ADD CONSTRAINT project_tasks_status_check CHECK (status IN (
  -- etapas atuais
  'na_fila', 'roteiro', 'captacao', 'em_progresso', 'revisao_interna',
  'revisao_cliente', 'alteracoes', 'concluido', 'pausado',
  -- legados (removidos do CHECK no passo 3, depois da migração)
  'iniciar', 'aguard_captacao', 'aguard_material', 'aprov_interna', 'entregue'
));

-- ───────────────────────────────────────────────────────────────────────────
-- 2) Migra os status fantasmas (existiam no banco, nunca apareciam na tela)
-- ───────────────────────────────────────────────────────────────────────────
UPDATE public.project_tasks SET status = 'na_fila'          WHERE status IN ('iniciar', 'aguard_material');
UPDATE public.project_tasks SET status = 'captacao'         WHERE status = 'aguard_captacao';
UPDATE public.project_tasks SET status = 'revisao_cliente'  WHERE status = 'aprov_interna';
UPDATE public.project_tasks SET status = 'concluido'        WHERE status = 'entregue';

-- O DEFAULT da coluna ainda era 'iniciar' (legado que sai do CHECK abaixo):
-- sem isso, qualquer INSERT sem status explícito passaria a falhar.
ALTER TABLE public.project_tasks ALTER COLUMN status SET DEFAULT 'na_fila';

-- ───────────────────────────────────────────────────────────────────────────
-- 3) Fecha o CHECK só nas 9 etapas de verdade
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.project_tasks DROP CONSTRAINT project_tasks_status_check;
ALTER TABLE public.project_tasks ADD CONSTRAINT project_tasks_status_check CHECK (status IN (
  'na_fila', 'roteiro', 'captacao', 'em_progresso', 'revisao_interna',
  'revisao_cliente', 'alteracoes', 'concluido', 'pausado'
));

-- task_status_to_video: as etapas novas ainda são "antes do vídeo existir",
-- então seguem a regra padrão (revisão interna, sem desfazer envio ao cliente).
-- Nada a mudar na função — a cláusula ELSE já cobre roteiro/captacao.

-- ───────────────────────────────────────────────────────────────────────────
-- 4) AVISO: vídeo novo chegou na revisão
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_video_novo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_proj_name text;
  v_task_titulo text;
  v_is_nova_versao boolean;
  u RECORD;
BEGIN
  SELECT name INTO v_proj_name FROM projects WHERE id = NEW.project_id;
  SELECT titulo INTO v_task_titulo FROM project_tasks WHERE id = NEW.task_id;
  v_is_nova_versao := NEW.versao > 1;

  FOR u IN
    SELECT DISTINCT a.id
    FROM app_users a
    WHERE a.status = 'ativo'
      AND (
        a.id = (SELECT responsavel_id FROM project_tasks WHERE id = NEW.task_id)
        OR a.id IN (SELECT user_id FROM task_collaborators WHERE task_id = NEW.task_id)
        -- sem tarefa vinculada: avisa quem toca produção
        OR (NEW.task_id IS NULL AND a.role IN ('admin', 'producao'))
      )
  LOOP
    INSERT INTO notifications (user_id, event_type, category, priority, title, body, link, data)
    VALUES (
      u.id, 'video_novo', 'producao', 'normal',
      CASE WHEN v_is_nova_versao THEN 'Nova versão de vídeo' ELSE 'Vídeo novo na revisão' END,
      COALESCE(NEW.file_name, 'Um vídeo') || ' entrou em ' || COALESCE(v_proj_name, 'um projeto')
        || COALESCE(' · ' || v_task_titulo, '') || '.',
      '/producao/projetos?projectId=' || COALESCE(NEW.project_id::text, '') || '&tab=entregas',
      jsonb_build_object('video_version_id', NEW.id, 'project_id', NEW.project_id, 'versao', NEW.versao)
    );
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Falha ao notificar vídeo novo %: %', NEW.id, SQLERRM;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_notify_video_novo ON public.video_versions;
CREATE TRIGGER trg_notify_video_novo
  AFTER INSERT ON public.video_versions
  FOR EACH ROW EXECUTE FUNCTION public.notify_video_novo();

-- ───────────────────────────────────────────────────────────────────────────
-- 5) AVISO: a tarefa passou pra sua etapa
--    Vai pro responsável e pros colaboradores (menos quem moveu).
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_task_stage_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor uuid;
  v_proj uuid;
  u RECORD;
  v_label text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;

  actor := (SELECT id FROM app_users WHERE auth_user_id = auth.uid() AND status = 'ativo');
  v_proj := NEW.project_id;
  v_label := CASE NEW.status
    WHEN 'na_fila' THEN 'Na fila'
    WHEN 'roteiro' THEN 'Roteiro'
    WHEN 'captacao' THEN 'Captação'
    WHEN 'em_progresso' THEN 'Edição'
    WHEN 'revisao_interna' THEN 'Revisão interna'
    WHEN 'revisao_cliente' THEN 'Com o cliente'
    WHEN 'alteracoes' THEN 'Ajustes'
    WHEN 'concluido' THEN 'Aprovado'
    WHEN 'pausado' THEN 'Pausado'
    ELSE NEW.status END;

  FOR u IN
    SELECT DISTINCT a.id
    FROM app_users a
    WHERE a.status = 'ativo'
      AND (a.id = NEW.responsavel_id OR a.id IN (SELECT user_id FROM task_collaborators WHERE task_id = NEW.id))
      AND (actor IS NULL OR a.id <> actor)
  LOOP
    INSERT INTO notifications (user_id, event_type, category, priority, title, body, link, data, actor_id)
    VALUES (
      u.id, 'tarefa_mudou_etapa', 'producao', 'normal',
      'Tarefa em ' || v_label,
      '"' || NEW.titulo || '" passou para ' || v_label || '.',
      '/producao/projetos?projectId=' || COALESCE(v_proj::text, '') || '&taskId=' || NEW.id::text,
      jsonb_build_object('task_id', NEW.id, 'project_id', v_proj, 'status', NEW.status),
      actor
    );
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Falha ao notificar etapa da tarefa %: %', NEW.id, SQLERRM;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_notify_task_stage_change ON public.project_tasks;
CREATE TRIGGER trg_notify_task_stage_change
  AFTER UPDATE OF status ON public.project_tasks
  FOR EACH ROW EXECUTE FUNCTION public.notify_task_stage_change();

-- ───────────────────────────────────────────────────────────────────────────
-- 6) AVISO: o cliente abriu o link de revisão
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_client_opened_link()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v RECORD;
  u RECORD;
BEGIN
  SELECT vv.id, vv.file_name, vv.project_id, vv.task_id
  INTO v
  FROM review_links l
  JOIN video_versions vv ON vv.id = l.video_version_id
  WHERE l.id = NEW.review_link_id;

  IF v.id IS NULL THEN RETURN NEW; END IF;

  FOR u IN
    SELECT DISTINCT a.id
    FROM app_users a
    WHERE a.status = 'ativo'
      AND (
        a.role IN ('admin', 'atendimento')
        OR a.id = (SELECT responsavel_id FROM project_tasks WHERE id = v.task_id)
        OR a.id IN (SELECT user_id FROM task_collaborators WHERE task_id = v.task_id)
      )
  LOOP
    INSERT INTO notifications (user_id, event_type, category, priority, title, body, link, data)
    VALUES (
      u.id, 'cliente_abriu_link', 'producao', 'normal',
      'Cliente abriu a revisão 👀',
      COALESCE(NEW.name, 'O cliente') || ' abriu o link de "' || COALESCE(v.file_name, 'vídeo') || '".',
      '/producao/projetos?projectId=' || COALESCE(v.project_id::text, '') || '&tab=entregas',
      jsonb_build_object('video_version_id', v.id, 'project_id', v.project_id)
    );
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Falha ao notificar abertura do link %: %', NEW.id, SQLERRM;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_notify_client_opened_link ON public.review_viewers;
CREATE TRIGGER trg_notify_client_opened_link
  AFTER INSERT ON public.review_viewers
  FOR EACH ROW EXECUTE FUNCTION public.notify_client_opened_link();

-- ───────────────────────────────────────────────────────────────────────────
-- 7) AVISO: prazo vence amanhã (cron diário, 08:00 SP = 11:00 UTC)
--    Usa o evento 'prazo_alerta', que já existe no catálogo do app.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_prazo_amanha()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t RECORD; u RECORD;
BEGIN
  FOR t IN
    SELECT pt.id, pt.titulo, pt.project_id, pt.responsavel_id
    FROM project_tasks pt
    JOIN projects p ON p.id = pt.project_id AND p.status = 'ativo'
    WHERE pt.deleted_at IS NULL
      AND pt.status <> 'concluido'
      AND pt.data_fim = (current_date + 1)
  LOOP
    FOR u IN
      SELECT DISTINCT a.id
      FROM app_users a
      WHERE a.status = 'ativo'
        AND (a.id = t.responsavel_id OR a.id IN (SELECT user_id FROM task_collaborators WHERE task_id = t.id))
    LOOP
      INSERT INTO notifications (user_id, event_type, category, priority, title, body, link, data)
      VALUES (
        u.id, 'prazo_alerta', 'producao', 'high',
        'Prazo vence amanhã',
        '"' || t.titulo || '" tem entrega marcada para amanhã.',
        '/producao/projetos?projectId=' || COALESCE(t.project_id::text, '') || '&taskId=' || t.id::text,
        jsonb_build_object('task_id', t.id, 'project_id', t.project_id)
      );
    END LOOP;
  END LOOP;
END; $$;

-- cron.schedule sobrescreve o job de mesmo nome (dá pra rodar de novo sem medo).
SELECT cron.schedule('notify-prazo-amanha', '0 11 * * *', $$SELECT public.notify_prazo_amanha()$$);
