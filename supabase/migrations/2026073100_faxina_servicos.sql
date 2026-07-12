-- Faxina dos serviços já cadastrados: renomeia os valores "bagunçados" para os
-- nomes padrão do catálogo. Casa por texto minúsculo + sem espaços nas pontas,
-- então pega variações de caixa. Só toca nas linhas que batem (as demais ficam).
-- REVISE a lista antes de rodar; ajuste/retire o que não fizer sentido no seu caso.

UPDATE public.fornecedor_servicos
SET tipo_servico = CASE lower(btrim(tipo_servico))
  WHEN 'direção de cena/artística (simples)'                       THEN 'Direção de cena / artística'
  WHEN 'direção de cena/artística (com ppm)'                       THEN 'Direção de cena / artística (com PPM)'
  WHEN 'direção'                                                   THEN 'Direção geral'
  WHEN 'atriz'                                                     THEN 'Ator / Atriz'
  WHEN 'ator'                                                      THEN 'Ator / Atriz'
  WHEN 'editora'                                                   THEN 'Edição de vídeo'
  WHEN 'tudo'                                                      THEN 'Tudo (produtora full-service)'
  WHEN 'assistente de câmera'                                     THEN 'Assistente de câmera (AC)'
  WHEN 'assist de câmera'                                         THEN 'Assistente de câmera (AC)'
  WHEN 'direção de arte, cenografia e montagens em geral'          THEN 'Direção de arte'
  WHEN 'diaria de camera fx30'                                     THEN 'Diária de câmera (equipamento)'
  WHEN 'edição de video'                                           THEN 'Edição de vídeo'
  WHEN 'edição sameday'                                            THEN 'Edição sameday'
  WHEN 'maquiagem e cabelo'                                        THEN 'Maquiagem e cabelo'
  WHEN 'gaffer'                                                    THEN 'Gaffer (chefe de elétrica)'
  WHEN 'técnico de áudio'                                          THEN 'Técnico de áudio'
  WHEN 'técnico de audio'                                          THEN 'Técnico de áudio'
  WHEN 'técnico de som'                                            THEN 'Técnico de áudio'
  WHEN 'coordenação técnica'                                       THEN 'Coordenação técnica'
  WHEN 'op câmera, cinegrafista'                                   THEN 'Operador de câmera'
  -- Ambíguos (revise / ajuste se quiser):
  WHEN 'produção'                                                  THEN 'Produtor(a)'
  WHEN 'assist. filmmaker'                                         THEN 'Assistente de câmera (AC)'
  ELSE tipo_servico
END
WHERE lower(btrim(tipo_servico)) IN (
  'direção de cena/artística (simples)', 'direção de cena/artística (com ppm)', 'direção',
  'atriz', 'ator', 'editora', 'tudo', 'assistente de câmera', 'assist de câmera',
  'direção de arte, cenografia e montagens em geral', 'diaria de camera fx30',
  'edição de video', 'edição sameday', 'maquiagem e cabelo', 'gaffer',
  'técnico de áudio', 'técnico de audio', 'técnico de som', 'coordenação técnica',
  'op câmera, cinegrafista', 'produção', 'assist. filmmaker'
);

-- Já estavam no padrão (não precisam mudar): Storymaker, Filmmaker, Som direto,
-- Operador de câmera, Cinegrafista, Motoboy, DTV.
