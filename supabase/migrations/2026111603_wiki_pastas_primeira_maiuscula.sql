-- WIKI: atualiza a página "Como usar as pastas do Drive" para os nomes novos das pastas (só a primeira letra maiúscula).
-- Decisão do Caio em 16/11/2026: Marca, Projetos, 00_Documentos, 01_Bruto, 02_Artes/01_Trilhas, 03_Export/01_Revisao e 03_Export/02_Final.
-- Só troca os nomes de pasta dentro do texto da página; o resto do texto (inclusive edições feitas na Wiki) fica como está.
-- Seguro rodar mais de uma vez: na segunda vez não há mais nada a trocar e a página não é tocada.
-- Fonte do texto: docs/wiki/como-usar-as-pastas-do-drive.md

DO $$
DECLARE
  antes   text;
  depois  text;
  pagina  record;
  qtd     int := 0;
BEGIN
  FOR pagina IN SELECT id, content FROM public.wiki_pages WHERE title = 'Como usar as pastas do Drive' LOOP
    antes  := pagina.content;
    depois := antes;
    depois := replace(depois, '00_DOCUMENTOS', '00_Documentos');
    depois := replace(depois, '01_BRUTO',      '01_Bruto');
    depois := replace(depois, '02_ARTES',      '02_Artes');
    depois := replace(depois, '01_TRILHAS',    '01_Trilhas');
    depois := replace(depois, '03_EXPORT',     '03_Export');
    depois := replace(depois, '01_REVISAO',    '01_Revisao');
    depois := replace(depois, '02_FINAL',      '02_Final');
    depois := replace(depois, 'MARCA',         'Marca');
    depois := replace(depois, 'PROJETOS',      'Projetos');
    IF depois <> antes THEN
      UPDATE public.wiki_pages SET content = depois, updated_at = now() WHERE id = pagina.id;
      qtd := qtd + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'Páginas atualizadas: %', qtd;
END $$;
