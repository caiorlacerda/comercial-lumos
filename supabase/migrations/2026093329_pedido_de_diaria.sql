-- 2026093329_pedido_de_diaria.sql
-- O cliente pede uma data de gravação pelo portal; a Lumos aceita ou recusa.

CREATE TABLE IF NOT EXISTS public.diaria_pedidos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  client_id      uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  client_user_id uuid REFERENCES public.client_users(id) ON DELETE SET NULL,
  nome           text NOT NULL,
  email          text NOT NULL,
  data_desejada  date NOT NULL,
  duracao_horas  numeric(4,1) NOT NULL DEFAULT 10,
  local          text,
  descricao      text NOT NULL,
  fora_do_pacote boolean NOT NULL DEFAULT false,
  estado         text NOT NULL DEFAULT 'pendente'
                 CHECK (estado IN ('pendente','aceito','recusado','cancelado')),
  motivo_recusa  text,
  diaria_id      uuid REFERENCES public.project_diarias(id) ON DELETE SET NULL,
  respondido_por uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  respondido_em  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_diaria_pedidos_projeto ON public.diaria_pedidos(project_id);
CREATE INDEX IF NOT EXISTS idx_diaria_pedidos_estado  ON public.diaria_pedidos(estado);
-- Um pedido pendente por dia POR CLIENTE. Clientes diferentes podem disputar a
-- mesma data: quem a Lumos aceitar primeiro ocupa o dia.
CREATE UNIQUE INDEX IF NOT EXISTS idx_diaria_pedidos_um_por_dia
  ON public.diaria_pedidos(client_id, data_desejada)
  WHERE estado = 'pendente';

CREATE TABLE IF NOT EXISTS public.agenda_bloqueios (
  data       date PRIMARY KEY,
  motivo     text,
  criado_por uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.client_portals
  ADD COLUMN IF NOT EXISTS antecedencia_dias int NOT NULL DEFAULT 7;

-- RLS: o portal NÃO fala com estas tabelas, fala com as RPCs. Aqui só o time.
ALTER TABLE public.diaria_pedidos   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agenda_bloqueios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "time le e escreve pedidos" ON public.diaria_pedidos;
CREATE POLICY "time le e escreve pedidos" ON public.diaria_pedidos
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "time le e escreve bloqueios" ON public.agenda_bloqueios;
CREATE POLICY "time le e escreve bloqueios" ON public.agenda_bloqueios
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Notificação por TRIGGER, não pelo cliente: o portal roda como anon e uma
-- chamada de notify() de lá esbarra na RLS. Mesmo motivo das outras rotas
-- públicas do app.
CREATE OR REPLACE FUNCTION public.notificar_pedido_de_diaria()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  u        RECORD;
  v_proj   text;
  v_quando text;
BEGIN
  SELECT name INTO v_proj FROM projects WHERE id = NEW.project_id;
  v_quando := to_char(NEW.data_desejada, 'DD/MM');
  FOR u IN
    SELECT id FROM app_users
    WHERE status = 'ativo' AND (role IN ('admin','producao') OR role = 'atendimento')
  LOOP
    INSERT INTO notifications (user_id, event_type, category, priority, title, body, link, data)
    VALUES (
      u.id, 'diaria_solicitada', 'producao', 'high',
      'Cliente pediu uma diária 📅',
      NEW.nome || ' pediu ' || v_quando || ' em ' || COALESCE(v_proj, 'um projeto') || '.',
      '/producao/projetos?projectId=' || NEW.project_id::text || '&aba=diarias',
      jsonb_build_object('pedido_id', NEW.id, 'project_id', NEW.project_id)
    );
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notificar_pedido_de_diaria falhou para %: %', NEW.id, SQLERRM;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_notificar_pedido_de_diaria ON public.diaria_pedidos;
CREATE TRIGGER trg_notificar_pedido_de_diaria
  AFTER INSERT ON public.diaria_pedidos
  FOR EACH ROW EXECUTE FUNCTION public.notificar_pedido_de_diaria();
