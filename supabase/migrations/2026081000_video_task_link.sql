-- Vídeo ⇄ Tarefa: vínculo por VÍDEO (não por projeto), status automático e
-- notificação em lote para o editor quando o cliente comenta.
--
-- O que já existia:
--   • video_versions.task_id  → o vínculo já existe no schema
--   • video_versions.group_id → cada "vídeo" é um grupo de versões (v01, v02…)
--   • O app já espelha o status do vídeo na tarefa (STATUS_TO_TASK, no cliente)
-- O que faltava: o vínculo era gravado no PROJETO inteiro, o status não reagia ao
-- comentário do cliente, e ninguém avisava o editor.

-- ───────────────────────────────────────────────────────────────────────────
-- 1) Auto-vínculo pelo NOME DO ARQUIVO, na entrada do vídeo.
--    Mora no INSERT da tabela, então vale para os DOIS caminhos de upload
--    (plataforma e dropzone do Drive).
--
--    Casa "Sicredi Copa do Mundo | 0X_v01.mp4" com a tarefa "Sicredi Copa do
--    Mundo | 0X": tira extensão, tira sufixo de versão e compara sem acento,
--    sem caixa e sem pontuação.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.unaccent_safe(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT translate(COALESCE(p, ''),
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC');
$$;

CREATE OR REPLACE FUNCTION public.norm_label(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(lower(public.unaccent_safe(COALESCE(p, ''))), '[^a-z0-9]+', '', 'g');
$$;

CREATE OR REPLACE FUNCTION public.autolink_video_to_task()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_base       text;
  v_task       uuid;
  v_group_task uuid;
BEGIN
  -- Já veio vinculado (upload feito a partir da tarefa): respeita.
  IF NEW.task_id IS NOT NULL THEN RETURN NEW; END IF;

  -- Outra versão do MESMO vídeo já está vinculada: herda (v02 segue a v01).
  SELECT task_id INTO v_group_task
  FROM video_versions
  WHERE group_id = NEW.group_id AND task_id IS NOT NULL
  LIMIT 1;
  IF v_group_task IS NOT NULL THEN
    NEW.task_id := v_group_task;
    RETURN NEW;
  END IF;

  -- Nome do arquivo sem extensão e sem sufixo de versão (_v01, -v2, v03…).
  v_base := regexp_replace(COALESCE(NEW.file_name, ''), '\.[^.]+$', '');
  v_base := regexp_replace(v_base, '[ _-]*v[0-9]+$', '', 'i');

  IF public.norm_label(v_base) <> '' THEN
    SELECT id INTO v_task
    FROM project_tasks
    WHERE project_id = NEW.project_id
      AND public.norm_label(titulo) = public.norm_label(v_base)
    LIMIT 1;
  END IF;

  NEW.task_id := v_task;   -- NULL se não casou: o app mostra o chip "sem tarefa"
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_autolink_video_to_task ON public.video_versions;
CREATE TRIGGER trg_autolink_video_to_task
  BEFORE INSERT ON public.video_versions
  FOR EACH ROW EXECUTE FUNCTION public.autolink_video_to_task();

-- Backfill: tenta vincular os vídeos que já existem e estão sem tarefa.
UPDATE public.video_versions vv
SET task_id = t.id
FROM public.project_tasks t
WHERE vv.task_id IS NULL
  AND t.project_id = vv.project_id
  AND public.norm_label(t.titulo) = public.norm_label(
        regexp_replace(regexp_replace(vv.file_name, '\.[^.]+$', ''), '[ _-]*v[0-9]+$', '', 'i')
      );

-- ───────────────────────────────────────────────────────────────────────────
-- 2) Comentário do CLIENTE → vídeo e tarefa vão para "Alterações" NA HORA.
--    (A notificação é separada: só sai após 30 min de silêncio — item 3.)
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.client_comment_sets_alteracoes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_task uuid;
BEGIN
  IF NEW.is_team = true THEN RETURN NEW; END IF;   -- só comentário de cliente

  -- Só muda se o vídeo estiver em revisão do cliente (não reabre um aprovado).
  UPDATE video_versions
  SET status = 'ALTERACOES_CLIENTE', updated_at = now()
  WHERE id = NEW.video_version_id
    AND status = 'EM_REVISAO_CLIENTE'
  RETURNING task_id INTO v_task;

  IF v_task IS NOT NULL THEN
    UPDATE project_tasks SET status = 'alteracoes' WHERE id = v_task;
  END IF;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_client_comment_sets_alteracoes ON public.review_comments;
CREATE TRIGGER trg_client_comment_sets_alteracoes
  AFTER INSERT ON public.review_comments
  FOR EACH ROW EXECUTE FUNCTION public.client_comment_sets_alteracoes();

-- ───────────────────────────────────────────────────────────────────────────
-- 3) Notificação em LOTE, 30 min após o ÚLTIMO comentário do cliente.
--    Janela deslizante: 10 comentários em 20 min viram UM aviso, 30 min depois
--    do último. Se o cliente voltar amanhã, sai outro lote.
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.review_notify_state (
  group_id         uuid PRIMARY KEY,
  notified_up_to   timestamptz NOT NULL DEFAULT '-infinity', -- até qual comentário já avisei
  last_notified_at timestamptz
);
-- Só o job (SECURITY DEFINER) escreve aqui; o app não precisa ler.
ALTER TABLE public.review_notify_state ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.notify_client_comments()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r         record;
  dest      record;
  v_project uuid;
  v_nome    text;
  v_qtd     integer;
  v_autores text;
BEGIN
  FOR r IN
    SELECT vv.group_id,
           MAX(c.created_at)                       AS ultimo_comentario,
           COALESCE(s.notified_up_to, '-infinity') AS notified_up_to
    FROM review_comments c
    JOIN video_versions vv ON vv.id = c.video_version_id
    LEFT JOIN review_notify_state s ON s.group_id = vv.group_id
    WHERE c.is_team = false
      AND c.created_at > COALESCE(s.notified_up_to, '-infinity')
    GROUP BY vv.group_id, s.notified_up_to
    HAVING MAX(c.created_at) <= now() - interval '30 minutes'
  LOOP
    -- Projeto e nome do vídeo (versão mais recente do grupo).
    SELECT vv.project_id, vv.file_name INTO v_project, v_nome
    FROM video_versions vv
    WHERE vv.group_id = r.group_id
    ORDER BY vv.versao DESC
    LIMIT 1;

    -- Só os comentários do lote (posteriores ao último aviso).
    SELECT count(*), string_agg(DISTINCT c.author_name, ', ')
      INTO v_qtd, v_autores
    FROM review_comments c
    JOIN video_versions vv ON vv.id = c.video_version_id
    WHERE vv.group_id = r.group_id
      AND c.is_team = false
      AND c.created_at > r.notified_up_to;

    IF COALESCE(v_qtd, 0) = 0 THEN CONTINUE; END IF;

    -- Destinatários: o EDITOR (responsável da tarefa vinculada) + atendimento + admin.
    FOR dest IN
      SELECT DISTINCT u.id
      FROM app_users u
      WHERE u.status = 'ativo'
        AND (
          u.role IN ('admin', 'atendimento')
          OR u.id IN (
            SELECT t.responsavel_id
            FROM video_versions vv
            JOIN project_tasks t ON t.id = vv.task_id
            WHERE vv.group_id = r.group_id AND t.responsavel_id IS NOT NULL
          )
        )
    LOOP
      INSERT INTO notifications (user_id, event_type, category, priority, title, body, link, data)
      VALUES (
        dest.id, 'comentarios_cliente_video', 'producao', 'high',
        'Comentários novos do cliente',
        v_qtd || CASE WHEN v_qtd = 1 THEN ' comentário novo de ' ELSE ' comentários novos de ' END
          || COALESCE(v_autores, 'cliente') || ' em "' || COALESCE(v_nome, 'vídeo') || '".',
        '/producao/projetos?projectId=' || v_project::text,
        jsonb_build_object('group_id', r.group_id, 'project_id', v_project, 'qtd', v_qtd)
      );
    END LOOP;

    -- Marca até onde já avisei (o próximo lote começa daqui).
    INSERT INTO review_notify_state (group_id, notified_up_to, last_notified_at)
    VALUES (r.group_id, r.ultimo_comentario, now())
    ON CONFLICT (group_id) DO UPDATE
      SET notified_up_to   = EXCLUDED.notified_up_to,
          last_notified_at = EXCLUDED.last_notified_at;
  END LOOP;
END; $$;

-- Marco inicial: os comentários que JÁ existem não devem gerar notificação
-- retroativa na primeira rodada do cron. Considera tudo até agora como "avisado".
INSERT INTO public.review_notify_state (group_id, notified_up_to, last_notified_at)
SELECT DISTINCT vv.group_id, now(), now()
FROM public.review_comments c
JOIN public.video_versions vv ON vv.id = c.video_version_id
WHERE c.is_team = false
ON CONFLICT (group_id) DO NOTHING;

-- Roda a cada 5 min. pg_cron já está ativo neste projeto (usado pelo drive-watch).
SELECT cron.unschedule('notify-client-comments-5min')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notify-client-comments-5min');

SELECT cron.schedule(
  'notify-client-comments-5min',
  '*/5 * * * *',
  $$ SELECT public.notify_client_comments(); $$
);
