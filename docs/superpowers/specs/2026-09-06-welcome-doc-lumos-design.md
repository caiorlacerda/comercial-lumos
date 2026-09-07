# Welcome Doc: o checklist vira uma página de onboarding completa

**Data:** 06/09/2026 · **Estado:** aprovado em conversa, reconciliando o brief do Caio com o que já está no ar

## O que já existe e não muda de dono

O checklist (`client_boas_vindas_itens`, `get_boas_vindas_lumos`,
`marcar_item_boas_vindas`, `boas-vindas-upload`) foi construído, revisado e
teve um buraco de segurança fechado horas atrás. Este spec **estende** esse
trabalho, não o substitui: a tabela de status continua a mesma, só ganha a
capacidade de descrever itens que vêm de um template em vez de 4 chaves
fixas no código.

## Três correções ao brief original

O Caio trouxe um brief pronto (`welcome-doc-lumos-portal-v2.html` como
referência visual). Ele é a base deste spec, com três ajustes, decididos em
conversa:

1. **Por cliente, não por projeto.** O brief amarrava tudo a `project_id`.
   Mas a decisão de hoje pro Bem-vindo à Lumos foi por `client_id` — um
   cliente tem vários projetos, o onboarding é dele, não de um projeto
   específico. Este spec segue `client_id` em toda parte onde o brief dizia
   `project_id`.
2. **Sem exigir login.** O brief assumia `auth.users`/RLS por sessão em toda
   ação do cliente. Hoje a maioria dos clientes usa o portal **sem login
   nenhum** (token + nome digitado); só quem tem `client_portals.exige_login
   = true` tem sessão de verdade (`client_users`). O modelo de permissão
   deste spec cobre os dois casos, replicando o padrão que
   `marcar_item_boas_vindas`/`boas-vindas-upload` já usam — nunca supõe uma
   conta Supabase.
3. **Tailwind não existe aqui.** O portal do cliente é CSS puro, de
   propósito, isolado do resto do app (ver `portalCliente.css.ts`). "Tokens
   do Tailwind" do brief viram variáveis CSS já existentes (`--luz`,
   `--gesso`, `--fio`, `--mesa`, `--meia-luz`) e novas classes no mesmo
   arquivo, sem trazer Tailwind pra essa página.

## Escopo desta entrega: fases 1 a 3 do brief

Dados + motor de seções + checklist migrado pro formato novo. **Fora desta
entrega:** tela de autoria interna (fase 4 — por enquanto, quem preenche
`values` é o Caio, direto no banco, com a SQL que eu preparo por cliente),
acompanhamento em tempo real, verticais Filmes/Live, editor rico. Essas
ficam explicitamente pendentes, não esquecidas.

## Modelo de dados

```sql
-- Template versionado por vertical (hoje só 'digital' existe)
client_welcome_doc_templates
  id           uuid PK
  vertical     text CHECK IN ('digital','filmes','live')
  version      int
  sections     jsonb  -- ver "Seções"
  variables    jsonb  -- ver "Variáveis"
  checklist    jsonb  -- ver "Checklist do template"
  is_active    boolean default false
  created_at   timestamptz
  UNIQUE (vertical, version)

-- Instância por CLIENTE (não por projeto)
client_welcome_docs
  id           uuid PK
  client_id    uuid REFERENCES clients(id) ON DELETE CASCADE
  template_id  uuid REFERENCES client_welcome_doc_templates(id)
  values       jsonb default '{}'  -- variáveis preenchidas
  status       text CHECK IN ('draft','published','archived') default 'draft'
  published_at timestamptz
  created_at, updated_at timestamptz
  UNIQUE (client_id)

-- Definição dos itens do checklist, snapshot do template na publicação.
-- Separado da tabela de STATUS (client_boas_vindas_itens, que não muda):
-- esta tabela diz o que existe pra preencher; a outra diz o que já foi.
client_welcome_doc_itens
  id                uuid PK
  welcome_doc_id    uuid REFERENCES client_welcome_docs(id) ON DELETE CASCADE
  item_key          text
  group_key         text  -- marca | acessos | contexto | gravacao
  titulo            text
  descricao         text
  requer_arquivo    boolean default true
  sort_order        int default 0
  UNIQUE (welcome_doc_id, item_key)
```

`client_boas_vindas_itens` (existente) ganha uma coluna nova, opcional:

```sql
ALTER TABLE client_boas_vindas_itens
  ADD COLUMN IF NOT EXISTS welcome_doc_item_id uuid
    REFERENCES client_welcome_doc_itens(id) ON DELETE SET NULL;
```

Isso liga cada linha de status ao item de template que ela preenche, sem
mexer no que já funciona: linhas antigas (Vitru, criadas hoje) ficam com
`welcome_doc_item_id = NULL` até a migração de dados (ver "Migração").
A checagem fixa de `item_key IN ('logo','brand_book','guidelines','acessos')`
na tabela de status é **relaxada** (removida), porque o item agora pode vir
de qualquer template — a validade do `item_key` passa a ser garantida pela
existência de uma linha correspondente em `client_welcome_doc_itens`, não
por uma lista fixa no banco.

**Progresso é derivado, como o brief pediu:**

```sql
CREATE VIEW client_welcome_doc_progresso AS
SELECT d.id AS welcome_doc_id, d.client_id,
       count(s.*) FILTER (WHERE s.id IS NOT NULL) AS feitos,
       count(i.*) AS total
FROM client_welcome_docs d
JOIN client_welcome_doc_itens i ON i.welcome_doc_id = d.id
LEFT JOIN client_boas_vindas_itens s
  ON s.welcome_doc_item_id = i.id AND s.client_id = d.client_id
GROUP BY d.id;
```

### Seções (`sections`)

Mesmo formato do brief, sem alteração — array ordenado, cada seção com
`type`. Tipos: `lead`, `rows`, `two-panels`, `steps`, `checklist`, `note`,
`tips`, `date-cards`, `next-steps`. Tipo desconhecido é ignorado, não
quebra a página. A seção `checklist` não carrega conteúdo — é onde o
componente do checklist (já existente, adaptado) entra.

### Variáveis (`variables`)

Mesmo formato do brief: `{{CHAVE}}` interpolado recursivamente em todo
campo string de `sections`. Obrigatória vazia bloqueia publicação (checada
na função de publicar, não só no front). Opcional vazia colapsa a frase
inteira. Nunca renderiza HTML vindo do JSON.

Lista do MVP, igual ao brief: `CLIENTE`, `ATENDIMENTO`, `PRODUCAO`,
`QTD_PECAS`, `FORMATOS`, `RODADAS`, `PRAZO_ENTREGA`, `PRAZO_FEEDBACK`,
`DATA_KICKOFF`, `DIA_FATURAMENTO`, `CANAL`, `DIA_GRAVACAO`.

### Checklist do template (`checklist`)

Mesmo formato do brief. Grupos: `marca` → "Marca", `acessos` → "Acessos e
pessoas", `contexto` → "Contexto", `gravacao` → "Gravação".

**Publicar** copia `template.checklist` pra linhas em
`client_welcome_doc_itens` (snapshot — editar o template depois não muda
docs já publicados). **Republicar** adiciona item novo e nunca apaga
`client_boas_vindas_itens` já marcado.

## Permissões

Sem RLS que suponha sessão. Leitura e escrita passam pelas mesmas duas
portas que o checklist já usa hoje:

- **Leitura do doc publicado** — nova RPC `get_welcome_doc(p_token text)`,
  `SECURITY DEFINER`, mesmo padrão de validação de token +
  `exige_login`/`client_users` que `get_boas_vindas_lumos` já implementa
  (replicar o bloco, não reinventar). Só devolve `client_welcome_docs` com
  `status = 'published'` — rascunho nunca vaza pro cliente. Devolve seções
  já com `values` do cliente prontas pro front interpolar (a interpolação
  em si roda no front, em `interpolate.ts`, como o brief já previa).
- **Escrita de status/upload** — continua sendo
  `marcar_item_boas_vindas`/`boas-vindas-upload`, sem mudança de contrato
  externo; só passam a aceitar qualquer `item_key` que exista em
  `client_welcome_doc_itens` do cliente, em vez dos 4 fixos.
- **Autoria (criar template, preencher `values`, publicar)** — só
  `authenticated` com `role IN ('admin','atendimento')` em `app_users`,
  igual o resto do app interno. Nesta entrega isso é feito por SQL direto
  (fase 4 é a tela); ainda assim as tabelas já nascem com RLS restrita a
  esse papel, não abertas.
- **Storage** — bucket `welcome-docs`, privado, path
  `clientes/{client_id}/onboarding/{item_id}/{uuid}-{nome}`, download só por
  signed URL. Limite 25MB por arquivo (mesmo teto que a `boas-vindas-upload`
  já aplica — não inventar um número novo). Tipos aceitos: os que a edge
  function já aceita hoje (qualquer arquivo, validado por tamanho, não por
  mimetype — manter o comportamento atual em vez de restringir sem pedido
  explícito).

**Critério inegociável, herdado do brief:** um cliente não lê o Welcome Doc
de outro cliente por nenhuma via, nem chamando a RPC direto com o próprio
token. Testar explicitamente (mesmo teste de isolamento que já fizemos pro
checklist, agora cobrindo `get_welcome_doc`).

## Componentes

```
src/pages/welcome-doc/
  WelcomeDocPage.tsx        // busca o doc pelo token, interpola, mapeia seções
  sections/
    LeadSection.tsx
    RowsSection.tsx         // time
    TwoPanelsSection.tsx    // incluído / fora do combinado
    StepsSection.tsx        // ciclo do mês
    NoteSection.tsx         // comunicação
    TipsSection.tsx         // feedback
    DateCardsSection.tsx
    NextStepsSection.tsx
  ProgressBar.tsx
  interpolate.ts            // {{VAR}} -> valor, testável isoladamente
```

`BoasVindasLumos.tsx` (o checklist de hoje) vira o miolo da seção
`checklist` dentro de `WelcomeDocPage` — não é jogado fora, é encaixado.
`PortalCliente.tsx` passa a renderizar `WelcomeDocPage` no lugar de
`BoasVindasLumos` direto na aba `boas_vindas`.

**Estilo:** todo elemento novo usa as classes/variáveis já definidas em
`portalCliente.css.ts` (mesmo fundo `var(--sala)`, cards `var(--mesa)`,
bordas `var(--fio)`, display Anton, mono pra metadado, amarelo com
parcimônia — igual a tabela do brief descreve, só que via essas variáveis
em vez de tokens Tailwind).

**Estados obrigatórios:** loading em skeleton (não spinner de tela
inteira); doc não publicado mostra "seu material está sendo preparado"
(nunca rascunho vazando, nunca 404); erro de upload por arquivo não derruba
a lista inteira (já é assim hoje, manter); item marcado sem anexo permitido
quando `requer_arquivo = false` (caso do "Acessos" de hoje).

**Tempo real:** fora de escopo nesta entrega (fase 4). A tela de
acompanhamento do time ainda não existe — quando existir, assina
`client_boas_vindas_itens`.

## Migração: os dados da Vitru não podem sumir

A Vitru já tem 4 itens no `client_boas_vindas_itens` de hoje (2 arquivos
reais de teste do Caio, mais os itens de verificação — o Caio decide o que
é lixo de teste e o que fica). A migração:

1. Cria o template `digital` v1 com o conteúdo do
   `welcome-doc-lumos-portal-v2.html` (texto final, não lorem).
2. Cria `client_welcome_docs` da Vitru, `status = 'published'`, com
   `values` preenchido — **os números reais de escopo (peças/mês, rodadas,
   prazo) e o canal de comunicação precisam vir do Caio antes desta
   migração rodar** (ver "Decisões em aberto").
3. Cria os 4 `client_welcome_doc_itens` (logo, brand_book, guidelines,
   acessos), e faz `UPDATE client_boas_vindas_itens SET welcome_doc_item_id
   = ...` nas linhas existentes da Vitru, ligando o que já foi enviado ao
   item novo — nada se perde, nenhum upload some.

## Fora de escopo, de propósito (nesta entrega)

- Tela de autoria interna (fase 4) — variáveis preenchidas por SQL direto.
- Acompanhamento em tempo real do time.
- Verticais Filmes e Live.
- Editor rico (TipTap) de seção.
- Notificação de onboarding concluído.
- Política de retenção de brutos (item 3 das decisões em aberto do brief) —
  não vira seção nem variável até existir uma decisão de negócio sobre isso.

## Decisões em aberto (bloqueiam só a migração da Vitru, não o resto)

1. **Canal de comunicação** — vira a variável `CANAL` (já prevista). Preciso
   do valor real (Slack? WhatsApp? outro?) antes de publicar o doc da
   Vitru.
2. **Escopo real da Vitru** — `QTD_PECAS`, `RODADAS`, `PRAZO_ENTREGA`,
   `PRAZO_FEEDBACK` precisam vir do contrato, não de exemplo. Mesma
   pendência do brief original.

O motor (template, seções, RLS, migração de schema) não depende dessas
respostas pra ser construído e testado — só a publicação real do doc da
Vitru depende.
