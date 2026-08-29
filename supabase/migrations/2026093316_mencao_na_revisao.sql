-- MENÇÃO NO COMENTÁRIO DA REVISÃO INTERNA
--
-- Hoje dá pra comentar num ponto do vídeo, mas não dá pra chamar alguém. Quem
-- precisa ver o pedido (roteirista, editor, atendimento) só descobre se abrir
-- o vídeo por conta própria — na prática, a cobrança acaba indo pro WhatsApp.
--
-- Mesma mecânica que já existe em comentário de tarefa: a menção vira uma LINHA
-- (não texto interpretado depois), e um gatilho manda a notificação. Assim o
-- registro de quem foi chamado não depende de reprocessar string.
--
-- O link da notificação abre o projeto, o painel de entregas e o vídeo certo.

CREATE TABLE IF NOT EXISTS public.review_comment_mentions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id        uuid NOT NULL REFERENCES public.review_comments(id) ON DELETE CASCADE,
  mentioned_user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  notified          boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (comment_id, mentioned_user_id)
);

CREATE INDEX IF NOT EXISTS idx_review_mentions_user
  ON public.review_comment_mentions(mentioned_user_id);

ALTER TABLE public.review_comment_mentions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS review_mentions_equipe ON public.review_comment_mentions;
CREATE POLICY review_mentions_equipe ON public.review_comment_mentions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT ALL ON public.review_comment_mentions TO authenticated;

-- ── Gatilho: menção criada, pessoa avisada ────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_review_mention_notification()
RETURNS trigger AS $$
DECLARE
  v_autor_id    uuid;
  v_autor_nome  text;
  v_texto       text;
  v_tempo_ms    int;
  v_versao_id   uuid;
  v_arquivo     text;
  v_versao      int;
  v_projeto_id  uuid;
  v_projeto     text;
BEGIN
  IF NEW.notified THEN RETURN NEW; END IF;

  BEGIN
    SELECT rc.author_user_id, rc.body, rc.timecode_ms, rc.video_version_id,
           vv.file_name, vv.versao, vv.project_id, p.name
      INTO v_autor_id, v_texto, v_tempo_ms, v_versao_id,
           v_arquivo, v_versao, v_projeto_id, v_projeto
    FROM review_comments rc
    JOIN video_versions vv ON vv.id = rc.video_version_id
    JOIN projects p ON p.id = vv.project_id
    WHERE rc.id = NEW.comment_id;

    SELECT full_name INTO v_autor_nome FROM app_users WHERE id = v_autor_id;

    -- Mencionar a si mesmo não gera aviso.
    IF NEW.mentioned_user_id = v_autor_id THEN
      UPDATE review_comment_mentions SET notified = true WHERE id = NEW.id;
      RETURN NEW;
    END IF;

    INSERT INTO public.notifications (
      user_id, event_type, category, priority, title, body, link, data
    ) VALUES (
      NEW.mentioned_user_id,
      'mencao_comentario',
      'producao',
      'normal',
      'Você foi mencionado numa revisão',
      COALESCE(v_autor_nome, 'Alguém') || ' mencionou você em "' || COALESCE(v_arquivo, 'um vídeo') || '": "' ||
        CASE WHEN length(COALESCE(v_texto, '')) > 60
             THEN substring(v_texto, 1, 60) || '...'
             ELSE COALESCE(v_texto, '') END || '"',
      '/producao/projetos?projectId=' || COALESCE(v_projeto_id::text, '')
        || '&review=' || COALESCE(v_versao_id::text, '')
        || '&comment=' || NEW.comment_id::text,
      jsonb_build_object(
        'comment_id', NEW.comment_id,
        'video_version_id', v_versao_id,
        'project_id', v_projeto_id,
        'timecode_ms', v_tempo_ms
      )
    );

    UPDATE review_comment_mentions SET notified = true WHERE id = NEW.id;

  EXCEPTION WHEN OTHERS THEN
    -- Isolamento: avisar é importante, mas não a ponto de derrubar o comentário.
    RAISE WARNING 'Menção na revisão % falhou: %', NEW.comment_id, SQLERRM;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_review_mention_notification ON public.review_comment_mentions;
CREATE TRIGGER trg_review_mention_notification
  AFTER INSERT ON public.review_comment_mentions
  FOR EACH ROW EXECUTE FUNCTION public.handle_review_mention_notification();

-- Conferência: deve listar a tabela e o gatilho.
SELECT 'tabela' AS o_que, to_regclass('public.review_comment_mentions')::text AS valor
UNION ALL
SELECT 'gatilho', tgname FROM pg_trigger WHERE tgname = 'trg_review_mention_notification';
