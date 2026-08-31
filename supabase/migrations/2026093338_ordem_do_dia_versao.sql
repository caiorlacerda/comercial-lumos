-- 2026093338_ordem_do_dia_versao.sql
-- Ordem do dia com várias mãos: a trava de conflito.
--
-- O problema: a tela salva campo a campo, mas cada salvamento manda a lista
-- inteira de volta (cronograma, equipe, elenco, objetos...). Com duas pessoas
-- na mesma ordem do dia, quem salva por último grava o que tinha lido quando
-- abriu a tela, e apaga em silêncio o que a outra fez no meio do caminho.
-- Ninguém percebe até faltar coisa no set.
--
-- A trava: cada linha ganha um contador `versao`. Um gatilho BEFORE UPDATE soma
-- 1 a cada atualização, e o cliente passa a salvar com
-- `WHERE id = ... AND versao = <a versão que eu li>`. Se outra pessoa já salvou,
-- a versão mudou, o UPDATE não pega linha nenhuma, nada é escrito, e a tela
-- recarrega e avisa em vez de atropelar.
--
-- Por que contador e não `updated_at`: timestamp com microssegundo passa por
-- formatação de ida e volta entre o PostgREST e o navegador, e basta um dígito
-- a mais ou a menos pra comparação nunca bater, o que transformaria a trava em
-- "não consigo mais salvar nada". Um inteiro não tem esse risco.
--
-- Nada aqui altera as migrações até 2026093337, que já rodaram em produção.
-- Idempotente: pode rodar de novo sem estragar nada.

-- ───────────────────────────────────────────────────────────────
-- 1) A coluna
-- ───────────────────────────────────────────────────────────────
-- DEFAULT 0 e NOT NULL: as ordens do dia que já existem entram na regra
-- valendo 0, e a primeira edição já leva pra 1.
ALTER TABLE public.ordens_do_dia
  ADD COLUMN IF NOT EXISTS versao bigint NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.ordens_do_dia.versao IS
  'Contador de edições da linha. Sobe sozinho a cada UPDATE (gatilho incrementa_versao). O cliente salva com WHERE versao = <a que leu> para não sobrescrever o trabalho de outra pessoa.';

-- ───────────────────────────────────────────────────────────────
-- 2) O gatilho que soma 1
-- ───────────────────────────────────────────────────────────────
-- Genérica de propósito: qualquer outra tabela que ganhar uma coluna `versao`
-- pode pendurar este mesmo gatilho, sem função nova.
CREATE OR REPLACE FUNCTION public.incrementa_versao()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.versao := COALESCE(OLD.versao, 0) + 1;
  RETURN NEW;
END; $$;

COMMENT ON FUNCTION public.incrementa_versao() IS
  'Gatilho BEFORE UPDATE: soma 1 na coluna versao da linha. Base da trava de conflito (salvamento condicionado à versão lida).';

DROP TRIGGER IF EXISTS trg_ordens_do_dia_versao ON public.ordens_do_dia;
CREATE TRIGGER trg_ordens_do_dia_versao
  BEFORE UPDATE ON public.ordens_do_dia
  FOR EACH ROW EXECUTE FUNCTION public.incrementa_versao();

-- ───────────────────────────────────────────────────────────────
-- 3) Tempo real
-- ───────────────────────────────────────────────────────────────
-- `ordens_do_dia` já está na publication supabase_realtime desde a migração
-- 2026072300, então o UPDATE de uma pessoa já chega na tela da outra. Nada a
-- fazer aqui, a nota fica só pra quem vier ler depois.
