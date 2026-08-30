-- ROTEIRO LIGADO À TAREFA, E O STATUS QUE PEDE NOVA VERSÃO
--
-- O roteiro vivia solto na aba Roteiros: dava pra saber que o projeto tem seis
-- roteiros, mas não QUAL deles é o da tarefa que a pessoa está fazendo. Quem
-- edita abria a tarefa e ia caçar o link no Docs, no WhatsApp ou perguntando.
-- Agora ele se liga a uma tarefa, do mesmo jeito que o vídeo da revisão já se
-- liga (video_versions.task_id) — e some a pergunta "qual é o roteiro deste?".
--
-- ON DELETE SET NULL: apagar a tarefa não apaga o roteiro. O texto é do projeto
-- e costuma sobreviver à tarefa que o originou; ele volta pra lista solta.
--
-- O status ganha 'ajustes'. 'revisao' quer dizer "alguém está lendo agora";
-- 'ajustes' quer dizer "voltou com pedido, precisa de uma nova versão". Eram
-- duas situações diferentes no mesmo chip, e a diferença é justamente a que
-- decide se alguém precisa sentar e escrever de novo.

ALTER TABLE public.project_roteiros
  ADD COLUMN IF NOT EXISTS task_id uuid REFERENCES public.project_tasks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_project_roteiros_task ON public.project_roteiros(task_id);

ALTER TABLE public.project_roteiros DROP CONSTRAINT IF EXISTS project_roteiros_status_check;
ALTER TABLE public.project_roteiros ADD CONSTRAINT project_roteiros_status_check
  CHECK (status IN ('em_criacao', 'revisao', 'ajustes', 'aprovado'));

-- Conferência: deve listar a coluna nova e a regra com os quatro status.
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'project_roteiros' AND column_name = 'task_id';
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'project_roteiros_status_check';
