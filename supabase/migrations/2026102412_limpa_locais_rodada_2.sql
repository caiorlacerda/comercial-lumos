-- LIMPEZA DOS LOCAIS, RODADA 2 (decisões do Caio em 24/10/2026)
--   - "Shopee" (5 diárias)        -> junta ao "Escritório Shopee"
--   - "Prédio da Vitru" (1)       -> junta ao "Escritório Vitru"
--   - "R. Jaceru, 384 - Brooklin." -> vira o local GERAL "Estúdio Lumos" (endereço da Lumos)
--   - "a ver" (Alice Saúde)       -> apagado; a diária fica sem local (a diária continua)
-- Fica como está: "Escritorio da Shopee + Ibirapuera" e os locais que já são únicos.
-- Os ids vêm da listagem de produção. Roda num bloco só (o editor do Supabase não guarda tabela temporária).
-- Desfazer: use as cópias *_backup_20261024 (ver o fim do 2026102411_limpa_locais_duplicados.sql).

DO $$
DECLARE
  de_ids   uuid[] := ARRAY[
    'e69c2a4e-9ed9-4b1f-91b5-f1780103243c',   -- Shopee
    'bd664bc6-ba0d-40b6-9288-503ad2003baa']::uuid[]; -- Prédio da Vitru
  para_ids uuid[] := ARRAY[
    'db7a358d-bf47-4a4e-85e8-a707c7c7f35f',   -- Escritório Shopee
    '6744b491-9b7c-46e5-aabf-6f901efd53f6']::uuid[]; -- Escritório Vitru
  tocados  uuid[];
BEGIN
  -- 1) Diárias dos duplicados passam para o local que fica; apaga os duplicados
  UPDATE public.project_diarias d SET local_id = f.para
  FROM unnest(de_ids, para_ids) AS f(de, para) WHERE d.local_id = f.de;
  DELETE FROM public.locais WHERE id = ANY(de_ids);

  -- 2) "a ver": solta as diárias do local (ficam sem local) e apaga o local
  UPDATE public.project_diarias SET local = NULL, local_id = NULL WHERE local_id = 'ec9da06a-1842-457e-8481-01c82e4dfac8';
  DELETE FROM public.locais WHERE id = 'ec9da06a-1842-457e-8481-01c82e4dfac8';

  -- 3) Endereço da Lumos vira o Estúdio Lumos, local geral
  UPDATE public.locais
  SET nome = 'Estúdio Lumos', endereco = 'R. Jaceru, 384 - Brooklin, São Paulo', client_id = NULL, updated_at = now()
  WHERE id = 'a4d60ccb-80db-4f8c-909c-2d744cde9f20';

  -- 4) Texto da diária = "Nome, endereço" nos locais que ficam ou foram renomeados
  tocados := para_ids || ARRAY['a4d60ccb-80db-4f8c-909c-2d744cde9f20']::uuid[];
  UPDATE public.project_diarias d
  SET local = CASE WHEN nullif(btrim(l.endereco), '') IS NOT NULL THEN btrim(l.nome) || ', ' || btrim(l.endereco) ELSE btrim(l.nome) END
  FROM public.locais l
  WHERE d.local_id = l.id AND l.id = ANY(tocados);
END $$;

-- CONFERÊNCIA (leitura): como ficou
SELECT coalesce(c.name, '(geral)') AS cliente, l.nome, coalesce(l.endereco, '') AS endereco,
       (SELECT count(*) FROM public.project_diarias d WHERE d.local_id = l.id) AS diarias
FROM public.locais l LEFT JOIN public.clients c ON c.id = l.client_id
ORDER BY c.name NULLS FIRST, lower(l.nome);
