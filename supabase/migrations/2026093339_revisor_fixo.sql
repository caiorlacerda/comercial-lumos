-- REVISOR FIXO — quem acompanha toda revisão interna sem precisar ser chamado
--
-- Hoje, quando um vídeo entra na revisão, o aviso vai só pro responsável da
-- tarefa, pros colaboradores dela e, quando o vídeo não tem tarefa, pra admin e
-- produção. Na prática quem revisa tudo precisa ser adicionado à mão em cada
-- tarefa, e sempre escapa alguma.
--
-- A marca `app_users.revisor_fixo` resolve isso: quem estiver marcado entra
-- sozinho como colaborador da tarefa quando o vídeo chega, e recebe o aviso
-- junto com os outros.
--
-- E sai sozinho também: entrar sem nunca sair transforma a lista de tarefas
-- dessa gente num arquivo morto em duas semanas. Quando todos os formatos da
-- tarefa estão aprovados, quem entrou pelo automático é removido. Quem foi
-- posto à mão fica, sempre.
--
-- Nada aqui pode derrubar upload nem aprovação de vídeo: as duas funções são
-- SECURITY DEFINER com EXCEPTION WHEN OTHERS, igual às que já existem.

-- ───────────────────────────────────────────────────────────────────────────
-- 1) A marca na ficha
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS revisor_fixo boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.app_users.revisor_fixo IS
  'Acompanha automaticamente toda revisão interna: entra como colaborador da tarefa quando o vídeo chega e sai quando a revisão acaba.';

-- Índice minúsculo: são poucas pessoas, e as duas funções abaixo consultam
-- essa lista a cada vídeo.
CREATE INDEX IF NOT EXISTS idx_app_users_revisor_fixo
  ON public.app_users(id) WHERE revisor_fixo;

-- ───────────────────────────────────────────────────────────────────────────
-- 2) De onde veio o colaborador: automático ou mão de gente
--
-- `added_by` não serve pra isso. Ele já nasce nulo em vários caminhos (a pessoa
-- que adicionou pode ter sido excluída — a FK é ON DELETE SET NULL) e continuaria
-- nulo no automático, então "nulo" não distingue nada. Uma coluna própria, com
-- DEFAULT false, deixa a origem explícita: só a automação escreve true, e a
-- remoção automática só mexe em quem tem true. Assim nunca desfazemos uma
-- decisão que alguém tomou de propósito.
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.task_collaborators
  ADD COLUMN IF NOT EXISTS auto_revisor boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.task_collaborators.auto_revisor IS
  'true = entrou pelo automático do revisor fixo (pode sair sozinho). false = alguém colocou à mão (nunca sai sozinho).';

-- ───────────────────────────────────────────────────────────────────────────
-- 3) Colaborador automático não gera "Você entrou numa tarefa"
--
-- O revisor fixo já recebe o aviso de vídeo novo. O aviso de colaborador em
-- cima seria a mesma notícia duas vezes, e voltaria a cada ciclo de revisão da
-- mesma tarefa. Fora isso, é o que segura o retroativo: o backfill do passo 6
-- cria vínculo sem encher a sineta de uma vez.
-- Mantém tudo o que a função já fazia para os colaboradores de sempre.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_task_collab_notification()
RETURNS trigger AS $$
DECLARE
  active_user_id UUID;
  t RECORD;
BEGIN
  IF COALESCE(NEW.auto_revisor, false) THEN RETURN NEW; END IF;

  BEGIN
    active_user_id := (SELECT id FROM public.app_users WHERE auth_user_id = auth.uid() AND status = 'ativo');

    IF active_user_id IS NULL OR active_user_id != NEW.user_id THEN
      SELECT id, titulo, project_id INTO t FROM public.project_tasks WHERE id = NEW.task_id;

      INSERT INTO public.notifications (
        user_id, event_type, category, priority, title, body, link, data, actor_id
      ) VALUES (
        NEW.user_id,
        'todo_atribuido',
        'producao',
        'normal',
        'Você entrou numa tarefa',
        'Você foi adicionado como colaborador da tarefa "' || COALESCE(t.titulo, '') || '".',
        '/producao/projetos?projectId=' || COALESCE(t.project_id::text, '') || '&taskId=' || COALESCE(t.id::text, ''),
        jsonb_build_object('task_id', NEW.task_id, 'project_id', t.project_id, 'collab', true),
        active_user_id
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Erro ao notificar colaborador da tarefa %: %', NEW.task_id, SQLERRM;
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ───────────────────────────────────────────────────────────────────────────
-- 4) Vídeo novo: revisor fixo entra na tarefa e recebe o aviso
--
-- Mantém tudo o que a função já fazia. Muda duas coisas:
--   · antes de avisar, insere os revisores fixos em task_collaborators;
--   · a lista de quem é avisado passa a incluir revisor_fixo.
-- Vídeo sem task_id não tem onde inserir colaborador: nesse caso, só o aviso.
-- O DISTINCT de sempre é o que garante um aviso por pessoa, mesmo quem for
-- responsável, colaborador e revisor fixo ao mesmo tempo.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_video_novo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_proj_name text;
  v_task_titulo text;
  v_is_nova_versao boolean;
  v_responsavel uuid;
  u RECORD;
BEGIN
  SELECT name INTO v_proj_name FROM projects WHERE id = NEW.project_id;
  SELECT titulo, responsavel_id INTO v_task_titulo, v_responsavel
    FROM project_tasks WHERE id = NEW.task_id;
  v_is_nova_versao := NEW.versao > 1;

  -- Entra como colaborador. ON CONFLICT DO NOTHING cobre quem já está lá (e
  -- preserva o auto_revisor = false de quem foi posto à mão, que por isso nunca
  -- será removido depois). Quem já é o responsável fica de fora: ele é dono da
  -- tarefa, não precisa aparecer duas vezes na mesma linha.
  IF NEW.task_id IS NOT NULL THEN
    INSERT INTO task_collaborators (task_id, user_id, added_by, auto_revisor)
    SELECT NEW.task_id, a.id, NULL::uuid, true
    FROM app_users a
    WHERE a.status = 'ativo'
      AND a.revisor_fixo
      AND a.id IS DISTINCT FROM v_responsavel
    ON CONFLICT (task_id, user_id) DO NOTHING;
  END IF;

  FOR u IN
    SELECT DISTINCT a.id
    FROM app_users a
    WHERE a.status = 'ativo'
      AND (
        a.id = v_responsavel
        OR a.id IN (SELECT user_id FROM task_collaborators WHERE task_id = NEW.task_id)
        -- revisor fixo acompanha toda revisão, com tarefa ou sem
        OR a.revisor_fixo
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
-- 5) O vídeo mudou de etapa: sair da tarefa, e devolver a tarefa pro editor
--
-- (a) SAIR — só quando não sobrar trabalho de revisão na tarefa.
--     Uma tarefa costuma ter 16:9, 9:16 e 1:1 andando em ritmos diferentes:
--     aprovar o 16:9 com o 1:1 ainda em ajuste não pode tirar ninguém. Quem
--     responde "acabou?" é status_tarefa_pelos_videos (2026093322), a MESMA
--     conta que já decide a etapa da tarefa pelo formato mais atrasado. Ela só
--     devolve 'concluido' quando a versão atual de todos os formatos está
--     APROVADO. Nada de critério novo aqui.
--
-- (b) VOLTAR PRO EDITOR — vídeo que vai pra alteração volta pra quem subiu
--     aquela versão. video_versions.uploaded_by é texto (vem do Drive; quando o
--     upload sai do app, é o full_name de quem estava logado), então casamos por
--     nome ou e-mail e SÓ quando bate em exatamente uma pessoa ativa. Dois
--     homônimos, nome do Google que não existe no app, ou campo vazio: não
--     mexemos no responsável. Melhor manter quem está do que apagar.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.revisor_fixo_ciclo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_etapa  text;
  v_ids    uuid[];
BEGIN
  IF NEW.task_id IS NULL OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- (a) acabou a revisão da tarefa inteira?
  v_etapa := public.status_tarefa_pelos_videos(NEW.task_id);
  IF v_etapa = 'concluido' THEN
    DELETE FROM task_collaborators tc
    USING app_users a
    WHERE tc.task_id = NEW.task_id
      AND tc.user_id = a.id
      AND tc.auto_revisor          -- entrou pelo automático
      AND a.revisor_fixo;          -- e segue sendo revisor fixo
  END IF;

  -- (b) foi pra alteração: a tarefa volta pro editor que enviou
  IF NEW.status IN ('ALTERACOES_INTERNAS', 'ALTERACOES_CLIENTE')
     AND COALESCE(btrim(NEW.uploaded_by), '') <> '' THEN
    SELECT array_agg(a.id) INTO v_ids
    FROM app_users a
    WHERE a.status = 'ativo'
      AND (
        lower(btrim(a.full_name)) = lower(btrim(NEW.uploaded_by))
        OR lower(btrim(a.email))  = lower(btrim(NEW.uploaded_by))
      );

    IF v_ids IS NOT NULL AND array_length(v_ids, 1) = 1 THEN
      -- O IS DISTINCT FROM evita escrita à toa e, com ela, o segundo aviso de
      -- "tarefa atribuída" pra quem já é o responsável.
      UPDATE project_tasks
      SET responsavel_id = v_ids[1]
      WHERE id = NEW.task_id
        AND responsavel_id IS DISTINCT FROM v_ids[1];
    END IF;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Falha no ciclo do revisor fixo (vídeo %): %', NEW.id, SQLERRM;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_revisor_fixo_ciclo ON public.video_versions;
CREATE TRIGGER trg_revisor_fixo_ciclo
  AFTER UPDATE OF status ON public.video_versions
  FOR EACH ROW EXECUTE FUNCTION public.revisor_fixo_ciclo();

-- ───────────────────────────────────────────────────────────────────────────
-- 6) As tarefas que já estão abertas
--
-- Só o vínculo, sem notificação retroativa (o passo 3 cuida disso).
--
-- Quais vídeos contam:
--   · EM_REVISAO_INTERNA e ALTERACOES_INTERNAS = a fase interna. O par aparece
--     junto em review_decide e nas funções do link público (2026093200,
--     2026093314, 2026093315, 2026093318) exatamente como "fase interna".
--   · EM_REVISAO_CLIENTE = aguardando o cliente, a bola está com ele.
--   · ALTERACOES_CLIENTE fica de fora: o cliente já decidiu, não se espera mais
--     nada dele — e a próxima versão que subir aciona o gatilho do passo 4.
--   · APROVADO fica de fora: acabou.
-- E só a versão ATUAL de cada formato conta, como em status_tarefa_pelos_videos:
-- versão antiga guarda o status de quando foi substituída.
--
-- É uma função pra poder rodar de novo depois de marcar as pessoas (o passo 8
-- deixa a linha pronta). Rodar duas vezes não duplica nada.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.backfill_revisores_fixos()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  INSERT INTO task_collaborators (task_id, user_id, added_by, auto_revisor)
  SELECT DISTINCT vv.task_id, a.id, NULL::uuid, true
  FROM video_versions vv
  JOIN project_tasks pt ON pt.id = vv.task_id AND pt.deleted_at IS NULL
  CROSS JOIN app_users a
  WHERE a.status = 'ativo'
    AND a.revisor_fixo
    AND a.id IS DISTINCT FROM pt.responsavel_id
    AND vv.status IN ('EM_REVISAO_INTERNA', 'ALTERACOES_INTERNAS', 'EM_REVISAO_CLIENTE')
    AND vv.id = (
      SELECT v2.id FROM video_versions v2
      WHERE COALESCE(v2.group_id, v2.id) = COALESCE(vv.group_id, vv.id)
      ORDER BY v2.versao DESC LIMIT 1
    )
  ON CONFLICT (task_id, user_id) DO NOTHING;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END; $$;

SELECT public.backfill_revisores_fixos();

-- ───────────────────────────────────────────────────────────────────────────
-- 7) Conferência
-- ───────────────────────────────────────────────────────────────────────────
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (table_name, column_name) IN (('app_users', 'revisor_fixo'), ('task_collaborators', 'auto_revisor'))
ORDER BY table_name;

-- ───────────────────────────────────────────────────────────────────────────
-- 8) Ligar para as duas pessoas
--
-- A coluna nasce toda FALSA. O pedido era marcar "o Caio e o Vini", e o time
-- tem DOIS Vinicius ativos: Ankerkrone (CFO, admin) e Gimenez (Editor). Não é
-- acaso que src/pages/ProducaoOverview.tsx já abrevia nome com a inicial do
-- sobrenome: é justamente pra esses dois não se confundirem. Em vez de chutar,
-- a pergunta foi feita.
--
-- Escolhidos pelo Caio em 01/09/2026: ele e o Vinicius Ankerkrone. O outro
-- Vinicius ativo (Vinicius Gimenez, Editor) NÃO entra: ele é quem sobe vídeo,
-- e revisor fixo é quem confere. Para mudar depois, não mexa aqui: é a marca
-- "Revisor fixo" na ficha da pessoa, em Usuários ou Equipe.
UPDATE public.app_users
SET revisor_fixo = true
WHERE status = 'ativo'
  AND email IN (
    'caio.lacerda@produtoralumos.com.br',        -- Caio Rizzutti
    'vinicius.ankerkrone@produtoralumos.com.br'  -- Vinicius Ankerkrone
  );

-- O vínculo nas tarefas que já estão em revisão hoje, sem notificação
-- retroativa: só entram como colaboradores, a sineta não toca.
SELECT public.backfill_revisores_fixos();

-- Conferência: tem que listar exatamente duas pessoas.
SELECT full_name, email, role
FROM public.app_users
WHERE revisor_fixo AND status = 'ativo'
ORDER BY full_name;
--
-- Conferência:
-- SELECT full_name, email, revisor_fixo FROM public.app_users WHERE revisor_fixo;
