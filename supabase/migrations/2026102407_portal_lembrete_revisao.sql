-- PORTAL DO CLIENTE (Pacote B): lembrete interno quando um vídeo fica parado com o cliente além do prazo de revisão.
--   1) Tabela portal_lembretes_revisao: um registro por vídeo (group_id) com a data do último lembrete e quantas vezes avisou.
--   2) Função portal_lembrar_revisoes(): cria 1 notificação por destinatário para cada vídeo vencido e devolve quantos
--      vídeos receberam lembrete. A rotina diária que a chama é um arquivo à parte (2026102408_portal_lembrete_cron.sql).
--
-- Quem recebe: usuários ATIVOS e NÃO ocultos que sejam admin ou atendimento, mais os contatos do portal do cliente.
-- Quando avisa: a versão MAIS NOVA do vídeo está em EM_REVISAO_CLIENTE, o link de revisão está ativo, o projeto está
-- visível no portal e NÃO está concluído/cancelado/arquivado, o portal do cliente está ativo e tem prazo configurado,
-- e o prazo (dias úteis a partir da entrega, fuso America/Sao_Paulo) já passou. Se a versão mais nova for interna, o
-- link do cliente está bloqueado e NÃO se avisa.
-- Repete a cada 3 dias de São Paulo enquanto o vídeo continuar parado. Com a automação "portal_revisao_lembra"
-- desligada a função não avisa nem anota nada (ao religar, sai o que ainda estiver vencido).
-- TETO: no máximo 10 vídeos por rodada (nunca lembrados primeiro, depois os há mais tempo sem lembrete), então um
-- acúmulo antigo escoa em vários dias em vez de uma rajada de notificações e pushes.
--
-- Datas: um vídeo devolvido internamente e reenviado mantém o entregue_em ORIGINAL (só é gravado na primeira vez que
-- vai ao cliente); o prazo dele pode já estar vencido e o N do título ("está há N dias") fica inflado. O prazo conta
-- dias ÚTEIS (sem feriados), mas o N do título conta dias CORRIDOS desde a entrega.
-- Só o servidor executa a função (cron e service_role); a equipe logada não a chama pelo app.
--
-- ATENÇÃO — ao agendar a rotina (arquivo 408), os vídeos que já esperam o cliente além do prazo entram na fila: no máximo
-- 10 por rodada (os de prazo mais antigo primeiro); o acúmulo escoa em vários dias. A trava acompanha cerca de 30 vídeos
-- vencidos ao mesmo tempo (10 por dia x o ciclo de 3 dias); acima disso, as repetições se espaçam. Para ver quantos há,
-- rode antes a consulta de ensaio (só lê) que está no cabeçalho do 408.
--
-- Pré-requisitos: 2026102406_portal_prazo_revisao.sql (coluna prazo_revisao_dias e portal_somar_dias_uteis) e a função
-- automacao_ativa(). Idempotente (pode rodar de novo).
DO $$
BEGIN
  IF to_regprocedure('public.is_team()') IS NULL THEN
    RAISE EXCEPTION 'Abortado: falta is_team() (2026102300_somente_equipe.sql).';
  END IF;
  IF to_regprocedure('public.portal_somar_dias_uteis(date,integer)') IS NULL THEN
    RAISE EXCEPTION 'Abortado: aplique antes 2026102406_portal_prazo_revisao.sql.';
  END IF;
  IF to_regprocedure('public.automacao_ativa(text)') IS NULL THEN
    RAISE EXCEPTION 'Abortado: falta automacao_ativa().';
  END IF;
END $$;

SET lock_timeout = '15s';

CREATE TABLE IF NOT EXISTS public.portal_lembretes_revisao (
  group_id  uuid PRIMARY KEY,
  ultimo_em timestamptz NOT NULL DEFAULT now(),
  vezes     integer NOT NULL DEFAULT 1
);
ALTER TABLE public.portal_lembretes_revisao ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.portal_lembretes_revisao FROM anon, authenticated;
GRANT ALL ON public.portal_lembretes_revisao TO service_role;

CREATE OR REPLACE FUNCTION public.portal_lembrar_revisoes()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c_teto   constant integer := 10;  -- no máximo 10 vídeos por rodada: um acúmulo antigo escoa em vários dias, sem rajada de pushes
  v_hoje   date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_avisar boolean;
  v_total  integer := 0;
  r        RECORD;
  u        RECORD;
  v_nome   text;
BEGIN
  -- O agendador roda sem usuário; quem estiver logado precisa ser da equipe.
  IF auth.uid() IS NOT NULL AND NOT public.is_team() THEN RAISE EXCEPTION 'sem_acesso'; END IF;
  v_avisar := public.automacao_ativa('portal_revisao_lembra');
  IF NOT v_avisar THEN RETURN 0; END IF;
  -- Uma chamada manual não pode se sobrepor à do cron (a segunda espera a primeira terminar e já enxerga as linhas dela).
  PERFORM pg_advisory_xact_lock(hashtext('portal_lembrar_revisoes'));

  FOR r IN
    SELECT COALESCE(e.group_id, e.id) AS grupo, e.versao, e.file_name,
           p.id AS project_id, p.client_id, c.name AS cliente,
           (COALESCE(e.entregue_em, e.uploaded_at, e.created_at) AT TIME ZONE 'America/Sao_Paulo')::date AS entregue,
           cp.contact_user_ids,
           public.portal_somar_dias_uteis(
             (COALESCE(e.entregue_em, e.uploaded_at, e.created_at) AT TIME ZONE 'America/Sao_Paulo')::date,
             cp.prazo_revisao_dias) AS prazo
    FROM (
      -- Versão mais nova de cada vídeo, SEM filtrar por status antes: se a mais nova é interna, o link do cliente está bloqueado.
      SELECT DISTINCT ON (COALESCE(vv.group_id, vv.id)) vv.*
      FROM video_versions vv
      ORDER BY COALESCE(vv.group_id, vv.id), vv.versao DESC
    ) e
    JOIN projects p ON p.id = e.project_id AND p.portal_visivel AND p.status NOT IN ('concluido', 'cancelado', 'arquivado')
    JOIN clients c ON c.id = p.client_id
    JOIN client_portals cp ON cp.client_id = p.client_id AND cp.active AND cp.prazo_revisao_dias IS NOT NULL
    LEFT JOIN portal_lembretes_revisao l ON l.group_id = COALESCE(e.group_id, e.id)
    WHERE e.status = 'EM_REVISAO_CLIENTE'
      AND EXISTS (SELECT 1 FROM review_links rl WHERE rl.group_id = e.group_id AND rl.active)
      AND public.portal_somar_dias_uteis(
            (COALESCE(e.entregue_em, e.uploaded_at, e.created_at) AT TIME ZONE 'America/Sao_Paulo')::date,
            cp.prazo_revisao_dias) < v_hoje
      -- Repetição por DIA de São Paulo (não por carimbo de hora): o cron roda sempre no mesmo horário e um
      -- carimbo com milissegundos de diferença empurraria o lembrete para o quarto dia.
      AND (l.group_id IS NULL OR (l.ultimo_em AT TIME ZONE 'America/Sao_Paulo')::date <= v_hoje - 3)
    -- Quem nunca foi lembrado vem primeiro; depois quem está há mais tempo sem lembrete; depois o prazo mais antigo.
    ORDER BY l.ultimo_em NULLS FIRST, prazo, COALESCE(e.group_id, e.id)
    LIMIT c_teto
  LOOP
    v_nome := regexp_replace(r.file_name, '\.[^.]+$', '');
    FOR u IN
      SELECT DISTINCT a.id FROM app_users a
      WHERE a.status = 'ativo' AND NOT a.hidden
        AND (a.role IN ('admin', 'atendimento') OR a.id = ANY (COALESCE(r.contact_user_ids, ARRAY[]::uuid[])))
    LOOP
      INSERT INTO notifications (user_id, event_type, category, priority, title, body, link, data)
      VALUES (
        u.id, 'cliente_atrasado_revisao', 'producao', 'normal',
        r.cliente || ' está há ' || (v_hoje - r.entregue) || ' dias sem responder: ' || v_nome || ' v' || lpad(r.versao::text, 2, '0'),
        'O prazo de revisão (' || to_char(r.prazo, 'DD/MM') || ') passou. Vale cobrar o retorno do cliente.',
        '/producao/projetos?projectId=' || r.project_id::text || '&tab=entregas',
        jsonb_build_object('project_id', r.project_id, 'group_id', r.grupo)
      );
    END LOOP;
    INSERT INTO portal_lembretes_revisao (group_id, ultimo_em, vezes) VALUES (r.grupo, now(), 1)
    ON CONFLICT (group_id) DO UPDATE SET ultimo_em = now(), vezes = portal_lembretes_revisao.vezes + 1;
    v_total := v_total + 1;
  END LOOP;
  RETURN v_total;
END; $$;

-- Só o servidor executa (cron roda como dono do banco; service_role para chamadas administrativas). A trava de equipe
-- dentro do corpo fica como segunda camada, sem efeito prático para quem não tem EXECUTE.
REVOKE ALL ON FUNCTION public.portal_lembrar_revisoes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_lembrar_revisoes() TO service_role;

-- ROLLBACK (comentado): apague antes o job do arquivo 2026102408 (cron.unschedule), depois:
-- DROP FUNCTION IF EXISTS public.portal_lembrar_revisoes();
-- DROP TABLE IF EXISTS public.portal_lembretes_revisao;

-- CONFERÊNCIA (último comando; esperado: anon_executa = false, authenticated_executa = false (função só do servidor),
-- anon_le_tabela = false, authenticated_le_tabela = false, lembretes_registrados = 0 antes da primeira rodada).
SELECT has_function_privilege('anon', 'public.portal_lembrar_revisoes()', 'EXECUTE')          AS anon_executa,
       has_function_privilege('authenticated', 'public.portal_lembrar_revisoes()', 'EXECUTE') AS authenticated_executa,
       has_table_privilege('anon', 'public.portal_lembretes_revisao', 'SELECT')               AS anon_le_tabela,
       has_table_privilege('authenticated', 'public.portal_lembretes_revisao', 'SELECT')      AS authenticated_le_tabela,
       (SELECT count(*) FROM public.portal_lembretes_revisao)                                 AS lembretes_registrados;
