-- O GATILHO PARA DE CARIMBAR TODOS OS FORMATOS DA TAREFA
--
-- Faltava esta peça pra independência valer de verdade. Existe um gatilho que,
-- ao mudar o status da TAREFA, empurra o status correspondente pra todos os
-- vídeos vinculados (trg_sync_task_status_to_video). Ele foi feito quando uma
-- tarefa tinha um vídeo só, e ali era útil: mover o cartão no quadro movia o
-- vídeo junto.
--
-- Com 16:9, 9:16 e 1:1 na mesma tarefa ele vira o oposto do que se quer: mexer
-- em UM formato mudava a tarefa, e a tarefa mudando reescrevia os outros dois.
-- Foi o que vimos acontecer: mover só o 1:1 para "alterações internas" levou os
-- três formatos junto.
--
-- Agora o gatilho age só quando a tarefa tem UM vídeo. Com mais de um, cada
-- formato é dono do próprio status, e quem descreve o conjunto é a tarefa (pela
-- regra do formato mais atrasado, em sincronizar_status_tarefa).

CREATE OR REPLACE FUNCTION public.sync_task_status_to_video()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r RECORD;
  v_next text;
  n_videos int;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;

  -- Quantos vídeos (grupos, não versões) esta tarefa tem?
  SELECT count(DISTINCT COALESCE(group_id::text, id::text)) INTO n_videos
  FROM video_versions WHERE task_id = NEW.id;

  -- Mais de um formato: cada um tem a própria etapa. A tarefa descreve o
  -- conjunto, não manda nele.
  IF n_videos > 1 THEN RETURN NEW; END IF;

  FOR r IN
    SELECT DISTINCT ON (COALESCE(group_id::text, id::text))
           id, status
    FROM video_versions
    WHERE task_id = NEW.id
    ORDER BY COALESCE(group_id::text, id::text), versao DESC
  LOOP
    v_next := public.task_status_to_video(NEW.status, r.status);
    IF v_next IS NOT NULL AND v_next <> r.status THEN
      UPDATE video_versions SET status = v_next, updated_at = now() WHERE id = r.id;
    END IF;
  END LOOP;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Falha ao sincronizar vídeo da tarefa %: %', NEW.id, SQLERRM;
  RETURN NEW;
END; $$;

-- Conferência: quantas tarefas passam a ficar livres do carimbo.
SELECT count(*) AS tarefas_com_mais_de_um_formato FROM (
  SELECT task_id FROM video_versions WHERE task_id IS NOT NULL
  GROUP BY task_id HAVING count(DISTINCT COALESCE(group_id::text, id::text)) > 1
) t;
