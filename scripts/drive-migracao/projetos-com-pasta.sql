-- SÓ LEITURA: projetos ativos com pasta no Drive, para o listar-pastas-na-lixeira.mjs conferir.
SELECT id, name, code, status, drive_layout, drive_folder_id, drive_upload_folder_id, drive_pastas
FROM projects WHERE drive_folder_id IS NOT NULL ORDER BY created_at;
