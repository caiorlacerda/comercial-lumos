-- NOTA FISCAL: O FORNECEDOR VOLTA A CONSEGUIR ENVIAR O ARQUIVO PELO LINK /nota/:token
--
-- SINTOMA: "Não conseguimos receber o arquivo: new row violates row-level security policy",
-- com PDF, foto ou XML.
--
-- CAUSA: a página pública sobe o arquivo direto no bucket notas-fiscais como visitante (anon).
-- A política "notas insert anon" (2026093300) confere se existe uma cobrança aberta com aquele
-- token consultando public.nota_requests. Só que o RLS de nota_requests ("nota_requests all")
-- libera apenas o papel authenticated; para o visitante a consulta sempre devolve 0 linhas e a
-- conferência dá falso.
--
-- CORREÇÃO: uma função de consulta mínima (SECURITY DEFINER, devolve só verdadeiro/falso) que a
-- política chama no lugar da consulta direta. A tabela nota_requests NÃO é aberta ao visitante.
-- A regra de negócio é a mesma de antes: só entra arquivo na pasta do próprio token, e só enquanto
-- a cobrança está agendada, com e-mail enviado ou com nota recebida (reenvio).
--
-- Também acrescenta image/heic, image/heif e image/webp aos tipos aceitos pela pasta (foto de
-- iPhone e WEBP), sem tirar nenhum dos que já existem.
--
-- Seguro rodar mais de uma vez. Não mexe em dados de cobrança nem em arquivos. Plano de volta no fim.
-- Não precisa de nenhuma outra migration antes (is_team() não é usado aqui).
--
-- ═══ ANTES DE RODAR (opcional, só leitura): como está em produção ═══════════════════════════
-- Cole e rode um bloco por vez no SQL Editor. Nada abaixo altera dados.
--
-- A) Todas as políticas de storage.objects (procure qualquer uma com permissive = RESTRICTIVE,
--    ou qualquer outra política de INSERT/UPDATE/SELECT que cite notas-fiscais):
--      SELECT policyname, permissive, cmd, roles, qual, with_check
--      FROM pg_policies
--      WHERE schemaname = 'storage' AND tablename = 'objects'
--      ORDER BY permissive DESC, cmd, policyname;
--
-- B) Política e dono de nota_requests (esperado: uma política só, TO authenticated;
--    relforcerowsecurity = false; dono = postgres):
--      SELECT policyname, cmd, roles, qual FROM pg_policies
--      WHERE schemaname = 'public' AND tablename = 'nota_requests';
--      SELECT c.relrowsecurity, c.relforcerowsecurity, r.rolname AS dono, r.rolbypassrls
--      FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
--      WHERE c.oid = 'public.nota_requests'::regclass;
--
-- C) Limites atuais da pasta (se allowed_mime_types vier NULL, a pasta já aceita qualquer tipo
--    e esta migration não mexe nela):
--      SELECT id, public, file_size_limit, allowed_mime_types FROM storage.buckets
--      WHERE id = 'notas-fiscais';
--
-- D) As funções públicas atuais da nota (esperado: prosecdef = true, mesmo dono da tabela):
--      SELECT proname, prosecdef, proowner::regrole AS dono, proconfig
--      FROM pg_proc WHERE pronamespace = 'public'::regnamespace
--        AND proname IN ('get_nota_request', 'submit_nota', 'nota_token_aberto');
-- ═══════════════════════════════════════════════════════════════════════════════════════════

-- 1) Função de conferência do token ------------------------------------------------------------
-- Devolve só se existe cobrança aberta com esse token. Roda com a permissão do dono (por isso
-- enxerga nota_requests mesmo para o visitante) e não devolve nenhum dado da cobrança.
-- Token nulo (arquivo na raiz do bucket, sem pasta) cai em falso.
CREATE OR REPLACE FUNCTION public.nota_token_aberto(p_token text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.nota_requests
    WHERE token = p_token
      AND status IN ('agendada', 'email_enviado', 'nota_recebida')
  );
$$;

REVOKE ALL ON FUNCTION public.nota_token_aberto(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nota_token_aberto(text) TO anon, authenticated;

-- 2) Política de envio ---------------------------------------------------------------------------
-- Só INSERT: a página envia com upsert:false, então não precisa de política de SELECT nem de UPDATE
-- para o visitante (a leitura da pasta continua só do time, "notas read").
DROP POLICY IF EXISTS "notas insert anon" ON storage.objects;
CREATE POLICY "notas insert anon" ON storage.objects FOR INSERT TO anon, authenticated
  WITH CHECK (
    bucket_id = 'notas-fiscais'
    AND public.nota_token_aberto((storage.foldername(name))[1])
  );

-- 3) Tipos aceitos pela pasta --------------------------------------------------------------------
-- Soma os três tipos novos à lista que existe HOJE no banco (não uma lista fixa), então nada que
-- já era aceito deixa de ser. Se a pasta está sem restrição (NULL), não mexe: acrescentar tipos a
-- uma lista vazia passaria a BLOQUEAR PDF e XML.
UPDATE storage.buckets
SET allowed_mime_types = ARRAY(
  SELECT DISTINCT t
  FROM unnest(allowed_mime_types || ARRAY['image/heic', 'image/heif', 'image/webp']) AS t
  ORDER BY t
)
WHERE id = 'notas-fiscais'
  AND allowed_mime_types IS NOT NULL;

-- CONFERÊNCIA (mostra tudo em uma tabela só):
--   politica: "notas insert anon" = INSERT para {anon,authenticated}
--   funcao:   anon e authenticated executam; PUBLIC não; dono igual ao da tabela
--   bucket:   lista de tipos com os 3 novos e os antigos
SELECT 'politica' AS item, p.policyname::text AS nome,
       p.cmd || ' / ' || p.roles::text || ' / ' || p.permissive AS detalhe
FROM pg_policies p
WHERE p.schemaname = 'storage' AND p.tablename = 'objects' AND p.policyname ILIKE 'notas%'
UNION ALL
SELECT 'funcao', 'nota_token_aberto',
       'anon=' || has_function_privilege('anon', 'public.nota_token_aberto(text)', 'EXECUTE')
       || ' authenticated=' || has_function_privilege('authenticated', 'public.nota_token_aberto(text)', 'EXECUTE')
       || ' secdef=' || (SELECT prosecdef FROM pg_proc WHERE oid = 'public.nota_token_aberto(text)'::regprocedure)
       || ' dono_funcao=' || (SELECT proowner::regrole FROM pg_proc WHERE oid = 'public.nota_token_aberto(text)'::regprocedure)
       || ' dono_tabela=' || (SELECT relowner::regrole FROM pg_class WHERE oid = 'public.nota_requests'::regclass)
UNION ALL
SELECT 'bucket', b.id,
       COALESCE(array_to_string(b.allowed_mime_types, ', '), '(sem restrição de tipo)')
       || ' | limite=' || COALESCE(b.file_size_limit::text, 'sem')
FROM storage.buckets b
WHERE b.id = 'notas-fiscais'
ORDER BY 1, 2;

-- PLANO DE VOLTA (só se algo parar de funcionar). Atenção: voltar a política antiga RESTAURA o
-- erro do fornecedor (a consulta direta a nota_requests não funciona para o visitante).
--   DROP POLICY IF EXISTS "notas insert anon" ON storage.objects;
--   CREATE POLICY "notas insert anon" ON storage.objects FOR INSERT TO anon, authenticated
--     WITH CHECK (bucket_id = 'notas-fiscais' AND EXISTS (
--       SELECT 1 FROM public.nota_requests
--       WHERE token = (storage.foldername(name))[1]
--         AND status IN ('agendada', 'email_enviado', 'nota_recebida')));
--   DROP FUNCTION IF EXISTS public.nota_token_aberto(text);
--   -- tipos: tirar só os três novos
--   UPDATE storage.buckets
--   SET allowed_mime_types = array_remove(array_remove(array_remove(allowed_mime_types, 'image/heic'), 'image/heif'), 'image/webp')
--   WHERE id = 'notas-fiscais' AND allowed_mime_types IS NOT NULL;
