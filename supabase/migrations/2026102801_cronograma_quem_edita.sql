-- 2026102801_cronograma_quem_edita.sql
-- QUEM PODE EDITAR O CRONOGRAMA DA EQUIPE, ESCOLHIDO PESSOA A PESSOA
--
-- Até aqui editava quem fosse 'admin' ou 'producao'. Agora vale a permissão
-- nominal 'cronograma_editar' em app_users.custom_permissions, na mesma lógica
-- do 'fechar_agenda' (2026093335) e da função can() de src/hooks/useAuth.tsx:
--
--   · chave presente em custom_permissions vence o padrão do papel
--     (true libera, false bloqueia);
--   · sem a chave, vale o padrão: 'admin' e 'producao' editam, o resto só vê.
--
-- Ou seja: NADA muda para ninguém até o admin mexer em "Quem edita" na tela
-- do Cronograma. Leitura continua liberada para toda a equipe.
--
-- A tela (can('cronograma_editar')) e o banco (esta função) precisam decidir
-- igual; por isso a regra é a mesma nos dois lugares.
--
-- Rodar à mão no SQL Editor do Supabase. É seguro rodar mais de uma vez e não
-- mexe em tabelas nem em policies: só troca o corpo da função que elas já usam.
-- Antes deste SQL o app funciona igual ao de hoje (só admin e Gestão editam).

CREATE OR REPLACE FUNCTION public.pode_editar_cronograma()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_users u
    WHERE u.auth_user_id = auth.uid()
      AND u.status = 'ativo'
      AND CASE
            WHEN jsonb_exists(COALESCE(u.custom_permissions, '{}'::jsonb), 'cronograma_editar')
              THEN u.custom_permissions ->> 'cronograma_editar' = 'true'
            ELSE u.role IN ('admin', 'producao')
          END
  );
$$;
REVOKE ALL ON FUNCTION public.pode_editar_cronograma() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pode_editar_cronograma() TO authenticated;

-- Conferência: quem pode editar hoje (admin e Gestão de Produção, até alguém ser liberado/bloqueado).
SELECT full_name, role,
       CASE WHEN jsonb_exists(COALESCE(custom_permissions, '{}'::jsonb), 'cronograma_editar')
            THEN custom_permissions ->> 'cronograma_editar' = 'true'
            ELSE role IN ('admin', 'producao') END AS pode_editar
FROM public.app_users
WHERE status = 'ativo'
ORDER BY pode_editar DESC, full_name;
