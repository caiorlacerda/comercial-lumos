-- WIKI: página "Como usar as pastas do Drive" (texto aprovado pelo Caio em 03/11/2026).
-- Entra no primeiro espaço da Wiki, no fim da lista de páginas de raiz. Seguro rodar mais de uma vez:
-- se já existe uma página com esse título no espaço, não cria outra e não mexe na existente.
-- O conteúdo usa só o que o editor da Wiki entende (títulos, parágrafos, listas, bloco de código, negrito).
-- Fonte do texto: docs/wiki/como-usar-as-pastas-do-drive.md

DO $$
DECLARE
  sp uuid;
BEGIN
  SELECT id INTO sp FROM public.wiki_spaces ORDER BY ordem, created_at LIMIT 1;
  IF sp IS NULL THEN
    RAISE NOTICE 'Wiki sem nenhum espaço: página não criada.';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.wiki_pages WHERE space_id = sp AND title = 'Como usar as pastas do Drive') THEN
    RAISE NOTICE 'A página "Como usar as pastas do Drive" já existe: nada a fazer.';
    RETURN;
  END IF;

  INSERT INTO public.wiki_pages (space_id, parent_id, title, icon, ordem, content)
  VALUES (
    sp, NULL, 'Como usar as pastas do Drive', '📁',
    (SELECT COALESCE(MAX(ordem) + 1, 0) FROM public.wiki_pages WHERE space_id = sp AND parent_id IS NULL),
    $html$<h2>Para que serve</h2>
<p>Todo cliente e todo projeto da Lumos tem a mesma estrutura de pastas no Drive. Quem abre um projeto novo sabe onde está cada coisa, e o app (revisão de vídeo, OS, documentos) acha as pastas sozinho. <strong>Por isso não renomeie, mova nem crie pastas dentro de um cliente ou de um projeto.</strong></p>
<h2>A hierarquia</h2>
<pre><code>Cliente
 ├─ MARCA                  materiais fixos do cliente
 └─ PROJETOS
     └─ [Sub-marca]        só para cliente com sub-marcas (ex.: Vitru › Uniasselvi)
         └─ AAAA-MM        mês do projeto (ex.: 2026-11)
             └─ NNN_NOME-DO-PROJETO
                 ├─ 00_DOCUMENTOS
                 ├─ 01_BRUTO
                 ├─ 02_ARTES
                 │   └─ 01_TRILHAS
                 └─ 03_EXPORT
                     ├─ 01_REVISAO
                     └─ 02_FINAL</code></pre>
<p>Cliente sem sub-marcas vai direto de PROJETOS para o mês: Cliente › PROJETOS › 2026-11 › 227_NOME.</p>
<h3>Nível do cliente</h3>
<ul>
<li><p><strong>MARCA</strong> guarda os materiais fixos do cliente: brandbook, logos, fontes, guidelines e afins. Ela <strong>substitui a antiga _ASSETS</strong> e fica <strong>fora dos meses</strong>. Os clientes que já existem continuam com a _ASSETS até serem renomeados; o app entende as duas.</p></li>
<li><p><strong>PROJETOS</strong> guarda todos os projetos novos do cliente.</p></li>
</ul>
<blockquote><p><strong>Atenção ao nome:</strong> a pasta MARCA (materiais fixos) <strong>não é</strong> a "marca" do projeto. A "marca" que se escolhe no app é a <strong>sub-marca</strong>, e só existe para clientes que têm várias (Vitru, por exemplo, tem <strong>Uniasselvi</strong>, <strong>Continuada</strong> e <strong>Vitru</strong>). A pasta da sub-marca fica <strong>dentro de PROJETOS</strong>.</p></blockquote>
<h3>Mês e projeto</h3>
<ul>
<li><p><strong>Mês (AAAA-MM):</strong> o mês de início do projeto; se o projeto não tem data de início, o mês em que foi criado.</p></li>
<li><p><strong>Projeto:</strong> NNN_NOME-DO-PROJETO: o código com 3 dígitos, um sublinhado e o nome do projeto aprovado no orçamento, em letras maiúsculas, sem acento, com hífen no lugar do espaço. Exemplo: 227_MINI-MISSAO.</p></li>
</ul>
<h2>O que vai em cada pasta do projeto</h2>
<ul>
<li><p><strong>00_DOCUMENTOS:</strong> roteiro, briefing, <strong>relatório de gravação</strong>, a <strong>OS</strong> (ordem de serviço) e qualquer outro documento do projeto.</p></li>
<li><p><strong>01_BRUTO:</strong> o material bruto da gravação: o <strong>cartão inteiro</strong>, com os arquivos <strong>XML</strong> e o <strong>proxy</strong>. Veja o protocolo de backup abaixo.</p></li>
<li><p><strong>02_ARTES:</strong> artes, gráficos e demais materiais visuais usados no projeto.</p></li>
<li><p><strong>02_ARTES / 01_TRILHAS:</strong> as <strong>trilhas musicais</strong> do projeto.</p></li>
<li><p><strong>03_EXPORT / 01_REVISAO:</strong> os cortes para revisão. O editor sobe o vídeo aqui (pelo app ou direto no Drive) e ele aparece na aba <strong>Entregas</strong> do projeto.</p></li>
<li><p><strong>03_EXPORT / 02_FINAL:</strong> as versões <strong>aprovadas</strong>. O app copia para cá quando o vídeo é aprovado.</p></li>
</ul>
<h2>Como achar a pasta de um projeto</h2>
<p>No app, abra o projeto e clique em <strong>Abrir pasta no Drive</strong>, no topo da página.</p>
<ul>
<li><p><strong>Pasta ainda não criada:</strong> aguarde alguns segundos e recarregue.</p></li>
<li><p><strong>Escolha a marca:</strong> o cliente tem sub-marcas e o projeto ainda não escolheu uma. Escolha na faixa amarela no topo do projeto e a pasta é criada na hora. <strong>Faça isso antes da gravação</strong>, senão o projeto fica sem pasta (e sem a OS salva no Drive).</p></li>
</ul>
<h2>Quem cria as pastas</h2>
<ul>
<li><p><strong>As pastas do projeto nascem sozinhas</strong>, pelo app, quando o projeto é criado. Ninguém precisa criá-las.</p></li>
<li><p><strong>Pastas feitas à mão</strong> (a pasta de um cliente novo, a MARCA, ou qualquer ajuste de estrutura) são criadas <strong>pela Ariella</strong> e, no máximo, pela <strong>Carol</strong>.</p></li>
<li><p>Mais ninguém cria, renomeia ou move pastas. Se precisar de uma pasta diferente, peça a elas.</p></li>
</ul>
<h2>Protocolo de backup da gravação</h2>
<ol>
<li><p>Terminou a gravação: o <strong>Douglas ou o Italo</strong> sobe o <strong>cartão inteiro</strong> para 01_BRUTO do projeto, <strong>sempre</strong>, com os <strong>XML</strong> e o <strong>proxy</strong>. Não é só o que parece útil: é o cartão todo.</p></li>
<li><p>Os <strong>editores usam esse backup</strong> quando houver qualquer problema com o material (arquivo corrompido, projeto que não abre, proxy faltando).</p></li>
<li><p>A <strong>Carol registra no relatório de gravação</strong> (em 00_DOCUMENTOS) que o backup foi feito, por quem e quando.</p></li>
</ol>
<h2>Projetos antigos</h2>
<p>Os projetos criados antes desta estrutura continuam como estão até serem migrados (com 06_ENTREGA, OS e as pastas numeradas de antes). Na dúvida, abra a pasta pelo botão <strong>Abrir pasta no Drive</strong> do projeto: ele leva sempre ao lugar certo. Lives continuam com a estrutura própria de live.</p>$html$
  );
END $$;
