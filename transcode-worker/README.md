# Worker de transcodificação (Cloud Run + ffmpeg)

Converte os `.mov`/ProRes que entram na revisão em um **proxy MP4 H.264** que toca
no player. O original fica intacto (o download entrega ele). Custo ~R$ 0/mês no
volume de um estúdio (cabe no tier gratuito do Cloud Run).

## Como funciona

1. Entra um `.mov` em `video_versions` → o trigger marca `transcode_status = 'pending'`
   e chama este worker (via `pg_net`).
2. O worker baixa o original do Drive, roda `ffmpeg` (H.264 até 1080p… na verdade
   até 1920 de largura), sobe o proxy MP4 na **mesma pasta** do Drive e grava
   `proxy_file_id` + `transcode_status = 'ready'`.
3. A `review-stream` passa a servir o proxy no player; o download continua no original.

## Pré-requisitos (uma vez)

- Ter o **gcloud CLI** logado no projeto do Google que já hospeda o service account
  do Drive: `gcloud auth login` e `gcloud config set project SEU_PROJECT_ID`.
- Habilitar as APIs:
  ```bash
  gcloud services enable run.googleapis.com cloudbuild.googleapis.com
  ```

## 1) Gere um segredo do webhook

```bash
openssl rand -hex 24
```
Guarde esse valor — ele vai no `TRANSCODE_SECRET` (abaixo) e no `<SEGREDO>` da migration.

## 2) Crie o arquivo de variáveis `env.yaml` (NÃO comitar)

Nesta pasta (`transcode-worker/`), crie `env.yaml`:

```yaml
TRANSCODE_SECRET: "COLE_O_SEGREDO_DO_PASSO_1"
SUPABASE_URL: "https://byntpekyfhzwfihjhzuo.supabase.co"
SUPABASE_SERVICE_ROLE_KEY: "COLE_A_SERVICE_ROLE_KEY_DO_SUPABASE"
GOOGLE_SERVICE_ACCOUNT_JSON: '{"type":"service_account", ... COLE O JSON INTEIRO EM UMA LINHA ... }'
```

> A `service_role key` está em Supabase → Project Settings → API.
> O `GOOGLE_SERVICE_ACCOUNT_JSON` é o mesmo JSON do service account do Drive
> (o mesmo já usado nas edge functions). Cole o conteúdo inteiro entre aspas simples.

## 3) Deploy (na pasta `transcode-worker/`)

```bash
gcloud run deploy lumos-transcode \
  --source . \
  --region southamerica-east1 \
  --allow-unauthenticated \
  --no-cpu-throttling \
  --memory 8Gi \
  --cpu 4 \
  --timeout 3600 \
  --concurrency 1 \
  --max-instances 3 \
  --env-vars-file env.yaml
```

- `--allow-unauthenticated` + o header `x-transcode-secret` fazem a autenticação
  (mesmo padrão das nossas edge functions públicas).
- `--no-cpu-throttling`: o worker responde na hora e transcodifica em background.
- `--memory 8Gi`: o Cloud Run usa `/tmp` em RAM, então o arquivo de origem precisa
  caber na memória. 8Gi cobre clipes de revisão normais. Clipes MUITO grandes podem
  exigir mais memória (é só aumentar `--memory`).

No fim, o gcloud imprime a **Service URL** (ex.: `https://lumos-transcode-xxxx.a.run.app`).
Guarde ela.

## 4) Rode a migration

Abra `supabase/migrations/2026081700_video_proxy.sql`, troque:
- `<CLOUD_RUN_URL>` pela Service URL do passo 3 (sem barra no final).
- `<SEGREDO>` pelo segredo do passo 1.

E rode no SQL Editor do Supabase.

## 5) Avise o Claude

Depois que a migration rodar, o Claude faz o deploy da `review-stream` atualizada
(que passa a servir o proxy). **Não** dá pra deployar antes da migration, senão a
review quebra (colunas ainda não existem).

## Testar

Suba um `.mov` ProRes na revisão. Em ~1–3 min (depende do tamanho) o
`transcode_status` vira `ready` e o vídeo toca no player. Enquanto processa, o
player mostra o aviso de "não foi possível exibir" (o proxy ainda não ficou pronto).

## Custo

Cloud Run cobra por uso. Free tier mensal cobre ~centenas de transcodes curtos.
`--max-instances 3` limita gastos em caso de fila. Sem uso, custa R$ 0.
