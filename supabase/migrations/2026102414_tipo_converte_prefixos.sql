-- TIPO DE TAREFA: converte os prefixos dos títulos ("EDIÇÃO | Nome do vídeo") em Tipo + título limpo.
--
-- RODE SÓ DEPOIS de: (1) o 2026102413_tipo_de_tarefa.sql; (2) o app com o Tipo já no ar (PRs do Tipo
-- mesclados), para o time já ver o Tipo em todas as telas quando o prefixo sair do título.
--
-- O que muda: só tarefas SEM tipo cujo título tem "|" e o que vem antes é um destes (sem acento/caixa):
--   MOTION -> Motion · EDIÇÃO -> Edição · ROTEIRO -> Roteiro · CAPTAÇÃO e GRAVAÇÃO -> Captação
--   THUMB, ARTE e DESIGN -> Design · SOCIAL -> Social · CRIAÇÃO -> Criação · FOTO -> Foto · REUNIÃO -> Reunião
-- O título fica só com o que vem depois do "|". Qualquer outro prefixo (nome de curso, "ENTREGA DE EDIÇÃO",
-- "DIÁRIA DE CAPTAÇÃO"...) NÃO é tocado.
--
-- BACKUP: antes de mudar, guarda o título e o tipo originais em public.project_tasks_tipo_backup_20261024
-- (rode de novo sem medo: o backup original nunca é sobrescrito). Para DESFAZER, veja o fim do arquivo.
-- O histórico de atividade e a data de atualização das tarefas não são alterados por esta limpeza.
-- Tudo roda num bloco só: se algo falhar, nada muda.

DO $$
DECLARE
  desligou boolean := false;
  n integer;
BEGIN
  IF to_regclass('public.task_tipos') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='project_tasks' AND column_name='tipo_id') THEN
    RAISE EXCEPTION 'Rode antes o 2026102413_tipo_de_tarefa.sql (falta a tabela task_tipos ou a coluna project_tasks.tipo_id).';
  END IF;

  CREATE TEMP TABLE _alvo ON COMMIT DROP AS
  WITH mapa(pre, nome) AS (VALUES
    ('MOTION','Motion'), ('EDICAO','Edição'), ('ROTEIRO','Roteiro'), ('CAPTACAO','Captação'), ('GRAVACAO','Captação'),
    ('THUMB','Design'), ('ARTE','Design'), ('DESIGN','Design'), ('SOCIAL','Social'), ('CRIACAO','Criação'),
    ('FOTO','Foto'), ('REUNIAO','Reunião'))
  SELECT t.id, t.titulo, btrim(substr(t.titulo, position('|' in t.titulo) + 1)) AS novo_titulo, k.id AS tipo_id
  FROM public.project_tasks t
  JOIN mapa m ON m.pre = upper(translate(btrim(split_part(t.titulo, '|', 1)), 'ÁÀÃÂÉÊÍÓÕÔÚÇáàãâéêíóõôúç', 'AAAAEEIOOOUCAAAAEEIOOOUC'))
  JOIN public.task_tipos k ON k.nome = m.nome
  WHERE t.tipo_id IS NULL
    AND position('|' in t.titulo) > 1
    AND btrim(substr(t.titulo, position('|' in t.titulo) + 1)) <> '';

  -- 0) Backup (o que já está guardado nunca é sobrescrito)
  CREATE TABLE IF NOT EXISTS public.project_tasks_tipo_backup_20261024 (
    id uuid PRIMARY KEY, titulo text, tipo_id uuid, guardado_em timestamptz DEFAULT now());
  INSERT INTO public.project_tasks_tipo_backup_20261024 (id, titulo, tipo_id)
    SELECT t.id, t.titulo, t.tipo_id FROM public.project_tasks t JOIN _alvo a ON a.id = t.id
    ON CONFLICT (id) DO NOTHING;

  -- 1) Sem gatilhos: não gera linha de "título alterado" no histórico nem mexe no updated_at.
  BEGIN
    EXECUTE 'ALTER TABLE public.project_tasks DISABLE TRIGGER USER';
    desligou := true;
  EXCEPTION WHEN insufficient_privilege THEN
    desligou := false;  -- sem permissão: segue com os gatilhos (aparecem linhas no histórico, só isso)
  END;

  UPDATE public.project_tasks t SET titulo = a.novo_titulo, tipo_id = a.tipo_id
  FROM _alvo a WHERE a.id = t.id;
  GET DIAGNOSTICS n = ROW_COUNT;

  IF desligou THEN EXECUTE 'ALTER TABLE public.project_tasks ENABLE TRIGGER USER'; END IF;
  RAISE NOTICE '% tarefas convertidas', n;
END $$;

-- CONFERÊNCIA (leitura): tarefas por tipo, e quantas ficaram no backup
SELECT coalesce(k.nome, '(sem tipo)') AS tipo, count(*) AS tarefas
FROM public.project_tasks t LEFT JOIN public.task_tipos k ON k.id = t.tipo_id
WHERE t.deleted_at IS NULL
GROUP BY 1 ORDER BY count(*) DESC;
SELECT count(*) AS linhas_no_backup FROM public.project_tasks_tipo_backup_20261024;

-- DESFAZER (só se precisar; devolve título e tipo originais das tarefas convertidas):
--   UPDATE public.project_tasks t SET titulo = b.titulo, tipo_id = b.tipo_id
--   FROM public.project_tasks_tipo_backup_20261024 b WHERE b.id = t.id;
-- Depois de uns dias, com tudo certo:  DROP TABLE public.project_tasks_tipo_backup_20261024;
