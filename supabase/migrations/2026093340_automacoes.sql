-- 2026093340_automacoes.sql
-- AUTOMAÇÕES: quem participa do que o app faz sozinho sai do código e vira dado
--
-- O app tem dezenas de gatilhos rodando sozinhos, e em cinco deles a lista de
-- quem participa estava escrita no código do banco. Trocar uma pessoa era abrir
-- uma migração nova. A partir daqui a lista mora na tabela `automacoes` e a
-- página Configurações → Automações mexe nela.
--
-- Três regras, e elas mandam em tudo o que vem abaixo:
--
--   1) Automação que não existe na tabela conta como LIGADA. Um deploy novo
--      nunca pode chegar com comportamento desligado por descuido.
--   2) Automação desligada não roda, e nada quebra: o gatilho lê a tabela,
--      não faz nada e devolve a linha.
--   3) Falha ao ler a configuração NUNCA derruba a operação principal. Subir
--      vídeo não pode falhar porque a tabela de automações está fora do ar.
--      Por isso automacao_ativa() devolve true quando não consegue ler: a
--      leitura que falha mantém o comportamento que o app já tem hoje.
--
-- Nada aqui edita migração antiga. Todas as funções entram por CREATE OR
-- REPLACE, com o corpo que está em produção hoje mais o portão da automação.
--
-- ANTES DE RODAR: feche as abas do app (app.produtoralumos.com.br e a preview).
-- Criar tabela com política exige lock, e o app lendo ao mesmo tempo pode gerar
-- deadlock. Se der "lock timeout", espere alguns segundos e rode de novo.

SET lock_timeout = '15s';

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) A tabela
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.automacoes (
  chave      text PRIMARY KEY,
  ativa      boolean NOT NULL DEFAULT true,
  config     jsonb   NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.automacoes IS
  'Liga, desliga e configura o que o app faz sozinho. Chave ausente = ligada.';
COMMENT ON COLUMN public.automacoes.config IS
  'Ajustes por automação. Hoje só pedido_diaria_avisa usa: {"user_ids": [...]} com quem é avisado; lista vazia mantém o padrão por papel.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) Quem pode mexer, cobrado pelo banco
--
-- Mesmo formato de pode_fechar_agenda() (2026093335): a checagem vive numa
-- função SECURITY DEFINER e as políticas só a chamam. A regra aqui é mais
-- estreita de propósito, porque uma automação vale para a produtora inteira:
-- só papel 'admin'. É a mesma conta que o isAdmin da tela faz.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.pode_configurar_automacoes()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM app_users u
    WHERE u.auth_user_id = auth.uid()
      AND u.status = 'ativo'
      AND u.role = 'admin'
  );
$$;

COMMENT ON FUNCTION public.pode_configurar_automacoes() IS
  'Só admin ativo liga, desliga ou reconfigura automação. Usada pelas policies da tabela automacoes.';

GRANT EXECUTE ON FUNCTION public.pode_configurar_automacoes() TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.automacoes TO authenticated;

ALTER TABLE public.automacoes ENABLE ROW LEVEL SECURITY;

-- Leitura liberada pra quem está logado: a página mostra o estado das
-- automações, e ver o que o app faz sozinho não é privilégio de ninguém.
DROP POLICY IF EXISTS "time le automacoes" ON public.automacoes;
DROP POLICY IF EXISTS "so admin liga automacao" ON public.automacoes;
DROP POLICY IF EXISTS "so admin altera automacao" ON public.automacoes;
DROP POLICY IF EXISTS "so admin apaga automacao" ON public.automacoes;

CREATE POLICY "time le automacoes" ON public.automacoes
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "so admin liga automacao" ON public.automacoes
  FOR INSERT TO authenticated WITH CHECK (public.pode_configurar_automacoes());

CREATE POLICY "so admin altera automacao" ON public.automacoes
  FOR UPDATE TO authenticated
  USING (public.pode_configurar_automacoes()) WITH CHECK (public.pode_configurar_automacoes());

CREATE POLICY "so admin apaga automacao" ON public.automacoes
  FOR DELETE TO authenticated USING (public.pode_configurar_automacoes());

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) As cinco chaves do catálogo, já ligadas
--
-- ON CONFLICT DO NOTHING: rodar de novo nunca religa o que alguém desligou.
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO public.automacoes (chave, ativa) VALUES
  ('revisor_fixo',              true),
  ('atendimento_com_cliente',   true),
  ('recusado_volta_pro_editor', true),
  ('pedido_diaria_avisa',       true),
  ('cliente_abriu_portal_avisa',true)
ON CONFLICT (chave) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) Como o gatilho pergunta
--
-- Duas funções minúsculas, e é por elas que passa a regra 3: as duas engolem
-- qualquer erro. Tabela ausente, permissão errada, banco lento no meio de uma
-- transação: a resposta é "ligada" e a operação principal segue. Preferimos o
-- comportamento de hoje a uma falha no upload de vídeo.
--
-- SECURITY DEFINER porque o gatilho do portal roda como anon, que não tem
-- policy de leitura nesta tabela.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.automacao_ativa(p_chave text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v boolean;
BEGIN
  SELECT ativa INTO v FROM automacoes WHERE chave = p_chave;
  -- Chave que não está na tabela é tratada como ligada (regra 2).
  RETURN COALESCE(v, true);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'automacao_ativa(%) falhou, seguindo como ligada: %', p_chave, SQLERRM;
  RETURN true;
END; $$;

COMMENT ON FUNCTION public.automacao_ativa(text) IS
  'Esta automação está ligada? Chave ausente ou falha de leitura respondem true, pra nunca derrubar a operação principal.';

CREATE OR REPLACE FUNCTION public.automacao_config(p_chave text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v jsonb;
BEGIN
  SELECT config INTO v FROM automacoes WHERE chave = p_chave;
  RETURN COALESCE(v, '{}'::jsonb);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'automacao_config(%) falhou, seguindo sem ajuste: %', p_chave, SQLERRM;
  RETURN '{}'::jsonb;
END; $$;

COMMENT ON FUNCTION public.automacao_config(text) IS
  'Ajustes da automação em jsonb. Devolve {} quando não há linha ou a leitura falha.';

GRANT EXECUTE ON FUNCTION public.automacao_ativa(text)  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.automacao_config(text) TO anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5) A marca de atendimento do projeto
--
-- project_members.funcao continua texto livre pra escrever o que a pessoa faz
-- ali. A marca é coisa separada, porque procurar a palavra "atendimento" no
-- texto quebraria no primeiro "Atend." ou "Atendimento / PM".
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.project_members
  ADD COLUMN IF NOT EXISTS e_atendimento boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.project_members.e_atendimento IS
  'É o atendimento deste projeto: entra na tarefa e é avisado quando o vídeo vai para a revisão do cliente.';

CREATE INDEX IF NOT EXISTS idx_project_members_atendimento
  ON public.project_members(project_id) WHERE e_atendimento;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6) Vídeo novo: o revisor fixo agora depende da automação
--
-- Corpo idêntico ao de 2026093339, com um portão. Desligada, a função continua
-- avisando responsável e colaboradores exatamente como antes do revisor fixo
-- existir: ninguém entra na tarefa e ninguém a mais é avisado.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.notify_video_novo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_proj_name text;
  v_task_titulo text;
  v_is_nova_versao boolean;
  v_responsavel uuid;
  v_rev boolean;
  u RECORD;
BEGIN
  SELECT name INTO v_proj_name FROM projects WHERE id = NEW.project_id;
  SELECT titulo, responsavel_id INTO v_task_titulo, v_responsavel
    FROM project_tasks WHERE id = NEW.task_id;
  v_is_nova_versao := NEW.versao > 1;

  -- Uma leitura só, usada no INSERT e na lista de avisados: duas leituras
  -- poderiam discordar se alguém desligasse a automação no meio.
  v_rev := public.automacao_ativa('revisor_fixo');

  -- Entra como colaborador. ON CONFLICT DO NOTHING cobre quem já está lá (e
  -- preserva o auto_revisor = false de quem foi posto à mão, que por isso nunca
  -- será removido depois). Quem já é o responsável fica de fora: ele é dono da
  -- tarefa, não precisa aparecer duas vezes na mesma linha.
  IF NEW.task_id IS NOT NULL AND v_rev THEN
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
        OR (v_rev AND a.revisor_fixo)
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

COMMENT ON FUNCTION public.notify_video_novo() IS
  'Vídeo entra na revisão: avisa responsável e colaboradores da tarefa, e com a automação revisor_fixo ligada põe os revisores fixos como colaboradores e avisa também.';

DROP TRIGGER IF EXISTS trg_notify_video_novo ON public.video_versions;
CREATE TRIGGER trg_notify_video_novo
  AFTER INSERT ON public.video_versions
  FOR EACH ROW EXECUTE FUNCTION public.notify_video_novo();

-- ═══════════════════════════════════════════════════════════════════════════
-- 7) O ciclo: sair da tarefa e devolver a tarefa pro editor
--
-- Corpo de 2026093339 com duas mudanças:
--
--   (a) a SAÍDA passa a valer também para o atendimento do projeto. Ela NÃO é
--       gateada por automação, de propósito: a saída só desfaz o que o
--       automático fez (auto_revisor = true) e nunca toca em quem foi posto à
--       mão. Se ela dependesse do interruptor, desligar uma automação deixaria
--       gente presa em tarefa pra sempre, que é exatamente o arquivo morto que
--       a saída existe pra evitar.
--
--   (b) a VOLTA PRO EDITOR passa pelo interruptor recusado_volta_pro_editor.
--       Desligada, vídeo que vai pra alteração não mexe mais no responsável da
--       tarefa, e quem estiver lá continua.
-- ═══════════════════════════════════════════════════════════════════════════
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
  --     Quem responde continua sendo status_tarefa_pelos_videos (2026093322),
  --     a mesma conta que decide a etapa da tarefa pelo formato mais atrasado:
  --     só dá 'concluido' quando a versão atual de TODOS os formatos está
  --     aprovada. Nada de critério novo.
  v_etapa := public.status_tarefa_pelos_videos(NEW.task_id);
  IF v_etapa = 'concluido' THEN
    DELETE FROM task_collaborators tc
    WHERE tc.task_id = NEW.task_id
      AND tc.auto_revisor                      -- entrou pelo automático
      AND (
        -- e segue sendo revisor fixo…
        EXISTS (SELECT 1 FROM app_users a
                 WHERE a.id = tc.user_id AND a.revisor_fixo)
        -- …ou segue sendo o atendimento deste projeto
        OR EXISTS (SELECT 1 FROM project_members pm
                    WHERE pm.project_id = NEW.project_id
                      AND pm.user_id = tc.user_id
                      AND pm.e_atendimento)
      );
  END IF;

  -- (b) foi pra alteração: a tarefa volta pro editor que enviou
  IF NEW.status IN ('ALTERACOES_INTERNAS', 'ALTERACOES_CLIENTE')
     AND COALESCE(btrim(NEW.uploaded_by), '') <> ''
     AND public.automacao_ativa('recusado_volta_pro_editor') THEN
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

COMMENT ON FUNCTION public.revisor_fixo_ciclo() IS
  'Vídeo muda de etapa: tira da tarefa quem entrou pelo automático quando todos os formatos estão aprovados, e com recusado_volta_pro_editor ligada devolve a tarefa a quem subiu a versão recusada.';

DROP TRIGGER IF EXISTS trg_revisor_fixo_ciclo ON public.video_versions;
CREATE TRIGGER trg_revisor_fixo_ciclo
  AFTER UPDATE OF status ON public.video_versions
  FOR EACH ROW EXECUTE FUNCTION public.revisor_fixo_ciclo();

-- ═══════════════════════════════════════════════════════════════════════════
-- 8) A automação nova: o atendimento acompanha o vídeo que foi pro cliente
--
-- Quando o vídeo passa pra revisão do cliente, quem estiver marcado como
-- atendimento naquele projeto entra como colaborador da tarefa e é avisado.
-- Mesmo mecanismo do revisor fixo, inclusive a marca auto_revisor, que é o que
-- permite tirar essa pessoa depois sem atropelar decisão de gente.
--
-- Dois gatilhos porque a passagem pro cliente acontece de dois jeitos: o comum
-- é o UPDATE de status (moverEtapa, em src/lib/reviewTransition.ts), e um vídeo
-- também pode nascer já com o status do cliente.
--
-- Quando o atendimento SAI: no mesmo momento que o revisor fixo, quando a
-- versão atual de todos os formatos da tarefa está aprovada (passo 7a). Não sai
-- quando o cliente pede alteração: é justamente aí que o atendimento precisa
-- ver o retorno e tocar a próxima rodada.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.atendimento_com_cliente()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_proj_name   text;
  v_task_titulo text;
  v_responsavel uuid;
  u RECORD;
BEGIN
  IF NEW.status IS DISTINCT FROM 'EM_REVISAO_CLIENTE' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NOT public.automacao_ativa('atendimento_com_cliente') THEN RETURN NEW; END IF;

  SELECT name INTO v_proj_name FROM projects WHERE id = NEW.project_id;
  SELECT titulo, responsavel_id INTO v_task_titulo, v_responsavel
    FROM project_tasks WHERE id = NEW.task_id;

  -- Entra na tarefa. auto_revisor = true é o que diz "entrou pelo automático":
  -- o ON CONFLICT preserva o false de quem foi posto à mão, e a saída do passo
  -- 7a só olha para o true.
  IF NEW.task_id IS NOT NULL THEN
    INSERT INTO task_collaborators (task_id, user_id, added_by, auto_revisor)
    SELECT NEW.task_id, pm.user_id, NULL::uuid, true
    FROM project_members pm
    JOIN app_users a ON a.id = pm.user_id AND a.status = 'ativo'
    WHERE pm.project_id = NEW.project_id
      AND pm.e_atendimento
      AND pm.user_id IS NOT NULL
      AND pm.user_id IS DISTINCT FROM v_responsavel
    ON CONFLICT (task_id, user_id) DO NOTHING;
  END IF;

  -- O aviso vai pra todo atendimento do projeto, inclusive quem já era
  -- responsável ou colaborador: a notícia é a passagem pro cliente, e ela
  -- interessa a ele do mesmo jeito. DISTINCT garante um aviso por pessoa.
  FOR u IN
    SELECT DISTINCT pm.user_id AS id
    FROM project_members pm
    JOIN app_users a ON a.id = pm.user_id AND a.status = 'ativo'
    WHERE pm.project_id = NEW.project_id
      AND pm.e_atendimento
      AND pm.user_id IS NOT NULL
  LOOP
    INSERT INTO notifications (user_id, event_type, category, priority, title, body, link, data)
    VALUES (
      u.id, 'video_com_cliente', 'producao', 'high',
      'Vídeo foi para o cliente 🎬',
      COALESCE(NEW.file_name, 'Um vídeo') || ' de ' || COALESCE(v_proj_name, 'um projeto')
        || COALESCE(' · ' || v_task_titulo, '') || ' está com o cliente.',
      '/producao/projetos?projectId=' || COALESCE(NEW.project_id::text, '') || '&tab=entregas',
      jsonb_build_object('video_version_id', NEW.id, 'project_id', NEW.project_id, 'versao', NEW.versao)
    );
  END LOOP;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Falha no atendimento com cliente (vídeo %): %', NEW.id, SQLERRM;
  RETURN NEW;
END; $$;

COMMENT ON FUNCTION public.atendimento_com_cliente() IS
  'Vídeo vai para a revisão do cliente: quem está marcado como atendimento do projeto entra como colaborador da tarefa e recebe o aviso.';

DROP TRIGGER IF EXISTS trg_atendimento_com_cliente_ins ON public.video_versions;
CREATE TRIGGER trg_atendimento_com_cliente_ins
  AFTER INSERT ON public.video_versions
  FOR EACH ROW WHEN (NEW.status = 'EM_REVISAO_CLIENTE')
  EXECUTE FUNCTION public.atendimento_com_cliente();

DROP TRIGGER IF EXISTS trg_atendimento_com_cliente_upd ON public.video_versions;
CREATE TRIGGER trg_atendimento_com_cliente_upd
  AFTER UPDATE OF status ON public.video_versions
  FOR EACH ROW WHEN (NEW.status = 'EM_REVISAO_CLIENTE' AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.atendimento_com_cliente();

-- ═══════════════════════════════════════════════════════════════════════════
-- 9) Pedido de diária: liga, desliga e escolhe quem é avisado
--
-- Corpo de 2026093333 com o portão e com a lista configurável. Sem lista
-- escolhida, o padrão continua sendo o de hoje: admin, produção e o papel
-- legado atendimento. Com lista, ela manda, e o papel deixa de importar.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.notificar_pedido_de_diaria()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  u        RECORD;
  v_proj   text;
  v_quando text;
  v_ids    uuid[] := NULL;
BEGIN
  IF NOT public.automacao_ativa('pedido_diaria_avisa') THEN RETURN NEW; END IF;

  -- Quem foi escolhido na página. Lista vazia, chave ausente ou id estragado
  -- caem no padrão por papel: melhor avisar demais do que ninguém.
  BEGIN
    SELECT array_agg(t.v::uuid) INTO v_ids
    FROM jsonb_array_elements_text(
           COALESCE(public.automacao_config('pedido_diaria_avisa') -> 'user_ids', '[]'::jsonb)
         ) AS t(v);
  EXCEPTION WHEN OTHERS THEN
    v_ids := NULL;
  END;

  SELECT name INTO v_proj FROM projects WHERE id = NEW.project_id;
  v_quando := to_char(NEW.data_desejada, 'DD/MM');
  FOR u IN
    SELECT id FROM app_users
    WHERE status = 'ativo'
      AND CASE
            WHEN v_ids IS NOT NULL THEN id = ANY(v_ids)
            ELSE role IN ('admin','producao','atendimento')
          END
  LOOP
    INSERT INTO notifications (user_id, event_type, category, priority, title, body, link, data)
    VALUES (
      u.id, 'diaria_solicitada', 'producao', 'high',
      'Cliente pediu uma diária 📅',
      NEW.nome || ' pediu ' || v_quando || ' em ' || COALESCE(v_proj, 'um projeto') || '.',
      '/producao/projetos?projectId=' || NEW.project_id::text || '&tab=diarias',
      jsonb_build_object('pedido_id', NEW.id, 'project_id', NEW.project_id)
    );
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notificar_pedido_de_diaria falhou para %: %', NEW.id, SQLERRM;
  RETURN NEW;
END; $$;

COMMENT ON FUNCTION public.notificar_pedido_de_diaria() IS
  'Cliente pede diária pelo portal: avisa quem foi escolhido na automação pedido_diaria_avisa, ou admin e produção quando ninguém foi escolhido.';

DROP TRIGGER IF EXISTS trg_notificar_pedido_de_diaria ON public.diaria_pedidos;
CREATE TRIGGER trg_notificar_pedido_de_diaria
  AFTER INSERT ON public.diaria_pedidos
  FOR EACH ROW EXECUTE FUNCTION public.notificar_pedido_de_diaria();

-- ═══════════════════════════════════════════════════════════════════════════
-- 10) Cliente abriu o portal: o aviso passa pelo interruptor
--
-- Corpo idêntico ao de 2026093328, com uma linha a mais no cálculo de v_avisar.
-- Desligada, o portal abre igual, a contagem de aberturas continua sendo
-- gravada, e só o aviso deixa de sair.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_client_portal_v2(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_portal    RECORD;
  v_client    RECORD;
  v_client_id uuid;
  v_abrir     uuid := NULL;
  v_avisar    boolean := false;
  v_fin       jsonb := NULL;
  v_result    jsonb;
  u           RECORD;
  v_email     text;
  -- Escalares, e não um RECORD: sem login a variável nunca é preenchida, e ler
  -- um campo de RECORD não atribuído derruba a função inteira.
  v_pessoa_id    uuid := NULL;
  v_pessoa_nome  text := NULL;
  v_pessoa_email text := NULL;
  v_restrito     boolean := false;
  c_visiveis  text[] := ARRAY['EM_REVISAO_CLIENTE', 'ALTERACOES_CLIENTE', 'APROVADO'];
  c_mes       date := date_trunc('month', current_date)::date;
BEGIN
  SELECT * INTO v_portal FROM client_portals WHERE token = p_token AND active = true;

  IF v_portal IS NULL THEN
    SELECT pr.client_id, pp.project_id INTO v_client_id, v_abrir
    FROM project_portals pp JOIN projects pr ON pr.id = pp.project_id
    WHERE pp.token = p_token AND pp.active = true;
    IF v_client_id IS NULL THEN RETURN jsonb_build_object('error', 'invalid'); END IF;
    SELECT * INTO v_portal FROM client_portals WHERE client_id = v_client_id AND active = true;
    IF v_portal IS NULL THEN
      INSERT INTO client_portals (client_id) VALUES (v_client_id) RETURNING * INTO v_portal;
    END IF;
  END IF;

  SELECT id, name INTO v_client FROM clients WHERE id = v_portal.client_id;
  IF v_client IS NULL THEN RETURN jsonb_build_object('error', 'invalid'); END IF;

  -- Porta: com login ligado, o link sozinho não abre mais nada.
  IF v_portal.exige_login THEN
    v_email := lower(COALESCE(auth.jwt() ->> 'email', ''));
    IF v_email = '' THEN
      RETURN jsonb_build_object('error', 'precisa_login',
                                'cliente', jsonb_build_object('nome', v_client.name));
    END IF;
    SELECT id, nome, email INTO v_pessoa_id, v_pessoa_nome, v_pessoa_email
    FROM client_users
    WHERE client_id = v_client.id AND lower(email) = v_email AND ativo;
    IF v_pessoa_id IS NULL THEN
      RETURN jsonb_build_object('error', 'sem_acesso',
                                'cliente', jsonb_build_object('nome', v_client.name));
    END IF;
    UPDATE client_users SET auth_user_id = auth.uid(), last_login_at = now()
    WHERE id = v_pessoa_id;
    v_restrito := EXISTS (SELECT 1 FROM client_user_projects WHERE client_user_id = v_pessoa_id);
  END IF;

  -- AUTOMAÇÃO cliente_abriu_portal_avisa: desligada, ninguém é avisado. A
  -- contagem de aberturas logo abaixo continua rodando de qualquer jeito.
  v_avisar := public.automacao_ativa('cliente_abriu_portal_avisa')
              AND (v_portal.last_opened_at IS NULL
                   OR v_portal.last_opened_at < now() - interval '60 minutes');
  IF v_avisar THEN
    FOR u IN
      SELECT DISTINCT a.id FROM app_users a
      WHERE a.status = 'ativo'
        AND (a.role IN ('admin', 'atendimento') OR a.id = ANY(v_portal.contact_user_ids))
    LOOP
      INSERT INTO notifications (user_id, event_type, category, priority, title, body, link, data)
      VALUES (
        u.id, 'cliente_abriu_link', 'producao', 'normal',
        'Cliente abriu o portal 👀',
        COALESCE(v_pessoa_nome, v_pessoa_email, v_client.name) || ' abriu o portal.',
        '/producao',
        jsonb_build_object('client_portal_id', v_portal.id, 'client_id', v_client.id)
      );
    END LOOP;
  END IF;
  UPDATE client_portals
  SET last_opened_at = now(), opened_count = opened_count + 1
  WHERE id = v_portal.id;

  INSERT INTO review_links (video_version_id, group_id)
  SELECT DISTINCT ON (vv.group_id) vv.id, vv.group_id
  FROM video_versions vv
  JOIN projects p ON p.id = vv.project_id
  WHERE p.client_id = v_client.id
    AND vv.status = ANY(c_visiveis)
    AND NOT EXISTS (SELECT 1 FROM review_links rl WHERE rl.group_id = vv.group_id AND rl.active = true)
  ORDER BY vv.group_id, vv.versao DESC;

  IF v_portal.show_financeiro THEN
    SELECT jsonb_build_object(
      'em_dia', NOT EXISTS (
        SELECT 1 FROM receivables r
        JOIN projects p ON p.budget_id = r.budget_id
        WHERE p.client_id = v_client.id
          AND r.status NOT IN ('recebido', 'cancelado')
          AND r.due_date IS NOT NULL AND r.due_date < current_date
      ),
      'proximo_vencimento', (
        SELECT MIN(r.due_date) FROM receivables r
        JOIN projects p ON p.budget_id = r.budget_id
        WHERE p.client_id = v_client.id
          AND r.status NOT IN ('recebido', 'cancelado')
          AND r.due_date IS NOT NULL AND r.due_date >= current_date
      )
    ) INTO v_fin;
  END IF;

  SELECT jsonb_build_object(
    'cliente', jsonb_build_object('nome', v_client.name),
    'portal', jsonb_build_object('show_financeiro', v_portal.show_financeiro,
                                 'blocks', v_portal.blocks,
                                 'exige_login', v_portal.exige_login),
    'voce', CASE WHEN v_pessoa_id IS NULL THEN NULL ELSE
      jsonb_build_object('nome', COALESCE(v_pessoa_nome, split_part(v_pessoa_email, '@', 1)),
                         'email', v_pessoa_email) END,
    'abrir_projeto', v_abrir,
    'projetos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id, 'nome', p.name, 'code', p.code, 'status', p.status,
        'data_inicio', p.data_inicio, 'data_fim', p.data_fim,
        'entregas', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'file_name', e.file_name, 'versao', e.versao, 'status', e.status,
            'largura', e.width, 'altura', e.height,
            'client_decision', e.client_decision,
            'client_decided_by', e.client_decided_by,
            'client_decided_at', e.client_decided_at,
            'entregue_em', COALESCE(e.entregue_em, e.uploaded_at, e.created_at),
            'review_token', (
              SELECT rl.token FROM review_links rl
              WHERE rl.group_id = e.group_id AND rl.active = true
              ORDER BY rl.created_at DESC LIMIT 1
            ),
            'allow_download', COALESCE((
              SELECT rl.allow_download FROM review_links rl
              WHERE rl.group_id = e.group_id AND rl.active = true
              ORDER BY rl.created_at DESC LIMIT 1
            ), false)
          ) ORDER BY COALESCE(e.entregue_em, e.created_at) DESC)
          FROM (
            SELECT DISTINCT ON (vv.group_id) vv.*
            FROM video_versions vv
            WHERE vv.project_id = p.id AND vv.status = ANY(c_visiveis)
            ORDER BY vv.group_id, vv.versao DESC
          ) e
        ), '[]'::jsonb),
        'cronograma', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'etapa', c.status, 'n', c.n, 'inicio', c.inicio, 'fim', c.fim, 'prazo_cliente', c.prazo))
          FROM (
            SELECT status, count(*) AS n, min(data_inicio) AS inicio,
                   max(data_fim) AS fim, min(data_entrega_cliente) AS prazo
            FROM project_tasks
            WHERE project_id = p.id AND deleted_at IS NULL
            GROUP BY status
          ) c
        ), '[]'::jsonb),
        'stages', (
          SELECT COALESCE(jsonb_object_agg(s.status, s.n), '{}'::jsonb)
          FROM (
            SELECT status, count(*) AS n FROM project_tasks
            WHERE project_id = p.id AND deleted_at IS NULL GROUP BY status
          ) s
        ),
        'escopo', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('rotulo', x.rotulo, 'meta', x.meta, 'realizado', x.realizado))
          FROM escopo_do_mes(p.id, c_mes) x
          WHERE x.periodo = 'mes'
        ), '[]'::jsonb),
        'arquivos', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('name', d.name, 'url', d.url, 'kind', d.kind) ORDER BY d.created_at DESC)
          FROM project_documents d
          WHERE d.project_id = p.id AND d.tag = 'entrega'
        ), '[]'::jsonb)
      ) ORDER BY (p.status = 'concluido'), p.created_at DESC)
      FROM projects p
      WHERE p.client_id = v_client.id
        AND p.portal_visivel
        AND (p.status <> 'concluido' OR p.updated_at > now() - interval '90 days')
        AND (NOT v_restrito OR p.id IN (
              SELECT cup.project_id FROM client_user_projects cup
              WHERE cup.client_user_id = v_pessoa_id))
    ), '[]'::jsonb),
    'contatos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'nome', a.full_name,
        'email', a.email,
        'cargo', COALESCE(NULLIF(a.job_title, ''), tm.role_title),
        'foto', COALESCE(NULLIF(a.avatar_url, ''), tm.photo_url),
        'whatsapp', COALESCE(NULLIF(tm.whatsapp, ''), NULLIF(a.phone, '')),
        'slack', NULLIF(tm.slack, '')
      ) ORDER BY array_position(v_portal.contact_user_ids, a.id))
      FROM app_users a
      LEFT JOIN team_members tm ON tm.app_user_id = a.id
      WHERE a.id = ANY(v_portal.contact_user_ids) AND a.status = 'ativo'
    ), '[]'::jsonb),
    'financeiro', v_fin,
    'atividade', COALESCE((
      SELECT jsonb_agg(t.x ORDER BY (t.x->>'quando') DESC)
      FROM (
        SELECT raw.x FROM (
          SELECT jsonb_build_object('tipo', 'decisao', 'projeto', p.name,
            'file_name', vv.file_name, 'decisao', vv.client_decision,
            'quem', vv.client_decided_by, 'quando', vv.client_decided_at) AS x
          FROM video_versions vv JOIN projects p ON p.id = vv.project_id
          WHERE p.client_id = v_client.id AND p.portal_visivel
            AND vv.status = ANY(c_visiveis) AND vv.client_decided_at IS NOT NULL
            AND (NOT v_restrito OR p.id IN (
                  SELECT cup.project_id FROM client_user_projects cup
                  WHERE cup.client_user_id = v_pessoa_id))
          UNION ALL
          SELECT jsonb_build_object('tipo', 'entrega', 'projeto', p.name,
            'file_name', vv.file_name, 'versao', vv.versao,
            'quando', COALESCE(vv.entregue_em, vv.uploaded_at, vv.created_at))
          FROM video_versions vv JOIN projects p ON p.id = vv.project_id
          WHERE p.client_id = v_client.id AND p.portal_visivel
            AND vv.status = ANY(c_visiveis)
            AND (NOT v_restrito OR p.id IN (
                  SELECT cup.project_id FROM client_user_projects cup
                  WHERE cup.client_user_id = v_pessoa_id))
        ) raw
        ORDER BY (raw.x->>'quando') DESC NULLS LAST
        LIMIT 12
      ) t
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END; $$;

GRANT EXECUTE ON FUNCTION public.get_client_portal_v2(text) TO anon, authenticated;

COMMENT ON FUNCTION public.get_client_portal_v2(text) IS
  'Tudo o que o portal do cliente mostra, numa consulta só. Com a automação cliente_abriu_portal_avisa ligada, avisa o time na primeira abertura de cada hora.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 11) A lista do que a página só mostra
--
-- Lida do catálogo do Postgres, não de uma lista escrita à mão em TypeScript:
-- lista escrita à mão apodrece na primeira migração que alguém esquecer de
-- espelhar. Aqui, gatilho que existe aparece, gatilho que sumiu some.
--
-- A descrição sai do COMMENT ON FUNCTION da função do gatilho. Onde não houver
-- comentário, a página mostra a linha assim mesmo: é o convite para escrever o
-- comentário na próxima vez que alguém encostar naquela função.
--
-- Gatilhos internos do Postgres (as checagens de chave estrangeira) ficam de
-- fora por tgisinternal: eles são encanamento, não automação.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.automacoes_do_banco()
RETURNS TABLE (gatilho text, tabela text, funcao text, descricao text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.pode_configurar_automacoes() THEN
    RAISE EXCEPTION 'Só admin vê a lista de automações do banco'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT t.tgname::text,
         c.relname::text,
         p.proname::text,
         obj_description(p.oid, 'pg_proc')::text
  FROM pg_trigger t
  JOIN pg_class c     ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_proc p      ON p.oid = t.tgfoid
  WHERE NOT t.tgisinternal
    AND n.nspname = 'public'
  ORDER BY c.relname, t.tgname;
END; $$;

COMMENT ON FUNCTION public.automacoes_do_banco() IS
  'Lista os gatilhos do schema public com a descrição do comentário da função. Só admin executa.';

REVOKE ALL ON FUNCTION public.automacoes_do_banco() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.automacoes_do_banco() TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 12) Conferência
--
-- (a) as cinco chaves, todas ligadas
-- (b) a coluna nova em project_members
-- (c) a tabela com RLS ligado e quatro políticas
-- Tudo aparece na aba Results.
-- ═══════════════════════════════════════════════════════════════════════════
SELECT chave, ativa, config FROM public.automacoes ORDER BY chave;

SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'project_members'
  AND column_name = 'e_atendimento';

SELECT c.relname AS tabela,
       c.relrowsecurity AS rls_ligado,
       p.policyname AS politica,
       p.cmd AS comando
FROM pg_class c
LEFT JOIN pg_policies p ON p.tablename = c.relname AND p.schemaname = 'public'
WHERE c.relname = 'automacoes'
ORDER BY p.cmd;

-- (d) os gatilhos que a página vai listar, com e sem descrição
SELECT * FROM public.automacoes_do_banco();
