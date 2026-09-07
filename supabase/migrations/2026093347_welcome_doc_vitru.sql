-- Welcome Doc Digital v1 — copy real, do mockup welcome-doc-lumos-portal-v2.html.
-- Publica pro cliente real (Vitru) e liga os itens que ela já preencheu
-- antes desta migração (testados nesta sessão: logo, brand_book, acessos)
-- aos itens novos do template, pra nenhum upload/marcação se perder.

INSERT INTO client_welcome_doc_templates (vertical, version, sections, variables, checklist, is_active)
VALUES (
  'digital', 1,
  '[
    {"key":"intro","type":"lead","body":"Que bom te ter por aqui. Esta página é o seu ponto de partida: o que esperar da gente, o que a gente precisa de você e como as coisas funcionam no dia a dia. Leva cinco minutos, e fica sempre aqui, atualizada durante o projeto."},
    {"key":"time","type":"rows","kicker":"01 · Seu time","title":"Quem cuida","titleAccent":"da sua conta",
      "rows":[
        {"name":"{{ATENDIMENTO}}","role":"Atendimento","when":"sempre — qualquer assunto entra por aqui","pill":"seu ponto focal","pillStyle":"accent"},
        {"name":"{{PRODUCAO}}","role":"Produção","when":"acompanha as gravações e a logística no dia","pill":"no set","pillStyle":"ghost"},
        {"name":"Caio Rizzutti","role":"CEO","when":"direção criativa e decisões estratégicas","pill":"estratégia","pillStyle":"ghost"},
        {"name":"Vinicius Ankerkrone","role":"CFO","when":"contrato, escopo e comercial","pill":"comercial","pillStyle":"ghost"}
      ],
      "footnote":"Você não precisa acionar editor ou produtor diretamente. Tudo passa por {{ATENDIMENTO}}, é o que garante que nenhum pedido se perca numa conversa paralela e que o time todo trabalhe com a mesma informação."},
    {"key":"escopo","type":"two-panels","kicker":"02 · Escopo","title":"O que está","titleAccent":"no combinado",
      "esquerda":{"titulo":"Incluído","sub":"Todo mês, sem precisar pedir","itens":[
        "{{QTD_PECAS}} peças por mês — {{FORMATOS}}",
        "Roteiro, direção, captação e edição",
        "Tratamento de cor, trilha e legendas",
        "{{RODADAS}} rodadas de alteração por peça",
        "1 diária de captação por mês",
        "Entrega em {{PRAZO_ENTREGA}} após o roteiro aprovado"
      ]},
      "direita":{"titulo":"Fora do combinado","sub":"Existe, mas a gente orça à parte","itens":[
        "Peças além do volume contratado",
        "Rodadas de alteração acima de {{RODADAS}}",
        "Mídia paga, impulsionamento e anúncios",
        "Postagem e gestão das redes",
        "Cachê de talentos, locação e trilha comercial",
        "Diárias extras e demandas com menos de 48h"
      ]}},
    {"key":"ciclo","type":"steps","kicker":"03 · Como funciona","title":"O ciclo","titleAccent":"do mês",
      "lead":"O mês é sempre o mesmo. As duas etapas destacadas são suas, e cada dia de atraso nelas é um dia de atraso na entrega, porque o time já está alocado no ciclo seguinte.",
      "passos":[
        {"numero":"01","texto":"Reunião de planejamento do mês","quemFaz":"Lumos + você","quando":"Semana 1"},
        {"numero":"02","texto":"Pauta e roteiros","quemFaz":"Lumos","quando":"Semana 1"},
        {"numero":"03","texto":"Aprovação dos roteiros","quemFaz":"Você","quando":"{{PRAZO_FEEDBACK}}","suaVez":true},
        {"numero":"04","texto":"Pré-produção e agendamento","quemFaz":"Lumos","quando":"Semana 2"},
        {"numero":"05","texto":"Captação","quemFaz":"Lumos","quando":"Diária do mês"},
        {"numero":"06","texto":"Edição","quemFaz":"Lumos","quando":"{{PRAZO_ENTREGA}}"},
        {"numero":"07","texto":"Aprovação dos cortes no portal","quemFaz":"Você","quando":"{{PRAZO_FEEDBACK}}","suaVez":true},
        {"numero":"08","texto":"Ajustes e entrega final","quemFaz":"Lumos","quando":"2 dias úteis"}
      ]},
    {"key":"checklist","type":"checklist"},
    {"key":"comunicacao","type":"note","kicker":"05 · Comunicação","label":"Canal oficial · {{CANAL}}",
      "body":"Resposta em até 4 horas úteis, de segunda a sexta, das 9h às 18h. Para contrato e nota fiscal, contato@produtoralumos.com.br.\n\nUm combinado honesto: pedido feito fora do canal oficial, no direct, no WhatsApp pessoal de alguém do time, no corredor de uma gravação, não entra na fila. Não é rigidez, é a única forma de garantir que ele não se perca. Se pintar uma ideia às 22h, manda no canal. A gente lê de manhã e ela entra no fluxo."},
    {"key":"feedback","type":"tips","kicker":"06 · Feedback","title":"Como pedir ajuste","titleAccent":"e ser entendido",
      "dicas":[
        {"titulo":"Consolide","texto":"Junte a opinião de todo mundo do seu lado e mande de uma vez. Feedback pingado gera versões conflitantes e queima uma rodada à toa."},
        {"titulo":"Comente no ponto exato","texto":"No portal você comenta em cima do frame. Em 00:12 o corte ficou seco resolve em cinco minutos; achei o meio estranho custa uma reunião."},
        {"titulo":"Fale do objetivo","texto":"Isso não conversa com o nosso público é acionável. Se for questão de gosto, diz o porquê, quase sempre existe uma solução melhor."}
      ]},
    {"key":"datas","type":"date-cards","kicker":"07 · Calendário","title":"Datas que","titleAccent":"importam",
      "cards":[
        {"data":"{{DATA_KICKOFF}}","titulo":"Kickoff","nota":"10:00 · online","destaque":true},
        {"data":"Semana 1","titulo":"Planejamento","nota":"mensal, fixo"},
        {"data":"{{DIA_GRAVACAO}}","titulo":"Diária 01","nota":"11:00 às 19:00"},
        {"data":"Dia {{DIA_FATURAMENTO}}","titulo":"Faturamento","nota":"conforme contrato"}
      ]},
    {"key":"proximos","type":"next-steps","kicker":"08 · Sua vez","title":"Próximos","titleAccent":"passos",
      "passos":[
        {"numero":"01","texto":"Enviar os itens pendentes acima","nota":"os de marca são os mais urgentes","quando":"até {{DATA_KICKOFF}}"},
        {"numero":"02","texto":"Confirmar quem aprova e o backup","nota":"e adicionar essa pessoa ao canal oficial","quando":"até {{DATA_KICKOFF}}"},
        {"numero":"03","texto":"Confirmar presença no kickoff","nota":"{{ATENDIMENTO}} manda o convite","quando":"{{DATA_KICKOFF}}"},
        {"numero":"04","texto":"Salvar este link","nota":"ele fica atualizado durante todo o projeto","quando":"—"}
      ]}
  ]'::jsonb,
  '[
    {"key":"CLIENTE","label":"Cliente","type":"text","required":true,"group":"geral"},
    {"key":"ATENDIMENTO","label":"Atendimento","type":"text","required":true,"group":"time"},
    {"key":"PRODUCAO","label":"Produção","type":"text","required":true,"group":"time"},
    {"key":"QTD_PECAS","label":"Peças por mês","type":"number","required":true,"group":"escopo"},
    {"key":"FORMATOS","label":"Formatos","type":"text","required":true,"group":"escopo"},
    {"key":"RODADAS","label":"Rodadas de alteração","type":"number","required":true,"group":"escopo"},
    {"key":"PRAZO_ENTREGA","label":"Prazo de entrega","type":"text","required":true,"group":"escopo"},
    {"key":"PRAZO_FEEDBACK","label":"Prazo de feedback","type":"text","required":true,"group":"escopo"},
    {"key":"DATA_KICKOFF","label":"Data do kickoff","type":"text","required":true,"group":"datas"},
    {"key":"DIA_FATURAMENTO","label":"Dia de faturamento","type":"text","required":true,"group":"datas"},
    {"key":"CANAL","label":"Canal oficial","type":"text","required":true,"group":"comunicacao"},
    {"key":"DIA_GRAVACAO","label":"Data da próxima diária","type":"text","required":false,"group":"datas"}
  ]'::jsonb,
  '[
    {"key":"logo","group":"marca","title":"Logo","description":"Em alta resolução, de preferência vetorial (AI, EPS ou SVG), ou um PNG bem grande se não tiver outro.","requires_upload":true,"sort_order":10},
    {"key":"brand_book","group":"marca","title":"Brand book","description":"O documento com as diretrizes visuais da sua marca, se você tiver um.","requires_upload":true,"sort_order":20},
    {"key":"guidelines","group":"marca","title":"Guidelines de conteúdo","description":"Como sua marca fala, o que evitar, referências de tom.","requires_upload":true,"sort_order":30},
    {"key":"acessos","group":"acessos","title":"Acessos","description":"Convide contato@produtoralumos.com.br como editor nas contas que vamos mexer (redes sociais, Drive etc.), e marca aqui quando fizer.","requires_upload":false,"sort_order":40},
    {"key":"quem_aprova","group":"acessos","title":"Quem aprova","description":"Nome, cargo e e-mail de quem dá a palavra final, e quem substitui essa pessoa em férias. Combina pelo canal oficial e marca aqui quando resolver.","requires_upload":false,"sort_order":50},
    {"key":"metricas_perfis","group":"acessos","title":"Métricas dos perfis","description":"Acesso de visualização ao Instagram Insights e ao YouTube Studio, pra gente medir o que funciona. Libera o acesso e marca aqui quando fizer.","requires_upload":false,"sort_order":60},
    {"key":"referencias","group":"contexto","title":"Referências","description":"3 a 5 conteúdos que vocês gostam, podem ser de outras marcas. E o que já foi testado e não funcionou.","requires_upload":true,"sort_order":70},
    {"key":"calendario_semestre","group":"contexto","title":"Calendário do semestre","description":"Datas, campanhas e lançamentos que a gente precisa considerar no planejamento.","requires_upload":true,"sort_order":80}
  ]'::jsonb,
  true
)
ON CONFLICT (vertical, version) DO NOTHING;

-- Publica pra Vitru, com os valores reais do mockup.
INSERT INTO client_welcome_docs (client_id, template_id, values, status, published_at)
SELECT '4298cbde-99fe-4465-ae14-a6ec70d88122'::uuid, t.id, '{
    "CLIENTE": "Vitru",
    "ATENDIMENTO": "Ariella Cordes",
    "PRODUCAO": "Samantha Ike",
    "QTD_PECAS": "12",
    "FORMATOS": "Reels, Shorts e cortes 16:9",
    "RODADAS": "2",
    "PRAZO_ENTREGA": "5 dias úteis",
    "PRAZO_FEEDBACK": "3 dias úteis",
    "DATA_KICKOFF": "12/09",
    "DIA_FATURAMENTO": "05",
    "CANAL": "Slack compartilhado",
    "DIA_GRAVACAO": "11/09"
  }'::jsonb, 'published', now()
FROM client_welcome_doc_templates t WHERE t.vertical = 'digital' AND t.version = 1
ON CONFLICT (client_id) DO NOTHING;

INSERT INTO client_welcome_doc_itens (welcome_doc_id, item_key, group_key, titulo, descricao, requer_arquivo, sort_order)
SELECT d.id, (c->>'key'), (c->>'group'), (c->>'title'), (c->>'description'), (c->>'requires_upload')::boolean, (c->>'sort_order')::int
FROM client_welcome_docs d
JOIN client_welcome_doc_templates t ON t.id = d.template_id
CROSS JOIN LATERAL jsonb_array_elements(t.checklist) AS c
WHERE d.client_id = '4298cbde-99fe-4465-ae14-a6ec70d88122'::uuid
ON CONFLICT (welcome_doc_id, item_key) DO NOTHING;

-- Liga o que a Vitru já preencheu (testado nesta sessão: logo, brand_book,
-- acessos) ao item novo — nada se perde. guidelines, quem_aprova,
-- metricas_perfis, referencias e calendario_semestre continuam pendentes,
-- corretamente, porque ainda não foram preenchidos.
UPDATE client_boas_vindas_itens s
SET welcome_doc_item_id = i.id
FROM client_welcome_doc_itens i
JOIN client_welcome_docs d ON d.id = i.welcome_doc_id
WHERE d.client_id = '4298cbde-99fe-4465-ae14-a6ec70d88122'::uuid
  AND s.client_id = '4298cbde-99fe-4465-ae14-a6ec70d88122'::uuid
  AND s.item_key = i.item_key
  AND s.welcome_doc_item_id IS NULL;

-- Conferência (rodar à mão depois de aplicar):
-- SELECT item_key, welcome_doc_item_id IS NOT NULL AS ligado FROM client_boas_vindas_itens
--   WHERE client_id = '4298cbde-99fe-4465-ae14-a6ec70d88122';
-- -- logo, brand_book e acessos devem estar com ligado = true.
