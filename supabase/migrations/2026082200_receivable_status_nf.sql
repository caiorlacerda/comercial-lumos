-- Novos status de Contas a Receber: "Emitir NF" e "NF Emitida".
-- (Aguardando, Recebido já existiam; "Em atraso" é derivado do vencimento no app.)
ALTER TYPE receivable_status ADD VALUE IF NOT EXISTS 'emitir_nf';
ALTER TYPE receivable_status ADD VALUE IF NOT EXISTS 'nf_emitida';
