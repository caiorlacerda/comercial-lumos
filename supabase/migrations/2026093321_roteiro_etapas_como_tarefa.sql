-- O ROTEIRO PASSA A FALAR A MESMA LÍNGUA DA TAREFA
--
-- O roteiro tinha um conjunto próprio de etapas ("em criação / em revisão /
-- aprovado") enquanto a tarefa falava outra ("na fila / revisão interna / com o
-- cliente / ajustes / aprovado"). Duas línguas para o mesmo fluxo é como nasce
-- a dúvida: "em revisão" do roteiro era a revisão interna ou a do cliente?
-- Ninguém sabia sem perguntar.
--
-- Agora as etapas do roteiro são as da tarefa, menos as que não existem no
-- texto (captação e edição são do vídeo). O que era 'revisao' vira
-- 'revisao_interna', que é o que aquele status significava na prática: o time
-- lendo antes de mandar pro cliente.

-- Primeiro solta a regra, senão o UPDATE abaixo bate nela.
ALTER TABLE public.project_roteiros DROP CONSTRAINT IF EXISTS project_roteiros_status_check;

UPDATE public.project_roteiros SET status = 'revisao_interna' WHERE status = 'revisao';

ALTER TABLE public.project_roteiros ADD CONSTRAINT project_roteiros_status_check
  CHECK (status IN ('na_fila', 'em_criacao', 'revisao_interna', 'revisao_cliente', 'ajustes', 'aprovado'));

-- Conferência: nenhuma linha deve sobrar com o nome antigo, e a regra tem que
-- listar as seis etapas.
SELECT status, count(*) FROM public.project_roteiros GROUP BY status ORDER BY status;
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'project_roteiros_status_check';
