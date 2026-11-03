-- CONSULTAS DE APOIO À MIGRAÇÃO DO DRIVE (só leitura; não alteram nada).
-- Funcionam antes e depois da migration 2026110300 (colunas novas são lidas com to_jsonb).

-- ─────────────────────────────────────────────────────────────────────────────
-- A) ESCOLHER O CLIENTE PILOTO
-- Clientes com poucos projetos (1 a 6), ao menos um com pasta de revisão e ao menos um vídeo aprovado.
-- "lives" ficam de fora da migração (seguem em v1); "com_pasta_de_revisao" são os projetos que
-- dependem de 06_ENTREGA/01_REVISAO e mais ganham com o teste.
-- ─────────────────────────────────────────────────────────────────────────────
select
  c.name                                                                              as cliente,
  count(distinct p.id)                                                                as projetos,
  count(distinct p.id) filter (where p.status = 'ativo')                              as ativos,
  count(distinct p.id) filter (where coalesce(to_jsonb(p)->>'category', b.category::text) = 'live') as lives,
  count(distinct p.id) filter (where p.drive_folder_id is not null)                   as com_pasta,
  count(distinct p.id) filter (where p.drive_upload_folder_id is not null)            as com_pasta_de_revisao,
  count(v.id) filter (where v.approved_file_id is not null)                           as videos_aprovados,
  pg_size_pretty(coalesce(sum(v.size_bytes) filter (where v.approved_file_id is not null), 0)::bigint) as espaco_das_copias,
  coalesce(jsonb_array_length(to_jsonb(c)->'marcas'), 0)                              as marcas_do_cliente
from public.clients c
join public.projects p            on p.client_id = c.id
left join public.budgets b        on b.id = p.budget_id
left join public.video_versions v on v.project_id = p.id
group by c.id, c.name
having count(distinct p.id) between 1 and 6
   and count(distinct p.id) filter (where p.drive_upload_folder_id is not null) >= 1
   and count(v.id) filter (where v.approved_file_id is not null) >= 1
order by projetos, videos_aprovados desc;

-- ─────────────────────────────────────────────────────────────────────────────
-- B) EXPORTAR OS PROJETOS DE UM CLIENTE (qualquer cliente)
-- 1. Troque 'NOME DO CLIENTE' pelo nome EXATO, como aparece no app.
-- 2. Rode. O resultado é UMA célula com o JSON.
-- 3. Copie o conteúdo da célula e salve num arquivo (ex.: projetos.json) para o script.
-- ─────────────────────────────────────────────────────────────────────────────
select coalesce(jsonb_pretty(jsonb_agg(jsonb_build_object(
  'id',                     p.id,
  'code',                   p.code,
  'name',                   p.name,
  'status',                 p.status,
  'category',               coalesce(to_jsonb(p)->>'category', b.category::text),
  'layout',                 coalesce(to_jsonb(p)->>'drive_layout', 'v1'),
  'marca',                  to_jsonb(p)->>'marca',
  'data_inicio',            p.data_inicio,
  'created_at',             p.created_at,
  'drive_folder_id',        p.drive_folder_id,
  'drive_upload_folder_id', p.drive_upload_folder_id,
  'client_id',              c.id,
  'client_name',            c.name,
  'client_drive_folder_id', c.drive_folder_id,
  'client_marcas',          coalesce(to_jsonb(c)->'marcas', '[]'::jsonb)
) order by p.code)), '[]') as projetos_json
from public.clients c
join public.projects p     on p.client_id = c.id
left join public.budgets b on b.id = p.budget_id
where c.name = 'NOME DO CLIENTE';
