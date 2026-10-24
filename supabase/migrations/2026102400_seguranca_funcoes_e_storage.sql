-- SEGURANÇA: FUNÇÕES ABERTAS A VISITANTES E ARQUIVOS DE NOTAS E REEMBOLSOS
--
-- 1) FUNÇÕES. Em produção, ~100 funções com "permissão total" (SECURITY DEFINER) podiam ser
--    executadas por QUALQUER visitante com a chave pública do app (papel anon), sem login:
--    criar notificações para qualquer pessoa (create_notification), confirmar e-mail de usuário
--    (confirm_user_email), gerar contas a pagar (gerar_payables_custos_fixos), disparar o
--    processamento de vídeo (call_transcode_worker, retry_pending_transcode), ler aniversários
--    e atividade da equipe, alterar status de tarefa (sincronizar_status_tarefa), etc.
--    Um REVOKE FROM anon sozinho não resolve no Supabase (PUBLIC e o grant direto continuam),
--    por isso aqui se fecha de PUBLIC e de anon. Ficam abertas ao anon SÓ as funções públicas
--    de propósito (portal, revisão de vídeo, aprovação de orçamento, nota fiscal, boas-vindas) e
--    pequenos ajudantes de permissão que só falam do próprio chamador. Gatilhos e cron não são
--    afetados (não checam EXECUTE ao disparar) e service_role/postgres continuam com tudo.
--    Quem está LOGADO (authenticated) mantém o acesso que já tinha.
--
-- 2) ARQUIVOS (Storage). As pastas notas-fiscais e reembolsos tinham leitura para o papel
--    "public", ou seja, qualquer visitante conseguia LISTAR e baixar todos os arquivos pela API
--    do Storage (notas fiscais de fornecedores, comprovantes de reembolso). Passa a ser só do
--    time. As URLs diretas já existentes no app continuam funcionando enquanto a pasta for
--    pública (trocar para URL assinada fica para uma próxima etapa). Escrita e exclusão em
--    avatars, equipamentos, notas-fiscais e reembolsos também passa a ser só do time (o envio
--    anônimo de nota pelo link do fornecedor, "notas insert anon", não muda).
--
-- Pressupõe a migration 2026102300_somente_equipe.sql (função is_team()). Plano de volta no fim.

DO $$
BEGIN
  IF to_regprocedure('public.is_team()') IS NULL THEN
    RAISE EXCEPTION 'Abortado: aplique antes 2026102300_somente_equipe.sql (falta is_team()).';
  END IF;
END $$;

-- 1) Funções ---------------------------------------------------------------------------
DO $$
DECLARE
  f record;
  n integer := 0;
  publicas text[] := ARRAY[
    -- portal do cliente
    'get_client_portal_v2', 'portal_agenda', 'portal_cancelar_pedido', 'portal_capas',
    'portal_pedir_diaria', 'portal_pode_entrar', 'get_boas_vindas_lumos', 'get_welcome_doc',
    'marcar_item_boas_vindas',
    -- revisão de vídeo do cliente
    'get_public_review', 'review_add_comment', 'review_decide', 'review_delete_comment',
    'review_identify', 'review_update_comment',
    -- aprovação de orçamento e nota fiscal do fornecedor
    'get_public_budget_by_token', 'insert_budget_approval', 'aprovar_orcamento',
    'get_nota_request', 'submit_nota',
    -- ajudantes de permissão (só respondem sobre o próprio chamador; usados em políticas)
    'is_team', 'get_user_role', 'current_app_user_id', 'fn_app_user_atual',
    'pode_configurar_automacoes', 'pode_editar_welcome_doc', 'pode_fechar_agenda', 'pode_ver_financeiro'
  ];
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS assinatura
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public'
      AND p.prokind = 'f'
      AND p.prosecdef
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT (p.proname = ANY (publicas))
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f.assinatura);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f.assinatura);
    -- quem está logado e o servidor continuam como estavam
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f.assinatura);
    n := n + 1;
  END LOOP;
  RAISE NOTICE '% funções fechadas para visitantes', n;
END $$;

-- 2) Storage ---------------------------------------------------------------------------
-- notas-fiscais
DROP POLICY IF EXISTS "notas read" ON storage.objects;
CREATE POLICY "notas read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'notas-fiscais' AND (SELECT public.is_team()));
DROP POLICY IF EXISTS "notas delete" ON storage.objects;
CREATE POLICY "notas delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'notas-fiscais' AND (SELECT public.is_team()));

-- reembolsos
DROP POLICY IF EXISTS "reembolsos read" ON storage.objects;
CREATE POLICY "reembolsos read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'reembolsos' AND (SELECT public.is_team()));
DROP POLICY IF EXISTS "reembolsos insert" ON storage.objects;
CREATE POLICY "reembolsos insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'reembolsos' AND (SELECT public.is_team()));
DROP POLICY IF EXISTS "reembolsos update" ON storage.objects;
CREATE POLICY "reembolsos update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'reembolsos' AND (SELECT public.is_team()));
DROP POLICY IF EXISTS "reembolsos delete" ON storage.objects;
CREATE POLICY "reembolsos delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'reembolsos' AND (SELECT public.is_team()));

-- equipamentos (a leitura pública das fotos continua)
DROP POLICY IF EXISTS "equip storage insert" ON storage.objects;
CREATE POLICY "equip storage insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'equipamentos' AND (SELECT public.is_team()));
DROP POLICY IF EXISTS "equip storage update" ON storage.objects;
CREATE POLICY "equip storage update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'equipamentos' AND (SELECT public.is_team()));
DROP POLICY IF EXISTS "equip storage delete" ON storage.objects;
CREATE POLICY "equip storage delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'equipamentos' AND (SELECT public.is_team()));

-- avatars
DROP POLICY IF EXISTS "Avatar select" ON storage.objects;
CREATE POLICY "Avatar select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'avatars' AND (SELECT public.is_team()));
DROP POLICY IF EXISTS "Avatar insert" ON storage.objects;
CREATE POLICY "Avatar insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND (SELECT public.is_team()));
DROP POLICY IF EXISTS "Avatar update" ON storage.objects;
CREATE POLICY "Avatar update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND (SELECT public.is_team()));
DROP POLICY IF EXISTS "Avatar delete" ON storage.objects;
CREATE POLICY "Avatar delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND (SELECT public.is_team()));

-- CONFERÊNCIA 1: funções com permissão total que o visitante (anon) ainda executa.
-- Deve sobrar só a lista pública acima.
SELECT p.proname
FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
WHERE ns.nspname = 'public' AND p.prosecdef AND p.prokind = 'f'
  AND has_function_privilege('anon', p.oid, 'EXECUTE')
ORDER BY 1;

-- CONFERÊNCIA 2: leitura de notas-fiscais e reembolsos agora só para o time.
SELECT policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
  AND (policyname ILIKE 'notas%' OR policyname ILIKE 'reembolsos%')
ORDER BY policyname;

-- PLANO DE VOLTA DO STORAGE (só se algo do time parar de funcionar com arquivos):
-- DROP POLICY IF EXISTS "notas read" ON storage.objects;
-- CREATE POLICY "notas read" ON storage.objects FOR SELECT TO public USING (bucket_id = 'notas-fiscais');
-- DROP POLICY IF EXISTS "reembolsos read" ON storage.objects;
-- CREATE POLICY "reembolsos read" ON storage.objects FOR SELECT TO public USING (bucket_id = 'reembolsos');
-- (e, para as de escrita, recriar com TO authenticated USING (bucket_id = '<pasta>') sem is_team)
