-- AS CAPAS DO PORTAL, SOB DEMANDA
--
-- A capa é uma imagem inteira guardada dentro da linha do vídeo. Mandar todas
-- junto com o portal seriam 3,3 MB antes de a tela aparecer — o mesmo erro que
-- fazia a lista de entregas levar quatro segundos.
--
-- Então o portal pede as capas DEPOIS, e só as dos quadros que estão na tela.
-- A função recebe os códigos de revisão daqueles quadros e devolve a imagem de
-- cada um, checando antes que o portal é válido e que aquele vídeo é mesmo
-- deste cliente e está liberado pra ele.

CREATE OR REPLACE FUNCTION public.portal_capas(p_token text, p_review_tokens text[])
RETURNS TABLE (review_token text, capa text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_client uuid;
BEGIN
  SELECT cp.client_id INTO v_client
  FROM client_portals cp WHERE cp.token = p_token AND cp.active;

  -- Link antigo, de projeto: vale igual, e o cliente é o dono do projeto.
  IF v_client IS NULL THEN
    SELECT pr.client_id INTO v_client
    FROM project_portals pp JOIN projects pr ON pr.id = pp.project_id
    WHERE pp.token = p_token AND pp.active;
  END IF;

  IF v_client IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT rl.token, v.thumb_url
  FROM review_links rl
  JOIN LATERAL (
    SELECT vv.* FROM video_versions vv
    WHERE COALESCE(vv.group_id, vv.id) = COALESCE(rl.group_id, rl.video_version_id)
    ORDER BY vv.versao DESC LIMIT 1
  ) v ON true
  JOIN projects p ON p.id = v.project_id
  WHERE rl.active
    AND rl.token = ANY(p_review_tokens)
    AND p.client_id = v_client
    AND p.portal_visivel
    AND v.status IN ('EM_REVISAO_CLIENTE', 'ALTERACOES_CLIENTE', 'APROVADO')
    AND v.thumb_url IS NOT NULL;
END; $$;

GRANT EXECUTE ON FUNCTION public.portal_capas(text, text[]) TO anon, authenticated;

-- Conferência: quantos vídeos visíveis ao cliente ainda estão sem capa.
SELECT count(*) AS visiveis_sem_capa FROM (
  SELECT DISTINCT ON (COALESCE(group_id, id)) status, thumb_url
  FROM video_versions ORDER BY COALESCE(group_id, id), versao DESC
) x
WHERE x.status IN ('EM_REVISAO_CLIENTE', 'ALTERACOES_CLIENTE', 'APROVADO') AND x.thumb_url IS NULL;
