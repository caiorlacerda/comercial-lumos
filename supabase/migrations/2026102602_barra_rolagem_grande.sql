-- BARRA DE ROLAGEM MAIOR (acessibilidade, por usuário)
--
-- Quem tem dificuldade de pegar a barra de rolagem fina do lado direito liga esta
-- opção em Configurações › Aparência (ou o admin liga na ficha da pessoa, em
-- Usuários). O app deixa a barra maior, com área para clicar e arrastar.
-- Fica no banco, por usuário, para valer em qualquer computador. A pessoa edita a
-- própria linha de app_users (como já faz com telefone e foto); o admin edita a dos outros.
ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS barra_rolagem_grande boolean NOT NULL DEFAULT false;
