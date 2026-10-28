-- 2026102803_cronograma_mais_cores.sql
-- MAIS CORES PARA MARCAR OS ITENS DO CRONOGRAMA DA EQUIPE
--
-- Além das 4 cores da legenda (edição, gravação/meeting, externa, entrega), o item pode
-- ganhar uma cor livre: roxo, rosa, vermelho, amarelo, turquesa ou cinza. A coluna `tipo`
-- tinha um CHECK com só as 4 originais; aqui ele passa a aceitar as 6 novas.
--
-- Não mexe em nenhum dado: os itens existentes continuam como estão.
-- Rodar à mão no SQL Editor do Supabase, ANTES de usar as novas cores no app.
-- Seguro rodar mais de uma vez.

ALTER TABLE public.cronograma_itens DROP CONSTRAINT IF EXISTS cronograma_itens_tipo_check;
ALTER TABLE public.cronograma_itens
  ADD CONSTRAINT cronograma_itens_tipo_check
  CHECK (tipo IN ('edicao', 'gravacao', 'externa', 'entrega',
                  'roxo', 'rosa', 'vermelho', 'amarelo', 'turquesa', 'cinza'));

-- Conferência: deve listar a regra com as 10 opções.
SELECT conname, pg_get_constraintdef(oid) AS regra
FROM pg_constraint
WHERE conrelid = 'public.cronograma_itens'::regclass AND contype = 'c' AND conname = 'cronograma_itens_tipo_check';
