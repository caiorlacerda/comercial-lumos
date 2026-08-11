-- WIKI — Portal do cliente: guia do time + guia do cliente
--
-- Cria (ou reaproveita) o espaço "Portal do cliente" e grava duas páginas:
--   1. Guia do time    — como operar o portal aqui dentro.
--   2. Guia do cliente — o texto pronto pra mandar pra quem contrata a gente.
--
-- Rodar de novo é seguro: se as páginas já existem, o conteúdo é atualizado
-- no lugar em vez de duplicar.

DO $migration$
DECLARE
  v_space uuid;
  v_html  text;
BEGIN

  SELECT id INTO v_space FROM public.wiki_spaces WHERE name = 'Portal do cliente' LIMIT 1;
  IF v_space IS NULL THEN
    INSERT INTO public.wiki_spaces (name, icon, ordem)
    VALUES ('Portal do cliente', '🤝', 50)
    RETURNING id INTO v_space;
  END IF;

  -- ═══════════════════════════════════════════════════════════════════════
  -- 1) GUIA DO TIME
  -- ═══════════════════════════════════════════════════════════════════════
  v_html := $html$
<p>O portal é uma página só do cliente, uma por projeto, onde ele acompanha as entregas, aprova os vídeos, vê o cronograma e sabe com quem falar. É o que substitui a antiga planilha de entregas.</p>

<h2>O que é, em uma frase</h2>
<p>Um link secreto, sem login, que abre um dashboard com a cara da Lumos mostrando <strong>só aquele projeto</strong> e <strong>só o que a gente liberou</strong>. O endereço é <code>/portal/&lt;código&gt;</code>, com um código sorteado que ninguém adivinha, e dá pra revogar a qualquer momento.</p>
<p>Toda vez que o cliente abre, a gente recebe a notificação <strong>“Cliente abriu o portal 👀”</strong>. Ela vai pros administradores, pro atendimento e pra quem estiver marcado como contato do projeto, com um freio de uma hora pra não virar spam. No modal também dá pra ver quantas vezes ele abriu e quando foi a última.</p>

<h2>Como criar e entregar o link</h2>
<ol>
  <li>Produção → Projetos → abra o projeto.</li>
  <li>No menu <strong>⋯</strong> do cabeçalho, clique em <strong>🤝 Portal do cliente</strong>.</li>
  <li>Clique em <strong>Gerar link do portal</strong>. O link já sai copiado, e você entra como contato do atendimento automaticamente.</li>
  <li>Ajuste o que o cliente vê: os blocos do dashboard, a aba Cronograma, o resumo financeiro e quem ele pode chamar.</li>
  <li>Mande o link por e-mail ou WhatsApp. Quem tiver o endereço entra, então trate como documento confidencial do projeto.</li>
</ol>

<h2>As quatro abas que o cliente vê</h2>
<h3>Dashboard</h3>
<p>A visão geral, montada com os blocos que você liga no modal: números do topo (progresso, com você, aprovadas, entrega final), barra por status, etapas do projeto, atividade, arquivos e o resumo financeiro. O financeiro mostra só <strong>em dia</strong> ou <strong>pendente</strong> mais o próximo vencimento, nunca valores.</p>
<h3>Entregas</h3>
<p>A grade dos vídeos, cada um com miniatura, versão e situação: <strong>Com você</strong> (esperando ele), <strong>Aprovado</strong> (com o nome de quem aprovou e quando), <strong>Ajustes</strong> (ele pediu mudança) e <strong>Em produção</strong> (voltou pra nossa mão). Ele filtra, assiste, aprova e baixa, um por um ou tudo de uma vez.</p>
<h3>Cronograma</h3>
<p>Uma régua com o prazo do projeto e quantos dias faltam, e embaixo as etapas: o que já foi, o que está rolando agora e o que vem depois, com a janela de datas de cada uma. As datas saem das tarefas, mas agregadas por etapa, o cliente não vê título de tarefa nem responsável.</p>
<h3>Atendimento</h3>
<p>Quem ele pode chamar, com nome, cargo e e-mail clicável. Sem ninguém marcado no modal, a aba fica vazia, então confira isso antes de mandar o link.</p>

<h2>Quando o vídeo aparece pro cliente</h2>
<p>Esta é a parte mais importante do processo. <strong>Nem todo vídeo do projeto aparece no portal.</strong> A situação do vídeo decide:</p>
<table>
  <tr><th>Situação</th><th>O cliente vê?</th></tr>
  <tr><td>Em revisão interna</td><td>Não, é corte que o time ainda está mexendo</td></tr>
  <tr><td>Alterações internas</td><td>Não</td></tr>
  <tr><td>Em revisão do cliente</td><td>Sim, aparece como “Com você”</td></tr>
  <tr><td>Alterações do cliente</td><td>Sim, aparece como “Ajustes”</td></tr>
  <tr><td>Aprovado</td><td>Sim, com quem aprovou e quando</td></tr>
</table>
<p>O que empurra o vídeo pro portal é o botão <strong>Enviar ao cliente</strong>, no painel de revisão do vídeo dentro do projeto. Dá pra fazer em lote: selecione vários vídeos e mude a situação de todos de uma vez.</p>
<p>Do lado dele: clica em <strong>Revisar e aprovar</strong>, assiste e escolhe entre <strong>Aprovar vídeo</strong> e <strong>Pedir ajustes</strong>. A decisão volta na hora pro app, com o nome de quem decidiu.</p>

<h2>Liberar o download</h2>
<p>Assistir é sempre liberado. <strong>Baixar é uma permissão separada, por vídeo.</strong> No painel de revisão, no menu <strong>⋯</strong> de cada vídeo, tem a chave <strong>Download: liberado / Download: bloqueado</strong>. Enquanto estiver bloqueado, o cliente assiste mas não salva o arquivo, e o vídeo nem entra na lista do “Baixar tudo”. Dá pra liberar vários de uma vez pela seleção múltipla.</p>
<p>No portal, o botão <strong>Baixar tudo</strong> abre uma lista com um botão por arquivo, mais um <strong>Baixar todos de uma vez</strong>. Nesse último o navegador pergunta se pode salvar vários arquivos, e o cliente precisa clicar em <strong>Permitir</strong>. Se ele disser que veio só um, é isso.</p>

<h2>Arquivos e cronograma</h2>
<p><strong>Arquivos:</strong> o bloco mostra só os documentos do projeto marcados com a categoria <strong>Entrega (portal)</strong>. Roteiro aprovado, apresentação final, o que fizer sentido entregar. Documento com outra categoria não vai pro portal.</p>
<p><strong>Cronograma:</strong> a aba usa as datas das tarefas (início, fim e data de entrega ao cliente) e a régua do topo usa as datas do próprio projeto. Em projeto sem datas, a aba aparece mas fica vazia, então vale desligá-la até o cronograma estar montado.</p>
<blockquote>Se a previsão de uma etapa vencer, o portal não mostra a data velha como se ainda valesse. No lugar dela aparece “estamos confirmando a nova data desta etapa, a gente te avisa”. Mantenha as datas em dia, senão o cliente vê esse aviso e cobra.</blockquote>

<h2>O que você controla no modal</h2>
<p>Tudo é por projeto e salva na hora, sem botão de confirmar.</p>
<table>
  <tr><th>Controle</th><th>O que faz</th></tr>
  <tr><td>Link do cliente</td><td>Copiar, abrir e ver quantas vezes ele abriu e quando foi a última</td></tr>
  <tr><td>Números do topo</td><td>Progresso, com você, aprovadas e entrega final</td></tr>
  <tr><td>Barra por status</td><td>Quantas entregas em cada situação</td></tr>
  <tr><td>Etapas do projeto</td><td>A régua roteiro, captação, edição e revisão</td></tr>
  <tr><td>Atividade</td><td>Histórico do que foi entregue e aprovado</td></tr>
  <tr><td>Arquivos</td><td>Os documentos marcados como Entrega (portal)</td></tr>
  <tr><td>Resumo financeiro</td><td>Só “em dia” ou “pendente” e o próximo vencimento, nunca valores</td></tr>
  <tr><td>Aba Cronograma</td><td>Liga e desliga a aba inteira pro cliente</td></tr>
  <tr><td>Atendimento</td><td>Quem do time aparece pro cliente chamar, pode ser mais de um</td></tr>
  <tr><td>Revogar link</td><td>Derruba o acesso na hora, gerar de novo cria um link diferente</td></tr>
</table>

<h2>O que o cliente nunca vê</h2>
<ul>
  <li>Custos do projeto, margem e lucro</li>
  <li>Valores a receber, notas e boletos</li>
  <li>Nome de quem é responsável por cada tarefa</li>
  <li>Título das tarefas e o quadro interno</li>
  <li>Vídeos em revisão interna</li>
  <li>Qualquer outro projeto, inclusive do mesmo cliente</li>
</ul>
<p>Cuidados no dia a dia: um link por projeto, nunca reaproveite entre projetos; cliente trocou de contato, revogue e gere outro; confira o modal antes de mandar, principalmente o financeiro e os contatos.</p>

<h2>Dúvidas comuns</h2>
<h3>O cliente diz que não está vendo um vídeo que a gente entregou</h3>
<p>Quase sempre o vídeo ainda está em revisão interna. Abra o painel de revisão do projeto e use <strong>Enviar ao cliente</strong>.</p>
<h3>Ele clicou em baixar tudo e veio só um arquivo</h3>
<p>É o navegador pedindo permissão pra salvar vários arquivos. Peça pra clicar em <strong>Permitir</strong> no aviso, ou no ícone de download na barra de endereço. Na mesma lista tem um botão por arquivo, e esse nunca é bloqueado.</p>
<h3>Ele não consegue baixar nenhum vídeo</h3>
<p>O download é uma permissão separada da visualização. No menu ⋯ do vídeo, deixe <strong>Download: liberado</strong>.</p>
<h3>A aba Cronograma está vazia</h3>
<p>O projeto está sem datas nas tarefas. Preencha início, fim e a data de entrega ao cliente, ou desligue a aba no modal.</p>
<h3>O cliente pediu ajuste, e agora?</h3>
<p>O vídeo passa pra “alterações do cliente” e continua visível pra ele, com o aviso de que uma nova versão está a caminho. Quando você enviar a nova versão ao cliente, ela toma o lugar na grade, que mostra sempre a versão mais recente de cada vídeo.</p>
<h3>Mandei o link errado, dá pra desfazer?</h3>
<p>Dá. No modal, clique em <strong>Revogar link</strong>: o endereço antigo para de funcionar na hora. Gerar de novo cria um link diferente, o antigo não volta.</p>
$html$;

  IF EXISTS (SELECT 1 FROM public.wiki_pages WHERE space_id = v_space AND title = 'Guia do time') THEN
    UPDATE public.wiki_pages
    SET content = v_html, icon = '🛠️', ordem = 1, updated_at = now()
    WHERE space_id = v_space AND title = 'Guia do time';
  ELSE
    INSERT INTO public.wiki_pages (space_id, title, content, icon, ordem)
    VALUES (v_space, 'Guia do time', v_html, '🛠️', 1);
  END IF;

  -- ═══════════════════════════════════════════════════════════════════════
  -- 2) GUIA DO CLIENTE
  -- ═══════════════════════════════════════════════════════════════════════
  v_html := $html$
<blockquote>Só pro time: esta página é o texto pronto pra mandar pro cliente junto com o link do portal. Copie daqui pra baixo, cole no e-mail e apague este aviso.</blockquote>

<hr>

<p>Bem-vindo ao portal do seu projeto na Lumos. É aqui que você acompanha tudo: o que já foi entregue, o que está esperando você, o que vem pela frente e com quem falar quando precisar.</p>

<h2>Como entrar</h2>
<p>Basta abrir o link que a gente te mandou. Não tem senha nem cadastro. O link é exclusivo do seu projeto, então guarde com você e evite repassar pra fora da sua equipe.</p>
<p>Funciona no computador e no celular, e você pode trocar entre o tema escuro e o claro no botão do canto superior direito.</p>

<h2>O que tem em cada aba</h2>
<h3>Dashboard</h3>
<p>A visão geral do projeto: quanto já foi aprovado, quantos vídeos estão esperando você, a data da entrega final e o histórico do que aconteceu. Se o seu projeto tiver o resumo financeiro ligado, você também vê se os pagamentos estão em dia e qual o próximo vencimento.</p>
<h3>Entregas</h3>
<p>Todos os vídeos que já chegaram até você. Cada um mostra em que pé está:</p>
<ul>
  <li><strong>Com você</strong>: está esperando a sua aprovação</li>
  <li><strong>Aprovado</strong>: você já deu o ok, com a data e o nome de quem aprovou</li>
  <li><strong>Ajustes</strong>: você pediu mudanças e a nova versão está sendo feita</li>
  <li><strong>Em produção</strong>: está com a nossa equipe</li>
</ul>
<p>Use os filtros do topo pra ver só o que está esperando você, ou só o que já foi aprovado.</p>
<h3>Cronograma</h3>
<p>O caminho do projeto: quanto tempo falta pra entrega final e em que etapa estamos, do roteiro à aprovação. As datas são a nossa previsão de trabalho e podem mudar conforme as aprovações. Quando alguma data mudar, a gente avisa por ali.</p>
<h3>Atendimento</h3>
<p>Quem da Lumos está com o seu projeto, com o e-mail de cada um. Qualquer dúvida, é só chamar.</p>

<h2>Como aprovar um vídeo</h2>
<ol>
  <li>Vá na aba <strong>Entregas</strong> e procure os vídeos marcados como <strong>Com você</strong>.</li>
  <li>Clique em <strong>Revisar e aprovar</strong>.</li>
  <li>Assista ao vídeo na página que abrir.</li>
  <li>Se estiver tudo certo, clique em <strong>Aprovar vídeo</strong>. Se quiser mudanças, clique em <strong>Pedir ajustes</strong> e descreva o que precisa.</li>
</ol>
<p>Assim que você decide, a nossa equipe é avisada na hora. No caso dos ajustes, o vídeo passa a aparecer como <strong>Ajustes</strong> no portal até a nova versão ficar pronta, e ela entra no lugar da anterior.</p>
<p>Quanto mais específico for o pedido de ajuste, mais rápido a nova versão volta. Vale citar o minuto exato do que incomodou.</p>

<h2>Como baixar os arquivos</h2>
<p>Nos vídeos liberados pra download aparece um botão de baixar. Pra levar tudo de uma vez, use o botão <strong>Baixar tudo</strong> no topo das entregas: ele abre uma lista com um botão pra cada arquivo, e um pra baixar todos juntos.</p>
<p>Se você escolher baixar todos juntos, o navegador vai perguntar se pode salvar vários arquivos. Clique em <strong>Permitir</strong>. Se vier só um arquivo, é porque essa permissão foi negada, então baixe pela lista, um por um, que sempre funciona.</p>
<p>Não achou o botão de baixar em algum vídeo? O download desse arquivo ainda não foi liberado. Chama a gente na aba Atendimento que a gente libera.</p>

<h2>Se alguma coisa não aparecer</h2>
<p>O portal mostra os vídeos a partir do momento em que eles são enviados pra sua aprovação. Se você está esperando um material que ainda não apareceu, provavelmente ele ainda está em produção com a nossa equipe. Qualquer dúvida sobre prazo, a aba Cronograma mostra a previsão de cada etapa, e a gente responde rápido no Atendimento.</p>
$html$;

  IF EXISTS (SELECT 1 FROM public.wiki_pages WHERE space_id = v_space AND title = 'Guia do cliente') THEN
    UPDATE public.wiki_pages
    SET content = v_html, icon = '👋', ordem = 2, updated_at = now()
    WHERE space_id = v_space AND title = 'Guia do cliente';
  ELSE
    INSERT INTO public.wiki_pages (space_id, title, content, icon, ordem)
    VALUES (v_space, 'Guia do cliente', v_html, '👋', 2);
  END IF;

END $migration$;
