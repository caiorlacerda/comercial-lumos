# SPEC-DEV — Revisão de Vídeo estilo Frame.io (Fase 3)

Documento de especificação do link público de revisão de vídeo para o cliente.
Base já pronta: **Fase 2** (tabela `video_versions`, detecção no dropzone via
`drive-watch`, máquina de estados interno→cliente→aprovado, painel no app).
Esta fase constrói a **experiência do cliente** e os **comentários**.

---

## 1. Objetivo

Cada versão de vídeo em `EM_REVISAO_CLIENTE` gera um **link público**. O cliente
abre, se identifica pelo nome, e vê um **player + painel de comentários** onde
comenta exatamente no timecode, com desenhos/setas/imagens. Marca d'água com o
nome de quem abriu (atribuição de vazamento), controle de download, e specs do
vídeo. Tudo o que ele faz volta atrelado à plataforma.

---

## 2. Fluxo do cliente

1. Recebe o link: `app.produtoralumos.com.br/revisao/:token` (rota **pública**, fora do AuthWrapper).
2. **Identificação:** tela pede só o nome → botão "Entrar". Cria/recupera um `review_viewer` e guarda o id no `localStorage` (não pede de novo). O nome vira a atribuição da marca d'água e a autoria dos comentários.
3. **Página de revisão:** player à esquerda, comentários à direita (responsivo: empilha no mobile).
4. Comenta no timecode atual; pode anexar desenho/seta/imagem; marca comentário como resolvido/aberto.
5. A equipe Lumos vê os comentários no painel interno (o mesmo `VideoReviewPanel`, enriquecido) e responde/avança o estado.

---

## 3. Player (requisitos do cliente)

- **Velocidade:** 1x · 1.25x · 1.5x · 1.75x · 2x (`video.playbackRate`).
- **Tela cheia** (Fullscreen API).
- **Resolução:** ver Decisão A (transcoding vs qualidade única).
- **Marca d'água:** overlay com o nome do espectador (ver Decisão B).
- **Download:** só se o link permitir (ver Decisão C).
- **Timecode:** display `mm:ss:ff`/`HH:MM:SS.mmm`; clicar num comentário salta o player para aquele tempo; "comentar aqui" captura o `currentTime`.

---

## 4. Comentários e anotações

- **Comentário:** texto + timecode + autor (viewer) + status (aberto/resolvido) + created_at. Réplicas (thread) opcional na v1.
- **Anotações sobre o frame** (no timecode do comentário):
  - Desenho livre (traços), setas, retângulos.
  - Imagem anexada (upload) posicionada sobre o frame.
  - Guardadas como dados vetoriais (coordenadas normalizadas 0–1 para escalar em qualquer resolução), não como pixels.
- Renderização: canvas sobreposto ao player, sincronizado ao pausar no timecode do comentário.

---

## 5. Marca d'água e atribuição de vazamento

- Overlay HTML semitransparente sobre o player: **nome do espectador + data/hora**, repetido/diagonal, difícil de recortar.
- Se alguém grava a tela ou tira print, o nome aparece → sabemos a origem.
- Toggle por link: **com** ou **sem** marca d'água.
- (Burn-in real no arquivo exigiria transcoding por espectador — fora de escopo; o overlay atende ao objetivo de atribuição.)

---

## 6. Specs do vídeo exibidas ao cliente

Formato, resolução, frame rate, duração, tamanho, codec, data da versão. Extra
úteis: versão (vNN), status atual, e "entregue por Lumos em DD/MM". As specs
técnicas vêm da Drive API (metadados `videoMediaMetadata`) e/ou de um probe no
momento do preparo.

---

## 7. Schema novo (proposto)

```
review_links
  id, video_version_id (FK), token (único), watermark boolean,
  allow_download boolean, active boolean, created_by, created_at

review_viewers
  id, review_link_id (FK), name, first_seen, last_seen

review_comments
  id, video_version_id (FK), viewer_id (FK, null = equipe interna),
  author_name, timecode_ms, body, resolved boolean, created_at

review_annotations
  id, comment_id (FK), type ('draw'|'arrow'|'rect'|'image'),
  data jsonb (pontos/coords normalizados), image_path (Storage) null
```

- **RLS:** anon pode ler `review_links`/`comments`/`viewers`/`annotations`
  **apenas** filtrando pelo token válido (policies por token, como em
  `/aprovar/:token`); inserir comentário/viewer atrelado ao link. Nunca listar
  tudo.

---

## 8. Como o vídeo chega no player (arquitetura) — **Decisão A**

O player precisa da mídia. O arquivo vive no Drive. Opções:

- **A1 — Copiar para Supabase Storage (recomendado):** ao entrar em
  `EM_REVISAO_CLIENTE`, o `drive-watch` copia o arquivo para um bucket privado;
  o player recebe **signed URL** (suporta range/streaming e controla download).
  Custo: storage + a cópia. Melhor controle (download toggle, sem expor Drive).
- **A2 — Proxy do Drive via edge function:** stream `files.get?alt=media` pela
  service account. Sem duplicar arquivo, mas toda a banda passa pela edge
  function (caro em vídeo) e range/seek é mais chato.
- **A3 — Iframe de preview do Drive:** grátis e com qualidade adaptativa nativa,
  **mas** perde overlay de marca d'água, desenhos e controle de download.
  Incompatível com os requisitos → descartado.

## 9. Multi-resolução — **Decisão A (parte 2)**

Resolução múltipla real precisa de **transcoding** (gerar 480p/720p/1080p) — um
pipeline à parte (ex.: worker/serviço de mídia). Opções:
- **Adiar (recomendado):** v1 entrega **uma** qualidade (a do arquivo) + controles
  nativos; multi-resolução vira melhoria depois.
- **Fazer agora:** integrar transcoding (mais semanas de trabalho + custo).

## 10. Download — **Decisão C**

- Com A1 (Storage): toggle real — signed URL de download só quando permitido.
- Sem permitir: player só faz streaming; escondemos controles de download.

---

## 11. Fatiamento sugerido

- **3A (essencial):** link público → identificação → player custom (A1) com
  velocidade/fullscreen/timecode → comentários por timecode → marca d'água
  (overlay) → toggle de download → specs. Painel interno mostra os comentários.
- **3B (rico):** desenhos/setas/imagens sobre o frame, comentários resolvidos/
  thread, notificação à equipe quando o cliente comenta.
- **3C (avançado):** multi-resolução (transcoding), comparação entre versões.

---

## 12. Decisões em aberto (resolver antes de codar)

- **A:** fonte de streaming — Storage (A1) vs proxy (A2). Recomendo A1.
- **A2:** multi-resolução agora (transcoding) ou depois. Recomendo depois.
- **B:** marca d'água por overlay (nome do espectador) atende? Recomendo sim.
- **Escopo:** começar por 3A e deixar 3B/3C para depois?
