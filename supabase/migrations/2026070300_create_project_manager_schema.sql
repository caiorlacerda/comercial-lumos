-- Migration: Fase 1 — Banco de Dados, Segurança e Seeds do Gerenciador de Projetos
-- Created: 2026-07-03
-- Description: Estende a tabela projects com colunas de controle, cria as tabelas de tarefas e templates, define RLS e popula dados padrão.

-- 1. ESTENDER A TABELA PROJECTS (Sem alterar colunas existentes)
-- Adiciona apenas colunas novas com tratamento IF NOT EXISTS para segurança e robustez.
ALTER TABLE public.projects 
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'concluido')),
  ADD COLUMN IF NOT EXISTS data_inicio date,
  ADD COLUMN IF NOT EXISTS data_fim date,
  ADD COLUMN IF NOT EXISTS descricao text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Trigger para updated_at em projects (caso não exista)
DROP TRIGGER IF EXISTS projects_updated_at ON public.projects;
CREATE TRIGGER projects_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 2. TABELA DE TEMPLATES DE TAREFAS POR SEGMENTO
-- Armazena as tarefas padrão que serão associadas aos segmentos de projeto.
CREATE TABLE IF NOT EXISTS public.project_task_templates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  segmento       public.budget_category NOT NULL, -- Enum 'digital', 'filme', 'live'
  titulo         text NOT NULL,
  descricao      text,
  ordem          integer NOT NULL DEFAULT 0,
  prioridade     text NOT NULL DEFAULT 'media' CHECK (prioridade IN ('baixa', 'media', 'alta')),
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);

-- Índice para busca rápida de templates de tarefas por segmento
CREATE INDEX IF NOT EXISTS idx_task_templates_segmento ON public.project_task_templates(segmento);

-- Trigger para updated_at em project_task_templates
DROP TRIGGER IF EXISTS update_project_task_templates_updated_at ON public.project_task_templates;
CREATE TRIGGER update_project_task_templates_updated_at
  BEFORE UPDATE ON public.project_task_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 3. TABELA DE TAREFAS DE PROJETOS (project_tasks)
-- Armazena as tarefas de cada projeto com status e datas para visões de Lista, Kanban e Gantt.
CREATE TABLE IF NOT EXISTS public.project_tasks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  titulo         text NOT NULL,
  descricao      text,
  status         text NOT NULL DEFAULT 'a_fazer' CHECK (status IN ('a_fazer', 'em_andamento', 'concluido')),
  prioridade     text NOT NULL DEFAULT 'media' CHECK (prioridade IN ('baixa', 'media', 'alta')),
  ordem          integer NOT NULL DEFAULT 0,
  data_inicio    date DEFAULT NULL, -- Nascem nulos para preenchimento manual do produtor/admin
  data_fim       date DEFAULT NULL,  -- Nascem nulos para preenchimento manual do produtor/admin
  responsavel_id uuid REFERENCES public.app_users(id) ON DELETE SET NULL, -- FK apontando para app_users(id)
  created_by     uuid REFERENCES public.app_users(id) ON DELETE SET NULL,  -- FK apontando para app_users(id)
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);

-- Índices para otimização de consultas de tarefas
CREATE INDEX IF NOT EXISTS idx_project_tasks_project ON public.project_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_project_tasks_responsavel ON public.project_tasks(responsavel_id);

-- Trigger para updated_at em project_tasks
DROP TRIGGER IF EXISTS update_project_tasks_updated_at ON public.project_tasks;
CREATE TRIGGER update_project_tasks_updated_at
  BEFORE UPDATE ON public.project_tasks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 4. SEGURANÇA E POLÍTICAS DE ROW LEVEL SECURITY (RLS)
ALTER TABLE public.project_task_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_tasks ENABLE ROW LEVEL SECURITY;

-- Políticas para Templates de Tarefa
DROP POLICY IF EXISTS select_templates ON public.project_task_templates;
CREATE POLICY select_templates ON public.project_task_templates
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS manage_templates ON public.project_task_templates;
CREATE POLICY manage_templates ON public.project_task_templates
  FOR ALL TO authenticated USING (public.get_user_role() = 'admin');

-- Políticas para Tarefas de Projeto
DROP POLICY IF EXISTS select_tasks ON public.project_tasks;
CREATE POLICY select_tasks ON public.project_tasks
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS manage_tasks ON public.project_tasks;
CREATE POLICY manage_tasks ON public.project_tasks
  FOR ALL TO authenticated USING (public.get_user_role() IN ('admin', 'producao'));

-- Permissões gerais de uso das tabelas para as roles de conexão
GRANT ALL ON public.project_task_templates TO authenticated, service_role;
GRANT ALL ON public.project_tasks TO authenticated, service_role;

-- 5. SEEDS PARA AS TAREFAS-PADRÃO POR SEGMENTO (Digital, Filme, Live)
-- Popula os templates iniciais sem prazos de início/fim automáticos.
INSERT INTO public.project_task_templates (segmento, titulo, descricao, ordem, prioridade) VALUES
-- Segmento: Digital
('digital', 'Planejamento e Briefing', 'Alinhamento de pauta e levantamento de referências', 10, 'alta'),
('digital', 'Roteirização', 'Criação dos roteiros ou copys dos posts/vídeos', 20, 'media'),
('digital', 'Gravação/Captação', 'Produção em estúdio ou externa dos materiais', 30, 'alta'),
('digital', 'Edição e Finalização', 'Corte, montagem, inserção de legendas e trilha', 40, 'media'),
('digital', 'Aprovação e Postagem', 'Aprovação do cliente e agendamento da publicação', 50, 'alta'),

-- Segmento: Filme
('filme', 'Pré-produção e Roteiro', 'Desenvolvimento de roteiro, decupagem, elenco e locação', 10, 'alta'),
('filme', 'Filmagem (Produção)', 'Captação das diárias planejadas', 20, 'alta'),
('filme', 'Montagem (Edição)', 'Primeiro corte e montagem do filme', 30, 'media'),
('filme', 'Pós-Produção de Áudio e Cor', 'Color grading, Sound Design e mixagem', 40, 'media'),
('filme', 'Exportação e Entrega', 'Masterização final e entrega das peças prontas', 50, 'alta'),

-- Segmento: Live
('live', 'Visita Técnica e Alinhamento', 'Análise do local da transmissão e requisitos de rede', 10, 'alta'),
('live', 'Montagem e Passagem', 'Montagem técnica dos equipamentos, câmeras e teste de sinal', 20, 'alta'),
('live', 'Transmissão Ao Vivo', 'Execução do evento de transmissão simultânea', 30, 'alta'),
('live', 'Desmontagem e Backup', 'Desmobilização dos equipamentos e backup de brutos gravados', 40, 'media'),
('live', 'Clipping e Highlights', 'Edição dos melhores momentos da transmissão (se contratado)', 50, 'baixa')
ON CONFLICT DO NOTHING;
