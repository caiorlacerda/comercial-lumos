# Migração de projetos antigos do Drive para a estrutura nova (v2)

Reorganiza **por dentro** a pasta de cada projeto antigo (layout v1) para a estrutura nova, **de um cliente por vez**.

- Só **move**. O ID de cada pasta/arquivo não muda, então vídeos, links e o banco continuam apontando para os mesmos arquivos.
- **Nunca copia e nunca exclui de vez.** O que sobra vazio vai para a **lixeira** do Drive (recuperável), e **só se estiver vazio na hora de aplicar** (conferido de novo, mesmo que a simulação tenha dito que ficaria vazio).
- **Nunca sobrescreve.** Se o destino já tem um item com o mesmo nome, é marcado **CONFLITO** e o item fica onde está.
- A única renomeação é `02_APROVADO` → `02_FINAL` (e, só com `renomear_assets`, a `_ASSETS` do cliente → `MARCA`, mesma pasta, mesmo ID).
- Lives e projetos que já são v2 são pulados.

## Como rodar (forma normal): edge function `drive-migracao`

Roda **dentro do Supabase**, com o secret `GOOGLE_SERVICE_ACCOUNT_JSON` que já existe. Não precisa baixar chave nenhuma, e a resposta nunca devolve a chave.

**Acesso:** só com o header `x-migracao-secret` igual ao secret `DRIVE_MIGRACAO_SECRET` (comparado em tempo constante). Sem o header, com header errado ou só com a chave anônima do app → 401. A função não está ligada a nenhuma tela.

```bash
# SIMULAÇÃO (padrão): só LÊ o Drive. O cliente do Drive é criado em modo somente leitura e o banco não é tocado.
curl -s -X POST "https://<projeto>.supabase.co/functions/v1/drive-migracao" \
  -H "x-migracao-secret: $DRIVE_MIGRACAO_SECRET" -H "Content-Type: application/json" \
  -d '{"cliente":"SPX Express"}'
```

Corpo (JSON):

| Campo | O que faz |
|---|---|
| `cliente` | **Obrigatório.** Nome exato (sem diferenciar maiúsculas). Cliente que não existe, ou parecido com mais de um, devolve `409` com as opções e não faz nada. |
| `modo` | `"simulacao"` (padrão) ou `"executar"`. |
| `confirmar_cliente` | **Obrigatório para executar**, igual ao nome do cliente (é o "digite o nome" do script). Sem isso, `400` e nada é feito. |
| `projeto` | Opcional: id ou código, para migrar um projeto só. |
| `mover_para_mes` | Opcional (padrão `false`): também move a pasta do projeto para `Cliente › PROJETOS › [sub-marca] › AAAA-MM`. |
| `renomear_assets` | Opcional (padrão `false`): renomeia `_ASSETS` → `MARCA` no cliente. |
| `entrega_vazia_para_lixeira` | Opcional (padrão `false`): manda a `06_ENTREGA` para a lixeira se, no fim, ela estiver vazia. |

`executar` aplica o plano **montado na hora** (não o da simulação anterior), projeto a projeto, e grava cada projeto no banco (`drive_layout='v2'`, `drive_upload_folder_id` = ID da `01_REVISAO`, `drive_pastas`) logo depois de mexer no Drive, com filtro `drive_layout='v1'`. Para no primeiro erro e devolve o que já foi feito. Cada projeto migrado deixa uma linha em `drive_sync_log` (`migracao_v2`).

## Mapa

| Hoje (dentro da pasta do projeto) | Vai para |
|---|---|
| `00_*`, `01_*`, `02_*` e `OS` | dentro de `00_DOCUMENTOS` |
| `03_*` (ex.: `03_CAPTACAO`) | dentro de `01_BRUTO` |
| `03_*` que tem uma `BRUTO` dentro (redundante) | a `03_*` se **dissolve**: o conteúdo da `BRUTO` e tudo o mais que houver na `03_*` sobem direto para `01_BRUTO`, e as duas pastas, vazias, vão para a lixeira (evita `01_BRUTO/03_CAPTACAO/...` em volta de uma pasta só). Se algo não puder subir (conflito de nome), a `03_*` não é apagada e entra inteira em `01_BRUTO` |
| `04_*` | dentro de `02_ARTES` |
| `04_*/TRILHA` (ou `TRILHAS`) | o conteúdo é **mesclado** em `02_ARTES/01_TRILHAS`; a `TRILHA` vazia vai para a lixeira |
| `05_POS_PRODUCAO` | **vazia** → lixeira. **Com conteúdo** → não é apagada: vai inteira para `01_BRUTO` (o plano lista o que há dentro) |
| outras `05_*` | dentro de `02_ARTES` |
| `06_ENTREGA/01_REVISAO` | `03_EXPORT/01_REVISAO` |
| `06_ENTREGA/02_APROVADO` | `03_EXPORT/02_FINAL` (renomeada) |
| `06_ENTREGA/03_REDES` e `04_THUMB` | o **conteúdo** vai para `03_EXPORT/02_FINAL`; a pasta, se ficar vazia, vai para a lixeira |
| arquivo `CAM_<id>_BKP_…` (backup de câmera) nas pastas de entrega | `01_BRUTO` |

Detalhes que valem a pena saber:

- Pasta antiga entra **inteira** (ex.: `00_DOCUMENTOS/00_GERAL`), sem mexer no conteúdo. Se já existir uma pasta com o nome exato do destino (ex.: um `00_DOCUMENTOS` antigo), ela vira o destino.
- Backup de câmera: só **arquivo** (nunca pasta) cujo nome começa com `CAM_<qualquer id>_BKP_`, e só nas pastas de entrega (`01_REVISAO`, `02_APROVADO`/`02_FINAL`, `03_REDES`, `04_THUMB` e os arquivos soltos da `06_ENTREGA`). Arquivo solto na raiz do projeto não é tocado.
- Nome fora do mapa (`99_DUPLICADOS`, arquivos soltos) fica onde está.
- `06_ENTREGA`: o que sobrar nela (pastas fora do mapa) fica e é listado. Se não sobrar nada, ela **não** é apagada a menos que se peça `entrega_vazia_para_lixeira`.
- Itens que a lixeira não pode levar (a pasta ainda tem coisa dentro por conflito de nome) ficam onde estão e aparecem como aviso.

## Plano (como ler)

Cada linha do relatório é uma operação: `REAPROVEITA`, `CRIA`, `MOVE` (com o ID, se é pasta ou arquivo, de onde e para onde), `LIXEIRA`, `CONFLITO` e `fica`. O fim traz um resumo com as contagens. A simulação é a forma de conferir tudo antes de pedir o OK.

## Alternativa: script no computador

Faz exatamente a mesma coisa (mesmo núcleo em `supabase/functions/drive-migracao`), mas precisa da **chave JSON da conta de serviço** num arquivo fora do repositório. Só serve se alguém tiver essa chave; o caminho normal é a função acima.

```bash
# simulação
node scripts/drive-migracao/migrar-projetos-v2.mjs --projetos projetos.json --sa /caminho/conta-de-servico.json --drive-id <ID_DO_DRIVE> --cliente "Nome do cliente"
# executar (pede para digitar o nome do cliente; gera um .sql para rodar no banco logo depois)
... --executar [--projeto <id ou código>] [--mover-para-mes] [--renomear-assets] [--entrega-vazia-para-lixeira]
```

O `projetos.json` vem da consulta **B** de [`consultas.sql`](consultas.sql); a consulta **A** ajuda a escolher o cliente piloto.

## Desfazer
- O que foi para a **lixeira** volta pela lixeira do Drive (mesmo ID).
- Movimentos: `executar` devolve (e o script salva em `saida-drive/feito-*.json`) o nome e o pai antigos de cada item movido, então dá para voltar à mão ou pedir um script de reversão.
- Banco, se precisar voltar um projeto:

```sql
update public.projects set drive_layout = 'v1', drive_pastas = null where id = '<id do projeto>';
```
(`drive_upload_folder_id` continua válido: é o mesmo ID de `01_REVISAO`.)

## Testes
```bash
node scripts/drive-migracao/plano.test.mjs      # regras do plano (árvores em memória, inclui a regra de segurança da lixeira)
node scripts/drive-migracao/nucleo.test.mjs     # aplicação, lixeira só se vazia, parada no erro, modo somente leitura do Drive
node scripts/drive-migracao/executor.test.mjs   # o script inteiro contra um Drive falso por HTTP
node --experimental-strip-types scripts/testes-drive/migracao.test.mts   # a edge function: autenticação, 409, simulação, executar
```
