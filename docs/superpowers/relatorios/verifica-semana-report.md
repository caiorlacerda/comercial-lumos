# Verificação: fechar dia da semana + motivo pontual + antecedência (migração 2026093334)

Ambiente: dev server local (porta 5173), login via robô de testes. Projeto de escrita: **Produção Teste**
(`e67d3d79-7347-4dec-a519-6225992c1b75`), portal `http://localhost:5173/portal/_kXsb3iRhJAa`.
Hoje na sessão de teste: domingo, 30/08/2026.

## Status geral: PASSOU

## Passo a passo

1. **Fechar o domingo** — PASSOU. Em Produção Teste (Encerrados) > Diárias > "Agenda bloqueada",
   liguei o toggle "Domingo". Toast confirmou "Domingo fechado, para a produtora inteira, todo santo
   dia." Reabri o modal depois e o toggle continuava ligado (persistiu).

2. **Ver no portal** — PASSOU. Naveguei agosto/setembro/outubro de 2026 no portal (projeto Produção
   Teste, aba Diárias). Todos os domingos visíveis (Ago 30; Set 6, 13, 20, 27; Out 4, 11, 18, 25)
   aparecem sem "Pedir esta data" e com tooltip "Não gravamos aos domingos" (não um "Indisponível"
   genérico).

3. **Recusa do servidor** — PASSOU. Chamei a RPC `portal_pedir_diaria` diretamente (fora da tela) para
   domingo 06/09/2026 com token e project_id reais. Resposta: `{"error":"dia_semana_fechado"}`. Nenhum
   registro foi criado (a função retorna antes do INSERT).

4. **Motivo de data pontual** — PASSOU. Bloqueei terça-feira 15/09/2026 com motivo escrito por mim
   ("Teste QA robô: equipe em manutenção de equipamento"). No portal, o dia 15/09 apareceu sem clique e
   com esse texto exato como tooltip.

5. **Nunca amanhã** — PASSOU. No calendário do cliente, amanhã (31/08) e depois de amanhã (01/09) não
   são clicáveis. O primeiro dia realmente pedível (07/09) respeita a antecedência configurada no portal
   (maior que o piso de 2 dias da migração). Observação à parte (não é defeito): alguns dias próximos
   apareceram como "Indisponível" genérico em vez de "Cedo demais para pedir" — isso é porque já existe
   diária de OUTRO projeto marcada nesses dias (estado "ocupado", que por design nunca carrega motivo,
   conforme o comentário da própria migração). Comportamento correto, só documentando para não confundir
   com bug.

6. **Um mês por vez** — PASSOU. Setas navegam Agosto → Setembro → Outubro. Seta "Mês anterior" fica
   inerte em Agosto (mês atual/primeiro). Seta "Próximo mês" fica inerte em Outubro (não avança para
   Novembro, mesmo a função do banco cobrindo até 90 dias — a tela limita a 3 meses, como esperado). O
   nome do mês aparece corretamente entre as duas setas em todos os casos.

7. **A janela do pedido** — PASSOU. Cliquei num dia livre (ex.: 1, 8 e 9 de outubro/2026); a janela abre
   com o título por extenso (ex.: "Quinta-feira, 8 de outubro de 2026"). Fecha por Esc, pelo X e por
   clique fora — testei os três métodos separadamente e todos funcionaram. Preenchi o formulário e enviei
   um pedido de verdade no Produção Teste para 08/10/2026 ("Teste QA robo: verificacao de fechamento de
   dia da semana (excluir depois)"); apareceu em "Seus pedidos" como "Esperando a Lumos". Cancelei em
   seguida pelo botão "Cancelar" — voltou a "Nenhum pedido feito por aqui ainda."

8. **Celular (375px)** — PASSOU. Repeti os passos 2, 6 e 7 com viewport emulado em 375px:
   - Passo 2: domingos de setembro aparecem corretamente esmaecidos/sem clique (mesmo atributo de
     motivo no DOM).
   - Passo 6: navegação de mês idêntica, sem quebra de layout.
   - Passo 7: janela de pedido abre em largura cheia, título por extenso, fecha pelo X (testado).
   - Sem rolagem lateral: `document.documentElement.scrollWidth === clientWidth === 375` tanto na tela
     do calendário quanto com a janela de pedido aberta.
   (Não reenviei um segundo pedido real no mobile — a mecânica de envio já foi validada no passo 7
   desktop e o back-end é o mesmo; só validei abertura/fechamento/layout no mobile para não gerar mais
   um pedido de teste para cancelar.)

9. **Desfazer tudo** — CONFIRMADO. Domingo reaberto ("Data reaberta" / toggle desligado e persistente),
   bloqueio pontual de 15/09 removido ("Data reaberta"), nenhum pedido pendente em Produção Teste.
   Confirmei via chamada direta à RPC `portal_agenda` após a limpeza: `pedidos: []`, e os dias
   06/09, 13/09, 20/09, 27/09 e 15/09 voltaram todos a `estado: "livre", motivo: null`. O bloqueio
   pré-existente "Segunda-feira, 21/09/2026 — Feriado" foi deixado intacto (já existia antes do teste,
   não fui eu que criei).

## Defeitos encontrados

- **Menor / não bloqueante**: no modal interno "Agenda bloqueada" (admin, dentro do projeto), a tecla
  Esc não fecha o modal — só funciona clique fora ou o X. Isso é diferente da janela de pedido do
  portal do cliente (onde Esc funciona corretamente). Não estava no escopo pedido explicitamente (o
  pedido de Esc/X/clique-fora era para a janela de pedido do cliente, que passou), mas fica registrado
  porque testei por analogia e notei a inconsistência.

## Observações fora de escopo (não corrigidas, só anotadas)

- Existe um bloqueio pontual pré-existente em 18/09/2026 (sexta-feira) sem motivo cadastrado, que
  aparece no portal como "Indisponível" genérico. Não fui eu que criei, é dado de produção já existente;
  mencionar caso o motivo devesse ter sido preenchido por quem bloqueou.
