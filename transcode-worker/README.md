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

Nesta pasta (`transcode-worker/`), crie `env.yaml` com **3 valores** (sem o JSON —
a autenticação no Drive é feita pela identidade do Cloud Run, ver passo 3):

```yaml
TRANSCODE_SECRET: "COLE_O_SEGREDO_DO_PASSO_1"
SUPABASE_URL: "https://byntpekyfhzwfihjhzuo.supabase.co"
SUPABASE_SERVICE_ROLE_KEY: "COLE_A_SERVICE_ROLE_KEY_DO_SUPABASE"
```

> A `service_role key` está em Supabase → Project Settings → API.

## 3) Deploy (na pasta `transcode-worker/`)

Descubra o e-mail do service account do Drive (o que já é usado na integração):
```bash
gcloud iam service-accounts list
```
Copie o e-mail (algo como `...@comercial-lumos.iam.gserviceaccount.com`) e use em
`--service-account` abaixo:

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
  --service-account SEU_SERVICE_ACCOUNT_EMAIL \
  --env-vars-file env.yaml
```

> O worker usa a identidade desse service account (ADC) pra falar com o Drive —
> por isso não precisa colar o JSON. Alternativa: se preferir, dá pra passar
> `GOOGLE_SERVICE_ACCOUNT_JSON` no `env.yaml` e omitir o `--service-account`.

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

## Rota `/pull` — cópia para o Cloudflare Stream sem passar pelo Supabase

Além de converter vídeos, o worker entrega o arquivo ao Cloudflare Stream. Antes, o
Stream buscava o vídeo numa URL da Edge Function `review-stream`, e o arquivo inteiro
saía pela cota de egress do Supabase. Agora a `stream-ingest` aponta o Stream para
`<URL do worker>/pull?v=…&exp=…&sig=…` e os bytes vão Drive → Cloud Run → Cloudflare.

A assinatura é a mesma da `review-stream` (HMAC-SHA256 de `<versão>.<exp>`), válida
para uma versão e por pouco tempo. Usa o proxy MP4 quando existe e está pronto, senão o
original, e responde a `Range` e a `HEAD`.

Para ligar (nesta ordem; sem o passo 2 tudo segue pelo caminho antigo, nada quebra):

1. **No `env.yaml`**, acrescente `PULL_SECRET` com o MESMO valor do secret
   `DRIVE_WEBHOOK_SECRET` das Edge Functions, e refaça o deploy (o mesmo comando do
   passo 3 acima). A Service URL não muda.
2. **No Supabase** (Edge Functions → Secrets), crie `PULL_BASE_URL` com a Service URL do
   worker, sem barra no final, e refaça o deploy da `stream-ingest`.
3. Teste com UM vídeo novo antes de rodar "Migrar acervo".

Atenção: o worker roda com `--concurrency 1`, então cada cópia ocupa uma instância
inteira enquanto o Stream baixa. Com `--max-instances 3`, três cópias/conversões ao
mesmo tempo esgotam o limite e as seguintes esperam. Se isso incomodar, aumente
`--max-instances`.

## Custo

Cloud Run cobra por uso. Free tier mensal cobre ~centenas de transcodes curtos.
`--max-instances 3` limita gastos em caso de fila. Sem uso, custa R$ 0.

Com a rota `/pull`, a banda de saída dos vídeos enviados ao Cloudflare passa a ser
cobrada pelo Google Cloud (e não mais descontada da cota do Supabase). Acompanhe o
primeiro mês em Billing → Reports e confira o preço atual de saída de dados do Cloud Run.
