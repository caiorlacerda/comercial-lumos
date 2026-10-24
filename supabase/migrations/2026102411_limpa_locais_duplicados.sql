-- LIMPEZA DOS LOCAIS DUPLICADOS (dados de produção em 24/10/2026)
--
-- A importação da 2026102410 criou um local para cada jeito de digitar o mesmo lugar
-- ("Escritorio Shopee", "Escritório da Shopee", "Escritorio da Shopee - Av. Faria Lima, 3732"...).
-- Este arquivo junta os duplicados em UM local por lugar, padroniza nome e endereço, religa as
-- diárias e apaga os sobrantes. Os ids abaixo vêm da listagem que o Caio rodou em 24/10/2026.
--
-- O QUE FAZ, NESTA ORDEM
--   0) guarda cópia do estado atual (tabelas *_backup_20261024) para desfazer se precisar;
--   1) diárias dos duplicados passam para o local que fica;
--   2) apaga os locais duplicados;
--   3) acerta nome / endereço (e o cliente, no caso do MASP, que vira local GERAL);
--   4) atualiza o texto `local` das diárias desses locais para "Nome, endereço".
--
-- NÃO MEXE: "a ver", "Shopee", "Prédio da Vitru", "R. Jaceru, 384 - Brooklin.",
-- "Escritorio da Shopee + Ibirapuera" (ficam para decisão do Caio) e os locais que já são únicos.
-- O Google Calendar não é atualizado: eventos antigos mantêm o texto até a diária ser salva de novo.

-- 0) Cópia de segurança -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.locais_backup_20261024 AS SELECT * FROM public.locais;
CREATE TABLE IF NOT EXISTS public.project_diarias_local_backup_20261024 AS
  SELECT id, local, local_id FROM public.project_diarias WHERE local IS NOT NULL OR local_id IS NOT NULL;

-- Tudo num bloco só (o editor do Supabase não mantém tabela temporária entre comandos).
DO $$
DECLARE
  -- duplicado (de) -> local que fica (para), na mesma posição das duas listas
  de_ids   uuid[] := ARRAY[
    -- Shopee: escritório (inclui "Escritório da Sho", que é o nome cortado)
    '04ca3c55-e5d2-443f-aa14-a978318c6f9d','c4fdd1d9-29f4-426b-8b24-e74456a041a7','2918f906-8e27-41d2-8418-ec5ca43798ae',
    '6e114830-f750-4af1-b7c6-ceef5511f858','9a0f1b65-4fb4-4604-ac9f-37a16685ece4',
    -- Shopee: estúdio e Greyhound
    '91d7c51f-13e0-4343-b805-7e0780dba659','552a7755-fb71-4ed7-acfa-cab022c0e26b',
    -- Vitru: escritório
    '6da45356-d5f2-4a95-a7ee-71a7548a8f1a','23d2ab47-6b13-4f34-abd3-750fabc8f24a','011fdd4a-c1c3-49b1-9a42-2bc8abf41b95',
    'd0c93dab-b996-402e-90b1-9b90757e58ab','919f79ed-076e-45d1-b7da-f0648cb3abf9',
    -- MASP da Vitru (vira o MASP geral)
    'c3f9fbcb-48fb-4c07-ac16-3a5934d594f2']::uuid[];
  para_ids uuid[] := ARRAY[
    'db7a358d-bf47-4a4e-85e8-a707c7c7f35f','db7a358d-bf47-4a4e-85e8-a707c7c7f35f','db7a358d-bf47-4a4e-85e8-a707c7c7f35f',
    'db7a358d-bf47-4a4e-85e8-a707c7c7f35f','db7a358d-bf47-4a4e-85e8-a707c7c7f35f',
    '4b14cf59-9e93-4ef7-8d46-1296d051e9fe','ed304f50-9cc2-476f-a4e3-2d40f9c330d2',
    '6744b491-9b7c-46e5-aabf-6f901efd53f6','6744b491-9b7c-46e5-aabf-6f901efd53f6','6744b491-9b7c-46e5-aabf-6f901efd53f6',
    '6744b491-9b7c-46e5-aabf-6f901efd53f6','6744b491-9b7c-46e5-aabf-6f901efd53f6',
    '296cb05e-73f9-4f2a-a8c0-bf153b064fc7']::uuid[];
  tocados  uuid[];
BEGIN
  IF array_length(de_ids, 1) <> array_length(para_ids, 1) THEN RAISE EXCEPTION 'listas de tamanhos diferentes'; END IF;

  -- 1) Diárias dos duplicados passam para o local que fica
  UPDATE public.project_diarias d SET local_id = f.para
  FROM unnest(de_ids, para_ids) AS f(de, para) WHERE d.local_id = f.de;

  -- 2) Apaga os duplicados
  DELETE FROM public.locais WHERE id = ANY(de_ids);

  -- 3) Nome, endereço (e cliente) dos que ficam
  UPDATE public.locais SET nome = 'Escritório Shopee', endereco = 'Avenida Brigadeiro Faria Lima, 3732', updated_at = now()
    WHERE id = 'db7a358d-bf47-4a4e-85e8-a707c7c7f35f';
  UPDATE public.locais SET nome = 'Escritório Vitru', endereco = 'Rua Tenente Negrão, 100 (JK Square Corporate), 13º andar – Itaim Bibi, São Paulo - SP', updated_at = now()
    WHERE id = '6744b491-9b7c-46e5-aabf-6f901efd53f6';
  UPDATE public.locais SET nome = 'Auditório Oscar Niemeyer (Ibirapuera)', updated_at = now()
    WHERE id = '4e8cc714-864b-40b5-88bd-3e919c482b9d';
  UPDATE public.locais SET nome = 'Expo Barra Funda', endereco = 'Rua Tagipuru, 1001 – Barra Funda, São Paulo - SP, CEP 05001-000', updated_at = now()
    WHERE id = 'c7ffeb96-00f9-4ea4-9f4c-65ed2ef2bc22';
  UPDATE public.locais SET nome = 'SEST SENAT - Vila Jaguara', endereco = 'Av. Cândido Portinari, 1100 - Vila Jaguara, São Paulo', updated_at = now()
    WHERE id = '05879e67-b36a-4d95-b10b-9493b8dd78d2';
  UPDATE public.locais SET nome = 'Vila dos Ipês', endereco = 'Av. Mofarrej, 1505 - Vila Leopoldina, São Paulo (SP)', updated_at = now()
    WHERE id = '322af96f-0752-421a-b954-bec1a2d57e14';
  UPDATE public.locais SET nome = 'MASP - Museu de Arte de São Paulo', endereco = 'Avenida Paulista, 1578, São Paulo', client_id = NULL, updated_at = now()
    WHERE id = '296cb05e-73f9-4f2a-a8c0-bf153b064fc7';

  -- 4) Texto da diária = "Nome, endereço" (ou só o nome, sem endereço), nos locais que ficam ou foram renomeados
  tocados := para_ids || ARRAY[
    '4e8cc714-864b-40b5-88bd-3e919c482b9d','c7ffeb96-00f9-4ea4-9f4c-65ed2ef2bc22',
    '05879e67-b36a-4d95-b10b-9493b8dd78d2','322af96f-0752-421a-b954-bec1a2d57e14']::uuid[];
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

-- DESFAZER (só se algo saiu errado; nesta ordem: devolve nome/endereço aos que ficaram, recria os apagados, religa as diárias):
--   UPDATE public.locais l SET nome=b.nome, endereco=b.endereco, client_id=b.client_id FROM public.locais_backup_20261024 b WHERE b.id=l.id;
--   INSERT INTO public.locais SELECT * FROM public.locais_backup_20261024 b WHERE NOT EXISTS (SELECT 1 FROM public.locais l WHERE l.id = b.id);
--   UPDATE public.project_diarias d SET local = b.local, local_id = b.local_id FROM public.project_diarias_local_backup_20261024 b WHERE b.id = d.id;
-- Depois de uns dias, quando estiver tudo certo:  DROP TABLE public.locais_backup_20261024, public.project_diarias_local_backup_20261024;
