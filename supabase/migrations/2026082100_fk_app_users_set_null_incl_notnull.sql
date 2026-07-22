-- Fix definitivo (v2) da exclusão de usuários. A v1 só tratava colunas anuláveis;
-- esta trata também as NOT NULL (ex.: project_costs.created_by): torna a coluna
-- anulável e converte a FK para ON DELETE SET NULL. Só afeta colunas que
-- REFERENCIAM app_users e que hoje TRAVAM o delete (não toca nas que já são
-- cascade/set null). São colunas de "autoria" — nulo é aceitável.

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT con.conname AS name,
           con.conrelid::regclass AS tbl,
           att.attname AS col,
           att.attnotnull AS notnull
    FROM pg_constraint con
    JOIN pg_attribute att
      ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
    WHERE con.contype = 'f'
      AND con.confrelid = 'public.app_users'::regclass
      AND con.confdeltype NOT IN ('c', 'n')   -- ainda não é cascade nem set null
      AND array_length(con.conkey, 1) = 1
  LOOP
    IF r.notnull THEN
      EXECUTE format('ALTER TABLE %s ALTER COLUMN %I DROP NOT NULL', r.tbl, r.col);
    END IF;
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.name);
    EXECUTE format(
      'ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.app_users(id) ON DELETE SET NULL',
      r.tbl, r.name, r.col
    );
    RAISE NOTICE 'FK % em % (col %): agora ON DELETE SET NULL', r.name, r.tbl, r.col;
  END LOOP;
END $$;
