-- Migration: Adicionar campos de briefing e atualizar trigger de segurança do editor
-- Criado em: 2026-06-26

-- 1. Adicionar colunas de briefing à tabela edicoes_cronograma (todas nuláveis)
ALTER TABLE public.edicoes_cronograma
  ADD COLUMN formato text,
  ADD COLUMN duracao text,
  ADD COLUMN legenda boolean DEFAULT NULL,
  ADD COLUMN link_editado text,
  ADD COLUMN link_referencia text,
  ADD COLUMN link_roteiro text,
  ADD COLUMN link_brutos text,
  ADD COLUMN link_artes text;

-- 2. Atualizar a trigger de segurança do editor
-- Agora o editor pode modificar: status, observacoes e link_editado.
-- Modificar qualquer outro campo (incluindo os novos campos de briefing e prazos/designação) gera exceção.
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
       NEW.created_by IS DISTINCT FROM OLD.created_by OR
       NEW.formato IS DISTINCT FROM OLD.formato OR
       NEW.duracao IS DISTINCT FROM OLD.duracao OR
       NEW.legenda IS DISTINCT FROM OLD.legenda OR
       NEW.link_referencia IS DISTINCT FROM OLD.link_referencia OR
       NEW.link_roteiro IS DISTINCT FROM OLD.link_roteiro OR
       NEW.link_brutos IS DISTINCT FROM OLD.link_brutos OR
       NEW.link_artes IS DISTINCT FROM OLD.link_artes THEN
      RAISE EXCEPTION 'Acesso negado: Editores podem alterar apenas status, observações e o link do vídeo editado.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
