-- SEGURANÇA: VIEWS ABERTAS A VISITANTES E LIMITES DAS PASTAS DE ARQUIVOS
--
-- 1) VIEWS. vw_rentabilidade (valor vendido, custos e lucro por projeto), vw_resumo_mensal
--    (entradas, saídas e lucro por mês) e client_welcome_doc_progresso são "views" que rodam com
--    a permissão do dono (postgres) e, por isso, IGNORAM as regras de acesso (RLS) das tabelas.
--    Como o Supabase libera SELECT de views novas ao papel anon, qualquer visitante com a chave
--    pública do app (que vai dentro do próprio site) conseguia ler esses números, sem login,
--    enquanto as tabelas de origem respondiam vazio. O app só lê essas views logado (telas
--    internas do Financeiro); nenhuma página pública usa view. Aqui o anon perde o acesso a
--    TODAS as views do schema public; quem está logado (authenticated) e o servidor
--    (service_role) continuam exatamente como estavam, então nenhuma tela da equipe muda.
--
-- 2) LIMITES DAS PASTAS (Storage). Nenhuma pasta tinha limite de tamanho nem de tipo de arquivo.
--    A pasta notas-fiscais aceita envio de visitante (fornecedor com o link da cobrança) e o limite
--    de 15 MB e os tipos .pdf/.xml/.jpg/.png só existiam no navegador (burlável). Agora o servidor
--    também recusa. As demais pastas (só a equipe envia) ganham só um teto de tamanho, para um
--    arquivo gigante não encher a cota.
--
-- Seguro rodar mais de uma vez. Não mexe em dados. Plano de volta no fim.

-- 1) Views -----------------------------------------------------------------------------
DO $$
DECLARE
  v record;
  n integer := 0;
BEGIN
  FOR v IN
    SELECT c.oid::regclass AS rel
    FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relkind IN ('v', 'm')
  LOOP
    EXECUTE format('REVOKE ALL ON %s FROM PUBLIC', v.rel);
    EXECUTE format('REVOKE ALL ON %s FROM anon', v.rel);
    n := n + 1;
  END LOOP;
  RAISE NOTICE '% views fechadas para visitantes', n;
END $$;

-- 2) Limites das pastas ----------------------------------------------------------------
-- notas-fiscais: o fornecedor envia .pdf, .xml, .jpg ou .png. O text/plain entra como tolerância
-- para o caso de um navegador não informar o tipo de um .xml.
UPDATE storage.buckets
SET file_size_limit = 15 * 1024 * 1024,
    allowed_mime_types = ARRAY['application/pdf', 'text/xml', 'application/xml', 'text/plain', 'image/jpeg', 'image/png']
WHERE id = 'notas-fiscais';

-- Só a equipe envia: teto de 25 MB, sem restrição de tipo.
UPDATE storage.buckets SET file_size_limit = 25 * 1024 * 1024 WHERE id IN ('reembolsos', 'mural', 'equipamentos', 'avatars');

-- CONFERÊNCIA 1: nenhuma view deve ser legível pelo visitante (linhas = 0).
SELECT c.relname AS view_ainda_aberta_ao_visitante
FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
WHERE ns.nspname = 'public' AND c.relkind IN ('v', 'm') AND has_table_privilege('anon', c.oid, 'SELECT');

-- CONFERÊNCIA 2: limites das pastas.
SELECT id, public, file_size_limit, allowed_mime_types FROM storage.buckets ORDER BY id;

-- PLANO DE VOLTA (só se algo do time parar de funcionar):
--   views:   GRANT SELECT ON public.vw_rentabilidade TO anon;   (e as outras, se precisar)
--   pastas:  UPDATE storage.buckets SET allowed_mime_types = NULL, file_size_limit = NULL
--            WHERE id IN ('notas-fiscais', 'reembolsos', 'mural', 'equipamentos', 'avatars');
