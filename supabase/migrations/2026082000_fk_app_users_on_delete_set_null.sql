-- Fix definitivo da exclusão de usuários: toda FK que aponta para app_users por
-- uma coluna ANULÁVEL (created_by, invited_by, paid_by, actor_id, edited_by…) e
-- que hoje trava o delete (NO ACTION/RESTRICT/SET DEFAULT) passa a ON DELETE SET
-- NULL. Assim, apagar um usuário não é mais bloqueado — a autoria vira nula e o
-- registro (custo de projeto, etc.) permanece.
--
-- Colunas NOT NULL que referenciam app_users (ex.: comentários, reembolsos) já
-- são ON DELETE CASCADE ou são limpas pela função delete-user — não entram aqui.

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT con.conname AS name,
           con.conrelid::regclass AS tbl,
           att.attname AS col
    FROM pg_constraint con
    JOIN pg_attribute att
      ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
    WHERE con.contype = 'f'
      AND con.confrelid = 'public.app_users'::regclass
      AND con.confdeltype NOT IN ('c', 'n')   -- ainda não é cascade nem set null
      AND array_length(con.conkey, 1) = 1      -- FK de coluna única
      AND NOT att.attnotnull                    -- coluna aceita NULL
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.name);
    EXECUTE format(
      'ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.app_users(id) ON DELETE SET NULL',
      r.tbl, r.name, r.col
    );
    RAISE NOTICE 'FK % em % (%): agora ON DELETE SET NULL', r.name, r.tbl, r.col;
  END LOOP;
END $$;
