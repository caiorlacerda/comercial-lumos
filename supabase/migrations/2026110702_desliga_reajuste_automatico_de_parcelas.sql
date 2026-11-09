-- Desliga o gatilho que "reajusta parcelas" quando a margem ou o desconto de um orçamento APROVADO é editado.
--
-- Achados A5/C2 (pente fino do financeiro, 07/11/2026). O gatilho trg_versao_reajusta_parcelas
-- (função fn_versao_reajusta_parcelas, de 2026093358) corrompe o valor a receber:
--   · usa sempre `custo / (1 − margem) − desconto` e ignora `imposto_reajusta_preco` (propostas novas ficam com preço errado);
--   · dispara ANTES de o editor gravar os itens, então calcula com os itens velhos;
--   · soma "já recebido" só entre as parcelas ainda abertas, e divide o restante em partes IGUAIS (desfaz 30/70, datas e valores);
--   · não atualiza o vendido.
-- Caso real: #2026-282 Transmissão Live Enem — vendido R$ 5.000,00, parcela derrubada para R$ 2.000,00 em 14/10
-- ("Valor ajustado em 14/10/2026 (proposta editada)" duas vezes nas notas).
--
-- Regra que fica: o contratado é a soma das parcelas (ver 2026110700). Editar a proposta de um orçamento aprovado NÃO muda
-- mais o que foi contratado; se o preço combinado mudou de verdade, o Financeiro ajusta as parcelas na mão
-- ("Definir parcelamento" / editar a parcela), que é uma decisão consciente e fica no histórico.
--
-- Só DESLIGA (a função e o gatilho continuam existindo): reversível com
--   ALTER TABLE public.budget_versions ENABLE TRIGGER trg_versao_reajusta_parcelas;
-- Seguro rodar mais de uma vez. Nenhum dado é alterado.

ALTER TABLE public.budget_versions DISABLE TRIGGER trg_versao_reajusta_parcelas;

-- Conferência (somente leitura): tgenabled = 'D' significa desligado.
-- SELECT tgname, tgenabled FROM pg_trigger WHERE tgname = 'trg_versao_reajusta_parcelas';
