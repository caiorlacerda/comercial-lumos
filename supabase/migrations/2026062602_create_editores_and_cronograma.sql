-- Migration: Create editores and edicoes_cronograma tables
-- Created: 2026-06-26

-- 1. Adicionar o valor 'editor' ao enum user_role
-- PostgreSQL permite ALTER TYPE ADD VALUE fora de blocos de transação explícitos.
-- Usamos a cláusula IF NOT EXISTS suportada no PostgreSQL 12+
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'editor';

-- 2. Tabela de Editores (Recursos de Produção)
CREATE TABLE IF NOT EXISTS public.editores (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome         text NOT NULL,
  tipo         text NOT NULL CHECK (tipo IN ('interno', 'freelancer')),
  auth_user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  status       text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'inativo')),
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

-- Habilitar Row Level Security (RLS) para Editores
ALTER TABLE public.editores ENABLE ROW LEVEL SECURITY;

-- Políticas de RLS para Editores
-- Leitura global para qualquer usuário autenticado
DROP POLICY IF EXISTS select_editores ON public.editores;
CREATE POLICY select_editores ON public.editores
  FOR SELECT TO authenticated USING (true);

-- Apenas admins e gerentes de produção podem gerenciar (inserir, atualizar, deletar) editores
DROP POLICY IF EXISTS manage_editores ON public.editores;
CREATE POLICY manage_editores ON public.editores
  FOR ALL TO authenticated USING (
    public.get_user_role() IN ('admin', 'producao')
  );

-- 3. Tabela de Edições (Tarefas de Linha do Tempo e Backlog)
CREATE TABLE IF NOT EXISTS public.edicoes_cronograma (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo         text NOT NULL,
  project_id     uuid REFERENCES public.projects(id) ON DELETE SET NULL, -- Vínculo opcional com projeto
  editor_id      uuid REFERENCES public.editores(id) ON DELETE SET NULL, -- Se NULL: Item em Espera
  semana_inicio  date, -- Segunda-feira de início. Se NULL: Item em Espera
  prazo          date NOT NULL, -- Prazo de entrega final
  status         text NOT NULL DEFAULT 'nao_iniciado' CHECK (status IN ('nao_iniciado', 'em_andamento', 'revisao_interna', 'aprovacao_cliente', 'concluido')),
  prioridade     text NOT NULL DEFAULT 'media' CHECK (prioridade IN ('baixa', 'media', 'alta')),
  observacoes    text,
  created_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL, -- Criador do card
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);

-- Habilitar Row Level Security (RLS) para Edições do Cronograma
ALTER TABLE public.edicoes_cronograma ENABLE ROW LEVEL SECURITY;

-- Políticas de RLS para Edições do Cronograma
-- A. Leitura global de todas as edições para usuários autenticados
DROP POLICY IF EXISTS select_edicoes ON public.edicoes_cronograma;
CREATE POLICY select_edicoes ON public.edicoes_cronograma
  FOR SELECT TO authenticated USING (true);

-- B. Admins e Produtores têm acesso completo a todos os cards
DROP POLICY IF EXISTS manage_edicoes_admin_producao ON public.edicoes_cronograma;
CREATE POLICY manage_edicoes_admin_producao ON public.edicoes_cronograma
  FOR ALL TO authenticated USING (
    public.get_user_role() IN ('admin', 'producao')
  );

-- C. Editores podem atualizar apenas os cards sob sua responsabilidade (editor_id vinculado ao seu login)
DROP POLICY IF EXISTS update_edicoes_proprias ON public.edicoes_cronograma;
CREATE POLICY update_edicoes_proprias ON public.edicoes_cronograma
  FOR UPDATE TO authenticated USING (
    public.get_user_role() = 'editor' AND 
    editor_id IN (
      SELECT id FROM public.editores WHERE auth_user_id = auth.uid()
    )
  );

-- 4. Trigger de validação de campos para a role de Editor
-- A RLS não consegue comparar colunas alteradas num UPDATE. Usamos uma Trigger BEFORE UPDATE.
CREATE OR REPLACE FUNCTION public.check_editor_update_fields()
RETURNS TRIGGER AS $$
BEGIN
  -- Se o usuário atual for da role 'editor', valida se tentou modificar campos proibidos
  IF public.get_user_role() = 'editor' THEN
    IF NEW.semana_inicio IS DISTINCT FROM OLD.semana_inicio OR
       NEW.prazo IS DISTINCT FROM OLD.prazo OR
       NEW.editor_id IS DISTINCT FROM OLD.editor_id OR
       NEW.project_id IS DISTINCT FROM OLD.project_id OR
       NEW.titulo IS DISTINCT FROM OLD.titulo OR
       NEW.prioridade IS DISTINCT FROM OLD.prioridade OR
       NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'Acesso negado: Editores podem alterar apenas status e observações.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Associar a Trigger de validação na tabela
DROP TRIGGER IF EXISTS trigger_check_editor_update_fields ON public.edicoes_cronograma;
CREATE TRIGGER trigger_check_editor_update_fields
  BEFORE UPDATE ON public.edicoes_cronograma
  FOR EACH ROW
  EXECUTE FUNCTION public.check_editor_update_fields();

-- 5. Triggers de atualização automática de updated_at
DROP TRIGGER IF EXISTS update_editores_updated_at ON public.editores;
CREATE TRIGGER update_editores_updated_at
  BEFORE UPDATE ON public.editores
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS update_edicoes_cronograma_updated_at ON public.edicoes_cronograma;
CREATE TRIGGER update_edicoes_cronograma_updated_at
  BEFORE UPDATE ON public.edicoes_cronograma
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

-- Conceder permissões de uso para as tabelas às roles de API
GRANT ALL ON public.editores TO authenticated, service_role;
GRANT ALL ON public.edicoes_cronograma TO authenticated, service_role;
